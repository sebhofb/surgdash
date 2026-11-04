// The partner dashboard in the GSF design (js/partnerReport.js): what the page carries. Its script is
// tested in a browser by hand; here: the data it embeds, the sections, and nothing personal or unsafe.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };

const ctx = { console: { log() {}, warn() {}, error() {} }, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, Intl, Date, isNaN, __swallowed() {},
  electronAPI: { appPath: ROOT, path, fs: { existsSync: () => false, readFileBase64: () => '', readdirSync: () => [] } },
  SURGGlobeData: { LAND: '[10,10,12,10]', CENT: JSON.stringify({ NG: [8, 9.5], KE: [37.9, 0.5] }) },
  countryToISO: (c) => ({ Nigeria: 'NG', Kenya: 'KE' }[c] || '') };
ctx.window = ctx;
const HARD = 'Evil </script><img src=x onerror=alert(1)> course';
ctx.App = {
  reportDataThrough: '2026-10',
  escapeHtml: (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  formatNumber: (n) => Number(n).toLocaleString('en-GB'), formatLearningTime: (m) => (m / 525960).toFixed(1) + ' yrs',
  scrubPersonal: (t) => String(t).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]'),
  _emailDemoMap: { 'a@x.org': { profession: 'nurse', country: 'Kenya' }, 'b@y.org': { country: 'Nigeria' } },
  _rawCompletion: [
    { email: 'a@x.org', name: 'Ann Example', course: 'Burns', start_date: '2026-09-03', certificate: true, certificate_date: '2026-10-01' },
    { email: 'b@y.org', name: 'Bo Example', course: 'Burns', enrolled_date: '2026-10-20T08:00:00Z', start_date: '2026-10-21' },
    { email: 'c@z.org', course: 'Other provider course', start_date: '2026-10-05' },
    { email: 'd@z.org', course: 'Burns', start_date: '2099-01-01' },
  ],
  _cfMeta: { byId: { burns: { tags: { Featured: true }, featured: [{ from: '2026-10-22' }] } } },
  coursesFeedBuild: () => ({ courses: [{ id: 'burns', tags: ['Featured', 'Free', 'Popular', 'Trending'] }] }),
  computeAwards: () => ({ categories: [{ key: 'courses', providerOnly: true }, { key: 'enrol' }, { key: 'rating' }] }),
  _currentQuarterLabel: () => 'Q4 2026',
  _surveyQTitle: (q) => /satisfaction/i.test(q) ? 'Overall satisfaction' : '',
  async _assembleReportData() {
    return {
      reportDate: 'Nov 3, 2026', totalLrn: 1200, totalCert: 300, certRate: '25.0', avgRating: '4.70', totalResp: 400, totalMin: 525960,
      provTimeline: { '2026-08': { e: 100, c: 10 }, '2026-10': { e: 50, c: 5 }, '2026-11': { e: 999, c: 99 } },
      providerCountryData: { Nigeria: 500, Kenya: 300, Atlantis: 2, Unknown: 9 },
      surveyImpact: { contentNew: { pct: 80, n: 300 }, willApply: { pct: 94, n: 290 } },
      surveyQRows: [{ q: 'How would you rate your overall satisfaction?', title: 'Overall satisfaction', avg: 4.7, n: 380, hiPct: 96.4 }],
      fbSummaries: { '@provider:GSF - Global Surgery Foundation': { s: 'Learners value it.' } },
      testimonials: [{ t: 'This changed how I manage burns, write to me at me@mail.com for more', r: 5, e: 'a@x.org', _course: 'Burns' }, { t: 'Too short', e: '' }],
      providerAwards: [{ key: 'rating', label: 'Highest Rated', rank: 1, total: 29, valueFmt: '4.72 / 5' }],
      providerCountryAwards: [{ country: 'Nigeria', rank: 1, learners: 500, total: 12 }],
      coursesSorted: [
        { Course: 'Burns', CourseId: 'burns', Learners: 1000, Certificates: 250, Rating: '4.80', Responses: 350, LearningMinutes: 400000,
          QuestionStats: JSON.stringify([{ q: 'How would you rate your overall satisfaction?', avg: 4.8, n: 340, dist: { 4: 40, 5: 290 } }]) },
        { Course: HARD, Learners: 200, Certificates: 50, Rating: 0, Responses: 0 },
      ],
      courseTimelines: { Burns: { '2026-09': { e: 60, c: 6 } } },
      courseCountryData: { Burns: { top10: [['Nigeria', 400], ['Kenya', 200]], totalWithCountry: 600 } },
      courseRatings: { Burns: { '2026-09': { sum: 48, count: 10 }, '2026-12': { sum: 5, count: 1 } } },
      courseAwardMap: { Burns: [{ key: 'enrol', label: 'Most Enrolments', rank: 2, total: 150, valueFmt: '1,000' }] },
    };
  },
};
vm.createContext(ctx);
for (const f of ['partnerReport.js', 'partnerReportPage.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });

(async () => {
  const html = await ctx.App._buildPartnerReportHtml('GSF - Global Surgery Foundation');
  const D = JSON.parse(html.match(/<script>var DATA=([\s\S]*?);\n/)[1]);
  check('the title is the full name', /<h1 id="hero-title">Global Surgery Foundation<\/h1>/.test(html) && D.name === 'Global Surgery Foundation');
  check('every section Seb asked for is there: map, learning impact, survey insights, voices, a course table and course pages', ['id="sec-map"', 'id="sec-impact"', 'id="sec-survey"', 'id="sec-voices"', 'id="ctable"', 'id="page"', '<!--SH-DOWNLOADS-->'].every(x => html.includes(x)));
  check('months run to the data-through month and no further, gaps filled', D.monthly.map(m => m[0]).join() === '2026-08,2026-09,2026-10' && D.monthly[1][1] === 0);
  check('countries sorted, with map positions where known, "Unknown" left out', D.countries[0][0] === 'Nigeria' && D.countries[0].length === 4 && D.countries.find(c => c[0] === 'Atlantis').length === 2 && !D.countries.some(c => c[0] === 'Unknown') && D.totals.known === 802);
  check('learning impact and survey questions come through', D.impact.contentNew.pct === 80 && D.impact.time === '1.0 yrs' && D.questions[0].t === 'Overall satisfaction' && D.questions[0].hi === 96);
  const burns = D.courses[0];
  check('a course carries its own figures, months, countries, ratings by month, questions and awards', burns.enrol === 1000 && burns.monthly.length === 2 && burns.countries.length === 2 && burns.ratings.length === 1 && burns.ratings[0][1] === 4.8
    && burns.questions[0].hi === 97 && JSON.stringify(burns.awards) === '[{"k":"enrol","r":2,"n":150,"v":"1,000"}]', JSON.stringify(burns).slice(0, 300));
  check('quotes keep no email address and say who in words, never a name', D.quotes.length === 1 && !/@/.test(JSON.stringify(D.quotes)) && D.quotes[0].w === 'Nurse, Kenya' && !/a@x\.org/.test(html));
  check('short fragments are left out of the quotes', !D.quotes.some(q => /Too short/.test(q.t)));
  check('awards carry their category, place and value; the categories and country leads come too', JSON.stringify(D.awards) === '[{"k":"rating","r":1,"n":29,"v":"4.72 / 5"}]' && D.cats.length === 3 && D.cats[0].p === true && D.caw[0].c === 'Nigeria' && D.caw[0].t === 12 && D.awAsOf === 'Q4 2026');
  check('the page shows gold, silver and bronze medals and a dialog of every award, grouped in two columns, without the country list or "not in the top three"', ['function medal(', 'Gold', 'Silver', 'Bronze', 'All awards and how they are decided', "['Reach', ['enrol'", 'Quality and engagement', 'aw-grid', 'wide: true'].every(x => html.includes(x)) && !html.includes('Not in the top three') && !/function awardsDialog[\s\S]{0,1800}D\.caw/.test(html));
  check('figure cards do without a "What this counts" line each', !html.includes('<span class="stat-m">What this counts'));
  check('one dialog explains every course label, opened from any label or the row of all labels under the course table', html.includes('function labelsInfo(') && html.includes('id="labels-all"') && html.includes('What they mean') && /class="t-foot" id="labels-all"/.test(html));
  check('a chosen period is flagged in each section that follows it, with a way back to all time', html.includes('function pwarn(') && (html.match(/data-pw/g) || []).length >= 6 && html.includes('Show all time') && html.includes('data-reset'));
  check('the menu marks the last section at the very end of the page', html.includes('function markNav(') && html.includes('atEnd'));
  check('ratings by month as dots sized by the number of ratings, the dashed line the average of every rating, each month readable on hover', /function ratingChart[\s\S]{0,4500}hover\(el, n, x/.test(html) && html.includes('>Weighted avg.</text>') && html.includes('Weighted average of all ') && html.includes('Few ratings: read with care') && !html.includes('RBANDS'));
  check('the header says SURGhub without the long name, the update in a smaller line', html.includes('Your courses on SURGhub.<span class="lead-sub">Updated about once a week; last updated') && !/hero-lead">[^<]*UN Global Surgery Learning Hub/.test(html) && !html.includes("' on SURGhub, the UN Global Surgery Learning Hub.'"));
  check('a course name cannot break out of the page script', !html.includes('</script><img') && html.split('</script>').length === 2 && D.courses[1].name === HARD);
  check('no outside scripts or styles: the page works on its own', !/<script[^>]+src=/.test(html) && !/<link[^>]+stylesheet/.test(html));
  check('the page script has the interactions: hover read-out, switches, monthly bars, sorting, course pages, the same 12 months in every small chart', ['showTip(', 'aria-pressed', 'Numbers each month', 'aria-sort', "location.hash = 'course-'", 'var WIN = '].every(x => html.includes(x)));
  check('the dated records behind a period hold course, days and country only: no email, name or id, nothing outside the courses or in the future', D.recs.length === 2 && !/@|Example/.test(JSON.stringify([D.recs, D.rc])) && D.rc.join() === 'Kenya,Nigeria' && D.recs[1][1] === Math.round(Date.UTC(2026, 9, 20) / 864e5) && D.recs[0][2] === Math.round(Date.UTC(2026, 9, 1) / 864e5) && D.recs[1][2] === -1 && D.dataTo === '2026-10-20' && D.dataFrom === '2026-09-03', JSON.stringify([D.recs, D.dataTo]));
  check('a period bar with presets, custom dates and a comparison', ['Last 30 days', 'Last full quarter', 'This year so far', 'Choose dates', 'The previous period', 'The same dates a year earlier', 'id="period"'].every(x => html.includes(x)));
  check('the provider\'s average rating by month across its courses', JSON.stringify(D.ratings) === '[["2026-09",4.8,10]]' && html.includes('id="ratings-box"'));
  check('course labels as on surghub.org (not Free) and when it was featured', JSON.stringify(burns.tags) === '["Popular","Trending"]' && JSON.stringify(burns.featured) === '[["2026-10-22",""]]' && html.includes('function featuredText('));
  check('it says how often it is updated and links to a methodology page', /Updated about once a week; last updated \d+ \w+ \d{4}/.test(html) && html.includes('href="#methodology"') && html.includes('function methodology(') && D.updated.length === 10);
  check('the header globe joins learner countries to each other, not to one centre', html.includes('joined to each other: no centre') && !/vec\(6\.14, ?46\.2\)/.test(html));
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  check('Arial Bold as on the website, never Arial Black', !/Arial Black/.test(css) && /\.hero h1\{[^}]*font-weight:700/.test(css));
  check('figures are plain, without boxes with a coloured line above', !/border-top:\s*\d+px solid var\(--(ac|orange|gold|pink|blue)/.test(css) && !/stat-i/.test(html));
  check('the header has no photograph, a globe of connections, and room for the SURGhub and provider logos', !/hero-photo|hero_surghub/.test(html) && html.includes('id="globe"') && html.includes('class="logos"') && html.includes('function globe(') && /\.hero\{[^}]*#0d233a/.test(css));
  check('the brand accents are used beside the blues', ['--orange', '--gold', '--pink', '--green'].every(x => css.includes(x)));
  check('figure cards open a dialog that explains them, closable with Escape', html.includes('<dialog id="info"') && ['data-info', 'showModal', 'Escape', 'aria-haspopup="dialog"', 'enrolInfo(', 'certInfo('].every(x => html.includes(x)));
  check('a navigation bar links to the sections', html.includes('<nav aria-label="Sections"') && html.includes('href="#sec-courses"') && html.includes('id="sec-courses"'));
  check('voices start short: the summary opens on one sentence, three quotes, with a way to read the rest', ['data-more="summary"', 'Read the full summary', 'q.slice(0, 3)', 'ss.slice(0, 1)'].every(x => html.includes(x)));
  check('survey insights lead with the overall rating and the share rating it 4 or 5', html.includes('id="survey-big"') && html.includes('function bigSurvey(') && html.includes('Rated it 4 or 5 out of 5'));
  check('the menu links to the downloads; the footer carries the joint-initiative line, without the GSF logo', html.includes('href="#sec-downloads">Downloads</a></nav>') && /joint initiative of the Global Surgery Foundation \(GSF\) and UNITAR/.test(html) && !/f-brand">\$\{|f-brand"><img/.test(html));
  check('the hero has no How we count link; the logos are centred; the update says how many days ago', !/hero-actions[^\n]*How we count/.test(html) && /\.logos\{[^}]*align-self:center/.test(html) && (html.match(/class="upd-age"/g) || []).length === 3 && html.includes("'yesterday'"));
  check('the methodology shows the icons the report uses: labels, medals, the award and globe icons, stars, the rating dots and the period reminder', /function methodology[\s\S]{0,6000}badge static/.test(html) && /function methodology[\s\S]{0,6000}medal\(r, 34\)/.test(html) && html.includes('AWARD_IC') && /function methodology[\s\S]{0,9000}GLOBE/.test(html) && html.includes('m-stars') && html.includes('A month with many') && html.includes('pwarn m-ex'));
  // ── all of SURGhub ──
  ctx.App._assembleReportData = (orig => async (p, o) => { const d = await orig(p, o); if (o && o.platform) { d.topProviders = [{ name: 'GSF - Global Surgery Foundation', courses: 2, lrn: 1200, cert: 300, avg: 4.7 }, { name: 'WFSA - World Federation', courses: 1, lrn: 50, cert: 5, avg: 0 }]; d.providerCount = 2; d.coursesSorted = d.coursesSorted.map(c => Object.assign({ Provider: 'GSF - Global Surgery Foundation' }, c)); } return d; })(ctx.App._assembleReportData);
  const ph = await ctx.App._buildPartnerReportHtml('SURGhub', { platform: true, links: { 'GSF - Global Surgery Foundation': 'gsf' } });
  const PD = JSON.parse(ph.match(/<script>var DATA=([\s\S]*?);\n/)[1]);
  check('All of SURGhub: named so, every provider in a table linked to its dashboard, the provider under each course', PD.platform === true && PD.name === 'All of SURGhub' && /<h1 id="hero-title">All of SURGhub<\/h1>/.test(ph) && PD.provs.length === 2 && PD.provs[0].n === 'Global Surgery Foundation' && PD.provs[0].slug === 'gsf' && PD.provs[1].slug === '' && PD.courses[0].provider === 'Global Surgery Foundation' && ph.includes('id="ptable"') && ph.includes('href="#sec-providers">Providers</a>') && PD.totals.providers === 2, JSON.stringify(PD.provs));
  check('…with no provider logo or provider summary, and its own wording', !/class="sep"/.test(ph) && PD.summary === '' && ph.includes("Every provider\'s courses on SURGhub.") && ph.includes('function ptable(') && ph.includes('No dashboard of its own'));
  console.log('\n' + ok + '/' + (ok + bad) + ' passed');
  process.exit(bad ? 1 : 0);
})();
