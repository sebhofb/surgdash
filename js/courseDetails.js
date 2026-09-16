// ── Course details: the summary text behind each course ───────────────────
//
// SURGdash's course records carry numbers — learners, certificates, minutes,
// ratings — and no prose. UNITAR's annual quality-assessment form asks for the
// course summary and its objectives, so this fetches the description LearnWorlds
// holds for every course and keeps it beside the numbers.
//
// Two sources, because neither has everything. The API (`/courses/{id}`) gives the
// description as a field rather than as markup to unpick. The public course page gives
// the things the API does not carry at all: the **learning objectives**, which every
// SURGhub course publishes as a list, and the **language** and **target audience**,
// printed on the page as plain "Language: English" pills. The public link is built from the course id —
// `https://www.surghub.org/course/<id>` — because the URL already on the course record
// is a survey link, not a page a reader can open.
//
// Paced deliberately. The enrolment sync earned a two-hour penalty box once by being
// impatient with this API (see js/enrolmentSync.js), so this walks one course at a
// time with a gap, and one failure never stops the run.
//
// Stored in `surghub_course_details` (surghub/course_details.json), mapped both ways
// so the text travels with the rest of the SURGhub data to colleagues.
Object.assign(window.App, {

    COURSE_DETAILS_KEY: 'surghub_course_details',
    COURSE_DETAILS_GAP_MS: 1200,      // ~50 requests a minute, the pace this API tolerates
    SURGHUB_COURSE_BASE: 'https://www.surghub.org/course/',

    coursePublicUrl(courseId) {
        const id = String(courseId || '').trim();
        return id ? this.SURGHUB_COURSE_BASE + encodeURIComponent(id) : '';
    },

    async _courseDetailsLoad() {
        if (this._courseDetails) return this._courseDetails;
        let v = null;
        try { v = await Storage.getItem(this.COURSE_DETAILS_KEY); } catch (e) { __swallowed(e, 'courseDetails.load'); }
        this._courseDetails = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
        return this._courseDetails;
    },
    async _courseDetailsStore(map) {
        this._courseDetails = map;
        try { await Storage.setItem(this.COURSE_DETAILS_KEY, map); } catch (e) { __swallowed(e, 'courseDetails.store'); }
    },

    // What we hold for one course, by title. Always an object, never null, so callers
    // can read `.description` without guarding.
    courseDetail(courseName) {
        const all = this._courseDetails || {};
        return all[String(courseName)] || {};
    },

    // Strip the markup LearnWorlds allows in a description, and the keyword tail that
    // editors append ("Keywords: PPE ; Lifebox ; …") — it is indexing, not prose.
    _courseCleanDescription(html) {
        let s = String(html == null ? '' : html);
        s = s.replace(/<\s*(br|\/p|\/div|\/li)\s*>/gi, '\n').replace(/<[^>]+>/g, ' ');
        s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
        s = s.replace(/[ \t]+/g, ' ');
        s = s.split('\n').map(l => l.trim()).join('\n');          // markup leaves ragged edges
        s = s.replace(/ +([.,;:!?])/g, '$1');                      // "basics ." from a closing tag
        s = s.replace(/\n{3,}/g, '\n\n').trim();
        s = s.replace(/\bKeywords?\s*:[\s\S]*$/i, '').trim();
        return s;
    },

    // ── what the public course page carries that the API does not ─────────
    // Objectives, language and target audience. SURGhub publishes course pages in the
    // course's own language, so the labels are localised too: "Language:" on an English
    // page, "Idioma:" on a Spanish one, "Langue :" on a French one — with the space before
    // the colon that French typography wants. Matching only the English wording left every
    // Spanish and French course with an empty language cell (found 16 Sep 2026).
    QA_PAGE_LABELS: {
        language: ['Language', 'Idioma', 'Langue', 'Lingua', 'Língua', 'Sprache'],
        targetAudience: ['Target audience', 'Designed for', 'Intended for',
            'Diseñado para', 'Dirigido a', 'Audiencia', 'Público objetivo',
            'Public cible', 'Destiné à', 'Conçu pour', 'Public visé'],
    },
    // Headings that introduce the objectives list, in the languages SURGhub publishes.
    QA_OBJECTIVE_HEADINGS: ['Learning Objectives', 'Objetivos de aprendizaje',
        'Objectifs pédagogiques', 'Objectifs d\'apprentissage', 'Objetivos de aprendizagem'],

    _coursePageFacts(html) {
        const out = { objectives: [], language: '', targetAudience: '' };
        const page = String(html || '');
        const decode = (h) => h.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
            .replace(/&#39;|&rsquo;|&apos;/gi, "'").replace(/&quot;/gi, '"')
            .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
        const strip = (h) => decode(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
        // Fold accents rather than dropping them, so "Objectifs pédagogiques" and a page
        // that writes it without the accent both come out as "objectifspedagogiques".
        // Dropping them would make those two different strings.
        const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, '');

        // Objectives: the list that follows the heading. The heading's words are split
        // across spans on the real page ("Learning " + " Objectives").
        const wanted = this.QA_OBJECTIVE_HEADINGS.map(norm);
        const headings = page.match(/<h[12][^>]*>[\s\S]*?<\/h[12]>/gi) || [];
        for (const h of headings) {
            if (wanted.indexOf(norm(strip(h))) < 0) continue;
            const after = page.slice(page.indexOf(h) + h.length);
            const ul = after.match(/<ul[^>]*>[\s\S]*?<\/ul>/i);
            if (!ul) break;
            const items = ul[0].match(/<li[^>]*>[\s\S]*?<\/li>/gi) || [];
            out.objectives = items.map(strip).filter(t => t.length > 3).slice(0, 20);
            break;
        }

        // The meta pills. Read from the page's visible text rather than its markup: the
        // value may share the label's element or sit in the next one, and working on text
        // sidesteps both that and however the page happens to encode its accents.
        const visible = decode(page.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, '\n'))
            .split('\n').map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
        const looksLikeLabel = (t) => /:$/.test(t) && t.length < 40;
        const pill = (aliases, max, wrap) => {
            const keys = aliases.map(norm);
            for (let i = 0; i < visible.length; i++) {
                const line = visible[i];
                const colon = line.indexOf(':');
                if (colon < 0) continue;
                if (keys.indexOf(norm(line.slice(0, colon))) < 0) continue;
                const rest = line.slice(colon + 1).trim();
                const parts = [];
                if (rest) parts.push(rest);
                for (let k = i + 1; k < visible.length && !parts.length; k++) {
                    if (looksLikeLabel(visible[k])) break;
                    parts.push(visible[k]);
                    break;
                }
                if (wrap) {
                    for (let k = i + (rest ? 1 : 2); k < visible.length && parts.join(' ').length < max; k++) {
                        if (looksLikeLabel(visible[k])) break;
                        parts.push(visible[k]);
                    }
                }
                const v = parts.join(' ').replace(/\s+/g, ' ').trim();
                if (v && v.length <= max && /[A-Za-zÀ-ÿ]/.test(v)) return v;
            }
            return '';
        };
        out.language = pill(this.QA_PAGE_LABELS.language, 80, false);
        out.targetAudience = pill(this.QA_PAGE_LABELS.targetAudience, 400, true);
        return out;
    },

    // Some descriptions carry their own objectives section. Where one exists it is the
    // best answer to UNITAR's "learning objectives"; where none does we say so rather
    // than paraphrasing the summary back at them.
    _courseObjectives(description) {
        const s = String(description || '');
        const m = s.match(/(?:learning\s+)?objectives?\s*[:\-–]?\s*\n?([\s\S]{20,1200})/i);
        if (!m) return '';
        const tail = m[1].trim();
        const lines = tail.split('\n').map(l => l.replace(/^[\s•\-\*\d.)]+/, '').trim()).filter(Boolean);
        return lines.slice(0, 12).join('\n');
    },

    // The rendered course page, through the main process (the renderer cannot reach
    // arbitrary hosts). A page that will not load costs that course its objectives and
    // its language, never the whole run.
    async _fetchCoursePage(courseId) {
        const empty = { objectives: [], language: '', targetAudience: '' };
        const url = this.coursePublicUrl(courseId);
        if (!url) return empty;
        try {
            const res = await electronAPI.invoke('http-request', { url, method: 'GET', timeoutMs: 30000 });
            if (!res || res.statusCode !== 200 || !res.body) return empty;
            return this._coursePageFacts(res.body);
        } catch (e) { __swallowed(e, 'courseDetails.page.' + courseId); return empty; }
    },

    async syncCourseDetails(opts) {
        opts = opts || {};
        if (!window.LearnWorlds || !LearnWorlds.apiGet) { if (!opts.silent) alert('LearnWorlds module not loaded.'); return null; }
        const creds = await LearnWorlds.getCredentials();
        if (!creds.clientId || !creds.apiToken) { if (!opts.silent) alert('Add LearnWorlds API credentials first (Data Sync).'); return null; }

        const snap = (this.getAnalyticsSnap ? this.getAnalyticsSnap() : (this.data || [])).filter(d => d && d.Course && d.CourseId);
        const seen = {};
        const courses = snap.filter(d => { const k = d.CourseId; if (seen[k]) return false; seen[k] = 1; return true; });
        if (!courses.length) { if (!opts.silent) alert('No courses with an id — run Sync Courses first.'); return null; }

        const map = Object.assign({}, await this._courseDetailsLoad());
        const stats = { total: courses.length, fetched: 0, failed: 0, at: new Date().toISOString() };
        for (let i = 0; i < courses.length; i++) {
            if (this._reportCancelled) break;
            const c = courses[i];
            if (opts.progress) opts.progress('Course ' + (i + 1) + '/' + courses.length + ': ' + c.Course);
            try {
                const r = await LearnWorlds.apiGet('/courses/' + encodeURIComponent(c.CourseId));
                const d = (r && r.data) ? r.data : r;
                const description = this._courseCleanDescription(d && d.description);
                const page = await this._fetchCoursePage(c.CourseId);
                map[c.Course] = {
                    courseId: c.CourseId,
                    title: (d && d.title) ? String(d.title) : c.Course,
                    description,
                    // The page's list is the real answer; a description that happens to
                    // spell out objectives is the fallback.
                    objectives: page.objectives.length ? page.objectives.join('\n') : this._courseObjectives(description),
                    language: page.language,
                    targetAudience: page.targetAudience,
                    categories: (d && Array.isArray(d.categories)) ? d.categories.map(x => String((x && x.name) || x)).filter(Boolean) : [],
                    author: (d && d.author) ? String((d.author.username) || d.author) : '',
                    access: (d && d.access) ? String(d.access) : (c.Access || ''),
                    created: (d && d.created) ? String(d.created) : '',
                    url: this.coursePublicUrl(c.CourseId),
                    fetchedAt: new Date().toISOString(),
                };
                stats.fetched++;
            } catch (e) {
                __swallowed(e, 'courseDetails.' + c.CourseId);
                stats.failed++;
            }
            if (i < courses.length - 1) await new Promise(res => setTimeout(res, this.COURSE_DETAILS_GAP_MS));
        }
        await this._courseDetailsStore(map);
        if (!opts.silent) {
            this.showMsg('Course summaries updated — ' + this.formatNumber(stats.fetched) + ' of ' + this.formatNumber(stats.total)
                + (stats.failed ? ' · ' + stats.failed + ' could not be read' : ''), stats.failed ? 'warn' : 'success');
        }
        return stats;
    },

    // The Data Sync button: an overlay, because it walks the whole catalogue.
    async syncCourseDetailsWithProgress() {
        const n = (this.getAnalyticsSnap ? this.getAnalyticsSnap() : []).filter(d => d && d.CourseId).length;
        if (!confirm('Fetch the course summary for every course from LearnWorlds?\n\n'
            + n + ' courses, about ' + Math.max(1, Math.round(n * this.COURSE_DETAILS_GAP_MS / 60000)) + ' minutes.\n'
            + 'Needed for the UNITAR quality-assessment forms.')) return;
        this._reportCancelled = false;
        if (this._showReportProgress) this._showReportProgress('Reading course summaries…', true);
        try {
            await this.syncCourseDetails({ progress: (t) => { if (this._showReportProgress) this._showReportProgress(t, true); } });
        } finally {
            if (this._hideReportProgress) this._hideReportProgress();
            if (this.renderView) this.renderView();
        }
    },
});
