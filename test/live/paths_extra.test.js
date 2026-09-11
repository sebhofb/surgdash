// Extra live-data checks: completed = certificate, chains, top-learning-paths card (2/3/4 courses, sort, min).
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = require('path').resolve(__dirname, '..', '..'), DATA = process.env.SURGDASH_DATA || require('path').join(require('os').homedir(), 'Library', 'Application Support', 'surgdash', 'data');
const rows = JSON.parse(fs.readFileSync(DATA + '/surghub/completion.json', 'utf8'));
const courseList = JSON.parse(fs.readFileSync(DATA + '/surghub/data.json', 'utf8'));
const store = new Map();
const ctx = { console, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, isFinite, isNaN, parseFloat, parseInt, setTimeout, TextDecoder, URLSearchParams, encodeURIComponent, __swallowed: () => {},
  electronAPI: { fs, path },
  Storage: { DATA_DIR: DATA, async getItem(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; }, async setItem(k, v) { store.set(k, JSON.parse(JSON.stringify(v))); } } };
ctx.window = ctx;
ctx.App = { _rawCompletion: rows, data: courseList, includePartialMonth: false, view: 'platform', _dashTab: 'journeys', _accounts: null,
  escapeHtml: (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  escapeJsArg: (t) => String(t).replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
  formatNumber: (n) => Number(n || 0).toLocaleString('en-US'), showMsg: () => {}, renderView: () => {},
  _djb2Hash(str) { let hash = 5381; for (let i = 0; i < str.length; i++) hash = (((hash << 5) + hash) + str.charCodeAt(i)) | 0; return (hash >>> 0).toString(36); },
};
vm.createContext(ctx);
for (const f of ['js/institutions.js', 'js/sparklines.js', 'js/journeys.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const App = ctx.App;
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 220) : '')); };
const idx = App._jrnIndex();
const valid = rows.filter(r => r && r.course && r.uid);
check('completed = certificates (LW flag ignored)', idx.totals.completed === idx.totals.certified && idx.totals.certified === valid.filter(r => r.certificate).length, `${idx.totals.completed} / ${idx.totals.certified}`);
check('every course: completed === certified', [...idx.courses.values()].every(c => c.completed === c.certified));
const expDur = valid.filter(r => r.certificate && r.start_date && ((r.certificate_date || r.completion_date) || '').length >= 10 && (r.certificate_date || r.completion_date).slice(0, 10) >= r.start_date.slice(0, 10)).length;
check('durations = certificates with start and certificate day', idx.totals.durations.length === expDur, `${idx.totals.durations.length} vs ${expDur}`);
const perUid = new Map(); for (const r of valid) { if (!r.start_date) continue; let s = perUid.get(r.uid); if (!s) { s = new Set(); perUid.set(r.uid, s); } s.add(r.course); }
let exp3 = 0, exp4 = 0; for (const s of perUid.values()) { exp3 += Math.max(0, s.size - 2); if (s.size === 4) exp4++; }
check('3-course chains total = Σ max(0, distinct courses − 2)', idx.chains3Total === exp3, `${idx.chains3Total} vs ${exp3}`);
check('learners with exactly 4 courses counted', idx.chains4Learners4 === exp4, `${idx.chains4Learners4} vs ${exp4}`);
check('chains sorted by learners, 3 titles each; 4-chains have 4', idx.chains3.length > 0 && idx.chains3.every((c, i) => c.courses.length === 3 && (i === 0 || idx.chains3[i - 1].n >= c.n)) && idx.chains4.every(c => c.courses.length === 4));
console.log('top 3-chain:', idx.chains3[0].courses.join(' › '), idx.chains3[0].n, '| top 4-chain:', idx.chains4[0] && idx.chains4[0].courses.join(' › '), idx.chains4[0] && idx.chains4[0].n);
const strip = App._jrnCourseStripHtml('Navigating the Global Surgery Ecosystem');
check('funnel strip has three steps', (strip.match(/rounded-lg border border-slate-200 bg-slate-50\/60/g) || []).length === 3);
// card: 2 courses default, sorted by learners
const counts = (html) => [...html.matchAll(/<div class="text-sm font-bold text-gsf-prussian">([\d,]+)<\/div><div class="text-\[10px\] text-slate-400">(\d+(?:\.\d+)?)% of first course/g)].map(m => [Number(m[1].replace(/,/g, '')), Number(m[2])]);
const html = App._dashJourneysHtml();
let c2 = counts(html);
check('card renders: 2-course paths, up to 15 rows, sorted by learners', /Top learning paths/.test(html) && !/chart_jrn_sankey|Sankey/.test(html) && c2.length > 0 && c2.length <= 15 && c2.every((v, i) => i === 0 || c2[i - 1][0] >= v[0]) && !/\$\{/.test(html), c2.slice(0, 4).map(v => v[0]).join(', '));
check('each 2-course row shows two course pills and a gap', (html.match(/d apart/g) || []).length === c2.length && (html.match(/chevron-right/g) || []).length === c2.length);
App._jrnChainLen = 3; const h3 = App._dashJourneysHtml(); const c3 = counts(h3);
check('3-course paths render with two arrows per row, ≥ min learners', c3.length > 0 && (h3.match(/chevron-right/g) || []).length === 2 * c3.length && c3.every(v => v[0] >= App.JRN_PATH_MIN_DEFAULT) && c3[0][0] === idx.chains3[0].n, c3.slice(0, 3).map(v => v[0]).join(', '));
App._jrnChainLen = 4; const h4 = App._dashJourneysHtml(); const c4 = counts(h4);
check('4-course paths render with three arrows per row', c4.length > 0 && (h4.match(/chevron-right/g) || []).length === 3 * c4.length && c4[0][0] === idx.chains4[0].n, c4.slice(0, 3).map(v => v[0]).join(', '));
App._jrnChainLen = 2; App._jrnChainSort = 'share'; const hs = App._dashJourneysHtml(); const cs = counts(hs);
check('sort by share: shares descending, all rows ≥ min learners', cs.length > 0 && cs.every((v, i) => i === 0 || cs[i - 1][1] >= v[1]) && cs.every(v => v[0] >= App.JRN_PATH_MIN_DEFAULT), cs.slice(0, 5).map(v => v[1] + '%').join(', '));
App._jrnChainSort = 'learners'; App._jrnPathMin = 100000; const hm = App._dashJourneysHtml();
check('impossible minimum → friendly empty state', /No 2-course path with 100,?000 or more learners|No 2-course path with 100000 or more learners/.test(hm));
App._jrnPathMin = null;
check('no Sankey leftovers in code', !/Sankey|sankey/.test(fs.readFileSync(path.join(ROOT, 'js/journeys.js'), 'utf8')) && !/_drawJourneyCharts/.test(fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8')));
console.log(`\n${ok}/${ok + bad} passed`);
process.exit(bad ? 1 : 0);
