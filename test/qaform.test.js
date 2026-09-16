// UNITAR quality-assessment form: js/qaForm.js and js/courseDetails.js in a VM,
// filling the real template that ships with the app.
const vm = require('vm'), fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };

const snap = [{ Course: 'Burns 101', Provider: 'Interburns', CourseId: 'burns-101', Learners: 900, Certificates: 300, Access: 'free', Timestamp: '2026-09-11' }];
const anonUsers = [
  { course: 'Burns 101', user_uid: 'u1', country: 'Kenya', gender: 'Female', organisation_type: 'Academia', career_stage: 'In practice', profession: 'nursing', signup_month: '2025-02', has_certificate: 'Yes', course_minutes: 80 },
  { course: 'Burns 101', user_uid: 'u2', country: 'Nigeria', gender: 'Male', organisation_type: '', career_stage: '', profession: 'surgeon', signup_month: '2025-03', has_certificate: 'No', course_minutes: 40 },
];
const completion = [
  { uid: 'u1', course: 'Burns 101', enrolled_date: '2025-02-01', start_date: '2025-02-02', certificate_date: '2025-02-20', completed: true, certificate: true, time_minutes: 80 },
  { uid: 'u2', course: 'Burns 101', enrolled_date: '2025-03-01', start_date: '2025-03-02', certificate_date: '', completed: false, certificate: false, time_minutes: 40 },
];

function mk(opts) {
  opts = opts || {};
  const store = new Map();
  const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, Intl, isNaN, isFinite, parseInt, parseFloat, setTimeout,
    __swallowed() {}, alert(m) { ctx.App.alerts.push(m); }, confirm() { return true; }, prompt() { return '2025'; },
    TextEncoder, TextDecoder, DataView, Uint8Array, Int32Array, ArrayBuffer, DecompressionStream, Response,
    document: { getElementById: () => null },
    Storage: { async getItem(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; },
               async setItem(k, v) { store.set(k, JSON.parse(JSON.stringify(v))); } },
  };
  ctx.window = ctx;
  ctx.Taxonomy = { canonProf: (v) => /nurs/i.test(v) ? 'Nursing' : 'Surgeon' };
  ctx.countryToISO = (n) => ({ Kenya: 'KE', Nigeria: 'NG' }[String(n).trim()] || null);
  ctx.App = { alerts: [], msgs: [], selectedCourse: 'Burns 101', data: snap,
    formatNumber: (v) => new Intl.NumberFormat('en-US').format(v || 0),
    escapeHtml: String, showMsg(m) { this.msgs.push(m); } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ROOT + '/js/unitarExport.js', 'utf8'), ctx, { filename: 'unitarExport.js' });
  vm.runInContext(fs.readFileSync(ROOT + '/js/courseDetails.js', 'utf8'), ctx, { filename: 'courseDetails.js' });
  vm.runInContext(fs.readFileSync(ROOT + '/js/qaForm.js', 'utf8'), ctx, { filename: 'qaForm.js' });
  ctx.App.__store = store;
  return ctx.App;
}

const A = mk();
const report = A.buildUnitarReport('Burns 101', { anonUsers, completion, snap, from: '2025-01', to: '2025-12' });

// ── course details ──
check('the public course link is built from the course id, not from the survey URL on the record',
  A.coursePublicUrl('burns-101') === 'https://www.surghub.org/course/burns-101' && A.coursePublicUrl('') === '',
  A.coursePublicUrl('burns-101'));
check('a course id with awkward characters is escaped into the link', A.coursePublicUrl('a b/c') === 'https://www.surghub.org/course/a%20b%2Fc');
check('the description is stripped of markup and of the editors\' keyword tail',
  A._courseCleanDescription('<p>Burn care <b>basics</b>.</p><p>Second line.</p>Keywords: burns ; lifebox') === 'Burn care basics.\nSecond line.',
  JSON.stringify(A._courseCleanDescription('<p>Burn care <b>basics</b>.</p><p>Second line.</p>Keywords: burns ; lifebox')));
check('html entities come back as characters', A._courseCleanDescription('Tom &amp; Jerry&nbsp;care') === 'Tom & Jerry care');
check('objectives are taken only when the course states them',
  A._courseObjectives('Intro text.\nLearning objectives:\n- Assess a burn\n- Fluid resuscitation') === 'Assess a burn\nFluid resuscitation',
  JSON.stringify(A._courseObjectives('Intro text.\nLearning objectives:\n- Assess a burn\n- Fluid resuscitation')));
check('a description with no objectives section yields none rather than a paraphrase',
  A._courseObjectives('This module covers strategies to minimise risk of infection.') === '');
check('the course-summary store travels with the SURGhub data, in both directions',
  (() => { const st = fs.readFileSync(ROOT + '/js/storage.js', 'utf8');
    return /'surghub_course_details': path\.join\('surghub', 'course_details\.json'\)/.test(st)
      && /'course_details': 'surghub_course_details'/.test(st); })());
check('the fetch is paced, because this API has bitten us before',
  A.COURSE_DETAILS_GAP_MS >= 1000 && /await new Promise\(res => setTimeout\(res, this\.COURSE_DETAILS_GAP_MS\)\)/.test(fs.readFileSync(ROOT + '/js/courseDetails.js', 'utf8')));

// ── the answers ──
const detail = { courseId: 'burns-101', title: 'Burns 101', description: 'A course about burns.', objectives: '', url: 'https://www.surghub.org/course/burns-101' };
const a = A.buildQaAnswers('Burns 101', { year: 2025, report, detail });
check('the form covers the year asked for, both ends', a.rows['Date of event'] === '2025/1/1 – 2025/12/31' && a.year === 2025);
check('a leap year is 366 days, not 365', A.buildQaAnswers('Burns 101', { year: 2024, report, detail }).rows['Duration of event'].indexOf('366 days') === 0);
check('the title comes from the course record, the location from its public link',
  a.rows['Title of event'] === 'Burns 101' && a.rows['Location'] === 'https://www.surghub.org/course/burns-101');
check('the provider is named as the partner, alongside GSF', a.rows['Partners'] === 'Interburns, in partnership with the Global Surgery Foundation', a.rows['Partners']);
check('a course with no known provider still names GSF',
  A.buildQaAnswers('Burns 101', { year: 2025, report: Object.assign({}, report, { provider: 'Unknown Provider' }), detail }).rows['Partners'] === 'Global Surgery Foundation');
check('the course summary answers "event objectives"', a.rows['Event objectives'] === 'A course about burns.');
check('learning objectives stay empty unless the course states them, as in UNITAR\'s own example',
  a.rows['Learning objectives'] === '' && a.blanks.indexOf('Learning objectives') >= 0);
check('when the course does state objectives they are used',
  A.buildQaAnswers('Burns 101', { year: 2025, report, detail: Object.assign({}, detail, { objectives: 'Assess a burn' }) }).rows['Learning objectives'] === 'Assess a burn');
check('the additional information carries the year\'s participation, from the same figures as the report',
  /2 learners enrolled during 2025/.test(a.rows['Additional Information']) && /1 certificates? were earned/.test(a.rows['Additional Information'])
    && /countries represented/.test(a.rows['Additional Information']),
  a.rows['Additional Information'].split('\n')[0]);
check('the figures are attributed', /Figures prepared with SURGdash, the Global Surgery Foundation\./.test(a.rows['Additional Information']));
check('what the app cannot know is named rather than invented',
  a.rows['Main language(s) of event'] === '' && a.rows['Activity’s focal point'] === ''
    && a.blanks.indexOf('Main language(s) of event') >= 0 && a.blanks.indexOf('Activity’s focal point') >= 0,
  JSON.stringify(a.blanks));
check('a course with no fetched summary says so, rather than filling the row with filler',
  (() => { const x = A.buildQaAnswers('Burns 101', { year: 2025, report, detail: {} });
    return x.rows['Event objectives'] === '' && x.blanks.indexOf('Event objectives') >= 0; })());

// ── filling their document ──
check('a label split across runs by Word is still recognised',
  (() => { const xml = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Mode of d</w:t></w:r><w:r><w:t>elivery</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:x/></w:tcPr><w:p><w:r><w:t>old</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const res = A.fillQaDocumentXml(xml, { 'Mode of delivery': 'Online' });
    return res.filled.join() === 'Mode of delivery' && /<w:t xml:space="preserve">Online<\/w:t>/.test(res.xml) && /<w:tcPr><w:x\/><\/w:tcPr>/.test(res.xml); })());
check('the hint text in the same cell does not stop the match',
  A.fillQaDocumentXml('<w:tr><w:tc><w:p><w:t>Deadline for r</w:t><w:t>egistration (Y/M/D)</w:t></w:p></w:tc><w:tc><w:p/></w:tc></w:tr>',
    { 'Deadline for registration': 'Open' }).filled.join() === 'Deadline for registration');
check('a row the app has no answer for is left exactly as it was',
  (() => { const xml = '<w:tr><w:tc><w:p><w:t>Something else</w:t></w:p></w:tc><w:tc><w:p><w:t>keep me</w:t></w:p></w:tc></w:tr>';
    const res = A.fillQaDocumentXml(xml, { 'Mode of delivery': 'Online' });
    return res.xml === xml && res.filled.length === 0; })());
check('a multi-line answer becomes several paragraphs, not one run with newlines in it',
  (() => { const res = A.fillQaDocumentXml('<w:tr><w:tc><w:p><w:t>Additional Information</w:t></w:p></w:tc><w:tc><w:p/></w:tc></w:tr>', { 'Additional Information': 'One\nTwo' });
    return (res.xml.match(/<w:p><w:r><w:t xml:space="preserve">/g) || []).length === 2; })());
check('angle brackets and ampersands in an answer cannot break the document',
  /Tom &amp; &lt;Jerry&gt;/.test(A.fillQaDocumentXml('<w:tr><w:tc><w:p><w:t>Partners</w:t></w:p></w:tc><w:tc><w:p/></w:tc></w:tr>', { Partners: 'Tom & <Jerry>' }).xml));

// ── the real template, end to end ──
(async () => {
  check('the QA template ships with the app', fs.existsSync(ROOT + '/templates/unitar_qa_form.docx'));
  const B = mk();
  B._qaTemplate = new Uint8Array(fs.readFileSync(ROOT + '/templates/unitar_qa_form.docx'));
  const { bytes, filled, answers } = await B.buildQaDocument('Burns 101', { year: 2025, report, detail });
  check('every row of UNITAR\'s form is answered, so none is left looking overlooked',
    filled.length === 20, filled.length + ' rows: ' + filled.slice(0, 6).join(', '));
  const back = await B._qaUnzip(bytes);
  check('the document is still a Word document: every part that came in goes back out',
    back.length === (await B._qaUnzip(B._qaTemplate)).length && back.some(e => e.name === 'word/document.xml')
      && back.some(e => e.name === '[Content_Types].xml') && back.some(e => /customXml/.test(e.name)),
    back.length + ' parts');
  const doc = new TextDecoder().decode(back.find(e => e.name === 'word/document.xml').data);
  check('the answers are in the document', /Essential|Burns 101/.test(doc) && /Interburns, in partnership/.test(doc) && /surghub\.org\/course\/burns-101/.test(doc));
  check('UNITAR\'s own labels and styling survive untouched',
    /QUALITY ASSESMENT/i.test(doc.replace(/<[^>]+>/g, '')) && /w:tblPr/.test(doc));
  check('the example answers UNITAR shipped are gone, not left beside ours',
    !/United Nations Global Surgery Learning Hub/.test(doc) && !/Michaela/.test(doc));
  check('the rewritten archive is a valid zip our own reader can walk', !!back && back.length > 20);
  check('nothing personal reaches the form', !/@/.test(doc.replace(/xmlns[^"]*"[^"]*"/g, '')) || !/[a-z0-9]+@[a-z0-9]+\.[a-z]/i.test(doc));

  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})();
