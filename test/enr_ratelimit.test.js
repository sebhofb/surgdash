// Fake-API test: 429 handling (shared hold, Retry-After, escalation, single-file, cancel during a hold)
// and fetch-time seeding from the completed full pass.
const vm = require('vm'), fs = require('fs'), path = require('path'), os = require('os');
const ROOT = require('path').resolve(__dirname, '..');
const SRC_LW = fs.readFileSync(path.join(ROOT, 'js/learnworlds.js'), 'utf8'), SRC_ENR = fs.readFileSync(path.join(ROOT, 'js/enrolmentSync.js'), 'utf8');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };
const COURSES = [{ CourseId: 'c1', Course: 'Course One', Timestamp: '2026-01-01' }, { CourseId: 'c2', Course: 'Course Two', Timestamp: '2026-01-01' }];
const NOW = Math.floor(Date.now() / 1000), DAY = 86400;
const bridgeFs = () => Object.assign({}, fs, { openSync(p) { return fs.openSync(p, 'r'); }, readSync(fd, length, position) { const len = Math.min(Number(length) || 0, 64 * 1024 * 1024); const buf = Buffer.allocUnsafe(len); const n = fs.readSync(fd, buf, 0, len, position == null ? null : Number(position)); return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + n)); }, closeSync(fd) { fs.closeSync(fd); } });
function makeCtx(world, opts) {
  opts = opts || {};
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrr-')); fs.mkdirSync(path.join(dataDir, 'surghub', 'raw'), { recursive: true });
  const store = new Map([['learnworlds_client_id', 'cid'], ['learnworlds_api_token', 'tok']]);
  const log = { requests: [], starts: [], startInflight: [], inflight: 0, maxInflight: 0, faults: [], texts: [] };
  async function invoke(channel, req) {
    const u = new URL(req.url); const p = u.pathname.replace('/admin/api/v2', ''); const q = u.searchParams;
    const key = p + (p === '/users' ? '?page=' + q.get('page') : '') + (q.get('course_id') ? '?course_id=' + q.get('course_id') : '');
    log.requests.push(key); log.starts.push(Date.now());
    log.inflight++; log.maxInflight = Math.max(log.maxInflight, log.inflight); log.startInflight.push(log.inflight);
    await new Promise(r => setTimeout(r, opts.latency || 0));
    log.inflight--;
    if (opts.fault) { const f = opts.fault(key, log); if (f) { log.faults.push({ t: Date.now(), key }); return f; } }
    const ok200 = (body) => ({ statusCode: 200, headers: {}, body: JSON.stringify(body) });
    if (p === '/users') { const page = Number(q.get('page') || 1), per = 5; return ok200({ data: world.users.slice((page - 1) * per, page * per), meta: { page, totalPages: Math.ceil(world.users.length / per) } }); }
    let m = p.match(/^\/users\/([^/]+)\/courses$/);
    if (m) { const acc = world.acc[m[1]] || {}; return ok200({ data: (acc.courses || []).map(cid => ({ course: { id: cid, title: cid }, created: NOW - 10 * DAY })), meta: { page: 1, totalPages: 1 } }); }
    m = p.match(/^\/users\/([^/]+)\/progress$/);
    if (m) { const acc = world.acc[m[1]] || {}; return ok200({ data: (acc.progress || []), meta: { page: 1, totalPages: 1 } }); }
    if (p === '/certificates') { return ok200({ data: (world.certs[q.get('course_id')] || []), meta: { page: 1, totalPages: 1 } }); }
    return { statusCode: 500, headers: {}, body: 'unknown ' + p };
  }
  const ctx = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, URL, URLSearchParams, TextDecoder, Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Error, Map, Set, Promise, isNaN, isFinite, parseFloat, parseInt, encodeURIComponent,
    confirm: () => true, alert: () => {}, __swallowed: () => {},
    Storage: { DATA_DIR: dataDir, async getItem(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; }, async setItem(k, v) { store.set(k, JSON.parse(JSON.stringify(v))); } },
    electronAPI: { fs: bridgeFs(), path, dataDir, invoke } };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.App = { data: COURSES, view: 'upload', _rawCompletion: null, async ensureCompletionLoaded() { this._rawCompletion = this._rawCompletion || []; },
    async _backupSurghubBeforeSync() {}, async _stampSync() {}, async handleDbSave() {}, renderView() {}, _showApiSyncOverlay() {}, _hideApiSyncOverlay() {}, _updateApiSyncOverlay(t) { if (t) { log.last = t; log.texts.push(t); } }, showMsg() {},
    escapeHtml: (t) => String(t), _djb2Hash(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = (((h << 5) + h) + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); } };
  vm.createContext(ctx); vm.runInContext(SRC_LW, ctx, { filename: 'learnworlds.js' }); vm.runInContext(SRC_ENR, ctx, { filename: 'enrolmentSync.js' });
  const A = ctx.App;
  A.ENR_TARGET_PER_MIN = opts.perMin || 6000; A.ENR_CERT_GAP_MS = 5; A.ENR_RETRY_WAITS_S = [0.05]; A.ENR_RETRY_MAX_WAIT_S = 0.05; A.ENR_CHECKPOINT = opts.checkpoint || 200;
  A.ENR_HOLD_MIN_MS = opts.holdMin || 300; A.ENR_HOLD_MAX_MS = opts.holdMax || 3000; A.ENR_HOLD_REPEAT_MS = opts.holdRepeat || 5000;
  A.ENR_WORKERS = opts.workers || 1; A.ENR_LIST_WORKERS = opts.listWorkers || 2;
  return { App: A, LW: ctx.LearnWorlds, store, log, dataDir, world, ctx };
}
const meta = (h) => h.store.get('surgdash_enrolment_sync');
const mkWorld = (n) => { const w = { users: Array.from({ length: n }, (_, i) => ({ id: 'u' + (i + 1), email: `u${i + 1}@x.org`, first_name: 'F', last_name: 'L', created: NOW - 30 * DAY, last_login: NOW - 20 * DAY })), acc: {}, certs: { c1: [], c2: [] } }; for (let i = 1; i <= n; i++) w.acc['u' + i] = { courses: ['c1'], progress: [{ course_id: 'c1', status: 'in_progress', progress_rate: 30, time_on_course: 600 }] }; return w; };
const r429 = (retryAfter) => ({ statusCode: 429, headers: retryAfter != null ? { 'retry-after': String(retryAfter) } : {}, body: '' });
// requests that STARTED inside (tf + lead, tf + hold − tail)
const startsInside = (log, tf, hold, lead, tail) => log.starts.filter(t => t > tf + (lead || 30) && t < tf + hold - (tail || 30)).length;

(async () => {
  // ── 1. one 429 with two account workers: everyone holds, then single-file, run completes ──
  { let once = false; const h = makeCtx(mkWorld(30), { latency: 20, workers: 2, holdMin: 400, fault: (k) => (k === '/users/u6/courses' && !once && (once = true)) ? r429() : null });
    const s = await h.App.syncEnrolmentsFromApi({ silent: true }); const m = meta(h); const tf = h.log.faults[0].t;
    check('429: run still completes — 30 accounts fetched once, rows for every one', s.done === 30 && h.store.get('surghub_completion').length === 30 && Object.keys(m.run.processed).length === 30 && m.run.done === true, JSON.stringify({ done: s.done, rows: h.store.get('surghub_completion').length }));
    check('429: complete silence for the hold (no request starts inside the 400 ms hold)', startsInside(h.log, tf, 400) === 0, 'inside=' + startsInside(h.log, tf, 400) + ' faults=' + h.log.faults.length);
    const after = h.log.starts.map((t, i) => [t, h.log.startInflight[i]]).filter(([t]) => t > tf + 30);
    check('429: single-file afterwards (never 2 in flight after the refusal), 2 in flight before it', after.length > 10 && after.every(([, n]) => n === 1) && h.log.maxInflight === 2, JSON.stringify({ after: after.length, maxAfter: Math.max(...after.map(a => a[1])), maxBefore: h.log.maxInflight }));
    check('429: counted on the summary and the run record; rate reduced by a third', s.rateLimits === 1 && m.run.rateLimits === 1 && Math.abs(h.App._enrGapMs - 15) < 1, JSON.stringify({ s: s.rateLimits, run: m.run.rateLimits, gap: h.App._enrGapMs }));
    check('429: overlay said what is happening', h.log.texts.some(t => /rate limit — all requests paused for/.test(t)), h.log.texts.find(t => /rate limit/.test(t)));
  }
  // ── 2. Retry-After honoured (1 s > the 300 ms minimum) ──
  { let once = false; const h = makeCtx(mkWorld(8), { latency: 10, holdMin: 300, fault: (k) => (k === '/users/u3/courses' && !once && (once = true)) ? r429(1) : null });
    h.App.ENR_ROUTINE_429_S = 0;   // treat every Retry-After as the penalty box here (the routine path has its own check, 11)
    const s = await h.App.syncEnrolmentsFromApi({ silent: true }); const tf = h.log.faults[0].t; const next = h.log.starts.find(t => t > tf + 5);
    check('Retry-After 1 s (penalty path): next request ≥ ~1 s after the refusal, hold recorded as 1000 ms', s.done === 8 && next - tf >= 950 && h.App._enrHoldMs === 1000, JSON.stringify({ gap: next - tf, hold: h.App._enrHoldMs }));
  }
  // ── 3. refused again right after the hold → the next hold doubles ──
  { let n = 0; const h = makeCtx(mkWorld(8), { latency: 10, holdMin: 300, fault: (k) => (k === '/users/u3/courses' && n < 2 && ++n) ? r429() : null });
    const s = await h.App.syncEnrolmentsFromApi({ silent: true }); const [f1, f2] = h.log.faults; const next2 = h.log.starts.find(t => t > f2.t + 5);
    check('second refusal soon after a hold: hold doubled to 600 ms, run completes, 2 refusals counted', s.done === 8 && h.App._enrHoldMs === 600 && next2 - f2.t >= 560 && s.rateLimits === 2, JSON.stringify({ hold: h.App._enrHoldMs, gap2: next2 - f2.t, gap1: h.log.starts.find(t => t > f1.t + 5) - f1.t }));
  }
  // ── 4. a sibling refused during the hold extends it but does not double it ──
  { const seen = new Set(); const h = makeCtx(mkWorld(30), { latency: 60, workers: 2, holdMin: 300, fault: (k, log) => { if (k === '/users/u6/courses' && !seen.has(k)) { seen.add(k); return r429(); } if (log.faults.length === 1 && Date.now() - log.faults[0].t < 100 && !seen.has('sib')) { seen.add('sib'); return r429(); } return null; } });
    const s = await h.App.syncEnrolmentsFromApi({ silent: true });
    check('sibling refusal inside the hold: hold stays 300 ms (no doubling), run completes', s.done === 30 && h.App._enrHoldMs === 300 && s.rateLimits >= 1 && s.rateLimits <= 2, JSON.stringify({ hold: h.App._enrHoldMs, refusals: s.rateLimits }));
  }
  // ── 5. Cancel during a long hold takes effect promptly ──
  { let once = false; const h = makeCtx(mkWorld(20), { latency: 10, holdMin: 6000, fault: (k) => (k === '/users/u3/courses' && !once && (once = true)) ? r429() : null });
    const t0 = Date.now(); setTimeout(() => h.LW.abort(), 400);
    const s = await h.App.syncEnrolmentsFromApi({ silent: true }); const ms = Date.now() - t0; const m = meta(h);
    check('cancel during a 6 s hold: paused within ~1 s, not after the hold; fetched accounts saved', ms < 2500 && m.run.pausedBy === 'cancel' && Object.keys(m.run.processed).length >= 2 && h.store.get('surghub_completion').length === Object.keys(m.run.processed).length, JSON.stringify({ ms, saved: Object.keys(m.run.processed).length, by: m.run.pausedBy }));
  }
  // ── 6. listing workers: single-file after a refusal, every page still fetched ──
  { let once = false; const h = makeCtx(mkWorld(60), { latency: 30, listWorkers: 2, holdMin: 300, fault: (k) => (k === '/users?page=4' && !once && (once = true)) ? r429() : null });
    const users = await h.App._enrFetchUsers(h.LW, () => {}); const tf = h.log.faults[0].t;
    const after = h.log.starts.map((t, i) => [t, h.log.startInflight[i]]).filter(([t]) => t > tf + 30);
    check('listing: 429 on page 4 → hold, then single-file; all 12 pages, 60 users', users.size === 60 && new Set(h.log.requests).size === 12 && after.every(([, n]) => n === 1) && startsInside(h.log, tf, 300) === 0, JSON.stringify({ users: users.size, distinct: new Set(h.log.requests).size, after: after.length }));
  }
  // ── 7. throw-mode 429 at the LearnWorlds level; the default path still retries internally ──
  { const h = makeCtx(mkWorld(1)); h.ctx.electronAPI.invoke = async () => r429(7);
    let e1 = null; try { await h.LW.apiGet('/users', { page: 1 }, { rateLimit: 'throw' }); } catch (e) { e1 = e; }
    check('apiGet(rateLimit: throw): rejects at once with status 429 and Retry-After 7000 ms; classified transient + 429', !!e1 && e1.status === 429 && e1.retryAfterMs === 7000 && h.App._enrErrorKind(e1) === 'transient' && h.App._enrIs429(e1), e1 && JSON.stringify({ status: e1.status, ra: e1.retryAfterMs, msg: e1.message.slice(0, 60) }));
  }
  // ── 8. seeding: device whose full pass completed under the old bookkeeping (today's case) ──
  const seedWorld = () => { const w = mkWorld(10); w.users.find(u => u.id === 'u5').last_login = NOW - 3600; w.users.push({ id: 'u11', email: 'u11@x.org', first_name: 'N', last_name: 'L', created: NOW - 600, last_login: NOW - 500 }); w.acc.u11 = { courses: ['c2'], progress: [] }; return w; };
  const passStart = new Date((NOW - 7 * DAY - 3600) * 1000).toISOString();
  const oldMeta = (lastMode) => ({ run: { startedAt: new Date().toISOString(), mode: 'incremental', total: 0, processed: {}, done: false, sessions: 1 }, lastRun: new Date((NOW - 7 * DAY + 7200) * 1000).toISOString(), lastRunEpoch: NOW - 7 * DAY + 7200, lastMode, certsAt: new Date((NOW - 3600) * 1000).toISOString(), certsFullAt: new Date((NOW - 3600) * 1000).toISOString(), fetchedAt: {} });
  { const h = makeCtx(seedWorld(), { latency: 5 }); h.store.set('surgdash_enrolment_sync', oldMeta('full'));
    fs.writeFileSync(path.join(h.dataDir, 'surghub', 'raw', 'manifest.jsonl'), JSON.stringify({ pullId: 'demographics__20260901-120000', startedAt: new Date((NOW - 9 * DAY) * 1000).toISOString(), pages: 1, complete: true }) + '\n' + JSON.stringify({ pullId: 'enrolments__20260903-100023', startedAt: passStart, finishedAt: passStart, pages: 3, bytes: 1, complete: false }) + '\n' + JSON.stringify({ pullId: 'enrolments__20260906-234946', startedAt: new Date((NOW - 4 * DAY) * 1000).toISOString(), pages: 3, complete: true }) + '\n');
    const s = await h.App.syncEnrolmentsFromApi({ silent: true }); const m = meta(h); const ids = [...new Set(h.log.requests.filter(r => /^\/users\/u\d+\//.test(r)).map(r => r.split('/')[2]))];
    check('seeding: 10 accounts credited to the full pass, only the one that logged in since and the new one fetched', s.seeded === 10 && s.selected === 2 && ids.length === 2 && ids.includes('u5') && ids.includes('u11'), JSON.stringify({ seeded: s.seeded, selected: s.selected, ids }));
    check('seeding: full-pass start taken from the earliest enrolments pull in the manifest and remembered', m.lastFullStartedAt === passStart && m.fetchedAt.u1 === Math.floor(Date.parse(passStart) / 1000) && Math.abs(m.fetchedAt.u5 - NOW) < 120 && Math.abs(m.fetchedAt.u11 - NOW) < 120, JSON.stringify({ start: m.lastFullStartedAt, u1: m.fetchedAt.u1, u5: m.fetchedAt.u5 - NOW }));
  }
  // ── 9. no completed full pass on record → nothing seeded, fallback rule fetches everyone unknown ──
  { const h = makeCtx(seedWorld(), { latency: 5 }); h.store.set('surgdash_enrolment_sync', oldMeta('incremental'));
    fs.writeFileSync(path.join(h.dataDir, 'surghub', 'raw', 'manifest.jsonl'), JSON.stringify({ pullId: 'enrolments__20260903-100023', startedAt: passStart, pages: 3, complete: false }) + '\n');
    const s = await h.App.syncEnrolmentsFromApi({ silent: true }); const m = meta(h);
    check('no full pass on record: nothing seeded, all 11 unknown accounts fetched', !s.seeded && s.selected === 11 && !m.lastFullStartedAt, JSON.stringify({ seeded: s.seeded, selected: s.selected }));
  }
  // ── 10. a full run under the new code remembers when it began; a later incremental run leans on it ──
  { const h = makeCtx(mkWorld(6), { latency: 5 });
    const s1 = await h.App.syncEnrolmentsFromApi({ silent: true }); let m = meta(h);
    check('full run records lastFullStartedAt = run.startedAt', s1.mode === 'full' && m.lastFullStartedAt === m.run.startedAt, JSON.stringify({ start: m.lastFullStartedAt, run: m.run.startedAt }));
    // a pruned receipt: drop u2's fetch time and pretend it was never processed; it existed before the pass → credited, not fetched
    delete m.fetchedAt.u2; delete m.run.processed.u2; h.store.set('surgdash_enrolment_sync', m);
    for (const d of fs.readdirSync(path.join(h.dataDir, 'surghub', 'raw'))) { const f = path.join(h.dataDir, 'surghub', 'raw', d, 'pull.jsonl'); if (fs.existsSync(f)) fs.unlinkSync(f); }
    h.log.requests.length = 0;
    const s2 = await h.App.syncEnrolmentsFromApi({ silent: true }); m = meta(h);
    check('incremental run: the account with a lost fetch time is credited to the pass (seeded 1, fetched 0)', s2.mode === 'incremental' && s2.seeded === 1 && s2.selected === 0 && m.fetchedAt.u2 === Math.floor(Date.parse(m.lastFullStartedAt) / 1000), JSON.stringify({ seeded: s2.seeded, selected: s2.selected }));
  }
  // ── 11. /certificates: a routine 429 (Retry-After 1 s) is waited out exactly, no penalty-box escalation ──
  { let n = 0; const h = makeCtx(mkWorld(2), { latency: 5, holdMin: 300, fault: (k) => (k.startsWith('/certificates?course_id=c1') && n < 2 && ++n) ? r429(1) : null });
    h.App._enrStats = { retries: 0, slowdowns: 0, requests: 0, rateLimits: 0, pauses: 0 }; h.App._enrCertGapMs = 0; h.App._enrSingleFile = false; h.App._enrHoldMs = 0;
    const t0 = Date.now(); const r = await h.App._enrGet(h.LW, '/certificates', { course_id: 'c1', items_per_page: 20, page: 1 }); const ms = Date.now() - t0;
    check('certificate 429 ×2 (Retry-After 1 s): ~2 s each, then the page; no single-file, no penalty hold, gap widened 2×250 ms, counted as pauses', !!(r && r.data) && ms >= 3900 && ms < 6000 && h.App._enrSingleFile === false && !h.App._enrHoldMs && h.App._enrCertGapMs === 505 && h.App._enrStats.pauses === 2 && h.App._enrStats.rateLimits === 0, JSON.stringify({ ms, single: h.App._enrSingleFile, hold: h.App._enrHoldMs, gap: h.App._enrCertGapMs, pauses: h.App._enrStats.pauses, rl: h.App._enrStats.rateLimits }));
  }
  // ── 12. routine refusals on another endpoint: the ENR_ROUTINE_429_MAX-th within the window is treated as the penalty box ──
  { let n = 0; const h = makeCtx(mkWorld(3), { latency: 5, holdMin: 300, fault: (k) => (k === '/users/u1/courses' && n < 2 && ++n) ? r429(1) : null });
    h.App.ENR_ROUTINE_429_MAX = 2;
    const s = await h.App.syncEnrolmentsFromApi({ silent: true });
    check('account endpoint refused twice with a short Retry-After: first waited out (pause), second = penalty box (single-file, counted); run completes', s.done === 3 && h.App._enrSingleFile === true && s.rateLimits === 1 && h.App._enrStats.pauses === 1 && h.App._enrHoldMs === 1000, JSON.stringify({ done: s.done, single: h.App._enrSingleFile, rl: s.rateLimits, pauses: h.App._enrStats.pauses, hold: h.App._enrHoldMs }));
  }
  // ── 13. harvest: accounts already saved at/after their capture are not re-merged; an older save IS recovered ──
  { const h = makeCtx(mkWorld(6), { latency: 5 });
    const s1 = await h.App.syncEnrolmentsFromApi({ silent: true });
    h.world.users[1].last_login = NOW; const s2 = await h.App.syncEnrolmentsFromApi({ silent: true });
    let m = meta(h); m.fetchedAt.u4 -= 100; h.store.set('surgdash_enrolment_sync', m);   // u4's saved fetch now predates its capture → recovered
    const s3 = await h.App.syncEnrolmentsFromApi({ silent: true }); m = meta(h);
    check('third run: run-1 receipt (5 accounts outside the previous run\'s processed) not re-merged; only u4 recovered', s1.done === 6 && s2.selected === 1 && s3.ingestedOffline === 1 && m.run.processed.u4 === 1 && Object.keys(m.run.processed).length === 1 + s3.done, JSON.stringify({ s2sel: s2.selected, s3ing: s3.ingestedOffline, s3done: s3.done, processed: Object.keys(m.run.processed).length }));
  }
  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); process.exit(2); });
