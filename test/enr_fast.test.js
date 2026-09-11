// Fake-API test of the faster incremental enrolment sync: per-account fetch times, targeted certificate walks.
const vm = require('vm'), fs = require('fs'), path = require('path'), os = require('os');
const ROOT = require('path').resolve(__dirname, '..');
const SRC_LW = fs.readFileSync(path.join(ROOT, 'js/learnworlds.js'), 'utf8'), SRC_ENR = fs.readFileSync(path.join(ROOT, 'js/enrolmentSync.js'), 'utf8');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 230) : '')); };
const COURSES = [{ CourseId: 'c1', Course: 'Course One', Timestamp: '2026-01-01' }, { CourseId: 'c2', Course: 'Course Two', Timestamp: '2026-01-01' }];
const NOW = Math.floor(Date.now() / 1000), DAY = 86400;
const bridgeFs = () => Object.assign({}, fs, {
  openSync(p) { return fs.openSync(p, 'r'); },
  readSync(fd, length, position) { const len = Math.min(Number(length) || 0, 64 * 1024 * 1024); const buf = Buffer.allocUnsafe(len); const n = fs.readSync(fd, buf, 0, len, position == null ? null : Number(position)); return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + n)); },
  closeSync(fd) { fs.closeSync(fd); },
});
function makeCtx(world) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrf-')); fs.mkdirSync(path.join(dataDir, 'surghub', 'raw'), { recursive: true });
  const store = new Map([['learnworlds_client_id', 'cid'], ['learnworlds_api_token', 'tok']]);
  const log = { requests: [] };
  async function invoke(channel, req) {
    const u = new URL(req.url); const p = u.pathname.replace('/admin/api/v2', ''); const q = u.searchParams;
    log.requests.push(p + (q.get('course_id') ? '?course_id=' + q.get('course_id') : '') + (p === '/users' ? '?page=' + q.get('page') : ''));
    const ok200 = (body) => ({ statusCode: 200, headers: {}, body: JSON.stringify(body) });
    if (p === '/users') { const page = Number(q.get('page') || 1), per = 5; return ok200({ data: world.users.slice((page - 1) * per, page * per), meta: { page, totalPages: Math.ceil(world.users.length / per) } }); }
    let m = p.match(/^\/users\/([^/]+)\/courses$/);
    if (m) { const acc = world.acc[m[1]] || {}; return ok200({ data: (acc.courses || []).map(cid => ({ course: { id: cid, title: cid }, created: NOW - 10 * DAY })), meta: { page: 1, totalPages: 1 } }); }
    m = p.match(/^\/users\/([^/]+)\/progress$/);
    if (m) { const acc = world.acc[m[1]] || {}; return ok200({ data: (acc.progress || []), meta: { page: 1, totalPages: 1 } }); }
    if (p === '/certificates') { const cid = q.get('course_id'); return ok200({ data: (world.certs[cid] || []), meta: { page: 1, totalPages: 1 } }); }
    return { statusCode: 500, headers: {}, body: 'unknown ' + p };
  }
  const ctx = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, URL, URLSearchParams, TextDecoder, Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Error, Map, Set, Promise, isNaN, isFinite, parseFloat, parseInt, encodeURIComponent,
    confirm: () => true, alert: () => {}, __swallowed: () => {},
    Storage: { DATA_DIR: dataDir, async getItem(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; }, async setItem(k, v) { store.set(k, JSON.parse(JSON.stringify(v))); } },
    electronAPI: { fs: bridgeFs(), path, dataDir, invoke } };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.App = { data: COURSES, view: 'upload', _rawCompletion: null, async ensureCompletionLoaded() { this._rawCompletion = this._rawCompletion || []; },
    async _backupSurghubBeforeSync() {}, async _stampSync() {}, async handleDbSave() {}, renderView() {}, _showApiSyncOverlay() {}, _hideApiSyncOverlay() {}, _updateApiSyncOverlay(t) { log.last = t; }, showMsg() {},
    escapeHtml: (t) => String(t), _djb2Hash(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = (((h << 5) + h) + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); } };
  vm.createContext(ctx); vm.runInContext(SRC_LW, ctx, { filename: 'learnworlds.js' }); vm.runInContext(SRC_ENR, ctx, { filename: 'enrolmentSync.js' });
  ctx.App.ENR_TARGET_PER_MIN = 6000; ctx.App.ENR_CERT_GAP_MS = 5; ctx.App.ENR_RETRY_WAITS_S = [0.05]; ctx.App.ENR_RETRY_MAX_WAIT_S = 0.05;
  return { App: ctx.App, LW: ctx.LearnWorlds, store, log, dataDir, world };
}
const meta = (h) => h.store.get('surgdash_enrolment_sync');
const users = (n, lastLogin) => Array.from({ length: n }, (_, i) => ({ id: 'u' + (i + 1), email: `u${i + 1}@x.org`, first_name: 'F', last_name: 'L', created: NOW - 30 * DAY, last_login: lastLogin }));
(async () => {
  // ── selection rule ──
  { const h = makeCtx({ users: [], acc: {}, certs: {} });
    const mk = (id, last, created) => ({ id, email: id + '@x.org', lastLogin: last, created: created || NOW - 30 * DAY });
    const fa = { a: NOW - 2 * DAY, b: NOW - 2 * DAY, c: NOW - 2 * DAY, d: NOW - 2 * DAY };
    const list = new Map([['a', mk('a', NOW - 1 * DAY)], ['b', mk('b', NOW - 3 * DAY)], ['c', mk('c', NOW - 2 * DAY - 3 * 3600)], ['d', mk('d', NOW - 10 * DAY, NOW - 1 * DAY)], ['e', mk('e', NOW - 20 * DAY)]].map(([k, v]) => [k, v]));
    const sel = h.App._enrSelectUsers(list, 'incremental', { fetchedAt: fa, run: { processed: {} } }).map(u => u.id).sort();
    check('incremental selection: logged in after fetch (a), within 6 h before fetch (c), created after fetch (d), never fetched (e); not b', sel.join(',') === 'a,c,d,e', sel.join(','));
    h.App._rawCompletion = ['a', 'b', 'c', 'd', 'e'].map(id => ({ uid: h.App._djb2Hash(id + '@x.org'), course: 'Course One' }));
    list.get('b').lastLogin = NOW - 5 * DAY;
    const selOld = h.App._enrSelectUsers(list, 'incremental', { lastRunEpoch: NOW - 1 * DAY, run: { processed: {} } }).map(u => u.id).sort();
    check('fallback (no fetch times): two-day window rule still applies', selOld.includes('a') && selOld.includes('d') && !selOld.includes('b'), selOld.join(','));
  }
  // ── full run seeds fetch times; incremental run fetches only changed accounts; certificates walked only where completions are new ──
  { const world = { users: users(12, NOW - 20 * DAY), acc: {}, certs: { c1: [{ user: { id: 'u1' }, course_id: 'c1', issued: NOW - 15 * DAY, score: 80 }], c2: [] } };
    for (let i = 1; i <= 12; i++) world.acc['u' + i] = { courses: ['c1'], progress: [{ course_id: 'c1', status: 'in_progress', progress_rate: 30, time_on_course: 600 }] };
    const h = makeCtx(world);
    const s1 = await h.App.syncEnrolmentsFromApi({ silent: true });
    let m = meta(h);
    check('full run: 12 accounts fetched, fetch time recorded per account (≈ now)', s1.done === 12 && Object.keys(m.fetchedAt).length === 12 && Object.values(m.fetchedAt).every(v => Math.abs(v - NOW) < 120), JSON.stringify({ n: Object.keys(m.fetchedAt).length, sample: Object.values(m.fetchedAt)[0], now: NOW }));
    check('full run: every course walked once for certificates (first walk), certsFullAt stamped', h.log.requests.filter(r => r.startsWith('/certificates')).length === 2 && !!m.certsFullAt && s1.certWalk === 'full', s1.certWalk);
    // day passes: u3 and u7 log in (u7 completes c1 → certificate issued); u9 is a brand-new account
    const T2 = NOW + 1 * DAY;
    h.world.users.find(u => u.id === 'u3').last_login = T2 - 8 * 3600; h.world.users.find(u => u.id === 'u7').last_login = T2 - 8 * 3600;
    h.world.acc.u7.progress = [{ course_id: 'c1', status: 'completed', progress_rate: 100, completed_at: T2 - 8 * 3600 - 100, time_on_course: 3600 }];
    h.world.certs.c1.push({ user: { id: 'u7' }, course_id: 'c1', issued: T2 - 8 * 3600, score: 90 });
    h.world.users.push({ id: 'u13', email: 'u13@x.org', first_name: 'N', last_name: 'L', created: T2 - 9 * 3600, last_login: T2 - 8 * 3600 }); h.world.acc.u13 = { courses: ['c2'], progress: [] };
    // make "now" a day later for the module's clock-based decisions by shifting the stored stamps back a day instead
    m = meta(h); for (const id of Object.keys(m.fetchedAt)) m.fetchedAt[id] -= DAY; m.certsAt = new Date((Date.parse(m.certsAt) - DAY * 1000)).toISOString(); m.certsFullAt = m.certsAt; m.lastRunEpoch -= DAY; if (m.lastFullStartedAt) m.lastFullStartedAt = new Date(Date.parse(m.lastFullStartedAt) - DAY * 1000).toISOString(); h.store.set('surgdash_enrolment_sync', m);
    h.world.users.forEach(u => { u.last_login = u.last_login - DAY; u.created = u.created - DAY; }); h.world.acc.u7.progress[0].completed_at -= DAY; h.world.certs.c1[1].issued -= DAY;
    for (const d of fs.readdirSync(path.join(h.dataDir, 'surghub', 'raw'))) { const f = path.join(h.dataDir, 'surghub', 'raw', d, 'pull.jsonl'); if (!fs.existsSync(f)) continue; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { const o = JSON.parse(l); o.t -= DAY * 1000; return JSON.stringify(o); }).join('\n') + '\n'); }
    h.log.requests.length = 0;
    const s2 = await h.App.syncEnrolmentsFromApi({ silent: true });
    const acctReqs = h.log.requests.filter(r => /^\/users\/u\d+\//.test(r)).map(r => r.split('/')[2]);
    check('incremental: only the two accounts that logged in and the new one are fetched', s2.mode === 'incremental' && s2.selected === 3 && new Set(acctReqs).size === 3 && ['u3', 'u7', 'u13'].every(id => acctReqs.includes(id)), JSON.stringify({ selected: s2.selected, ids: [...new Set(acctReqs)] }));
    const certReqs = h.log.requests.filter(r => r.startsWith('/certificates'));
    check('incremental: certificates walked only for the course with a new completion (c1), not c2', certReqs.length === 1 && certReqs[0].endsWith('course_id=c1') && s2.certWalk === 'targeted' && s2.certsNew === 1, JSON.stringify({ certReqs, walk: s2.certWalk, new: s2.certsNew }));
    const rows = h.store.get('surghub_completion'); const r7 = rows.find(r => r.email === 'u7@x.org' && r.course === 'Course One');
    check('the new certificate reaches the record of u7', r7 && r7.certificate === true && r7.certificate_score === 90, JSON.stringify(r7 && { c: r7.certificate, s: r7.certificate_score }));
    m = meta(h);
    check('fetch times refreshed for the three fetched accounts only', Math.abs(m.fetchedAt.u3 - NOW) < 120 && Math.abs(m.fetchedAt.u13 - NOW) < 120 && m.fetchedAt.u1 < NOW - DAY + 120, JSON.stringify({ u3: m.fetchedAt.u3 - NOW, u1: m.fetchedAt.u1 - NOW }));
    // nothing changed → no accounts, no certificate walk
    h.log.requests.length = 0;
    const s3 = await h.App.syncEnrolmentsFromApi({ silent: true });
    check('quiet day: no account fetched, no certificate walk', s3.selected === 0 && !h.log.requests.some(r => r.startsWith('/certificates') || /^\/users\/u/.test(r)) && s3.certWalk === 'none', JSON.stringify({ selected: s3.selected, walk: s3.certWalk }));
    // full walk due after ENR_CERT_FULL_DAYS
    m = meta(h); m.certsFullAt = new Date(Date.now() - 4 * DAY * 1000).toISOString(); h.store.set('surgdash_enrolment_sync', m); h.log.requests.length = 0;
    const s4 = await h.App.syncEnrolmentsFromApi({ silent: true });
    check('after 3+ days every course is walked again (safety net)', s4.certWalk === 'full' && h.log.requests.filter(r => r.startsWith('/certificates')).length === 2, s4.certWalk);
  }
  // ── seeding from a completed run without fetch times, sharpened by receipt times ──
  { const world = { users: users(6, NOW - 20 * DAY), acc: {}, certs: { c1: [], c2: [] } };
    for (let i = 1; i <= 6; i++) world.acc['u' + i] = { courses: ['c1'], progress: [] };
    const h = makeCtx(world);
    const started = NOW - 5 * DAY;
    h.store.set('surgdash_enrolment_sync', { run: { startedAt: new Date(started * 1000).toISOString(), mode: 'full', total: 6, processed: { u1: 1, u2: 1, u3: 1, u4: 1, u5: 1, u6: 1 }, done: true }, lastRun: new Date((NOW - 2 * DAY) * 1000).toISOString(), lastRunEpoch: NOW - 2 * DAY, certsAt: new Date((NOW - 2 * DAY) * 1000).toISOString() });
    // a receipt from that run holds exact fetch times for u1 (3 days ago) — newer than the seed
    const dir = path.join(h.dataDir, 'surghub', 'raw', 'enrolments__20260905-100000'); fs.mkdirSync(dir, { recursive: true });
    const t1 = (NOW - 3 * DAY) * 1000;
    fs.writeFileSync(path.join(dir, 'pull.jsonl'), [JSON.stringify({ t: t1 - 100, path: '/users', params: { page: 1 }, body: JSON.stringify({ data: world.users.slice(0, 6), meta: { totalPages: 1 } }) }), JSON.stringify({ t: t1, path: '/users/u1/courses', params: null, body: JSON.stringify({ data: [], meta: { totalPages: 1 } }) })].join('\n') + '\n');
    h.world.users.find(u => u.id === 'u2').last_login = NOW - 4 * DAY;   // logged in after the seed (run start) but before the last run finished → conservative seed re-fetches it
    h.world.users.find(u => u.id === 'u1').last_login = NOW - 4 * DAY;   // receipt says u1 was fetched 3 days ago, after this login → not re-fetched
    const s = await h.App.syncEnrolmentsFromApi({ silent: true });
    const acct = [...new Set(h.log.requests.filter(r => /^\/users\/u\d+\//.test(r)).map(r => r.split('/')[2]))];
    check('first incremental run on this device: seed = run start, receipt times override (u2 fetched, u1 not)', s.mode === 'incremental' && acct.includes('u2') && !acct.includes('u1'), JSON.stringify(acct));
    const m = meta(h);
    check('fetchedAt now covers every account; u1 carries the receipt time', Object.keys(m.fetchedAt).length === 6 && m.fetchedAt.u1 === Math.floor(t1 / 1000), JSON.stringify({ n: Object.keys(m.fetchedAt).length, u1: m.fetchedAt.u1, t1: Math.floor(t1 / 1000) }));
    check('certsFullAt inherited from certsAt when missing', !!m.certsFullAt);
  }
  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); process.exit(2); });
