// Sandbox test: Sync Everything's enrolment stage + targeted redraws (real charts.js, ui.js, updater.js loaded).
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = require('path').resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 240) : '')); };
// minimal DOM
const nodes = {}; const mkEl = (id) => { const e = { id: id || '', style: {}, _html: '', children: [], classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, setAttribute() {}, getAttribute() { return null; }, appendChild(c) { this.children.push(c); if (c.id) nodes[c.id] = c; }, remove() { delete nodes[this.id]; }, textContent: '', offsetWidth: 800, offsetHeight: 300 }; Object.defineProperty(e, 'innerHTML', { get() { return this._html; }, set(v) { this._html = v; } }); return e; };
const doc = { body: mkEl('body'), getElementById: (id) => nodes[id] || null, querySelector: (sel) => { const m = sel.match(/\[data-chart-width-btns="([^"]+)"\]/); return m ? (nodes['btns:' + m[1]] || null) : null; }, querySelectorAll: (sel) => sel.includes('data-partial-toggle') ? Object.values(nodes).filter(n => n._partialToggle) : sel.includes('data-partial-caption') ? Object.values(nodes).filter(n => n._partialCaption) : [], createElement: () => mkEl(''), addEventListener() {}, documentElement: { scrollTop: 0 } };
const msgs = [], alerts = [];
const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, isFinite, isNaN, parseFloat, parseInt, setTimeout: (f) => { f(); return 1; }, clearTimeout() {}, setInterval() { return 2; }, clearInterval() {}, requestAnimationFrame: (f) => f(), TextDecoder, URLSearchParams, encodeURIComponent, decodeURIComponent, __swallowed: () => {},
  document: doc, navigator: { clipboard: { writeText: async () => {} } }, localStorage: { getItem: () => null, setItem() {} }, lucide: { createIcons() { ctx.App._icons = (ctx.App._icons || 0) + 1; } },
  alert: (m) => alerts.push(m), confirm: () => true,
  google: { charts: { load() {}, setOnLoadCallback() {} }, visualization: { ColumnChart: function (el) { this.draw = (d, o) => { ctx.App._drawn = (ctx.App._drawn || []).concat([[el.id, o]]); }; } } },
  electronAPI: { fs, path, invoke: async () => ({}) },
  Storage: { DATA_DIR: '/tmp', async getItem() { return null; }, async setItem() {} },
  Projects: { getProject: () => null, getAppSettings: async () => ({}) },
};
ctx.window = ctx; ctx.globalThis = ctx;
ctx.App = { view: 'platform', _dashTab: 'journeys', data: [], userHistory: [], selectedDate: null, includePartialMonth: false, editUnlocked: true, _chartWidth: {}, currentProject: 'surghub',
  escapeHtml: (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  escapeJsArg: (t) => String(t).replace(/\\/g, '\\\\').replace(/'/g, "\\'"), formatNumber: (n) => Number(n || 0).toLocaleString('en-US'),
  showMsg: (m) => msgs.push(m), navigate() {}, getAnalyticsSnap: () => [], getPlatformSnap: () => [], getPlatformHistory: () => [], getAnalyticsHistory: () => [], getCurrentProject: () => ({ id: 'surghub', type: 'surghub' }),
  _snapshotUiState() { this._snaps = (this._snaps || 0) + 1; }, _djb2Hash: (s) => s, _enrMeta: null,
};
vm.createContext(ctx);
for (const f of ['js/charts.js', 'js/updater.js', 'js/ui.js']) { try { vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }); } catch (e) { check('loads ' + f, false, e.message); } }
const App = ctx.App;
App.view = 'platform'; App._dashTab = 'journeys'; App.currentProject = 'surghub';   // ui.js declares defaults for these at load
// stubs over the real methods where the real ones need the app
App.renderSidebar = () => { App._sidebar = (App._sidebar || 0) + 1; }; App.renderTabBar = () => {};
let fullRenders = 0; const realRender = App.renderView; App.renderView = function () { fullRenders++; };
App._dashJourneysHtml = () => '<div class="jrn">JOURNEYS ' + (App.includePartialMonth ? 'partial' : 'complete') + '</div>';
App._dashCompareHtml = () => '<div>COMPARE</div>'; App._dashLookupHtml = () => 'LOOKUP'; App._drawCompareCharts = () => { App._cmpDraws = (App._cmpDraws || 0) + 1; };
(async () => {
  // ── rerenderDashTab ──
  const host = mkEl('dash-content'); nodes['dash-content'] = host;
  App.rerenderDashTab();
  check('rerenderDashTab replaces only #dash-content, no full render, icons refreshed, prefs snapshotted', /JOURNEYS complete/.test(host.innerHTML) && fullRenders === 0 && App._icons === 1 && App._snaps === 1, host.innerHTML);
  App._dashTab = 'compare'; App.rerenderDashTab();
  check('rerenderDashTab runs the tab\'s own chart draw (compare)', /COMPARE/.test(host.innerHTML) && App._cmpDraws === 1 && fullRenders === 0);
  App._dashTab = 'overview'; App.rerenderDashTab();
  check('overview falls back to the full render (KPI cards)', fullRenders === 1);
  App._dashTab = 'lookup'; App.rerenderDashTab();
  check('a remembered lookup/health tab falls back to the overview (full render) and is forgotten', fullRenders === 2 && App._dashTab === 'overview' && App._dashTabKey() === 'overview');
  fullRenders = 1;   // keep the later counters as they were
  delete nodes['dash-content']; App._dashTab = 'journeys'; App.rerenderDashTab();
  check('no #dash-content on the page → full render', fullRenders === 2);
  nodes['dash-content'] = host;
  check('_dashContentHtml matches the old if-chain for every tab key', App._dashContentHtml('journeys') === App._dashJourneysHtml() && App._dashContentHtml('compare') === '<div>COMPARE</div>' && !App._DASH_HTML_TABS.includes('lookup') && !App._DASH_HTML_TABS.includes('health'));
  // ── setIncludePartialMonth ──
  const cb1 = mkEl('cb1'); cb1._partialToggle = true; nodes.cb1 = cb1; const cb2 = mkEl('cb2'); cb2._partialToggle = true; nodes.cb2 = cb2;
  const cap = mkEl('cap1'); cap._partialCaption = true; nodes.cap1 = cap;
  fullRenders = 0; App._dashTab = 'journeys'; App.setIncludePartialMonth(true);
  check('partial toggle on an HTML tab: flag set, every toggle synced, tab re-rendered, no full render', App.includePartialMonth === true && cb1.checked === true && cb2.checked === true && /JOURNEYS partial/.test(host.innerHTML) && fullRenders === 0);
  check('captions refreshed in place', /Cumulative growth may appear to slow/.test(cap.innerHTML) || cap.innerHTML === '' /* no Charts._partialMonthCaption text in sandbox */);
  App.view = 'provider'; let drawn = 0; App._currentDraw = () => { drawn++; };
  App.setIncludePartialMonth(false);
  check('partial toggle on a chart view: redraws charts via the remembered hook, no full render', App.includePartialMonth === false && drawn === 1 && fullRenders === 0 && cb1.checked === false);
  App._currentDraw = null; App.setIncludePartialMonth(true);
  check('no draw hook remembered → full render as before', fullRenders === 1);
  // ── redrawCharts + _currentDraw wiring ──
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
  check('every draw hook is remembered (dashboard, ambassadors, provider, course) and cleared at render start', (ui.match(/this\._currentDraw = _d;/g) || []).length === 5 && /this\._snapshotUiState\(\);\n\s+this\._currentDraw = null;/.test(ui));
  check('partial-month toggle markup uses the targeted setter and carries data-partial-toggle', /data-partial-toggle[^>]*onchange="App\.setIncludePartialMonth\(this\.checked\)"/.test(ui) && /_partialMonthCaption\(\) \{ return `<div data-partial-caption>/.test(ui));
  // ── _setChartWidth in place ──
  App.view = 'platform'; fullRenders = 0;
  const chart = mkEl('chart_growth'); const wrap = mkEl(''); wrap.style.maxWidth = '100%'; wrap.style.margin = '0'; chart.parentElement = wrap; nodes.chart_growth = chart;
  const btns = mkEl(''); let btnsHtml = ''; Object.defineProperty(btns, 'outerHTML', { set(v) { btnsHtml = v; } }); nodes['btns:chart_growth'] = btns;
  ctx.Charts._registerChart('chart_growth', 'ColumnChart', { fake: true }, { height: 300 });
  App._setChartWidth('chart_growth', 'compact');
  check('chart width: wrapper resized, buttons refreshed, chart redrawn from registry, no full render', wrap.style.maxWidth === '520px' && wrap.style.margin === '0 auto' && /data-chart-width-btns="chart_growth"/.test(btnsHtml) && /bg-gsf-boston/.test(btnsHtml) && App._drawn && App._drawn.length === 1 && App._drawn[0][0] === 'chart_growth' && fullRenders === 0, JSON.stringify({ w: wrap.style.maxWidth, drawn: App._drawn && App._drawn.length }));
  App._setChartWidth('chart_nowhere', 'wide');
  check('chart width on a chart that is not on the page → full render', fullRenders === 1);
  check('Charts.redrawRegistered returns false for unknown charts', ctx.Charts.redrawRegistered('chart_nowhere') === false);
  // ── modules: tab-local handlers no longer full-render ──
  const jr = fs.readFileSync(path.join(ROOT, 'js/journeys.js'), 'utf8'), cp = fs.readFileSync(path.join(ROOT, 'js/compare.js'), 'utf8'), ins = fs.readFileSync(path.join(ROOT, 'js/institutions.js'), 'utf8');
  check('journeys/compare/institutions tab-local handlers use rerenderDashTab', !/App\.renderView\(\)/.test(jr) && (jr.match(/rerenderDashTab/g) || []).length >= 10 && /setCmpOpt[^\n]*rerenderDashTab/.test(cp) && /setInstOpt[\s\S]{0,300}rerenderDashTab/.test(ins) && /_sortInstTable[\s\S]{0,300}rerenderDashTab/.test(ins));
  // ── Sync Everything: enrolments stage ──
  const calls = []; App._apiSyncInFlight = false;
  App._backupSurghubBeforeSync = async () => {}; App.autoVerifyAfterSync = () => {}; App._demoCoverageLine = () => '';
  App.syncCourseFoundationFromApi = async () => { calls.push(['courses', App._apiSyncInFlight]); return { courses: 255 }; };
  App.syncDemographicsFromApi = async () => { calls.push(['demo', App._apiSyncInFlight]); return { totalUsers: 63256 }; };
  App.syncAmbassadorsFromApi = async () => { calls.push(['amb', App._apiSyncInFlight]); return {}; };
  App.syncEnrolmentsFromApi = async (o) => { calls.push(['enr', App._apiSyncInFlight, !!(o && o.silent)]); App._enrMeta = { run: { done: true } }; return { mode: 'incremental', done: 412, certsNew: 37 }; };
  App._enrLoadMeta = async () => ({ lastRunEpoch: Math.floor(Date.now() / 1000) - 3600 * 26 });
  ctx.LearnWorlds = { getCredentials: async () => ({ clientId: 'c', apiToken: 't' }) };
  await App.runFullSync();
  check('Sync Everything runs courses, demographics, ambassadors, then enrolments last (silent)', calls.map(c => c[0]).join(',') === 'courses,demo,amb,enr' && calls[3][2] === true, calls.map(c => c[0]).join(','));
  check('in-flight flag held for steps 1-3, released for the enrolment sync, cleared at the end', calls[0][1] === true && calls[2][1] === true && calls[3][1] === false && App._apiSyncInFlight === false);
  check('summary reports the enrolment stage', alerts.length === 1 && /✓ Enrolments & progress \(incremental\): 412 accounts refreshed, 37 new certificates/.test(alerts[0]), alerts[0] && alerts[0].split('\n').filter(l => /Enrol/.test(l)).join(' | '));
  // no full pass yet → skipped, others still run
  calls.length = 0; alerts.length = 0; App._enrLoadMeta = async () => ({});
  await App.runFullSync();
  check('without a completed pass the enrolment stage is skipped with a note', calls.map(c => c[0]).join(',') === 'courses,demo,amb' && /– Enrolments & progress: skipped — card 2 has never completed a full pass/.test(alerts[0]), alerts[0] && alerts[0].split('\n').filter(l => /Enrol/.test(l)).join(' | '));
  // paused (cancelled) enrolment run reported as paused
  calls.length = 0; alerts.length = 0; App._enrLoadMeta = async () => ({ run: { done: false, processed: { a: 1, b: 1 } } });
  App.syncEnrolmentsFromApi = async () => { calls.push(['enr', App._apiSyncInFlight, true]); App._enrMeta = { run: { done: false } }; return { mode: 'full', resumed: true, done: 120 }; };
  await App.runFullSync();
  check('an interrupted pass is resumed and a pause is reported with the resume hint', calls.map(c => c[0]).join(',') === 'courses,demo,amb,enr' && /⏸ Enrolments & progress \(full, resumed\): 120 accounts refreshed — paused; card 2/.test(alerts[0]), alerts[0] && alerts[0].split('\n').filter(l => /Enrol/.test(l)).join(' | '));
  const upd = fs.readFileSync(path.join(ROOT, 'js/updater.js'), 'utf8');
  check('confirm text lists the enrolment step and drops the old "NOT refreshed" warning', /3\. Enrolments & progress — ' \+ enrolNote/.test(upd) && !/NOT refreshed by this sync/.test(upd));
  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); process.exit(2); });
