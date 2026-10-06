// The two course toggles (< 50 learners, private courses): real js/app.js (the filter),
// js/unitarExport.js (what "private" means) and js/ui.js (the checkboxes) in one VM.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };

const mkEl = () => ({ style: {}, innerHTML: '', children: [], classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, setAttribute() {}, getAttribute() { return null; }, appendChild() {}, remove() {} });
const store = new Map();
const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, isNaN, isFinite, parseInt, parseFloat, Intl,
  TextEncoder, TextDecoder, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {}, requestAnimationFrame: (f) => f(), URLSearchParams, encodeURIComponent, decodeURIComponent, __swallowed() {},
  document: { addEventListener() {}, body: mkEl(), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => mkEl(), documentElement: { scrollTop: 0 } },
  navigator: { clipboard: { writeText: async () => {} } }, localStorage: { getItem: () => null, setItem() {} }, lucide: { createIcons() {} }, alert() {}, confirm: () => true,
  electronAPI: { fs, path, os: { tmpdir: () => '/tmp' }, invoke: async () => ({}) },
  Storage: { async getItem(k) { return store.has(k) ? store.get(k) : null; }, async setItem(k, v) { store.set(k, v); }, async keys() { return [...store.keys()]; } },
  Projects: { getProject: () => null, getAppSettings: async () => ({}), saveAppSettings: async () => {} } };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['js/app.js', 'js/unitarExport.js', 'js/ui.js']) { try { vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }); } catch (e) { check('loads ' + f, false, e.message); } }
const App = ctx.App;
App.renderView = () => { App._renders = (App._renders || 0) + 1; };
App.escapeHtml = (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const rec = (Course, Learners, Access, extra) => Object.assign({ Course, Provider: 'P', Learners, Access, Timestamp: '2026-10-01', CourseId: Course.toLowerCase().replace(/\W+/g, '-') }, extra || {});
App.data = [
  rec('Big Free', 120, 'free'),
  rec('Small Free', 20, 'free'),
  rec('Workshop', 80, 'free', { Timestamp: '2026-01-01' }),     // was free…
  rec('Workshop', 80, 'private'),                                // …is private now: the newest record decides
  rec('Draft', 5, 'draft'),
  rec('Override Private', 200, 'free'),                          // free on LearnWorlds, marked private on the course page
  rec('Override Public', 60, 'private'),                         // private on LearnWorlds, marked not private
  rec('Excluded Test', 300, 'free', { Excluded: true }),         // switched off in the Directory
];
App._privateCourses = { 'Override Private': true, 'Override Public': false };
App._excludedProviders = new Set();
const names = (list) => [...new Set(list.map(d => d.Course))].sort().join(', ');
const set = (low, priv) => { App.hideLowLearners = low; App.hidePrivateCourses = priv; };

// ── what "private" means ──
const pk = App.privateCourseKeys();
const pkNames = [...new Set(App.data.filter(d => pk.has(ctx.courseKey(d))).map(d => d.Course))].sort().join(', ');
check('private = marked private or draft on LearnWorlds, unless the course page says otherwise',
  pkNames === 'Draft, Override Private, Workshop', pkNames);
check('with no title shared, the per-course answer and the title answer agree',
  App.data.every(d => App.isCoursePrivate(d.Course) === pk.has(ctx.courseKey(d))));

// ── the filter ──
set(false, false); check('both off: every included course', names(App.getAnalyticsSnap()) === 'Big Free, Draft, Override Private, Override Public, Small Free, Workshop', names(App.getAnalyticsSnap()));
set(true, false); check('< 50 learners left out', names(App.getAnalyticsSnap()) === 'Big Free, Override Private, Override Public, Workshop', names(App.getAnalyticsSnap()));
set(false, true); check('private courses left out, the course-page overrides respected', names(App.getAnalyticsSnap()) === 'Big Free, Override Public, Small Free', names(App.getAnalyticsSnap()));
set(true, true); check('both together', names(App.getAnalyticsSnap()) === 'Big Free, Override Public', names(App.getAnalyticsSnap()));
set(false, true);
check('platform totals follow the toggle too (and still keep Directory-excluded courses)', names(App.getPlatformSnap()) === 'Big Free, Excluded Test, Override Public, Small Free', names(App.getPlatformSnap()));
check('history follows it: every record of a private course goes, old ones included',
  !App.getAnalyticsHistory().some(d => d.Course === 'Workshop') && !App.getPlatformHistory().some(d => d.Course === 'Workshop'));
set(false, false);
check('history with both off is untouched', App.getAnalyticsHistory().filter(d => d.Course === 'Workshop').length === 2);

// ── counting everything regardless ──
set(true, true);
const all = App._withAllCourses(() => App.getAnalyticsSnap());
check('exports that must count every course still see all of them', all.length === 6 && App.hideLowLearners === true && App.hidePrivateCourses === true);
let threw = false; try { App._withAllCourses(() => { throw new Error('x'); }); } catch (e) { threw = true; }
check('the toggles come back even when the work fails', threw && App.hideLowLearners === true && App.hidePrivateCourses === true);

// ── switching ──
set(false, false); App._renders = 0;
App.setCourseToggle('hidePrivateCourses', true);
check('a checkbox switches its toggle and redraws', App.hidePrivateCourses === true && App._renders === 1);
App.setCourseToggle('somethingElse', true);
check('nothing else can be switched through it', App.somethingElse === undefined && App._renders === 1);

// ── what reports say ──
set(false, false); check('every course in: reports say nothing extra', App._courseScopeNote() === '');
set(true, false); check('< 50 learners left out: said', App._courseScopeNote() === 'Courses with fewer than 50 learners are left out of this report.');
set(false, true); check('private left out: said, and what private means', App._courseScopeNote() === 'Private courses (in-country workshops and unreleased courses) are left out of this report.');
set(true, true); check('both: one sentence', /fewer than 50 learners and private courses \(in-country workshops and unreleased courses\) are left out/.test(App._courseScopeNote()));

// ── the checkboxes ──
set(false, true);
const html = App._courseTogglesHtml();
check('two checkboxes, usable in read-only and reporting mode',
  (html.match(/<input type="checkbox" data-viewer-allowed data-report-ok/g) || []).length === 2, html.slice(0, 200));
check('each switches its own toggle', /onchange="App\.setCourseToggle\('hideLowLearners', this\.checked\)"/.test(html) && /onchange="App\.setCourseToggle\('hidePrivateCourses', this\.checked\)"/.test(html));
check('they show the current state', /data-course-toggle="hidePrivateCourses" checked/.test(html) && !/data-course-toggle="hideLowLearners" checked/.test(html));
check('each says how many courses it would leave out', /&lt; 50 learners <span class="text-slate-400">\(2\)<\/span>/.test(html) && /private courses <span class="text-slate-400">\(3\)<\/span>/.test(html), html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));

// ── one title, three records: the ECSACONM PeN programme (Oct 2026) ──
const PEN = 'Perioperative Nursing E-Learning Foundational Programme (PeN Programme)';
const pen = (CourseId, Access, Learners, Timestamp) => ({ Course: PEN, Provider: 'ECSACONM', CourseId, Access, Learners, Certificates: 0, Timestamp: Timestamp || '2026-10-06' });
const resetPen = () => {
  App.data = [pen('pen-programme', 'free', 2207), Object.assign(rec('Programa Básico', 157, 'free'), { Provider: 'ECSACONM' }),
              pen(undefined, undefined, 0, '2026-06-03'),                       // the leftover record with no slug
              pen('pen-programme-en', 'private', 2)];                           // the private copy
  delete App.data[2].CourseId; delete App.data[2].Access;
  App._privateCourses = {}; set(false, false);
};
resetPen();
check('the table lists each course once and drops the leftover no-slug record, as the analytics do',
  App._provCourseRows('ECSACONM').length === 3 && !App._provCourseRows('ECSACONM').some(d => !d.CourseId), App._provCourseRows('ECSACONM').map(d => d.CourseId || '(none)').join(', '));
check('so all ticked reads "3 of 3 included", not "3 of 4"', /^3 of 3 included · untick/.test(App._provIncludedSummary('ECSACONM')), App._provIncludedSummary('ECSACONM'));
App.toggleCourseIncluded('pen-programme-en', false);
check('unticking the private copy switches off that course only, not the published one with the same title',
  App.data.find(d => d.CourseId === 'pen-programme-en').Excluded === true && !App.data.find(d => d.CourseId === 'pen-programme').Excluded);
check('the export then holds the published course and not the copy',
  names(App.getAnalyticsSnap().filter(d => d.Provider === 'ECSACONM')) === PEN + ', Programa Básico'
  && App.getAnalyticsSnap().filter(d => d.Course === PEN).length === 1 && App.getAnalyticsSnap().find(d => d.Course === PEN).Learners === 2207);
check('…and the header counts the tick', /^2 of 3 included/.test(App._provIncludedSummary('ECSACONM')));
check('a course page reads its own course\'s tick', App.isCourseIncludedKey('pen-programme') === true && App.isCourseIncludedKey('pen-programme-en') === false);
resetPen();
App.toggleCourseIncluded('pen-programme', false);
check('switching off the slugged course does not bring the leftover record back into the reports',
  !App.getAnalyticsSnap().some(d => d.Course === PEN && !d.CourseId));
resetPen();
App.data.push(rec('Legacy Course', 60, 'free')); delete App.data[App.data.length - 1].CourseId;
App.toggleCourseIncluded('Legacy Course', false);
check('a course with no slug at all is still switched by its title', App.data[App.data.length - 1].Excluded === true);

resetPen();
check('the private copy is private; the title, shared with a published course, is not',
  App.isCourseRecordPrivate(App.data[3]) === true && App.isCourseRecordPrivate(App.data[0]) === false && App.isCoursePrivate(PEN) === false);
set(false, true);
check('excluding private courses leaves out the copy and keeps the published course and its 2,207 learners',
  App.getAnalyticsSnap().filter(d => d.Course === PEN).map(d => d.CourseId).join() === 'pen-programme');
check('the table says why a ticked course is still left out', App._courseToggleReason(App.data[3]) === 'private' && App._courseToggleReason(App.data[0]) === ''
  && / · 1 left out by the course toggles · /.test(App._provIncludedSummary('ECSACONM')), App._provIncludedSummary('ECSACONM'));
App._privateCourses = { [PEN]: true };
check('marking the title private on the course page covers every course with that title',
  !App.getAnalyticsSnap().some(d => d.Course === PEN) && App.isCoursePrivate(PEN) === true);
set(false, false);

// ── wiring ──
const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
const reports = fs.readFileSync(path.join(ROOT, 'js/reports.js'), 'utf8');
check('the checkboxes sit on the Dashboard, the provider page and the Reports tab', (ui.match(/\$\{this\._courseTogglesHtml\(/g) || []).length === 3 && /Courses in Reports/.test(ui));
check('the old Dashboard-only checkbox is gone', !/App\.hideLowLearners=this\.checked/.test(ui));
check('provider table and course page switch courses by key', /onchange="App\.toggleCourseIncluded\(\\'' \+ keyEsc \+ '\\', this\.checked, this\)"/.test(ui)
  && /App\.toggleCourseIncluded\('\$\{this\.escapeJsArg\(crsKey\)\}', this\.checked\)/.test(ui) && !/toggleCourseIncludedByName\(\\'' \+ courseEsc/.test(ui));
check('Directory and course page show each course\'s own privacy', /App\.isCourseRecordPrivate\(s\)/.test(ui) && /App\.isCourseRecordPrivate\(cSnap\)/.test(ui));
check('both reports state what they left out', (reports.match(/<strong[^>]*>Courses included:<\/strong> ' \+ esc\(window\.App\._courseScopeNote\(\)\)/g) || []).length === 2);
check('awards wording follows the private toggle', /window\.App\.hidePrivateCourses \? '\(private courses left out\)' : '\(including private ones\)'/.test(reports)
  && /App\.hidePrivateCourses \? '\(private courses left out\)' : '\(incl\. private courses\)'/.test(ui));
check('the awards are recomputed when the private toggle changes', /\(this\.hidePrivateCourses \? JSON\.stringify\(this\._privateCourses \|\| \{\}\) : 0\)/.test(ui));
check('the master export and milestones count every course', /this\._withAllCourses\(\(\) => this\.getAnalyticsSnap\(\)\)/.test(fs.readFileSync(path.join(ROOT, 'js/export.js'), 'utf8'))
  && /this\._withAllCourses\(\(\) => \[/.test(fs.readFileSync(path.join(ROOT, 'js/milestones.js'), 'utf8')));

console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
