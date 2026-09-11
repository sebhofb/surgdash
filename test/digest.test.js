// Weekly digest: js/digest.js in a VM with fixture data around a fixed "now" (Monday 14 Sep 2026).
const vm = require('vm'), fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };

const NOW = new Date(2026, 8, 14, 9, 30);   // Monday 14 Sep 2026, local
const day = (s) => s;
// rows: dates in the window 7–13 Sep, in the previous window 31 Aug–6 Sep, and outside
const rows = [];
const add = (course, start, cert, enrol) => rows.push({ uid: 'u' + rows.length, course, start_date: start || '', certificate: !!cert, certificate_date: cert || '', enrolled_date: enrol || start || '', source: 'api' });
for (let i = 0; i < 10; i++) add('Course A', day('2026-09-0' + (7 + (i % 3))), i < 4 ? day('2026-09-1' + (i % 3)) : '');   // 10 opened, 4 certs in window
for (let i = 0; i < 6; i++) add('Course B', day('2026-09-1' + (i % 3)), i < 2 ? day('2026-09-12') : '');                     // 6 opened, 2 certs
for (let i = 0; i < 5; i++) add('Course A', day('2026-09-0' + (1 + (i % 5))), i < 1 ? day('2026-09-05') : '');            // prev window: 5 opened, 1 cert
add('Course C', day('2026-08-01'), day('2026-08-20'));                                                                     // outside both
add('Course B', '', day('2026-09-13'), day('2026-09-13'));                                                                   // enrolled + cert without start (counts: enrol 1, cert 1)
const courses = [   // the store keeps one row per course, stamped with its last sync day — never a signal of newness
  { Timestamp: '2026-09-11', Course: 'Course A', Provider: 'Prov X', Learners: 110, CourseCreated: '2024-02-01T10:00:00.000Z' },
  { Timestamp: '2026-09-06', Course: 'Course B', Provider: 'Prov Y', Learners: 56, CourseCreated: '2025-05-01T10:00:00.000Z' },
  { Timestamp: '2026-09-11', Course: 'Course New', Provider: 'Prov Y', Learners: 3, CourseCreated: '2026-09-10T08:48:51.000Z' },
  { Timestamp: '2026-09-11', Course: 'Course Old Resynced', Provider: 'Prov Y', Learners: 9, CourseCreated: '2023-03-07T11:12:43.000Z' },
];
const accounts = { byUid: { a: { c: '2026-09-08', l: '2026-09-12' }, b: { c: '2026-09-01', l: '2026-09-09' }, c: { c: '2026-07-01', l: '2026-09-02' }, d: { c: '2026-09-13', l: '2026-09-13' } }, listedAt: '2026-09-14T02:00:00Z' };

function mk(opts) {
  opts = opts || {};
  const store = new Map(); if (opts.stored) for (const [k, v] of Object.entries(opts.stored)) store.set(k, v);
  const claude = [];
  const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, Intl, isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, __swallowed: () => {},
    Storage: { async getItem(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; }, async setItem(k, v) { store.set(k, JSON.parse(JSON.stringify(v))); } },
    document: { getElementById: () => null },
    navigator: { clipboard: { async writeText(t) { ctx.clip = t; } } },
    electronAPI: { openExternal(h) { ctx.opened = h; } },
    Projects: { registry: [{ id: 'p1', type: 'generic', name: 'Nakuru', shortName: 'Nakuru' }, { id: 's1', type: 'generic', isSample: true, name: 'Sample' }], async getKpiLog(id) { return id === 'p1' ? [{ timestamp: '2026-09-09T10:00:00Z' }, { timestamp: '2026-08-01T10:00:00Z' }] : []; }, async getEvents(id) { return id === 'p1' ? [{ date: '2026-09-10' }] : []; }, async getAppSettings() { return { googleSheetsLastSync: '2026-09-13T20:00:00Z' }; } },
  };
  ctx.window = ctx;
  ctx.App = { view: 'upload', msgs: [], renders: 0, data: courses, userHistory: [{ Timestamp: '2026-09-06', TotalUsers: 63000, TotalCertificates: 33500 }, { Timestamp: '2026-09-11', TotalUsers: 63615, TotalCertificates: 33688 }], ambassadorData: { TotalReferrals: 3300 },
    _rawCompletion: rows, async ensureCompletionLoaded() { return this._rawCompletion; }, getAvailableDates() { return ['2026-09-06', '2026-09-11']; },
    _accounts: opts.noAccounts ? null : accounts, async _accountsLoad() { return this._accounts; },
    _bgSettings: { digest: { enabled: true, day: 1, narrative: false }, history: [{ at: '2026-09-13T00:05:00Z', ok: true }, { at: '2026-09-12T00:05:00Z', ok: false }, { at: '2026-09-01T00:05:00Z', ok: true }], lastRun: { at: '2026-09-13T00:05:00Z' } },
    async _enrLoadMeta() { return { lastRun: '2026-09-13T00:20:00Z', lastMode: 'incremental' }; },
    _deriveVerify: { checks: [{ match: true }, { match: false }, { match: false, noReceipt: true }] },
    formatNumber: (v) => new Intl.NumberFormat('en-US').format(v || 0), escapeHtml: (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    showMsg(m) { this.msgs.push(m); }, renderView() { this.renders++; },
    async _getAnthropicKey() { return opts.noKey ? '' : 'sk-test'; },
    async _claudeJSON(key, system, user, schema, maxTokens, o) { claude.push({ key, system, user, schema, maxTokens, o }); return { narrative: 'This week 16 courses were opened. ' }; },
  };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(ROOT + '/js/digest.js', 'utf8'), ctx, { filename: 'digest.js' });
  return { App: ctx.App, store, ctx, claude };
}

(async () => {
  const h = mk();
  // ── dates ──
  const w = h.App._digestWindow(NOW);
  check('window: Monday 14 Sep → 7–13 Sep, previous 31 Aug–6 Sep', w.from === '2026-09-07' && w.to === '2026-09-13' && w.prevFrom === '2026-08-31' && w.prevTo === '2026-09-06', JSON.stringify(w));
  check('ISO week keys', h.App._digestWeekKey(NOW) === '2026-W38' && h.App._digestWeekKey(new Date(2026, 0, 1)) === '2026-W01' && h.App._digestWeekKey(new Date(2026, 11, 31)) === '2026-W53' || h.App._digestWeekKey(new Date(2026, 11, 31)) === '2027-W01', h.App._digestWeekKey(NOW) + ' ' + h.App._digestWeekKey(new Date(2026, 11, 31)));
  const s = { digest: { enabled: true, day: 1 } };
  check('due: Monday with no digest this week → due; Sunday of a week already covered → not due; already generated this week → not due; Tuesday catch-up → due; disabled → never', h.App._digestDue(s, NOW, null) === true && h.App._digestDue(s, new Date(2026, 8, 13), { week: '2026-W37' }) === false && h.App._digestDue(s, NOW, { week: '2026-W38' }) === false && h.App._digestDue(s, new Date(2026, 8, 15), { week: '2026-W37' }) === true && h.App._digestDue({ digest: { enabled: false, day: 1 } }, NOW, null) === false);
  check('due with day = Wednesday: Monday not due, Wednesday due', h.App._digestDue({ digest: { enabled: true, day: 3 } }, NOW, null) === false && h.App._digestDue({ digest: { enabled: true, day: 3 } }, new Date(2026, 8, 16), null) === true);

  // ── build ──
  const d = await h.App.buildWeeklyDigest({ now: NOW });
  check('counts: 16 opened (10 prev? no: 5), 7 certificates (prev 1), 17 enrolments (prev 5)', d.counts.started === 16 && d.counts.startedPrev === 5 && d.counts.certs === 7 && d.counts.certsPrev === 1 && d.counts.enrol === 17 && d.counts.enrolPrev === 5, JSON.stringify(d.counts));
  check('top courses: A (10 opened, 4 certs, Prov X) then B (6 opened, 3 certs incl. the start-less certificate)', d.courses.length === 2 && d.courses[0].course === 'Course A' && d.courses[0].started === 10 && d.courses[0].certs === 4 && d.courses[0].provider === 'Prov X' && d.courses[1].course === 'Course B' && d.courses[1].started === 6 && d.courses[1].certs === 3, JSON.stringify(d.courses));
  check('providers aggregated', d.providers[0].provider === 'Prov X' && d.providers[0].started === 10 && d.providers[1].provider === 'Prov Y' && d.providers[1].certs === 3);
  check('new course = created this week (CourseCreated 10 Sep); a course merely re-synced on 11 Sep is not new', d.newCourses.length === 1 && d.newCourses[0] === 'Course New', JSON.stringify(d.newCourses));
  check('long lists are capped in the text', h.App._digestListCap(['a','b','c','d'], 2) === 'a, b and 2 more' && h.App._digestListCap(['a'], 2) === 'a');
  check('accounts: 2 new (8 & 13 Sep), 1 new prev (1 Sep); 3 logged in this week, 1 prev', d.accounts.newAcc === 2 && d.accounts.newAccPrev === 1 && d.accounts.active === 3 && d.accounts.activePrev === 1, JSON.stringify(d.accounts));
  check('platform totals from the newest snapshot', d.platform.totalUsers === 63615 && d.platform.totalCertificates === 33688 && d.platform.snapshotDate === '2026-09-11');
  check('SURGfund: 1 KPI edit + 1 activity this week for Nakuru; the sample is ignored', d.surgfund.kpiEdits === 1 && d.surgfund.activities === 1 && d.surgfund.projects.length === 1 && d.surgfund.projects[0].name === 'Nakuru');
  check('health: 2 background runs this week (1 failed), enrolment sync date + mode, Sheets date, 1 provenance check failing (the no-receipt one excluded), data through 11 Sep', d.health.bgRuns === 2 && d.health.bgFailed === 1 && d.health.enrolMode === 'incremental' && d.health.sheetsLastSync === '2026-09-13T20:00:00Z' && d.health.provenanceFailing === 1 && d.health.dataThrough === '2026-09-11', JSON.stringify(d.health));
  check('ambassadors: total now, no previous digest → no delta', d.ambassadors.totalReferrals === 3300 && d.ambassadors.prevTotal === null && d.week === '2026-W38' && d.snapshot.totalReferrals === 3300);

  // ── second digest a week later sees the previous snapshot ──
  await h.App._digestStore(d);
  h.App.ambassadorData.TotalReferrals = 3340;
  const d2 = await h.App.buildWeeklyDigest({ now: new Date(2026, 8, 21, 9) });
  check('next week: ambassadors delta vs the stored digest (+40 since W38)', d2.ambassadors.prevTotal === 3300 && d2.ambassadors.prevWeek === '2026-W38' && d2.week === '2026-W39');

  // ── text ──
  const txt = h.App._digestText(d);
  check('text: headline, the three activity lines with week-over-week, accounts, top courses, health, definitions', /weekly digest — 2026-W38 \(7 Sept? to 13 Sept?/.test(txt) && /Courses opened: 16 \(\+220%, prev 5\)/.test(txt) && /Certificates issued: 7 \(\+600%, prev 1\)/.test(txt) && /New accounts: 2 \(\+100%\)/.test(txt) && /1\. Course A \(Prov X\) — 10 opened, 4 certificates/.test(txt) && /New on the platform \(1\): Course New/.test(txt) && /background runs this week 2 \(1 with problems\)/.test(txt) && /Definitions:/.test(txt), txt.split('\n').slice(0, 6).join(' | '));
  check('percent helper: new / ±0 / signed', h.App._digestPct(5, 0) === 'new' && h.App._digestPct(0, 0) === '±0' && h.App._digestPct(8, 10) === '-20%' && h.App._digestPct(12, 10) === '+20%');

  // ── narrative from the figures only ──
  h.App._digest = d;
  const nar = await h.App.digestWriteNarrative({ silent: true });
  const call = h.claude[0];
  check('narrative: Claude gets exactly the digest facts (no prose), a numbers-only instruction, Opus 4.8, and the text is stored + stamped', nar.startsWith('This week') && JSON.parse(call.user).counts.started === 16 && !('narrative' in JSON.parse(call.user)) && /ONLY numbers present in the JSON/.test(call.system) && call.o.model === 'claude-opus-4-8' && call.schema.required[0] === 'narrative' && h.store.get('surgdash_digest').narrative === nar && !!h.store.get('surgdash_digest').narrativeAt);
  const hk = mk({ noKey: true }); hk.App._digest = d;
  let e1 = null; try { await hk.App.digestWriteNarrative({ silent: true }); } catch (x) { e1 = x; }
  check('no API key → a clear error, no call', e1 && /Claude API key/.test(e1.message) && hk.claude.length === 0);

  // ── copy / email / panel ──
  await h.App.digestCopy();
  check('copy puts the text on the clipboard', h.ctx.clip && h.ctx.clip.startsWith('SURGhub weekly digest'));
  await h.App.digestEmail();
  check('email opens a mailto with subject + body', /^mailto:\?subject=SURGhub%20weekly%20digest%202026-W38/.test(h.ctx.opened) && /body=SURGhub%20weekly%20digest/.test(h.ctx.opened));
  const html = h.App._digestPanelHtml();
  check('panel: tiles, tables, controls (generate/narrative/copy/email), settings (weekly, day, narrative)', /Courses opened/.test(html) && /Course A/.test(html) && /digestGenerateNow/.test(html) && /digestWriteNarrativeClick/.test(html) && /digestCopy/.test(html) && /digestEmail/.test(html) && /digest: \{ enabled: this\.checked \}/.test(html) && /digest: \{ day: Number\(this\.value\) \}/.test(html) && /digest: \{ narrative: this\.checked \}/.test(html) && /AI-written from the figures above only/.test(html));
  const hn = mk(); hn.App._digest = null;
  check('panel without a digest: explains when the first one comes', /No digest yet on this device/.test(hn.App._digestPanelHtml()));
  const ha = mk({ noAccounts: true }); const da = await ha.App.buildWeeklyDigest({ now: NOW });
  check('no account index on this device → account figures omitted, the rest intact', da.accounts.newAcc === null && da.counts.started === 16 && !/New accounts/.test(ha.App._digestText(da)));

  // ── wiring ──
  const bg = fs.readFileSync(ROOT + '/js/backgroundSync.js', 'utf8'), html2 = fs.readFileSync(ROOT + '/index.html', 'utf8'), st = fs.readFileSync(ROOT + '/js/storage.js', 'utf8'), ui = fs.readFileSync(ROOT + '/js/ui.js', 'utf8');
  check('wiring: digest.js loaded after backgroundSync.js; settings default + merge; nightly step after publish; panel on Data Sync; device-local storage key', html2.indexOf('js/digest.js') > html2.indexOf('js/backgroundSync.js') && /digest: \{ enabled: true, day: 1, narrative: false \}/.test(bg) && /digest: Object\.assign\(d\.digest/.test(bg) && /patch\.digest\) \{ Object\.assign\(s\.digest/.test(bg) && /await step\('Weekly digest'/.test(bg) && bg.indexOf("step('Weekly digest'") > bg.indexOf("step('Publish to Sheets'") && /_digestPanelHtml\(\)/.test(ui) && /surgdash_digest'\)\s+return path\.join\('settings', 'digest\.json'\)/.test(st));
  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); process.exit(2); });
