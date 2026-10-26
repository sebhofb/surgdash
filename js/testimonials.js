// ── Testimonials on surghub.org course pages (Seb, 26 Oct 2026) ─────────────────
//
// Which survey comments each course page shows, chosen here and published as
// https://reports.globalsurgeryfoundation.org/testimonials.json beside courses.json (same commit,
// same nightly run and "Publish now"). Replaces the hand-made Google Sheet → agency feed route.
//
// The comments themselves are the anonymised survey exports SURGdash keeps (survey_raw; Sync Surveys
// replaces each course's export every time). The CHOICES live apart, in surghub_testimonials (synced with the
// data like the other curation stores), keyed by a stable response id — a hash of course id, the
// response's date and its normalised text; never the email. Sync Surveys never touches this store,
// so a new comment is off until someone switches it on, and nothing chosen is ever reset.
//   byId[id]     { course: courseId, show, order, text (display text; the original stays in the
//                  export), cadre / country / stars (only where set by hand or seeded from the page
//                  as it was), seed: {from, position}, at }
//   reviewed     { courseId: ISO time of the last "Mark reviewed" } → "new since last review"
// Published per course (courses.json slugs as keys), only switched-on comments that still exist,
// in display order: { id, text, cadre, country, stars, lang } — no names, emails, user ids or dates;
// cadre / country left out when unknown (the site then shows "SURGhub learner"). A display text the
// privacy scrub would change (an email, phone number or learner name in it) is held back.
Object.assign(window.App, {
    TM_KEY: 'surghub_testimonials',
    TM_STATE_KEY: 'surgdash_testimonials_feed',   // device-local: last published file and attempt
    TM_SUGGEST_WORDS: 15,
    TM_PAGE: 60,
    // LearnWorlds profession codes (the export's Profession column) as the person label the site shows
    TM_CADRE: { 'nurse': 'Nurse', 'nursing': 'Nurse', 'surgeon': 'Specialist Surgeon', 'anesthesiology': 'Anaesthesiologist', 'anaesthesiologist': 'Anaesthesiologist',
        'medical-officer': 'General Medical Officer', 'doctor': 'Physician', 'resident': 'Resident', 'non-clinical': 'Non-Clinical Professional',
        'emergency-doctor': 'Emergency Medicine Doctor', 'anaesthesia-technician': 'Anaesthesia Technician', 'medical-technician': 'Medical Technician',
        'nurse-anaesthetist': 'Nurse Anaesthetist', 'clinical-officer': 'Clinical Officer', 'obstetrician': 'Obstetrician', 'gynaecologist': 'Gynaecologist' },

    async _tmLoad() {
        if (!this._tm) {
            let v = null; try { v = await Storage.getItem(this.TM_KEY); } catch (e) { __swallowed(e, 'tm.load'); }
            this._tm = Object.assign({ v: 1, byId: {}, reviewed: {} }, (v && typeof v === 'object') ? v : {});
        }
        if (this._tmState === undefined) { try { this._tmState = (await Storage.getItem(this.TM_STATE_KEY)) || {}; } catch (e) { this._tmState = {}; } }
        if (this._rawSurveyResponses == null) {
            if (this.ensureSurveyRawLoaded) await this.ensureSurveyRawLoaded();
            else { let v = null; try { v = await Storage.getItem('surghub_survey_raw'); } catch (e) { v = null; } this._rawSurveyResponses = (v && typeof v === 'object') ? v : {}; }
        }
        return this._tm;
    },
    async _tmSave() { this._tmRev = (this._tmRev || 0) + 1; try { await Storage.setItem(this.TM_KEY, this._tm); } catch (e) { __swallowed(e, 'tm.save'); } },

    _tmNorm(t) {
        let s = String(t == null ? '' : t);
        if (/[ÃÂâ][\x80-\xBF€™œ]/.test(s)) { try { s = decodeURIComponent(escape(s)); } catch (e) { /* not UTF-8 read as Latin-1 */ } }
        return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/â€?™?/g, "'").replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();
    },
    _tmHash(t) {
        let a = 5381, b = 0;
        for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); a = ((a << 5) + a + c) | 0; b = (c + (b << 6) + (b << 16) - b) | 0; }
        return (a >>> 0).toString(36) + (b >>> 0).toString(36);
    },
    tmResponseId(courseId, date, text) { return 't' + this._tmHash(courseId + '|' + (date || '') + '|' + this._tmNorm(text)); },

    _tmLatest() {
        if (this._tmLatestSrc === this.data && this._tmLatestLen === (this.data || []).length && this._tmLatestCache) return this._tmLatestCache;
        const by = {};
        (this.data || []).forEach(d => { if (!d || d.IsShell || !d.Course || !d.CourseId) return; const p = by[d.CourseId]; if (!p || String(d.Timestamp || '') > String(p.Timestamp || '')) by[d.CourseId] = d; });
        this._tmLatestCache = by; this._tmLatestSrc = this.data; this._tmLatestLen = (this.data || []).length;
        return by;
    },
    // The survey's language from its question wording (for comments too short to tell).
    _tmSurveyLang(cols) {
        const q = (cols || []).join(' ');
        return /[\u0600-\u06ff]/.test(q) ? 'ar' : /escala|satisfacci|curso/i.test(q) ? 'es' : /échelle|echelle|satisfaction concernant|cours\b/i.test(q) ? 'fr' : 'en';
    },
    _tmLang(text, fallback) {
        const t = ' ' + String(text || '').toLowerCase() + ' ';
        if (/[\u0600-\u06ff]/.test(t)) return 'ar';
        const n = (re) => (t.match(re) || []).length;
        const s = { en: n(/\b(the|and|is|was|very|of|to|it|this|i|my|for|with)\b/g), fr: n(/\b(le|la|les|des|est|très|une|pour|avec|du|je|j'ai|nous|cours|été)\b/g), es: n(/\b(el|los|las|es|muy|una|para|con|que|del|por|curso|fue|más)\b/g) };
        const best = Object.keys(s).sort((a, b) => s[b] - s[a])[0];
        return s[best] >= 2 ? best : (fallback || 'en');
    },
    _tmCadre(code) {
        const p = String(code || '').trim();
        if (!p || /test/i.test(p)) return '';
        return this.TM_CADRE[p.toLowerCase()] || p.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    },
    _tmDate(v) {
        if (window.Pipeline && window.Pipeline.parseDateToExact) { const d = window.Pipeline.parseDateToExact(v); return d === '2023-01-01' && !/2023/.test(String(v)) ? '' : d; }
        const M = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
        const m = String(v || '').match(/^(\d{1,2}) ([A-Za-z]{3})\w* (\d{4})/);
        if (m && M[m[2].toLowerCase()]) return m[3] + '-' + String(M[m[2].toLowerCase()]).padStart(2, '0') + '-' + m[1].padStart(2, '0');
        const iso = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/); return iso ? iso[1] : '';
    },
    TM_SAT: /overall satisfaction|satisfaction with this course|satisfaction concernant ce cours|satisfacci.n general|satisfacci.n con este curso|رضاك/i,
    TM_META: ['Respondent', 'Country', 'Profession', 'Started at', 'Ended at'],
    // One course's written answers, newest first, one per id — read from the anonymised survey
    // export SURGdash keeps (survey_raw: every column verbatim, with the respondent's country and
    // profession and the completion time), so every open question counts, not only the ones the
    // feedback list picked up.
    tmResponses(courseId) {
        const d = this._tmLatest()[courseId], raw = this._rawSurveyResponses, v = d && raw && raw[d.Course];
        if (!v || !Array.isArray(v.cols) || !Array.isArray(v.data)) return [];
        this._tmRespCache = this._tmRespCache || {};
        const c = this._tmRespCache[courseId];
        if (c && c.src === v && c.n === v.data.length) return c.list;
        const cols = v.cols, at = (name) => cols.indexOf(name);
        const iC = at('Country'), iP = at('Profession'), iE = at('Ended at') >= 0 ? at('Ended at') : at('Started at');
        const blank = (x) => { const t = String(x == null ? '' : x).trim(); return !t || /^(no data|nan|n\/?a|none|-|no|non|nada|aucun)$/i.test(t); };
        const scale = [], text = [];
        cols.forEach((h, i) => {
            if (this.TM_META.indexOf(h) >= 0) return;
            const vals = v.data.map(r => r[i]).filter(x => !blank(x));
            if (!vals.length) return;
            if (vals.every(x => /^\s*[0-5]\s*$/.test(String(x)))) scale.push(i); else text.push(i);
        });
        const iR = scale.find(i => this.TM_SAT.test(cols[i])) != null ? scale.find(i => this.TM_SAT.test(cols[i])) : scale[0];
        const lang = this._tmSurveyLang(cols), seen = new Set(), list = [];
        const isTime = (t) => this._isTimestampText ? this._isTimestampText(t) : /^\d{1,2} \w{3} \d{4} \d\d:\d\d/.test(t);
        v.data.forEach(r => {
            const date = iE >= 0 ? this._tmDate(r[iE]) : '', stars = iR != null ? (Number(r[iR]) || 0) : 0;
            text.forEach(i => {
                const t = String(r[i] == null ? '' : r[i]).trim();
                if (blank(t) || t.length < 3 || isTime(t)) return;
                const id = this.tmResponseId(courseId, date, t);
                if (seen.has(id)) return; seen.add(id);
                list.push({ id, courseId, text: t, q: cols[i], date, stars: stars >= 1 && stars <= 5 ? stars : 0, cadre: this._tmCadre(iP >= 0 ? r[iP] : ''), country: String(iC >= 0 ? r[iC] || '' : '').trim(),
                    lang: this._tmLang(t, lang), words: t.split(/\s+/).length });
            });
        });
        list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
        this._tmRespCache[courseId] = { src: v, n: v.data.length, list };
        return list;
    },
    _tmQLabel(q) {
        const t = String(q || '');
        return /most interesting|plus intéressant|más interesante|الأكثر/i.test(t) ? 'Most interesting' : /less engaging|moins intéressant|menos interesante|الأقل/i.test(t) ? 'Less engaging' : /technical|technique|técnic|تقنية/i.test(t) ? 'Technical issues' : /additional|other comment|autres commentaires|comentario|تعليقات/i.test(t) ? 'Other comments' : t.slice(0, 40);
    },
    _tmSuggested(r) { return r.stars >= 4 && r.words >= this.TM_SUGGEST_WORDS && !!r.cadre && !!r.country; },

    // ── seeding from the testimonials live on surghub.org (26 Oct 2026) ──
    // rows: { slug, sheet_course_name?, position, query (text to find), alt (a second text to try), display, cadre, country, stars }.
    // A row matches when exactly one comment of that course is the same text (case, spacing,
    // punctuation and quote marks ignored) or a light edit of it; several equally good candidates are
    // settled only by cadre + country + stars all agreeing with exactly one — otherwise reported.
    _tmTokens(t) { return this._tmNorm(t).split(' ').filter(Boolean); },
    _tmScore(q, c) {
        if (q.join(' ') === c.join(' ')) return 1;
        const bag = {}; c.forEach(w => { bag[w] = (bag[w] || 0) + 1; });
        let common = 0; q.forEach(w => { if (bag[w]) { bag[w]--; common++; } });
        const dice = 2 * common / (q.length + c.length), inC = common / q.length;
        if (q.length < 5) return 0;                                   // short texts: exact only
        return Math.max(dice, inC >= 0.9 && q.length >= 8 ? 0.85 + (inC - 0.9) : 0);   // a trimmed or lightly edited original
    },
    _tmSameCountry(a, b) {
        if (!a || !b) return true;
        const iso = (x) => (window.countryToISO && window.countryToISO(x)) || this._tmNorm(x);
        return iso(a) === iso(b);
    },
    _tmSameCadre(site, ours) {
        const s = this._tmNorm(site), o = this._tmNorm(ours);
        if (!s || !o || /surghub learner/.test(s)) return true;
        const key = { 'specialist surgeon': 'surgeon', 'general medical officer': 'medical officer', 'non clinical professional': 'non clinical', 'emergency medicine doctor': 'emergency', 'anaesthesiologist': 'anaesthes', 'nurse anaesthetist': 'anaesthetist' }[o] || o;
        return s.includes(key) || (key === 'surgeon' && /surgeon/.test(s)) || (o === 'nurse' && /nurs/.test(s)) || (key === 'anaesthes' && /anaesthes|anesthes/.test(s)) || (o === 'physician' && /physician|doctor|medical/.test(s));
    },
    tmMatchRows(rows, from) {
        const report = { from, rows: rows.length, matched: [], none: [], several: [], differs: [], duplicate: [] };
        const feed = this._tmCourseFeed(), bySlug = {};
        feed.courses.forEach(c => { bySlug[c.slug] = c.id; bySlug[c.id] = c.id; });
        const byName = {}; Object.values(this._tmLatest()).forEach(d => { byName[String(d.Course).trim().toLowerCase()] = d.CourseId; });
        const taken = {};
        rows.forEach((row, i) => {
            const label = { line: i + 2, slug: row.slug, position: row.position, text: String(row.display || row.query).slice(0, 140) };
            const courseId = bySlug[row.slug] || byName[String(row.sheet_course_name || '').trim().toLowerCase()];
            if (!courseId) { report.none.push(Object.assign(label, { why: 'course not found' })); return; }
            // the original answer first; the text as shown when the original finds nothing
            let q = [], scored = [];
            for (const t of [row.query, row.alt].filter(Boolean)) {
                q = this._tmTokens(t);
                scored = this.tmResponses(courseId).map(r => ({ r, s: this._tmScore(q, this._tmTokens(r.text)) })).filter(x => x.s >= 0.8).sort((a, b) => b.s - a.s);
                if (scored.length) break;
            }
            const checks = (r) => ({ stars: !row.stars || !r.stars || Number(row.stars) === r.stars, country: this._tmSameCountry(row.country, r.country), cadre: this._tmSameCadre(row.cadre, r.cadre) });
            const allOk = (r) => { const c = checks(r); return c.stars && c.country && c.cadre; };
            let pick = null, how = '';
            if (scored.length === 1 || (scored.length > 1 && scored[0].s - scored[1].s >= 0.1)) { pick = scored[0]; how = scored[0].s === 1 ? 'exact' : 'near'; }
            else if (scored.length > 1) {
                const top = scored.filter(x => scored[0].s - x.s < 0.1), ok = top.filter(x => allOk(x.r));
                if (ok.length === 1) { pick = ok[0]; how = 'settled by cadre, country and stars'; }
                else { report.several.push(Object.assign(label, { candidates: top.length, agreeing: ok.length })); return; }
            }
            if (!pick) {
                const elsewhere = Object.keys(this._tmLatest()).filter(id => id !== courseId && this.tmResponses(id).some(r => this._tmScore(q, this._tmTokens(r.text)) >= 0.9));
                report.none.push(Object.assign(label, { why: elsewhere.length ? 'only in another course: ' + elsewhere.slice(0, 3).map(id => this._tmLatest()[id].Course).join('; ') : 'no comment like it in this course' }));
                return;
            }
            const r = pick.r;
            if (taken[r.id]) { report.duplicate.push(Object.assign(label, { sameAs: 'line ' + taken[r.id] })); return; }
            taken[r.id] = i + 2;
            const c = checks(r);
            if (!c.stars || !c.country || !c.cadre) report.differs.push(Object.assign({}, label, { site: [row.cadre, row.country, row.stars].join(' · '), survey: [r.cadre || '—', r.country || '—', r.stars || '—'].join(' · '),
                fields: Object.keys(c).filter(k => !c[k]).join(', ') }));
            report.matched.push(Object.assign(label, { id: r.id, courseId, how, score: Math.round(pick.s * 100) / 100, row }));
        });
        return report;
    },
    // Apply a match report: switched on, in the page's order, with the page's text — and the cadre /
    // country the page shows (kept as set by hand; "SURGhub Learner" or blank means none).
    async tmApplySeed(report) {
        await this._tmLoad();
        const now = new Date().toISOString();
        report.matched.forEach(m => {
            const row = m.row, e = this._tm.byId[m.id] || (this._tm.byId[m.id] = { course: m.courseId });
            e.show = true; e.order = Number(row.position) || 0;
            const text = String(row.display || '').trim().replace(/^["“”«]+|["“”»]+$/g, '').trim();
            if (text) e.text = text;
            if (row.cadre && !/^surghub learner$/i.test(String(row.cadre).trim())) e.cadre = String(row.cadre).trim();
            if (row.country) e.country = String(row.country).trim();
            if (row.stars) e.stars = Number(row.stars);
            e.seed = { from: report.from, position: Number(row.position) || 0 }; e.at = now;
        });
        Object.keys(this._tm.byId).forEach(id => { const e = this._tm.byId[id]; if (e.show && !this._tm.reviewed[e.course]) this._tm.reviewed[e.course] = now; });
        await this._tmSave();
    },

    // ── testimonials.json ──
    _tmCourseFeed(feed) {
        if (feed && feed.courses) return feed;
        return this._cfFeedNow ? this._cfFeedNow() : (this.coursesFeedBuild ? this.coursesFeedBuild() : { courses: [] });
    },
    _tmHeld(text) { return !!(this.scrubPersonal && this.scrubPersonal(text) !== text); },
    testimonialsFeedBuild(feed, now) {
        const t = now || new Date(), out = { as_of: t.toISOString().slice(0, 10), updated_at: t.toISOString(), courses: {} };
        const stats = { courses: 0, testimonials: 0, missing: 0, held: 0 };
        const byCourse = {};
        Object.keys((this._tm && this._tm.byId) || {}).forEach(id => { const e = this._tm.byId[id]; if (e && e.show) (byCourse[e.course] = byCourse[e.course] || []).push([id, e]); });
        this._tmCourseFeed(feed).courses.forEach(c => {
            const chosen = byCourse[c.id]; if (!chosen) return;
            const resp = {}; this.tmResponses(c.id).forEach(r => { resp[r.id] = r; });
            const items = chosen.map(([id, e]) => {
                const r = resp[id];
                if (!r) { stats.missing++; return null; }
                const text = String(e.text || r.text).trim();
                if (!text || this._tmHeld(text)) { stats.held++; return null; }
                const o = { id, text };
                const cadre = e.cadre != null ? e.cadre : r.cadre, country = e.country != null ? e.country : r.country, stars = e.stars || r.stars;
                if (cadre) o.cadre = cadre;
                if (country) o.country = country;
                if (stars) o.stars = stars;
                o.lang = r.lang;
                return { o, order: Number(e.order) || 9999, date: r.date };
            }).filter(Boolean).sort((a, b) => a.order - b.order || String(b.date).localeCompare(String(a.date))).map(x => x.o);
            if (items.length) { out.courses[c.slug] = items; stats.courses++; stats.testimonials += items.length; }
        });
        Object.defineProperty(out, '_stats', { value: stats, enumerable: false });
        return out;
    },
    // The file to publish. Never an empty file over a non-empty one (keeps the last instead).
    async testimonialsFeedFile(opts) {
        opts = opts || {};
        await this._tmLoad();
        const f = this.testimonialsFeedBuild(opts.feed), st = this._tmState || {}, prev = (st.last && st.last.count) || 0;
        const why = !f._stats.testimonials && prev ? 'no testimonials switched on (the last file had ' + prev + ')' : '';
        const content = !why ? JSON.stringify(f, null, 2) + '\n' : (st.last && st.last.content) || null;
        return { content, fresh: !why, why, count: f._stats.testimonials, courses: f._stats.courses, stats: f._stats };
    },
    async _tmMarkPublished(f) {
        const st = this._tmState || {};
        if (f && f.fresh && f.content) st.last = { at: new Date().toISOString(), count: f.count, courses: f.courses, content: f.content };
        this._tmState = st;
        try { await Storage.setItem(this.TM_STATE_KEY, st, { internal: true }); } catch (e) { __swallowed(e, 'tm.state'); }
    },
    // The published file's courses, as JSON text (compared with what would be built now).
    _tmLiveCourses() {
        const txt = this._tmState && this._tmState.last && this._tmState.last.content;
        if (!txt) return '';
        if (this._tmLiveSrc !== txt) { let c = ''; try { c = JSON.stringify(JSON.parse(txt).courses || {}); } catch (e) { c = ''; } this._tmLiveJson = c; this._tmLiveSrc = txt; }
        return this._tmLiveJson;
    },

    // ── editing (Testimonials tab) ──
    async tmToggle(id, courseId) {
        await this._tmLoad();
        const e = this._tm.byId[id] || (this._tm.byId[id] = { course: courseId });
        e.show = !e.show; e.at = new Date().toISOString();
        if (e.show && !e.order) e.order = Math.max(0, ...Object.values(this._tm.byId).filter(x => x.course === e.course && x.show && x !== e).map(x => Number(x.order) || 0)) + 1;
        await this._tmSave(); this.rerenderDashTab ? this.rerenderDashTab() : this.renderView();
    },
    async tmMove(id, dir) {
        await this._tmLoad();
        const e = this._tm.byId[id]; if (!e) return;
        const list = Object.entries(this._tm.byId).filter(([, x]) => x.course === e.course && x.show).sort((a, b) => (Number(a[1].order) || 9999) - (Number(b[1].order) || 9999));
        const i = list.findIndex(([k]) => k === id), j = i + dir;
        if (j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        list.forEach(([, x], k) => { x.order = k + 1; });
        await this._tmSave(); this.rerenderDashTab ? this.rerenderDashTab() : this.renderView();
    },
    async tmSetField(id, courseId, field, value) {
        await this._tmLoad();
        const e = this._tm.byId[id] || (this._tm.byId[id] = { course: courseId });
        const v = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
        if (v) e[field] = field === 'stars' ? Number(v) : v; else delete e[field];
        e.at = new Date().toISOString();
        await this._tmSave(); this.rerenderDashTab ? this.rerenderDashTab() : this.renderView();
    },
    // Off the "Switched off" list and back into the plain comment list. The entry
    // stays (with any edited text), so switching it on again still brings that back.
    async tmForget(id) {
        await this._tmLoad();
        const e = this._tm.byId[id]; if (!e || e.show) return;
        delete e.show; e.at = new Date().toISOString();
        await this._tmSave(); this.rerenderDashTab ? this.rerenderDashTab() : this.renderView();
    },
    async tmMarkReviewed(courseId) { await this._tmLoad(); this._tm.reviewed[courseId] = new Date().toISOString(); await this._tmSave(); this.rerenderDashTab ? this.rerenderDashTab() : this.renderView(); },
    tmPickCourse(courseId) { this._tmCourse = courseId || null; this._tmShowN = this.TM_PAGE; this.rerenderDashTab ? this.rerenderDashTab() : this.renderView(); },
    tmSetFilter(k, v) { this._tmFilter = Object.assign({}, this._tmFilter || {}, { [k]: v }); this._tmShowN = this.TM_PAGE; this.rerenderDashTab ? this.rerenderDashTab() : this.renderView(); },
    tmMore() { this._tmShowN = (this._tmShowN || this.TM_PAGE) + this.TM_PAGE; this.rerenderDashTab ? this.rerenderDashTab() : this.renderView(); },

    _dashTestimonialsHtml() {
        if (!this._tm || this._tmState === undefined) { if (!this._tmLoading) { this._tmLoading = true; this._tmLoad().then(() => { this._tmLoading = false; if (this._dashTab === 'testimonials') (this.rerenderDashTab ? this.rerenderDashTab() : this.renderView()); }); } return '<div class="p-10 text-sm text-slate-400">Loading testimonials…</div>'; }
        if (this._cfMeta === undefined && this._cfLoad) { this._cfMeta = null; this._cfLoad().then(() => { if (this._dashTab === 'testimonials') (this.rerenderDashTab ? this.rerenderDashTab() : this.renderView()); }); }
        if (this._rawCompletion == null && this.ensureCompletionLoaded && !this._completionLoadPromise) this.ensureCompletionLoaded().then(() => { if (this._dashTab === 'testimonials') (this.rerenderDashTab ? this.rerenderDashTab() : this.renderView()); });
        const esc = (t) => this.escapeHtml(String(t == null ? '' : t));
        const feed = this._tmCourseFeed(), built = this.testimonialsFeedBuild(feed);
        const pendingN = this._tmLiveCourses() !== JSON.stringify(built.courses);
        const head = '<div class="flex items-end justify-between gap-4 flex-wrap mb-5"><div><h2 class="text-xl font-bold text-gsf-prussian">Testimonials on surghub.org</h2>'
            + '<p class="text-sm text-slate-500 mt-1 max-w-3xl">Choose the learner comments each course page shows. New comments come in switched off; nothing appears on the site until someone switches it on here. Changes go online at the next publish (nightly, or Publish now).</p></div>'
            + '<div class="text-right text-xs text-slate-500"><strong class="text-gsf-prussian text-base">' + this.formatNumber(built._stats.testimonials) + '</strong> shown on <strong class="text-gsf-prussian">' + built._stats.courses + '</strong> course pages'
            + (built._stats.held ? ' · <span class="text-rose-600">' + built._stats.held + ' held back (personal details)</span>' : '') + (built._stats.missing ? ' · <span class="text-amber-700">' + built._stats.missing + ' no longer in the survey</span>' : '')
            + '<br>' + (pendingN ? '<span class="text-amber-700">changes not online yet</span> <button data-edit-only onclick="App.publishWebsiteMetrics(this)" class="ml-1 font-bold text-gsf-boston hover:underline">Publish now</button>' : '<span class="text-emerald-700">online as shown</span>') + '</div></div>';
        const courses = feed.courses.map(c => {
            const resp = this.tmResponses(c.id), rev = this._tm.reviewed[c.id] || '';
            const shown = Object.values(this._tm.byId).filter(e => e.course === c.id && e.show).length;
            const isNew = (r) => !rev || String(r.date) > rev.slice(0, 10);
            const chosen = new Set(Object.keys(this._tm.byId).filter(id => this._tm.byId[id].course === c.id && this._tm.byId[id].show));
            const off = Object.values(this._tm.byId).filter(e => e.course === c.id && e.show === false).length;
            return { c, n: resp.length, shown, off, waiting: resp.filter(r => isNew(r) && !chosen.has(r.id)).length, suggested: resp.filter(r => !chosen.has(r.id) && this._tmSuggested(r)).length };
        });
        if (!this._tmCourse || !feed.courses.some(c => c.id === this._tmCourse)) {
            const rows = courses.filter(x => x.n).sort((a, b) => (a.shown >= 3) - (b.shown >= 3) || a.shown - b.shown || b.waiting - a.waiting || a.c.title.localeCompare(b.c.title)).map(x => {
                const tone = !x.shown ? 'text-rose-600 bg-rose-50 border-rose-200' : x.shown < 3 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200';
                return '<tr class="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onclick="App.tmPickCourse(\'' + this.escapeJsArg(x.c.id) + '\')">'
                    + '<td class="py-2 px-3 text-xs font-bold text-gsf-prussian">' + esc(x.c.title) + '</td><td class="py-2 px-3 text-xs text-slate-500 truncate max-w-[200px]">' + esc(x.c.provider) + '</td>'
                    + '<td class="py-2 px-3 text-center"><span class="inline-block min-w-[28px] px-2 py-0.5 rounded-full border text-[11px] font-bold ' + tone + '">' + x.shown + '</span>' + (x.off ? '<span class="block text-[10px] text-slate-400 mt-0.5" title="Switched off: open the course to put them back">' + x.off + ' off</span>' : '') + '</td>'
                    + '<td class="py-2 px-3 text-right text-xs ' + (x.waiting ? 'font-bold text-amber-700' : 'text-slate-400') + '">' + this.formatNumber(x.waiting) + '</td>'
                    + '<td class="py-2 px-3 text-right text-xs text-slate-600">' + this.formatNumber(x.suggested) + '</td><td class="py-2 px-3 text-right text-xs text-slate-400">' + this.formatNumber(x.n) + '</td></tr>';
            }).join('');
            const none = courses.filter(x => !x.n).length;
            return head + '<div class="bg-white rounded-xl shadow-sm border overflow-hidden"><div class="overflow-x-auto max-h-[640px] overflow-y-auto custom-scrollbar"><table class="w-full text-left border-collapse text-sm">'
                + '<thead class="sticky top-0 bg-white shadow-sm"><tr class="border-b text-slate-500 text-xs"><th class="py-2 px-3 font-medium">Course</th><th class="py-2 px-3 font-medium">Provider</th><th class="py-2 px-3 font-medium text-center" title="Testimonials switched on for the course page">Shown</th>'
                + '<th class="py-2 px-3 font-medium text-right" title="Comments received since the course was last marked reviewed">New</th><th class="py-2 px-3 font-medium text-right" title="4–5 stars, ' + this.TM_SUGGEST_WORDS + '+ words, cadre and country known">Suggested</th><th class="py-2 px-3 font-medium text-right">Comments</th></tr></thead><tbody>'
                + rows + '</tbody></table></div>' + (none ? '<p class="text-[11px] text-slate-400 px-4 py-2 border-t">' + none + ' public course' + (none === 1 ? '' : 's') + ' with no written comments yet are not listed.</p>' : '') + '</div>';
        }
        // one course
        const c = feed.courses.find(x => x.id === this._tmCourse), cid = c.id, cidJs = this.escapeJsArg(cid);
        const all = this.tmResponses(cid), rev = this._tm.reviewed[cid] || '', fl = this._tmFilter || {};
        const ent = (id) => this._tm.byId[id] || {};
        const shownList = all.filter(r => ent(r.id).show).sort((a, b) => (Number(ent(a.id).order) || 9999) - (Number(ent(b.id).order) || 9999));
        const isNew = (r) => !rev || String(r.date) > rev.slice(0, 10);
        // Comments that were on the page and were switched off keep their own list,
        // most recent first: otherwise they sink into hundreds of comments, filtered
        // and paged, and are hard to find again. show === false only ever comes
        // from switching one off (tmForget clears it).
        const offList = all.filter(r => ent(r.id).show === false).sort((a, b) => String(ent(b.id).at || '').localeCompare(String(ent(a.id).at || '')));
        let rest = all.filter(r => !ent(r.id).show && ent(r.id).show !== false);
        if (fl.fresh) rest = rest.filter(isNew);
        if (fl.stars === '5') rest = rest.filter(r => r.stars === 5); else if (fl.stars === '4') rest = rest.filter(r => r.stars >= 4); else if (fl.stars === 'low') rest = rest.filter(r => r.stars && r.stars <= 3);
        if (fl.lang) rest = rest.filter(r => r.lang === fl.lang);
        if (fl.suggested) rest = rest.filter(r => this._tmSuggested(r));
        const stars = (n) => n ? '<span class="text-amber-500 tracking-tight">' + '★'.repeat(n) + '<span class="text-slate-200">' + '★'.repeat(5 - n) + '</span></span>' : '<span class="text-slate-300 text-[10px]">no rating</span>';
        const card = (r, i, n) => {
            const e = ent(r.id), on = !!e.show, idJs = this.escapeJsArg(r.id), disp = e.text || r.text, held = on && this._tmHeld(disp);
            const meta = [e.cadre != null ? e.cadre : r.cadre, e.country != null ? e.country : r.country].filter(Boolean).join(' · ') || 'SURGhub learner';
            return '<div class="border rounded-xl p-4 mb-3 ' + (on ? 'border-gsf-boston bg-sky-50/40' : 'border-slate-200 bg-white') + '">'
                + '<div class="flex items-center gap-2 flex-wrap text-[11px] text-slate-500">' + stars(r.stars) + '<span class="font-semibold text-slate-700">' + esc(meta) + '</span><span class="uppercase text-[10px] font-bold text-slate-400">' + esc(r.lang) + '</span>'
                + '<span class="text-[10px] text-slate-400 truncate max-w-[260px]" title="' + esc(r.q) + '">' + esc(this._tmQLabel(r.q)) + '</span>'
                + (this._tmSuggested(r) && !on ? '<span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-bold">suggested</span>' : '')
                + (isNew(r) && !on ? '<span class="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-bold">new</span>' : '')
                + (held ? '<span class="px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 text-[10px] font-bold" title="The display text contains an email, phone number or learner name: it is not published until edited">held back: personal details</span>' : '')
                + (!on && e.text && e.text !== r.text ? '<span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold" title="Switching it on again brings back your edited text, cadre and country">edits kept</span>' : '')
                + '<span class="ml-auto">' + esc(r.date) + '</span>'
                + (on ? '<span class="inline-flex items-center gap-0.5 ml-2" data-edit-only><button onclick="App.tmMove(\'' + idJs + '\', -1)" ' + (i === 0 ? 'disabled ' : '') + 'class="px-1.5 py-0.5 border rounded text-slate-500 hover:text-gsf-boston disabled:opacity-30" title="Move up">▲</button><button onclick="App.tmMove(\'' + idJs + '\', 1)" ' + (i === n - 1 ? 'disabled ' : '') + 'class="px-1.5 py-0.5 border rounded text-slate-500 hover:text-gsf-boston disabled:opacity-30" title="Move down">▼</button><span class="ml-1 font-bold text-gsf-prussian">#' + (i + 1) + '</span></span>' : '')
                + '<label class="inline-flex items-center gap-1.5 ml-2 cursor-pointer font-bold ' + (on ? 'text-gsf-boston' : 'text-slate-500') + '" data-edit-only><input type="checkbox" ' + (on ? 'checked ' : '') + 'onchange="App.tmToggle(\'' + idJs + '\', \'' + cidJs + '\')"> Show on SURGhub</label></div>'
                + '<p class="text-sm text-slate-700 mt-2 whitespace-pre-line">' + esc(r.text) + '</p>'
                + (on ? '<div class="mt-3" data-edit-only><label class="text-[10px] font-bold uppercase tracking-wide text-slate-400">Text on the course page' + (e.text && e.text !== r.text ? ' · edited' : '') + '</label>'
                    + '<textarea rows="2" onchange="App.tmSetField(\'' + idJs + '\', \'' + cidJs + '\', \'text\', this.value)" class="w-full mt-1 text-sm border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-gsf-boston/30">' + esc(disp) + '</textarea>'
                    + '<div class="flex gap-3 mt-1 text-[11px] text-slate-500 flex-wrap"><span>Cadre <input value="' + esc(e.cadre != null ? e.cadre : r.cadre) + '" placeholder="SURGhub learner" onchange="App.tmSetField(\'' + idJs + '\', \'' + cidJs + '\', \'cadre\', this.value)" class="border rounded px-1.5 py-0.5 w-44"></span>'
                    + '<span>Country <input value="' + esc(e.country != null ? e.country : r.country) + '" onchange="App.tmSetField(\'' + idJs + '\', \'' + cidJs + '\', \'country\', this.value)" class="border rounded px-1.5 py-0.5 w-36"></span>'
                    + (e.text && e.text !== r.text ? '<button onclick="App.tmSetField(\'' + idJs + '\', \'' + cidJs + '\', \'text\', \'\')" class="underline hover:text-gsf-boston">back to the original</button>' : '') + '</div></div>' : '')
                + '</div>';
        };
        const sel = (k, opts) => '<select onchange="App.tmSetFilter(\'' + k + '\', this.value)" class="text-xs border rounded-lg px-2 py-1.5">' + opts.map(([v, l]) => '<option value="' + v + '"' + ((fl[k] || '') === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
        const langs = [...new Set(all.map(r => r.lang))].sort();
        const max = this._tmShowN || this.TM_PAGE;
        const x = courses.find(y => y.c.id === cid) || { waiting: 0 };
        return head + '<div class="mb-4 flex items-center gap-3 flex-wrap"><button onclick="App.tmPickCourse(null)" class="text-xs font-bold text-gsf-boston hover:underline">← All courses</button>'
            + '<h3 class="text-lg font-bold text-gsf-prussian">' + esc(c.title) + '</h3><span class="text-xs text-slate-400">' + esc(c.provider) + ' · ' + this.formatNumber(all.length) + ' comments · ' + x.waiting + ' new since ' + (rev ? 'review on ' + esc(rev.slice(0, 10)) : 'never reviewed') + '</span>'
            + '<button data-edit-only onclick="App.tmMarkReviewed(\'' + cidJs + '\')" class="ml-auto px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 hover:border-gsf-boston text-gsf-prussian" title="Everything received until now stops counting as new">Mark reviewed</button></div>'
            + '<div class="bg-white rounded-xl shadow-sm border p-5 mb-5"><h4 class="text-sm font-bold text-gsf-prussian mb-3">On the course page (' + shownList.length + ')</h4>'
            + (shownList.length ? shownList.map((r, i) => card(r, i, shownList.length)).join('') : '<p class="text-sm text-slate-400">None yet: switch comments on below.</p>') + '</div>'
            + (offList.length ? '<div class="bg-white rounded-xl shadow-sm border border-dashed p-5 mb-5"><h4 class="text-sm font-bold text-gsf-prussian">Switched off (' + offList.length + ')</h4>'
                + '<p class="text-xs text-slate-500 mt-0.5 mb-3">Were on the course page. Tick one to put it back; your edits come back with it. "Forget" moves it into the comments below.</p>'
                + offList.map(r => card(r, 0, 0).replace(/<\/div>$/, '<div class="mt-2 text-right" data-edit-only><button onclick="App.tmForget(\'' + this.escapeJsArg(r.id) + '\')" class="text-[11px] text-slate-400 hover:text-gsf-boston hover:underline">Forget</button></div></div>')).join('') + '</div>' : '')
            + '<div class="bg-white rounded-xl shadow-sm border p-5"><div class="flex items-center gap-2 flex-wrap mb-3"><h4 class="text-sm font-bold text-gsf-prussian mr-2">Comments (' + rest.length + ')</h4>'
            + '<label class="inline-flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" ' + (fl.fresh ? 'checked ' : '') + 'onchange="App.tmSetFilter(\'fresh\', this.checked)"> New since last review</label>'
            + '<label class="inline-flex items-center gap-1 text-xs text-slate-600 ml-2"><input type="checkbox" ' + (fl.suggested ? 'checked ' : '') + 'onchange="App.tmSetFilter(\'suggested\', this.checked)"> Suggested only</label>'
            + sel('stars', [['', 'All stars'], ['5', '5 stars'], ['4', '4–5 stars'], ['low', '1–3 stars']]) + sel('lang', [['', 'All languages']].concat(langs.map(l => [l, l.toUpperCase()]))) + '</div>'
            + rest.slice(0, max).map(r => card(r, 0, 0)).join('')
            + (rest.length > max ? '<button onclick="App.tmMore()" class="w-full py-2 text-xs font-bold text-gsf-boston hover:underline">Show ' + Math.min(this.TM_PAGE, rest.length - max) + ' more of ' + (rest.length - max) + '</button>' : '')
            + (!rest.length ? '<p class="text-sm text-slate-400">No comments match these filters.</p>' : '') + '</div>';
    },
});
