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
//     active accounts go first so fresh data lands early. Incremental runs
//     re-fetch only accounts that logged in after their last fetch
//     (meta.fetchedAt) and walk certificates only for courses with fresh
//     completions (see the constants below).
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
    ENR_TARGET_PER_MIN: 50,             // the profile that has run for days without a refusal (see the note below)
    ENR_CHECKPOINT: 200,                // accounts between persisted checkpoints (~7 min)
    ENR_INCREMENTAL_SLACK_DAYS: 2,      // fallback rule only (no per-account fetch times yet)
    // INCREMENTAL RUNS FETCH ONLY WHAT CAN HAVE CHANGED. meta.fetchedAt holds, per
    // account, the epoch of its last fetch (kept across runs; seeded from receipts).
    // An account is re-fetched when it logged in after that (progress needs a login),
    // was created after it, or was never fetched. ENR_SESSION_SLACK_S covers a login
    // shortly BEFORE the fetch whose session continued after it. Result: a daily run
    // touches the day's active accounts (~400) instead of everyone active in a
    // two-day window (~2,500).
    ENR_SESSION_SLACK_S: 6 * 3600,
    // CERTIFICATE WALKS ARE TARGETED. Each session walks (newest-first, early stop)
    // only the courses where a fetched account completed something since the last
    // walk; every course is walked at most every ENR_CERT_FULL_DAYS as a safety net
    // (a certificate issued long after completion, or to an account that did not log
    // in). At ~10 s a page this turns a ~1 h daily walk into ~10 min most days.
    ENR_CERT_FULL_DAYS: 3,
    // PARALLELISM HIDES LATENCY, NOT THE QUOTA — AND THE API PUNISHES IT. Requests
    // take their turn at the shared pacer (one start every 60/ENR_TARGET_PER_MIN s), so
    // the rate never exceeds the target; workers only overlap the waits. But on 10 Sep
    // two account workers at 55/min were refused (429, Retry-After 30–60 s) after
    // 13 minutes, and because the second worker kept requesting while the first waited,
    // the API let ONE request through per minute for two hours: it lifts the penalty
    // only after the client has been completely silent. So: one account worker by
    // default (a single flow at ~50/min ran for days without a refusal), two for the
    // listing, and on any 429 EVERY worker holds (_enrRateLimited) and the session
    // continues single-file at a lower rate.
    ENR_WORKERS: 1,
    ENR_LIST_WORKERS: 2,
    ENR_HOLD_MIN_MS: 60000,             // silence after a 429: at least this, or the server's Retry-After
    ENR_HOLD_MAX_MS: 15 * 60000,
    ENR_HOLD_REPEAT_MS: 5 * 60000,      // a second 429 this soon after a hold doubles the next hold
    // A users listing made by the Learners sync (card 3) within this many minutes is
    // reused instead of listing again — the nightly run lists once, not twice.
    ENR_LISTING_REUSE_MIN: 30,
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
    _enrPace(minGapMs) {
        // Serialized: concurrent callers queue and each gets its own slot, so two
        // workers can never start inside the same gap.
        const slot = async () => {
            // A rate-limit hold (_enrPausedUntil) outranks the gap: nothing starts before it
            // ends — re-checked after every wait, since a hold can begin while a slot sleeps.
            for (;;) {
                const gap = Math.max(this._enrGapMs || 60000 / this.ENR_TARGET_PER_MIN, minGapMs || 0);
                const wait = Math.max((this._enrLastReq || 0) + gap, this._enrPausedUntil || 0) - Date.now();
                if (wait > 0) { await this._enrSleep(wait); continue; }
                // Single-file after a refusal: one request in flight at a time, whatever a worker is in the middle of.
                if (this._enrSingleFile && this._enrInFlight > 0) { await this._enrSleep(50); continue; }
                break;
            }
            this._enrLastReq = Date.now();
        };
        const p = (this._enrPaceChain || Promise.resolve()).then(slot, slot);
        this._enrPaceChain = p.catch(() => {});
        return p;
    },
    // Abortable when the LearnWorlds module is there (Cancel ends a hold within half a second).
    _enrSleep(ms) { const LW = window.LearnWorlds; return (LW && LW.sleep) ? LW.sleep(ms) : new Promise(r => setTimeout(r, ms)); },
    _enrRateNow() { return Math.round(60000 / (this._enrGapMs || 60000 / this.ENR_TARGET_PER_MIN)); },
    _enrSlowDown(factor) {
        const cur = this._enrGapMs || 60000 / this.ENR_TARGET_PER_MIN;
        this._enrGapMs = Math.min(60000 / this.ENR_MIN_PER_MIN, cur * (factor || 1.2));
        if (this._enrStats) this._enrStats.slowdowns++;
    },
    _enrIs429(e) { return !!(e && (e.status === 429 || /\b429\b/.test(String(e.message || '')))); },
    // The API refused (429): go silent — every worker, since the pacer holds them all —
    // for the server's Retry-After (at least ENR_HOLD_MIN_MS), longer each time it
    // happens again soon after; then continue single-file and a third slower. Keeping
    // one worker going while another waited is what turned a 60 s refusal into two
    // hours at one request a minute.
    _enrRateLimited(e) {
        const now = Date.now(), server = Number(e && e.retryAfterMs) || 0;
        let hold = Math.min(this.ENR_HOLD_MAX_MS, Math.max(this.ENR_HOLD_MIN_MS, server));
        // A sibling request refused in the same breath (another worker was in flight)
        // extends the current hold; a refusal soon AFTER a hold ended doubles the next.
        const inHold = !!this._enrHoldEndsAt && now < this._enrHoldEndsAt;
        if (!inHold && this._enrHoldEndsAt && now - this._enrHoldEndsAt < this.ENR_HOLD_REPEAT_MS) hold = Math.min(this.ENR_HOLD_MAX_MS, Math.max(hold, (this._enrHoldMs || hold) * 2));
        if (!inHold) { this._enrHoldMs = hold; this._enrSlowDown(1.5); }
        this._enrHoldEndsAt = Math.max(this._enrHoldEndsAt || 0, now + hold);
        this._enrPausedUntil = Math.max(this._enrPausedUntil || 0, now + hold + 2000);
        this._enrSingleFile = true;
        if (this._enrStats) this._enrStats.rateLimits++;
        const holdTxt = this._enrFmtWait(Math.max(1, Math.round(hold / 1000)));
        console.warn(`[enrolments] API rate limit (429)${server ? ', Retry-After ' + Math.round(server / 1000) + ' s' : ''} — all requests paused for ${holdTxt}, then one at a time at ${this._enrRateNow()} req/min`);
        const base = this._enrLastStatus ? this._enrLastStatus.text : 'Enrolments & progress';
        this._updateApiSyncOverlay(`${base} · ⚠ API rate limit — all requests paused for ${holdTxt}, then one at a time at ${this._enrRateNow()} req/min · Cancel to pause`, null);
        return hold;
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
            this._enrInFlight = (this._enrInFlight || 0) + 1;
            let r, err = null;
            try { r = await LW.apiGet(path, params, { rateLimit: 'throw' }); } catch (e) { err = e; }
            this._enrInFlight = Math.max(0, (this._enrInFlight || 1) - 1);
            if (!err) {
                if (attempt && this._enrLastStatus) this._updateApiSyncOverlay(this._enrLastStatus.text, this._enrLastStatus.pct);
                return r;
            }
            const e = err;
            if (this._enrErrorKind(e) !== 'transient') throw e;
            const n = attempt + 1;
            if (n >= this.ENR_RETRY_MAX_ATTEMPTS) throw new Error(`Gave up after ${n} attempts over ~${Math.round(this._enrRetryTotalS() / 3600)} h — last error: ${e.message || e}`);
            if (this._enrIs429(e)) { this._enrRateLimited(e); continue; }   // the hold lives in the pacer; the retry waits there
            if (this._enrStats) this._enrStats.retries++;
            const waitS = attempt < this.ENR_RETRY_WAITS_S.length ? this.ENR_RETRY_WAITS_S[attempt] : this.ENR_RETRY_MAX_WAIT_S;
            console.warn(`[enrolments] ${this._enrShortErr(e)} — retrying in ${this._enrFmtWait(waitS)} (attempt ${n}/${this.ENR_RETRY_MAX_ATTEMPTS})`);
            const base = this._enrLastStatus ? this._enrLastStatus.text : 'Enrolments & progress';
            this._updateApiSyncOverlay(`${base} · ⚠ ${this._enrShortErr(e)} — retrying in ${this._enrFmtWait(waitS)} (attempt ${n}) · Cancel to pause`, null);
            await LW.sleep(waitS * 1000);   // abortable: Cancel rejects within half a second
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
        // Remaining pages with a few workers; each request still takes its turn at the pacer.
        let next = 2, done = 1, failure = null;
        const worker = async (w) => {
            while (!failure) {
                if (w && this._enrSingleFile) return;   // after a 429 only the first worker goes on
                const p = next++; if (p > totalPages) return;
                try { take(await this._enrGet(LW, '/users', { page: p, items_per_page: 200 })); }
                catch (e) { failure = failure || e; return; }
                done++; if (onProgress) onProgress(done, totalPages, out.size);
            }
        };
        await Promise.all(Array.from({ length: Math.max(1, Math.min(this.ENR_LIST_WORKERS, Math.max(1, totalPages - 1))) }, (_, w) => worker(w)));
        if (failure) throw failure;
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
        const fetchedAt = {};                          // account id → epoch seconds of its (latest) fetch in this receipt
        const head = /^\{"t":(\d+),"path":"([^"]*)"/;   // cheap peek — no JSON.parse for bodies nobody needs
        const perUserRe = /^\/users\/([^/]+)\/(courses|progress)$/;
        this._enrReadLines(path.join(pullDir, 'pull.jsonl'), (line) => {
            const h = head.exec(line);
            let o = null, p, t;
            if (h) { p = h[2]; t = Number(h[1]) || 0; }
            else { try { o = JSON.parse(line); } catch (e) { return; } p = String(o.path || ''); t = Number(o.t) || 0; }
            const m = perUserRe.exec(p);
            if (m) { if (lastCertT) accountsAfterCert++; const ts = Math.floor((t || 0) / 1000); if (ts && (!fetchedAt[m[1]] || ts > fetchedAt[m[1]])) fetchedAt[m[1]] = ts; if (skipIds && skipIds[m[1]]) return; }
            else if (p !== '/users' && p !== '/certificates') return;
            let b; try { o = o || JSON.parse(line); b = JSON.parse(o.body); } catch (e) { return; }
            if (p === '/users') { (b.data || []).forEach(u => { if (u && u.id && u.email) users.set(String(u.id), { id: String(u.id), email: String(u.email).toLowerCase().trim(), first: u.first_name || '', last: u.last_name || '', lastLogin: Number(u.last_login) || 0, created: Number(u.created) || 0 }); }); return; }
            if (p === '/certificates') { (b.data || []).forEach(c => certs.push(c)); lastCertT = t || lastCertT; accountsAfterCert = 0; return; }
            const rec = perUser.get(m[1]) || { courses: [], progress: [] }; rec[m[2]].push(b); perUser.set(m[1], rec);
        });
        return { users, perUser, certs, pullDir, lastCertT, accountsAfterCert, fetchedAt };
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
            // A capture is complete when the progress pages are there too (they are fetched
            // whenever the account has enrolments). A cancel between the two calls leaves a
            // half-capture: skip it, so the resume fetches the account properly.
            const hasEnrolments = bodies.courses.some(b => (b && b.data || []).length);
            if (hasEnrolments && !bodies.progress.length) continue;
            rows.push(...this._enrBuildRows(u, this._enrFromBodies(bodies), certMap, titleMap, priorByKey));
            uids.push(this._djb2Hash(u.email)); ids.push(id);
            if (onProgress && i % 500 === 0) onProgress(i, parsed.perUser.size);
        }
        if (ids.length) await this._enrPersist(rows, uids, 'merge');
        return { ids, rows: rows.length };
    },

    // When the earliest enrolments pull on this device began — the start of the
    // full pass on devices that completed it before meta.lastFullStartedAt existed.
    // From the raw manifest (all pulls, also pruned ones); else the oldest receipt dir.
    _enrEarliestReceiptStart() {
        try {
            const fs = electronAPI.fs, path = electronAPI.path, dir = path.join(Storage.DATA_DIR, 'surghub', 'raw');
            let best = '';
            try {
                const mf = path.join(dir, 'manifest.jsonl');
                if (fs.existsSync(mf)) for (const line of String(fs.readFileSync(mf, 'utf8')).split('\n')) {
                    if (!/"pullId":"enrolments__/.test(line)) continue;
                    const m = line.match(/"startedAt":"([^"]+)"/); if (m && (!best || m[1] < best)) best = m[1];
                }
            } catch (e) { __swallowed(e, 'enrolments.manifest'); }
            if (!best) { const d = this._enrReceiptDirs()[0]; const st = d && String(d).match(/__(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/); if (st) best = new Date(+st[1], +st[2] - 1, +st[3], +st[4], +st[5], +st[6]).toISOString(); }
            return best && !isNaN(Date.parse(best)) ? best : '';
        } catch (e) { return ''; }
    },
    // A completed full pass fetched every account that existed when it began (or found
    // nothing to fetch). Accounts it covered whose receipt has since been pruned have no
    // fetch time on record and would be re-fetched wholesale — 7,300 unchanged accounts
    // on 10 Sep, after the old build replaced the run record. Seed them with the pass's
    // start: only a login since then re-fetches them. Returns how many were seeded.
    _enrSeedFetchedAtFromFullPass(meta, users) {
        if (!meta || !meta.fetchedAt || !meta.lastRunEpoch || !users) return 0;
        if (!meta.lastFullStartedAt) {
            if (meta.lastMode !== 'full') return 0;   // no completed full pass on record
            const t = this._enrEarliestReceiptStart(); if (!t) return 0;
            meta.lastFullStartedAt = t;
        }
        const seed = Math.floor(Date.parse(meta.lastFullStartedAt) / 1000); if (!seed) return 0;
        const processed = (meta.run && meta.run.processed) || {};
        let n = 0;
        for (const u of users.values()) { if (u.created && u.created < seed && !meta.fetchedAt[u.id] && !processed[u.id]) { meta.fetchedAt[u.id] = seed; n++; } }
        return n;
    },

    _enrSelectUsers(users, mode, meta) {
        const list = [...users.values()];
        const processed = (meta.run && meta.run.processed) || {};
        const uc = this._enrUserCourses || null;
        const tl = Math.floor(new Date(this.ENR_TIMELINES_DATE).getTime() / 1000);
        let out = list.filter(u => !processed[u.id]);
        if (mode === 'incremental') {
            const fa = (meta.fetchedAt && Object.keys(meta.fetchedAt).length) ? meta.fetchedAt : null;
            if (fa) {
                // Exact per account: never fetched, logged in after the fetch (plus the
                // session slack), or created after it.
                const slack = this.ENR_SESSION_SLACK_S;
                out = out.filter(u => { const f = fa[u.id]; return !f || (u.lastLogin + slack) > f || u.created > f; });
            } else if (meta.lastRunEpoch) {
                // Fallback for a device without fetch times yet: a two-day window.
                const since = meta.lastRunEpoch - this.ENR_INCREMENTAL_SLACK_DAYS * 86400;
                const known = new Set((this._rawCompletion || []).map(r => r.uid));
                out = out.filter(u => u.lastLogin >= since || u.created >= since || !known.has(this._djb2Hash(u.email)));
            }
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
        this._enrGapMs = null; this._enrPausedUntil = 0; this._enrSingleFile = false; this._enrHoldMs = 0; this._enrHoldEndsAt = 0; this._enrInFlight = 0;
        this._enrStats = { retries: 0, slowdowns: 0, requests: 0, rateLimits: 0 }; const sessionT0 = Date.now(); this._enrLastStatus = null;
        try { await this._backupSurghubBeforeSync(); } catch (e) { __swallowed(e, 'enrolments.backup'); }
        if (!opts.silent) this._showApiSyncOverlay('Enrolments & progress (API)');
        this._enrStatus('Preparing…', 0);
        const summary = { mode, resumed: !!openRun, ingestedOffline: 0, users: 0, selected: 0, done: 0, failed: 0, noEnrolments: 0, rows: 0 };
        let ok = false, cancelled = false;
        const titleMap = this._enrCourseTitleMap();
        // Buffered rows since the last checkpoint — flushed on checkpoint, cancel, error, or completion.
        let pending = [], pendingUids = [], pendingIds = [], pendingAt = [];
        // Per-account fetch times, kept across runs. First time on a device with a
        // completed pass: seed every processed account with that run's start (the
        // earliest it can have been fetched) — receipts sharpen this in the harvest.
        if (!meta.fetchedAt || typeof meta.fetchedAt !== 'object') meta.fetchedAt = {};
        if (!Object.keys(meta.fetchedAt).length && meta.run && meta.run.processed && (meta.run.done || meta.lastRunEpoch)) {
            const seed = Math.floor(Date.parse(meta.run.startedAt || meta.lastRun || 0) / 1000) || meta.lastRunEpoch || 0;
            if (seed) for (const id of Object.keys(meta.run.processed)) meta.fetchedAt[id] = seed;
        }
        if (!meta.certsFullAt && meta.certsAt) meta.certsFullAt = meta.certsAt;   // earlier passes walked every course
        const run = openRun || { startedAt: new Date().toISOString(), mode, total: 0, processed: {}, done: false };
        meta.run = run;
        run.sessions = (run.sessions || 0) + 1; run.sessionAt = new Date().toISOString(); run.rateLimitsBefore = run.rateLimits || 0;
        delete run.pausedAt; delete run.pausedBy; delete run.lastError;
        // Checkpoints are serialized (two workers may ask at once) and swap the buffers
        // out first, so rows pushed while a persist is in flight wait for the next one
        // and no account is ever marked saved without its rows.
        let ckChain = Promise.resolve();
        const checkpoint = (label) => { const p = ckChain.then(() => checkpointNow(label)); ckChain = p.catch(() => {}); return p; };
        const checkpointNow = async (label) => {
            if (pendingIds.length) {
                const rowsB = pending, uidsB = pendingUids, idsB = pendingIds, atB = pendingAt;
                pending = []; pendingUids = []; pendingIds = []; pendingAt = [];
                await this._enrPersist(rowsB, uidsB, 'merge');
                idsB.forEach((id, k) => { run.processed[id] = 1; meta.fetchedAt[id] = atB[k] || Math.floor(Date.now() / 1000); });
            }
            run.checkpointAt = new Date().toISOString();
            const mins = (Date.now() - sessionT0) / 60000;
            if (mins >= 3 && this._enrStats) run.reqPerMin = Math.round(this._enrStats.requests / mins * 10) / 10;   // observed, for the card's ETA
            if (this._enrStats && this._enrStats.rateLimits) { run.rateLimits = (run.rateLimitsBefore || 0) + this._enrStats.rateLimits; run.rateLimitAt = new Date().toISOString(); }
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
                    if (parsed.lastCertT && parsed.accountsAfterCert >= 10) { const iso = new Date(parsed.lastCertT).toISOString(); if (!meta.certsAt || iso > meta.certsAt) meta.certsAt = iso; if (!meta.certsFullAt || iso > meta.certsFullAt) meta.certsFullAt = iso; }
                    // A full account listing in a receipt refreshes the account index when it is newer than the one held.
                    if (parsed.users.size >= 1000 && this._accountsFromUsers) {
                        try {
                            const st = String(dirs[d]).match(/__(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
                            const listedAt = st ? new Date(+st[1], +st[2] - 1, +st[3], +st[4], +st[5], +st[6]).toISOString() : '';
                            const cur = await this._accountsLoad();
                            if (listedAt && (!cur || String(cur.listedAt || '') < listedAt)) await this._accountsPersist(this._accountsFromUsers(parsed.users, listedAt));
                        } catch (e) { __swallowed(e, 'enrolments.accounts'); }
                    }
                    const certMapNow = this._enrCertMapFromIndex(certIndex, titleMap);
                    const ing = await this._enrIngestReceipt(parsed, titleMap, run.processed, (i, n) => this._enrStatus(`Ingesting receipt ${d + 1}/${dirs.length}… ${i.toLocaleString()}/${n.toLocaleString()}`, 1 + Math.round(i / n * 4)), certMapNow);
                    const stampS = (() => { const st = String(dirs[d]).match(/__(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/); return st ? Math.floor(new Date(+st[1], +st[2] - 1, +st[3], +st[4], +st[5], +st[6]).getTime() / 1000) : 0; })();
                    ing.ids.forEach(id => { run.processed[id] = 1; meta.fetchedAt[id] = (parsed.fetchedAt && parsed.fetchedAt[id]) || stampS || meta.fetchedAt[id] || 0; });
                    // Exact fetch times for every account this receipt holds (also the ones already saved).
                    if (parsed.fetchedAt) for (const id of Object.keys(parsed.fetchedAt)) if (!meta.fetchedAt[id] || parsed.fetchedAt[id] > meta.fetchedAt[id]) meta.fetchedAt[id] = parsed.fetchedAt[id];
                    summary.ingestedOffline += ing.ids.length;
                }
                if (harvested) await this._enrSaveCertIndex(certIndex);
                await this._enrSaveMeta(meta);
                if (!opts.silent && this.view === 'upload') this.renderView();   // card 2 → "in progress"
            }
            try { LW.startRawPull('enrolments'); } catch (e) { __swallowed(e, 'enrolments.raw'); }

            // 2. Accounts — reuse a listing the Learners sync (card 3) made minutes ago,
            //    else list now (~6 min with ENR_LIST_WORKERS under the cap).
            let users;
            const cache = this._enrUsersCache;
            if (!opts.forceListing && cache && cache.users && cache.users.size > 1000 && (Date.now() - cache.at) < this.ENR_LISTING_REUSE_MIN * 60000) {
                users = cache.users;
                summary.listingReused = true;
                this._enrStatus(`Accounts: reusing the listing from ${new Date(cache.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} (${users.size.toLocaleString()} accounts)`, 8);
                // Keep this run's receipt self-contained: the listing it relied on, as one page.
                try { if (LW.captureRaw) LW.captureRaw('/users', { page: 1, items_per_page: users.size, reused: cache.source || 'listing' }, JSON.stringify({ data: [...users.values()].map(u => ({ id: u.id, email: u.email, first_name: u.first, last_name: u.last, last_login: u.lastLogin, created: u.created })), meta: { page: 1, totalPages: 1, totalItems: users.size } })); } catch (e) { __swallowed(e, 'enrolments.raw'); }
            } else {
                users = await this._enrFetchUsers(LW, (p, t, n) => this._enrStatus(`Listing accounts… ${p}/${t} pages (${n.toLocaleString()})${!this._enrSingleFile && this.ENR_LIST_WORKERS > 1 ? ' · ' + this.ENR_LIST_WORKERS + ' in parallel' : ''}`, 5 + Math.round(p / t * 5)));
                this._enrUsersCache = { at: Date.now(), users, source: 'enrolments' };
            }
            summary.users = users.size; run.total = users.size;
            // 2b. Fetch times for accounts the completed full pass covered but whose receipt is gone.
            try { summary.seeded = this._enrSeedFetchedAtFromFullPass(meta, users); if (summary.seeded) await this._enrSaveMeta(meta); } catch (e) { __swallowed(e, 'enrolments.seed'); }
            // Account index for the Learner journeys tab: sign-up day, last login and email domain per hashed id.
            try { if (this._accountsFromUsers) await this._accountsPersist(this._accountsFromUsers(users, new Date().toISOString())); } catch (e) { __swallowed(e, 'enrolments.accounts'); }

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

            // 5. Per-account fetch — ENR_WORKERS in parallel under the shared pacer (each
            //    request still waits its turn; parallelism only hides latency), checkpointed
            //    every ENR_CHECKPOINT accounts. A cancel or an auth failure stops every worker.
            const t0 = Date.now(); let sinceCheckpoint = 0, nextIdx = 0, stop = false, fatal = null;
            const freshCourses = new Set(), certsAtS = meta.certsAt ? Math.floor(Date.parse(meta.certsAt) / 1000) : 0;
            const nWorkers = Math.max(1, Math.min(this.ENR_WORKERS, selected.length || 1));
            const status = () => {
                const elapsed = (Date.now() - t0) / 1000, eta = summary.done ? (selected.length - summary.done) * elapsed / summary.done : 0;
                const par = (nWorkers > 1 && !this._enrSingleFile) ? ` · ${nWorkers} in parallel` : '';
                this._enrStatus(`Enrolments… ${summary.done.toLocaleString()}/${selected.length.toLocaleString()} accounts this session · ${(Object.keys(run.processed).length + pendingIds.length).toLocaleString()}/${run.total.toLocaleString()} overall · ~${this._enrFmtEta(eta)} left · ${this._enrRateNow()} req/min${par} · saved every ${this.ENR_CHECKPOINT}`, 15 + Math.round(summary.done / Math.max(1, selected.length) * 82));
            };
            const worker = async (w) => {
                while (!stop) {
                    if (w && this._enrSingleFile) return;   // after a 429 only the first worker goes on
                    const i = nextIdx++; if (i >= selected.length) return;
                    const u = selected[i];
                    let f;
                    // _enrGet retries transient failures in place; what surfaces here is a
                    // cancel, an auth/config failure (stop — every account would fail the
                    // same way) or a bad request on this one account (skip it, keep going).
                    try { f = await this._enrFetchUser(LW, u.id); }
                    catch (e) {
                        const kind = this._enrErrorKind(e);
                        if (kind === 'cancel') { cancelled = true; stop = true; fatal = fatal || e; return; }
                        if (kind === 'fatal' && /^Auth failed|credentials/i.test(e.message || '')) { stop = true; fatal = fatal || e; return; }
                        summary.failed++; console.warn('[enrolments] account skipped:', u.id, e.message || e); continue;
                    }
                    pending.push(...this._enrBuildRows(u, f, certMap, titleMap, priorByKey));
                    pendingUids.push(this._djb2Hash(u.email)); pendingIds.push(u.id); pendingAt.push(Math.floor(Date.now() / 1000));
                    summary.done++; if (!f.enrolments.length && !Object.keys(f.progress).length) summary.noEnrolments++;
                    // Courses where this account completed something since the last certificate walk → walk them below.
                    for (const cid of Object.keys(f.progress)) {
                        const pr = f.progress[cid]; if (!pr || certIndex[u.id + '|' + cid]) continue;
                        const done = String(pr.status || '').toLowerCase() === 'completed' || (Number(pr.progress_rate) || 0) >= 100 || !!pr.completed_at;
                        if (!done) continue;
                        const ca = Number(pr.completed_at) || 0;
                        if (!ca || !certsAtS || ca >= certsAtS - 3600) freshCourses.add(cid);
                    }
                    if (++sinceCheckpoint >= this.ENR_CHECKPOINT) { sinceCheckpoint = 0; await checkpoint(); }
                    status();
                }
            };
            await Promise.all(Array.from({ length: nWorkers }, (_, w) => worker(w)));
            if (fatal) throw fatal;
            if (summary.failed > Math.max(20, summary.selected * this.ENR_MAX_FAILURE_SHARE)) throw new Error(`${summary.failed} of ${summary.selected} accounts failed after retries — stopping; progress so far is saved, run again later.`);

            // 6. Certificates — after the accounts: every session walks the courses where a
            //    fetched account completed something since the last walk (newest first,
            //    stopping where the index is complete); every course is walked at most every
            //    ENR_CERT_FULL_DAYS. Then the index is applied to EVERY record, so rows built
            //    above and rows from the xlsx importer pick up certificates issued since.
            const fullDue = !meta.certsFullAt || (Date.now() - Date.parse(meta.certsFullAt)) / 86400000 >= this.ENR_CERT_FULL_DAYS || !Object.keys(certIndex).length;
            const walkIds = fullDue ? Object.keys(titleMap) : [...freshCourses].filter(id => titleMap[id]);
            summary.certWalk = fullDue ? 'full' : (walkIds.length ? 'targeted' : 'none'); summary.certCourses = walkIds.length;
            if (walkIds.length) {
                await checkpoint();
                const tc0 = Date.now();
                this._enrStatus(`Certificates: ${fullDue ? 'checking every course' : 'checking ' + walkIds.length + ' course' + (walkIds.length === 1 ? '' : 's') + ' with new completions'} for certificates issued since ${meta.certsAt ? String(meta.certsAt).slice(0, 10) : 'the beginning'} — ~${Math.round(this.ENR_CERT_GAP_MS / 1000)} s per page, this endpoint's limit…`, 97);
                const items = await this._enrFetchCertificates(LW, walkIds, (i, n, k, page, totalPages, cid, pages) => this._enrStatus(`Certificates… course ${i}/${n} (${titleMap[cid] || cid}) · page ${page}/${totalPages} · ${pages} page${pages === 1 ? '' : 's'} so far · ~${this._enrFmtEta(Math.max(10, (n - i) * (Date.now() - tc0) / 1000 / Math.max(1, i)))} left`, 97 + Math.round(i / n * 2)), certIndex, meta.certsAt);
                summary.certsNew = this._enrCertIndexAdd(certIndex, items);
                await this._enrSaveCertIndex(certIndex);
                const nowIso = new Date().toISOString();
                meta.certsAt = nowIso; if (fullDue) meta.certsFullAt = nowIso;
                await this._enrSaveMeta(meta);
                this._enrStatus('Applying certificates to learner records…', 99);
                summary.certsApplied = await this._enrApplyCertIndexToRows(certIndex, users, titleMap);
            } else {
                this._enrStatus(`Certificates: no new completions since the last walk (${meta.certsAt ? String(meta.certsAt).slice(0, 10) : 'never'}) — index unchanged`, 98);
            }

            // 7. Finish
            await checkpoint('Saving…');
            run.done = true; run.finishedAt = new Date().toISOString();
            meta.lastRun = run.finishedAt; meta.lastRunEpoch = Math.floor(Date.now() / 1000); meta.lastMode = mode;
            if (mode === 'full') meta.lastFullStartedAt = run.startedAt;   // every account that existed then was covered — see _enrSeedFetchedAtFromFullPass
            await this._enrSaveMeta(meta);
            await this._stampSync('progress'); await this._stampSync('enrolments');
            await this.handleDbSave();
            summary.rows = (this._rawCompletion || []).length;
            summary.retries = this._enrStats.retries; summary.slowdowns = this._enrStats.slowdowns; summary.rateLimits = this._enrStats.rateLimits;
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
            this.showMsg(`✓ Enrolments synced (${mode}${summary.resumed ? ', resumed' : ''}): ${summary.done.toLocaleString()} accounts fetched` + (summary.ingestedOffline ? `, ${summary.ingestedOffline.toLocaleString()} ingested from the receipt` : '') + ` (${summary.noEnrolments.toLocaleString()} with no enrolments) → ${summary.rows.toLocaleString()} learner-course records` + (summary.failed ? ` · ${summary.failed} accounts skipped after retries` : '') + (summary.certsNew ? ` · ${summary.certsNew.toLocaleString()} new certificate${summary.certsNew === 1 ? '' : 's'}` : '') + (summary.certsApplied ? ` (${summary.certsApplied.toLocaleString()} records updated)` : '') + (summary.retries ? ` · ${summary.retries} transient error${summary.retries === 1 ? '' : 's'} retried` : '') + (summary.rateLimits ? ` · rate-limited ${summary.rateLimits}× (held back, then single-file)` : '') + (summary.seeded ? ` · ${summary.seeded.toLocaleString()} accounts credited to the full pass` : '') + (summary.listingReused ? ' · listing reused from the Learners sync' : ''));
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
            const saved = `${done.toLocaleString()} accounts fetched` + (left ? ` · ${left.toLocaleString()} to go` : '') + (r.skipped ? ` · ${r.skipped.toLocaleString()} skipped (nothing to fetch)` : '') + (r.rateLimits ? ` · the API refused ${r.rateLimits}× (rate limit, backed off)` : '');
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
