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

    _enrDay(ts) { const n = Number(ts); return n ? new Date(n * 1000).toISOString().slice(0, 10) : ''; },
    _enrIs404(e) { return /\b404\b|not found/i.test((e && e.message) || ''); },
    _enrFmtEta(sec) { return sec >= 5400 ? Math.round(sec / 3600) + ' h' : Math.max(1, Math.round(sec / 60)) + ' min'; },

    async _enrLoadMeta() { try { const m = await Storage.getItem(this.ENR_META_KEY); return (m && typeof m === 'object') ? m : {}; } catch (e) { return {}; } },
    async _enrSaveMeta(meta) { this._enrMeta = meta; try { await Storage.setItem(this.ENR_META_KEY, meta); } catch (e) { __swallowed(e, 'enrolments.meta'); } },

    // ── Pacing: never start a request less than 60/TARGET seconds after the last ──
    async _enrPace() {
        const gap = 60000 / this.ENR_TARGET_PER_MIN;
        const now = Date.now(), wait = (this._enrLastReq || 0) + gap - now;
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        this._enrLastReq = Date.now();
    },
    async _enrGet(LW, path, params) { await this._enrPace(); return LW.apiGet(path, params); },

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
    _enrLatestReceiptDir() {
        try {
            const fs = electronAPI.fs, path = electronAPI.path, dir = path.join(Storage.DATA_DIR, 'surghub', 'raw');
            const dirs = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory && /^enrolments__/.test(e.name) && fs.existsSync(path.join(dir, e.name, 'pull.jsonl'))).map(e => e.name).sort();
            return dirs.length ? path.join(dir, dirs[dirs.length - 1]) : null;
        } catch (e) { return null; }
    },
    _enrParseReceipt(pullDir) {
        const fs = electronAPI.fs, path = electronAPI.path;
        const users = new Map(), perUser = new Map(), certs = [];
        const text = fs.readFileSync(path.join(pullDir, 'pull.jsonl'), 'utf8');
        for (const line of text.split('\n')) {
            if (!line) continue;
            let o, b; try { o = JSON.parse(line); b = JSON.parse(o.body); } catch (e) { continue; }
            const p = String(o.path || '');
            if (p === '/users') { (b.data || []).forEach(u => { if (u && u.id && u.email) users.set(String(u.id), { id: String(u.id), email: String(u.email).toLowerCase().trim(), first: u.first_name || '', last: u.last_name || '', lastLogin: Number(u.last_login) || 0, created: Number(u.created) || 0 }); }); continue; }
            if (p === '/certificates') { (b.data || []).forEach(c => certs.push(c)); continue; }
            const m = p.match(/^\/users\/([^/]+)\/(courses|progress)$/);
            if (m) { const rec = perUser.get(m[1]) || { courses: [], progress: [] }; rec[m[2]].push(b); perUser.set(m[1], rec); }
        }
        return { users, perUser, certs, pullDir };
    },
    // Build + persist rows for every account the receipt holds a /courses body for.
    // Accounts already in `alreadyProcessed` are skipped. Returns the ids ingested.
    async _enrIngestReceipt(parsed, titleMap, alreadyProcessed, onProgress) {
        const certMap = this._enrCertMap(parsed.certs, titleMap);
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
                    ? `FULL enrolment & progress sync from the LearnWorlds API?\n\nTwo calls per account at ~${perMin} requests/minute — the API's sustained limit — so the whole platform takes roughly a day and a half of API time. It saves progress every ${this.ENR_CHECKPOINT} accounts and resumes where it left off, so run it in sessions (overnight, keep the Mac awake: \`caffeinate -i\`). Cancel any time — nothing is lost.\n\nContinue?`
                    : `Incremental enrolment & progress sync?\n\nRe-fetches accounts active since the last completed run (${String(meta.lastRun || '').slice(0, 10)}) plus new ones — usually minutes.\n\nContinue?`;
            if (!confirm(msg)) return;
        }

        this._apiSyncInFlight = true;
        try { await this._backupSurghubBeforeSync(); } catch (e) { __swallowed(e, 'enrolments.backup'); }
        if (!opts.silent) this._showApiSyncOverlay('Enrolments & progress (API)');
        this._updateApiSyncOverlay('Preparing…', 0);
        const summary = { mode, resumed: !!openRun, ingestedOffline: 0, users: 0, selected: 0, done: 0, failed: 0, noEnrolments: 0, rows: 0 };
        let ok = false, cancelled = false;
        const titleMap = this._enrCourseTitleMap();
        // Buffered rows since the last checkpoint — flushed on checkpoint, cancel, error, or completion.
        let pending = [], pendingUids = [], pendingIds = [];
        const run = openRun || { startedAt: new Date().toISOString(), mode, total: 0, processed: {}, done: false };
        meta.run = run;
        const checkpoint = async (label) => {
            if (pendingIds.length) {
                await this._enrPersist(pending, pendingUids, 'merge');
                pendingIds.forEach(id => { run.processed[id] = 1; });
                pending = []; pendingUids = []; pendingIds = [];
            }
            run.checkpointAt = new Date().toISOString();
            await this._enrSaveMeta(meta);
            if (label) this._updateApiSyncOverlay(label, null);
        };
        try {
            // 1. Ingest what the current receipt already holds (offline, resume only).
            if (openRun) {
                const dir = this._enrLatestReceiptDir();
                if (dir) {
                    this._updateApiSyncOverlay('Reading the receipt from the previous session…', 1);
                    const parsed = this._enrParseReceipt(dir);
                    const ing = await this._enrIngestReceipt(parsed, titleMap, run.processed, (i, n) => this._updateApiSyncOverlay(`Ingesting receipt… ${i.toLocaleString()}/${n.toLocaleString()}`, 1 + Math.round(i / n * 4)));
                    ing.ids.forEach(id => { run.processed[id] = 1; });
                    summary.ingestedOffline = ing.ids.length;
                    await this._enrSaveMeta(meta);
                }
            }
            try { LW.startRawPull('enrolments'); } catch (e) { __swallowed(e, 'enrolments.raw'); }

            // 2. Accounts (paced; ~5 min for the whole list)
            const users = await this._enrFetchUsers(LW, (p, t, n) => this._updateApiSyncOverlay(`Listing accounts… page ${p}/${t} (${n.toLocaleString()})`, 5 + Math.round(p / t * 5)));
            summary.users = users.size; run.total = users.size;

            // 3. Certificates (issued dates) — existing fetcher, its own pacing
            this._updateApiSyncOverlay('Fetching certificates…', 10);
            const certRes = await LW.fetchAllCertificates(p => { if (p && p.total) this._updateApiSyncOverlay(`Fetching certificates… ${p.current || 0}/${p.total} courses`, 10 + Math.round((p.current || 0) / p.total * 5)); });
            const certMap = this._enrCertMap(Array.isArray(certRes) ? certRes : ((certRes && certRes.records) || []), titleMap);

            // 4. Selection
            if (this._enrUserCourses === undefined) { this._enrUserCourses = null; try { const uc = await Storage.getItem('surghub_user_courses'); if (uc && typeof uc === 'object') this._enrUserCourses = uc; } catch (e) { __swallowed(e, 'enrolments.uc'); } }
            if (this._rawCompletion == null && this.ensureCompletionLoaded) { try { await this.ensureCompletionLoaded(); } catch (e) { __swallowed(e, 'enrolments.load'); } }
            const selected = this._enrSelectUsers(users, mode, meta);
            summary.selected = selected.length;
            const priorByKey = this._enrPriorMap(this._rawCompletion);
            await this._enrSaveMeta(meta);

            // 5. Per-account fetch, paced, checkpointed
            const t0 = Date.now(); let sinceCheckpoint = 0;
            for (let i = 0; i < selected.length; i++) {
                const u = selected[i];
                let fetched;
                try { fetched = await LW.settleWithRetry([() => this._enrFetchUser(LW, u.id)], 'enrolments'); }
                catch (e) { if (/cancelled/i.test(e.message || '')) { cancelled = true; throw e; } summary.failed++; continue; }
                const f = fetched[0];
                pending.push(...this._enrBuildRows(u, f, certMap, titleMap, priorByKey));
                pendingUids.push(this._djb2Hash(u.email)); pendingIds.push(u.id);
                summary.done++; if (!f.enrolments.length && !Object.keys(f.progress).length) summary.noEnrolments++;
                if (++sinceCheckpoint >= this.ENR_CHECKPOINT) { sinceCheckpoint = 0; await checkpoint(); }
                const elapsed = (Date.now() - t0) / 1000, eta = summary.done ? (selected.length - i - 1) * elapsed / summary.done : 0;
                this._updateApiSyncOverlay(`Enrolments… ${(i + 1).toLocaleString()}/${selected.length.toLocaleString()} accounts this session · ${(Object.keys(run.processed).length + pendingIds.length).toLocaleString()}/${run.total.toLocaleString()} overall · ~${this._enrFmtEta(eta)} left · saved every ${this.ENR_CHECKPOINT}`, 15 + Math.round((i + 1) / selected.length * 82));
            }
            if (summary.failed > Math.max(20, summary.selected * this.ENR_MAX_FAILURE_SHARE)) throw new Error(`${summary.failed} of ${summary.selected} accounts failed after retries — stopping; progress so far is saved, run again later.`);

            // 6. Finish
            await checkpoint('Saving…');
            run.done = true; run.finishedAt = new Date().toISOString();
            meta.lastRun = run.finishedAt; meta.lastRunEpoch = Math.floor(Date.now() / 1000); meta.lastMode = mode;
            await this._enrSaveMeta(meta);
            await this._stampSync('progress'); await this._stampSync('enrolments');
            await this.handleDbSave();
            summary.rows = (this._rawCompletion || []).length;
            ok = true;
        } catch (e) {
            // Keep everything fetched so far — that is the whole point.
            try { await checkpoint(); if (pendingIds.length === 0 && summary.done) { await this._stampSync('progress'); await this.handleDbSave(); } } catch (e2) { __swallowed(e2, 'enrolments.checkpoint'); }
            console.error('[enrolments] sync ' + (cancelled ? 'cancelled' : 'stopped') + ':', e);
            if (!opts.silent) this.showMsg((cancelled ? '⏸ Enrolment sync paused' : '⚠ Enrolment sync stopped') + ' — ' + Object.keys(run.processed).length.toLocaleString() + ' of ' + (run.total || '?').toLocaleString() + ' accounts saved. Click "Sync from API" to resume.' + (cancelled ? '' : ' (' + (e.message || e) + ')'), !cancelled);
            if (!cancelled) throw e;
            return summary;
        } finally {
            try { LW.finishRawPull(ok); } catch (e) { __swallowed(e, 'enrolments.raw'); }
            this._apiSyncInFlight = false;
            if (!opts.silent) this._hideApiSyncOverlay();
        }
        if (!opts.silent) {
            this.showMsg(`✓ Enrolments synced (${mode}${summary.resumed ? ', resumed' : ''}): ${summary.done.toLocaleString()} accounts fetched` + (summary.ingestedOffline ? `, ${summary.ingestedOffline.toLocaleString()} ingested from the receipt` : '') + ` (${summary.noEnrolments.toLocaleString()} with no enrolments) → ${summary.rows.toLocaleString()} learner-course records` + (summary.failed ? ` · ${summary.failed} accounts skipped after retries` : ''));
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
            const done = Object.keys(m.run.processed || {}).length, total = m.run.total || 0;
            const left = total ? Math.max(0, total - done) : 0;
            return `<span class="inline-flex items-center gap-1.5 text-xs text-amber-700 font-medium ml-2" title="Started ${esc(String(m.run.startedAt || '').slice(0, 16).replace('T', ' '))}. Click 'Sync from API' to resume — anything already fetched is kept."><i data-lucide="pause-circle" width="12"></i> API run paused: ${done.toLocaleString()} of ${total.toLocaleString()} accounts saved${left ? ' · ~' + this._enrFmtEta(left * 2 * 60 / this.ENR_TARGET_PER_MIN) + ' of API time left' : ''}</span>`;
        }
        if (m.lastRun) return `<span class="inline-flex items-center gap-1.5 text-xs text-slate-400 font-medium ml-2"><i data-lucide="cloud-download" width="12" class="text-emerald-500"></i> API sync ${esc(String(m.lastRun).slice(0, 10))} (${esc(m.lastMode || '')})</span>`;
        return '';
    },
});
