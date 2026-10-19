// SURGhub overall report (reports.js _assembleReportData, platform mode): totals and aggregates
// count EVERY course, private and unpublished ("Excluded") ones too; course and provider counts
// and the course listings stay with the included courses. Provider reports are unchanged.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };

const tl = (e, c) => JSON.stringify({ timeline: { '2026-05-10': { e: e, c: c } } });
const qs = (avg, n, hi) => JSON.stringify([{ q: 'On a scale from 1 to 5, how would you rate your overall satisfaction with this course?', avg, n, hi, na: 0 }]);
const fbk = (rs) => JSON.stringify(rs.map(r => ({ r, t: 'Very helpful course for my daily surgical practice indeed', d: '2026-05-01', s: 'Positive' })));
const COURSES = [
  { Course: 'Public A', CourseId: 'a', Provider: 'GSF', Access: 'free', Learners: 1000, Certificates: 300, Responses: 100, Rating: 4.8, LearningMinutes: 6000, Timestamp: '2026-10-14', CourseTimeline: tl(1000, 300), QuestionStats: qs(4.8, 100, 95), CountryStats: JSON.stringify({ India: 400, Kenya: 100 }), FeedbackBank: fbk([5, 5, 4, 5, 5, 4, 5, 5, 5, 4]) },
  { Course: 'Private B', CourseId: 'b', Provider: 'GSF', Access: 'private', Learners: 200, Certificates: 50, Responses: 20, Rating: 4.0, LearningMinutes: 1200, Timestamp: '2026-10-14', CourseTimeline: tl(200, 50), QuestionStats: qs(4.0, 20, 12), CountryStats: JSON.stringify({ Nepal: 150 }), FeedbackBank: fbk([3, 3]) },
  { Course: 'Hidden C', CourseId: 'c', Provider: 'WFSA', Access: 'draft', Learners: 300, Certificates: 30, Responses: 10, Rating: 4.2, LearningMinutes: 900, Timestamp: '2026-10-14', Excluded: true, CourseTimeline: tl(300, 30), QuestionStats: qs(4.2, 10, 8), CountryStats: JSON.stringify({ Nepal: 100, India: 50 }), FeedbackBank: fbk([4]) },
];
const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, isNaN, isFinite, parseInt, parseFloat, __swallowed() {}, Storage: { async getItem() { return null; } },
  electronAPI: { path: require('path'), os: require('os'), fs: { existsSync: () => false }, appPath: ROOT, invoke: async () => null } };
ctx.window = ctx;
ctx.document = { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }, createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; }, head: { appendChild() {} }, body: { appendChild() {} } };
ctx.Charts = { safeParse: (s) => JSON.parse(s) };
ctx.App = { data: COURSES, hideLowLearners: false, hidePrivateCourses: false, reportPeriodFrom: '', reportPeriodTo: '', reportFeedbackFromDate: '',
  getAnalyticsSnap() { return this.data.filter(d => !d.Excluded); }, getPlatformSnap() { return this.data.slice(); },
  getAnalyticsHistory() { return this.data.filter(d => !d.Excluded); }, getPlatformHistory() { return this.data.slice(); },
  escapeHtml: (t) => String(t), formatNumber: (n) => String(n), courseLearningMinutes: (d) => Number(d.LearningMinutes) || 0, getCourseLearningMinutes: () => ({}),
  _reconcileScale: () => ({ e: 1, c: 1 }), formatDate: (d) => String(d), _surveyQTitle: () => '' };
vm.createContext(ctx);
try { vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/reports.js'), 'utf8'), ctx, { filename: 'reports.js' }); } catch (e) { check('reports.js loads', false, e.message); }
const App = ctx.App;

(async () => {
  let D = null, err = null;
  try { D = await App._assembleReportData('SURGhub', { platform: true }); } catch (e) { err = e; }
  check('the overall report assembles', !!D, err && err.stack);
  if (D) {
    check('enrolments, certificates, responses and study time count every course, private and unpublished too', D.totalLrn === 1500 && D.totalCert === 380 && D.totalResp === 130 && D.totalMin === 8100, JSON.stringify({ l: D.totalLrn, c: D.totalCert, r: D.totalResp, m: D.totalMin }));
    check('…and so the certification rate', D.certRate === (380 / 1500 * 100).toFixed(1), D.certRate);
    check('the courses listed (and counted) are the included ones only', D.coursesSorted.length === 2 && !D.coursesSorted.some(d => d.Course === 'Hidden C'));
    check('countries count every course', D.providerCountryData.Nepal === 250 && D.providerCountryData.India === 450, JSON.stringify(D.providerCountryData));
    const sat = (D.surveyQRows || []).find(r => /satisfaction/i.test(r.q));
    check('survey answers count every course', sat && sat.n === 130, sat && sat.n);
    check('the growth curve ends at the all-course totals', D.provTimeline['2026-05'] && D.provTimeline['2026-05'].e === 1500 && D.provTimeline['2026-05'].c === 380, JSON.stringify(D.provTimeline));
    const gsf = (D.topProviders || []).find(p => p.name === 'GSF');
    check('the providers table: figures from every course, courses counted and providers listed from the included ones', gsf && gsf.courses === 2 && gsf.lrn === 1200 && !D.topProviders.some(p => p.name === 'WFSA') && D.providerCount === 1, JSON.stringify(D.topProviders));
  }
  // A provider report keeps to that provider's included courses.
  let P = null; try { P = await App._assembleReportData('WFSA', {}); } catch (e) { err = e; }
  check('a provider report is unchanged: only its included courses (WFSA has none here)', P === null);
  let G = null; try { G = await App._assembleReportData('GSF', {}); } catch (e) { err = e; }
  check('…and GSF\'s report totals its own included courses', G && G.totalLrn === 1200 && G.totalCert === 350, G && JSON.stringify({ l: G.totalLrn, c: G.totalCert }));
  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})();
