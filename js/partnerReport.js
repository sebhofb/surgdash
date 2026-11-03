// ── Partner dashboard in the GSF design (Nov 2026) ───────────────────────────────────────
//
// A provider's web report built from scratch on the Global Surgery Foundation Design System,
// to read like the GSF website: a navy hero with a photograph from the website (faded in from
// the left), white sections, Arial Black headings in strong blue, plain large figures, light-
// blue graphics, gold only for emphasis, a navy footer with the white logo. One self-contained
// page: images inline, charts drawn as SVG, no outside scripts, readable on a phone.
//
// The figures come from _assembleReportData (reports.js), the same as the dark report, so the
// numbers do not change with the design. partnerDash.js uses it for a provider whose design is
// 'gsf' and puts the downloads where <!--SH-DOWNLOADS--> stands.
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
    _prMonthName(ym, long) {
        const m = String(ym || '').match(/^(\d{4})-(\d{2})/); if (!m) return '';
        return new Date(Date.UTC(+m[1], +m[2] - 1, 15)).toLocaleDateString('en-GB', { month: long ? 'long' : 'short', year: 'numeric', timeZone: 'UTC' });
    },
    _prLastDay(ym) {
        const m = String(ym || '').match(/^(\d{4})-(\d{2})/); if (!m) return '';
        return new Date(Date.UTC(+m[1], +m[2], 0)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    },
    // Months from the first to the last, gaps filled, cut at the data-through month.
    _prSeries(tl, through) {
        const keys = Object.keys(tl || {}).filter(k => /^\d{4}-\d{2}$/.test(k) && (!through || k <= through)).sort();
        if (!keys.length) return [];
        const out = []; let [y, m] = keys[0].split('-').map(Number); const last = keys[keys.length - 1];
        let e = 0, c = 0;
        for (let g = 0; g < 600; g++) {
            const k = y + '-' + String(m).padStart(2, '0'); if (k > last) break;
            const v = tl[k] || {}; e += Number(v.e) || 0; c += Number(v.c) || 0;
            out.push({ m: k, e, c, de: Number(v.e) || 0 });
            m++; if (m > 12) { m = 1; y++; }
        }
        return out;
    },
    // Cumulative enrolments (strong blue, light area) and certificates (dark blue line) as SVG.
    _prGrowthSvg(series, fmt) {
        if (!series || series.length < 2) return '';
        const W = 1000, H = 300, L = 64, R = 16, T = 16, B = 40, w = W - L - R, h = H - T - B;
        const max = Math.max(1, series[series.length - 1].e, series[series.length - 1].c);
        const raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map(x => x * p).find(x => x >= raw), top = step * Math.ceil(max / step);
        const x = (i) => L + (series.length === 1 ? 0 : i * w / (series.length - 1)), y = (v) => T + h - (v / top) * h;
        const line = (k) => series.map((s, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(s[k]).toFixed(1)).join(' ');
        let grid = '';
        for (let i = 0; i <= Math.round(top / step); i++) { const v = step * i, yy = y(v).toFixed(1); grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" stroke="#dee7ef"/><text x="' + (L - 10) + '" y="' + yy + '" dy="4" text-anchor="end" font-size="13" fill="#4a6b82">' + fmt(v) + '</text>'; }
        let ticks = '';
        series.forEach((s, i) => { if (s.m.endsWith('-01') || i === 0) ticks += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="' + (i === 0 ? 'start' : 'middle') + '" font-size="13" fill="#4a6b82">' + (i === 0 ? this._prMonthName(s.m) : s.m.slice(0, 4)) + '</text>'; });
        const area = line('e') + ' L' + x(series.length - 1).toFixed(1) + ' ' + (T + h) + ' L' + L + ' ' + (T + h) + ' Z';
        const last = series[series.length - 1];
        return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Course enrolments and certificates over time" style="width:100%;height:auto;display:block">'
            + grid + ticks
            + '<path d="' + area + '" fill="#e6f0f8"/>'
            + '<path d="' + line('e') + '" fill="none" stroke="#0468b1" stroke-width="3" stroke-linejoin="round"/>'
            + '<path d="' + line('c') + '" fill="none" stroke="#002f4c" stroke-width="3" stroke-linejoin="round"/>'
            + '<circle cx="' + x(series.length - 1).toFixed(1) + '" cy="' + y(last.e).toFixed(1) + '" r="5" fill="#0468b1"/>'
            + '<circle cx="' + x(series.length - 1).toFixed(1) + '" cy="' + y(last.c).toFixed(1) + '" r="5" fill="#002f4c"/>'
            + '</svg>';
    },
    _prSpark(series) {
        if (!series || series.length < 2) return '';
        const W = 160, H = 40, max = Math.max(1, series[series.length - 1].e);
        const d = series.map((s, i) => (i ? 'L' : 'M') + (i * W / (series.length - 1)).toFixed(1) + ' ' + (H - 2 - (s.e / max) * (H - 4)).toFixed(1)).join(' ');
        return '<svg viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true" style="width:160px;height:40px;display:block"><path d="' + d + ' L' + W + ' ' + H + ' L0 ' + H + ' Z" fill="#e6f0f8"/><path d="' + d + '" fill="none" stroke="#0468b1" stroke-width="2"/></svg>';
    },

    async _buildPartnerReportHtml(providerName, opts) {
        opts = opts || {};
        const D = await this._assembleReportData(providerName, {});
        if (!D) return null;
        const esc = (s) => this.escapeHtml(String(s == null ? '' : s));
        const fmt = (n) => this.formatNumber(Math.round(Number(n) || 0));
        const scrub = (t) => this.scrubPersonal ? this.scrubPersonal(String(t || '')) : String(t || '');
        // The full name ("GSF - Global Surgery Foundation" reads "Global Surgery Foundation")
        const name = String(providerName).includes(' - ') ? String(providerName).split(' - ').slice(1).join(' - ').trim() : (this.providerFolderName ? this.providerFolderName(providerName) : providerName);
        const through = this.reportDataThrough || (this._lastFullMonth ? this._lastFullMonth() : '');
        const asOf = through ? this._prLastDay(through) : esc(D.reportDate);
        const logoBlue = this._prImage('gsf_logo_blue.png'), logoWhite = this._prImage('gsf_logo_white_web.png'), hero = this._prImage('hero_surghub.jpg');
        const provLogo = /^GSF\b|Global Surgery Foundation/i.test(providerName) ? '' : this._prProviderLogo(providerName);   // GSF's logo is already at the top

        // ── figures ──
        const courses = (D.coursesSorted || []).filter(c => c && c.Course);
        const countries = Object.entries(D.providerCountryData || {}).filter(([k]) => k && k !== 'Unknown').sort((a, b) => b[1] - a[1]);
        const withCountry = countries.reduce((s, [, n]) => s + n, 0);
        const rating = Number(D.avgRating) > 0 ? Number(D.avgRating).toFixed(2) : '';
        const certRate = D.certRate != null && D.certRate !== '' ? D.certRate + '%' : '';
        const learningTime = D.totalMin > 0 && this.formatLearningTime ? this.formatLearningTime(D.totalMin) : '';
        const series = this._prSeries(D.provTimeline, through);
        const si = D.surveyImpact || {};

        const stat = (value, label, sub) => '<div class="stat"><div class="stat-v">' + value + '</div><div class="stat-l">' + label + '</div>' + (sub ? '<div class="stat-s">' + sub + '</div>' : '') + '</div>';
        const stats = [
            stat(fmt(D.totalLrn), 'Course enrolments', 'One learner can enrol in several courses'),
            stat(fmt(D.totalCert), 'Certificates', certRate ? certRate + ' of enrolments' : ''),
            countries.length ? stat(fmt(countries.length), 'Countries', 'Where learners told us their country') : '',
            rating ? stat(rating, 'Average rating', 'Out of 5, from ' + fmt(D.totalResp) + ' survey responses') : '',
            learningTime ? stat(esc(learningTime), 'Learning time', 'Recorded across all learners') : '',
            stat(fmt(courses.length), courses.length === 1 ? 'Course' : 'Courses', 'On SURGhub'),
        ].filter(Boolean).join('');

        // ── recognition ──
        const awards = (D.providerAwards || []).slice().sort((a, b) => a.rank - b.rank).map(a =>
            '<span class="tag tag-gold">' + esc(String(a.label || '').toLowerCase().replace(/^\w/, c => c.toUpperCase())) + (a.rank === 1 ? ' of ' : ': number ' + a.rank + ' of ') + fmt(a.total) + ' providers on SURGhub</span>');
        const topCountries = (D.providerCountryAwards || []).filter(c => c.rank === 1).map(c => c.country);
        const recognition = (awards.length || topCountries.length) ? '<div class="tags">' + awards.join('')
            + (topCountries.length ? '<span class="tag">More learners than any other provider from ' + esc(topCountries.slice(0, 6).join(', ')) + (topCountries.length > 6 ? ' and ' + (topCountries.length - 6) + ' more countries' : '') + '</span>' : '') + '</div>' : '';

        // ── where learners are ──
        const top10 = countries.slice(0, 10), topMax = top10.length ? top10[0][1] : 1;
        const countryBars = top10.map(([c, n]) => '<div class="bar-row"><div class="bar-l">' + esc(c) + '</div><div class="bar-t"><div class="bar-f" style="width:' + Math.max(2, n / topMax * 100).toFixed(1) + '%"></div></div><div class="bar-n">' + fmt(n) + '<span>' + (withCountry ? (n / withCountry * 100).toFixed(1) + '%' : '') + '</span></div></div>').join('');

        // ── what learners say ──
        const impact = [
            si.contentNew ? stat(si.contentNew.pct + '%', 'found the content new', 'of ' + fmt(si.contentNew.n) + ' who answered') : '',
            si.willApply ? stat(si.willApply.pct + '%', 'are likely to apply it at work', 'of ' + fmt(si.willApply.n) + ' who answered') : '',
            si.careerValue ? stat(si.careerValue.pct + '%', 'rate it important for their work', 'of ' + fmt(si.careerValue.n) + ' who answered') : '',
        ].filter(Boolean).join('');
        const whoFor = (f) => {
            const d = f.e ? (this._emailDemoMap || {})[String(f.e).trim().toLowerCase()] : null;
            const prof = d && d.profession ? ((this._tmCadre ? this._tmCadre(d.profession) : '') || String(d.profession).replace(/[-_]+/g, ' ')).toLowerCase().replace(/^\w/, c => c.toUpperCase()) : '';
            const parts = d ? [prof, d.country].filter(Boolean) : [];
            return parts.length ? parts.join(', ') : 'SURGhub learner';
        };
        let quotes = [];
        if (D.courseTestimonials) Object.entries(D.courseTestimonials).forEach(([c, list]) => (list || []).forEach(f => quotes.push(Object.assign({ _course: c }, f))));
        else quotes = (D.testimonials || []).slice();
        quotes = quotes.map(f => ({ t: scrub(f.t).trim(), who: whoFor(f), course: f._course || f.course || '' })).filter(q => q.t.length >= 25).slice(0, 6);
        const quoteCards = quotes.map(q => '<figure class="quote"><blockquote>' + esc(q.t) + '</blockquote><figcaption><b>' + esc(q.who) + '</b>' + (q.course ? '<span>' + esc(q.course) + '</span>' : '') + '</figcaption></figure>').join('');
        const summary = D.fbSummaries && D.fbSummaries['@provider:' + providerName] && D.fbSummaries['@provider:' + providerName].s;

        // ── courses ──
        const courseCards = courses.map(c => {
            const s = this._prSeries((D.courseTimelines || {})[c.Course], through);
            const cr = Number(c.Learners) > 0 ? (Number(c.Certificates) / Number(c.Learners) * 100).toFixed(1) + '%' : '–';
            const cc = (D.courseCountryData || {})[c.Course];
            const tops = cc && cc.top10 ? cc.top10.slice(0, 3).map(([k]) => esc(k)).join(', ') : '';
            return '<article class="course"><div class="course-h"><h3>' + esc(c.Course) + '</h3>' + this._prSpark(s) + '</div>'
                + '<dl><div><dt>Enrolments</dt><dd>' + fmt(c.Learners) + '</dd></div><div><dt>Certificates</dt><dd>' + fmt(c.Certificates) + '</dd></div><div><dt>Certification rate</dt><dd>' + cr + '</dd></div>'
                + '<div><dt>Rating</dt><dd>' + (Number(c.Rating) > 0 ? Number(c.Rating).toFixed(2) : '–') + '</dd></div><div><dt>Responses</dt><dd>' + fmt(c.Responses) + '</dd></div></dl>'
                + (tops ? '<p class="course-c">Most learners from ' + tops + '</p>' : '') + '</article>';
        }).join('');

        const css = `
:root{--blue:#0468b1;--blue-h:#035c9d;--navy:#002f4c;--navy-r:#173f5c;--light:#91b5d9;--tint:#e6f0f8;--line:#dee7ef;--line2:#cde1f0;--gold:#ffc145;--muted:#4a6b82}
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
.intro{font-size:16px;color:var(--muted);max-width:720px;margin:0 0 28px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:24px}
.stat{border-top:3px solid var(--light);padding-top:16px}
.stat-v{font-family:"Arial Black",Arial,sans-serif;font-weight:900;font-size:44px;line-height:1;letter-spacing:-.01em;color:var(--blue)}
.stat-l{margin-top:10px;font-weight:700;font-size:16px;line-height:1.35}
.stat-s{margin-top:4px;font-size:13px;color:var(--muted)}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:28px}
.tag{display:inline-flex;align-items:center;font-weight:700;font-size:13px;line-height:1.3;padding:7px 14px;border-radius:999px;background:var(--tint);color:var(--blue)}
.tag-gold{background:var(--gold);color:var(--navy)}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 1px 3px rgba(0,47,76,.08),0 1px 2px rgba(0,47,76,.06);padding:28px}
.legend{display:flex;gap:20px;flex-wrap:wrap;font-size:14px;font-weight:700;margin:0 0 12px}.legend i{display:inline-block;width:14px;height:4px;border-radius:2px;margin-right:8px;vertical-align:middle}
.two{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.bar-row{display:grid;grid-template-columns:150px 1fr 96px;gap:12px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line);font-size:14px}
.bar-l{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar-t{background:var(--tint);border-radius:4px;height:10px}.bar-f{background:var(--blue);height:10px;border-radius:4px}
.bar-n{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}.bar-n span{display:inline-block;min-width:46px;font-weight:400;color:var(--muted);margin-left:6px}
.note{font-size:13px;color:var(--muted);margin:12px 0 0}
.summary{margin-top:32px;border-left:0;background:#fff;border:1px solid var(--line);border-radius:12px;padding:28px 32px;font-family:Georgia,"Times New Roman",serif;font-size:17px;line-height:1.65;max-width:900px}
.summary small{display:block;margin-top:12px;font-family:Arial,sans-serif;font-size:13px;color:var(--muted)}
.quotes{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;margin-top:32px}
.quote{margin:0;background:var(--tint);border-radius:12px;padding:28px}
.quote blockquote{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:17px;line-height:1.65;color:var(--navy)}
.quote blockquote:before{content:"\\201C";display:block;font-family:Georgia,serif;font-size:56px;line-height:.6;color:var(--blue);margin-bottom:10px}
.quote figcaption{margin-top:16px;font-size:14px}.quote figcaption b{display:block}.quote figcaption span{display:block;color:var(--muted);margin-top:2px}
.courses{display:grid;grid-template-columns:repeat(auto-fit,minmax(460px,1fr));gap:24px}
.course{background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 1px 3px rgba(0,47,76,.08);padding:24px}
.course-h{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
.course h3{margin:0;font-size:19px;line-height:1.25;color:var(--navy)}
.course dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:14px 12px;margin:18px 0 0}.course dl div{min-width:0}
.course dt{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.course dd{margin:4px 0 0;font-family:"Arial Black",Arial,sans-serif;font-weight:900;font-size:19px;color:var(--blue)}
.course-c{margin:14px 0 0;font-size:14px;color:var(--muted)}
.dl{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.btn{display:inline-flex;align-items:center;gap:8px;font:700 15px Arial,sans-serif;padding:11px 22px;border-radius:9px;border:2px solid var(--blue);background:var(--blue);color:#fff;cursor:pointer}
.btn:hover{background:var(--blue-h);border-color:var(--blue-h)}.btn.sec{background:#fff;color:var(--blue)}.btn.sec:hover{background:var(--tint)}
.btn:focus-visible,a:focus-visible{outline:none;box-shadow:0 0 0 2px #002f4c,0 0 0 5px #ffc145}
.notes{columns:2;column-gap:40px;font-size:14px;color:var(--navy)}.notes p{margin:0 0 12px;break-inside:avoid}.notes b{color:var(--navy)}
footer{margin-top:72px;background:var(--navy);color:#fff}footer .wrap{display:flex;justify-content:space-between;align-items:center;gap:24px;flex-wrap:wrap;padding-top:40px;padding-bottom:40px}
footer img{height:52px;width:auto}footer p{margin:0;font-size:14px;color:rgba(255,255,255,.85);text-align:right}footer a{color:#fff}
@media (max-width:760px){.courses{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr;gap:20px}h2{font-size:24px}.stat-v{font-size:32px}.top img{height:36px}.hero h1{font-size:34px}.hero-photo{width:100%;opacity:.35}.two{grid-template-columns:1fr}.notes{columns:1}.bar-row{grid-template-columns:110px 1fr 84px}footer p{text-align:left}}
@media print{.hero{border-radius:0}.dl{display:none}section{break-inside:avoid}}`;

        const growth = series.length >= 2 ? `
<section><div class="wrap">
  <p class="eyebrow">Growth</p><h2>Enrolments and certificates over time</h2>
  <p class="intro">Running totals by month, from the first enrolment to ${esc(this._prMonthName(series[series.length - 1].m, true))}.</p>
  <div class="card"><div class="legend"><span><i style="background:#0468b1"></i>Course enrolments</span><span><i style="background:#002f4c"></i>Certificates</span></div>${this._prGrowthSvg(series, fmt)}</div>
</div></section>` : '';

        const where = countryBars ? `
<section><div class="wrap">
  <p class="eyebrow">Reach</p><h2>Where your learners are</h2>
  <p class="intro">Learners from ${fmt(countries.length)} countries took your courses. The ten largest:</p>
  <div class="card">${countryBars}<p class="note">Country is known for ${fmt(withCountry)} of ${fmt(D.totalLrn)} enrolments, so shares are of the enrolments with a known country.</p></div>
</div></section>` : '';

        const voices = (impact || quoteCards || summary) ? `
<section><div class="wrap">
  <p class="eyebrow">Learner voices</p><h2>What learners say</h2>
  <p class="intro">From the survey at the end of each course${D.totalResp ? ', ' + fmt(D.totalResp) + ' responses in all' : ''}.</p>
  ${impact ? '<div class="stats">' + impact + '</div>' : ''}
  ${summary ? '<div class="summary">' + esc(summary) + '<small>A summary of the written answers in the end-of-course surveys.</small></div>' : ''}
  ${quoteCards ? '<div class="quotes">' + quoteCards + '</div>' : ''}
</div></section>` : '';

        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><title>${esc(name)} on SURGhub</title><style>${css}</style></head><body>
<header class="top"><div class="wrap">${logoBlue ? '<img src="' + logoBlue + '" alt="Global Surgery Foundation">' : '<b>Global Surgery Foundation</b>'}<span>SURGhub partner dashboard</span></div></header>
<div class="hero">${hero ? '<div class="hero-photo" style="background-image:url(' + hero + ')"></div>' : ''}<div class="wrap">
  ${provLogo ? '<div class="plogo"><img src="' + provLogo + '" alt="' + esc(name) + '"></div>' : ''}
  <p class="eyebrow">SURGhub partner dashboard</p>
  <h1>${esc(name)}</h1>
  <p class="lead">Your courses on SURGhub, the UN Global Surgery Learning Hub. Figures to ${esc(asOf)}.</p>
</div>${hero ? '<div class="credit">Photo: Gulu University Surgical Equity Society</div>' : ''}</div>

<section><div class="wrap">
  <p class="eyebrow">At a glance</p><h2>Your courses in numbers</h2>
  <p class="intro">All of your courses on SURGhub, since each one opened.</p>
  <div class="stats">${stats}</div>
  ${recognition}
</div></section>
${growth}${where}${voices}
<section><div class="wrap">
  <p class="eyebrow">Courses</p><h2>Course by course</h2>
  <p class="intro">Largest first. The small chart shows each course's enrolments building up over time.</p>
  <div class="courses">${courseCards}</div>
</div></section>

<!--SH-DOWNLOADS-->

<section><div class="wrap">
  <p class="eyebrow">About these figures</p><h2>How we count</h2>
  <div class="notes">
    <p><b>Course enrolments</b> count every enrolment in your courses, whether or not the learner has started. One person who takes two of your courses counts twice.</p>
    <p><b>Certificates</b> are the course certificates learners earned. The certification rate is certificates divided by enrolments.</p>
    <p><b>Countries</b> come from what learners give in their SURGhub profile; not every learner gives one.</p>
    <p><b>Ratings and survey answers</b> come from the survey at the end of each course. Quotes are shown as learners wrote them, without names.</p>
    <p><b>Figures run to ${esc(asOf)}.</b> They come from SURGhub and are prepared by the Global Surgery Foundation with SURGdash.</p>
    <p>Questions about this dashboard: <a href="mailto:info@globalsurgeryfoundation.org">info@globalsurgeryfoundation.org</a></p>
  </div>
</div></section>

<footer><div class="wrap">${logoWhite ? '<img src="' + logoWhite + '" alt="Global Surgery Foundation">' : '<b>Global Surgery Foundation</b>'}<p>SURGhub, the UN Global Surgery Learning Hub, is the Global Surgery Foundation's online learning platform.<br><a href="https://www.globalsurgeryfoundation.org">globalsurgeryfoundation.org</a></p></div></footer>
</body></html>`;
        return html;
    },
});
