// GSF Brand Colors — modernised palette with richer tones
const GSF_COLORS = ['#1a5276', '#3498db', '#e74c3c', '#85c1e9', '#f39c12', '#2471a3', '#48c9b0', '#e57373'];

// Load Google Charts asynchronously. The gstatic loader is the one dependency we
// can't vendor (it fetches more scripts at runtime), so guard it: if it didn't load
// (e.g. offline launch), don't throw at parse time — the rest of the app still runs,
// and charts degrade gracefully via the isReady/_deferIfNotReady retry path below.
if (window.google && google.charts) {
    google.charts.load('current', {'packages':['corechart', 'geochart', 'bar']});
    google.charts.setOnLoadCallback(() => { window.Charts.isReady = true; });
} else {
    console.warn('[charts] Google Charts loader unavailable (offline?) — charts disabled this session.');
}

window.Charts = {
    isReady: false,
    instances: {},
    _charts: {},   // registry for hi-res export (mirrors GenericCharts pattern)
    _MAX_READY_RETRIES: 150, // 150 × 200ms = 30s max wait for Google Charts

    // Deferred call with retry cap — returns true if deferred, false if ready
    _deferIfNotReady(methodName, args) {
        if (this.isReady) return false;
        const key = methodName;
        this._retryCount = this._retryCount || {};
        this._retryCount[key] = (this._retryCount[key] || 0) + 1;
        if (this._retryCount[key] > this._MAX_READY_RETRIES) {
            console.warn(`Charts.${methodName}: Google Charts not ready after ${this._MAX_READY_RETRIES} retries — giving up`);
            delete this._retryCount[key];
            return true; // deferred but abandoned
        }
        setTimeout(() => this[methodName](...args), 200);
        return true;
    },

    _registerChart(elementId, chartType, data, options) {
        this._charts[elementId] = { chartType, data, options };
    },

    _renderHiRes(elementId) {
        const entry = this._charts[elementId];
        if (!entry) return null;
        const SCALE = 3;
        const origEl = document.getElementById(elementId);
        if (!origEl) return null;
        const w = origEl.offsetWidth || 500;
        const h = entry.options.height || origEl.offsetHeight || 300;
        const tmp = document.createElement('div');
        tmp.style.cssText = `position:fixed;left:-9999px;top:-9999px;width:${w * SCALE}px;height:${h * SCALE}px;background:white;`;
        document.body.appendChild(tmp);
        const opts = JSON.parse(JSON.stringify(entry.options));
        opts.width = w * SCALE;
        opts.height = h * SCALE;
        opts.backgroundColor = 'white';
        if (opts.chartArea) { for (const k of ['left','right','top','bottom']) { if (typeof opts.chartArea[k] === 'number') opts.chartArea[k] *= SCALE; } }
        const scaleFonts = (obj) => { if (!obj || typeof obj !== 'object') return; if (typeof obj.fontSize === 'number') obj.fontSize *= SCALE; for (const v of Object.values(obj)) scaleFonts(v); };
        scaleFonts(opts.hAxis); scaleFonts(opts.vAxis); scaleFonts(opts.vAxes); scaleFonts(opts.legend); scaleFonts(opts.annotations); scaleFonts(opts.tooltip);
        if (typeof opts.lineWidth === 'number') opts.lineWidth *= SCALE;
        if (typeof opts.pointSize === 'number') opts.pointSize *= SCALE;
        if (opts.series) { for (const s of Object.values(opts.series)) { if (typeof s.lineWidth === 'number') s.lineWidth *= SCALE; if (typeof s.pointSize === 'number') s.pointSize *= SCALE; } }
        opts.animation = { startup: false, duration: 0 };
        const ChartClass = google.visualization[entry.chartType];
        const chart = new ChartClass(tmp);
        chart.draw(entry.data, opts);
        const uri = chart.getImageURI();
        document.body.removeChild(tmp);
        return uri;
    },

    async copyChart(elementId) {
        try {
            const uri = this._renderHiRes(elementId);
            if (!uri) return;
            await electronAPI.invoke('clipboard-write-image', uri);
            const btn = document.querySelector(`[data-copy-chart="${elementId}"]`);
            if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.innerHTML = '<i data-lucide="copy" width="11"></i>'; if (window.lucide) lucide.createIcons(); }, 1500); }
        } catch (e) { console.error('Copy chart failed:', e); }
    },

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

    formatDate: (dateString) => {
        if (!dateString) return '';
        const [y, m, d] = dateString.split('-');
        return new Date(y, m - 1, d || 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    },

    safeParse: (str) => {
        if (!str) return {};
        if (typeof str === 'object') return str;
        try {
            let parsed = JSON.parse(str);
            return (typeof parsed === 'object' && parsed !== null) ? parsed : {};
        } catch(e) { return {}; }
    },

    // ── Partial-month helpers ────────────────────────────────────────────
    // Today's calendar month in YYYY-MM
    _currentMonth: function() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    },
    // Days into current month, total days in month (for "5/31 days" labels)
    _monthProgress: function() {
        const d = new Date();
        const day = d.getDate();
        const total = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        return { day, total };
    },
    // True if monthStr (YYYY-MM) is the current calendar month AND we're not on the last day.
    // (If we're on the last day of the month, it's effectively a complete data point.)
    _isPartialMonth: function(monthStr) {
        if (!monthStr) return false;
        if (monthStr !== this._currentMonth()) return false;
        const { day, total } = this._monthProgress();
        return day < total;
    },
    // Whether the user wants to include the partial month in timeline charts.
    // Defaults to false (cleaner, matches industry standard).
    _shouldIncludePartial: function() {
        return !!(window.App && window.App.includePartialMonth);
    },
    // Footnote string to display on the chart when partial-month inclusion is on.
    _partialMonthCaption: function() {
        const { day, total } = this._monthProgress();
        const m = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        return `Latest point is ${m} (partial — ${day}/${total} days)`;
    },

    getFlag: (country) => {
        const f = {
            "Afghanistan":"🇦🇫","Algeria":"🇩🇿","Angola":"🇦🇴","Argentina":"🇦🇷","Australia":"🇦🇺","Austria":"🇦🇹","Bangladesh":"🇧🇩",
            "Belgium":"🇧🇪","Brazil":"🇧🇷","Cameroon":"🇨🇲","Canada":"🇨🇦","Chile":"🇨🇱","China":"🇨🇳","Colombia":"🇨🇴",
            "Congo":"🇨🇬","DR Congo":"🇨🇩","Democratic Republic of the Congo":"🇨🇩","Egypt":"🇪🇬","Ethiopia":"🇪🇹","France":"🇫🇷",
            "Germany":"🇩🇪","Ghana":"🇬🇭","Greece":"🇬🇷","Guyana":"🇬🇾","Haiti":"🇭🇹","India":"🇮🇳","Indonesia":"🇮🇩",
            "Iraq":"🇮🇶","Ireland":"🇮🇪","Italy":"🇮🇹","Jamaica":"🇯🇲","Jordan":"🇯🇴","Kazakhstan":"🇰🇿","Kenya":"🇰🇪",
            "Libya":"🇱🇾","Malawi":"🇲🇼","Malaysia":"🇲🇾","Mexico":"🇲🇽","Mongolia":"🇲🇳","Morocco":"🇲🇦","Myanmar":"🇲🇲",
            "Namibia":"🇳🇦","Nepal":"🇳🇵","Netherlands":"🇳🇱","Niger":"🇳🇪","Nigeria":"🇳🇬","Pakistan":"🇵🇰","Paraguay":"🇵🇾",
            "Peru":"🇵🇪","Philippines":"🇵🇭","Russia":"🇷🇺","Rwanda":"🇷🇼","Saudi Arabia":"🇸🇦","Senegal":"🇸🇳","Sierra Leone":"🇸🇱",
            "Somalia":"🇸🇴","South Africa":"🇿🇦","Spain":"🇪🇸","Sri Lanka":"🇱🇰","Sudan":"🇸🇩","Switzerland":"🇨🇭","Tanzania":"🇹🇿",
            "Thailand":"🇹🇭","Togo":"🇹🇬","Tunisia":"🇹🇳","Turkey":"🇹🇷","Uganda":"🇺🇬","United Arab Emirates":"🇦🇪",
            "United Kingdom":"🇬🇧","United States":"🇺🇸","Yemen":"🇾🇪","Zambia":"🇿🇲","Zimbabwe":"🇿🇼"
        };
        return f[country] || '';
    },

    shortenSource: (str) => {
        if(!str) return 'Unknown';
        const s = str.toLowerCase();
        if(s.includes('friend') || s.includes('colleague')) return 'Colleague/Friend';
        if(s.includes('social') || s.includes('facebook') || s.includes('linkedin') || s.includes('twitter') || s.includes('instagram')) return 'Social Media';
        if(s.includes('email') || s.includes('newsletter')) return 'Email/Newsletter';
        if(s.includes('search') || s.includes('google')) return 'Search Engine';
        if(s.includes('website') || s.includes('gsf') || s.includes('wfsahq') || s.includes('rcsi')) return 'Partner Website';
        if(s.includes('hospital') || s.includes('employer') || s.includes('university') || s.includes('school')) return 'Employer/University';
        if(s.includes('event') || s.includes('conference') || s.includes('webinar')) return 'Event/Conference';
        return str.length > 25 ? str.substring(0,25) + '...' : str;
    },

    // Shorten provider name for chart labels, keeping full for tooltip
    shortenProvider: (name) => {
        if (!name) return 'Unknown';
        // Common abbreviation patterns
        const abbrevs = {
            'Global Surgical Foundation': 'GSF',
            'World Federation of Societies of Anaesthesiologists': 'WFSA',
            'Royal College of Surgeons in Ireland': 'RCSI',
        };
        if (abbrevs[name]) return abbrevs[name];
        if (name.length > 20) return name.substring(0, 18) + '...';
        return name;
    },

    // Fold an activity/profession timeline's exact-tag categories into canonical
    // cadres (via Taxonomy.canonProf) so the Growth-by-Cadre chart shows the SAME
    // buckets as the Profession/Cadre table (e.g. Nurse→Nursing, the three
    // anaesthesia roles→Anaesthesia, Intern/Resident (legacy)→Trainee / Resident).
    // Other breakdowns (country/career/topic) never call this and pass through.
    canonActivityTimeline: function(tl) {
        const canon = (window.Taxonomy && window.Taxonomy.canonProf) ? window.Taxonomy.canonProf : null;
        if (!canon || !tl || typeof tl !== 'object') return tl || {};
        const out = {};
        Object.keys(tl).forEach(month => {
            const m = tl[month]; if (!m || typeof m !== 'object') return;
            const dst = out[month] = out[month] || {};
            // canonProf returns a canonical cadre, 'Other' for unmatched-but-present
            // tags, or null for undeclared/unknown — drop the latter (keeps the
            // "share of known" denominator honest).
            Object.entries(m).forEach(([tag, n]) => { const c = canon(tag); if (!c) return; dst[c] = (dst[c] || 0) + (Number(n) || 0); });
        });
        return out;
    },

    getScaledTimeline: function(courseTimelineStr, isMonthly) {
        let parsed = this.safeParse(courseTimelineStr);
        let tl = parsed.timeline || parsed;
        let scale = parsed.scale || { enrollScale: 1, certScale: 1 };
        let result = {};
        Object.keys(tl).forEach(date => {
            let key = isMonthly ? date.substring(0, 7) : date;
            if (!result[key]) result[key] = { e: 0, c: 0 };
            if (typeof tl[date] === 'object') {
                result[key].e += (tl[date].e || 0) * (scale.enrollScale || 1);
                result[key].c += (tl[date].c || 0) * (scale.certScale || 1);
            } else {
                result[key].e += tl[date] * (scale.enrollScale || 1);
            }
        });
        Object.keys(result).forEach(k => {
            result[k].e = Math.round(result[k].e);
            result[k].c = Math.round(result[k].c);
        });
        return result;
    },

    hAxisDefaults: function() {
        return {
            textStyle: { color: '#94a3b8', fontSize: 11 },
            gridlines: { color: 'transparent' },
            slantedText: true,
            slantedTextAngle: 45,
            baselineColor: '#e2e8f0'
        };
    },

    clearChart: (elementId, message = "Not enough data to display this chart.") => {
        const el = document.getElementById(elementId);
        if (el) {
            el.innerHTML = '<div class="flex items-center justify-center h-full w-full bg-slate-50/50 border border-dashed border-slate-200 rounded-xl text-slate-400 italic text-sm py-12">' + message + '</div>';
        }
    },

    // Growth timeline: cumulative learner + cert lines, optional monthly bars
    // seriesPrefix: prefix for data-series checkboxes (e.g., 'plat' or 'prov')
    // Expand a sparse list of YYYY-MM months into the CONTIGUOUS range from first→last,
    // so a zero-activity month renders as a flat segment instead of vanishing from the
    // axis (which makes a cumulative line jump, e.g. Nov→Jan, and looks like missing data).
    _fillMonthRange: function(months) {
        const valid = (months || []).filter(m => /^\d{4}-\d{2}$/.test(m)).sort();
        if (valid.length < 2) return months || [];
        const out = [];
        let [y, mo] = valid[0].split('-').map(Number);
        const [ey, em] = valid[valid.length - 1].split('-').map(Number);
        let guard = 0;
        while ((y < ey || (y === ey && mo <= em)) && guard++ < 1200) {
            out.push(y + '-' + String(mo).padStart(2, '0'));
            mo++; if (mo > 12) { mo = 1; y++; }
        }
        return out;
    },
    drawTimelineLineChart: function(elementId, timelines, titles, isMonthly, showBars, seriesPrefix) {
        if (this._deferIfNotReady('drawTimelineLineChart', [elementId, timelines, titles, isMonthly, showBars, seriesPrefix])) return;
        const el = document.getElementById(elementId);
        if (!el) return;

        // Check which series are enabled via checkboxes
        const prefix = seriesPrefix || 'plat';
        const enrollEl = document.querySelector('[data-series="' + prefix + '-enroll"]');
        const certEl = document.querySelector('[data-series="' + prefix + '-cert"]');
        const showEnroll = enrollEl ? enrollEl.checked : true;
        const showCert = certEl ? certEl.checked : true;

        if (!showEnroll && !showCert) { this.clearChart(elementId, "Enable at least one data series."); return; }

        let allDates = new Set();
        let parsedTimelines = [];

        timelines.forEach(tlStr => {
            let data = this.safeParse(tlStr);
            let tl = data.timeline || data;
            let currentCounts = {};
            Object.keys(tl).forEach(d => {
                const dateKey = isMonthly ? d.substring(0, 7) : d;
                allDates.add(dateKey);
                if (!currentCounts[dateKey]) currentCounts[dateKey] = { e: 0, c: 0 };
                if (typeof tl[d] === 'object') {
                    currentCounts[dateKey].e += (tl[d].e || 0);
                    currentCounts[dateKey].c += (tl[d].c || 0);
                } else {
                    currentCounts[dateKey].e += tl[d];
                }
            });
            parsedTimelines.push(currentCounts);
        });

        let sortedDates = Array.from(allDates).sort();
        if (sortedDates.length === 0) { this.clearChart(elementId, "No historical timeline data attached."); return; }
        // Continuous month axis: a month with zero activity (e.g. a quiet December) stays
        // on the axis as a flat segment rather than disappearing and making the line jump.
        if (isMonthly) sortedDates = this._fillMonthRange(sortedDates);

        // Drop the current incomplete month unless the user has opted to include it.
        // Only applies to monthly charts (isMonthly === true). Daily charts always show today.
        const includePartial = this._shouldIncludePartial();
        let partialIndex = -1;
        if (isMonthly) {
            const lastDate = sortedDates[sortedDates.length - 1];
            if (this._isPartialMonth(lastDate)) {
                if (!includePartial) {
                    sortedDates = sortedDates.slice(0, -1);
                } else {
                    partialIndex = sortedDates.length - 1;
                }
            }
        }
        if (sortedDates.length === 0) { this.clearChart(elementId, "No complete months yet — toggle 'Include current month' to see partial data."); return; }

        let dataTable = new google.visualization.DataTable();
        dataTable.addColumn('string', 'Date');
        titles.forEach(t => {
            if (showEnroll) dataTable.addColumn('number', t + ' Learners');
            if (showCert) dataTable.addColumn('number', t + ' Certificates');
        });
        if (showBars) {
            if (showEnroll) dataTable.addColumn('number', 'Monthly Learners');
            if (showCert) dataTable.addColumn('number', 'Monthly Certificates');
        }

        let cumulative = titles.map(() => ({ e: 0, c: 0 }));
        sortedDates.forEach(date => {
            let row = [this.formatDate(date + (isMonthly ? '-01' : ''))];
            let totalMonthE = 0, totalMonthC = 0;
            parsedTimelines.forEach((pt, i) => {
                let me = pt[date] ? Math.round(pt[date].e || 0) : 0;
                let mc = pt[date] ? Math.round(pt[date].c || 0) : 0;
                cumulative[i].e += me;
                cumulative[i].c += mc;
                if (showEnroll) row.push(Math.round(cumulative[i].e));
                if (showCert) row.push(Math.round(cumulative[i].c));
                totalMonthE += me;
                totalMonthC += mc;
            });
            if (showBars) {
                if (showEnroll) row.push(totalMonthE);
                if (showCert) row.push(totalMonthC);
            }
            dataTable.addRow(row);
        });

        // Build color array: learner=dark blue, cert=light blue
        const visibleColors = [];
        if (showEnroll) visibleColors.push(GSF_COLORS[0]);
        if (showCert) visibleColors.push(GSF_COLORS[1]);
        // For bars: duplicate colors so bars match their line
        const allColors = showBars ? [...visibleColors, ...visibleColors] : visibleColors;

        if (showBars) {
            const nLines = visibleColors.length * titles.length;
            const nBars = visibleColors.length;
            let series = {};
            for (let i = 0; i < nLines; i++) {
                series[i] = { type: 'line', lineWidth: 2.5, pointSize: 4, targetAxisIndex: 0 };
            }
            for (let i = 0; i < nBars; i++) {
                series[nLines + i] = { type: 'bars', targetAxisIndex: 1, opacity: 0.4 };
            }

            const comboOpts = {
                colors: allColors, seriesType: 'line', series: series,
                curveType: 'function',
                chartArea: { left: 55, right: 20, top: 35, bottom: 75, height: '65%' },
                legend: { position: 'top', maxLines: 2, textStyle: { fontSize: 11, color: '#64748b' } },
                hAxis: this.hAxisDefaults(),
                vAxes: {
                    0: { textStyle: { color: '#94a3b8', fontSize: 11 }, gridlines: { color: '#f1f5f9', count: 6 }, viewWindow: { min: 0 }, format: 'short', baselineColor: '#e2e8f0' },
                    1: { textStyle: { color: '#cbd5e1', fontSize: 10 }, gridlines: { color: 'transparent' }, viewWindow: { min: 0 }, format: 'short' }
                },
                bar: { groupWidth: '55%' },
                backgroundColor: 'transparent',
                animation: { startup: false, duration: 0 }, focusTarget: 'datum',
                tooltip: { textStyle: { fontSize: 12 } }
            };
            new google.visualization.ComboChart(el).draw(dataTable, comboOpts);
            this._registerChart(elementId, 'ComboChart', dataTable, comboOpts);
        } else {
            const lineOpts = {
                colors: visibleColors,
                curveType: 'function',
                chartArea: { left: 55, right: 20, top: 35, bottom: 75, height: '68%' },
                legend: { position: 'top', maxLines: 2, textStyle: { fontSize: 11, color: '#64748b' } },
                hAxis: this.hAxisDefaults(),
                vAxis: { textStyle: { color: '#94a3b8', fontSize: 11 }, gridlines: { color: '#f1f5f9', count: 6 }, viewWindow: { min: 0 }, format: 'short', baselineColor: '#e2e8f0' },
                lineWidth: 2.5, pointSize: 4,
                backgroundColor: 'transparent',
                animation: { startup: false, duration: 0 }, focusTarget: 'datum',
                tooltip: { textStyle: { fontSize: 12 } }
            };
            new google.visualization.LineChart(el).draw(dataTable, lineOpts);
            this._registerChart(elementId, 'LineChart', dataTable, lineOpts);
        }
    },

    // Vertical column chart with full name on hover
    drawColumnChart: function(elementId, dataObj, title, color) {
        if (this._deferIfNotReady('drawColumnChart', [elementId, dataObj, title, color])) return;
        const el = document.getElementById(elementId);
        if (!el) return;
        if (!dataObj || Object.keys(dataObj).length === 0) { this.clearChart(elementId); return; }

        let dataTable = new google.visualization.DataTable();
        dataTable.addColumn('string', title);
        dataTable.addColumn('number', 'Count');
        dataTable.addColumn({type: 'string', role: 'tooltip'});

        Object.entries(dataObj).sort((a,b) => b[1] - a[1]).slice(0, 15).forEach(([k, v]) => {
            dataTable.addRow([this.shortenProvider(k), v, k + ': ' + v.toLocaleString()]);
        });

        const opts = {
            colors: [color || GSF_COLORS[0]],
            chartArea: { left: 55, right: 15, top: 15, bottom: 90, height: '72%' },
            legend: { position: 'none' },
            vAxis: { textStyle: { color: '#94a3b8', fontSize: 11 }, gridlines: { color: '#f1f5f9', count: 5 }, viewWindow: { min: 0 }, format: 'short', baselineColor: '#e2e8f0' },
            hAxis: { textStyle: { color: '#64748b', fontSize: 10 }, slantedText: true, slantedTextAngle: 45 },
            animation: { startup: false, duration: 0 },
            bar: { groupWidth: '65%' },
            backgroundColor: 'transparent',
            tooltip: { trigger: 'focus', textStyle: { fontSize: 12 } }
        };
        new google.visualization.ColumnChart(el).draw(dataTable, opts);
        this._registerChart(elementId, 'ColumnChart', dataTable, opts);
    },

    // Horizontal bar chart for top-N lists
    drawBarChart: function(elementId, dataObj, title, colors) {
        if (this._deferIfNotReady('drawBarChart', [elementId, dataObj, title, colors])) return;
        const el = document.getElementById(elementId);
        if (!el) return;
        if (!dataObj || Object.keys(dataObj).length === 0) { this.clearChart(elementId); return; }

        let dataArr = [[title, 'Count']];
        Object.entries(dataObj).sort((a,b) => b[1] - a[1]).slice(0, 15)
            .forEach(([k, v]) => dataArr.push([k.length > 30 ? k.substring(0, 30) + '...' : k, v]));
        if (dataArr.length <= 1) { this.clearChart(elementId); return; }

        const barData = google.visualization.arrayToDataTable(dataArr);
        const opts = {
            colors: colors || [GSF_COLORS[0]],
            chartArea: { width: '58%', height: '82%', left: 175, top: 10 },
            legend: { position: 'none' },
            hAxis: { textStyle: { color: '#94a3b8', fontSize: 11 }, gridlines: { color: '#f1f5f9', count: 5 }, viewWindow: { min: 0 }, format: 'short', baselineColor: '#e2e8f0' },
            vAxis: { textStyle: { color: '#64748b', fontSize: 11 } },
            animation: { startup: false, duration: 0 },
            bar: { groupWidth: '65%' },
            backgroundColor: 'transparent',
            tooltip: { textStyle: { fontSize: 12 } }
        };
        new google.visualization.BarChart(el).draw(barData, opts);
        this._registerChart(elementId, 'BarChart', barData, opts);
    },

    drawFeedbackTimeline: function(elementId, snapData, showBars) {
        if (this._deferIfNotReady('drawFeedbackTimeline', [elementId, snapData, showBars])) return;
        const el = document.getElementById(elementId);
        if (!el) return;

        // Deduplicate to latest entry per course to avoid double-counting
        const deduped = {};
        snapData.forEach(d => {
            const k = (window.courseKey ? courseKey(d) : d.Course);
            if (!deduped[k] || d.Timestamp > deduped[k].Timestamp) {
                deduped[k] = d;
            }
        });
        const uniqueData = Object.values(deduped);

        let allDates = new Set();
        let aggregated = {};

        // Try RatingHistory first
        uniqueData.forEach(course => {
            if (!course.RatingHistory) return;
            let hist = this.safeParse(course.RatingHistory);
            Object.keys(hist).forEach(month => {
                allDates.add(month);
                if (!aggregated[month]) aggregated[month] = { volume: 0, ratingSum: 0, ratingCount: 0 };
                if (typeof hist[month] === 'object' && hist[month].sum !== undefined) {
                    aggregated[month].ratingSum += hist[month].sum;
                    aggregated[month].ratingCount += hist[month].count;
                    // Use volume field if available, fall back to count for backwards compat
                    aggregated[month].volume += hist[month].volume || hist[month].count;
                }
            });
        });

        // Fallback to FeedbackBank
        if (allDates.size === 0) {
            uniqueData.forEach(course => {
                if (!course.FeedbackBank) return;
                let fb; try { fb = JSON.parse(course.FeedbackBank); } catch(e) { return; }
                if (!Array.isArray(fb)) return;
                fb.forEach(entry => {
                    if (!entry.d) return;
                    let month = entry.d.substring(0, 7);
                    allDates.add(month);
                    if (!aggregated[month]) aggregated[month] = { volume: 0, ratingSum: 0, ratingCount: 0 };
                    aggregated[month].volume++;
                    if (entry.r) { aggregated[month].ratingSum += Number(entry.r); aggregated[month].ratingCount++; }
                });
            });
        }

        // Last fallback: if we have Rating + Responses but no history, show a single point
        if (allDates.size === 0) {
            uniqueData.forEach(course => {
                let resp = Number(course.Responses) || 0;
                let rat = Number(course.Rating) || 0;
                if (resp > 0 && rat > 0) {
                    let ts = course.Timestamp || 'current';
                    let month = ts.substring(0, 7);
                    allDates.add(month);
                    if (!aggregated[month]) aggregated[month] = { volume: 0, ratingSum: 0, ratingCount: 0 };
                    aggregated[month].volume += resp;
                    aggregated[month].ratingSum += rat * resp;
                    aggregated[month].ratingCount += resp;
                }
            });
        }

        let sortedDates = Array.from(allDates).sort();
        if (sortedDates.length === 0) { this.clearChart(elementId, "No survey/feedback history available. Run Step 2 to fetch survey data."); return; }

        let dataTable = new google.visualization.DataTable();
        dataTable.addColumn('string', 'Month');
        if (showBars) dataTable.addColumn('number', 'Survey Responses');
        dataTable.addColumn('number', 'Average Rating');

        sortedDates.forEach(date => {
            let row = [this.formatDate(date + '-01')];
            let mData = aggregated[date];
            if (showBars) row.push(mData.volume);
            row.push(mData.ratingCount > 0 ? (mData.ratingSum / mData.ratingCount) : null);
            dataTable.addRow(row);
        });

        const fbOpts = {
            colors: showBars ? [GSF_COLORS[3], GSF_COLORS[2]] : [GSF_COLORS[2]],
            seriesType: showBars ? 'bars' : 'line',
            series: showBars ? { 0: { type: 'bars', targetAxisIndex: 1, opacity: 0.4 }, 1: { type: 'line', targetAxisIndex: 0, lineWidth: 3, pointSize: 5, curveType: 'function' } } : { 0: { type: 'line', lineWidth: 3, pointSize: 5, curveType: 'function' } },
            chartArea: { left: 55, right: 55, top: 35, bottom: 75, height: '65%' },
            legend: { position: 'top', textStyle: { fontSize: 11, color: '#64748b' } },
            hAxis: this.hAxisDefaults(),
            vAxes: {
                0: { title: 'Avg Rating', titleTextStyle: { color: '#94a3b8', fontSize: 11, italic: false }, textStyle: { color: '#94a3b8', fontSize: 11 }, viewWindow: { min: 0, max: 5.5 }, gridlines: { color: '#f1f5f9', count: 6 }, baselineColor: '#e2e8f0' },
                1: { title: 'Volume', titleTextStyle: { color: '#cbd5e1', fontSize: 11, italic: false }, textStyle: { color: '#cbd5e1', fontSize: 10 }, viewWindow: { min: 0 }, gridlines: { color: 'transparent' } }
            },
            bar: { groupWidth: '55%' },
            backgroundColor: 'transparent',
            animation: { startup: false, duration: 0 },
            tooltip: { textStyle: { fontSize: 12 } }
        };
        new google.visualization.ComboChart(el).draw(dataTable, fbOpts);
        this._registerChart(elementId, 'ComboChart', dataTable, fbOpts);
    },

    // Cumulative line chart with optional monthly bars
    drawCumulativeTimeline: function(elementId, monthlyData, label, color, showBars, extraOpts) {
        if (this._deferIfNotReady('drawCumulativeTimeline', [elementId, monthlyData, label, color, showBars, extraOpts])) return;
        const el = document.getElementById(elementId);
        if (!el) return;
        extraOpts = extraOpts || {};
        const monthLimit = extraOpts.monthLimit;   // 'all' | '3' | '6' | '12' | '24' (number-as-string)
        const trimYAxis  = !!extraOpts.trimYAxis;  // start y-axis near the first visible value (drama mode)

        let months = Object.keys(monthlyData).sort();
        if (months.length === 0) { this.clearChart(elementId); return; }
        // Continuous month axis — a zero-activity month stays as a flat point, not a gap.
        months = this._fillMonthRange(months);

        // Drop the current incomplete month unless the user has opted to include it
        if (months.length > 0 && this._isPartialMonth(months[months.length - 1]) && !this._shouldIncludePartial()) {
            months = months.slice(0, -1);
        }
        if (months.length === 0) { this.clearChart(elementId, "No complete months yet — toggle 'Include current month' to see partial data."); return; }

        // Compute cumulative values for the FULL series so that trimming to a window
        // preserves the true cumulative total at each point.
        let fullCum = {}; let running = 0;
        months.forEach(m => { running += (Number(monthlyData[m]) || 0); fullCum[m] = running; });

        // Apply month-limit window (keep last N months) before building the chart's DataTable
        let visibleMonths = months;
        if (monthLimit && monthLimit !== 'all') {
            const n = parseInt(monthLimit, 10);
            if (n > 0 && months.length > n) visibleMonths = months.slice(-n);
        }

        let dataTable = new google.visualization.DataTable();
        dataTable.addColumn('string', 'Month');
        dataTable.addColumn('number', 'Cumulative ' + label);
        if (showBars) dataTable.addColumn('number', 'Monthly ' + label);

        visibleMonths.forEach(m => {
            let row = [this.formatDate(m + '-01'), Math.round(fullCum[m])];
            if (showBars) row.push(Math.round(Number(monthlyData[m]) || 0));
            dataTable.addRow(row);
        });

        // Determine y-axis min: 0 (honest) or trimmed below first visible cumulative value (dramatic)
        const firstCum = fullCum[visibleMonths[0]] || 0;
        const lastCum  = fullCum[visibleMonths[visibleMonths.length - 1]] || 0;
        let yMin = 0;
        if (trimYAxis && firstCum > 0 && lastCum > firstCum) {
            // Pad ~5% below the first visible cumulative so the line doesn't touch the axis
            const span = lastCum - firstCum;
            yMin = Math.max(0, Math.floor(firstCum - span * 0.05));
        }

        if (showBars) {
            const lineColor = color || GSF_COLORS[0];
            const opts = {
                colors: [lineColor, lineColor],
                seriesType: 'line', series: { 0: { type: 'line', lineWidth: 2.5, pointSize: 4, targetAxisIndex: 0, curveType: 'function' }, 1: { type: 'bars', targetAxisIndex: 1, opacity: 0.35 } },
                chartArea: { left: 55, right: 20, top: 35, bottom: 75, height: '65%' },
                legend: { position: 'top', textStyle: { fontSize: 11, color: '#64748b' } },
                hAxis: this.hAxisDefaults(),
                vAxes: {
                    0: { textStyle: { color: '#94a3b8', fontSize: 11 }, gridlines: { color: '#f1f5f9', count: 6 }, viewWindow: { min: yMin }, format: 'short', baselineColor: '#e2e8f0' },
                    1: { textStyle: { color: '#cbd5e1', fontSize: 10 }, gridlines: { color: 'transparent' }, viewWindow: { min: 0 }, format: 'short' }
                },
                bar: { groupWidth: '55%' },
                backgroundColor: 'transparent',
                animation: { startup: false, duration: 0 }, focusTarget: 'datum',
                tooltip: { textStyle: { fontSize: 12 } }
            };
            new google.visualization.ComboChart(el).draw(dataTable, opts);
            this._registerChart(elementId, 'ComboChart', dataTable, opts);
        } else {
            const opts = {
                colors: [color || GSF_COLORS[0]],
                curveType: 'function',
                chartArea: { left: 55, right: 20, top: 35, bottom: 75, height: '68%' },
                legend: { position: 'top', textStyle: { fontSize: 11, color: '#64748b' } },
                hAxis: this.hAxisDefaults(),
                vAxis: { textStyle: { color: '#94a3b8', fontSize: 11 }, gridlines: { color: '#f1f5f9', count: 6 }, viewWindow: { min: yMin }, format: 'short', baselineColor: '#e2e8f0' },
                lineWidth: 2.5, pointSize: 4,
                backgroundColor: 'transparent',
                animation: { startup: false, duration: 0 }, focusTarget: 'datum',
                tooltip: { textStyle: { fontSize: 12 } }
            };
            new google.visualization.LineChart(el).draw(dataTable, opts);
            this._registerChart(elementId, 'LineChart', dataTable, opts);
        }
    },

    // Multi-line breakdown (countries, professions, ambassadors)
    // selectedCategories = array of selected names; if empty, use top N
    // monthLimit = number of recent months to display ('all' or a positive integer)
    // showBars = if true, also overlay monthly bars (sum across selected categories)
    drawBreakdownTimeline: function(elementId, monthlyBreakdown, topN, selectedCategories, showBars, monthLimit, trimYAxis) {
        if (this._deferIfNotReady('drawBreakdownTimeline', [elementId, monthlyBreakdown, topN, selectedCategories, showBars, monthLimit, trimYAxis])) return;
        const el = document.getElementById(elementId);
        if (!el) return;

        let allMonths = Object.keys(monthlyBreakdown).sort();
        if (allMonths.length === 0) { this.clearChart(elementId); return; }

        // Drop the current incomplete month unless the user has opted to include it
        if (allMonths.length > 0 && this._isPartialMonth(allMonths[allMonths.length - 1]) && !this._shouldIncludePartial()) {
            allMonths = allMonths.slice(0, -1);
        }
        if (allMonths.length === 0) { this.clearChart(elementId, "No complete months yet — toggle 'Include current month' to see partial data."); return; }

        // Calculate totals for all categories (across full timeline — used for selecting top N)
        let totals = {};
        allMonths.forEach(m => {
            Object.entries(monthlyBreakdown[m]).forEach(([cat, count]) => {
                totals[cat] = (totals[cat] || 0) + count;
            });
        });

        let categories;
        if (selectedCategories && selectedCategories.length > 0) {
            categories = selectedCategories;
        } else {
            categories = Object.entries(totals)
                .filter(([k]) => k && k !== 'Unknown' && k !== 'nan' && k !== 'undefined')
                .sort((a, b) => b[1] - a[1])
                .slice(0, topN || 10)
                .map(([k]) => k);
        }
        if (categories.length === 0) { this.clearChart(elementId); return; }

        // Pre-compute cumulative-up-to-each-month BEFORE applying the period filter
        // (so cumulative values are correct for the selected window)
        const cumulativeUpTo = {};
        let runningCum = {};
        categories.forEach(c => runningCum[c] = 0);
        allMonths.forEach(m => {
            categories.forEach(cat => { runningCum[cat] += (monthlyBreakdown[m][cat] || 0); });
            cumulativeUpTo[m] = { ...runningCum };
        });

        // Grand-total cumulative across ALL known categories (not just the selected /
        // visible ones). Each series' % is its share of the WHOLE known population at
        // that month, so toggling categories on/off no longer changes the percentages.
        const allCatsForPct = Object.keys(totals).filter(k => k && k !== 'Unknown' && k !== 'nan' && k !== 'undefined');
        const cumAllUpTo = {};
        let runningAll = {};
        allCatsForPct.forEach(c => runningAll[c] = 0);
        allMonths.forEach(m => {
            allCatsForPct.forEach(cat => { runningAll[cat] += (monthlyBreakdown[m][cat] || 0); });
            cumAllUpTo[m] = { ...runningAll };
        });

        // Apply month limit (default: all)
        let monthsToShow = allMonths;
        const limit = monthLimit;
        if (limit && limit !== 'all' && Number.isFinite(Number(limit))) {
            const n = Math.max(1, parseInt(limit, 10));
            monthsToShow = allMonths.slice(-n);
        }

        let dataTable = new google.visualization.DataTable();
        dataTable.addColumn('string', 'Month');
        categories.forEach(cat => {
            dataTable.addColumn('number', cat);
            dataTable.addColumn({type: 'string', role: 'tooltip', p: {html: true}});
        });
        if (showBars) {
            dataTable.addColumn('number', 'Monthly total');
            dataTable.addColumn({type: 'string', role: 'tooltip', p: {html: true}});
        }

        monthsToShow.forEach(m => {
            const cum = cumulativeUpTo[m];
            let grandTotal = 0;
            const cumAll = cumAllUpTo[m] || {};
            allCatsForPct.forEach(cat => { grandTotal += (cumAll[cat] || 0); });
            let row = [this.formatDate(m + '-01')];
            categories.forEach(cat => {
                let val = Math.round(cum[cat]);
                let pct = grandTotal > 0 ? ((cum[cat] / grandTotal) * 100).toFixed(1) : '0.0';
                row.push(val);
                row.push('<div style="padding:8px;font-size:12px"><strong>' + cat + '</strong><br>' + val.toLocaleString() + ' (' + pct + '%)</div>');
            });
            if (showBars) {
                let monthSum = 0;
                categories.forEach(cat => { monthSum += (monthlyBreakdown[m][cat] || 0); });
                row.push(Math.round(monthSum));
                row.push('<div style="padding:8px;font-size:12px"><strong>This month</strong><br>' + Math.round(monthSum).toLocaleString() + ' new (selected)</div>');
            }
            dataTable.addRow(row);
        });

        // Drama-mode y-axis trim: start near the minimum cumulative value across all visible
        // categories at the first visible month, padded ~5% below.
        let yMin = 0;
        if (trimYAxis && monthsToShow.length > 0) {
            const firstM = monthsToShow[0];
            const lastM = monthsToShow[monthsToShow.length - 1];
            let lowestFirst = Infinity, highestLast = 0;
            categories.forEach(cat => {
                const fv = cumulativeUpTo[firstM][cat] || 0;
                const lv = cumulativeUpTo[lastM][cat] || 0;
                if (fv < lowestFirst) lowestFirst = fv;
                if (lv > highestLast) highestLast = lv;
            });
            if (lowestFirst !== Infinity && highestLast > lowestFirst) {
                const span = highestLast - lowestFirst;
                yMin = Math.max(0, Math.floor(lowestFirst - span * 0.05));
            }
        }

        const baseOpts = {
            colors: GSF_COLORS.slice(0, categories.length).concat(showBars ? ['#94a3b8'] : []),
            chartArea: { left: 55, right: showBars ? 55 : 20, top: 45, bottom: 75, height: '62%' },
            legend: { position: 'top', maxLines: 3, textStyle: { fontSize: 10, color: '#64748b' } },
            hAxis: this.hAxisDefaults(),
            backgroundColor: 'transparent',
            tooltip: { isHtml: true, trigger: 'focus' },
            focusTarget: 'datum',
            animation: { startup: false, duration: 0 }
        };

        if (showBars) {
            // ComboChart: lines for cumulative categories, bars for monthly total
            const series = {};
            categories.forEach((c, i) => { series[i] = { type: 'line', targetAxisIndex: 0, lineWidth: 2.5, pointSize: 0, curveType: 'function' }; });
            series[categories.length] = { type: 'bars', targetAxisIndex: 1, opacity: 0.4 };
            const opts = { ...baseOpts,
                seriesType: 'line',
                series,
                vAxes: {
                    0: { textStyle: { color: '#94a3b8', fontSize: 11 }, gridlines: { color: '#f1f5f9', count: 6 }, viewWindow: { min: yMin }, format: 'short', baselineColor: '#e2e8f0', title: 'Cumulative' },
                    1: { textStyle: { color: '#cbd5e1', fontSize: 10 }, gridlines: { color: 'transparent' }, viewWindow: { min: 0 }, format: 'short', title: 'Monthly' }
                },
                bar: { groupWidth: '55%' }
            };
            new google.visualization.ComboChart(el).draw(dataTable, opts);
            this._registerChart(elementId, 'ComboChart', dataTable, opts);
        } else {
            const opts = { ...baseOpts,
                curveType: 'function',
                vAxis: { textStyle: { color: '#94a3b8', fontSize: 11 }, gridlines: { color: '#f1f5f9', count: 6 }, viewWindow: { min: yMin }, format: 'short', baselineColor: '#e2e8f0' },
                lineWidth: 2.5, pointSize: 0
            };
            new google.visualization.LineChart(el).draw(dataTable, opts);
            this._registerChart(elementId, 'LineChart', dataTable, opts);
        }
    },

    // --- DASHBOARD WRAPPERS ---

    drawPlatform: function(historyData, snapData) {
        if (this._deferIfNotReady('drawPlatform', [historyData, snapData])) return;

        // 1. Platform Growth
        let platformTimeline = {};
        historyData.forEach(d => {
            if (d.CourseTimeline) {
                let scaled = this.getScaledTimeline(d.CourseTimeline, true);
                Object.keys(scaled).forEach(m => {
                    if (m < '2023-05') return; // platform launched May 2023 — older signup dates are pre-launch noise
                    if (!platformTimeline[m]) platformTimeline[m] = { e: 0, c: 0 };
                    platformTimeline[m].e += scaled[m].e;
                    platformTimeline[m].c += scaled[m].c;
                });
            }
        });
        let showGrowthBars = document.getElementById('toggle-plat-growth-bars') && document.getElementById('toggle-plat-growth-bars').checked;
        this.drawTimelineLineChart('chart_growth', [JSON.stringify(platformTimeline)], ['Platform Total'], true, showGrowthBars);

        // 2. Feedback
        this.drawFeedbackTimeline('chart_feedback_growth', snapData, document.getElementById('toggle-plat-fb-bars') && document.getElementById('toggle-plat-fb-bars').checked);

        // 3. Provider Distributions (vertical column charts)
        // Per-provider rollups use the INCLUDED-ONLY analytics snapshot so each
        // provider's bar matches that provider's own page / PDF (which exclude
        // course-level-private courses). Only the platform growth/totals above use
        // the full snapData (incl. active-but-private).
        const provSnap = (window.App && window.App.getAnalyticsSnap) ? window.App.getAnalyticsSnap() : snapData;
        let pLearners = {}, pCerts = {}, pRate = {};
        provSnap.forEach(d => {
            if (!d.Provider) return;
            pLearners[d.Provider] = (pLearners[d.Provider] || 0) + (Number(d.Learners) || 0);
            pCerts[d.Provider] = (pCerts[d.Provider] || 0) + (Number(d.Certificates) || 0);
            const r = Number(d.Rating) || 0;
            if (r > 0) { if (!pRate[d.Provider]) pRate[d.Provider] = { sum: 0, cnt: 0 }; pRate[d.Provider].sum += r; pRate[d.Provider].cnt++; }
        });
        this.drawColumnChart('chart_prov_learners', pLearners, 'Provider', GSF_COLORS[0]);
        this.drawColumnChart('chart_prov_certs', pCerts, 'Provider', GSF_COLORS[1]);
        // Certification rate per provider (certs ÷ learners). Min 50 learners
        // so a 1/1 provider doesn't top the chart at 100%.
        let pCertRate = {};
        Object.keys(pLearners).forEach(p => { if ((pLearners[p] || 0) >= 50) pCertRate[p] = +((pCerts[p] || 0) / pLearners[p] * 100).toFixed(1); });
        this.drawColumnChart('chart_prov_certrate', pCertRate, 'Provider', GSF_COLORS[2]);
        const ratingRows = Object.entries(pRate).map(([name, o]) => ({ name, avg: o.sum / o.cnt, courses: o.cnt }));
        this.drawProviderRatings('chart_prov_rating', ratingRows);
    },

    // Average rating per provider (simple mean of its rated courses, matching the
    // provider-page KPI). y-axis is zoomed near the data so ~4.x ratings differ visibly.
    drawProviderRatings: function(elementId, rows) {
        if (this._deferIfNotReady('drawProviderRatings', [elementId, rows])) return;
        const el = document.getElementById(elementId);
        if (!el) return;
        if (!rows || rows.length === 0) { this.clearChart(elementId, 'No rating data yet — run Sync Surveys.'); return; }
        const sorted = rows.slice().sort((a, b) => b.avg - a.avg).slice(0, 15);
        const dt = new google.visualization.DataTable();
        dt.addColumn('string', 'Provider');
        dt.addColumn('number', 'Avg Rating');
        dt.addColumn({ type: 'string', role: 'tooltip' });
        sorted.forEach(r => {
            dt.addRow([this.shortenProvider(r.name), Number(r.avg.toFixed(2)), r.name + ': ' + r.avg.toFixed(2) + ' ★ (' + r.courses + ' course' + (r.courses !== 1 ? 's' : '') + ')']);
        });
        const minVal = Math.min.apply(null, sorted.map(r => r.avg));
        const lo = Math.max(0, Math.floor((minVal - 0.3) * 2) / 2);
        const opts = {
            colors: ['#D03734'],
            chartArea: { left: 45, right: 15, top: 15, bottom: 90, height: '72%' },
            legend: { position: 'none' },
            vAxis: { textStyle: { color: '#94a3b8', fontSize: 11 }, gridlines: { color: '#f1f5f9', count: 5 }, viewWindow: { min: lo, max: 5 }, format: '#.0', baselineColor: '#e2e8f0' },
            hAxis: { textStyle: { color: '#64748b', fontSize: 10 }, slantedText: true, slantedTextAngle: 45 },
            animation: { startup: false, duration: 0 },
            bar: { groupWidth: '65%' },
            backgroundColor: 'transparent',
            tooltip: { trigger: 'focus', textStyle: { fontSize: 12 } }
        };
        new google.visualization.ColumnChart(el).draw(dt, opts);
        this._registerChart(elementId, 'ColumnChart', dt, opts);
    },

    // Targeted redraw for platform growth chart only
    redrawPlatformGrowth: function(historyData) {
        let platformTimeline = {};
        historyData.forEach(d => {
            if (d.CourseTimeline) {
                let scaled = this.getScaledTimeline(d.CourseTimeline, true);
                Object.keys(scaled).forEach(m => {
                    if (m < '2023-05') return;
                    if (!platformTimeline[m]) platformTimeline[m] = { e: 0, c: 0 };
                    platformTimeline[m].e += scaled[m].e;
                    platformTimeline[m].c += scaled[m].c;
                });
            }
        });
        let showBars = document.getElementById('toggle-plat-growth-bars') && document.getElementById('toggle-plat-growth-bars').checked;
        this.drawTimelineLineChart('chart_growth', [JSON.stringify(platformTimeline)], ['Platform Total'], true, showBars, 'plat');
    },

    // Targeted redraw for provider growth chart only
    redrawProviderGrowth: function(historyData, providerName) {
        const pData = historyData.filter(d => d.Provider === providerName);
        let provTimeline = {};
        pData.forEach(d => {
            if (d.CourseTimeline) {
                let scaled = this.getScaledTimeline(d.CourseTimeline, true);
                Object.keys(scaled).forEach(m => {
                    if (!provTimeline[m]) provTimeline[m] = { e: 0, c: 0 };
                    provTimeline[m].e += scaled[m].e;
                    provTimeline[m].c += scaled[m].c;
                });
            }
        });
        let showBars = document.getElementById('toggle-prov-growth-bars') && document.getElementById('toggle-prov-growth-bars').checked;
        this.drawTimelineLineChart('chart_growth', [JSON.stringify(provTimeline)], [providerName], true, showBars, 'prov');
    },

    // Targeted redraw for provider feedback chart only
    redrawProviderFeedback: function(historyData, providerName, showBars) {
        const pData = historyData.filter(d => d.Provider === providerName);
        this.drawFeedbackTimeline('chart_feedback_growth', pData, showBars);
    },

    drawProvider: function(historyData, providerName) {
        if (this._deferIfNotReady('drawProvider', [historyData, providerName])) return;
        if (!providerName) { this.clearChart('chart_growth', "Please select a provider."); return; }

        const pData = historyData.filter(d => d.Provider === providerName);
        let provTimeline = {};
        pData.forEach(d => {
            if (d.CourseTimeline) {
                let scaled = this.getScaledTimeline(d.CourseTimeline, true);
                Object.keys(scaled).forEach(m => {
                    if (!provTimeline[m]) provTimeline[m] = { e: 0, c: 0 };
                    provTimeline[m].e += scaled[m].e;
                    provTimeline[m].c += scaled[m].c;
                });
            }
        });
        let showGrowthBars = document.getElementById('toggle-prov-growth-bars') && document.getElementById('toggle-prov-growth-bars').checked;
        this.drawTimelineLineChart('chart_growth', [JSON.stringify(provTimeline)], [providerName], true, showGrowthBars);
        this.drawFeedbackTimeline('chart_feedback_growth', pData, document.getElementById('toggle-prov-fb-bars') && document.getElementById('toggle-prov-fb-bars').checked);

        // Provider world map from anonymized user data
        this.drawProviderMap(providerName);
    },

    drawProviderMap: function(providerName) {
        const mapEl = document.getElementById('chart_provider_map');
        if (!mapEl) return;
        const snapData = window.App.getAnalyticsSnap();
        const provRecords = snapData.filter(d => d.Provider === providerName);
        const countryCounts = {};

        // PRIMARY (API path): aggregate per-course CountryStats across the
        // provider's courses (collected during the Growth Timelines sync).
        let usedCountryStats = false;
        provRecords.forEach(d => {
            if (!d.CountryStats) return;
            try {
                const cs = JSON.parse(d.CountryStats);
                Object.entries(cs).forEach(([k, v]) => {
                    if (k && k !== 'Unknown' && k !== 'nan') { countryCounts[k] = (countryCounts[k] || 0) + v; usedCountryStats = true; }
                });
            } catch (e) {}
        });

        // FALLBACK (CSV path): derive from anonymized per-user records.
        if (!usedCountryStats) {
            const anonUsers = window.App._rawAnonymizedUsers;
            if (!anonUsers || anonUsers.length === 0) {
                this.clearChart('chart_provider_map', 'Run "Sync Growth Timelines" (or upload a Users file) to see the learner map.');
                return;
            }
            const provCourses = provRecords.map(d => d.Course);
            anonUsers.forEach(u => {
                if (!provCourses.includes(u.course)) {
                    const normU = (u.course || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    const found = provCourses.some(pc => {
                        const normP = pc.toLowerCase().replace(/[^a-z0-9]/g, '');
                        return normU.length > 3 && normP.length > 3 && (normU.includes(normP) || normP.includes(normU));
                    });
                    if (!found) return;
                }
                if (u.country && u.country.trim() && u.country !== 'Unknown' && u.country !== 'nan') {
                    countryCounts[u.country.trim()] = (countryCounts[u.country.trim()] || 0) + 1;
                }
            });
        }
        const entries = Object.entries(countryCounts);
        if (entries.length > 0) {
            let total = entries.reduce((s, [, v]) => s + v, 0);
            let dt = new google.visualization.DataTable();
            dt.addColumn('string', 'Country');
            dt.addColumn('number', 'Learners');
            dt.addColumn({type: 'string', role: 'tooltip', p: {html: true}});
            entries.forEach(([c, v]) => {
                let pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0';
                dt.addRow([(window.countryToISO && window.countryToISO(c)) || c, v, '<div style="padding:8px 12px;font-size:12px"><strong>' + c + '</strong><br>' + v.toLocaleString() + ' learners (' + pct + '%)</div>']);
            });
            new google.visualization.GeoChart(mapEl).draw(dt,
                { colorAxis: {colors: ['#ebf5fb', '#3498db', '#1a5276'], minValue: 0}, backgroundColor: 'transparent', datalessRegionColor: '#f1f5f9', defaultColor: '#f1f5f9', legend: {textStyle: {fontSize: 11, color: '#64748b'}}, tooltip: {isHtml: true, trigger: 'focus'} }
            );
        } else {
            this.clearChart('chart_provider_map', 'No country data for this provider.');
        }
    },

    drawCourse: function(historyData, courseName) {
        if (this._deferIfNotReady('drawCourse', [historyData, courseName])) return;
        if (!courseName) { this.clearChart('chart_growth', "Please select a course."); return; }

        const cData = historyData.filter(d => window.courseMatches ? courseMatches(d, courseName) : d.Course === courseName);
        // Find the entry that actually has CourseTimeline (may not be the first one)
        const withTL = cData.find(d => d.CourseTimeline);
        let cTimeline = {};
        if (withTL) {
            cTimeline = this.getScaledTimeline(withTL.CourseTimeline, true);
        }
        let showGrowthBars = document.getElementById('toggle-crs-growth-bars') && document.getElementById('toggle-crs-growth-bars').checked;
        this.drawTimelineLineChart('chart_growth', [JSON.stringify(cTimeline)], [courseName], true, showGrowthBars, 'crs');
        this.drawFeedbackTimeline('chart_feedback_growth', cData, document.getElementById('toggle-crs-fb-bars') && document.getElementById('toggle-crs-fb-bars').checked);
        this.drawCourseMap(courseName);
    },

    // Per-course learner map from the course record's CountryStats (collected
    // during Growth Timelines sync). Falls back to anonymized per-user records.
    drawCourseMap: function(courseName) {
        const mapEl = document.getElementById('chart_course_map');
        if (!mapEl) return;
        const snapData = window.App.getAnalyticsSnap();
        const rec = snapData.find(d => window.courseMatches ? courseMatches(d, courseName) : d.Course === courseName) || {};
        const countryCounts = {};
        let used = false;
        if (rec.CountryStats) {
            try {
                const cs = JSON.parse(rec.CountryStats);
                Object.entries(cs).forEach(([k, v]) => { if (k && k !== 'Unknown' && k !== 'nan') { countryCounts[k] = (countryCounts[k] || 0) + v; used = true; } });
            } catch (e) {}
        }
        if (!used) {
            const anon = window.App._rawAnonymizedUsers || [];
            anon.forEach(u => {
                if (u.course === courseName && u.country && u.country.trim() && u.country !== 'Unknown' && u.country !== 'nan') {
                    countryCounts[u.country.trim()] = (countryCounts[u.country.trim()] || 0) + 1;
                }
            });
        }
        const entries = Object.entries(countryCounts);
        if (entries.length === 0) {
            this.clearChart('chart_course_map', 'Run "Sync Growth Timelines" to see this course\'s learner map.');
            return;
        }
        const total = entries.reduce((s, [, v]) => s + v, 0);
        const dt = new google.visualization.DataTable();
        dt.addColumn('string', 'Country');
        dt.addColumn('number', 'Learners');
        dt.addColumn({ type: 'string', role: 'tooltip', p: { html: true } });
        entries.forEach(([c, v]) => {
            const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0';
            dt.addRow([(window.countryToISO && window.countryToISO(c)) || c, v, '<div style="padding:8px 12px;font-size:12px"><strong>' + c + '</strong><br>' + v.toLocaleString() + ' learners (' + pct + '%)</div>']);
        });
        new google.visualization.GeoChart(mapEl).draw(dt,
            { colorAxis: { colors: ['#ebf5fb', '#3498db', '#1a5276'], minValue: 0 }, backgroundColor: 'transparent', datalessRegionColor: '#f1f5f9', defaultColor: '#f1f5f9', legend: { textStyle: { fontSize: 11, color: '#64748b' } }, tooltip: { isHtml: true, trigger: 'focus' } }
        );
    },

    drawAudience: function(snap) {
        if (this._deferIfNotReady('drawAudience', [snap])) return;
        if (!snap || !snap.AllCountryStats) {
            this.clearChart('chart_user_map', "Upload User CSV to generate audience charts.");
            this.clearChart('chart_audience_growth');
            return;
        }

        // 1. Geo Map with % tooltips
        const mapEl = document.getElementById('chart_user_map');
        if (mapEl) {
            try {
                let countryStats = JSON.parse(snap.AllCountryStats);
                let entries = Object.entries(countryStats).filter(([c]) => c !== 'Unknown' && c !== 'nan');
                let total = entries.reduce((s, [, v]) => s + v, 0);
                if (entries.length > 0) {
                    let dt = new google.visualization.DataTable();
                    dt.addColumn('string', 'Country');
                    dt.addColumn('number', 'Users');
                    dt.addColumn({type: 'string', role: 'tooltip', p: {html: true}});
                    entries.forEach(([c, v]) => {
                        let pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0';
                        dt.addRow([(window.countryToISO && window.countryToISO(c)) || c, v, '<div style="padding:8px 12px;font-size:12px"><strong>' + c + '</strong><br>' + v.toLocaleString() + ' users (' + pct + '%)</div>']);
                    });
                    new google.visualization.GeoChart(mapEl).draw(dt,
                        { colorAxis: {colors: ['#ebf5fb', '#3498db', '#1a5276'], minValue: 0}, backgroundColor: 'transparent', datalessRegionColor: '#f1f5f9', defaultColor: '#f1f5f9', legend: {textStyle: {fontSize: 11, color: '#64748b'}}, tooltip: {isHtml: true, trigger: 'focus'} }
                    );
                } else { this.clearChart('chart_user_map'); }
            } catch(e) { this.clearChart('chart_user_map'); }
        }

        // 2. User Growth
        if (snap.Signups) {
            let signups = this.safeParse(snap.Signups);
            let showBars = document.getElementById('toggle-aud-growth-bars') && document.getElementById('toggle-aud-growth-bars').checked;
            const opts = {
                monthLimit: (window.App && App.userGrowthRange) || 'all',
                trimYAxis:  !!(window.App && App.userGrowthTrim),
            };
            this.drawCumulativeTimeline('chart_audience_growth', signups, 'Users', GSF_COLORS[0], showBars, opts);
        } else { this.clearChart('chart_audience_growth', "Re-upload Users file to see growth timeline."); }

        // 3. Country breakdown
        if (snap.CountryTimeline) {
            let countryTL = this.safeParse(snap.CountryTimeline);
            let selected = window.App.selectedCountries || [];
            let showBars = !!(document.getElementById('toggle-country-bars') || {}).checked;
            let limit = window.App.countryTimelineRange || 'all';
            let trim = !!(window.App && App.countryGrowthTrim);
            this.drawBreakdownTimeline('chart_country_timeline', countryTL, 5, selected.length > 0 ? selected : null, showBars, limit, trim);
        } else { this.clearChart('chart_country_timeline', "Re-upload Users file to see country timeline."); }

        // 4. Per-question breakdowns (exact-tag): Activity (Q3), Career Stage (Q2), Topics (Q8).
        //    Each falls back to the legacy ProfTimeline only for the Activity chart
        //    when a snapshot predates these fields.
        const drawBd = (field, elId, stateSel, stateRange, stateTrim, barId, emptyMsg) => {
            const raw = snap[field];
            if (raw) {
                let tl = this.safeParse(raw);
                // Cadre chart: fold exact tags into canonical cadres so it matches the table.
                if (field === 'ActivityTimeline' || field === 'ProfTimeline') tl = this.canonActivityTimeline(tl);
                const selected = (window.App && window.App[stateSel]) || [];
                const showBars = !!(document.getElementById(barId) || {}).checked;
                const limit = (window.App && window.App[stateRange]) || 'all';
                const trim = !!(window.App && window.App[stateTrim]);
                this.drawBreakdownTimeline(elId, tl, 5, selected.length > 0 ? selected : null, showBars, limit, trim);
            } else {
                this.clearChart(elId, emptyMsg);
            }
        };
        drawBd(snap.ActivityTimeline ? 'ActivityTimeline' : 'ProfTimeline', 'chart_activity_timeline',
            'selectedActivities', 'activityTimelineRange', 'activityGrowthTrim', 'toggle-activity-bars',
            'Re-sync Learners (or re-upload Users) to see the activity breakdown.');
        drawBd('CareerStageTimeline', 'chart_career_timeline',
            'selectedCareerStages', 'careerTimelineRange', 'careerGrowthTrim', 'toggle-career-bars',
            'Re-sync Learners to see career-stage growth (needs the latest sync).');
        drawBd('TopicTimeline', 'chart_topic_timeline',
            'selectedTopics', 'topicTimelineRange', 'topicGrowthTrim', 'toggle-topic-bars',
            'Re-sync Learners to see topic-interest growth (needs the latest sync).');
    },

    drawAmbassadors: function(snap) {
        if (this._deferIfNotReady('drawAmbassadors', [snap])) return;
        if (!snap || !snap.Timeline) { this.clearChart('chart_ambassador_total', "Upload Leads CSV to generate ambassador charts."); return; }

        let showBars = document.getElementById('toggle-amb-growth-bars') && document.getElementById('toggle-amb-growth-bars').checked;
        const ambOpts = {
            monthLimit: (window.App && App.ambGrowthRange) || 'all',
            trimYAxis:  !!(window.App && App.ambGrowthTrim),
        };
        this.drawCumulativeTimeline('chart_ambassador_total', snap.Timeline, 'Referrals', GSF_COLORS[1], showBars, ambOpts);
        // Top Ambassadors bar — metric toggle (Leads vs Clicks). Leads honour the
        // time-window filter (App.ambTopWindow); clicks are an all-time counter
        // (no per-click dates) so the window doesn't apply to them.
        const hasClicks = snap.ClicksByPromoter && Object.keys(snap.ClicksByPromoter).length > 0;
        const ambMetric = (hasClicks && window.App && window.App.ambTopMetric === 'clicks') ? 'clicks' : 'leads';
        let topData;
        if (ambMetric === 'clicks') {
            topData = snap.ClicksByPromoter || {};
        } else {
            topData = snap.Promoters || {};
            if (window.App && window.App._filterTopAmbassadors) {
                const f = window.App._filterTopAmbassadors();
                if (f && (window.App.ambTopWindow || 'all') !== 'all') topData = f.filtered;
            }
        }
        const limit = (window.App && window.App.ambTopLimit) || 15;
        const topN = Object.entries(topData).sort((a, b) => b[1] - a[1]).slice(0, limit);
        const limited = Object.fromEntries(topN);
        this.drawBarChart('chart_ambassador_bar', limited, 'Ambassador', [ambMetric === 'clicks' ? '#E28743' : GSF_COLORS[0]]);

        // Ambassador timeline: build from ALL promoters, let selector + drawBreakdownTimeline handle display
        if (snap.PromoterTimeline && snap.TopPromoters) {
            let allTL = {};
            snap.TopPromoters.forEach(name => {
                let pTL = snap.PromoterTimeline[name] || {};
                Object.keys(pTL).forEach(m => {
                    if (!allTL[m]) allTL[m] = {};
                    allTL[m][name] = (allTL[m][name] || 0) + pTL[m];
                });
            });
            let selected = window.App.selectedAmbassadors || [];
            let showAmbBars = !!(document.getElementById('toggle-amb-top-bars') || {}).checked;
            let ambLimit = window.App.ambassadorsTimelineRange || 'all';
            this.drawBreakdownTimeline('chart_ambassador_top5', allTL, 5, selected.length > 0 ? selected : null, showAmbBars, ambLimit);
        } else { this.clearChart('chart_ambassador_top5'); }

        this.drawAmbassadorScatter(snap);
    },

    // Quality-vs-volume quadrant scatter: each ambassador with >=20 referral clicks
    // plotted by leads (x, volume) and click->lead conversion (y, quality), coloured
    // by quadrant relative to the MEDIAN of each axis. Conversion needs a clicks
    // counter, so only name-matched ambassadors with >=20 clicks are plotted (matches
    // the >=20 threshold the "Best Conversion" award uses) — the rest are too noisy.
    drawAmbassadorScatter: function(snap) {
        const el = document.getElementById('chart_ambassador_scatter');
        if (!el) return;
        const promoters = (snap && snap.Promoters) || {};
        const clicks = (snap && snap.ClicksByPromoter) || {};
        const pts = Object.keys(promoters)
            .filter(n => (clicks[n] || 0) >= 20 && n.indexOf('@') < 0)
            .map(n => ({ n, leads: Number(promoters[n]) || 0, conv: (Number(promoters[n]) || 0) / clicks[n] * 100 }))
            .filter(p => p.leads > 0);
        if (pts.length < 4) { this.clearChart('chart_ambassador_scatter', 'Not enough ambassadors with ≥20 referral clicks to plot quality vs volume yet.'); return; }
        const median = arr => { const s = arr.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
        const medLeads = median(pts.map(p => p.leads));
        const medConv = median(pts.map(p => p.conv));
        const colorFor = p => {
            // Strict > on the tie-prone integer leads axis (many ambassadors share low
            // lead counts) so points at the median fall to "lower volume" and the
            // lower-volume quadrants actually populate; conversion is ~continuous so >= is fine.
            const hiV = p.leads > medLeads, hiQ = p.conv >= medConv;
            if (hiV && hiQ) return '#3FB984';   // high volume + high quality (stars)
            if (hiV && !hiQ) return '#4389C8';  // high volume, lower quality
            if (!hiV && hiQ) return '#E28743';  // lower volume, high quality (efficient)
            return '#94A3B8';                   // lower volume, lower quality
        };
        const dt = new google.visualization.DataTable();
        dt.addColumn('number', 'Leads');
        dt.addColumn('number', 'Conversion %');
        dt.addColumn({ type: 'string', role: 'style' });
        dt.addColumn({ type: 'string', role: 'tooltip' });
        pts.forEach(p => dt.addRow([p.leads, p.conv, 'point { fill-color: ' + colorFor(p) + '; }',
            p.n + '  —  ' + (window.App ? App.formatNumber(p.leads) : p.leads) + ' leads · ' + p.conv.toFixed(1) + '% conversion']));
        const opts = {
            height: 380,
            chartArea: { width: '80%', height: '76%', left: 60, top: 15 },
            hAxis: { title: 'Leads (volume)', textStyle: { color: '#64748b', fontSize: 11 }, titleTextStyle: { color: '#94a3b8', italic: false, fontSize: 11 }, gridlines: { color: '#f1f5f9' }, viewWindow: { min: 0 }, baselineColor: '#e2e8f0' },
            vAxis: { title: 'Conversion % (quality)', textStyle: { color: '#64748b', fontSize: 11 }, titleTextStyle: { color: '#94a3b8', italic: false, fontSize: 11 }, gridlines: { color: '#f1f5f9' }, viewWindow: { min: 0 }, baselineColor: '#e2e8f0' },
            legend: { position: 'none' },
            backgroundColor: 'transparent',
            pointSize: 7,
            dataOpacity: 0.85,
            animation: { startup: false, duration: 0 },
        };
        new google.visualization.ScatterChart(el).draw(dt, opts);
        this._registerChart('chart_ambassador_scatter', 'ScatterChart', dt, opts);
    }
};