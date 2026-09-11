// Live-data test of js/journeys.js (+ sparklines.js, institutions.js helpers, enrolmentSync.js receipt parser).
// Read-only against the app's data directory; Storage writes stay in memory.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = require('path').resolve(__dirname, '..', '..'), DATA = process.env.SURGDASH_DATA || require('path').join(require('os').homedir(), 'Library', 'Application Support', 'surgdash', 'data');
const rows = JSON.parse(fs.readFileSync(DATA + '/surghub/completion.json', 'utf8'));
const courseList = JSON.parse(fs.readFileSync(DATA + '/surghub/data.json', 'utf8'));
const store = new Map();
const openFds = new Set();
const bfs = Object.assign({}, fs, {
  openSync(p) { const fd = fs.openSync(p, 'r'); openFds.add(fd); return fd; },
  readSync(fd, length, position) { const len = Math.min(Number(length) || 0, 64 * 1024 * 1024); const buf = Buffer.allocUnsafe(len); const n = fs.readSync(fd, buf, 0, len, position == null ? null : Number(position)); return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + n)); },
  closeSync(fd) { openFds.delete(fd); fs.closeSync(fd); },
});
const ctx = { console, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, isFinite, isNaN, parseFloat, parseInt, setTimeout, TextDecoder, URLSearchParams, encodeURIComponent, __swallowed: () => {},
  electronAPI: { fs: bfs, path },
  Storage: { DATA_DIR: DATA, async getItem(k) { if (store.has(k)) return JSON.parse(JSON.stringify(store.get(k))); const rel = k === 'surgdash_enrolment_sync' ? 'settings/enrolment_sync.json' : null; if (rel && fs.existsSync(path.join(DATA, rel))) return JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8')); return null; }, async setItem(k, v) { store.set(k, JSON.parse(JSON.stringify(v))); } },
  XLSX: null, alert: (m) => { throw new Error('alert: ' + m); },
};
ctx.window = ctx;
ctx.App = { _rawCompletion: rows, data: courseList, includePartialMonth: false, view: 'platform', _dashTab: 'journeys',
  escapeHtml: (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  escapeJsArg: (t) => String(t).replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
  formatNumber: (n) => Number(n || 0).toLocaleString('en-US'),
  showMsg: () => {}, renderView: () => {},
  _djb2Hash(str) { let hash = 5381; for (let i = 0; i < str.length; i++) hash = (((hash << 5) + hash) + str.charCodeAt(i)) | 0; return (hash >>> 0).toString(36); },   // same as updater.js
};
vm.createContext(ctx);
// institutions.js for _instDomain/_instIsPersonal, enrolmentSync.js for receipts, sparklines.js, journeys.js
for (const f of ['js/institutions.js', 'js/enrolmentSync.js', 'js/sparklines.js', 'js/journeys.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const App = ctx.App;
// the app's djb2 lives in updater.js; use the same as the harness above only if the app's uid scheme matches: check on a row
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 200) : '')); };
const sample = rows.find(r => r.email && r.uid);
check('uid scheme matches djb2(email) used for the account index', App._djb2Hash(String(sample.email).toLowerCase().trim()) === String(sample.uid), sample.uid + ' vs ' + App._djb2Hash(String(sample.email).toLowerCase().trim()));

const t0 = Date.now(); const idx = App._jrnIndex(); const ms = Date.now() - t0;
console.log(`index: ${ms} ms | courses ${idx.courses.size} | learners ${idx.learners} | never ${idx.never} | multi ${idx.multi} | certLearners ${idx.certLearners} | returned ${idx.returned} | transitions ${idx.transitions.length}`);
console.log('totals', JSON.stringify({ enrolled: idx.totals.enrolled, opened: idx.totals.opened, completed: idx.totals.completed, certified: idx.totals.certified, fast: idx.totals.fast, median: idx.totals.median, gapMedian: idx.gapMedian, perLearner: idx.perLearner }));
check('index builds in under 2 s', ms < 2000, ms + ' ms');
// independent recount
const valid = rows.filter(r => r && r.course && r.uid);
check('enrolled = records with course+uid', idx.totals.enrolled === valid.length, valid.length);
check('opened = records with start_date', idx.totals.opened === valid.filter(r => r.start_date && String(r.start_date).length >= 10).length);
check('certified = records with certificate', idx.totals.certified === valid.filter(r => r.certificate).length);
check('learners = distinct uids', idx.learners === new Set(valid.map(r => r.uid)).size);
// transitions sum = sum over learners of (distinct opened courses - 1)
const perUid = new Map(); for (const r of valid) { if (!r.start_date) continue; let s = perUid.get(r.uid); if (!s) { s = new Set(); perUid.set(r.uid, s); } s.add(r.course); }
let expT = 0, expMulti = 0; for (const s of perUid.values()) { expT += s.size - 1; if (s.size >= 2) expMulti++; }
check('transitions sum = Σ(distinct opened courses − 1)', idx.transitions.reduce((a, t) => a + t.n, 0) === expT, expT);
check('multi = learners with 2+ distinct opened courses', idx.multi === expMulti, expMulti);
check('never = learners with no opened course', idx.never === idx.learners - perUid.size);
check('per-learner histogram sums to learners who opened', idx.perLearner.reduce((a, b) => a + b, 0) === perUid.size);
// per-course next/prev consistency: Σ next over all courses = Σ prev = transitions
let sn = 0, sp = 0; for (const c of idx.courses.values()) { for (const v of c.next.values()) sn += v; for (const v of c.prev.values()) sp += v; }
check('Σ next = Σ prev = transitions', sn === expT && sp === expT, `${sn} ${sp}`);
const top = idx.transitions[0]; console.log('top path:', top.from, '→', top.to, top.n, 'learners, median gap', top.medianGap, 'd');
check('return-after-certificate rate is between 10% and 40%', idx.returned / idx.certLearners > 0.1 && idx.returned / idx.certLearners < 0.4, (100 * idx.returned / idx.certLearners).toFixed(1) + '%');

// strips
const strip = App._jrnCourseStripHtml('Navigating the Global Surgery Ecosystem');
check('course strip renders funnel + next courses', /Enrolled/.test(strip) && /Learners go on to/.test(strip) && /<svg|Opened/.test(strip), strip.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 220));
const pstrip = App._jrnProviderStripHtml('GSF - Global Surgery Foundation');
check('provider strip renders with included course count', /included course/.test(pstrip) && /Enrolled/.test(pstrip), pstrip.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160));
check('unknown course/provider strips are empty', App._jrnCourseStripHtml('No Such Course') === '' && App._jrnProviderStripHtml('No Such Provider') === '');

// tab render before the account index exists
App._accounts = null;
const html0 = App._dashJourneysHtml();
check('tab renders without account index (build button shown)', /Build from the last sync/.test(html0) && /Funnel by course/.test(html0) && /Top learning paths/.test(html0), html0.length + ' chars');
// account index from the real receipts (read-only parse; persisted in-memory here)
(async () => {
  const ta = Date.now(); const acc = await App._accountsBuildFromReceipt(true); const ams = Date.now() - ta;
  check('account index built from the newest receipt', !!acc && acc.n > 60000, acc && `${acc.n} accounts, listing ${acc.listedAt}, ${ams} ms`);
  const sampleUid = Object.keys(acc.byUid)[0]; const a = acc.byUid[sampleUid];
  check('index entries carry day strings + domain, no email', /^\d{4}-\d{2}-\d{2}$/.test(a.c) && (a.l === '' || /^\d{4}-\d{2}-\d{2}$/.test(a.l)) && typeof a.d === 'string' && !/@/.test(JSON.stringify(a)), JSON.stringify(a));
  check('index joins to the records (most learners with records are in it)', (() => { let hit = 0, n = 0; for (const uid of idx.byUid.keys()) { n++; if (acc.byUid[uid]) hit++; } return hit / n > 0.95; })(), (() => { let hit = 0, n = 0; for (const uid of idx.byUid.keys()) { n++; if (acc.byUid[uid]) hit++; } return `${hit}/${n}`; })());
  const act = App._jrnActivation();
  console.log('activation:', JSON.stringify({ asOf: act.asOf, total: act.total, active30: act.active30, active90: act.active90, dormant: act.dormant, activated: act.activated, ever: act.ever, domains: act.domains.length, lastMonths: act.months.slice(-3) }));
  check('activation computed: activated ≤ ever ≤ total, dormant = total − ever', act.activated <= act.ever && act.ever <= act.total && act.dormant === act.total - act.ever);
  check('24 sign-up months + current', act.months.length === 25 && act.months[24].month === act.asOf.slice(0, 7), act.months.map(m => m.month).slice(-2).join(','));
  const html = App._dashJourneysHtml();
  check('tab renders with activation section', /Sign-ups per month and activation/.test(html) && /Institutions, last 12 months/.test(html) && !/Build from the last sync/.test(html), html.length + ' chars');
  check('no unescaped template leftovers in the tab', !/\$\{/.test(html) && !/undefined/.test(html.replace(/data-lucide/g, '')), (html.match(/undefined/g) || []).length + ' undefined');
  console.log(`\n${ok}/${ok + bad} passed`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); process.exit(2); });
