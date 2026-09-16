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
    document: {
      getElementById: () => null,
      // Enough of a DOM for the year dialog, which is the only way into the export now.
      createElement() {
        const nodes = {};
        const stub = (sel) => nodes[sel] || (nodes[sel] = { value: '', style: {}, focus() {}, select() {}, getAttribute: (a) => (sel.match(/\[data-y="(\d+)"\]/) || [])[1] });
        const el = {
          id: '', style: {}, _html: '',
          set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
          querySelector: (sel) => stub(sel),
          querySelectorAll: (sel) => {
            if (sel !== '[data-y]') return [];
            return (el._html.match(/data-y="(\d+)"/g) || []).map(m => {
              const y = m.match(/\d+/)[0];
              return Object.assign(stub('[data-y="' + y + '"]'), { getAttribute: () => y });
            });
          },
          remove() { el.removed = true; },
        };
        ctx.App.__dialog = el;   // mk() hands back ctx.App, so hang it there
        return el;
      },
      body: { appendChild() {} },
    },
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

// ── what the public course page carries ──
{
  const page = '<h2><span>Learning </span><span> Objectives</span></h2>'
    + '<ul><li><span class="icon"></span><div>Understand what Global Surgery is today</div></li>'
    + '<li><div>Identify current challenges</div></li></ul>'
    + '<div>Language: <strong>English</strong></div>';
  const f = A._coursePageFacts(page);
  check('the objectives list is read from the page, heading split across spans and all',
    f.objectives.length === 2 && f.objectives[0] === 'Understand what Global Surgery is today', JSON.stringify(f.objectives));
  check('the language is read from the page, where it is printed as a label and a value', f.language === 'English', JSON.stringify(f.language));
  check('a page with no objectives section yields none rather than grabbing the wrong list',
    A._coursePageFacts('<h2>Structure</h2><ul><li><div>Module 1</div></li></ul>').objectives.length === 0);
  check('a page with no language leaves it empty', A._coursePageFacts('<h2>Learning Objectives</h2><ul><li><div>x y z</div></li></ul>').language === '');
  check('the value is taken even when it sits on the next line rather than beside the label',
    A._coursePageFacts('<div>Language:</div><div>French</div>').language === 'French');
  // SURGhub publishes each course page in the course's own language, labels and all.
  const esPage = '<h2>OBJETIVOS DE APRENDIZAJE</h2>'
    + '<ul><li><div>Explica los principios básicos.</div></li><li><div>Identifica las fases.</div></li></ul>'
    + '<div>Diseñado para:</div><div>Profesionales sanitarios, enfermeros y estudiantes.</div>'
    + '<div>Idioma:</div><div>Español</div>';
  const es = A._coursePageFacts(esPage);
  check('a Spanish course page is read as readily as an English one',
    es.language === 'Español' && es.objectives.length === 2 && /Profesionales sanitarios/.test(es.targetAudience),
    JSON.stringify([es.language, es.objectives.length, es.targetAudience.slice(0, 40)]));
  const frPage = '<h2>Objectifs Pédagogiques</h2><ul><li><div>Développer des activités.</div></li></ul>'
    + '<div>Public cible:</div><div>Chirurgiens et infirmiers.</div><div>Langue :</div><div>Français</div>';
  const fr = A._coursePageFacts(frPage);
  check('a French page too, including the space French puts before its colon',
    fr.language === 'Français' && fr.objectives.length === 1 && /Chirurgiens/.test(fr.targetAudience),
    JSON.stringify([fr.language, fr.objectives.length, fr.targetAudience]));
  check('accents are not required to match: the comparison survives them',
    A._coursePageFacts('<h2>Objectifs pedagogiques</h2><ul><li><div>Une chose utile.</div></li></ul>').objectives.length === 1);
  check('the label must be the whole label, not a word inside a sentence',
    A._coursePageFacts('<div>We changed the language: it is now clearer</div>').language === '', 
    JSON.stringify(A._coursePageFacts('<div>We changed the language: it is now clearer</div>').language));
  check('a page that is not a course page cannot poison the fields',
    (() => { const g = A._coursePageFacts('<html><body>nothing here</body></html>'); return g.objectives.length === 0 && g.language === ''; })());
  check('the page fetch never takes the whole run down with it',
    /catch \(e\) \{ __swallowed\(e, 'courseDetails\.page\./.test(fs.readFileSync(ROOT + '/js/courseDetails.js', 'utf8')));
  check('the page list beats a description that happens to mention objectives',
    /page\.objectives\.length \? page\.objectives\.join/.test(fs.readFileSync(ROOT + '/js/courseDetails.js', 'utf8')));
}

// ── the answers ──
const detail = { courseId: 'burns-101', title: 'Burns 101', description: 'A course about burns.', objectives: '', language: 'English', targetAudience: 'Nurses and surgeons.', url: 'https://www.surghub.org/course/burns-101' };
const withObj = Object.assign({}, detail, { objectives: 'Assess a burn\nResuscitate' });
const a = A.buildQaAnswers('Burns 101', { year: 2025, report, detail });
check('the form covers the year asked for, both ends', a.rows['Date of event'] === '2025/1/1 – 2025/12/31' && a.year === 2025);
check('a leap year is 366 days, not 365', A.buildQaAnswers('Burns 101', { year: 2024, report, detail }).rows['Duration of event'].indexOf('366 days') === 0);
check('the title comes from the course record, the location from its public link',
  a.rows['Title of event'] === 'Burns 101' && a.rows['Location'] === 'https://www.surghub.org/course/burns-101');
check('partners is the SURGhub partnership itself, named in full, the same on every form',
  a.rows['Partners'] === 'The Global Surgery Foundation'
    && ['Interburns', 'Unknown Provider', 'GSF'].every(p =>
      A.buildQaAnswers('Burns 101', { year: 2025, report: Object.assign({}, report, { provider: p }), detail }).rows['Partners'] === 'The Global Surgery Foundation'),
  a.rows['Partners']);
check('the body that wrote the course is named under additional information instead',
  a.rows['Additional Information'] === 'Course provider: Interburns', a.rows['Additional Information']);
check('a GSF-run course does not name GSF as its own provider as well',
  ['GSF - Global Surgery Foundation', 'Global Surgery Foundation', 'GSF', 'Unknown Provider'].every(p =>
    A.buildQaAnswers('Burns 101', { year: 2025, report: Object.assign({}, report, { provider: p }), detail }).rows['Additional Information'] === ''));
check('the course summary answers "event objectives"', a.rows['Event objectives'] === 'A course about burns.');
check('event objectives carry the summary AND the learning objectives, which is what UNITAR asked for',
  (() => { const x = A.buildQaAnswers('Burns 101', { year: 2025, report, detail: withObj });
    return x.rows['Event objectives'] === 'A course about burns.\n\nLearning objectives:\nAssess a burn\nResuscitate'; })(),
  JSON.stringify(A.buildQaAnswers('Burns 101', { year: 2025, report, detail: withObj }).rows['Event objectives']));
check('the objectives still stand alone in their own row',
  A.buildQaAnswers('Burns 101', { year: 2025, report, detail: withObj }).rows['Learning objectives'] === 'Assess a burn\nResuscitate');
check('a course whose page states no objectives leaves both rows honest rather than padded',
  a.rows['Learning objectives'] === '' && a.rows['Event objectives'] === 'A course about burns.' && a.blanks.indexOf('Learning objectives') >= 0);
check('the language is filled from the course page',
  a.rows['Main language(s) of event'] === 'English' && a.blanks.indexOf('Main language(s) of event') < 0);
check('a course page with no language stated leaves the row empty and says so',
  (() => { const x = A.buildQaAnswers('Burns 101', { year: 2025, report, detail: Object.assign({}, detail, { language: '' }) });
    return x.rows['Main language(s) of event'] === '' && x.blanks.indexOf('Main language(s) of event') >= 0; })());
check('the focal point is UNITAR\'s own', a.rows['Activity’s focal point'] === 'Michaela DORCIKOVA <Michaela.DORCIKOVA@unitar.org>');
check('the target audience is the course\'s own wording when its page states one',
  a.rows['Target audience'] === 'Nurses and surgeons.');
check('a course page with no audience falls back to ours rather than leaving it blank',
  /Surgical, obstetric, anaesthesia and nursing care providers/.test(
    A.buildQaAnswers('Burns 101', { year: 2025, report, detail: Object.assign({}, detail, { targetAudience: '' }) }).rows['Target audience']));
check('content and structure says what the course is, without the learning-time aside',
  a.rows['Content and structure'] === 'Self-paced online course hosted on SURGhub.', a.rows['Content and structure']);
check('a course with no fetched summary says so, rather than filling the row with filler',
  (() => { const x = A.buildQaAnswers('Burns 101', { year: 2025, report, detail: {} });
    return x.rows['Event objectives'] === '' && x.blanks.indexOf('Event objectives') >= 0; })());

// ── how the rows are rendered ──
{
  const ctx = { bulletNumId: '2', linkRelId: 'rId13', logoRelId: 'rId14', logoW: 120, logoH: 56 };
  const row = (label, value, c) => A._qaCellXml('<w:tcPr/>', value, A.QA_ROW_FORMAT[label], c === undefined ? ctx : c);
  check('the location is a real hyperlink, using the relationship the document was given',
    /<w:hyperlink r:id="rId13">/.test(row('Location', 'https://www.surghub.org/course/x'))
      && /<w:u w:val="single"\/>/.test(row('Location', 'https://www.surghub.org/course/x')));
  check('a location that is not a link is left as plain text rather than linked to nothing',
    !/<w:hyperlink/.test(row('Location', 'https://www.surghub.org/course/x', {})));
  check('learning objectives become a real Word list, using the template\'s own bullet',
    (A._qaCellXml('', 'One\nTwo', A.QA_ROW_FORMAT['Learning objectives'], ctx).match(/<w:numId w:val="2"\/>/g) || []).length === 2);
  check('with no bullet definition to point at, a literal bullet still reads as a list',
    /\u2022 One/.test(A._qaCellXml('', 'One\nTwo', A.QA_ROW_FORMAT['Learning objectives'], {})));
  check('in event objectives the summary stays prose and only the objectives are bulleted',
    (() => { const x = row('Event objectives', 'A summary.\n\nLearning objectives:\nOne\nTwo');
      return (x.match(/<w:numPr>/g) || []).length === 2 && /A summary\.<\/w:t>/.test(x) && !/<w:numPr>[\s\S]{0,120}A summary/.test(x); })(),
    (row('Event objectives', 'A summary.\n\nLearning objectives:\nOne\nTwo').match(/<w:numPr>/g) || []).length + ' bulleted');
  check('the logo goes in the partners cell, ahead of the words, with a blank line between',
    (() => { const x = row('Partners', 'The Global Surgery Foundation');
      return x.indexOf('<w:drawing>') > 0 && x.indexOf('<w:drawing>') < x.indexOf('The Global Surgery Foundation')
        && /<\/w:drawing><\/w:r><\/w:p><w:p\/>/.test(x) && /r:embed="rId14"/.test(x); })(),
    (row('Partners', 'The Global Surgery Foundation').match(/<\/w:p>[\s\S]{0,12}/) || [''])[0]);
  check('no logo relationship means no picture and no stray blank line',
    (() => { const x = row('Partners', 'The Global Surgery Foundation', {}); return !/<w:drawing>/.test(x) && !/<w:p\/>/.test(x); })());
  check('the picture declares the namespaces the document does not',
    /xmlns:pic="http:\/\/schemas\.openxmlformats\.org\/drawingml\/2006\/picture"/.test(row('Partners', 'x'))
      && /xmlns:a="http:\/\/schemas\.openxmlformats\.org\/drawingml\/2006\/main"/.test(row('Partners', 'x')));
  check('the bullet list is found in the template\'s own numbering, preferring the standard bullet',
    A._qaBulletNumId('<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="\uF0B7"/></w:lvl></w:abstractNum>'
      + '<w:abstractNum w:abstractNumId="3"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="-"/></w:lvl></w:abstractNum>'
      + '<w:num w:numId="1"><w:abstractNumId w:val="3"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>') === '2');
  check('numbering with no bullet at all yields nothing rather than a wrong list',
    A._qaBulletNumId('<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>') === '');
  check('a new relationship continues the document\'s own numbering and never reuses an id',
    (() => { const r0 = '<Relationships><Relationship Id="rId1"/><Relationship Id="rId12"/></Relationships>';
      const a1 = A._qaAddRel(r0, 'hyperlink', 'https://x.test/a?b=1&c=2', true);
      const a2 = A._qaAddRel(a1.rels, 'image', 'media/gsf-logo.png', false);
      return a1.id === 'rId13' && a2.id === 'rId14' && /TargetMode="External"/.test(a1.rels)
        && /b=1&amp;c=2/.test(a1.rels) && !/TargetMode/.test(a2.rels.slice(a2.rels.indexOf('gsf-logo'))); })());
}

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
  const uiSrc = fs.readFileSync(ROOT + '/js/ui.js', 'utf8');
  check('the course-summary fetch has its own card on Data Sync, not a corner of the optional one',
    /6 · Course summaries/.test(uiSrc) && uiSrc.indexOf('syncCourseDetailsWithProgress') > uiSrc.indexOf('6 · Course summaries'),
    (uiSrc.match(/\d · Course summaries/) || ['not found'])[0]);
  check('it is reachable on the same terms as every other sync button, not hidden behind edit mode',
    !/data-edit-only[^>]*syncCourseDetailsWithProgress/.test(uiSrc));
  check('the card says whether any summaries are held yet',
    /course-details-status/.test(uiSrc) && /No summaries yet/.test(uiSrc));
  check('the QA form buttons are offered on the course page and for every course',
    /exportQaForm\(\)/.test(uiSrc) && /exportAllQaForms\(\)/.test(uiSrc));
  const B = mk();
  B._qaTemplate = new Uint8Array(fs.readFileSync(ROOT + '/templates/unitar_qa_form.docx'));
  const { bytes, filled, answers } = await B.buildQaDocument('Burns 101', { year: 2025, report, detail: withObj, logo: new Uint8Array(fs.readFileSync(ROOT + '/build/gsf_logo_full.png')) });
  check('every row of UNITAR\'s form is answered, so none is left looking overlooked',
    filled.length === 20, filled.length + ' rows: ' + filled.slice(0, 6).join(', '));
  const back = await B._qaUnzip(bytes);
  const original = await B._qaUnzip(B._qaTemplate);
  check('the document is still a Word document: every part that came in goes back out, plus the picture',
    original.every(o => back.some(e => e.name === o.name)) && back.length === original.length + 1
      && back.some(e => e.name === 'word/media/gsf-logo.png') && back.some(e => /customXml/.test(e.name)),
    back.length + ' parts from ' + original.length);
  check('a build with no logo adds no parts at all',
    (async () => true) && (await (async () => { const C = mk(); C._qaTemplate = B._qaTemplate;
      const r2 = await C.buildQaDocument('Burns 101', { year: 2025, report, detail: withObj, logo: null });
      const p2 = await C._qaUnzip(r2.bytes); return p2.length === original.length; })()));
  const doc = new TextDecoder().decode(back.find(e => e.name === 'word/document.xml').data);
  check('the answers are in the document', /Burns 101/.test(doc) && /The Global Surgery Foundation/.test(doc) && /surghub\.org\/course\/burns-101/.test(doc));
  check('the real template yields a bullet list, a hyperlink and a picture',
    /<w:numPr>/.test(doc) && /<w:hyperlink r:id="rId\d+">/.test(doc) && /<w:drawing>/.test(doc));
  check('the picture, its relationship and its content type all travel together',
    back.some(e => e.name === 'word/media/gsf-logo.png')
      && /relationships\/image/.test(new TextDecoder().decode(back.find(e => e.name === 'word/_rels/document.xml.rels').data))
      && /Extension="png"/.test(new TextDecoder().decode(back.find(e => e.name === '[Content_Types].xml').data)));
  check('the location relationship is external, or Word would look for a file',
    /TargetMode="External"/.test(new TextDecoder().decode(back.find(e => e.name === 'word/_rels/document.xml.rels').data)));
  check('UNITAR\'s own labels and styling survive untouched',
    /QUALITY ASSESMENT/i.test(doc.replace(/<[^>]+>/g, '')) && /w:tblPr/.test(doc));
  check('the example answers UNITAR shipped are replaced, not left beside ours',
    !/United Nations Global Surgery Learning Hub/.test(doc) && !/E-Learning Platform/.test(doc)
      && !/Frontline surgical care workers/.test(doc));
  check('the focal point UNITAR asked for is on the form', /Michaela DORCIKOVA/.test(doc));
  check('the rewritten archive is a valid zip our own reader can walk', !!back && back.length > 20);
  check('the only address on the form is UNITAR\'s own focal point — no learner reaches it',
    (() => { const mails = (doc.replace(/xmlns[^"]*"[^"]*"/g, '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []);
      return mails.length > 0 && mails.every(m => /@unitar\.org$/i.test(m)); })(),
    (doc.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).join(', '));

  // ── the year dialog (Electron has no prompt()) ──
  check('no code path calls prompt(), which throws in Electron rather than returning null',
    ['qaForm.js', 'unitarExport.js', 'courseDetails.js'].every(f =>
      !/[^a-zA-Z_.]prompt\(/.test(fs.readFileSync(ROOT + '/js/' + f, 'utf8').split('\n').filter(l => l.indexOf('//') !== 0 && l.trim().indexOf('//') !== 0).join('\n'))),
    'checked qaForm, unitarExport, courseDetails');
  check('both entry points await the year dialog rather than reading a value straight back',
    (fs.readFileSync(ROOT + '/js/qaForm.js', 'utf8').match(/await this\._qaYear\(/g) || []).length === 2);
  {
    const C = mk();
    const p1 = C._qaYear('t');
    check('the dialog is a promise, and a year button settles it',
      p1 instanceof Promise && !!C.__dialog && /Create form/.test(C.__dialog.innerHTML));
    const buttons = C.__dialog.querySelectorAll('[data-y]');
    check('it offers this year and the three before it', buttons.length === 4);
    buttons[1].onclick();
    check('picking a year resolves to that year and closes the dialog',
      (await p1) === new Date().getFullYear() - 1 && C.__dialog.removed === true, await p1);

    const D = mk();
    const p2 = D._qaYear('t');
    D.__dialog.querySelector('#qa-cancel').onclick();
    check('cancelling resolves to null, so the caller stops', (await p2) === null);

    const E = mk();
    const p3 = E._qaYear('t');
    const input = E.__dialog.querySelector('#qa-year-input');
    input.value = '1066';
    E.__dialog.querySelector('#qa-ok').onclick();
    check('a year outside the allowed range is refused in place instead of resolving',
      E.__dialog.removed !== true && input.style.borderColor === '#D03734', input.style.borderColor);
    input.value = '2024';
    E.__dialog.querySelector('#qa-ok').onclick();
    check('correcting it then works', (await p3) === 2024);
  }

  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})();
