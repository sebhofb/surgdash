// UNITAR course reports: js/unitarExport.js in a VM with fixture data.
// The report object is built without any spreadsheet library, so the numbers, the
// period filter, the launch detection and the gap-filling arithmetic are all checkable
// here; the workbook writer is a thin layer over it and is checked for shape only.
const vm = require('vm'), fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };

// 10 participants on "Course A"; the platform says 12 enrolled, so the two figures differ.
// Country stated by 8, gender by 6, organisation type by 4 — three different gaps.
// Only u1, u2 and u4 have an enrolment record, so only they can be placed in a period.
const anonUsers = [
  { course: 'Course A', user_uid: 'u1',  signup_month: '2026-01', country: 'Kenya',   profession: 'surgeon', gender: 'Female', organisation_type: 'Academia',              career_stage: 'In practice',   has_certificate: 'Yes', course_minutes: 120 },
  { course: 'Course A', user_uid: 'u2',  signup_month: '2026-01', country: 'Kenya',   profession: 'surgeon', gender: 'Male',   organisation_type: 'Academia',              career_stage: 'In practice',   has_certificate: 'No',  course_minutes: 30 },
  { course: 'Course A', user_uid: 'u3',  signup_month: '2026-02', country: 'Kenya',   profession: 'nursing', gender: 'Female', organisation_type: 'Government - National', career_stage: 'Undergraduate', has_certificate: 'No',  course_minutes: 45 },
  { course: 'Course A', user_uid: 'u4',  signup_month: '2026-02', country: 'Nigeria', profession: 'nursing', gender: 'Male',   organisation_type: 'Private Sector',        career_stage: 'In practice',   has_certificate: 'Yes', course_minutes: 90 },
  { course: 'Course A', user_uid: 'u5',  signup_month: '2026-02', country: 'Nigeria', profession: '',        gender: 'Female', organisation_type: '',                      career_stage: 'In practice',   has_certificate: 'No',  course_minutes: 10 },
  { course: 'Course A', user_uid: 'u6',  signup_month: '2026-03', country: 'Nigeria', profession: 'surgeon', gender: 'Male',   organisation_type: '',                      career_stage: '',              has_certificate: 'No',  course_minutes: 0 },
  { course: 'Course A', user_uid: 'u7',  signup_month: '2026-03', country: 'India',   profession: 'surgeon', gender: '',       organisation_type: '',                      career_stage: 'Undergraduate', has_certificate: 'No',  course_minutes: 15 },
  { course: 'Course A', user_uid: 'u8',  signup_month: '2026-03', country: 'Unknown', profession: 'surgeon', gender: '',       organisation_type: '',                      career_stage: 'In practice',   has_certificate: 'No',  course_minutes: 20 },
  { course: 'Course A', user_uid: 'u9',  signup_month: '2026-03', country: '',        profession: '',        gender: '',       organisation_type: '',                      career_stage: '',              has_certificate: 'No',  course_minutes: 5 },
  { course: 'Course A', user_uid: 'u10', signup_month: '2026-03', country: 'Kenya',   profession: 'nursing', gender: '',       organisation_type: '',                      career_stage: 'Retired',       has_certificate: 'No',  course_minutes: 60 },
  { course: 'Course B', user_uid: 'u1',  signup_month: '2026-01', country: 'Kenya',   profession: 'surgeon', gender: 'Female', organisation_type: 'Academia',              career_stage: 'In practice',   has_certificate: 'No',  course_minutes: 7 },
];
const completion = [
  { uid: 'u1', name: 'Mary Jane Watson', email: 'mjw@example.invalid', course: 'Course A', enrolled_date: '2026-01-05', start_date: '2026-01-06', completion_date: '2026-01-20', certificate_date: '2026-01-20', completed: true,  certificate: true,  time_minutes: 121.4 },
  { uid: 'u2', name: 'Amara',             email: 'a@example.invalid',   course: 'Course A', enrolled_date: '2026-01-07', start_date: '2026-01-08', completion_date: '',           certificate_date: '',           completed: false, certificate: false, time_minutes: 30 },
  { uid: 'u4', name: 'Okafor, Chidi',     email: 'oc@example.invalid',  course: 'Course A', enrolled_date: '2026-02-02', start_date: '',           completion_date: '2026-02-20', certificate_date: '2026-02-21', completed: true,  certificate: true,  time_minutes: 90 },
  { uid: 'u1', course: 'Course B', enrolled_date: '2026-01-05', start_date: '2026-01-05', completion_date: '', certificate_date: '', completed: false, certificate: false, time_minutes: 7 },
];
const snap = [
  { Course: 'Course A', Provider: 'Prov X',   Learners: 12, Certificates: 3, Timestamp: '2026-09-11' },
  { Course: 'Course A', Provider: 'Prov OLD', Learners: 9,  Certificates: 1, Timestamp: '2026-08-01' },
  { Course: 'Course B', Provider: 'Prov Y',   Learners: 1,  Certificates: 0, Timestamp: '2026-09-11' },
];

function mk() {
  const store = new Map();
  const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, Intl, isNaN, isFinite, parseInt, parseFloat, setTimeout,
    __swallowed() {}, alert(m) { ctx.App.alerts.push(m); }, confirm() { return true; },
    TextEncoder, TextDecoder, DataView, Uint8Array, Int32Array, ArrayBuffer,
    document: { getElementById: () => null },
    Storage: { async getItem(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; },
               async setItem(k, v) { store.set(k, JSON.parse(JSON.stringify(v))); } },
  };
  ctx.__store = store;
  ctx.window = ctx;
  ctx.Taxonomy = { canonProf: (v) => /nurs/i.test(v) ? 'Nursing' : (/surg/i.test(v) ? 'Surgeon' : 'Other') };
  ctx.countryToISO = (n) => ({ Kenya: 'KE', Nigeria: 'NG', India: 'IN' }[String(n).trim()] || null);
  ctx.App = {
    alerts: [], msgs: [], selectedCourse: 'Course A',
    data: [{ Course: 'Course A', Access: 'free', Timestamp: '2026-09-11' },
           { Course: 'Workshop A', Access: 'private', Timestamp: '2026-09-11' },
           { Course: 'Draft A', Access: 'draft', Timestamp: '2026-09-11' },
           { Course: 'Workshop A', Access: 'free', Timestamp: '2020-01-01' }],
    formatNumber: (v) => new Intl.NumberFormat('en-US').format(v || 0),
    escapeHtml: (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    showMsg(m) { this.msgs.push(m); },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ROOT + '/js/unitarExport.js', 'utf8'), ctx, { filename: 'unitarExport.js' });
  ctx.App.__store = store;
  return ctx.App;
}

const A = mk();
const build = (o) => A.buildUnitarReport('Course A', Object.assign({ anonUsers, completion, snap }, o || {}));
const r = build();
const dim = (k) => r.dimensions.find(d => d.key === k);
const row = (k, v) => dim(k).rows.find(x => x.value === v);

// ── scope ──
check('only this course\'s participants are included', r.totals.participants === 10 && r.participants.length === 10, r.totals.participants);
check('the provider comes from the newest course snapshot, not an older one', r.provider === 'Prov X' && r.dataThrough === '2026-09-11');

// ── one enrolment number ──
check('the report gives ONE participant figure, the rows it actually lists',
  r.totals.participants === 10 && r.participants.length === 10 && !('enrolled' in r.totals) && !('missingRecords' in r.totals),
  JSON.stringify(Object.keys(r.totals)));
check('the platform total is kept for the app but never becomes a second headline figure',
  r.totals.platform === 12 && r.totals.participants === 10);
check('"completed the course" is gone; certificates and starts remain',
  !('completed' in r.totals) && r.totals.certificates === 2 && r.totals.started === 2,
  JSON.stringify({ certificates: r.totals.certificates, started: r.totals.started }));

// ── the launch month ──
const L = (m) => A._unitarLaunch(m);
check('the launch month is the ramp, not the first quiet reviewer month',
  (() => { const x = L({ '2025-01': 2, '2025-02': 1, '2025-03': 3, '2025-04': 40, '2025-05': 62, '2025-06': 55 });
    return x.month === '2025-04' && x.basis === 'ramp' && x.before === 6; })(),
  JSON.stringify(L({ '2025-01': 2, '2025-02': 1, '2025-03': 3, '2025-04': 40, '2025-05': 62, '2025-06': 55 })));
check('a month with nothing in it counts as a zero, so gaps do not shift the ramp',
  L({ '2025-01': 1, '2025-06': 30, '2025-07': 44, '2025-08': 40 }).month === '2025-06');
check('a single trickle month is not mistaken for the launch when the real jump follows',
  L({ '2024-05': 1, '2024-06': 2, '2024-07': 11, '2024-08': 281, '2024-09': 105, '2024-10': 146 }).month === '2024-08',
  L({ '2024-05': 1, '2024-06': 2, '2024-07': 11, '2024-08': 281, '2024-09': 105, '2024-10': 146 }).month);
check('a course too small to show a ramp reports its first enrolment month and says which',
  (() => { const x = L({ '2025-02': 3, '2025-03': 4, '2025-04': 2 }); return x.month === '2025-02' && x.basis === 'first'; })());
check('no enrolment dates at all leaves the launch unknown rather than invented',
  L({}).basis === 'none' && L({}).month === '');
check('the launch is read from the whole history, so a reporting period cannot move it',
  build({ from: '2026-02', to: '2026-02' }).launch.month === r.launch.month, r.launch.month + ' / ' + r.launch.basis);
check('a month is named in words for the sheet', A._unitarMonthName('2025-04') === 'April 2025' && A._unitarMonthName('') === '');

// ── the reporting period ──
check('with no period every participant is included and the label says so',
  r.period.set === false && r.period.label === 'All time' && r.totals.participants === 10);
const jan = build({ from: '2026-01', to: '2026-01' });
check('a period keeps only the learners who ENROLLED inside it',
  jan.totals.participants === 2 && jan.participants.every(p => p.enrolled.slice(0, 7) === '2026-01'),
  JSON.stringify(jan.participants.map(p => p.enrolled)));
check('a participant with no enrolment date is excluded by a period, and the exclusion is counted',
  jan.totals.excludedUndated === 7 && r.totals.excludedUndated === 0, jan.totals.excludedUndated);
check('an open-ended period works from either side',
  build({ from: '2026-02' }).totals.participants === 1 && build({ to: '2026-01' }).totals.participants === 2);
check('a full calendar year is labelled by the year alone', build({ from: '2026-01', to: '2026-12' }).period.label === '2026');
check('any other range is spelled out in months', build({ from: '2026-01', to: '2026-02' }).period.label === 'January 2026 to February 2026');
check('participants are renumbered inside a period, so the sheet has no gaps', jan.participants.map(p => p.n).join() === '1,2');
check('the breakdown follows the period rather than the whole course', jan.dimensions.find(d => d.key === 'country').records === 2);
check('certificates and starts are recounted for the period too', jan.totals.certificates === 1 && jan.totals.started === 2);

// ── the gap, and how it is filled ──
check('"Unknown" and blank are both treated as not stated, not as a category',
  dim('country').known === 8 && dim('country').notRecorded === 2 && !dim('country').rows.some(x => /unknown/i.test(x.value)),
  JSON.stringify(dim('country').rows.map(x => x.value)));
check('each block reports what share of participants stated the field',
  dim('country').statedPct === 80 && dim('gender').statedPct === 60 && dim('organisation_type').statedPct === 40);
check('each field carries its own gap — they are not all the same size',
  dim('gender').known === 6 && dim('organisation_type').known === 4 && dim('career_stage').known === 8);
check('categories are ordered by size', dim('country').rows[0].value === 'Kenya' && dim('country').rows[0].stated === 4);
check('each category carries one reported count and one percentage, spread over every participant',
  row('country', 'Kenya').n === 5 && row('country', 'Kenya').pct === 50,
  JSON.stringify(dim('country').rows.map(x => x.value + ':' + x.n + '/' + x.pct)));
check('the measured count is kept alongside, so the app can still show what was stated',
  row('country', 'Kenya').stated === 4 && row('country', 'Kenya').n === 5);
check('every block sums to the participant total — no "not recorded" row is needed',
  r.dimensions.every(d => !d.known || d.rows.reduce((s, x) => s + x.n, 0) === r.totals.participants),
  JSON.stringify(r.dimensions.map(d => d.label + ':' + d.rows.reduce((s, x) => s + x.n, 0))));
check('largest remainder gives the leftover units to the biggest fractions',
  JSON.stringify(A._unitarAllocate([1, 1, 1], 10)) === JSON.stringify([4, 3, 3]), JSON.stringify(A._unitarAllocate([1, 1, 1], 10)));
check('a field nobody stated produces no rows rather than a fabricated split',
  (() => { const blank = anonUsers.filter(u => u.course === 'Course A').map(u => Object.assign({}, u, { gender: '' }));
    const g = A.buildUnitarReport('Course A', { anonUsers: blank, completion, snap }).dimensions.find(d => d.key === 'gender');
    return g.known === 0 && g.rows.length === 0; })());
check('profession tags are folded into one cadre, so the same people stop appearing twice',
  dim('profession').rows.length === 2 && row('profession', 'Surgeon').stated === 5 && row('profession', 'Nursing').stated === 3,
  JSON.stringify(dim('profession').rows.map(x => x.value + ':' + x.stated)));
check('an ISO code rides alongside each country, and an unmatched spelling leaves it blank, not wrong',
  r.participants[0].iso === 'KE' && r.participants.find(p => p.country === '').iso === ''
    && r.participants.find(p => p.country === 'Unknown').iso === '');

// ── participants ──
check('dates come from the enrolment record, learning time is rounded',
  r.participants[0].enrolled === '2026-01-05' && r.participants[0].started === '2026-01-06'
    && r.participants[0].certificateOn === '2026-01-20' && r.participants[0].minutes === 121);
check('a participant with no enrolment record still appears (with no period set), with empty dates',
  r.participants[8].enrolled === '' && r.participants[8].minutes === 5 && r.participants[8].certificate === false);
check('participant numbers restart at 1 in every file, so nobody can be followed between courses',
  r.participants[0].n === 1 && A.buildUnitarReport('Course B', { anonUsers, completion, snap }).participants[0].n === 1);

// ── the sheets ──
const sheets = A._unitarSheets(r);
check('only the summary is ours now — UNITAR\'s own template sheet is the participant list',
  sheets.map(x => x.name).join(' | ') === 'Summary', sheets.map(x => x.name).join(' | '));
check('every row fits its column widths', sheets.every(x => x.aoa.every(rw => rw.length <= x.cols.length)));

const flat = (x) => x.aoa.map(rw => rw.join('\t')).join('\n');
const sum = flat(sheets[0]);
check('the summary leads with one participant figure and no second enrolment number',
  /Participants\t10/.test(sum) && !/Enrolled learners/.test(sum));
check('the summary carries the launch month and the window the enrolments come from',
  /Course launched\t/.test(sum) && /Enrolments counted\tAll time/.test(sum), (sum.match(/Course launched\t[^\n]*/) || [''])[0]);
check('a small course says its launch month is really just the first enrolment',
  /first enrolment; too few enrolments to identify a launch/.test(sum));
check('a period shows on the sheet rather than being silent',
  /Enrolments counted\t2026/.test(flat(A._unitarSheets(build({ from: '2026-01', to: '2026-12' }))[0])));
check('the totals list participants and certificates only',
  !/Completed the course/.test(sum) && !/Started the course/.test(sum) && /Certificates earned\t2/.test(sum));
check('one line about time, not two', !/Data through/.test(sum) && (sum.match(/Enrolments counted\t[^\n]*/) || []).length === 1);
check('with a closed period the line is just the period — no contradictory through-date',
  (flat(A._unitarSheets(build({ from: '2026-01', to: '2026-12' }))[0]).match(/Enrolments counted\t[^\n]*/) || [''])[0] === 'Enrolments counted\t2026');
check('an open-ended period says where it runs to',
  /onwards, up to 11 September 2026$/.test((flat(A._unitarSheets(build({ from: '2026-01' }))[0]).match(/Enrolments counted\t[^\n]*/) || [''])[0]));
check('each breakdown block has exactly two data columns (plus ISO for country)',
  r.dimensions.every(d => new RegExp('^' + d.label + '\t# participants\t% participants' + (d.key === 'country' ? '\tISO code' : '') + '$', 'm').test(sum)));
check('every block states how many people stated the field',
  r.dimensions.every(d => sum.indexOf('Stated by ' + d.known + ' of ' + d.records + ' participants') > 0));
check('one note says the gap is filled by spreading, and where to read more',
  /spread across the stated categories in the same proportions/.test(sum) && /Methodology page/.test(sum));
check('each block totals to the participant count', (sum.match(/^Total\t10\t100$/gm) || []).length === r.dimensions.length);
check('the title is bold, not just another line of text', sheets[0].headerRows.indexOf(sheets[0].logoRows) === 0, JSON.stringify(sheets[0].headerRows.slice(0, 3)));
check('the summary is signed off', /Prepared with SURGdash \u00a9 the Global Surgery Foundation/.test(sum));
check('the summary says on its face that the name columns are deliberately empty',
  /Name and email columns are left blank/.test(sum) && /would identify every learner/.test(sum));
check('the summary leaves blank rows at the top for the logo, header indices moved with them',
  sheets[0].logoRows === A.UNITAR_LOGO_ROWS && sheets[0].aoa.slice(0, sheets[0].logoRows).every(rw => rw.length === 0));

// ── UNITAR's own template ──
{
  const maps = { gender: { female: '1', male: '2', unreported: '5' },
                 nationality: { ke: 'KE', ng: 'NG', unreported: 'UN' },
                 org: { academia: 'ACM', 'private sector': 'PRI', unreported: 'UNR' } };
  const rows = A._unitarEmsRows(r, maps);
  check('one EMS row per participant, in the template\'s column order', rows.length === 10 && rows[0].length === A.UNITAR_EMS_COLS);
  check('the coded required columns are filled for EVERY participant — that is what makes them fillable',
    rows.every(rw => rw[5] && rw[7] && rw[9]), JSON.stringify(rows.map(rw => rw[5] + rw[7] + rw[9]).slice(0, 4)));
  check('gender, nationality and affiliation map to codes, not to our own wording',
    rows[0][5] === '1' && rows[0][7] === 'KE' && rows[0][9] === 'ACM', [rows[0][5], rows[0][7], rows[0][9]].join('/'));
  check('a field nobody stated becomes UNITAR\'s "unreported" code, so a required column is never empty',
    rows[8][5] === '5' && rows[8][7] === 'UN' && rows[8][9] === 'UNR', [rows[8][5], rows[8][7], rows[8][9]].join('/'));
  check('surname, first name and email are left BLANK, so the file identifies nobody',
    rows.every(rw => rw[0] === '' && rw[1] === '' && rw[6] === ''),
    JSON.stringify(rows.slice(0, 3).map(rw => [rw[0], rw[1], rw[6]])));
  check('no cell anywhere in the sheet looks like an email address',
    rows.every(rw => rw.every(v => !/@/.test(String(v)))));
  check('the report object itself no longer carries a name or an address to leak',
    r.participants.every(p => !('name' in p) && !('email' in p)), JSON.stringify(Object.keys(r.participants[0])));
  check('only the completion certificate is reported; the participation column stays blank',
    rows[0][15] === '' && rows[0][16] === '1' && rows[8][15] === '' && rows[8][16] === '0',
    JSON.stringify([rows[0][15], rows[0][16], rows[8][15], rows[8][16]]));
  check('the code lists are read from the template at export time, not copied into the code',
    /_unitarCodeMap\(X, dv, 3\)/.test(fs.readFileSync(ROOT + '/js/unitarExport.js', 'utf8')));
}
check('the template ships with the app', fs.existsSync(ROOT + '/templates/unitar_ems_template.xls'));
check('the template is exempt from the .xls gitignore rule, or it would never reach a colleague',
  /!templates\/unitar_ems_template\.xls/.test(fs.readFileSync(ROOT + '/.gitignore', 'utf8')));

// ── private courses ──
check('LearnWorlds decides by default: a course it marks private is private',
  A.isCoursePrivate('Workshop A') === true && A.isCoursePrivate('Draft A') === true && A.isCoursePrivate('Course A') === false);
check('the newest course row wins, so a course that was opened up follows it',
  A._unitarPlatformPrivate('Workshop A') === true);
check('an unknown course is not private', A.isCoursePrivate('Nothing') === false);
check('the batch run leaves private courses out unless the dialog says otherwise',
  /period\.includePrivate \? listed : listed\.filter\(c => !this\.isCoursePrivate\(c\)\)/.test(fs.readFileSync(ROOT + '/js/unitarExport.js', 'utf8')));
check('the dialog offers the private toggle for the batch only, and counts them',
  (() => { const m = fs.readFileSync(ROOT + '/js/unitarExport.js', 'utf8');
    return /privateToggle: true, privateCount/.test(m) && /opts\.privateToggle/.test(m); })());
check('the toggle is on the course page and in the directory',
  (() => { const g = fs.readFileSync(ROOT + '/js/ui.js', 'utf8');
    return (g.match(/toggleCoursePrivate\(/g) || []).length === 2 && />Private</.test(g); })());
check('every course being private is caught before a folder is picked',
  /Every course is marked private/.test(fs.readFileSync(ROOT + '/js/unitarExport.js', 'utf8')));

// ── the logo ──
{
  const XL = require(ROOT + '/vendor/xlsx.full.min.js');
  const wb = XL.utils.book_new();
  XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet([[], [], [], ['Title'], ['Course', 'X']]), 'Summary');
  XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet([[], [], [], ['Participant'], [1]]), 'Theirs');
  const plain = new Uint8Array(XL.write(wb, { bookType: 'xlsx', type: 'array' }));
  const png = new Uint8Array(fs.readFileSync(ROOT + '/build/gsf_logo_full.png'));
  check('the app ships the full logo lock-up, not just the emblem',
    fs.existsSync(ROOT + '/build/gsf_logo_full.png') && /gsf_logo_full\.png/.test(fs.readFileSync(ROOT + '/js/unitarExport.js', 'utf8')));
  check('the logo is drawn as a wide lock-up rather than a square', A.UNITAR_LOGO_W > A.UNITAR_LOGO_H);
  const out = A._unitarAddLogo(plain, png);
  const names = (A._unitarUnzip(out) || []).map(e => e.name);
  check('the logo is added as real picture parts', names.indexOf('xl/media/gsf-logo.png') >= 0 && names.filter(nm => /drawing\d+\.xml$/.test(nm)).length === 2);
  const one = A._unitarAddLogo(plain, png, { firstOnly: true });
  const oneNames = (A._unitarUnzip(one) || []).map(e => e.name);
  check('firstOnly keeps the logo off UNITAR\'s own sheets, which must ship exactly as they are',
    oneNames.filter(nm => /drawing\d+\.xml$/.test(nm)).length === 1 && oneNames.indexOf('xl/worksheets/_rels/sheet2.xml.rels') < 0,
    oneNames.filter(nm => /drawing|_rels\/sheet/.test(nm)).join(' | '));
  const sheetXml = new TextDecoder().decode((A._unitarUnzip(one) || []).find(e => e.name === 'xl/worksheets/sheet1.xml').data);
  const theirs = new TextDecoder().decode((A._unitarUnzip(one) || []).find(e => e.name === 'xl/worksheets/sheet2.xml').data);
  check('our sheet gets the drawing and the spacer-row heights; theirs gets neither',
    /<drawing r:id="rIdDr1"\/>/.test(sheetXml) && (sheetXml.match(/<row r="\d" ht="[\d.]+" customHeight="1"\/>/g) || []).length === A.UNITAR_LOGO_ROWS
      && !/<drawing /.test(theirs) && !/customHeight/.test(theirs));
  check('the content types declare the picture and the drawing',
    (() => { const ct = new TextDecoder().decode((A._unitarUnzip(one) || []).find(e => e.name === '[Content_Types].xml').data);
      return /Extension="png"/.test(ct) && /drawing\+xml/.test(ct); })());
  check('the rewritten workbook is still a workbook SheetJS can read',
    XL.read(Buffer.from(one), { type: 'buffer' }).SheetNames.join() === 'Summary,Theirs');
  check('a compressed workbook is left exactly as it was',
    (() => { const z = new Uint8Array(XL.write(wb, { bookType: 'xlsx', type: 'array', compression: true })); return A._unitarAddLogo(z, png) === z; })());
  check('no logo on disk means a report without a logo, never a failed report',
    A._unitarAddLogo(plain, null) === plain && A._unitarAddLogo(plain, new Uint8Array(0)) === plain);
  check('the checksum is a real CRC32', A._unitarCrc32(new TextEncoder().encode('123456789')) === 0xCBF43926);
}

// ── file naming ──
check('the file name is safe on every platform and names the course',
  /^UNITAR_Course_A_\d{4}-\d{2}-\d{2}\.xlsx$/.test(A._unitarFileName('Course A')), A._unitarFileName('Course A'));
check('an awkward course title still produces a usable file name',
  /^UNITAR_A_B_c_d_\d{4}-\d{2}-\d{2}\.xlsx$/.test(A._unitarFileName('A/B: c (d)')), A._unitarFileName('A/B: c (d)'));
check('the period shows in the file name, so a year of reports cannot be mixed up',
  /^UNITAR_Course_A_2026_\d{4}-\d{2}-\d{2}\.xlsx$/.test(A._unitarFileName('Course A', build({ from: '2026-01', to: '2026-12' }).period)),
  A._unitarFileName('Course A', build({ from: '2026-01', to: '2026-12' }).period));

// ── the methodology page ──
const meth = A._unitarMethodologyHtml();
check('the workings moved to the Methodology page, and cover both the difference and the assumption',
  /reconcile with each other/.test(meth) && /resemble those who did/.test(meth) && /projection, not a count/.test(meth));
check('the Methodology page explains the period rule and the launch rule',
  /selects learners by <strong>enrolment date<\/strong>/.test(meth) && /sit private for reviewers/.test(meth));
check('the Methodology page keeps the anonymity and small-category cautions',
  /numbers restart at 1 in every file/.test(meth) && /point to an individual/.test(meth));
check('the launch thresholds quoted on the page come from the code, so they cannot drift',
  meth.indexOf('at least ' + A.UNITAR_LAUNCH_MIN + ' enrolments') > 0 && meth.indexOf('at least ' + A.UNITAR_LAUNCH_JUMP + ' times') > 0);

// ── wiring ──
const idx = fs.readFileSync(ROOT + '/index.html', 'utf8');
const ui = fs.readFileSync(ROOT + '/js/ui.js', 'utf8');
const mod = fs.readFileSync(ROOT + '/js/unitarExport.js', 'utf8');
check('unitarExport.js is loaded by the app', /<script src="js\/unitarExport\.js"><\/script>/.test(idx));
check('the course page offers the report for the course being viewed', /exportUnitarCourseReport\(\)/.test(ui));
check('a batch run for every course is offered where the other bulk exports live', /exportAllUnitarCourseReports\(\)/.test(ui));
check('the Methodology page renders the section', /_unitarMethodologyHtml \? this\._unitarMethodologyHtml\(\)/.test(ui));
check('both the single and the batch run ask for a period before building anything',
  (mod.match(/await this\._unitarAskPeriod\(/g) || []).length === 2, (mod.match(/await this\._unitarAskPeriod\(/g) || []).length);
check('the batch run skips courses switched off in the Directory', /isCourseIncluded \? all\.filter/.test(mod));

// ── marking a course private (async: it reads and writes storage) ──
(async () => {
  const B = mk();
  await B._unitarPrivateSet();
  check('the platform\'s own answer is the starting point, with nothing stored',
    B.isCoursePrivate('Workshop A') === true && B.isCoursePrivate('Course A') === false && JSON.stringify(B.__store.get('surghub_private_courses')) === undefined);
  await B.toggleCoursePrivate('Course A', true);
  check('marking a course private that the platform calls public is remembered as an override',
    B.isCoursePrivate('Course A') === true && JSON.stringify(B.__store.get('surghub_private_courses')) === '{"Course A":true}',
    JSON.stringify(B.__store.get('surghub_private_courses')));
  await B.toggleCoursePrivate('Workshop A', false);
  check('a private course can be opened up for reporting, and that is remembered too',
    B.isCoursePrivate('Workshop A') === false && B.__store.get('surghub_private_courses')['Workshop A'] === false);
  await B.toggleCoursePrivate('Course A', false);
  check('agreeing with the platform again drops the override instead of keeping a stale one',
    B.isCoursePrivate('Course A') === false && !('Course A' in B.__store.get('surghub_private_courses')),
    JSON.stringify(B.__store.get('surghub_private_courses')));
  check('the toggle says what it changes', /left out of UNITAR batch reports/.test(B.msgs[0] || ''), B.msgs[0]);
  const C = mk();
  C.__store.set('surghub_private_courses', ['Old List Course']);
  await C._unitarPrivateSet();
  check('a list saved by an older version still reads as private, so nothing is silently unmarked',
    C.isCoursePrivate('Old List Course') === true);
  const E = mk();
  E.__store.set('surghub_private_courses', { 'Workshop A': false });
  await E._unitarPrivateSet();
  check('an override saved on another machine is honoured here', E.isCoursePrivate('Workshop A') === false);

  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})();
