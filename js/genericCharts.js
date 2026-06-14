window.GenericCharts = {

    // Chart registry for hi-res export (copy/download)
    _charts: {},

    _registerChart(elementId, chartType, data, options) {
        this._charts[elementId] = { chartType, data, options };
    },

    // Redraw chart at 2x in a hidden offscreen div, return the image URI, then clean up
    _renderHiRes(elementId) {
        const entry = this._charts[elementId];
        if (!entry) return null;
        const SCALE = 3;
        const origEl = document.getElementById(elementId);
        if (!origEl) return null;
        const w = origEl.offsetWidth || 500;
        const h = entry.options.height || origEl.offsetHeight || 300;

        // Create offscreen container
        const tmp = document.createElement('div');
        tmp.style.cssText = `position:fixed;left:-9999px;top:-9999px;width:${w * SCALE}px;height:${h * SCALE}px;background:white;`;
        document.body.appendChild(tmp);

        // Scale up options
        const opts = JSON.parse(JSON.stringify(entry.options));
        opts.width = w * SCALE;
        opts.height = h * SCALE;
        opts.backgroundColor = 'white';
        // Scale chart area
        if (opts.chartArea) {
            for (const k of ['left','right','top','bottom']) {
                if (typeof opts.chartArea[k] === 'number') opts.chartArea[k] *= SCALE;
            }
        }
        // Scale font sizes
        const scaleFonts = (obj) => {
            if (!obj || typeof obj !== 'object') return;
            if (typeof obj.fontSize === 'number') obj.fontSize *= SCALE;
            for (const v of Object.values(obj)) scaleFonts(v);
        };
        scaleFonts(opts.hAxis); scaleFonts(opts.vAxis); scaleFonts(opts.legend);
        scaleFonts(opts.annotations); scaleFonts(opts.tooltip);
        // Scale line/point/bar sizes
        if (typeof opts.lineWidth === 'number') opts.lineWidth *= SCALE;
        if (typeof opts.pointSize === 'number') opts.pointSize *= SCALE;
        if (opts.bar && typeof opts.bar.groupWidth === 'string') {
            // keep percentage as-is
        }
        if (opts.series) {
            for (const s of Object.values(opts.series)) {
                if (typeof s.lineWidth === 'number') s.lineWidth *= SCALE;
                if (typeof s.pointSize === 'number') s.pointSize *= SCALE;
                if (s.lineDashStyle) s.lineDashStyle = s.lineDashStyle.map(v => v * SCALE);
            }
        }
        if (opts.annotations?.stem && typeof opts.annotations.stem.length === 'number') {
            opts.annotations.stem.length *= SCALE;
        }
        // Disable animation for instant render
        opts.animation = { startup: false, duration: 0 };

        const ChartClass = google.visualization[entry.chartType];
        const chart = new ChartClass(tmp);
        chart.draw(entry.data, opts);
        const uri = chart.getImageURI();
        document.body.removeChild(tmp);
        return uri;
    },

    // Copy chart as hi-res PNG to clipboard
    async copyChart(elementId) {
        try {
            const uri = this._renderHiRes(elementId);
            if (!uri) return;
            await electronAPI.invoke('clipboard-write-image', uri);
            const btn = document.querySelector(`[data-copy-chart="${elementId}"]`);
            if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.innerHTML = '<i data-lucide="copy" width="11"></i>'; if (window.lucide) lucide.createIcons(); }, 1500); }
        } catch (e) { console.error('Copy chart failed:', e); }
    },

    // Download chart as hi-res PNG
    downloadChart(elementId, name) {
        try {
            const uri = this._renderHiRes(elementId);
            if (!uri) return;
            const a = document.createElement('a');
            a.href = uri;
            a.download = (name || elementId).replace(/[^a-zA-Z0-9_-]/g, '_') + '.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (e) { console.error('Download chart failed:', e); }
    },

    // ── Map export (uses Electron capturePage for pixel-perfect capture) ──────
    async _captureMap(elementId) {
        const el = document.getElementById(elementId);
        if (!el) return null;

        // Hide Leaflet controls for a cleaner export
        const controls = el.querySelectorAll('.leaflet-control-container');
        controls.forEach(c => { c._prevDisplay = c.style.display; c.style.display = 'none'; });

        // Boost watermark opacity for export
        const wm = el.querySelector('.map-watermark');
        if (wm) wm.style.opacity = '0.8';

        // Wait a frame for the controls to hide
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        try {
            const rect = el.getBoundingClientRect();
            const captureRect = {
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
            };
            const nativeImage = await electronAPI.invoke('capture-page', captureRect);
            return nativeImage;
        } finally {
            controls.forEach(c => { c.style.display = c._prevDisplay || ''; });
            if (wm) wm.style.opacity = '';
        }
    },

    async copyMap(elementId) {
        try {
            const uri = await this._captureMap(elementId);
            if (!uri) return;
            await electronAPI.invoke('clipboard-write-image', uri);
            const btn = document.querySelector(`[data-copy-map="${elementId}"]`);
            if (btn) { const orig = btn.innerHTML; btn.textContent = 'Copied!'; setTimeout(() => { btn.innerHTML = orig; if (window.lucide) lucide.createIcons(); }, 1500); }
        } catch (e) { console.error('Copy map failed:', e); }
    },

    async downloadMap(elementId, name) {
        try {
            const uri = await this._captureMap(elementId);
            if (!uri) return;
            const a = document.createElement('a');
            a.href = uri;
            a.download = (name || 'map').replace(/[^a-zA-Z0-9_-]/g, '_') + '.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (e) { console.error('Download map failed:', e); }
    },

    // Draw a cumulative monthly progress line for a single KPI, with optional target line
    drawCumulativeProgress(elementId, monthlyData, kpiId, target, color) {
        const el = document.getElementById(elementId);
        if (!el) return;

        const kpiSeries = (monthlyData[kpiId] || []);
        const now = new Date();
        // Only show months up to current month (for current year) or all 12
        const maxMonth = 12; // always show full year projection

        if (kpiSeries.length === 0 || kpiSeries.every(([, v]) => v === 0)) {
            el.innerHTML = '<p class="text-slate-300 text-xs text-center py-6">No data this year</p>';
            return;
        }

        const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const data = new google.visualization.DataTable();
        data.addColumn('string', 'Month');
        data.addColumn('number', 'Achieved');
        if (target > 0) data.addColumn('number', 'Target');

        kpiSeries.slice(0, maxMonth).forEach(([m, val]) => {
            const row = [MONTH_LABELS[m - 1], val];
            if (target > 0) row.push(target);
            data.addRow(row);
        });

        const options = {
            height: 120,
            legend: 'none',
            chartArea: { left: 40, right: 10, top: 10, bottom: 28, width: '85%', height: '76%' },
            colors: target > 0 ? [color, '#94a3b8'] : [color],
            curveType: 'function',
            lineWidth: 2.5,
            pointSize: 4,
            series: target > 0 ? {
                0: { lineWidth: 2.5, pointSize: 4 },
                1: { lineWidth: 1.5, lineDashStyle: [3, 4], pointSize: 0 }
            } : {},
            hAxis: { textStyle: { fontSize: 9, color: '#64748b' }, baselineColor: '#e2e8f0', gridlines: { color: 'transparent' } },
            vAxis: { textStyle: { fontSize: 9, color: '#94a3b8' }, baselineColor: '#e2e8f0', gridlines: { color: '#f1f5f9', count: 3 }, minorGridlines: { count: 0 }, minValue: 0 },
            backgroundColor: 'transparent',
            focusTarget: 'category',
            tooltip: { textStyle: { fontSize: 11, color: '#1e293b' } }
        };

        const chart = new google.visualization.LineChart(el);
        chart.draw(data, options);
        this._registerChart(elementId, 'LineChart', data, options);
    },

    drawKpiTimeSeries(elementId, kpiData, kpiDef, projectColor) {
        const el = document.getElementById(elementId);
        if (!el || !kpiData || kpiData.length === 0) return;

        const rows = kpiData
            .filter(d => d.values[kpiDef.id] !== undefined && d.values[kpiDef.id] !== null)
            .map(d => [new Date(d.date + 'T00:00:00'), Number(d.values[kpiDef.id])]);

        if (rows.length === 0) {
            el.innerHTML = '<p class="text-slate-400 text-sm italic text-center py-8">No data yet</p>';
            return;
        }

        const data = new google.visualization.DataTable();
        data.addColumn('date', 'Date');
        data.addColumn('number', kpiDef.name);
        data.addRows(rows);

        const areaOpts = {
            height: 200,
            legend: 'none',
            chartArea: { left: 60, right: 20, top: 20, bottom: 40, width: '85%', height: '78%' },
            colors: [projectColor || '#4389C8'],
            areaOpacity: 0.15,
            curveType: 'function',
            lineWidth: 2.5,
            pointSize: 5,
            hAxis: { format: 'MMM yyyy', textStyle: { fontSize: 11, color: '#64748b' }, baselineColor: '#e2e8f0', gridlines: { color: 'transparent' } },
            vAxis: { textStyle: { fontSize: 11, color: '#64748b' }, baselineColor: '#e2e8f0', gridlines: { color: '#f1f5f9', count: 5 }, minorGridlines: { count: 0 }, minValue: 0, format: 'short' },
            backgroundColor: 'transparent',
            focusTarget: 'category'
        };
        const chart = new google.visualization.AreaChart(el);
        chart.draw(data, areaOpts);
        this._registerChart(elementId, 'AreaChart', data, areaOpts);
    },

    // Convert hex color to rgba string
    _hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    },

    // Draw multi-year org progress charts (actuals bars + targets line) for each KPI
    // idPrefix defaults to 'org-chart-' but can be overridden for project-level charts
    // filters = { hiddenYears: Set<number>, showTargets: bool, showActuals: bool }
    drawOrgYearlyProgress(multiYearData, selectedYear, idPrefix = 'org-chart-', filters = {}) {
        // Google Charts loads packages asynchronously; ComboChart only becomes available
        // after the 'corechart' package has loaded. Retry once after a short delay if
        // the page tried to render before the script finished loading.
        if (!window.google || !google.visualization || !google.visualization.ComboChart) {
            setTimeout(() => this.drawOrgYearlyProgress(multiYearData, selectedYear, idPrefix, filters), 300);
            return;
        }

        const hiddenYears  = filters.hiddenYears  || new Set();
        const showTargets  = filters.showTargets  !== false;
        const showActuals  = filters.showActuals  !== false;

        const visibleData = multiYearData.filter(r => !hiddenYears.has(r.year));

        Projects.STANDARD_KPIS.forEach(kpi => {
            const el = document.getElementById(idPrefix + kpi.id);
            if (!el) return;

            if (!showTargets && !showActuals) {
                el.innerHTML = '<p class="text-xs text-slate-400 italic text-center pt-10">No series selected.</p>';
                return;
            }

            const data = new google.visualization.DataTable();
            data.addColumn('string', 'Year');
            if (showActuals) {
                data.addColumn('number', 'Actuals');
                data.addColumn({ type: 'string', role: 'annotation' });
            }
            if (showTargets) {
                data.addColumn('number', 'Targets');
            }

            visibleData.forEach(row => {
                const actual = row.actuals[kpi.id] || 0;
                const target = row.targets[kpi.id] || 0;
                const annot  = actual > 0 ? GenericCharts._fmtShort(actual) : null;
                const rowArr = [String(row.year)];
                if (showActuals) rowArr.push(actual > 0 ? actual : null, annot);
                if (showTargets) rowArr.push(target > 0 ? target : null);
                data.addRow(rowArr);
            });

            // Build series config dynamically
            const seriesConfig = {};
            let seriesIdx = 0;
            if (showActuals) { seriesConfig[seriesIdx++] = { type: 'bars', color: kpi.color }; }
            if (showTargets) { seriesConfig[seriesIdx++] = { type: 'line', lineWidth: 2, pointSize: 5, color: '#64748b', lineDashStyle: [3, 4] }; }

            const chart = new google.visualization.ComboChart(el);
            const chartId = idPrefix + kpi.id;
            const comboOpts = {
                height: 230,
                seriesType: showActuals ? 'bars' : 'line',
                series: seriesConfig,
                bar: { groupWidth: '48%' },
                legend: { position: 'top', alignment: 'end', textStyle: { fontSize: 10, color: '#64748b' } },
                chartArea: { left: 50, right: 18, top: 28, bottom: 32, width: '85%', height: '78%' },
                hAxis: { textStyle: { fontSize: 11, color: '#64748b' }, baselineColor: '#e2e8f0', gridlines: { color: 'transparent' } },
                vAxis: { textStyle: { fontSize: 10, color: '#94a3b8' }, baselineColor: '#e2e8f0', gridlines: { color: '#f1f5f9', count: 4 }, minorGridlines: { count: 0 }, minValue: 0, format: 'short' },
                annotations: { textStyle: { fontSize: 11, color: '#1e293b', bold: true, auraColor: '#ffffff' }, alwaysOutside: true, stem: { length: 4, color: 'transparent' } },
                backgroundColor: 'transparent',
                animation: { startup: false, duration: 0 },
                focusTarget: 'category',
                tooltip: { textStyle: { fontSize: 12, color: '#1e293b' }, showColorCode: true }
            };
            chart.draw(data, comboOpts);
            GenericCharts._registerChart(chartId, 'ComboChart', data, comboOpts);
        });
    },

    // Short number formatter for annotations (1.2k, 3.4M etc.)
    _fmtShort(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (n >= 1000)    return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
        return String(n);
    },

    drawAllKpis(containerId, kpiData, kpiDefinitions, projectColor) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!kpiDefinitions || kpiDefinitions.length === 0) {
            container.innerHTML = '<p class="text-slate-400 text-sm italic text-center py-8">No KPIs defined. Add KPIs in Project Settings.</p>';
            return;
        }

        container.innerHTML = kpiDefinitions.map(kpi =>
            `<div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
                <h3 class="text-sm font-bold text-slate-700 mb-2">${kpi.name} ${kpi.unit ? '<span class="text-slate-400 font-normal">(' + kpi.unit + ')</span>' : ''}</h3>
                <div id="chart-${kpi.id}" style="width:100%; min-height:200px;"></div>
            </div>`
        ).join('');

        // Draw after DOM is ready
        setTimeout(() => {
            kpiDefinitions.forEach(kpi => {
                this.drawKpiTimeSeries('chart-' + kpi.id, kpiData, kpi, projectColor);
            });
        }, 50);
    }
};
