// Live-data test of js/lookup.js. Prints counts and booleans only — never a learner's name or email.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = require('path').resolve(__dirname, '..', '..'), DATA = process.env.SURGDASH_DATA || require('path').join(require('os').homedir(), 'Library', 'Application Support', 'surgdash', 'data');
const rows = JSON.parse(fs.readFileSync(DATA + '/surghub/completion.json', 'utf8'));
const courseList = JSON.parse(fs.readFileSync(DATA + '/surghub/data.json', 'utf8'));
const store = new Map(); let copied = '';
const dom = { html: {} };
const ctx = { console, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, isFinite, isNaN, parseFloat, parseInt, setTimeout, clearTimeout, TextDecoder, URLSearchParams, encodeURIComponent, __swallowed: () => {},
  electronAPI: { fs, path },
  Storage: { DATA_DIR: DATA, async getItem(k) { return store.has(k) ? store.get(k) : null; }, async setItem(k, v) { store.set(k, v); } },
  document: { getElementById: (id) => ({ set innerHTML(v) { dom.html[id] = v; }, get innerHTML() { return dom.html[id] || ''; } }) },
  navigator: { clipboard: { writeText: async (t) => { copied = t; } } },
  lucide: { createIcons() {} },
};
ctx.window = ctx;
ctx.App = { _rawCompletion: rows, data: courseList, editUnlocked: true, view: 'platform', _dashTab: 'lookup', _accounts: null,
  escapeHtml: (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  escapeJsArg: (t) => String(t).replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
  formatNumber: (n) => Number(n || 0).toLocaleString('en-US'), formatLearningTime: (m) => Math.round(m) + ' min',
  showMsg: (m) => { ctx.lastMsg = m; }, renderView: () => { ctx.renders = (ctx.renders || 0) + 1; }, showUnlockPrompt() {},
  _djb2Hash(str) { let hash = 5381; for (let i = 0; i < str.length; i++) hash = (((hash << 5) + hash) + str.charCodeAt(i)) | 0; return (hash >>> 0).toString(36); },
};
vm.createContext(ctx);
for (const f of ['js/institutions.js', 'js/sparklines.js', 'js/journeys.js', 'js/lookup.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const App = ctx.App;
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 160) : '')); };

const t0 = Date.now(); const idx = App._lkIndex(); const ms = Date.now() - t0;
check('index builds quickly, one entry per learner', ms < 1500 && idx.list.length === new Set(rows.filter(r => r && r.uid).map(r => r.uid)).size, `${idx.list.length} learners in ${ms} ms`);
// pick a learner with several courses and a certificate as the probe (never printed)
const probe = idx.list.filter(u => u.rows.length >= 3 && u.certs >= 1 && u.name && u.email.includes('@')).sort((a, b) => b.rows.length - a.rows.length)[10];
check('search by exact email returns that learner first', App._lkSearch(probe.email)[0] === probe);
check('search by email prefix (first 6 chars) includes the learner', App._lkSearch(probe.email.slice(0, 6)).includes(probe) || App._lkSearch(probe.email.slice(0, 6)).length === App.LOOKUP_MAX_RESULTS);
check('search by name (first word, case-insensitive) finds the learner', App._lkSearch(probe.name.split(' ')[0].toUpperCase()).some(u => u === probe) || App._lkSearch(probe.name.split(' ')[0].toUpperCase()).length === App.LOOKUP_MAX_RESULTS);
check('search by learner id finds exactly that learner', App._lkSearch(probe.uid).length >= 1 && App._lkSearch(probe.uid)[0] === probe);
check('too-short query returns nothing', App._lkSearch('ab').length === 0);
check('results capped', App._lkSearch('gmail').length === App.LOOKUP_MAX_RESULTS);
// rendering
App._lkQuery = probe.email; App._lkUid = null;
const tab = App._dashLookupHtml();
check('tab renders search box, results and the privacy notice', /id="lk-query"/.test(tab) && /id="lk-results"/.test(tab) && /Internal support tool/.test(tab) && /pick a learner/.test(tab) && !/\$\{/.test(tab));
App._lkSelect(probe.uid);
const detail = dom.html['lk-detail'];
check('detail renders name, email, facts and one row per enrolment', detail.includes(App.escapeHtml(probe.email)) && detail.includes(App.escapeHtml(probe.name)) && (detail.match(/<tr class="border-b hover:bg-slate-50 text-xs">/g) || []).length === probe.rows.length && /Certified/.test(detail) && /Copy history/.test(detail));
check('detail rows sorted newest first', (() => { const ds = App._lkSorted(probe).map(r => r.certificate_date || r.completion_date || r.start_date || r.enrolled_date || ''); return ds.every((d, i) => i === 0 || ds[i - 1] >= d); })());
check('results list marks the selected learner', /bg-blue-50/.test(dom.html['lk-results']));
// account index + demographics enrich the detail
(async () => {
  store.set('surghub_email_demo', { [probe.email]: { country: 'Testland', profession: 'nurse' } });
  App._emailDemoMap = null; App._lkDemoKick = false; App._accounts = { listedAt: '2026-09-06T21:49:46.000Z', byUid: { [probe.uid]: { c: '2025-01-02', l: '2026-08-30', d: probe.domain } } };
  App._dashLookupHtml(); await new Promise(r => setTimeout(r, 20));
  App._lkSelect(probe.uid);
  const d2 = dom.html['lk-detail'];
  check('detail shows sign-up, last login, country and profession when available', /2025-01-02/.test(d2) && /2026-08-30/.test(d2) && /Testland/.test(d2) && /nurse/.test(d2));
  await App._lkCopy();
  check('copy history produces plain text with one line per course', copied.split('\n').length === probe.rows.length + 3 && copied.includes(probe.email) && /certificate/.test(copied));
  // gating
  App.editUnlocked = false;
  const locked = App._dashLookupHtml();
  check('locked: no search box, unlock prompt instead', !/id="lk-query"/.test(locked) && /Unlock editing/.test(locked) && !locked.includes(App.escapeHtml(probe.email)));
  App.editUnlocked = true;
  // ui.js wiring
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
  check('lookup lives on the Directory page: edit-only, never exported, no dashboard tab', /<div data-edit-only data-no-export id="learner-lookup"[\s\S]*?_dashLookupHtml\(\)/.test(ui) && !/\['lookup', 'Learner lookup'/.test(ui) && !/if \(dt === 'lookup'\)/.test(ui));
  check('lookup prefs are not persisted', !/_lkQuery|_lkUid/.test(fs.readFileSync(path.join(ROOT, 'js/uiState.js'), 'utf8')));
  console.log(`\n${ok}/${ok + bad} passed`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); process.exit(2); });
