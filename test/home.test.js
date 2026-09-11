// Home screen: js/home.js in a VM with fixture data around a fixed "now" (Friday 11 Sep 2026).
// digest.js is loaded alongside it on purpose — Home reuses the digest's window helpers so the
// two can never disagree about what "this week" means; a test that stubbed them would hide that.
const vm = require('vm'), fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };

const NOW = new Date(2026, 8, 11, 16, 5);   // Friday 11 Sep 2026, local → window 4–10 Sep, previous 28 Aug–3 Sep

// completion rows: exact dates, the same shape card 2 writes
const rows = [];
const add = (course, start, cert, enrol) => rows.push({ uid: 'u' + rows.length, course, start_date: start || '', certificate: !!cert, certificate_date: cert || '', enrolled_date: enrol || start || '' });
for (let i = 0; i < 9; i++) add('Course A', '2026-09-0' + (4 + (i % 3)), i < 3 ? '2026-09-09' : '');     // window: 9 opened, 3 certs
for (let i = 0; i < 4; i++) add('Course B', '2026-09-1' + 0, i < 2 ? '2026-09-10' : '');                 // window: 4 opened, 2 certs
for (let i = 0; i < 6; i++) add('Course A', '2026-09-0' + (1 + (i % 3)), i < 1 ? '2026-09-02' : '');     // previous: 6 opened, 1 cert
add('Course C', '2026-07-01', '2026-07-20');                                                             // outside both
add('Course B', '', '', '2026-09-05');                                                                   // enrolled in window, never opened

const courses = [
  { Timestamp: '2026-09-11', Course: 'Course A', Provider: 'Prov X', Learners: 110 },
  { Timestamp: '2026-09-06', Course: 'Course B', Provider: 'Prov OLD', Learners: 56 },
  { Timestamp: '2026-09-11', Course: 'Course B', Provider: 'Prov Y', Learners: 58 },   // newest row wins for the provider
];
const accounts = { byUid: {
  a: { c: '2026-09-05', l: '2026-09-10' },   // new + active in window
  b: { c: '2026-09-01', l: '2026-09-07' },   // new in previous, active in window
  c: { c: '2026-06-01', l: '2026-09-02' },   // active in previous only
  d: { c: '2026-09-09', l: '2026-09-09' },   // new + active in window
} };

function mk(opts) {
  opts = opts || {};
  const store = new Map(); if (opts.stored) for (const [k, v] of Object.entries(opts.stored)) store.set(k, v);
  const writes = [];
  const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, Intl, isNaN, isFinite, parseInt, parseFloat, setTimeout, clearTimeout,
    __swallowed() {},
    Storage: {
      async getItem(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; },
      async setItem(k, v, o) { writes.push({ k, internal: !!(o && o.internal) }); store.set(k, JSON.parse(JSON.stringify(v))); },
    },
    document: { getElementById: (id) => ctx.els[id] || null, querySelector: () => null },
    Projects: {
      registry: [
        { id: 'p1', type: 'generic', name: 'Nakuru', shortName: 'Nakuru' },
        { id: 'p2', type: 'generic', name: 'Kano' },
        { id: 's1', type: 'generic', isSample: true, name: 'Sample' },
        { id: 'surghub', type: 'surghub', name: 'SURGhub' },
      ],
      getProject(id) { return this.registry.find(p => p.id === id) || null; },
      // p1's newer entry is ISO; the older one is a raw Date.toString(), as the app wrote them for years
      async getKpiLog(id) { return id === 'p1' ? [{ timestamp: '2026-09-08T10:00:00Z' }, { timestamp: '2026-05-01T10:00:00Z' }] : (id === 'p2' ? [{ timestamp: String(new Date(2026, 8, 7, 16, 12, 39)) }] : []); },
      async getEvents(id) { return id === 'p1' ? [{ date: '2026-09-09' }, { date: '2026-01-02' }] : (id === 'p2' ? [{ date: '2026-01-05' }] : []); },
      // p1 has reported this year; p2 has an empty row for it (entered nothing yet)
      async getActuals(id) { return id === 'p1' ? [{ year: 2025, kpis: { a: 1 } }, { year: 2026, kpis: { patients_reached: 120 } }] : [{ year: 2026, kpis: {} }, { year: 2025, kpis: { a: 4 } }]; },
      async getAppSettings() { return opts.appSettings || { googleSheetsLastSync: '2026-09-11T09:35:00Z', googleSheetsUrl: 'https://example.invalid/exec' }; },
    },
  };
  ctx.window = ctx;
  ctx.els = { 'view-body': { innerHTML: '' } };
  ctx.App = {
    view: 'home', currentProject: 'home', msgs: [], renders: 0, editUnlocked: true, includeSample: false,
    data: courses, _rawCompletion: opts.noRows ? [] : rows,
    userHistory: [{ Timestamp: '2026-09-06', TotalUsers: 63000, TotalCertificates: 27900 }, { Timestamp: '2026-09-11', TotalUsers: 63527, TotalCertificates: 28259 }],
    async ensureCompletionLoaded() { return this._rawCompletion; },
    getAvailableDates() { return opts.noData ? [] : ['2026-09-06', '2026-09-11']; },
    _accounts: opts.noAccounts ? null : accounts, async _accountsLoad() { return this._accounts; },
    async _enrLoadMeta() { return { lastRun: opts.enrolRun || '2026-09-11T07:52:41Z', lastMode: 'incremental' }; },
    _bgSettings: opts.bg || { lastRun: { at: '2026-09-11T07:52:41Z', ok: true }, history: [] },
    _deriveVerify: opts.derive || { checks: [{ match: true }, { match: false }, { match: false, noReceipt: true }] },
    _uiState: opts.uiState || {}, _saveUiState() { this.uiSaved = (this.uiSaved || 0) + 1; },
    _unsyncedDirty: !!opts.dirty,
    formatNumber: (v) => new Intl.NumberFormat('en-US').format(v || 0),
    escapeHtml: (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    escapeJsArg: (t) => String(t).replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
    showMsg(m) { this.msgs.push(m); }, renderView() { this.renders++; },
    _restoreLastScreen() { this.restored = true; return !!(this._uiState && this._uiState._lastScreen); },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ROOT + '/js/digest.js', 'utf8'), ctx, { filename: 'digest.js' });
  vm.runInContext(fs.readFileSync(ROOT + '/js/home.js', 'utf8'), ctx, { filename: 'home.js' });
  return { App: ctx.App, store, writes, ctx };
}

(async () => {
  const h = mk();
  const s = await h.App.buildHomeStats({ now: NOW });

  // ── the window is the digest's window ──
  const w = h.App._digestWindow(NOW);
  check('Home and the weekly digest share one window definition (Fri 11 Sep → 4–10 Sep vs 28 Aug–3 Sep)',
    s.from === w.from && s.to === w.to && s.prevFrom === w.prevFrom && s.prevTo === w.prevTo && s.from === '2026-09-04' && s.prevTo === '2026-09-03',
    s.from + '→' + s.to + ' vs ' + s.prevFrom + '→' + s.prevTo);

  // ── counts ──
  check('courses opened, this window and the one before, counted from exact start dates',
    s.counts.started === 13 && s.counts.startedPrev === 6, s.counts.started + ' vs ' + s.counts.startedPrev);
  check('certificates counted only when the row actually carries one',
    s.counts.certs === 5 && s.counts.certsPrev === 1, s.counts.certs + ' vs ' + s.counts.certsPrev);
  check('an enrolment without an opening still counts as an enrolment',
    s.counts.enrol === 14 && s.counts.started === 13, 'enrol ' + s.counts.enrol + ' started ' + s.counts.started);

  // ── top courses ──
  check('top courses ranked by openings, with the provider from that course\'s newest row',
    s.courses.length === 2 && s.courses[0].course === 'Course A' && s.courses[0].started === 9 && s.courses[0].certs === 3
      && s.courses[1].course === 'Course B' && s.courses[1].provider === 'Prov Y',
    JSON.stringify(s.courses.map(c => c.course + '/' + c.provider + '/' + c.started)));
  check('the top list is capped', s.courses.length <= h.App.HOME_TOP, s.courses.length + ' ≤ ' + h.App.HOME_TOP);

  // ── accounts ──
  check('sign-ups and logins from the hashed index, both windows',
    s.accounts.newAcc === 2 && s.accounts.newAccPrev === 1 && s.accounts.active === 3 && s.accounts.activePrev === 1,
    JSON.stringify(s.accounts));
  const h2 = mk({ noAccounts: true });
  const s2 = await h2.App.buildHomeStats({ now: NOW });
  check('no account index on this device: the account figures stay null rather than reading zero',
    s2.accounts.newAcc === null && s2.accounts.active === null, JSON.stringify(s2.accounts));

  // ── SURGfund ──
  check('SURGfund counts real projects only (the sample is blended out), with this week\'s edits',
    s.surgfund.projects === 2 && s.surgfund.kpiEdits === 2 && s.surgfund.activities === 1,
    JSON.stringify(s.surgfund));
  check('a KPI edit stamped the old way (Date.toString, not ISO) is still counted — it used to read as zero',
    s.surgfund.kpiEdits === 2, JSON.stringify({ kpiEdits: s.surgfund.kpiEdits, activities: s.surgfund.activities }));
  check('an unparseable stamp is ignored rather than guessed at',
    h.App._digestDayOf('not a date') === '' && h.App._digestDayOf('') === '' && h.App._digestDayOf(null) === ''
      && h.App._digestDayOf('2026-09-08T10:00:00Z') === '2026-09-08' && h.App._digestDayOf(String(new Date(2026, 8, 7, 16, 12))) === '2026-09-07');
  check('this year\'s KPI reporting progress, naming who has not reported (an empty row does not count)',
    s.surgfund.year === 2026 && s.surgfund.reported === 1 && s.surgfund.missing.join() === 'Kano' && s.surgfund.lastTouched === '2026-09-09',
    JSON.stringify({ year: s.surgfund.year, reported: s.surgfund.reported, missing: s.surgfund.missing, last: s.surgfund.lastTouched }));
  check('missing KPI figures are raised on the attention list, not buried',
    (() => { const g = mk(); const l = g.App._homeAttention({ dataThrough: '2026-09-11', fund: s.surgfund }); return l.some(i => /2026 KPI figures are still missing for 1 of 2/.test(i.text)); })());
  check('a fully reported portfolio raises nothing',
    (() => { const g = mk(); const l = g.App._homeAttention({ dataThrough: '2026-09-11', fund: { projects: 2, reported: 2, year: 2026, missing: [] } }); return !l.some(i => /KPI figures/.test(i.text)); })());

  // ── cache ──
  const w1 = h.writes.filter(x => x.k === 'surgdash_home');
  check('the figures are cached device-locally, written as an internal change (never marks data dirty)',
    w1.length === 1 && w1[0].internal === true);
  const before = h.App._homeStats.builtAt;
  await h.App.buildHomeStats({ now: NOW });
  check('same day, same data: the cache is reused, not recomputed',
    h.App._homeStats.builtAt === before && h.writes.filter(x => x.k === 'surgdash_home').length === 1);
  await h.App.buildHomeStats({ now: new Date(2026, 8, 12, 9, 0) });
  check('the day turns: the figures are rebuilt', h.writes.filter(x => x.k === 'surgdash_home').length === 2);
  const h3 = mk({ stored: { surgdash_home: { v: 1, builtFor: '2026-09-11', srcStamp: 'stale|stale', counts: { started: 1 } } } });
  const s3 = await h3.App.buildHomeStats({ now: NOW });
  check('a sync during the day invalidates the cache even though the date has not changed',
    s3.counts.started === 13 && s3.srcStamp.indexOf('2026-09-11') === 0, s3.srcStamp);
  check('the cache key is forward-only in storage.js — never enumerated, pushed, exported or restored',
    /surgdash_home'\)\s*return path\.join\('settings', 'home\.json'\)/.test(fs.readFileSync(ROOT + '/js/storage.js', 'utf8'))
      && !/'home':\s*'surgdash_home'/.test(fs.readFileSync(ROOT + '/js/storage.js', 'utf8')));

  // ── attention ──
  const at = (o) => { const g = mk(o); return g.App._homeAttention({ dataThrough: o && o.noData ? '' : '2026-09-11', unsynced: !!(o && o.dirty) }); };
  check('a healthy device flags only the failing provenance check', at().length === 1 && /no longer reproduce/.test(at()[0].text), JSON.stringify(at().map(i => i.text)));
  check('a check that has no receipt to compare against is not counted as failing',
    at({ derive: { checks: [{ match: true }, { match: false, noReceipt: true }] } }).length === 0);
  check('stale course data is flagged with its age', /Course data is \d+ days old/.test(JSON.stringify(at({ derive: { checks: [] } }).concat(mk().App._homeAttention({ dataThrough: '2026-08-01' })).map(i => i.text))));
  check('a background sync that did not finish is flagged',
    at({ derive: { checks: [] }, bg: { lastRun: { at: '2026-09-11T07:00:00Z', ok: false } } }).some(i => /did not finish/.test(i.text)));
  check('a background sync that has not run for days is flagged',
    at({ derive: { checks: [] }, bg: { lastRun: { at: '2026-09-01T07:00:00Z', ok: true } } }).some(i => /last completed \d+ days ago/.test(i.text)));
  check('unpublished local changes are flagged with a one-click push',
    at({ derive: { checks: [] }, dirty: true }).some(i => /not been published/.test(i.text) && i.fn === 'App.syncNow()'));
  check('an empty device says so instead of reporting all-clear',
    (() => { const g = mk({ noData: true }); g.App.data = []; const l = g.App._homeAttention({ dataThrough: '' }); return l.length === 1 && /No SURGhub data/.test(l[0].text); })());
  check('a digest for the current week is offered', (() => { const g = mk(); g.App._digest = { week: g.App._digestWeekKey(new Date()) }; return g.App._homeAttention({ dataThrough: '2026-09-11' }).some(i => /digest for/.test(i.text)); })());
  check('last week\'s digest is not offered as if it were new', (() => { const g = mk(); g.App._digest = { week: '2020-W01' }; return !g.App._homeAttention({ dataThrough: '2026-09-11' }).some(i => /digest for/.test(i.text)); })());

  // ── render ──
  const html = h.App._homeHtml(s);
  check('the page renders the platform totals, the window figures and the top courses',
    /63,527/.test(html) && /28,259/.test(html) && />13</.test(html) && /Course A/.test(html) && /Prov Y/.test(html));
  check('every tile names the comparison period rather than a bare percentage',
    html.indexOf(h.App._digestFmtDay('2026-09-04') + ' to ' + h.App._digestFmtDay('2026-09-10')) > 0 && /before<\/span>/.test(html));
  check('a rise reads as green and a fall as amber — never as an error',
    (() => {
      const up = h.App._homeHtml(s);                                   // every fixture figure rises
      const fell = JSON.parse(JSON.stringify(s)); fell.counts.started = 4; fell.counts.startedPrev = 40;
      const down = h.App._homeHtml(fell);
      return /▲/.test(up) && !/▼/.test(up) && /▼/.test(down) && /text-amber-600/.test(down) && /text-green-600/.test(up) && !/text-red-/.test(down);
    })());
  check('the SURGfund card states the reporting position in words, not a bare count',
    /2026 figures entered for 1 of 2/.test(html) && /still to come: Kano/.test(html), (html.match(/\d{4} figures entered for [^<]*/) || [''])[0]);
  check('the page is marked never-export and carries no personal data',
    /data-no-export/.test(html) && !/@/.test(html.replace(/&#39;|&quot;|&amp;/g, '')));
  check('a first paint with no figures yet shows placeholders, never zeroes',
    (() => { const skel = h.App._homeHtml(null); return /calculating/.test(skel) && !/>0</.test(skel) && /63,527/.test(skel); })());
  check('the destructive-looking actions are edit-only; the rest work for viewers',
    /data-edit-only onclick="App.runFullSync\(\)"/.test(html) && /data-viewer-allowed[^>]*homeGo\('surghub','upload'\)/.test(html));
  check('the open-on-launch checkbox is device-local and reflects the stored preference',
    /Open Home on launch/.test(html) && /checked/.test(html) && /homeSetOnLaunch\(this\.checked\)/.test(html));
  check('turning the launch preference off is remembered', (() => { const g = mk(); g.App.homeSetOnLaunch(false); return g.App._uiState.homeOnLaunch === false && g.App._homeOnLaunch() === false && g.App.uiSaved === 1; })());
  check('the preference defaults to on when nothing is stored', mk().App._homeOnLaunch() === true);

  // ── continue where you left off ──
  const g1 = mk({ uiState: { _lastScreen: { project: 'surghub', view: 'platform' } } });
  check('the continue button names the remembered screen', g1.App._homeLastScreen() === 'SURGhub dashboard', g1.App._homeLastScreen());
  const g2 = mk({ uiState: { _lastScreen: { project: 'p1', view: 'project-dashboard' } } });
  check('a remembered project screen is named by its project', g2.App._homeLastScreen() === 'Nakuru · Dashboard', g2.App._homeLastScreen());
  const g3 = mk({ uiState: { _lastScreen: { project: 'gone', view: 'project-dashboard' } } });
  check('a project that no longer exists is not offered', g3.App._homeLastScreen() === null);
  check('Home never offers itself as the screen to return to', mk({ uiState: { _lastScreen: { project: 'home', view: 'home' } } }).App._homeLastScreen() === null);
  check('the fallback when nothing is remembered opens the SURGhub dashboard',
    (() => { const g = mk(); g.App.homeContinue(); return g.App.currentProject === 'surghub' && g.App.view === 'platform'; })());

  // ── freshness line ──
  const line = h.App._homeFreshnessLine('2026-09-11', { googleSheetsLastSync: '2026-09-11T09:35:00Z' });
  check('the freshness line names the data date, the last sync and the last publish',
    /Course data through 11 Sep/.test(line) && /last sync/.test(line) && /published to Sheets/.test(line), line);
  check('an older sync is reported in days, not as a time of day',
    / 3 days ago/.test(mk({ bg: { lastRun: { at: new Date(Date.now() - 3 * 86400000).toISOString(), ok: true } } }).App._homeFreshnessLine('2026-09-11', {})));

  // ── wiring (read from the real files) ──
  const ui = fs.readFileSync(ROOT + '/js/ui.js', 'utf8');
  const app = fs.readFileSync(ROOT + '/js/app.js', 'utf8');
  const uiState = fs.readFileSync(ROOT + '/js/uiState.js', 'utf8');
  const renderViewBody = ui.slice(ui.indexOf('    renderView() {'));
  check('renderView routes the home view to home.js before any project view',
    renderViewBody.indexOf("this.view === 'home' && this.renderHome") > 0
      && renderViewBody.indexOf("this.view === 'home' && this.renderHome") < renderViewBody.indexOf("if (project.type === 'org')")
      && renderViewBody.indexOf("this.view === 'home' && this.renderHome") < renderViewBody.indexOf("this.view === 'new-project'"));
  check('Home has no tab bar', /this\.view === 'new-project' \|\| this\.view === 'home'\) \{ tabsEl\.innerHTML = ''/.test(ui));
  check('the sidebar shows Home above Organisation', ui.indexOf('data-proj="home"') > 0 && ui.indexOf('data-proj="home"') < ui.indexOf('data-proj="org"'));
  check('getCurrentProject knows the Home pseudo-project', /currentProject === 'home'\) return Projects\.HOME_PROJECT/.test(app) && /HOME_PROJECT: \{[\s\S]{0,120}type: 'home'/.test(fs.readFileSync(ROOT + '/js/projects.js', 'utf8')));
  check('switching to Home opens the home view', /projectId === 'home'\) \{\s*\n\s*this\.view = 'home';/.test(app));
  check('launch lands on Home unless the device opted out or there is nothing to show',
    /_homeOnLaunch\(\) && _hasSomething/.test(app) && /_hasSomething =[\s\S]{0,220}registry\.some/.test(app));
  check('Home is never recorded as the screen to come back to', /_SCREEN_SKIP: \[[^\]]*'home'\]/.test(uiState));
  check('unlocking while on Home stays on Home', /_restoreLastScreenOnUnlock\(\) \{[\s\S]{0,400}this\.view === 'home'\) return false;/.test(uiState));
  check('home.js is loaded after digest.js, whose window helpers it reuses',
    (() => { const idx = fs.readFileSync(ROOT + '/index.html', 'utf8'); return idx.indexOf('js/home.js') > idx.indexOf('js/digest.js'); })());

  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})();
