// The Forum tab (forumActivity.js forumOverview / _dashForumHtml): platform totals, quarters,
// per-course table, posts-only series (people are per course and never summed).
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };
const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, isNaN, __swallowed() {} };
ctx.window = ctx;
ctx.App = { view: 'platform', formatNumber: (n) => Number(n).toLocaleString('en-GB'), escapeHtml: (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), escapeJsArg: (t) => String(t).replace(/'/g, "\\'"),
  providerFolderName: (p) => String(p).split(' - ')[0], _courseStatusBadge: () => '',
  data: [{ Course: 'Surgical Foundations', CourseId: 'sf', Provider: 'COSECSA - College', Learners: 1000, Access: 'free', Timestamp: '2026-10-20' },
         { Course: 'Research Methods', CourseId: 'rm', Provider: 'CANECSA', Learners: 200, Access: 'free', Timestamp: '2026-10-20' },
         { Course: 'Quiet Course', CourseId: 'qc', Provider: 'CANECSA', Learners: 50, Access: 'private', Timestamp: '2026-10-20' }] };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/forumActivity.js'), 'utf8'), ctx);
const App = ctx.App;
App._forum = { fetchedAt: '2026-10-21T08:00:00Z', totals: { posts: 1130, joined: 1100, orphan: 30, courses: 3 }, byCourse: {
  sf: { posts: 800, people: 300, first: '2026-04', last: '2026-10', months: { '2026-04': { posts: 100, people: 50 }, '2026-07': { posts: 300, people: 120 }, '2026-08': { posts: 200, people: 90 }, '2026-10': { posts: 200, people: 80 } } },
  rm: { posts: 300, people: 250, first: '2026-05', last: '2026-09', months: { '2026-05': { posts: 50, people: 40 }, '2026-09': { posts: 250, people: 210 } } },
  qc: { posts: 0, people: 0, months: {} } } };
const o = App.forumOverview(new Date('2026-10-21T12:00:00Z'));
check('quarters: current Q4 2026, last full Q3, compared with Q2', o.curQ === '2026 Q4' && o.lastQ === '2026 Q3' && o.prevQ === '2026 Q2');
check('posts per quarter across courses', o.lastQPosts === 750 && o.prevQPosts === 150 && o.curQPosts === 200, [o.lastQPosts, o.prevQPosts, o.curQPosts].join());
check('only courses with posts are listed', o.courses.length === 2 && !o.courses.some(c => c.id === 'qc'));
const sf = o.courses.find(c => c.id === 'sf');
check('per course: name, provider, Q3 posts and posts per 100 enrolled', sf.name === 'Surgical Foundations' && sf.lastQ === 500 && sf.per100 === 80 && sf.people === 300);
check('the monthly series runs without gaps, posts only (people are per course, never summed)', o.series.length === 7 && o.series[0].month === '2026-04' && o.series[2].posts === 0 && o.series.every(p => p.people === null), o.series.map(p => p.month + ':' + p.posts).join(' '));
check('busiest month', o.busiest.month === '2026-07' && o.busiest.posts === 300);
check('providers: posts and courses with posts', o.providers[0].provider === 'COSECSA - College' && o.providers[0].posts === 800 && o.providers[1].courses === 1);
const html = App._dashForumHtml();
check('the tab: headline cards, the chart, the course table linking to each course', /Posts 2026 Q3/.test(html) && />750</.test(html) && /\+400% on 2026 Q2/.test(html) && /id="chart_forum_platform"/.test(html) && /App\.openCourse\('Surgical Foundations'\)/.test(html) && /Replies under a post are not counted/.test(html));
App.rerenderDashTab = () => {}; App.setForumSort('per100');
check('sorting by posts per 100 enrolled puts Research Methods (150) first', App._dashForumHtml().indexOf('Research Methods') < App._dashForumHtml().indexOf('Surgical Foundations'));
App._forum = null;
check('without data, a clear note and the refresh button', /No forum data yet/.test(App._dashForumHtml()) && /syncForumActivityWithProgress/.test(App._dashForumHtml()));
const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8'), ch = fs.readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8');
check('wired into the dashboard: pill, content and draw hook', /\['forum', 'Forum', 'messages-square'/.test(ui) && /if \(dt === 'forum' && this\._dashForumHtml\) return this\._dashForumHtml\(\);/.test(ui) && /if \(dt === 'forum' && this\._drawForumCharts\) this\._drawForumCharts\(\);/.test(ui));
check('the chart draws posts alone when there are no people figures', /const withPeople = series\.some\(p => p\.people != null\)/.test(ch));
console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
