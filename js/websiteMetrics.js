// GSF website figures: six SURGhub headline totals published as metrics.json on the
// partner-reports site (https://reports.globalsurgeryfoundation.org/metrics.json), which the
// GSF website reads on page load (the site allows any origin; GitHub caches ~10 minutes).
//
// Published with every partner-dashboard publish (nightly), and on demand from the Reports
// tab (one small commit, seconds). Aggregate totals only: nothing about any learner.
// Figures (Seb, 19 Oct 2026), all with the report toggles OFF so a report setting never
// moves the website:
//   registered_learners  registered SURGhub accounts (newest learner snapshot, TotalUsers)
//   enrolments           every course enrolment, opened or not, all courses (dashboard "Enrolled Learners")
//   countries            countries & territories learners come from (KnownCountry; public 219)
//   courses              live courses: included, not private, not draft
//   certificates         every certificate issued, all courses (dashboard "Certificates")
//   content_providers    providers with at least one included course (public 34)
// Also, for the website's pop-ups (added 19 Oct 2026), from the SURGhub overall report's own
// data (toggles and filters off) — so they match that report. Like enrolments and certificates,
// they count EVERY course, private and unpublished too; only `courses` is the public catalogue:
//   overall_satisfaction_pct  share of end-of-course survey answers rating overall satisfaction 4 or 5 (1 decimal)
//   likely_to_apply_pct       the same for "it is likely that I will use the information acquired" (1 decimal)
//   satisfaction_responses    how many answered the overall-satisfaction question
//   average_rating            average course rating (the report's "Avg Rating"), 2 decimals
//   study_minutes / study_years   recorded learning time, all courses (years = minutes / 525,960, 1 decimal)
//   certification_rate_pct    certificates ÷ enrolments in this same file, 1 decimal
//   top_countries             the 10 countries with most enrolments: country, iso2, enrolments, share_pct
// Each is checked on its own (0–100, 1–5, ten countries, study time not falling >2% or
// doubling); one that fails keeps its previous value.
// Safety: every value a positive whole number, none down more than 2% or more than doubled
// against the last published values, and the sync before it without LearnWorlds errors.
// When a check fails, the last good file is published again unchanged and the reason kept.
Object.assign(window.App, {
    WM_KEY: 'surgdash_website_metrics',   // device-local: last good values + last attempt
    WM_ORDER: ['registered_learners', 'enrolments', 'countries', 'courses', 'certificates', 'content_providers'],
    WM_LABELS: { registered_learners: 'Registered learners', enrolments: 'Enrolments', countries: 'Countries', courses: 'Courses', certificates: 'Certificates', content_providers: 'Content providers' },
    WM_MAX_DROP: 0.02,

    websiteMetricsCompute() {
        const all = (fn) => (this._withAllCourses ? this._withAllCourses(fn) : fn());
        const plat = all(() => this.getPlatformSnap()) || [];
        const incl = all(() => this.getAnalyticsSnap()) || [];
        const hist = (this.userHistory || []).slice().sort((a, b) => String(a.Timestamp || '').localeCompare(String(b.Timestamp || ''))).pop() || {};
        const isPriv = (d) => (this.isCourseRecordPrivate ? this.isCourseRecordPrivate(d) : /^(private|draft)$/i.test(String(d.Access || '')));
        const sum = (f) => plat.reduce((s, d) => s + (Number(d[f]) || 0), 0);
        return {
            registered_learners: Number(hist.TotalUsers) || 0,
            enrolments: sum('Learners'),
            countries: Number(hist.KnownCountry) || 0,
            courses: incl.filter(d => !isPriv(d)).length,
            certificates: sum('Certificates'),
            content_providers: new Set(incl.map(d => d.Provider).filter(p => p && !/^unknown/i.test(p))).size,
        };
    },

    // Why these values may not go out, or '' when they may.
    _wmProblem(v, prev) {
        for (const k of this.WM_ORDER) {
            const x = v[k];
            if (!Number.isFinite(x) || !Number.isInteger(x) || x <= 0) return this.WM_LABELS[k] + ' is not a positive whole number (' + x + ')';
            const p = prev && Number(prev[k]);
            if (p > 0 && x < p * (1 - this.WM_MAX_DROP)) return this.WM_LABELS[k] + ' fell more than 2% (' + p + ' → ' + x + ')';
            if (p > 0 && x > p * 2) return this.WM_LABELS[k] + ' more than doubled (' + p + ' → ' + x + ')';
        }
        return '';
    },
    async _wmLoad() {
        if (this._wm) return this._wm;
        let v = null; try { v = await Storage.getItem(this.WM_KEY); } catch (e) { __swallowed(e, 'wm.load'); }
        this._wm = (v && typeof v === 'object') ? v : {};
        return this._wm;
    },
    async _wmSave() { try { await Storage.setItem(this.WM_KEY, this._wm, { internal: true }); } catch (e) { __swallowed(e, 'wm.save'); } },
    _wmJson(rec) {
        const o = { as_of: rec.as_of, updated_at: rec.at, source: 'SURGhub, via SURGdash (Global Surgery Foundation)' };
        this.WM_ORDER.forEach(k => { o[k] = rec.values[k]; });
        const v = rec.values, x = rec.extras || {};
        if (v.enrolments > 0) o.certification_rate_pct = Math.round(v.certificates / v.enrolments * 1000) / 10;
        ['overall_satisfaction_pct', 'likely_to_apply_pct', 'satisfaction_responses', 'average_rating'].forEach(k => { if (x[k] != null) o[k] = x[k]; });
        if (x.study_minutes != null) { o.study_minutes = x.study_minutes; o.study_years = Math.round(x.study_minutes / 525960 * 10) / 10; }
        if (x.top_countries) o.top_countries = x.top_countries;
        return JSON.stringify(o, null, 2) + '\n';
    },

    // The SURGhub overall report's data, assembled with every report filter off.
    async _wmReportData() {
        if (!this._assembleReportData) return null;
        const keep = { from: this.reportPeriodFrom, to: this.reportPeriodTo, fb: this.reportFeedbackFromDate, low: this.hideLowLearners, priv: this.hidePrivateCourses };
        try {
            this.reportPeriodFrom = ''; this.reportPeriodTo = ''; this.reportFeedbackFromDate = ''; this.hideLowLearners = false; this.hidePrivateCourses = false;
            return await this._assembleReportData('SURGhub', { platform: true });
        } finally {
            this.reportPeriodFrom = keep.from; this.reportPeriodTo = keep.to; this.reportFeedbackFromDate = keep.fb; this.hideLowLearners = keep.low; this.hidePrivateCourses = keep.priv;
        }
    },
    async websiteMetricsExtras() {
        const D = await this._wmReportData();
        if (!D) return {};
        const row = (t) => (D.surveyQRows || []).find(r => r && r.title === t);
        const sat = row('Overall satisfaction'), app = row('Intent to apply');
        const cc = D.providerCountryData || {};
        const ent = Object.entries(cc).filter(([k, n]) => k && Number(n) > 0).sort((a, b) => b[1] - a[1]);
        const total = ent.reduce((t, e) => t + Number(e[1]), 0);
        const iso = (c) => { try { return (window.countryToISO && window.countryToISO(c)) || ''; } catch (e) { return ''; } };
        const top = ent.slice(0, 10).map(([c, n]) => ({ country: c, iso2: iso(c), enrolments: Math.round(Number(n)), share_pct: Math.round(Number(n) / total * 1000) / 10 }));
        const r = Number(D.avgRating);
        return {
            overall_satisfaction_pct: sat ? Math.round(sat.hiPct * 10) / 10 : null,
            likely_to_apply_pct: app ? Math.round(app.hiPct * 10) / 10 : null,
            satisfaction_responses: sat ? sat.n : null,
            average_rating: Number.isFinite(r) && r > 0 ? Math.round(r * 100) / 100 : null,
            study_minutes: Math.round(Number(D.totalMin) || 0) || null,
            top_countries: top.length === 10 ? top : null,
        };
    },
    // Each extra on its own: a value that fails keeps the previous one (or is left out).
    _wmExtrasChecked(x, prev) {
        prev = prev || {}; const out = {}, kept = [];
        const pct = (v) => Number.isFinite(v) && v >= 0 && v <= 100 && Math.abs(Math.round(v * 10) - v * 10) < 1e-6;   // one decimal
        const ok = {
            overall_satisfaction_pct: pct, likely_to_apply_pct: pct,
            satisfaction_responses: (v) => Number.isInteger(v) && v > 0,
            average_rating: (v) => Number.isFinite(v) && v >= 1 && v <= 5,
            study_minutes: (v) => Number.isInteger(v) && v > 0 && !(prev.study_minutes > 0 && (v < prev.study_minutes * (1 - this.WM_MAX_DROP) || v > prev.study_minutes * 2)),
            top_countries: (v) => Array.isArray(v) && v.length === 10 && v.every(c => c && typeof c.country === 'string' && c.country && Number.isInteger(c.enrolments) && c.enrolments > 0),
        };
        Object.keys(ok).forEach(k => {
            if (x && x[k] != null && ok[k](x[k])) out[k] = x[k];
            else { if (prev[k] != null) out[k] = prev[k]; if (x && x[k] != null) kept.push(k); }
        });
        return { extras: out, kept };
    },

    // The metrics.json to publish now: fresh figures when they pass, otherwise the last
    // good ones unchanged (null when there are none yet). opts.syncOk === false: the sync
    // before this had LearnWorlds errors, so the figures may be stale or partial.
    async websiteMetricsFile(opts) {
        opts = opts || {};
        const s = await this._wmLoad();
        const now = new Date();
        const values = this.websiteMetricsCompute();
        const why = opts.syncOk === false ? 'the sync before it had LearnWorlds errors' : this._wmProblem(values, s.last && s.last.values);
        let extras = null, kept = [];
        if (!why) {
            let raw = {}; try { raw = await this.websiteMetricsExtras(); } catch (e) { __swallowed(e, 'wm.extras'); }
            ({ extras, kept } = this._wmExtrasChecked(raw, s.last && s.last.extras));
        }
        s.attempt = { at: now.toISOString(), values, extras, ok: !why, why, kept };
        await this._wmSave();
        const rec = !why ? { values, extras, as_of: now.toISOString().slice(0, 10), at: now.toISOString() } : s.last;
        return { content: rec ? this._wmJson(rec) : null, rec, fresh: !why, why, kept };
    },
    // After the upload went through: fresh figures become the new baseline for the checks.
    async _wmPublished(f) {
        const s = await this._wmLoad();
        if (f && f.fresh && f.rec) s.last = f.rec;
        s.published = { at: new Date().toISOString(), fresh: !!(f && f.fresh), why: (f && f.why) || '' };
        await this._wmSave();
    },

    // On demand: replace metrics.json alone, on top of what is published (one small commit;
    // the next full publish starts the branch afresh, as always).
    async publishWebsiteMetrics(btn) {
        const ready = this._pdReady ? await this._pdReady() : { ok: false, why: 'partner dashboards not loaded' };
        if (!ready.ok) { alert('The reports site is not set up: ' + ready.why + '.'); return { ok: false }; }
        const label = btn && btn.textContent; if (btn) { btn.disabled = true; btn.textContent = 'Publishing…'; }
        try {
            const f = await this.websiteMetricsFile({});
            if (!f.content) throw new Error('nothing to publish yet: ' + f.why);
            const s = this._pd, token = await this._pdToken(), branch = s.branch || 'main';
            const ref = await this._pdGh('GET', '/git/ref/heads/' + branch, null, token);
            const head = ref.object.sha, commit = await this._pdGh('GET', '/git/commits/' + head, null, token);
            const blob = await this._pdGh('POST', '/git/blobs', { content: f.content, encoding: 'utf-8' }, token);
            const tree = await this._pdGh('POST', '/git/trees', { base_tree: commit.tree.sha, tree: [{ path: 'metrics.json', mode: '100644', type: 'blob', sha: blob.sha }] }, token);
            const c = await this._pdGh('POST', '/git/commits', { message: 'Website metrics ' + new Date().toISOString().slice(0, 10), tree: tree.sha, parents: [head] }, token);
            await this._pdGh('PATCH', '/git/refs/heads/' + branch, { sha: c.sha, force: false }, token);
            await this._wmPublished(f);
            this.showMsg(f.fresh ? '✓ Website figures published. The GSF website shows them within about 10 minutes.' : '⚠ Kept the last figures: ' + f.why + '.', !f.fresh);
            return { ok: true, fresh: f.fresh };
        } catch (e) {
            alert('Could not publish the website figures:\n\n' + String((e && e.message) || e));
            return { ok: false };
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = label; }
            if (this._pdRerender) this._pdRerender();
        }
    },

    // The box on the Reports tab, inside Partner Dashboards.
    _websiteMetricsHtml() {
        if (this._wm === undefined) { this._wm = null; this._wmLoad().then(() => this._pdRerender && this._pdRerender()); return ''; }
        const s = this._wm || {}, esc = (t) => this.escapeHtml(String(t == null ? '' : t));
        let now = null; try { now = this.websiteMetricsCompute(); } catch (e) { __swallowed(e, 'wm.compute'); }
        const pub = s.last && s.last.values;
        const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
        const url = this._pdUrl ? String(this._pdUrl('x')).replace(/x\/$/, 'metrics.json') : '';
        const cells = this.WM_ORDER.map(k => {
            const n = now ? now[k] : null, p = pub ? pub[k] : null, changed = pub && n !== p;
            return '<div class="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200"><div class="text-[10px] font-bold uppercase tracking-wide text-slate-400">' + esc(this.WM_LABELS[k]) + '</div>'
                + '<div class="text-base font-black text-gsf-prussian tabular-nums">' + (n != null ? Number(n).toLocaleString('en-GB') : '–') + '</div>'
                + '<div class="text-[10px] ' + (changed ? 'text-amber-700' : 'text-slate-400') + '">' + (pub ? 'online: ' + Number(p).toLocaleString('en-GB') : 'not online yet') + '</div></div>';
        }).join('');
        const a = s.attempt;
        const status = a && !a.ok ? '<span class="text-amber-700">Last check ' + esc(when(a.at)) + ' kept the previous figures: ' + esc(a.why) + '.</span>'
            : (s.last ? '<span class="text-emerald-700">Online since ' + esc(when(s.last.at)) + ' (as of ' + esc(s.last.as_of) + ').</span>' : '<span class="text-slate-400">Not published yet.</span>');
        return '<div class="mt-5 pt-4 border-t border-slate-100">'
            + '<div class="flex items-center gap-3 flex-wrap mb-2"><h3 class="text-xs font-bold text-gsf-prussian uppercase tracking-wide">GSF website figures</h3>'
            + (url ? '<button onclick="electronAPI.openExternal(\'' + this.escapeJsArg(url) + '\')" class="font-mono text-[11px] text-gsf-boston hover:underline">' + esc(url.replace(/^https?:\/\//, '')) + '</button>' : '') + '</div>'
            + '<p class="text-xs text-slate-400 mb-3 max-w-3xl">Six totals the GSF website reads on page load, published with every nightly run (and here on demand). Report toggles do not apply; courses are the live, included, non-private ones. A figure that falls more than 2% or doubles keeps the previous values online until checked.</p>'
            + '<div class="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">' + cells + '</div>'
            + (() => { const x = (s.last && s.last.extras) || {}; const v = s.last && s.last.values; const bits = [];
                if (v && v.enrolments) bits.push('certification ' + (Math.round(v.certificates / v.enrolments * 1000) / 10) + '%');
                if (x.overall_satisfaction_pct != null) bits.push('satisfaction ' + x.overall_satisfaction_pct + '%');
                if (x.likely_to_apply_pct != null) bits.push('likely to apply ' + x.likely_to_apply_pct + '%');
                if (x.average_rating != null) bits.push('rating ' + x.average_rating);
                if (x.study_minutes != null) bits.push((Math.round(x.study_minutes / 525960 * 10) / 10) + ' years of study');
                if (x.top_countries) bits.push('top: ' + x.top_countries.slice(0, 3).map(c => c.country).join(', ') + '…');
                return bits.length ? '<p class="text-[11px] text-slate-500 mb-3">Also online: ' + esc(bits.join(' · ')) + '</p>' : ''; })()
            + '<div class="flex items-center gap-3 flex-wrap text-xs"><button onclick="App.publishWebsiteMetrics(this)" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-gsf-boston text-white hover:bg-gsf-prussian">Publish figures now</button>' + status + '</div></div>';
    },
});
