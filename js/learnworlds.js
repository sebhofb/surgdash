// === LearnWorlds API integration ===
// Phase 1: Course Foundation auto-sync.
// Talks directly to https://api.learnworlds.com/v2/* via the main-process
// http-request IPC (no CORS, no preload changes needed).
//
// Credentials are stored locally only (Storage keys: learnworlds_client_id,
// learnworlds_api_token, learnworlds_school_domain). They are NEVER included
// in any cloud sync — the Sheets push only ships surghub_* + project keys.
//
// Source-of-truth: Step 1 reconciliation in updater.js still owns the merge
// logic. This module just produces masterRows of shape {Course, Learners,
// Certificates} so the existing pipeline can be reused.

window.LearnWorlds = (function () {

    // LearnWorlds routes each school's API through its own domain. SURGhub's
    // is https://www.surghub.org/admin/api/v2 (visible on the API page in
    // SURGhub admin → Developers → API → "API URL").
    const DEFAULT_BASE_URL = 'https://www.surghub.org/admin/api/v2';
    // Most LW endpoints cap at 100/page, but /v2/users on this plan accepts up
    // to 500. We try a large page size first and the API silently truncates if
    // it doesn't support it (we'd see fewer rows than requested but still
    // correct totalPages, so iteration completes correctly).
    const PAGE_SIZE = 100;          // safe default for endpoints we haven't probed
    const USERS_PAGE_SIZE = 200;    // /users max per LearnWorlds API: 1-200
    const REQ_DELAY_MS = 350;       // Polite delay between calls (rate-limit safety — LW free tier ≈ 60/min)

    let _creds = null;              // {clientId, apiToken, schoolDomain}

    // ── Credentials ─────────────────────────────────────────────────────────
    async function getCredentials() {
        if (_creds) return _creds;
        const clientId = await Storage.getItem('learnworlds_client_id');
        const apiToken = await Storage.getItem('learnworlds_api_token');
        const schoolDomain = await Storage.getItem('learnworlds_school_domain');
        _creds = { clientId: clientId || '', apiToken: apiToken || '', schoolDomain: schoolDomain || '' };
        return _creds;
    }

    async function setCredentials({ clientId, apiToken, schoolDomain }) {
        await Storage.setItem('learnworlds_client_id', clientId || '');
        await Storage.setItem('learnworlds_api_token', apiToken || '');
        await Storage.setItem('learnworlds_school_domain', schoolDomain || '');
        _creds = { clientId: clientId || '', apiToken: apiToken || '', schoolDomain: schoolDomain || '' };
        return _creds;
    }

    function hasCredentials(c) {
        return !!(c && c.clientId && c.apiToken);
    }

    // ── HTTP helper ─────────────────────────────────────────────────────────
    function _resolveBaseUrl(c) {
        // Allow override via the school_domain credential (full URL or bare domain).
        const raw = (c && c.schoolDomain || '').trim();
        if (!raw) return DEFAULT_BASE_URL;
        // If user pasted the full URL from LearnWorlds admin
        if (raw.includes('/admin/api')) return raw.replace(/\/+$/, '') + (raw.endsWith('/v2') ? '' : '/v2');
        // Bare domain
        const host = raw.replace(/^https?:\/\//, '').replace(/\/+$/, '');
        return `https://${host}/admin/api/v2`;
    }

    // Hard global abort flag — Cmd+R or App.cancelLearnWorldsSync() sets this
    // and every in-flight loop checks it between calls.
    let _aborted = false;
    function abort() { _aborted = true; }
    function _checkAbort() { if (_aborted) throw new Error('Sync cancelled by user.'); }

    async function _apiGet(path, params, retryDepth) {
        _checkAbort();
        const c = await getCredentials();
        if (!hasCredentials(c)) {
            throw new Error('LearnWorlds API credentials not set. Open Settings → LearnWorlds API to add your Client ID and Access Token.');
        }
        const base = _resolveBaseUrl(c);
        const qs = params ? '?' + new URLSearchParams(params).toString() : '';
        const url = `${base}${path}${qs}`;
        const headers = {
            'Authorization': `Bearer ${c.apiToken}`,
            'Lw-Client': c.clientId,
            'Accept': 'application/json'
        };
        const res = await electronAPI.invoke('http-request', { url, method: 'GET', headers });
        if (res.error) throw new Error(`Network error reaching ${url}: ${res.error}`);
        if (res.statusCode === 401 || res.statusCode === 403) {
            throw new Error(`Auth failed (${res.statusCode}) at ${url}. Check Client ID + token scopes (need courses:read).`);
        }
        if (res.statusCode === 429) {
            // Honour the server's Retry-After header if present; otherwise back off
            // exponentially. Cap at 3 retries per call so we don't hang forever.
            const d = (retryDepth || 0);
            if (d >= 3) throw new Error(`Rate limit (429) after ${d} retries at ${url}. Server keeps refusing — slow down further or pause sync.`);
            const waitMs = Math.min(60000, 2000 * Math.pow(2, d));
            console.warn(`[LearnWorlds] 429 rate-limited, waiting ${waitMs}ms before retry ${d+1}/3 at ${url}`);
            await _sleep(waitMs);
            _checkAbort();
            return _apiGet(path, params, d + 1);
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
            throw new Error(`API error ${res.statusCode} at ${url}: ${(res.body || '').slice(0, 200)}`);
        }
        let parsed;
        try { parsed = JSON.parse(res.body); }
        catch (e) {
            const snippet = (res.body || '').replace(/\s+/g, ' ').slice(0, 250);
            throw new Error(`Non-JSON response from ${url} (status ${res.statusCode}). Body starts with: "${snippet}"`);
        }
        _captureRaw(path, params, res.body);   // immutable receipt (best-effort)
        return parsed;
    }

    function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // Run async thunks concurrently, retrying any that reject (on top of _apiGet's
    // own 429 backoff). Returns results IN ORDER. If a thunk still fails after all
    // attempts, THROWS — so a sync aborts loudly rather than silently persisting an
    // incomplete dataset. This recovers transient rate-limit/network blips that
    // would otherwise waste a whole multi-page pull.
    async function _settleWithRetry(thunks, label, attempts) {
        attempts = attempts || 3;
        const results = new Array(thunks.length);
        let pending = thunks.map((_, i) => i);
        for (let attempt = 1; attempt <= attempts && pending.length; attempt++) {
            if (attempt > 1) await _sleep(3000 * (attempt - 1)); // extra 3s, then 6s, between rounds
            _checkAbort();
            const settled = await Promise.allSettled(pending.map(i => thunks[i]()));
            const next = [];
            settled.forEach((s, k) => {
                const i = pending[k];
                if (s.status === 'fulfilled') { results[i] = s.value; }
                else { next.push(i); console.warn(`[${label}] request ${i + 1} failed (attempt ${attempt}/${attempts}): ${s.reason && s.reason.message}`); }
            });
            pending = next;
        }
        if (pending.length) {
            throw new Error(`${label}: ${pending.length} request(s) failed after ${attempts} attempts — sync aborted so incomplete data isn't saved (usually a transient rate limit; try again).`);
        }
        return results;
    }

    // ── Raw capture: immutable "receipts" of every API response ─────────────
    // Each successful API response is appended VERBATIM to raw/{pullId}/pull.jsonl
    // BEFORE any normalization, with a manifest line per pull. This makes on-screen
    // numbers traceable to a named pull and re-derivable later. Best-effort —
    // every call is wrapped so it can NEVER break or slow-fail a sync. raw/ holds
    // emails + referrer_id, so storage.js keys() hard-excludes it from every export.
    let _rawPullId = null, _rawComplete = false, _rawPages = 0, _rawBytes = 0, _rawStartedAt = null;
    function _rawDir() { return electronAPI.path.join(Storage.DATA_DIR, 'surghub', 'raw'); }
    function _rawStamp() { const d = new Date(); const p = n => String(n).padStart(2, '0'); return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); }
    function _finalizeRawPull() {
        if (!_rawPullId) return;
        try {
            const fs = electronAPI.fs, path = electronAPI.path;
            const line = JSON.stringify({ pullId: _rawPullId, startedAt: _rawStartedAt, finishedAt: new Date().toISOString(), pages: _rawPages, bytes: _rawBytes, complete: _rawComplete }) + '\n';
            fs.appendFileSync(path.join(_rawDir(), 'manifest.jsonl'), line);
        } catch (e) { console.warn('[raw] manifest write failed:', e && e.message); }
        _rawPullId = null;
    }
    function _pruneRawPulls(keep) {
        try {
            const fs = electronAPI.fs, path = electronAPI.path, dir = _rawDir();
            if (!fs.existsSync(dir)) return;
            // Prune PER PULL-TYPE (label before "__"), keeping the last `keep` of
            // EACH — so a burst of course/demographics syncs can never evict the
            // ambassadors (or any other type's) receipt, which would blind the
            // firewall's checks for that type. Only API-pull dirs (those holding a
            // pull.jsonl) are touched; self-contained artifact receipts (signup
            // survey) carry no pull.jsonl and manage their own retention.
            const byLabel = {};
            fs.readdirSync(dir, { withFileTypes: true })
                .filter(e => e.isDirectory && /__\d{8}-\d{6}$/.test(e.name) && fs.existsSync(path.join(dir, e.name, 'pull.jsonl')))
                .forEach(e => { const label = e.name.slice(0, e.name.lastIndexOf('__')); (byLabel[label] = byLabel[label] || []).push(e.name); });
            for (const label of Object.keys(byLabel)) {
                const dirs = byLabel[label].sort();
                for (let i = 0; i < dirs.length - keep; i++) { try { fs.rmSync(path.join(dir, dirs[i]), { recursive: true, force: true }); } catch (e) {} }
            }
        } catch (e) {}
    }
    // Open a new pull (finalising any dangling one conservatively as incomplete).
    function startRawPull(label) {
        try {
            if (_rawPullId) _finalizeRawPull();
            const fs = electronAPI.fs, path = electronAPI.path;
            _rawPullId = String(label || 'pull').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '') + '__' + _rawStamp();
            _rawComplete = false; _rawPages = 0; _rawBytes = 0; _rawStartedAt = new Date().toISOString();
            const pd = path.join(_rawDir(), _rawPullId);
            if (!fs.existsSync(pd)) fs.mkdirSync(pd, { recursive: true });
            return _rawPullId;
        } catch (e) { console.warn('[raw] startRawPull failed:', e && e.message); _rawPullId = null; return null; }
    }
    // Close the current pull, recording whether it finished cleanly, and prune.
    function finishRawPull(ok) { _rawComplete = ok !== false; _finalizeRawPull(); _pruneRawPulls(3); }
    function _captureRaw(pathName, params, body) {
        if (!_rawPullId || !body) return;
        try {
            const fs = electronAPI.fs, path = electronAPI.path;
            const line = JSON.stringify({ t: Date.now(), path: pathName, params: params || null, body: String(body) }) + '\n';
            fs.appendFileSync(path.join(_rawDir(), _rawPullId, 'pull.jsonl'), line);
            _rawPages++; _rawBytes += line.length;
        } catch (e) { /* best-effort — never break a sync */ }
    }
    // Capture a NON-API artifact (e.g. the signup-survey export) as its own
    // self-contained receipt: a raw/{label}__{stamp}/ dir + a manifest line,
    // WITHOUT touching the in-flight API-pull state (_rawPullId) — so it can run
    // during or outside a sync without clobbering an API pull. raw/ is hard-
    // excluded from every export, so this never leaks; the file is .jsonl
    // (keys() only indexes .json) for defense-in-depth. Returns the pullId, or
    // null on any failure (best-effort — never throws).
    function captureRawArtifact(label, filename, text) {
        try {
            if (!text) return null;
            const fs = electronAPI.fs, path = electronAPI.path, dir = _rawDir();
            const lbl = (String(label || 'artifact').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '')) || 'artifact';
            const fname = filename || 'artifact.jsonl';
            const pullId = lbl + '__' + _rawStamp();
            const pd = path.join(dir, pullId);
            if (!fs.existsSync(pd)) fs.mkdirSync(pd, { recursive: true });
            const out = String(text);
            fs.writeFileSync(path.join(pd, fname), out, 'utf8');
            const stamp = new Date().toISOString();
            const line = JSON.stringify({ pullId, startedAt: stamp, finishedAt: stamp, pages: 1, bytes: out.length, complete: true, artifact: fname }) + '\n';
            fs.appendFileSync(path.join(dir, 'manifest.jsonl'), line);
            // Label-scoped retention — keep the last 3 receipts of THIS label.
            try {
                const dirs = fs.readdirSync(dir, { withFileTypes: true })
                    .filter(e => e.isDirectory && e.name.indexOf(lbl + '__') === 0 && /__\d{8}-\d{6}$/.test(e.name))
                    .map(e => e.name).sort();
                for (let i = 0; i < dirs.length - 3; i++) { try { fs.rmSync(path.join(dir, dirs[i]), { recursive: true, force: true }); } catch (e) {} }
            } catch (e) {}
            return pullId;
        } catch (e) { console.warn('[raw] captureRawArtifact failed:', e && e.message); return null; }
    }
    // Read back the rows of the latest artifact receipt for a label (one JSON
    // object per line). Returns an array of row objects (empty if none/error).
    function readLatestArtifactRows(label, filename) {
        try {
            const fs = electronAPI.fs, path = electronAPI.path, dir = _rawDir();
            if (!fs.existsSync(dir)) return [];
            const lbl = String(label || '').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '');
            const latest = fs.readdirSync(dir, { withFileTypes: true })
                .filter(e => e.isDirectory && e.name.indexOf(lbl + '__') === 0 && /__\d{8}-\d{6}$/.test(e.name))
                .map(e => e.name).sort().pop();
            if (!latest) return [];
            const txt = String(fs.readFileSync(path.join(dir, latest, filename || 'rows.jsonl'), 'utf8'));
            const out = [];
            for (const ln of txt.split('\n')) { if (!ln) continue; try { out.push(JSON.parse(ln)); } catch (e) {} }
            return out;
        } catch (e) { return []; }
    }

    // ── Connection test ─────────────────────────────────────────────────────
    // Pings /v2/courses with items_per_page=1 — cheapest valid call that proves
    // both credentials are accepted by the school.
    async function testConnection() {
        try {
            const data = await _apiGet('/courses', { items_per_page: 1, page: 1 });
            // Response shape: { data: [...], meta: {totalItems, totalPages, ...} }
            const total = (data && data.meta && data.meta.totalItems) || (data && data.data && data.data.length) || 0;
            return { ok: true, totalCourses: total };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }

    // ── Fetch all courses (paginated) ───────────────────────────────────────
    async function fetchAllCourses(onProgress) {
        const all = [];
        let page = 1;
        let totalPages = 1;
        do {
            const data = await _apiGet('/courses', { items_per_page: PAGE_SIZE, page });
            const rows = (data && data.data) || [];
            all.push(...rows);
            totalPages = (data && data.meta && data.meta.totalPages) || 1;
            if (onProgress) onProgress({ page, totalPages, count: all.length });
            page++;
            if (page <= totalPages) await _sleep(REQ_DELAY_MS);
        } while (page <= totalPages);
        return all;
    }

    // ── Course Foundation: build masterRows for Step 1 reconciler ──────────
    // Returns an array of {Course, Learners, Certificates} matching the
    // shape that Pipeline.processMasterUpload would produce from the CSV.
    //
    // LearnWorlds /v2/courses returns per-course counters depending on the
    // school's API plan. The fields we look for (in priority order):
    //   - enrolled_users_count, total_enrollments, students_count
    //   - certificates_issued, certified_users_count, completions_count
    // If both counters are present on /courses, no extra calls are needed.
    // Otherwise we fall back to per-course /courses/{id}/users counts.
    async function fetchCourseFoundation(onProgress) {
        // Reset state for a fresh sync. Sticky filter & diag dump are session-
        // scoped so a re-run after editing creds works cleanly.
        _aborted = false;
        _stickyFilter = null;
        _stickyFilterRejected = false;
        _diagDumped = false;

        const courses = await fetchAllCourses(p =>
            onProgress && onProgress({ phase: 'list', ...p, totalCourses: p.count })
        );
        const masterRows = [];
        const needsDeepFetch = [];

        for (const c of courses) {
            const title = (c.title || c.name || '').trim();
            if (!title) continue;
            const learners = _firstNumber(c, ['enrolled_users_count', 'total_enrollments', 'students_count', 'users_count']);
            const certs    = _firstNumber(c, ['certificates_issued', 'certified_users_count', 'completions_count', 'completed_count']);
            // Publication status straight from LearnWorlds: 'free' (published/open),
            // 'private' (published/unlisted), or 'draft' (unpublished). Carried onto
            // the course record so the app can classify courses by their real status.
            const access = c.access != null ? c.access : null;
            const modified = _normaliseLwDate(c.modified || c.modified_at) || null;
            if (learners != null && certs != null) {
                masterRows.push({ Course: title, Learners: learners, Certificates: certs, _courseId: c.id, _courseCreated: _normaliseLwDate(c.created || c.created_at) || null, _access: access, _modified: modified });
            } else {
                needsDeepFetch.push({ id: c.id, title, learners, certs, access, created: c.created, modified: c.modified });
            }
        }

        // Deep-fetch any course that didn't expose counters on the list endpoint.
        // PARALLEL — 5 concurrent course fetches. Each takes 1-3 API calls;
        // running them in batches drops 244 courses from ~30 min serial to ~5 min.
        // certs:null in the masterRow means "API couldn't determine" — the reconciler
        // will preserve existing local cert count rather than overwriting with 0.
        const COURSE_CONCURRENCY = 5;
        const methodCounts = {};
        let processed = 0;
        const courseResults = new Array(needsDeepFetch.length);

        for (let batchStart = 0; batchStart < needsDeepFetch.length; batchStart += COURSE_CONCURRENCY) {
            _checkAbort();
            const batchEnd = Math.min(batchStart + COURSE_CONCURRENCY, needsDeepFetch.length);
            const batch = [];
            for (let i = batchStart; i < batchEnd; i++) {
                const c = needsDeepFetch[i];
                batch.push(
                    _fetchCourseCounters(c.id)
                        .then(result => {
                            methodCounts[result.method || 'unknown'] = (methodCounts[result.method || 'unknown'] || 0) + 1;
                            if (i < 5) {
                                console.log(`[LearnWorlds] "${c.title.slice(0, 40)}" → learners=${result.learners}, certs=${result.certs == null ? 'unavailable' : result.certs}, mins=${result.learningMinutes || 0} (${result.method})`);
                            }
                            courseResults[i] = {
                                Course: c.title,
                                Learners: c.learners != null ? c.learners : result.learners,
                                Certificates: (c.certs != null) ? c.certs : result.certs,
                                LearningMinutes: result.learningMinutes != null ? result.learningMinutes : null,
                                SuccessRate: result.successRate != null ? result.successRate : null,
                                AvgFinishMinutes: result.avgFinishMinutes != null ? result.avgFinishMinutes : null,
                                _courseId: c.id, _courseCreated: _normaliseLwDate(c.created || c.created_at) || null,
                                _access: c.access != null ? c.access : null, _modified: _normaliseLwDate(c.modified || c.modified_at) || null
                            };
                        })
                        .catch(e => {
                            console.warn('[LearnWorlds] Deep fetch failed for', c.title, e.message);
                            courseResults[i] = { Course: c.title, Learners: c.learners || 0, Certificates: null, LearningMinutes: null, _courseId: c.id, _courseCreated: _normaliseLwDate(c.created || c.created_at) || null };
                        })
                );
            }
            await Promise.all(batch);
            processed = batchEnd;
            if (onProgress) onProgress({ phase: 'deep', current: processed, total: needsDeepFetch.length, course: needsDeepFetch[batchEnd - 1].title });
            if (batchEnd < needsDeepFetch.length) await _sleep(REQ_DELAY_MS);
        }
        for (const r of courseResults) if (r) masterRows.push(r);
        console.log('[LearnWorlds] Cert-count method tally:', methodCounts);
        return masterRows;
    }

    // Count enrolled + completed users for a single course by paginating
    // /v2/courses/{id}/users with status filters. Uses meta.totalItems so we
    // don't actually iterate all pages.
    //
    // Filter behaviour varies by LearnWorlds plan: status=completed is silently
    // IGNORED on some plans (returns the same total as unfiltered → certs would
    // equal learners, which is wrong). To handle that, we:
    //   1. Get the unfiltered count first.
    //   2. Try several filter variants in order.
    //   3. A filter is accepted ONLY if it returns a strictly smaller count
    //      (or zero); equal-to-unfiltered means the param was ignored.
    //   4. If every variant is ignored, fall back to client-side pagination
    //      reading progress_rate=100 (slower but plan-independent). This is
    //      gated by COUNT_CERTS_BY_PAGING below.
    let _diagDumped = false;
    let _tlFieldsDumped = false;
    // Tag classification inventory — populated as users are flattened, dumped
    // after a /users pull so we can see which tags are slipping through as
    // "specialty" when they should be country/profession etc.
    let _tagInventory = { classified: {}, specialtyCounts: {} };
    function _resetTagInventory() { _tagInventory = { classified: {}, specialtyCounts: {} }; }
    function _logTagInventory() {
        const { classified, specialtyCounts } = _tagInventory;
        console.group('[LearnWorlds] Tag classification inventory');
        console.log('Classified counts:', classified);
        const topSpecialty = Object.entries(specialtyCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 50);
        console.log(`Top 50 unmatched / specialty tags (out of ${Object.keys(specialtyCounts).length} unique):`);
        console.table(topSpecialty.map(([tag, count]) => ({ tag, count })));
        console.groupEnd();
    }

    // Fetch counters for ONE course. Cheap by design — at most:
    //   • 1 call: unfiltered enrolment count (always done)
    //   • 1 call: course detail (may include aggregate certs)
    //   • 1 call: filtered users count with the FIRST filter variant that worked
    //             this session (sticky — see _stickyFilter)
    // Total per course: 2-3 calls, never the 8+ we were doing before.
    let _stickyFilter = null;  // remembered across courses once one variant works
    let _stickyFilterRejected = false;  // true once we've ruled out all filters

    async function _fetchCourseCounters(courseId) {
        const enc = encodeURIComponent(courseId);

        // PRIMARY: /v2/courses/{id}/analytics returns students, certificates_issued,
        // total_study_time (seconds), success_rate (%), avg_time_to_finish (seconds)
        // — everything in ONE call. Confirmed accurate on SURGhub (students 1870 ≈
        // 1874, certs 1288 ≈ 1287). This replaces the old 2-call users+certs probe.
        try {
            const a = await _apiGet(`/courses/${enc}/analytics`);
            if (!_diagDumped && a) {
                _diagDumped = true;
                console.log('[LearnWorlds DIAG] /courses/{id}/analytics sample:', JSON.parse(JSON.stringify(a)));
            }
            if (a && typeof a === 'object') {
                const learners = _firstNumber(a, ['students', 'enrolled_users', 'enrollments']) || 0;
                const certs    = _firstNumber(a, ['certificates_issued', 'certificates', 'completions']);
                // Analytics sometimes reports 0 students for a course that has
                // real enrolments (seen on PeN Programme). Don't trust a zero —
                // fall through to the legacy count path below instead.
                if (learners === 0) throw new Error('analytics reported 0 students — using count fallback');
                const studySec = _firstNumber(a, ['total_study_time', 'study_time', 'total_time']) || 0;
                const finishSec = _firstNumber(a, ['avg_time_to_finish', 'avg_completion_time']);
                const successRate = _firstNumber(a, ['success_rate', 'completion_rate']);
                return {
                    learners,
                    certs: certs != null ? certs : 0,
                    learningMinutes: Math.round(studySec / TIME_DIVISOR),
                    avgFinishMinutes: finishSec != null ? Math.round(finishSec / TIME_DIVISOR) : null,
                    successRate: successRate != null ? successRate : null,
                    method: 'analytics'
                };
            }
        } catch (e) {
            if (/404|not found/i.test(e.message)) {
                return { learners: 0, certs: 0, learningMinutes: 0, method: 'empty-course' };
            }
            // else fall through to the legacy counter path below
            console.warn('[LearnWorlds] analytics endpoint failed for course', courseId, '— falling back to counts:', e.message);
        }

        // FALLBACK (only if analytics endpoint missing/errored): old behaviour —
        // enrolment count from /courses/{id}/users + cert count from /certificates.
        let learners = 0;
        try {
            const enrolled = await _apiGet(`/courses/${enc}/users`, { items_per_page: 1, page: 1 });
            learners = (enrolled && enrolled.meta && enrolled.meta.totalItems) || 0;
        } catch (e) {
            if (/404|not found/i.test(e.message)) return { learners: 0, certs: 0, learningMinutes: 0, method: 'empty-course' };
            throw e;
        }
        let certs = null;
        if (learners > 0) {
            try {
                const r = await _apiGet('/certificates', { course_id: courseId, items_per_page: 1, page: 1 });
                const n = (r && r.meta && r.meta.totalItems);
                if (typeof n === 'number') certs = n;
            } catch (e) { /* leave null */ }
        } else {
            certs = 0;
        }
        return { learners, certs, learningMinutes: 0, method: certs != null ? 'certs-by-course' : 'unavailable' };
    }

    // LearnWorlds returns dates as Unix EPOCH SECONDS (e.g. 1754691434 =
    // 2025-08-08). The CSV-path parsers expect ISO strings. Convert here so
    // every downstream consumer gets a consistent format.
    function _normaliseLwDate(val) {
        if (val == null || val === '') return '';
        const s = String(val).trim();
        if (!s) return '';
        // Numeric? Treat as Unix epoch. Detect seconds-vs-milliseconds by
        // magnitude — anything < 10^11 is seconds (year ~5138 if ms).
        if (/^-?\d+(\.\d+)?$/.test(s)) {
            const n = Number(s);
            if (!isFinite(n) || n <= 0) return '';
            const ms = n < 1e11 ? n * 1000 : n;
            const d = new Date(ms);
            if (isNaN(d.getTime())) return '';
            return d.toISOString();
        }
        // Already a string — pass through unchanged (CSV path uses many formats).
        return s;
    }

    function _firstNumber(obj, keys) {
        for (const k of keys) {
            if (obj && obj[k] != null) {
                const n = Number(obj[k]);
                if (!isNaN(n)) return n;
            }
        }
        return null;
    }

    // ── Ambassadors / Affiliates (Step 8) ──────────────────────────────────
    // Returns an array of leads in the shape expected by the CSV-path aggregator:
    //   [{ promoter: 'First Last', registered: 'YYYY-MM-DD' }, …]
    // This lets us reuse processStandaloneAmbassadors' aggregation unchanged.
    async function fetchAmbassadorLeads(onProgress) {
        _aborted = false;
        // 1. List all affiliates (paginated, ~3 pages for 245)
        const affiliates = [];
        let page = 1, totalPages = 1;
        do {
            _checkAbort();
            const r = await _apiGet('/affiliates', { items_per_page: PAGE_SIZE, page });
            const rows = (r && r.data) || [];
            affiliates.push(...rows);
            // DIAG: dump first full affiliate object so we can see all keys
            if (!_diagDumped && rows.length > 0) {
                _diagDumped = true;
                console.log('[LearnWorlds DIAG] First affiliate full record:', JSON.parse(JSON.stringify(rows[0])));
                console.log('[LearnWorlds DIAG] First affiliate keys:', Object.keys(rows[0]));
            }
            totalPages = (r && r.meta && r.meta.totalPages) || 1;
            if (onProgress) onProgress({ phase: 'list', current: page, total: totalPages, count: affiliates.length });
            page++;
            if (page <= totalPages) await _sleep(REQ_DELAY_MS);
        } while (page <= totalPages);

        // Referral-link CLICKS (link views) — a top-level counter on each
        // affiliate record (no extra calls). Total + per-promoter, for the
        // Ambassador page. Distinct from leads (referral signups): courses are
        // free, so clicks >> leads (a click is a visit, a lead is an account).
        const _promoterName = (a) => [a.first_name, a.last_name].filter(Boolean).join(' ').trim()
            || a.username || a.email || a.code || `affiliate_${a.id}`;
        let totalClicks = 0;
        const clicksByPromoter = {};
        for (const a of affiliates) {
            const c = Number(a.clicks) || 0;
            totalClicks += c;
            if (c) { const p = _promoterName(a); clicksByPromoter[p] = (clicksByPromoter[p] || 0) + c; }
        }

        // Ambassador certificate-tier tags (Ambassador_Bronze/Silver/Gold/Platinum)
        // read straight off the affiliate roster IF /affiliates exposes user tags.
        // Keyed by the SAME promoter name as Promoters, so it's an exact match in
        // the UI. (Step 4's /users scan is the fallback when affiliates carry no tags.)
        const _tiersFromTags = (tags) => {
            const arr = Array.isArray(tags) ? tags : String(tags || '').split(',');
            const out = [];
            for (const t of arr) {
                const m = String(t).trim().toLowerCase().match(/^ambassador[\s_\-]*(bronze|silver|gold|platinum)$/);
                if (m) out.push(m[1].charAt(0).toUpperCase() + m[1].slice(1));
            }
            return Array.from(new Set(out));
        };
        const tierTagsByPromoter = {};
        for (const a of affiliates) {
            if (!Array.isArray(a.tags) || !a.tags.length) continue;
            const tiers = _tiersFromTags(a.tags);
            if (tiers.length) tierTagsByPromoter[_promoterName(a)] = tiers;
        }

        // 2. Find which sub-resource name actually works. Probe an affiliate
        //    with leads > 0 (the metric that matters for SURGhub — courses are
        //    free so sales/customers are always 0; clicks are link views, not
        //    referral signups).
        const candidateSubpaths = ['leads', 'referrals', 'sales', 'transactions', 'commissions'];
        let workingSubpath = null;
        const probeTarget = affiliates.find(a => Number(a.leads) > 0)
            || affiliates.find(a => Number(a.clicks) > 0)
            || affiliates[0];
        if (probeTarget) {
            for (const sub of candidateSubpaths) {
                try {
                    const r = await _apiGet(`/affiliates/${encodeURIComponent(probeTarget.id)}/${sub}`, { items_per_page: 1, page: 1 });
                    if (r) {
                        workingSubpath = sub;
                        console.log(`[LearnWorlds] Affiliate sub-resource that works: /${sub}`, '(probed on', probeTarget.username || probeTarget.id, ')');
                        console.log(`[LearnWorlds DIAG] Sample affiliate-${sub} response:`, JSON.parse(JSON.stringify(r)));
                        break;
                    }
                } catch (e) { /* try next */ }
                await _sleep(REQ_DELAY_MS);
            }
        }

        // 3. If no sub-resource works at all, fall back to aggregate-only mode:
        //    use the affiliate's `sales` / `clicks` fields to build a flat
        //    promoter ranking (no per-month timeline, but better than nothing).
        const leads = [];
        if (!workingSubpath) {
            console.warn('[LearnWorlds] No per-lead endpoint available. Falling back to aggregate fields (no monthly timeline).');
            for (const a of affiliates) {
                const promoter = [a.first_name, a.last_name].filter(Boolean).join(' ').trim()
                    || a.username || a.email || a.code || `affiliate_${a.id}`;
                // SURGhub-specific: courses are free, so `sales`/`customers` are
                // always 0. The metric that matters is `leads` (= signups via
                // referral link). `clicks` is link views, NOT referral signups.
                const count = Number(a.leads) || 0;
                const dateField = a.date || a.created || a.created_at || '';
                // Synthesize N rows with the affiliate's join date — gives correct
                // ranking + total counts; timeline collapses to single month
                for (let k = 0; k < count; k++) {
                    leads.push({ promoter, registered: dateField });
                }
            }
            return { leads, mode: 'aggregate', totalClicks, clicksByPromoter, tierTagsByPromoter };
        }

        // 4. Per-affiliate paginated fetch using the working sub-resource.
        //    Skip affiliates whose top-level counter is 0 — saves a wasted API
        //    call per zero-lead affiliate (LW returns 404 not empty for those).
        const counterField = workingSubpath === 'leads' ? 'leads'
                            : workingSubpath === 'sales' ? 'sales'
                            : null;
        let skippedEmpty = 0;
        let firstLeadDumped = false;
        // Audit: total leads expected per affiliate counters vs actual fetched.
        // If sum-of-counters > fetched, /leads sub-resource is under-returning.
        // If sum-of-counters == fetched, the LearnWorlds dashboard total counts
        // something we're not seeing (likely deleted users included).
        let expectedFromCounters = 0;
        const mismatches = [];
        for (const a of affiliates) {
            expectedFromCounters += Number(a.leads || 0);
        }
        console.log(`[LearnWorlds] Sum of all affiliate.leads counters = ${expectedFromCounters}`);
        const perAffiliateActual = {};

        for (let i = 0; i < affiliates.length; i++) {
            _checkAbort();
            const a = affiliates[i];
            const promoter = [a.first_name, a.last_name].filter(Boolean).join(' ').trim()
                || a.username || a.email || a.code || `affiliate_${a.id}`;
            if (onProgress) onProgress({ phase: 'leads', current: i + 1, total: affiliates.length, name: promoter });
            // Optimization: skip the API call ONLY when the affiliate explicitly
            // reports 0 leads. Treat null/undefined as "unknown" — fall through
            // and call the API. Skipping nulls drops ~227 leads on SURGhub
            // (probably legacy accounts where the counter wasn't populated).
            if (counterField && a[counterField] === 0) {
                skippedEmpty++;
                continue;
            }
                let actualForThisAffiliate = 0;
            try {
                let p = 1, tp = 1;
                do {
                    const r = await _apiGet(`/affiliates/${encodeURIComponent(a.id)}/${workingSubpath}`, { items_per_page: PAGE_SIZE, page: p });
                    const rows = (r && r.data) || [];
                    // Dump first actual lead record so we can identify field names
                    if (!firstLeadDumped && rows.length > 0) {
                        firstLeadDumped = true;
                        console.log('[LearnWorlds DIAG] First lead record keys:', Object.keys(rows[0]));
                        console.log('[LearnWorlds DIAG] First lead full record:', JSON.parse(JSON.stringify(rows[0])));
                    }
                    for (const lead of rows) {
                        // LearnWorlds returns timestamps as epoch seconds — convert.
                        const rawDate = lead.registered || lead.created || lead.created_at ||
                                        lead.date || lead.signup_date || lead.signup ||
                                        lead.registration_date || lead.joined_at || lead.registered_at ||
                                        lead.timestamp || lead.lead_date || lead.signed_up_at || '';
                        const registered = _normaliseLwDate(rawDate);
                        leads.push({ promoter, registered, _raw: lead });
                        actualForThisAffiliate++;
                    }
                    tp = (r && r.meta && r.meta.totalPages) || 1;
                    p++;
                    if (p <= tp) await _sleep(REQ_DELAY_MS);
                } while (p <= tp);
            } catch (e) {
                // 404 for this specific affiliate = they just have no entries
            }
            perAffiliateActual[a.id] = actualForThisAffiliate;
            const expected = Number(a.leads || 0);
            if (expected !== actualForThisAffiliate) {
                mismatches.push({ promoter, expected, actual: actualForThisAffiliate, diff: expected - actualForThisAffiliate });
            }
            await _sleep(REQ_DELAY_MS);
        }
        if (skippedEmpty > 0) console.log(`[LearnWorlds] Skipped ${skippedEmpty} affiliates with 0 ${counterField} (no API call needed)`);
        console.log(`[LearnWorlds] Audit: expected from counters = ${expectedFromCounters}, actually fetched = ${leads.length}, diff = ${expectedFromCounters - leads.length}`);
        if (mismatches.length > 0) {
            // Sort by diff size descending so the biggest mismatches surface first
            mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
            console.log(`[LearnWorlds] ${mismatches.length} affiliates have a leads-counter vs /leads-fetched mismatch:`);
            console.table(mismatches.slice(0, 20));
            if (mismatches.length > 20) console.log(`  …and ${mismatches.length - 20} more (not shown)`);
        }
        return { leads, mode: workingSubpath, totalClicks, clicksByPromoter, tierTagsByPromoter };
    }

    // ── Certificate records: per-user completions + dates, fetched BY COURSE ──
    // /certificates?course_id=X returns one record per issued cert with `user`
    // (learner id), `course_id`, `issued` (epoch seconds), `score`, `type`.
    // Iterating all courses (~25k records across ~250 pages) gives per-user cert
    // attribution + completion dates → cohort retention / time-to-completion /
    // drop-off. This is the legit cheap "deep" dataset (the by-course /users
    // endpoint returns only profiles, no progress — confirmed by probe).
    async function fetchAllCertificates(onProgress) {
        _aborted = false;
        const courses = await fetchAllCourses(p =>
            onProgress && onProgress({ phase: 'courses', current: p.count, total: p.count })
        );
        const courseList = courses
            .map(c => ({ id: c.id, title: (c.title || c.name || '').trim(), created: _normaliseLwDate(c.created || c.created_at) || null }))
            .filter(c => c.id);

        const records = [];           // {user, courseName, issued (ISO), score, type}
        const certCountByUser = {};   // userId -> count
        let total = 0;
        let diag = false;
        let coursesDone = 0;
        const CONC = 3;

        // Emit an initial 'certs' progress immediately so the overlay moves off
        // "Listing courses" the moment collection begins (the first batch can take
        // 30s+ on big courses, which previously looked frozen).
        if (onProgress) onProgress({ phase: 'certs', current: 0, total: courseList.length, certs: 0 });

        // Process ONE course into a LOCAL result (no shared-state writes), so a
        // failed course can be retried via _settleWithRetry without double-counting.
        const processCourse = async (course) => {
            const localRecords = [];
            const localCertCount = {};
            let localTotal = 0;
            let page = 1, totalPages = 1;
            do {
                let r;
                try {
                    r = await _apiGet('/certificates', { course_id: course.id, items_per_page: PAGE_SIZE, page });
                } catch (e) {
                    if (/404|not found/i.test(e.message)) break;
                    throw e;
                }
                const rows = (r && r.data) || [];
                if (!diag && rows.length > 0) {
                    diag = true;
                    console.log('[Certs DIAG] record keys:', Object.keys(rows[0]));
                }
                for (const rec of rows) {
                    // rec.user is an OBJECT ({id, email}) on real SURGhub data — read
                    // the nested id (coercing the object would yield "[object Object]"
                    // for every record, collapsing certsByUser/completion-record hashes
                    // downstream in updater.js into a single bogus user).
                    const ru = rec.user;
                    let uid = (ru && typeof ru === 'object') ? (ru.id || ru._id || ru.user_id) : ru;
                    uid = uid || rec.user_id || rec.learner_id;
                    if (!uid) continue;
                    uid = String(uid);
                    localRecords.push({
                        user: uid,
                        courseName: course.title,
                        issued: rec.issued ? _normaliseLwDate(rec.issued) : null,
                        score: rec.score,
                        type: rec.type
                    });
                    localCertCount[uid] = (localCertCount[uid] || 0) + 1;
                    localTotal++;
                }
                totalPages = (r && r.meta && r.meta.totalPages) || 1;
                page++;
                if (page <= totalPages) await _sleep(REQ_DELAY_MS);
            } while (page <= totalPages);
            return { localRecords, localCertCount, localTotal };
        };

        for (let bs = 0; bs < courseList.length; bs += CONC) {
            _checkAbort();
            const batch = courseList.slice(bs, bs + CONC);
            const settled = await _settleWithRetry(batch.map(c => () => processCourse(c)), `certificates courses ${bs + 1}-${bs + batch.length}`, 3);
            // Merge each course's local result ONLY after the whole batch succeeded.
            for (const res of settled) {
                for (const rec of res.localRecords) records.push(rec);
                for (const uid in res.localCertCount) certCountByUser[uid] = (certCountByUser[uid] || 0) + res.localCertCount[uid];
                total += res.localTotal;
                coursesDone++;
                if (onProgress) onProgress({ phase: 'certs', current: coursesDone, total: courseList.length, certs: total });
            }
            await _sleep(REQ_DELAY_MS);
        }
        return { records, certCountByUser, total, courseCount: courseList.length };
    }

    // ── Course growth timelines: monthly enrolment + certificate history ────
    // Builds, per course, a {month: {e, c}} timeline from enrolment `created`
    // dates (/courses/{id}/users) + certificate `issued` dates (/certificates).
    // This is the heavy collection (~110k dated records) that powers the
    // Platform/Provider/Course Growth-over-time charts. ~10-12 min.
    async function fetchCourseTimelines(onProgress) {
        _aborted = false;
        const courses = await fetchAllCourses(p =>
            onProgress && onProgress({ phase: 'courses', current: p.count, total: p.count })
        );
        const courseList = courses
            .map(c => ({ id: c.id, title: (c.title || c.name || '').trim(), created: _normaliseLwDate(c.created || c.created_at) || null }))
            .filter(c => c.id);

        const result = [];
        const userCourses = {};   // userId -> [course titles] (enrolments)
        const userCerts = {};     // userId -> [course titles] (certificates)
        let done = 0;
        const CONC = 3;

        for (let bs = 0; bs < courseList.length; bs += CONC) {
            _checkAbort();
            const batch = courseList.slice(bs, bs + CONC);
            const settled = await _settleWithRetry(batch.map((course) => async () => {
                const enc = encodeURIComponent(course.id);
                const timeline = {};   // 'YYYY-MM' -> {e, c}
                const countryStats = {};   // canonical country -> enrolment count
                let totalE = 0, totalC = 0;
                const localUserCourses = new Set(), localUserCerts = new Set(); // uids, deduped per course; merged into the shared maps only on course success

                // Enrolment dates + country tags from /courses/{id}/users.
                // The user records carry `created` (enrolment date) AND `tags`
                // (incl. country) — so we get the per-course geography for the
                // Provider/Course learner maps in the same pass, no extra calls.
                // The user id is also captured into a user→courses map so the
                // Learners sync can attribute users to courses (anonymized
                // per-course records) without the slow deep-cert collection.
                let p = 1, tp = 1;
                do {
                    let r;
                    try { r = await _apiGet(`/courses/${enc}/users`, { items_per_page: USERS_PAGE_SIZE, page: p }); }
                    catch (e) {
                        if (/404|not found/i.test(e.message)) break;  // empty course
                        throw e;  // hard error → _settleWithRetry retries the whole course (loud abort if persistent)
                    }
                    for (const u of ((r && r.data) || [])) {
                        // Prefer a per-enrolment date if the record carries one;
                        // u.created is the USER's signup date, which back-dates
                        // enrolments for courses joined by existing users (seen
                        // as pre-launch activity on late-added courses).
                        if (!_tlFieldsDumped && u) { _tlFieldsDumped = true; console.log('[GrowthTimeline DIAG] course-user record keys:', Object.keys(u).join(', ')); }
                        let d = null;
                        for (const cand of [u.enrolled_at, u.enrollment_date, u.enrolled, u.enrollment && u.enrollment.created, u.enrollment && u.enrollment.date, u.created]) {
                            if (!cand) continue;
                            d = _normaliseLwDate(cand);
                            if (d) break;
                        }
                        // No per-enrolment date exists on these records (only the
                        // user's account-creation date), so clamp to the course's
                        // launch: an enrolment cannot predate the course.
                        if (d && course.created && d < course.created) d = course.created;
                        if (d) { const m = d.substring(0, 7); (timeline[m] = timeline[m] || { e: 0, c: 0 }).e++; totalE++; }
                        const uid = u.id || u.user_id;
                        if (uid) localUserCourses.add(uid);
                        if (Array.isArray(u.tags)) {
                            for (const tag of u.tags) {
                                const cls = _classifyTag(tag);
                                if (cls && cls.type === 'country') { countryStats[cls.value] = (countryStats[cls.value] || 0) + 1; break; }
                            }
                        }
                    }
                    tp = (r && r.meta && r.meta.totalPages) || 1; p++;
                    if (p <= tp) await _sleep(REQ_DELAY_MS);
                } while (p <= tp);

                // Certificate dates from /certificates?course_id (`issued`)
                p = 1; tp = 1;
                do {
                    let r;
                    try { r = await _apiGet('/certificates', { course_id: course.id, items_per_page: PAGE_SIZE, page: p }); }
                    catch (e) { if (/404|not found/i.test(e.message)) break; throw e; }
                    for (const rec of ((r && r.data) || [])) {
                        const d = rec.issued ? _normaliseLwDate(rec.issued) : null;
                        if (d) { const m = d.substring(0, 7); (timeline[m] = timeline[m] || { e: 0, c: 0 }).c++; totalC++; }
                        // On real SURGhub data rec.user is an OBJECT ({id, email}),
                        // not a string id — read the nested id so cert records key by
                        // user. Coercing the raw object would stringify every record
                        // to "[object Object]" and collapse the whole map into one key.
                        const ru = rec.user;
                        let uid = (ru && typeof ru === 'object') ? (ru.id || ru._id || ru.user_id) : ru;
                        uid = uid || rec.user_id || rec.learner_id;
                        if (uid) localUserCerts.add(String(uid));
                    }
                    tp = (r && r.meta && r.meta.totalPages) || 1; p++;
                    if (p <= tp) await _sleep(REQ_DELAY_MS);
                } while (p <= tp);

                return { courseId: course.id, courseName: course.title, timeline, totalE, totalC, countryStats, localUserCourses, localUserCerts };
            }), `timelines courses ${bs + 1}-${bs + batch.length}`, 3);
            // Merge each course's local result ONLY after the whole batch succeeded.
            for (const res of settled) {
                result.push({ courseId: res.courseId, courseName: res.courseName, timeline: res.timeline, totalE: res.totalE, totalC: res.totalC, countryStats: res.countryStats });
                for (const uid of res.localUserCourses) (userCourses[uid] = userCourses[uid] || []).push(res.courseName);
                for (const uid of res.localUserCerts) (userCerts[uid] = userCerts[uid] || []).push(res.courseName);
            }
            done = Math.min(bs + CONC, courseList.length);
            if (onProgress) onProgress({ phase: 'timelines', current: done, total: courseList.length });
            await _sleep(REQ_DELAY_MS);
        }
        return { timelines: result, userCourses, userCerts };
    }

    // ── Deep progress: per-user-per-course completion + time, fetched BY COURSE ──
    // Iterating /courses/{id}/users (243 courses, paginated) is ~75x cheaper
    // than /users/{id}/progress per user (49k calls). We extract each enrolled
    // user's progress_rate / time_on_course / completed_at and accumulate by
    // user id. Returns enrollmentsByUser keyed by user id.
    //
    // time_on_course unit: LearnWorlds typically reports SECONDS. We convert to
    // minutes via TIME_DIVISOR. The first-record diagnostic dumps the raw value
    // so we can confirm/adjust the unit on the first real run.
    const DEEP_COURSE_CONCURRENCY = 3;
    const TIME_DIVISOR = 60;  // seconds → minutes (adjust if diag shows otherwise)

    async function fetchDeepProgress(onProgress) {
        _aborted = false;
        const courses = await fetchAllCourses(p =>
            onProgress && onProgress({ phase: 'courses', current: p.count, total: p.count })
        );
        const courseList = courses
            .map(c => ({ id: c.id, title: (c.title || c.name || '').trim() }))
            .filter(c => c.id);

        const enrollmentsByUser = {};   // userId -> [{courseName, minutes, completed, completedAt, enrolledAt, progressRate}]
        let totalEnrollments = 0;
        let fieldDiag = null;
        let timeSampleLogged = false;

        for (let bs = 0; bs < courseList.length; bs += DEEP_COURSE_CONCURRENCY) {
            _checkAbort();
            const batch = courseList.slice(bs, bs + DEEP_COURSE_CONCURRENCY);
            const settled = await _settleWithRetry(batch.map((course) => async () => {
                const enc = encodeURIComponent(course.id);
                const localEnrollments = [], seenInCourse = new Set(); // one entry per (user,course); merged into shared state only on success
                let page = 1, totalPages = 1;
                do {
                    let r;
                    try {
                        r = await _apiGet(`/courses/${enc}/users`, { items_per_page: 200, page });
                    } catch (e) {
                        if (/404|not found/i.test(e.message)) break;  // empty course
                        throw e;
                    }
                    const rows = (r && r.data) || [];
                    if (!fieldDiag && rows.length > 0) {
                        fieldDiag = Object.keys(rows[0]);
                        console.log('[DeepSync DIAG] /courses/{id}/users record keys:', fieldDiag);
                        console.log('[DeepSync DIAG] sample record:', JSON.parse(JSON.stringify(rows[0])));
                    }
                    for (const u of rows) {
                        const userId = u.id || u.user_id;
                        if (!userId) continue;
                        if (seenInCourse.has(userId)) continue;  // one enrolment per user per course
                        seenInCourse.add(userId);
                        const rawTime = _firstNumber(u, ['time_on_course', 'total_time', 'time_spent', 'seconds_on_course', 'time']);
                        if (!timeSampleLogged && rawTime != null && rawTime > 0) {
                            timeSampleLogged = true;
                            console.log(`[DeepSync DIAG] sample raw time_on_course = ${rawTime} (÷${TIME_DIVISOR} → ${(rawTime / TIME_DIVISOR).toFixed(1)} min). Verify unit!`);
                        }
                        const minutes = rawTime != null ? rawTime / TIME_DIVISOR : 0;
                        const progressRate = _firstNumber(u, ['progress_rate', 'progress', 'completion_rate']);
                        const status = String(u.status || u.course_progress_status || u.progress_status || '').toLowerCase();
                        const completedAt = u.completed_at || u.completion_date || u.completed_on || null;
                        const completed = (progressRate != null && progressRate >= 100) ||
                                          status === 'completed' || status === 'passed' || !!completedAt;
                        localEnrollments.push({ userId, entry: {
                            courseName: course.title,
                            minutes,
                            completed,
                            progressRate,
                            completedAt: completedAt ? _normaliseLwDate(completedAt) : null,
                            enrolledAt: u.created ? _normaliseLwDate(u.created) : (u.enrolled_at ? _normaliseLwDate(u.enrolled_at) : null)
                        } });
                    }
                    totalPages = (r && r.meta && r.meta.totalPages) || 1;
                    page++;
                    if (page <= totalPages) await _sleep(REQ_DELAY_MS);
                } while (page <= totalPages);
                return localEnrollments;
            }), `deep-progress courses ${bs + 1}-${bs + batch.length}`, 3);
            // Merge each course's local result ONLY after the whole batch succeeded.
            for (const list of settled) {
                for (const it of list) { (enrollmentsByUser[it.userId] = enrollmentsByUser[it.userId] || []).push(it.entry); totalEnrollments++; }
            }
            if (onProgress) onProgress({
                phase: 'progress',
                current: Math.min(bs + DEEP_COURSE_CONCURRENCY, courseList.length),
                total: courseList.length,
                enrollments: totalEnrollments
            });
            await _sleep(REQ_DELAY_MS);
        }
        return { enrollmentsByUser, totalEnrollments, fieldDiag, courseCount: courseList.length };
    }

    // Cheap: list-only fetch of affiliate IDs (for cross-referencing
    // referrer_id orphans without iterating per-affiliate leads).
    async function fetchAffiliateIds() {
        _aborted = false;
        const ids = new Set();
        let page = 1, totalPages = 1;
        do {
            const r = await _apiGet('/affiliates', { items_per_page: PAGE_SIZE, page });
            for (const a of ((r && r.data) || [])) {
                if (a && a.id) ids.add(String(a.id));
            }
            totalPages = (r && r.meta && r.meta.totalPages) || 1;
            page++;
            if (page <= totalPages) await _sleep(REQ_DELAY_MS);
        } while (page <= totalPages);
        return ids;
    }

    // ── Users / Demographics (Step 4) ──────────────────────────────────────
    // Returns an array of user records suitable for runAudienceAggregation.
    // Each record is a flat object combining top-level fields + flattened
    // custom_fields / extras so the existing heuristic column-finder can pick
    // them up by name (e.g. "country of nationality" → country).
    // Concurrency for parallel pagination. 3 simultaneous calls cuts /users
    // runtime by ~3x with no rate-limit issues on SURGhub's tier (LW caps
    // around 30 req/sec; we average <10 with this).
    const PARALLEL_PAGES = 3;

    async function fetchAllUsers(onProgress) {
        _aborted = false;
        _resetTagInventory();
        const users = [];
        const referrerCounts = {};
        let totalLeads = 0;

        // Process a single page's rows into the running aggregates
        const ingestPage = (r) => {
            const rows = (r && r.data) || [];
            for (const u of rows) {
                users.push(_flattenUser(u));
                const rid = u.referrer_id;
                if (rid != null && String(rid).trim() !== '') {
                    referrerCounts[rid] = (referrerCounts[rid] || 0) + 1;
                    totalLeads++;
                }
            }
            return rows;
        };

        // First page (serial) — gives us totalPages
        const first = await _apiGet('/users', { items_per_page: USERS_PAGE_SIZE, page: 1, include: 'custom_fields' });
        const firstRows = ingestPage(first);
        const totalPages = (first && first.meta && first.meta.totalPages) || 1;
        if (!_diagDumped && firstRows.length > 0) {
            _diagDumped = true;
            console.log('[LearnWorlds DIAG] First raw user keys:', Object.keys(firstRows[0]));
            console.log('[LearnWorlds DIAG] Flattened first user keys:', Object.keys(users[0]));
        }
        if (onProgress) onProgress({ current: 1, total: totalPages, count: users.length, totalLeadsSoFar: totalLeads });

        // Remaining pages in PARALLEL_PAGES-sized batches
        for (let batchStart = 2; batchStart <= totalPages; batchStart += PARALLEL_PAGES) {
            _checkAbort();
            const batchEnd = Math.min(batchStart + PARALLEL_PAGES - 1, totalPages);
            const thunks = [];
            for (let p = batchStart; p <= batchEnd; p++) {
                const page = p;
                thunks.push(() => _apiGet('/users', { items_per_page: USERS_PAGE_SIZE, page, include: 'custom_fields' }));
            }
            // Resilient: retry any page that fails (on top of _apiGet's 429 backoff)
            // so a transient blip doesn't waste the whole pagination. Ingest happens
            // only after the full batch resolves, so a failure ingests nothing and
            // aborts loudly rather than storing a partial learner set.
            const results = await _settleWithRetry(thunks, `users pages ${batchStart}–${batchEnd}`, 3);
            for (const r of results) ingestPage(r);
            if (onProgress) onProgress({ current: batchEnd, total: totalPages, count: users.length, totalLeadsSoFar: totalLeads });
            if (batchEnd < totalPages) await _sleep(REQ_DELAY_MS);
        }

        _logTagInventory();
        return { users, leadAttribution: { totalLeads, referrerCounts } };
    }

    // ── Tag classifier ─────────────────────────────────────────────────────
    // SURGhub stores demographic data as user tags rather than custom fields
    // (e.g. tags: ['undergraduate', 'nurse', 'algeria', 'surgery']). This
    // classifier inspects each tag and slots it into country / profession /
    // gender / education / specialty so the existing CSV-path aggregator can
    // pick it up by column name.
    //
    // Strict matching: we don't guess. Country must match a known ISO name,
    // gender/education must match a fixed list, profession must contain one of
    // a known list of role keywords. Anything else → specialty (free-form).
    // Comprehensive country list — all UN member states + observers + common
    // colloquial/alternate names + ISO 3166-1 alpha-2 codes. The existing
    // COUNTRY_CODE_MAP (in countryMap.js) covers ~140; this fills the rest.
    // All entries stored lowercase for case-insensitive matching.
    const _EXTRA_COUNTRY_NAMES = [
        // Countries missing from COUNTRY_CODE_MAP
        'andorra', 'antigua and barbuda', 'bahamas', 'bahrain', 'barbados',
        'belarus', 'belize', 'bhutan', 'cabo verde', 'cape verde',
        'comoros', 'cook islands', 'djibouti', 'dominica', 'east timor',
        'timor-leste', 'eswatini', 'swaziland', 'grenada', 'guinea-bissau',
        'iceland', 'israel', 'kiribati', 'kosovo', 'latvia', 'liechtenstein',
        'malta', 'maldives', 'marshall islands', 'mauritania', 'mauritius',
        'monaco', 'montenegro', 'nauru', 'niue', 'palau', 'puerto rico',
        'samoa', 'san marino', 'sao tome and principe', 'seychelles',
        'solomon islands', 'st kitts and nevis', 'saint kitts and nevis',
        'st lucia', 'saint lucia', 'st vincent and the grenadines',
        'saint vincent and the grenadines', 'suriname', 'tonga',
        'trinidad and tobago', 'tuvalu', 'vanuatu', 'vatican city',
        'holy see', 'western sahara', 'macedonia', 'north macedonia',
        'curacao', 'aruba', 'gibraltar', 'greenland', 'guam',
        'hong kong', 'macau', 'macao', 'french polynesia', 'new caledonia',
        'reunion', 'martinique', 'guadeloupe', 'french guiana',
        // Common alternate / colloquial names
        'uk', 'united kingdom of great britain', 'great britain', 'britain',
        'usa', 'us', 'u.s.', 'u.s.a.', 'united states of america',
        'uae', 'emirates', 'drc', 'dr congo', 'democratic republic of congo',
        'democratic republic of the congo', 'republic of congo',
        'congo-brazzaville', 'congo-kinshasa',
        'palestine', 'palestinian territories', 'occupied palestinian territory',
        'ivory coast', "cote d'ivoire", 'côte d’ivoire', "côte d'ivoire",
        'cape verde', 'cabo verde',
        'south korea', 'republic of korea', 'korea south',
        'north korea', "democratic people's republic of korea",
        'czechia', 'czech republic',
        'myanmar (burma)', 'burma',
        'russia', 'russian federation',
        'syria', 'syrian arab republic',
        'iran', 'islamic republic of iran',
        'venezuela', 'bolivarian republic of venezuela',
        'tanzania', 'united republic of tanzania',
        'moldova', 'republic of moldova',
        'bolivia', 'plurinational state of bolivia',
        'micronesia', 'federated states of micronesia',
        'laos', "lao people's democratic republic",
        'vietnam', 'viet nam',
        'taiwan', 'chinese taipei', 'republic of china',
        'turkiye', 'türkiye', 'turkey',
        'eswatini', 'kingdom of eswatini',
        'tanzania', 'tz',
        // Common spelling variants
        'philippine', 'phillippines',
        'srilanka', 'sri lanka',
        'newzealand', 'new zealand',
        'southafrica', 'south africa',
        'saudiarabia', 'saudi arabia',
        // Surfaced by tag-inventory diagnostic
        'azerbaidjan',                        // old French spelling
        'american samoa', 'aland islands', 'antarctica',
        'cocos islands', 'christmas island', 'falkland islands',
        'french southern territories', 'south georgia',
        'svalbard', 'jan mayen', 'norfolk island',
        'pitcairn', 'saint barthelemy', 'saint martin', 'sint maarten',
        'saint pierre and miquelon', 'tokelau', 'wallis and futuna',
        'british virgin islands', 'us virgin islands',
        'cayman islands', 'turks and caicos islands',
        'isle of man', 'jersey', 'guernsey', 'faroe islands',
        'new caledonia', 'french polynesia', 'mayotte', 'reunion',
        'martinique', 'guadeloupe', 'french guiana',
        'bermuda', 'anguilla', 'montserrat',
    ];

    // Normalise the same way we normalise tags (hyphens/underscores → space,
    // lowercase, accent strip) so the lookup set and tag inputs always agree.
    function _normaliseName(s) {
        return String(s || '')
            .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip accents (curaçao → curacao)
            .toLowerCase()
            .replace(/[-_]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    let _countryNameSet = null;
    function _getCountryNameSet() {
        if (_countryNameSet) return _countryNameSet;
        _countryNameSet = new Set();
        const add = (name) => { const n = _normaliseName(name); if (n) _countryNameSet.add(n); };
        if (typeof window !== 'undefined' && window.COUNTRY_CODE_MAP) {
            for (const name of Object.values(window.COUNTRY_CODE_MAP)) add(name);
            // ISO 3166-1 alpha-2 codes themselves (so a tag "us" / "in" matches)
            for (const code of Object.keys(window.COUNTRY_CODE_MAP)) add(code);
        }
        for (const name of _EXTRA_COUNTRY_NAMES) add(name);
        // Additional countries / territories / variants surfaced by tag inventory
        [
            'brunei darussalam', 'kyrgystan',                                     // typo of kyrgyzstan
            'saint vincent and grenadines',                                       // missing 'the'
            'british indian ocean territory', 'northern mariana islands',
            'virgin islands us', 'virgin islands british',                        // word-order variants
            'us virgin islands', 'british virgin islands',
            'turkmenistan', 'bonaire',
            'curacao',                                                            // already normalised (accent stripped)
            'guinea bissau',                                                      // hyphen→space form
            'timor leste',                                                        // hyphen→space form
        ].forEach(add);
        return _countryNameSet;
    }

    const _GENDERS = new Set(['male', 'female', 'non binary', 'nonbinary', 'genderqueer',
        'prefer not to say', 'rather not say', 'other gender']);
    // Canonical labels so tag-derived values match the signup-survey importer
    // ("Female"/"Male"/"Prefer not to say"), not raw kebab tags.
    function _canonicalGender(norm) {
        if (norm === 'male') return 'Male';
        if (norm === 'female') return 'Female';
        if (norm === 'non binary' || norm === 'nonbinary' || norm === 'genderqueer') return 'Non-binary';
        return 'Prefer not to say';
    }
    // Organisation type — the signup survey asks "What type of organisation are
    // you affiliated with?" and LearnWorlds slugifies chosen answers into kebab
    // tags (same mechanism as career-stage/activity tags). Normalized
    // (kebab→space) tag → canonical answer label as it appears in the survey.
    const _ORG_TYPES = {
        'government national': 'Government - National',
        'government state': 'Government - State',
        'government local': 'Government - Local',
        'academia': 'Academia',
        'private sector': 'Private Sector',
        'ngo': 'NGO',
        'non governmental organisation': 'NGO',
        'non governmental organization': 'NGO',
        'regional organization': 'Regional organization',
        'regional organisation': 'Regional organization',
        'international organization non un': 'International organization (non UN)',
        'international organisation non un': 'International organization (non UN)',
        'international organization': 'International organization (non UN)',
        'international organisation': 'International organization (non UN)',
        'un un system': 'UN/UN System',
        'un system': 'UN/UN System',
        'un un system locally recruited': 'UN/UN System (locally recruited)'
    };
    // Career stage / education level. SURGhub uses tags like 'in-practice',
    // 'postgraduate-clinical', 'medical-student' to mark where a learner is.
    // These all normalize via hyphen→space (handled below) so we just list the
    // normalized forms here.
    const _EDUCATION = new Set([
        'undergraduate', 'undergrad', 'postgraduate', 'postgrad',
        'graduate', 'phd', 'masters', 'doctorate', 'high school', 'student',
        'in practice', 'postgraduate clinical', 'postgraduate academic',
        'medical student', 'nursing student', 'retired'
    ]);
    const _PROFESSION_KEYWORDS = [
        'surgeon', 'anaesthetist', 'anesthetist', 'anaesthesiologist', 'anesthesiologist',
        'anesthesiology', 'anaesthesiology', 'anaesthesia technician', 'anesthesia technician',
        'nurse', 'nursing', 'physician', 'medical officer',
        'obstetrician', 'gynaecologist', 'gynecologist', 'paramedic', 'pharmacist',
        'midwife', 'midwifery', 'dentist', 'dental', 'physiotherapist', 'physical therapist',
        'researcher', 'public health', 'clinical officer', 'medical technician',
        'radiographer', 'radiologist', 'paediatrician', 'pediatrician', 'oncologist',
        'cardiologist', 'urologist', 'orthopaedic', 'orthopedic', 'neurosurgeon',
        'gp', 'general practitioner', 'intern', 'resident', 'consultant',
        'health worker', 'healthcare worker', 'community health', 'biomedical engineer',
        'medical doctor', 'doctor', 'emergency medicine', 'non clinical'
    ];

    // Map a normalized country string → clean canonical name. Prefer the
    // ISO-code map's official name (so "drc" → "DR Congo"); otherwise Title-Case
    // the normalized words ("united states" → "United States").
    function _canonicalCountry(normalized) {
        if (typeof window !== 'undefined' && window.countryToISO && window.COUNTRY_CODE_MAP) {
            const iso = window.countryToISO(normalized);
            if (iso && window.COUNTRY_CODE_MAP[iso]) return window.COUNTRY_CODE_MAP[iso];
        }
        // Title-case fallback, with small-word handling
        const small = new Set(['of', 'and', 'the']);
        return normalized.split(' ').map((w, i) =>
            (i > 0 && small.has(w)) ? w : (w.charAt(0).toUpperCase() + w.slice(1))
        ).join(' ');
    }

    // Campaign / segment / partner-org / tracking tags — not demographic,
    // should be ignored. Match against the RAW (pre-normalisation) tag because
    // they often have mixed-case prefixes like "Ambassador_*" or "Friend_*".
    const _PARTNER_ORG_TAGS = new Set([
        // Surfaced by tag-inventory diagnostic — partner organisations,
        // training-cohort labels, course-cohort labels. Not demographic data.
        'smile_train', 'smile train', 'resurge', 'rcsi', 'unitar', 'gsf',
        'allsafe', 'cnis', 'gulu', 'pen-program', 'pen program',
        'batch 2', 'batch 1', 'batch 3'
    ]);
    function _isCampaignTag(raw) {
        if (!raw) return false;
        const lower = raw.toLowerCase();
        return (
            /^ambassador[_\s]/i.test(raw) ||
            /^clicked[_\s]/i.test(raw) ||
            /^oss/i.test(raw) ||                      // OSSNakuru, OSS leadership, ossc
            /^safe\s?cs/i.test(raw) ||                // Safe CS Kano
            /^friend[_\s]/i.test(raw) ||              // Friend_Student
            /^cours[:\s]/i.test(raw) ||               // "Cours: Management des soins infirmiers"
            /^informedconsent$/i.test(raw) ||
            /^self$/i.test(raw) ||
            _PARTNER_ORG_TAGS.has(lower)
        );
    }

    function _classifyTag(tag) {
        if (!tag || typeof tag !== 'string') return null;
        const raw = tag.trim();
        if (!raw) return null;

        // 0. Campaign / segment tags — skip entirely (return null = ignored).
        if (_isCampaignTag(raw)) return null;

        // Normalize for matching using the same function as the country set.
        // LearnWorlds uses kebab-case for many tags (e.g. "united-states",
        // "medical-student", "anaesthesia-technician"); the normaliser also
        // strips accents so "curaçao" → "curacao".
        const t = _normaliseName(raw);
        if (!t) return null;

        // 1. Country (strict — must match the canonical / extended set).
        //    Emit a clean Title-Case canonical name (NOT the raw kebab tag) so
        //    breakdowns read "United States" not "united-states", and conflict-
        //    country matching works.
        if (_getCountryNameSet().has(t)) return { type: 'country', value: _canonicalCountry(t) };

        // 2. Gender — plain ('female'), prefixed ('gender-female'), or the
        //    full survey answer ('i-prefer-not-to-disclose-my-gender').
        if (_GENDERS.has(t)) return { type: 'gender', value: _canonicalGender(t) };
        const gm = t.match(/^(?:gender|sex) (.+)$/);
        if (gm && _GENDERS.has(gm[1])) return { type: 'gender', value: _canonicalGender(gm[1]) };
        if (t.includes('gender') && /prefer not to (say|disclose|share)/.test(t)) {
            return { type: 'gender', value: 'Prefer not to say' };
        }

        // 3. Organisation type (exact survey-answer tags, e.g. 'government-national')
        if (Object.prototype.hasOwnProperty.call(_ORG_TYPES, t)) {
            return { type: 'org', value: _ORG_TYPES[t] };
        }

        // 4. Education / career stage
        if (_EDUCATION.has(t)) return { type: 'education', value: raw };

        // 5. Profession (substring match against normalized keyword list)
        for (const kw of _PROFESSION_KEYWORDS) {
            if (t === kw || t.includes(kw)) return { type: 'profession', value: raw };
        }

        // 6. Unmatched → specialty/interest (e.g. "surgery", "obstetrics", "research")
        return { type: 'specialty', value: raw };
    }

    // Flatten a /v2/users record into a CSV-row-shape so the existing
    // runAudienceAggregation heuristics work. We unwrap custom_fields and
    // extras into top-level keys, and add common aliases for date/signup.
    function _flattenUser(u) {
        const flat = Object.assign({}, u);
        // Unwrap nested fields commonly used by LearnWorlds for custom data
        const nested = u.custom_fields || u.extras || u.fields || u.profile_fields || null;
        if (nested) {
            if (Array.isArray(nested)) {
                // [{field_id|name, value}, ...]
                for (const f of nested) {
                    const key = f && (f.name || f.field_name || f.label || f.field_id || f.id);
                    const val = f && (f.value != null ? f.value : f.val);
                    if (key && val != null) flat[String(key)] = val;
                }
            } else if (typeof nested === 'object') {
                // {field_name: value, ...}
                for (const [k, v] of Object.entries(nested)) {
                    if (v != null) flat[k] = v;
                }
            }
        }
        // Provide signup-date aliases — the aggregator's heuristic checks
        // multiple column names; this guarantees at least one will match.
        // Normalise epoch-seconds → ISO so downstream parsers handle it.
        const rawSignup = u.created || u.created_at || u.registered || u.signup_date || u.joined_at || '';
        const signup = _normaliseLwDate(rawSignup);
        if (signup) {
            flat.signup = signup;
            flat['Signup date'] = signup;
            flat.signup_date = signup;
        }

        // Tag-based demographics. SURGhub puts country/profession/gender into
        // user tags (no labels). Classify each, then set named keys matching
        // what the CSV-path aggregator's column heuristic looks for.
        if (Array.isArray(u.tags) && u.tags.length > 0) {
            const specialties = [];
            for (const tag of u.tags) {
                const cls = _classifyTag(tag);
                if (!cls) continue;
                // Inventory: track frequency of each classification across the
                // whole user base so we can surface unmatched tags later.
                _tagInventory.classified[cls.type] = (_tagInventory.classified[cls.type] || 0) + 1;
                if (cls.type === 'specialty') {
                    _tagInventory.specialtyCounts[tag] = (_tagInventory.specialtyCounts[tag] || 0) + 1;
                }
                if (cls.type === 'country') {
                    // Aggregator looks for keys containing "country of nationality"
                    // or "currently based" — set both so either heuristic catches it.
                    if (!flat['Country of Nationality']) flat['Country of Nationality'] = cls.value;
                    if (!flat['currently based']) flat['currently based'] = cls.value;
                    if (!flat['country']) flat['country'] = cls.value;
                } else if (cls.type === 'profession') {
                    // Key must contain "describes your activity" per the heuristic
                    if (!flat['Question: which describes your activity']) {
                        flat['Question: which describes your activity'] = cls.value;
                    }
                    if (!flat['profession']) flat['profession'] = cls.value;
                } else if (cls.type === 'gender') {
                    if (!flat['Gender']) flat['Gender'] = cls.value;
                    if (!flat['gender']) flat['gender'] = cls.value;
                } else if (cls.type === 'org') {
                    // Anon-user builder finds the key containing "organisation"
                    if (!flat['organisation_type']) flat['organisation_type'] = cls.value;
                } else if (cls.type === 'education') {
                    if (!flat['education']) flat['education'] = cls.value;
                } else if (cls.type === 'specialty') {
                    specialties.push(cls.value);
                }
            }
            if (specialties.length > 0) flat['specialties'] = specialties.join(', ');
            // Stash full tag list for engagement analysis / future use
            flat._tags_raw = u.tags.join(', ');
        }

        return flat;
    }

    // ── Total historical lead count (Option A: filter probe) ──────────────
    // Tries several /v2/users filter variants. A filter is accepted iff it
    // returns a totalItems STRICTLY LESS than the unfiltered total (49,865 for
    // SURGhub). Equal-to-unfiltered means the param was silently ignored.
    async function fetchTotalLeadCount() {
        // Establish the unfiltered baseline
        const baseline = await _apiGet('/users', { items_per_page: 1, page: 1 });
        const totalUsers = (baseline && baseline.meta && baseline.meta.totalItems) || 0;
        if (!totalUsers) return { count: null, totalUsers: 0, method: 'baseline-failed' };

        const variants = [
            // Filter by has-referrer
            { is_lead: 'true' },
            { has_referrer: 'true' },
            { referred: 'true' },
            { source: 'referral' },
            // referrer_id with wildcard-ish values
            { referrer_id: '*' },
            { referrer_id: 'notnull' },
            { referrer_id: 'any' },
            { 'referrer_id[ne]': 'null' },
            { 'referrer_id[exists]': 'true' },
        ];

        for (const filter of variants) {
            const filterName = Object.keys(filter)[0] + '=' + filter[Object.keys(filter)[0]];
            try {
                const params = Object.assign({ items_per_page: 1, page: 1 }, filter);
                const r = await _apiGet('/users', params);
                const n = (r && r.meta && r.meta.totalItems);
                if (typeof n !== 'number') {
                    console.log(`[LearnWorlds] Lead-filter "${filterName}" — no totalItems in response`);
                    continue;
                }
                if (n === totalUsers) {
                    console.log(`[LearnWorlds] Lead-filter "${filterName}" silently ignored (returned full ${n})`);
                    continue;
                }
                if (n === 0) {
                    console.log(`[LearnWorlds] Lead-filter "${filterName}" returned 0 — likely wrong syntax`);
                    continue;
                }
                // Filter accepted! n is in (0, totalUsers)
                console.log(`[LearnWorlds] ✓ Lead-filter "${filterName}" accepted: ${n.toLocaleString()} of ${totalUsers.toLocaleString()} users`);
                return { count: n, totalUsers, method: filterName };
            } catch (e) {
                console.log(`[LearnWorlds] Lead-filter "${filterName}" errored: ${e.message.slice(0, 80)}`);
            }
            await _sleep(REQ_DELAY_MS);
        }
        return { count: null, totalUsers, method: 'no-filter-accepted' };
    }

    // ── Capability probe ────────────────────────────────────────────────────
    // One-shot discovery: hit a curated list of likely-useful endpoints and
    // report what exists on this plan, what they count, and what fields they
    // expose. Lets us redesign the import flow around the real shape of the
    // API (which is user-centric) rather than the CSV-export model.
    async function probeCapabilities(onProgress) {
        _aborted = false;
        // First we need a real user_id to probe the user-scoped endpoints
        let firstUserId = null;
        const results = [];

        async function probe(name, path, params) {
            if (onProgress) onProgress(name);
            const c = await getCredentials();
            const base = _resolveBaseUrl(c);
            const qs = params ? '?' + new URLSearchParams(params).toString() : '';
            const url = `${base}${path}${qs}`;
            const headers = {
                'Authorization': `Bearer ${c.apiToken}`,
                'Lw-Client': c.clientId,
                'Accept': 'application/json'
            };
            const res = await electronAPI.invoke('http-request', { url, method: 'GET', headers });
            const entry = { name, path, status: res.statusCode, error: null, totalItems: null, sampleKeys: null, sampleRecord: null };
            if (res.error) {
                entry.error = res.error;
                results.push(entry);
                return entry;
            }
            if (res.statusCode < 200 || res.statusCode >= 300) {
                entry.error = (res.body || '').slice(0, 200);
                results.push(entry);
                return entry;
            }
            try {
                const j = JSON.parse(res.body);
                entry.totalItems = (j && j.meta && j.meta.totalItems) != null ? j.meta.totalItems : null;
                const sample = (j && j.data && j.data[0]) || (Array.isArray(j) ? j[0] : null) || (typeof j === 'object' && !j.data ? j : null);
                if (sample && typeof sample === 'object') {
                    entry.sampleKeys = Object.keys(sample);
                    entry.sampleRecord = sample;
                }
            } catch (e) {
                entry.error = 'non-JSON: ' + (res.body || '').slice(0, 150);
            }
            results.push(entry);
            await _sleep(REQ_DELAY_MS);
            return entry;
        }

        // Phase 1: global-scope endpoints (cheap, single call each)
        const usersR = await probe('users (global)', '/users', { items_per_page: 1, page: 1 });
        if (usersR.sampleRecord && usersR.sampleRecord.id) firstUserId = usersR.sampleRecord.id;

        await probe('certificates (global)',   '/certificates',  { items_per_page: 1, page: 1 });
        await probe('enrollments (global)',    '/enrollments',   { items_per_page: 1, page: 1 });
        await probe('affiliates',              '/affiliates',    { items_per_page: 1, page: 1 });
        await probe('assessments',             '/assessments',   { items_per_page: 1, page: 1 });
        await probe('reports root',            '/reports');
        await probe('social posts',            '/social/posts',  { items_per_page: 1, page: 1 });
        await probe('social comments',         '/social/comments', { items_per_page: 1, page: 1 });
        await probe('usersegments',            '/usersegments',  { items_per_page: 1, page: 1 });
        await probe('forms',                   '/forms',         { items_per_page: 1, page: 1 });
        await probe('orders',                  '/orders',        { items_per_page: 1, page: 1 });

        // Phase 2: user-scoped endpoints (needs a real user id)
        if (firstUserId) {
            const enc = encodeURIComponent(firstUserId);
            await probe(`users/{id} detail`,      `/users/${enc}`);
            await probe(`users/{id}/courses`,     `/users/${enc}/courses`, { items_per_page: 1, page: 1 });
            await probe(`users/{id}/certificates`, `/users/${enc}/certificates`, { items_per_page: 1, page: 1 });
            await probe(`users/{id}/progress`,    `/users/${enc}/progress`, { items_per_page: 1, page: 1 });
        }

        // Render a compact summary to the console
        console.group('[LearnWorlds Probe] Capability summary');
        const summaryLines = [];
        for (const r of results) {
            const tick = r.error ? '✗' : '✓';
            const count = r.totalItems != null ? ` (${r.totalItems.toLocaleString()} items)` : '';
            const detail = r.error ? ` — ${r.error.slice(0, 100)}` : (r.sampleKeys ? ` — keys: [${r.sampleKeys.slice(0, 12).join(', ')}${r.sampleKeys.length > 12 ? ', …' : ''}]` : '');
            const line = `${tick} ${r.name.padEnd(28)} ${String(r.status).padEnd(5)}${count}${detail}`;
            summaryLines.push(line);
            console.log(line);
        }
        console.groupEnd();
        console.log('[LearnWorlds Probe] Full results object (right-click → Copy Object):', results);
        return { results, summary: summaryLines.join('\n') };
    }

    return {
        getCredentials,
        setCredentials,
        hasCredentials: () => getCredentials().then(hasCredentials),
        testConnection,
        fetchAllCourses,
        fetchCourseFoundation,
        fetchAmbassadorLeads,
        fetchTotalLeadCount,
        fetchAffiliateIds,
        classifyTag: _classifyTag,
        fetchAllUsers,
        fetchDeepProgress,
        fetchAllCertificates,
        fetchCourseTimelines,
        probeCapabilities,
        startRawPull,
        finishRawPull,
        captureRawArtifact,
        readLatestArtifactRows,
        // Reconstruct the flattened usersJson from captured raw /users page bodies —
        // the SAME _flattenUser the live fetch applies, so re-deriving the audience
        // snapshot from raw uses the identical pipeline (faithful by construction).
        flattenUsersFromRawPages: (pageBodies) => {
            const out = [];
            for (const body of (pageBodies || [])) { const rows = (body && body.data) || []; for (const u of rows) out.push(_flattenUser(u)); }
            return out;
        },
        abort
    };
})();
