// Testimonials added by hand (js/testimonialsManual.js): stored with the choices, listed as responses,
// published with the label as typed, never checked (no cost) and never replaced, the note never published.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 300) : '')); };
const store = new Map();
const COLS = ['Respondent', 'Country', 'Profession', 'Started at', 'Ended at', 'On a scale from 1 to 5, how would you rate your overall satisfaction with this course?', 'What aspects of this course did you find most interesting?'];
store.set('surghub_survey_raw', {
  'Burns Course': { cols: COLS, data: [[1, 'Kenya', 'nurse', '12 Oct 2026 10:00:00', '12 Oct 2026 10:00:00', '5', 'The case discussions on fluid resuscitation were the most practical part of the course for my ward']] },
  'Cours Français': { cols: ['Respondent', 'Country', 'Profession', 'Started at', 'Ended at', 'Sur une échelle de 1 à 5, satisfaction concernant ce cours', 'Qu\'avez-vous trouvé le plus intéressant dans ce cours ?'], data: [] },
});
const alerts = [], confirms = []; let answer = true;
const ctx = { console: { log() {}, warn() {}, error() {} }, TextEncoder, crypto: globalThis.crypto, Uint8Array, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, isNaN, escape, unescape, decodeURIComponent, __swallowed() {},
  Date: class extends Date { constructor(...a) { super(...(a.length ? a : [Date.UTC(2026, 10, 2, 9)])); } static now() { return Date.UTC(2026, 10, 2, 9); } },
  alert: (m) => alerts.push(m), confirm: (m) => { confirms.push(m); return answer; },
  Storage: { async getItem(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; }, async setItem(k, v) { store.set(k, JSON.parse(JSON.stringify(v))); } } };
ctx.window = ctx; ctx.Intl = Intl;
ctx.App = { data: [{ Course: 'Burns Course', CourseId: 'burns', Timestamp: '2026-10-26' }, { Course: 'Cours Français', CourseId: 'fr', Timestamp: '2026-10-26' }], msgs: [],
  escapeHtml: (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), escapeJsArg: (t) => String(t).replace(/'/g, "\\'"), formatNumber: (n) => String(n),
  showMsg(m) { this.msgs.push(m); }, renderView() {}, rerenderDashTab() {} };
vm.createContext(ctx);
for (const f of ['js/countryMap.js', 'js/scrub.js', 'js/testimonials.js', 'js/testimonialLabels.js', 'js/testimonialsWorkbench.js', 'js/testimonialsManual.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const App = ctx.App;
App._tmJudgeMissing = async () => false;
const FEED = { courses: [{ id: 'burns', slug: 'burns-public', title: 'Burns Course', provider: 'P' }, { id: 'fr', slug: 'cours-fr', title: 'Cours Français', provider: 'P' }] };
App._cfFeedNow = () => FEED;

(async () => {
  await App._tmLoad();
  const QUOTE = 'Thanks to the burns course our team now starts fluid resuscitation within the first hour, and we have not lost a child to burn shock since.';
  const id = await App.tmSaveManual({ course: 'burns', text: '  ' + QUOTE + '\n', role: 'General surgeon', affiliation: 'Kenyatta National Hospital', country: 'Kenya', note: 'Email to the SURGhub inbox from Dr A. B., 12 Oct; permission given', date: '2026-10-12', show: true });
  const tm = store.get('surghub_testimonials');
  check('it is stored with the testimonial choices, which travel with the data', tm.manual && tm.manual[id] && tm.manual[id].text === QUOTE && tm.manual[id].note.startsWith('Email'), JSON.stringify(tm.manual && tm.manual[id]));
  check('it is switched on and protected from Find better', tm.byId[id] && tm.byId[id].show === true && tm.byId[id].keep === true && tm.byId[id].course === 'burns');
  check('the id says it was added by hand and carries no email or name', /^m[a-z0-9]+$/.test(id));
  const R = App.tmResponses('burns'), r = R.find(x => x.id === id);
  check('it is listed with the course\'s responses, first, next to the survey comments', R.length === 2 && R[0].id === id && r.manual === true && r.q === 'Added by hand');

  // ── published ──
  const f = App.testimonialsFeedBuild(FEED), item = (f.courses['burns-public'] || []).find(x => x.id === id);
  check('it is published on the course page', !!item && item.text === QUOTE, JSON.stringify(f.courses['burns-public']));
  check('the label is published as typed: role, affiliation, then the country', item && item.cadre === 'General surgeon, Kenyatta National Hospital' && item.country === 'Kenya', JSON.stringify(item));
  check('the internal note and the date received are never published', !JSON.stringify(f).includes('inbox') && !JSON.stringify(f).includes('Dr A'));
  const id2 = await App.tmSaveManual({ course: 'burns', text: 'This course gave me the confidence to manage burns on my own at night.', show: true });
  const it2 = App.testimonialsFeedBuild(FEED).courses['burns-public'].find(x => x.id === id2);
  check('without a role or country it shows nothing there (the page says SURGhub learner)', it2 && !it2.cadre && !it2.country, JSON.stringify(it2));
  check('the date received defaults to today', store.get('surghub_testimonials').manual[id2].date === '2026-11-02');

  // ── never checked, never replaced ──
  const q = App._tmQ('burns', r);
  check('the testimonial check never runs on it (no cost) and it counts as chosen', q.ok && q.label === 'added by hand' && !App._tmJudgeItems(['burns']).some(x => x.r.manual), JSON.stringify(q));
  check('it is never flagged weak for not answering a survey question', App._tmWeak(App._tm.byId[id], r) === '');
  App._tmRel = App._tmRelational();
  check('Find better never proposes replacing it', !App._tmReviewCourse('burns').some(p => p.old && p.old.id === id));
  const rows = App._tmPublishedRows().filter(x => x.r && x.r.manual);
  check('the Published list shows it with no problems', rows.length === 2 && rows.every(x => !x.flags.length), JSON.stringify(rows.map(x => x.flags)));
  App._tmPubF = { show: 'manual' };
  const html = App._tmPublishedHtml(App.escapeHtml, FEED);
  check('the Published list can show only those added by hand, with where it came from and an Edit link', /Added by hand/.test(html) && /Received 2026-10-12 · Email to the SURGhub inbox/.test(html) && /tmOpenManual\(null, '/.test(html) && !/The case discussions/.test(html));
  check('the Published list has the Add button', /App\.tmOpenManual\(\)/.test(html));
  App._tmPubF = {};

  // ── edit, switch off, move, delete ──
  await App.tmSaveManual({ course: 'burns', text: QUOTE + ' Truly.', role: 'Consultant surgeon', affiliation: '', country: 'Kenya', note: 'edited', date: '2026-10-12', show: false }, id);
  let m = store.get('surghub_testimonials');
  check('editing keeps the same testimonial (same id) and its added date', m.manual[id] && m.manual[id].text.endsWith('Truly.') && m.manual[id].added === tm.manual[id].added && m.manual[id].edited && Object.keys(m.manual).length === 2);
  check('switched off, it leaves the page but stays in the list', m.byId[id].show === false && !(App.testimonialsFeedBuild(FEED).courses['burns-public'] || []).some(x => x.id === id) && App.tmResponses('burns').some(x => x.id === id));
  await App.tmSaveManual({ course: 'fr', text: 'Ce cours m\'a permis de mieux organiser la prise en charge des brûlés dans notre service.', show: true }, id);
  m = store.get('surghub_testimonials');
  check('moving it to another course moves the choice too', m.manual[id].course === 'fr' && m.byId[id].course === 'fr' && App.tmResponses('fr').some(x => x.id === id) && !App.tmResponses('burns').some(x => x.id === id));
  check('a French testimonial on a French page is published', (App.testimonialsFeedBuild(FEED).courses['cours-fr'] || []).some(x => x.id === id && x.lang === 'fr'));
  answer = false;
  check('delete asks first and does nothing on Cancel', !(await App.tmDeleteManual(id)) && !!store.get('surghub_testimonials').manual[id] && /Delete this testimonial/.test(confirms.pop()));
  answer = true;
  check('delete removes the entry and its choice', (await App.tmDeleteManual(id)) && !store.get('surghub_testimonials').manual[id] && !store.get('surghub_testimonials').byId[id]);

  // ── warnings ──
  const w1 = App.tmManualWarnings('fr', 'This course was excellent and I use what I learned every day on the ward.');
  check('an English testimonial for a French page is pointed out', w1.some(x => x.k === 'lang' && /French/.test(x.msg)), JSON.stringify(w1));
  const w2 = App.tmManualWarnings('burns', 'Great course, write to me at someone@example.org for more of my story.');
  check('an email address in the text is pointed out: it would be held back', w2.some(x => x.k === 'held'), JSON.stringify(w2));
  check('a clean English testimonial on an English page has no warning', !App.tmManualWarnings('burns', QUOTE).length);
  const heldId = await App.tmSaveManual({ course: 'burns', text: 'Great course, write to me at someone@example.org for more of my story.', show: true });
  check('…and it is not published while the address is in it', !(App.testimonialsFeedBuild(FEED).courses['burns-public'] || []).some(x => x.id === heldId));
  check('nothing is saved without a course or a text', (await App.tmSaveManual({ course: '', text: 'x' })) === null && (await App.tmSaveManual({ course: 'burns', text: '  ' })) === null);

  // ── wiring ──
  const ui = fs.readFileSync(ROOT + '/js/ui.js', 'utf8'), idx = fs.readFileSync(ROOT + '/index.html', 'utf8'), tjs = fs.readFileSync(ROOT + '/js/testimonials.js', 'utf8');
  check('the Feedback tab has an Add a testimonial button', /_dashFeedbackHtml\(snapData\) \{[\s\S]{0,2000}App\.tmOpenManual\(\)/.test(ui));
  check('the course editor has one for its course', /App\.tmOpenManual\(\\'' \+ cidJs/.test(tjs));
  check('the module loads after the workbench', idx.indexOf('js/testimonialsManual.js') > idx.indexOf('js/testimonialsWorkbench.js') && idx.includes('js/testimonialsManual.js'));

  console.log('\n' + ok + '/' + (ok + bad) + ' passed');
  process.exit(bad ? 1 : 0);
})();
