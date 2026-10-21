// ── courses.json: the per-course feed surghub.org course pages read ──────────────
//
// Published beside metrics.json (websiteMetrics.js) at
// https://reports.globalsurgeryfoundation.org/courses.json — same host, same commit, same
// nightly run and the same "Publish figures now" button; GitHub Pages serves it to any
// origin (access-control-allow-origin: *) with a 10-minute cache. It replaces the course
// agency's ratings.json. Aggregates per course only: nothing about any learner.
//
// Which courses: public (LearnWorlds access 'free') and included in SURGdash; drafts, private
// courses, excluded ones (test copies) and anything titled "template" are left out.
// Fields (Seb, 21 Oct 2026):
//   slug             the PUBLIC address (surghub.org/course/<slug>): for 7 courses it is not the
//                    LearnWorlds id, which redirects to it; read from the course page's canonical
//                    link and cached (settings/course_slugs.json). `id` = the LearnWorlds id.
//   learners         the LearnWorlds course count (= the agency feed's "Total Learners")
//   learners_90d     enrolments in the last 90 days (per-learner records), for Popular
//   certificates     the LearnWorlds course count
//   ratings          mean score per post-course survey question: satisfaction, objectives,
//                    relevance ("relevant and engaging"), platform; EN/FR/ES question texts
//   average_rating   mean of the four, 2 decimals; rating_responses = satisfaction answers
//   published_on     the directory field: as set, else the day the course reached 25
//                    enrolments, else its LearnWorlds creation date
//   tags             Free (price 0), Popular (top 15% by learners_90d, every run), CME/CPD
//                    (directory tick box, seeded from the LearnWorlds "CME/CPD" label), New
//                    (published_on within 90 days) — in that order
// Safety: a file with no courses, or under 80% of the last published count, or after a sync
// with LearnWorlds errors, is not published; the previous one is republished unchanged.
Object.assign(window.App, {
    CF_META_KEY: 'surghub_course_meta',      // synced with the SURGhub data: {byId: {id: {cme: bool, publishedOn: 'YYYY-MM-DD'}}}
    CF_SLUG_KEY: 'surgdash_course_slugs',    // device-local cache: {byId: {id: {slug, at}}}
    CF_STATE_KEY: 'surgdash_courses_feed',   // device-local: the last published file and the last attempt
    CF_LAUNCH_N: 25, CF_NEW_DAYS: 90, CF_RECENT_DAYS: 90, CF_POP_SHARE: 0.15, CF_MIN_KEEP: 0.8, CF_SLUG_DAYS: 30,
    CF_Q: [
        ['satisfaction', /overall satisfaction|satisfaction with this course|satisfaction concernant ce cours|satisfacci.n general|satisfacci.n con este curso/i],
        ['objectives', /learning objectives|objectives stated|objectifs mentionn|objectifs d.apprentissage|objetivos mencionados|objetivos enunciados|alcanzar los objetivos/i],
        // Spanish: "pertinencia de los contenidos para alcanzar los objetivos" is the OBJECTIVES question; relevance is "interactividad"
        ['relevance', /relevant and engaging|pertinent et engageant|pertinente y atractivo|interactividad de los contenidos/i],
        ['platform', /user-friendly|reliable was the course platform|course platform|facile . utiliser|f.cil de usar|interfaz|ergonom.a|accesibilidad\s*de la plataforma/i],
    ],

    async _cfLoad() {
        const get = async (k) => { try { const v = await Storage.getItem(k); return (v && typeof v === 'object') ? v : null; } catch (e) { return null; } };
        if (!this._cfMeta) this._cfMeta = Object.assign({ byId: {} }, (await get(this.CF_META_KEY)) || {});
        if (!this._cfSlugs) this._cfSlugs = Object.assign({ byId: {} }, (await get(this.CF_SLUG_KEY)) || {});
        if (!this._cfState) this._cfState = (await get(this.CF_STATE_KEY)) || {};
    },
    async _cfSaveMeta() { try { await Storage.setItem(this.CF_META_KEY, this._cfMeta); } catch (e) { __swallowed(e, 'cf.meta'); } },

    // Label, price and creation date by LearnWorlds id: the course records carry them since the
    // 21 Oct 2026 Sync Courses; until then, the newest raw course pull.
    _cfRawCourses() {
        if (this._cfRaw) return this._cfRaw;
        const out = {};
        try {
            const rows = (window.LearnWorlds && LearnWorlds.readLatestArtifactRows) ? LearnWorlds.readLatestArtifactRows('course-foundation', 'pull.jsonl') : [];
            rows.forEach(r => { let b = r && r.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } } ((b && b.data) || []).forEach(c => { if (c && c.id && c.title && !out[c.id]) out[c.id] = c; }); });
        } catch (e) { __swallowed(e, 'cf.raw'); }
        this._cfRaw = out;
        return out;
    },

    // Enrolment dates per course title (normalised), sorted, rebuilt when the records change.
    _cfEnrolDates() {
        const rows = this._rawCompletion;
        if (!Array.isArray(rows)) return null;
        if (this._cfDates && this._cfDatesSrc === rows) return this._cfDates;
        const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const m = {};
        rows.forEach(r => {
            if (!r) return;
            const d = String(r.enrolled_date || r.start_date || '').slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
            const k = norm(r.course); if (k) (m[k] || (m[k] = [])).push(d);
        });
        Object.values(m).forEach(a => a.sort());
        this._cfDates = m; this._cfDatesSrc = rows;
        return m;
    },
    _cfNorm(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]/g, ''); },

    // The courses that go in the feed: newest record per LearnWorlds id, public, included, no template.
    _cfCandidates() {
        const rec = {};
        (this.data || []).forEach(d => { if (d && !d.IsShell && d.CourseId && (!rec[d.CourseId] || String(d.Timestamp || '') > String(rec[d.CourseId].Timestamp || ''))) rec[d.CourseId] = d; });
        return Object.values(rec).filter(d => String(d.Access || '').toLowerCase() === 'free' && !d.Excluded && !/template/i.test(String(d.Course || '')));
    },
    _cfCme(d) {
        const m = this._cfMeta && this._cfMeta.byId[d.CourseId];
        if (m && typeof m.cme === 'boolean') return m.cme;
        const raw = this._cfRawCourses()[d.CourseId];
        const label = d.Label != null ? d.Label : (raw ? raw.label : '');
        return /CME\s*\/\s*CPD/i.test(String(label || ''));
    },
    _cfDefaultPublished(d) {
        const dates = this._cfEnrolDates();
        const list = dates ? (dates[this._cfNorm(d.Course)] || []) : [];
        if (list.length >= this.CF_LAUNCH_N) return list[this.CF_LAUNCH_N - 1];
        const raw = this._cfRawCourses()[d.CourseId];
        const c = d.CourseCreated || (raw && raw.created);
        if (!c) return '';
        const n = Number(c);
        return (n > 1e9 ? new Date(n * 1000) : new Date(c)).toISOString().slice(0, 10);
    },
    _cfPublished(d) {
        const m = this._cfMeta && this._cfMeta.byId[d.CourseId];
        return (m && m.publishedOn) || this._cfDefaultPublished(d);
    },
    _cfProviderName(p) {
        p = String(p || '').trim();
        if (!p || /^unknown/i.test(p)) return '';
        return p.replace(/^[A-Z0-9&]{2,12}\s*-\s*/, '').trim() || p;   // "GSF - Global Surgery Foundation" → "Global Surgery Foundation"
    },
    _cfRatings(d) {
        let qs = []; try { qs = JSON.parse(d.QuestionStats || '[]') || []; } catch (e) { qs = []; }
        const out = {}; let satN = 0;
        this.CF_Q.forEach(([k, re]) => {
            const hit = qs.filter(s => s && s.n && re.test(String(s.q || '')));
            const n = hit.reduce((t, s) => t + s.n, 0);
            if (n) { out[k] = Math.round(hit.reduce((t, s) => t + (Number(s.avg) || 0) * s.n, 0) / n * 100) / 100; if (k === 'satisfaction') satN = n; }
        });
        const vals = Object.values(out);
        return { ratings: out, n: satN, avg: vals.length ? Math.round(vals.reduce((t, v) => t + v, 0) / vals.length * 100) / 100 : null };
    },

    coursesFeedBuild(now) {
        const t = (now || new Date()), today = t.toISOString().slice(0, 10);
        const since = (days) => new Date(t.getTime() - days * 86400000).toISOString().slice(0, 10);
        const recentFrom = since(this.CF_RECENT_DAYS), newFrom = since(this.CF_NEW_DAYS);
        const dates = this._cfEnrolDates() || {};
        const raw = this._cfRawCourses(), slugs = (this._cfSlugs && this._cfSlugs.byId) || {};
        const list = this._cfCandidates().map(d => {
            const ds = dates[this._cfNorm(d.Course)] || [];
            const r = this._cfRatings(d);
            const rawC = raw[d.CourseId] || {};
            const price = d.Price != null ? Number(d.Price) || 0 : (rawC.final_price != null ? Number(rawC.final_price) || 0 : 0);
            const slug = String((slugs[d.CourseId] && slugs[d.CourseId].slug) || d.CourseId).toLowerCase();
            const o = { slug, id: d.CourseId, url: 'https://www.surghub.org/course/' + slug, title: String(d.Course || '').trim(), provider: this._cfProviderName(d.Provider),
                published_on: this._cfPublished(d), learners: Number(d.Learners) || 0, learners_90d: ds.filter(x => x >= recentFrom).length,
                certificates: Number(d.Certificates) || 0, rating_responses: r.n, average_rating: r.avg, ratings: r.ratings, _free: price === 0, _cme: this._cfCme(d) };
            return o;
        });
        // Popular: the top 15% by learners_90d this run (ties at the cut-off included; never a course with none)
        const sorted = list.map(c => c.learners_90d).sort((a, b) => b - a);
        const k = Math.max(1, Math.ceil(list.length * this.CF_POP_SHARE));
        const cut = sorted.length ? sorted[Math.min(k, sorted.length) - 1] : Infinity;
        list.forEach(c => {
            const tags = [];
            if (c._free) tags.push('Free');
            if (c.learners_90d > 0 && c.learners_90d >= cut) tags.push('Popular');
            if (c._cme) tags.push('CME/CPD');
            if (c.published_on && c.published_on >= newFrom && c.published_on <= today) tags.push('New');
            c.tags = tags; delete c._free; delete c._cme;
            if (c.average_rating == null) delete c.average_rating;
        });
        list.sort((a, b) => a.title.localeCompare(b.title));
        return { as_of: today, updated_at: t.toISOString(), source: 'SURGhub, via SURGdash (Global Surgery Foundation)', popular_cutoff_90d: cut === Infinity ? null : cut, courses: list };
    },

    // Public slugs: read the canonical link of the pages not yet known (or not checked for a
    // month), politely, at most `max` a run.
    async _cfResolveSlugs(ids, opts) {
        opts = opts || {};
        await this._cfLoad();
        const S = this._cfSlugs.byId, max = opts.max || 200, stale = Date.now() - this.CF_SLUG_DAYS * 86400000;
        const todo = ids.filter(id => !S[id] || !(Date.parse(S[id].at) > stale)).slice(0, max);
        let done = 0;
        for (const id of todo) {
            if (opts.progress) opts.progress('Course addresses: ' + (++done) + '/' + todo.length);
            try {
                const res = await electronAPI.invoke('http-request', { url: 'https://www.surghub.org/course/' + encodeURIComponent(id), method: 'GET', headers: { 'Accept': 'text/html' }, timeoutMs: 20000 });
                const m = res && res.statusCode === 200 && String(res.body || '').match(/<link rel="canonical" href="https:\/\/www\.surghub\.org\/course\/([^"?#/]+)"/i);
                if (m) S[id] = { slug: decodeURIComponent(m[1]).toLowerCase(), at: new Date().toISOString() };
            } catch (e) { __swallowed(e, 'cf.slug'); }
            await new Promise(r => setTimeout(r, 700));
        }
        try { await Storage.setItem(this.CF_SLUG_KEY, this._cfSlugs, { internal: true }); } catch (e) { __swallowed(e, 'cf.slugs'); }
        return done;
    },

    // The courses.json to publish now: fresh when it passes, else the last good one unchanged.
    async coursesFeedFile(opts) {
        opts = opts || {};
        await this._cfLoad();
        if (this._rawCompletion == null && this.ensureCompletionLoaded) await this.ensureCompletionLoaded();
        this._cfRaw = null;
        const ids = this._cfCandidates().map(d => d.CourseId);
        if (opts.resolveSlugs !== false) await this._cfResolveSlugs(ids, { progress: opts.progress });
        const st = this._cfState, prevN = (st.last && st.last.count) || 0;
        const feed = this.coursesFeedBuild();
        const n = feed.courses.length;
        const why = opts.syncOk === false ? 'the sync before it had LearnWorlds errors'
            : !n ? 'no courses' : (prevN && n < prevN * this.CF_MIN_KEEP) ? 'only ' + n + ' courses against ' + prevN + ' last time' : '';
        st.attempt = { at: new Date().toISOString(), count: n, ok: !why, why };
        const content = !why ? JSON.stringify(feed, null, 2) + '\n' : (st.last && st.last.content) || null;
        try { await Storage.setItem(this.CF_STATE_KEY, st, { internal: true }); } catch (e) { __swallowed(e, 'cf.state'); }
        return { content, fresh: !why, why, count: n, feed };
    },
    async _cfMarkPublished(f) {
        const st = this._cfState || {};
        if (f && f.fresh && f.content) st.last = { at: new Date().toISOString(), count: f.count, content: f.content };
        st.published = { at: new Date().toISOString(), fresh: !!(f && f.fresh), why: (f && f.why) || '' };
        this._cfState = st;
        try { await Storage.setItem(this.CF_STATE_KEY, st, { internal: true }); } catch (e) { __swallowed(e, 'cf.state'); }
    },

    // ── the two directory fields ──
    async setCourseCme(courseId, on) {
        await this._cfLoad();
        (this._cfMeta.byId[courseId] || (this._cfMeta.byId[courseId] = {})).cme = !!on;
        await this._cfSaveMeta();
    },
    async setCoursePublishedOn(courseId, value) {
        await this._cfLoad();
        const v = String(value || '').trim();
        const m = this._cfMeta.byId[courseId] || (this._cfMeta.byId[courseId] = {});
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) m.publishedOn = v; else delete m.publishedOn;   // cleared: back to the default
        await this._cfSaveMeta();
        if (this.renderView) this.renderView();
    },
    // Directory cells (edit mode). The record behind a directory row carries the LearnWorlds id.
    _cfDirCells(d) {
        if (this._cfMeta === undefined) { this._cfMeta = null; this._cfLoad().then(() => { if (this.renderView) this.renderView(); }); }
        if (!d || !d.CourseId || !this._cfMeta) return '<td class="py-2 px-3"></td><td class="py-2 px-3"></td>';
        const id = this.escapeJsArg(d.CourseId), set = this._cfMeta.byId[d.CourseId] || {};
        const pub = set.publishedOn || '', def = this._cfDefaultPublished(d);
        return '<td class="py-2 px-3 text-center"><input type="checkbox" data-edit-only ' + (this._cfCme(d) ? 'checked' : '') + ' onchange="App.setCourseCme(\'' + id + '\', this.checked)" title="CME/CPD course (tag on surghub.org)"></td>'
            + '<td class="py-2 px-2"><input type="date" data-edit-only value="' + this.escapeHtml(pub || def) + '" onchange="App.setCoursePublishedOn(\'' + id + '\', this.value)" title="' + (pub ? 'Set by hand. Clear it to go back to the default (' + this.escapeHtml(def || 'none') + ')' : 'Default: the day it reached ' + this.CF_LAUNCH_N + ' enrolments, else its creation date') + '" class="text-[11px] border rounded px-1 py-0.5 w-[118px] ' + (pub ? 'text-gsf-prussian font-bold' : 'text-slate-400') + '"></td>';
    },
});
