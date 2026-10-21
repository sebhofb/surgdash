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
//                    (published_on within 90 days) — in that order, then any custom tags.
//                    Each of the four can be forced on or off per course (the course page's
//                    "On surghub.org" band, 21 Oct 2026); a tag left on automatic follows the rule.
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
    async _cfSaveMeta() { this._cfMetaRev = (this._cfMetaRev || 0) + 1; try { await Storage.setItem(this.CF_META_KEY, this._cfMeta); } catch (e) { __swallowed(e, 'cf.meta'); } },
    CF_TAGS: ['Free', 'Popular', 'CME/CPD', 'New'],
    // A tag's override for one course: true / false, or undefined (automatic). CME/CPD keeps its
    // directory tick box (`cme`), the others live under `tags`.
    _cfTagOverride(id, tag) {
        const m = (this._cfMeta && this._cfMeta.byId[id]) || {};
        return tag === 'CME/CPD' ? (typeof m.cme === 'boolean' ? m.cme : undefined) : (m.tags && typeof m.tags[tag] === 'boolean' ? m.tags[tag] : undefined);
    },

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
    _cfCme(d, autoOnly) {
        const m = this._cfMeta && this._cfMeta.byId[d.CourseId];
        if (!autoOnly && m && typeof m.cme === 'boolean') return m.cme;
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
                certificates: Number(d.Certificates) || 0, rating_responses: r.n, average_rating: r.avg, ratings: r.ratings, _free: price === 0, _cme: this._cfCme(d, true) };
            return o;
        });
        // Popular: the top 15% by learners_90d this run (ties at the cut-off included; never a course with none)
        const sorted = list.map(c => c.learners_90d).sort((a, b) => b - a);
        const k = Math.max(1, Math.ceil(list.length * this.CF_POP_SHARE));
        const cut = sorted.length ? sorted[Math.min(k, sorted.length) - 1] : Infinity;
        const auto = {};
        list.forEach(c => {
            const a = { 'Free': c._free, 'Popular': c.learners_90d > 0 && c.learners_90d >= cut, 'CME/CPD': c._cme, 'New': !!(c.published_on && c.published_on >= newFrom && c.published_on <= today) };
            auto[c.id] = a;
            const tags = this.CF_TAGS.filter(t => { const o = this._cfTagOverride(c.id, t); return o === undefined ? a[t] : o; });
            const m = (this._cfMeta && this._cfMeta.byId[c.id]) || {};
            (Array.isArray(m.extraTags) ? m.extraTags : []).forEach(t => { if (t && tags.indexOf(t) < 0) tags.push(t); });
            c.tags = tags; delete c._free; delete c._cme;
            if (c.average_rating == null) delete c.average_rating;
        });
        list.sort((a, b) => a.title.localeCompare(b.title));
        const feedOut = { as_of: today, updated_at: t.toISOString(), source: 'SURGhub, via SURGdash (Global Surgery Foundation)', popular_cutoff_90d: cut === Infinity ? null : cut, courses: list };
        Object.defineProperty(feedOut, '_auto', { value: auto, enumerable: false });   // the course page's band reads it; never published
        return feedOut;
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

    // ── tags by hand (the course page band) ──
    async cycleCourseTag(courseId, tag) {
        await this._cfLoad();
        const m = this._cfMeta.byId[courseId] || (this._cfMeta.byId[courseId] = {});
        const cur = this._cfTagOverride(courseId, tag), next = cur === undefined ? true : cur === true ? false : undefined;   // automatic → on → off → automatic
        if (tag === 'CME/CPD') { if (next === undefined) delete m.cme; else m.cme = next; }
        else { m.tags = m.tags || {}; if (next === undefined) delete m.tags[tag]; else m.tags[tag] = next; }
        await this._cfSaveMeta(); if (this.renderView) this.renderView();
    },
    async addCourseTag(courseId, text) {
        const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 30);
        if (!t) return;
        await this._cfLoad();
        if (this.CF_TAGS.some(x => x.toLowerCase() === t.toLowerCase())) { this.showMsg('"' + t + '" is one of the standard tags: click its chip to switch it on or off.', 'warn'); return; }
        const m = this._cfMeta.byId[courseId] || (this._cfMeta.byId[courseId] = {});
        m.extraTags = (Array.isArray(m.extraTags) ? m.extraTags : []).filter(x => x.toLowerCase() !== t.toLowerCase()).concat([t]);
        await this._cfSaveMeta(); if (this.renderView) this.renderView();
    },
    async removeCourseTag(courseId, text) {
        await this._cfLoad();
        const m = this._cfMeta.byId[courseId]; if (!m || !Array.isArray(m.extraTags)) return;
        m.extraTags = m.extraTags.filter(x => x !== text);
        await this._cfSaveMeta(); if (this.renderView) this.renderView();
    },

    // The feed as it would be published now, rebuilt only when its inputs change.
    _cfFeedNow() {
        const key = [this.data && this.data.length, this._rawCompletion && this._rawCompletion.length, this._cfMetaRev || 0, new Date().toISOString().slice(0, 10)].join('|');
        if (this._cfNowCache && this._cfNowCache.key === key && this._cfNowCache.data === this.data) return this._cfNowCache.feed;
        const feed = this.coursesFeedBuild();
        this._cfNowCache = { key, data: this.data, feed };
        return feed;
    },
    _cfLiveEntry(id) {
        const st = this._cfState, txt = st && st.last && st.last.content;
        if (!txt) return null;
        if (!this._cfLiveParsed || this._cfLiveParsed.src !== txt) { let f = null; try { f = JSON.parse(txt); } catch (e) { f = null; } this._cfLiveParsed = { src: txt, feed: f }; }
        const f = this._cfLiveParsed.feed;
        return f && f.courses ? (f.courses.find(c => c.id === id) || null) : null;
    },

    // "On surghub.org": how the course appears in courses.json, with the controls to change it.
    _cfCourseBandHtml(d) {
        if (!d || !d.CourseId) return '';
        if (this._cfMeta === undefined || this._cfState === undefined) { this._cfMeta = this._cfMeta || null; this._cfLoad().then(() => { if (this.view === 'course' && this.renderView) this.renderView(); }); return ''; }
        if (!this._cfMeta) return '';
        const esc = (t) => this.escapeHtml(String(t == null ? '' : t)), id = d.CourseId, idJs = this.escapeJsArg(id);
        const access = String(d.Access || '').toLowerCase();
        const why = access === 'private' ? 'it is private on LearnWorlds' : access === 'draft' ? 'it is a draft on LearnWorlds' : access !== 'free' ? 'its LearnWorlds status is not public' : d.Excluded ? 'it is excluded from analytics (Include unticked)' : /template/i.test(String(d.Course || '')) ? 'its title marks it as a template' : '';
        const box = (inner) => '<div class="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3 mb-4">' + inner + '</div>';
        const head = '<div class="flex items-center gap-2 mb-2"><i data-lucide="globe" width="15" class="text-gsf-boston"></i><span class="text-xs font-bold uppercase tracking-wide text-gsf-prussian">On surghub.org</span>';
        if (why) return box(head + '<span class="text-xs text-slate-400">· not in the course feed, because ' + esc(why) + '.</span></div>');
        const feed = this._cfFeedNow(), e = feed.courses.find(c => c.id === id);
        if (!e) return box(head + '<span class="text-xs text-slate-400">· not in the course feed.</span></div>');
        const auto = (feed._auto && feed._auto[id]) || {}, m = this._cfMeta.byId[id] || {};
        const set = m.publishedOn || '', def = this._cfDefaultPublished(d);
        const rank = feed.courses.map(c => c.learners_90d).sort((a, b) => b - a).indexOf(e.learners_90d) + 1;
        const chip = (t) => {
            const o = this._cfTagOverride(id, t), on = o === undefined ? !!auto[t] : o;
            const why2 = { 'Free': 'no price on LearnWorlds', 'Popular': 'top 15% by enrolments in the last 90 days (cut-off ' + feed.popular_cutoff_90d + ')', 'CME/CPD': 'the LearnWorlds "CME/CPD" label', 'New': 'published within the last 90 days' }[t];
            const state = o === undefined ? 'automatic: ' + (on ? 'on' : 'off') + ' (' + why2 + ')' : (o ? 'always on' : 'always off') + ' (set by hand; the rule would say ' + (auto[t] ? 'on' : 'off') + ')';
            const cls = on ? (o === undefined ? 'bg-gsf-boston text-white border-gsf-boston' : 'bg-gsf-prussian text-white border-gsf-prussian') : (o === undefined ? 'bg-white text-slate-400 border-slate-200' : 'bg-white text-slate-400 border-slate-300 line-through');
            return '<button data-edit-only onclick="App.cycleCourseTag(\'' + idJs + '\', \'' + t + '\')" title="' + esc(t + ': ' + state + '. Click: automatic → always on → always off.') + '" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] font-bold ' + cls + '">' + (o !== undefined ? '<i data-lucide="pin" width="10"></i>' : '') + esc(t) + '</button>';
        };
        const extras = (Array.isArray(m.extraTags) ? m.extraTags : []).map(t => '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-amber-300 bg-amber-50 text-amber-800 text-[11px] font-bold">' + esc(t)
            + '<button data-edit-only onclick="App.removeCourseTag(\'' + idJs + '\', \'' + this.escapeJsArg(t) + '\')" title="Remove this tag" class="ml-0.5 text-amber-600 hover:text-amber-900">×</button></span>').join('');
        const live = this._cfLiveEntry(id);
        const pending = live ? (live.tags.join() !== e.tags.join() || live.published_on !== e.published_on || live.slug !== e.slug) : true;
        const liveNote = !live ? '<span class="text-amber-700">not online yet — goes live at the next publish</span>'
            : pending ? '<span class="text-amber-700">online now: ' + esc(live.tags.join(', ') || 'no tags') + ' · published ' + esc(live.published_on) + ' — your changes go live at the next publish</span>'
            : '<span class="text-emerald-700">online as shown</span>';
        return box(head + '<a href="#" onclick="electronAPI.openExternal(\'' + this.escapeJsArg(e.url) + '\'); return false" class="font-mono text-[11px] text-gsf-boston hover:underline">/course/' + esc(e.slug) + '</a>'
            + '<span class="ml-auto text-[11px]">' + liveNote + (pending ? ' <button data-edit-only onclick="App.publishWebsiteMetrics(this)" class="ml-1 font-bold text-gsf-boston hover:underline">Publish now</button>' : '') + '</span></div>'
            + '<div class="flex items-center gap-x-5 gap-y-2 flex-wrap text-xs text-slate-600">'
            + '<span class="inline-flex items-center gap-1.5"><span class="text-slate-400">Published</span><input type="date" data-edit-only value="' + esc(set || def) + '" onchange="App.setCoursePublishedOn(\'' + idJs + '\', this.value)" class="text-[11px] border rounded px-1 py-0.5 ' + (set ? 'text-gsf-prussian font-bold' : 'text-slate-500') + '">'
            + (set ? '<button data-edit-only onclick="App.setCoursePublishedOn(\'' + idJs + '\', \'\')" class="text-[10px] text-slate-400 hover:text-gsf-boston underline" title="Back to the default: ' + esc(def || 'none') + '">reset</button>' : '<span class="text-[10px] text-slate-400">default: day of the ' + this.CF_LAUNCH_N + 'th enrolment</span>') + '</span>'
            + '<span class="inline-flex items-center gap-1.5 flex-wrap"><span class="text-slate-400">Tags</span>' + this.CF_TAGS.map(chip).join('') + extras
            + '<input data-edit-only type="text" placeholder="+ tag" maxlength="30" onkeydown="if(event.key===\'Enter\'){App.addCourseTag(\'' + idJs + '\', this.value); this.value=\'\';}" class="w-20 text-[11px] border rounded-full px-2 py-1 outline-none focus:ring-2 focus:ring-gsf-boston/30" title="Add a tag of your own (Enter)"></span>'
            + '<span class="text-[11px] text-slate-400">' + this.formatNumber(e.learners_90d) + ' enrolments in 90 days (#' + rank + ' of ' + feed.courses.length + ')' + (e.average_rating != null ? ' · rating ' + e.average_rating.toFixed(2) + ' from ' + this.formatNumber(e.rating_responses) : ' · no ratings yet') + '</span>'
            + '</div>');
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
