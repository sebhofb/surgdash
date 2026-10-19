// GSF website figures (js/websiteMetrics.js): the six totals, computed with the report
// toggles off; the safety checks that keep the last good figures online; and the quick
// publish of metrics.json on top of the reports site.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };

const store = new Map(), calls = [];
const gh = async (req) => {
  calls.push(req);
  const p = req.url.replace(/^https:\/\/api\.github\.com\/repos\/gsf\/reports/, ''), body = req.body ? JSON.parse(req.body) : null, ok_ = (st, j) => ({ statusCode: st, body: JSON.stringify(j) });
  if (req.method === 'GET' && p === '/git/ref/heads/main') return ok_(200, { object: { sha: 'head1' } });
  if (req.method === 'GET' && p === '/git/commits/head1') return ok_(200, { tree: { sha: 'tree0' } });
  if (req.method === 'POST' && p === '/git/blobs') return ok_(201, { sha: 'blobM' });
  if (req.method === 'POST' && p === '/git/trees') return ok_(201, { sha: 'treeM' });
  if (req.method === 'POST' && p === '/git/commits') return ok_(201, { sha: 'commitM' });
  if (req.method === 'PATCH' && p === '/git/refs/heads/main') return ok_(200, {});
  return ok_(404, { message: 'Not Found' });
};
const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, isNaN, isFinite, __swallowed() {}, alert(m) { ctx.__alert = m; },
  electronAPI: { invoke: async (ch, req) => (ch === 'http-request' ? gh(req) : null) },
  Storage: { async getItem(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; }, async setItem(k, v, o) { store.set(k, JSON.parse(JSON.stringify(v))); ctx.__internal = !!(o && o.internal); } } };
ctx.window = ctx;
// Courses: a live one, a private one, a draft, an excluded one (counted in totals only), one with no provider, one with <50 learners.
const C = [
  { Course: 'Live A', Provider: 'GSF - Global Surgery Foundation', Access: 'free', Learners: 1000, Certificates: 300 },
  { Course: 'Private B', Provider: 'WFSA - World Federation', Access: 'private', Learners: 200, Certificates: 50 },
  { Course: 'Draft C', Provider: 'Lifebox', Access: 'draft', Learners: 5, Certificates: 0 },
  { Course: 'Excluded D', Provider: 'ICRC', Access: 'free', Learners: 70, Certificates: 7, Excluded: true },
  { Course: 'Orphan E', Provider: 'Unknown Provider', Access: 'free', Learners: 60, Certificates: 6 },
  { Course: 'Small F', Provider: 'Lifebox', Access: 'free', Learners: 20, Certificates: 2 },
];
ctx.App = { hideLowLearners: true, hidePrivateCourses: true, view: 'sh-reports', renderView() {}, showMsg(m) { ctx.__msg = m; },
  escapeHtml: (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), escapeJsArg: (t) => String(t).replace(/'/g, "\\'"),
  userHistory: [{ Timestamp: '2026-10-01', TotalUsers: 66000, KnownCountry: 218 }, { Timestamp: '2026-10-16', TotalUsers: 67450, KnownCountry: 219 }],
  _toggled(rows) { return rows.filter(d => !(this.hideLowLearners && d.Learners < 50) && !(this.hidePrivateCourses && /^(private|draft)$/.test(d.Access))); },
  getPlatformSnap() { return this._toggled(C); },
  getAnalyticsSnap() { return this._toggled(C.filter(d => !d.Excluded)); },
  _withAllCourses(fn) { const a = this.hideLowLearners, b = this.hidePrivateCourses; this.hideLowLearners = false; this.hidePrivateCourses = false; try { return fn(); } finally { this.hideLowLearners = a; this.hidePrivateCourses = b; } },
  isCourseRecordPrivate(d) { return /^(private|draft)$/.test(d.Access); },
  _pd: { repo: 'gsf/reports', branch: 'main', baseUrl: 'https://reports.globalsurgeryfoundation.org', providers: {} },
};
vm.createContext(ctx);
for (const f of ['js/partnerDash.js', 'js/websiteMetrics.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const App = ctx.App;
App._pdReady = async () => ({ ok: true }); App._pdToken = async () => 'ghp_T';
ctx.countryToISO = (c) => ({ India: 'IN', 'United Arab Emirates': 'AE', 'United States': 'US' }[c] || '');
// The SURGhub overall report's data (reports.js _assembleReportData), as far as the extras use it.
const CC = { India: 7000, 'United Arab Emirates': 6400, 'United States': 5200, 'United Kingdom': 3300, Mexico: 1800, Pakistan: 3310, Kenya: 2140, Egypt: 2230, Nigeria: 2210, Ethiopia: 1820, Malta: 180, Fiji: 80 };
let D = null, seenFilters = null;
App.reportPeriodFrom = '2026-07'; App.reportFeedbackFromDate = '2026-01-01';
App._assembleReportData = async (prov, o) => { seenFilters = { prov, platform: o.platform, low: App.hideLowLearners, priv: App.hidePrivateCourses, from: App.reportPeriodFrom, fb: App.reportFeedbackFromDate }; return D; };
const mkD = (sat, app, rating, min) => ({ avgRating: rating, totalMin: min, providerCountryData: CC,
  surveyQRows: [{ title: 'Overall satisfaction', hiPct: sat, n: 10421 }, { title: 'Learning objectives', hiPct: 95, n: 10000 }, { title: 'Intent to apply', hiPct: app, n: 9800 }] });

(async () => {
  const v = App.websiteMetricsCompute();
  check('registered learners and countries: the newest learner snapshot', v.registered_learners === 67450 && v.countries === 219);
  check('enrolments and certificates: every course, excluded and private ones too, toggles ignored', v.enrolments === 1355 && v.certificates === 365, JSON.stringify(v));
  check('courses: live only — included, not private, not draft (toggles ignored, so the small course counts)', v.courses === 3, v.courses);
  check('providers: with an included course, never "Unknown"', v.content_providers === 3, v.content_providers);
  check('the report toggles are left as they were', App.hideLowLearners === true && App.hidePrivateCourses === true);

  // ── first publish ──
  const f1 = await App.websiteMetricsFile({});
  const j1 = JSON.parse(f1.content);
  check('metrics.json: the six keys in order, whole numbers, an as_of date (UTC) and nothing else personal',
    Object.keys(j1).slice(0, 9).join() === 'as_of,updated_at,source,registered_learners,enrolments,countries,courses,certificates,content_providers' && /^\d{4}-\d{2}-\d{2}$/.test(j1.as_of) && App.WM_ORDER.every(k => Number.isInteger(j1[k])), f1.content);
  check('a first publish has nothing to compare with, so it goes out', f1.fresh === true);
  check('…but is not the baseline until the upload went through', !(store.get('surgdash_website_metrics') || {}).last);
  await App._wmPublished(f1);
  check('after the upload it is, stored on this device only', store.get('surgdash_website_metrics').last.values.enrolments === 1355 && ctx.__internal === true);

  check('without the overall report, the extras are simply left out', !('overall_satisfaction_pct' in j1) && j1.certification_rate_pct === 26.9, f1.content);

  // ── the pop-up figures ──
  D = mkD(91.6, 92.4, '4.63', 19034567);
  const fx = await App.websiteMetricsFile({});
  const jx = JSON.parse(fx.content);
  check('the overall report is assembled for all of SURGhub with every filter off, and the filters put back',
    seenFilters.prov === 'SURGhub' && seenFilters.platform === true && !seenFilters.low && !seenFilters.priv && seenFilters.from === '' && seenFilters.fb === '' && App.reportPeriodFrom === '2026-07' && App.reportFeedbackFromDate === '2026-01-01' && App.hideLowLearners === true);
  check('satisfaction and likely-to-apply: share answering 4 or 5, one decimal, with the number who answered',
    jx.overall_satisfaction_pct === 91.6 && jx.likely_to_apply_pct === 92.4 && jx.satisfaction_responses === 10421, JSON.stringify([jx.overall_satisfaction_pct, jx.likely_to_apply_pct]));
  check('average rating to 2 decimals; study time in minutes and years', jx.average_rating === 4.63 && jx.study_minutes === 19034567 && jx.study_years === 36.2, JSON.stringify({ r: jx.average_rating, y: jx.study_years }));
  check('certification rate from this file\'s own enrolments and certificates', jx.certification_rate_pct === Math.round(jx.certificates / jx.enrolments * 1000) / 10);
  check('top 10 countries by enrolments, largest first, with ISO code and share of enrolments with a known country',
    jx.top_countries.length === 10 && jx.top_countries[0].country === 'India' && jx.top_countries[0].iso2 === 'IN' && jx.top_countries[0].enrolments === 7000 && jx.top_countries[0].share_pct === Math.round(7000 / 35670 * 1000) / 10
    && jx.top_countries.map(c => c.country).indexOf('Malta') === -1 && jx.top_countries.every((c, i, a) => i === 0 || a[i - 1].enrolments >= c.enrolments), JSON.stringify(jx.top_countries.slice(0, 2)));
  await App._wmPublished(fx);
  D = mkD(140, 93.2, '4.64', 10000);   // a broken percentage and study time falling by half
  const fy = await App.websiteMetricsFile({});
  const jy = JSON.parse(fy.content);
  check('a pop-up figure that fails its own check keeps its previous value; the others update', fy.fresh && jy.overall_satisfaction_pct === 91.6 && jy.study_minutes === 19034567 && jy.likely_to_apply_pct === 93.2 && jy.average_rating === 4.64 && fy.kept.join() === 'overall_satisfaction_pct,study_minutes', fy.kept.join());
  await App._wmPublished(fy);

  // ── safety checks keep the old figures ──
  C[0].Learners = 900;   // enrolments 1355 → 1255: −7%
  const f2 = await App.websiteMetricsFile({});
  check('a fall of more than 2% keeps the last good figures online, with the reason', !f2.fresh && /Enrolments fell more than 2% \(1355 → 1255\)/.test(f2.why) && JSON.parse(f2.content).enrolments === 1355, f2.why);
  C[0].Learners = 1000; C[0].Certificates = 900;   // certificates 365 → 965
  const f3 = await App.websiteMetricsFile({});
  check('more than doubling is held back too', !f3.fresh && /Certificates more than doubled/.test(f3.why));
  C[0].Certificates = 300;
  App.userHistory.push({ Timestamp: '2026-10-17', TotalUsers: 0, KnownCountry: 219 });
  const f4 = await App.websiteMetricsFile({});
  check('a zero (a sync that came back empty) is held back', !f4.fresh && /Registered learners is not a positive whole number/.test(f4.why));
  App.userHistory.pop();
  const f5 = await App.websiteMetricsFile({ syncOk: false });
  check('after a sync with LearnWorlds errors, the last good figures stay, pop-up figures included', !f5.fresh && /LearnWorlds errors/.test(f5.why) && JSON.parse(f5.content).enrolments === 1355 && JSON.parse(f5.content).likely_to_apply_pct === 93.2);
  C[0].Learners = 1010;   // a normal day: small growth
  const f6 = await App.websiteMetricsFile({});
  check('small growth goes out', f6.fresh && JSON.parse(f6.content).enrolments === 1365);
  C[0].Learners = 1000;

  // ── the quick publish ──
  calls.length = 0;
  const r = await App.publishWebsiteMetrics(null);
  const tree = JSON.parse(calls.find(c => c.url.endsWith('/git/trees')).body), commit = JSON.parse(calls.find(c => c.url.endsWith('/git/commits') && c.method === 'POST').body), patch = JSON.parse(calls.find(c => c.method === 'PATCH').body);
  check('publishing now replaces metrics.json alone, on top of the published site', r.ok && tree.base_tree === 'tree0' && tree.tree.length === 1 && tree.tree[0].path === 'metrics.json');
  check('…as one commit after the current one, not a forced rewrite', commit.parents.join() === 'head1' && patch.force === false);
  check('the GitHub token only in the Authorization header', calls.every(c => !String(c.body || '').includes('ghp_T') && c.headers.Authorization === 'Bearer ghp_T'));
  check('the Reports tab box shows the six figures, what is online, and the button', /GSF website figures/.test(App._websiteMetricsHtml()) && /reports\.globalsurgeryfoundation\.org\/metrics\.json/.test(App._websiteMetricsHtml()) && /App\.publishWebsiteMetrics\(this\)/.test(App._websiteMetricsHtml()));

  // ── wiring ──
  const pd = fs.readFileSync(path.join(ROOT, 'js/partnerDash.js'), 'utf8'), bg = fs.readFileSync(path.join(ROOT, 'js/backgroundSync.js'), 'utf8'), st = fs.readFileSync(path.join(ROOT, 'js/storage.js'), 'utf8'), idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('every full site publish carries metrics.json, and makes it the baseline once uploaded', /files\.push\(\{ path: 'metrics\.json', content: wm\.content \}\)/.test(pd) && /if \(wm && wm\.content && this\._wmPublished\) await this\._wmPublished\(wm\)/.test(pd));
  check('the nightly run passes whether the LearnWorlds steps went through', /const syncOk = steps\.filter\(x => lwSteps\.includes\(x\.label\)\)\.every\(x => x\.ok\)/.test(bg) && /publishPartnerDashboards\(\{ silent: true, syncOk/.test(bg));
  check('the state file is device-only (settings/, never mapped back)', /'surgdash_website_metrics'\) return path\.join\('settings', 'website_metrics\.json'\)/.test(st) && !/: 'surgdash_website_metrics'/.test(st));
  check('loaded after partnerDash.js', idx.indexOf('js/websiteMetrics.js') > idx.indexOf('js/partnerDash.js'));

  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})();
