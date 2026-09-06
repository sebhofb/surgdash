// ── Enrolments & progress from the LearnWorlds API ────────────────────────────
// Replaces the manual card-2 "User Progress" xlsx as the source of per-learner
// dates. Per account, two calls:
//   GET /users/{id}/courses   → one record per enrolment, with its own `created`
//   GET /users/{id}/progress  → per course: status, progress_rate, time_on_course
//                               (seconds), average_score_rate, completed_at
// plus one pass over /certificates (issued dates). Both per-account endpoints are
// paginated (50/page); heavy learners span several pages.
//
// THE CONSTRAINT IS THE QUOTA, NOT CONCURRENCY. Bursts of 8 req/s pass, but the
// first full run showed LearnWorlds enforcing roughly 60 requests/minute
// sustained: with 4 workers, 6.4 of 7.2 hours went on Retry-After waits (10 s
// and 60 s). So this sync is
//   • PACED: one account at a time, ~55 requests/minute — no wasted 429s;
//   • CHECKPOINTED: every ENR_CHECKPOINT accounts the merged rows are written to
//     surghub_completion and the processed ids to the run record, so Cancel,
//     a crash or a laptop going to sleep loses at most a few minutes;
//   • RESUMABLE: the next "Sync from API" continues the open run, after first
//     ingesting OFFLINE whatever the raw receipt already holds (every response
//     is captured verbatim in raw/enrolments__*/pull.jsonl) — nothing fetched
//     is ever fetched twice;
//   • SELECTIVE: accounts that had no course in the growth-timelines pull and
//     no activity since are skipped (no enrolments to fetch); most recently
//     active accounts go first so fresh data lands early.
// A full pass over ~63k accounts is still ~33 hours of API time; it simply no
// longer has to happen in one sitting. Incremental runs (accounts active since
// the last completed run) take minutes.
//
// Output is the xlsx importer's EXACT row shape into the same store, so charts,
// Institutions, Compare and exports are untouched (extra fields: enrolled_date,
// source). Semantics preserved: start_date only when the learner has progress;
// rows from the UNION of enrolments and progress records; dates only ever move
// earlier (re-enrolment resets the enrolment `created`); time = max(API, prior).
Object.assign(window.App, {

    ENR_META_KEY: 'surgdash_enrolment_sync',
    ENR_TARGET_PER_MIN: 55,             // just under the observed ~60/min sustained quota
    ENR_CHECKPOINT: 200,                // accounts between persisted checkpoints (~7 min)
    ENR_INCREMENTAL_SLACK_DAYS: 2,
    ENR_MAX_FAILURE_SHARE: 0.01,
    ENR_TIMELINES_DATE: '2026-06-14',   // date of the growth-timelines pull behind surghub_user_courses
    // TRANSIENT FAILURES ARE RETRIED IN PLACE, not allowed to end the run. A network
    // blip, a 5xx, an HTML error page, or a rate limit that outlasted apiGet's own
    // three retries → wait 15 s, 30 s, 1, 2, 5 min, then every 10 min, for up to
    // ENR_RETRY_MAX_ATTEMPTS (~6 h of outage) before giving up. An unattended
    // overnight run has to survive a one-second Wi-Fi hiccup: net::ERR_NETWORK_CHANGED
    // killed the 3 Sep 2026 run at page 227 of the account listing and the card
    // showed nothing but "paused" the next morning. Cancel still lands in < 0.5 s.
    ENR_RETRY_WAITS_S: [15, 30, 60, 120, 300],
    ENR_RETRY_MAX_WAIT_S: 600,
    ENR_RETRY_MAX_ATTEMPTS: 40,
    ENR_MIN_PER_MIN: 20,                // adaptive floor when the API keeps answering 429
    // /certificates has its own, much lower limit: a call made sooner than ~10 s after
    // the previous one is answered 429 + Retry-After 10 (one page per ~12 s, observed
    // 6 Sep 2026), so certificate pages are paced separately at just over 10 s.
    ENR_CERT_GAP_MS: 10500,

    _enrDay(ts) { const n = Number(ts); return n ? new Date(n * 1000).toISOString().slice(0, 10) : ''; },
    _enrIs404(e) { return /\b404\b|not found/i.test((e && e.message) || ''); },
    _enrFmtEta(sec) { return sec >= 5400 ? Math.round(sec / 3600) + ' h' : Math.max(1, Math.round(sec / 60)) + ' min'; },

    async _enrLoadMeta() { try { const m = await Storage.getItem(this.ENR_META_KEY); return (m && typeof m === 'object') ? m : {}; } catch (e) { return {}; } },
    async _enrSaveMeta(meta) { this._enrMeta = meta; try { await Storage.setItem(this.ENR_META_KEY, meta); } catch (e) { __swallowed(e, 'enrolments.meta'); } },

    // ── Pacing: never start a request less than 60/TARGET seconds after the last ──
    // (the gap widens for the session when the API keeps answering 429 — see _enrSlowDown).
    async _enrPace(minGapMs) {
        const gap = Math.max(this._enrGapMs || 60000 / this.ENR_TARGET_PER_MIN, minGapMs || 0);
        const now = Date.now(), wait = (this._enrLastReq || 0) + gap - now;
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        this._enrLastReq = Date.now();
    },
    _enrRateNow() { return Math.round(60000 / (this._enrGapMs || 60000 / this.ENR_TARGET_PER_MIN)); },
    _enrSlowDown() {
        const cur = this._enrGapMs || 60000 / this.ENR_TARGET_PER_MIN;
        this._enrGapMs = Math.min(60000 / this.ENR_MIN_PER_MIN, cur * 1.2);
        if (this._enrStats) this._enrStats.slowdowns++;
    },
    // What kind of failure apiGet surfaced: 'cancel' (stop now), 'notfound' (callers
    // treat a 404 as "nothing there"), 'fatal' (auth / config / bad request — retrying
    // cannot help), or 'transient' (everything else: network, 5xx, exhausted 429s,
    // a non-JSON body). apiGet throws plain Errors, so this reads the message.
    _enrErrorKind(e) {
        const m = String((e && e.message) || e || '');
        if (/cancelled/i.test(m)) return 'cancel';
        if (this._enrIs404(e)) return 'notfound';
        if (/^Auth failed|credentials not set|not loaded/i.test(m)) return 'fatal';
        if (/^API error (400|401|403|405|410|422)\b/.test(m)) return 'fatal';
        return 'transient';
    },
    // Message without the host and query string — fits the card and the overlay.
    _enrShortErr(e) { return String((e && e.message) || e || '').replace(/https?:\/\/\S+/g, u => u.replace(/^https?:\/\/[^/]+\/admin\/api\/v2/, '').replace(/\?\S*/, q => (/[.:]$/.test(q) ? q.slice(-1) : ''))).slice(0, 160); },
    _enrFmtWait(s) { return s >= 60 ? Math.round(s / 60) + ' min' : s + ' s'; },
    _enrFmtWhen(iso) { const d = iso ? new Date(iso) : null; if (!d || isNaN(d)) return ''; return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); },
    // Overlay text, remembered so a retry notice can restore it afterwards.
    _enrStatus(text, pct) { this._enrLastStatus = { text, pct }; this._updateApiSyncOverlay(text, pct); },
    // One paced GET that outlives transient failures (see the constants above).
    async _enrGet(LW, path, params) {
        for (let attempt = 0; ; attempt++) {
            await this._enrPace(path === '/certificates' ? this.ENR_CERT_GAP_MS : 0);
            if (this._enrStats) this._enrStats.requests++;
            try {
                const r = await LW.apiGet(path, params);
                if (attempt && this._enrLastStatus) this._updateApiSyncOverlay(this._enrLastStatus.text, this._enrLastStatus.pct);
                return r;
            } catch (e) {
                if (this._enrErrorKind(e) !== 'transient') throw e;
                const n = attempt + 1;
                if (n >= this.ENR_RETRY_MAX_ATTEMPTS) throw new Error(`Gave up after ${n} attempts over ~${Math.round(this._enrRetryTotalS() / 3600)} h — last error: ${e.message || e}`);
                if (/\b429\b/.test(e.message || '')) this._enrSlowDown();
                if (this._enrStats) this._enrStats.retries++;
                const waitS = attempt < this.ENR_RETRY_WAITS_S.length ? this.ENR_RETRY_WAITS_S[attempt] : this.ENR_RETRY_MAX_WAIT_S;
                console.warn(`[enrolments] ${this._enrShortErr(e)} — retrying in ${this._enrFmtWait(waitS)} (attempt ${n}/${this.ENR_RETRY_MAX_ATTEMPTS})`);
                const base = this._enrLastStatus ? this._enrLastStatus.text : 'Enrolments & progress';
                this._updateApiSyncOverlay(`${base} · ⚠ ${this._enrShortErr(e)} — retrying in ${this._enrFmtWait(waitS)} (attempt ${n}) · Cancel to pause`, null);
                await LW.sleep(waitS * 1000);   // abortable: Cancel rejects within half a second
            }
        }
    },
    _enrRetryTotalS() { const w = this.ENR_RETRY_WAITS_S; return w.reduce((a, b) => a + b, 0) + Math.max(0, this.ENR_RETRY_MAX_ATTEMPTS - w.length) * this.ENR_RETRY_MAX_WAIT_S; },

    // Latest course title per LearnWorlds course id, from the synced course list.
    _enrCourseTitleMap() {
        const latest = {};
        (this.data || []).forEach(d => { if (!d || !d.CourseId || !d.Course) return; const k = String(d.CourseId); if (!latest[k] || String(d.Timestamp || '') > String(latest[k].Timestamp || '')) latest[k] = d; });
        const map = {}; Object.keys(latest).forEach(k => { map[k] = latest[k].Course; });
        return map;
    },

    // ── Fetching ──────────────────────────────────────────────────────────
    async _enrFetchUsers(LW, onProgress) {
        const first = await this._enrGet(LW, '/users', { page: 1, items_per_page: 200 });
        const totalPages = (first.meta && first.meta.totalPages) || 1;
        const out = new Map();
        const take = (body) => (body && body.data || []).forEach(u => { if (u && u.id && u.email) out.set(String(u.id), { id: String(u.id), email: String(u.email).toLowerCase().trim(), first: u.first_name || '', last: u.last_name || '', lastLogin: Number(u.last_login) || 0, created: Number(u.created) || 0 }); });
        take(first);
        for (let p = 2; p <= totalPages; p++) {
            take(await this._enrGet(LW, '/users', { page: p, items_per_page: 200 }));
            if (onProgress) onProgress(p, totalPages, out.size);
        }
        return out;
    },

    // One account's enrolments + progress (both paginated). 404 = nothing there.
    async _enrFetchUser(LW, id) {
        const bodies = { courses: [], progress: [] };
        try {
            let page = 1, totalPages = 1;
            do { const r = await this._enrGet(LW, '/users/' + encodeURIComponent(id) + '/courses', { page, items_per_page: 50 }); bodies.courses.push(r); totalPages = (r.meta && r.meta.totalPages) || 1; page++; } while (page <= totalPages && page <= 20);
        } catch (e) { if (!this._enrIs404(e)) throw e; }
        if (!bodies.courses.some(b => (b.data || []).length)) return this._enrFromBodies(bodies);
        try {
            let page = 1, totalPages = 1;
            do { const r = await this._enrGet(LW, '/users/' + encodeURIComponent(id) + '/progress', { page, items_per_page: 50 }); bodies.progress.push(r); totalPages = (r.meta && r.meta.totalPages) || 1; page++; } while (page <= totalPages && page <= 20);
        } catch (e) { if (!this._enrIs404(e)) throw e; }
        return this._enrFromBodies(bodies);
    },
    // Pass over /certificates, one course at a time, NEWEST FIRST — the API lists
    // certificates by issue date descending (verified on 25 pages, 6 Sep 2026). The
    // index already holds everything issued before the last complete pass
    // (meta.certsAt), so a course's walk stops at the first page whose certificates
    // are all in the index AND all issued before that day; a course with nothing
    // indexed is walked to the end. That is ~1–2 pages per course instead of ~1,750
    // pages in total (≈ 5 h at this endpoint's limit). Page size is fixed at 20.
    async _enrFetchCertificates(LW, courseIds, onProgress, index, sinceIso) {
        const items = []; let pages = 0;
        const sinceDay = sinceIso ? String(sinceIso).slice(0, 10) : '';
        const keyOf = (c) => { const u = c && c.user && (c.user.id || c.user) || (c && c.user_id); return u && c.course_id ? String(u) + '|' + String(c.course_id) : ''; };
        const dayOf = (c) => typeof c.issued === 'number' ? this._enrDay(c.issued) : String(c.issued || '').slice(0, 10);
        for (let i = 0; i < courseIds.length; i++) {
            const cid = courseIds[i];
            try {
                let page = 1, totalPages = 1;
                do {
                    const r = await this._enrGet(LW, '/certificates', { course_id: cid, items_per_page: 20, page });
                    const data = r.data || []; pages++;
                    data.forEach(c => items.push(c));
                    totalPages = (r.meta && r.meta.totalPages) || 1;
                    if (onProgress) onProgress(i + 1, courseIds.length, items.length, page, totalPages, cid, pages);
                    const covered = !!(sinceDay && index && data.length && data.every(c => { const k = keyOf(c); return k && index[k]; }) && data.every(c => { const d = dayOf(c); return d && d < sinceDay; }));
                    if (covered) break;
                    page++;
                } while (page <= totalPages && page <= 400);
            } catch (e) { if (!this._enrIs404(e)) throw e; }
        }
        return items;
    },
    // After a certificate refresh: give existing learner records the certificates the
    // index now holds for them — rows built earlier in the session (before the pass),
    // or by the xlsx importer, may predate the certificate. Local join, no API call.
    // Only certificate fields change; completion comes from progress. Returns the
    // number of records updated.
    async _enrApplyCertIndexToRows(certIndex, users, titleMap) {
        const rows = this._rawCompletion; if (!Array.isArray(rows) || !rows.length || !users) return 0;
        const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
        const byKey = {};
        for (const k of Object.keys(certIndex || {})) {
            const bar = k.indexOf('|'); if (bar < 0) continue;
            const u = users.get(k.slice(0, bar)); if (!u) continue;
            const title = titleMap[k.slice(bar + 1)] || k.slice(bar + 1), v = certIndex[k], uid = this._djb2Hash(u.email);
            [uid + '|' + title, uid + '|' + norm(title)].forEach(kk => { if (!byKey[kk] || (v.i && v.i < byKey[kk].i)) byKey[kk] = v; });
        }
        let n = 0;
        for (const r of rows) {
            if (!r || r.certificate || !r.uid || !r.course) continue;
            const v = byKey[r.uid + '|' + r.course] || byKey[r.uid + '|' + norm(r.course)]; if (!v) continue;
            r.certificate = true; r.certificate_date = v.i || r.certificate_date || '';
            if (isFinite(parseFloat(v.s))) r.certificate_score = parseFloat(v.s);
            n++;
        }
        if (n) { await Storage.setItem('surghub_completion', rows); this._instIdx = null; this._anomCompCache = null; }
        return n;
    },

    // Normalise raw response bodies (live or from the receipt) into {enrolments, progress}.
    _enrFromBodies(bodies) {
        const enrolments = [], progress = {};
        (bodies.courses || []).forEach(r => (r && r.data || []).forEach(en => { if (en && en.course && en.course.id) enrolments.push({ courseId: String(en.course.id), title: en.course.title || '', created: Number(en.created) || 0 }); }));
        (bodies.progress || []).forEach(r => (r && r.data || []).forEach(p => { if (p && p.course_id) progress[String(p.course_id)] = p; }));
        return { enrolments, progress };
    },

    _enrCertMap(items, titleMap) {
        const map = {};
        (items || []).forEach(c => {
            if (!c) return;
            const userId = c.user && (c.user.id || c.user) || c.user_id; if (!userId) return;
            const title = c.courseName || titleMap[String(c.course_id)] || String(c.course_id || '');
            const issued = typeof c.issued === 'number' ? this._enrDay(c.issued) : String(c.issued || '').slice(0, 10);
            const v = { issued, score: c.score };
            [String(userId) + '|' + title, String(userId) + '|' + title.toLowerCase().replace(/[^a-z0-9]/g, '')].forEach(k => { if (!map[k] || (issued && issued < map[k].issued)) map[k] = v; });
        });
        return map;
    },

    // ── Certificate index: LearnWorlds user id | course id → {issued, score} ──
    // Certificates never disappear and issued dates never change, so every
    // certificate page ever captured (receipts) or fetched is final. The index is
    // persisted (settings/cert_index.json) and only grows; a fresh pass over
    // /certificates (~1,700 pages at the API's fixed 20/page) is made at most once
    // a day instead of once per session.
    ENR_CERT_KEY: 'surgdash_cert_index',
    ENR_CERT_MAX_AGE_H: 24,
    async _enrLoadCertIndex() { try { const v = await Storage.getItem(this.ENR_CERT_KEY); return (v && typeof v === 'object') ? v : {}; } catch (e) { return {}; } },
    async _enrSaveCertIndex(index) { try { await Storage.setItem(this.ENR_CERT_KEY, index); } catch (e) { __swallowed(e, 'enrolments.certIndex'); } },
    _enrCertIndexAdd(index, items) {
        let added = 0;
        (items || []).forEach(c => {
            if (!c) return;
            const userId = c.user && (c.user.id || c.user) || c.user_id, courseId = c.course_id; if (!userId || !courseId) return;
            const issued = typeof c.issued === 'number' ? this._enrDay(c.issued) : String(c.issued || '').slice(0, 10);
            const k = String(userId) + '|' + String(courseId);
            if (!index[k] || (issued && issued < index[k].i)) { if (!index[k]) added++; index[k] = { i: issued, s: c.score == null ? '' : c.score }; }
        });
        return added;
    },
    // The lookup shape _enrBuildRows expects: userId|courseTitle (and a normalised title key).
    _enrCertMapFromIndex(index, titleMap) {
        const map = {};
        for (const k of Object.keys(index || {})) {
            const bar = k.indexOf('|'); if (bar < 0) continue;
            const userId = k.slice(0, bar), courseId = k.slice(bar + 1);
            const title = titleMap[courseId] || courseId;
            const v = { issued: index[k].i, score: index[k].s };
            [userId + '|' + title, userId + '|' + title.toLowerCase().replace(/[^a-z0-9]/g, '')].forEach(kk => { if (!map[kk] || (v.issued && v.issued < map[kk].issued)) map[kk] = v; });
        }
        return map;
    },

    _enrStarted(p) {
        if (!p) return false;
        if ((Number(p.progress_rate) || 0) > 0 || (Number(p.time_on_course) || 0) > 0 || (Number(p.completed_units) || 0) > 0) return true;
        const s = String(p.status || '').toLowerCase();
        return !!s && !/not.?started|enrol/.test(s) && /start|progress|complet/.test(s);
    },

    // Rows in the xlsx importer's exact shape — union of enrolments and progress;
    // dates only move earlier; time only grows. See file header.
    _enrBuildRows(user, fetched, certMap, titleMap, priorByKey) {
        const rows = [];
        const uid = this._djb2Hash(user.email);
        const name = [user.first, user.last].filter(Boolean).join(' ').trim();
        const byCourse = {};
        for (const en of fetched.enrolments) byCourse[en.courseId] = { en, p: fetched.progress[en.courseId] || null };
        for (const cid of Object.keys(fetched.progress)) if (!byCourse[cid]) byCourse[cid] = { en: null, p: fetched.progress[cid] };
        const minDay = (...ds) => ds.filter(Boolean).sort()[0] || '';
        for (const cid of Object.keys(byCourse)) {
            const { en, p } = byCourse[cid];
            const course = titleMap[cid] || (en && en.title) || cid;
            const prior = priorByKey ? priorByKey[uid + '|' + course] : null;
            const started = this._enrStarted(p) || !!(prior && prior.start_date);
            const enrolledDay = en ? this._enrDay(en.created) : '';
            const completedAt = p && p.completed_at ? this._enrDay(p.completed_at) : '';
            const startDate = started ? minDay(enrolledDay, completedAt, prior && prior.start_date) : '';
            const completed = !!(p && (String(p.status || '').toLowerCase() === 'completed' || (Number(p.progress_rate) || 0) >= 100)) || !!(prior && prior.completed);
            const cert = certMap[user.id + '|' + course] || certMap[user.id + '|' + String(course).toLowerCase().replace(/[^a-z0-9]/g, '')] || null;
            const apiMinutes = Math.round((Number(p && p.time_on_course) || 0) / 60);
            const certDate = cert ? cert.issued : (prior && prior.certificate ? prior.certificate_date : '');
            rows.push({
                uid, email: user.email, name,
                course, course_sheet: course, course_id: cid,
                start_date: startDate, start_month: startDate ? startDate.slice(0, 7) : '',
                completion_date: minDay(completedAt, prior && prior.completion_date) || (completed && certDate ? certDate : ''),
                completed,
                time_minutes: Math.max(apiMinutes, Number(prior && prior.time_minutes) || 0),
                score: Number(p && p.average_score_rate) || Number(prior && prior.score) || 0,
                certificate: !!cert || !!(prior && prior.certificate),
                certificate_date: certDate,
                certificate_score: cert && isFinite(parseFloat(cert.score)) ? parseFloat(cert.score) : (Number(prior && prior.certificate_score) || 0),
                enrolled_date: enrolledDay,
                source: 'api',
            });
        }
        return rows;
    },

    _enrPriorMap(existing) {
        const priorByKey = {};
        (existing || []).forEach(r => { if (r && r.uid && r.course) { const k = r.uid + '|' + r.course; const q = priorByKey[k]; if (!q || (r.start_date && (!q.start_date || r.start_date < q.start_date))) priorByKey[k] = r; } });
        return priorByKey;
    },

    // Merge freshly built rows for a set of accounts into the store (replace those uids only).
    async _enrPersist(newRows, processedUids, mode) {
        const existing = Array.isArray(this._rawCompletion) ? this._rawCompletion : [];
        const drop = new Set(processedUids);
        const kept = (mode === 'full-replace') ? [] : existing.filter(r => !drop.has(r.uid));
        const rows = kept.concat(newRows);
        await Storage.setItem('surghub_completion', rows);
        this._rawCompletion = rows; this._completionLoadPromise = null;
        this._instIdx = null; this._anomCompCache = null;
        return rows.length;
    },

    // ── Offline: ingest a raw receipt (the current/last enrolments pull) ─────
    // Every enrolments receipt on disk, oldest first (retention keeps the last 3).
    _enrReceiptDirs() {
        try {
            const fs = electronAPI.fs, path = electronAPI.path, dir = path.join(Storage.DATA_DIR, 'surghub', 'raw');
            return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory && /^enrolments__/.test(e.name) && fs.existsSync(path.join(dir, e.name, 'pull.jsonl'))).map(e => e.name).sort().map(n => path.join(dir, n));
        } catch (e) { return []; }
    },
    _enrLatestReceiptDir() { const d = this._enrReceiptDirs(); return d.length ? d[d.length - 1] : null; },
    // Receipts outgrow V8's ~512 MB string limit within a day of fetching: the
    // 4–6 Sep 2026 session's reached 897 MB and "Cannot create a string longer
    // than 0x1fffffe8 characters" ended three resume attempts. So the file is read
    // in ENR_READ_CHUNK slices and handled line by line, and account bodies are
    // kept only for ids NOT in `skipIds` (everything an earlier run already saved)
    // — an interrupted session's unsaved tail, not tens of thousands of finished
    // accounts. /users pages and /certificates pages are always kept (small).
    ENR_READ_CHUNK: 16 * 1024 * 1024,
    _enrReadLines(file, onLine) {
        const fs = electronAPI.fs;
        if (typeof fs.openSync !== 'function') {   // older preload without chunked reads (works up to ~512 MB)
            for (const l of fs.readFileSync(file, 'utf8').split('\n')) if (l) onLine(l);
            return;
        }
        const fd = fs.openSync(file), dec = new TextDecoder('utf-8');
        let carry = '', pos = 0;
        try {
            for (;;) {
                const chunk = fs.readSync(fd, this.ENR_READ_CHUNK, pos);
                if (!chunk || !chunk.length) break;
                pos += chunk.length;
                const parts = (carry + dec.decode(chunk, { stream: true })).split('\n');
                carry = parts.pop();
                for (const l of parts) if (l) onLine(l);
            }
            carry += dec.decode();
            if (carry) onLine(carry);
        } finally { try { fs.closeSync(fd); } catch (e) { __swallowed(e, 'enrolments.receipt'); } }
    },
    _enrParseReceipt(pullDir, skipIds) {
        const path = electronAPI.path;
        const users = new Map(), perUser = new Map(), certs = [];
        let lastCertT = 0, accountsAfterCert = 0;   // the run moves on to accounts only after a COMPLETE certificate pass
        const head = /^\{"t":(\d+),"path":"([^"]*)"/;   // cheap peek — no JSON.parse for bodies nobody needs
        const perUserRe = /^\/users\/([^/]+)\/(courses|progress)$/;
        this._enrReadLines(path.join(pullDir, 'pull.jsonl'), (line) => {
            const h = head.exec(line);
            let o = null, p, t;
            if (h) { p = h[2]; t = Number(h[1]) || 0; }
            else { try { o = JSON.parse(line); } catch (e) { return; } p = String(o.path || ''); t = Number(o.t) || 0; }
            const m = perUserRe.exec(p);
            if (m) { if (lastCertT) accountsAfterCert++; if (skipIds && skipIds[m[1]]) return; }
            else if (p !== '/users' && p !== '/certificates') return;
            let b; try { o = o || JSON.parse(line); b = JSON.parse(o.body); } catch (e) { return; }
            if (p === '/users') { (b.data || []).forEach(u => { if (u && u.id && u.email) users.set(String(u.id), { id: String(u.id), email: String(u.email).toLowerCase().trim(), first: u.first_name || '', last: u.last_name || '', lastLogin: Number(u.last_login) || 0, created: Number(u.created) || 0 }); }); return; }
            if (p === '/certificates') { (b.data || []).forEach(c => certs.push(c)); lastCertT = t || lastCertT; accountsAfterCert = 0; return; }
            const rec = perUser.get(m[1]) || { courses: [], progress: [] }; rec[m[2]].push(b); perUser.set(m[1], rec);
        });
        return { users, perUser, certs, pullDir, lastCertT, accountsAfterCert };
    },
    // Build + persist rows for every account the receipt holds a /courses body for.
    // Accounts already in `alreadyProcessed` are skipped. Returns the ids ingested.
    async _enrIngestReceipt(parsed, titleMap, alreadyProcessed, onProgress, certMap) {
        certMap = certMap || this._enrCertMap(parsed.certs, titleMap);
        if (this._rawCompletion == null && this.ensureCompletionLoaded) { try { await this.ensureCompletionLoaded(); } catch (e) { __swallowed(e, 'enrolments.load'); } }
        const priorByKey = this._enrPriorMap(this._rawCompletion);
        const rows = [], uids = [], ids = [];
        let i = 0;
        for (const [id, bodies] of parsed.perUser) {
            i++;
            if (alreadyProcessed && alreadyProcessed[id]) continue;
            const u = parsed.users.get(id); if (!u || !bodies.courses.length) continue;
            rows.push(...this._enrBuildRows(u, this._enrFromBodies(bodies), certMap, titleMap, priorByKey));
            uids.push(this._djb2Hash(u.email)); ids.push(id);
            if (onProgress && i % 500 === 0) onProgress(i, parsed.perUser.size);
        }
        if (ids.length) await this._enrPersist(rows, uids, 'merge');
        return { ids, rows: rows.length };
    },

    _enrSelectUsers(users, mode, meta) {
        const list = [...users.values()];
        const processed = (meta.run && meta.run.processed) || {};
        const uc = this._enrUserCourses || null;
        const tl = Math.floor(new Date(this.ENR_TIMELINES_DATE).getTime() / 1000);
        let out = list.filter(u => !processed[u.id]);
        if (mode === 'incremental' && meta.lastRunEpoch) {
            const since = meta.lastRunEpoch - this.ENR_INCREMENTAL_SLACK_DAYS * 86400;
            const known = new Set((this._rawCompletion || []).map(r => r.uid));
            out = out.filter(u => u.lastLogin >= since || u.created >= since || !known.has(this._djb2Hash(u.email)));
        }
        // No course in the growth-timelines pull and no activity since → nothing to fetch.
        if (uc) out = out.filter(u => uc[u.id] || u.created >= tl || u.lastLogin >= tl);
        out.sort((a, b) => b.lastLogin - a.lastLogin);
        return out;
    },

    // ── Entry point ────────────────────────────────────────────────────────
    async syncEnrolmentsFromApi(opts) {
        opts = opts || {};
        const LW = window.LearnWorlds;
        if (!LW || !LW.apiGet) { if (!opts.silent) alert('LearnWorlds module not loaded.'); return; }
        const creds = await LW.getCredentials();
        if (!creds.clientId || !creds.apiToken) { if (!opts.silent) this.showMsg('⚠ Add LearnWorlds API credentials first'); return; }
        if (this._apiSyncInFlight) { this.showMsg('⚠ A sync is already running — let it finish or Cancel it first.'); return; }
        if (!(this.data || []).length) { if (!opts.silent) alert('Run "Sync Courses" (card 1) first — enrolments are matched to the synced course list.'); return; }

        let meta = await this._enrLoadMeta();
        const openRun = meta.run && !meta.run.done ? meta.run : null;
        const priorProcessed = (meta.run && meta.run.processed) || {};   // saved by an earlier run (open or completed): their receipt bodies need no re-ingest
        let mode;
        if (opts.mode === 'full') {
            if (openRun && !opts.silent && !confirm('A run is already in progress (' + Object.keys(openRun.processed || {}).length.toLocaleString() + ' of ' + (openRun.total || '?').toLocaleString() + ' accounts done). Discard it and start a full re-sync from scratch?')) return;
            mode = 'full'; meta.run = null;
        } else if (openRun) {
            mode = openRun.mode;   // resume
        } else {
            mode = (opts.mode === 'incremental' || meta.lastRunEpoch) ? 'incremental' : 'full';
        }
        const perMin = this.ENR_TARGET_PER_MIN;
        if (!opts.silent) {
            const doneN = openRun ? Object.keys(openRun.processed || {}).length : 0;
            const msg = openRun
                ? `Resume the enrolment & progress sync?\n\n${doneN.toLocaleString()} of ${(openRun.total || 0).toLocaleString()} accounts are done. Anything the raw receipt already holds is ingested first without calling the API; the rest continues at ~${perMin} requests/minute (the LearnWorlds sustained limit), saving progress every ${this.ENR_CHECKPOINT} accounts. Cancel any time — nothing is lost.\n\nContinue?`
                : mode === 'full'
                    ? `FULL enrolment & progress sync from the LearnWorlds API?\n\nAnything a previous run's receipt already holds is ingested first without calling the API. Then two calls per account at ~${perMin} requests/minute — the API's sustained limit — so the whole platform takes roughly a day and a half of API time. It saves progress every ${this.ENR_CHECKPOINT} accounts and resumes where it left off, so run it in sessions (overnight, keep the Mac awake: \`caffeinate -i\`). Cancel any time — nothing is lost.\n\nContinue?`
                    : `Incremental enrolment & progress sync?\n\nRe-fetches accounts active since the last completed run (${String(meta.lastRun || '').slice(0, 10)}) plus new ones — usually minutes.\n\nContinue?`;
            if (!confirm(msg)) return;
        }

        this._apiSyncInFlight = true;
        if (LW.resetAbort) LW.resetAbort();   // an earlier Cancel must not end this run at its first request
        this._enrGapMs = null; this._enrStats = { retries: 0, slowdowns: 0, requests: 0 }; const sessionT0 = Date.now(); this._enrLastStatus = null;
        try { await this._backupSurghubBeforeSync(); } catch (e) { __swallowed(e, 'enrolments.backup'); }
        if (!opts.silent) this._showApiSyncOverlay('Enrolments & progress (API)');
        this._enrStatus('Preparing…', 0);
        const summary = { mode, resumed: !!openRun, ingestedOffline: 0, users: 0, selected: 0, done: 0, failed: 0, noEnrolments: 0, rows: 0 };
        let ok = false, cancelled = false;
        const titleMap = this._enrCourseTitleMap();
        // Buffered rows since the last checkpoint — flushed on checkpoint, cancel, error, or completion.
        let pending = [], pendingUids = [], pendingIds = [];
        const run = openRun || { startedAt: new Date().toISOString(), mode, total: 0, processed: {}, done: false };
        meta.run = run;
        run.sessions = (run.sessions || 0) + 1; run.sessionAt = new Date().toISOString();
        delete run.pausedAt; delete run.pausedBy; delete run.lastError;
        const checkpoint = async (label) => {
            if (pendingIds.length) {
                await this._enrPersist(pending, pendingUids, 'merge');
                pendingIds.forEach(id => { run.processed[id] = 1; });
                pending = []; pendingUids = []; pendingIds = [];
            }
            run.checkpointAt = new Date().toISOString();
            const mins = (Date.now() - sessionT0) / 60000;
            if (mins >= 3 && this._enrStats) run.reqPerMin = Math.round(this._enrStats.requests / mins * 10) / 10;   // observed, for the card's ETA
            await this._enrSaveMeta(meta);
            if (label) this._enrStatus(label, null);
        };
        try {
            // 1. Harvest EVERY receipt on disk — offline, on every run: certificate
            //    pages go into the persistent index (they are final), and accounts whose
            //    enrolment/progress bodies were captured but never processed (an
            //    interrupted run, or one from a build that kept no run record) are
            //    ingested without touching the API. Idempotent: processed ids are
            //    skipped; rows merge with dates only moving earlier.
            const certIndex = await this._enrLoadCertIndex();
            {
                const dirs = this._enrReceiptDirs();
                let harvested = 0;
                for (let d = 0; d < dirs.length; d++) {
                    this._enrStatus(`Reading receipt ${d + 1}/${dirs.length} from earlier sessions…`, 1);
                    const parsed = this._enrParseReceipt(dirs[d], Object.assign({}, priorProcessed, run.processed));
                    harvested += this._enrCertIndexAdd(certIndex, parsed.certs);
                    // A receipt whose run went on to fetch accounts after its last
                    // certificate page holds a COMPLETE pass (the pass throws on any
                    // failure) — so its time counts as the last refresh and today's
                    // ~31-minute pass is skipped when it is under a day old.
                    if (parsed.lastCertT && parsed.accountsAfterCert >= 10) { const iso = new Date(parsed.lastCertT).toISOString(); if (!meta.certsAt || iso > meta.certsAt) meta.certsAt = iso; }
                    const certMapNow = this._enrCertMapFromIndex(certIndex, titleMap);
                    const ing = await this._enrIngestReceipt(parsed, titleMap, run.processed, (i, n) => this._enrStatus(`Ingesting receipt ${d + 1}/${dirs.length}… ${i.toLocaleString()}/${n.toLocaleString()}`, 1 + Math.round(i / n * 4)), certMapNow);
                    ing.ids.forEach(id => { run.processed[id] = 1; });
                    summary.ingestedOffline += ing.ids.length;
                }
                if (harvested) await this._enrSaveCertIndex(certIndex);
                await this._enrSaveMeta(meta);
                if (!opts.silent && this.view === 'upload') this.renderView();   // card 2 → "in progress"
            }
            try { LW.startRawPull('enrolments'); } catch (e) { __swallowed(e, 'enrolments.raw'); }

            // 2. Accounts (paced; ~5 min for the whole list)
            const users = await this._enrFetchUsers(LW, (p, t, n) => this._enrStatus(`Listing accounts… page ${p}/${t} (${n.toLocaleString()})`, 5 + Math.round(p / t * 5)));
            summary.users = users.size; run.total = users.size;

            // 3. Certificates for the rows built below come from the index as it stands
            //    (receipts + earlier passes); the refresh itself runs AFTER the accounts
            //    (step 6) and is then applied to every row, so nothing depends on order.
            const certMap = this._enrCertMapFromIndex(certIndex, titleMap);
            this._enrStatus(`Certificates: index holds ${Object.keys(certIndex).length.toLocaleString()} (refreshed ${meta.certsAt ? String(meta.certsAt).slice(0, 10) : 'never'})`, 15);

            // 4. Selection
            if (this._enrUserCourses === undefined) { this._enrUserCourses = null; try { const uc = await Storage.getItem('surghub_user_courses'); if (uc && typeof uc === 'object') this._enrUserCourses = uc; } catch (e) { __swallowed(e, 'enrolments.uc'); } }
            if (this._rawCompletion == null && this.ensureCompletionLoaded) { try { await this.ensureCompletionLoaded(); } catch (e) { __swallowed(e, 'enrolments.load'); } }
            const selected = this._enrSelectUsers(users, mode, meta);
            summary.selected = selected.length;
            run.processedAtSel = Object.keys(run.processed).length; run.selectedLeft = selected.length;
            run.skipped = Math.max(0, users.size - run.processedAtSel - selected.length);   // nothing to fetch (or not active, in incremental mode)
            const priorByKey = this._enrPriorMap(this._rawCompletion);
            await this._enrSaveMeta(meta);

            // 5. Per-account fetch, paced, checkpointed
            const t0 = Date.now(); let sinceCheckpoint = 0;
            for (let i = 0; i < selected.length; i++) {
                const u = selected[i];
                let fetched;
                // _enrGet retries transient failures in place; what surfaces here is a
                // cancel, an auth/config failure (stop — every account would fail the
                // same way) or a bad request on this one account (skip it, keep going).
                try { fetched = await this._enrFetchUser(LW, u.id); }
                catch (e) { const kind = this._enrErrorKind(e); if (kind === 'cancel') { cancelled = true; throw e; } if (kind === 'fatal' && /^Auth failed|credentials/i.test(e.message || '')) throw e; summary.failed++; console.warn('[enrolments] account skipped:', u.id, e.message || e); continue; }
                const f = fetched;
                pending.push(...this._enrBuildRows(u, f, certMap, titleMap, priorByKey));
                pendingUids.push(this._djb2Hash(u.email)); pendingIds.push(u.id);
                summary.done++; if (!f.enrolments.length && !Object.keys(f.progress).length) summary.noEnrolments++;
                if (++sinceCheckpoint >= this.ENR_CHECKPOINT) { sinceCheckpoint = 0; await checkpoint(); }
                const elapsed = (Date.now() - t0) / 1000, eta = summary.done ? (selected.length - i - 1) * elapsed / summary.done : 0;
                this._enrStatus(`Enrolments… ${(i + 1).toLocaleString()}/${selected.length.toLocaleString()} accounts this session · ${(Object.keys(run.processed).length + pendingIds.length).toLocaleString()}/${run.total.toLocaleString()} overall · ~${this._enrFmtEta(eta)} left · saved every ${this.ENR_CHECKPOINT}`, 15 + Math.round((i + 1) / selected.length * 82));
            }
            if (summary.failed > Math.max(20, summary.selected * this.ENR_MAX_FAILURE_SHARE)) throw new Error(`${summary.failed} of ${summary.selected} accounts failed after retries — stopping; progress so far is saved, run again later.`);

            // 6. Certificates — after the accounts, at most once a day: an incremental
            //    walk (newest first, stopping where the index is already complete), then
            //    the index is applied to EVERY record, so rows built above and rows from
            //    the xlsx importer pick up certificates issued since they were fetched.
            const certAgeH = meta.certsAt ? (Date.now() - Date.parse(meta.certsAt)) / 3600000 : Infinity;
            if (certAgeH > this.ENR_CERT_MAX_AGE_H) {
                await checkpoint();
                const courseIds = Object.keys(titleMap), tc0 = Date.now();
                this._enrStatus(`Certificates: checking ${courseIds.length} courses for certificates issued since ${meta.certsAt ? String(meta.certsAt).slice(0, 10) : 'the beginning'} — ~${Math.round(this.ENR_CERT_GAP_MS / 1000)} s per page, this endpoint's limit…`, 97);
                const items = await this._enrFetchCertificates(LW, courseIds, (i, n, k, page, totalPages, cid, pages) => this._enrStatus(`Certificates… course ${i}/${n} (${titleMap[cid] || cid}) · page ${page}/${totalPages} · ${pages} page${pages === 1 ? '' : 's'} so far · ~${this._enrFmtEta(Math.max(10, (n - i) * (Date.now() - tc0) / 1000 / Math.max(1, i)))} left`, 97 + Math.round(i / n * 2)), certIndex, meta.certsAt);
                summary.certsNew = this._enrCertIndexAdd(certIndex, items);
                await this._enrSaveCertIndex(certIndex);
                meta.certsAt = new Date().toISOString(); await this._enrSaveMeta(meta);
                this._enrStatus('Applying certificates to learner records…', 99);
                summary.certsApplied = await this._enrApplyCertIndexToRows(certIndex, users, titleMap);
            }

            // 7. Finish
            await checkpoint('Saving…');
            run.done = true; run.finishedAt = new Date().toISOString();
            meta.lastRun = run.finishedAt; meta.lastRunEpoch = Math.floor(Date.now() / 1000); meta.lastMode = mode;
            await this._enrSaveMeta(meta);
            await this._stampSync('progress'); await this._stampSync('enrolments');
            await this.handleDbSave();
            summary.rows = (this._rawCompletion || []).length;
            summary.retries = this._enrStats.retries; summary.slowdowns = this._enrStats.slowdowns;
            ok = true;
        } catch (e) {
            if (!cancelled && this._enrErrorKind(e) === 'cancel') cancelled = true;   // Cancel during the listing or the certificate pass
            // Keep everything fetched so far — that is the whole point — and record
            // WHY the run stopped, so the card can say so tomorrow morning.
            run.pausedAt = new Date().toISOString(); run.pausedBy = cancelled ? 'cancel' : 'error';
            if (!cancelled) { run.lastError = String(e.message || e).slice(0, 300); run.errors = (run.errors || 0) + 1; }
            try { await checkpoint(); if (pendingIds.length === 0 && summary.done) { await this._stampSync('progress'); await this.handleDbSave(); } } catch (e2) { __swallowed(e2, 'enrolments.checkpoint'); }
            console.error('[enrolments] sync ' + (cancelled ? 'cancelled' : 'stopped') + ':', e);
            if (!opts.silent) this.showMsg((cancelled ? '⏸ Enrolment sync paused' : '⚠ Enrolment sync stopped') + ' — ' + Object.keys(run.processed).length.toLocaleString() + ' of ' + (run.total || '?').toLocaleString() + ' accounts saved. Click "Sync from API" to resume.' + (cancelled ? '' : ' (' + this._enrShortErr(e) + ')'), !cancelled);
            if (!cancelled) throw e;
            return summary;
        } finally {
            try { LW.finishRawPull(ok); } catch (e) { __swallowed(e, 'enrolments.raw'); }
            this._apiSyncInFlight = false;
            if (!opts.silent) { this._hideApiSyncOverlay(); if (!ok && this.view === 'upload') this.renderView(); }   // card 2 → paused / stopped-by-error, after the in-flight flag clears
        }
        if (!opts.silent) {
            this.showMsg(`✓ Enrolments synced (${mode}${summary.resumed ? ', resumed' : ''}): ${summary.done.toLocaleString()} accounts fetched` + (summary.ingestedOffline ? `, ${summary.ingestedOffline.toLocaleString()} ingested from the receipt` : '') + ` (${summary.noEnrolments.toLocaleString()} with no enrolments) → ${summary.rows.toLocaleString()} learner-course records` + (summary.failed ? ` · ${summary.failed} accounts skipped after retries` : '') + (summary.certsNew ? ` · ${summary.certsNew.toLocaleString()} new certificate${summary.certsNew === 1 ? '' : 's'}` : '') + (summary.certsApplied ? ` (${summary.certsApplied.toLocaleString()} records updated)` : '') + (summary.retries ? ` · ${summary.retries} transient error${summary.retries === 1 ? '' : 's'} retried` : ''));
            this.renderView();
        }
        return summary;
    },

    // Card-2 status line: open run / last completed run. Loads meta lazily.
    _enrStatusHtml() {
        if (this._enrMeta === undefined) { this._enrMeta = null; this._enrLoadMeta().then(m => { this._enrMeta = m || {}; if (this.view === 'upload') this.renderView(); }); }
        const m = this._enrMeta; if (!m) return '';
        const esc = (t) => this.escapeHtml(t);
        if (m.run && !m.run.done) {
            const r = m.run, done = Object.keys(r.processed || {}).length, total = r.total || 0;
            // Accounts still to fetch: what the last selection left, minus what this run has done since —
            // not total − done, which counts the accounts the selection skips as nothing to fetch.
            const left = (r.selectedLeft != null && r.processedAtSel != null) ? Math.max(0, r.selectedLeft - (done - r.processedAtSel)) : (total ? Math.max(0, total - done) : 0);
            const rate = r.reqPerMin || this.ENR_TARGET_PER_MIN;
            const saved = `${done.toLocaleString()} accounts fetched` + (left ? ` · ${left.toLocaleString()} to go` : '') + (r.skipped ? ` · ${r.skipped.toLocaleString()} skipped (nothing to fetch)` : '');
            const eta = left ? ` · ~${this._enrFmtEta(left * 2 * 60 / rate)} left at ${Math.round(rate)} req/min` : '';
            const started = `Started ${esc(this._enrFmtWhen(r.startedAt))}${r.sessions > 1 ? ', session ' + r.sessions : ''}.`;
            const pill = (cls, icon, text, title) => `<span class="inline-flex items-center gap-1.5 text-xs ${cls} font-medium ml-2" title="${title}"><i data-lucide="${icon}" width="12"></i> ${text}</span>`;
            if (this._apiSyncInFlight) return pill('text-emerald-700', 'loader', `API run in progress · ${saved}${eta}`, `${started} Progress is saved every ${this.ENR_CHECKPOINT} accounts; Cancel in the corner panel pauses it.`);
            if (r.pausedBy === 'error') return pill('text-red-700', 'alert-triangle', `API run stopped by an error ${esc(this._enrFmtWhen(r.pausedAt))} — ${esc(this._enrShortErr(r.lastError || ''))} · ${saved}${eta} · click "Sync from API" to resume`, `${started} ${esc(r.lastError || '')}`);
            if (r.pausedBy === 'cancel') return pill('text-amber-700', 'pause-circle', `API run paused ${esc(this._enrFmtWhen(r.pausedAt))} (Cancel) · ${saved}${eta} · click "Sync from API" to resume`, `${started} Anything already fetched is kept.`);
            return pill('text-amber-700', 'pause-circle', `API run interrupted · ${saved}${eta} · click "Sync from API" to resume`, `${started} The app closed or crashed mid-run; anything already fetched is kept.`);
        }
        if (m.lastRun) return `<span class="inline-flex items-center gap-1.5 text-xs text-slate-400 font-medium ml-2"><i data-lucide="cloud-download" width="12" class="text-emerald-500"></i> API sync ${esc(String(m.lastRun).slice(0, 10))} (${esc(m.lastMode || '')})</span>`;
        return '';
    },
});
