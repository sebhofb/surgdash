// ── "Worth a look" — cheap anomaly flags for the overview ─────────────────────
// Six checks, each a few milliseconds, each pointing at the tab that explains it:
//   • a data source more than 7 days behind the newest (the stale-July case);
//   • one institution dominating the latest complete month (the seha.ae case);
//   • a KPI more than 2σ from its trailing-12-month mean (registrations, courses
//     started, certificates) — spikes are "info", drops are "warn";
//   • a complete month with courses started but no certificates, or vice versa
//     (a sync gap, not real behaviour);
//   • one country suddenly dominating new sign-ups;
//   • registrations in the latest complete month under half the prior 3-month mean.
// Only sources already in memory are used — the overview never triggers the
// 40 MB completion load; those checks simply appear once the blob is present.
Object.assign(window.App, {
    ANOM_SIGMA: 2,
    ANOM_MIN_HISTORY: 6,

    _anomYm(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); },
    _anomLatestComplete() { const d = new Date(); return this._anomYm(new Date(d.getFullYear(), d.getMonth() - 1, 1)); },
    _anomLabel(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }); },
    _anomPrevMonths(ym, k) { const out = []; const [y, m] = ym.split('-').map(Number); for (let i = 1; i <= k; i++) { const d = new Date(y, m - 1 - i, 1); out.push(this._anomYm(d)); } return out.reverse(); },

    // Monthly series {month: n}. 'registrations' from the audience snapshot; the
    // other two from the completion blob, memoised on its identity.
    _anomMonthly(kind) {
        if (kind === 'registrations') {
            const aud = (this.userHistory || []).find(d => d.Timestamp === this.selectedDate)
                || (this.userHistory || []).slice().reduce((a, b) => (a && String(a.Timestamp) > String(b.Timestamp) ? a : b), null);
            if (!aud || !aud.Signups) return null;
            let s = aud.Signups; if (typeof s === 'string') { try { s = JSON.parse(s); } catch (e) { return null; } }
            const out = {}; Object.entries(s).forEach(([m, v]) => { if (/^\d{4}-\d{2}$/.test(m)) out[m] = Number(v) || 0; });
            return out;
        }
        const rows = this._rawCompletion; if (!Array.isArray(rows) || !rows.length) return null;
        if (!this._anomCompCache || this._anomCompSrc !== rows) {
            const started = {}, certs = {};
            for (const r of rows) {
                if (r.start_date) { const m = String(r.start_date).slice(0, 7); started[m] = (started[m] || 0) + 1; }
                if (r.certificate && r.certificate_date) { const m = String(r.certificate_date).slice(0, 7); certs[m] = (certs[m] || 0) + 1; }
            }
            this._anomCompCache = { started, certs }; this._anomCompSrc = rows;
        }
        return this._anomCompCache[kind] || null;
    },

    _anomZ(series, month) {
        const hist = this._anomPrevMonths(month, 12).map(m => series[m]).filter(v => typeof v === 'number');
        if (hist.length < this.ANOM_MIN_HISTORY) return null;
        const mean = hist.reduce((s, v) => s + v, 0) / hist.length;
        const sd = Math.sqrt(hist.reduce((s, v) => s + (v - mean) ** 2, 0) / hist.length);
        const value = series[month];
        if (typeof value !== 'number' || sd === 0) return null;
        return { z: (value - mean) / sd, mean, sd, value, n: hist.length };
    },

    _anomalyFlags() {
        const L = this._anomLatestComplete();
        const key = L + '|' + (this._rawCompletion ? this._rawCompletion.length : 0) + '|' + (this._rawAnonymizedUsers ? this._rawAnonymizedUsers.length : 0) + '|' + ((this.userHistory || []).length);
        if (this._anomCache && this._anomCacheKey === key) return this._anomCache;
        const flags = [];
        const fmt = (n) => this.formatNumber(Math.round(n));
        const go = (tab) => `App._dashTab='${tab}'; App.renderView()`;

        // 1. Stale source
        try {
            const log = this._syncRunLog ? (this._syncRunLog() || {}) : {};
            const SRC = { courses: 'courses & providers', learners: 'accounts & demographics', progress: 'enrolments & certificates (card 2 upload)', surveys: 'ratings & feedback' };
            const rows = Object.entries(SRC).map(([k, l]) => ({ k, l, t: log[k] ? Date.parse(log[k]) : NaN })).filter(r => !isNaN(r.t));
            if (rows.length) {
                const newest = Math.max(...rows.map(r => r.t));
                rows.forEach(r => { const days = Math.round((newest - r.t) / 86400000); if (days > 7) flags.push({ sev: 'warn', icon: 'clock', text: `${r.l} is ${days} days behind the newest source — charts built on it stop at ${new Date(r.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.`, action: "App.navigate ? App.navigate('upload') : (App.view='upload', App.renderView())", cta: 'Data Sync' }); });
            }
        } catch (e) { __swallowed(e, 'anomalies.stale'); }

        // 2. Institution dominance in the latest complete month
        try {
            if (this._rawCompletion && this.institutionDominance) {
                const th = Number(this.instThreshold) || 15;
                this.institutionDominance(th).filter(f => f.month === L).forEach(f => flags.push({ sev: 'warn', icon: 'building-2',
                    text: `${f.domain} accounted for ${f.share.toFixed(0)}% of ${this._anomLabel(L)} ${f.metric === 'certs' ? 'certificates' : 'courses started'} (${fmt(f.n)} of ${fmt(f.total)}) — one rollout, not platform momentum.`, action: go('institutions'), cta: 'Institutions' }));
            }
        } catch (e) { __swallowed(e, 'anomalies.dominance'); }

        // 3. 2σ moves
        try {
            [['registrations', 'New registrations', 'learners'], ['started', 'Courses started', 'performance'], ['certs', 'Certificates', 'performance']].forEach(([kind, label, tab]) => {
                const s = this._anomMonthly(kind); if (!s) return;
                const z = this._anomZ(s, L); if (!z || Math.abs(z.z) < this.ANOM_SIGMA) return;
                flags.push({ sev: z.z < 0 ? 'warn' : 'info', icon: z.z < 0 ? 'trending-down' : 'trending-up',
                    text: `${label} in ${this._anomLabel(L)}: ${fmt(z.value)} — ${Math.abs(z.z).toFixed(1)}σ ${z.z < 0 ? 'below' : 'above'} the trailing-${z.n}-month mean of ${fmt(z.mean)}.`, action: go(tab), cta: tab === 'learners' ? 'Learners' : 'Performance' });
            });
        } catch (e) { __swallowed(e, 'anomalies.sigma'); }

        // 4. Sync gap: started without certificates or certificates without starts
        try {
            const st = this._anomMonthly('started'), ce = this._anomMonthly('certs');
            if (st && ce) {
                this._anomPrevMonths(L, 11).concat([L]).forEach(m => {
                    const a = st[m] || 0, c = ce[m] || 0;
                    if ((a >= 50 && c === 0) || (c >= 50 && a === 0)) flags.push({ sev: 'warn', icon: 'alert-triangle', text: `${this._anomLabel(m)} has ${fmt(a)} courses started but ${fmt(c)} certificates — looks like a sync gap rather than behaviour.`, action: go('health'), cta: 'Data Health' });
                });
            }
        } catch (e) { __swallowed(e, 'anomalies.gap'); }

        // 5. Country dominance among new sign-ups
        try {
            const anon = this._rawAnonymizedUsers;
            if (Array.isArray(anon) && anon.length) {
                if (!this._anomAnonCache || this._anomAnonSrc !== anon) {
                    const byMonth = {}; const seen = new Set();
                    for (const r of anon) { if (!r.user_uid || seen.has(r.user_uid)) continue; seen.add(r.user_uid); const m = r.signup_month; if (!m) continue; const b = byMonth[m] || (byMonth[m] = { n: 0, c: {} }); b.n++; if (r.country) b.c[r.country] = (b.c[r.country] || 0) + 1; }
                    this._anomAnonCache = byMonth; this._anomAnonSrc = anon;
                }
                const bm = this._anomAnonCache, cur = bm[L];
                if (cur && cur.n >= 200) {
                    const top = Object.entries(cur.c).sort((x, y) => y[1] - x[1])[0];
                    if (top) {
                        const share = top[1] / cur.n * 100;
                        const prev = this._anomPrevMonths(L, 12).map(m => bm[m]).filter(Boolean);
                        const prevShare = prev.length ? prev.reduce((s, b) => s + ((b.c[top[0]] || 0) / b.n * 100), 0) / prev.length : 0;
                        if (share >= 15 && prevShare > 0 && share >= 2 * prevShare) flags.push({ sev: 'info', icon: 'globe', text: `${top[0]} was ${share.toFixed(0)}% of ${this._anomLabel(L)} sign-ups, against ${prevShare.toFixed(0)}% over the prior year — check for a cohort.`, action: go('geography'), cta: 'Geography' });
                    }
                }
            }
        } catch (e) { __swallowed(e, 'anomalies.country'); }

        // 6. Registrations collapse
        try {
            const s = this._anomMonthly('registrations');
            if (s && typeof s[L] === 'number') {
                const prev = this._anomPrevMonths(L, 3).map(m => s[m]).filter(v => typeof v === 'number');
                if (prev.length === 3) { const mean = prev.reduce((a, b) => a + b, 0) / 3; if (mean >= 100 && s[L] < mean * 0.5) flags.push({ sev: 'warn', icon: 'user-x', text: `Only ${fmt(s[L])} registrations in ${this._anomLabel(L)}, under half the prior 3-month average of ${fmt(mean)} — check the sign-up flow.`, action: go('learners'), cta: 'Learners' }); }
            }
        } catch (e) { __swallowed(e, 'anomalies.dip'); }

        const order = { warn: 0, info: 1 };
        flags.sort((a, b) => order[a.sev] - order[b.sev]);
        this._anomCache = flags; this._anomCacheKey = key;
        return flags;
    },

    _anomalyStripHtml() {
        let flags = [];
        try { flags = this._anomalyFlags(); } catch (e) { __swallowed(e, 'anomalies'); return ''; }
        if (!flags.length) return '';
        const esc = (t) => this.escapeHtml(t);
        const warn = flags.filter(f => f.sev === 'warn').length;
        const collapsed = !!this.anomalyCollapsed;
        return `
            <div class="rounded-xl border ${warn ? 'border-amber-200 bg-amber-50' : 'border-sky-200 bg-sky-50'} px-4 py-3 mb-6">
                <div class="flex items-center justify-between gap-3">
                    <p class="text-[10px] font-bold uppercase tracking-wide ${warn ? 'text-amber-700' : 'text-sky-700'} flex items-center gap-1.5"><i data-lucide="eye" width="11"></i> Worth a look · ${flags.length}${warn ? ' · ' + warn + ' need attention' : ''}</p>
                    <button data-viewer-allowed onclick="App.anomalyCollapsed=!App.anomalyCollapsed; App.renderView()" class="text-[11px] ${warn ? 'text-amber-700' : 'text-sky-700'} hover:underline">${collapsed ? 'Show' : 'Hide'}</button>
                </div>
                ${collapsed ? '' : `<ul class="mt-2 space-y-1.5">${flags.map(f => `<li class="flex items-start justify-between gap-3 text-sm ${f.sev === 'warn' ? 'text-amber-900' : 'text-sky-900'}">
                    <span class="flex items-start gap-2"><i data-lucide="${f.icon}" width="14" class="shrink-0 mt-0.5 ${f.sev === 'warn' ? 'text-amber-600' : 'text-sky-600'}"></i><span>${esc(f.text)}</span></span>
                    <button data-viewer-allowed onclick="${f.action}" class="shrink-0 text-[11px] font-bold ${f.sev === 'warn' ? 'text-amber-700' : 'text-sky-700'} hover:underline whitespace-nowrap">${esc(f.cta)} &rarr;</button></li>`).join('')}</ul>`}
            </div>`;
    },
});
