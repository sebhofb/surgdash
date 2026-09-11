// Google Sheets sync: the real Apps Script (v3 and the previous version from git) runs in a VM
// against an in-memory Sheets model; js/sheetsSync.js runs in another VM and talks to it through
// a fake http. Covers compression, fingerprint skipping, retries, idempotent parts, legacy
// fallback, pull decisions, and value/format parity of the batched tab writers.
const vm = require('vm'), fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const ROOT = require('path').resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 300) : '')); };

// ── in-memory Google Sheets ──────────────────────────────────────────────────
function makeSheets() {
  const props = {};
  function Sheet(name) {
    this.name = name; this.cells = {}; this.merges = new Set(); this.widths = {}; this.hidden = false; this.frozen = 0;
  }
  const key = (r, c) => r + ',' + c;
  Sheet.prototype.cell = function (r, c, create) { const k = key(r, c); if (!this.cells[k] && create) this.cells[k] = { v: '', fmt: {} }; return this.cells[k]; };
  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.clearContents = function () { for (const k of Object.keys(this.cells)) this.cells[k].v = ''; return this; };
  Sheet.prototype.clearFormats = function () { for (const k of Object.keys(this.cells)) this.cells[k].fmt = {}; this.merges.clear(); return this; };
  Sheet.prototype.getLastRow = function () { let m = 0; for (const k of Object.keys(this.cells)) { const [r] = k.split(',').map(Number); if (this.cells[k].v !== '' && r > m) m = r; } return m; };
  Sheet.prototype.getLastColumn = function () { let m = 0; for (const k of Object.keys(this.cells)) { const [, c] = k.split(',').map(Number); if (this.cells[k].v !== '' && c > m) m = c; } return m; };
  Sheet.prototype.getRange = function (r, c, nr, nc) { if (nr == null) nr = 1; if (nc == null) nc = 1; return new Range(this, r, c, nr, nc); };
  Sheet.prototype.getDataRange = function () { const lr = Math.max(1, this.getLastRow()), lc = Math.max(1, this.getLastColumn()); return new Range(this, 1, 1, lr, lc); };
  Sheet.prototype.appendRow = function (vals) { const r = this.getLastRow() + 1; vals.forEach((v, i) => { this.cell(r, i + 1, true).v = v; }); return this; };
  Sheet.prototype.hideSheet = function () { this.hidden = true; return this; };
  Sheet.prototype.setColumnWidth = function (c, w) { this.widths[c] = w; return this; };
  Sheet.prototype.setColumnWidths = function (c, n, w) { for (let i = 0; i < n; i++) this.widths[c + i] = w; return this; };
  Sheet.prototype.setFrozenRows = function (n) { this.frozen = n; return this; };
  function Range(sheet, r, c, nr, nc) { this.s = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  Range.prototype.each = function (fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.r + i, this.c + j, i, j); return this; };
  Range.prototype.setValues = function (vals) {
    if (!Array.isArray(vals) || vals.length !== this.nr) throw new Error('The number of rows in the data does not match the number of rows in the range. The data has ' + (vals && vals.length) + ' but the range has ' + this.nr + '.');
    for (const row of vals) if (row.length !== this.nc) throw new Error('The number of columns in the data does not match the number of columns in the range. The data has ' + row.length + ' but the range has ' + this.nc + '.');
    return this.each((r, c, i, j) => { const v = vals[i][j]; if (typeof v === 'string' && v.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.'); this.s.cell(r, c, true).v = (v === null || v === undefined) ? '' : v; });
  };
  Range.prototype.setValue = function (v) { this.s.cell(this.r, this.c, true).v = v; return this; };
  Range.prototype.getValues = function () { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { const cell = this.s.cell(this.r + i, this.c + j); row.push(cell ? cell.v : ''); } out.push(row); } return out; };
  Range.prototype.merge = function () { this.s.merges.add(this.r + ',' + this.c + ',' + this.nr + ',' + this.nc); return this; };
  const fmtSetter = (k) => function (v) { return this.each((r, c) => { this.s.cell(r, c, true).fmt[k] = v; }); };
  const gridSetter = (k) => function (grid) { if (!Array.isArray(grid) || grid.length !== this.nr || grid.some(row => row.length !== this.nc)) throw new Error('grid size mismatch for ' + k); return this.each((r, c, i, j) => { this.s.cell(r, c, true).fmt[k] = grid[i][j]; }); };
  Range.prototype.setFontWeight = fmtSetter('bold'); Range.prototype.setFontWeights = gridSetter('bold');
  Range.prototype.setBackground = fmtSetter('bg'); Range.prototype.setBackgrounds = gridSetter('bg');
  Range.prototype.setFontColor = fmtSetter('fc'); Range.prototype.setFontColors = gridSetter('fc');
  Range.prototype.setFontSize = fmtSetter('fs'); Range.prototype.setFontSizes = gridSetter('fs');
  Range.prototype.setFontStyle = fmtSetter('italic'); Range.prototype.setFontStyles = gridSetter('italic');
  Range.prototype.setNumberFormat = fmtSetter('num'); Range.prototype.setNumberFormats = gridSetter('num');
  Range.prototype.setWrap = fmtSetter('wrap');
  const ss = {
    sheets: [], calls: 0,
    getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; },
    insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; },
    getSheets() { return this.sheets.slice(); },
    deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); },
    setActiveSheet(s) { this.active = s; }, moveActiveSheet(i) { this.sheets = [this.active].concat(this.sheets.filter(x => x !== this.active)); },
  };
  // count Sheets API calls (every Range/Sheet method) — the speed metric
  for (const P of [Range.prototype, Sheet.prototype]) for (const k of Object.keys(P)) { if (k === 'cell' || k === 'each') continue; const f = P[k]; P[k] = function () { ss.calls++; return f.apply(this, arguments); }; }
  const services = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty(k, v) { props[k] = String(v); }, deleteProperty(k) { delete props[k]; }, getProperties: () => Object.assign({}, props) }) },
    ContentService: { createTextOutput: (t) => ({ _t: t, setMimeType() { return this; }, getContent() { return this._t; } }), MimeType: { JSON: 'json' } },
    Logger: { log() {} }, Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
  };
  return { ss, props, services };
}
function loadScript(src) {
  const sh = makeSheets();
  const ctx = Object.assign({ console, JSON, Object, Array, Number, String, Boolean, Date, Math, RegExp, Error, isNaN }, sh.services);
  vm.createContext(ctx); vm.runInContext(src, ctx, { filename: 'gas.js' });
  const post = (obj) => JSON.parse(ctx.doPost({ postData: { contents: typeof obj === 'string' ? obj : JSON.stringify(obj) } }).getContent());
  const get = (params) => JSON.parse(ctx.doGet({ parameter: params || {} }).getContent());
  return { ctx, ss: sh.ss, props: sh.props, post, get };
}
const NEW_SRC = fs.readFileSync(path.join(ROOT, 'scripts/google-apps-script.js'), 'utf8');
// the v2 script (per-row writers, no fingerprints, no key) — pinned as a fixture
const OLD_SRC = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'google-apps-script-v2.js'), 'utf8');

// ── sheetsSync.js in a VM ────────────────────────────────────────────────────
function loadClient() {
  const ctx = { console, JSON, Object, Array, Number, String, Boolean, Date, Math, RegExp, Error, Promise, setTimeout, clearTimeout, TextEncoder, TextDecoder, CompressionStream, DecompressionStream, Response, Uint8Array, ArrayBuffer, crypto, btoa, atob, isNaN };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/sheetsSync.js'), 'utf8'), ctx, { filename: 'sheetsSync.js' });
  ctx.SheetsSync.cfg.sleep = () => Promise.resolve();   // no real waits between retries
  return ctx.SheetsSync;
}
// fake http bridging to a script instance; faults: (req, n) → response|null to inject failures
function makeHttp(script, faults) {
  const log = { reqs: [] };
  const http = async (req) => {
    log.reqs.push({ method: req.method, url: req.url, len: (req.body || '').length, type: (() => { try { return JSON.parse(req.body).type || 'project'; } catch (_) { return ''; } })(), part: (() => { try { return JSON.parse(req.body).part; } catch (_) { return undefined; } })() });
    if (faults) { const f = faults(req, log.reqs.length); if (f) return f; }
    const u = new URL(req.url);
    const params = {}; u.searchParams.forEach((v, k) => { params[k] = v; });
    if (req.method === 'POST') return { statusCode: 200, headers: {}, body: JSON.stringify(script.post(req.body)) };
    return { statusCode: 200, headers: {}, body: JSON.stringify(script.get(params)) };
  };
  return { http, log };
}
const URL_ = 'https://script.google.com/macros/s/AKfyc/exec';

// ── fixtures ────────────────────────────────────────────────────────────────
const project = (id, name, opts) => Object.assign({
  isSample: false, name, shortName: name.slice(0, 12), description: 'Desc ' + name, color: '#4389C8', icon: 'briefcase', startDate: '2024-01-01', endDate: '2027-12-31',
  hcwMultiplierEnabled: true, hcwMultiplierRate: 10, programme: 'P', linkGsf: 'https://gsf.org/' + id, linkFolder: '', lat: 1.5, lng: 36.8, locations: [{ name: 'Nakuru', lat: -0.3, lng: 36.07 }], sheetsTabUrl: '', linksExtra: [{ url: 'https://x.org', label: 'X' }],
  enabledQualityKpis: ['ssi_rate'], qualityData: [{ kpiId: 'ssi_rate', year: 2025, quarter: 1, target: 5, actual: 4.2 }], facilities: [{ name: 'Hospital A', isHub: true, lat: -0.3, lng: 36.1, catchmentPop: 120000, annualPatients: 4000, notes: 'hub' }],
  syncedAt: '2026-09-11T08:00:00.000Z',
  years: [{ year: 2024, targets: { hcw_strengthened: 100, patients_reached: 5000, facilities_strengthened: 3, population_access: 200000 }, actuals: { hcw_strengthened: 80, patients_reached: 4200, facilities_strengthened: 2, population_access: 150000 }, quarters: { 1: { hcw_strengthened: 20, patients_reached: 1000 }, 2: { hcw_strengthened: 45, patients_reached: 2100, facilities_strengthened: 1 } }, targetComments: { hcw_strengthened: 'plan note' }, actualComments: { patients_reached: 'actual note' } },
          { year: 2025, targets: { hcw_strengthened: 120, patients_reached: 6000, facilities_strengthened: 4, population_access: 250000 }, actuals: { hcw_strengthened: 30, patients_reached: 900, facilities_strengthened: 1, population_access: 50000 }, quarters: null, targetComments: {}, actualComments: {} }],
  events: [{ id: 'e1', date: '2025-03-04', endDate: '2025-03-06', type: 'training_mentoring', title: 'Course 1', hcw_count: 25, hcw_new_count: 20, facilities_count: 2, notes: 'n1' }, { id: 'e2', date: '2024-11-11', type: 'site_visit', title: 'Visit', hcw_count: 0, notes: '' }, { id: 'e3', date: '2025-01-20', type: 'workshop', title: 'WS', hcw_count: 12, hcw_new_count: 5 }],
  updates: [{ id: 'u1', date: '2025-02-01', tags: ['milestone'], title: 'Kick-off', body: 'Started.' }],
  kpiLog: [{ id: 'l1', timestamp: '2025-02-01T10:00:00.000Z', year: 2025, note: 'baseline', targets: { hcw_strengthened: 120, patients_reached: 6000, facilities_strengthened: 4 }, actuals: { hcw_strengthened: 0, patients_reached: 0, facilities_strengthened: 0 } }],
  _truncated: { events: false, kpiLog: false },
}, opts || {});
const PROJECTS = [project('p1', 'Nakuru Obstetric Safe Surgery'), project('p2', 'Kano Caesarean', { events: [], kpiLog: [], facilities: [], qualityData: [], years: [{ year: 2025, targets: { hcw_strengthened: 10 }, actuals: { hcw_strengthened: 5 }, targetComments: {}, actualComments: {} }] }), project('s1', 'Sample Project', { isSample: true })];
const rnd = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
const surghub = () => ({ surghub_data: Array.from({ length: 300 }, (_, i) => ({ Course: 'Course ' + (i % 40), Learners: i * 3, Timestamp: '2026-0' + (1 + i % 9) + '-01' })), surghub_completion: Array.from({ length: 8000 }, (_, i) => ({ uid: rnd(), course: 'Course ' + (i % 40), start_date: '2026-01-' + String(1 + i % 28).padStart(2, '0'), time: i % 90, note: rnd() })), surghub_history: { '2026-01': 10, '2026-02': 20 }, surghub_derive_verify: { checks: [{ label: 'x', match: true }] } });

// normalised cell dump for parity checks
function dump(sheet) {
  const out = {};
  for (const k of Object.keys(sheet.cells)) {
    const c = sheet.cells[k]; const f = c.fmt;
    out[k] = { v: c.v, bold: f.bold === 'bold' ? 'bold' : 'normal', bg: f.bg || null, fc: f.fc || null, fs: f.fs || 10, italic: f.italic === 'italic' ? 'italic' : 'normal', num: f.num || '' };
    if (out[k].v === '' && !f.bg && !f.bold && !f.fc && !f.italic) delete out[k];   // formatting-free empties don't matter
  }
  return out;
}
function diffDumps(a, b) {
  const diffs = []; const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const x = a[k], y = b[k];
    if (!x || !y) { if ((x && x.v !== '') || (y && y.v !== '')) diffs.push(k + ': ' + JSON.stringify(x) + ' vs ' + JSON.stringify(y)); continue; }
    for (const f of ['v', 'bold', 'bg', 'fc', 'fs', 'italic']) if (String(x[f]) !== String(y[f])) diffs.push(k + '.' + f + ': ' + x[f] + ' vs ' + y[f]);
    if (x.v !== '' && x.num !== y.num) diffs.push(k + '.num: ' + x.num + ' vs ' + y.num);
  }
  return diffs;
}

(async () => {
  const SS = loadClient();
  // ── 1. compression + fingerprint ──
  { const json = JSON.stringify(surghub());
    const packed = await SS.packBlob(json);
    const back = await SS.unpackBlob(packed.text);
    check('packBlob: MARK prefix, base64 gzip, round trip exact, ' + (json.length / packed.text.length).toFixed(1) + 'x smaller', SS.isPacked(packed.text) && back === json && packed.text.length < json.length / 1.5 && /^[0-9a-f]{64}$/.test(packed.hash), JSON.stringify({ raw: json.length, packed: packed.text.length }));
    const h1 = await SS.payloadHash(PROJECTS[0]), h2 = await SS.payloadHash(Object.assign({}, PROJECTS[0], { syncedAt: 'other' })), h3 = await SS.payloadHash(Object.assign({}, PROJECTS[0], { name: 'changed' }));
    check('payloadHash ignores the clock stamp, sees a content change', h1 === h2 && h1 !== h3);
    let e = null; try { await SS.unpackBlob('{"plain":1}'); } catch (x) { e = x; }
    check('unpackBlob refuses plain JSON', !!e);
  }
  // ── 2. request(): retries ──
  { let n = 0; const http = async () => { n++; return n < 3 ? { error: 'net::ERR_NETWORK_CHANGED' } : { statusCode: 200, body: '{"ok":true,"x":1}' }; };
    const retries = []; const r = await SS.request(http, { url: 'u', method: 'GET' }, { onRetry: (m, a, w) => retries.push([m, a, w]) });
    check('request: two network failures then success → 3 attempts, 2 retries logged with waits 5 s/15 s', r.x === 1 && n === 3 && retries.length === 2 && retries[0][2] === 5000 && retries[1][2] === 15000, JSON.stringify(retries));
    n = 0; const httpFatal = async () => { n++; return { statusCode: 200, body: '{"ok":false,"error":"Your input contains more than the maximum of 50000 characters in a single cell."}' }; };
    let e = null; try { await SS.request(httpFatal, { url: 'u', method: 'POST' }); } catch (x) { e = x; }
    check('request: a script error that is not transient is not retried', n === 1 && e && e.kind === 'fatal' && /50000/.test(e.message));
    n = 0; const httpHtml = async () => { n++; return { statusCode: 200, body: '<!DOCTYPE html><html>Google Drive - Page Not Found</html>' }; };
    e = null; try { await SS.request(httpHtml, { url: 'u', method: 'GET' }); } catch (x) { e = x; }
    check('request: an HTML page is transient (retried 3×) and named in the error', n === 3 && e && /HTML page/.test(e.message) && /3 attempts/.test(e.message), e && e.message);
    n = 0; const httpBusy = async () => { n++; return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'Exception: Service Spreadsheets failed while accessing document with id abc.' }) }; };
    e = null; try { await SS.request(httpBusy, { url: 'u', method: 'POST' }, { attempts: 2 }); } catch (x) { e = x; }
    check('request: "failed while accessing document" is transient', n === 2 && e && e.kind === 'transient');
  }
  // ── 3. serverInfo: old vs new script ──
  { const oldS = loadScript(OLD_SRC), newS = loadScript(NEW_SRC);
    const io = await SS.serverInfo(makeHttp(oldS).http, URL_), inew = await SS.serverInfo(makeHttp(newS).http, URL_);
    check('serverInfo: previous script → version 2, not fast, reason says redeploy; v4 → fast, can secure, unsecured, empty fingerprints', io.version === 2 && io.fast === false && /redeploy/.test(io.reason) && inew.version === 4 && inew.fast === true && inew.canSecure === true && inew.secured === false && inew.hashes.surghub === '' && Object.keys(inew.hashes.projects).length === 0, JSON.stringify({ io, inew }));
    const unreachable = await SS.serverInfo(async () => ({ error: 'net::ERR_NAME_NOT_RESOLVED' }), URL_);
    check('serverInfo: unreachable → not fast, reason given', unreachable.fast === false && /unreachable/.test(unreachable.reason));
  }
  // ── 4. v3 script: idempotent parts, fingerprint timing, incomplete blob, legacy client, nosurghub ──
  { const S = loadScript(NEW_SRC);
    const text = SS.MARK + 'A'.repeat(49000 * 2 + 10);   // 3 chunk rows
    const part = (p, data, extra) => S.post(Object.assign({ type: 'surghub_chunk', part: p, totalParts: 2, syncedAt: 't', data }, extra));
    part(1, text.slice(0, 49000), { startRow: 2, totalRows: 3, format: 'gz64', hash: 'H1' });
    check('after part 1 of 2: fingerprint not advertised yet, blob not served (incomplete)', S.props['hash:surghub'] === undefined && S.get().surghubStorage === undefined);
    part(2, text.slice(49000), { startRow: 3, totalRows: 3, format: 'gz64', hash: 'H1' });
    part(2, text.slice(49000), { startRow: 3, totalRows: 3, format: 'gz64', hash: 'H1' });   // retried part
    const sheet = S.ss.getSheetByName('📋 SURGhub');
    check('parts at explicit rows: a retried part overwrites — 3 rows, blob served as the packed string, fingerprint advertised', sheet.getLastRow() === 4 && S.get().surghubStorage === text && S.get({ meta: '1' }).hashes.surghub === 'H1' && S.get().surghubHash === 'H1', JSON.stringify({ lastRow: sheet.getLastRow(), meta: S.get({ meta: '1' }) }));
    check('?nosurghub=1 leaves the blob out', S.get({ nosurghub: '1' }).surghubStorage === undefined && S.get({ nosurghub: '1' }).ok === true);
    // legacy client (no startRow/hash): appended, parsed server-side, fingerprint cleared
    const legacyJson = JSON.stringify({ surghub_data: [1, 2, 3] });
    S.post({ type: 'surghub_chunk', part: 1, totalParts: 1, syncedAt: 't', data: legacyJson });
    const g = S.get();
    check('legacy client parts: plain JSON parsed by the script as before; stale fingerprint cleared', JSON.stringify(g.surghubStorage) === legacyJson && S.props['hash:surghub'] === undefined && g.surghubHash === undefined);
    // project + org fingerprints stored
    S.post(Object.assign({}, PROJECTS[0], { id: 'p1', hash: 'PH1' })); S.post({ type: 'org_summary', generatedAt: 'now', projects: [PROJECTS[0]], hash: 'OH1' });
    const m = S.get({ meta: '1' });
    check('project and org fingerprints stored and returned by ?meta', m.hashes.projects.p1 === 'PH1' && m.hashes.org === 'OH1' && m.version === 4 && !!m.lastModified);
  }
  // ── 5. parity: batched writers produce the same cells as the per-row writers ──
  { const oldS = loadScript(OLD_SRC), newS = loadScript(NEW_SRC);
    for (const p of PROJECTS) { oldS.ctx._writeProject(oldS.ss, p); newS.ctx._writeProject(newS.ss, p); }
    let diffs = [];
    for (const p of PROJECTS) { const n = (p.shortName || p.name).slice(0, 95); diffs = diffs.concat(diffDumps(dump(oldS.ss.getSheetByName(n)), dump(newS.ss.getSheetByName(n))).map(d => n + ' ' + d)); }
    check('project tabs: values, bold, backgrounds, colours, sizes, number formats identical to the per-row writer (3 projects incl. sample)', diffs.length === 0, diffs.slice(0, 6).join(' | '));
    const mergesEq = PROJECTS.every(p => { const n = (p.shortName || p.name).slice(0, 95); return [...oldS.ss.getSheetByName(n).merges].sort().join(';') === [...newS.ss.getSheetByName(n).merges].sort().join(';'); });
    check('project tabs: identical merges', mergesEq);
    const parsedOld = PROJECTS.map(p => oldS.ctx._readProjectSheet(oldS.ss.getSheetByName((p.shortName || p.name).slice(0, 95))));
    const parsedNew = PROJECTS.map(p => newS.ctx._readProjectSheet(newS.ss.getSheetByName((p.shortName || p.name).slice(0, 95))));
    check('project tabs read back identically by the pull parser', JSON.stringify(parsedOld) === JSON.stringify(parsedNew) && parsedNew[0].years.length === 2 && parsedNew[0].events.length === 3);
    const callsOldP = oldS.ss.calls, callsNewP = newS.ss.calls;
    oldS.ss.calls = 0; newS.ss.calls = 0;
    const org = { type: 'org_summary', generatedAt: 'Thu 11 Sep', projects: PROJECTS };
    oldS.ctx._writeOrgSummary(oldS.ss, org); newS.ctx._writeOrgSummary(newS.ss, org);
    const od = diffDumps(dump(oldS.ss.getSheetByName('📊 Organisation')), dump(newS.ss.getSheetByName('📊 Organisation')));
    check('organisation summary: identical cells and merges', od.length === 0 && [...oldS.ss.getSheetByName('📊 Organisation').merges].sort().join(';') === [...newS.ss.getSheetByName('📊 Organisation').merges].sort().join(';'), od.slice(0, 6).join(' | '));
    check('about a third of the Sheets calls: projects ' + callsOldP + ' → ' + callsNewP + ', org ' + oldS.ss.calls + ' → ' + newS.ss.calls, callsNewP * 2.5 < callsOldP && newS.ss.calls * 2.5 < oldS.ss.calls);
  }
  // ── 6. end-to-end push/pull against the v3 script ──
  { const S = loadScript(NEW_SRC); const { http, log } = makeHttp(S);
    SS.cfg.partRows = 1;   // one cell row per upload → the blob spans several parts
    const data = surghub();
    const ctx = () => ({ url: URL_, http, projects: PROJECTS.map(p => ({ id: p.name.toLowerCase().replace(/\W+/g, '-'), name: p.name, shortName: p.shortName, _p: p })), buildPayload: async (p) => JSON.stringify(Object.assign({}, p._p, { syncedAt: new Date().toISOString() })), collect: async () => ({ surghubStorage: data, rawStorage: { surgdash_projects: [1, 2] }, appSettings: { googleSheetsUrl: URL_ }, customQualityKpis: [] }), progress: () => {}, log: () => {} });
    const s1 = await SS.push(ctx());
    const parts1 = log.reqs.filter(r => r.type === 'surghub_chunk').length;
    check('push #1 (fast): every project, org, compressed SURGhub in ' + parts1 + ' parts, backup — no errors', s1.ok && s1.fast && s1.projects.pushed.length === 3 && s1.org === 'pushed' && s1.surghub === 'pushed' && s1.backup === 'pushed' && parts1 === s1.surghubParts && parts1 >= 3, JSON.stringify({ errors: s1.errors, parts: parts1, packed: s1.surghubPackedChars }));
    const pulled = await SS.fetchMirror(http, URL_, {});
    check('pull: packed blob inflated → surghubStorage deep-equals what was pushed; projects parsed', JSON.stringify(pulled.surghubStorage) === JSON.stringify(data) && pulled.projects.length === 3 && pulled.surghubHash === s1.surghubHash && pulled.version === 4);
    log.reqs.length = 0;
    const s2 = await SS.push(ctx());
    check('push #2 (nothing changed): projects, org and SURGhub skipped; only the backup went — ' + log.reqs.filter(r => r.method === 'POST').length + ' POST', s2.ok && s2.projects.skipped.length === 3 && s2.projects.pushed.length === 0 && s2.org === 'skipped' && s2.surghub === 'skipped' && s2.backup === 'pushed' && log.reqs.filter(r => r.method === 'POST').length === 1, JSON.stringify({ skipped: s2.projects.skipped.length, org: s2.org, surghub: s2.surghub }));
    // one project edited
    PROJECTS[1].years[0].actuals.hcw_strengthened = 7; log.reqs.length = 0;
    const s3 = await SS.push(ctx());
    check('push #3 (one project edited): that project + org summary + backup only', s3.ok && s3.projects.pushed.length === 1 && s3.projects.skipped.length === 2 && s3.org === 'pushed' && s3.surghub === 'skipped' && log.reqs.filter(r => r.method === 'POST').length === 3, JSON.stringify(s3.projects));
    // SURGhub changed
    data.surghub_history['2026-03'] = 30; log.reqs.length = 0;
    const s4 = await SS.push(ctx());
    check('push #4 (SURGhub changed): only the blob parts + backup', s4.ok && s4.projects.pushed.length === 0 && s4.org === 'skipped' && s4.surghub === 'pushed' && log.reqs.filter(r => r.type === 'surghub_chunk').length === s4.surghubParts && log.reqs.filter(r => r.method === 'POST').length === s4.surghubParts + 1);
    // pull decisions
    const planSame = await SS.pullPlan(http, URL_, { localHash: s4.surghubHash });
    const planOther = await SS.pullPlan(http, URL_, { localHash: 'nope' });
    const planDirty = await SS.pullPlan(http, URL_, { silent: true, localDirty: true, localHash: 'nope' });
    check('pullPlan: same fingerprint → skip (unchanged); other → download; silent+dirty → skip (dirty)', planSame.skip && planSame.reason === 'unchanged' && !planOther.skip && planDirty.skip && planDirty.reason === 'dirty');
    const light = await SS.fetchMirror(http, URL_, { nosurghub: true });
    check('fetchMirror(nosurghub): projects only', light.surghubStorage === undefined && light.projects.length === 3);
    check('describe(): readable summary', /3 projects unchanged/.test(SS.describe(s2)) && /SURGhub data unchanged/.test(SS.describe(s2)) && /1 project updated \(2 unchanged\)/.test(SS.describe(s3)), SS.describe(s3));
    // force pushes everything
    log.reqs.length = 0; const s5 = await SS.push(Object.assign(ctx(), { force: true }));
    check('force: everything pushed despite matching fingerprints', s5.ok && s5.projects.pushed.length === 3 && s5.org === 'pushed' && s5.surghub === 'pushed');
  }
  // ── 7. retry of a SURGhub part on the v3 script leaves an intact blob ──
  { const S = loadScript(NEW_SRC); let failed = false;
    const { http, log } = makeHttp(S, (req) => { if (!failed && req.method === 'POST' && /"part":2/.test(req.body)) { failed = true; return { error: 'net::ERR_CONNECTION_RESET' }; } return null; });
    SS.cfg.partRows = 1; const data = surghub();
    const s = await SS.push({ url: URL_, http, projects: [], buildPayload: async () => '{}', collect: async () => ({ surghubStorage: data, rawStorage: {}, appSettings: {}, customQualityKpis: [] }), progress: () => {}, log: () => {} });
    const pulled = await SS.fetchMirror(http, URL_, {});
    check('part 2 failed once → retried → run ok with 1 retry, pulled blob equals the original (no duplicate rows)', s.ok && s.retries === 1 && s.surghub === 'pushed' && JSON.stringify(pulled.surghubStorage) === JSON.stringify(data), JSON.stringify({ ok: s.ok, retries: s.retries, errors: s.errors }));
  }
  // ── 8. legacy script: old protocol, no skipping, no part retries, honest error ──
  { const S = loadScript(OLD_SRC); const { http, log } = makeHttp(S);
    SS.cfg.partRows = 1; const data = surghub();
    const ctx = () => ({ url: URL_, http, projects: PROJECTS.slice(0, 2).map(p => ({ id: 'x-' + p.name, name: p.name, shortName: p.shortName, _p: p })), buildPayload: async (p) => JSON.stringify(p._p), collect: async () => ({ surghubStorage: data, rawStorage: {}, appSettings: {}, customQualityKpis: [] }), progress: () => {}, log: () => {} });
    const s1 = await SS.push(ctx());
    const chunkBodies = log.reqs.filter(r => r.type === 'surghub_chunk');
    check('legacy: not fast, raw JSON parts (no MARK), everything pushed, summary tells to redeploy', !s1.fast && s1.ok && chunkBodies.length === s1.surghubParts && s1.surghubPackedChars === JSON.stringify(data).length && /redeploy/.test(SS.describe(s1)), SS.describe(s1));
    const pulled = await SS.fetchMirror(http, URL_, {});
    check('legacy pull: script parses the JSON itself, client receives the object', JSON.stringify(pulled.surghubStorage) === JSON.stringify(data) && pulled.projects.length === 2);
    log.reqs.length = 0; const s2 = await SS.push(ctx());
    check('legacy: no skipping (everything pushed again)', s2.projects.pushed.length === 2 && s2.org === 'pushed' && s2.surghub === 'pushed');
    // a failing part is not retried on a legacy script (a retry would duplicate rows) and the error is honest
    const { http: http2 } = makeHttp(S, (req) => (req.method === 'POST' && /"part":2/.test(req.body)) ? { error: 'net::ERR_TIMED_OUT' } : null);
    const s3 = await SS.push(Object.assign(ctx(), { http: http2 }));
    check('legacy: failed part → one attempt, SURGhub marked failed with "nothing was lost locally", backup still pushed, no doomed fallback', s3.surghub === 'failed' && s3.retries === 0 && /nothing was lost locally/.test(s3.errors.join(' ')) && s3.backup === 'pushed' && !s3.ok);
  }
  // ── 9. wiring in genericViews / index.html ──
  { const gv = fs.readFileSync(path.join(ROOT, 'js/genericViews.js'), 'utf8'), html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    check('genericViews: push goes through SheetsSync.push, pull plans the SURGhub download, GET normalises the blob, module loaded before genericViews', /SheetsSync\.push\(\{/.test(gv) && /SheetsSync\.pullPlan\(_http, url/.test(gv) && /SheetsSync\.fetchMirror\(http, targetUrl/.test(gv) && /googleSheetsSurghubHash/.test(gv) && html.indexOf('js/sheetsSync.js') < html.indexOf('js/genericViews.js') && html.indexOf('js/sheetsSync.js') > 0 && !/_sheetsPostRaw/.test(gv));
    check('genericViews: the doomed "embed 150 MB in the backup" fallback is gone', !/if \(!chunked\) backupPayload\.surghubStorage/.test(gv));
    const gas = NEW_SRC;
    check('Copy Script still recognises the canonical file (markers present)', gas.indexOf('surghub_chunk') !== -1 && gas.indexOf('parameter.meta') !== -1 || /p\.meta/.test(gas));
  }
  // ── 10. sync key: open until set, then required everywhere but ?meta; rotation needs the current key ──
  { const S = loadScript(NEW_SRC); const { http, log } = makeHttp(S); SS.cfg.partRows = 1; const data = surghub();
    const KEY = SS.generateKey(), KEY2 = SS.generateKey();
    check('generateKey: 48 hex chars, unique', /^[0-9a-f]{48}$/.test(KEY) && KEY !== KEY2);
    const before = await SS.serverInfo(http, URL_);
    check('unsecured script: meta says secured:false, canSecure:true', before.secured === false && before.canSecure === true);
    const shortRefused = await SS.setKey(http, URL_, { newKey: 'short' }).catch(e => false);
    check('a key under 16 chars is refused', shortRefused === false || shortRefused === undefined);
    check('first key set without a current key', (await SS.setKey(http, URL_, { newKey: KEY })) === true && S.props.syncKey === KEY);
    const after = await SS.serverInfo(http, URL_);
    check('?meta stays open and reports secured:true', after.secured === true && after.version === 4 && after.fast);
    const ctx = (key) => ({ url: URL_, http, key, projects: PROJECTS.slice(0, 1).map(p => ({ id: 'k-' + p.name, name: p.name, shortName: p.shortName, _p: p })), buildPayload: async (p) => JSON.stringify(p._p), collect: async () => ({ surghubStorage: data, rawStorage: {}, appSettings: {}, customQualityKpis: [] }), progress: () => {}, log: () => {} });
    log.reqs.length = 0;
    const noKey = await SS.push(ctx(''));
    check('push without a key on a secured Sheet: refused at once (no requests after ?meta), message names the share link', !noKey.ok && noKey.errors.length === 1 && /share link/.test(noKey.errors[0]) && log.reqs.filter(r => r.method === 'POST').length === 0);
    const wrong = await SS.push(ctx('0123456789abcdef0123456789abcdef'));
    check('push with a WRONG key: every item unauthorised, nothing retried, nothing written', !wrong.ok && wrong.retries === 0 && wrong.projects.failed.length === 1 && wrong.surghub === 'failed' && /unauthorised/.test(wrong.errors.join(' ')) && !S.ss.getSheetByName('📋 SURGhub'));
    const good = await SS.push(ctx(KEY));
    check('push with the key: everything lands', good.ok && good.projects.pushed.length === 1 && good.surghub === 'pushed' && good.backup === 'pushed' && !!S.ss.getSheetByName('📋 SURGhub'));
    let e1 = null; try { await SS.fetchMirror(http, URL_, {}); } catch (x) { e1 = x; }
    check('pull without the key: unauthorised, fatal (2 attempts configured, 1 made)', e1 && e1.code === 'unauthorised' && !/attempts/.test(e1.message));
    const m2 = await SS.fetchMirror(http, URL_, { key: KEY });
    check('pull with the key: full mirror incl. the blob', JSON.stringify(m2.surghubStorage) === JSON.stringify(data) && m2.projects.length === 1);
    const plan = await SS.pullPlan(http, URL_, { localHash: good.surghubHash });
    check('pullPlan without a key on a secured Sheet: flags unauthorised, no skip', plan.unauthorised === true && plan.skip === false);
    const planK = await SS.pullPlan(http, URL_, { localHash: good.surghubHash, key: KEY });
    check('pullPlan with the key: unchanged → skip', planK.skip && planK.reason === 'unchanged');
    check('rotation with a wrong current key is refused', (await SS.setKey(http, URL_, { newKey: KEY2, currentKey: 'nope' }).catch(() => false)) === false && S.props.syncKey === KEY);
    check('rotation with the current key works; old key then fails', (await SS.setKey(http, URL_, { newKey: KEY2, currentKey: KEY })) === true && S.props.syncKey === KEY2 && !(await SS.push(ctx(KEY))).ok && (await SS.push(ctx(KEY2))).ok);
    // share links
    const p1 = SS.parseShareLink('https://script.google.com/macros/s/AKfyc/exec#k=' + KEY2), p2 = SS.parseShareLink('https://script.google.com/macros/s/AKfyc/exec?k=' + KEY2), p3 = SS.parseShareLink('https://script.google.com/macros/s/AKfyc/exec'), p4 = SS.parseShareLink('  https://script.google.com/macros/s/AKfyc/exec#k=' + KEY2 + '  ');
    check('parseShareLink: #k= and ?k= forms yield the bare URL + key; a plain URL has no key; whitespace tolerated', p1.url === URL_ && p1.key === KEY2 && p2.url === URL_ && p2.key === KEY2 && p3.url === URL_ && p3.key === '' && p4.url === URL_ && p4.key === KEY2, JSON.stringify([p1, p2, p3, p4]));
    check('makeShareLink round-trips', SS.parseShareLink(SS.makeShareLink(URL_, KEY2)).key === KEY2 && SS.makeShareLink(URL_, '') === URL_);
    // legacy (v2) script ignores keys entirely
    const L = loadScript(OLD_SRC); const { http: lh } = makeHttp(L);
    const li = await SS.serverInfo(lh, URL_);
    const lp = await SS.push(Object.assign(ctx(KEY), { http: lh }));
    check('v2 script: cannot secure, key sent but ignored, push works', li.canSecure === false && li.secured === false && lp.ok);
  }
  // ── 11. wiring: key stored device-locally, share links parsed on both URL fields, key on push and pull ──
  { const gv = fs.readFileSync(path.join(ROOT, 'js/genericViews.js'), 'utf8'), st = fs.readFileSync(path.join(ROOT, 'js/storage.js'), 'utf8');
    check('storage: surgdash_sheets_key is forward-mapped only (device-local)', /surgdash_sheets_key'\)\s+return path\.join\('settings', 'sheets_key\.json'\)/.test(st) && !/'sheets_key': 'surgdash_sheets_key'/.test(st));
    const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    check('refused pull → paste-here banner (also on silent pulls); Email share link button; unauthorised code kept on the rethrown error', /id="sync-key-banner"/.test(idx) && /id="sync-key-input"/.test(idx) && /_saveShareLinkFromBanner\(\)/.test(idx) && /_showSyncKeyBanner\(\) \{/.test(gv) && /if \(_needsKey\) this\._showSyncKeyBanner\(\);/.test(gv) && /if \(_plan\.unauthorised\)/.test(gv) && /e2\.code = 'unauthorised'/.test(gv) && /async _emailSheetsShareLink\(\)/.test(gv) && /_emailSheetsShareLink', 'Email share link…'/.test(gv));
    check('genericViews: both URL fields go through _sheetsStoreShareLink; push and pull carry the key; settings row + Secure/Rotate/Copy handlers exist', (gv.match(/_sheetsStoreShareLink\(/g) || []).length >= 3 && /key: await this\._sheetsKey\(\),\s*$/m.test(gv) && /pullPlan\(_http, url, \{[^}]*key: await this\._sheetsKey\(\)/.test(gv) && /id="sheets-key-status"/.test(gv) && /async _secureSheet\(\)/.test(gv) && /async _rotateSheetsKey\(\)/.test(gv) && /async _copySheetsShareLink\(btn\)/.test(gv) && /clipboard-write-text/.test(gv));
  }
  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); process.exit(2); });
