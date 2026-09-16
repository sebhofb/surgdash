// Forum activity: js/forumActivity.js in a VM. The counting is a pure function, so the
// join, the monthly buckets and the distinct-people counts are all checkable here.
const vm = require('vm'), fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };

// Two course forums and one general space that belongs to no course.
const spaces = [
  { id: 's1', title: 'Reflection Forum - Burns', usages: [{ type: 'ebook', unitId: 'u1', courseId: 'burns-101' }] },
  { id: 's2', title: 'Introduce Yourself - Burns', usages: [{ type: 'ebook', unitId: 'u2', courseId: 'burns-101' }] },
  { id: 's3', title: 'Reflection Forum - Suturing', usages: [{ courseId: 'suturing' }] },
  { id: 's4', title: 'General chat', usages: [] },
  { id: 's5', title: 'Odd one', usages: [{ type: 'page' }] },   // a usage with no course
];
const at = (iso) => Math.floor(Date.parse(iso + 'T12:00:00Z') / 1000);
const post = (space, who, when) => ({ id: 'p' + Math.random(), posted_in: { type: 'space', id: space }, user: { id: who, username: who }, text: '<p>hi</p>', created: at(when) });
const posts = [
  post('s1', 'a', '2025-01-05'), post('s1', 'b', '2025-01-20'), post('s1', 'a', '2025-01-28'),  // Jan: 3 posts, 2 people
  post('s2', 'c', '2025-01-09'),                                                                 // same course, other space
  post('s1', 'a', '2025-03-02'),                                                                 // Feb empty, Mar: 1 post
  post('s3', 'a', '2025-02-11'), post('s3', 'd', '2025-02-12'),                                  // a different course
  post('s4', 'e', '2025-02-13'),                                                                 // no course
  post('s5', 'f', '2025-02-14'),                                                                 // no course
  { id: 'broken', posted_in: { id: 's1' }, user: { id: 'z' }, created: 0 },                       // no usable date
];

function mk() {
  const store = new Map();
  const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, Intl, isNaN, isFinite, parseInt, parseFloat, setTimeout,
    __swallowed() {}, alert(m) { ctx.App.alerts.push(m); }, confirm() { return true; },
    document: { getElementById: () => null },
    Storage: { async getItem(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; },
               async setItem(k, v) { store.set(k, JSON.parse(JSON.stringify(v))); } } };
  ctx.window = ctx;
  ctx.App = { alerts: [], msgs: [], view: 'course', selectedCourse: 'Burns 101',
    data: [{ Course: 'Burns 101', CourseId: 'burns-101', Timestamp: '2026-09-01' },
           { Course: 'Burns 101', CourseId: 'burns-old', Timestamp: '2020-01-01' },
           { Course: 'Suturing', CourseId: 'suturing', Timestamp: '2026-09-01' },
           { Course: 'No Forum', CourseId: 'no-forum', Timestamp: '2026-09-01' }],
    formatNumber: (v) => new Intl.NumberFormat('en-US').format(v || 0),
    showMsg(m) { this.msgs.push(m); }, renderView() {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ROOT + '/js/forumActivity.js', 'utf8'), ctx, { filename: 'forumActivity.js' });
  ctx.App.__store = store;
  return ctx.App;
}

const A = mk();
const idx = A.buildForumIndex(spaces, posts);

// ── the join ──
check('a post reaches its course through its space, with no guessing from titles',
  idx.byCourse['burns-101'] && idx.byCourse['suturing'] && !idx.byCourse['general'],
  Object.keys(idx.byCourse).join(', '));
check('two spaces on the same course are one course, not two',
  idx.byCourse['burns-101'].posts === 5, idx.byCourse['burns-101'].posts);
check('a space with no course is counted as an orphan, not dropped silently',
  idx.totals.orphan === 3 && idx.totals.joined === 7, JSON.stringify(idx.totals));   // 5 on burns + 2 on suturing
check('a space whose usage carries no course id is not treated as one',
  idx.totals.spacesWithCourse === 3, idx.totals.spacesWithCourse);
check('a post with no usable date cannot land in a month', idx.byCourse['burns-101'].posts === 5);

// ── the months ──
check('posts land in the month they were written',
  idx.byCourse['burns-101'].months['2025-01'].posts === 4 && idx.byCourse['burns-101'].months['2025-03'].posts === 1,
  JSON.stringify(idx.byCourse['burns-101'].months));
check('the first and last month of the conversation are recorded',
  idx.byCourse['burns-101'].first === '2025-01' && idx.byCourse['burns-101'].last === '2025-03');

// ── distinct people ──
check('a person posting three times in a month counts once',
  idx.byCourse['burns-101'].months['2025-01'].people === 3, idx.byCourse['burns-101'].months['2025-01'].people);
check('a person posting in two months counts once for the course, not twice',
  idx.byCourse['burns-101'].people === 3, idx.byCourse['burns-101'].people);
check('the course total is not the sum of its months',
  idx.byCourse['burns-101'].people < Object.values(idx.byCourse['burns-101'].months).reduce((s, m) => s + m.people, 0));
check('a person in two different courses counts in each',
  idx.byCourse['suturing'].people === 2 && idx.byCourse['burns-101'].people === 3);

// ── what is stored ──
check('no user id, username or post text is kept anywhere in the index',
  !/"user"|"username"|"text"|"\\ba\\b":/.test(JSON.stringify(idx)) && !/<p>/.test(JSON.stringify(idx)),
  JSON.stringify(idx.byCourse['suturing']));
check('the index carries its own provenance', /^\d{4}-\d{2}-\d{2}T/.test(idx.fetchedAt) && idx.v === 1);

// ── the series ──
const series = A.forumSeries(idx.byCourse['burns-101']);
check('the series runs month by month, including the quiet ones',
  series.length === 3 && series.map(p => p.month).join() === '2025-01,2025-02,2025-03', JSON.stringify(series.map(p => p.month)));
check('a quiet month is a zero, not a gap in the line',
  series[1].posts === 0 && series[1].people === 0);
check('each point carries both the posts and the people who wrote them',
  series[0].posts === 4 && series[0].people === 3);
check('no activity, no series', A.forumSeries(null).length === 0 && A.forumSeries({ months: {} }).length === 0);
check('a single month is a single point', A.forumSeries({ months: { '2025-05': { posts: 2, people: 1 } } }).length === 1);

// ── looking a course up ──
A._forum = idx;
check('a course is found through its newest course id', A.forumActivity('Burns 101').posts === 5);
check('a course with no forum returns nothing, rather than an empty-looking one',
  A.forumActivity('No Forum') === null && A.forumActivity('Nothing At All') === null);
check('with nothing read yet, every course returns nothing',
  (() => { const B = mk(); B._forum = null; return B.forumActivity('Burns 101') === null; })());

// ── the panel ──
check('the panel names what it shows and what it cannot show',
  (() => { const h = A._forumPanelHtml('Burns 101');
    return /Forum Activity/.test(h) && /5 posts from 3 learners/.test(h) && /Replies to a post are not counted/.test(h)
      && /chart_forum_activity/.test(h); })(),
  (A._forumPanelHtml('Burns 101').match(/>\s*(\d+ posts[^<]*)/) || [''])[1]);
check('a course with no forum says so plainly instead of drawing an empty chart',
  (() => { const h = A._forumPanelHtml('No Forum'); return /No posts in this course/.test(h) && !/chart_forum_activity/.test(h); })());
check('before anything is read, the panel points at the sync that fills it',
  (() => { const B = mk(); B._forum = null; const h = B._forumPanelHtml('Burns 101');
    return /No forum data yet/.test(h) && /Forum activity/.test(h); })());
check('the month is written out for a reader', A._forumMonthName('2025-03') === 'March 2025' && A._forumMonthName('') === '');

// ── dates ──
check('a unix timestamp becomes a UTC month', A._forumMonth(at('2025-07-15')) === '2025-07');
check('a missing or nonsense timestamp yields no month',
  A._forumMonth(0) === '' && A._forumMonth(null) === '' && A._forumMonth('x') === '');

// ── wiring ──
const charts = fs.readFileSync(ROOT + '/js/charts.js', 'utf8');
const ui = fs.readFileSync(ROOT + '/js/ui.js', 'utf8');
const mod = fs.readFileSync(ROOT + '/js/forumActivity.js', 'utf8');
check('the chart draws both series, posts as bars and people as a line',
  /drawForumActivity: function/.test(charts) && /addColumn\('number', 'Posts'\)/.test(charts)
    && /addColumn\('number', 'Learners posting'\)/.test(charts) && /type: 'line'/.test(charts));
check('it is drawn whenever a course page is drawn', /drawForumActivity\('chart_forum_activity', App\.forumSeries/.test(charts));
check('the panel sits on the course page', /_forumPanelHtml \? this\._forumPanelHtml\(this\.selectedCourse\)/.test(ui));
check('Data Sync offers the read, with its cost stated up front',
  /7 · Forum activity/.test(ui) && /syncForumActivityWithProgress/.test(ui) && /three to four minutes/.test(mod));
check('the store travels with the SURGhub data, both directions',
  (() => { const st = fs.readFileSync(ROOT + '/js/storage.js', 'utf8');
    return /'surghub_forum':\s*path\.join\('surghub', 'forum\.json'\)/.test(st) && /'forum': 'surghub_forum'/.test(st); })());
check('the module is loaded by the app', /<script src="js\/forumActivity\.js"><\/script>/.test(fs.readFileSync(ROOT + '/index.html', 'utf8')));
check('paging asks for the largest page the API allows, and paces itself',
  /items_per_page: this\.FORUM_PAGE/.test(mod) && A.FORUM_PAGE === 100 && A.FORUM_GAP_MS >= 1000
    && /await new Promise\(res => setTimeout\(res, this\.FORUM_GAP_MS\)\)/.test(mod));
check('a runaway pager is stopped', /page <= this\.FORUM_MAX_PAGES/.test(mod));

console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
