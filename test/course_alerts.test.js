// Courses that started enrolling without a provider or survey link (js/courseAlerts.js):
// silenced and excluded courses included; a few reviewer enrolments do not trip it.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };
const store = new Map(), msgs = [], toggled = [];
const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, isNaN, __swallowed() {},
  Storage: { async getItem(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; }, async setItem(k, v) { store.set(k, JSON.parse(JSON.stringify(v))); } } };
ctx.window = ctx;
const day = (n) => new Date(Date.UTC(2026, 9, 21) - n * 86400000).toISOString().slice(0, 10);
const enr = (course, n, ago) => Array.from({ length: n }, (_, i) => ({ uid: course + i, course, enrolled_date: day(ago) }));
ctx.App = { view: 'upload', formatNumber: (n) => Number(n).toLocaleString('en-GB'), escapeHtml: (t) => String(t), escapeJsArg: (t) => String(t).replace(/'/g, "\\'"),
  showMsg(m, kind) { msgs.push([m, kind]); }, renderView() {}, toggleCourseIncluded(k, inc) { toggled.push([k, inc]); },
  data: [
    { Course: 'Launched Draft', CourseId: 'ld', Provider: 'Unknown Provider', URL: '', Access: 'free', Learners: 40, Excluded: true, Timestamp: '2026-10-20' },
    { Course: 'Silenced Course', CourseId: 'sc', Provider: 'AO Alliance', URL: '', Access: 'private', Learners: 12, Timestamp: '2026-10-20' },
    { Course: 'Reviewers Only', CourseId: 'ro', Provider: '', URL: '', Access: 'draft', Learners: 3, Timestamp: '2026-10-20' },
    { Course: 'Complete Course', CourseId: 'cc', Provider: 'GSF', URL: 'https://x/assessment/1', Access: 'free', Learners: 900, Timestamp: '2026-10-20' },
    { Course: 'Old Burst', CourseId: 'ob', Provider: 'Unknown', URL: 'https://x', Access: 'free', Learners: 60, Timestamp: '2026-10-20' }],
  _triageSilenced: ['Silenced Course'] };
ctx.App._rawCompletion = [].concat(enr('Launched Draft', 30, 3), enr('Silenced Course', 26, 10), enr('Reviewers Only', 7, 2), enr('Complete Course', 50, 1), enr('Old Burst', 30, 40));
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/courseAlerts.js'), 'utf8'), ctx);
const App = ctx.App;
(async () => {
  await App._wakeLoad();
  const now = new Date(Date.UTC(2026, 9, 21, 12));
  const L = App.courseWakeups(now);
  check('flags courses missing a provider or survey link with 25+ enrolments in 14 days, most first', L.map(x => x.course).join() === 'Launched Draft,Silenced Course', L.map(x => x.course + ':' + x.recent).join());
  check('excluded and silenced courses are included, and marked', L[0].excluded && !L[0].silenced && L[1].silenced && !L[1].excluded);
  check('what is missing is named', L[0].missing.join() === 'provider,survey link' && L[1].missing.join() === 'survey link');
  check('7 enrolments (reviewers, a slow start), a complete course, or enrolments older than 14 days do not trip it', !L.some(x => /Reviewers|Complete|Old Burst/.test(x.course)));
  await App.wakeAddDetails('Launched Draft');
  check('Add details includes an excluded course again and brings a silenced one back', toggled[0][0] === 'ld' && toggled[0][1] === true);
  await App.wakeAddDetails('Silenced Course');
  check('…off the silenced list (persisted), so it is in the triage list to fill in', App._triageSilenced.indexOf('Silenced Course') < 0 && store.get('surgdash_triage_silenced').indexOf('Silenced Course') < 0);
  await App.wakeDismiss('Launched Draft');
  check('Silence hides a course', !App.courseWakeups(now).some(x => x.course === 'Launched Draft') && store.get('surgdash_course_wakeups').dismissed['Launched Draft'] === 40);
  App.data[0].Learners = 64;
  check('…24 more enrolments are not enough to bring it back', !App.courseWakeups(now).some(x => x.course === 'Launched Draft'));
  App.data[0].Learners = 65; App._rawCompletion = App._rawCompletion.filter(r => r.course !== 'Launched Draft');
  const back = App.courseWakeups(now).find(x => x.course === 'Launched Draft');
  check('…25 more bring it back, even when they came slowly (none in the last 14 days)', back && back.sinceSilenced === 25 && back.recent === 0);
  // nightly: announce each course once; a silenced one again when it comes back
  ctx.Date = class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now.getTime(); } };
  App._wake = null; store.delete('surgdash_course_wakeups'); msgs.length = 0;
  App.data[0].Learners = 40; App._rawCompletion = App._rawCompletion.concat(enr('Launched Draft', 30, 3));
  const n1 = await App.courseWakeupsCheck();
  const n2 = await App.courseWakeupsCheck();
  check('the nightly check announces new ones once (amber), then only counts them', /2 enrolling without provider\/survey link \(2 new\)/.test(n1) && msgs.length === 1 && msgs[0][1] === 'warn' && /2 courses have started enrolling/.test(msgs[0][0]) && /^2 enrolling/.test(n2) && !/new/.test(n2), n1 + ' | ' + n2);
  await App.wakeDismiss('Silenced Course'); msgs.length = 0;
  check('after Silence it is gone from the nightly count', /^1 enrolling/.test(await App.courseWakeupsCheck()) && msgs.length === 0);
  App.data[1].Learners = 12 + 25;
  const n3 = await App.courseWakeupsCheck();
  check('a silenced course that comes back (25 more) is announced again', /^2 enrolling .*\(1 new\)/.test(n3) && msgs.some(m => /"Silenced Course" has started enrolling/.test(m[0])), n3);
  const html = App._courseWakeupsHtml();
  check('the Data Sync box lists them with their recent enrolments, "back" when it returned, and the two buttons', /Courses that started enrolling/.test(html) && /30 enrolments in 14 days/.test(html) && /back: 25 more since silenced/.test(html) && /App\.wakeAddDetails\('Launched Draft'\)/.test(html) && />Silence<\/button>/.test(html), (html.match(/enrolments in 14 days[^<]*/g) || []).join(' | '));
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8'), bg = fs.readFileSync(path.join(ROOT, 'js/backgroundSync.js'), 'utf8'), st = fs.readFileSync(path.join(ROOT, 'js/storage.js'), 'utf8');
  check('wired: on the Data Sync page above triage, a nightly step, stored on this Mac only', /\$\{this\._courseWakeupsHtml \? this\._courseWakeupsHtml\(\) : ''\}\s*\$\{\(\(\) => \{\s*\/\/ ── New-course triage/.test(ui) && /step\('New course activity'/.test(bg) && /'surgdash_course_wakeups'\) return path\.join\('settings', 'course_wakeups\.json'\)/.test(st) && !/: 'surgdash_course_wakeups'/.test(st));
  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})();
