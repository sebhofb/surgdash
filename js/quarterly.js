// ── Quarterly tab: the core SURGhub metrics, one column per quarter ───────────────
//
// One table for reporting rounds (J&J, the GSF website, funders): each core metric per
// quarter since launch, a small trend line per row, and a switch between the values and
// the change on the previous quarter or on the same quarter a year earlier. The current
// quarter is shown greyed and "to date"; trends and changes use complete quarters.
//
// Definitions, kept identical to what gets reported (Seb, Oct 2026):
//   registrations      accounts by registration day (surghub_accounts, `c`) — the 11,102 / 65,773 basis
//   enrolments         EVERY enrolment, opened or not, all courses (enrolled_date, else start_date)
//   learners           different people enrolling in the quarter
//   courses started    enrolments the learner opened (start_date)
//   certificates       every certificate issued (certificate_date)
//   certification rate certificates ÷ enrolments in the same quarter
//   survey responses   end-of-course survey submissions with a 1–5 score; average rating over them
//   forum posts        posts in course discussion spaces (forumActivity.js, shared spaces attributed)
// Counts only, computed in memory from data already on this Mac.
Object.assign(window.App, {
    _qtrOf(d) { return d.slice(0, 4) + ' Q' + Math.ceil(Number(d.slice(5, 7)) / 3); },
    _qtrNext(q) { let y = Number(q.slice(0, 4)), n = Number(q.slice(-1)) + 1; if (n > 4) { n = 1; y++; } return y + ' Q' + n; },
    _qtrEnd(q) { const y = q.slice(0, 4), n = Number(q.slice(-1)); return y + '-' + ['03-31', '06-30', '09-30', '12-31'][n - 1]; },

    // Everything the table reads, loaded once; the tab re-renders when the last one arrives.
    _qtrEnsureLoaded() {
        if (this._qtrLoading) return;
        const need = [];
        if (this._rawCompletion == null && this.ensureCompletionLoaded) need.push(this.ensureCompletionLoaded());
        if (this._accounts === undefined && this._accountsLoad) need.push(this._accountsLoad());
        if (this._rawSurveyResponses == null && this.ensureSurveyRawLoaded) need.push(this.ensureSurveyRawLoaded());
        if (this._forum === undefined && this._forumLoad) need.push(this._forumLoad());
        if (!need.length) return;
        this._qtrLoading = true;
        Promise.all(need.map(p => Promise.resolve(p).catch(() => null))).then(() => {
            this._qtrLoading = false; this._qtrCache = null;
            if (this.view === 'platform' && this._dashTabKey && this._dashTabKey() === 'quarterly' && this.rerenderDashTab) this.rerenderDashTab();
        });
    },

    quarterlyMetrics(now) {
        const today = (now || new Date()).toISOString().slice(0, 10);
        const curQ = this._qtrOf(today);
        const bump = (o, q, k, v) => { const r = o[q] || (o[q] = {}); r[k] = (r[k] || 0) + (v == null ? 1 : v); };
        const by = {};
        let first = null;
        const seen = (d) => { if (d && (!first || d < first)) first = d; };
        // registrations
        const acc = this._accounts && this._accounts.byUid ? Object.values(this._accounts.byUid) : null;
        if (acc) acc.forEach(a => { const c = String(a && a.c || ''); if (/^\d{4}-\d{2}-\d{2}$/.test(c)) { bump(by, this._qtrOf(c), 'registrations'); seen(c); } });
        // enrolments, learners, courses started, certificates
        const learnersBy = {};
        (Array.isArray(this._rawCompletion) ? this._rawCompletion : []).forEach(r => {
            if (!r) return;
            const e = String(r.enrolled_date || r.start_date || '').slice(0, 10), s = String(r.start_date || '').slice(0, 10), c = String(r.certificate_date || '').slice(0, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(e)) { const q = this._qtrOf(e); bump(by, q, 'enrolments'); seen(e); if (r.uid) (learnersBy[q] || (learnersBy[q] = new Set())).add(r.uid); }
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) bump(by, this._qtrOf(s), 'started');
            if (/^\d{4}-\d{2}-\d{2}$/.test(c)) bump(by, this._qtrOf(c), 'certificates');
        });
        Object.keys(learnersBy).forEach(q => { (by[q] || (by[q] = {})).learners = learnersBy[q].size; });
        // survey: the Compare tab's reader (columns found by heading), scored answers only
        (this._cmpSurveyRows ? (this._cmpSurveyRows(this._rawSurveyResponses) || []) : []).forEach(x => {
            if (x.score == null) return;
            const q = this._qtrOf(x.iso); bump(by, q, 'survey'); bump(by, q, 'scoreSum', x.score);
        });
        // forum (course spaces, via the Forum tab's overview so the attribution rules match)
        const fo = this.forumOverview ? this.forumOverview(now) : null;
        if (fo) {
            const withPosts = {};
            fo.courses.forEach(c => {
                const a = this._forum.byCourse[c.id];
                Object.entries((a && a.months) || {}).forEach(([m, v]) => { if (!v || !v.posts) return; const q = this._qtrOf(m + '-01'); bump(by, q, 'posts', v.posts); (withPosts[q] || (withPosts[q] = new Set())).add(c.id); });
            });
            Object.keys(withPosts).forEach(q => { by[q].discussion = withPosts[q].size; });
        }
        if (!first) return null;
        // quarters from the first one with data to the current one
        const quarters = [];
        for (let q = this._qtrOf(first), g = 0; g < 80; q = this._qtrNext(q), g++) { quarters.push(q); if (q === curQ) break; }
        let regRun = 0, certRun = 0;
        const col = quarters.map(q => {
            const b = by[q] || {};
            regRun += b.registrations || 0; certRun += b.certificates || 0;
            return { q, partial: q === curQ, end: q === curQ ? today : this._qtrEnd(q), registrations: acc ? (b.registrations || 0) : null, registeredTotal: acc ? regRun : null,
                enrolments: b.enrolments || 0, learners: b.learners || 0, started: b.started || 0, certificates: b.certificates || 0, certificatesTotal: certRun,
                certRate: b.enrolments ? (b.certificates || 0) / b.enrolments * 100 : null,
                survey: b.survey || 0, rating: b.survey ? b.scoreSum / b.survey : null,
                posts: fo ? (b.posts || 0) : null, discussion: fo ? (b.discussion || 0) : null };
        });
        const ROWS = [
            ['registrations', 'New registrations', 'flow'], ['registeredTotal', 'Registered learners (end of quarter)', 'stock'],
            ['enrolments', 'Course enrolments', 'flow'], ['learners', 'Learners enrolling', 'flow'], ['started', 'Courses started', 'flow'],
            ['certificates', 'Certificates issued', 'flow'], ['certificatesTotal', 'Certificates to date', 'stock'], ['certRate', 'Certification rate', 'pct'],
            ['survey', 'Survey responses', 'flow'], ['rating', 'Average rating', 'score'], ['posts', 'Forum posts', 'flow'], ['discussion', 'Courses with discussion', 'flow'],
        ];
        const rows = ROWS.filter(([k]) => col.some(c => c[k] != null)).map(([key, label, kind]) => ({ key, label, kind, values: col.map(c => c[key]) }));
        return { quarters: col.map(c => c.q), partial: col.map(c => c.partial), today, rows };
    },

    setQtrOpt(k, v) { this[k] = v; if (this.rerenderDashTab) this.rerenderDashTab(); },

    _qtrFmt(kind, v) {
        if (v == null) return '–';
        if (kind === 'pct') return v.toFixed(1) + '%';
        if (kind === 'score') return v.toFixed(2);
        return this.formatNumber(Math.round(v));
    },
    // Change on a base quarter: % for counts, points for a rate or a score.
    _qtrChange(kind, v, base) {
        if (v == null || base == null) return null;
        const sgn = (d, dp) => (Math.abs(d) < 0.5 * Math.pow(10, -dp) ? '' : d > 0 ? '+' : '−');
        if (kind === 'pct') return { d: v - base, txt: sgn(v - base, 1) + Math.abs(v - base).toFixed(1) + ' pts' };
        if (kind === 'score') return { d: v - base, txt: sgn(v - base, 2) + Math.abs(v - base).toFixed(2) };
        if (!base) return v > 0 ? { d: 1, txt: 'new' } : null;
        const p = (v / base - 1) * 100;
        if (p >= 1000) return { d: p, txt: '×' + (v / base).toFixed(0) };   // ten times or more: the ratio
        return { d: p, txt: (Math.round(p) > 0 ? '+' : Math.round(p) < 0 ? '−' : '') + Math.abs(p).toFixed(0) + '%' };
    },
    // A small line over the complete quarters shown; colour from the last one against the one before.
    _qtrSpark(values, kind) {
        const vals = values.map(v => (v == null ? null : Number(v)));
        const pts = vals.filter(v => v != null);
        if (pts.length < 2) return '<span class="text-slate-300 text-xs">–</span>';
        const w = 96, h = 26, pad = 2.5, max = Math.max(...pts), min = kind === 'flow' || kind === 'stock' ? 0 : Math.min(...pts);
        const n = vals.length, x = (i) => (pad + (n > 1 ? i / (n - 1) : 0) * (w - pad * 2)).toFixed(1);
        const y = (v) => (h - pad - (max > min ? (v - min) / (max - min) : 0.5) * (h - pad * 2)).toFixed(1);
        const line = vals.map((v, i) => (v == null ? null : x(i) + ',' + y(v))).filter(Boolean).join(' ');
        const last = pts[pts.length - 1], prev = pts[pts.length - 2];
        const ch = this._qtrChange(kind, last, prev);
        const up = ch && ch.d > (kind === 'flow' || kind === 'stock' ? 5 : 0.0001), down = ch && ch.d < (kind === 'flow' || kind === 'stock' ? -5 : -0.0001);
        const color = up ? '#059669' : down ? '#e11d48' : '#64748b';
        const li = vals.map((v, i) => (v == null ? -1 : i)).filter(i => i >= 0).pop();
        return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="display:block;overflow:visible"><polyline points="' + line + '" fill="none" stroke="' + color + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>'
            + '<circle cx="' + x(li) + '" cy="' + y(vals[li]) + '" r="2.2" fill="' + color + '"/></svg>';
    },

    _dashQuarterlyHtml() {
        this._qtrEnsureLoaded();
        const esc = (t) => this.escapeHtml(String(t == null ? '' : t));
        const Q = this.quarterlyMetrics();
        if (!Q) return '<div class="bg-white p-6 rounded-xl shadow-sm border"><h3 class="text-lg font-bold text-gsf-prussian mb-1">Quarterly metrics</h3><p class="text-sm text-slate-400">' + (this._qtrLoading ? 'Loading the learner records…' : 'No learner records yet: run the enrolment sync (Data Sync, card 2).') + '</p></div>';
        const mode = ['values', 'qoq', 'yoy'].includes(this.qtrMode) ? this.qtrMode : 'values';
        const range = this.qtrRange === 'all' ? 'all' : 8;
        const all = Q.quarters.length, from = range === 'all' ? 0 : Math.max(0, all - (range + 1));   // +1: the current quarter
        const idx = []; for (let i = from; i < all; i++) idx.push(i);
        const btn = (k, v, l) => '<button onclick="App.setQtrOpt(\'' + k + '\', \'' + v + '\')" class="px-3 py-1.5 text-xs font-bold rounded-md ' + (String(this[k] || (k === 'qtrMode' ? 'values' : '8')) === String(v) ? 'bg-gsf-prussian text-white' : 'text-slate-600 hover:bg-slate-100') + '">' + l + '</button>';
        const controls = '<div class="flex items-center gap-3 flex-wrap mb-4">'
            + '<div class="inline-flex bg-white border rounded-lg p-0.5">' + btn('qtrMode', 'values', 'Values') + btn('qtrMode', 'qoq', '% vs previous quarter') + btn('qtrMode', 'yoy', '% vs a year earlier') + '</div>'
            + '<div class="inline-flex bg-white border rounded-lg p-0.5">' + btn('qtrRange', '8', 'Last 8 quarters') + btn('qtrRange', 'all', 'All since launch') + '</div>'
            + '<button onclick="App.exportQuarterlyXlsx()" class="ml-auto flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-bold text-slate-600 hover:text-gsf-boston hover:bg-white"><i data-lucide="download" width="13"></i> Excel</button></div>';
        const head = '<tr><th class="py-2 px-3 text-left font-medium sticky left-0 bg-white">Metric</th><th class="py-2 px-3 text-left font-medium">Trend</th>'
            + idx.map(i => '<th class="py-2 px-3 text-right font-medium whitespace-nowrap ' + (Q.partial[i] ? 'text-slate-300' : '') + '">' + esc(Q.quarters[i]) + (Q.partial[i] ? '<div class="text-[9px] font-normal">to ' + esc(new Date(Q.today).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })) + '</div>' : '') + '</th>').join('') + '</tr>';
        const body = Q.rows.map(r => {
            const complete = idx.filter(i => !Q.partial[i]).map(i => r.values[i]);
            const cells = idx.map(i => {
                const v = r.values[i], grey = Q.partial[i];
                if (mode === 'values') return '<td class="py-2 px-3 text-right tabular-nums whitespace-nowrap ' + (grey ? 'text-slate-300' : 'text-slate-700') + '">' + this._qtrFmt(r.kind, v) + '</td>';
                // stocks are levels, not flows: a partial quarter's level vs a full one is still fair
                const bi = mode === 'qoq' ? i - 1 : i - 4;
                const ch = bi >= 0 ? this._qtrChange(r.kind, v, r.values[bi]) : null;
                const fairPartial = r.kind === 'stock' || r.kind === 'pct' || r.kind === 'score';
                const cls = !ch ? 'text-slate-300' : (grey && !fairPartial) ? 'text-slate-300 italic' : ch.d > 0 ? 'text-emerald-700 font-semibold' : ch.d < 0 ? 'text-rose-600 font-semibold' : 'text-slate-500';
                return '<td class="py-2 px-3 text-right tabular-nums whitespace-nowrap ' + cls + '" title="' + esc(this._qtrFmt(r.kind, v)) + (bi >= 0 ? ' vs ' + esc(this._qtrFmt(r.kind, r.values[bi])) + ' in ' + esc(Q.quarters[bi]) : '') + '">' + (ch ? ch.txt : '–') + '</td>';
            }).join('');
            return '<tr class="border-b last:border-0 hover:bg-slate-50"><td class="py-2 px-3 font-bold text-gsf-prussian whitespace-nowrap sticky left-0 bg-white">' + esc(r.label) + '</td><td class="py-2 px-3">' + this._qtrSpark(complete, r.kind) + '</td>' + cells + '</tr>';
        }).join('');
        return '<p class="text-sm text-slate-500 mb-4 max-w-4xl">The core SURGhub metrics per quarter, on the definitions used in reporting: every enrolment and every certificate, across all courses (private and unpublished included); registrations by registration date. The current quarter is greyed and runs to today; the trend lines and the colours use complete quarters. In the change views, rates and ratings show the difference in points.</p>'
            + controls
            + '<div class="bg-white rounded-xl border shadow-sm p-4 overflow-x-auto"><table class="w-full text-xs"><thead class="text-slate-400 border-b">' + head + '</thead><tbody>' + body + '</tbody></table></div>'
            + '<p class="text-[11px] text-slate-400 mt-3">Registrations count accounts that exist today, so earlier quarters miss the few deleted since. Forum posts are posts in course discussion spaces; replies are not reported by the platform.</p>';
    },

    async exportQuarterlyXlsx() {
        if (typeof XLSX === 'undefined') return alert('Spreadsheet library not loaded — reopen the app and try again.');
        const Q = this.quarterlyMetrics(); if (!Q) return;
        const header = ['Metric'].concat(Q.quarters.map((q, i) => q + (Q.partial[i] ? ' (to ' + Q.today + ')' : '')));
        const rows = Q.rows.map(r => [r.label].concat(r.values.map(v => (v == null ? '' : (r.kind === 'pct' || r.kind === 'score') ? Math.round(v * 100) / 100 : Math.round(v)))));
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header].concat(rows)), 'Quarterly');
        const name = 'SURGhub quarterly metrics ' + Q.today + '.xlsx';
        const p = await electronAPI.invoke('pick-save-path', name); if (!p) return;
        this._writeWorkbook(wb, p);
        this.showMsg('Saved quarterly metrics → ' + p.split('/').pop());
    },
});
