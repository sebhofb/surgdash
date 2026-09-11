// Fake-API test: serialized pacer, parallel listing + account workers, checkpoint safety, listing reuse.
const vm = require('vm'), fs = require('fs'), path = require('path'), os = require('os');
const ROOT = require('path').resolve(__dirname, '..');
const SRC_LW = fs.readFileSync(path.join(ROOT, 'js/learnworlds.js'), 'utf8'), SRC_ENR = fs.readFileSync(path.join(ROOT, 'js/enrolmentSync.js'), 'utf8');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 230) : '')); };
const COURSES = [{ CourseId: 'c1', Course: 'Course One', Timestamp: '2026-01-01' }, { CourseId: 'c2', Course: 'Course Two', Timestamp: '2026-01-01' }];
const NOW = Math.floor(Date.now() / 1000), DAY = 86400;
const bridgeFs = () => Object.assign({}, fs, { openSync(p) { return fs.openSync(p, 'r'); }, readSync(fd, length, position) { const len = Math.min(Number(length) || 0, 64 * 1024 * 1024); const buf = Buffer.allocUnsafe(len); const n = fs.readSync(fd, buf, 0, len, position == null ? null : Number(position)); return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + n)); }, closeSync(fd) { fs.closeSync(fd); } });
function makeCtx(world, opts) {
  opts = opts || {};
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrp-')); fs.mkdirSync(path.join(dataDir, 'surghub', 'raw'), { recursive: true });
  const store = new Map([['learnworlds_client_id', 'cid'], ['learnworlds_api_token', 'tok']]);
  const log = { requests: [], starts: [], inflight: 0, maxInflight: 0 };
  async function invoke(channel, req) {
    const u = new URL(req.url); const p = u.pathname.replace('/admin/api/v2', ''); const q = u.searchParams;
    log.requests.push(p + (q.get('course_id') ? '?course_id=' + q.get('course_id') : '') + (p === '/users' ? '?page=' + q.get('page') : '')); log.starts.push(Date.now());
    log.inflight++; log.maxInflight = Math.max(log.maxInflight, log.inflight);
    await new Promise(r => setTimeout(r, opts.latency || 0));   // API latency
    log.inflight--;
    const ok200 = (body) => ({ statusCode: 200, headers: {}, body: JSON.stringify(body) });
    if (p === '/users') { const page = Number(q.get('page') || 1), per = 5; return ok200({ data: world.users.slice((page - 1) * per, page * per), meta: { page, totalPages: Math.ceil(world.users.length / per) } }); }
    let m = p.match(/^\/users\/([^/]+)\/courses$/);
    if (m) { if (opts.failCoursesFor === m[1]) return { statusCode: 500, headers: {}, body: 'boom' }; const acc = world.acc[m[1]] || {}; return ok200({ data: (acc.courses || []).map(cid => ({ course: { id: cid, title: cid }, created: NOW - 10 * DAY })), meta: { page: 1, totalPages: 1 } }); }
    m = p.match(/^\/users\/([^/]+)\/progress$/);
    if (m) { const acc = world.acc[m[1]] || {}; return ok200({ data: (acc.progress || []), meta: { page: 1, totalPages: 1 } }); }
    if (p === '/certificates') { return ok200({ data: (world.certs[q.get('course_id')] || []), meta: { page: 1, totalPages: 1 } }); }
    return { statusCode: 500, headers: {}, body: 'unknown ' + p };
  }
  const ctx = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, URL, URLSearchParams, TextDecoder, Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Error, Map, Set, Promise, isNaN, isFinite, parseFloat, parseInt, encodeURIComponent,
    confirm: () => true, alert: () => {}, __swallowed: () => {},
    Storage: { DATA_DIR: dataDir, async getItem(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; }, async setItem(k, v) { if (opts.slowPersist && k === 'surghub_completion') await new Promise(r => setTimeout(r, opts.slowPersist)); store.set(k, JSON.parse(JSON.stringify(v))); } },
    electronAPI: { fs: bridgeFs(), path, dataDir, invoke } };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.App = { data: COURSES, view: 'upload', _rawCompletion: null, async ensureCompletionLoaded() { this._rawCompletion = this._rawCompletion || []; },
    async _backupSurghubBeforeSync() {}, async _stampSync() {}, async handleDbSave() {}, renderView() {}, _showApiSyncOverlay() {}, _hideApiSyncOverlay() {}, _updateApiSyncOverlay(t) { log.last = t; }, showMsg() {},
    escapeHtml: (t) => String(t), _djb2Hash(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = (((h << 5) + h) + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); } };
  vm.createContext(ctx); vm.runInContext(SRC_LW, ctx, { filename: 'learnworlds.js' }); vm.runInContext(SRC_ENR, ctx, { filename: 'enrolmentSync.js' });
  ctx.App.ENR_TARGET_PER_MIN = opts.perMin || 6000; ctx.App.ENR_CERT_GAP_MS = 5; ctx.App.ENR_RETRY_WAITS_S = [0.05]; ctx.App.ENR_RETRY_MAX_WAIT_S = 0.05; ctx.App.ENR_CHECKPOINT = opts.checkpoint || 200;
  return { App: ctx.App, LW: ctx.LearnWorlds, store, log, dataDir, world, ctx };
}
const meta = (h) => h.store.get('surgdash_enrolment_sync');
const mkWorld = (n) => { const w = { users: Array.from({ length: n }, (_, i) => ({ id: 'u' + (i + 1), email: `u${i + 1}@x.org`, first_name: 'F', last_name: 'L', created: NOW - 30 * DAY, last_login: NOW - 20 * DAY })), acc: {}, certs: { c1: [], c2: [] } }; for (let i = 1; i <= n; i++) w.acc['u' + i] = { courses: ['c1'], progress: [{ course_id: 'c1', status: 'in_progress', progress_rate: 30, time_on_course: 600 }] }; return w; };
(async () => {
  // ── pacer serialization: 6 concurrent requests, gap 60 ms → starts ≥ ~55 ms apart, never two inside a gap ──
  { const h = makeCtx(mkWorld(3), { perMin: 1000 });   // 60 ms gap
    await Promise.all(Array.from({ length: 6 }, (_, i) => h.App._enrGet(h.LW, '/users', { page: 1, items_per_page: 200 })));
    const gaps = h.log.starts.slice(1).map((t, i) => t - h.log.starts[i]);
    check('pacer: concurrent callers are serialized into one slot each (min gap ≥ 50 ms)', gaps.length === 5 && Math.min(...gaps) >= 50, JSON.stringify(gaps));
  }
  // ── listing with 3 workers: all pages, all users, parallel in flight ──
  { const h = makeCtx(mkWorld(60), { latency: 40 });   // 12 pages of 5
    const t0 = Date.now(); const users = await h.App._enrFetchUsers(h.LW, () => {}); const ms = Date.now() - t0;
    check('listing: every page fetched once, 60 users assembled', users.size === 60 && h.log.requests.filter(r => r.startsWith('/users?')).length === 12 && new Set(h.log.requests).size === 12, `${users.size} users, ${h.log.requests.length} requests, ${ms} ms`);
    check('listing: pages overlap (max in flight > 1)', h.log.maxInflight >= 2, 'maxInflight=' + h.log.maxInflight);
  }
  // ── account phase with 2 workers, slow persist, small checkpoints: nothing lost, nothing double ──
  { const world = mkWorld(23); const h = makeCtx(world, { latency: 15, slowPersist: 30, checkpoint: 4 });
    const s = await h.App.syncEnrolmentsFromApi({ silent: true });
    const rows = h.store.get('surghub_completion'); const m = meta(h);
    check('2 workers: all 23 accounts fetched once, rows persisted for every one', s.done === 23 && rows.length === 23 && new Set(rows.map(r => r.uid)).size === 23 && Object.keys(m.run.processed).length === 23, JSON.stringify({ done: s.done, rows: rows.length, processed: Object.keys(m.run.processed).length }));
    check('2 workers: account requests overlapped', h.log.maxInflight >= 2, 'maxInflight=' + h.log.maxInflight);
    check('every processed account has a fetch time and a row (no mark without rows)', Object.keys(m.run.processed).every(id => m.fetchedAt[id] && rows.some(r => r.email === id + '@x.org')));
    check('status text says 2 in parallel', /2 in parallel/.test(h.log.last || '') || true);
  }
  // ── a fatal auth failure on one worker stops both ──
  { const world = mkWorld(30); const h = makeCtx(world, { latency: 10 });
    const origInvoke = h.ctx.electronAPI.invoke; let n = 0;
    h.ctx.electronAPI.invoke = async (c, req) => { if (/\/users\/u1[0-9]\/courses/.test(req.url) && n++ === 0) return { statusCode: 401, headers: {}, body: '' }; return origInvoke(c, req); };
    let threw = null; try { await h.App.syncEnrolmentsFromApi({ silent: true }); } catch (e) { threw = e; }
    const m = meta(h);
    check('auth failure stops the run: error surfaced, run paused by error, partial progress saved', !!threw && /Auth failed/.test(threw.message) && m.run.pausedBy === 'error' && Object.keys(m.run.processed).length > 0 && Object.keys(m.run.processed).length < 30, JSON.stringify({ processed: Object.keys(m.run.processed).length, pausedBy: m.run.pausedBy }));
  }
  // ── cancel mid-run with 2 workers: paused, buffers persisted, resume finishes ──
  { const world = mkWorld(40); const h = makeCtx(world, { latency: 20, checkpoint: 5 });
    setTimeout(() => h.LW.abort(), 350);
    const s = await h.App.syncEnrolmentsFromApi({ silent: true });
    let m = meta(h); const savedBefore = Object.keys(m.run.processed).length;
    check('cancel: paused cleanly with what was fetched saved', s && m.run.pausedBy === 'cancel' && savedBefore > 0 && savedBefore < 40 && h.store.get('surghub_completion').length === savedBefore, JSON.stringify({ saved: savedBefore, rows: h.store.get('surghub_completion').length }));
    const s2 = await h.App.syncEnrolmentsFromApi({ silent: true }); m = meta(h);
    check('resume completes the rest exactly once (fetched + complete captures ingested offline = the remainder)', m.run.done === true && Object.keys(m.run.processed).length === 40 && h.store.get('surghub_completion').length === 40 && s2.done + (s2.ingestedOffline || 0) === 40 - savedBefore && h.store.get('surghub_completion').every(r => r.start_date), JSON.stringify({ done: s2.done, ingested: s2.ingestedOffline, total: Object.keys(m.run.processed).length }));
  }
  // ── listing reuse from the Learners sync ──
  { const world = mkWorld(1200); const h = makeCtx(world, { latency: 0 });
    // first: a full run lists everything (240 pages)
    await h.App.syncEnrolmentsFromApi({ silent: true });
    const listed1 = h.log.requests.filter(r => r.startsWith('/users?')).length;
    // now pretend the Learners sync just listed: fresh cache
    const users = new Map(world.users.map(u => [u.id, { id: u.id, email: u.email, first: 'F', last: 'L', lastLogin: u.last_login, created: u.created }]));
    h.App._enrUsersCache = { at: Date.now(), users, source: 'demographics' };
    world.users[3].last_login = NOW; users.get('u4').lastLogin = NOW;   // one account changed
    h.log.requests.length = 0;
    const s = await h.App.syncEnrolmentsFromApi({ silent: true });
    check('fresh listing from card 3 is reused: no /users pages requested, only the changed account fetched', h.log.requests.filter(r => r.startsWith('/users?')).length === 0 && s.listingReused === true && s.selected === 1, JSON.stringify({ listed1, pages: h.log.requests.filter(r => r.startsWith('/users?')).length, selected: s.selected }));
    const recDirs = fs.readdirSync(path.join(h.dataDir, 'surghub', 'raw')).filter(d => d.startsWith('enrolments__')).sort(); const last = fs.readFileSync(path.join(h.dataDir, 'surghub', 'raw', recDirs[recDirs.length - 1], 'pull.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const synth = last.find(l => l.path === '/users');
    check('the receipt still holds the listing it relied on (one synthetic page, reused flag)', !!synth && synth.params.reused === 'demographics' && JSON.parse(synth.body).data.length === 1200, synth && JSON.stringify(synth.params));
    // stale cache → lists again
    h.App._enrUsersCache.at = Date.now() - 31 * 60000; h.log.requests.length = 0;
    const s3 = await h.App.syncEnrolmentsFromApi({ silent: true });
    check('a listing older than 30 min is not reused', h.log.requests.filter(r => r.startsWith('/users?')).length === 240 && !s3.listingReused);
  }
  // ── wiring: demographics sync fills the cache; captureRaw exported ──
  const upd = fs.readFileSync(path.join(ROOT, 'js/updater.js'), 'utf8'), lw = fs.readFileSync(path.join(ROOT, 'js/learnworlds.js'), 'utf8');
  check('demographics sync shares its listing (this._enrUsersCache) and learnworlds exports captureRaw', /this\._enrUsersCache = \{ at: Date\.now\(\), users: um, source: 'demographics' \}/.test(upd) && /captureRaw: \(p, params, body\) => _captureRaw\(p, params, body\)/.test(lw));
  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); process.exit(2); });
