// ── Enrolments & progress from the LearnWorlds API ────────────────────────────
// Replaces the manual card-2 "User Progress" xlsx as the source of per-learner
// dates. Per user, two calls:
//   GET /users/{id}/courses   → one record per enrolment, with its own `created`
//   GET /users/{id}/progress  → per course: status, progress_rate, time_on_course
//                               (seconds), average_score_rate, completed_at
// plus one pass over /certificates (issued dates) via the existing fetcher.
// Verified 2 Sep 2026 against the xlsx: enrolment `created` matched the xlsx
// start date to the day in 25/28 sampled pairs (the other 3 the API is earlier —
// enrolled before first opening); time_on_course ÷ 60 equals the xlsx minutes.
// Throughput measured at 4 concurrent requests: ~8 req/s, no 429s; a 404
// "Courses not found" simply means the account has no enrolments.
//
// Output is written in the EXACT row shape the xlsx importer produces, into the
// same store (surghub_completion), so every consumer — charts, Institutions,
// Compare, exports — is untouched. Two extra fields are added (enrolled_date,
// source) which consumers ignore.
//
// Definitions preserved: start_date = the enrolment date, but ONLY for learners
// who have any progress on the course; an enrolment never opened stays undated,
// exactly as the xlsx left it — so "courses started" keeps its meaning.
Object.assign(window.App, {

    ENR_CONCURRENCY: 4,                 // users in flight (each does 2 sequential calls)
    ENR_META_KEY: 'surgdash_enrolment_sync',
    ENR_INCREMENTAL_SLACK_DAYS: 2,      // re-fetch anyone active since lastRun − this
    ENR_MAX_FAILURE_SHARE: 0.01,        // abort (don't persist) if more than 1% of users fail after retries

    _enrDay(ts) { const n = Number(ts); return n ? new Date(n * 1000).toISOString().slice(0, 10) : ''; },
    _enrIs404(e) { return /\b404\b|not found/i.test((e && e.message) || ''); },

    async _enrLoadMeta() { try { const m = await Storage.getItem(this.ENR_META_KEY); return (m && typeof m === 'object') ? m : null; } catch (e) { return null; } },
    async _enrSaveMeta(meta) { try { await Storage.setItem(this.ENR_META_KEY, meta); } catch (e) { __swallowed(e, 'enrolments.meta'); } },

    // Latest course title per LearnWorlds course id, from the synced course list.
    _enrCourseTitleMap() {
        const map = {};
        const latest = {};
        (this.data || []).forEach(d => { if (!d || !d.CourseId || !d.Course) return; const k = String(d.CourseId); if (!latest[k] || String(d.Timestamp || '') > String(latest[k].Timestamp || '')) latest[k] = d; });
        Object.keys(latest).forEach(k => { map[k] = latest[k].Course; });
        return map;
    },

    // Minimal user list straight from /users (id, email, names, last_login, created).
    async _enrFetchUsers(LW, onProgress) {
        const first = await LW.apiGet('/users', { page: 1, items_per_page: 200 });
        const totalPages = (first.meta && first.meta.totalPages) || 1;
        const out = [];
        const take = (body) => (body && body.data || []).forEach(u => { if (u && u.id && u.email) out.push({ id: String(u.id), email: String(u.email).toLowerCase().trim(), first: u.first_name || '', last: u.last_name || '', lastLogin: Number(u.last_login) || 0, created: Number(u.created) || 0 }); });
        take(first);
        for (let p = 2; p <= totalPages; p += this.ENR_CONCURRENCY) {
            const pages = []; for (let q = p; q < p + this.ENR_CONCURRENCY && q <= totalPages; q++) pages.push(q);
            const bodies = await LW.settleWithRetry(pages.map(q => () => LW.apiGet('/users', { page: q, items_per_page: 200 })), 'users');
            bodies.forEach(take);
            if (onProgress) onProgress(Math.min(p + pages.length - 1, totalPages), totalPages, out.length);
        }
        return out;
    },

    // One user's enrolments + progress. 404 on either endpoint = nothing there.
    async _enrFetchUser(LW, id) {
        let enrolments = [], progress = {};
        try {
            let page = 1, totalPages = 1;
            do {
                const r = await LW.apiGet('/users/' + encodeURIComponent(id) + '/courses', { page, items_per_page: 50 });
                (r.data || []).forEach(en => { if (en && en.course && en.course.id) enrolments.push({ courseId: String(en.course.id), title: en.course.title || '', created: Number(en.created) || 0 }); });
                totalPages = (r.meta && r.meta.totalPages) || 1; page++;
            } while (page <= totalPages && page <= 20);
        } catch (e) { if (!this._enrIs404(e)) throw e; }
        if (!enrolments.length) return { enrolments, progress };
        try {
            // Paginated like /courses — a learner with dozens of courses spans several pages.
            let page = 1, totalPages = 1;
            do {
                const r = await LW.apiGet('/users/' + encodeURIComponent(id) + '/progress', { page, items_per_page: 50 });
                (r.data || []).forEach(p => { if (p && p.course_id) progress[String(p.course_id)] = p; });
                totalPages = (r.meta && r.meta.totalPages) || 1; page++;
            } while (page <= totalPages && page <= 20);
        } catch (e) { if (!this._enrIs404(e)) throw e; }
        return { enrolments, progress };
    },

    _enrStarted(p) {
        if (!p) return false;
        if ((Number(p.progress_rate) || 0) > 0 || (Number(p.time_on_course) || 0) > 0 || (Number(p.completed_units) || 0) > 0) return true;
        const s = String(p.status || '').toLowerCase();
        return !!s && !/not.?started|enrol/.test(s) && /start|progress|complet/.test(s);
    },

    // Rows in the xlsx importer's exact shape.
    //
    // Built from the UNION of the enrolment list and the progress list: a course
    // the learner is no longer enrolled in (expired, unenrolled, re-issued) still
    // has a progress record, and that is real learning — verified: 32 of 33 such
    // records on heavy learners had rows in the xlsx.
    //
    // Dates only ever move EARLIER. A re-enrolment resets the enrolment record's
    // `created` (gaps of up to 1,377 days seen), so the start date is the earliest
    // of: the enrolment date, the completion date (a course cannot finish before
    // it started), and any prior record for the same learner + course — which is
    // how the xlsx history is kept where the API cannot know better. Time on
    // course is likewise the max of API and prior (it only grows).
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

    _enrSelectUsers(users, mode, meta, existingUids) {
        if (mode === 'full' || !meta || !meta.lastRunEpoch) return users;
        const since = meta.lastRunEpoch - this.ENR_INCREMENTAL_SLACK_DAYS * 86400;
        return users.filter(u => u.lastLogin >= since || u.created >= since || !existingUids.has(this._djb2Hash(u.email)));
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

        const meta = await this._enrLoadMeta();
        const mode = opts.mode === 'full' ? 'full' : (opts.mode === 'incremental' ? 'incremental' : (meta && meta.lastRunEpoch ? 'incremental' : 'full'));
        if (!opts.silent && !confirm(
            (mode === 'full' ? 'FULL enrolment & progress sync from the LearnWorlds API?\n\nFetches every account\'s enrolments and progress (2 calls per user, ~8 per second → roughly 4 hours for the whole platform). Run it overnight; you can keep working but don\'t close the app.\n\n'
                             : 'Incremental enrolment & progress sync from the LearnWorlds API?\n\nRe-fetches accounts active since the last run (' + (meta.lastRun || '?').slice(0, 10) + ') plus any new ones — typically a few minutes.\n\n')
            + 'Replaces the card-2 xlsx as the source of per-learner dates; the result is written in the same format, so nothing else changes.\n\nContinue?')) return;

        this._apiSyncInFlight = true;
        try { await this._backupSurghubBeforeSync(); } catch (e) { __swallowed(e, 'enrolments.backup'); }
        if (!opts.silent) this._showApiSyncOverlay('Enrolments & progress (API)');
        this._updateApiSyncOverlay('Listing accounts…', 0);
        let ok = false; const summary = { mode, users: 0, selected: 0, done: 0, failed: 0, noEnrolments: 0, rows: 0 };
        try {
            try { LW.startRawPull('enrolments'); } catch (e) { __swallowed(e, 'enrolments.raw'); }

            // 1. Accounts
            const users = await this._enrFetchUsers(LW, (p, t, n) => this._updateApiSyncOverlay(`Listing accounts… page ${p}/${t} (${n.toLocaleString()})`, Math.round(p / t * 8)));
            summary.users = users.length;

            // 2. Certificates (issued dates) — existing fetcher
            this._updateApiSyncOverlay('Fetching certificates…', 9);
            const certRes = await LW.fetchAllCertificates(p => { if (p && p.total) this._updateApiSyncOverlay(`Fetching certificates… ${p.current || 0}/${p.total} courses`, 9 + Math.round((p.current || 0) / p.total * 6)); });
            const certRecs = Array.isArray(certRes) ? certRes : ((certRes && certRes.records) || []);
            const certMap = {};
            certRecs.forEach(c => { if (!c || !c.user) return; const issued = String(c.issued || '').slice(0, 10); const v = { issued, score: c.score }; const t = String(c.courseName || '');
                const k1 = String(c.user) + '|' + t, k2 = String(c.user) + '|' + t.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (!certMap[k1] || issued < certMap[k1].issued) certMap[k1] = v; if (!certMap[k2] || issued < certMap[k2].issued) certMap[k2] = v; });

            // 3. Which users this run covers
            if (this._rawCompletion == null && this.ensureCompletionLoaded) { try { await this.ensureCompletionLoaded(); } catch (e) { __swallowed(e, 'enrolments.load'); } }
            const existing = Array.isArray(this._rawCompletion) ? this._rawCompletion : [];
            const existingUids = new Set(existing.map(r => r.uid));
            // Prior record per learner+course: lets dates only move earlier and keeps
            // xlsx history the API cannot recover (re-enrolments reset `created`).
            const priorByKey = {};
            existing.forEach(r => { if (r && r.uid && r.course) { const k = r.uid + '|' + r.course; const q = priorByKey[k]; if (!q || (r.start_date && (!q.start_date || r.start_date < q.start_date))) priorByKey[k] = r; } });
            const selected = this._enrSelectUsers(users, mode, meta, existingUids);
            summary.selected = selected.length;
            const titleMap = this._enrCourseTitleMap();

            // 4. Per-user fetch, ENR_CONCURRENCY in flight
            const newRows = []; const processed = new Set(); const t0 = Date.now();
            for (let i = 0; i < selected.length; i += this.ENR_CONCURRENCY) {
                const batch = selected.slice(i, i + this.ENR_CONCURRENCY);
                let results;
                try {
                    results = await LW.settleWithRetry(batch.map(u => () => this._enrFetchUser(LW, u.id)), 'enrolments');
                } catch (e) {
                    if (/cancelled/i.test(e.message || '')) throw e;
                    // A batch that still fails after retries: count its users as failed and carry on.
                    summary.failed += batch.length; results = null;
                }
                if (results) results.forEach((f, k) => { const u = batch[k]; processed.add(this._djb2Hash(u.email)); summary.done++; if (!f.enrolments.length) summary.noEnrolments++; newRows.push(...this._enrBuildRows(u, f, certMap, titleMap, priorByKey)); });
                const doneN = i + batch.length, elapsed = (Date.now() - t0) / 1000, eta = doneN ? Math.round((selected.length - doneN) * elapsed / doneN) : 0;
                this._updateApiSyncOverlay(`Enrolments… ${doneN.toLocaleString()}/${selected.length.toLocaleString()} accounts · ${newRows.length.toLocaleString()} records · ~${eta >= 3600 ? Math.round(eta / 3600) + ' h' : Math.round(eta / 60) + ' min'} left`, 15 + Math.round(doneN / selected.length * 80));
            }
            if (summary.failed > Math.max(20, summary.selected * this.ENR_MAX_FAILURE_SHARE)) {
                throw new Error(`${summary.failed} of ${summary.selected} accounts failed after retries — not saving an incomplete dataset. Run again later.`);
            }

            // 5. Merge and persist (same store, same shape)
            this._updateApiSyncOverlay('Saving…', 97);
            const kept = mode === 'full' ? [] : existing.filter(r => !processed.has(r.uid));
            const rows = kept.concat(newRows);
            summary.rows = rows.length;
            await Storage.setItem('surghub_completion', rows);
            this._rawCompletion = rows; this._completionLoadPromise = null;
            this._instIdx = null; this._anomCompCache = null;
            await this._stampSync('progress');
            await this._stampSync('enrolments');
            await this._enrSaveMeta({ lastRun: new Date().toISOString(), lastRunEpoch: Math.floor(Date.now() / 1000), mode, users: summary.users, selected: summary.selected, rows: summary.rows, failed: summary.failed });
            await this.handleDbSave();
            ok = true;
        } catch (e) {
            console.error('[enrolments] sync failed:', e);
            if (!opts.silent) this.showMsg('⚠ Enrolment sync ' + (/cancelled/i.test(e.message || '') ? 'cancelled' : 'failed') + ': ' + (e.message || e), true);
            throw e;
        } finally {
            try { LW.finishRawPull(ok); } catch (e) { __swallowed(e, 'enrolments.raw'); }
            this._apiSyncInFlight = false;
            if (!opts.silent) this._hideApiSyncOverlay();
        }
        if (!opts.silent) {
            this.showMsg(`✓ Enrolments synced (${mode}): ${summary.done.toLocaleString()} accounts (${summary.noEnrolments.toLocaleString()} with no enrolments) → ${summary.rows.toLocaleString()} learner-course records` + (summary.failed ? ` · ${summary.failed} accounts skipped after retries` : ''));
            this.renderView();
        }
        return summary;
    },
});
