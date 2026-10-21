// courses.json (js/coursesFeed.js): public, included courses only; public slugs; learners,
// recent enrolments, survey ratings (EN/FR/ES), tags in order; never an empty or shrunken file.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };
const store = new Map(), reqs = [];
const NOW = new Date(Date.UTC(2026, 9, 21, 9, 0, 0));
const day = (n) => new Date(NOW.getTime() - n * 86400000).toISOString().slice(0, 10);
const enr = (course, n, ago) => Array.from({ length: n }, (_, i) => ({ uid: course + ago + i, course, enrolled_date: day(ago) }));
const qs = (list) => JSON.stringify(list.map(([q, avg, n]) => ({ q, avg, n })));
const EN = (s, o, r, p, n) => qs([['On a scale from 1 to 5, how would you rate your overall satisfaction with this course?', s, n], ['On a scale from 1 to 5, how well did the course help you achieve the learning objectives stated on the course description?', o, n], ['On a scale from 1 to 5, how relevant and engaging was the course content?', r, n], ['On a scale from 1 to 5, how user-friendly and reliable was the course platform?', p, n - 2]]);
const ES = qs([['En una escala del 1 al 5 ¿cuál describe mejor su satisfacción general con el curso?', 4.8, 30], ['En una escala del 1 al 5 ¿cuál describe mejor la pertinencia de los contenidos para alcanzar los objetivos enunciados?', 4.6, 30], ['En una escala del 1 al 5 ¿cuál describe mejor la interactividad de los contenidos?', 4.4, 30], ['En una escala del 1 al 5, ¿Cómo evaluaría su satisfacción respecto a la ergonomía y la accesibilidadde la plataforma?', 4.2, 28]]);
const ctx = { console: { log() {}, warn() {}, error() {} }, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, isNaN, encodeURIComponent, decodeURIComponent, setTimeout: (f) => f(), __swallowed() {},
  Date: class extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW.getTime(); } },
  Storage: { async getItem(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; }, async setItem(k, v) { store.set(k, JSON.parse(JSON.stringify(v))); } },
  electronAPI: { invoke: async (ch, req) => { reqs.push(req.url); const id = req.url.split('/course/')[1]; const slug = id === 'carb-go-1' ? 'heat-stable-carbetocin' : id; return { statusCode: 200, body: '<html><head><link rel="canonical" href="https://www.surghub.org/course/' + slug + '"/></head></html>' }; } },
  LearnWorlds: { readLatestArtifactRows: () => [{ body: JSON.stringify({ data: [{ id: 'wfsa-a', title: 'WFSA A', label: 'CME/CPD activity ; ATOTW', final_price: 0, created: 1700000000 }, { id: 'paid', title: 'Paid', label: '', final_price: 0.1, created: 1700000000 }] }) }] } };
ctx.window = ctx;
const C = (o) => Object.assign({ IsShell: false, Timestamp: '2026-10-20', Access: 'free', Learners: 100, Certificates: 10, CourseCreated: '2026-01-05', Provider: 'GSF - Global Surgery Foundation' }, o);
ctx.App = { escapeHtml: (t) => String(t), escapeJsArg: (t) => String(t),
  data: [C({ Course: 'Carbetocin', CourseId: 'carb-go-1', Learners: 426, Certificates: 149, QuestionStats: EN(4.72, 4.69, 4.72, 4.69, 161) }),
    C({ Course: 'WFSA A', CourseId: 'wfsa-a', Provider: 'WFSA - World Federation of Societies of Anaesthesiologists', Learners: 900, QuestionStats: EN(4.5, 4.5, 4.5, 4.5, 40) }),
    C({ Course: 'Spanish', CourseId: 'es', Provider: 'ICRC- International Committee of the Red Cross', QuestionStats: ES }),
    C({ Course: 'Paid', CourseId: 'paid', Learners: 5 }),
    C({ Course: 'No Survey', CourseId: 'nosurvey', Learners: 3, CourseCreated: '2026-09-30' }),
    C({ Course: 'Private One', CourseId: 'priv', Access: 'private', Learners: 999 }),
    C({ Course: 'Draft One', CourseId: 'draft', Access: 'draft' }),
    C({ Course: 'Excluded Copy', CourseId: 'exc', Excluded: true }),
    C({ Course: 'template course (testing)', CourseId: 'tpl', Learners: 750 }),
    ...Array.from({ length: 10 }, (_, i) => C({ Course: 'Filler ' + i, CourseId: 'f' + i, Learners: 50 }))],
  _rawCompletion: [].concat(enr('Carbetocin', 26, 120), enr('Carbetocin', 30, 60), enr('WFSA A', 12, 10), enr('Spanish', 40, 30), enr('Filler 0', 2, 5)) };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/coursesFeed.js'), 'utf8'), ctx);
const App = ctx.App;
(async () => {
  const f = await App.coursesFeedFile({});
  const F = JSON.parse(f.content), by = (id) => F.courses.find(c => c.id === id);
  check('public, included courses only: no private, draft, excluded or template courses; courses with no survey stay in', F.courses.length === 15 && !['priv', 'draft', 'exc', 'tpl'].some(by) && by('nosurvey') && by('nosurvey').average_rating === undefined, F.courses.map(c => c.id).join());
  const carb = by('carb-go-1');
  check('slug: the public address from the course page (the id redirects there), lower case; url built on it', carb.slug === 'heat-stable-carbetocin' && carb.url === 'https://www.surghub.org/course/heat-stable-carbetocin' && carb.id === 'carb-go-1');
  check('learners and certificates are the course counts; learners_90d the enrolments in 90 days', carb.learners === 426 && carb.certificates === 149 && carb.learners_90d === 30 && by('wfsa-a').learners_90d === 12);
  check('ratings: mean per question, average = mean of the four (2 dp), responses = satisfaction answers', JSON.stringify(carb.ratings) === JSON.stringify({ satisfaction: 4.72, objectives: 4.69, relevance: 4.72, platform: 4.69 }) && carb.average_rating === 4.71 && carb.rating_responses === 161);
  check('…the Spanish questions too, platform included ("ergonomía")', JSON.stringify(by('es').ratings) === JSON.stringify({ satisfaction: 4.8, objectives: 4.6, relevance: 4.4, platform: 4.2 }) && by('es').average_rating === 4.5);
  check('published_on: the day of the 25th enrolment; else the creation date', carb.published_on === day(120) && by('nosurvey').published_on === '2026-09-30', carb.published_on);
  check('provider without the acronym', carb.provider === 'Global Surgery Foundation' && by('wfsa-a').provider === 'World Federation of Societies of Anaesthesiologists' && by('es').provider === 'International Committee of the Red Cross');
  check('Popular: the top 15% by enrolments in 90 days (3 of 15), never a course with none', F.popular_cutoff_90d === 12 && F.courses.filter(c => c.tags.includes('Popular')).map(c => c.id).sort().join() === 'carb-go-1,es,wfsa-a', F.courses.filter(c => c.tags.includes('Popular')).map(c => c.id).join());
  check('CME/CPD from the LearnWorlds label (also "CME/CPD activity ; ATOTW"); Free unless priced', by('wfsa-a').tags.includes('CME/CPD') && !carb.tags.includes('CME/CPD') && !by('paid').tags.includes('Free') && carb.tags.includes('Free'));
  check('New: published within 90 days; tags in order Free, Popular, CME/CPD, New', by('nosurvey').tags.join() === 'Free,New' && !carb.tags.includes('New') && by('wfsa-a').tags.join() === 'Free,Popular,CME/CPD');
  check('aggregates only: no learner ids, emails or names anywhere', !/uid|email|@/.test(f.content));
  // directory fields
  await App.setCourseCme('carb-go-1', true); await App.setCourseCme('wfsa-a', false); await App.setCoursePublishedOn('carb-go-1', day(30));
  const g = JSON.parse((await App.coursesFeedFile({ resolveSlugs: false })).content);
  const c2 = g.courses.find(c => c.id === 'carb-go-1');
  check('the directory tick box and date win over the defaults (and are stored with the SURGhub data)', c2.tags.join() === 'Free,Popular,Top rated,CME/CPD,New' && c2.published_on === day(30) && !g.courses.find(c => c.id === 'wfsa-a').tags.includes('CME/CPD') && store.get('surghub_course_meta').byId['carb-go-1'].cme === true);
  await App.setCoursePublishedOn('carb-go-1', '');
  check('clearing the date goes back to the default', JSON.parse((await App.coursesFeedFile({ resolveSlugs: false })).content).courses.find(c => c.id === 'carb-go-1').published_on === day(120));
  // ── Trending: an established course picking up ──
  {
    const keepD = App.data, keepC = App._rawCompletion;
    App.data = keepD.concat([C({ Course: 'Rising', CourseId: 'rising', CourseCreated: '2025-01-01' }), C({ Course: 'Steady Big', CourseId: 'steady', CourseCreated: '2025-01-01' }), C({ Course: 'Brand New', CourseId: 'brandnew', CourseCreated: day(40) })]);
    App._rawCompletion = keepC.concat(enr('Rising', 25, 200), enr('Rising', 60, 10), enr('Rising', 30, 60),          // 60 now vs 10 per 30 days before
      enr('Steady Big', 25, 200), enr('Steady Big', 45, 10), ...[40, 70, 100].map(a => enr('Steady Big', 45, a)).flat(),   // 45 vs 45: big, not rising
      enr('Brand New', 25, 35), enr('Brand New', 80, 5));                                                                 // rising but new (New instead)
    const T = App.coursesFeedBuild(NOW), tg = (id) => T.courses.find(c => c.id === id).tags;
    check('Trending: 40+ in 30 days and 1.5x its own average before', tg('rising').includes('Trending') && T.courses.find(c => c.id === 'rising').learners_30d === 60, tg('rising').join());
    check('…not a big course enrolling at its usual pace', !tg('steady').includes('Trending'));
    check('…not a course published in the last 90 days (it is New)', !tg('brandnew').includes('Trending') && tg('brandnew').includes('New'));
    check('…nor one under 40 in 30 days, however fast it grows', !tg('wfsa-a').includes('Trending'));
    check('tag order: Free, Popular, Trending, Top rated, CME/CPD, New', JSON.stringify(App.CF_TAGS) === JSON.stringify(['Free', 'Popular', 'Trending', 'Top rated', 'CME/CPD', 'New']) && tg('rising').indexOf('Trending') === tg('rising').indexOf('Popular') + 1);
    App.data = keepD; App._rawCompletion = keepC;
  }

  // ── Top rated: the top 10% by average rating among courses rated by 50+ learners ──
  {
    const keepD = App.data;
    const sat = (avg, n) => JSON.stringify(['overall satisfaction with this course', 'learning objectives stated', 'relevant and engaging', 'course platform'].map(q => ({ q, avg, n, na: 0 })));
    const extra = [];
    for (let i = 0; i < 20; i++) extra.push(C({ Course: 'Rated ' + i, CourseId: 'rated' + i, CourseCreated: '2025-01-01', QuestionStats: sat(4.5 + i * 0.01, 60) }));
    extra.push(C({ Course: 'Few Raters', CourseId: 'few', CourseCreated: '2025-01-01', QuestionStats: sat(5, 12) }));
    App.data = keepD.concat(extra);
    const T = App.coursesFeedBuild(NOW), tg = (id) => (T.courses.find(c => c.id === id) || { tags: [] }).tags;
    const top = T.courses.filter(c => c.tags.includes('Top rated')).map(c => c.id).sort();
    check('Top rated: the top 10% of courses rated by 50+ learners (3 of 21 with the fixture course), cut-off published', JSON.stringify(top) === JSON.stringify(['carb-go-1', 'rated18', 'rated19']) && T.top_rated_cutoff === 4.68, top.join() + ' cut ' + T.top_rated_cutoff);
    check('…never a course with under 50 ratings, however high', !tg('few').includes('Top rated'));
    App.data = keepD;
  }

  // ── an Arabic survey's questions are read (Oct 2026: it showed 0 responses) ──
  {
    const q = (t, avg, n) => ({ q: t, avg, n, na: 0 });
    const r = App._cfRatings({ QuestionStats: JSON.stringify([q('على مقياس من 1 إلى 5، ما مدى رضاك عن هذه الدورة؟', 4.38, 24), q('على مقياس من 1 إلى 5، إلى أي مدى ساعدتك هذه الدورة على تحقيق أهداف التعلّم المذكورة في وصف الدورة؟', 4.48, 25),
      q('على مقياس من 1 إلى 5، إلى أي مدى بدا لك محتوى الدورة ذا صلة وجذاباً؟', 4.52, 25), q('على مقياس من 1 إلى 5، إلى أي مدى كان استخدام المنصة سهلًا وموثوقًا؟', 4.55, 22)]) });
    check('Arabic survey: all four ratings and the satisfaction count', r.n === 24 && r.ratings.satisfaction === 4.38 && r.ratings.objectives === 4.48 && r.ratings.relevance === 4.52 && r.ratings.platform === 4.55, JSON.stringify(r));
  }

  // ── tags by hand (the course page band) ──
  App.formatNumber = (n) => String(n); App.showMsg = () => {}; App.renderView = () => {}; App.view = 'course';
  const tagsOf = async (id) => JSON.parse((await App.coursesFeedFile({ resolveSlugs: false })).content).courses.find(c => c.id === id).tags.join();
  check('before: WFSA A is Free, Popular (and CME/CPD off by the tick box above)', (await tagsOf('wfsa-a')) === 'Free,Popular');
  await App.cycleCourseTag('wfsa-a', 'Popular');
  check('a tag clicked once is forced on (already on: no change in the feed)', (await tagsOf('wfsa-a')) === 'Free,Popular' && store.get('surghub_course_meta').byId['wfsa-a'].tags.Popular === true);
  await App.cycleCourseTag('wfsa-a', 'Popular');
  check('twice: forced off, whatever the rule says', (await tagsOf('wfsa-a')) === 'Free' && store.get('surghub_course_meta').byId['wfsa-a'].tags.Popular === false);
  await App.cycleCourseTag('wfsa-a', 'Popular');
  check('three times: back to automatic', (await tagsOf('wfsa-a')) === 'Free,Popular' && store.get('surghub_course_meta').byId['wfsa-a'].tags.Popular === undefined);
  await App.cycleCourseTag('wfsa-a', 'CME/CPD');   // the tick box had it off (false): next is automatic (the label says on)
  check('CME/CPD shares the directory tick box: false → automatic (label: on)', (await tagsOf('wfsa-a')) === 'Free,Popular,CME/CPD' && store.get('surghub_course_meta').byId['wfsa-a'].cme === undefined);
  await App.addCourseTag('wfsa-a', '  Featured  '); await App.addCourseTag('wfsa-a', 'featured'); await App.addCourseTag('wfsa-a', 'new');
  check('custom tags come after the four, once each; a standard name is not added as custom', (await tagsOf('wfsa-a')) === 'Free,Popular,CME/CPD,featured', await tagsOf('wfsa-a'));
  await App.removeCourseTag('wfsa-a', 'featured');
  check('…and can be removed', (await tagsOf('wfsa-a')) === 'Free,Popular,CME/CPD');
  // the band on the course page
  App._cfState = App._cfState || {};
  const rec = (id) => App.data.find(d => d.CourseId === id);
  let band = App._cfCourseBandHtml(rec('wfsa-a'));
  check('the band: public address, published date, the six chips (with state), custom-tag box, 90-day rank and rating', /On surghub\.org/.test(band) && /\/course\/wfsa-a/.test(band) && /type="date"[^>]*value="/.test(band) && (band.match(/App\.cycleCourseTag\('wfsa-a'/g) || []).length === 6 && /in 30 days vs \d+ before/.test(band) && /placeholder="\+ tag"/.test(band) && /enrolments in 90 days \(#\d+ of 15\)/.test(band) && /rating 4\.50 from 40/.test(band));
  check('…says the change is not online yet, with a Publish button', /not online yet/.test(band) && /App\.publishWebsiteMetrics\(this\)/.test(band));
  check('a course that is not listed says why', /not in the course feed, because it is private/.test(App._cfCourseBandHtml(rec('priv'))) && /because it is excluded from analytics/.test(App._cfCourseBandHtml(rec('exc'))) && /marks it as a template/.test(App._cfCourseBandHtml(rec('tpl'))));
  const ui2 = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
  check('shown on every course page, under the header', /\$\{this\._cfCourseBandHtml \? this\._cfCourseBandHtml\(cSnap\) : ''\}/.test(ui2));

  // safety
  await App._cfMarkPublished(await App.coursesFeedFile({ resolveSlugs: false }));
  check('once published, the band says it is online as shown', /online as shown/.test(App._cfCourseBandHtml(App.data.find(d => d.CourseId === 'wfsa-a'))));
  const keep = App.data; App.data = App.data.slice(0, 5);
  const s1 = await App.coursesFeedFile({ resolveSlugs: false });
  check('a file with under 80% of the last count is not published: the previous one is kept', !s1.fresh && /only 5 courses against 15/.test(s1.why) && JSON.parse(s1.content).courses.length === 15);
  App.data = keep;
  const s2 = await App.coursesFeedFile({ resolveSlugs: false, syncOk: false });
  check('after a sync with LearnWorlds errors, the previous file is kept', !s2.fresh && /LearnWorlds errors/.test(s2.why) && JSON.parse(s2.content).courses.length === 15);
  App.data = []; store.delete('surgdash_courses_feed'); App._cfState = null;
  const s3 = await App.coursesFeedFile({ resolveSlugs: false });
  check('never an empty file', !s3.fresh && s3.why === 'no courses' && s3.content === null);
  App.data = keep;
  check('slugs are read once and cached (no second request for a known page)', (() => { const n = reqs.length; return App._cfResolveSlugs(['carb-go-1']).then(() => reqs.length === n); })());
  const pd = fs.readFileSync(path.join(ROOT, 'js/partnerDash.js'), 'utf8'), wm = fs.readFileSync(path.join(ROOT, 'js/websiteMetrics.js'), 'utf8'), st = fs.readFileSync(path.join(ROOT, 'js/storage.js'), 'utf8'), ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
  check('published with the nightly site and with "Publish figures now" (one commit with metrics.json)', /files\.push\(\{ path: 'courses\.json', content: cf\.content \}\)/.test(pd) && /entries\.push\(\{ path: 'courses\.json'/.test(wm));
  check('directory fields travel with the SURGhub data; the slug cache and state stay on this Mac', /'surghub_course_meta':\s*path\.join\('surghub', 'course_meta\.json'\)/.test(st) && /'course_meta': 'surghub_course_meta'/.test(st) && /'surgdash_course_slugs'\) return path\.join\('settings'/.test(st));
  check('the directory shows the CME/CPD and Published columns', />CME\/CPD<\/th>/.test(ui) && />Published<\/th>/.test(ui) && /this\._cfDirCells\(s\._rec\)/.test(ui));
  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})();
