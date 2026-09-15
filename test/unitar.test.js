// UNITAR course reports: js/unitarExport.js in a VM with fixture data.
// The report object is built without any spreadsheet library, so the numbers, the two
// gaps and the estimate arithmetic are all checkable here; the workbook writer is a
// thin layer over it and is checked for sheet shape only.
const vm = require('vm'), fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };

// 10 participant records for "Course A"; the platform says 12 enrolled, so 2 have no record.
// Country recorded for 8, gender for 6, organisation type for 4 — three different gaps.
const anonUsers = [
  { course: 'Course A', user_uid: 'u1', signup_month: '2026-01', country: 'Kenya',   profession: 'surgeon', gender: 'Female', organisation_type: 'Academia',            career_stage: 'In practice',  has_certificate: 'Yes', course_minutes: 120 },
  { course: 'Course A', user_uid: 'u2', signup_month: '2026-01', country: 'Kenya',   profession: 'surgeon', gender: 'Male',   organisation_type: 'Academia',            career_stage: 'In practice',  has_certificate: 'No',  course_minutes: 30 },
  { course: 'Course A', user_uid: 'u3', signup_month: '2026-02', country: 'Kenya',   profession: 'nursing',   gender: 'Female', organisation_type: 'Government - National', career_stage: 'Undergraduate', has_certificate: 'No', course_minutes: 45 },
  { course: 'Course A', user_uid: 'u4', signup_month: '2026-02', country: 'Nigeria',  profession: 'nursing',   gender: 'Male',   organisation_type: 'Private Sector',      career_stage: 'In practice',  has_certificate: 'Yes', course_minutes: 90 },
  { course: 'Course A', user_uid: 'u5', signup_month: '2026-02', country: 'Nigeria',  profession: '',        gender: 'Female', organisation_type: '',                    career_stage: 'In practice',  has_certificate: 'No',  course_minutes: 10 },
  { course: 'Course A', user_uid: 'u6', signup_month: '2026-03', country: 'Nigeria',  profession: 'surgeon', gender: 'Male',   organisation_type: '',                    career_stage: '',             has_certificate: 'No',  course_minutes: 0 },
  { course: 'Course A', user_uid: 'u7', signup_month: '2026-03', country: 'India',    profession: 'surgeon', gender: '',       organisation_type: '',                    career_stage: 'Undergraduate', has_certificate: 'No', course_minutes: 15 },
  { course: 'Course A', user_uid: 'u8', signup_month: '2026-03', country: 'Unknown',  profession: 'surgeon', gender: '',       organisation_type: '',                    career_stage: 'In practice',  has_certificate: 'No',  course_minutes: 20 },
  { course: 'Course A', user_uid: 'u9', signup_month: '2026-03', country: '',         profession: '',        gender: '',       organisation_type: '',                    career_stage: '',             has_certificate: 'No',  course_minutes: 5 },
  { course: 'Course A', user_uid: 'u10', signup_month: '2026-03', country: 'Kenya',   profession: 'nursing',   gender: '',       organisation_type: '',                    career_stage: 'Retired',      has_certificate: 'No',  course_minutes: 60 },
  { course: 'Course B', user_uid: 'u1', signup_month: '2026-01', country: 'Kenya', profession: 'surgeon', gender: 'Female', organisation_type: 'Academia', career_stage: 'In practice', has_certificate: 'No', course_minutes: 7 },
];
const completion = [
  { uid: 'u1', course: 'Course A', enrolled_date: '2026-01-05', start_date: '2026-01-06', completion_date: '2026-01-20', certificate_date: '2026-01-20', completed: true,  certificate: true,  time_minutes: 121.4 },
  { uid: 'u2', course: 'Course A', enrolled_date: '2026-01-07', start_date: '2026-01-08', completion_date: '',          certificate_date: '',           completed: false, certificate: false, time_minutes: 30 },
  { uid: 'u4', course: 'Course A', enrolled_date: '2026-02-02', start_date: '',           completion_date: '2026-02-20', certificate_date: '2026-02-21', completed: true,  certificate: true,  time_minutes: 90 },
  { uid: 'u1', course: 'Course B', enrolled_date: '2026-01-05', start_date: '2026-01-05', completion_date: '', certificate_date: '', completed: false, certificate: false, time_minutes: 7 },
];
const snap = [
  { Course: 'Course A', Provider: 'Prov X', Learners: 12, Certificates: 3, Timestamp: '2026-09-11' },
  { Course: 'Course A', Provider: 'Prov OLD', Learners: 9, Certificates: 1, Timestamp: '2026-08-01' },
  { Course: 'Course B', Provider: 'Prov Y', Learners: 1, Certificates: 0, Timestamp: '2026-09-11' },
];

function mk() {
  const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, Intl, isNaN, isFinite, parseInt, parseFloat, setTimeout,
    __swallowed() {}, alert(m) { ctx.App.alerts.push(m); }, confirm() { return true; },
    document: { getElementById: () => null }, Storage: { async getItem() { return null; } },
  };
  ctx.window = ctx;
  ctx.Taxonomy = { canonProf: (v) => /nurs/i.test(v) ? 'Nursing' : (/surg/i.test(v) ? 'Surgeon' : 'Other') };
  ctx.countryToISO = (n) => ({ Kenya: 'KE', Nigeria: 'NG', India: 'IN' }[String(n).trim()] || null);
  ctx.App = {
    alerts: [], msgs: [], selectedCourse: 'Course A',
    formatNumber: (v) => new Intl.NumberFormat('en-US').format(v || 0),
    showMsg(m) { this.msgs.push(m); },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ROOT + '/js/unitarExport.js', 'utf8'), ctx, { filename: 'unitarExport.js' });
  return ctx.App;
}

const A = mk();
const r = A.buildUnitarReport('Course A', { anonUsers, completion, snap, now: new Date(2026, 8, 15) });
const dim = (k) => r.dimensions.find(d => d.key === k);
const row = (k, v) => dim(k).rows.find(x => x.value === v);

// ── scope ──
check('only this course\'s participants are included', r.totals.records === 10 && r.participants.length === 10, r.totals.records);
check('the provider and data date come from the newest course snapshot, not an older one',
  r.provider === 'Prov X' && r.dataThrough === '2026-09-11', r.provider + ' ' + r.dataThrough);

// ── gap 1: enrolments with no participant record ──
check('the enrolment total is the platform figure, not the number of records we happen to hold',
  r.totals.enrolled === 12 && r.totals.platform === 12 && r.totals.records === 10);
check('the shortfall is reported as its own number rather than hidden', r.totals.missingRecords === 2);
check('a platform total below our own record count never produces a negative gap',
  (() => { const x = A.buildUnitarReport('Course B', { anonUsers, completion, snap, now: new Date() }); return x.totals.enrolled === 1 && x.totals.missingRecords === 0 && x.totals.records === 1; })());
check('with no course snapshot at all the records themselves become the enrolment base',
  (() => { const x = A.buildUnitarReport('Course A', { anonUsers, completion, snap: [], now: new Date() }); return x.totals.enrolled === 10 && x.totals.platform === 0 && x.totals.missingRecords === 0; })());

// ── gap 2: fields not recorded ──
check('"Unknown" and blank are both treated as not recorded, not as a category',
  dim('country').known === 8 && dim('country').notRecorded === 2 && !dim('country').rows.some(x => /unknown/i.test(x.value)),
  JSON.stringify(dim('country').rows.map(x => x.value)));
check('each field carries its own gap — they are not all the same size',
  dim('gender').known === 6 && dim('organisation_type').known === 4 && dim('career_stage').known === 8,
  [dim('gender').known, dim('organisation_type').known, dim('career_stage').known].join('/'));
check('categories are ordered by size', dim('country').rows[0].value === 'Kenya' && dim('country').rows[0].n === 4);

// ── percentages ──
check('a percentage of those recorded and a percentage of all records are both given, and they differ',
  row('country', 'Kenya').pctKnown === 50 && row('country', 'Kenya').pctRecords === 40,
  row('country', 'Kenya').pctKnown + ' vs ' + row('country', 'Kenya').pctRecords);
check('percentages are one-decimal numbers, not fractions',
  row('organisation_type', 'Academia').pctKnown === 50 && row('country', 'India').pctKnown === 12.5);

// ── the estimate ──
check('the estimate projects the recorded shares onto every enrolled learner',
  row('country', 'Kenya').estimate === 6 && row('country', 'Nigeria').estimate === 5, JSON.stringify(dim('country').rows.map(x => x.value + ':' + x.estimate)));
check('estimates sum exactly to the enrolment total — no rounding drift',
  r.dimensions.every(d => !d.known || d.rows.reduce((s, x) => s + x.estimate, 0) === r.totals.enrolled),
  JSON.stringify(r.dimensions.map(d => d.label + ':' + d.rows.reduce((s, x) => s + x.estimate, 0))));
check('largest remainder gives the leftover units to the biggest fractions',
  JSON.stringify(A._unitarAllocate([1, 1, 1], 10)) === JSON.stringify([4, 3, 3]), JSON.stringify(A._unitarAllocate([1, 1, 1], 10)));
check('a field nobody answered produces no estimate rather than a fabricated split',
  (() => { const blank = anonUsers.filter(u => u.course === 'Course A').map(u => ({ ...u, gender: '' }));
    const x = A.buildUnitarReport('Course A', { anonUsers: blank, completion, snap, now: new Date() });
    const g = x.dimensions.find(d => d.key === 'gender'); return g.known === 0 && g.rows.length === 0; })());

check('profession tags are folded into one cadre, so the same people stop appearing twice',
  dim('profession').rows.length === 2 && row('profession', 'Surgeon').n === 5 && row('profession', 'Nursing').n === 3,
  JSON.stringify(dim('profession').rows.map(x => x.value + ':' + x.n)));
check('an ISO code rides alongside each country, and an unmatched spelling leaves it blank, not wrong',
  r.participants[0].iso === 'KE' && r.participants.find(p => p.country === '').iso === ''
    && r.participants.find(p => p.country === 'Unknown').iso === '');

// ── participants ──
const p1 = r.participants[0], p9 = r.participants[8];
check('dates come from the enrolment record, learning time is rounded',
  p1.enrolled === '2026-01-05' && p1.started === '2026-01-06' && p1.certificateOn === '2026-01-20' && p1.minutes === 121);
check('a participant with no enrolment record still appears, with empty dates',
  p9.enrolled === '' && p9.started === '' && p9.minutes === 5 && p9.certificate === false);
check('"started" counts only a real start date, so a missing one is never read as a start',
  r.totals.started === 2 && r.totals.completed === 2 && r.totals.certificates === 2,
  [r.totals.started, r.totals.completed, r.totals.certificates].join('/'));
check('participant numbers restart at 1 in every file, so nobody can be followed between courses',
  r.participants[0].n === 1 && A.buildUnitarReport('Course B', { anonUsers, completion, snap, now: new Date() }).participants[0].n === 1);

// ── the sheets ──
const sheets = A._unitarSheets(r);
const names = sheets.map(s => s.name);
check('three sheets, summary first', names.join(' | ') === 'Summary | Participants | Method and assumptions', names.join(' | '));
check('every sheet name fits Excel\'s 31-character limit and each row fits its column widths',
  sheets.every(s => s.name.length <= 31 && s.aoa.every(row => row.length <= s.cols.length)),
  JSON.stringify(sheets.map(s => s.name.length + '/' + Math.max(...s.aoa.map(r2 => r2.length)) + ' of ' + s.cols.length)));

const flat = (s) => s.aoa.map(r2 => r2.join('\t')).join('\n');
const sum = flat(sheets[0]), par = flat(sheets[1]), met = flat(sheets[2]);
check('the summary leads with the totals the reporting system asks for',
  /Enrolled learners\t12/.test(sum) && /Participant records in this file\t10/.test(sum) && /no participant record\t2/.test(sum));
check('every dimension gets a block with both percentage bases and the estimate',
  r.dimensions.every(d => new RegExp(d.label.toUpperCase()).test(sum))
    && /% of those recorded/.test(sum) && /% of all participant records/.test(sum) && /Estimated, all enrolled/.test(sum));
check('the not-recorded count appears inside each block, so a reader cannot miss it',
  (sum.match(/Not recorded\t/g) || []).length === r.dimensions.filter(d => d.notRecorded).length);

check('the participant sheet carries no name, no email and no cross-course identifier',
  !/email|name|uid|@/i.test(par.replace(/Not recorded/g, '')), par.slice(0, 120));
check('a blank field reads "Not recorded" rather than looking like a broken cell',
  /Not recorded/.test(par) && !sheets[1].aoa.slice(1).some(row => [2, 4, 5, 6, 7].some(i => row[i] === '')));
check('the participant sheet carries an ISO code column next to the country',
  sheets[1].aoa[0][2] === 'Country' && sheets[1].aoa[0][3] === 'ISO code' && sheets[1].aoa[1][3] === 'KE');
check('the country block on the summary carries the ISO code too',
  (() => { const a = sheets[0].aoa; const h = a.findIndex(r2 => r2[0] === 'Country' && r2[1] === 'Participants'); return h > 0 && a[h][6] === 'ISO code' && a[h + 1][6] === 'KE'; })());
check('one header row, one row per participant', sheets[1].aoa.length === 11);

check('the method sheet separates the two gaps and names the cause of the second',
  /GAP 1 — ENROLLED LEARNERS WITH NO PARTICIPANT RECORD/.test(met)
    && /GAP 2 — FIELDS NOT RECORDED/.test(met) && /sign-up survey, which is voluntary/.test(met));
check('the method sheet states the assumption, and calls the estimate a projection',
  /assumed to be spread across the categories in the same proportions/.test(met)
    && /a projection, not a count/.test(met) && /has not been tested/.test(met));
check('the method sheet tabulates the gap per field',
  /Field\tRecorded\tNot recorded\tRecorded %\tSource/.test(met) && /Gender\t6\t4\t60%/.test(met), (met.match(/Gender\t[^\n]*/) || [''])[0]);
check('the method sheet warns about small categories when there are any',
  /Categories with fewer than 5 participants/.test(met) && /point to an individual/.test(met));
check('a missing start date is explained rather than left to be read as inactivity',
  /a blank start date means the platform holds none/.test(met));

// ── file naming + wiring ──
check('the file name is safe on every platform and names the course',
  /^UNITAR_Course_A_\d{4}-\d{2}-\d{2}\.xlsx$/.test(A._unitarFileName('Course A')), A._unitarFileName('Course A'));
check('an awkward course title still produces a usable file name',
  /^UNITAR_A_B_c_d_\d{4}-\d{2}-\d{2}\.xlsx$/.test(A._unitarFileName('A/B: c (d)')), A._unitarFileName('A/B: c (d)'));
const idx = fs.readFileSync(ROOT + '/index.html', 'utf8');
check('unitarExport.js is loaded by the app', /<script src="js\/unitarExport\.js"><\/script>/.test(idx));
const ui = fs.readFileSync(ROOT + '/js/ui.js', 'utf8');
check('the course page offers the report for the course being viewed',
  /exportUnitarCourseReport\(\)/.test(ui) && /data-report-ok/.test(ui));
check('a batch run for every course is offered where the other bulk exports live',
  /exportAllUnitarCourseReports\(\)/.test(ui));

console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
