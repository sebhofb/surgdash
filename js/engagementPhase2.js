// Phase 2 engagement sections — strategic + forecasting.
//   #11 Quality-weighted Impact Map (Google GeoChart, metric selector)
//   #17 Reach-Gap (Lancet) — how well we serve countries with surgical-care gaps
//   #16 Growth Forecast — simple trend extrapolation with milestone ETAs

Object.assign(window.App, {
    // ── State for Impact Map metric switcher ──────────────────────────────
    _impactMapMetric: 'avgMins', // avgMins | completion | activePct | enrolls
    _impactMapMin: 50,           // minimum learners to be coloured (avoid noise)

    _setImpactMapMetric(v) {
        this._impactMapMetric = v;
        // Re-render just the section so the dropdown reflects, then redraw the map
        const el = document.getElementById('eng-impact-map');
        if (el) {
            const data = this._computeEngagement();
            if (data) el.outerHTML = this._renderImpactMap(data);
            if (window.lucide) lucide.createIcons();
        }
        setTimeout(() => this._drawImpactMap(), 50);
    },
    _setImpactMapMin(v) {
        this._impactMapMin = Math.max(0, Number(v) || 0);
        const data = this._computeEngagement();
        if (data) {
            const el = document.getElementById('eng-impact-map');
            if (el) el.outerHTML = this._renderImpactMap(data);
            if (window.lucide) lucide.createIcons();
        }
        setTimeout(() => this._drawImpactMap(), 50);
    },

    // ── #11 Quality-Weighted Impact Map ───────────────────────────────────
    _renderImpactMap(data) {
        const metrics = [
            { v: 'avgMins',    l: 'Avg minutes / active learner', short: 'Avg minutes',  unit: 'min' },
            { v: 'completion', l: 'Completion %',                   short: 'Completion %', unit: '%' },
            { v: 'activePct',  l: 'Active %',                       short: 'Active %',     unit: '%' },
            { v: 'enrolls',    l: 'Learners (raw count)',         short: 'Learners',   unit: '' },
        ];
        const cur = metrics.find(m => m.v === this._impactMapMetric) || metrics[0];

        const total = Object.entries(data.byCountry).filter(([, v]) => v.enrolls >= this._impactMapMin).length;

        return `
            <div id="eng-impact-map" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="bg-slate-50 border-b p-5 flex justify-between items-start gap-4 flex-wrap">
                    <div>
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="map-pinned" class="text-gsf-boston"></i> Quality-Weighted Impact Map</h2>
                        <p class="text-xs text-slate-500 mt-1">Geographic distribution of engagement <em>quality</em>, not just raw user count. Switch metric to see different patterns. ${total} countries shown (≥ ${this._impactMapMin} learners).</p>
                    </div>
                    <div class="flex items-center gap-3 flex-wrap">
                        <label class="inline-flex items-center gap-2 text-xs text-slate-600">
                            <span class="font-semibold text-slate-400 uppercase tracking-wide">Metric</span>
                            <select onchange="App._setImpactMapMetric(this.value)" class="bg-white border rounded px-2 py-1 text-slate-700 outline-none text-xs">
                                ${metrics.map(m => `<option value="${m.v}" ${m.v===this._impactMapMetric?'selected':''}>${m.l}</option>`).join('')}
                            </select>
                        </label>
                        <label class="inline-flex items-center gap-2 text-xs text-slate-600">
                            <span class="font-semibold text-slate-400 uppercase tracking-wide">Min learners</span>
                            <input type="number" min="0" step="10" value="${this._impactMapMin}" onchange="App._setImpactMapMin(this.value)" class="w-20 px-2 py-1 border rounded text-slate-700 outline-none text-xs">
                        </label>
                        ${this._engActionBtns('eng-impact-map', 'impactmap', 'Impact_Map_' + cur.short.replace(/[^a-zA-Z0-9]/g, '_'))}
                    </div>
                </div>
                <div class="p-5">
                    <div id="eng-impact-map-chart" style="width: 100%; height: 480px;"></div>
                    <p class="text-[11px] text-slate-400 italic mt-2 text-right">Showing <strong>${this.escapeHtml(cur.l)}</strong>. Grey = below the minimum-learners threshold (not enough data).</p>
                </div>
            </div>
        `;
    },

    _drawImpactMap() {
        const el = document.getElementById('eng-impact-map-chart');
        if (!el || !window.google || !google.visualization || !google.visualization.GeoChart) return;
        const data = this._computeEngagement();
        if (!data) { el.innerHTML = '<p class="text-sm text-slate-400 italic text-center pt-20">No anonymized user data yet.</p>'; return; }

        const metric = this._impactMapMetric;
        const min = this._impactMapMin;

        const rows = Object.entries(data.byCountry)
            .filter(([, v]) => v.enrolls >= min)
            .map(([country, v]) => {
                const activePct  = v.enrolls > 0 ? (v.active / v.enrolls) * 100 : 0;
                const avgMins    = v.active > 0 ? v.totalMins / v.active : 0;
                const completion = v.enrolls > 0 ? (v.certs / v.enrolls) * 100 : 0;
                let val;
                if      (metric === 'completion') val = completion;
                else if (metric === 'activePct')  val = activePct;
                else if (metric === 'enrolls')    val = v.enrolls;
                else                              val = avgMins;
                return { country, value: val, enrolls: v.enrolls, activePct, avgMins, completion };
            });

        if (rows.length === 0) { el.innerHTML = '<p class="text-sm text-slate-400 italic text-center pt-20">No countries meet the minimum-learners filter.</p>'; return; }

        const dt = new google.visualization.DataTable();
        dt.addColumn('string', 'Country');
        dt.addColumn('number', 'Value');
        dt.addColumn({ type: 'string', role: 'tooltip', p: { html: true } });

        rows.forEach(r => {
            const tip = `<div style="padding:8px 12px;font-size:12px;line-height:1.5">
                <strong>${r.country}</strong><br>
                Learners: ${r.enrolls.toLocaleString()}<br>
                Active: ${r.activePct.toFixed(0)}%<br>
                Avg time / active: ${this.formatLearningTime(r.avgMins)}<br>
                Completion: ${r.completion.toFixed(0)}%
            </div>`;
            dt.addRow([(window.countryToISO && window.countryToISO(r.country)) || r.country, r.value, tip]);
        });

        // Colour scale: orange→teal→deep blue. Completion uses crimson→green to communicate "good vs bad" intuitively.
        const colorScales = {
            avgMins:    ['#fef3c7', '#7A9E9F', '#1a5276'],   // engagement: gold → teal → deep blue
            completion: ['#fee2e2', '#fde68a', '#16a34a'],   // bad → mid → good
            activePct:  ['#fee2e2', '#fde68a', '#16a34a'],
            enrolls:    ['#ebf5fb', '#4389C8', '#1a5276'],   // brand blues for sheer volume
        };

        new google.visualization.GeoChart(el).draw(dt, {
            colorAxis: { colors: colorScales[metric] || colorScales.avgMins, minValue: 0 },
            backgroundColor: 'transparent',
            datalessRegionColor: '#f1f5f9',
            defaultColor: '#f1f5f9',
            legend: { textStyle: { fontSize: 11, color: '#64748b' } },
            tooltip: { isHtml: true, trigger: 'focus' }
        });
    },

    // ── #17 Reach-Gap (Lancet) ────────────────────────────────────────────
    _renderReachGap(data) {
        if (!window.IncomeClassification) return '';
        const IC = window.IncomeClassification;

        // Build per-country aggregates joined with priority flag
        const allCountries = Object.entries(data.byCountry).map(([c, v]) => {
            const compl = v.enrolls > 0 ? (v.certs / v.enrolls) * 100 : 0;
            const avgMins = v.active > 0 ? v.totalMins / v.active : 0;
            return { country: c, enrolls: v.enrolls, certs: v.certs, compl, avgMins,
                     priority: IC.isLancetPriority(c), tier: IC.classify(c) };
        });
        // Enumerate the FULL priority list so unreached countries (zero signups) show up too.
        const priorityList = IC.priorityCountries ? IC.priorityCountries() : [];
        const byCountryMap = Object.fromEntries(allCountries.map(c => [c.country, c]));
        const priorityCountries = priorityList.map(name => byCountryMap[name] || {
            country: name, enrolls: 0, certs: 0, compl: 0, avgMins: 0,
            priority: true, tier: IC.classify(name)
        });

        // Reached = has any learners. Underreached threshold: less than 25 learners.
        const reached      = priorityCountries.filter(c => c.enrolls >= 25);
        const underreached = priorityCountries.filter(c => c.enrolls > 0 && c.enrolls < 25);
        const notReached   = priorityCountries.filter(c => c.enrolls === 0);

        const totalEnrolls = allCountries.reduce((s, c) => s + c.enrolls, 0);
        const priorityEnrolls = priorityCountries.reduce((s, c) => s + c.enrolls, 0);
        const priorityShare = totalEnrolls > 0 ? (priorityEnrolls / totalEnrolls) * 100 : 0;
        const totalCerts = allCountries.reduce((s, c) => s + c.certs, 0);
        const priorityCerts = priorityCountries.reduce((s, c) => s + c.certs, 0);
        const priorityCertShare = totalCerts > 0 ? (priorityCerts / totalCerts) * 100 : 0;

        // Top reached (by learners) and top underreached/missing (priority countries we are NOT reaching well)
        const topReached    = reached.slice().sort((a, b) => b.enrolls - a.enrolls).slice(0, 15);
        const gapCandidates = [...underreached, ...notReached].sort((a, b) => a.enrolls - b.enrolls).slice(0, 20);

        // Mini geo of reach status (priority countries only)
        const geoRowsId = 'eng-reachgap-map';

        return `
            <div id="eng-section-reachgap" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="bg-slate-50 border-b p-5 flex justify-between items-start gap-4 flex-wrap">
                    <div>
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="target" class="text-gsf-boston"></i> Reach-Gap (Surgical-Care Priority)</h2>
                        <p class="text-xs text-slate-500 mt-1">How well are we reaching countries with documented surgical-care gaps (Lancet Commission on Global Surgery)?</p>
                    </div>
                    ${this._engActionBtns('eng-section-reachgap', 'reachgap', 'Reach_Gap_Lancet')}
                </div>
                <div class="p-5">
                    <div class="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                        <div class="border rounded-lg p-4 bg-orange-50 border-orange-200">
                            <div class="text-[10px] font-bold text-orange-700 uppercase tracking-wide mb-1">Priority learner share</div>
                            <div class="text-2xl font-black text-gsf-crimson">${priorityShare.toFixed(0)}%</div>
                            <div class="text-[10px] text-slate-500 mt-1">${this.formatNumber(priorityEnrolls)} of ${this.formatNumber(totalEnrolls)} learners</div>
                        </div>
                        <div class="border rounded-lg p-4">
                            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Priority countries reached</div>
                            <div class="text-2xl font-black text-green-700">${reached.length}</div>
                            <div class="text-[10px] text-slate-500 mt-1">≥ 25 learners</div>
                        </div>
                        <div class="border rounded-lg p-4">
                            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Priority gap</div>
                            <div class="text-2xl font-black text-amber-700">${underreached.length + notReached.length}</div>
                            <div class="text-[10px] text-slate-500 mt-1">${underreached.length} underreached · ${notReached.length} unreached</div>
                        </div>
                    </div>

                    <div id="${geoRowsId}" style="width: 100%; height: 420px;" class="mb-6"></div>
                    <p class="text-[11px] text-slate-400 italic -mt-4 mb-4 text-right">Map: priority countries only. <span class="text-green-700 font-bold">Green</span> = well-reached (≥ 25 learners). <span class="text-amber-700 font-bold">Amber</span> = underreached (1–24). Grey = no learners.</p>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Top reached priority countries</h4>
                            <div class="border rounded-lg overflow-hidden">
                                <table class="w-full text-xs">
                                    <thead class="text-slate-500 border-b bg-slate-50"><tr>
                                        <th class="py-2 px-2 font-medium text-left">Country</th>
                                        <th class="py-2 px-2 font-medium text-right">Learners</th>
                                        <th class="py-2 px-2 font-medium text-right">Completion %</th>
                                    </tr></thead>
                                    <tbody>
                                        ${topReached.length === 0
                                            ? '<tr><td colspan="3" class="py-4 text-center text-slate-400 italic">No priority countries reached above the threshold yet.</td></tr>'
                                            : topReached.map(c => `<tr class="border-b">
                                                <td class="py-1.5 px-2 font-medium text-gsf-prussian">${this.escapeHtml(c.country)}</td>
                                                <td class="py-1.5 px-2 text-right font-medium">${this.formatNumber(c.enrolls)}</td>
                                                <td class="py-1.5 px-2 text-right ${c.compl >= 30 ? 'text-green-700 font-bold' : 'text-slate-600'}">${c.compl.toFixed(0)}%</td>
                                            </tr>`).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div>
                            <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Priority gap (under/un-reached)</h4>
                            <div class="border rounded-lg overflow-hidden">
                                <table class="w-full text-xs">
                                    <thead class="text-slate-500 border-b bg-slate-50"><tr>
                                        <th class="py-2 px-2 font-medium text-left">Country</th>
                                        <th class="py-2 px-2 font-medium text-right">Learners</th>
                                        <th class="py-2 px-2 font-medium text-left">Status</th>
                                    </tr></thead>
                                    <tbody>
                                        ${gapCandidates.length === 0
                                            ? '<tr><td colspan="3" class="py-4 text-center text-slate-400 italic">All priority countries well reached. 🎉</td></tr>'
                                            : gapCandidates.map(c => `<tr class="border-b">
                                                <td class="py-1.5 px-2 font-medium text-gsf-prussian">${this.escapeHtml(c.country)}</td>
                                                <td class="py-1.5 px-2 text-right text-slate-500">${this.formatNumber(c.enrolls)}</td>
                                                <td class="py-1.5 px-2 text-left text-[10px]">${c.enrolls === 0 ? '<span class="text-red-600 font-bold">Unreached</span>' : '<span class="text-amber-600 font-bold">Underreached</span>'}</td>
                                            </tr>`).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <p class="text-[11px] text-slate-400 italic mt-4">
                        Priority list: countries identified by the Lancet Commission on Global Surgery as having documented surgical-care gaps (≈ low and lower-middle-income countries plus selected upper-middle income). Swap with GSF's own priority list if available.
                    </p>
                </div>
            </div>
        `;
    },

    _drawReachGapMap() {
        const el = document.getElementById('eng-reachgap-map');
        if (!el || !window.google || !google.visualization || !google.visualization.GeoChart) return;
        const data = this._computeEngagement();
        if (!data || !window.IncomeClassification) return;

        const IC = window.IncomeClassification;
        const priorityCountries = Object.entries(data.byCountry)
            .filter(([c]) => IC.isLancetPriority(c))
            .map(([c, v]) => ({ country: c, enrolls: v.enrolls }));

        // Bucket: 0 = unreached, 1 = underreached (1-24), 2 = reached (25+)
        const dt = new google.visualization.DataTable();
        dt.addColumn('string', 'Country');
        dt.addColumn('number', 'Reach status');
        dt.addColumn({ type: 'string', role: 'tooltip', p: { html: true } });

        priorityCountries.forEach(p => {
            const status = p.enrolls === 0 ? 0 : (p.enrolls < 25 ? 1 : 2);
            const label = status === 0 ? 'Unreached' : status === 1 ? 'Underreached' : 'Reached';
            const tip = `<div style="padding:8px 12px;font-size:12px;line-height:1.5">
                <strong>${p.country}</strong><br>
                ${label}<br>
                ${p.enrolls.toLocaleString()} learners
            </div>`;
            dt.addRow([(window.countryToISO && window.countryToISO(p.country)) || p.country, status, tip]);
        });

        new google.visualization.GeoChart(el).draw(dt, {
            colorAxis: { colors: ['#cbd5e1', '#f59e0b', '#16a34a'], minValue: 0, maxValue: 2, values: [0, 1, 2] },
            backgroundColor: 'transparent',
            datalessRegionColor: '#f8fafc',
            defaultColor: '#f8fafc',
            legend: 'none',
            tooltip: { isHtml: true, trigger: 'focus' }
        });
    },

    // Period selector for growth forecast — drives which window we estimate from
    _forecastWindow: '12mo',  // '30d' | '90d' | '6mo' | '12mo' | 'all'
    _setForecastWindow(v) {
        this._forecastWindow = v;
        this._refreshEngagementSection();
    },

    _drawGrowthForecastChart() {
        const el = document.getElementById('eng-forecast-chart');
        if (!el || !window.google || !google.visualization || !google.visualization.LineChart) return;
        const d = this._forecastChartData;
        if (!d) return;

        const dt = new google.visualization.DataTable();
        dt.addColumn('string', 'Month');
        dt.addColumn('number', 'Historical');
        dt.addColumn('number', 'Linear');
        dt.addColumn('number', 'Compound');
        dt.addColumn({ type: 'string', role: 'tooltip', p: { html: true } });

        const fmtMonth = (yyyymm) => {
            if (!yyyymm) return '';
            const [y, m] = yyyymm.split('-');
            const dd = new Date(Number(y), Number(m) - 1, 1);
            return dd.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        };
        const tip = (label, m, value) => `<div style="padding:8px 12px;font-size:12px;line-height:1.5">
            <strong>${fmtMonth(m)}</strong><br>${label}: <strong>${Math.round(value).toLocaleString()}</strong>
        </div>`;

        // Historical rows (forecast cells null)
        d.historicalRows.forEach(r => {
            dt.addRow([fmtMonth(r.m), Math.round(r.hist), null, null, tip('Total users', r.m, r.hist)]);
        });

        // Anchor — value in all three series so the forecasts attach cleanly at today
        dt.addRow([fmtMonth(d.anchorRow.m) + ' ◆', Math.round(d.anchorRow.hist), Math.round(d.anchorRow.lin), Math.round(d.anchorRow.cmp),
            tip('Today', d.anchorRow.m, d.anchorRow.hist)]);

        // Forecast rows (historical null)
        d.forecastRows.forEach(r => {
            dt.addRow([fmtMonth(r.m), null, Math.round(r.lin), Math.round(r.cmp),
                `<div style="padding:8px 12px;font-size:12px;line-height:1.5">
                    <strong>${fmtMonth(r.m)}</strong><br>
                    Linear: <strong>${Math.round(r.lin).toLocaleString()}</strong><br>
                    Compound: <strong>${Math.round(r.cmp).toLocaleString()}</strong>
                </div>`]);
        });

        const opts = {
            chartArea: { left: 60, right: 20, top: 20, bottom: 60, width: '92%' },
            backgroundColor: 'transparent',
            legend: { position: 'none' }, // custom legend rendered in HTML above the chart
            hAxis: {
                textStyle: { fontSize: 10, color: '#94a3b8' },
                gridlines: { color: '#f1f5f9', count: 6 },
                slantedText: true, slantedTextAngle: 30,
            },
            vAxis: {
                textStyle: { color: '#94a3b8', fontSize: 11 },
                gridlines: { color: '#f1f5f9', count: 6 },
                viewWindow: { min: 0 }, format: 'short', baselineColor: '#e2e8f0'
            },
            series: {
                0: { color: '#1a5276', lineWidth: 2.5, pointSize: 0, curveType: 'function' },        // Historical
                1: { color: '#4389C8', lineWidth: 2,   pointSize: 0, lineDashStyle: [6, 4],
                     curveType: 'function' },                                                          // Linear (dashed)
                2: { color: '#E28743', lineWidth: 2,   pointSize: 0, lineDashStyle: [3, 3],
                     curveType: 'function' },                                                          // Compound (dotted)
            },
            interpolateNulls: false,
            focusTarget: 'datum',
            tooltip: { isHtml: true },
            animation: { startup: false, duration: 0 }
        };
        new google.visualization.LineChart(el).draw(dt, opts);
    },

    // ── #16 Growth Forecast ───────────────────────────────────────────────
    _renderGrowthForecast(_unused) {
        const audSnap = (this.userHistory || []).find(d => d.Timestamp === this.selectedDate) || (this.userHistory || [])[0] || null;
        if (!audSnap || !audSnap.Signups) return '';

        let monthly, daily;
        try { monthly = typeof audSnap.Signups === 'string' ? JSON.parse(audSnap.Signups) : audSnap.Signups; }
        catch (_) { return ''; }
        try { daily = audSnap.SignupsDaily ? (typeof audSnap.SignupsDaily === 'string' ? JSON.parse(audSnap.SignupsDaily) : audSnap.SignupsDaily) : null; }
        catch (_) { daily = null; }

        const months = Object.keys(monthly).sort();
        if (months.length < 3) return '';

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today.getTime() - 86400000);

        // ── Total today: prefer the live platform headcount (TotalUsers on the snapshot).
        // Fall back to cumulative-from-monthly only if the snapshot doesn't have it.
        const curMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        let totalNow = Number(audSnap.TotalUsers) || 0;
        if (totalNow <= 0) {
            months.forEach(m => { if (m < curMonth) totalNow += (Number(monthly[m]) || 0); });
        }

        const win = this._forecastWindow;
        const windows = [
            { v: '30d',  l: 'Last 30 days',   needsDaily: true },
            { v: '90d',  l: 'Last 90 days',   needsDaily: true },
            { v: '6mo',  l: 'Last 6 months',  needsDaily: false },
            { v: '12mo', l: 'Last 12 months', needsDaily: false },
            { v: 'all',  l: 'All time',       needsDaily: false },
        ];
        const winInfo = windows.find(w => w.v === win) || windows[3];

        // ── Compute monthly run-rate from the chosen window ──────────────
        let monthlyAdd = 0;
        let cmgr = 0;
        let dataNote = '';

        if ((win === '30d' || win === '90d') && daily) {
            // Sum signups within the period ending yesterday
            const periodDays = win === '30d' ? 30 : 90;
            const startDate = new Date(yesterday.getTime() - (periodDays - 1) * 86400000);
            const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const startStr = fmt(startDate), endStr = fmt(yesterday);
            let periodTotal = 0;
            Object.entries(daily).forEach(([day, n]) => { if (day >= startStr && day <= endStr) periodTotal += Number(n) || 0; });
            const dailyAvg = periodTotal / periodDays;
            monthlyAdd = dailyAvg * (365 / 12); // 30.4 days/mo
            // For CMGR from daily data, compare last half-period to first half
            const midDate = new Date(startDate.getTime() + Math.floor(periodDays / 2) * 86400000);
            const midStr = fmt(midDate);
            let firstHalf = 0, secondHalf = 0;
            Object.entries(daily).forEach(([day, n]) => {
                if (day < startStr || day > endStr) return;
                const v = Number(n) || 0;
                if (day < midStr) firstHalf += v; else secondHalf += v;
            });
            cmgr = firstHalf > 0 ? Math.pow(secondHalf / firstHalf, 1 / 6) - 1 : 0;
            dataNote = `${periodTotal.toLocaleString()} new users in ${periodDays} days · daily avg ${dailyAvg.toFixed(1)}/day`;
        } else if ((win === '30d' || win === '90d') && !daily) {
            // Fall back to 6-month if no daily data
            dataNote = '⚠ Daily signup data unavailable — falling back to 6-month average.';
            const n = 6;
            const recent = months.filter(m => m < curMonth).slice(-n);
            if (recent.length >= 2) {
                const total = recent.reduce((s, m) => s + (Number(monthly[m]) || 0), 0);
                monthlyAdd = total / recent.length;
                const first = Number(monthly[recent[0]]) || 0;
                const last = Number(monthly[recent[recent.length - 1]]) || 0;
                cmgr = first > 0 ? Math.pow(last / first, 1 / (recent.length - 1)) - 1 : 0;
            }
        } else {
            // Monthly window
            const n = win === '6mo' ? 6 : win === '12mo' ? 12 : Infinity;
            const recent = months.filter(m => m < curMonth).slice(-Math.min(months.length, n));
            if (recent.length < 2) return '';
            const total = recent.reduce((s, m) => s + (Number(monthly[m]) || 0), 0);
            monthlyAdd = total / recent.length;
            const first = Number(monthly[recent[0]]) || 0;
            const last = Number(monthly[recent[recent.length - 1]]) || 0;
            cmgr = first > 0 ? Math.pow(last / first, 1 / (recent.length - 1)) - 1 : 0;
            dataNote = `${total.toLocaleString()} new users across ${recent.length} months · monthly avg ${monthlyAdd.toFixed(0)}/mo`;
        }

        // ── Forecasts ────────────────────────────────────────────────────
        const fmt = (n) => this.formatNumber(Math.round(n));

        // Compound: project each future month's NEW signups with the growth rate,
        // then sum. NOT cumulative_total × (1+r)^t — that wrongly compounds the
        // existing user base. Floor at linear when cmgr ≤ 0 (a shrinking growth
        // rate doesn't mean shrinking total — the platform doesn't lose users).
        const projectCompound = (monthsAhead) => {
            const m = Math.max(0, monthsAhead);
            if (m === 0) return totalNow;
            if (Math.abs(cmgr) < 1e-6) return totalNow + monthlyAdd * m;
            // Geometric series Σ a*(1+r)^k for k=0..m-1 = a * ((1+r)^m - 1) / r
            const sumInflow = monthlyAdd * (Math.pow(1 + cmgr, m) - 1) / cmgr;
            return totalNow + sumInflow;
        };

        const fcLinear = totalNow + monthlyAdd * 12;
        const fcCmgr   = projectCompound(12);

        // End-of-year forecast — use days-remaining-to-EOY × daily rate when
        // daily data is available; otherwise convert remaining days to a
        // decimal month count. Either way, no whole-month truncation.
        const dailyAdd = monthlyAdd * 12 / 365; // implied daily rate from the chosen window
        const eoyDate = new Date(today.getFullYear(), 11, 31);
        const daysToEoy = Math.max(0, Math.round((eoyDate - today) / 86400000));
        const monthsToEoy = daysToEoy / (365 / 12); // ~30.44 days per month
        const eoyLinear   = totalNow + dailyAdd * daysToEoy;
        const eoyCompound = projectCompound(monthsToEoy);
        const eoyLabel = eoyDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const oneYearLabel = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

        // ── Milestones — pick 3 distinct round-numbered targets ABOVE current ──
        const candidates = [25000, 50000, 75000, 100000, 150000, 200000, 250000, 300000, 400000, 500000, 750000, 1000000, 1500000, 2000000, 5000000, 10000000];
        const milestones = candidates.filter(t => t > totalNow).slice(0, 3);

        // ── Chart series prep ────────────────────────────────────────────
        // Historical: walk through monthly Signups cumulatively up to last complete month.
        // Today anchor: switch to totalNow (live count) so the line connects to the latest snapshot value.
        // Forecast lines (linear, compound) start at totalNow and project 12 months ahead.
        const historicalMonths = months.filter(m => m < curMonth);
        let cumWalk = 0;
        const histRows = historicalMonths.map(m => { cumWalk += (Number(monthly[m]) || 0); return { m, hist: cumWalk }; });

        // Anchor "today" point so the forecast lines start where historical ends.
        // We anchor at the current month (yyyy-MM) using totalNow as the value.
        const anchorMonth = curMonth;
        const anchorRow = { m: anchorMonth, hist: totalNow, lin: totalNow, cmp: totalNow };

        // Forecast 12 months ahead
        const fcRows = [];
        let linCum = totalNow;
        let cmpCum = totalNow;
        let cmpInflow = monthlyAdd;
        for (let i = 1; i <= 12; i++) {
            const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
            const mlabel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            linCum += monthlyAdd;
            cmpCum += cmpInflow;
            cmpInflow = cmpInflow * (1 + cmgr);
            fcRows.push({ m: mlabel, lin: linCum, cmp: cmpCum });
        }

        // Stash on App so the deferred drawer can read without re-computing
        this._forecastChartData = {
            historicalRows: histRows,
            anchorRow,
            forecastRows: fcRows,
            totalNow,
        };

        const milestoneEta = (target) => {
            if (monthlyAdd <= 0) return { txt: '—', months: Infinity };
            const monthsAway = Math.ceil((target - totalNow) / monthlyAdd);
            if (monthsAway > 360) return { txt: '> 30 yrs', months: monthsAway };
            const eta = new Date(today.getFullYear(), today.getMonth() + monthsAway, 1);
            return { txt: eta.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), months: monthsAway };
        };

        const winButton = (w) => `<button onclick="App._setForecastWindow('${w.v}')" class="px-2.5 py-1 rounded text-[11px] font-bold ${win===w.v ? 'bg-gsf-boston text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}" ${w.needsDaily && !daily ? 'title="Daily data not available — will fall back to monthly average"' : ''}>${w.l}</button>`;

        return `
            <div id="eng-section-forecast" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="bg-slate-50 border-b p-5 flex justify-between items-start gap-4 flex-wrap">
                    <div>
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="zap" class="text-gsf-boston"></i> Growth Forecast</h2>
                        <p class="text-xs text-slate-500 mt-1">
                            Trend extrapolation from the chosen window. <strong>Linear</strong> assumes constant new-user inflow; <strong>Compound</strong> assumes the current growth rate persists.
                        </p>
                    </div>
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mr-1">Trend window</span>
                        ${windows.map(winButton).join('')}
                    </div>
                </div>
                <div class="p-5">
                    ${dataNote ? `<p class="text-[11px] text-slate-500 mb-4 italic">${this.escapeHtml(dataNote)}</p>` : ''}

                    <!-- Top: current snapshot + headline projection -->
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div class="border rounded-lg p-4 bg-slate-50/50">
                            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Total users today</div>
                            <div class="text-2xl font-black text-gsf-prussian">${fmt(totalNow)}</div>
                            <div class="text-[10px] text-slate-500 mt-1">${audSnap.TotalUsers ? 'live platform total' : 'as of last complete month'}</div>
                        </div>
                        <div class="border rounded-lg p-4 bg-blue-50/40 border-blue-100">
                            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Monthly run-rate</div>
                            <div class="text-2xl font-black text-gsf-boston">+ ${fmt(monthlyAdd)} <span class="text-sm text-slate-400 font-normal">/ mo</span></div>
                            <div class="text-[10px] text-slate-500 mt-1">CMGR ${(cmgr * 100).toFixed(2)}% / mo · ${dailyAdd.toFixed(1)}/day</div>
                        </div>
                        <div class="border rounded-lg p-4 bg-amber-50 border-amber-200">
                            <div class="text-[10px] font-bold text-amber-700 uppercase tracking-wide mb-1">By end of year — ${eoyLabel}</div>
                            <div class="text-2xl font-black text-amber-700">${fmt(Math.min(eoyLinear, eoyCompound))} <span class="text-sm text-amber-500 font-normal">– ${fmt(Math.max(eoyLinear, eoyCompound))}</span></div>
                            <div class="text-[10px] text-slate-500 mt-1">${daysToEoy} days remaining · linear ${fmt(eoyLinear)} · compound ${fmt(eoyCompound)}</div>
                        </div>
                    </div>

                    <!-- 12-month projection split -->
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        <div class="border rounded-lg p-4 bg-blue-50/40 border-blue-100">
                            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Linear — by ${oneYearLabel}</div>
                            <div class="text-2xl font-black text-gsf-boston">${fmt(fcLinear)}</div>
                            <div class="text-[10px] text-slate-500 mt-1">Constant inflow assumption · ${cmgr >= 0 ? 'conservative vs compound' : 'optimistic vs compound'}</div>
                        </div>
                        <div class="border rounded-lg p-4 bg-blue-50/40 border-blue-100">
                            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Compound — by ${oneYearLabel}</div>
                            <div class="text-2xl font-black text-gsf-boston">${fmt(fcCmgr)}</div>
                            <div class="text-[10px] text-slate-500 mt-1">Inflow ${cmgr >= 0 ? 'grows' : 'shrinks'} ${(Math.abs(cmgr) * 100).toFixed(2)}% / mo · ${cmgr >= 0 ? 'optimistic' : 'pessimistic'} vs linear</div>
                        </div>
                    </div>

                    <!-- Forecast chart -->
                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Projection chart</h4>
                    <div class="border rounded-lg p-3 mb-6">
                        <div class="flex flex-wrap items-center gap-3 mb-2 text-[11px] text-slate-500">
                            <span class="inline-flex items-center gap-1.5"><span class="inline-block w-4 h-0.5" style="background:#1a5276"></span><strong class="text-slate-700">Historical</strong></span>
                            <span class="inline-flex items-center gap-1.5"><span class="inline-block w-4 h-0.5" style="background:#4389C8; border-top:1px dashed #4389C8"></span><strong class="text-slate-700">Linear</strong> · constant inflow</span>
                            <span class="inline-flex items-center gap-1.5"><span class="inline-block w-4 h-0.5" style="background:#E28743; border-top:1px dashed #E28743"></span><strong class="text-slate-700">Compound</strong> · CMGR ${(cmgr * 100).toFixed(2)}%/mo</span>
                        </div>
                        <div id="eng-forecast-chart" style="width: 100%; height: 360px;"></div>
                    </div>

                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Milestone ETAs (linear)</h4>
                    ${milestones.length === 0
                        ? '<p class="text-xs text-slate-400 italic">No round-number milestone above current total.</p>'
                        : `<table class="w-full text-sm border rounded-lg overflow-hidden">
                            <thead class="text-slate-500 border-b bg-slate-50"><tr>
                                <th class="py-2 px-3 font-medium text-left">Target</th>
                                <th class="py-2 px-3 font-medium text-right">Months away</th>
                                <th class="py-2 px-3 font-medium text-right">ETA</th>
                            </tr></thead>
                            <tbody>
                                ${milestones.map(t => {
                                    const eta = milestoneEta(t);
                                    return `<tr class="border-b">
                                        <td class="py-2 px-3 text-xs font-medium text-gsf-prussian">${fmt(t)} total users</td>
                                        <td class="py-2 px-3 text-right text-xs text-slate-500">${Number.isFinite(eta.months) ? eta.months + ' mo' : '—'}</td>
                                        <td class="py-2 px-3 text-right text-xs font-bold text-gsf-boston">${eta.txt}</td>
                                    </tr>`;
                                }).join('')}
                            </tbody>
                        </table>`}

                    <p class="text-[11px] text-slate-400 italic mt-3">
                        ⚠ Forecasts are mechanical extrapolations from the selected window, not predictions. Real growth depends on campaigns, partnerships, and platform changes. Shorter windows are more reactive but more volatile; longer windows are smoother but slower to detect inflection.
                    </p>
                </div>
            </div>
        `;
    },
});
