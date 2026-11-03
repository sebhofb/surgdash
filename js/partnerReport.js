// ── Partner dashboard in the GSF design (Nov 2026) ───────────────────────────────────────
//
// A provider's web report built from scratch on the Global Surgery Foundation Design System,
// to read like the GSF website: a navy hero with a photograph from the website (faded in from
// the left), white sections, Arial Black headings in strong blue, plain large figures, light-
// blue graphics, gold only for emphasis, a navy footer with the white logo.
//
// One self-contained page (images inline, no outside scripts, readable on a phone). The figures
// are prepared here into one DATA object; a small script in the page draws the interactive
// growth chart (hover, enrolments/certificates on and off, monthly numbers), the world map, the
// sortable course table and a detail page per course (#course-<n>).
//
// The numbers come from _assembleReportData (reports.js), the same as the dark report. Seb's
// list (3 Nov 2026): world map, survey insights, learning impact, clickable courses with their
// own page, small charts that say their timeframe, a sortable table, an interactive chart.
// partnerDash.js uses it for a provider whose design is 'gsf' and puts the downloads where
// <!--SH-DOWNLOADS--> stands.
Object.assign(window.App, {

    _prImage(file) {
        try {
            const p = electronAPI.path.join(electronAPI.appPath, 'build', file);
            if (!electronAPI.fs.existsSync(p)) return '';
            return 'data:' + (/\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png') + ';base64,' + electronAPI.fs.readFileBase64(p);
        } catch (e) { __swallowed(e, 'pr.image'); return ''; }
    },
    // The provider's own logo, if one is in build/provider_logos (same rule as the dark report).
    _prProviderLogo(providerName) {
        try {
            const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
            const want = norm(providerName);
            const dir = electronAPI.path.join(electronAPI.appPath, 'build', 'provider_logos');
            const files = electronAPI.fs.readdirSync ? electronAPI.fs.readdirSync(dir) : [];
            const base = (f) => norm(String(f).replace(/\.[^.]+$/, ''));
            const hit = files.find(f => /\.(png|jpe?g)$/i.test(f) && base(f) === want)
                || files.find(f => /\.(png|jpe?g)$/i.test(f) && base(f).length >= 3 && (want.includes(base(f)) || base(f).includes(want)));
            return hit ? this._prImage('provider_logos/' + hit) : '';
        } catch (e) { return ''; }
    },
    _prLastDay(ym) {
        const m = String(ym || '').match(/^(\d{4})-(\d{2})/); if (!m) return '';
        return new Date(Date.UTC(+m[1], +m[2], 0)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    },
    // Months from the first to the data-through month, gaps filled: [[ 'YYYY-MM', new enrolments, new certificates ]].
    _prMonthly(tl, through) {
        const keys = Object.keys(tl || {}).filter(k => /^\d{4}-\d{2}$/.test(k) && (!through || k <= through)).sort();
        if (!keys.length) return [];
        const out = []; let [y, m] = keys[0].split('-').map(Number); const last = through && through > keys[keys.length - 1] ? through : keys[keys.length - 1];
        for (let g = 0; g < 600; g++) {
            const k = y + '-' + String(m).padStart(2, '0'); if (k > last) break;
            const v = tl[k] || {}; out.push([k, Math.round(Number(v.e) || 0), Math.round(Number(v.c) || 0)]);
            m++; if (m > 12) { m = 1; y++; }
        }
        return out;
    },
    // Survey questions from a course's QuestionStats ({q, avg, n, dist}), in the shape the page shows.
    _prQuestions(rows) {
        return (rows || []).filter(r => r && r.q && Number(r.n) >= 3).map(r => {
            const n = Number(r.n) || 0, d = r.dist || {};
            const hi = r.hiPct != null ? Number(r.hiPct) : (n ? ((Number(d['4']) || 0) + (Number(d['5']) || 0)) / n * 100 : 0);
            return { t: (r.title || (this._surveyQTitle ? this._surveyQTitle(r.q) : '') || r.q), q: r.q, avg: +(Number(r.avg) || 0).toFixed(2), hi: Math.round(hi), n };
        });
    },

    async _buildPartnerReportHtml(providerName, opts) {
        opts = opts || {};
        const D = await this._assembleReportData(providerName, {});
        if (!D) return null;
        const esc = (s) => this.escapeHtml(String(s == null ? '' : s));
        const scrub = (t) => this.scrubPersonal ? this.scrubPersonal(String(t || '')) : String(t || '');
        const fmt = (n) => this.formatNumber(Math.round(Number(n) || 0));
        // The full name ("GSF - Global Surgery Foundation" reads "Global Surgery Foundation")
        const name = String(providerName).includes(' - ') ? String(providerName).split(' - ').slice(1).join(' - ').trim() : (this.providerFolderName ? this.providerFolderName(providerName) : providerName);
        const through = this.reportDataThrough || (this._lastFullMonth ? this._lastFullMonth() : '');
        const asOf = through ? this._prLastDay(through) : String(D.reportDate || '');
        const logoBlue = this._prImage('gsf_logo_blue.png'), logoWhite = this._prImage('gsf_logo_white_web.png'), hero = this._prImage('hero_surghub.jpg');
        const provLogo = /^GSF\b|Global Surgery Foundation/i.test(providerName) ? '' : this._prProviderLogo(providerName);   // GSF's logo is already at the top
        const lt = (min) => (Number(min) > 0 && this.formatLearningTime) ? this.formatLearningTime(Number(min)) : '';
        const sentence = (t) => String(t || '').toLowerCase().replace(/^\w/, c => c.toUpperCase());

        // who said it: profession and country, never a name
        const whoFor = (f) => {
            const d = f.e ? (this._emailDemoMap || {})[String(f.e).trim().toLowerCase()] : null;
            const prof = d && d.profession ? sentence((this._tmCadre ? this._tmCadre(d.profession) : '') || String(d.profession).replace(/[-_]+/g, ' ')) : '';
            const parts = d ? [prof, d.country].filter(Boolean) : [];
            return parts.length ? parts.join(', ') : 'SURGhub learner';
        };
        const quotesByCourse = {};
        if (D.courseTestimonials) Object.entries(D.courseTestimonials).forEach(([c, list]) => (list || []).forEach(f => (quotesByCourse[c] = quotesByCourse[c] || []).push(f)));
        else (D.testimonials || []).forEach(f => { const c = f._course || f.course || ''; (quotesByCourse[c] = quotesByCourse[c] || []).push(f); });
        const quoteOf = (f, course) => ({ t: scrub(f.t).trim(), w: whoFor(f), c: course || f._course || f.course || '' });
        const allQuotes = [];
        Object.entries(quotesByCourse).forEach(([c, list]) => list.forEach(f => allQuotes.push(quoteOf(f, c))));

        // countries, with a map position where the app knows the country
        const G = window.SURGGlobeData || {};
        let cent = {}; try { cent = JSON.parse(G.CENT || '{}'); } catch (e) { cent = {}; }
        const toIso = (c) => (window.countryToISO ? window.countryToISO(c) : '') || '';
        const countries = Object.entries(D.providerCountryData || {}).filter(([k, n]) => k && k !== 'Unknown' && n > 0).sort((a, b) => b[1] - a[1])
            .map(([c, n]) => { const p = cent[toIso(c)]; return p ? [c, n, p[0], p[1]] : [c, n]; });
        const known = countries.reduce((s, c) => s + c[1], 0);

        const si = D.surveyImpact || {};
        const pick = (x) => x ? { pct: x.pct, n: x.n } : null;
        const courses = (D.coursesSorted || []).filter(c => c && c.Course).map(c => {
            let qs = []; try { qs = JSON.parse(c.QuestionStats || '[]') || []; } catch (e) { qs = []; }
            const cc = (D.courseCountryData || {})[c.Course];
            const rt = (D.courseRatings || {})[c.Course] || {};
            const sm = D.fbSummaries && D.fbSummaries[c.Course] && D.fbSummaries[c.Course].s;
            return {
                name: c.Course, enrol: Number(c.Learners) || 0, cert: Number(c.Certificates) || 0, rating: Number(c.Rating) > 0 ? +Number(c.Rating).toFixed(2) : 0,
                resp: Number(c.Responses) || 0, time: lt(c.LearningMinutes),
                monthly: this._prMonthly((D.courseTimelines || {})[c.Course], through),
                countries: cc && cc.top10 ? cc.top10.slice(0, 10) : [], known: cc ? (cc.totalWithCountry || 0) : 0,
                ratings: Object.keys(rt).filter(m => (!through || m <= through) && rt[m].count > 0).sort().map(m => [m, +(rt[m].sum / rt[m].count).toFixed(2), rt[m].count]),
                questions: this._prQuestions(qs),
                quotes: (quotesByCourse[c.Course] || []).map(f => quoteOf(f, '')).filter(q => q.t.length >= 25).slice(0, 6),
                summary: sm ? String(sm) : '',
                awards: ((D.courseAwardMap || {})[c.Course] || []).slice().sort((a, b) => a.rank - b.rank).map(a => sentence(a.label) + (a.rank === 1 ? ' of ' : ': number ' + a.rank + ' of ') + fmt(a.total) + ' courses'),
            };
        });
        const awards = (D.providerAwards || []).slice().sort((a, b) => a.rank - b.rank).map(a => sentence(a.label) + (a.rank === 1 ? ' of ' : ': number ' + a.rank + ' of ') + fmt(a.total) + ' providers on SURGhub');
        const firsts = (D.providerCountryAwards || []).filter(c => c.rank === 1).map(c => c.country);

        const DATA = {
            name, asOf, through,
            totals: { enrol: D.totalLrn, cert: D.totalCert, rate: D.certRate, rating: Number(D.avgRating) > 0 ? Number(D.avgRating).toFixed(2) : '', resp: D.totalResp, time: lt(D.totalMin), courses: courses.length, countries: countries.length, known },
            monthly: this._prMonthly(D.provTimeline, through),
            countries, land: G.LAND || '[]',
            impact: { time: lt(D.totalMin), contentNew: pick(si.contentNew), willApply: pick(si.willApply), careerValue: pick(si.careerValue) },
            questions: this._prQuestions(D.surveyQRows),
            summary: (D.fbSummaries && D.fbSummaries['@provider:' + providerName] && D.fbSummaries['@provider:' + providerName].s) || '',
            quotes: allQuotes.filter(q => q.t.length >= 25).slice(0, 6),
            courses, awards, firsts,
        };
        const json = JSON.stringify(DATA).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

        return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><title>${esc(name)} on SURGhub</title><style>${this._prCss()}</style></head><body>
<header class="top"><div class="wrap">${logoBlue ? '<img src="' + logoBlue + '" alt="Global Surgery Foundation">' : '<b>Global Surgery Foundation</b>'}<span>SURGhub partner dashboard</span></div></header>
<div class="hero">${hero ? '<div class="hero-photo" style="background-image:url(' + hero + ')"></div>' : ''}<div class="wrap">
  ${provLogo ? '<div class="plogo"><img src="' + provLogo + '" alt="' + esc(name) + '"></div>' : ''}
  <p class="eyebrow">SURGhub partner dashboard</p>
  <h1 id="hero-title">${esc(name)}</h1>
  <p class="lead" id="hero-lead">Your courses on SURGhub, the UN Global Surgery Learning Hub. Figures to ${esc(asOf)}.</p>
</div>${hero ? '<div class="credit">Photo: Gulu University Surgical Equity Society</div>' : ''}</div>

<main id="main">
<section><div class="wrap">
  <p class="eyebrow">At a glance</p><h2>Your courses in numbers</h2>
  <p class="intro">All of your courses on SURGhub, since each one opened.</p>
  <div class="stats" id="stats"></div><div class="tags" id="awards"></div>
</div></section>

<section><div class="wrap">
  <p class="eyebrow">Growth</p><h2>Enrolments and certificates over time</h2>
  <p class="intro">Running totals by month. Point at the chart to read a month; switch the lines on and off, or add the numbers for each month.</p>
  <div class="card"><div id="growth"></div></div>
</div></section>

<section id="sec-map"><div class="wrap">
  <p class="eyebrow">Reach</p><h2>Where your learners are</h2>
  <p class="intro" id="map-intro"></p>
  <div class="card map-card"><div id="map"></div><div id="toplist"></div></div>
</div></section>

<section id="sec-impact"><div class="wrap">
  <p class="eyebrow">Learning impact</p><h2>What the learning changes</h2>
  <p class="intro">From the survey at the end of each course: the share of learners answering 4 or 5 on a scale of 1 to 5.</p>
  <div class="stats" id="impact"></div>
</div></section>

<section id="sec-survey"><div class="wrap">
  <p class="eyebrow">Survey insights</p><h2>How learners rate the courses</h2>
  <p class="intro" id="survey-intro"></p>
  <div class="card"><div id="questions"></div></div>
</div></section>

<section id="sec-voices"><div class="wrap">
  <p class="eyebrow">Learner voices</p><h2>What learners say</h2>
  <div id="summary"></div><div class="quotes" id="quotes"></div>
</div></section>

<section><div class="wrap">
  <p class="eyebrow">Courses</p><h2>Course by course</h2>
  <p class="intro">Choose a column to sort; choose a course to see its own page.</p>
  <div class="card table-card"><div class="table-scroll"><table class="ctable" id="ctable"></table></div></div>
</div></section>

<!--SH-DOWNLOADS-->

<section><div class="wrap">
  <p class="eyebrow">About these figures</p><h2>How we count</h2>
  <div class="notes">
    <p><b>Course enrolments</b> count every enrolment in your courses, whether or not the learner has started. One person who takes two of your courses counts twice.</p>
    <p><b>Certificates</b> are the course certificates learners earned. The certification rate is certificates divided by enrolments.</p>
    <p><b>Countries</b> come from what learners give in their SURGhub profile; not every learner gives one. The map places each country at its centre.</p>
    <p><b>Ratings and survey answers</b> come from the survey at the end of each course. Quotes are shown as learners wrote them, without names.</p>
    <p><b>Figures run to ${esc(asOf)}.</b> They come from SURGhub and are prepared by the Global Surgery Foundation with SURGdash.</p>
    <p>Questions about this dashboard: <a href="mailto:info@globalsurgeryfoundation.org">info@globalsurgeryfoundation.org</a></p>
  </div>
</div></section>
</main>

<main id="course" hidden></main>

<footer><div class="wrap">${logoWhite ? '<img src="' + logoWhite + '" alt="Global Surgery Foundation">' : '<b>Global Surgery Foundation</b>'}<p>SURGhub, the UN Global Surgery Learning Hub, is the Global Surgery Foundation's online learning platform.<br><a href="https://www.globalsurgeryfoundation.org">globalsurgeryfoundation.org</a></p></div></footer>
<div id="tip" class="tip" hidden></div>
<script>var DATA=${json};
${this._prScript()}<\/script>
</body></html>`;
    },

    _prCss() {
        return `
:root{--blue:#0468b1;--blue-h:#035c9d;--navy:#002f4c;--light:#91b5d9;--tint:#e6f0f8;--line:#dee7ef;--line2:#cde1f0;--gold:#ffc145;--muted:#4a6b82}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:var(--navy);font:16px/1.5 Arial,"Helvetica Neue",Helvetica,sans-serif}
.wrap{max-width:1200px;margin:0 auto;padding:0 24px}
a{color:var(--blue)}a:hover{text-decoration:underline}
.top{background:#fff;border-bottom:1px solid var(--line)}.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;height:76px}
.top img{height:44px;width:auto}.top span{font-size:14px;font-weight:700;color:var(--muted)}
.hero{position:relative;background:var(--navy);color:#fff;overflow:hidden;border-bottom-left-radius:50% 28px;border-bottom-right-radius:50% 28px}
.hero-photo{position:absolute;top:0;right:0;bottom:0;width:56%;background-size:cover;background-position:center 30%;-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 38%);mask-image:linear-gradient(90deg,transparent 0,#000 38%)}
.hero-photo:after{content:"";position:absolute;inset:0;background:rgba(0,47,76,.14)}
.hero .wrap{position:relative;padding-top:72px;padding-bottom:88px}
.eyebrow{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--blue);margin:0 0 12px}
.hero .eyebrow{color:var(--light)}
.hero h1{font-family:"Arial Black",Arial,sans-serif;font-weight:900;font-size:48px;line-height:1.1;letter-spacing:-.01em;margin:0;max-width:640px}
.hero p.lead{font-size:19px;font-weight:700;line-height:1.5;color:rgba(255,255,255,.85);max-width:560px;margin:16px 0 0}
.hero .plogo{display:inline-block;background:#fff;border-radius:9px;padding:10px 14px;margin-bottom:22px}.hero .plogo img{height:44px;width:auto;display:block}
.credit{position:absolute;right:24px;bottom:40px;font-size:12px;color:rgba(255,255,255,.6)}
section{padding:64px 0 8px}
h2{font-family:"Arial Black",Arial,sans-serif;font-weight:900;font-size:30px;line-height:1.25;color:var(--blue);margin:0 0 8px}
h3{font-size:19px;line-height:1.25;margin:0 0 12px;color:var(--navy)}
.intro{font-size:16px;color:var(--muted);max-width:760px;margin:0 0 28px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:24px}
.stat{border-top:3px solid var(--light);padding-top:16px}
.stat-v{font-family:"Arial Black",Arial,sans-serif;font-weight:900;font-size:44px;line-height:1;letter-spacing:-.01em;color:var(--blue);white-space:nowrap}
.stat-l{margin-top:10px;font-weight:700;font-size:16px;line-height:1.35}
.stat-s{margin-top:4px;font-size:13px;color:var(--muted)}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:28px}.tags:empty{display:none}
.tag{display:inline-flex;align-items:center;font-weight:700;font-size:13px;line-height:1.3;padding:7px 14px;border-radius:999px;background:var(--tint);color:var(--blue)}
.tag-gold{background:var(--gold);color:var(--navy)}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 1px 3px rgba(0,47,76,.08),0 1px 2px rgba(0,47,76,.06);padding:28px}
.toggles{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}
.tg{display:inline-flex;align-items:center;gap:8px;font:700 14px Arial,sans-serif;padding:7px 14px;border-radius:999px;border:2px solid var(--line2);background:#fff;color:var(--muted);cursor:pointer}
.tg i{display:inline-block;width:14px;height:4px;border-radius:2px}
.tg[aria-pressed="true"]{border-color:var(--blue);color:var(--navy);background:var(--tint)}
.chart{position:relative}.chart svg{width:100%;height:auto;display:block;touch-action:pan-y}
.tip{position:fixed;z-index:50;pointer-events:none;background:var(--navy);color:#fff;border-radius:9px;padding:10px 12px;font-size:13px;line-height:1.45;box-shadow:0 12px 28px rgba(0,47,76,.14);max-width:280px}
.tip b{display:block;font-size:14px;margin-bottom:2px}
.map-card{display:grid;grid-template-columns:minmax(0,2fr) minmax(240px,1fr);gap:28px;align-items:start}
.bar-row{display:grid;grid-template-columns:minmax(0,1fr) 64px 46px;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line);font-size:14px}
.bar-l{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar-l span{display:block;background:var(--tint);border-radius:3px;height:6px;margin-top:5px}.bar-l span i{display:block;height:6px;border-radius:3px;background:var(--blue)}
.bar-n{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}.bar-p{text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
.note{font-size:13px;color:var(--muted);margin:12px 0 0}
.q-row{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(120px,1fr) 64px 64px;gap:16px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line);font-size:14px}
.q-row:last-child{border-bottom:0}.q-row.head{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);padding-top:0}
.q-t{font-weight:700}.q-t small{display:block;font-weight:400;color:var(--muted);margin-top:2px}
.q-bar{background:var(--tint);border-radius:4px;height:10px}.q-bar i{display:block;height:10px;border-radius:4px;background:var(--blue)}
.num{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
.summary{background:#fff;border:1px solid var(--line);border-radius:12px;padding:28px 32px;font-family:Georgia,"Times New Roman",serif;font-size:17px;line-height:1.65;max-width:900px}
.summary small{display:block;margin-top:12px;font-family:Arial,sans-serif;font-size:13px;color:var(--muted)}
.quotes{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;margin-top:28px}
.quote{margin:0;background:var(--tint);border-radius:12px;padding:28px}
.quote blockquote{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:17px;line-height:1.65;color:var(--navy)}
.quote blockquote:before{content:"\\201C";display:block;font-family:Georgia,serif;font-size:56px;line-height:.6;color:var(--blue);margin-bottom:10px}
.quote figcaption{margin-top:16px;font-size:14px}.quote figcaption b{display:block}.quote figcaption span{display:block;color:var(--muted);margin-top:2px}
.table-card{padding:8px 0 0}.table-scroll{overflow-x:auto}
.ctable{width:100%;border-collapse:collapse;font-size:14px;min-width:760px}
.ctable th{text-align:right;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);padding:12px 14px;border-bottom:1px solid var(--line2);white-space:nowrap}
.ctable th:first-child,.ctable td:first-child{text-align:left}
.ctable th button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:4px}.ctable th button:focus-visible{box-shadow:0 0 0 2px #002f4c,0 0 0 5px #ffc145;border-radius:4px}
.ctable th[aria-sort] button{color:var(--blue)}.ctable th button:after{content:"\\2195";font-size:11px;opacity:.45}
.ctable th[aria-sort="ascending"] button:after{content:"\\2191";opacity:1}.ctable th[aria-sort="descending"] button:after{content:"\\2193";opacity:1}
.ctable td{padding:9px 14px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;vertical-align:middle}
.ctable tbody tr{cursor:pointer}.ctable tbody tr:hover{background:#f3f7fb}.ctable tbody tr:focus-visible{outline:none;box-shadow:inset 0 0 0 2px var(--blue)}
.ctable td.cn{white-space:normal;font-weight:700;color:var(--blue);min-width:260px}
.ctable td.sp{width:150px}.spark{display:block;width:132px;height:30px;margin-left:auto}
.dl{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.btn{display:inline-flex;align-items:center;gap:8px;font:700 15px Arial,sans-serif;padding:11px 22px;border-radius:9px;border:2px solid var(--blue);background:var(--blue);color:#fff;cursor:pointer;text-decoration:none}
.btn:hover{background:var(--blue-h);border-color:var(--blue-h);text-decoration:none}.btn.sec{background:#fff;color:var(--blue)}.btn.sec:hover{background:var(--tint)}
.btn:focus-visible,a:focus-visible,.tg:focus-visible{outline:none;box-shadow:0 0 0 2px #002f4c,0 0 0 5px #ffc145}
.back{display:inline-flex;align-items:center;gap:6px;font-weight:700;margin:40px 0 0}
.two{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.notes{columns:2;column-gap:40px;font-size:14px}.notes p{margin:0 0 12px;break-inside:avoid}
footer{margin-top:72px;background:var(--navy);color:#fff}footer .wrap{display:flex;justify-content:space-between;align-items:center;gap:24px;flex-wrap:wrap;padding-top:40px;padding-bottom:40px}
footer img{height:52px;width:auto}footer p{margin:0;font-size:14px;color:rgba(255,255,255,.85);text-align:right}footer a{color:#fff}
@media (max-width:760px){.hero h1{font-size:34px}.hero-photo{width:100%;opacity:.35}.two,.map-card{grid-template-columns:1fr}.notes{columns:1}.stats{grid-template-columns:1fr 1fr;gap:20px}h2{font-size:24px}.stat-v{font-size:32px}.top img{height:36px}footer p{text-align:left}.q-row{grid-template-columns:minmax(0,1fr) 60px 56px}.q-row .q-bar{display:none}.q-row.head span:nth-child(2){display:none}}
@media print{.hero{border-radius:0}.dl,.toggles{display:none}section{break-inside:avoid}}`;
    },

    // The page's own script: plain ES5-style JavaScript so it runs in any browser a partner uses.
    _prScript() {
        return `(function(){
var D=DATA,NS="http://www.w3.org/2000/svg";
function fmt(n){return Math.round(+n||0).toLocaleString("en-GB")}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function mName(m,long){var p=String(m).split("-");return new Date(Date.UTC(+p[0],+p[1]-1,15)).toLocaleDateString("en-GB",{month:long?"long":"short",year:"numeric",timeZone:"UTC"})}
function $(id){return document.getElementById(id)}
var tip=$("tip");
function showTip(html,x,y){tip.innerHTML=html;tip.hidden=false;var w=tip.offsetWidth,h=tip.offsetHeight,X=x+16,Y=y+16;if(X+w>innerWidth-8)X=x-w-16;if(Y+h>innerHeight-8)Y=y-h-16;tip.style.left=Math.max(8,X)+"px";tip.style.top=Math.max(8,Y)+"px"}
function hideTip(){tip.hidden=true}
function stat(v,l,s){return '<div class="stat"><div class="stat-v">'+v+'</div><div class="stat-l">'+l+'</div>'+(s?'<div class="stat-s">'+s+'</div>':'')+'</div>'}
function nice(max,parts){var raw=Math.max(1,max)/parts,p=Math.pow(10,Math.floor(Math.log10(raw))),st=[1,2,2.5,5,10].map(function(x){return x*p}).filter(function(x){return x>=raw})[0];return {step:st,top:st*Math.ceil(Math.max(1,max)/st)}}

// ── the growth chart: running totals as lines, monthly numbers as bars on their own scale ──
function growth(el,monthly){
  if(!monthly||monthly.length<2){el.innerHTML='<p class="note">Not enough months yet to draw a chart.</p>';return}
  var st={e:true,c:true,bars:false},cum=[],e=0,c=0;
  monthly.forEach(function(r){e+=r[1];c+=r[2];cum.push({m:r[0],e:e,c:c,de:r[1],dc:r[2]})});
  el.innerHTML='<div class="toggles" role="group" aria-label="Show in the chart">'
    +'<button class="tg" data-k="e" aria-pressed="true"><i style="background:#0468b1"></i>Course enrolments</button>'
    +'<button class="tg" data-k="c" aria-pressed="true"><i style="background:#002f4c"></i>Certificates</button>'
    +'<button class="tg" data-k="bars" aria-pressed="false"><i style="background:#91b5d9;height:10px;width:10px"></i>Numbers each month</button></div><div class="chart"></div>';
  var box=el.querySelector(".chart");
  el.querySelectorAll(".tg").forEach(function(b){b.addEventListener("click",function(){var k=b.getAttribute("data-k");st[k]=!st[k];if(!st.e&&!st.c&&!st.bars){st[k]=true}b.setAttribute("aria-pressed",String(st[k]));draw()})});
  function draw(){
    var W=1000,H=330,L=64,R=st.bars?64:16,T=16,B=40,w=W-L-R,h=H-T-B,n=cum.length,last=cum[n-1];
    var lmax=Math.max(st.e?last.e:0,st.c?last.c:0,1),bmax=1;cum.forEach(function(r){if(st.e)bmax=Math.max(bmax,r.de);if(st.c)bmax=Math.max(bmax,r.dc)});
    var A=nice(lmax,4),Bs=nice(bmax,4);
    var x=function(i){return L+(n===1?0:i*w/(n-1))},y=function(v){return T+h-v/A.top*h},yb=function(v){return T+h-v/Bs.top*h};
    var s='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Course enrolments and certificates by month">';
    for(var i=0;i*A.step<=A.top+1e-9;i++){var v=i*A.step,yy=y(v).toFixed(1);s+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+yy+'" y2="'+yy+'" stroke="#dee7ef"/><text x="'+(L-10)+'" y="'+yy+'" dy="4" text-anchor="end" font-size="13" fill="#4a6b82">'+fmt(v)+'</text>'}
    if(st.bars){for(var j=0;j*Bs.step<=Bs.top+1e-9;j++){var vb=j*Bs.step;s+='<text x="'+(W-R+10)+'" y="'+yb(vb).toFixed(1)+'" dy="4" font-size="13" fill="#4a6b82">'+fmt(vb)+'</text>'}
      var bw=Math.max(2,w/n*0.7),half=(st.e&&st.c)?bw/2:bw;
      cum.forEach(function(r,i){var x0=x(i)-bw/2;if(st.e)s+='<rect x="'+x0.toFixed(1)+'" y="'+yb(r.de).toFixed(1)+'" width="'+half.toFixed(1)+'" height="'+(T+h-yb(r.de)).toFixed(1)+'" fill="#91b5d9"/>';if(st.c)s+='<rect x="'+(x0+(st.e?half:0)).toFixed(1)+'" y="'+yb(r.dc).toFixed(1)+'" width="'+half.toFixed(1)+'" height="'+(T+h-yb(r.dc)).toFixed(1)+'" fill="#cde1f0"/>'})}
    cum.forEach(function(r,i){if(r.m.slice(5)==="01"||i===0)s+='<text x="'+x(i).toFixed(1)+'" y="'+(H-12)+'" text-anchor="'+(i===0?"start":"middle")+'" font-size="13" fill="#4a6b82">'+(i===0?mName(r.m):r.m.slice(0,4))+'</text>'});
    function path(k){return cum.map(function(r,i){return(i?"L":"M")+x(i).toFixed(1)+" "+y(r[k]).toFixed(1)}).join(" ")}
    if(st.e)s+='<path d="'+path("e")+' L'+x(n-1).toFixed(1)+' '+(T+h)+' L'+L+' '+(T+h)+' Z" fill="#e6f0f8" fill-opacity="'+(st.bars?0.5:1)+'"/><path d="'+path("e")+'" fill="none" stroke="#0468b1" stroke-width="3" stroke-linejoin="round"/>';
    if(st.c)s+='<path d="'+path("c")+'" fill="none" stroke="#002f4c" stroke-width="3" stroke-linejoin="round"/>';
    s+='<line class="guide" x1="0" x2="0" y1="'+T+'" y2="'+(T+h)+'" stroke="#002f4c" stroke-dasharray="3 3" visibility="hidden"/><g class="dots"></g>';
    s+='<rect x="'+L+'" y="'+T+'" width="'+w+'" height="'+h+'" fill="transparent" class="hit"/></svg>';
    box.innerHTML=s;
    var svg=box.querySelector("svg"),guide=svg.querySelector(".guide"),dots=svg.querySelector(".dots"),hit=svg.querySelector(".hit");
    function at(ev){var r=svg.getBoundingClientRect(),cx=(ev.touches?ev.touches[0].clientX:ev.clientX),px=(cx-r.left)/r.width*W;var i=Math.round((px-L)/(w/(n-1||1)));return Math.max(0,Math.min(n-1,i))}
    function move(ev){var i=at(ev),r=cum[i],X=x(i).toFixed(1);guide.setAttribute("x1",X);guide.setAttribute("x2",X);guide.setAttribute("visibility","visible");
      dots.innerHTML=(st.e?'<circle cx="'+X+'" cy="'+y(r.e).toFixed(1)+'" r="5" fill="#0468b1"/>':'')+(st.c?'<circle cx="'+X+'" cy="'+y(r.c).toFixed(1)+'" r="5" fill="#002f4c"/>':'');
      var t='<b>'+mName(r.m,true)+'</b>';if(st.e)t+='Course enrolments: '+fmt(r.e)+' in total, '+fmt(r.de)+' this month<br>';if(st.c)t+='Certificates: '+fmt(r.c)+' in total, '+fmt(r.dc)+' this month';
      var cx=ev.touches?ev.touches[0].clientX:ev.clientX,cy=ev.touches?ev.touches[0].clientY:ev.clientY;showTip(t,cx,cy)}
    function out(){guide.setAttribute("visibility","hidden");dots.innerHTML="";hideTip()}
    hit.addEventListener("mousemove",move);hit.addEventListener("mouseleave",out);hit.addEventListener("touchstart",move,{passive:true});hit.addEventListener("touchmove",move,{passive:true});hit.addEventListener("touchend",out);
  }
  draw();
}

// ── the last twelve months of new enrolments, as small bars ──
// the same twelve calendar months for every course, ending with the data-through month
var WIN=(function(){var end=D.through||(D.monthly.length?D.monthly[D.monthly.length-1][0]:"");if(!end)return [];var p=end.split("-").map(Number),y=p[0],m=p[1],out=[];for(var i=0;i<12;i++){out.unshift(y+"-"+(m<10?"0":"")+m);m--;if(!m){m=12;y--}}return out})();
function spark(monthly){
  if(!WIN.length)return '';
  var by={};(monthly||[]).forEach(function(r){by[r[0]]=r[1]});
  var max=1;WIN.forEach(function(m){max=Math.max(max,by[m]||0)});var bw=132/12;
  return '<svg class="spark" viewBox="0 0 132 30" role="img" aria-label="New enrolments each month, '+mName(WIN[0])+' to '+mName(WIN[11])+'">'+WIN.map(function(m,i){var v=by[m],hgt=v>0?Math.max(2,v/max*28):1;return '<rect x="'+(i*bw+1).toFixed(1)+'" y="'+(30-hgt).toFixed(1)+'" width="'+(bw-2).toFixed(1)+'" height="'+hgt.toFixed(1)+'" fill="'+(v>0?"#0468b1":"#cde1f0")+'"><title>'+mName(m)+': '+fmt(v||0)+' new enrolments</title></rect>'}).join("")+'</svg>';
}

// ── the world map: land as light-blue dots, a bubble per country at its centre ──
function worldMap(el,countries){
  var land=[];try{land=JSON.parse(D.land)}catch(e){}
  var W=1000,H=470,X=function(lon){return (lon+170)/360*W},Y=function(lat){return (78-lat)/138*H};
  var s='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Map of where learners come from" style="width:100%;height:auto;display:block">';
  for(var i=0;i+1<land.length;i+=2){if(land[i+1]<-58)continue;s+='<circle cx="'+X(land[i]).toFixed(1)+'" cy="'+Y(land[i+1]).toFixed(1)+'" r="3.4" fill="#cde1f0"/>'}
  var placed=countries.filter(function(c){return c.length>=4}),max=placed.length?placed[0][1]:1;
  placed.slice().reverse().forEach(function(c){var r=4+24*Math.sqrt(c[1]/max);s+='<circle class="pin" data-c="'+esc(c[0])+'" data-n="'+c[1]+'" cx="'+X(c[2]).toFixed(1)+'" cy="'+Y(c[3]).toFixed(1)+'" r="'+r.toFixed(1)+'" fill="#0468b1" fill-opacity=".55" stroke="#0468b1" stroke-width="1.5"/>'});
  el.innerHTML=s+'</svg>';
  el.querySelectorAll(".pin").forEach(function(p){p.addEventListener("mousemove",function(ev){showTip('<b>'+p.getAttribute("data-c")+'</b>'+fmt(p.getAttribute("data-n"))+' enrolments',ev.clientX,ev.clientY)});p.addEventListener("mouseleave",hideTip)});
}
function bars(list,known){
  var top=list.slice(0,10),max=top.length?top[0][1]:1;
  return top.map(function(c){return '<div class="bar-row"><div class="bar-l">'+esc(c[0])+'<span><i style="width:'+Math.max(2,c[1]/max*100).toFixed(1)+'%"></i></span></div><div class="bar-n">'+fmt(c[1])+'</div><div class="bar-p">'+(known?(c[1]/known*100).toFixed(1)+'%':'')+'</div></div>'}).join("");
}
function questions(list){
  if(!list||!list.length)return '';
  return '<div class="q-row head"><span>Question</span><span>Average out of 5</span><span class="num">Average</span><span class="num">4 or 5</span></div>'
    +list.map(function(q){return '<div class="q-row"><div class="q-t">'+esc(q.t)+(q.t!==q.q?'<small>'+esc(q.q)+'</small>':'')+'</div><div class="q-bar"><i style="width:'+(q.avg/5*100).toFixed(1)+'%"></i></div><div class="num">'+q.avg.toFixed(2)+'</div><div class="num">'+q.hi+'%</div></div>'}).join("");
}
function quotes(list){return (list||[]).map(function(q){return '<figure class="quote"><blockquote>'+esc(q.t)+'</blockquote><figcaption><b>'+esc(q.w)+'</b>'+(q.c?'<span>'+esc(q.c)+'</span>':'')+'</figcaption></figure>'}).join("")}
function impactStats(I){return [I.time?stat(esc(I.time),"Learning time","Recorded across all learners"):"",I.contentNew?stat(I.contentNew.pct+"%","Found the content new","Of "+fmt(I.contentNew.n)+" who answered"):"",I.willApply?stat(I.willApply.pct+"%","Are likely to apply it at work","Of "+fmt(I.willApply.n)+" who answered"):"",I.careerValue?stat(I.careerValue.pct+"%","Rate it important for their work","Of "+fmt(I.careerValue.n)+" who answered"):""].join("")}

// ── the main page ──
var T=D.totals;
$("stats").innerHTML=[stat(fmt(T.enrol),"Course enrolments","One learner can enrol in several courses"),stat(fmt(T.cert),"Certificates",T.rate?T.rate+"% of enrolments":""),T.countries?stat(fmt(T.countries),"Countries","Where learners gave their country"):"",T.rating?stat(T.rating,"Average rating","Out of 5, from "+fmt(T.resp)+" survey responses"):"",stat(fmt(T.courses),T.courses===1?"Course":"Courses","On SURGhub")].join("");
$("awards").innerHTML=D.awards.map(function(a){return '<span class="tag tag-gold">'+esc(a)+'</span>'}).join("")+(D.firsts.length?'<span class="tag">More learners than any other provider from '+esc(D.firsts.slice(0,6).join(", "))+(D.firsts.length>6?" and "+(D.firsts.length-6)+" more countries":"")+'</span>':"");
growth($("growth"),D.monthly);
if(D.countries.length){$("map-intro").textContent="Learners from "+fmt(D.countries.length)+" countries took your courses. Point at a circle to see the number; the ten largest are listed.";worldMap($("map"),D.countries);$("toplist").innerHTML='<h3>The ten largest</h3>'+bars(D.countries,T.known)+'<p class="note">Country is known for '+fmt(T.known)+' of '+fmt(T.enrol)+' enrolments; shares are of those.</p>'}else $("sec-map").hidden=true;
var I=impactStats(D.impact);if(I)$("impact").innerHTML=I;else $("sec-impact").hidden=true;
if(D.questions.length){$("survey-intro").textContent="Every question with at least three answers, across "+fmt(T.resp)+" survey responses. The bar shows the average out of 5; the last column the share answering 4 or 5.";$("questions").innerHTML=questions(D.questions)}else $("sec-survey").hidden=true;
if(D.summary)$("summary").innerHTML='<div class="summary">'+esc(D.summary)+'<small>A summary of the written answers in the end-of-course surveys.</small></div>';
if(D.quotes.length)$("quotes").innerHTML=quotes(D.quotes);if(!D.summary&&!D.quotes.length)$("sec-voices").hidden=true;

// ── the course table: sortable, each row opens the course page ──
var cols=[{k:"name",t:"Course"},{k:"enrol",t:"Enrolments"},{k:"cert",t:"Certificates"},{k:"rate",t:"Cert. rate"},{k:"rating",t:"Rating"},{k:"resp",t:"Responses"},{k:"spark",t:"Last 12 months"}];
D.courses.forEach(function(c,i){c.i=i;c.rate=c.enrol?c.cert/c.enrol*100:0});
var sortK="enrol",sortDir=-1;
function table(){
  var rows=D.courses.slice().sort(function(a,b){var x=a[sortK],y=b[sortK];if(sortK==="name")return sortDir*String(x).localeCompare(String(y));return sortDir*((x||0)-(y||0))});
  $("ctable").innerHTML='<thead><tr>'+cols.map(function(c){return c.k==="spark"?'<th title="New enrolments in each month">'+c.t+(WIN.length?'<br><span style="font-weight:400;letter-spacing:0;text-transform:none">'+mName(WIN[0])+' to '+mName(WIN[11])+'</span>':'')+'</th>':'<th'+(c.k===sortK?' aria-sort="'+(sortDir>0?"ascending":"descending")+'"':'')+'><button data-k="'+c.k+'">'+c.t+'</button></th>'}).join("")+'</tr></thead><tbody>'
    +rows.map(function(c){return '<tr tabindex="0" data-i="'+c.i+'"><td class="cn">'+esc(c.name)+'</td><td>'+fmt(c.enrol)+'</td><td>'+fmt(c.cert)+'</td><td>'+(c.enrol?c.rate.toFixed(1)+"%":"–")+'</td><td>'+(c.rating?c.rating.toFixed(2):"–")+'</td><td>'+fmt(c.resp)+'</td><td class="sp">'+spark(c.monthly)+'</td></tr>'}).join("")+'</tbody>';
  $("ctable").querySelectorAll("th button").forEach(function(b){b.addEventListener("click",function(ev){ev.stopPropagation();var k=b.getAttribute("data-k");if(k===sortK)sortDir=-sortDir;else{sortK=k;sortDir=k==="name"?1:-1}table()})});
  $("ctable").querySelectorAll("tbody tr").forEach(function(r){var go=function(){location.hash="course-"+r.getAttribute("data-i")};r.addEventListener("click",go);r.addEventListener("keydown",function(ev){if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();go()}})});
}
table();

// ── a course's own page ──
function coursePage(c){
  var rc=c.ratings||[],rate=c.enrol?(c.cert/c.enrol*100).toFixed(1)+"%":"–";
  var h='<section><div class="wrap"><a class="back" href="#">&larr; All courses</a></div></section>'
   +'<section style="padding-top:24px"><div class="wrap"><p class="eyebrow">At a glance</p><h2>This course in numbers</h2>'
   +'<div class="stats" style="margin-top:28px">'+[stat(fmt(c.enrol),"Course enrolments",""),stat(fmt(c.cert),"Certificates",rate+" of enrolments"),c.rating?stat(c.rating.toFixed(2),"Average rating","Out of 5, from "+fmt(c.resp)+" responses"):"",c.time?stat(esc(c.time),"Learning time","Recorded across all learners"):""].join("")+'</div>'
   +(c.awards.length?'<div class="tags">'+c.awards.map(function(a){return '<span class="tag tag-gold">'+esc(a)+'</span>'}).join("")+'</div>':"")+'</div></section>'
   +'<section><div class="wrap"><p class="eyebrow">Growth</p><h2>Enrolments and certificates over time</h2><div class="card"><div id="cgrowth"></div></div></div></section>'
   +(rc.length?'<section><div class="wrap"><p class="eyebrow">Ratings</p><h2>Average rating by month</h2><p class="intro">From the end-of-course survey; the bar height is the number of ratings that month. Point at a bar for the figures.</p><div class="card"><div id="cratings" class="chart"></div></div></div></section>':"")
   +(c.countries.length?'<section><div class="wrap"><p class="eyebrow">Reach</p><h2>Where this course\\'s learners are</h2><div class="card"><div class="two"><div>'+bars(c.countries.slice(0,5),c.known)+'</div><div>'+bars(c.countries.slice(5,10),c.known)+'</div></div><p class="note">Country is known for '+fmt(c.known)+' of '+fmt(c.enrol)+' enrolments; shares are of those.</p></div></div></section>':"")
   +(c.questions.length?'<section><div class="wrap"><p class="eyebrow">Survey insights</p><h2>How learners rate this course</h2><div class="card">'+questions(c.questions)+'</div></div></section>':"")
   +((c.summary||c.quotes.length)?'<section><div class="wrap"><p class="eyebrow">Learner voices</p><h2>What learners say</h2>'+(c.summary?'<div class="summary">'+esc(c.summary)+'<small>A summary of the written answers in this course\\'s survey.</small></div>':"")+'<div class="quotes">'+quotes(c.quotes)+'</div></div></section>':"")
   +'<section><div class="wrap"><a class="back" href="#">&larr; All courses</a></div></section>';
  $("course").innerHTML=h;
  growth($("cgrowth"),c.monthly);
  if(rc.length){var el=$("cratings"),W=1000,H=240,L=48,R=16,Tp=16,B=36,w=W-L-R,hh=H-Tp-B,n=rc.length,mx=1;rc.forEach(function(r){mx=Math.max(mx,r[2])});var bw=Math.max(3,w/n*0.7);
    var s='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Average rating by month">';[1,2,3,4,5].forEach(function(v){var yy=(Tp+hh-v/5*hh).toFixed(1);s+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+yy+'" y2="'+yy+'" stroke="#dee7ef"/><text x="'+(L-10)+'" y="'+yy+'" dy="4" text-anchor="end" font-size="13" fill="#4a6b82">'+v+'</text>'});
    rc.forEach(function(r,i){var cx=L+(n===1?w/2:i*w/(n-1)),hb=Math.max(2,r[2]/mx*hh*0.5);s+='<rect class="rb" data-i="'+i+'" x="'+(cx-bw/2).toFixed(1)+'" y="'+(Tp+hh-hb).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+hb.toFixed(1)+'" fill="#cde1f0"/>';if(r[0].slice(5)==="01"||i===0)s+='<text x="'+cx.toFixed(1)+'" y="'+(H-10)+'" text-anchor="'+(i===0?"start":"middle")+'" font-size="13" fill="#4a6b82">'+(i===0?mName(r[0]):r[0].slice(0,4))+'</text>'});
    s+='<path d="'+rc.map(function(r,i){var cx=L+(n===1?w/2:i*w/(n-1));return(i?"L":"M")+cx.toFixed(1)+" "+(Tp+hh-r[1]/5*hh).toFixed(1)}).join(" ")+'" fill="none" stroke="#0468b1" stroke-width="3"/></svg>';
    el.innerHTML=s;el.querySelectorAll(".rb").forEach(function(b){var r=rc[+b.getAttribute("data-i")];b.addEventListener("mousemove",function(ev){showTip("<b>"+mName(r[0],true)+"</b>Average "+r[1].toFixed(2)+" out of 5, from "+fmt(r[2])+" ratings",ev.clientX,ev.clientY)});b.addEventListener("mouseleave",hideTip)})}
}
function route(){
  var m=String(location.hash).match(/^#course-(\\d+)$/),c=m?D.courses[+m[1]]:null;
  hideTip();
  if(c){coursePage(c);$("main").hidden=true;$("course").hidden=false;$("hero-title").textContent=c.name;$("hero-lead").textContent="A course by "+D.name+" on SURGhub, the UN Global Surgery Learning Hub. Figures to "+D.asOf+".";window.scrollTo(0,0)}
  else{var was=!$("course").hidden;$("course").hidden=true;$("main").hidden=false;$("hero-title").textContent=D.name;$("hero-lead").textContent="Your courses on SURGhub, the UN Global Surgery Learning Hub. Figures to "+D.asOf+".";if(was){var t=$("ctable");if(t)t.scrollIntoView()}}
}
window.addEventListener("hashchange",route);route();
})();`;
    },
});
