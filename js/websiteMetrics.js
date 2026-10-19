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
        return JSON.stringify(o, null, 2) + '\n';
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
        s.attempt = { at: now.toISOString(), values, ok: !why, why };
        await this._wmSave();
        const rec = !why ? { values, as_of: now.toISOString().slice(0, 10), at: now.toISOString() } : s.last;
        return { content: rec ? this._wmJson(rec) : null, rec, fresh: !why, why };
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
            + '<div class="flex items-center gap-3 flex-wrap text-xs"><button onclick="App.publishWebsiteMetrics(this)" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-gsf-boston text-white hover:bg-gsf-prussian">Publish figures now</button>' + status + '</div></div>';
    },
});
