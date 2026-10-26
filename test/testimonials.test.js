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
ctx.window = ctx;
ctx.App = { data: [{ Course: 'Burns Course', CourseId: 'burns', Timestamp: '2026-10-26' }, { Course: 'Other Course', CourseId: 'other', Timestamp: '2026-10-26' }],
  escapeHtml: (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), escapeJsArg: (t) => String(t).replace(/'/g, "\\'"), formatNumber: (n) => String(n), renderView() {}, rerenderDashTab() {} };
vm.createContext(ctx);
for (const f of ['js/countryMap.js', 'js/scrub.js', 'js/testimonials.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const App = ctx.App;
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
  App._tm.byId[id1].show = true; App._tm.byId[pid].show = true; App._tmCourse = null; App._dashTab = 'testimonials';
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

  // ── the survey sync never touches the choices; publishing carries the file ──
  const upd = fs.readFileSync(path.join(ROOT, 'js/updater.js'), 'utf8'), wm = fs.readFileSync(path.join(ROOT, 'js/websiteMetrics.js'), 'utf8'), pd = fs.readFileSync(path.join(ROOT, 'js/partnerDash.js'), 'utf8'), st = fs.readFileSync(path.join(ROOT, 'js/storage.js'), 'utf8');
  check('Sync Surveys never writes the testimonial choices', !/surghub_testimonials|_tm\.byId/.test(upd));
  check('both publish routes include testimonials.json', /path: 'testimonials\.json'/.test(wm) && /path: 'testimonials\.json'/.test(pd) && /_tmMarkPublished\(tf\)/.test(wm) && /_tmMarkPublished\(tf\)/.test(pd));
  check('the choices travel with the data (both storage maps); the publish state stays on this Mac', /'surghub_testimonials': path\.join\('surghub', 'testimonials\.json'\)/.test(st) && /'testimonials': 'surghub_testimonials'/.test(st) && /surgdash_testimonials_feed/.test(st));
  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})().catch(e => { check('runs', false, e.stack); console.log(`\n${ok}/${ok + bad} passed`); process.exit(1); });
