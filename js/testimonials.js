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
// Also one small file per public course, testimonials/<slug>.json = { course, testimonials: […] } (an empty
// list when none are chosen, so a page never meets a 404), without timestamps so it only changes when that
// course's choices do — a course page loads ~1 KB instead of the whole file (Seb, 26 Oct 2026).
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
        await this._tmJudgeLoad();
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
        if (/[؀-ۿ]/.test(t)) return 'ar';
        const n = (re) => (t.match(re) || []).length;
        const s = {
            en: n(/\b(the|and|is|was|very|of|to|it|this|i|my|for|with|that|in|we|our|how)\b/g),
            fr: n(/\b(le|les|des|est|très|une|pour|avec|du|je|j'ai|nous|cours|été|et|sur|mon|aussi|mais|qui|dans|au|aux|cette|ce)\b/g) + 2 * n(/[èêçàùœ]/g),
            es: n(/\b(el|los|las|es|muy|una|para|con|que|del|por|curso|fue|más|y|sobre|mi|ahora|cada|lo|nos|pero|también|este|esta|como|en)\b/g) + 2 * n(/[ñ¿¡]|ción\b/g),
        };
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
        v.data.forEach((r, row) => {
            const date = iE >= 0 ? this._tmDate(r[iE]) : '', stars = iR != null ? (Number(r[iR]) || 0) : 0;
            text.forEach(i => {
                const t = String(r[i] == null ? '' : r[i]).trim();
                if (blank(t) || t.length < 3 || isTime(t)) return;
                const id = this.tmResponseId(courseId, date, t);
                if (seen.has(id)) return; seen.add(id);
                list.push({ id, courseId, text: t, q: cols[i], date, stars: stars >= 1 && stars <= 5 ? stars : 0, cadre: this._tmCadre(iP >= 0 ? r[iP] : ''), country: String(iC >= 0 ? r[iC] || '' : '').trim(),
                    lang: this._tmLang(t, lang), words: t.split(/\s+/).length, row });   // row: one survey submission = one learner
            });
        });
        list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
        this._tmRespCache[courseId] = { src: v, n: v.data.length, list };
        return list;
    },
    _tmQLabel(q) {
        const t = String(q || '');
        return /less engaging|least useful|could be improved|moins intéressant|menos interesante|peores aspectos|الأقل/i.test(t) ? 'Less engaging'
            : /most interesting|most useful|like most|plus intéressant|más interesante|mejores aspectos|الأكثر/i.test(t) ? 'Most interesting' : /technical|technique|técnic|تقنية/i.test(t) ? 'Technical issues' : /additional|other comment|autres commentaires|comentario|تعليقات/i.test(t) ? 'Other comments' : t.slice(0, 40);
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
        const stats = { courses: 0, testimonials: 0, missing: 0, held: 0, otherLang: 0 };
        const byCourse = {};
        Object.keys((this._tm && this._tm.byId) || {}).forEach(id => { const e = this._tm.byId[id]; if (e && e.show) (byCourse[e.course] = byCourse[e.course] || []).push([id, e]); });
        this._tmCourseFeed(feed).courses.forEach(c => {
            const chosen = byCourse[c.id]; if (!chosen) return;
            const resp = {}; this.tmResponses(c.id).forEach(r => { resp[r.id] = r; });
            const lang = this._tmPageLang(c.id);
            let items = chosen.map(([id, e]) => {
                const r = resp[id];
                if (!r) { stats.missing++; return null; }
                if (r.lang !== lang) { stats.otherLang++; return null; }   // only comments written in the page's language
                const text = String(e.text || r.text).trim();
                if (!text || this._tmHeld(text)) { stats.held++; return null; }
                const o = { id, text };
                const lb = this._tmLabels(e, r, lang), cadre = lb.cadre, country = lb.country, stars = e.stars || r.stars;
                if (cadre) o.cadre = cadre;
                if (country) o.country = country;
                if (stars) o.stars = stars;
                o.lang = r.lang;
                return { o, order: Number(e.order) || 9999, date: r.date };
            }).filter(Boolean).sort((a, b) => a.order - b.order || String(b.date).localeCompare(String(a.date))).map(x => x.o);
            items = this._tmArrange ? this._tmArrange(c.id, items, t) : items;
            if (items.length) { out.courses[c.slug] = items; stats.courses++; stats.testimonials += items.length; }
        });
        Object.defineProperty(out, '_stats', { value: stats, enumerable: false });
        return out;
    },
    // Cadre and country as the page in `lang` shows them (testimonialLabels.js); '' set by hand = none.
    _tmLabels(e, r, lang) {
        let c = e.cadre != null ? e.cadre : r.cadre;
        const k = e.country != null ? e.country : r.country;
        // "as a physiotherapist…": the label must agree with the text, or be empty (Seb, 27 Oct 2026)
        const j = e.cadre == null && r && this._tmVerdict ? this._tmVerdict(e.course || r.courseId, r) : null;
        if (j && j.role) {
            const said = this._tmCadreIndex ? this._tmCadreIndex()[this._tmNorm(j.role)] : null, now = this._tmCadreIndex ? this._tmCadreIndex()[this._tmNorm(c)] : null;
            if (said) c = said[0];
            else if (!now || this._tmNorm(c) !== this._tmNorm(j.role)) c = '';
        }
        return { cadre: this.tmCadreLabel ? this.tmCadreLabel(c, lang) : c, country: this.tmCountryLabel ? this.tmCountryLabel(k, lang) : k };
    },
    // Display texts switched on for more than one course: [{ text, where: [{ id, course }] }].
    tmDuplicates() {
        const by = {};
        Object.entries((this._tm && this._tm.byId) || {}).forEach(([id, e]) => {
            if (!e.show) return;
            const r = this.tmResponses(e.course).find(x => x.id === id);
            const t = this._tmNorm(e.text || (r && r.text) || ''); if (!t) return;
            (by[t] = by[t] || []).push({ id, course: e.course, text: e.text || (r && r.text) });
        });
        return Object.values(by).filter(l => new Set(l.map(x => x.course)).size > 1).map(l => ({ text: l[0].text, where: l }));
    },
    // The file to publish. Never an empty file over a non-empty one (keeps the last instead).
    async testimonialsFeedFile(opts) {
        opts = opts || {};
        await this._tmLoad();
        const f = this.testimonialsFeedBuild(opts.feed), st = this._tmState || {}, prev = (st.last && st.last.count) || 0;
        const why = !f._stats.testimonials && prev ? 'no testimonials switched on (the last file had ' + prev + ')' : '';
        const content = !why ? JSON.stringify(f, null, 2) + '\n' : (st.last && st.last.content) || null;
        return { content, fresh: !why, why, count: f._stats.testimonials, courses: f._stats.courses, stats: f._stats, perCourse: this._tmPerCourseFiles(content, opts.feed) };
    },
    // testimonials/<slug>.json for every public course, from the file being published.
    _tmPerCourseFiles(content, feed) {
        let all = {}; try { all = (JSON.parse(content || '{}').courses) || {}; } catch (e) { all = {}; }
        const slugs = new Set(this._tmCourseFeed(feed).courses.map(c => c.slug).concat(Object.keys(all)));
        return [...slugs].filter(sl => /^[a-z0-9][a-z0-9-]*$/i.test(sl)).sort()
            .map(sl => ({ path: 'testimonials/' + sl + '.json', content: JSON.stringify({ course: sl, testimonials: all[sl] || [] }, null, 1) + '\n' }));
    },
    // Git's id for a file's content (sha1 of "blob <bytes>\0<content>"), to upload only what changed.
    async _gitBlobSha(text) {
        const body = new TextEncoder().encode(text), head = new TextEncoder().encode('blob ' + body.length + '\0');
        const all = new Uint8Array(head.length + body.length); all.set(head); all.set(body, head.length);
        const h = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
        return Array.from(h).map(b => b.toString(16).padStart(2, '0')).join('');
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

    // ── picking the best automatically (Seb, 26 Oct 2026) ──
    // For a course with no (or few) testimonials: up to TM_PICK_N comments, screened by the same Claude
    // scoring the Feedback tab uses (surghub_feedback_ai, keyed by djb2 of the text). A pick must be from
    // a praise question ("most interesting" / other comments — never "less engaging" or technical
    // issues), rated 4–5 stars, not junk, pass the privacy scrub, and be marked quotable with an AI score
    // of TM_PICK_MIN or more. Best first; near-duplicates skipped; one per country first, then the rest.
    // The AI's cleaned quote becomes the display text. Fewer good ones → fewer picks. Picks carry `auto`
    // (shown as "picked automatically" until someone edits or reorders them).
    TM_PICK_N: 6, TM_PICK_MIN: 6,
    _tmTarget() { return Number(((this._tm && this._tm.settings) || {}).target) || this.TM_PICK_N; },   // Settings, else the default
    _tmMinimum() { return Number(((this._tm && this._tm.settings) || {}).min) || 4; },
    // ── the testimonial check (Seb, 26 Oct 2026) ──
    // The report scorer (surghub_feedback_ai) never sees the course, so a fluent comment about drugs on
    // the wound course scored 9 "quotable", and its impact-story scale kept short good comments ("Very well
    // laid out module.") under the bar. This check asks the question that matters here — would this work
    // on THIS course's page? — with the course title, the question and the comment, on a stronger model.
    // Cached per course + comment in surghub_testimonial_ai: { v: 'use'|'weak'|'no', r: reason, s: 1–5 }.
    TM_JUDGE_MODEL: 'claude-opus-5-5', TM_JUDGE_EFFORT: 'low', TM_JUDGE_BATCH: 20,
    TM_JUDGE_COST: 0.0021,   // USD per comment on Opus 5.5 at low effort, display text included (measured 27 Oct 2026; shown before a run)
    TM_REASON: { good: 'a good testimonial', generic: 'generic praise', fragment: 'a fragment that only makes sense next to the question', off_topic: 'not about this course',
        notes: 'course notes or a list, not an experience', personal: 'personal details (patient, health, names, under 18)', complaint: 'a complaint or request', suggestion: 'mainly a suggestion for the course',
        clinical_claim: 'a clinical claim', platform: 'about the platform, not this course', unclear: 'unclear', machine: 'reads machine-written, not about this course' },
    // Version 2 (Seb, 27 Oct 2026): also specific vs generic, the learner's self-described role (labels
    // must agree), suggestions, clinical claims, platform remarks. Editable in Settings; a changed
    // instruction or model makes earlier verdicts stale, and the next scan checks them again.
    // Version 3 (Seb, 27 Oct 2026, after the first scan proposed 200+ changes, many poor): v2 passed
    // topic phrases that only answer the survey question ("Comparison between different Surgical
    // methods", "Teaching on how to use both the left and right hands for 2 hand knots.") as "use", and
    // judged long comments before their suggestions were cut. Now the check first makes the display
    // text with the editing rule (appended from Settings), then judges that text as a reader would see
    // it; the text is stored with the verdict, shown on every suggestion and used as is when accepted.
    TM_JUDGE_PROMPT: 'You choose learner comments from end-of-course surveys to show as testimonials on that course\'s public page on SURGhub, the United Nations Global Surgery Learning Hub (free online surgical training, mostly for clinicians in low- and middle-income countries). On the page a testimonial stands alone, in quotation marks, under the learner\'s profession and country. Readers have not seen the survey question. Be strict: a course page is better with three good testimonials than with six where one is poor, and every comment you pass may go online without a person reading it first.\n\n'
        + 'For each item (course title, survey question, comment):\n'
        + '1. text: make the display text from the comment with the editing rule below. A long comment usually holds one or two sentences worth showing: keep those and cut the rest. If nothing usable is left, leave text empty.\n'
        + '2. Judge the display text as a reader of the course page sees it:\n'
        + '- verdict "use": in the learner\'s own voice, it tells the reader what this course gave them (what they learned, valued, or will now do differently) together with their view of it, as a complete thought. "Being quizzed on the depth of burns as we went was very helpful." "Le contenu est clair, structuré et directement applicable à la pratique clinique." "Very well laid out module." (use, strength 3)\n'
        + '- verdict "weak": complete, but bland: praise or thanks that could sit on any course. "Excellent course, thank you." "Thank you so much for a concise but high yield course."\n'
        + '- verdict "no": anything else. Most often a fragment: a phrase that names a topic, technique or format with no view of it, which only made sense as an answer to the survey question. "Comparison between different Surgical methods." "Teaching on how to use both the left and right hands for 2 hand knots." "Clear concepts of margins and prognosis." "The one on one interview and back and forth conversation with thorough storytelling of the case." "Understanding vulnerable patient populations alongside structural frameworks for clinician mental health support." Being specific does not rescue a fragment; a topic followed by the learner\'s view of it is not a fragment.\n'
        + '- reason: "good" (use); "generic" (weak); otherwise the main problem: "fragment"; "notes" (course notes, headings, a list, or a summary of the content rather than the learner\'s experience); "off_topic" (about another course or subject than this course); "personal" (the learner\'s own or a patient\'s health, names or other personal details, or shows the learner is under 18); "complaint"; "suggestion" (nothing left once suggestions and requests are cut); "clinical_claim" (states clinical facts or advice as its main content); "platform" (about SURGhub or online learning in general, not this course); "unclear"; "machine" (reads like generated text not grounded in this course).\n'
        + '- strength 1-5, for use and weak: 5 = specific to this course and says what it gave the learner or how they will use it, credible and vivid; 4 = specific with the learner\'s view, or a strong view in their own words; 3 = clear, positive and complete but general; 2 = bland; 1 = says almost nothing. For no, 1.\n'
        + '- specific: true if it says something about THIS course (a topic, technique, case, format detail) or the learner\'s own context ("as a scrub nurse…"); false if it could sit on any course.\n'
        + '- self_role: the learner\'s own profession or role as they state it in the comment ("physiotherapist", "medical student", "patient"), in English; empty if they do not say.\n'
        + 'Judge each comment in its own language and keep the display text in that language.\n\n'
        + 'The editing rule for the display text:',
    TM_JUDGE_SCHEMA: { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: { i: { type: 'integer' }, text: { type: 'string' },
        verdict: { type: 'string', enum: ['use', 'weak', 'no'] }, reason: { type: 'string', enum: ['good', 'generic', 'fragment', 'off_topic', 'notes', 'personal', 'complaint', 'suggestion', 'clinical_claim', 'platform', 'unclear', 'machine'] },
        strength: { type: 'integer' }, specific: { type: 'boolean' }, self_role: { type: 'string' } },
        required: ['i', 'text', 'verdict', 'reason', 'strength', 'specific', 'self_role'], additionalProperties: false } } }, required: ['results'], additionalProperties: false },
    _tmJudgePrompt() { return (this.tmSetting && this.tmSetting('judgePrompt')) || this.TM_JUDGE_PROMPT; },
    // The whole instruction sent: the check, then the editing rule's own rules (its "- " lines; all of it if customised without them).
    _tmJudgeSystem() {
        const rule = this._tmTidyPrompt(), lines = rule.split('\n').filter(l => /^- /.test(l));
        return this._tmJudgePrompt() + '\n' + (lines.length ? lines.join('\n') : rule);
    },
    _tmSuggestMin() { return Number(this.tmSetting ? this.tmSetting('suggestMin') : 4) || 4; },
    _tmJudgeModel() { return (this.tmSetting && this.tmSetting('judgeModel')) || this.TM_JUDGE_MODEL; },
    _tmJudgeVersion() {   // asked for every comment on screen: hashed again only when the model or an instruction changes
        const m = this._tmJudgeModel(), a = this._tmJudgePrompt(), b = this._tmTidyPrompt(), c = this._tmJvFor;
        if (!c || c[0] !== m || c[1] !== a || c[2] !== b) this._tmJvFor = [m, a, b, this._tmHash(m + '|' + this._tmJudgeSystem())];
        return this._tmJvFor[3];
    },
    async _tmJudgeLoad() { if (!this._tmJudge) { let v = null; try { v = await Storage.getItem('surghub_testimonial_ai'); } catch (e) { v = null; } this._tmJudge = (v && typeof v === 'object') ? v : {}; } return this._tmJudge; },
    _tmJudgeKey(courseId, text) { return courseId + '|' + this._tmAiKey(text); },
    _tmVerdict(courseId, r) { return r && this._tmJudge ? this._tmJudge[this._tmJudgeKey(courseId, r.text)] || null : null; },
    // Judge the comments that have no verdict yet. items: [{ courseId, course (title), r }]. Asks first.
    async _tmJudgeMissing(items, btn) {
        await this._tmJudgeLoad();
        const pv = this._tmJudgeVersion();
        // An older verdict is checked again only where the answer can change what happens: testimonials on
        // the page, and comments it rated good enough to suggest. Its rejections and low ratings are kept:
        // every new instruction so far has been stricter (Seb, 27 Oct 2026: no paying twice for the same no).
        const least = this._tmSuggestMin(), seen = new Set();
        let kept = 0;
        const todo = items.filter(x => {
            const k = this._tmJudgeKey(x.courseId, x.r.text), j = this._tmJudge[k];
            if (seen.has(k)) return false; seen.add(k);
            if (!j) return true;
            if (j.pv === pv) return false;
            if (x.shown || (j.v === 'use' && j.s >= least)) return true;
            kept++; return false;
        });
        const stale = todo.filter(x => this._tmJudge[this._tmJudgeKey(x.courseId, x.r.text)]).length;
        if (!todo.length) return true;
        const apiKey = this._getAnthropicKey ? await this._getAnthropicKey() : null;
        if (!apiKey || !this._claudeJSON) { alert('The testimonial check needs the Anthropic API key (Feedback tab → Score with AI). Using the older report scores instead.'); return false; }
        if (!confirm('Check ' + todo.length.toLocaleString() + ' comments with the testimonial check (' + this._tmJudgeModel() + ')' + (stale ? ', ' + stale.toLocaleString() + ' of them checked before with an older instruction (on the page, or good enough to suggest)' : '') + (kept ? '. ' + kept.toLocaleString() + ' earlier rejections and low ratings are kept, not paid for again' : '') + ': does each work on its course\'s page, or is it a fragment, off-topic, notes, personal…?\n\nAbout ' + Math.ceil(todo.length / this.TM_JUDGE_BATCH) + ' requests, roughly $' + Math.max(1, Math.round(todo.length * this.TM_JUDGE_COST)) + '. Each comment is checked once and remembered.')) return false;
        let done = 0, failed = 0;
        const B = this.TM_JUDGE_BATCH;
        for (let i = 0; i < todo.length; i += B) {
            const batch = todo.slice(i, i + B);
            if (btn) btn.textContent = 'Checking comments ' + Math.min(i + B, todo.length).toLocaleString() + '/' + todo.length.toLocaleString() + '…';
            try {
                const res = await this._claudeJSON(apiKey, this._tmJudgeSystem(), JSON.stringify(batch.map((x, k) => ({ i: k, course: x.course, question: x.r.q, comment: x.r.text }))), this.TM_JUDGE_SCHEMA, 16000, { model: this._tmJudgeModel(), effort: this.TM_JUDGE_EFFORT });
                (res && res.results || []).forEach(r => { const x = batch[r.i]; if (x && ['use', 'weak', 'no'].includes(r.verdict)) { const t = r.verdict === 'no' ? '' : this._tmCleanEdit(r.text), v = t ? r.verdict : 'no';   // nothing left once edited: no
                    this._tmJudge[this._tmJudgeKey(x.courseId, x.r.text)] = { v, r: v === r.verdict ? r.reason : 'suggestion', s: Math.max(1, Math.min(5, Number(r.strength) || 1)), sp: !!r.specific, role: String(r.self_role || '').trim(), t, pv, at: new Date().toISOString().slice(0, 10) }; done++; } });
                if ((i / B) % 5 === 4) { try { await Storage.setItem('surghub_testimonial_ai', this._tmJudge); } catch (e) { __swallowed(e, 'tm.judgeSave'); } }
            } catch (e) { __swallowed(e, 'tm.judge'); failed++; if (/Invalid Anthropic API key/.test(e.message) || failed >= 3) { alert('The testimonial check stopped: ' + e.message + '\n\nWhat was checked is kept; run it again to continue.'); break; } }
        }
        try { await Storage.setItem('surghub_testimonial_ai', this._tmJudge); } catch (e) { __swallowed(e, 'tm.judgeSave'); }
        return done > 0;
    },
    // What to send to the check: everything shown, and candidates the report scorer did not rule out (0–2: bare thanks, junk).
    _tmJudgeItems(courseIds) {
        const feed = this._tmCourseFeed(), title = {}; feed.courses.forEach(c => { title[c.id] = c.title; });
        const scores = this._aiScoreMap || {}, out = [];
        courseIds.forEach(id => {
            const resp = {}; this.tmResponses(id).forEach(r => { resp[r.id] = r; });
            Object.entries(this._tm.byId).forEach(([rid, e]) => { if (e.course === id && e.show && resp[rid]) out.push({ courseId: id, course: title[id] || '', r: resp[rid], shown: true }); });
            this._tmCandidates(id).forEach(r => { const a = scores[this._tmAiKey(r.text)]; if (!a || a.s >= 3) out.push({ courseId: id, course: title[id] || '', r }); });
        });
        return out;
    },
    // One quality view for picking and reviewing: the testimonial check where it has run, else the report score.
    // ok = may be picked; rank (0–10) orders them; weak = a reason to take a shown one off; label for the screen.
    _tmQ(courseId, r) {
        const j = this._tmVerdict(courseId, r);
        if (j) return { judged: true, ok: j.v === 'use', no: j.v === 'no', s: j.v === 'use' ? j.s : 0, text: j.t && j.pv === this._tmJudgeVersion() ? j.t : '', rank: j.v === 'use' ? j.s * 2 : j.v === 'weak' ? Math.min(j.s, 1) : 0,
            label: j.v === 'use' ? 'testimonial ' + j.s + '/5' : j.v === 'weak' ? 'weak: ' + (this.TM_REASON[j.r] || j.r) : 'not a testimonial: ' + (this.TM_REASON[j.r] || j.r),
            weak: j.v === 'no' ? (this.TM_REASON[j.r] || j.r) : '' };
        const a = r && (this._aiScoreMap || {})[this._tmAiKey(r.text)];
        if (!a) return { judged: false, ok: false, no: false, rank: null, label: 'not checked', weak: '' };
        const ok = !!(a.q && a.s >= this.TM_PICK_MIN && !(a.t || []).includes('complaint'));
        return { judged: false, ok, no: false, rank: a.q && !(a.t || []).includes('complaint') ? a.s : 0, label: 'report score ' + a.s + '/10', weak: ok ? '' : 'report score ' + a.s + '/10' + (a.q ? '' : ', not quotable') };
    },

    // The text shown on the course page: a light copy-edit made for this purpose (not the report
    // scorer's cached quote, which cut too much: "The structured decision-making algorithms for flap
    // selection…" said nothing on its own, and an em-dash rewrite read as fake — Seb, 26 Oct 2026).
    TM_TIDY_MODEL: 'claude-opus-5-5',
    // The editing rule (Seb, 26 Oct 2026, after the review of the first rewrites: they had started to
    // sound alike — "I found the sections…", "Overall, the course was…"). Also shown as help by the text box.
    TM_EDIT_RULE: ['Correct spelling, typos, capitals, spacing and punctuation; add a full stop if missing.',
        'Change words only where the meaning would otherwise be unclear, and as little as possible.',
        'Keep only what the learner valued, learned or will use: cut suggestions ("It would be even better if…", "Please add…"), wishes, complaints, technical problems and side remarks.',
        'Shorten by cutting whole sentences or clauses, never by rewording (60 words at most).',
        'Keep the learner\'s own words, word order, tone and grammar, informal or non-native phrasing included.',
        'Add no phrases ("I found…", "most interesting", "Overall,"), merge no ideas, never translate.',
        'Remove names, other people\'s details, personal health details and anything showing the learner is under 18; switch it off if nothing useful is left.',
        'No em dashes (a comma or full stop instead) and no quote marks (the site adds its own).',
        'A comment that needs no changes is shown exactly as written.'],
    TM_TIDY_PROMPT: 'You lightly edit learner comments for display as testimonials on the public page of a SURGhub course (SURGhub is the United Nations Global Surgery Learning Hub: free online surgical training, mostly for clinicians in low- and middle-income countries). Each item gives the course title, the survey question and the learner\'s original comment. Return the display text, following these rules exactly:\n'
        + '- Correct spelling, typos, capitalisation, spacing and punctuation. Add a full stop at the end if it is missing.\n'
        + '- Change words only where the meaning would otherwise be unclear. Keep any such change as small as possible.\n'
        + '- Keep only the parts that say what the learner valued, learned or will use from this course. Cut sentences or clauses that are suggestions or wishes ("It would be even better if…", "Please add…", "more interactive elements would help"), complaints, technical problems or remarks unrelated to the course. Cut, never reword. If nothing is left, the comment is dropped.\n'
        + '- Cut words that only answer the survey question and mean nothing on their own ("None.", "N/A", "Nothing to add.", "Yes,").\n'
        + '- From a numbered or bulleted list, keep only items that read as complete statements on their own, without their numbers or bullets.\n'
        + '- Shorten a long comment by cutting whole sentences or clauses, never by rewording. Aim for 60 words at most.\n'
        + '- Keep the learner\'s own words, word order, tone and grammar, including informal or non-native phrasing that is still clear. Do not polish it.\n'
        + '- Do not add phrases (such as "I found…", "most interesting", "Overall,"), do not merge ideas, and do not translate: keep the comment in the language it was written in.\n'
        + '- Remove learner names, other people\'s personal details, personal health details and anything showing the learner is under 18. If that leaves nothing useful, the comment is dropped.\n'
        + '- No em dashes or en dashes: use a comma or a full stop. No quotation marks around the text and no stray quote marks.\n'
        + '- If the comment needs no changes, return it exactly as written.\n'
        + 'When a comment is dropped, set drop to true and say why in reason; otherwise leave drop false and reason empty.',
    _tmTidyPrompt() { return (this.tmSetting && this.tmSetting('editPrompt')) || this.TM_TIDY_PROMPT; },
    TM_TIDY_SCHEMA: { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: { i: { type: 'integer' }, text: { type: 'string' }, drop: { type: 'boolean' }, reason: { type: 'string' } }, required: ['i', 'text', 'drop', 'reason'], additionalProperties: false } } }, required: ['results'], additionalProperties: false },
    // What the model returns, made safe: dashes → comma, outer and stray quote marks out, a final full stop.
    _tmCleanEdit(t) {
        let q = String(t || '').replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ',').trim();
        q = q.replace(/^["“”«»]+|["“”«»]+$/g, '').replace(/(^|\s)["“”](?=\s|$)/g, '$1').trim();
        if (q && !/[.!?…؟)]$/.test(q)) q += '.';
        return q;
    },
    // Edit texts for the course page: items [{ r (response), course (title) }] → { id: { text } | { drop, reason } }
    // (quietly {} without a key).
    async _tmTidy(items, btn) {
        if (!items.length || !this._claudeJSON || !this._getAnthropicKey) return {};
        const apiKey = await this._getAnthropicKey(); if (!apiKey) return {};
        const out = {};
        for (let i = 0; i < items.length; i += 12) {
            const batch = items.slice(i, i + 12);
            if (btn) btn.textContent = 'Tidying texts ' + Math.min(i + 12, items.length) + '/' + items.length + '…';
            try {
                const res = await this._claudeJSON(apiKey, this._tmTidyPrompt(), JSON.stringify(batch.map((x, k) => ({ i: k, course: x.course, question: x.r.q, comment: x.r.text }))), this.TM_TIDY_SCHEMA, 16000, { model: this.TM_TIDY_MODEL, effort: 'low' });
                (res && res.results || []).forEach(r => {
                    const x = batch[r.i]; if (!x) return;
                    if (r.drop) { out[x.r.id] = { drop: true, reason: String(r.reason || 'nothing useful left once personal details are removed') }; return; }
                    const q = this._tmCleanEdit(r.text);
                    if (q && !this._tmHeld(q)) out[x.r.id] = { text: q };
                });
            } catch (e) { __swallowed(e, 'tm.tidy'); if (/Invalid Anthropic API key/.test(e.message)) break; }
        }
        return out;
    },
    // The check's display text (made with the editing rule) becomes the text on the page; false when there is none.
    // Only from a verdict made with the current instruction and editing rule.
    _tmCheckText(courseId, r) { const j = this._tmVerdict(courseId, r); return j && j.t && j.pv === this._tmJudgeVersion() ? j.t : ''; },
    _tmUseCheckText(id, r, courseId) {
        const t = this._tmCheckText(courseId, r); if (!t || this._tmHeld(t)) return false;
        return !!this._tmApplyEdit(id, r, { text: t });
    },
    _tmApplyEdit(id, r, res) {
        const e = this._tm.byId[id]; if (!e || !res) return '';
        if (res.drop) { e.show = false; e.removed = { at: new Date().toISOString(), why: 'personal details: ' + res.reason }; return 'dropped'; }
        if (res.text === String(r.text).trim()) { delete e.text; return 'original'; }
        e.text = res.text; return 'edited';
    },
    // Re-edit the display text of the given testimonials (default: every one switched on) with TM_TIDY_PROMPT.
    async tmRetidy(ids, btn) {
        await this._tmLoad();
        const feed = this._tmCourseFeed(), title = {}; feed.courses.forEach(c => { title[c.id] = c.title; });
        const want = ids && ids.length ? ids : Object.keys(this._tm.byId).filter(id => this._tm.byId[id].show);
        const items = [], fromCheck = [];   // the scan's own display text where it has one (same rule, no second call)
        want.forEach(id => { const e = this._tm.byId[id]; const r = e && this.tmResponses(e.course).find(x => x.id === id); if (r) (this._tmCheckText(e.course, r) ? fromCheck : items).push({ r, course: title[e.course] || '', cid: e.course }); });
        if (!(ids && ids.length) && !confirm('Re-edit the course-page text of all ' + want.length + ' testimonials switched on, from the learners\' original comments, with the light-editing rule?\n\n' + fromCheck.length + ' take the text the last scan made; ' + Math.ceil(items.length / 12) + ' requests to Claude for the rest. Texts edited by hand are redone too.')) return 0;
        fromCheck.forEach(x => { if (this._tmUseCheckText(x.r.id, x.r, x.cid)) this._tm.byId[x.r.id].at = new Date().toISOString(); });
        if (!items.length) { await this._tmSave(); this.showMsg('✓ ' + fromCheck.length + ' texts set from the last scan.'); this.rerenderDashTab ? this.rerenderDashTab() : this.renderView(); return fromCheck.length; }
        const label = btn && btn.textContent; if (btn) btn.disabled = true;
        try {
            const q = await this._tmTidy(items, btn);
            if (!Object.keys(q).length) { alert('Could not tidy the texts (no Anthropic API key, or the request failed).'); return 0; }
            const n = { edited: 0, original: 0, dropped: 0 };
            items.forEach(x => { const k = this._tmApplyEdit(x.r.id, x.r, q[x.r.id]); if (k) { n[k]++; this._tm.byId[x.r.id].at = new Date().toISOString(); } });
            await this._tmSave();
            this.showMsg('✓ ' + (fromCheck.length ? fromCheck.length + ' set from the last scan, ' : '') + n.edited + ' lightly edited, ' + n.original + ' shown as written' + (n.dropped ? ', ' + n.dropped + ' switched off (personal details)' : '') + '.', n.dropped ? 'warn' : false);
            return Object.keys(q).length;
        } finally { if (btn) { btn.disabled = false; btn.textContent = label; } this.rerenderDashTab ? this.rerenderDashTab() : this.renderView(); }
    },
    _tmAiKey(t) { return this._djb2Hash ? this._djb2Hash(String(t).trim()) : this._tmHash(String(t).trim()); },
    _tmPraiseQ(q) { const l = this._tmQLabel(q); return l === 'Most interesting' || l === 'Other comments'; },
    // The course page's language: its survey's (a French course's page shows French comments).
    _tmPageLang(courseId) {
        const d = this._tmLatest()[courseId], v = d && this._rawSurveyResponses && this._rawSurveyResponses[d.Course];
        return v && v.cols ? this._tmSurveyLang(v.cols) : 'en';
    },
    _tmCandidates(courseId) {
        const lang = this._tmPageLang(courseId);
        const chosen = new Set(Object.keys(this._tm.byId).filter(id => this._tm.byId[id].course === courseId && this._tm.byId[id].show));
        const no = (id) => !!(this._tm.byId[id] && this._tm.byId[id].rejected);
        return this.tmResponses(courseId).filter(r => !chosen.has(r.id) && !no(r.id) && r.lang === lang && this._tmPraiseQ(r.q) && r.stars >= 4 && !(this._isJunkFeedback && this._isJunkFeedback(r.text)) && !this._tmHeld(r.text));
    },
    // Score candidates the AI has not seen yet (asks first). Returns false when it could not.
    async _tmScoreMissing(list, btn) {
        if (!this._getAiScores || !this._claudeScoreBatch) return false;
        const scores = await this._getAiScores(), todo = [], seen = new Set();
        list.forEach(r => { const h = this._tmAiKey(r.text); if (!scores[h] && !seen.has(h)) { seen.add(h); todo.push({ h, t: r.text.trim() }); } });
        if (!todo.length) return true;
        const apiKey = this._getAnthropicKey ? await this._getAnthropicKey() : null;
        if (!apiKey) { alert('To screen comments the AI has not scored yet, SURGdash needs the Anthropic API key (Feedback tab → Score with AI). Picking from the comments already scored.'); return false; }
        if (!confirm(todo.length + ' candidate comments have not been screened by the AI yet.\n\nScore them now with Claude (' + Math.ceil(todo.length / 30) + ' requests, a few cents) so they can be picked?\n\nCancel picks from the comments already scored.')) return false;
        for (let i = 0; i < todo.length; i += 30) {
            const batch = todo.slice(i, i + 30);
            if (btn) btn.textContent = 'Screening comments ' + Math.min(i + 30, todo.length) + '/' + todo.length + '…';
            try {
                const results = await this._claudeScoreBatch(apiKey, batch.map(b => b.t));
                results.forEach(r => {
                    const item = batch[r.i]; if (!item) return;
                    const sc = Math.max(0, Math.min(10, Number(r.score) || 0)), themes = Array.isArray(r.themes) ? r.themes.slice(0, 4) : [];
                    scores[item.h] = { s: sc, q: !!r.quotable && sc > 0, t: themes, l: String(r.language || ''), c: (r.quotable || themes.includes('suggestion') || themes.includes('complaint')) ? String(r.quote || '').trim() : '' };
                });
                await Storage.setItem('surghub_feedback_ai', scores);
            } catch (e) { __swallowed(e, 'tm.score'); if (/Invalid Anthropic API key/.test(e.message)) { alert(e.message); return false; } }
        }
        this._aiScoreMap = scores;
        return true;
    },
    // Pick for one course; returns how many were added.
    _tmPickCourse(courseId) {
        const scores = this._aiScoreMap || {}, shown = Object.values(this._tm.byId).filter(e => e.course === courseId && e.show);
        const slots = this._tmTarget() - shown.length;
        if (slots <= 0) return 0;
        const good = this._tmCandidates(courseId).map(r => ({ r, q: this._tmQ(courseId, r) })).filter(x => x.q.ok)
            .sort((x, y) => y.q.rank - x.q.rank || (!!(y.r.cadre && y.r.country) - !!(x.r.cadre && x.r.country)) || String(y.r.date).localeCompare(String(x.r.date)));
        const toks = (t) => this._tmTokens(t);
        const dice = (a, b) => { const bag = {}; b.forEach(w => { bag[w] = (bag[w] || 0) + 1; }); let c = 0; a.forEach(w => { if (bag[w]) { bag[w]--; c++; } }); return 2 * c / ((a.length + b.length) || 1); };
        const taken = shown.map(e => toks(e.text || '')), countries = new Set(shown.map(e => e.country).filter(Boolean)), picks = [];
        const respOf = {}; this.tmResponses(courseId).forEach(r => { respOf[r.id] = r; });
        const shownR = Object.entries(this._tm.byId).filter(([, e]) => e.course === courseId && e.show).map(([id]) => respOf[id]).filter(Boolean);
        const rows = new Set(shownR.map(r => r.row)), generic = { n: shownR.filter(r => this._tmGeneric(courseId, r)).length };
        for (const pass of [1, 2]) {
            for (const x of good) {
                if (picks.length >= slots) break;
                if (picks.includes(x)) continue;
                const disp = x.r.text, t = toks(disp);
                if (taken.some(o => dice(t, o) >= 0.6)) continue;
                if (rows.has(x.r.row) || (this._tmGeneric(courseId, x.r) && generic.n) || this._tmSiteCapped(x.r)) continue;   // one per learner; one generic; site cap
                if (pass === 1 && x.r.country && countries.has(x.r.country)) continue;
                picks.push(x); taken.push(t); if (x.r.country) countries.add(x.r.country); rows.add(x.r.row); if (this._tmGeneric(courseId, x.r)) generic.n++;
                x.disp = disp;
            }
        }
        let order = Math.max(0, ...shown.map(e => Number(e.order) || 0));
        const at = new Date().toISOString();
        picks.forEach(x => {
            const e = this._tm.byId[x.r.id] || (this._tm.byId[x.r.id] = { course: courseId });
            e.show = true; e.order = ++order; e.at = at; e.auto = { at, score: x.q.rank, label: x.q.label };
            delete e.text;   // tidied by tmPickBest (TM_TIDY_PROMPT); the original until then
        });
        return picks;
    },
    // courseIds: the courses to fill (default: every public course with comments and none shown).
    async tmPickBest(courseIds, btn) {
        await this._tmLoad();
        const feed = this._tmCourseFeed();
        const ids = courseIds && courseIds.length ? courseIds : feed.courses.filter(c => !Object.values(this._tm.byId).some(e => e.course === c.id && e.show) && this.tmResponses(c.id).length).map(c => c.id);
        if (!ids.length) { this.showMsg('Every course with comments already has testimonials.'); return { picked: 0, courses: 0 }; }
        const label = btn && btn.textContent; if (btn) { btn.disabled = true; btn.textContent = 'Picking…'; }
        try {
            await this._tmScoreMissing(ids.flatMap(id => this._tmCandidates(id)), btn);
            if (this._getAiScores) await this._getAiScores();
            await this._tmJudgeMissing(this._tmJudgeItems(ids), btn);
            this._tmRel = this._tmRelational();
            const title = {}; feed.courses.forEach(c => { title[c.id] = c.title; });
            const res = ids.map(id => { const p = this._tmPickCourse(id); return { id, n: p.length, picks: p }; });
            const all = res.flatMap(x => x.picks.map(p => ({ r: p.r, course: title[x.id] || '' })));
            const tidy = await this._tmTidy(all, btn);
            all.forEach(x => this._tmApplyEdit(x.r.id, x.r, tidy[x.r.id]));
            await this._tmSave();
            const picked = res.reduce((t, x) => t + x.n, 0), full = res.filter(x => x.n >= this._tmTarget()).length, few = res.filter(x => x.n && x.n < this._tmTarget()).length, none = res.filter(x => !x.n).length;
            this.showMsg('✓ Picked ' + picked + ' testimonial' + (picked === 1 ? '' : 's') + ' for ' + (ids.length - none) + ' course' + (ids.length - none === 1 ? '' : 's') + (few ? ' (' + few + ' with fewer than ' + this._tmTarget() + ': not enough good comments)' : '') + (none ? '; ' + none + ' had no comment good enough' : '') + '. Marked "picked automatically" — they go online at the next publish.', none || few ? 'warn' : false);
            return { picked, courses: ids.length, full, few, none, res: res.map(x => ({ id: x.id, n: x.n })) };
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = label; }
            this.rerenderDashTab ? this.rerenderDashTab() : this.renderView();
        }
    },

    // ── review every course: better or newer comments for what is shown (Seb, 26 Oct 2026) ──
    // Proposals, applied only by a person: 'add' (a course with fewer than TM_PICK_N), 'replace' (a
    // comment that scores higher than a shown one, or the same and is newer), 'weak' (a shown one below
    // the bar — not quotable, AI score under TM_PICK_MIN, under 4 stars, a "less engaging" answer or
    // personal details — with nothing better to take its place). Testimonials marked keep are never
    // proposed for replacement; a candidate marked "not this one" (rejected) is never proposed again.
    // ── selection rules (Seb, 27 Oct 2026; apply to every course) ──
    // one per learner per course (a survey row is one learner's submission); at most one generic comment
    // per course; a learner whose near-identical comment sits on several courses: at most TM_SITE_CAP of
    // them site-wide, kept where the text is most specific; a mix of countries and cadres.
    TM_SITE_CAP: 3,
    _tmDice(a, b) { const bag = {}; b.forEach(w => { bag[w] = (bag[w] || 0) + 1; }); let c = 0; a.forEach(w => { if (bag[w]) { bag[w]--; c++; } }); return 2 * c / ((a.length + b.length) || 1); },
    // The learner behind a response, across courses: a hash of their email, through the course's feedback
    // list (FeedbackBank keeps the email on this Mac). In memory only: never stored with the choices or published.
    _tmWho(courseId, r) {
        const d = this._tmLatest()[courseId]; if (!d || !d.FeedbackBank || !r) return '';
        this._tmWhoCache = this._tmWhoCache || {};
        let c = this._tmWhoCache[courseId];
        if (!c || c.src !== d.FeedbackBank) { const m = {}; try { (JSON.parse(d.FeedbackBank) || []).forEach(f => { if (f && f.e && f.t) m[String(f.t).trim()] = this._tmHash(String(f.e).toLowerCase()); }); } catch (e) { /* none */ } c = this._tmWhoCache[courseId] = { src: d.FeedbackBank, m }; }
        return c.m[String(r.text).trim()] || '';
    },
    _tmGeneric(courseId, r) { const j = this._tmVerdict(courseId, r); return !!(j && j.pv && !j.sp); },
    // Problems that only show next to the others: { responseId: reason }. Also remembers, per
    // cadre|country, the texts shown site-wide (candidates near-identical to TM_SITE_CAP of them are skipped).
    _tmRelational() {
        const out = {}, groups = {}, site = {};
        const feed = this._tmCourseFeed();
        feed.courses.forEach(c => {
            const resp = {}; this.tmResponses(c.id).forEach(r => { resp[r.id] = r; });
            const shown = Object.entries(this._tm.byId).filter(([, e]) => e.course === c.id && e.show).map(([id, e]) => ({ id, e, r: resp[id] })).filter(x => x.r);
            const strength = (x) => { const q = this._tmQ(c.id, x.r); return (q.rank || 0) + (this._tmGeneric(c.id, x.r) ? 0 : 0.5); };
            const byRow = {}; shown.forEach(x => { (byRow[x.r.row] = byRow[x.r.row] || []).push(x); });
            Object.values(byRow).filter(l => l.length > 1).forEach(l => l.sort((a, b) => strength(b) - strength(a)).slice(1).forEach(x => { out[x.id] = 'the same learner twice on this course'; }));
            const gen = shown.filter(x => !out[x.id] && this._tmGeneric(c.id, x.r) && !this._tmQ(c.id, x.r).no).sort((a, b) => strength(b) - strength(a));
            gen.slice(1).forEach(x => { out[x.id] = 'a second generic comment on this course'; });
            shown.forEach(x => { const lb = [x.r.cadre, x.r.country].join('|'), t = this._tmTokens(x.e.text || x.r.text); (groups[lb] = groups[lb] || []).push({ x, c: c.id, t, sp: !this._tmGeneric(c.id, x.r), s: strength(x) }); });
        });
        const byWho = {}, whoCourses = {};
        Object.values(groups).flat().forEach(y => { const w = this._tmWho(y.c, y.x.r); if (w) { (byWho[w] = byWho[w] || []).push(y); y.w = w; } });
        Object.entries(byWho).forEach(([w, l]) => {
            whoCourses[w] = new Set(l.map(y => y.c));
            if (whoCourses[w].size <= this.TM_SITE_CAP) return;
            const best = {}; l.slice().sort((a, b) => (b.sp - a.sp) || (b.s - a.s)).forEach(y => { if (!best[y.c] && Object.keys(best).length < this.TM_SITE_CAP) best[y.c] = y; });
            l.forEach(y => { if (best[y.c] !== y && !out[y.x.id]) out[y.x.id] = 'this learner is on ' + whoCourses[w].size + ' courses (at most ' + this.TM_SITE_CAP + ', kept where most specific)'; });
        });
        this._tmWhoCourses = whoCourses;
        Object.entries(groups).forEach(([lb, l]) => {
            site[lb] = l.filter(y => !y.w).map(y => y.t);
            if (l.length <= this.TM_SITE_CAP || lb === '|') return;
            const seen = new Set();
            l.forEach((y, i) => {
                if (seen.has(i)) return;
                const cl = [y]; seen.add(i);
                l.forEach((z, k) => { if (!seen.has(k) && z.c !== y.c && this._tmDice(y.t, z.t) >= 0.6) { cl.push(z); seen.add(k); } });
                if (new Set(cl.map(z => z.c)).size <= this.TM_SITE_CAP) return;
                cl.sort((a, b) => (b.sp - a.sp) || (b.s - a.s)).slice(this.TM_SITE_CAP).forEach(z => { if (!out[z.x.id]) out[z.x.id] = 'near-identical to the same learner\'s comments on ' + (cl.length - 1) + ' other courses'; });
            });
        });
        this._tmSiteTexts = site;
        return out;
    },
    _tmSiteCapped(r) {
        const w = this._tmWho(r.courseId, r), wc = w && this._tmWhoCourses && this._tmWhoCourses[w];
        if (wc) return wc.size >= this.TM_SITE_CAP && !wc.has(r.courseId);   // the learner is already on enough courses
        if (w) return false;
        const l = (this._tmSiteTexts || {})[[r.cadre, r.country].join('|')]; if (!l || !r.cadre && !r.country) return false;
        const t = this._tmTokens(r.text); return l.filter(o => this._tmDice(t, o) >= 0.6).length >= this.TM_SITE_CAP;
    },
    _tmDismissed(key) { return !!(this._tm.dismissed && this._tm.dismissed[key]); },
    _tmShownScore(e, r) { return r ? this._tmQ(e.course, r).rank : null; },   // null: not checked, never replaced on score
    _tmWeak(e, r) {
        if (!r) return 'no longer in the survey export';
        const q = this._tmQ(e.course, r);
        if (q.weak) return q.weak;                                          // the check's own verdict first
        if (this._tmRel && this._tmRel[r.id]) return this._tmRel[r.id];      // then the rules across testimonials
        if (q.rank == null) return '';   // not checked: no verdict
        if (r.stars && r.stars < 4) return r.stars + ' stars';
        if (!this._tmPraiseQ(r.q)) return 'an answer to "' + this._tmQLabel(r.q) + '"';
        if (this._tmHeld(e.text || r.text)) return 'personal details in the text';
        return '';
    },
    _tmReviewCourse(courseId) {
        const scores = this._aiScoreMap || {}, resp = {}; this.tmResponses(courseId).forEach(r => { resp[r.id] = r; });
        const toks = (t) => this._tmTokens(t);
        const dice = (a, b) => { const bag = {}; b.forEach(w => { bag[w] = (bag[w] || 0) + 1; }); let c = 0; a.forEach(w => { if (bag[w]) { bag[w]--; c++; } }); return 2 * c / ((a.length + b.length) || 1); };
        let shown = Object.entries(this._tm.byId).filter(([, e]) => e.course === courseId && e.show).map(([id, e]) => ({ id, e, r: resp[id], s: this._tmShownScore(e, resp[id]), weak: this._tmWeak(e, resp[id]) }));
        // checked comments: only with the current instruction (they carry the page text) and rated at least
        // suggestMin; an older verdict is never enough. Unchecked ones fall back to the report score (no API key).
        const least = this._tmSuggestMin();
        const pool = this._tmCandidates(courseId).map(r => { const q = this._tmQ(courseId, r); return { r, q, a: { s: q.rank } }; }).filter(x => x.q.ok && (!x.q.judged || (x.q.text && x.q.s >= least)) && !this._tmSiteCapped(x.r))
            .sort((x, y) => y.q.rank - x.q.rank || (this._tmGeneric(courseId, x.r) - this._tmGeneric(courseId, y.r)) || String(y.r.date).localeCompare(String(x.r.date)));
        const out = [], used = new Set();
        const textOf = (x) => toks((x.e && x.e.text) || (x.r && x.r.text) || '');
        // not near-identical to one kept; not a learner already on the page; no second generic comment
        const fits = (c, keepers) => { const t = toks(c.r.text); return !keepers.some(k => dice(t, textOf(k)) >= 0.6) && !keepers.some(k => k.r && k.r.row === c.r.row)
            && !(this._tmGeneric(courseId, c.r) && keepers.some(k => k.r && this._tmGeneric(courseId, k.r) && !k.weak && !this._tmQ(courseId, k.r).no)); };
        const next = (keepers, pred) => pool.find(c => !used.has(c.r.id) && fits(c, keepers) && pred(c));
        // a mix: first someone from another country with another cadre, then anyone
        const varied = (keepers) => (c) => !keepers.some(k => k.r && ((c.r.country && k.r.country === c.r.country) || (c.r.cadre && k.r.cadre === c.r.cadre)));
        const upgrade = (this.tmSetting && this.tmSetting('upgrade')) || 'clear';
        // 1. weak ones first (not a testimonial, below the bar): replaced by the best candidates, so applying
        //    everything never leaves them live while fresh ones are only added beside them
        // 2. then empty places; 3. then the rest, lowest first, by something better (or as good and newer)
        const order = shown.filter(x => !x.e.keep).sort((a, b) => (!!b.weak - !!a.weak) || (a.s == null ? 99 : a.s) - (b.s == null ? 99 : b.s) || String((a.r || {}).date || '').localeCompare(String((b.r || {}).date || '')));
        const replaceOne = (w) => {
            const keepers = shown.filter(x => x !== w).concat(out.filter(p => p.type === 'add').map(p => ({ r: p.cand.r })));
            const better = (c) => !this._tmDismissed('rep>' + w.id + '>' + c.r.id) && (!!w.weak || (upgrade === 'clear' ? c.a.s >= w.s + 4 : upgrade === 'newer' ? (c.a.s > w.s || (c.a.s === w.s && String(c.r.date) > String((w.r || {}).date || ''))) : false));
            const c = (w.weak || w.s != null) && next(keepers, better);
            if (c) { used.add(c.r.id); out.push({ type: 'replace', course: courseId, cand: c, newScore: c.a.s, old: w, oldScore: w.s, why: w.weak || (c.a.s > w.s ? 'better (' + c.q.label + ' against ' + (w.r ? this._tmQ(courseId, w.r).label : '?') + ')' : 'as good (' + c.q.label + ') and newer') }); shown = shown.map(x => x === w ? { id: c.r.id, e: {}, r: c.r, s: c.a.s, weak: '' } : x); }
            else if (w.weak && !this._tmDismissed('weak>' + w.id)) out.push({ type: 'weak', course: courseId, old: w, oldScore: w.s, why: w.weak, no: !!(w.r && (this._tmQ(courseId, w.r).no || (this._tmRel && this._tmRel[w.id]))) });
        };
        order.filter(w => w.weak).forEach(replaceOne);
        while (shown.length + out.filter(p => p.type === 'add').length < this._tmTarget()) {
            const keepers = shown.concat(out.filter(p => p.cand).map(p => ({ r: p.cand.r })));
            const ok = (c) => !this._tmDismissed('add>' + c.r.id);
            const c = next(keepers, (c) => ok(c) && varied(keepers)(c)) || next(keepers, ok); if (!c) break;
            used.add(c.r.id); out.push({ type: 'add', course: courseId, cand: c, newScore: c.a.s });
        }
        order.filter(w => !w.weak).forEach(replaceOne);
        return out;
    },
    async tmReviewAll(btn) {
        await this._tmLoad();
        const feed = this._tmCourseFeed(), ids = feed.courses.map(c => c.id).filter(id => this.tmResponses(id).length);
        const label = btn && btn.textContent; if (btn) { btn.disabled = true; btn.textContent = 'Reviewing…'; }
        try {
            // everything shown and every candidate gets an AI verdict first (asks before calling the API)
            const shownR = [];
            ids.forEach(id => { const resp = {}; this.tmResponses(id).forEach(r => { resp[r.id] = r; }); Object.entries(this._tm.byId).forEach(([rid, e]) => { if (e.course === id && e.show && resp[rid]) shownR.push(resp[rid]); }); });
            await this._tmScoreMissing(shownR.concat(ids.flatMap(id => this._tmCandidates(id))), btn);
            if (this._getAiScores) await this._getAiScores();
            await this._tmJudgeMissing(this._tmJudgeItems(ids), btn);
            this._tmRel = this._tmRelational();
            this._tmProposals = ids.flatMap(id => this._tmReviewCourse(id));
            this._tm.lastScan = new Date().toISOString(); await this._tmSave();
            this._tmProposalsAt = new Date().toISOString();
            const n = (t) => this._tmProposals.filter(p => p.type === t).length;
            this.showMsg('Review done: ' + n('replace') + ' replacement' + (n('replace') === 1 ? '' : 's') + ', ' + n('add') + ' addition' + (n('add') === 1 ? '' : 's') + ', ' + n('weak') + ' weak testimonial' + (n('weak') === 1 ? '' : 's') + ' without a better one. Nothing changes until you apply them.');
        } finally { if (btn) { btn.disabled = false; btn.textContent = label; } this._tmCourse = null; this.rerenderDashTab ? this.rerenderDashTab() : this.renderView(); }
    },
    // Apply proposals (indexes into _tmProposals; all when omitted). New texts get the testimonial copy-edit.
    async tmApplyProposals(idx, btn) {
        await this._tmLoad();
        const list = this._tmProposals || [], pick = idx && idx.length ? idx.map(i => list[i]).filter(Boolean) : list.filter(p => p.type !== 'weak');
        if (!pick.length) return 0;
        const label = btn && btn.textContent; if (btn) { btn.disabled = true; btn.textContent = 'Applying…'; }
        try {
            const at = new Date().toISOString(), feed = this._tmCourseFeed(), title = {}; feed.courses.forEach(c => { title[c.id] = c.title; });
            const fresh = [];
            pick.forEach(p => {
                if (p.type === 'weak') { const o = this._tm.byId[p.old.id]; if (o) { o.show = false; o.at = at; o.removed = { at, why: p.why }; } return; }
                let order;
                if (p.type === 'replace') { const o = this._tm.byId[p.old.id]; if (o) { order = o.order; o.show = false; o.at = at; o.replacedBy = p.cand.r.id; } }
                else order = Math.max(0, ...Object.values(this._tm.byId).filter(x => x.course === p.course && x.show).map(x => Number(x.order) || 0)) + 1;
                const e = this._tm.byId[p.cand.r.id] || (this._tm.byId[p.cand.r.id] = { course: p.course });
                e.show = true; e.order = order; e.at = at; e.auto = { at, score: p.newScore, review: true }; delete e.text;
                if (!this._tmUseCheckText(p.cand.r.id, p.cand.r, p.course)) fresh.push({ r: p.cand.r, course: title[p.course] || '' });
            });
            const tidy = await this._tmTidy(fresh, btn);
            fresh.forEach(x => this._tmApplyEdit(x.r.id, x.r, tidy[x.r.id]));
            await this._tmSave();
            this._tmProposals = list.filter(p => !pick.includes(p));
            this.showMsg('✓ Applied ' + pick.length + ' change' + (pick.length === 1 ? '' : 's') + '. They go online at the next publish.');
            return pick.length;
        } finally { if (btn) { btn.disabled = false; btn.textContent = label; } this.rerenderDashTab ? this.rerenderDashTab() : this.renderView(); }
    },
    async tmKeep(i) {   // "keep current": the shown testimonial is never proposed for replacement again
        await this._tmLoad(); const p = (this._tmProposals || [])[i]; if (!p || !p.old) return;
        const o = this._tm.byId[p.old.id]; if (o) o.keep = true;
        this._tmProposals.splice(i, 1); await this._tmSave(); this.rerenderDashTab ? this.rerenderDashTab() : this.renderView();
    },
    async tmReject(i) {  // "not this one": the suggested comment is never proposed again
        await this._tmLoad(); const p = (this._tmProposals || [])[i]; if (!p || !p.cand) return;
        const e = this._tm.byId[p.cand.r.id] || (this._tm.byId[p.cand.r.id] = { course: p.course }); e.rejected = true; e.show = false;
        this._tmProposals.splice(i, 1); await this._tmSave(); this.rerenderDashTab ? this.rerenderDashTab() : this.renderView();
    },
    async tmUnkeep(id) { await this._tmLoad(); if (this._tm.byId[id]) delete this._tm.byId[id].keep; await this._tmSave(); this.rerenderDashTab ? this.rerenderDashTab() : this.renderView(); },
    _tmReviewHtml(esc, feed) {
        const list = this._tmProposals; if (!list) return '';
        const title = {}; feed.courses.forEach(c => { title[c.id] = c.title; });
        const n = (t) => list.filter(p => p.type === t).length;
        if (!list.length) return '<div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-4 text-sm text-emerald-800">Review complete: nothing left to change. <button onclick="App._tmProposals = null; App.rerenderDashTab()" class="ml-2 underline">close</button></div>';
        const meta = (r) => esc([r.cadre, r.country].filter(Boolean).join(' · ') || 'SURGhub learner') + ' · ' + esc(r.date) + ' · ' + (r.stars ? r.stars + '★' : '');
        const box = (cls, label, r, score, text) => '<div class="flex-1 min-w-[240px] border rounded-lg p-3 ' + cls + '"><div class="text-[10px] font-bold uppercase tracking-wide mb-1">' + label + (score ? ' · ' + esc(score) : '') + '</div>'
            + '<p class="text-xs text-slate-700">' + esc(text) + '</p>' + (r ? '<p class="text-[10px] text-slate-400 mt-1">' + meta(r) + '</p>' : '') + '</div>';
        let lastCourse = '';
        const rows = list.map((p, i) => {
            const head = p.course !== lastCourse ? '<div class="text-xs font-bold text-gsf-prussian mt-4 mb-1">' + esc(title[p.course] || p.course) + ' <button onclick="App.tmPickCourse(\'' + this.escapeJsArg(p.course) + '\')" class="ml-1 font-normal text-gsf-boston hover:underline">open</button></div>' : '';
            lastCourse = p.course;
            const old = p.old ? box('border-slate-200 bg-white', p.type === 'weak' ? 'Shown now: ' + esc(p.why) : 'Shown now', p.old.r, p.old.r ? this._tmQ(p.course, p.old.r).label : '', (p.old.e && p.old.e.text) || (p.old.r && p.old.r.text) || '(no longer in the survey)') : '';
            const neu = p.cand ? box('border-emerald-200 bg-emerald-50/50', p.type === 'add' ? 'Add' : 'Replace with · ' + esc(p.why), p.cand.r, p.cand.q ? p.cand.q.label : '', p.cand.r.text) : '';
            const btns = '<div class="flex flex-col gap-1 shrink-0" data-edit-only>'
                + (p.type === 'weak' ? '<button onclick="App.tmApplyProposals([' + i + '], this)" class="px-3 py-1 text-[11px] font-bold rounded bg-rose-600 text-white">Switch off</button>' : '<button onclick="App.tmApplyProposals([' + i + '], this)" class="px-3 py-1 text-[11px] font-bold rounded bg-gsf-boston text-white">Apply</button>')
                + (p.old ? '<button onclick="App.tmKeep(' + i + ')" class="px-3 py-1 text-[11px] font-bold rounded border text-slate-600" title="Never propose replacing this testimonial again">Keep current</button>' : '')
                + (p.cand ? '<button onclick="App.tmReject(' + i + ')" class="px-3 py-1 text-[11px] font-bold rounded border text-slate-500" title="Never suggest this comment again">Not this one</button>' : '') + '</div>';
            return head + '<div class="flex items-stretch gap-2 flex-wrap mb-2">' + old + (p.old && p.cand ? '<div class="self-center text-slate-300 text-lg">→</div>' : '') + neu + btns + '</div>';
        }).join('');
        return '<div class="bg-white rounded-xl shadow-sm border p-5 mb-5"><div class="flex items-center gap-3 flex-wrap"><h3 class="text-base font-bold text-gsf-prussian">Review of every course</h3>'
            + '<span class="text-xs text-slate-500">' + n('replace') + ' replacements · ' + n('add') + ' additions · ' + n('weak') + ' weak without a better one</span>'
            + (list.some(p => p.type === 'weak' && p.no) ? '<button data-edit-only onclick="App.tmApplyProposals(App._tmProposals.map((p, i) => p.type === \'weak\' && p.no ? i : -1).filter(i => i >= 0), this)" class="ml-auto px-4 py-1.5 text-xs font-bold rounded-lg bg-rose-600 hover:bg-rose-700 text-white" title="Switch off every shown testimonial the check marks as not a testimonial (fragment, not about this course, notes, personal…), with nothing better to replace it">Switch off ' + list.filter(p => p.type === 'weak' && p.no).length + ' that are not testimonials</button>' : '')
            + '<button data-edit-only onclick="App.tmApplyProposals(null, this)" class="' + (list.some(p => p.type === 'weak' && p.no) ? '' : 'ml-auto ') + ' px-4 py-1.5 text-xs font-bold rounded-lg bg-gsf-boston hover:bg-gsf-prussian text-white">Apply all ' + (n('replace') + n('add')) + ' replacements and additions</button>'
            + '<button onclick="App._tmProposals = null; App.rerenderDashTab()" class="text-xs text-slate-400 hover:text-slate-600">close</button></div>'
            + '<p class="text-[11px] text-slate-500 mt-1">Replacements score higher on the AI screen (or the same and newer). Weak ones are listed to switch off by hand. "Keep current" protects a testimonial from future reviews; "Not this one" stops a comment being suggested again.</p>'
            + '<div class="max-h-[560px] overflow-y-auto custom-scrollbar mt-2 pr-1">' + rows + '</div></div>';
    },

    // ── the review of 26 Oct 2026, applied once (Seb) ──
    // Only testimonials already switched on change; nothing new is switched on. The listed ones were
    // resolved from the published per-course files of 26 Oct 2026 to their response ids (positions move,
    // ids do not). None had been filed under the wrong course: each original is in that course's own
    // survey export (one learner pasted the same burns text into three surveys).
    TM_REVIEW_20261026: {"off": [
        {"id": "trmfbi81jqjugb", "at": "difficult-airway-algorithm-2023#1", "why": "about health systems and policy, not airways"}, 
        {"id": "t7ribgcrb4pjx", "at": "tecsalud-basic-burn-management#2", "why": "about clinical trials, not burns"}, 
        {"id": "t9mpgyx1ii3voa", "at": "tecsalud-basic-burn-management#5", "why": "about hypertension and clinical research, not burns"}, 
        {"id": "t1d1gnlj1odt7jm", "at": "tecsalud-basic-principles-wound-management#1", "why": "about drugs, not wounds"}, 
        {"id": "t17e5wwe1evkjo1", "at": "tecsalud-basic-principles-wound-management#2", "why": "about triage, not wounds"}, 
        {"id": "ta9m0x513v65gy", "at": "lumbar-plexus-block#4", "why": "about emergency airway and resuscitation"}, 
        {"id": "tz4aa3o5o3w0v", "at": "epidemiology-fundamentals-patient-safety#6", "why": "about burn prevention and fire safety (the same learner sent it to Essential Burn Care and Obstetric Trauma too)"}, 
        {"id": "t1g2rpfoyjk0h1", "at": "understanding-capnography#4", "why": "about medication error prevention"}, 
        {"id": "t1ib6qj61yao5h", "at": "colon-cancer-surgery#6", "why": "about CEI in surgical research"}, 
        {"id": "tn84uv062qh8p", "at": "complex-lower-extremity-trauma-pelvic-fractures#4", "why": "about SBAR and team huddles"}, 
        {"id": "t145j1bjhg84ae", "at": "central-venous-access-devices#6", "why": "about staff coordination"}, 
        {"id": "t2hq8tif85ie5", "at": "burn-sepsis#6", "why": "generic (industry application, group discussion)"}, 
        {"id": "tj27k6j5kn5ao", "at": "burn-sepsis#5", "why": "the same generic text the learner also sent to Acetabular Fractures: not written for burn sepsis"}, 
        {"id": "twchdk010bl9w1", "at": "complex-lower-extremity-trauma-acetabular-fractures#2", "why": "the same text as burn-sepsis #5"}, 
        {"id": "t1kppgqe1cko1ml", "at": "local-anaesthetic-systemic-toxicity#3", "why": "the learner’s own experience as a patient"}, 
        {"id": "ti2qavf17tmi82", "at": "local-anaesthetic-systemic-toxicity#5", "why": "the learner’s own experience as a patient"}, 
        {"id": "t1vs9bg5ezs73w", "at": "resurge-cleft-lip-palate#2", "why": "the learner is a high school student"}, 
        {"id": "tdzcgd01qxqhjx", "at": "tranexamic-acid#3", "why": "reads like course notes and calls TXA an anticoagulant"}, 
        {"id": "tdlocaqr02o8l", "at": "emergency-checklists-anesthesia-practice#7", "why": "a list of steps, not a testimonial"}], "labels": [
        {"id": "tx2s8dp1htbzya", "at": "managing-a-high-voltage-burn-in-a-low-resource-setting#4", "field": "cadre", "why": "writes “as a physiotherapist”; the survey says Anaesthesiologist"}, 
        {"id": "tp8gb289jk8lb", "at": "understanding-capnography#1", "field": "cadre", "why": "writes “paramedic science student”; the survey says Anaesthesiologist"}, 
        {"id": "t1usktsq1d0sbzv", "at": "chest-wall-reconstruction#4", "field": "country", "why": "writes “my country Ukraine”; the survey says Poland"}]},
    async tmApplyReview20261026(btn) {
        await this._tmLoad();
        if (this._getAiScores) await this._getAiScores();
        const FIX = this.TM_REVIEW_20261026, at = new Date().toISOString(), feed = this._tmCourseFeed();
        const title = {}, slugOf = {}; feed.courses.forEach(c => { title[c.id] = c.title; slugOf[c.id] = c.slug; });
        const shownN = Object.values(this._tm.byId).filter(e => e.show).length;
        if (!confirm('Apply the review of 26 Oct 2026 to the ' + shownN + ' testimonials switched on?\n\n• switch off the ' + FIX.off.length + ' listed (wrong topic, personal, generic)\n• fix ' + FIX.labels.length + ' cadre/country labels\n• switch off comments not written in the page\'s language; keep a duplicated text on one course only\n• rebuild every display text from the learner\'s original comment with the light-editing rule (' + Math.ceil(shownN / 12) + ' requests to Claude)\n\nNothing new is switched on. Cadres and countries are shown in each page\'s language from now on.')) return null;
        const label = btn && btn.textContent; if (btn) btn.disabled = true;
        try {
            const resp = (id, e) => this.tmResponses(e.course).find(x => x.id === id);
            const built = this.testimonialsFeedBuild(feed), pos = {};
            Object.entries(built.courses).forEach(([slug, l]) => l.forEach((x, i) => { pos[x.id] = slug + ' #' + (i + 1); }));
            const shownText = (id, e) => { const r = resp(id, e); return e.text || (r && r.text) || ''; };
            const rep = { at, off: [], labels: [], lang: [], dups: [], dropped: [], edits: { edited: 0, original: 0, failed: 0 }, examples: [], fewer: [], labelsShown: 0 };
            const off = (id, why, list) => { const e = this._tm.byId[id]; if (!e || !e.show) return; list.push({ at: pos[id] || slugOf[e.course], course: title[e.course] || e.course, why, text: shownText(id, e) }); e.show = false; e.removed = { at, why }; };
            // 1. the listed ones
            FIX.off.forEach(f => off(f.id, f.why, rep.off));
            // 2. labels the learner's own words contradict, and the survey does not support
            FIX.labels.forEach(f => { const e = this._tm.byId[f.id]; if (!e) return; const r = resp(f.id, e); const was = r ? this._tmLabels(e, r, this._tmPageLang(e.course))[f.field] : ''; e[f.field] = ''; rep.labels.push({ at: pos[f.id] || f.at, course: title[e.course], field: f.field, from: was, to: '(none)', why: f.why }); });
            // 3. only comments written in the page's language
            Object.entries(this._tm.byId).forEach(([id, e]) => { if (!e.show) return; const r = resp(id, e), L = this._tmPageLang(e.course); if (r && r.lang !== L) off(id, 'written in ' + r.lang.toUpperCase() + ', the page is ' + L.toUpperCase(), rep.lang); });
            // 4. a text on one course only: kept where the course has fewest testimonials
            const count = (c) => Object.values(this._tm.byId).filter(x => x.course === c && x.show).length;
            this.tmDuplicates().forEach(d => {
                const keep = d.where.slice().sort((a, b) => count(a.course) - count(b.course) || String(title[a.course]).localeCompare(String(title[b.course])))[0];
                d.where.filter(w => w !== keep).forEach(w => off(w.id, 'the same text is kept on ' + (title[keep.course] || keep.course), rep.dups));
            });
            // 5. every display text rebuilt from the original
            const items = [];
            Object.entries(this._tm.byId).forEach(([id, e]) => { if (!e.show) return; const r = resp(id, e); if (r) items.push({ r, course: title[e.course] || '', old: shownText(id, e), courseId: e.course }); });
            const res = await this._tmTidy(items, btn);
            items.forEach(x => {
                const k = this._tmApplyEdit(x.r.id, x.r, res[x.r.id]);
                if (!k) { rep.edits.failed++; return; }
                if (k === 'dropped') { rep.dropped.push({ at: pos[x.r.id], course: x.course, why: this._tm.byId[x.r.id].removed.why, text: x.old }); return; }
                rep.edits[k]++;
                const now = this._tm.byId[x.r.id].text || x.r.text;
                if (now !== x.old) rep.examples.push({ course: x.course, at: pos[x.r.id], original: x.r.text, old: x.old, new: now });
                delete this._tm.byId[x.r.id].auto;
            });
            // 6. labels now shown in each page's language (counted for the report)
            Object.entries(this._tm.byId).forEach(([id, e]) => { if (!e.show) return; const r = resp(id, e); if (!r) return; const L = this._tmPageLang(e.course), lb = this._tmLabels(e, r, L);
                const raw = [e.cadre != null ? e.cadre : r.cadre, e.country != null ? e.country : r.country]; if (raw[0] !== lb.cadre || raw[1] !== lb.country) rep.labelsShown++; });
            // 7. courses left with fewer than 3, and the good candidates waiting for each
            const scores = this._aiScoreMap || {};
            feed.courses.forEach(c => { const n = count(c.id); if (n >= 3 || !this.tmResponses(c.id).length) return;
                const cand = this._tmCandidates(c.id), waiting = cand.filter(r => { const a = scores[this._tmAiKey(r.text)]; return a && a.q && a.s >= this.TM_PICK_MIN && !(a.t || []).includes('complaint'); }).length;
                rep.fewer.push({ course: c.title, slug: c.slug, shown: n, waiting, unscreened: cand.filter(r => !scores[this._tmAiKey(r.text)]).length, comments: this.tmResponses(c.id).length }); });
            rep.shownAfter = Object.values(this._tm.byId).filter(e => e.show).length;
            this._tm.fixes = Object.assign({}, this._tm.fixes, { '2026-10-26': at });
            await this._tmSave();
            try { await Storage.setItem('surgdash_testimonials_rework', rep, { internal: true }); } catch (e) { __swallowed(e, 'tm.reworkReport'); }
            this._tmLastRework = rep;
            const msg = 'Review applied.\n\n' + (rep.edits.edited + rep.edits.original) + ' display texts rebuilt: ' + rep.edits.edited + ' lightly edited, ' + rep.edits.original + ' shown exactly as written' + (rep.edits.failed ? ', ' + rep.edits.failed + ' not reached (run "Re-edit all texts" again)' : '') + '.\n'
                + (rep.off.length + rep.lang.length + rep.dups.length + rep.dropped.length) + ' switched off (' + rep.off.length + ' listed, ' + rep.lang.length + ' other language, ' + rep.dups.length + ' duplicate, ' + rep.dropped.length + ' personal details).\n'
                + rep.labels.length + ' labels fixed; cadre/country now in each page\'s language (' + rep.labelsShown + ' shown differently).\n'
                + rep.fewer.length + ' courses have fewer than 3 testimonials.\n\n' + rep.shownAfter + ' testimonials switched on.\n\nPublish now?';
            if (confirm(msg) && this.publishWebsiteMetrics) await this.publishWebsiteMetrics(null);
            return rep;
        } finally { if (btn) { btn.disabled = false; btn.textContent = label; } this.rerenderDashTab ? this.rerenderDashTab() : this.renderView(); }
    },

    // ── editing (Testimonials tab) ──
    async tmToggle(id, courseId) {
        await this._tmLoad();
        const e = this._tm.byId[id] || (this._tm.byId[id] = { course: courseId });
        e.show = !e.show; e.at = new Date().toISOString(); delete e.auto;
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
        delete e.auto;
        await this._tmSave(); this.rerenderDashTab ? this.rerenderDashTab() : this.renderView();
    },
    async tmSetField(id, courseId, field, value) {
        await this._tmLoad();
        const e = this._tm.byId[id] || (this._tm.byId[id] = { course: courseId });
        const v = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
        if (v) e[field] = field === 'stars' ? Number(v) : v;
        else if (field === 'cadre' || field === 'country') e[field] = '';   // emptied: none shown ("SURGhub learner")
        else delete e[field];
        e.at = new Date().toISOString(); delete e.auto;
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

    // The "Courses" section of the tab (testimonialsWorkbench.js): the course table and the course editor.
    _tmCoursesHtml() {
        if (!this._tm || this._tmState === undefined) { if (!this._tmLoading) { this._tmLoading = true; this._tmLoad().then(() => { this._tmLoading = false; if (this._dashTab === 'testimonials') (this.rerenderDashTab ? this.rerenderDashTab() : this.renderView()); }); } return '<div class="p-10 text-sm text-slate-400">Loading testimonials…</div>'; }
        if (this._cfMeta === undefined && this._cfLoad) { this._cfMeta = null; this._cfLoad().then(() => { if (this._dashTab === 'testimonials') (this.rerenderDashTab ? this.rerenderDashTab() : this.renderView()); }); }
        if (this._rawCompletion == null && this.ensureCompletionLoaded && !this._completionLoadPromise) this.ensureCompletionLoaded().then(() => { if (this._dashTab === 'testimonials') (this.rerenderDashTab ? this.rerenderDashTab() : this.renderView()); });
        const esc = (t) => this.escapeHtml(String(t == null ? '' : t));
        const feed = this._tmCourseFeed(), built = this.testimonialsFeedBuild(feed);
        const pendingN = this._tmLiveCourses() !== JSON.stringify(built.courses);
        const head = '';   // the tab's header and sections are drawn by testimonialsWorkbench.js
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
                return '<tr data-tms="' + esc(this._tmNorm(x.c.title + ' ' + x.c.provider)) + '" class="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onclick="App.tmPickCourse(\'' + this.escapeJsArg(x.c.id) + '\')">'
                    + '<td class="py-2 px-3 text-xs font-bold text-gsf-prussian">' + esc(x.c.title) + (Object.values(this._tm.byId).some(e => e.course === x.c.id && e.show && e.auto) ? ' <span class="ml-1 px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 text-[9px] font-bold uppercase">auto-picked</span>' : '') + '</td><td class="py-2 px-3 text-xs text-slate-500 truncate max-w-[200px]">' + esc(x.c.provider) + '</td>'
                    + '<td class="py-2 px-3 text-center"><span class="inline-block min-w-[28px] px-2 py-0.5 rounded-full border text-[11px] font-bold ' + tone + '">' + x.shown + '</span>' + (x.off ? '<span class="block text-[10px] text-slate-400 mt-0.5" title="Switched off: open the course to put them back">' + x.off + ' off</span>' : '') + '</td>'
                    + '<td class="py-2 px-3 text-right text-xs ' + (x.waiting ? 'font-bold text-amber-700' : 'text-slate-400') + '">' + this.formatNumber(x.waiting) + '</td>'
                    + '<td class="py-2 px-3 text-right text-xs text-slate-600">' + this.formatNumber(x.suggested) + '</td><td class="py-2 px-3 text-right text-xs text-slate-400">' + this.formatNumber(x.n) + '</td></tr>';
            }).join('');
            const none = courses.filter(x => !x.n).length, empty = courses.filter(x => x.n && !x.shown).length;
            const autoN = Object.values(this._tm.byId).filter(e => e.show && e.auto).length;
            const dups = this.tmDuplicates(), titleOf = {}; feed.courses.forEach(x => { titleOf[x.id] = x.title; });
            return '<div class="flex items-center gap-2 flex-wrap mb-3"><input type="search" value="' + esc(this._tmQuery || '') + '" oninput="App.tmSearch(this.value)" placeholder="Search courses or providers…" class="px-3 py-2 w-80 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30"><span id="tm-count" class="text-xs text-slate-400"></span>'
                + (empty ? '<button data-edit-only onclick="App.tmPickBest(null, this)" class="ml-auto px-4 py-2 bg-gsf-boston hover:bg-gsf-prussian text-white text-xs font-bold rounded-lg">Pick the best for the ' + empty + ' course' + (empty === 1 ? '' : 's') + ' with none</button>' : '') + '</div>'
                + '<div class="bg-white rounded-xl shadow-sm border overflow-hidden"><div class="overflow-x-auto max-h-[640px] overflow-y-auto custom-scrollbar"><table class="w-full text-left border-collapse text-sm">'
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
        if (fl.checked) rest = rest.filter(r => this._tmQ(cid, r).ok).sort((a, b) => this._tmQ(cid, b).rank - this._tmQ(cid, a).rank);
        const stars = (n) => n ? '<span class="text-amber-500 tracking-tight">' + '★'.repeat(n) + '<span class="text-slate-200">' + '★'.repeat(5 - n) + '</span></span>' : '<span class="text-slate-300 text-[10px]">no rating</span>';
        const pageLang = this._tmPageLang(cid), titleOf = {}; feed.courses.forEach(x => { titleOf[x.id] = x.title; });
        const dupBy = {};
        this.tmDuplicates().forEach(d => { const others = d.where.filter(w => w.course !== cid); if (d.where.some(w => w.course === cid) && others.length) dupBy[this._tmNorm(d.text)] = others.map(w => titleOf[w.course] || w.course).join(', '); });
        const card = (r, i, n) => {
            const e = ent(r.id), on = !!e.show, idJs = this.escapeJsArg(r.id), disp = e.text || r.text, held = on && this._tmHeld(disp);
            const lb = this._tmLabels(e, r, pageLang), meta = [lb.cadre, lb.country].filter(Boolean).join(' · ') || 'SURGhub learner';
            const dupOn = on ? dupBy[this._tmNorm(disp)] : null;
            return '<div class="border rounded-xl p-4 mb-3 ' + (on ? 'border-gsf-boston bg-sky-50/40' : 'border-slate-200 bg-white') + '">'
                + '<div class="flex items-center gap-2 flex-wrap text-[11px] text-slate-500">' + stars(r.stars) + '<span class="font-semibold text-slate-700">' + esc(meta) + '</span><span class="uppercase text-[10px] font-bold text-slate-400">' + esc(r.lang) + '</span>'
                + '<span class="text-[10px] text-slate-400 truncate max-w-[260px]" title="' + esc(r.q) + '">' + esc(this._tmQLabel(r.q)) + '</span>'
                + (this._tmSuggested(r) && !on ? '<span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-bold">suggested</span>' : '')
                + (isNew(r) && !on ? '<span class="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-bold">new</span>' : '')
                + (() => { const q = this._tmQ(cid, r); if (!q.judged) return ''; const tone = q.ok ? 'bg-emerald-50 text-emerald-700' : q.no ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-500'; return '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold ' + tone + '" title="The testimonial check (' + esc(this.TM_JUDGE_MODEL) + '): would this work on this course\'s page?">' + esc(q.label) + '</span>'; })()
                + (on && e.keep ? '<button data-edit-only onclick="App.tmUnkeep(\'' + idJs + '\')" class="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 text-[10px] font-bold" title="Kept: never proposed for replacement. Click to allow it again">kept ×</button>' : '')
                + (on && e.auto ? '<span class="px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 text-[10px] font-bold" title="Picked automatically (AI score ' + esc(e.auto.score) + '/10). Editing, moving or switching it clears this mark.">picked automatically</span>' : '')
                + (on && r.lang !== pageLang ? '<span class="px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 text-[10px] font-bold" title="Only comments written in the course page\'s language are published">not in ' + esc(pageLang.toUpperCase()) + ': not published</span>' : '')
                + (dupOn ? '<span class="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-bold" title="The same text is switched on for another course too">also on ' + esc(dupOn) + '</span>' : '')
                + (held ? '<span class="px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 text-[10px] font-bold" title="The display text contains an email, phone number or learner name: it is not published until edited">held back: personal details</span>' : '')
                + (!on && e.text && e.text !== r.text ? '<span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold" title="Switching it on again brings back your edited text, cadre and country">edits kept</span>' : '')
                + '<span class="ml-auto">' + esc(r.date) + '</span>'
                + (on ? '<span class="inline-flex items-center gap-0.5 ml-2" data-edit-only><button onclick="App.tmMove(\'' + idJs + '\', -1)" ' + (i === 0 ? 'disabled ' : '') + 'class="px-1.5 py-0.5 border rounded text-slate-500 hover:text-gsf-boston disabled:opacity-30" title="Move up">▲</button><button onclick="App.tmMove(\'' + idJs + '\', 1)" ' + (i === n - 1 ? 'disabled ' : '') + 'class="px-1.5 py-0.5 border rounded text-slate-500 hover:text-gsf-boston disabled:opacity-30" title="Move down">▼</button><span class="ml-1 font-bold text-gsf-prussian">#' + (i + 1) + '</span></span>' : '')
                + '<label class="inline-flex items-center gap-1.5 ml-2 cursor-pointer font-bold ' + (on ? 'text-gsf-boston' : 'text-slate-500') + '" data-edit-only><input type="checkbox" ' + (on ? 'checked ' : '') + 'onchange="App.tmToggle(\'' + idJs + '\', \'' + cidJs + '\')"> Show on SURGhub</label></div>'
                + '<p class="text-sm text-slate-700 mt-2 whitespace-pre-line">' + esc(r.text) + '</p>'
                + (on ? '<div class="mt-3" data-edit-only><label class="text-[10px] font-bold uppercase tracking-wide text-slate-400">Text on the course page' + (e.text && e.text !== r.text ? ' · edited' : ' · as written') + '</label>'
                    + '<details class="inline-block ml-2 text-[10px] text-slate-500"><summary class="cursor-pointer text-gsf-boston">editing rule</summary><ul class="list-disc ml-4 mt-1 mb-1 space-y-0.5 max-w-3xl">' + this.TM_EDIT_RULE.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></details>'
                    + '<textarea rows="2" onchange="App.tmSetField(\'' + idJs + '\', \'' + cidJs + '\', \'text\', this.value)" class="w-full mt-1 text-sm border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-gsf-boston/30">' + esc(disp) + '</textarea>'
                    + '<div class="flex gap-3 mt-1 text-[11px] text-slate-500 flex-wrap"><span>Cadre <input value="' + esc(e.cadre != null ? e.cadre : r.cadre) + '" placeholder="SURGhub learner" onchange="App.tmSetField(\'' + idJs + '\', \'' + cidJs + '\', \'cadre\', this.value)" class="border rounded px-1.5 py-0.5 w-44"></span>'
                    + '<span>Country <input value="' + esc(e.country != null ? e.country : r.country) + '" onchange="App.tmSetField(\'' + idJs + '\', \'' + cidJs + '\', \'country\', this.value)" class="border rounded px-1.5 py-0.5 w-36"></span>'
                    + (e.text && e.text !== r.text ? '<button onclick="App.tmSetField(\'' + idJs + '\', \'' + cidJs + '\', \'text\', \'\')" class="underline hover:text-gsf-boston">back to the original</button>' : '')
                    + '<button onclick="App.tmRetidy([\'' + idJs + '\'], this)" class="underline hover:text-gsf-boston" title="A light copy-edit by Claude: typos fixed, kept in the learner\'s words, complete on its own">tidy with AI</button></div></div>' : '')
                + '</div>';
        };
        const sel = (k, opts) => '<select onchange="App.tmSetFilter(\'' + k + '\', this.value)" class="text-xs border rounded-lg px-2 py-1.5">' + opts.map(([v, l]) => '<option value="' + v + '"' + ((fl[k] || '') === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
        const langs = [...new Set(all.map(r => r.lang))].sort();
        const max = this._tmShowN || this.TM_PAGE;
        const x = courses.find(y => y.c.id === cid) || { waiting: 0 };
        return head + '<div class="mb-4 flex items-center gap-3 flex-wrap"><button onclick="App.tmPickCourse(null)" class="text-xs font-bold text-gsf-boston hover:underline">← All courses</button>'
            + '<h3 class="text-lg font-bold text-gsf-prussian">' + esc(c.title) + '</h3><span class="text-xs text-slate-400">' + esc(c.provider) + ' · ' + this.formatNumber(all.length) + ' comments · ' + x.waiting + ' new since ' + (rev ? 'review on ' + esc(rev.slice(0, 10)) : 'never reviewed') + '</span>'
            + (shownList.length < this._tmTarget() ? '<button data-edit-only onclick="App.tmPickBest([\'' + cidJs + '\'], this)" class="ml-auto px-3 py-1.5 text-xs font-bold rounded-lg bg-gsf-boston hover:bg-gsf-prussian text-white" title="Add the best AI-screened comments, up to ' + this._tmTarget() + ' in all">Pick the best' + (shownList.length ? ' to fill up to ' + this._tmTarget() : ' ' + this._tmTarget()) + '</button>' : '')
            + '<button data-edit-only onclick="App.tmMarkReviewed(\'' + cidJs + '\')" class="' + (shownList.length < this._tmTarget() ? '' : 'ml-auto ') + ' px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 hover:border-gsf-boston text-gsf-prussian" title="Everything received until now stops counting as new">Mark reviewed</button></div>'
            + '<div class="bg-white rounded-xl shadow-sm border p-5 mb-5"><h4 class="text-sm font-bold text-gsf-prussian mb-3">On the course page (' + shownList.length + ')</h4>'
            + (shownList.length ? shownList.map((r, i) => card(r, i, shownList.length)).join('') : '<p class="text-sm text-slate-400">None yet: switch comments on below.</p>') + '</div>'
            + (offList.length ? '<div class="bg-white rounded-xl shadow-sm border border-dashed p-5 mb-5"><h4 class="text-sm font-bold text-gsf-prussian">Switched off (' + offList.length + ')</h4>'
                + '<p class="text-xs text-slate-500 mt-0.5 mb-3">Were on the course page. Tick one to put it back; your edits come back with it. "Forget" moves it into the comments below.</p>'
                + offList.map(r => card(r, 0, 0).replace(/<\/div>$/, '<div class="mt-2 text-right" data-edit-only><button onclick="App.tmForget(\'' + this.escapeJsArg(r.id) + '\')" class="text-[11px] text-slate-400 hover:text-gsf-boston hover:underline">Forget</button></div></div>')).join('') + '</div>' : '')
            + '<div class="bg-white rounded-xl shadow-sm border p-5"><div class="flex items-center gap-2 flex-wrap mb-3"><h4 class="text-sm font-bold text-gsf-prussian mr-2">Comments (' + rest.length + ')</h4>'
            + '<label class="inline-flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" ' + (fl.fresh ? 'checked ' : '') + 'onchange="App.tmSetFilter(\'fresh\', this.checked)"> New since last review</label>'
            + '<label class="inline-flex items-center gap-1 text-xs text-slate-600 ml-2"><input type="checkbox" ' + (fl.suggested ? 'checked ' : '') + 'onchange="App.tmSetFilter(\'suggested\', this.checked)"> Suggested only</label>'
            + '<label class="inline-flex items-center gap-1 text-xs text-slate-600 ml-2" title="Only comments the testimonial check says work on this page, strongest first"><input type="checkbox" ' + (fl.checked ? 'checked ' : '') + 'onchange="App.tmSetFilter(\'checked\', this.checked)"> Testimonials only (check)</label>'
            + sel('stars', [['', 'All stars'], ['5', '5 stars'], ['4', '4–5 stars'], ['low', '1–3 stars']]) + sel('lang', [['', 'All languages']].concat(langs.map(l => [l, l.toUpperCase()]))) + '</div>'
            + rest.slice(0, max).map(r => card(r, 0, 0)).join('')
            + (rest.length > max ? '<button onclick="App.tmMore()" class="w-full py-2 text-xs font-bold text-gsf-boston hover:underline">Show ' + Math.min(this.TM_PAGE, rest.length - max) + ' more of ' + (rest.length - max) + '</button>' : '')
            + (!rest.length ? '<p class="text-sm text-slate-400">No comments match these filters.</p>' : '') + '</div>';
    },
});
