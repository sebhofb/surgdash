// Star ratings on the course and provider pages: the 5-star share read from the
// overall-satisfaction question's 1–5 distribution (QuestionStats). ui.js is loaded
// for real; the helpers are pure, so the arithmetic and the wording are checkable here.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };

const mkEl = () => ({ style: {}, innerHTML: '', children: [], classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, setAttribute() {}, getAttribute() { return null; }, appendChild() {}, remove() {} });
const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, isFinite, isNaN, parseFloat, parseInt,
  setTimeout: (f) => { f(); return 1; }, clearTimeout() {}, setInterval() { return 2; }, clearInterval() {}, requestAnimationFrame: (f) => f(), TextDecoder, URLSearchParams, encodeURIComponent, decodeURIComponent, __swallowed: () => {},
  document: { body: mkEl(), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => mkEl(), addEventListener() {}, documentElement: { scrollTop: 0 } },
  navigator: { clipboard: { writeText: async () => {} } }, localStorage: { getItem: () => null, setItem() {} }, lucide: { createIcons() {} },
  alert() {}, confirm: () => true,
  electronAPI: { fs, path, invoke: async () => ({}) },
  Storage: { DATA_DIR: '/tmp', async getItem() { return null; }, async setItem() {} },
  Projects: { getProject: () => null, getAppSettings: async () => ({}) },
};
ctx.window = ctx; ctx.globalThis = ctx;
ctx.App = { view: 'platform', data: [], userHistory: [], editUnlocked: true, currentProject: 'surghub',
  escapeHtml: (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  escapeJsArg: (t) => String(t).replace(/\\/g, '\\\\').replace(/'/g, "\\'"), formatNumber: (n) => Number(n || 0).toLocaleString('en-US'),
  showMsg() {}, navigate() {}, getAnalyticsSnap: () => [], getAnalyticsHistory: () => [], getCurrentProject: () => ({ id: 'surghub', type: 'surghub' }),
};
vm.createContext(ctx);
try { vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8'), ctx, { filename: 'ui.js' }); } catch (e) { check('loads ui.js', false, e.message); }
const App = ctx.App;

// ── fixtures: what Sync Surveys writes into a course record ──
const Q = (q, dist, extra) => Object.assign({ q, n: Object.values(dist).reduce((a, b) => a + b, 0), na: 0, avg: 4.5, dist }, extra || {});
const NEW_TO_ME = Q('How strongly do you agree with the following statement: "The information presented in this course was new to me"', { 3: 5, 4: 20, 5: 75 });
const en = { Course: 'Burns', Provider: 'P', Rating: '4.48', Responses: 110, QuestionStats: JSON.stringify([
  NEW_TO_ME,   // listed first on purpose: the overall question is found by wording, not position
  Q('On a scale from 1 to 5, how would you rate your overall satisfaction with this course?', { 1: 2, 2: 3, 3: 10, 4: 15, 5: 70 }),
]) };
const es = { Course: 'Heridas', Provider: 'P', Rating: '4.70', Responses: 30, QuestionStats: JSON.stringify([
  Q('En una escala del 1 al 5 ¿cuál describe mejor su satisfacción general con el curso?', { 3: 2, 4: 5, 5: 23 }),
]) };
const fr = { Course: 'Brûlures', Provider: 'P', Rating: '4.10', Responses: 10, QuestionStats: JSON.stringify([
  Q('Sur une échelle de 1 à 5, quel est votre niveau de satisfaction concernant ce cours ?', { 2: 1, 3: 1, 4: 4, 5: 4 }),
]) };
const module_ = { Course: 'Wound Healing', Provider: 'P', Rating: '5.00', Responses: 4, QuestionStats: JSON.stringify([
  Q('On a scale from 1 to 5, please rate the overall quality of this module?', { 5: 4 }),
]) };
const flagged = { Course: 'Oddly Worded', Provider: 'P', Rating: '3.00', Responses: 2, QuestionStats: JSON.stringify([
  Q('How strongly do you agree: the platform was easy to use', { 5: 2 }),
  Q('Please score this course', { 1: 1, 5: 1 }, { overall: true }),   // no keyword, but the sync marked it
]) };
const noSurvey = { Course: 'Silent', Provider: 'P', Responses: 0 };
const broken = { Course: 'Broken', Provider: 'P', Responses: 9, QuestionStats: '{not json' };
const noDist = { Course: 'Old', Provider: 'P', Responses: 9, QuestionStats: JSON.stringify([{ q: 'overall satisfaction', n: 9, avg: 4 }]) };

// ── finding the overall question ──
const pick = (rec) => App._overallRatingQuestion(JSON.parse(rec.QuestionStats));
check('English: the overall-satisfaction question, wherever it sits in the list', /overall satisfaction/.test(pick(en).q), pick(en).q);
check('Spanish and French wordings are recognised', /satisfacci/.test(pick(es).q) && /satisfaction concernant/.test(pick(fr).q));
check('the one course that asks about "overall quality of this module" still counts', /overall quality/.test(pick(module_).q));
check('a question the sync marked as the overall one wins over wording', pick(flagged).q === 'Please score this course');
check('nothing to pick from → null, never a throw', App._overallRatingQuestion(null) === null && App._overallRatingQuestion([]) === null && App._overallRatingQuestion([{ q: 'x' }]) === null);

// ── one course ──
const one = App.ratingDistribution([en]);
check('5-star count and rated total come from the distribution', one.five === 70 && one.n === 100 && one.dist[1] === 2 && one.dist[4] === 15, JSON.stringify(one));
check('the share is of RATED responses, rounded to a whole percent', one.fivePct === 70 && one.courses === 1);
check('responses that skipped the rating are counted separately, not as non-5-star', one.responses === 110 && one.unrated === 10);
check('a course with no survey, broken stats or no distribution yields nothing',
  App.ratingDistribution([noSurvey]) === null && App.ratingDistribution([broken]) === null && App.ratingDistribution([noDist]) === null && App.ratingDistribution([]) === null && App.ratingDistribution(null) === null);
check('an unmatched record does not disturb the others', JSON.stringify(App.ratingDistribution([broken, en, noSurvey])) === JSON.stringify(one));

// ── a provider ──
const prov = App.ratingDistribution([en, es, fr, module_, flagged, noSurvey]);
check('a provider sums its courses: 5-star, rated and course counts', prov.five === 70 + 23 + 4 + 4 + 1 && prov.n === 100 + 30 + 10 + 4 + 2 && prov.courses === 5, JSON.stringify(prov));
check('percentage is over the summed rated responses, not an average of course shares', prov.fivePct === Math.round(102 / 146 * 100));
check('the whole 1–5 spread is kept', prov.dist[1] === 3 && prov.dist[2] === 4 && prov.dist[3] === 13 && prov.dist[4] === 24 && prov.dist[5] === 102);
check('rating-blank count is the surplus of survey responses over rated ones', prov.responses === 156 && prov.unrated === 10);

// ── the strip ──
const html = App._fiveStarHtml([en], { scope: 'course' });
check('the course strip states the share and the numbers behind it', /70%/.test(html) && /gave <strong>5 stars<\/strong>/.test(html) && /70 of 100 rated responses/.test(html), html.replace(/\s+/g, ' ').slice(0, 300));
check('it says how many skipped the rating', /10 left the rating blank/.test(html));
check('it draws every star level that has votes, widest first', (html.match(/<div style="width:/g) || []).length === 5 && /width:70\.0%/.test(html) && html.indexOf('width:70.0%') < html.indexOf('width:15.0%'));
check('each segment and the legend carry the count and share', /title="5 stars: 70 \(70%\)"/.test(html) && /title="1 star: 2 \(2%\)"/.test(html) && /5★ 70%/.test(html) && /1★ 2%/.test(html));
check('the tooltip defines the metric: rated responses only', /share of everyone who answered it/.test(html) && /skipped the question are not counted/.test(html));
check('a single course never says "across N courses"', !/across/.test(html));
const phtml = App._fiveStarHtml([en, es, fr, module_, flagged, noSurvey], { scope: 'provider' });
check('the provider strip says how many courses it spans', /across 5 courses/.test(phtml) && /102 of 146 rated responses/.test(phtml) && /70%/.test(phtml), phtml.replace(/\s+/g, ' ').match(/rated responses[^<]*/)[0]);
check('the platform tab spans courses the same way', /across 5 courses/.test(App._fiveStarHtml([en, es, fr, module_, flagged], { scope: 'platform' })));
check('one-course providers read like a course', !/across/.test(App._fiveStarHtml([es], { scope: 'provider' })));
check('no strip until surveys have been synced', App._fiveStarHtml([noSurvey]) === '' && App._fiveStarHtml([]) === '' && App._fiveStarHtml([{}]) === '');
check('a course that only ever got 5 stars is a full bar, not a division error', /100%/.test(App._fiveStarHtml([module_])) && (App._fiveStarHtml([module_]).match(/<div style="width:/g) || []).length === 1);
check('a level with a few votes reads as <1%, never as 0%', (() => { const h = App._fiveStarHtml([{ Responses: 1826, QuestionStats: JSON.stringify([Q('overall satisfaction', { 1: 13, 2: 8, 3: 149, 4: 332, 5: 1256 })]) }]); return /2★ &lt;1%|2★ <1%/.test(h) && /title="2 stars: 8 \(<1%\)"/.test(h) && !/ 0%/.test(h); })(), (App._fiveStarHtml([{ Responses: 1826, QuestionStats: JSON.stringify([Q('overall satisfaction', { 1: 13, 2: 8, 3: 149, 4: 332, 5: 1256 })]) }]).match(/2★[^<]*/) || [''])[0]);
check('large numbers are formatted for a reader', /1,256 of 1,758/.test(App._fiveStarHtml([{ Responses: 1826, QuestionStats: JSON.stringify([Q('overall satisfaction', { 1: 13, 2: 8, 3: 149, 4: 332, 5: 1256 })]) }])));

// ── wiring ──
const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
const upd = fs.readFileSync(path.join(ROOT, 'js/updater.js'), 'utf8');
check('the strip opens the Feedback Trends panel on the provider page, over the provider\'s included courses',
  /Feedback_Trends'\)\}<\/h3>\s*\$\{this\._fiveStarHtml\(pSnap, \{ scope: 'provider' \}\)\}/.test(ui));
check('and the platform Feedback tab, over every included course',
  /Feedback_Trends'\)\}<\/h3>\s*\$\{this\._fiveStarHtml\(snapData, \{ scope: 'platform' \}\)\}/.test(ui));
check('and on the course page, over that course alone',
  /Course_Feedback'\)\}<\/h3>\s*\$\{this\._fiveStarHtml\(\[cSnap\], \{ scope: 'course' \}\)\}/.test(ui));
check('the survey sync marks the question behind Rating so newer data needs no guessing',
  /if \(rColFinal && qc === rColFinal\) st\.overall = true;/.test(upd));
check('the fallback overall question is always among the scale questions that get a distribution',
  /\(rCol && k === rCol\) \|\| \(rColFinal && k === rColFinal\)/.test(upd));

console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
