// Learner stories (js/learnerStories.js): the blog stories written in on first use, tied to courses,
// a story deleted stays deleted, saving and editing, what a blog link fills in, and the stories on a
// provider's partner dashboard (only those about its courses, names kept, links safe).
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 300) : '')); };
const store = new Map(), confirms = []; let answer = true, page = '';
const ctx = { console: { log() {}, warn() {}, error() {} }, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, Intl, Date, isNaN, __swallowed() {},
  setTimeout, confirm: (m) => { confirms.push(m); return answer; }, alert() {},
  document: { createElement: () => { const o = { set innerHTML(v) { o.value = v.replace(/&amp;/g, '&').replace(/&#39;/g, "'"); } }; return o; } },
  Storage: { async getItem(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; }, async setItem(k, v) { store.set(k, JSON.parse(JSON.stringify(v))); } },
  electronAPI: { appPath: ROOT, path, fs: { existsSync: () => false, readFileBase64: () => '', readdirSync: () => [] }, invoke: async (ch, req) => (ch === 'http-request' ? { body: page } : null) },
  SURGGlobeData: { LAND: '[]', CENT: '{}' }, countryToISO: () => '' };
ctx.window = ctx;
const SNAP = [
  { CourseId: 'acute-burn-care', Course: 'Acute Burn Care', Provider: 'ReSurge International', Learners: 900, Certificates: 300 },
  { CourseId: 'burn-reconstruction', Course: 'Burn Reconstruction', Provider: 'ReSurge International', Learners: 500, Certificates: 100 },
  { CourseId: 'essential-burn-care', Course: 'Essential Burn Care (EBC)', Provider: 'Interburns', Learners: 700, Certificates: 200 },
  { CourseId: 'anaesthesia-in-war', Course: 'Anaesthesia in War', Provider: 'ICRC- International Committee of the Red Cross', Learners: 800, Certificates: 90 },
];
ctx.App = { msgs: [], escapeHtml: (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  formatNumber: (n) => Number(n).toLocaleString('en-GB'), showMsg(m) { this.msgs.push(m); }, getAnalyticsSnap: () => SNAP, reportDataThrough: '2026-10',
  _tmHash: (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); },
  scrubPersonal: (t) => String(t).replace(/Sourov|Das/g, '[name]'),
  async _assembleReportData(p) { const rows = SNAP.filter(r => r.Provider === p); return { reportDate: 'Nov 3, 2026', totalLrn: 1400, totalCert: 400, certRate: '28.6', avgRating: '4.70', totalResp: 10, totalMin: 0, provTimeline: {}, providerCountryData: {}, surveyImpact: {}, surveyQRows: [], fbSummaries: {}, testimonials: [], providerAwards: [], providerCountryAwards: [], coursesSorted: rows, courseTimelines: {}, courseCountryData: {}, courseRatings: {}, courseAwardMap: {} }; } };
vm.createContext(ctx);
for (const f of ['js/learnerStories.js', 'js/partnerReport.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const App = ctx.App;

(async () => {
  await App._lsLoad();
  const st = store.get('surghub_learner_stories');
  const all = Object.values(st.stories);
  check('first use writes in the nine learner stories from the blog, shown, with an internal note on where they came from', all.length === 9 && all.every(s => s.show && /surghub\.org\/blog/.test(s.url) && s.courses.length && /3 Nov 2026/.test(s.note)));
  check('each is tied to the courses its article links or names (Dr Sourov Das: Acute Burn Care and Essential Burn Care)', JSON.stringify(all.find(s => /Sourov/.test(s.name)).courses) === '["acute-burn-care","essential-burn-care"]');
  check('the committee-member story is not a learner story', !all.some(s => /Andrea Parker/.test(s.name)));
  check('no em or en dashes in the written-in text', !/[–—]/.test(JSON.stringify(all.map(s => [s.title, s.summary, s.role]))));

  const burns = App.lsList(['acute-burn-care']);
  check('stories are found by course', burns.length === 1 && /Sourov/.test(burns[0].name));
  const sid = burns[0].id;
  answer = true; await App.lsDeleteStory(sid); App._ls = null; await App._lsLoad();
  check('a story deleted stays deleted: the blog stories are written in only once', Object.keys(store.get('surghub_learner_stories').stories).length === 8 && !App.lsList(['acute-burn-care']).length);

  const nid = await App.lsSaveStory({ url: 'https://www.surghub.org/blog/x', title: '  A new story ', name: 'Dr A', role: 'Nurse', country: 'Kenya', summary: 'S', quote: '"Learning helped."', courses: ['burn-reconstruction', 'burn-reconstruction', ''], show: true, note: 'Consent on file' });
  const ns = store.get('surghub_learner_stories').stories[nid];
  check('a story is saved tidy: title trimmed, quote marks dropped, each course once', ns.title === 'A new story' && ns.quote === 'Learning helped.' && JSON.stringify(ns.courses) === '["burn-reconstruction"]' && ns.added);
  check('a story without a course is not saved', (await App.lsSaveStory({ title: 'No course', courses: [] })) === null);
  await App.lsSaveStory(Object.assign({}, ns, { title: 'Renamed' }), nid);
  check('editing keeps the id and the date it was added', store.get('surghub_learner_stories').stories[nid].title === 'Renamed' && store.get('surghub_learner_stories').stories[nid].edited);

  page = '<html><head><meta property="og:title" content="Burns care in Ghana | SURGhub"><meta property="og:description" content="A nurse on what the Acute Burn Care course changed &amp; why."><meta property="og:image" content="https://lwfiles.mycourse.app/x.png"></head></html>';
  const r = await App.lsReadLink('https://www.surghub.org/blog/burns-ghana');
  check('a blog link fills in the title (without "| SURGhub"), summary and photo', r.title === 'Burns care in Ghana' && r.summary === 'A nurse on what the Acute Burn Care course changed & why.' && r.image === 'https://lwfiles.mycourse.app/x.png', JSON.stringify(r));
  check('courses named in the title or summary are suggested', JSON.stringify(r.courses) === '["acute-burn-care"]', JSON.stringify(r.courses));
  check('a link that is not a web address is not fetched', (await App.lsReadLink('javascript:alert(1)')) === null);

  // ── on the partner dashboard ──
  await App.lsSaveStory({ url: 'https://www.surghub.org/blog/das', title: 'Approaching cases with confidence', name: 'Dr Sourov Das', role: 'Surgical trainee', country: 'Bangladesh', summary: 'Burns.', courses: ['acute-burn-care', 'essential-burn-care'], show: true });
  await App.lsSaveStory({ url: 'javascript:alert(1)', image: 'http://insecure/x.png', title: 'Hidden one', courses: ['acute-burn-care'], show: false });
  const html = await App._buildPartnerReportHtml('ReSurge International');
  const D = JSON.parse(html.match(/<script>var DATA=([\s\S]*?);\n/)[1]);
  const titles = D.stories.map(s => s.t);
  check('a provider\'s dashboard carries the stories about its courses, and only those', titles.includes('Approaching cases with confidence') && titles.includes('Reconstructive surgery in Egypt') && titles.includes('Renamed') && !titles.some(t => /DRC/.test(t)), JSON.stringify(titles));
  check('hidden stories stay off the dashboard', !titles.includes('Hidden one'));
  const das = D.stories.find(s => /Sourov/.test(s.n));
  check('the learner\'s public name is kept (not scrubbed) and the story names only this provider\'s courses', das.n === 'Dr Sourov Das' && das.c.length === 1 && D.courses[das.c[0]].name === 'Acute Burn Care');
  check('each course knows its stories, for its own page', (D.courses.find(c => c.name === 'Acute Burn Care').stories || []).includes(das.id));
  check('the page draws them as cards that open the story', html.includes('function storyCards(') && html.includes('Read the story') && html.includes('rel="noopener noreferrer"'));
  console.log('\n' + ok + '/' + (ok + bad) + ' passed');
  process.exit(bad ? 1 : 0);
})();
