// ── Compare periods ───────────────────────────────────────────────────────────
// Two month-aligned periods, side by side: activity (flow), quality, reach shares,
// and the platform as it stood at each period's end (stock), with per-day rates
// and a true cohort completion rate. Optionally restrict the completion-based
// metrics to one institution (email domain) or exclude it — so a rollout can be
// quoted with and without.
//
// Sources: registrations from the audience snapshot's SignupsDaily; courses
// started / certificates / learners / hours from the completion records
// (surghub_completion, lazy); survey volume and mean rating from the raw survey
// store (surghub_survey_raw, lazy); reach shares from the anonymised learner
// records by signup month (surghub_anon_users, lazy). Registrations, survey and
// reach carry no email, so the institution filter applies to completion metrics
// only — the table says so wherever that matters.
Object.assign(window.App, {

    CMP_PRESETS: [
        ['last12', 'Last 12 complete months vs the 12 before'],
        ['fy',     'July–June years (latest two complete)'],
        ['cal',    'Calendar years (latest two complete)'],
        ['custom', 'Custom months'],
    ],

    _cmpYm(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); },
    _cmpAddMonths(ym, k) { const [y, m] = ym.split('-').map(Number); return this._cmpYm(new Date(y, m - 1 + k, 1)); },
    _cmpLastCompleteMonth() { const d = new Date(); return this._cmpYm(new Date(d.getFullYear(), d.getMonth() - 1, 1)); },
    _cmpMonthsIn(r) { const out = []; let m = r.start; while (m <= r.end && out.length < 600) { out.push(m); m = this._cmpAddMonths(m, 1); } return out; },
    _cmpDaysIn(r) {
        const [y1, m1] = r.start.split('-').map(Number), [y2, m2] = r.end.split('-').map(Number);
        return Math.round((new Date(y2, m2, 1) - new Date(y1, m1 - 1, 1)) / 86400000);
    },
    _cmpEndDate(r) { const [y, m] = r.end.split('-').map(Number); return this._cmpYm(new Date(y, m - 1, 1)) + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0'); },
    _cmpStartDate(r) { return r.start + '-01'; },
    _cmpLabel(r) { const f = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }); }; return r.start === r.end ? f(r.start) : f(r.start) + ' – ' + f(r.end); },

    // Period A (later) and Period B (earlier) as {start, end} months.
    _cmpRanges() {
        const preset = this.cmpPreset || 'last12';
        const last = this._cmpLastCompleteMonth();
        const yr = Number(last.slice(0, 4)), mo = Number(last.slice(5, 7));
        let A, B;
        if (preset === 'fy') {
            // latest complete Jul–Jun year: ends in June of yr if mo ≥ 6, else June of yr-1
            const endY = mo >= 6 ? yr : yr - 1;
            A = { start: (endY - 1) + '-07', end: endY + '-06' };
            B = { start: (endY - 2) + '-07', end: (endY - 1) + '-06' };
        } else if (preset === 'cal') {
            const endY = mo === 12 ? yr : yr - 1;
            A = { start: endY + '-01', end: endY + '-12' };
            B = { start: (endY - 1) + '-01', end: (endY - 1) + '-12' };
        } else if (preset === 'custom' && /^\d{4}-\d{2}$/.test(this.cmpAStart || '') && /^\d{4}-\d{2}$/.test(this.cmpAEnd || '')) {
            A = { start: this.cmpAStart <= this.cmpAEnd ? this.cmpAStart : this.cmpAEnd, end: this.cmpAStart <= this.cmpAEnd ? this.cmpAEnd : this.cmpAStart };
            const len = this._cmpMonthsIn(A).length;
            if (/^\d{4}-\d{2}$/.test(this.cmpBStart || '') && /^\d{4}-\d{2}$/.test(this.cmpBEnd || '')) {
                B = { start: this.cmpBStart <= this.cmpBEnd ? this.cmpBStart : this.cmpBEnd, end: this.cmpBStart <= this.cmpBEnd ? this.cmpBEnd : this.cmpBStart };
            } else {
                B = { start: this._cmpAddMonths(A.start, -len), end: this._cmpAddMonths(A.start, -1) };
            }
        } else {
            A = { start: this._cmpAddMonths(last, -11), end: last };
            B = { start: this._cmpAddMonths(last, -23), end: this._cmpAddMonths(last, -12) };
        }
        return { A, B, preset };
    },

    _cmpAudSnap() {
        return (this.userHistory || []).find(d => d.Timestamp === this.selectedDate)
            || (this.userHistory || []).slice().reduce((a, b) => (a && String(a.Timestamp) > String(b.Timestamp) ? a : b), null);
    },
    _cmpParse(v) { if (!v) return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return null; } } return v; },

    // Survey rows → [{iso, score}] once, memoised on the raw store object.
    _cmpSurveyRows() {
        const raw = this._surveyRawMap; if (!raw) return null;
        if (this._cmpSurveyCache && this._cmpSurveySrc === raw) return this._cmpSurveyCache;
        const M = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
        const out = [];
        Object.values(raw).forEach(v => {
            if (!v || !Array.isArray(v.data)) return;
            v.data.forEach(r => {
                const m = String(r[3] || '').match(/^(\d{1,2}) (\w{3}) (\d{4})/); if (!m || !M[m[2]]) return;
                const sc = parseFloat(r[4]);
                out.push({ iso: m[3] + '-' + M[m[2]] + '-' + String(m[1]).padStart(2, '0'), score: (sc >= 1 && sc <= 5) ? sc : null });
            });
        });
        this._cmpSurveyCache = out; this._cmpSurveySrc = raw;
        return out;
    },

    _cmpAnonUsers() {
        const rows = this._rawAnonymizedUsers; if (!Array.isArray(rows) || !rows.length) return null;
        if (this._cmpAnonCache && this._cmpAnonSrc === rows) return this._cmpAnonCache;
        const u = {};
        rows.forEach(r => { if (r.user_uid && !u[r.user_uid]) u[r.user_uid] = { m: r.signup_month || '', c: r.country || '', p: r.profession || '', g: r.gender || '' }; });
        this._cmpAnonCache = Object.values(u); this._cmpAnonSrc = rows;
        return this._cmpAnonCache;
    },

    _cmpCohortFilter() {
        const mode = this.cmpCohortMode || 'all', dom = String(this.cmpCohortDomain || '').toLowerCase();
        if (mode === 'all' || !dom || !this._instDomain) return null;
        return { mode, dom, test: (email) => (this._instDomain(email) === dom) === (mode === 'only') };
    },

    // Metrics for one range. `filter` restricts completion rows (only/exclude a domain).
    _cmpMetrics(r, filter) {
        const startD = this._cmpStartDate(r), endD = this._cmpEndDate(r), days = this._cmpDaysIn(r);
        const out = { range: r, label: this._cmpLabel(r), days, startD, endD, ready: {} };
        // Registrations (SignupsDaily)
        const aud = this._cmpAudSnap();
        const daily = aud ? this._cmpParse(aud.SignupsDaily) : null;
        if (daily) {
            let n = 0, cum = 0;
            for (const [d, v] of Object.entries(daily)) { const x = Number(v) || 0; if (d <= endD) { cum += x; if (d >= startD) n += x; } }
            out.registrations = n; out.stockRegistrations = cum; out.ready.registrations = true;
            out.dataThroughRegistrations = Object.keys(daily).sort().pop();
        }
        // Completion-based
        const rows = this._rawCompletion;
        if (Array.isArray(rows) && rows.length) {
            let started = 0, certs = 0, minutes = 0, cohortStarted = 0, cohortCompleted = 0, stockStarted = 0, stockCerts = 0;
            const learners = new Set(), stockLearners = new Set();
            let maxDate = '';
            for (const row of rows) {
                if (filter && !filter.test(row.email)) continue;
                const s = row.start_date ? String(row.start_date).slice(0, 10) : '';
                const c = (row.certificate && row.certificate_date) ? String(row.certificate_date).slice(0, 10) : '';
                const uid = row.uid || String(row.email || '').toLowerCase();
                if (s) {
                    if (s > maxDate) maxDate = s;
                    if (s <= endD) { stockStarted++; if (uid) stockLearners.add(uid); }
                    if (s >= startD && s <= endD) {
                        started++; minutes += Number(row.time_minutes) || 0; if (uid) learners.add(uid);
                        cohortStarted++; if (row.certificate) cohortCompleted++;
                    }
                }
                if (c) { if (c > maxDate) maxDate = c; if (c <= endD) stockCerts++; if (c >= startD && c <= endD) certs++; }
            }
            Object.assign(out, { coursesStarted: started, certificates: certs, learners: learners.size, hours: Math.round(minutes / 60),
                certPerStart: started ? certs / started * 100 : 0, cohortCompletion: cohortStarted ? cohortCompleted / cohortStarted * 100 : 0,
                stockStarted, stockCerts, stockLearners: stockLearners.size, dataThroughCompletion: maxDate });
            out.ready.completion = true;
        }
        // Survey
        const sv = this._cmpSurveyRows();
        if (sv) {
            // "Responses" = submissions carrying a 1–5 satisfaction score (the same
            // population the mean is taken over, and the figure quoted in reports);
            // submissions without a score are kept separately.
            let n = 0, sum = 0, k = 0, five = 0;
            for (const x of sv) { if (x.iso >= startD && x.iso <= endD) { n++; if (x.score != null) { sum += x.score; k++; if (x.score === 5) five++; } } }
            out.surveySubmissions = n; out.surveyN = k; out.surveyMean = k ? sum / k : null; out.surveyFive = k ? five / k * 100 : null; out.ready.survey = true;
        }
        // Reach (anon, by signup month)
        const anon = this._cmpAnonUsers();
        if (anon) {
            const IC = window.IncomeClassification;
            const cmap = this._conflictMatchMap ? this._conflictMatchMap() : null;
            const cohort = anon.filter(x => x.m && x.m >= r.start && x.m <= r.end);
            const n = cohort.length || 1;
            const sh = (f) => cohort.filter(f).length / n * 100;
            const tier = (c) => IC ? IC.classify(c) : 'Unknown';
            out.reach = {
                cohort: cohort.length,
                lic: sh(x => tier(x.c) === 'LIC'), licLmic: sh(x => ['LIC', 'LMIC'].includes(tier(x.c))), umic: sh(x => tier(x.c) === 'UMIC'), hic: sh(x => tier(x.c) === 'HIC'),
                unknownCountry: sh(x => !x.c),
                lancet: IC && IC.isLancetPriority ? sh(x => IC.isLancetPriority(x.c)) : null,
                conflict: cmap ? sh(x => !!(x.c && cmap.get(this._conflictNorm(x.c)))) : null,
                nursing: sh(x => /nurse|nursing/i.test(x.p)), surgeon: sh(x => x.p === 'surgeon'), anaesthesia: sh(x => /anaesthes|anesthes/i.test(x.p)),
                female: sh(x => x.g === 'Female'),
            };
            out.ready.reach = true;
        }
        out.perDay = { registrations: out.registrations != null ? out.registrations / days : null, coursesStarted: out.coursesStarted != null ? out.coursesStarted / days : null, certificates: out.certificates != null ? out.certificates / days : null };
        return out;
    },

    compareCompute() {
        const { A, B, preset } = this._cmpRanges();
        const filter = this._cmpCohortFilter();
        return { A: this._cmpMetrics(A, filter), B: this._cmpMetrics(B, filter), preset, filter };
    },

    setCmpOpt(k, v) { this[k] = v; if (k === 'cmpCohortMode' && v === 'all') this.cmpCohortDomain = ''; this.renderView(); },

    _drawCompareCharts() {
        if (!(window.google && google.visualization && google.visualization.ColumnChart)) return;
        const el = document.getElementById('chart_cmp_flow'); if (!el) return;
        const c = this.compareCompute();
        const rows = [['Registrations', c.B.registrations, c.A.registrations], ['Courses started', c.B.coursesStarted, c.A.coursesStarted],
            ['Certificates', c.B.certificates, c.A.certificates], ['Survey responses', c.B.surveyN, c.A.surveyN]].filter(r => r[1] != null && r[2] != null);
        if (!rows.length) return;
        const dt = new google.visualization.DataTable();
        dt.addColumn('string', 'Metric'); dt.addColumn('number', c.B.label); dt.addColumn('number', c.A.label);
        rows.forEach(r => dt.addRow(r));
        const opts = { colors: ['#94a3b8', '#206095'], legend: { position: 'top', textStyle: { fontSize: 11 } }, chartArea: { left: 60, right: 15, top: 40, bottom: 40, height: '65%' },
            vAxis: { textStyle: { color: '#94a3b8', fontSize: 11 }, gridlines: { color: '#f1f5f9', count: 5 }, viewWindow: { min: 0 }, format: 'short' },
            hAxis: { textStyle: { color: '#64748b', fontSize: 11 } }, bar: { groupWidth: '60%' }, backgroundColor: 'transparent', animation: { startup: false, duration: 0 }, tooltip: { textStyle: { fontSize: 12 } } };
        new google.visualization.ColumnChart(el).draw(dt, opts);
        if (window.Charts && Charts._registerChart) Charts._registerChart('chart_cmp_flow', 'ColumnChart', dt, opts);
    },

    _dashCompareHtml(snapData, audSnap) {
        const esc = (t) => this.escapeHtml(t);
        const fmt = (n) => (n == null ? '—' : this.formatNumber(Math.round(n)));
        const fmt1 = (n) => (n == null ? '—' : (Math.round(n * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
        const pctS = (n, d = 1) => (n == null ? '—' : (Number(n)).toFixed(d) + '%');
        // Lazy sources
        const kick = (p) => p.then(() => { if (this.view === 'platform' && this._dashTab === 'compare') this.renderView(); }).catch(() => {});
        if (this._rawCompletion == null && this.ensureCompletionLoaded && !this._completionLoadPromise) kick(this.ensureCompletionLoaded());
        if (this._rawAnonymizedUsers == null && this.ensureAnonLoaded && !this._anonLoadPromise) kick(this.ensureAnonLoaded());
        if (this._surveyRawMap === undefined) { this._surveyRawMap = null; kick(Storage.getItem('surghub_survey_raw').then(v => { this._surveyRawMap = (v && typeof v === 'object') ? v : {}; })); }

        const c = this.compareCompute();
        const { A, B } = c;
        const chg = (a, b, opts = {}) => {
            if (a == null || b == null) return '<span class="text-slate-300">—</span>';
            if (opts.pp) { const d = a - b; return `<span class="${d >= 0 ? 'text-emerald-700' : 'text-red-600'} font-semibold">${d >= 0 ? '+' : ''}${d.toFixed(1)} pp</span>`; }
            if (!b) return a ? '<span class="text-emerald-700 font-semibold">new</span>' : '—';
            const p = (a / b - 1) * 100;
            return `<span class="${p >= 0 ? 'text-emerald-700' : 'text-red-600'} font-semibold">${p >= 0 ? '+' : ''}${Math.abs(p) >= 100 ? Math.round(p) : p.toFixed(1)}%</span>`;
        };
        const mult = (a, b) => (a != null && b) ? '<span class="text-slate-400 text-xs">×' + (a / b).toFixed(2) + '</span>' : '';
        const cohortNote = c.filter ? ` <span class="text-[10px] text-slate-400 font-normal">(all learners — no email on these records)</span>` : '';

        const row = (label, b, a, fmtF, opts = {}) => `<tr class="border-b ${opts.strong ? 'bg-slate-50/60' : ''} hover:bg-slate-50">
            <td class="py-2 px-4 ${opts.strong ? 'font-bold text-gsf-prussian' : 'text-slate-700'}">${label}${opts.unfilterable && c.filter ? cohortNote : ''}${opts.hint ? `<span class="block text-[10px] text-slate-400 font-normal">${opts.hint}</span>` : ''}</td>
            <td class="py-2 px-4 text-right text-slate-500 font-mono">${fmtF(b)}</td>
            <td class="py-2 px-4 text-right font-mono ${opts.strong ? 'font-bold text-gsf-prussian' : 'text-slate-800'}">${fmtF(a)}</td>
            <td class="py-2 px-4 text-right">${chg(a, b, opts)} ${opts.pp ? '' : mult(a, b)}</td></tr>`;
        const section = (title) => `<tr><td colspan="4" class="pt-4 pb-1 px-4 text-[10px] font-bold uppercase tracking-wide text-slate-400">${title}</td></tr>`;

        const ready = (k) => A.ready[k] && B.ready[k];
        const loading = [];
        if (!ready('completion')) loading.push('per-learner records');
        if (!ready('reach')) loading.push('learner demographics');
        if (!ready('survey')) loading.push('survey responses');
        if (!ready('registrations')) loading.push('registrations (run Sync Learners)');

        const controls = `
            <div class="bg-white rounded-xl border shadow-sm p-5 mb-6">
                <div class="flex flex-wrap items-end gap-4">
                    <label class="text-xs text-slate-600"><span class="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Periods</span>
                        <select data-viewer-allowed onchange="App.setCmpOpt('cmpPreset', this.value)" class="bg-white border rounded px-2 py-1.5 text-sm text-slate-700">
                            ${this.CMP_PRESETS.map(([k, l]) => `<option value="${k}" ${c.preset === k ? 'selected' : ''}>${l}</option>`).join('')}
                        </select></label>
                    ${c.preset === 'custom' ? `
                    <div class="p-3 bg-gsf-boston/5 rounded-lg border border-gsf-boston/20"><p class="text-[10px] font-bold uppercase tracking-wide text-gsf-boston mb-1">Period A (later)</p>
                        <input type="month" data-viewer-allowed value="${esc(this.cmpAStart || A.start)}" max="${this._cmpLastCompleteMonth()}" onchange="App.setCmpOpt('cmpAStart', this.value)" class="bg-white border rounded px-2 py-1 text-xs"> <span class="text-xs text-slate-500">→</span>
                        <input type="month" data-viewer-allowed value="${esc(this.cmpAEnd || A.end)}" max="${this._cmpLastCompleteMonth()}" onchange="App.setCmpOpt('cmpAEnd', this.value)" class="bg-white border rounded px-2 py-1 text-xs"></div>
                    <div class="p-3 bg-slate-50 rounded-lg border border-slate-200"><p class="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">Period B (earlier) <span class="font-normal normal-case">— blank = same length, immediately before</span></p>
                        <input type="month" data-viewer-allowed value="${esc(this.cmpBStart || '')}" onchange="App.setCmpOpt('cmpBStart', this.value)" class="bg-white border rounded px-2 py-1 text-xs"> <span class="text-xs text-slate-500">→</span>
                        <input type="month" data-viewer-allowed value="${esc(this.cmpBEnd || '')}" onchange="App.setCmpOpt('cmpBEnd', this.value)" class="bg-white border rounded px-2 py-1 text-xs"></div>` : ''}
                    <label class="text-xs text-slate-600"><span class="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Institution filter</span>
                        <select data-viewer-allowed onchange="App.setCmpOpt('cmpCohortMode', this.value)" class="bg-white border rounded px-2 py-1.5 text-sm text-slate-700">
                            <option value="all" ${(this.cmpCohortMode || 'all') === 'all' ? 'selected' : ''}>All learners</option>
                            <option value="exclude" ${this.cmpCohortMode === 'exclude' ? 'selected' : ''}>Exclude one institution</option>
                            <option value="only" ${this.cmpCohortMode === 'only' ? 'selected' : ''}>Only one institution</option>
                        </select></label>
                    ${(this.cmpCohortMode && this.cmpCohortMode !== 'all') ? `<label class="text-xs text-slate-600"><span class="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Domain</span>
                        <select data-viewer-allowed onchange="App.setCmpOpt('cmpCohortDomain', this.value)" class="bg-white border rounded px-2 py-1.5 text-sm text-slate-700 font-mono">
                            <option value="">— choose —</option>
                            ${(this.institutionRows ? this.institutionRows().sort((x, y) => y.learners - x.learners).slice(0, 40) : []).map(r => `<option value="${esc(r.domain)}" ${this.cmpCohortDomain === r.domain ? 'selected' : ''}>${esc(r.domain)} (${fmt(r.learners)})</option>`).join('')}
                        </select></label>` : ''}
                    <button onclick="App.exportCompareXlsx()" class="ml-auto flex items-center gap-1.5 px-3 py-2 border rounded-lg text-xs font-bold text-slate-600 hover:text-gsf-boston hover:bg-slate-50"><i data-lucide="download" width="14"></i> Excel</button>
                </div>
                <p class="text-xs text-slate-500 mt-3"><strong class="text-gsf-prussian">A</strong> ${esc(A.label)} (${A.days} days) &nbsp;vs&nbsp; <strong class="text-slate-600">B</strong> ${esc(B.label)} (${B.days} days)${c.filter ? ` &nbsp;·&nbsp; completion metrics ${c.filter.mode === 'only' ? 'only for' : 'excluding'} <span class="font-mono">${esc(c.filter.dom)}</span>` : ''}${loading.length ? ` &nbsp;·&nbsp; <span class="text-amber-700">loading ${loading.join(', ')}…</span>` : ''}</p>
            </div>`;

        const table = `
            <div class="bg-white rounded-xl border shadow-sm overflow-hidden mb-6">
                <table class="w-full text-sm">
                    <thead class="text-[11px] uppercase tracking-wide text-slate-500 border-b bg-slate-50"><tr>
                        <th class="py-2 px-4 text-left">Metric</th><th class="py-2 px-4 text-right">B · ${esc(B.label)}</th><th class="py-2 px-4 text-right">A · ${esc(A.label)}</th><th class="py-2 px-4 text-right">Change</th></tr></thead>
                    <tbody>
                        ${section('Activity in the period')}
                        ${row('New registered users', B.registrations, A.registrations, fmt, { strong: true, unfilterable: true })}
                        ${row('Courses started', B.coursesStarted, A.coursesStarted, fmt, { strong: true, hint: 'enrolments where the learner opened the course' })}
                        ${row('Certificates awarded', B.certificates, A.certificates, fmt, { strong: true })}
                        ${row('Learners starting a course', B.learners, A.learners, fmt)}
                        ${row('Learning hours', B.hours, A.hours, fmt)}
                        ${row('Registrations per day', B.perDay.registrations, A.perDay.registrations, fmt1, { unfilterable: true })}
                        ${row('Courses started per day', B.perDay.coursesStarted, A.perDay.coursesStarted, fmt1)}
                        ${row('Certificates per day', B.perDay.certificates, A.perDay.certificates, fmt1)}
                        ${section('Quality')}
                        ${row('Certificates ÷ courses started', B.certPerStart, A.certPerStart, (v) => pctS(v), { pp: true, hint: 'activity ratio within the period' })}
                        ${row('Cohort completion', B.cohortCompletion, A.cohortCompletion, (v) => pctS(v), { pp: true, strong: true, hint: 'of courses started in the period, share certified by ' + (A.dataThroughCompletion || 'the data-through date') })}
                        ${row('Survey responses', B.surveyN, A.surveyN, fmt, { unfilterable: true, hint: 'responses carrying a 1–5 rating · ' + fmt(B.surveySubmissions) + ' / ' + fmt(A.surveySubmissions) + ' submissions in total' })}
                        ${row('Mean satisfaction (1–5)', B.surveyMean, A.surveyMean, (v) => v == null ? '—' : v.toFixed(2), { pp: false, unfilterable: true })}
                        ${row('Share rating 5/5', B.surveyFive, A.surveyFive, (v) => pctS(v), { pp: true, unfilterable: true })}
                        ${section('Who signed up (share of new learners' + (c.filter ? ', all learners' : '') + ')')}
                        ${A.reach && B.reach ? [
                            ['Low-income countries', 'lic'], ['Low + lower-middle income', 'licLmic'], ['High-income countries', 'hic'], ['Lancet-priority countries', 'lancet'],
                            ['Conflict-affected settings', 'conflict'], ['Nursing', 'nursing'], ['Surgeons', 'surgeon'], ['Anaesthesia', 'anaesthesia'], ['Women', 'female'], ['Country not given', 'unknownCountry'],
                        ].filter(([, k]) => A.reach[k] != null).map(([l, k]) => row(l, B.reach[k], A.reach[k], (v) => pctS(v), { pp: true })).join('')
                          : `<tr><td colspan="4" class="py-3 px-4 text-xs text-slate-400">Loading learner demographics…</td></tr>`}
                        ${A.reach && B.reach ? row('Learners in cohort', B.reach.cohort, A.reach.cohort, fmt, { hint: 'signed up in the period, with demographics' }) : ''}
                        ${section('The platform at period end (cumulative)')}
                        ${row('Registered users', B.stockRegistrations, A.stockRegistrations, fmt, { unfilterable: true })}
                        ${row('Courses ever started', B.stockStarted, A.stockStarted, fmt)}
                        ${row('Certificates ever issued', B.stockCerts, A.stockCerts, fmt, { strong: true })}
                        ${row('Learners who ever started a course', B.stockLearners, A.stockLearners, fmt)}
                        ${row('Lifetime certificates ÷ courses started', B.stockStarted ? B.stockCerts / B.stockStarted * 100 : null, A.stockStarted ? A.stockCerts / A.stockStarted * 100 : null, (v) => pctS(v), { pp: true })}
                    </tbody>
                </table>
            </div>`;

        const chart = `
            <div class="bg-white p-6 rounded-xl shadow-sm border mb-6">
                <h3 class="text-lg font-bold mb-3 flex items-center gap-2 text-gsf-prussian"><i data-lucide="bar-chart-3" class="text-gsf-boston"></i> Activity, period B vs period A ${this._chartBtns ? this._chartBtns('chart_cmp_flow', 'Compare_Periods') : ''}</h3>
                <div id="chart_cmp_flow" style="width:100%;height:340px;"></div>
            </div>`;

        const method = `
            <div class="bg-slate-50 border rounded-xl p-5 text-xs text-slate-600 space-y-1">
                <p class="font-bold text-slate-700 text-sm">How this is counted</p>
                <p>Periods are whole months. <strong>Activity</strong> counts events dated inside the period: registrations from the daily sign-up series (through ${esc(A.dataThroughRegistrations || '—')}), courses started by their start date and certificates by their issue date from the per-learner records (through ${esc(A.dataThroughCompletion || '—')}). <strong>Per day</strong> divides by the period's calendar days.</p>
                <p><strong>Certificates ÷ courses started</strong> is an activity ratio (a certificate may belong to an earlier start). <strong>Cohort completion</strong> follows the courses started in the period forward and reports the share that hold a certificate by the data-through date — the rate to publish.</p>
                <p><strong>Reach</strong> uses learners with demographics, by signup month; shares are of that cohort. Income groups follow the World Bank classification, conflict settings the World Bank FCV list, both matched by ISO code. <strong>Platform at period end</strong> is cumulative to the last day of each period.</p>
                <p>The institution filter applies to courses started, certificates, learners, hours and cohort completion — registrations, survey and reach records carry no email and are shown for all learners.</p>
            </div>`;

        return `<p class="text-sm text-slate-500 mb-6">Two periods side by side — the year-on-year view a director asks for, with the same definitions every time.</p>
            ${controls}${table}${chart}${method}`;
    },

    async exportCompareXlsx() {
        const c = this.compareCompute(); const { A, B } = c;
        const wb = XLSX.utils.book_new();
        const nice = (ws, o) => (this._niceSheet ? this._niceSheet(ws, o) : ws);
        const pct = (a, b) => (a != null && b) ? +(((a / b) - 1) * 100).toFixed(1) : '';
        const pp = (a, b) => (a != null && b != null) ? +(a - b).toFixed(1) : '';
        const r = (metric, b, a, kind) => ({ Metric: metric, ['B · ' + B.label]: b == null ? '' : (typeof b === 'number' ? +b.toFixed(kind === 'pct' ? 1 : 2) : b), ['A · ' + A.label]: a == null ? '' : (typeof a === 'number' ? +a.toFixed(kind === 'pct' ? 1 : 2) : a), Change: kind === 'pct' ? pp(a, b) : pct(a, b), Unit: kind === 'pct' ? 'percentage points' : '%' });
        const rows = [
            r('New registered users', B.registrations, A.registrations), r('Courses started', B.coursesStarted, A.coursesStarted), r('Certificates awarded', B.certificates, A.certificates),
            r('Learners starting a course', B.learners, A.learners), r('Learning hours', B.hours, A.hours),
            r('Registrations per day', B.perDay.registrations, A.perDay.registrations), r('Courses started per day', B.perDay.coursesStarted, A.perDay.coursesStarted), r('Certificates per day', B.perDay.certificates, A.perDay.certificates),
            r('Certificates ÷ courses started %', B.certPerStart, A.certPerStart, 'pct'), r('Cohort completion %', B.cohortCompletion, A.cohortCompletion, 'pct'),
            r('Survey responses (with a 1–5 rating)', B.surveyN, A.surveyN), r('Survey submissions (all)', B.surveySubmissions, A.surveySubmissions), r('Mean satisfaction (1–5)', B.surveyMean, A.surveyMean), r('Share rating 5/5 %', B.surveyFive, A.surveyFive, 'pct'),
            r('Registered users at period end', B.stockRegistrations, A.stockRegistrations), r('Courses ever started at period end', B.stockStarted, A.stockStarted),
            r('Certificates ever issued at period end', B.stockCerts, A.stockCerts), r('Learners who ever started a course', B.stockLearners, A.stockLearners),
        ];
        const about = [['SURGhub — period comparison'], ['Generated', new Date().toISOString().slice(0, 10)],
            ['Period A (later)', A.label + ' (' + A.startD + ' → ' + A.endD + ', ' + A.days + ' days)'], ['Period B (earlier)', B.label + ' (' + B.startD + ' → ' + B.endD + ', ' + B.days + ' days)'],
            ['Institution filter', c.filter ? (c.filter.mode + ' ' + c.filter.dom + ' — applies to completion-based metrics only') : 'none'],
            ['Registrations through', A.dataThroughRegistrations || ''], ['Per-learner records through', A.dataThroughCompletion || ''],
            [''], ['Definitions', 'Periods are whole months. Courses started = enrolments the learner opened, by start date. Certificates by issue date. Cohort completion = share of courses started in the period holding a certificate by the data-through date. Reach shares are of learners with demographics who signed up in the period.']];
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.aoa_to_sheet(about), { noFilter: true, widths: [{ wch: 32 }, { wch: 110 }] }), 'Summary');
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(rows)), 'Comparison');
        if (A.reach && B.reach) {
            const keys = [['Low-income countries', 'lic'], ['Low + lower-middle income', 'licLmic'], ['Upper-middle income', 'umic'], ['High-income countries', 'hic'], ['Lancet-priority countries', 'lancet'], ['Conflict-affected settings', 'conflict'], ['Nursing', 'nursing'], ['Surgeons', 'surgeon'], ['Anaesthesia', 'anaesthesia'], ['Women', 'female'], ['Country not given', 'unknownCountry']];
            XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(keys.filter(([, k]) => A.reach[k] != null).map(([l, k]) => ({ Segment: l, ['B share % · ' + B.label]: +B.reach[k].toFixed(1), ['A share % · ' + A.label]: +A.reach[k].toFixed(1), 'Change (pp)': +(A.reach[k] - B.reach[k]).toFixed(1), ['B learners']: Math.round(B.reach[k] / 100 * B.reach.cohort), ['A learners']: Math.round(A.reach[k] / 100 * A.reach.cohort) })))), 'Reach');
        }
        // Monthly detail across both periods
        const aud = this._cmpAudSnap(); const daily = aud ? this._cmpParse(aud.SignupsDaily) : null;
        const months = [...this._cmpMonthsIn(B.range), ...this._cmpMonthsIn(A.range)];
        const perMonth = {}; months.forEach(m => perMonth[m] = { Month: m, Period: m >= A.range.start ? 'A' : 'B', Registrations: 0, 'Courses started': 0, Certificates: 0 });
        if (daily) Object.entries(daily).forEach(([d, v]) => { const m = d.slice(0, 7); if (perMonth[m]) perMonth[m].Registrations += Number(v) || 0; });
        const f = c.filter;
        (this._rawCompletion || []).forEach(row => { if (f && !f.test(row.email)) return; const s = row.start_date ? String(row.start_date).slice(0, 7) : ''; const cm = (row.certificate && row.certificate_date) ? String(row.certificate_date).slice(0, 7) : ''; if (s && perMonth[s]) perMonth[s]['Courses started']++; if (cm && perMonth[cm]) perMonth[cm].Certificates++; });
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(months.map(m => perMonth[m]))), 'Monthly');
        const path = await electronAPI.invoke('pick-save-path', 'surghub_compare_' + A.range.start + '_' + A.range.end + '_vs_' + B.range.start + '_' + B.range.end + '.xlsx');
        if (!path) return;
        this._writeWorkbook(wb, path);
        this.showMsg('Saved comparison → ' + path.split('/').pop());
    },
});
