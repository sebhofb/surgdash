// "Data through" on the provider page: the shared control (js/ui.js), the month helpers and the
// report note (js/reports.js), and file names that end where the data ends (js/reportNames.js).
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };

const mkEl = () => ({ style: {}, innerHTML: '', children: [], classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, setAttribute() {}, getAttribute() { return null; }, appendChild() {}, remove() {} });
const store = new Map();
const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, isNaN, isFinite, parseInt, parseFloat, Intl,
  TextEncoder, TextDecoder, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {}, requestAnimationFrame: (f) => f(), URLSearchParams, encodeURIComponent, decodeURIComponent, __swallowed() {},
  document: { addEventListener() {}, body: mkEl(), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => mkEl(), documentElement: { scrollTop: 0 } },
  navigator: { clipboard: { writeText: async () => {} } }, localStorage: { getItem: () => null, setItem() {} }, lucide: { createIcons() {} }, alert() {}, confirm: () => true,
  electronAPI: { fs, path, os: { tmpdir: () => '/tmp' }, invoke: async () => ({}) },
  Storage: { async getItem(k) { return store.has(k) ? store.get(k) : null; }, async setItem(k, v) { store.set(k, v); }, async removeItem(k) { store.delete(k); }, async keys() { return [...store.keys()]; } },
  Projects: { getProject: () => null, getAppSettings: async () => ({}), saveAppSettings: async () => {} } };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['js/app.js', 'js/reportNames.js', 'js/reports.js', 'js/ui.js']) { try { vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }); } catch (e) { check('loads ' + f, false, e.message); } }
const App = ctx.App;
App.renderView = () => { App._renders = (App._renders || 0) + 1; };
App.escapeHtml = (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const setP = (from, to, through) => { App.reportPeriodFrom = from; App.reportPeriodTo = to; App.reportDataThrough = through; };

(async () => {
  // ── months ──
  check('the month in progress, and the last full one', App._currentMonth('2026-10-07') === '2026-10' && App._lastFullMonth('2026-10-07') === '2026-09');
  check('in January the last full month is December of the year before', App._lastFullMonth('2027-01-03') === '2026-12');
  check('without a date, today', /^\d{4}-\d{2}$/.test(App._currentMonth()) && App._lastFullMonth() < App._currentMonth());

  // ── setting it ──
  App._renders = 0;
  await App.setReportDataThrough('2026-09');
  check('setting it is remembered and redraws', App.reportDataThrough === '2026-09' && store.get('report_data_through') === '2026-09' && App._renders === 1);
  await App.setReportDataThrough('');
  check('clearing it goes back to the latest data', App.reportDataThrough === '' && store.get('report_data_through') === '');

  // ── the control ──
  const today = App._currentMonth(), last = App._lastFullMonth();
  setP('', '', '');
  let h = App._dataThroughHtml();
  check('a month picker usable in the reporting role', /<input type="month" data-report-ok value=""/.test(h) && /onchange="App\.setReportDataThrough\(this\.value\)"/.test(h), h.slice(0, 200));
  check('one click leaves out the month in progress', h.includes(`onclick="App.setReportDataThrough('${last}')"`) && />Last full month</.test(h));
  check('unset, it says the month in progress is in', /latest, incl\. \w{3} \d{4} so far/.test(h) && !/✕/.test(h));
  check('the shortcut and ✕ are hidden from viewers, who cannot export', (h.match(/<button data-edit-only data-report-ok/g) || []).length === 1);
  setP('', '', last);
  h = App._dataThroughHtml();
  check('at the last full month: no shortcut, a ✕, and the month shown', !/Last full month/.test(h) && /✕/.test(h) && /to \w{3} \d{4}</.test(h) && !/is complete too/.test(h));
  const older = App._lastFullMonth(last + '-01');
  setP('', '', older);
  h = App._dataThroughHtml();
  check('a remembered month that has fallen behind is flagged', /text-amber-700/.test(h) && /is complete too/.test(h) && /Last full month/.test(h), h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));

  // ── the report says so ──
  setP('', '', ''); check('no cut, no note', App._reportDataThroughNote() === '');
  setP('', '', '2026-09');
  check('with a cut, Methodology & Notes names the month', App._reportDataThroughNote() === 'Monthly charts and period figures stop at September 2026, so a month still in progress does not show as a dip. Headline totals are all-time, as of the report date.');
  setP('2026-07', '', '2026-09'); check('an open period ends at the cut, not "present"', App._periodLabel() === 'Jul 2026 – Sep 2026', App._periodLabel());
  setP('2026-07', '2026-12', '2026-09'); check('a period past the cut ends at the cut', App._periodLabel() === 'Jul 2026 – Sep 2026');
  setP('2026-04', '2026-06', '2026-09'); check('a period before the cut is unchanged', App._periodLabel() === 'Apr 2026 – Jun 2026');
  setP('2026-07', '', ''); check('no cut: an open period still runs to "present"', App._periodLabel() === 'Jul 2026 – present');

  // ── file names end where the data ends ──
  setP('', '', '2026-09'); check('no period, cut at September: "Launch-Sept 2026"', App.reportPeriodFileLabel('2026-10-07') === 'Launch-Sept 2026', App.reportPeriodFileLabel('2026-10-07'));
  setP('2026-07', '', '2026-09'); check('open period: "Jul-Sept 2026", not up to October', App.reportPeriodFileLabel('2026-10-07') === 'Jul-Sept 2026');
  setP('2026-07', '2026-12', '2026-09'); check('period past the cut: capped', App.reportPeriodFileLabel('2026-10-07') === 'Jul-Sept 2026');
  setP('2026-07', '2026-08', '2026-09'); check('period before the cut: unchanged', App.reportPeriodFileLabel('2026-10-07') === 'Jul-Aug 2026');
  setP('2025-11', '', '2026-01'); check('across the year end', App.reportPeriodFileLabel('2026-10-07') === 'Nov 2025-Jan 2026');
  setP('', '', ''); check('nothing set: the export date, as before', App.reportPeriodFileLabel('2026-10-07') === '7 Oct 2026');

  // ── wiring ──
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
  const reports = fs.readFileSync(path.join(ROOT, 'js/reports.js'), 'utf8');
  check('the provider page shows it beside Report period', /\$\{this\._dataThroughHtml\(\)\}\n\s*<div class="flex items-center gap-x-4 gap-y-1 flex-wrap">\$\{this\._courseTogglesHtml\(\{ small: true \}\)\}/.test(ui));
  check('the Reports tab shows the same control', /<div class="mb-6 bg-slate-50 border rounded-lg px-3 py-2 w-fit">\$\{this\._dataThroughHtml\(\)\}<\/div>/.test(ui) && (ui.match(/\$\{this\._dataThroughHtml\(\)\}/g) || []).length === 2);
  check('both report templates carry the note', (reports.match(/<strong[^>]*>Data through:<\/strong> ' \+ esc\(window\.App\._reportDataThroughNote\(\)\)/g) || []).length === 2);
  check('no name clash with the dashboard\'s own freshness line (ui.js _dataThroughNote)', typeof App._dataThroughNote === 'function' && App._reportDataThroughNote !== App._dataThroughNote
    && (fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8').match(/_reportDataThroughNote/g) || []).length === 0);
  check('the reports still cut every timeline at the month', /if \(m > dataThrough\) delete obj\[m\]/.test(reports));

  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})();
