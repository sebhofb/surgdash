// ── Partner dashboard in the GSF design (Nov 2026) ───────────────────────────────────────
//
// A provider's web report built from scratch on the Global Surgery Foundation Design System,
// to read like the GSF website's inner pages (the About page): a sticky navy bar with gold links,
// a deep-navy header (#0d233a) with a slanted foot, where the globe of connections (arcs from
// Geneva to where the learners are) fades in from the right in place of the website's photograph
// and the SURGhub and provider logos sit side by side; plain large figures without boxes (like
// the website's "9 in 10"), each opening a dialog that explains it; Arial Bold throughout; the
// brand accents (gold, orange, pink, green) beside the blues. Seb (3 Nov 2026): "too blue", no
// Arial Black for subheadings, no photograph, no boxes with a coloured line above.
//
// One self-contained page (images inline, no outside scripts, readable on a phone). The figures
// are prepared here into one DATA object; a small script in the page draws the header globe,
// the interactive growth chart (hover, enrolments/certificates on and off, monthly numbers), the
// world map, the sortable course table and a detail page per course (#course-<n>).
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
        const logoWhite = this._prImage('gsf_logo_white_web.png');
        // the header logos, made small enough not to weigh the page down
        const thumb = async (uri) => (uri && this._pdThumb) ? this._pdThumb(uri) : uri;
        const shLogo = await thumb(this._prImage('surghub_logo_color.png'));
        const provLogo = await thumb(this._prProviderLogo(providerName));
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

        // Course labels as on surghub.org (coursesFeed.js), and when each course was featured.
        let feed = null;
        try { if (this._cfLoad) await this._cfLoad(); feed = this.coursesFeedBuild ? this.coursesFeedBuild() : null; } catch (e) { __swallowed(e, 'pr.labels'); }
        const tagsById = {}; ((feed && feed.courses) || []).forEach(c => { tagsById[c.id] = c.tags || []; });
        const cfMeta = (this._cfMeta && this._cfMeta.byId) || {};
        const awardOf = (a) => ({ k: a.key, r: a.rank, n: a.total, v: a.valueFmt || '' });
        const si = D.surveyImpact || {};
        const pick = (x) => x ? { pct: x.pct, n: x.n } : null;
        const courses = (D.coursesSorted || []).filter(c => c && c.Course).map(c => {
            let qs = []; try { qs = JSON.parse(c.QuestionStats || '[]') || []; } catch (e) { qs = []; }
            const cc = (D.courseCountryData || {})[c.Course];
            const rt = (D.courseRatings || {})[c.Course] || {};
            const sm = D.fbSummaries && D.fbSummaries[c.Course] && D.fbSummaries[c.Course].s;
            return {
                name: c.Course, enrol: Number(c.Learners) || 0, cert: Number(c.Certificates) || 0, rating: Number(c.Rating) > 0 ? +Number(c.Rating).toFixed(2) : 0,
                resp: Number(c.Responses) || 0, time: lt(c.LearningMinutes), min: Math.round(Number(c.LearningMinutes) || 0),
                monthly: this._prMonthly((D.courseTimelines || {})[c.Course], through),
                countries: cc && cc.top10 ? cc.top10.slice(0, 10) : [], known: cc ? (cc.totalWithCountry || 0) : 0,
                ratings: Object.keys(rt).filter(m => (!through || m <= through) && rt[m].count > 0).sort().map(m => [m, +(rt[m].sum / rt[m].count).toFixed(2), rt[m].count]),
                questions: this._prQuestions(qs),
                quotes: (quotesByCourse[c.Course] || []).map(f => quoteOf(f, '')).filter(q => q.t.length >= 25).slice(0, 6),
                summary: sm ? String(sm) : '',
                awards: ((D.courseAwardMap || {})[c.Course] || []).map(awardOf),
                tags: (tagsById[c.CourseId] || []).filter(t => t !== 'Free' && t !== 'Featured'),
                featured: ((cfMeta[c.CourseId] && cfMeta[c.CourseId].featured) || []).filter(f => f && f.from).map(f => [String(f.from).slice(0, 10), f.to ? String(f.to).slice(0, 10) : '']),
            };
        });
        // Learner stories from the blog that mention one of these courses (js/learnerStories.js). Public
        // stories told with the learner's consent, so the name stays; never passed through scrubPersonal.
        if (this._lsLoad) { try { await this._lsLoad(); } catch (e) { __swallowed(e, 'pr.stories'); } }
        const courseIdx = {}; (D.coursesSorted || []).filter(c => c && c.Course).forEach((c, i) => { if (c.CourseId) courseIdx[c.CourseId] = i; });
        const stories = (this.lsList ? this.lsList(Object.keys(courseIdx)) : []).map(st => {
            const on = (st.courses || []).filter(id => courseIdx[id] != null).map(id => courseIdx[id]);
            on.forEach(i => { if (courses[i]) (courses[i].stories = courses[i].stories || []).push(st.id); });
            return { id: st.id, t: st.title, n: st.name, r: st.role, w: [st.city, st.country].filter(Boolean).join(', '), s: st.summary, q: st.quote, u: /^https:\/\//.test(st.url || '') ? st.url : '', i: /^https:\/\//.test(st.image || '') ? st.image : '', c: on };
        });
        let cats = [];
        try { const aw = this.computeAwards ? this.computeAwards() : null; cats = ((aw && aw.categories) || []).map(c => ({ k: c.key, p: !!c.providerOnly })); } catch (e) { __swallowed(e, 'pr.awards'); }

        // The dated records behind a chosen period: [course, enrolment day, certificate day, country],
        // days counted from 1 Jan 1970 (-1 = none). No ids, names or emails: the email only finds the
        // country, as for the quotes. The course is matched by name, as the records carry no id.
        const dayOf = (v) => { const t = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? Math.round(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10)) / 86400000) : -1; };
        const today = new Date(), todayN = Math.round(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000);
        const normC = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const byName = {}; courses.forEach((c, i) => { const k = normC(c.name); if (byName[k] == null) byName[k] = i; });
        const demo = this._emailDemoMap || {}, rc = [], rcIdx = {}, recs = [];
        let dMin = Infinity, dMax = -1;
        (Array.isArray(this._rawCompletion) ? this._rawCompletion : []).forEach(r => {
            const i = r ? byName[normC(r.course)] : null; if (i == null) return;
            let e = dayOf(r.enrolled_date || r.start_date), c = r.certificate ? dayOf(r.certificate_date) : -1;
            if (e > todayN) e = -1; if (c > todayN) c = -1;
            if (e < 0 && c < 0) return;
            const dm = r.email ? demo[String(r.email).trim().toLowerCase()] : null, cn = dm && dm.country ? String(dm.country).trim() : '';
            let k = -1; if (cn && !/^(unknown|nan|n\/a)$/i.test(cn)) { if (rcIdx[cn] == null) { rcIdx[cn] = rc.length; rc.push(cn); } k = rcIdx[cn]; }
            recs.push([i, e, c, k]);
            [e, c].forEach(d => { if (d >= 0) { dMin = Math.min(dMin, d); dMax = Math.max(dMax, d); } });
        });
        const dStr = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
        const cpos = {}; rc.forEach(n => { const p = cent[toIso(n)]; if (p) cpos[n] = [p[0], p[1]]; });
        // the average rating by month across the provider's courses: [[month, average, ratings]]
        const rm = {};
        Object.values(D.courseRatings || {}).forEach(rt => Object.keys(rt || {}).forEach(m => { if (through && m > through) return; const v = rt[m]; if (!v || !(v.count > 0)) return; const o = rm[m] || (rm[m] = { s: 0, n: 0 }); o.s += Number(v.sum) || 0; o.n += v.count; }));
        const ratingsByMonth = Object.keys(rm).sort().map(m => [m, +(rm[m].s / rm[m].n).toFixed(2), rm[m].n]);

        const DATA = {
            name, asOf, through, updated: dStr(todayN), dataTo: dMax >= 0 ? dStr(dMax) : '', dataFrom: dMin < Infinity ? dStr(dMin) : '',
            totals: { enrol: D.totalLrn, cert: D.totalCert, rate: D.certRate, rating: Number(D.avgRating) > 0 ? Number(D.avgRating).toFixed(2) : '', resp: D.totalResp, time: lt(D.totalMin), min: Math.round(Number(D.totalMin) || 0), courses: courses.length, countries: countries.length, known },
            monthly: this._prMonthly(D.provTimeline, through),
            countries, land: G.LAND || '[]',
            impact: { time: lt(D.totalMin), contentNew: pick(si.contentNew), willApply: pick(si.willApply), careerValue: pick(si.careerValue) },
            questions: this._prQuestions(D.surveyQRows),
            summary: (D.fbSummaries && D.fbSummaries['@provider:' + providerName] && D.fbSummaries['@provider:' + providerName].s) || '',
            quotes: allQuotes.filter(q => q.t.length >= 25).slice(0, 6),
            courses, stories, recs, rc, cpos, ratings: ratingsByMonth,
            awards: (D.providerAwards || []).map(awardOf), cats, awAsOf: this._currentQuarterLabel ? this._currentQuarterLabel() : '',
            caw: (D.providerCountryAwards || []).map(c => ({ c: c.country, r: c.rank, n: c.learners, t: c.total })),
        };
        const json = JSON.stringify(DATA).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

        const updatedLong = this._prLastDay ? new Date(todayN * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
        const lead = 'Your courses on SURGhub.<span class="lead-sub">Updated about once a week; last updated ' + esc(updatedLong) + '<span class="upd-age"></span>.</span>';
        const sec = (id, tone, eyebrow, title, body) => `<section id="${id}" class="${tone}"><div class="wrap"><p class="eyebrow">${eyebrow}</p><h2>${title}</h2>${body}</div></section>`;
        return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><title>${esc(name)} on SURGhub</title><style>${this._prCss()}</style></head><body>
<a class="skip" href="#main">Skip to the figures</a>
<header class="top"><div class="wrap">
  <a class="brand" href="#">${logoWhite ? '<img src="' + logoWhite + '" alt="Global Surgery Foundation">' : '<b>Global Surgery Foundation</b>'}</a>
  <nav aria-label="Sections" id="nav"><a href="#sec-numbers">Overview</a><a href="#sec-growth">Growth</a><a href="#sec-map">Reach</a><a href="#sec-impact">Impact</a><a href="#sec-survey">Survey</a><a href="#sec-voices">Voices</a><a href="#sec-courses">Courses</a><a href="#sec-downloads">Downloads</a></nav>
</div></header>
<div class="hero"><svg class="globe" id="globe" aria-hidden="true" focusable="false"></svg><div class="hero-fade"></div><div class="wrap hero-in">
  <div class="hero-text">
    <p class="eyebrow">SURGhub partner dashboard</p>
    <h1 id="hero-title">${esc(name)}</h1>
    <p class="lead" id="hero-lead">${lead}</p>
    <p class="actions" id="hero-actions"><a class="btn" href="#sec-courses">See your courses</a></p>
  </div>
  <div class="logos">${shLogo ? '<img src="' + shLogo + '" alt="SURGhub, the UN Global Surgery Learning Hub">' : '<b>SURGhub</b>'}${provLogo ? '<span class="sep" aria-hidden="true"></span><img src="' + provLogo + '" alt="' + esc(name) + '">' : ''}</div>
</div></div>
<div id="period" class="period" role="region" aria-label="Period"></div>

<main id="main">
<section id="sec-numbers" class="lift"><div class="wrap">
  <div data-pw></div><div class="stats" id="stats"></div><ul class="tags" id="awards"></ul><p class="aw-all" id="awards-all"></p>
  <p class="note" id="numbers-note"></p>
</div></section>
${sec('sec-growth', '', 'Growth', 'Enrolments and certificates over time', '<div data-pw></div><p class="intro" id="growth-intro"></p><div class="card"><div id="growth"></div></div>')}
${sec('sec-map', 'band', 'Reach', 'Where your learners are', '<div data-pw></div><p class="intro" id="map-intro"></p><div class="card map-card"><div id="map"></div><div id="toplist"></div></div>')}
${sec('sec-impact', 'dark', 'Learning impact', 'What the learning changes', '<p class="intro">From the survey at the end of each course: the share of learners answering 4 or 5 on a scale of 1 to 5. Choose a figure for the question behind it.</p><div class="stats" id="impact"></div><p class="note" id="impact-note" hidden>All time: the survey questions are not broken down by period.</p>')}
${sec('sec-survey', '', 'Survey insights', 'How learners rate the courses', '<div data-pw></div><div class="big2" id="survey-big"></div><div class="card" id="ratings-box"><h3>Average rating by month</h3><p class="note" style="margin:0 0 16px">From the end-of-course survey. The height of a dot is the average for the month; its size, how many ratings it rests on. Point at the chart to read a month.</p><div id="ratings" class="chart"></div></div><p class="intro" id="survey-intro" style="margin-top:32px"></p><div class="card"><div id="questions"></div></div>')}
${sec('sec-voices', 'band warm', 'Learner voices', 'What learners say', '<div id="voices"></div><div id="stories"></div>')}
${sec('sec-courses', '', 'Courses', 'Course by course', '<div data-pw></div><p class="intro">Choose a column to sort; choose a course to see its own page.</p><div class="card table-card"><div class="table-scroll"><table class="ctable" id="ctable"></table></div><div class="t-foot" id="labels-all"></div></div>')}

<!--SH-DOWNLOADS-->

${sec('sec-notes', 'band', 'About these figures', 'How we count', `<div class="notes">
    <p><b>Course enrolments</b> count every enrolment in your courses, whether or not the learner has started. One person who takes two of your courses counts twice.</p>
    <p><b>Certificates</b> are the course certificates learners earned. The certification rate is certificates divided by enrolments.</p>
    <p><b>Countries</b> come from what learners give in their SURGhub profile; not every learner gives one. The map places each country at its centre.</p>
    <p><b>Ratings and survey answers</b> come from the survey at the end of each course. Quotes are shown as learners wrote them, without names.</p>
    <p><b>Updated about once a week.</b> Last updated ${esc(updatedLong)}<span class="upd-age"></span>. The monthly charts run to the end of the last full month (${esc(asOf)}). The figures come from SURGhub and are prepared by the Global Surgery Foundation with SURGdash.</p>
    <p>Questions about this dashboard: <a href="mailto:info@globalsurgeryfoundation.org">info@globalsurgeryfoundation.org</a></p>
  </div>
  <p style="margin-top:20px"><a class="btn sec" href="#methodology">Read the full methodology &rarr;</a></p>`)}
</main>

<main id="page" hidden></main>

<footer><div class="wrap">
  <div class="f-brand"><b>SURGhub, the UN Global Surgery Learning Hub</b><p>SURGhub is a joint initiative of the Global Surgery Foundation (GSF) and UNITAR (United Nations Institute for Training and Research), supported by the Royal College of Surgeons in Ireland (RCSI), and implemented in association with the Johnson &amp; Johnson Foundation.</p></div>
  <div class="f-col"><b>On this page</b><a href="#sec-numbers">Overview</a><a href="#sec-map">Reach</a><a href="#sec-courses">Courses</a><a href="#sec-downloads">Downloads</a><a href="#sec-notes">How we count</a><a href="#methodology">Methodology</a></div>
  <div class="f-col"><b>Contact</b><a href="mailto:info@globalsurgeryfoundation.org">info@globalsurgeryfoundation.org</a><a href="https://www.globalsurgeryfoundation.org">globalsurgeryfoundation.org</a><a href="https://www.surghub.org">surghub.org</a></div>
</div><div class="wrap f-small">Updated about once a week; last updated ${esc(updatedLong)}<span class="upd-age"></span>. This page is private to you; please do not share the link or password.</div></footer>
<dialog id="info" class="info" aria-labelledby="info-t"><div class="info-in"><button class="x" id="info-x" aria-label="Close">&times;</button><p class="eyebrow" id="info-e"></p><h3 id="info-t"></h3><div class="info-v" id="info-v"></div><div id="info-b"></div></div></dialog>
<div id="tip" class="tip" hidden></div>
<script>var DATA=${json};
${this._prScript()}<\/script>
</body></html>`;
    },

    _prCss() {
        return `
:root{--blue:#0468b1;--blue-h:#035c9d;--navy:#002f4c;--light:#91b5d9;--tint:#e6f0f8;--paper:#f3f7fb;--line:#dee7ef;--line2:#cde1f0;--gold:#ffc145;--orange:#ff9734;--orange-d:#e07412;--pink:#de3a8d;--green:#5d9e1c;--muted:#4a6b82;--warm:#fff8ec;--deep:#0d233a}
*{box-sizing:border-box}[hidden]{display:none!important}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:#fff;color:var(--navy);font:16px/1.55 Arial,"Helvetica Neue",Helvetica,sans-serif}
.wrap{max-width:1200px;margin:0 auto;padding:0 24px}
a{color:var(--blue)}a:hover{text-decoration:underline}
.skip{position:absolute;left:-9999px;top:8px;background:var(--gold);color:var(--navy);padding:8px 14px;border-radius:9px;font-weight:700;z-index:100}.skip:focus{left:16px}
.top{position:sticky;top:0;z-index:40;background:var(--deep)}
.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:24px;height:72px}
.brand img{height:42px;width:auto;display:block}
.top nav{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}.top nav::-webkit-scrollbar{display:none}
.top nav a{font-size:15px;letter-spacing:.03em;text-transform:uppercase;color:var(--gold);text-decoration:none;padding:8px 10px;white-space:nowrap;text-underline-offset:6px}
.top nav a:hover{color:#fff}.top nav a.on{text-decoration:underline;text-decoration-thickness:2px}
.hero{position:relative;overflow:hidden;color:#fff;background:radial-gradient(ellipse 50% 90% at 82% 50%,#1e4a73 0,#0d233a 75%);clip-path:polygon(0 0,100% 0,100% 100%,0 calc(100% - 22px))}
.hero-fade{position:absolute;inset:0;background:linear-gradient(90deg,#0d233a 0,#0d233a 36%,rgba(13,35,58,.6) 60%,rgba(13,35,58,.35) 100%),linear-gradient(0deg,rgba(13,35,58,.5) 0,rgba(13,35,58,0) 40%);pointer-events:none}
.globe{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;opacity:.7}
.hero-in{position:relative;display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:40px;align-items:center;padding-top:96px;padding-bottom:110px}
.eyebrow{font-size:16px;color:var(--blue);margin:0 0 8px}
.hero .eyebrow{color:var(--gold)}
.hero h1{font-weight:700;font-size:56px;line-height:1.08;letter-spacing:-.01em;margin:0;color:#fff}
.hero p.lead{font-size:19px;line-height:1.5;color:rgba(255,255,255,.88);max-width:560px;margin:16px 0 0}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:28px;margin:30px 0 0}
.hero .btn{background:var(--gold);border-color:var(--gold);color:var(--navy)}.hero .btn:hover{background:#ffcf6e;border-color:#ffcf6e}
.link{color:#fff;font-weight:700;font-size:16px;text-decoration:underline;text-underline-offset:5px}.link:hover{color:var(--gold)}
.logos{justify-self:end;align-self:center;display:flex;align-items:center;gap:28px;background:#fff;border-radius:12px;box-shadow:0 16px 36px rgba(0,20,40,.28);padding:24px 32px}
.logos img{height:76px;width:auto;max-width:220px;object-fit:contain;display:block}.logos b{font-size:28px}
.logos .sep{width:1px;align-self:stretch;background:var(--line2)}
section{padding:72px 0;scroll-margin-top:72px}
section.band{background:var(--paper)}section.warm{background:var(--warm)}
section.dark{background:var(--deep);color:#fff}section.dark h2{color:#fff}section.dark .intro{color:rgba(255,255,255,.8)}section.dark .eyebrow{color:var(--gold)}
section.lift{padding-top:64px;padding-bottom:8px}
h2{font-weight:700;font-size:32px;line-height:1.2;letter-spacing:-.005em;color:var(--navy);margin:0 0 10px}
h3{font-weight:700;font-size:19px;line-height:1.25;margin:0 0 12px;color:var(--navy)}
.intro{font-size:17px;color:var(--muted);max-width:760px;margin:0 0 32px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:20px}
.stat{all:unset;box-sizing:border-box;display:flex;flex-direction:column;padding:24px 24px 20px;border-radius:12px;background:var(--paper);border:1px solid var(--line2);cursor:pointer;color:var(--navy);transition:background .15s,border-color .15s}
.stat:hover{background:var(--tint);border-color:var(--light)}.stat:focus-visible{box-shadow:0 0 0 2px #002f4c,0 0 0 5px #ffc145}
.stat-v{font-weight:700;font-size:46px;line-height:1;letter-spacing:-.01em;white-space:nowrap;color:var(--blue)}
.stat-l{margin-top:12px;font-size:17px;line-height:1.35}
.stat-s{margin-top:4px;font-size:14px;line-height:1.4;color:var(--muted)}
section.dark .stat{color:#fff;background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.2)}section.dark .stat:hover{background:rgba(255,255,255,.11);border-color:rgba(255,255,255,.35)}
section.dark .stat-v{color:var(--gold)}section.dark .stat-s{color:rgba(255,255,255,.75)}
.tags{list-style:none;display:flex;flex-wrap:wrap;gap:24px 64px;margin:48px 0 0;padding:0}.tags:empty{display:none}
.tags li{display:flex;align-items:flex-start;gap:10px;font-size:16px;line-height:1.4;color:var(--navy);max-width:560px}
.tags svg{flex:none;width:22px;height:22px;margin-top:-1px;fill:none;stroke:var(--orange-d);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 1px 3px rgba(0,47,76,.08),0 1px 2px rgba(0,47,76,.06);padding:28px}
.toggles{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}
.tg{display:inline-flex;align-items:center;gap:8px;font:700 14px Arial,sans-serif;padding:7px 14px;border-radius:999px;border:2px solid var(--line2);background:#fff;color:var(--muted);cursor:pointer}
.tg i{display:inline-block;width:14px;height:4px;border-radius:2px}
.tg[aria-pressed="true"]{border-color:var(--navy);color:var(--navy);background:var(--paper)}
.chart{position:relative}.chart svg{width:100%;height:auto;display:block;touch-action:pan-y}
.tip{position:fixed;z-index:60;pointer-events:none;background:var(--navy);color:#fff;border-radius:9px;padding:10px 12px;font-size:13px;line-height:1.45;box-shadow:0 12px 28px rgba(0,47,76,.14);max-width:280px}
.tip b{display:block;font-size:14px;margin-bottom:2px}
.map-card{display:grid;grid-template-columns:minmax(0,2fr) minmax(240px,1fr);gap:28px;align-items:start}
.bar-row{display:grid;grid-template-columns:minmax(0,1fr) 64px 46px;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line);font-size:14px}
.bar-l{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar-l span{display:block;background:var(--tint);border-radius:3px;height:6px;margin-top:5px}.bar-l span i{display:block;height:6px;border-radius:3px;background:var(--blue)}
.bar-n{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}.bar-p{text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
.note{font-size:13px;color:var(--muted);margin:14px 0 0}
.q-row{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(120px,1fr) 64px 64px;gap:16px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line);font-size:14px}
.q-row:last-child{border-bottom:0}.q-row.head{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);padding-top:0}
.q-t{font-weight:700}.q-t small{display:block;font-weight:400;color:var(--muted);margin-top:2px}
.q-bar{background:var(--tint);border-radius:4px;height:10px}.q-bar i{display:block;height:10px;border-radius:4px;background:var(--green)}
.num{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
.summary{font-family:Georgia,"Times New Roman",serif;font-size:19px;line-height:1.65;max-width:820px}
.more{all:unset;cursor:pointer;font:700 15px Arial,sans-serif;color:var(--blue);text-decoration:underline;text-underline-offset:4px}.more:focus-visible{box-shadow:0 0 0 2px #002f4c,0 0 0 5px #ffc145;border-radius:4px}
.summary .more{margin-left:6px}.quotes-more{margin-top:24px}
.big2{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:0 0 20px}
.big{background:var(--paper);border:1px solid var(--line2);border-radius:12px;padding:30px 32px;display:flex;align-items:center;gap:28px}
.big-v{font-weight:700;font-size:72px;line-height:1;letter-spacing:-.02em;color:var(--blue);white-space:nowrap}.big-v small{font-size:24px;color:var(--muted);font-weight:700;margin-left:4px}
.big-l{font-size:18px;font-weight:700;line-height:1.35}.big-s{margin-top:4px;font-size:14px;color:var(--muted)}
.stars{display:flex;gap:4px;margin-top:10px}.stars svg{width:24px;height:24px}
.share{margin-top:12px;height:12px;border-radius:6px;background:#fff;border:1px solid var(--line2);overflow:hidden;max-width:260px}.share i{display:block;height:100%;background:var(--green)}
.summary small{display:block;margin-top:12px;font-family:Arial,sans-serif;font-size:13px;color:var(--muted)}
.quotes{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;margin-top:28px}
.quote{margin:0;background:#fff;border-radius:12px;padding:28px}
.quote blockquote{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:17px;line-height:1.65;color:var(--navy)}
.quote blockquote:before{content:"\\201C";display:block;font-family:Georgia,serif;font-size:56px;line-height:.6;color:var(--orange);margin-bottom:10px}
.stories h3{font-size:22px;margin:56px 0 6px}.stories>p{color:var(--muted);margin:0 0 24px}
.story-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:24px}
.story{display:flex;flex-direction:column;background:#fff;border-radius:12px;overflow:hidden;color:var(--navy);text-decoration:none;border:1px solid var(--line)}
a.story:hover{text-decoration:none;box-shadow:0 12px 28px rgba(0,47,76,.12)}a.story:hover .story-go{text-decoration:underline}
.story-img{aspect-ratio:16/9;background:var(--tint) center/cover no-repeat}
.story-in{padding:22px 24px 24px;display:flex;flex-direction:column;flex:1}
.story-t{font-weight:700;font-size:19px;line-height:1.3}.story-who{margin-top:6px;font-size:14px;color:var(--muted)}
.story-s{margin:12px 0 0;font-size:15px;line-height:1.55}.story-q{margin:14px 0 0;font-family:Georgia,"Times New Roman",serif;font-size:16px;line-height:1.55;color:var(--navy)}.story-q:before{content:"\\201C"}.story-q:after{content:"\\201D"}
.story-c{margin-top:14px;font-size:13px;color:var(--muted)}.story-c b{color:var(--navy)}.story-go{margin-top:auto;padding-top:16px;font-weight:700;color:var(--blue);font-size:15px}
.quote figcaption{margin-top:16px;font-size:14px}.quote figcaption b{display:block}.quote figcaption span{display:block;color:var(--muted);margin-top:2px}
.table-card{padding:8px 0 0}.table-scroll{overflow-x:auto}
.ctable{width:100%;border-collapse:collapse;font-size:14px;min-width:760px}
.ctable th{text-align:right;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);padding:12px 14px;border-bottom:2px solid var(--line2);white-space:nowrap}
.ctable th:first-child,.ctable td:first-child{text-align:left}
.ctable th button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:4px}.ctable th button:focus-visible{box-shadow:0 0 0 2px #002f4c,0 0 0 5px #ffc145;border-radius:4px}
.ctable th[aria-sort] button{color:var(--navy)}.ctable th button:after{content:"\\2195";font-size:11px;opacity:.45}
.ctable th[aria-sort="ascending"] button:after{content:"\\2191";opacity:1;color:var(--orange-d)}.ctable th[aria-sort="descending"] button:after{content:"\\2193";opacity:1;color:var(--orange-d)}
.ctable td{padding:9px 14px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;vertical-align:middle}
.ctable tbody tr{cursor:pointer}.ctable tbody tr:hover{background:var(--warm)}.ctable tbody tr:focus-visible{outline:none;box-shadow:inset 0 0 0 2px var(--blue)}
.ctable td.cn{white-space:normal;font-weight:700;color:var(--blue);min-width:260px}
.ctable td.sp{width:150px}.spark{display:block;width:132px;height:30px;margin-left:auto}
.dl{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.btn{display:inline-flex;align-items:center;gap:8px;font:700 15px Arial,sans-serif;padding:11px 22px;border-radius:9px;border:2px solid var(--blue);background:var(--blue);color:#fff;cursor:pointer;text-decoration:none}
.btn:hover{background:var(--blue-h);border-color:var(--blue-h);text-decoration:none}.btn.sec{background:#fff;color:var(--blue)}.btn.sec:hover{background:var(--tint)}
.btn:focus-visible,a:focus-visible,.tg:focus-visible,.x:focus-visible{outline:none;box-shadow:0 0 0 2px #002f4c,0 0 0 5px #ffc145}
.back{display:inline-flex;align-items:center;gap:6px;font-weight:700}
.two{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.notes{columns:2;column-gap:40px;font-size:14px}.notes p{margin:0 0 12px;break-inside:avoid}
.info{border:0;padding:0;border-radius:12px;max-width:560px;width:calc(100% - 32px);color:var(--navy);box-shadow:0 24px 60px rgba(0,47,76,.3)}
.info::backdrop{background:rgba(0,47,76,.55)}
.info-in{position:relative;padding:28px 32px 30px}
.info h3{font-size:24px;margin:0 0 8px;padding-right:32px}.info-v{font-weight:700;font-size:34px;line-height:1.1;margin:4px 0 16px}
.info p{margin:0 0 12px;font-size:15px;line-height:1.6}.info ul{margin:0 0 12px;padding-left:20px;font-size:15px}.info li{margin:3px 0}
.info .fact{display:grid;grid-template-columns:1fr auto;gap:12px;padding:8px 0;border-top:1px solid var(--line);font-size:15px}.info .fact b{font-variant-numeric:tabular-nums}
.x{position:absolute;top:16px;right:16px;width:36px;height:36px;border-radius:50%;border:0;background:var(--paper);color:var(--navy);font-size:24px;line-height:36px;cursor:pointer}.x:hover{background:var(--tint)}
footer{background:var(--deep);color:#fff}footer .wrap{display:grid;grid-template-columns:minmax(0,2fr) 1fr 1fr;gap:40px;padding-top:56px;padding-bottom:32px}
.f-brand b{display:block;font-size:17px;margin-bottom:10px}footer p{margin:0;font-size:14px;line-height:1.6;color:rgba(255,255,255,.8);max-width:460px}
.f-col{display:flex;flex-direction:column;gap:8px;font-size:14px}.f-col b{color:var(--gold);font-size:13px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px}.f-col a{color:#fff;text-decoration:none}.f-col a:hover{text-decoration:underline}
footer .f-small{display:block;padding-top:20px;padding-bottom:28px;border-top:1px solid rgba(255,255,255,.15);font-size:13px;color:rgba(255,255,255,.65)}
.period{position:sticky;top:72px;z-index:30;background:#fff;border-bottom:1px solid var(--line);box-shadow:0 6px 16px rgba(0,47,76,.06)}
.pb{display:flex;flex-wrap:wrap;align-items:center;gap:10px 20px;padding-top:12px;padding-bottom:12px;font-size:14px}
.pb label{display:inline-flex;align-items:center;gap:8px;font-weight:700}
.pb select,.pb input{font:15px Arial,sans-serif;color:var(--navy);border:1px solid var(--line2);border-radius:9px;padding:7px 10px;background:#fff}
.pb select:focus-visible,.pb input:focus-visible{outline:none;box-shadow:0 0 0 2px #002f4c,0 0 0 5px #ffc145}
#p-dates{display:inline-flex;gap:12px;flex-wrap:wrap}.p-now{color:var(--muted);margin-left:auto}
.stat-d{margin-top:6px;font-size:13px;color:var(--muted)}.up{color:#2f7a14;font-weight:700}.down{color:#c0392b;font-weight:700}
section.dark .up{color:#9be06b}section.dark .down{color:#ff9b8f}
.legend-cmp{display:inline-flex;align-items:center;gap:8px;font-size:14px;color:var(--muted);margin-left:6px}.legend-cmp i{width:22px;border-top:2px dashed var(--muted)}
.tags li b{display:block}.tags li small{display:block;font-size:13px;color:var(--muted);margin-top:2px}.tags .medal{flex:none;width:30px;height:30px;margin-top:-2px;stroke:none;fill:initial}
.aw-all{margin:28px 0 0}.aw-all:empty{display:none}#numbers-note{margin-top:32px}
.aw-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 28px}
.aw-cell{display:grid;grid-template-columns:38px 1fr;gap:10px;align-items:start;padding:12px 0;border-top:1px solid var(--line)}.aw-cell b{font-size:15px}.aw-cell p{margin:3px 0 0;font-size:13.5px;line-height:1.5;color:var(--muted)}
.aw-cell .aw-won{display:block;margin-top:2px}.aw-cell:not(.won) b{color:var(--muted)}
.info.wide{max-width:920px}.info h4{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--blue);margin:22px 0 4px}
.lb-row{display:grid;grid-template-columns:minmax(150px,auto) 1fr;gap:14px;align-items:start;padding:12px 0;border-top:1px solid var(--line)}.lb-row p{margin:0;font-size:14.5px}.lb-row.on{background:var(--warm);margin:0 -12px;padding:12px}
.t-foot{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:14px 16px;border-top:1px solid var(--line);background:var(--paper);border-radius:0 0 12px 12px}.t-foot:empty{display:none}.t-foot .lb-t{font-size:13px;font-weight:700;color:var(--muted);margin-right:4px}.t-foot .more{margin-left:6px;font-size:14px}
.badge.static{cursor:default}.badge.static:hover{border-color:var(--line2)}
.rk{display:flex;flex-wrap:wrap;align-items:center;gap:8px 22px;margin-top:10px;font-size:13px;color:var(--muted)}.rk span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.rk-t{font-weight:700;color:var(--navy)}
.rk-a i{display:inline-block;width:22px;border-top:2px dashed #e07412}
.hero .lead-sub{display:block;margin-top:10px;font-size:15px;color:rgba(255,255,255,.62)}
.pwarn{display:inline-flex;align-items:center;flex-wrap:wrap;gap:8px 12px;margin:0 0 20px;padding:8px 12px;border-radius:9px;background:#fff3d6;border:1px solid #f3cf7a;font-size:14px;color:var(--navy)}
.pwarn svg{width:16px;height:16px;fill:none;stroke:#9a6b00;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}
.pwarn button{all:unset;cursor:pointer;font-weight:700;color:var(--blue);text-decoration:underline;text-underline-offset:3px}.pwarn button:focus-visible{box-shadow:0 0 0 2px #002f4c,0 0 0 5px #ffc145;border-radius:3px}
[data-pw]:empty{display:none}
.aw-row{display:grid;grid-template-columns:40px 1fr;gap:12px;align-items:start;padding:12px 0;border-top:1px solid var(--line)}.aw-row p{margin:2px 0 4px;font-size:14px;color:var(--muted)}.aw-row b{font-size:15px}
.aw-c{padding:8px 0}.aw-won{font-size:14px;font-weight:700;color:var(--navy)}.aw-not{font-size:14px;color:var(--muted)}
.info h4{font-size:17px;margin:20px 0 4px}.info{max-width:640px}
.badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.badge{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;line-height:1;padding:5px 8px;border-radius:6px;border:1px solid var(--line2);color:var(--navy);background:#fff;white-space:nowrap}
.badge svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.badge:hover{border-color:var(--blue)}.badge:focus-visible{box-shadow:0 0 0 2px #002f4c,0 0 0 5px #ffc145}
.b-megaphone{background:#fff3d6;border-color:#f3cf7a}.b-flame{color:#b5530a}.b-trend{color:#2f7a14}.b-star{color:#9a6b00}.b-spark{color:var(--blue)}.b-cap{color:#6b3fa0}
.c-badges .badges{margin-top:14px}.cn-t{display:block}
.m-h3{font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--blue);margin:24px 0 6px}
.m-rows{max-width:860px}.m-row{display:grid;grid-template-columns:40px 1fr;gap:12px;align-items:start;padding:12px 0;border-top:1px solid var(--line)}.m-row p{margin:2px 0 0;font-size:15px;color:var(--muted)}.m-row b{font-size:16px}
.m-ic{display:flex;justify-content:center;padding-top:1px}.m-sec .lb-row{max-width:860px}.m-sec .lb-row p{font-size:15px}
.m-medals{display:flex;flex-wrap:wrap;gap:14px 36px;margin:4px 0 16px}.m-medals span{display:inline-flex;align-items:center;gap:8px;font-size:16px}
.m-ex{margin:6px 0 18px}.m-fake{font-weight:700;color:var(--blue);text-decoration:underline;text-underline-offset:3px}
.m-stars .stars{display:inline-flex;vertical-align:-6px;margin:0 10px 0 0}.m-stars .stars svg{width:20px;height:20px}
.m-toc{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:8px;font-size:15px}
.m-sec{padding:40px 0 8px}.m-sec h2{font-size:24px}.m-sec p,.m-sec li{max-width:820px;font-size:16px;line-height:1.65}.m-sec ul{padding-left:22px}.m-sec li{margin:6px 0}
@keyframes flow{from{stroke-dashoffset:100}to{stroke-dashoffset:0}}.globe .arc{animation:flow 6s linear infinite}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.globe .arc{animation:none;stroke-opacity:0}.stat{transition:none}}
@media (max-width:900px){.globe{opacity:.35}.p-now{margin-left:0;width:100%}.top nav{display:none}.hero-in{grid-template-columns:1fr;padding-top:40px}.logos{justify-self:start;order:-1;padding:16px 20px;gap:18px}.logos img{height:52px}}
@media (max-width:760px){.period{position:static}.hero h1{font-size:32px}.two,.map-card{grid-template-columns:1fr}.notes{columns:1}.stats{grid-template-columns:1fr 1fr;gap:12px}.aw-grid{grid-template-columns:1fr}.tags{gap:20px}.big2{grid-template-columns:1fr}.big{flex-direction:column;align-items:flex-start;gap:12px;padding:24px}.big-v{font-size:56px}h2{font-size:25px}.stat-v{font-size:38px}.stat{padding:20px 16px}section{padding:52px 0}.brand img{height:36px}footer .wrap{grid-template-columns:1fr}.q-row{grid-template-columns:minmax(0,1fr) 60px 56px}.q-row .q-bar{display:none}.q-row.head span:nth-child(2){display:none}.info-in{padding:24px 20px}}
@media print{.top,.period{position:static}.dl,.toggles,.actions{display:none}section{break-inside:avoid}.globe .arc{animation:none}}`;
    },

    // The page's own script lives in partnerReportPage.js as an ordinary function; its source goes into the page.
    _prScript() { return '(' + this._prPageScript.toString() + ')();'; },
});
