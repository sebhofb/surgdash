// ── Forum quotes: what learners write in the discussion spaces, for articles and posts ────
//
// forumActivity.js counts posts and keeps no text. This reads the longer posts once more,
// asks Claude which of them make a quote for GSF's communications (an article, a social
// post, a funder report), and keeps only those, edited lightly and without names.
//
// WHO SAID IT. A post carries a LearnWorlds user id, not a profession or country. The
// newest enrolment receipt (surghub/raw/enrolments__*/pull.jsonl) lists every account
// with its email, so id → email → djb2 → the anonymised user row gives the profession and
// country on record. Where the record is blank, what the post itself says is used. The
// email and name are used on this Mac only and never stored; the poster is kept as a hash,
// so several quotes from one learner can be told apart from several learners.
//
// NOT FOR THE WEBSITE. Forum posts were written for other learners, not as feedback, so
// these quotes stay internal: nothing here is published, and the screen says so.
//
// STORED: `surghub_forum_quotes` (surghub/forum_quotes.json) — the quotes kept (edited
// text, labels, strength, theme), and the ids of posts checked and rejected, so a run
// only pays for posts it has not seen.
Object.assign(window.App, {

    FQ_KEY: 'surghub_forum_quotes',
    FQ_MODEL: 'claude-opus-5-5', FQ_EFFORT: 'low', FQ_BATCH: 20,
    FQ_COST: 0.0037,          // USD per post on Opus 5.5 at low effort (measured 30 Oct 2026 on a 40-post pilot)
    FQ_MIN_CHARS: 250,        // shorter posts are greetings, thanks and one-line answers; 200–250 rated mostly 2–3/5
    FQ_STAFF: /@globalsurgeryfoundation\.org$/i,   // the team's own announcements are not learner voices
    FQ_THEMES: { practice: 'Changed practice', patient: 'A patient or case', why: 'Why they are learning', context: 'Where they work',
        course: 'What the course gave them', access: 'Access and equity', community: 'Learning together' },
    FQ_KINDS: { reflection: 'Reflection forum', introduction: 'Introduce yourself', discussion: 'Discussion', general: 'General community' },

    FQ_PROMPT: 'You pick quotes from the discussion forums of SURGhub, the United Nations Global Surgery Learning Hub (free online surgical training, mostly for clinicians in low- and middle-income countries), for the Global Surgery Foundation\'s communications team: news articles, social media posts and reports to funders. A quote is printed on its own, under the learner\'s profession and country. Be strict: the team would rather read twenty strong quotes than two hundred mixed ones.\n\n'
        + 'Each item gives the course the forum belongs to (or "general community"), the kind of space (reflection forum, introduce yourself, discussion, general), the poster\'s profession and country from their account when known, and the post.\n'
        + '1. text: the quote, made from the post with these rules. Keep the learner\'s own words, word order and tone, non-native phrasing included; correct only spelling, typos, capitals, spacing and punctuation. Cut greetings ("Hello everyone"), sign-offs, thanks to the moderators, and the learner\'s own name. Remove the names of people and of hospitals, universities and other institutions, cutting the clause or replacing the name with a plain description ("a district hospital"); cities, regions and countries may stay. Remove patient details that could identify someone, and anything showing the learner is under 18. Shorten by cutting whole sentences or clauses, never by rewording, to 80 words at most; keep the sentences that carry the point. Add no words of your own, no em dashes, no quotation marks. Never translate: keep the quote in the post\'s language. Leave text empty if nothing usable is left.\n'
        + '2. en: an English translation of the quote when it is not in English; otherwise empty.\n'
        + '3. verdict, judged on the quote as a reader of an article would see it:\n'
        + '- "use": a complete thought in the learner\'s own voice that tells the reader something real: a change in how they or their team work, a case or situation that made the training matter, why they are learning and what they face where they work (shortages, conflict, distance), or what the course gave them, specifically. "Since then all instruments are inspected and the findings recorded weekly." "I treat children with cleft lip and palate in conflict-affected, low-resource settings, and I am here to learn and bring it back to my team."\n'
        + '- "weak": true and complete but generic: thanks, general praise, a plain introduction with name, job and interests and nothing more.\n'
        + '- "no": anything else: questions to the moderators, announcements, adverts and invitations, technical problems, a recital of course content or textbook facts (common in reflection forums), copied or machine-written text, complaints, posts about someone\'s own health, fragments.\n'
        + '- reason: "good" (use), "generic" (weak), or for no the main problem: "question", "announcement", "content" (recites course content or facts), "fragment", "personal", "complaint", "machine", "off_topic", "unclear".\n'
        + '- strength 1-5 for use and weak: 5 = concrete, vivid and credible, the kind of line an article is built around; 4 = specific and in their own voice; 3 = clear but general; 2 = bland; 1 = says almost nothing. For no, 1.\n'
        + '- theme, the main one: "practice" (changed how they or their team work), "patient" (a case or situation; no identifying details), "why" (why they are learning), "context" (where and how they work), "course" (what the course gave them), "access" (access to care or training, equity), "community" (learning with peers).\n'
        + '- self_role and self_country: the poster\'s profession and country as the post itself states them, in English; empty if it does not say.',
    FQ_SCHEMA: { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: { i: { type: 'integer' }, text: { type: 'string' }, en: { type: 'string' },
        verdict: { type: 'string', enum: ['use', 'weak', 'no'] }, reason: { type: 'string', enum: ['good', 'generic', 'question', 'announcement', 'content', 'fragment', 'personal', 'complaint', 'machine', 'off_topic', 'unclear'] },
        strength: { type: 'integer' }, theme: { type: 'string', enum: ['practice', 'patient', 'why', 'context', 'course', 'access', 'community'] }, self_role: { type: 'string' }, self_country: { type: 'string' } },
        required: ['i', 'text', 'en', 'verdict', 'reason', 'strength', 'theme', 'self_role', 'self_country'], additionalProperties: false } } }, required: ['results'], additionalProperties: false },

    _fqVersion() { return this._fqHash ? this._fqHash : (this._fqHash = this._djb2Hash(this.FQ_MODEL + '|' + this.FQ_PROMPT)); },
    async _fqLoad() {
        if (this._fq) return this._fq;
        let v = null; try { v = await Storage.getItem(this.FQ_KEY); } catch (e) { __swallowed(e, 'fq.load'); }
        this._fq = (v && typeof v === 'object' && v.quotes) ? v : { v: 1, at: '', quotes: {}, no: {}, hidden: {} };
        ['quotes', 'no', 'hidden'].forEach(k => { if (!this._fq[k]) this._fq[k] = {}; });
        return this._fq;
    },
    _fqText(html) {
        return String(html || '').replace(/<br\s*\/?>|<\/p>|<\/li>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#0?39;|&rsquo;|&lsquo;/g, "'").replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    },
    _fqKind(title, courseId) {
        const t = String(title || '');
        if (/introduc|pr[ée]sent|tarif|تعارف|عرّف|عرف بنفسك/i.test(t)) return 'introduction';
        if (/reflect|r[ée]flex/i.test(t)) return 'reflection';
        return courseId ? 'discussion' : 'general';
    },

    // LearnWorlds user id → { email, first, last } from the newest receipt that lists every account.
    // Only the /users pages are parsed: the per-learner pages are most of the file and not needed.
    _fqPosterIndex() {
        if (this._fqPosters) return this._fqPosters;
        const dirs = this._enrReceiptDirs ? this._enrReceiptDirs() : [], path = window.electronAPI && electronAPI.path;
        const head = /^\{"t":\d+,"path":"\/users"/;
        for (let i = dirs.length - 1; i >= 0; i--) {
            const users = new Map();
            try {
                this._enrReadLines(path.join(dirs[i], 'pull.jsonl'), (line) => {
                    if (!head.test(line)) return;
                    let b; try { b = JSON.parse(JSON.parse(line).body); } catch (e) { return; }
                    (b.data || []).forEach(u => { if (u && u.id && u.email) users.set(String(u.id), { email: String(u.email).toLowerCase().trim(), first: u.first_name || '', last: u.last_name || '' }); });
                });
            } catch (e) { __swallowed(e, 'fq.receipt'); }
            if (users.size >= 1000) return (this._fqPosters = users);
        }
        return (this._fqPosters = new Map());
    },
    // user_uid → { profession, country } from the anonymised rows, then the email demographics.
    _fqProfiles() {
        const out = {};
        (this._rawAnonymizedUsers || []).forEach(r => { if (!r || !r.user_uid) return; const o = out[r.user_uid] || (out[r.user_uid] = { p: '', c: '' }); if (!o.p && r.profession) o.p = r.profession; if (!o.c && r.country) o.c = r.country; });
        return out;
    },
    _fqWho(userId, posters, profiles) {
        const u = posters.get(String(userId || ''));
        if (!u) return { uid: '', staff: false, p: '', c: '', names: [] };
        const uid = this._djb2Hash(u.email), rec = profiles[uid] || {}, demo = (this._emailDemoMap || {})[u.email] || {};
        const names = [u.first, u.last].join(' ').split(/\s+/).filter(w => w.length >= 3);
        return { uid, staff: this.FQ_STAFF.test(u.email), p: rec.p || demo.profession || '', c: rec.c || demo.country || '', names };
    },
    _fqNamed(text, names) {
        const t = String(text || '').toLowerCase();
        return names.some(n => new RegExp('(^|[^\\p{L}])' + n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\p{L}])', 'u').test(t));
    },

    // Read every post, link it to its course and poster, and check the longer ones not seen before.
    // opts.progress(text); returns { checked, kept, cost } or null when stopped or declined.
    async findForumQuotes(btn, opts) {
        opts = opts || {};
        if (this._fqRunning) return null;
        if (!window.LearnWorlds || !LearnWorlds.apiGet) { alert('LearnWorlds module not loaded.'); return null; }
        const apiKey = this._getAnthropicKey ? await this._getAnthropicKey() : '';
        if (!apiKey || !this._claudeJSON) { alert('Finding forum quotes needs the Anthropic API key (Feedback tab → Score with AI).'); return null; }
        this._fqRunning = true;
        const label = btn ? btn.textContent : '', say = (t) => { if (btn) btn.textContent = t; if (opts.progress) opts.progress(t); };
        try {
            await this._fqLoad();
            if (this.ensureAnonLoaded) await this.ensureAnonLoaded();
            if (this.ensureCompletionLoaded) await this.ensureCompletionLoaded();
            const spaces = await this._forumFetchAll('/community/spaces', { progress: say, label: 'Discussion spaces, page' });
            await new Promise(res => setTimeout(res, this.FORUM_GAP_MS));
            const posts = await this._forumFetchAll('/community/posts', { progress: say, label: 'Forum posts, page' });
            const title = {}; (this.data || []).forEach(d => { if (d && d.CourseId && d.Course && !title[d.CourseId]) title[d.CourseId] = d.Course; });
            const space = {};
            spaces.forEach(s => { const ids = [...new Set((s.usages || []).map(u => u && u.courseId).filter(Boolean))]; const c = ids.length > 1 ? this._forumPickCourse(ids) : ids[0] || ''; space[s.id] = { c, kind: this._fqKind(s.title || s.name, c) }; });
            const posters = this._fqPosterIndex(), profiles = this._fqProfiles(), pv = this._fqVersion(), fq = this._fq;
            let staff = 0, short = 0, seen = 0;
            const todo = [];
            posts.forEach(p => {
                const id = String(p && p.id || ''); if (!id) return;
                if (fq.quotes[id] && fq.quotes[id].pv === pv || fq.no[id]) { seen++; return; }
                const text = this._fqText(p.text);
                if (text.length < this.FQ_MIN_CHARS) { short++; return; }
                const who = this._fqWho(p.user && p.user.id, posters, profiles);
                if (who.staff) { staff++; return; }
                const sp = space[p.posted_in && p.posted_in.id] || { c: '', kind: 'general' };
                todo.push({ id, text: text.slice(0, 2500), c: sp.c, course: sp.c ? (title[sp.c] || sp.c) : '', kind: sp.kind, d: p.created ? new Date(p.created * 1000).toISOString().slice(0, 10) : '', who });
            });
            if (opts.limit) todo.splice(opts.limit);   // a pilot run
            if (!todo.length) { if (!opts.quiet) alert('No new forum posts to check (' + posts.length.toLocaleString() + ' read, ' + seen.toLocaleString() + ' checked before).'); return { checked: 0, kept: 0, cost: 0 }; }
            const ask = 'Check ' + todo.length.toLocaleString() + ' forum posts for quotes (' + this.FQ_MODEL + ')?\n\n'
                + posts.length.toLocaleString() + ' posts read: ' + short.toLocaleString() + ' shorter than ' + this.FQ_MIN_CHARS + ' characters and ' + staff.toLocaleString() + ' by GSF staff are left out'
                + (seen ? ', ' + seen.toLocaleString() + ' were checked before and are not paid for again' : '') + '.\n\nAbout ' + Math.ceil(todo.length / this.FQ_BATCH) + ' requests, roughly $' + Math.max(1, Math.round(todo.length * this.FQ_COST)) + '. The quotes stay in SURGdash: nothing is published.';
            if (!(opts.confirm ? opts.confirm(ask) : confirm(ask))) return null;
            const kind = (k) => (this.FQ_KINDS[k] || k).toLowerCase();
            let done = 0, kept = 0, failed = 0;
            const B = this.FQ_BATCH, in0 = this._aiUsage ? this._aiUsage.in : 0, out0 = this._aiUsage ? this._aiUsage.out : 0;
            for (let i = 0; i < todo.length; i += B) {
                const batch = todo.slice(i, i + B);
                say('Checking forum posts ' + Math.min(i + B, todo.length).toLocaleString() + '/' + todo.length.toLocaleString() + '…');
                try {
                    const res = await this._claudeJSON(apiKey, this.FQ_PROMPT, JSON.stringify(batch.map((x, k) => ({ i: k, course: x.course || 'general community', space: kind(x.kind), profession: x.who.p, country: x.who.c, post: x.text }))),
                        this.FQ_SCHEMA, 16000, { model: this.FQ_MODEL, effort: this.FQ_EFFORT });
                    (res && res.results || []).forEach(r => {
                        const x = batch[r.i]; if (!x || !['use', 'weak', 'no'].includes(r.verdict)) return;
                        done++;
                        let t = r.verdict === 'no' ? '' : String(r.text || '').replace(/\s+/g, ' ').trim();
                        if (t && this.scrubPersonal) t = this.scrubPersonal(t);
                        if (!t || this._fqNamed(t, x.who.names)) { delete fq.quotes[x.id]; fq.no[x.id] = 1; return; }   // still names the poster: never kept
                        fq.quotes[x.id] = { c: x.c, course: x.course, k: x.kind, d: x.d, t, en: String(r.en || '').trim(), v: r.verdict, s: Math.max(1, Math.min(5, Number(r.strength) || 1)), th: r.theme,
                            role: x.who.p || String(r.self_role || '').trim(), country: x.who.c || String(r.self_country || '').trim(), u: x.who.uid, pv };
                        kept++;
                    });
                    if ((i / B) % 5 === 4) { try { await Storage.setItem(this.FQ_KEY, fq); } catch (e) { __swallowed(e, 'fq.save'); } }
                } catch (e) { __swallowed(e, 'fq.check'); failed++; if (/Invalid Anthropic API key/.test(e.message) || failed >= 3) { alert('The forum check stopped: ' + e.message + '\n\nWhat was checked is kept; run it again to continue.'); break; } }
            }
            fq.at = new Date().toISOString(); fq.read = posts.length;
            try { await Storage.setItem(this.FQ_KEY, fq); } catch (e) { __swallowed(e, 'fq.save'); }
            const tin = (this._aiUsage ? this._aiUsage.in : 0) - in0, tout = (this._aiUsage ? this._aiUsage.out : 0) - out0;
            const use = Object.values(fq.quotes).filter(q => q.v === 'use').length;
            if (!opts.quiet) this.showMsg('Forum quotes: ' + done.toLocaleString() + ' posts checked, ' + use.toLocaleString() + ' quotes worth using.');
            if (this._fqOnTab()) this.rerenderDashTab();
            return { checked: done, kept, use, tokensIn: tin, tokensOut: tout };
        } finally { this._fqRunning = false; if (btn) btn.textContent = label; }
    },

    // ── The Forum tab section ──
    _fqOnTab() { return !!(this.rerenderDashTab && this.view === 'platform' && this._dashTabKey && this._dashTabKey() === 'forum'); },
    _fqFilterGet() { return this._fqFilter || (this._fqFilter = { kind: '', theme: '', min: 4, conflict: false, q: '', all: false }); },
    setFqFilter(k, v) { const f = this._fqFilterGet(); f[k] = k === 'min' ? Number(v) : k === 'conflict' || k === 'all' ? !!v : String(v || ''); if (k !== 'all') f.all = false; if (this.rerenderDashTab) this.rerenderDashTab(); },
    _fqConflict(country) {
        if (!country || !this._conflictMatchMap) return false;
        if (!this._fqCm) this._fqCm = this._conflictMatchMap();
        return !!this._fqCm.get(this._conflictNorm(country));
    },
    // The account's profession is a tag ("nurse-anaesthetist", "anesthesiology"): read as a job title.
    FQ_ROLES: { anesthesiology: 'Anaesthesiologist', nursing: 'Nurse', resident: 'Resident doctor', 'non-clinical': '', 'internal test homepage': '' },
    _fqRole(r) {
        const k = String(r || '').trim().toLowerCase();
        if (k in this.FQ_ROLES) return this.FQ_ROLES[k];
        const t = ((this.tmCadreLabel ? this.tmCadreLabel(r, 'en') : '') || String(r || '')).replace(/-/g, ' ').trim();
        return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
    },
    _fqLabel(q) {
        const role = this._fqRole(q.role) || 'Learner';
        const ctry = (this.tmCountryLabel ? this.tmCountryLabel(q.country, 'en') : '') || q.country || '';
        return role.charAt(0).toUpperCase() + role.slice(1) + (ctry ? ', ' + ctry : '');
    },
    fqList() {
        const fq = this._fq; if (!fq) return [];
        const f = this._fqFilterGet(), needle = f.q.toLowerCase(), byU = {};
        Object.values(fq.quotes).forEach(q => { if (q.u && q.v === 'use') byU[q.u] = (byU[q.u] || 0) + 1; });
        return Object.entries(fq.quotes).filter(([id, q]) => !fq.hidden[id] && q.v === 'use' && q.s >= f.min && (!f.kind || q.k === f.kind) && (!f.theme || q.th === f.theme)
            && (!f.conflict || this._fqConflict(q.country)) && (!needle || [q.t, q.en, q.course, q.role, q.country].join(' ').toLowerCase().includes(needle)))
            .map(([id, q]) => Object.assign({ id, label: this._fqLabel(q), same: q.u ? byU[q.u] || 1 : 1 }, q))
            .sort((a, b) => (b.s - a.s) || String(b.d).localeCompare(String(a.d)));
    },
    _fqSectionHtml() {
        if (!this._fq) { this._fqLoad().then(() => { if (this._fqOnTab()) this.rerenderDashTab(); }); return ''; }
        const esc = (t) => this.escapeHtml(t), fq = this._fq, f = this._fqFilterGet(), list = this.fqList(), shown = f.all ? list : list.slice(0, 40);
        const find = '<button data-edit-only onclick="App.findForumQuotes(this)" class="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-bold text-slate-600 hover:text-gsf-boston hover:bg-slate-50"><i data-lucide="quote" width="13"></i> ' + (fq.at ? 'Check new posts' : 'Find quotes') + '</button>';
        const total = Object.values(fq.quotes).filter(q => q.v === 'use').length;
        const opt = (v, l, cur) => '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>';
        const sel = (k, cur, opts) => '<select onchange="App.setFqFilter(\'' + k + '\', this.value)" class="border rounded-lg px-2 py-1 text-xs text-slate-600">' + opts + '</select>';
        const filters = '<div class="flex items-center gap-2 flex-wrap mb-4">'
            + sel('kind', f.kind, opt('', 'Every space', f.kind) + Object.entries(this.FQ_KINDS).map(([k, l]) => opt(k, l, f.kind)).join(''))
            + sel('theme', f.theme, opt('', 'Every theme', f.theme) + Object.entries(this.FQ_THEMES).map(([k, l]) => opt(k, l, f.theme)).join(''))
            + sel('min', f.min, opt(5, 'Strongest (5/5)', f.min) + opt(4, '4/5 and up', f.min) + opt(3, '3/5 and up', f.min))
            + '<label class="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox"' + (f.conflict ? ' checked' : '') + ' onchange="App.setFqFilter(\'conflict\', this.checked)"> Conflict-affected countries</label>'
            + '<input type="search" value="' + esc(f.q) + '" placeholder="Search course, country, words…" onchange="App.setFqFilter(\'q\', this.value)" class="border rounded-lg px-2 py-1 text-xs flex-1 min-w-[180px]">'
            + '<span class="text-[11px] text-slate-400">' + list.length.toLocaleString() + ' of ' + total.toLocaleString() + '</span></div>';
        const card = (q) => '<div class="border border-slate-200 rounded-lg p-4 flex flex-col">'
            + '<p class="text-sm text-slate-700 leading-relaxed">&ldquo;' + esc(q.t) + '&rdquo;</p>'
            + (q.en ? '<p class="text-xs text-slate-500 italic mt-2">English: ' + esc(q.en) + '</p>' : '')
            + '<p class="text-xs font-bold text-gsf-prussian mt-3">' + esc(q.label) + (this._fqConflict(q.country) ? ' <span class="ml-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-bold">conflict-affected</span>' : '') + '</p>'
            + '<p class="text-[11px] text-slate-400 mt-0.5">' + esc(q.course || 'General community') + ' &middot; ' + esc((this.FQ_KINDS[q.k] || q.k).toLowerCase()) + (q.d ? ' &middot; ' + esc(this._forumMonthName ? this._forumMonthName(q.d.slice(0, 7)) : q.d) : '')
            + ' &middot; ' + esc(this.FQ_THEMES[q.th] || q.th || '') + ' &middot; ' + q.s + '/5' + (q.same > 1 ? ' &middot; <span title="Quote one of them rather than all: they read as several voices">' + q.same + ' quotes from this learner</span>' : '') + '</p>'
            + '<div class="flex gap-3 mt-3 text-xs font-bold"><button onclick="App.copyForumQuote(\'' + this.escapeJsArg(q.id) + '\')" class="text-gsf-boston hover:underline">Copy</button>'
            + '<button data-edit-only onclick="App.hideForumQuote(\'' + this.escapeJsArg(q.id) + '\')" class="text-slate-400 hover:text-rose-600 hover:underline">Hide</button></div></div>';
        const body = !fq.at ? '<p class="text-sm text-slate-400">Not run yet. <strong>Find quotes</strong> reads the forum posts and checks the longer ones; it shows the count and the cost before anything is charged.</p>'
            : list.length ? '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">' + shown.map(card).join('') + '</div>'
                + (list.length > shown.length ? '<button onclick="App.setFqFilter(\'all\', true)" class="mt-3 text-xs font-bold text-gsf-boston hover:underline">Show all ' + list.length.toLocaleString() + '</button>' : '')
            : '<p class="text-sm text-slate-400">No quotes match these filters.</p>';
        return '<div class="bg-white rounded-xl border shadow-sm p-5 mb-6"><div class="flex items-start justify-between gap-3 flex-wrap mb-2"><div class="min-w-0"><h3 class="font-bold text-gsf-prussian">Quotes from the forum</h3>'
            + '<p class="text-xs text-slate-500 mt-1 max-w-3xl">Longer posts from the discussion spaces, checked for use in articles, social posts and reports, lightly edited, with the names of people and institutions taken out. Profession and country come from the learner\'s account. For internal use: these were written for other learners, so quote by profession and country only, and ask the learner before telling a story that could identify them.'
            + (fq.at ? ' Checked ' + esc(new Date(fq.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })) + '.' : '') + '</p></div>' + find + '</div>'
            + (fq.at ? filters : '') + body + '</div>';
    },
    async copyForumQuote(id) {
        const q = this._fq && this._fq.quotes[id]; if (!q) return;
        const text = '"' + q.t + '"\n— ' + this._fqLabel(q) + (q.course ? ', ' + q.course : '') + (q.en ? '\n(English: ' + q.en + ')' : '');
        try { await navigator.clipboard.writeText(text); this.showMsg('Quote copied.'); } catch (e) { __swallowed(e, 'fq.copy'); alert(text); }
    },
    async hideForumQuote(id) {
        const fq = await this._fqLoad(); fq.hidden[id] = 1;
        try { await Storage.setItem(this.FQ_KEY, fq); } catch (e) { __swallowed(e, 'fq.save'); }
        if (this.rerenderDashTab) this.rerenderDashTab();
    },
});
