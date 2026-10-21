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
         { Course: 'Quiet Course', CourseId: 'qc', Provider: 'CANECSA', Learners: 50, Access: 'private', Timestamp: '2026-10-20' },
         { Course: 'Live Series Template', CourseId: 'lst', Provider: 'Unknown Provider', Learners: 0, Access: 'draft', Excluded: true, Timestamp: '2026-06-14' }] };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/forumActivity.js'), 'utf8'), ctx);
const App = ctx.App;
App._forum = { fetchedAt: '2026-10-21T08:00:00Z', totals: { posts: 1530, joined: 1500, orphan: 30, courses: 4 }, byCourse: {
  lst: { posts: 400, people: 90, first: '2026-04', last: '2026-10', months: { '2026-07': { posts: 300, people: 60 }, '2026-10': { posts: 100, people: 30 } } },
  sf: { posts: 800, people: 300, first: '2026-04', last: '2026-10', months: { '2026-04': { posts: 100, people: 50 }, '2026-07': { posts: 300, people: 120 }, '2026-08': { posts: 200, people: 90 }, '2026-10': { posts: 200, people: 80 } } },
  rm: { posts: 300, people: 250, first: '2026-05', last: '2026-09', months: { '2026-05': { posts: 50, people: 40 }, '2026-09': { posts: 250, people: 210 } } },
  qc: { posts: 0, people: 0, months: {} } } };
const o = App.forumOverview(new Date('2026-10-21T12:00:00Z'));
check('quarters: current Q4 2026, last full Q3, compared with Q2', o.curQ === '2026 Q4' && o.lastQ === '2026 Q3' && o.prevQ === '2026 Q2');
check('posts per quarter across courses', o.lastQPosts === 750 && o.prevQPosts === 150 && o.curQPosts === 200, [o.lastQPosts, o.prevQPosts, o.curQPosts].join());
check('only courses with posts are listed', o.courses.length === 2 && !o.courses.some(c => c.id === 'qc'));
check('a space beside a course nobody is enrolled in (the Live Series Template) counts as general areas, not course discussion',
  !o.courses.some(c => c.id === 'lst') && o.totals.joined === 1100 && o.totals.orphan === 430 && o.totals.posts === 1530 && o.generalIds.join() === 'lst', JSON.stringify(o.totals));
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
// ── shared spaces: a course and its template / copy ──
App.data = [
  { Course: 'Live Series Template', CourseId: 'live-series-template', Access: 'draft', Learners: 0, Excluded: true, Timestamp: '2026-06-14' },
  { Course: 'Navigating the Global Surgery Ecosystem', CourseId: 'navigating', Access: 'free', Learners: 1689, Timestamp: '2026-10-20' },
  { Course: 'Surgical Foundations', CourseId: 'sf', Access: 'free', Learners: 8711, Timestamp: '2026-10-20' },
  { Course: 'Surgical Foundations (copy)', CourseId: 'sf-draft', Access: 'draft', Learners: 0, Excluded: true, Timestamp: '2026-10-20' },
  { Course: 'Ambassadors', CourseId: 'amb', Access: 'private', Learners: 414, Excluded: true, Timestamp: '2026-10-20' },
  { Course: 'Council Portal', CourseId: 'council', Access: 'draft', Learners: 0, Excluded: true, Timestamp: '2026-10-20' },
  { Course: 'Anaesthesia in War', CourseId: 'aw', Access: 'free', Learners: 686, Timestamp: '2026-10-20' },
  { Course: 'Fundamentals of War Surgery', CourseId: 'fws', Access: 'free', Learners: 793, Timestamp: '2026-10-20' },
  { Course: 'OSSC', CourseId: 'ossc', Access: 'private', Learners: 54, Timestamp: '2026-10-20' },
  { Course: 'SELF community', CourseId: 'self', Access: 'private', Learners: 282, Excluded: true, Timestamp: '2026-10-20' }];
const sp = (id, ...courses) => ({ id, usages: courses.map(c => ({ courseId: c })) });
const SPACES = [sp('s1', 'live-series-template', 'navigating'), sp('s2', 'navigating', 'live-series-template'), sp('s3', 'sf-draft', 'sf'),
  sp('s4', 'council', 'amb'), sp('s5', 'aw', 'fws'), sp('s6', 'self', 'ossc'), sp('s7', 'aw')];
const post = (space, uid) => ({ posted_in: { id: space }, created: 1790000000, user: { id: uid } });
const POSTS = [post('s1', 'a'), post('s1', 'b'), post('s2', 'c'), post('s3', 'd'), post('s4', 'e'), post('s5', 'f'), post('s6', 'g'), post('s7', 'h')];
const idx = App.buildForumIndex(SPACES, POSTS, '2026-10-21T00:00:00Z', (ids) => App._forumPickCourse(ids));
const bc = idx.byCourse;
check('a space shared with a draft template goes to the live course, whichever is listed first', bc.navigating && bc.navigating.posts === 3 && !bc['live-series-template'], JSON.stringify(Object.keys(bc)));
check('…and to the course rather than its draft copy', bc.sf && bc.sf.posts === 1 && !bc['sf-draft']);
check('between two excluded courses, the private one with learners beats the draft', bc.amb && bc.amb.posts === 1 && !bc.council);
check('a space shared by live courses goes to the one with most learners, counted once', bc.fws && bc.fws.posts === 1 && bc.aw && bc.aw.posts === 1 && idx.totals.joined === 8);
check('an included course beats an excluded one with more learners', bc.ossc && bc.ossc.posts === 1 && !bc.self);
check('shared spaces are counted', idx.totals.sharedSpaces === 6);
const old = App.buildForumIndex(SPACES, POSTS, '2026-10-21T00:00:00Z');
check('without a picker, the first link as before', old.byCourse['live-series-template'].posts === 2 && old.byCourse.navigating.posts === 1);
const fa = fs.readFileSync(path.join(ROOT, 'js/forumActivity.js'), 'utf8');
check('the sync attributes shared spaces with the picker', /this\.buildForumIndex\(spaces, posts, null, \(ids\) => this\._forumPickCourse\(ids\)\)/.test(fa));

const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8'), ch = fs.readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8');
check('wired into the dashboard: pill, content and draw hook', /\['forum', 'Forum', 'messages-square'/.test(ui) && /if \(dt === 'forum' && this\._dashForumHtml\) return this\._dashForumHtml\(\);/.test(ui) && /if \(dt === 'forum' && this\._drawForumCharts\) this\._drawForumCharts\(\);/.test(ui));
check('the chart draws posts alone when there are no people figures', /const withPeople = series\.some\(p => p\.people != null\)/.test(ch));
console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
