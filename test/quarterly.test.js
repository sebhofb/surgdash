// Quarterly tab (js/quarterly.js): core metrics per quarter on the reporting definitions,
// the current quarter as "to date", changes on the previous quarter / a year earlier.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };
const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, isNaN, parseFloat, __swallowed() {} };
ctx.window = ctx;
ctx.App = { view: 'platform', formatNumber: (n) => Number(n).toLocaleString('en-GB'), escapeHtml: (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  data: [{ Course: 'A', CourseId: 'a', Learners: 10, Timestamp: '2026-10-01' }] };
vm.createContext(ctx);
for (const f of ['js/forumActivity.js', 'js/compare.js', 'js/quarterly.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const App = ctx.App;
App._accounts = { byUid: { u1: { c: '2025-08-01' }, u2: { c: '2025-11-01' }, u3: { c: '2026-08-02' }, u4: { c: '2026-09-30' }, u5: { c: '2026-10-05' } } };
App._rawCompletion = [
  { uid: 'u1', enrolled_date: '2025-08-02', start_date: '2025-08-03', certificate_date: '2025-08-20' },
  { uid: 'u1', enrolled_date: '2025-09-01', start_date: '' },                                   // never opened: still an enrolment
  { uid: 'u2', enrolled_date: '2025-11-02', start_date: '2025-11-02' },
  { uid: 'u3', enrolled_date: '2026-08-03', start_date: '2026-08-04', certificate_date: '2026-09-01' },
  { uid: 'u3', enrolled_date: '2026-08-05', start_date: '2026-08-05', certificate_date: '2026-08-30' },
  { uid: 'u4', enrolled_date: '', start_date: '2026-09-30' },                                    // no enrolled_date: start_date
  { uid: 'u5', enrolled_date: '2026-10-06', start_date: '' }];
App._rawSurveyResponses = { a: { data: [[0, 0, 0, '10 Aug 2025 09:00', '5'], [0, 0, 0, '3 Sep 2026 10:00', '4'], [0, 0, 0, '9 Sep 2026 10:00', '5'], [0, 0, 0, '9 Sep 2026 11:00', 'n/a']] } };
App._forum = { fetchedAt: '2026-10-21T00:00:00Z', totals: { posts: 12 }, byCourse: { a: { posts: 12, people: 4, months: { '2025-08': { posts: 2, people: 1 }, '2026-08': { posts: 10, people: 3 } } } } };
const Q = App.quarterlyMetrics(new Date('2026-10-21T12:00:00Z'));
const val = (k, q) => Q.rows.find(r => r.key === k).values[Q.quarters.indexOf(q)];
check('quarters run from the first data to the current one, which is marked partial', Q.quarters[0] === '2025 Q3' && Q.quarters[Q.quarters.length - 1] === '2026 Q4' && Q.partial[Q.partial.length - 1] === true && Q.quarters.length === 6, Q.quarters.join(', '));
check('registrations by registration day, and the running total at each quarter end', val('registrations', '2026 Q3') === 2 && val('registeredTotal', '2026 Q3') === 4 && val('registeredTotal', '2025 Q3') === 1);
check('enrolments: every enrolment, opened or not (start date when there is no enrolment date)', val('enrolments', '2025 Q3') === 2 && val('enrolments', '2026 Q3') === 3);
check('learners enrolling are people, not enrolments; courses started need a start date', val('learners', '2026 Q3') === 2 && val('started', '2025 Q3') === 1 && val('started', '2026 Q3') === 3);
check('certificates per quarter and to date; certification rate = certificates ÷ enrolments', val('certificates', '2026 Q3') === 2 && val('certificatesTotal', '2026 Q3') === 3 && Math.abs(val('certRate', '2026 Q3') - 66.67) < 0.01);
check('survey: scored responses only, and their average', val('survey', '2026 Q3') === 2 && val('rating', '2026 Q3') === 4.5 && val('survey', '2025 Q3') === 1);
check('forum posts and courses with discussion', val('posts', '2026 Q3') === 10 && val('discussion', '2026 Q3') === 1 && val('posts', '2025 Q4') === 0);
check('change on a year earlier: % for counts, points for a rate or a rating', App._qtrChange('flow', 3, 2).txt === '+50%' && App._qtrChange('pct', 66.7, 50).txt === '+16.7 pts' && App._qtrChange('score', 4.5, 5).txt === '−0.50' && App._qtrChange('flow', 5, 0).txt === 'new'
  && App._qtrChange('flow', 198, 1).txt === '×198' && App._qtrChange('score', 4.601, 4.6).txt === '0.00' && App._qtrChange('flow', 100, 100).txt === '0%');
App.qtrMode = 'values'; App.qtrRange = 'all';
let html = App._dashQuarterlyHtml();
check('the table: every metric a row with a trend line, one column per quarter, the current one greyed and "to date"', (html.match(/<tr class="border-b/g) || []).length === Q.rows.length && /<svg width="96"/.test(html) && /2026 Q4<div class="text-\[9px\] font-normal">to /.test(html));
App.qtrMode = 'yoy';
html = App._dashQuarterlyHtml();
check('% vs a year earlier: Q3 2026 enrolments +50% on Q3 2025, shown in green', /text-emerald-700 font-semibold" title="3 vs 2 in 2025 Q3">\+50%</.test(html), (html.match(/title="3 vs 2 in 2025 Q3"[^<]*</) || [''])[0]);
App.qtrMode = 'qoq';
html = App._dashQuarterlyHtml();
check('a partial quarter\'s flow change is shown greyed (not a fair comparison yet)', /text-slate-300 italic" title="1 vs 3 in 2026 Q3">−67%</.test(html));
check('the last-8 range shows eight complete quarters and the current one', (() => { App.qtrRange = '8'; App.qtrMode = 'values'; const h = App._dashQuarterlyHtml(); return (h.match(/<th class="py-2 px-3 text-right/g) || []).length === Math.min(9, Q.quarters.length); })());
// The survey export's newer layout: "Started at" / "Ended at" before the questions. Columns are found by heading.
const NEW = { b: { cols: ['Respondent', 'Country', 'Profession', 'Started at', 'Ended at', 'On a scale from 1 to 5, how would you rate your overall satisfaction with this course?'],
  data: [[1, 'Kenya', 'Nurse', '30 Jun 2026 23:50:00', '1 Jul 2026 00:10:00', '5'], [2, '', '', '2 Aug 2026 10:00:00', '3 Aug 2026 10:20:00', '4'], [3, '', '', '3 Aug 2026', '4 Aug 2026', 'N/A']] } };
const sv = App._cmpSurveyRows(NEW);
check('survey rows: the satisfaction score and the completion date are found by column heading (not position)',
  sv.length === 3 && sv[0].iso === '2026-07-01' && sv[0].score === 5 && sv[1].score === 4 && sv[2].score === null, JSON.stringify(sv));
check('…so an "Ended at" date is never read as a score', !sv.some(x => x.score != null && x.score < 4));

const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8'), idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), st = fs.readFileSync(path.join(ROOT, 'js/uiState.js'), 'utf8');
check('wired: the pill, the content switch, loaded before uiState.js, its view remembered', /\['quarterly', 'Quarterly', 'calendar-range'/.test(ui) && /if \(dt === 'quarterly' && this\._dashQuarterlyHtml\)/.test(ui) && idx.indexOf('js/quarterly.js') < idx.indexOf('js/uiState.js') && /'qtrMode', 'qtrRange'/.test(st));
console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
