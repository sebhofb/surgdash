// Testimonials on surghub.org (js/testimonials.js, 26 Oct 2026): responses read from the kept survey
// exports with stable ids; seeding from the live pages (exact, light edits, ties settled only by cadre +
// country + stars, everything else reported); testimonials.json (shown only, in order, no personal data,
// held back when the privacy scrub would change the text); and Sync Surveys never touching the choices.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 300) : '')); };
const store = new Map();
const COLS = ['Respondent', 'Country', 'Profession', 'Started at', 'Ended at', 'On a scale from 1 to 5, how would you rate your overall satisfaction with this course?',
  'What aspects of this course did you find most interesting?', 'Do you have additional comments?'];
const row = (n, country, prof, ended, stars, interesting, other) => [n, country, prof, ended, ended, stars, interesting, other];
store.set('surghub_survey_raw', {
  'Burns Course': { cols: COLS, data: [
    row(1, 'Kenya', 'nurse', '12 Oct 2026 10:00:00', '5', 'Videos', 'The case discussions on fluid resuscitation were the most practical part of the whole course for my daily ward work'),
    row(2, 'Nepal', 'surgeon', '10 Oct 2026 09:00:00', '4', 'Very good.', 'NO DATA'),
    row(3, 'India', 'nurse', '09 Oct 2026 09:00:00', '5', 'Very good.', ''),
    row(4, '', '', '01 Sep 2026 08:00:00', '3', 'This courses is very usefull for me and my team at the hospital', 'Contact me at learner@example.org for more'),
    row(5, 'Peru', 'doctor', '02 Sep 2026 08:00:00', '5', '12 Oct 2026 10:00:00', 'Muy bueno el curso, me sirvió para mi trabajo diario en el hospital'),
  ] },
  'Other Course': { cols: COLS, data: [row(1, 'Chad', 'nurse', '05 Oct 2026 10:00:00', '5', 'Excellent and clear lectures on airway management', '')] },
});
const ctx = { console: { log() {}, warn() {}, error() {} }, TextEncoder, crypto: globalThis.crypto, Uint8Array, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, isNaN, escape, unescape, decodeURIComponent, __swallowed() {},
  Date: class extends Date { constructor(...a) { super(...(a.length ? a : [Date.UTC(2026, 9, 26, 9)])); } },
  Storage: { async getItem(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; }, async setItem(k, v) { store.set(k, JSON.parse(JSON.stringify(v))); } } };
ctx.window = ctx; ctx.Intl = Intl;
ctx.App = { data: [{ Course: 'Burns Course', CourseId: 'burns', Timestamp: '2026-10-26' }, { Course: 'Other Course', CourseId: 'other', Timestamp: '2026-10-26' }],
  escapeHtml: (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), escapeJsArg: (t) => String(t).replace(/'/g, "\\'"), formatNumber: (n) => String(n), renderView() {}, rerenderDashTab() {} };
vm.createContext(ctx);
for (const f of ['js/countryMap.js', 'js/scrub.js', 'js/testimonials.js', 'js/testimonialLabels.js', 'js/testimonialsWorkbench.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const App = ctx.App;
const realJudge = App._tmJudgeMissing; App._tmJudgeMissing = async () => false;   // the testimonial check has its own block below
const FEED = { courses: [{ id: 'burns', slug: 'burns-public', title: 'Burns Course', provider: 'P' }, { id: 'other', slug: 'other-course', title: 'Other Course', provider: 'P' }] };
App._cfFeedNow = () => FEED;

(async () => {
  await App._tmLoad();
  const R = App.tmResponses('burns');
  const by = (t) => R.find(r => r.text.startsWith(t));
  check('every written answer is a response, from every open question — one-word ones too', R.length === 7 && !!by('Videos') && !!by('The case discussions'), R.map(r => r.text.slice(0, 12)).join(' | '));
  check('…never a blank, "NO DATA" or a timestamp', !R.some(r => /^(no data|)$/i.test(r.text) || /^\d{1,2} \w{3} \d{4}/.test(r.text)));
  const a = by('The case discussions');
  check('cadre, country, stars, date and language come from the response itself', a.cadre === 'Nurse' && a.country === 'Kenya' && a.stars === 5 && a.date === '2026-10-12' && a.lang === 'en' && by('Muy bueno').lang === 'es', JSON.stringify(a));
  check('newest first', R[0].date >= R[R.length - 1].date);
  const id1 = a.id; App._tmRespCache = null;
  check('ids are stable between reads and carry no email', App.tmResponses('burns').find(r => r.text === a.text).id === id1 && /^t[a-z0-9]+$/.test(id1));
  check('two learners writing the same words on different days are two responses', R.filter(r => r.text === 'Very good.').length === 2);

  // ── seeding ──
  const rep = App.tmMatchRows([
    { slug: 'burns-public', position: 2, query: 'the case discussions on fluid resuscitation were the most practical part of the whole course for my daily ward work.', display: '"The case discussions were practical."', cadre: 'Postgraduate Nurse', country: 'Kenya', stars: 5 },
    { slug: 'burns-public', position: 1, query: 'This course is very useful for me and my team at the hospital', display: 'This course is very useful for me and my team at the hospital.', cadre: 'SURGhub Learner', country: '', stars: 3 },
    { slug: 'burns-public', position: 3, query: 'Very good', cadre: 'Specialist Surgeon', country: 'Nepal', stars: 4 },
    { slug: 'burns-public', position: 4, query: 'Very good', cadre: 'Doctor', country: 'Brazil', stars: 5 },
    { slug: 'burns-public', position: 5, query: 'Excellent and clear lectures on airway management', cadre: 'Nurse', country: 'Chad', stars: 5 },
    { slug: 'nowhere', position: 1, query: 'anything at all here' },
    { slug: 'burns-public', position: 6, query: 'The case discussions on fluid resuscitation were the most practical part of the whole course for my daily ward work', cadre: 'Nurse', country: 'Kenya', stars: 5 },
  ], 'test');
  const m = (pos) => rep.matched.find(x => x.position === pos);
  check('an exact match (case, spacing, punctuation and quote marks ignored)', m(2) && m(2).id === id1, JSON.stringify(rep.matched.map(x => [x.position, x.how])));
  check('a light edit of the original still matches', m(1) && m(1).how === 'near' && m(1).id === by('This courses').id);
  check('equally close candidates: settled only when cadre, country and stars all agree with exactly one', m(3) && m(3).how.startsWith('settled') && m(3).id === R.find(r => r.text === 'Very good.' && r.country === 'Nepal').id);
  check('…otherwise reported, never guessed', !m(4) && rep.several.some(x => x.position === 4));
  check('a comment only found in another course is reported with that course', rep.none.some(x => x.position === 5 && /Other Course/.test(x.why)));
  check('an unknown course is reported', rep.none.some(x => x.slug === 'nowhere'));
  check('two rows for one response: the second is reported', rep.duplicate.some(x => x.position === 6));
  await App.tmApplySeed(rep);
  const e = App._tm.byId[id1];
  check('seeding: switched on, in the page order, with the page text (no quote marks) and its cadre/country', e.show === true && e.order === 2 && e.text === 'The case discussions were practical.' && e.cadre === 'Postgraduate Nurse' && e.country === 'Kenya', JSON.stringify(e));
  check('"SURGhub Learner" is not kept as a cadre', App._tm.byId[by('This courses').id].cadre === undefined);

  // ── testimonials.json ──
  let F = App.testimonialsFeedBuild(FEED);
  const list = F.courses['burns-public'];
  check('keyed by the course page slug; only switched-on comments, in display order', Object.keys(F.courses).join() === 'burns-public' && list.map(x => x.id).join() === [by('This courses').id, id1, R.find(r => r.country === 'Nepal').id].join(), JSON.stringify(list));
  check('each: id, text, cadre, country, stars, lang — no names, emails or dates', list.every(x => Object.keys(x).every(k => ['id', 'text', 'cadre', 'country', 'stars', 'lang'].includes(k))) && !/@|2026-/.test(JSON.stringify(F.courses)));
  check('a missing cadre or country is left out (the site shows "SURGhub learner")', list[0].cadre === undefined && list[0].country === undefined && list[0].stars === 3);
  check('as_of and updated_at at the top', F.as_of === '2026-10-26' && /T/.test(F.updated_at));
  // privacy: a display text with personal details is held back
  const pid = by('Contact me').id;
  await App.tmToggle(pid, 'burns');
  F = App.testimonialsFeedBuild(FEED);
  check('a text with an email in it is held back, not published', F._stats.held === 1 && !JSON.stringify(F).includes('example.org'));
  await App.tmSetField(pid, 'burns', 'text', 'Contact me for more');
  check('…until it is edited', App.testimonialsFeedBuild(FEED).courses['burns-public'].some(x => x.text === 'Contact me for more'));
  // order
  await App.tmMove(pid, -1);
  check('up / down moves it in the order', App.testimonialsFeedBuild(FEED).courses['burns-public'].findIndex(x => x.id === pid) === 2);
  // a response that left the survey export is not published, but its choice is kept
  const raw = store.get('surghub_survey_raw'); raw['Burns Course'].data.shift(); App._rawSurveyResponses = raw; App._tmRespCache = null;
  F = App.testimonialsFeedBuild(FEED);
  check('a chosen comment no longer in the survey is skipped (and counted), its choice kept', F._stats.missing === 1 && !!App._tm.byId[id1] && App._tm.byId[id1].show);
  // one small file per course page, for every public course
  const tfile = await App.testimonialsFeedFile({ feed: FEED });
  const pc = Object.fromEntries(tfile.perCourse.map(x => [x.path, JSON.parse(x.content)]));
  check('one small file per public course: testimonials/<slug>.json with its testimonials in order', Object.keys(pc).join() === 'testimonials/burns-public.json,testimonials/other-course.json' && JSON.stringify(pc['testimonials/burns-public.json'].testimonials) === JSON.stringify(JSON.parse(tfile.content).courses['burns-public']), Object.keys(pc).join());
  check('…an empty list for a course with none (never a 404), and no timestamps (unchanged courses are not re-uploaded)', pc['testimonials/other-course.json'].testimonials.length === 0 && !/as_of|updated_at/.test(tfile.perCourse.map(x => x.content).join('')));
  check('the change check uses git\'s own content id', await App._gitBlobSha('hello\n') === 'ce013625030ba8dba906f756967f9e9ca394464a');
  const wmSrc = fs.readFileSync(path.join(ROOT, 'js/websiteMetrics.js'), 'utf8');
  check('quick publish uploads only per-course files that changed and removes those of courses no longer public', /have\[x\.path\] === await this\._gitBlobSha\(x\.content\)\) continue/.test(wmSrc) && /sha: null/.test(wmSrc));
  check('full publish includes them all', /\(tf\.perCourse \|\| \[\]\)\.forEach\(x => files\.push\(x\)\)/.test(fs.readFileSync(path.join(ROOT, 'js/partnerDash.js'), 'utf8')));

  // never an empty file over a non-empty one
  App._tmState = { last: { count: 4, content: '{"courses":{"x":[1]}}' } };
  Object.values(App._tm.byId).forEach(x => { x.show = false; });
  const ff = await App.testimonialsFeedFile({ feed: FEED });
  check('nothing switched on → the last published file is kept', !ff.fresh && ff.content === '{"courses":{"x":[1]}}' && /no testimonials/.test(ff.why));

  // ── the tab renders ──
  App._tm.byId[id1].show = true; App._tm.byId[pid].show = true; App._tmCourse = null; App._dashTab = 'testimonials'; App._tmSection = 'courses';
  const overview = App._dashTestimonialsHtml();
  check('the tab: an overview of courses with shown / new / suggested', /Testimonials on surghub\.org/.test(overview) && /App\.tmPickCourse\('burns'\)/.test(overview));
  App._tmCourse = 'burns';
  const page = App._dashTestimonialsHtml();
  check('…and a course: switches, order arrows, editable text, filters', /Show on SURGhub/.test(page) && /App\.tmMove\(/.test(page) && /tmSetField\('[^']+', 'burns', 'text'/.test(page) && /New since last review/.test(page) && /Mark reviewed/.test(page));

  // ── switched off: kept in its own list so it is easy to put back ──
  const offSection = (html) => html.includes('Switched off') ? html.slice(html.indexOf('Switched off'), html.indexOf('Comments (')) : '';
  await App.tmSetField(pid, 'burns', 'text', 'Edited for the page');
  await App.tmToggle(pid, 'burns');
  const off = App._dashTestimonialsHtml(), offPart = off.slice(off.indexOf('Switched off'), off.indexOf('Comments ('));
  check('a comment switched off gets its own "Switched off" list…', /Switched off \(\d+\)/.test(off) && offPart.includes("tmToggle('" + pid + "'") && /edits kept/.test(offPart) && /App\.tmForget\(/.test(offPart));
  check('…and is not lost among the other comments', !off.slice(off.indexOf('Comments (')).includes("tmToggle('" + pid + "'"));
  await App.tmToggle(pid, 'burns');
  const back = App._dashTestimonialsHtml();
  check('ticking it again puts it back with the edited text', App._tm.byId[pid].show === true && App.testimonialsFeedBuild(FEED).courses['burns-public'].some(x => x.id === pid && x.text === 'Edited for the page') && !offSection(back).includes("tmToggle('" + pid + "'"));
  App._tmCourse = null;
  check('the course overview says how many are switched off', /\d+ off<\/span>/.test(App._dashTestimonialsHtml()));
  App._tmCourse = 'burns';
  await App.tmToggle(pid, 'burns'); await App.tmForget(pid);
  const forgot = App._dashTestimonialsHtml();
  check('"Forget" moves it back into the comments, edits still stored', !offSection(forgot).includes("tmToggle('" + pid + "'") && forgot.slice(forgot.indexOf('Comments (')).includes("tmToggle('" + pid + "'") && App._tm.byId[pid].text === 'Edited for the page');

  // ── picking the best automatically ──
  {
    const C2 = ['Respondent', 'Country', 'Profession', 'Started at', 'Ended at', 'On a scale from 1 to 5, how would you rate your overall satisfaction with this course?',
      'What aspects of this course did you find most interesting?', 'What aspects of this course did you find less engaging? How could we make the course better for you?'];
    const TEXTS = ['', 'The difficult airway trolley checks changed how our team prepares every single morning',
      'Paediatric dosing tables were clear and I now use them at the bedside with confidence',
      'Video laryngoscopy practice cases gave me courage for my first emergency intubation',
      'Extubation planning steps helped our recovery nurses spot danger earlier than before',
      'Learning about oxygen supply failures prepared our rural hospital for real outages',
      'Rapid sequence induction drugs finally make sense to me after these short lectures',
      'Setting up awake fibreoptic intubation was explained better than in any textbook I own',
      'Cricothyroidotomy drills with simple materials are something we now teach juniors monthly',
      'Aspiration prevention advice was useful although I knew most of it already from training'];
    const txt = (i) => TEXTS[i];
    const rows = [];
    for (let i = 1; i <= 9; i++) rows.push([i, i <= 3 ? 'Kenya' : 'Country' + i, 'nurse', '0' + i + ' Oct 2026 10:00:00', '0' + i + ' Oct 2026 10:00:00', '5', txt(i), 'More videos about difficult airway cases would make it better for us']);
    rows.push([10, 'Ghana', 'nurse', '10 Oct 2026 10:00:00', '10 Oct 2026 10:00:00', '2', 'Low rated but long and lovely comment about the airway course and its videos', '']);
    rows.push([11, 'Togo', 'nurse', '11 Oct 2026 10:00:00', '11 Oct 2026 10:00:00', '5', txt(1).replace('every single morning', 'every morning'), '']);   // near-duplicate of #1
    const raw = store.get('surghub_survey_raw'); raw['Airway Course'] = { cols: C2, data: rows }; App._rawSurveyResponses = raw; App._tmRespCache = null;
    App.data.push({ Course: 'Airway Course', CourseId: 'airway', Timestamp: '2026-10-26' });
    App._tmLatestCache = null;
    FEED.courses.push({ id: 'airway', slug: 'airway', title: 'Airway Course', provider: 'P' });
    App._djb2Hash = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = (((h << 5) + h) + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
    App._isJunkFeedback = (t) => String(t).length < 25;
    const ai = {};
    for (let i = 1; i <= 9; i++) ai[App._djb2Hash(txt(i))] = { s: i === 9 ? 4 : 10 - i % 3, q: true, t: ['knowledge-gain'], l: 'en', c: i === 2 ? 'Tidied: the airway module was useful.' : '' };
    ai[App._djb2Hash(txt(1).replace('every single morning', 'every morning'))] = { s: 10, q: true, t: [], l: 'en', c: '' };
    ai[App._djb2Hash('More videos about difficult airway cases would make it better for us')] = { s: 9, q: true, t: ['suggestion'], l: 'en', c: '' };
    App._aiScoreMap = ai; App._getAiScores = async () => App._aiScoreMap; App._claudeScoreBatch = async () => []; App.showMsg = (m) => { App.__msg = m; };
    const tidyCalls = [];
    App._getAnthropicKey = async () => 'k';
    App._claudeJSON = async (key, system, user, schema, max, opts) => { tidyCalls.push({ system, items: JSON.parse(user), model: opts && opts.model }); return { results: JSON.parse(user).map((x, i) => ({ i, text: 'Tidied ' + x.comment.slice(0, 20) + ' — kept in my words', drop: false, reason: '' })) }; };
    const res = await App.tmPickBest(['airway'], null);
    const picked = Object.entries(App._tm.byId).filter(([, e]) => e.course === 'airway' && e.show).sort((a, b) => a[1].order - b[1].order);
    const respA = {}; App.tmResponses('airway').forEach(r => { respA[r.id] = r; });
    const pt = picked.map(([id]) => respA[id]);
    check('picks at most 6, all AI-screened (quotable, score 6+), 4–5 stars, from the "most interesting" question', res.picked === 6 && pt.every(r => r.stars >= 4 && /most interesting/.test(r.q)), pt.map(r => r.text.slice(0, 12)).join(' | '));
    check('never a low-rated comment, a "less engaging" answer, one the AI scored under 6, or a near-duplicate', !pt.some(r => /Low rated|More videos/.test(r.text) || r.text === txt(9)) && pt.filter(r => /difficult airway trolley/.test(r.text)).length <= 1);
    check('countries are spread: one from Kenya until the others are used', pt.slice(0, 6).filter(r => r.country === 'Kenya').length <= 2 && pt[0].country !== pt[1].country);
    check('the course-page text comes from the testimonial copy-edit (with course, question and answer), never the report scorer\'s cached quote', tidyCalls.length === 1 && tidyCalls[0].items.every(x => x.course === 'Airway Course' && /most interesting/.test(x.question) && x.comment) && picked.every(([, e]) => /^Tidied /.test(e.text) && !/Tidied: the airway/.test(e.text)) && picked.every(([, e]) => e.auto && e.auto.score >= 6), JSON.stringify(picked.map(([, e]) => e.text)));
    check('…with no em or en dashes (replaced by a comma)', picked.every(([, e]) => !/[—–]/.test(e.text) && /, kept in my words\.$/.test(e.text)));
    check('the light-editing rule (26 Oct 2026): fix only, cut never reword, own words, no added phrases, no translation, personal details out, no dashes, unchanged = as written', /Correct spelling, typos, capitalisation, spacing and punctuation/.test(App.TM_TIDY_PROMPT) && /cutting whole sentences or clauses, never by rewording/.test(App.TM_TIDY_PROMPT) && /60 words/.test(App.TM_TIDY_PROMPT) && /own words, word order, tone and grammar/.test(App.TM_TIDY_PROMPT) && /Do not add phrases/.test(App.TM_TIDY_PROMPT) && /do not translate/.test(App.TM_TIDY_PROMPT) && /under 18/.test(App.TM_TIDY_PROMPT) && /No em dashes/.test(App.TM_TIDY_PROMPT) && /needs no changes, return it exactly as written/.test(App.TM_TIDY_PROMPT) && tidyCalls[0].model === App.TM_TIDY_MODEL && App.TM_EDIT_RULE.length >= 7);
    App._claudeJSON = async (key, system, user) => ({ results: JSON.parse(user).map((x, i) => ({ i, text: 'Again: ' + x.comment.slice(0, 12) + '.', drop: false, reason: '' })) });
    ctx.confirm = () => true;
    const nRe = await App.tmRetidy(null, null);
    check('"Tidy their texts again" redoes every automatic pick', nRe === picked.length && Object.values(App._tm.byId).filter(e => e.course === 'airway' && e.show).every(e => /^Again: /.test(e.text)));
    await App.tmSetField(picked[0][0], 'airway', 'text', 'Edited by a person');
    check('editing one clears its "picked automatically" mark', !App._tm.byId[picked[0][0]].auto);
    await App.tmToggle(picked[5][0], 'airway');
    const again = await App.tmPickBest(['airway'], null);
    check('on a course with some shown, it only fills up to 6', again.picked <= 1 && Object.values(App._tm.byId).filter(e => e.course === 'airway' && e.show).length <= 6);
    const ai2 = Object.keys(ai).length; let asked = false; ctx.confirm = () => { asked = true; return false; };
    raw['Airway Course'].data.push([12, 'Mali', 'nurse', '12 Oct 2026 10:00:00', '12 Oct 2026 10:00:00', '5', 'A brand new comment nobody has screened yet about the airway course videos', '']); App._tmRespCache = null;
    Object.values(App._tm.byId).forEach(e => { if (e.course === 'airway') e.show = false; });
    await App.tmPickBest(['airway'], null);
    check('comments the AI has not screened: it asks before scoring them, and never picks them unscreened', asked && Object.keys(ai).length === ai2 && !Object.entries(App._tm.byId).some(([id, e]) => e.course === 'airway' && e.show && /brand new/.test((respA[id] || App.tmResponses('airway').find(r => r.id === id) || {}).text || '')));
  }

  // ── review every course ──
  {
    const C3 = ['Respondent', 'Country', 'Profession', 'Started at', 'Ended at', 'On a scale from 1 to 5, how would you rate your overall satisfaction with this course?', 'What aspects of this course did you find most interesting?'];
    const T = ['', 'Suturing videos showed every knot clearly and I now close wounds faster on my ward shifts',
      'Triage tables helped our small district hospital organise the emergency room during the floods',
      'The quiz after each module told me exactly where my anatomy knowledge was weak before exams',
      'Case discussions about burns in children changed how I calculate fluids for my young patients',
      'Learning about sterile field set-up helped me teach the new nurses in our theatre this month',
      'Mi equipo aprendió muchísimo sobre la técnica de suturas y ahora las practicamos cada semana',
      'Old but excellent comment about tourniquet use that taught me to time applications properly',
      'A fresh comment about tourniquet timing that helped me avoid nerve damage in two patients'];
    const rowsR = T.slice(1).map((t, i) => [i + 1, 'C' + i, 'nurse', (i === 6 ? '01 Jan 2026' : '1' + i + ' Oct 2026') + ' 10:00:00', (i === 6 ? '01 Jan 2026' : '1' + i + ' Oct 2026') + ' 10:00:00', '5', t]);
    const raw = store.get('surghub_survey_raw'); raw['Review Course'] = { cols: C3, data: rowsR }; App._rawSurveyResponses = raw; App._tmRespCache = null;
    App.data.push({ Course: 'Review Course', CourseId: 'rev', Timestamp: '2026-10-26' }); App._tmLatestCache = null;
    FEED.courses.push({ id: 'rev', slug: 'rev', title: 'Review Course', provider: 'P' });
    const RR = App.tmResponses('rev'), rid = (k) => RR.find(r => r.text === T[k]).id, H = (k) => App._djb2Hash(T[k]);
    // shown now: #1 (scored 5: weak), #2 (scored 7), #7 (old, scored 8), #3 (never scored); candidates #4 (9), #5 (8), #6 (Spanish, 10), #8 (new, scored 8)
    [[1, 1], [2, 2], [7, 3], [3, 4]].forEach(([k, o]) => { App._tm.byId[rid(k)] = { course: 'rev', show: true, order: o }; });
    Object.assign(App._aiScoreMap, { [H(1)]: { s: 5, q: true, t: [] }, [H(2)]: { s: 7, q: true, t: [] }, [H(7)]: { s: 8, q: true, t: [] }, [H(4)]: { s: 9, q: true, t: [] }, [H(5)]: { s: 8, q: true, t: [] }, [H(6)]: { s: 10, q: true, t: [] }, [H(8)]: { s: 8, q: true, t: [] } });
    App._tmScoreMissing = async () => true; App.TM_PICK_N = 4;   // the four places are taken: no additions here
    App._tm.settings = { upgrade: 'newer' };   // this block tests "as good and newer" (a setting since 27 Oct 2026)
    await App.tmReviewAll(null);
    const P = App._tmProposals.filter(p => p.course === 'rev'), rep = (k) => P.find(p => p.type === 'replace' && p.old.id === rid(k));
    check('review: a weak testimonial (AI score under 6) is replaced by the best candidate', rep(1) && rep(1).cand.r.text === T[4], JSON.stringify(P.map(p => [p.type, p.old && p.old.r.text.slice(0, 8), p.cand && p.cand.r.text.slice(0, 8), p.why])));
    check('…a shown one scoring lower is replaced by a higher one; an old one by an as-good newer one', rep(2) && rep(2).newScore > 7 && rep(7) && rep(7).newScore === 8 && /newer/.test(rep(7).why) && rep(2).cand.r.id !== rep(7).cand.r.id);
    check('…a testimonial never screened is not replaced on score', !rep(3));
    check('…only comments in the course page\'s language are proposed', !P.some(p => p.cand && p.cand.r.text === T[6]));
    check('…and nothing changes until applied', App._tm.byId[rid(1)].show === true && !App._tm.byId[rid(4)]);
    const i2 = App._tmProposals.indexOf(rep(2));
    await App.tmKeep(i2);
    check('"Keep current" protects a testimonial from later reviews', App._tm.byId[rid(2)].keep === true && (await (async () => { await App.tmReviewAll(null); return !App._tmProposals.some(p => p.old && p.old.id === rid(2)); })()));
    const i1 = App._tmProposals.findIndex(p => p.type === 'replace' && p.old.id === rid(1));
    await App.tmReject(i1);
    await App.tmReviewAll(null);
    check('"Not this one" stops a comment being suggested again', !App._tmProposals.some(p => p.cand && p.cand.r.text === T[4]) && App._tm.byId[rid(4)].rejected === true);
    const before = App._tm.byId[rid(7)].order;
    const nApplied = await App.tmApplyProposals(null, null);
    App.TM_PICK_N = 6; App._tm.settings = {};
    const nw = App._tm.byId[rid(7)].replacedBy;
    check('"Apply all": the old one off, the new one on in its place, copy-edited', nApplied > 0 && App._tm.byId[rid(7)].show === false && nw && App._tm.byId[nw].show === true && App._tm.byId[nw].order === before && /^(Tidied|Again)/.test(App._tm.byId[nw].text || ''), JSON.stringify(App._tm.byId[rid(7)]));
  }

  // ── 26 Oct 2026: light editing, labels in the page language, one language, duplicates, the one-off review ──
  {
    check('edits are made safe: dashes become commas, quote marks go, a full stop is added', App._tmCleanEdit('"Great course — very clear"') === 'Great course, very clear.' && App._tmCleanEdit('Muy bueno el curso') === 'Muy bueno el curso.' && App._tmCleanEdit('Is it?') === 'Is it?');
    App._tm.byId.tA = { course: 'burns', show: true, text: 'old rewrite' };
    check('a comment that needs no change is shown exactly as written; personal details switch it off', App._tmApplyEdit('tA', { text: 'As written.' }, { text: 'As written.' }) === 'original' && App._tm.byId.tA.text === undefined
      && App._tmApplyEdit('tA', { text: 'x' }, { drop: true, reason: 'names a patient' }) === 'dropped' && App._tm.byId.tA.show === false && /names a patient/.test(App._tm.byId.tA.removed.why));
    delete App._tm.byId.tA;
    check('cadres in the page language, from any spelling; not-cadres mapped; unknown left out on other-language pages', App.tmCadreLabel('Infirmière', 'en') === 'Nurse' && App.tmCadreLabel('Nurse', 'fr') === 'Infirmier(ère)' && App.tmCadreLabel('nurse', 'es') === 'Enfermero(a)' && App.tmCadreLabel('Anaesthesiologist', 'ar') === 'طبيب(ة) تخدير'
      && App.tmCadreLabel('Undergraduate Specialist Surgeon', 'en') === 'Medical Student' && App.tmCadreLabel('Odontología', 'es') === 'Odontólogo(a)' && App.tmCadreLabel('Undergraduate Gynaecologist', 'en') === 'Medical Student'
      && App.tmCadreLabel('Sales Representative', 'en') === 'Sales Representative' && App.tmCadreLabel('Sales Representative', 'fr') === '' && App.tmCadreLabel('SURGhub Learner', 'en') === '');
    check('countries: short common names in the page language', App.tmCountryLabel('Tanzania, United Republic of', 'en') === 'Tanzania' && App.tmCountryLabel('Chad', 'fr') === 'Tchad' && App.tmCountryLabel('Tchad', 'en') === 'Chad' && App.tmCountryLabel('Ivory Coast', 'fr') === "Côte d'Ivoire" && App.tmCountryLabel("Côte d'Ivoire", 'en') === "Côte d'Ivoire"
      && App.tmCountryLabel('République Démocratique du Congo', 'en') === 'DR Congo' && App.tmCountryLabel('Mexico', 'es') === 'México' && App.tmCountryLabel('Occupied Palestinian Territory', 'en') === 'Palestine' && App.tmCountryLabel('Myanmar', 'en') === 'Myanmar' && App.tmCountryLabel('Trinidad and Tobago', 'en') === 'Trinidad and Tobago',
      [App.tmCountryLabel('Tanzania, United Republic of', 'en'), App.tmCountryLabel('République Démocratique du Congo', 'en'), App.tmCountryLabel('Myanmar', 'en'), App.tmCountryLabel('Trinidad and Tobago', 'en')].join(' | '));
    // a French course page: labels in French, an English comment not published
    const FC = ['Respondent', 'Country', 'Profession', 'Started at', 'Ended at', 'Sur une échelle de 1 à 5, quel est votre niveau de satisfaction concernant ce cours ?', 'Quels aspects du cours avez-vous trouvé les plus intéressants ?'];
    const raw = store.get('surghub_survey_raw'); raw['Cours FR'] = { cols: FC, data: [[1, 'Chad', 'nurse', '01 Oct 2026 10:00:00', '01 Oct 2026 10:00:00', '5', "J'ai beaucoup aimé les vidéos sur les brûlures et les cas cliniques du Tchad."], [2, 'Kenya', 'surgeon', '02 Oct 2026 10:00:00', '02 Oct 2026 10:00:00', '5', 'The videos on burns were very good and clear for my work.']] };
    App._rawSurveyResponses = raw; App._tmRespCache = null; App.data.push({ Course: 'Cours FR', CourseId: 'fr1', Timestamp: '2026-10-26' }); App._tmLatestCache = null; FEED.courses.push({ id: 'fr1', slug: 'cours-fr', title: 'Cours FR', provider: 'P' });
    App.tmResponses('fr1').forEach((r, i) => { App._tm.byId[r.id] = { course: 'fr1', show: true, order: i + 1 }; });
    const F = App.testimonialsFeedBuild(FEED);
    check('a French page: cadre and country in French; an English comment is not published', F.courses['cours-fr'].length === 1 && F.courses['cours-fr'][0].cadre === 'Infirmier(ère)' && F.courses['cours-fr'][0].country === 'Tchad' && F._stats.otherLang === 1, JSON.stringify(F.courses['cours-fr']));
    // an emptied cadre box means none
    const fid = App.tmResponses('fr1').find(r => r.lang === 'fr').id;
    await App.tmSetField(fid, 'fr1', 'cadre', '');
    check('emptying the cadre box shows none (not the survey value again)', App._tm.byId[fid].cadre === '' && !App.testimonialsFeedBuild(FEED).courses['cours-fr'][0].cadre);
    // duplicates
    const r1 = App.tmResponses('burns')[0];
    App._tm.byId[r1.id] = Object.assign(App._tm.byId[r1.id] || { course: 'burns' }, { show: true, text: 'Same words on two courses.' });
    App._tm.byId[fid].text = 'Same words on two courses.';
    const D = App.tmDuplicates();
    check('the duplicate check finds a text switched on for two courses', D.length === 1 && new Set(D[0].where.map(w => w.course)).size === 2);
    App._tmCourse = null; App._dashTab = 'testimonials'; App._tmSection = 'courses';
    App._tmSection = 'published';
    check('…and the Published list flags it', /the same text on another course/.test(App._dashTestimonialsHtml()));
    App._tmSection = 'courses';
    App._tmCourse = 'fr1';
    const pg = App._dashTestimonialsHtml();
    check('the editing rule is shown by the text box; cards flag other-language and duplicated texts', /editing rule/.test(pg) && /never by rewording/.test(pg) && /not in FR: not published/.test(pg) && /also on /.test(pg));
    // the one-off review: listed ids off, labels emptied, other language off, duplicates kept once, texts rebuilt
    const save = App.TM_REVIEW_20261026, bid = App.tmResponses('burns').find(r => r.id !== r1.id && r.text !== 'Same words on two courses.');
    App._tm.byId[bid.id] = Object.assign(App._tm.byId[bid.id] || { course: 'burns' }, { show: true });
    App.TM_REVIEW_20261026 = { off: [{ id: bid.id, at: 'x', why: 'about another course' }], labels: [{ id: fid, at: 'y', field: 'country', why: 'writes another country' }] };
    App._tm.fixes = {};
    App._tmTidy = async (items) => Object.fromEntries(items.map(x => [x.r.id, x.r.text.length > 60 ? { text: 'Cut to the clause that matters.' } : { text: x.r.text.trim() }]));
    const seq = [true, false]; ctx.confirm = () => seq.shift();
    const rv = await App.tmApplyReview20261026(null);
    check('review: the listed one off (with the reason), a label emptied, the English comment on the French page off, one copy of the duplicate kept', rv && App._tm.byId[bid.id].show === false && /another course/.test(App._tm.byId[bid.id].removed.why) && App._tm.byId[fid].country === '' && rv.lang.length === 1 && rv.dups.length === 1, JSON.stringify(rv && { off: rv.off.length, lang: rv.lang.length, dups: rv.dups.length }));
    check('…every remaining text rebuilt from the original (as written when unchanged), reported with examples, and run once', rv.edits.edited + rv.edits.original > 0 && rv.examples.every(x => x.original && x.old !== undefined && x.new) && !!App._tm.fixes['2026-10-26'] && store.has('surgdash_testimonials_rework') && !/Apply the review/.test((App._tmCourse = null, App._dashTestimonialsHtml())));
    App.TM_REVIEW_20261026 = save;
    check('the shipped review list: 19 to switch off and 3 labels, by response id', save.off.length === 19 && save.labels.length === 3 && save.off.every(x => /^t[a-z0-9]+$/.test(x.id) && x.why));
  }

  // ── the testimonial check: a verdict per course + comment, on a stronger model ──
  {
    const JC = ['Respondent', 'Country', 'Profession', 'Started at', 'Ended at', 'On a scale from 1 to 5, how would you rate your overall satisfaction with this course?', 'What aspects of this course did you find most interesting?'];
    const JT = ['Very well laid out module.', 'Su contenido.', 'The mechanisms of antiepileptic drugs and how NSAIDs inhibit COX enzymes were explained in great depth with clear diagrams.', 'Learning to debride a burn wound safely changed how our ward manages new admissions every week.'];
    const raw = store.get('surghub_survey_raw'); raw['Wound Course'] = { cols: JC, data: JT.map((t, i) => [i + 1, 'Kenya', 'nurse', '0' + (i + 1) + ' Oct 2026 10:00:00', '0' + (i + 1) + ' Oct 2026 10:00:00', '5', t]) };
    App._rawSurveyResponses = raw; App._tmRespCache = null; App.data.push({ Course: 'Wound Course', CourseId: 'wound', Timestamp: '2026-10-26' }); App._tmLatestCache = null; FEED.courses.push({ id: 'wound', slug: 'wound', title: 'Wound Course', provider: 'P' });
    App.TM_PICK_N = 6;
    const W = App.tmResponses('wound'), wid = (k) => W.find(r => r.text === JT[k]).id;
    App._tm.byId[wid(1)] = { course: 'wound', show: true, order: 1 }; App._tm.byId[wid(2)] = { course: 'wound', show: true, order: 2 };
    const verdicts = { [JT[0]]: ['use', 'good', 3], [JT[1]]: ['no', 'fragment', 1], [JT[2]]: ['no', 'off_topic', 4], [JT[3]]: ['use', 'good', 5, 'Learning to debride a burn wound safely changed how our ward manages new admissions.'] };
    const calls = []; App._getAnthropicKey = async () => 'k'; ctx.confirm = () => true;
    App._claudeJSON = async (key, system, user, schema, max, opts) => { const items = JSON.parse(user); calls.push({ system, items, opts, max }); const v = (c) => verdicts[c] || ['weak', 'generic', 2]; return { results: items.map((x, i) => ({ i, text: v(x.comment)[0] === 'no' ? '' : (v(x.comment)[3] || x.comment), verdict: v(x.comment)[0], reason: v(x.comment)[1], strength: v(x.comment)[2], specific: v(x.comment)[2] >= 4, self_role: '' })) }; };
    App._tmJudgeMissing = realJudge; App._tmJudge = {};
    App._tm.settings = {};
    await App.tmReviewAll(null);
    {
      const P4 = App._tmProposals.filter(p => p.course === 'wound');
      check('the check v3 makes the display text first and judges that; a topic phrase is a fragment', /make the display text/.test(calls[0].system) && /Comparison between different Surgical methods/.test(App.TM_JUDGE_PROMPT) && /Cut words that only answer the survey question/.test(calls[0].system) && App.TM_JUDGE_SCHEMA.properties.results.items.required.includes('text'));
      check('by default only comments rated 4/5 or better are suggested: the 5/5 replaces one, the clear but general 3/5 is not offered', P4.filter(p => p.type === 'replace').length === 1 && P4.find(p => p.type === 'replace').cand.r.text === JT[3] && !P4.some(p => p.cand && p.cand.r.text === JT[0]), JSON.stringify(P4.map(p => [p.type, p.cand && p.cand.r.text.slice(0, 10)])));
    }
    App._tm.settings = { suggestMin: 3 }; App._tmRel = App._tmRelational(); App._tmProposals = ['wound'].flatMap(id => App._tmReviewCourse(id));
    const wItems = calls.flatMap(c => c.items).filter(x => x.course === 'Wound Course');
    check('the check is asked with the course title, the question and the comment, on Opus 5.5 at low effort, with room for thinking', wItems.length === 4 && wItems.every(x => /most interesting/.test(x.question) && x.comment) && calls[0].opts.model === 'claude-opus-5-5' && calls[0].opts.effort === 'low' && calls[0].max >= 16000 && /testimonials on that course/.test(calls[0].system), JSON.stringify(calls[0] && calls[0].opts));
    check('…it knows a fragment, an off-topic comment, and that short can be good', App._tmQ('wound', W.find(r => r.text === JT[1])).weak === App.TM_REASON.fragment && App._tmQ('wound', W.find(r => r.text === JT[2])).no && App._tmQ('wound', W.find(r => r.text === JT[0])).ok);
    const P = App._tmProposals.filter(p => p.course === 'wound');
    check('review: the off-topic and the fragment are replaced by the check\'s testimonials, strongest first', P.filter(p => p.type === 'replace').length === 2 && P.find(p => p.type === 'replace').cand.r.text === JT[3] && P.some(p => p.type === 'replace' && p.cand.r.text === JT[0]), JSON.stringify(P.map(p => [p.type, p.old && p.old.r.text.slice(0, 10), p.cand && p.cand.r.text.slice(0, 10), p.why])));
    check('…the reasons read as verdicts', P.every(p => p.type !== 'replace' || /fragment|not about this course/.test(p.why)));
    {
      App._tmSection = 'find'; const html = App._dashTestimonialsHtml();
      check('Find better shows the text that would go online (the check\'s), marked as edited from the original', html.includes('changed how our ward manages new admissions.”') && /edited from the original/.test(html));
      const snap = JSON.stringify(App._tm.byId), nCalls = calls.length, i5 = App._tmProposals.findIndex(p => p.cand && p.cand.r.text === JT[3]);
      await App.tmApplyProposals([i5], null);
      check('accepting puts the check\'s text online as is, with no second call to Claude', App._tm.byId[wid(3)].show && App._tm.byId[wid(3)].text === 'Learning to debride a burn wound safely changed how our ward manages new admissions.' && calls.length === nCalls);
      App._tm.byId = JSON.parse(snap); App._tmProposals = P.slice();
      check('"clearly better" means two strength points: a 4/5 on the page is never upgraded, a 3/5 only by a 5/5', App.tmSetting('upgrade') === 'clear' && /c\.a\.s >= w\.s \+ 4/.test(App._tmReviewCourse.toString()));
    }
    const n0 = calls.length; await App.tmReviewAll(null);
    check('each comment is checked once and remembered', calls.length === n0 && store.has('surghub_testimonial_ai'));
    {
      // a new instruction: only what is on the page and what was good enough to suggest is checked again
      const saved = JSON.parse(JSON.stringify(App._tmJudge)), set0 = App._tm.settings; App._tm.settings = {};   // suggest 4/5 or better
      Object.values(App._tmJudge).forEach(j => { j.pv = 'old'; });
      const asked = []; const realC = App._claudeJSON; App._claudeJSON = async (k, sy, u, sc, m, o) => { asked.push(...JSON.parse(u).map(x => x.comment)); return realC(k, sy, u, sc, m, o); };
      let msg = ''; ctx.confirm = (m) => { msg = m; return true; };
      await App._tmJudgeMissing(App._tmJudgeItems(['wound']), null);
      App._claudeJSON = realC; ctx.confirm = () => true;
      check('a new instruction re-checks only testimonials on the page and comments good enough to suggest; earlier rejections are kept, not paid for again',
        asked.includes(JT[1]) && asked.includes(JT[2]) && asked.includes(JT[3]) && !asked.includes(JT[0]) && /earlier rejections and low ratings are kept/.test(msg), JSON.stringify(asked.map(t => t.slice(0, 12))));
      Object.values(App._tmJudge).forEach(j => { j.pv = 'old'; });
      App._tmRel = App._tmRelational();
      check('…and an older verdict alone never makes a suggestion', !App._tmReviewCourse('wound').some(p => p.cand && p.cand.q.judged));
      App._tmJudge = saved; App._tm.settings = set0;
    }
    // with nothing better left, a "not a testimonial" is listed to switch off, all at once
    App._tm.byId[wid(0)] = { course: 'wound', show: true, order: 3 }; App._tm.byId[wid(3)] = { course: 'wound', show: true, order: 4 };
    await App.tmReviewAll(null);
    const noP = App._tmProposals.filter(p => p.course === 'wound' && p.type === 'weak' && p.no);
    App._tmCourse = null; App._dashTab = 'testimonials'; App._tmSection = 'courses';
    App._tmSection = 'find';
    check('…otherwise "not a testimonial" ones are listed to switch off, under "Problems on the site" with one button for all of them', noP.length === 2 && /Problems on the site/.test(App._dashTestimonialsHtml()) && /tmAcceptGroup\('problems'/.test(App._dashTestimonialsHtml()));
    App._tmSection = 'courses';
    App._tmCourse = 'wound';
    check('cards show the check\'s verdict; a filter keeps only its testimonials', /testimonial 5\/5/.test(App._dashTestimonialsHtml()) && /not a testimonial: a fragment/.test(App._dashTestimonialsHtml()) && /Testimonials only \(check\)/.test(App._dashTestimonialsHtml()));
    App._tmJudgeMissing = async () => false;
  }

  // ── the workbench (27 Oct 2026): settings, shuffling, selection rules, swap + undo, dismiss, Excel ──
  {
    App._tmJudgeMissing = async () => false; App._tm.settings = {};
    check('settings: defaults; a saved value wins; the default instruction is stored as "default"', App.tmSetting('target') === 6 && App.tmSetting('upgrade') === 'clear' && App.tmSetting('shuffle') === 'off'
      && (await App.tmSetSetting('target', '5'), App._tmTarget() === 5) && (await App.tmSetSetting('judgePrompt', App.TM_JUDGE_PROMPT), App._tm.settings.judgePrompt === ''));
    const v1 = App._tmJudgeVersion(); await App.tmSetSetting('judgePrompt', 'A different instruction'); const v2 = App._tmJudgeVersion(); await App.tmSetSetting('judgePrompt', '');
    check('…a changed instruction makes earlier verdicts stale (a new version), reset brings the old one back', v1 !== v2 && App._tmJudgeVersion() === v1);
    check('the check v2 asks for specific and self_role; the editing rule cuts suggestions and side remarks', App.TM_JUDGE_SCHEMA.properties.results.items.required.includes('specific') && App.TM_JUDGE_SCHEMA.properties.results.items.required.includes('self_role') && /clinical_claim/.test(App.TM_JUDGE_PROMPT)
      && /Keep only the parts that say what the learner valued, learned or will use/.test(App.TM_TIDY_PROMPT) && App.TM_EDIT_RULE.some(x => /cut suggestions/.test(x)));
    // shuffling
    const items = [1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ id: 't' + i, text: 'x' + i }));
    App._tm.settings = { shuffle: 'order' };
    const d1 = App._tmArrange('c1', items, new Date(Date.UTC(2026, 9, 27))), d1b = App._tmArrange('c1', items, new Date(Date.UTC(2026, 9, 27, 23))), d2 = App._tmArrange('c1', items, new Date(Date.UTC(2026, 9, 28)));
    check('shuffle "order": the same order all day, a different one the next day, nothing dropped', JSON.stringify(d1) === JSON.stringify(d1b) && JSON.stringify(d1) !== JSON.stringify(d2) && d1.length === 8);
    App._tm.settings = { shuffle: 'rotate', target: 6 };
    const w1 = App._tmArrange('c1', items, new Date(Date.UTC(2026, 9, 27))), w1b = App._tmArrange('c1', items, new Date(Date.UTC(2026, 9, 29))), w2 = App._tmArrange('c1', items, new Date(Date.UTC(2026, 10, 4)));
    const ids = (l) => l.map(x => x.id).sort().join();
    check('shuffle "rotate": 6 of the 8 switched on, the same 6 all week, another 6 the next week', w1.length === 6 && ids(w1) === ids(w1b) && ids(w1) !== ids(w2));
    App._tm.settings = {};
    check('shuffle "off": the order as set', JSON.stringify(App._tmArrange('c1', items, new Date())) === JSON.stringify(items));
    // selection rules on a course
    const RC = ['Respondent', 'Country', 'Profession', 'Started at', 'Ended at', 'On a scale from 1 to 5, how would you rate your overall satisfaction with this course?', 'What aspects of this course did you find most interesting?', 'Do you have additional comments?'];
    const raw = store.get('surghub_survey_raw');
    raw['Rules Course'] = { cols: RC, data: [
      [1, 'Peru', 'nurse', '01 Oct 2026 10:00:00', '01 Oct 2026 10:00:00', '5', 'The suturing videos on vertical mattress stitches made the technique clear for my ward.', 'As a physiotherapist I will use the splinting advice with my burn patients every day.'],
      [2, 'Chad', 'surgeon', '02 Oct 2026 10:00:00', '02 Oct 2026 10:00:00', '5', 'Informative, well structured and relevant to practice.', ''],
      [3, 'Iraq', 'doctor', '03 Oct 2026 10:00:00', '03 Oct 2026 10:00:00', '5', 'Very good course, clear and useful for everyone working in hospitals.', ''],
      [4, 'Fiji', 'nurse', '04 Oct 2026 10:00:00', '04 Oct 2026 10:00:00', '5', 'Debridement steps for pressure sores were shown on real patients and I now teach them to students.', ''] ] };
    App._rawSurveyResponses = raw; App._tmRespCache = null; App.data.push({ Course: 'Rules Course', CourseId: 'rules', Timestamp: '2026-10-26' }); App._tmLatestCache = null; FEED.courses.push({ id: 'rules', slug: 'rules', title: 'Rules Course', provider: 'P' });
    const RR = App.tmResponses('rules'), rr = (start) => RR.find(r => r.text.startsWith(start));
    const pv = App._tmJudgeVersion();
    const J = (r, v, s, sp, role) => { App._tmJudge[App._tmJudgeKey('rules', r.text)] = { v, r: v === 'use' ? 'good' : 'generic', s, sp, role: role || '', pv }; };
    J(rr('The suturing'), 'use', 5, true); J(rr('As a physio'), 'use', 4, true, 'physiotherapist'); J(rr('Informative'), 'use', 3, false); J(rr('Very good course'), 'use', 3, false); J(rr('Debridement'), 'use', 5, true);
    [rr('The suturing'), rr('As a physio'), rr('Informative'), rr('Very good course')].forEach((r, i) => { App._tm.byId[r.id] = { course: 'rules', show: true, order: i + 1 }; });
    const rel = App._tmRelational();
    check('rules: the same learner twice on a course is flagged (the stronger one stays)', rel[rr('As a physio').id] === 'the same learner twice on this course' && !rel[rr('The suturing').id]);
    check('…and a second generic comment', /second generic/.test(rel[rr('Informative').id] || rel[rr('Very good course').id] || ''));
    check('labels agree with the text: "as a physiotherapist" shows Physiotherapist, not the survey\'s Nurse', App._tmLabels(App._tm.byId[rr('As a physio').id], rr('As a physio'), 'en').cadre === 'Physiotherapist');
    // one learner on many courses (linked through the feedback list's email, kept in memory as a hash)
    {
      const raw2 = store.get('surghub_survey_raw'), ids5 = [];
      for (let k = 1; k <= 5; k++) {
        const name = 'Learner Course ' + k, text = 'Course ' + k + ' taught me a distinct technique number ' + k + ' that I use daily in theatre.';
        raw2[name] = { cols: RC, data: [[1, 'Yemen', 'nurse', '0' + k + ' Oct 2026 10:00:00', '0' + k + ' Oct 2026 10:00:00', '5', text, '']] };
        App.data.push({ Course: name, CourseId: 'lc' + k, Timestamp: '2026-10-26', FeedbackBank: JSON.stringify([{ t: text, e: 'same.learner@example.org', d: '2026-10-0' + k }]) });
        FEED.courses.push({ id: 'lc' + k, slug: 'lc' + k, title: name, provider: 'P' });
      }
      App._rawSurveyResponses = raw2; App._tmRespCache = null; App._tmLatestCache = null;
      for (let k = 1; k <= 5; k++) { const r = App.tmResponses('lc' + k)[0]; ids5.push(r.id); App._tm.byId[r.id] = { course: 'lc' + k, show: true, order: 1 }; App._tmJudge[App._tmJudgeKey('lc' + k, r.text)] = { v: 'use', r: 'good', s: k === 5 ? 2 : 4, sp: true, role: '', pv }; }
      const rel5 = App._tmRelational();
      const flagged = ids5.filter(id => /this learner is on 5 courses/.test(rel5[id] || ''));
      check('one learner on 5 courses: kept on 3 (the strongest), the other 2 flagged; the email is never stored', flagged.length === 2 && flagged.includes(ids5[4]) && !JSON.stringify(App._tm).includes('example.org'), JSON.stringify(flagged));
      for (let k = 1; k <= 5; k++) { delete App._tm.byId[ids5[k - 1]]; FEED.courses.pop(); }
      App._tmRelational();
    }

    // Published: search attributes, problems filter, swap with undo
    App._tmSection = 'published'; App._tmPubF = { show: 'problems' }; App._tmState = {};
    const pub = App._dashTestimonialsHtml();
    check('Published lists what is live, searchable, filtered to problems, with Swap / Off and an Excel download', /data-tms="rules course/.test(pub) && /the same learner twice on this course/.test(pub) && /tmOpenSwap\(/.test(pub) && /tmSwitchOff\(/.test(pub) && /Download Excel/.test(pub) && /data-tmg/.test(pub));
    App._tmPubF = {};
    const alt = App._tmAlternatives(rr('Informative').id);
    check('swap alternatives: checked ones only, never a learner already on the page or a second generic', alt.good.length === 1 && alt.good[0].r.text.startsWith('Debridement'), JSON.stringify(alt.good.map(a => a.r.text.slice(0, 12))));
    App._tmTidy = async (list) => Object.fromEntries(list.map(x => [x.r.id, { text: x.r.text }]));
    const ordBefore = App._tm.byId[rr('Informative').id].order;
    await App.tmSwap(rr('Informative').id, rr('Debridement').id, null);
    check('swap: the new one takes the same place, the old one goes off', App._tm.byId[rr('Debridement').id].show === true && App._tm.byId[rr('Debridement').id].order === ordBefore && App._tm.byId[rr('Informative').id].show === false);
    await App.tmUndo();
    check('…and Undo puts it back exactly', App._tm.byId[rr('Informative').id].show === true && !(App._tm.byId[rr('Debridement').id] && App._tm.byId[rr('Debridement').id].show));
    await App.tmSwitchOff(rr('Very good course').id); await App.tmUndo();
    check('switching off can be undone too', App._tm.byId[rr('Very good course').id].show === true);
    // Find better: groups and dismissals
    App._tmSection = 'find'; App._tmScoreMissing = async () => true;
    await App.tmReviewAll(null);
    const pi = App._tmProposals.findIndex(p => p.course === 'rules');
    check('Find better: suggestions in groups (problems, gaps, upgrades), each with Accept and Dismiss', pi >= 0 && /Accept all/.test(App._dashTestimonialsHtml()) && /tmDismiss\(/.test(App._dashTestimonialsHtml()) && !!App._tm.lastScan);
    const dkey = App._tmProposals[pi];
    await App.tmDismiss(pi);
    await App.tmReviewAll(null);
    check('…a dismissed suggestion does not come back', !App._tmProposals.some(p => p.course === dkey.course && p.type === dkey.type && (p.old && dkey.old ? p.old.id === dkey.old.id : true) && (p.cand && dkey.cand ? p.cand.r.id === dkey.cand.r.id : !p.cand)));
    // Excel
    let saved = null; const wrote = {};
    ctx.XLSX = { utils: { book_new: () => ({ s: [] }), json_to_sheet: (rows) => ({ rows }), book_append_sheet: (wb, ws, name) => { wb.s.push([name, ws.rows]); } }, write: (wb) => { saved = wb; return new Uint8Array([1]); } };
    ctx.electronAPI = { invoke: async (ch, name) => (ch === 'pick-save-path' ? '/tmp/' + name : null), fs: { writeFileSync: (p, d) => { wrote[p] = d; } } };
    await App.tmExportXlsx(null);
    const sh = saved && saved.s.find(x => x[0] === 'Testimonials');
    check('Excel: one row per live testimonial (text shown, original, labels, check, problems, status) and a courses sheet', sh && sh[1].length === App._tmPublishedRows().length && ['Text on the page', 'Original comment', 'Cadre', 'Country', 'Check: verdict', 'Problems', 'Status'].every(k => k in sh[1][0]) && saved.s.some(x => x[0] === 'Courses') && Object.keys(wrote)[0].startsWith('/tmp/surghub-testimonials-'));
    App._tmSection = 'courses';
  }

  // ── the survey sync never touches the choices; publishing carries the file ──
  const upd = fs.readFileSync(path.join(ROOT, 'js/updater.js'), 'utf8'), wm = fs.readFileSync(path.join(ROOT, 'js/websiteMetrics.js'), 'utf8'), pd = fs.readFileSync(path.join(ROOT, 'js/partnerDash.js'), 'utf8'), st = fs.readFileSync(path.join(ROOT, 'js/storage.js'), 'utf8');
  check('Sync Surveys never writes the testimonial choices', !/surghub_testimonials|_tm\.byId/.test(upd));
  check('both publish routes include testimonials.json', /path: 'testimonials\.json'/.test(wm) && /path: 'testimonials\.json'/.test(pd) && /_tmMarkPublished\(tf\)/.test(wm) && /_tmMarkPublished\(tf\)/.test(pd));
  check('the choices travel with the data (both storage maps); the publish state stays on this Mac', /'surghub_testimonials': path\.join\('surghub', 'testimonials\.json'\)/.test(st) && /'testimonials': 'surghub_testimonials'/.test(st) && /surgdash_testimonials_feed/.test(st));
  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})().catch(e => { check('runs', false, e.stack); console.log(`\n${ok}/${ok + bad} passed`); process.exit(1); });
