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
  _emailDemoMap: { 'a@x.org': { profession: 'nurse', country: 'Kenya' } },
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
      providerAwards: [{ label: 'Highest Rated', rank: 1, total: 29, valueFmt: '4.72 / 5' }],
      providerCountryAwards: [{ country: 'Nigeria', rank: 1 }],
      coursesSorted: [
        { Course: 'Burns', Learners: 1000, Certificates: 250, Rating: '4.80', Responses: 350, LearningMinutes: 400000,
          QuestionStats: JSON.stringify([{ q: 'How would you rate your overall satisfaction?', avg: 4.8, n: 340, dist: { 4: 40, 5: 290 } }]) },
        { Course: HARD, Learners: 200, Certificates: 50, Rating: 0, Responses: 0 },
      ],
      courseTimelines: { Burns: { '2026-09': { e: 60, c: 6 } } },
      courseCountryData: { Burns: { top10: [['Nigeria', 400], ['Kenya', 200]], totalWithCountry: 600 } },
      courseRatings: { Burns: { '2026-09': { sum: 48, count: 10 }, '2026-12': { sum: 5, count: 1 } } },
      courseAwardMap: { Burns: [{ label: 'Most Enrolments', rank: 2, total: 150 }] },
    };
  },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'partnerReport.js'), 'utf8'), ctx, { filename: 'partnerReport.js' });

(async () => {
  const html = await ctx.App._buildPartnerReportHtml('GSF - Global Surgery Foundation');
  const D = JSON.parse(html.match(/<script>var DATA=([\s\S]*?);\n/)[1]);
  check('the title is the full name', /<h1 id="hero-title">Global Surgery Foundation<\/h1>/.test(html) && D.name === 'Global Surgery Foundation');
  check('every section Seb asked for is there: map, learning impact, survey insights, voices, a course table and course pages', ['id="sec-map"', 'id="sec-impact"', 'id="sec-survey"', 'id="sec-voices"', 'id="ctable"', 'id="course"', '<!--SH-DOWNLOADS-->'].every(x => html.includes(x)));
  check('months run to the data-through month and no further, gaps filled', D.monthly.map(m => m[0]).join() === '2026-08,2026-09,2026-10' && D.monthly[1][1] === 0);
  check('countries sorted, with map positions where known, "Unknown" left out', D.countries[0][0] === 'Nigeria' && D.countries[0].length === 4 && D.countries.find(c => c[0] === 'Atlantis').length === 2 && !D.countries.some(c => c[0] === 'Unknown') && D.totals.known === 802);
  check('learning impact and survey questions come through', D.impact.contentNew.pct === 80 && D.impact.time === '1.0 yrs' && D.questions[0].t === 'Overall satisfaction' && D.questions[0].hi === 96);
  const burns = D.courses[0];
  check('a course carries its own figures, months, countries, ratings by month, questions and awards', burns.enrol === 1000 && burns.monthly.length === 2 && burns.countries.length === 2 && burns.ratings.length === 1 && burns.ratings[0][1] === 4.8
    && burns.questions[0].hi === 97 && /Most enrolments: number 2 of 150 courses/.test(burns.awards[0]), JSON.stringify(burns).slice(0, 300));
  check('quotes keep no email address and say who in words, never a name', D.quotes.length === 1 && !/@/.test(JSON.stringify(D.quotes)) && D.quotes[0].w === 'Nurse, Kenya' && !/a@x\.org/.test(html));
  check('short fragments are left out of the quotes', !D.quotes.some(q => /Too short/.test(q.t)));
  check('recognition reads as a sentence, without a second rating figure', D.awards[0] === 'Highest rated of 29 providers on SURGhub' && D.firsts[0] === 'Nigeria');
  check('a course name cannot break out of the page script', !html.includes('</script><img') && html.split('</script>').length === 2 && D.courses[1].name === HARD);
  check('no outside scripts or styles: the page works on its own', !/<script[^>]+src=/.test(html) && !/<link[^>]+stylesheet/.test(html));
  check('the page script has the interactions: hover read-out, switches, monthly bars, sorting, course pages, the same 12 months in every small chart', ['showTip(', 'aria-pressed', 'Numbers each month', 'aria-sort', 'location.hash="course-"', 'var WIN='].every(x => html.includes(x)));
  console.log('\n' + ok + '/' + (ok + bad) + ' passed');
  process.exit(bad ? 1 : 0);
})();
