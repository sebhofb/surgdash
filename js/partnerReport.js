// ── Partner dashboard in the GSF design (Nov 2026) ───────────────────────────────────────
//
// A provider's web report built from scratch on the Global Surgery Foundation Design System,
// to read like a website: a sticky navigation bar, a light header with the SURGhub and provider
// logos side by side over a faint globe of connections (drawn from where the learners are),
// figure cards that open a dialog explaining each figure, sections in alternating bands, Arial
// Black for the page title only, and the brand accents (orange, gold, pink, green) beside the
// blues. Seb (3 Nov 2026): "too blue", no Arial Black for subheadings, no photograph in the header.
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
        const logoBlue = this._prImage('gsf_logo_blue.png'), logoWhite = this._prImage('gsf_logo_white_web.png');
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
                awards: ((D.courseAwardMap || {})[c.Course] || []).slice().sort((a, b) => a.rank - b.rank).map(a => sentence(a.label) + (a.rank === 1 ? ' of ' : ': number ' + a.rank + ' of ') + fmt(a.total) + ' courses'),
            };
        });
        const awards = (D.providerAwards || []).slice().sort((a, b) => a.rank - b.rank).map(a => sentence(a.label) + (a.rank === 1 ? ' of ' : ': number ' + a.rank + ' of ') + fmt(a.total) + ' providers on SURGhub');
        const firsts = (D.providerCountryAwards || []).filter(c => c.rank === 1).map(c => c.country);

        const DATA = {
            name, asOf, through,
            totals: { enrol: D.totalLrn, cert: D.totalCert, rate: D.certRate, rating: Number(D.avgRating) > 0 ? Number(D.avgRating).toFixed(2) : '', resp: D.totalResp, time: lt(D.totalMin), min: Math.round(Number(D.totalMin) || 0), courses: courses.length, countries: countries.length, known },
            monthly: this._prMonthly(D.provTimeline, through),
            countries, land: G.LAND || '[]',
            impact: { time: lt(D.totalMin), contentNew: pick(si.contentNew), willApply: pick(si.willApply), careerValue: pick(si.careerValue) },
            questions: this._prQuestions(D.surveyQRows),
            summary: (D.fbSummaries && D.fbSummaries['@provider:' + providerName] && D.fbSummaries['@provider:' + providerName].s) || '',
            quotes: allQuotes.filter(q => q.t.length >= 25).slice(0, 6),
            courses, awards, firsts,
        };
        const json = JSON.stringify(DATA).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

        const lead = 'Your courses on SURGhub, the UN Global Surgery Learning Hub. Figures to ' + esc(asOf) + '.';
        const sec = (id, tone, eyebrow, title, body) => `<section id="${id}" class="${tone}"><div class="wrap"><p class="eyebrow">${eyebrow}</p><h2>${title}</h2>${body}</div></section>`;
        return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><title>${esc(name)} on SURGhub</title><style>${this._prCss()}</style></head><body>
<a class="skip" href="#main">Skip to the figures</a>
<header class="top"><div class="wrap">
  <a class="brand" href="#">${logoBlue ? '<img src="' + logoBlue + '" alt="Global Surgery Foundation">' : '<b>Global Surgery Foundation</b>'}</a>
  <nav aria-label="Sections" id="nav"><a href="#sec-numbers">Overview</a><a href="#sec-growth">Growth</a><a href="#sec-map">Reach</a><a href="#sec-impact">Impact</a><a href="#sec-survey">Survey</a><a href="#sec-voices">Voices</a><a href="#sec-courses">Courses</a></nav>
</div></header>
<div class="hero"><svg class="globe" id="globe" aria-hidden="true" focusable="false"></svg><div class="wrap hero-in">
  <div class="hero-text">
    <p class="eyebrow">SURGhub partner dashboard</p>
    <h1 id="hero-title">${esc(name)}</h1>
    <p class="lead" id="hero-lead">${lead}</p>
    <p class="actions" id="hero-actions"><a class="btn" href="#sec-courses">See your courses</a><a class="btn sec" href="#sec-notes">How we count</a></p>
  </div>
  <div class="logos">${shLogo ? '<img src="' + shLogo + '" alt="SURGhub, the UN Global Surgery Learning Hub">' : '<b>SURGhub</b>'}${provLogo ? '<span class="sep" aria-hidden="true"></span><img src="' + provLogo + '" alt="' + esc(name) + '">' : ''}</div>
</div></div>

<main id="main">
<section id="sec-numbers" class="lift"><div class="wrap">
  <div class="stats" id="stats"></div><div class="tags" id="awards"></div>
  <p class="note">All of your courses on SURGhub, since each one opened. Choose a figure to see what it counts.</p>
</div></section>
${sec('sec-growth', '', 'Growth', 'Enrolments and certificates over time', '<p class="intro">Running totals by month. Point at the chart to read a month; switch the lines on and off, or add the numbers for each month.</p><div class="card"><div id="growth"></div></div>')}
${sec('sec-map', 'band', 'Reach', 'Where your learners are', '<p class="intro" id="map-intro"></p><div class="card map-card"><div id="map"></div><div id="toplist"></div></div>')}
${sec('sec-impact', 'dark', 'Learning impact', 'What the learning changes', '<p class="intro">From the survey at the end of each course: the share of learners answering 4 or 5 on a scale of 1 to 5. Choose a figure for the question behind it.</p><div class="stats" id="impact"></div>')}
${sec('sec-survey', '', 'Survey insights', 'How learners rate the courses', '<p class="intro" id="survey-intro"></p><div class="card"><div id="questions"></div></div>')}
${sec('sec-voices', 'band warm', 'Learner voices', 'What learners say', '<div id="summary"></div><div class="quotes" id="quotes"></div>')}
${sec('sec-courses', '', 'Courses', 'Course by course', '<p class="intro">Choose a column to sort; choose a course to see its own page.</p><div class="card table-card"><div class="table-scroll"><table class="ctable" id="ctable"></table></div></div>')}

<!--SH-DOWNLOADS-->

${sec('sec-notes', 'band', 'About these figures', 'How we count', `<div class="notes">
    <p><b>Course enrolments</b> count every enrolment in your courses, whether or not the learner has started. One person who takes two of your courses counts twice.</p>
    <p><b>Certificates</b> are the course certificates learners earned. The certification rate is certificates divided by enrolments.</p>
    <p><b>Countries</b> come from what learners give in their SURGhub profile; not every learner gives one. The map places each country at its centre.</p>
    <p><b>Ratings and survey answers</b> come from the survey at the end of each course. Quotes are shown as learners wrote them, without names.</p>
    <p><b>Figures run to ${esc(asOf)}.</b> They come from SURGhub and are prepared by the Global Surgery Foundation with SURGdash.</p>
    <p>Questions about this dashboard: <a href="mailto:info@globalsurgeryfoundation.org">info@globalsurgeryfoundation.org</a></p>
  </div>`)}
</main>

<main id="course" hidden></main>

<footer><div class="wrap">
  <div class="f-brand">${logoWhite ? '<img src="' + logoWhite + '" alt="Global Surgery Foundation">' : '<b>Global Surgery Foundation</b>'}<p>SURGhub, the UN Global Surgery Learning Hub, is the Global Surgery Foundation's online learning platform.</p></div>
  <div class="f-col"><b>On this page</b><a href="#sec-numbers">Overview</a><a href="#sec-map">Reach</a><a href="#sec-courses">Courses</a><a href="#sec-notes">How we count</a></div>
  <div class="f-col"><b>Contact</b><a href="mailto:info@globalsurgeryfoundation.org">info@globalsurgeryfoundation.org</a><a href="https://www.globalsurgeryfoundation.org">globalsurgeryfoundation.org</a><a href="https://www.surghub.org">surghub.org</a></div>
</div><div class="wrap f-small">Figures to ${esc(asOf)}. This page is private to you; please do not share the link or password.</div></footer>
<dialog id="info" class="info" aria-labelledby="info-t"><div class="info-bar" id="info-bar"></div><div class="info-in"><button class="x" id="info-x" aria-label="Close">&times;</button><p class="eyebrow" id="info-e"></p><h3 id="info-t"></h3><div class="info-v" id="info-v"></div><div id="info-b"></div></div></dialog>
<div id="tip" class="tip" hidden></div>
<script>var DATA=${json};
${this._prScript()}<\/script>
</body></html>`;
    },

    _prCss() {
        return `
:root{--blue:#0468b1;--blue-h:#035c9d;--navy:#002f4c;--light:#91b5d9;--tint:#e6f0f8;--paper:#f3f7fb;--line:#dee7ef;--line2:#cde1f0;--gold:#ffc145;--orange:#ff9734;--orange-d:#e07412;--pink:#de3a8d;--green:#5d9e1c;--muted:#4a6b82;--warm:#fff8ec}
*{box-sizing:border-box}[hidden]{display:none!important}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:#fff;color:var(--navy);font:16px/1.55 Arial,"Helvetica Neue",Helvetica,sans-serif}
.wrap{max-width:1200px;margin:0 auto;padding:0 24px}
a{color:var(--blue)}a:hover{text-decoration:underline}
.skip{position:absolute;left:-9999px;top:8px;background:var(--gold);color:var(--navy);padding:8px 14px;border-radius:9px;font-weight:700;z-index:100}.skip:focus{left:16px}
.top{position:sticky;top:0;z-index:40;background:rgba(255,255,255,.96);backdrop-filter:saturate(1.4) blur(6px);border-bottom:1px solid var(--line)}
.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:24px;height:72px}
.brand img{height:42px;width:auto;display:block}
.top nav{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}.top nav::-webkit-scrollbar{display:none}
.top nav a{font-size:15px;font-weight:700;color:var(--navy);text-decoration:none;padding:8px 12px;border-radius:9px;white-space:nowrap;border-bottom:3px solid transparent}
.top nav a:hover{background:var(--paper)}.top nav a.on{color:var(--blue);border-bottom-color:var(--orange);border-radius:9px 9px 0 0}
.hero{position:relative;overflow:hidden;background:linear-gradient(180deg,#fff 0,var(--paper) 100%);border-bottom:1px solid var(--line)}
.globe{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}
.hero-in{position:relative;display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:40px;align-items:center;padding-top:64px;padding-bottom:120px}
.eyebrow{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--blue);margin:0 0 12px}
.eyebrow:before{content:"";width:28px;height:4px;border-radius:2px;background:var(--orange);flex:none}
.hero h1{font-family:"Arial Black",Arial,sans-serif;font-weight:900;font-size:46px;line-height:1.1;letter-spacing:-.01em;margin:0;color:var(--navy)}
.hero p.lead{font-size:19px;line-height:1.5;color:var(--muted);max-width:560px;margin:16px 0 0}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin:28px 0 0}
.logos{justify-self:end;align-self:end;margin-bottom:8px;display:flex;align-items:center;gap:28px;background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 28px rgba(0,47,76,.10);padding:24px 32px}
.logos img{height:76px;width:auto;max-width:220px;object-fit:contain;display:block}.logos b{font-size:28px}
.logos .sep{width:1px;align-self:stretch;background:var(--line2)}
section{padding:72px 0;scroll-margin-top:72px}
section.band{background:var(--paper)}section.warm{background:var(--warm)}
section.dark{background:var(--navy);color:#fff}section.dark h2{color:#fff}section.dark .intro{color:rgba(255,255,255,.8)}section.dark .eyebrow{color:var(--gold)}
section.lift{padding-top:0;padding-bottom:8px;margin-top:-72px;position:relative}
h2{font-weight:700;font-size:32px;line-height:1.2;letter-spacing:-.005em;color:var(--navy);margin:0 0 10px}
h3{font-weight:700;font-size:19px;line-height:1.25;margin:0 0 12px;color:var(--navy)}
.intro{font-size:17px;color:var(--muted);max-width:760px;margin:0 0 32px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:20px}
.stat{all:unset;box-sizing:border-box;position:relative;display:flex;flex-direction:column;background:#fff;border:1px solid var(--line);border-top:5px solid var(--ac,var(--blue));border-radius:12px;padding:22px 22px 20px;box-shadow:0 6px 18px rgba(0,47,76,.08);cursor:pointer;transition:transform .15s,box-shadow .15s;color:var(--navy)}
.stat:hover{transform:translateY(-2px);box-shadow:0 14px 30px rgba(0,47,76,.14)}
.stat:focus-visible{box-shadow:0 0 0 2px #002f4c,0 0 0 5px #ffc145}
.stat-v{font-weight:700;font-size:40px;line-height:1;letter-spacing:-.01em;white-space:nowrap;color:var(--navy)}
.stat-l{margin-top:12px;font-weight:700;font-size:16px;line-height:1.35}
.stat-s{margin-top:4px;font-size:13px;line-height:1.4;color:var(--muted)}
.stat-i{position:absolute;top:14px;right:14px;width:22px;height:22px;border-radius:50%;background:var(--tint);color:var(--blue);font:700 13px/22px Georgia,serif;text-align:center;font-style:italic}
.stat:hover .stat-i{background:var(--ac,var(--blue));color:#fff}
section.dark .stat{background:#0a3d5e;border-color:#1b5378;border-top-color:var(--ac);color:#fff;box-shadow:none}section.dark .stat-v{color:var(--gold)}section.dark .stat-s{color:rgba(255,255,255,.75)}section.dark .stat-i{background:rgba(255,255,255,.14);color:#fff}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:24px}.tags:empty{display:none}
.tag{display:inline-flex;align-items:center;font-weight:700;font-size:13px;line-height:1.3;padding:7px 14px;border-radius:999px;background:var(--tint);color:var(--blue)}
.tag-gold{background:var(--gold);color:var(--navy)}
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
.summary{background:#fff;border:1px solid var(--line);border-left:5px solid var(--orange);border-radius:12px;padding:28px 32px;font-family:Georgia,"Times New Roman",serif;font-size:17px;line-height:1.65;max-width:900px}
.summary small{display:block;margin-top:12px;font-family:Arial,sans-serif;font-size:13px;color:var(--muted)}
.quotes{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;margin-top:28px}
.quote{margin:0;background:#fff;border:1px solid var(--line);border-radius:12px;padding:28px;box-shadow:0 1px 3px rgba(0,47,76,.06)}
.quote:nth-child(3n+1){border-top:5px solid var(--orange)}.quote:nth-child(3n+2){border-top:5px solid var(--gold)}.quote:nth-child(3n){border-top:5px solid var(--pink)}
.quote blockquote{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:17px;line-height:1.65;color:var(--navy)}
.quote blockquote:before{content:"\\201C";display:block;font-family:Georgia,serif;font-size:56px;line-height:.6;color:var(--orange);margin-bottom:10px}
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
.info-bar{height:6px;background:var(--blue)}.info-in{position:relative;padding:28px 32px 30px}
.info h3{font-size:24px;margin:0 0 8px;padding-right:32px}.info-v{font-weight:700;font-size:34px;line-height:1.1;margin:4px 0 16px}
.info p{margin:0 0 12px;font-size:15px;line-height:1.6}.info ul{margin:0 0 12px;padding-left:20px;font-size:15px}.info li{margin:3px 0}
.info .fact{display:grid;grid-template-columns:1fr auto;gap:12px;padding:8px 0;border-top:1px solid var(--line);font-size:15px}.info .fact b{font-variant-numeric:tabular-nums}
.x{position:absolute;top:16px;right:16px;width:36px;height:36px;border-radius:50%;border:0;background:var(--paper);color:var(--navy);font-size:24px;line-height:36px;cursor:pointer}.x:hover{background:var(--tint)}
footer{background:var(--navy);color:#fff}footer .wrap{display:grid;grid-template-columns:minmax(0,2fr) 1fr 1fr;gap:40px;padding-top:56px;padding-bottom:32px}
footer img{height:52px;width:auto;display:block;margin-bottom:16px}footer p{margin:0;font-size:14px;color:rgba(255,255,255,.8);max-width:420px}
.f-col{display:flex;flex-direction:column;gap:8px;font-size:14px}.f-col b{color:var(--gold);font-size:13px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px}.f-col a{color:#fff;text-decoration:none}.f-col a:hover{text-decoration:underline}
footer .f-small{display:block;padding-top:20px;padding-bottom:28px;border-top:1px solid rgba(255,255,255,.15);font-size:13px;color:rgba(255,255,255,.65)}
@keyframes flow{from{stroke-dashoffset:100}to{stroke-dashoffset:0}}.globe .arc{animation:flow 6s linear infinite}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.globe .arc{animation:none;stroke-opacity:0}.stat{transition:none}}
@media (max-width:900px){.globe{opacity:.5}.top nav{display:none}.hero-in{grid-template-columns:1fr;padding-top:40px}.logos{justify-self:start;order:-1;padding:16px 20px;gap:18px}.logos img{height:52px}}
@media (max-width:760px){.hero h1{font-size:32px}.two,.map-card{grid-template-columns:1fr}.notes{columns:1}.stats{grid-template-columns:1fr 1fr;gap:14px}h2{font-size:25px}.stat-v{font-size:30px}.stat{padding:18px 16px}section{padding:52px 0}.brand img{height:36px}footer .wrap{grid-template-columns:1fr}.q-row{grid-template-columns:minmax(0,1fr) 60px 56px}.q-row .q-bar{display:none}.q-row.head span:nth-child(2){display:none}.info-in{padding:24px 20px}}
@media print{.top{position:static}.dl,.toggles,.actions{display:none}section{break-inside:avoid}.globe .arc{animation:none}}`;
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
// ── the last twelve months of new enrolments, as small bars ──
// the same twelve calendar months for every course, ending with the data-through month
var WIN=(function(){var end=D.through||(D.monthly.length?D.monthly[D.monthly.length-1][0]:"");if(!end)return [];var p=end.split("-").map(Number),y=p[0],m=p[1],out=[];for(var i=0;i<12;i++){out.unshift(y+"-"+(m<10?"0":"")+m);m--;if(!m){m=12;y--}}return out})();
// a figure card; with an explanation it is a button that opens the dialog
var INFO=[],AC={blue:"#0468b1",orange:"#ff9734",gold:"#ffc145",pink:"#de3a8d",green:"#5d9e1c",navy:"#002f4c"};
function stat(v,l,s,info,ac){var c=AC[ac]||AC.blue,body='<div class="stat-v">'+v+'</div><div class="stat-l">'+l+'</div>'+(s?'<div class="stat-s">'+s+'</div>':'');
  if(!info)return '<div class="stat" style="--ac:'+c+';cursor:default">'+body+'</div>';
  info.v=v;info.l=l;info.ac=c;INFO.push(info);
  return '<button type="button" class="stat" style="--ac:'+c+'" data-info="'+(INFO.length-1)+'" aria-haspopup="dialog"><span class="stat-i" aria-hidden="true">i</span>'+body+'<span style="position:absolute;left:-9999px"> (more about this figure)</span></button>'}
function fact(l,v){return '<div class="fact"><span>'+l+'</span><b>'+v+'</b></div>'}
var dlg=$("info"),lastFocus=null;
function openInfo(i){var x=INFO[i];if(!x)return;lastFocus=document.activeElement;
  $("info-bar").style.background=x.ac;$("info-e").textContent=x.e||"About this figure";$("info-t").textContent=x.t||x.l;$("info-v").innerHTML=x.v;$("info-v").style.color=(x.ac===AC.gold||x.ac===AC.orange)?"#002f4c":x.ac;$("info-b").innerHTML=x.b;
  if(dlg.showModal){if(!dlg.open)dlg.showModal()}else dlg.setAttribute("open","");$("info-x").focus()}
function closeInfo(){if(dlg.close&&dlg.open)dlg.close();else dlg.removeAttribute("open");if(lastFocus&&lastFocus.focus)lastFocus.focus()}
$("info-x").addEventListener("click",closeInfo);
dlg.addEventListener("click",function(ev){if(ev.target===dlg){closeInfo();return}var a=ev.target.closest?ev.target.closest("a[href^='#']"):null;if(a){lastFocus=null;closeInfo()}});
document.addEventListener("keydown",function(ev){if(ev.key==="Escape"&&dlg.hasAttribute("open"))closeInfo()});
document.addEventListener("click",function(ev){var b=ev.target.closest?ev.target.closest("[data-info]"):null;if(b)openInfo(+b.getAttribute("data-info"))});
// the last twelve months, and the busiest month, from a [[month, enrolments, certificates]] list
function last12(monthly,k){var by={};(monthly||[]).forEach(function(r){by[r[0]]=r[k]});return WIN.reduce(function(t,m){return t+(by[m]||0)},0)}
function busiest(monthly,k){var b=null;(monthly||[]).forEach(function(r){if(r[k]>0&&(!b||r[k]>b[k]))b=r});return b}
function perHead(min,n){if(!min||!n)return "";var m=min/n;return m>=90?(m/60).toFixed(1)+" hours":Math.round(m)+" minutes"}
function nice(max,parts){var raw=Math.max(1,max)/parts,p=Math.pow(10,Math.floor(Math.log10(raw))),st=[1,2,2.5,5,10].map(function(x){return x*p}).filter(function(x){return x>=raw})[0];return {step:st,top:st*Math.ceil(Math.max(1,max)/st)}}

// ── the growth chart: running totals as lines, monthly numbers as bars on their own scale ──
function growth(el,monthly){
  if(!monthly||monthly.length<2){el.innerHTML='<p class="note">Not enough months yet to draw a chart.</p>';return}
  var st={e:true,c:true,bars:false},cum=[],e=0,c=0;
  monthly.forEach(function(r){e+=r[1];c+=r[2];cum.push({m:r[0],e:e,c:c,de:r[1],dc:r[2]})});
  el.innerHTML='<div class="toggles" role="group" aria-label="Show in the chart">'
    +'<button class="tg" data-k="e" aria-pressed="true"><i style="background:#0468b1"></i>Course enrolments</button>'
    +'<button class="tg" data-k="c" aria-pressed="true"><i style="background:#f08a24"></i>Certificates</button>'
    +'<button class="tg" data-k="bars" aria-pressed="false"><i style="background:#91b5d9;height:10px;width:10px"></i><i style="background:#ffd29c;height:10px;width:10px;margin-left:-6px"></i>Numbers each month</button></div><div class="chart"></div>';
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
      cum.forEach(function(r,i){var x0=x(i)-bw/2;if(st.e)s+='<rect x="'+x0.toFixed(1)+'" y="'+yb(r.de).toFixed(1)+'" width="'+half.toFixed(1)+'" height="'+(T+h-yb(r.de)).toFixed(1)+'" fill="#91b5d9"/>';if(st.c)s+='<rect x="'+(x0+(st.e?half:0)).toFixed(1)+'" y="'+yb(r.dc).toFixed(1)+'" width="'+half.toFixed(1)+'" height="'+(T+h-yb(r.dc)).toFixed(1)+'" fill="#ffd29c"/>'})}
    cum.forEach(function(r,i){if(r.m.slice(5)==="01"||i===0)s+='<text x="'+x(i).toFixed(1)+'" y="'+(H-12)+'" text-anchor="'+(i===0?"start":"middle")+'" font-size="13" fill="#4a6b82">'+(i===0?mName(r.m):r.m.slice(0,4))+'</text>'});
    function path(k){return cum.map(function(r,i){return(i?"L":"M")+x(i).toFixed(1)+" "+y(r[k]).toFixed(1)}).join(" ")}
    if(st.e)s+='<path d="'+path("e")+' L'+x(n-1).toFixed(1)+' '+(T+h)+' L'+L+' '+(T+h)+' Z" fill="#e6f0f8" fill-opacity="'+(st.bars?0.5:1)+'"/><path d="'+path("e")+'" fill="none" stroke="#0468b1" stroke-width="3" stroke-linejoin="round"/>';
    if(st.c)s+='<path d="'+path("c")+'" fill="none" stroke="#f08a24" stroke-width="3" stroke-linejoin="round"/>';
    s+='<line class="guide" x1="0" x2="0" y1="'+T+'" y2="'+(T+h)+'" stroke="#002f4c" stroke-dasharray="3 3" visibility="hidden"/><g class="dots"></g>';
    s+='<rect x="'+L+'" y="'+T+'" width="'+w+'" height="'+h+'" fill="transparent" class="hit"/></svg>';
    box.innerHTML=s;
    var svg=box.querySelector("svg"),guide=svg.querySelector(".guide"),dots=svg.querySelector(".dots"),hit=svg.querySelector(".hit");
    function at(ev){var r=svg.getBoundingClientRect(),cx=(ev.touches?ev.touches[0].clientX:ev.clientX),px=(cx-r.left)/r.width*W;var i=Math.round((px-L)/(w/(n-1||1)));return Math.max(0,Math.min(n-1,i))}
    function move(ev){var i=at(ev),r=cum[i],X=x(i).toFixed(1);guide.setAttribute("x1",X);guide.setAttribute("x2",X);guide.setAttribute("visibility","visible");
      dots.innerHTML=(st.e?'<circle cx="'+X+'" cy="'+y(r.e).toFixed(1)+'" r="5" fill="#0468b1"/>':'')+(st.c?'<circle cx="'+X+'" cy="'+y(r.c).toFixed(1)+'" r="5" fill="#f08a24" stroke="#fff" stroke-width="2"/>':'');
      var t='<b>'+mName(r.m,true)+'</b>';if(st.e)t+='Course enrolments: '+fmt(r.e)+' in total, '+fmt(r.de)+' this month<br>';if(st.c)t+='Certificates: '+fmt(r.c)+' in total, '+fmt(r.dc)+' this month';
      var cx=ev.touches?ev.touches[0].clientX:ev.clientX,cy=ev.touches?ev.touches[0].clientY:ev.clientY;showTip(t,cx,cy)}
    function out(){guide.setAttribute("visibility","hidden");dots.innerHTML="";hideTip()}
    hit.addEventListener("mousemove",move);hit.addEventListener("mouseleave",out);hit.addEventListener("touchstart",move,{passive:true});hit.addEventListener("touchmove",move,{passive:true});hit.addEventListener("touchend",out);
  }
  draw();
}

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
function surveyInfo(x,what){return {e:"Learning impact",b:'<p>From the survey learners fill in at the end of each course. They were asked '+what+', on a scale of 1 to 5; this is the share who answered 4 or 5.</p>'+fact("Learners who answered this question",fmt(x.n))+fact("Answered 4 or 5",fmt(Math.round(x.n*x.pct/100))+" ("+x.pct+"%)")+'<p class="note">Only learners who finish the survey are counted, so the share describes those who answered, not every learner.</p>'}}
function timeInfo(min,time,enrol){return {e:"Learning impact",t:"Learning time",b:'<p>The time learners spent in the course pages, as SURGhub records it, added up across every learner. It counts time with a course open, not time spent studying away from SURGhub.</p>'+fact("In total",esc(time))+(perHead(min,enrol)?fact("On average per enrolment",perHead(min,enrol)):"")}}
function impactStats(I){return [I.time?stat(esc(I.time),"Learning time","Recorded across all learners",timeInfo(T.min,I.time,T.enrol),"gold"):"",I.contentNew?stat(I.contentNew.pct+"%","Found the content new","Of "+fmt(I.contentNew.n)+" who answered",surveyInfo(I.contentNew,"how much of the content was new to them"),"gold"):"",I.willApply?stat(I.willApply.pct+"%","Are likely to apply it at work","Of "+fmt(I.willApply.n)+" who answered",surveyInfo(I.willApply,"how likely they are to apply what they learnt in their work"),"gold"):"",I.careerValue?stat(I.careerValue.pct+"%","Rate it important for their work","Of "+fmt(I.careerValue.n)+" who answered",surveyInfo(I.careerValue,"how important the course is for their work"),"gold"):""].join("")}

// ── the header: a faint globe, with arcs from Geneva to where most learners are ──
function globe(){
  var svg=$("globe");if(!svg)return;var land=[];try{land=JSON.parse(D.land)}catch(e){}
  var W=1400,H=560,cx=1120,cy=330,R=270,rad=Math.PI/180,lon0=14*rad,lat0=22*rad,sl0=Math.sin(lat0),cl0=Math.cos(lat0);
  function vec(lon,lat){var a=lon*rad,b=lat*rad;return [Math.cos(b)*Math.cos(a),Math.cos(b)*Math.sin(a),Math.sin(b)]}
  function pv(v,k){var lon=Math.atan2(v[1],v[0]),lat=Math.asin(Math.max(-1,Math.min(1,v[2]))),l=lon-lon0,z=sl0*Math.sin(lat)+cl0*Math.cos(lat)*Math.cos(l);k=k||1;return {x:cx+k*R*Math.cos(lat)*Math.sin(l),y:cy-k*R*(cl0*Math.sin(lat)-sl0*Math.cos(lat)*Math.cos(l)),z:z}}
  function pr(lon,lat){return pv(vec(lon,lat))}
  function line(pts){var d="",pen=false;pts.forEach(function(q){if(q.z>0){d+=(pen?"L":"M")+q.x.toFixed(1)+" "+q.y.toFixed(1);pen=true}else pen=false});return d}
  svg.setAttribute("viewBox","0 0 "+W+" "+H);svg.setAttribute("preserveAspectRatio","xMaxYMid slice");
  var s='<defs><radialGradient id="gl" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e6f0f8"/></radialGradient></defs>';
  // a loose web of points across the rest of the header
  var seed=7;function rnd(){seed=(seed*16807)%2147483647;return seed/2147483647}
  var pts=[];for(var i=0;i<30;i++)pts.push([rnd()*820,20+rnd()*(H-40)]);
  pts.forEach(function(a,i){var near=pts.map(function(b,j){return [j,(a[0]-b[0])*(a[0]-b[0])+(a[1]-b[1])*(a[1]-b[1])]}).filter(function(x){return x[0]>i}).sort(function(x,y){return x[1]-y[1]}).slice(0,2);
    near.forEach(function(x){var b=pts[x[0]];s+='<line x1="'+a[0].toFixed(0)+'" y1="'+a[1].toFixed(0)+'" x2="'+b[0].toFixed(0)+'" y2="'+b[1].toFixed(0)+'" stroke="#cde1f0" stroke-width="1" stroke-opacity=".7"/>'})});
  pts.forEach(function(a,i){s+='<circle cx="'+a[0].toFixed(0)+'" cy="'+a[1].toFixed(0)+'" r="'+(i%5?2.5:4)+'" fill="'+(i%7===0?"#ffc145":i%5===0?"#ff9734":"#cde1f0")+'"/>'});
  s+='<circle cx="'+cx+'" cy="'+cy+'" r="'+R+'" fill="url(#gl)" stroke="#cde1f0" stroke-width="1.5"/>';
  for(var lo=-180;lo<180;lo+=30){var m=[];for(var la=-90;la<=90;la+=4)m.push(pr(lo,la));s+='<path d="'+line(m)+'" fill="none" stroke="#dee7ef"/>'}
  for(var la2=-60;la2<=60;la2+=30){var p2=[];for(var lo2=-180;lo2<=180;lo2+=4)p2.push(pr(lo2,la2));s+='<path d="'+line(p2)+'" fill="none" stroke="#dee7ef"/>'}
  for(var k=0;k+1<land.length;k+=2){var q=pr(land[k],land[k+1]);if(q.z>0.02)s+='<circle cx="'+q.x.toFixed(1)+'" cy="'+q.y.toFixed(1)+'" r="'+(1.4+1.6*q.z).toFixed(1)+'" fill="#91b5d9" fill-opacity="'+(0.3+0.4*q.z).toFixed(2)+'"/>'}
  // arcs lifted off the surface, from the hub to the countries with the most learners
  var hub=vec(6.14,46.2),cols=["#ff9734","#de3a8d","#ffc145","#0468b1"],ends="",n=0;
  D.countries.filter(function(c){return c.length>=4}).forEach(function(c){if(n>=16)return;var to=vec(c[2],c[3]),e=pv(to);if(e.z<0.15)return;
    var dot=hub[0]*to[0]+hub[1]*to[1]+hub[2]*to[2],om=Math.acos(Math.max(-1,Math.min(1,dot)));if(om<0.08)return;
    var arc=[];for(var t=0;t<=1.0001;t+=1/32){var a1=Math.sin((1-t)*om)/Math.sin(om),a2=Math.sin(t*om)/Math.sin(om),v=[a1*hub[0]+a2*to[0],a1*hub[1]+a2*to[1],a1*hub[2]+a2*to[2]];arc.push(pv(v,1+0.22*om/Math.PI*Math.sin(Math.PI*t)))}
    var col=cols[n%cols.length];var d=arc.map(function(q,i){return(i?"L":"M")+q.x.toFixed(1)+" "+q.y.toFixed(1)}).join("");
    s+='<path d="'+d+'" fill="none" stroke="'+col+'" stroke-width="1.4" stroke-opacity=".55" stroke-linecap="round"/><path class="arc" d="'+d+'" pathLength="100" fill="none" stroke="'+col+'" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="7 93" style="animation-delay:-'+(n*0.7).toFixed(1)+'s"/>';
    ends+='<circle cx="'+e.x.toFixed(1)+'" cy="'+e.y.toFixed(1)+'" r="4" fill="'+col+'" stroke="#fff" stroke-width="1.5"/>';n++});
  var h0=pv(hub);s+=ends+'<circle cx="'+h0.x.toFixed(1)+'" cy="'+h0.y.toFixed(1)+'" r="11" fill="#002f4c" fill-opacity=".12"/><circle cx="'+h0.x.toFixed(1)+'" cy="'+h0.y.toFixed(1)+'" r="5.5" fill="#002f4c" stroke="#fff" stroke-width="2"/>';
  svg.innerHTML=s;
}
globe();

// ── the main page ──
D.courses.forEach(function(c,i){c.i=i;c.rate=c.enrol?c.cert/c.enrol*100:0});
var T=D.totals,RANGE=WIN.length?mName(WIN[0])+" to "+mName(WIN[11]):"the last 12 months";
function enrolInfo(x,share){var b=busiest(x.monthly,1);return {t:"Course enrolments",b:'<p>Every enrolment in '+(share!=null?"this course":"your courses")+', whether or not the learner has started. One person who takes two courses counts twice, so this is more than the number of people.</p>'
  +fact("New in "+RANGE,fmt(last12(x.monthly,1)))+(b?fact("Busiest month",mName(b[0],true)+", "+fmt(b[1])):"")+(share!=null?fact("Share of all "+esc(D.name)+" enrolments",share):"")}}
function certInfo(x,avg){var rate=x.enrol?(x.cert/x.enrol*100).toFixed(1)+"%":"–";return {t:"Certificates",b:'<p>Course certificates learners earned by completing the course. The certification rate is certificates divided by enrolments; recent enrolments lower it for a while, as those learners are still working through the course.</p>'
  +fact("Certification rate",rate)+(avg?fact("Across all your courses",avg):"")+fact("Earned in "+RANGE,fmt(last12(x.monthly,2)))}}
function ratingInfo(n,best){return {t:"Average rating",b:'<p>The average of the overall rating learners give in the survey at the end of the course, on a scale of 1 to 5.</p>'+fact("Survey responses",fmt(n))+(best?fact("Highest rated course (20 or more responses)",esc(best.name)+", "+best.rating.toFixed(2)):"")+'<p class="note">Only learners who finish the survey are counted.</p>'}}
var byEnrol=D.courses.slice().sort(function(a,b){return b.enrol-a.enrol});
var best=D.courses.filter(function(c){return c.resp>=20&&c.rating}).sort(function(a,b){return b.rating-a.rating})[0];
$("stats").innerHTML=[stat(fmt(T.enrol),"Course enrolments","One learner can enrol in several courses",enrolInfo({monthly:D.monthly}),"blue"),
  stat(fmt(T.cert),"Certificates",T.rate?T.rate+"% of enrolments":"",certInfo({enrol:T.enrol,cert:T.cert,monthly:D.monthly}),"orange"),
  T.countries?stat(fmt(T.countries),"Countries","Where learners gave their country",{t:"Countries",b:'<p>The countries learners give in their SURGhub profile. Not every learner gives one, so this counts the countries we know of.</p>'+fact("Enrolments with a known country",fmt(T.known)+" of "+fmt(T.enrol))+D.countries.slice(0,5).map(function(c,i){return fact((i+1)+". "+esc(c[0]),fmt(c[1]))}).join("")+(D.firsts.length?'<p class="note">You have more learners than any other SURGhub provider from '+esc(D.firsts.slice(0,8).join(", "))+(D.firsts.length>8?" and "+(D.firsts.length-8)+" more":"")+'.</p>':"")+'<p><a href="#sec-map">See the map</a></p>'},"green"):"",
  T.rating?stat(T.rating,"Average rating","Out of 5, from "+fmt(T.resp)+" survey responses",ratingInfo(T.resp,best),"gold"):"",
  stat(fmt(T.courses),T.courses===1?"Course":"Courses","On SURGhub",{t:"Your courses",b:'<p>Your courses on SURGhub that these figures include. The five with the most enrolments:</p>'+byEnrol.slice(0,5).map(function(c){return fact('<a href="#course-'+c.i+'">'+esc(c.name)+'</a>',fmt(c.enrol))}).join("")+'<p><a href="#sec-courses">See every course</a></p>'},"pink")].join("");
$("awards").innerHTML=D.awards.map(function(a){return '<span class="tag tag-gold">'+esc(a)+'</span>'}).join("")+(D.firsts.length?'<span class="tag">More learners than any other provider from '+esc(D.firsts.slice(0,6).join(", "))+(D.firsts.length>6?" and "+(D.firsts.length-6)+" more countries":"")+'</span>':"");
growth($("growth"),D.monthly);
if(D.countries.length){$("map-intro").textContent="Learners from "+fmt(D.countries.length)+" countries took your courses. Point at a circle to see the number; the ten largest are listed.";worldMap($("map"),D.countries);$("toplist").innerHTML='<h3>The ten largest</h3>'+bars(D.countries,T.known)+'<p class="note">Country is known for '+fmt(T.known)+' of '+fmt(T.enrol)+' enrolments; shares are of those.</p>'}else $("sec-map").hidden=true;
var I=impactStats(D.impact);if(I)$("impact").innerHTML=I;else $("sec-impact").hidden=true;
if(D.questions.length){$("survey-intro").textContent="Every question with at least three answers, across "+fmt(T.resp)+" survey responses. The bar shows the average out of 5; the last column the share answering 4 or 5.";$("questions").innerHTML=questions(D.questions)}else $("sec-survey").hidden=true;
if(D.summary)$("summary").innerHTML='<div class="summary">'+esc(D.summary)+'<small>A summary of the written answers in the end-of-course surveys.</small></div>';
if(D.quotes.length)$("quotes").innerHTML=quotes(D.quotes);if(!D.summary&&!D.quotes.length)$("sec-voices").hidden=true;

// ── the course table: sortable, each row opens the course page ──
var cols=[{k:"name",t:"Course"},{k:"enrol",t:"Enrolments"},{k:"cert",t:"Certificates"},{k:"rate",t:"Cert. rate"},{k:"rating",t:"Rating"},{k:"resp",t:"Responses"},{k:"spark",t:"Last 12 months"}];
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
  var h='<section style="padding:32px 0 0"><div class="wrap"><a class="back" href="#sec-courses">&larr; All courses</a></div></section>'
   +'<section style="padding-top:28px"><div class="wrap"><p class="eyebrow">At a glance</p><h2>This course in numbers</h2><p class="intro">Choose a figure to see what it counts.</p>'
   +'<div class="stats">'+[stat(fmt(c.enrol),"Course enrolments",fmt(last12(c.monthly,1))+" in the last 12 months",enrolInfo(c,T.enrol?(c.enrol/T.enrol*100).toFixed(1)+"%":"–"),"blue"),stat(fmt(c.cert),"Certificates",rate+" of enrolments",certInfo(c,T.rate?T.rate+"%":""),"orange"),c.rating?stat(c.rating.toFixed(2),"Average rating","Out of 5, from "+fmt(c.resp)+" responses",ratingInfo(c.resp,null),"gold"):"",c.time?stat(esc(c.time),"Learning time","Recorded across all learners",timeInfo(c.min,c.time,c.enrol),"pink"):""].join("")+'</div>'
   +(c.awards.length?'<div class="tags">'+c.awards.map(function(a){return '<span class="tag tag-gold">'+esc(a)+'</span>'}).join("")+'</div>':"")+'</div></section>'
   +'<section><div class="wrap"><p class="eyebrow">Growth</p><h2>Enrolments and certificates over time</h2><div class="card"><div id="cgrowth"></div></div></div></section>'
   +(rc.length?'<section><div class="wrap"><p class="eyebrow">Ratings</p><h2>Average rating by month</h2><p class="intro">From the end-of-course survey; the bar height is the number of ratings that month. Point at a bar for the figures.</p><div class="card"><div id="cratings" class="chart"></div></div></div></section>':"")
   +(c.countries.length?'<section><div class="wrap"><p class="eyebrow">Reach</p><h2>Where this course\\'s learners are</h2><div class="card"><div class="two"><div>'+bars(c.countries.slice(0,5),c.known)+'</div><div>'+bars(c.countries.slice(5,10),c.known)+'</div></div><p class="note">Country is known for '+fmt(c.known)+' of '+fmt(c.enrol)+' enrolments; shares are of those.</p></div></div></section>':"")
   +(c.questions.length?'<section><div class="wrap"><p class="eyebrow">Survey insights</p><h2>How learners rate this course</h2><div class="card">'+questions(c.questions)+'</div></div></section>':"")
   +((c.summary||c.quotes.length)?'<section><div class="wrap"><p class="eyebrow">Learner voices</p><h2>What learners say</h2>'+(c.summary?'<div class="summary">'+esc(c.summary)+'<small>A summary of the written answers in this course\\'s survey.</small></div>':"")+'<div class="quotes">'+quotes(c.quotes)+'</div></div></section>':"")
   +'<section style="padding-top:0"><div class="wrap"><a class="back" href="#sec-courses">&larr; All courses</a></div></section>';
  $("course").innerHTML=h;
  growth($("cgrowth"),c.monthly);
  if(rc.length){var el=$("cratings"),W=1000,H=240,L=48,R=16,Tp=16,B=36,w=W-L-R,hh=H-Tp-B,n=rc.length,mx=1;rc.forEach(function(r){mx=Math.max(mx,r[2])});var bw=Math.max(3,w/n*0.7);
    var s='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Average rating by month">';[1,2,3,4,5].forEach(function(v){var yy=(Tp+hh-v/5*hh).toFixed(1);s+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+yy+'" y2="'+yy+'" stroke="#dee7ef"/><text x="'+(L-10)+'" y="'+yy+'" dy="4" text-anchor="end" font-size="13" fill="#4a6b82">'+v+'</text>'});
    rc.forEach(function(r,i){var cx=L+(n===1?w/2:i*w/(n-1)),hb=Math.max(2,r[2]/mx*hh*0.5);s+='<rect class="rb" data-i="'+i+'" x="'+(cx-bw/2).toFixed(1)+'" y="'+(Tp+hh-hb).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+hb.toFixed(1)+'" fill="#cde1f0"/>';if(r[0].slice(5)==="01"||i===0)s+='<text x="'+cx.toFixed(1)+'" y="'+(H-10)+'" text-anchor="'+(i===0?"start":"middle")+'" font-size="13" fill="#4a6b82">'+(i===0?mName(r[0]):r[0].slice(0,4))+'</text>'});
    s+='<path d="'+rc.map(function(r,i){var cx=L+(n===1?w/2:i*w/(n-1));return(i?"L":"M")+cx.toFixed(1)+" "+(Tp+hh-r[1]/5*hh).toFixed(1)}).join(" ")+'" fill="none" stroke="#f08a24" stroke-width="3"/></svg>';
    el.innerHTML=s;el.querySelectorAll(".rb").forEach(function(b){var r=rc[+b.getAttribute("data-i")];b.addEventListener("mousemove",function(ev){showTip("<b>"+mName(r[0],true)+"</b>Average "+r[1].toFixed(2)+" out of 5, from "+fmt(r[2])+" ratings",ev.clientX,ev.clientY)});b.addEventListener("mouseleave",hideTip)})}
}
function route(){
  var hs=String(location.hash),m=hs.match(/^#course-(\\d+)$/),c=m?D.courses[+m[1]]:null;
  hideTip();
  if(c){coursePage(c);$("main").hidden=true;$("course").hidden=false;$("hero-title").textContent=c.name;$("hero-lead").textContent="A course by "+D.name+" on SURGhub, the UN Global Surgery Learning Hub. Figures to "+D.asOf+".";$("hero-actions").hidden=true;window.scrollTo(0,0)}
  else{var was=!$("course").hidden;$("course").hidden=true;$("main").hidden=false;$("hero-title").textContent=D.name;$("hero-lead").textContent="Your courses on SURGhub, the UN Global Surgery Learning Hub. Figures to "+D.asOf+".";$("hero-actions").hidden=false;
    var t=hs.length>1?document.getElementById(hs.slice(1)):null;if(was||t)(t||$("sec-courses")).scrollIntoView()}
}
// the navigation: hide links to empty sections, mark the section in view
var navLinks=[].slice.call(document.querySelectorAll("#nav a"));
navLinks.forEach(function(a){var t=document.getElementById(a.getAttribute("href").slice(1));if(!t||t.hidden)a.hidden=true});
if(window.IntersectionObserver){var seen={};var io=new IntersectionObserver(function(es){es.forEach(function(e){seen[e.target.id]=e.isIntersecting});var on=null;navLinks.forEach(function(a){if(!on&&seen[a.getAttribute("href").slice(1)])on=a});navLinks.forEach(function(a){a.classList.toggle("on",a===on)})},{rootMargin:"-80px 0px -55% 0px"});
  navLinks.forEach(function(a){var t=document.getElementById(a.getAttribute("href").slice(1));if(t)io.observe(t)})}
window.addEventListener("hashchange",route);route();
})();`;
    },
});
