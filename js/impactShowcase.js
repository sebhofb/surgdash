// SURGhub Impact Showcase — a self-contained, scrollytelling impact microsite generated
// from LIVE, PII-FREE SURGhub aggregates. Dark editorial design (Spike-style): count-ups,
// scroll reveals, a draw-in growth chart with a scrubber, a GeoChart world map with hover +
// a low-income focus toggle, survey dials, an ambassador funnel and curated learner voices.
//
// HARD RULE: this is a PUBLIC artifact. It only ever reads AGGREGATES (counts / curated text).
// No emails, no names, no per-learner rows. The output is scanned for '@' before it is written.
(function () {
  const ROOT = (typeof window !== 'undefined') ? window : {};

  const ImpactShowcase = {

    // ---- assemble the PII-free data object from live app state -------------------
    async _assemble() {
      const snap = (ROOT.App && App.getAnalyticsSnap) ? (App.getAnalyticsSnap() || []) : [];
      const aud = ((ROOT.App && App.userHistory) || []).slice()
        .sort((a, b) => String(b.Timestamp || '').localeCompare(String(a.Timestamp || '')))[0] || null;
      const parse = (ROOT.Charts && Charts.safeParse)
        ? (s) => Charts.safeParse(s)
        : (s) => { try { return JSON.parse(s) || {}; } catch (e) { return {}; } };
      const scale = (ROOT.Charts && Charts.getScaledTimeline)
        ? (t) => Charts.getScaledTimeline(t, true)
        : (t) => parse(t);

      let certs = 0, enrol = 0;
      snap.forEach(d => { certs += Number(d.Certificates) || 0; enrol += Number(d.Learners) || 0; });
      const learners = aud ? (Number(aud.TotalUsers) || 0) : (Number(App.platformUniqueUsers) || 0);
      const countries = aud ? (Number(aud.KnownCountry) || 0) : 0;

      // learning time (minutes) — shared resolver so totals reconcile with the dashboard
      const cmins = (App.getCourseLearningMinutes ? App.getCourseLearningMinutes() : {}) || {};
      let minutes = 0;
      snap.forEach(d => { minutes += App.courseLearningMinutes ? App.courseLearningMinutes(d, cmins) : (Number(d.LearningMinutes) || 0); });

      const provSet = {}; snap.forEach(d => { if (d.Provider) provSet[d.Provider] = 1; });
      const providers = Object.keys(provSet).length;
      const courses = snap.filter(d => (Number(d.Learners) || 0) > 50).length;

      // cumulative monthly series on a fixed axis: launch (Jun 2023) → last complete month
      const signups = (aud && aud.Signups) ? parse(aud.Signups) : {};
      const certMonth = {};
      snap.forEach(d => { if (!d.CourseTimeline) return; const sc = scale(d.CourseTimeline) || {}; Object.keys(sc).forEach(m => { certMonth[m] = (certMonth[m] || 0) + ((sc[m] && sc[m].c) || 0); }); });
      const nd = new Date();
      const nowMonth = nd.getFullYear() + '-' + String(nd.getMonth() + 1).padStart(2, '0');
      const START = '2023-06';
      let end = '';
      [signups, certMonth].forEach(mp => Object.keys(mp).forEach(m => { if (/^\d{4}-\d{2}$/.test(m) && m < nowMonth && m > end) end = m; }));
      const monthRange = (s, e) => { const out = []; if (!s || !e || e < s) return out; let y = +s.slice(0, 4), mo = +s.slice(5, 7); const ey = +e.slice(0, 4), em = +e.slice(5, 7); while (y < ey || (y === ey && mo <= em)) { out.push(y + '-' + String(mo).padStart(2, '0')); mo++; if (mo > 12) { mo = 1; y++; } } return out; };
      const cum = (mp) => { let base = 0; Object.keys(mp).forEach(m => { if (/^\d{4}-\d{2}$/.test(m) && m < START) base += Number(mp[m]) || 0; }); let r = base; return monthRange(START, end).map(m => { r += Number(mp[m]) || 0; return { m: m, v: Math.round(r) }; }); };

      // country reach → ISO alpha-2; income split (by name, before ISO); LMIC/LIC subset
      const cc = (App.aggregateCourseCountries ? App.aggregateCourseCountries(snap) : { counts: {} }).counts || {};
      const iso = {}, isoLMIC = {};
      const inc = { HIC: 0, UMIC: 0, LMIC: 0, LIC: 0, Unknown: 0 };
      const IC = ROOT.IncomeClassification || null;
      Object.keys(cc).forEach(name => {
        const n = Number(cc[name]) || 0; if (n <= 0) return;
        const code = (ROOT.countryToISO && countryToISO(name)) || null;
        const tier = IC ? IC.classify(name) : 'Unknown';
        if (inc[tier] === undefined) inc[tier] = 0;
        inc[tier] += n;
        if (code) { iso[code] = (iso[code] || 0) + n; if (tier === 'LMIC' || tier === 'LIC') isoLMIC[code] = (isoLMIC[code] || 0) + n; }
      });
      const incTotal = inc.HIC + inc.UMIC + inc.LMIC + inc.LIC + inc.Unknown;
      const incomeOrder = [['LIC', 'Low income'], ['LMIC', 'Lower-middle'], ['UMIC', 'Upper-middle'], ['HIC', 'High income']];
      const income = incTotal > 0 ? incomeOrder.map(([t, label]) => ({ tier: t, label: label, count: inc[t], pct: Math.round(inc[t] / incTotal * 100) })) : [];
      const lmicShare = incTotal > 0 ? Math.round((inc.LMIC + inc.LIC) / incTotal * 100) : 0;

      const conflict = App.getConflictLearners ? App.getConflictLearners(aud) : 0;

      // cadres (authoritative ActivityStats) — counts only
      let cadres = [];
      try { const a = parse(aud && aud.ActivityStats); cadres = Object.keys(a).map(k => ({ name: k, v: Number(a[k]) || 0 })).filter(x => x.v > 0 && x.name && x.name.toLowerCase() !== 'unknown').sort((a, b) => b.v - a.v).slice(0, 6); } catch (e) { cadres = []; }

      let survey = null;
      try { survey = App._surveyImpactStats ? App._surveyImpactStats(snap) : null; } catch (e) { survey = null; }

      // ambassador downstream reach (counts only) — load from memory or disk
      let rb = (ROOT.App && App._referrerBridge) || null;
      if (!rb && ROOT.Storage) { try { rb = await Storage.getItem('surghub_referrer_bridge'); } catch (e) { rb = null; } }
      let amb = null;
      if (rb && rb.totalBridged) {
        amb = { referrers: rb.distinctReferrers || 0, bridged: rb.totalBridged || 0, hasOutcomes: !!rb.hasOutcomes,
          active: rb.hasOutcomes ? (rb.activeLearners || 0) : 0, certs: rb.hasOutcomes ? (rb.totalCerts || 0) : 0 };
      }

      // platform rating distribution from FeedbackBank .r (1–5) — NUMBERS ONLY. Also a
      // text→rating map (normalised) so curated quotes can show their own star rating.
      const ratingMap = {}; let rTotal = 0, rSum = 0, r45 = 0;
      const normT = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 140);
      snap.forEach(d => {
        if (!d || !d.FeedbackBank) return;
        let fb; try { fb = JSON.parse(d.FeedbackBank); } catch (e) { return; }
        (Array.isArray(fb) ? fb : []).forEach(f => {
          const r = Number(f && f.r) || 0;
          if (r >= 1 && r <= 5) { rTotal++; rSum += r; if (r >= 4) r45++; if (f.t) ratingMap[normT(f.t)] = r; }
        });
      });
      const rating = rTotal >= 10 ? { avg: +(rSum / rTotal).toFixed(1), pct45: Math.round(r45 / rTotal * 100), n: rTotal } : null;

      // curated learner voices — TEXT ONLY (no attribution beyond a generic label). '@'-bearing dropped.
      // Each quote carries its own star rating when we can match it back to a FeedbackBank entry.
      let quotes = [];
      try {
        const sel = (ROOT.Storage ? (await Storage.getItem('surghub_selected_testimonials')) : null) || {};
        Object.keys(sel).forEach(prov => { const courses = sel[prov] || {}; Object.keys(courses).forEach(cn => { (courses[cn] || []).forEach(t => {
          if (typeof t === 'string') { const txt = t.trim(); if (txt.length >= 45 && txt.length <= 320 && txt.indexOf('@') === -1) quotes.push({ text: txt, course: cn, r: ratingMap[normT(txt)] || null }); }
        }); }); });
        quotes = quotes.slice(0, 9);
      } catch (e) { quotes = []; }

      // logos (base64-inlined; optional)
      let gsf = '', surghub = '';
      try {
        const read = (f) => { const lp = electronAPI.path.join(electronAPI.appPath, 'build', f); return electronAPI.fs.existsSync(lp) ? ('data:image/png;base64,' + electronAPI.fs.readFileBase64(lp)) : ''; };
        ['gsf_logo_white.png', 'gsf_logo_dark_bg.png', 'gsf_logo_full.png'].some(f => (gsf = read(f)));
        ['surghub_logo_white.png', 'SURGhub_app_square_white.png', 'surghub_logo.png', 'surghub_white.png'].some(f => (surghub = read(f)));
      } catch (e) {}

      const minutesToHours = Math.round(minutes / 60);
      const certRate = (App.formatCertRate ? App.formatCertRate(certs, enrol, { asNumber: true }) : (enrol > 0 ? +(certs / enrol * 100).toFixed(1) : null));

      return {
        snapshotDate: (aud && aud.Timestamp ? String(aud.Timestamp).slice(0, 10) : new Date().toISOString().slice(0, 10)),
        learners: learners, enrolments: enrol, certificates: certs,
        certRate: certRate, learningHours: minutesToHours, learningYears: Math.round(minutes / 525960),
        courses: courses, providers: providers, countries: countries,
        learnersSeries: cum(signups), certsSeries: cum(certMonth),
        countryMap: Object.keys(iso).length ? iso : null,
        countryMapLMIC: Object.keys(isoLMIC).length ? isoLMIC : null,
        income: income, lmicShare: lmicShare, conflict: conflict,
        cadres: cadres, survey: survey, amb: amb, rating: rating, quotes: quotes,
        logos: { gsf: gsf, surghub: surghub }
      };
    },

    async export() {
      try {
        if (!ROOT.App || !App.getAnalyticsSnap) { App.showMsg && App.showMsg('SURGhub data isn’t loaded yet.', true); return; }
        App.showMsg && App.showMsg('Building the impact showcase…');
        const D = await this._assemble();
        if (!D || !(D.learners || D.enrolments || D.certificates)) { App.showMsg('No SURGhub data to show — sync SURGhub first.', true); return; }

        // PII firewall: the public artifact must contain ZERO email-like values in its data.
        const probe = JSON.stringify({ a: D.learnersSeries, b: D.certsSeries, c: D.countryMap, d: D.countryMapLMIC, e: D.income, f: D.cadres, g: D.quotes, h: D.amb, i: D.survey, j: D.conflict });
        if (probe.indexOf('@') !== -1) { App.showMsg('Export blocked — the data failed the PII check (an email-like value was found). Nothing was written.', true); return; }

        const html = this._html(D);
        const savePath = await electronAPI.invoke('pick-save-path', 'surghub_impact_showcase.html');
        if (!savePath) { App.showMsg('Export cancelled.'); return; }
        electronAPI.fs.writeFileSync(savePath, html, 'utf8');
        App.showMsg('Impact showcase saved ✓ — a self-contained page you can open or host.');
      } catch (e) {
        console.error('[ImpactShowcase] export failed', e);
        App.showMsg && App.showMsg('Showcase export failed: ' + ((e && e.message) || e), true);
      }
    },

    _html(D) {
      const fmt = (n) => (Number(n) || 0) >= 1000 ? (Number(n) || 0).toLocaleString('en-US') : String(Number(n) || 0);
      const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const json = JSON.stringify(D).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');

      const kpi = (val, suf, cls, label, sub, pill) =>
        '<div class="kpi rv"><div class="v ' + (cls || '') + ' num" data-to="' + (val || 0) + '"' + (suf ? ' data-suffix="' + suf + '"' : '') + '>0</div>'
        + '<div class="l">' + label + '</div>' + (sub ? '<div class="s">' + sub + '</div>' : '') + (pill ? '<span class="pill">' + pill + '</span>' : '') + '</div>';

      const scaleCards = [
        kpi(D.learners, '', '', 'Registered learners', 'healthcare workers worldwide', ''),
        kpi(D.enrolments, '', 'boston', 'Course enrolments', 'across all providers', ''),
        kpi(D.certificates, '', 'green', 'Certificates earned', '', (D.certRate != null ? (D.certRate + '% completion rate') : '')),
        kpi(D.learningHours, '+', '', 'Hours of learning', (D.learningYears >= 1 ? ('≈ ' + D.learningYears + ' years, back to back') : ''), ''),
        kpi(D.courses, '', '', 'Courses', (D.providers ? ('from ' + D.providers + ' expert providers') : ''), ''),
        kpi(D.countries, '+', 'boston', 'Countries reached', 'on every continent', '')
      ].join('');

      const incomeBars = (D.income || []).map(r =>
        '<div class="bar"><span class="lab">' + esc(r.label) + '</span><div class="track"><div class="fill ' + (r.tier === 'LIC' || r.tier === 'LMIC' ? '' : 'slate') + '" data-w="' + r.pct + '"></div></div><span class="val num" data-to="' + r.pct + '" data-suffix="%">0</span></div>'
      ).join('');

      const cadreMax = (D.cadres || []).reduce((m, c) => Math.max(m, c.v), 0) || 1;
      const cadreBars = (D.cadres || []).map(c =>
        '<div class="bar"><span class="lab">' + esc(c.name) + '</span><div class="track"><div class="fill" data-w="' + Math.max(4, Math.round(c.v / cadreMax * 100)) + '"></div></div><span class="val num" data-to="' + c.v + '">0</span></div>'
      ).join('');

      const dials = D.survey ? [
        D.survey.contentNew ? '<div class="dial rv" data-pct="' + D.survey.contentNew.pct + '" data-cap="said the content was new to them"></div>' : '',
        D.survey.willApply ? '<div class="dial rv" data-pct="' + D.survey.willApply.pct + '" data-cap="intend to apply what they learned"></div>' : '',
        D.survey.careerValue ? '<div class="dial rv" data-pct="' + D.survey.careerValue.pct + '" data-cap="rate it important to their work"></div>' : ''
      ].join('') : '';
      const surveyN = D.survey ? Math.max((D.survey.willApply || {}).n || 0, (D.survey.contentNew || {}).n || 0, (D.survey.careerValue || {}).n || 0) : 0;

      const ambCards = D.amb ? (
        '<div class="kpi rv lite"><div class="v boston num" data-to="' + D.amb.referrers + '">0</div><div class="l">Active ambassadors</div></div>'
        + '<div class="kpi rv lite"><div class="v num" data-to="' + D.amb.bridged + '">0</div><div class="l">Learners they brought in</div></div>'
        + (D.amb.hasOutcomes ? '<div class="kpi rv lite"><div class="v num" data-to="' + D.amb.active + '">0</div><div class="l">Became active learners</div></div>' : '')
        + (D.amb.hasOutcomes ? '<div class="kpi rv lite"><div class="v green num" data-to="' + D.amb.certs + '">0</div><div class="l">Certificates earned</div></div>' : '')
      ) : '';

      const stars = (r) => { r = Math.round(Number(r) || 0); if (r < 1) return ''; let s = '<span class="stars">'; for (let i = 1; i <= 5; i++) s += '<span class="' + (i <= r ? 'on' : '') + '">★</span>'; return s + '</span>'; };

      const quoteCards = (D.quotes || []).map((q) =>
        '<div class="quote rv"><span class="mark">“</span><p class="q">' + esc(q.text) + '</p>' + (q.r ? stars(q.r) : '') + (q.course ? '<p class="by">— ' + esc(q.course) + '</p>' : '<p class="by">— A SURGhub learner</p>') + '</div>'
      ).join('');

      // Overall platform rating band (shown atop the voices section)
      const ratingBand = D.rating ? (
        '<div class="ratingband rv d1"><div class="rb-pct num" data-to="' + D.rating.pct45 + '" data-suffix="%">0</div>'
        + '<div class="rb-meta"><div class="rb-stars">★★★★★ <b>' + D.rating.avg + '</b><span> / 5 average</span></div>'
        + '<div class="rb-sub">of ' + fmt(D.rating.n) + ' learner ratings give SURGhub 4 or 5 stars</div></div></div>'
      ) : '';

      const sec = (id, dot, cls, inner) => '<section id="' + id + '" class="' + (cls || '') + '" data-dot="' + dot + '"><div class="wrap">' + inner + '</div></section>';

      // ---- the page script (runs in the exported file). Reads the global D. ----
      // Written in plain JS with <\/ escaping so it survives inlining; no template literals.
      function PAGE() {
        var reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
        function fmt(n) { n = Number(n) || 0; return n >= 1000 ? n.toLocaleString('en-US') : String(n); }

        var prog = document.getElementById('prog'), dotsNav = document.getElementById('dots');
        var sections = [].slice.call(document.querySelectorAll('section[data-dot]'));
        sections.forEach(function (s) { var a = document.createElement('a'); a.href = '#'; a.title = s.getAttribute('data-dot'); a.addEventListener('click', function (e) { e.preventDefault(); s.scrollIntoView({ behavior: 'smooth' }); }); dotsNav.appendChild(a); });
        var dotEls = [].slice.call(dotsNav.children);
        function onScroll() { var h = document.documentElement; prog.style.width = (h.scrollTop / (h.scrollHeight - h.clientHeight) * 100) + '%'; var mid = h.scrollTop + innerHeight * 0.4, act = 0; sections.forEach(function (s, i) { if (s.offsetTop <= mid) act = i; }); dotEls.forEach(function (d, i) { d.classList.toggle('on', i === act); }); }
        addEventListener('scroll', onScroll, { passive: true }); onScroll();

        function countUp(el) { var to = +el.getAttribute('data-to'), suf = el.getAttribute('data-suffix') || ''; if (reduce) { el.textContent = fmt(to) + suf; return; } var st = null; function step(ts) { st = st || ts; var p = Math.min((ts - st) / 1400, 1), e = 1 - Math.pow(1 - p, 4); el.textContent = fmt(Math.round(to * e)) + suf; if (p < 1) requestAnimationFrame(step); } requestAnimationFrame(step); }

        function buildDial(d) {
          var pct = +d.getAttribute('data-pct'), cap = d.getAttribute('data-cap') || '', r = 58, c = 2 * Math.PI * r;
          d.innerHTML = '<svg width="150" height="150" viewBox="0 0 150 150"><circle cx="75" cy="75" r="' + r + '" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="12"\/><circle class="ring" cx="75" cy="75" r="' + r + '" fill="none" stroke="#7fb6e3" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + c + '" style="transition:stroke-dashoffset 1.4s cubic-bezier(.2,.7,.2,1)"\/><text class="pc" x="75" y="75" text-anchor="middle" dominant-baseline="central" transform="rotate(90 75 75)">0%<\/text><\/svg><p class="cap">' + cap + '<\/p>';
          d._fire = function () { var ring = d.querySelector('.ring'), txt = d.querySelector('.pc'); if (reduce) { ring.style.strokeDashoffset = c * (1 - pct / 100); txt.textContent = pct + '%'; return; } requestAnimationFrame(function () { ring.style.strokeDashoffset = c * (1 - pct / 100); }); var st = null; function step(ts) { st = st || ts; var p = Math.min((ts - st) / 1400, 1), e = 1 - Math.pow(1 - p, 4); txt.textContent = Math.round(pct * e) + '%'; if (p < 1) requestAnimationFrame(step); } requestAnimationFrame(step); };
        }
        [].slice.call(document.querySelectorAll('.dial')).forEach(buildDial);

        // growth chart (inline SVG) with a hover scrubber
        function drawGrowth() {
          var svg = document.getElementById('growth'); if (!svg || svg._done) return;
          var A = D.learnersSeries || [], B = D.certsSeries || []; if (!A.length) { if (svg.parentNode) svg.parentNode.style.display = 'none'; svg._done = 1; return; }
          // Draw in REAL pixel coordinates read from the rendered element, and set the viewBox to
          // match — no reliance on SVG intrinsic / aspect-ratio sizing (which collapsed to 0 height
          // in some browsers). Retry on the next frame if the element isn't laid out yet.
          var W = svg.clientWidth || (svg.getBoundingClientRect ? svg.getBoundingClientRect().width : 0) || 0;
          var H = svg.clientHeight || 340;
          if (W < 50) { requestAnimationFrame(drawGrowth); return; }
          svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
          svg._done = 1;
          var padL = 10, padR = 12, padT = 22, padB = 30, n = A.length;
          var maxY = 1; A.forEach(function (p) { maxY = Math.max(maxY, p.v); });
          function X(i) { return padL + (W - padL - padR) * (i / (Math.max(1, n - 1))); }
          function Y(v) { return padT + (H - padT - padB) * (1 - v / maxY); }
          function path(arr) { var d = ''; for (var i = 0; i < arr.length; i++) { d += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(arr[i].v).toFixed(1) + ' '; } return d.trim(); }
          var area = 'M' + X(0) + ' ' + Y(0) + ' ' + path(A).slice(1) + ' L' + X(n - 1) + ' ' + Y(0) + ' Z';
          var lab0 = A[0].m, lab1 = A[n - 1].m;
          svg.innerHTML = '<line x1="' + padL + '" y1="' + Y(0) + '" x2="' + (W - padR) + '" y2="' + Y(0) + '" stroke="#e4edf4"\/>'
            + '<line x1="' + padL + '" y1="' + Y(maxY * 0.5) + '" x2="' + (W - padR) + '" y2="' + Y(maxY * 0.5) + '" stroke="#eef4f9"\/>'
            + '<path d="' + area + '" fill="rgba(47,134,201,.10)" opacity="0" id="garea"\/>'
            + '<path class="gline" d="' + (B.length ? path(B) : '') + '" stroke="#3FB984" id="gcert"\/>'
            + '<path class="gline" d="' + path(A) + '" stroke="#2f86c9" id="genr"\/>'
            + '<text x="' + (W - padR) + '" y="' + (Y(A[n - 1].v) - 10) + '" text-anchor="end" class="ann" fill="#1d6fb0">' + fmt(A[n - 1].v) + '<\/text>'
            + (B.length ? '<text x="' + (W - padR) + '" y="' + (Y(B[n - 1].v) - 8) + '" text-anchor="end" class="ann" fill="#2c9a72">' + fmt(B[n - 1].v) + '<\/text>' : '')
            + '<text x="' + padL + '" y="' + (H - 9) + '" font-size="12" fill="#90a6b8">' + lab0 + '<\/text>'
            + '<text x="' + (W - padR) + '" y="' + (H - 9) + '" text-anchor="end" font-size="12" fill="#90a6b8">' + lab1 + '<\/text>'
            + '<line id="gcur" x1="0" y1="' + padT + '" x2="0" y2="' + Y(0) + '" stroke="#9fc1dc" stroke-width="1" opacity="0"\/>'
            + '<circle id="gd1" r="4.5" fill="#2f86c9" opacity="0"\/><circle id="gd2" r="4.5" fill="#3FB984" opacity="0"\/>';
          var lines = [svg.querySelector('#genr'), svg.querySelector('#gcert')].filter(Boolean);
          lines.forEach(function (p) { var len = p.getTotalLength(); p.style.strokeDasharray = len; p.style.strokeDashoffset = len; if (!reduce) p.style.transition = 'stroke-dashoffset 1.5s ease'; });
          svg._fire = function () { lines.forEach(function (p) { p.style.strokeDashoffset = 0; }); var a = svg.querySelector('#garea'); a.style.transition = 'opacity 1.2s ease .3s'; a.style.opacity = 1; };
          if (reduce) svg._fire();
          // scrubber
          var tip = document.getElementById('growth-tip'), cur = svg.querySelector('#gcur'), d1 = svg.querySelector('#gd1'), d2 = svg.querySelector('#gd2');
          svg.addEventListener('mousemove', function (ev) {
            var r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * W;
            var i = Math.round((x - padL) / ((W - padL - padR) / Math.max(1, n - 1))); i = Math.max(0, Math.min(n - 1, i));
            cur.setAttribute('x1', X(i)); cur.setAttribute('x2', X(i)); cur.setAttribute('opacity', '.8');
            d1.setAttribute('cx', X(i)); d1.setAttribute('cy', Y(A[i].v)); d1.setAttribute('opacity', '1');
            if (B[i]) { d2.setAttribute('cx', X(i)); d2.setAttribute('cy', Y(B[i].v)); d2.setAttribute('opacity', '1'); }
            if (tip) { tip.style.opacity = 1; tip.innerHTML = '<b>' + A[i].m + '<\/b> &nbsp; <span style="color:#7fb6e3">' + fmt(A[i].v) + ' learners<\/span>' + (B[i] ? ' &nbsp; <span style="color:#3FB984">' + fmt(B[i].v) + ' certs<\/span>' : ''); }
          });
          svg.addEventListener('mouseleave', function () { cur.setAttribute('opacity', '0'); d1.setAttribute('opacity', '0'); d2.setAttribute('opacity', '0'); if (tip) tip.style.opacity = 0; });
        }

        // world map (Google GeoChart, ISO alpha-2 keyed, log colour ramp). Hover = native.
        var ramp = ['#123a5c', '#1a5485', '#2474b3', '#3f97d6', '#74bce9', '#bce3fb'];
        function drawMap(iso, tries) {
          var el = document.getElementById('map'); if (!el || !iso) return; tries = tries || 0;
          if (typeof google === 'undefined' || !google.charts || !google.charts.load) { if (tries < 40) setTimeout(function () { drawMap(iso, tries + 1); }, 150); else el.innerHTML = '<p class="mapoff">Interactive map needs an internet connection.<\/p>'; return; }
          google.charts.load('current', { packages: ['geochart'] });
          google.charts.setOnLoadCallback(function () {
            if (!google.visualization || !google.visualization.GeoChart) { el.innerHTML = '<p class="mapoff">Map unavailable.<\/p>'; return; }
            var total = 0, pairs = []; for (var k in iso) { if (Object.prototype.hasOwnProperty.call(iso, k)) { var v = Number(iso[k]) || 0; if (v > 0) { total += v; pairs.push([k, v]); } } }
            if (total <= 0) { el.innerHTML = '<p class="mapoff">No country data.<\/p>'; return; }
            var dt = new google.visualization.DataTable(); dt.addColumn('string', 'Country'); dt.addColumn('number', 'Share of learners (%)');
            var pcts = []; pairs.forEach(function (pr) { var pct = pr[1] / total * 100; pcts.push(pct); dt.addRow([pr[0], Math.round(pct * 100) / 100]); });
            pcts.sort(function (a, b) { return a - b; });
            var maxPct = pcts[pcts.length - 1], lo = Math.max(pcts[0] || 0.001, maxPct / 316), values = [], canLog = (maxPct > lo && lo > 0);
            if (canLog) { var rr = maxPct / lo; for (var ci = 0; ci < ramp.length; ci++) values.push(lo * Math.pow(rr, ci / (ramp.length - 1))); }
            var colorAxis = canLog ? { values: values, colors: ramp } : { minValue: 0, colors: ['#1d5e90', '#74bce9'] };
            var opts = { backgroundColor: 'transparent', datalessRegionColor: '#0b2c46', defaultColor: '#0b2c46', colorAxis: colorAxis, legend: 'none', keepAspectRatio: true, tooltip: { textStyle: { color: '#06243a', fontSize: 12 } } };
            try { new google.visualization.GeoChart(el).draw(dt, opts); } catch (e) {}
            var fp = function (p) { return p >= 10 ? Math.round(p) + '%' : (p >= 1 ? p.toFixed(1) + '%' : p.toFixed(2) + '%'); };
            var leg = document.getElementById('map-legend');
            if (leg) leg.innerHTML = '<div style="display:flex;align-items:center;gap:10px;max-width:440px;margin:14px auto 0"><span class="mono">0%<\/span><span style="flex:1;height:9px;border-radius:99px;background:linear-gradient(90deg,' + ramp.join(',') + ')"><\/span><span class="mono">' + fp(maxPct) + '<\/span><\/div><p class="mono" style="text-align:center;margin:8px 0 0">Share of total learners<\/p>';
          });
        }
        var mapBtn = document.getElementById('lmic-toggle'), mapFocus = false;
        if (mapBtn && !D.countryMapLMIC) mapBtn.style.display = 'none';
        if (mapBtn) mapBtn.addEventListener('click', function () { mapFocus = !mapFocus; mapBtn.textContent = mapFocus ? 'Show all countries' : 'Focus: low- & lower-middle income'; mapBtn.classList.toggle('on', mapFocus); var el = document.getElementById('map'); if (el) el.innerHTML = ''; drawMap(mapFocus ? D.countryMapLMIC : D.countryMap); });

        // hero starfield
        (function () { var cv = document.getElementById('dotsbg'); if (!cv) return; var ctx = cv.getContext('2d'); function sz() { cv.width = cv.offsetWidth; cv.height = cv.offsetHeight; } sz(); addEventListener('resize', sz); var pts = []; for (var i = 0; i < 70; i++) pts.push({ x: Math.random(), y: Math.random(), r: Math.random() * 2 + .6, s: Math.random() * .4 + .1 }); function frame() { ctx.clearRect(0, 0, cv.width, cv.height); ctx.fillStyle = 'rgba(127,182,227,.5)'; pts.forEach(function (p) { p.y -= p.s / 700; if (p.y < 0) p.y = 1; ctx.beginPath(); ctx.arc(p.x * cv.width, p.y * cv.height, p.r, 0, 7); ctx.fill(); }); if (!reduce) requestAnimationFrame(frame); } frame(); })();

        // reveal observer — fires count-ups, bars, dials, chart, map
        var io = new IntersectionObserver(function (ents) {
          ents.forEach(function (en) {
            if (!en.isIntersecting) return; var el = en.target; el.classList.add('in');
            if (el.hasAttribute && el.hasAttribute('data-to') && !el._d) { el._d = 1; countUp(el); }
            [].slice.call(el.querySelectorAll('[data-to]')).forEach(function (c) { if (!c._d) { c._d = 1; countUp(c); } });
            [].slice.call(el.querySelectorAll('.fill[data-w]')).forEach(function (f) { f.style.width = f.getAttribute('data-w') + '%'; });
            if (el.classList.contains('dial') && el._fire && !el._df) { el._df = 1; el._fire(); }
            if (el.querySelector && el.querySelector('#growth')) { drawGrowth(); var g = document.getElementById('growth'); if (g && g._fire && !g._gf) { g._gf = 1; setTimeout(g._fire, 150); } }
            if (el.querySelector && el.querySelector('#map') && !el._map) { el._map = 1; drawMap(D.countryMap); }
            io.unobserve(el);
          });
        }, { threshold: .22 });
        [].slice.call(document.querySelectorAll('.rv,.dial')).forEach(function (el) { io.observe(el); });
      }

      const heroBrand = D.logos.surghub
        ? '<img src="' + D.logos.surghub + '" alt="SURGhub" style="height:34px;width:auto;margin-bottom:18px">'
        : '<p class="brandtag rv">● <b>SURGhub</b> — Global Surgery Foundation</p>';

      const body =
        '<div id="prog"></div><nav id="dots"></nav>'
        + '<section id="hero" class="darker" data-dot="The hub"><canvas id="dotsbg"></canvas><div class="wrap" style="position:relative;z-index:2">'
        + heroBrand
        + '<h1 class="rv d1">Surgical knowledge,<br>made borderless.</h1>'
        + '<p class="lead rv d2">A free, open learning platform putting world-class surgical, anaesthesia and nursing education in the hands of the people who need it most — anywhere on earth. This is what it has built.</p>'
        + '</div><div class="cue">Scroll to explore ↓</div></section>'

        + sec('scale', 'The scale', 'dark', '<p class="eyebrow rv">The scale</p><h2 class="rv d1">A global classroom for surgical care.</h2><div class="kpis">' + scaleCards + '</div>')

        + sec('growth', 'Growth', '', '<p class="eyebrow rv">Adoption that compounds</p><h2 class="rv d1">From a launch to a movement.</h2><p class="lead rv d2" style="margin-bottom:24px">Month after month, more clinicians arrive — and more finish what they start. Hover the chart to read any month.</p><div class="chartcard rv d2"><div class="legend"><span><i class="sw" style="background:#2f86c9"></i>Registered learners</span><span><i class="sw" style="background:#3FB984"></i>Certificates earned</span></div><div id="growth-tip" class="tip"></div><svg id="growth" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Cumulative registered learners and certificates over time"></svg></div>')

        + sec('reach', 'Reach', 'dark', '<p class="eyebrow rv">World reach</p><div class="cols"><div><h2 class="rv">Where surgical care is hardest to reach.</h2><div class="bignum num rv d1" data-to="' + (D.countries || 0) + '" data-suffix="+">0</div><p class="statline rv d2">countries' + (D.lmicShare ? ' — with ' + D.lmicShare + '% of located learners in low- and lower-middle-income settings' : '') + '.</p>'
        + (D.conflict ? '<div class="conflict rv d3"><div class="v num" data-to="' + D.conflict + '" data-suffix="+">0</div><div class="l">learners in conflict-affected settings — Sudan, Yemen, Ukraine, Gaza and beyond.</div></div>' : '')
        + '<p class="muted rv d4" style="margin-top:18px">Country known for the majority of learners; the rest extrapolated.</p></div>'
        + '<div class="rv d2"><p class="muted" style="margin-bottom:14px">Located learners by World Bank income group</p><div class="bars">' + incomeBars + '</div></div></div>'
        + '<div class="rv d2" style="margin-top:34px"><div id="map" style="width:100%;height:460px"></div><div id="map-legend"></div><div style="text-align:center;margin-top:14px"><button id="lmic-toggle" class="toggle">Focus: low- &amp; lower-middle income</button></div></div>')

        + (cadreBars ? sec('who', 'Who', '', '<p class="eyebrow rv">Who is learning</p><h2 class="rv d1">The whole surgical team.</h2><p class="lead rv d2" style="margin-bottom:22px">Surgeons, nurses, anaesthesia providers, midwives — and the students who will follow them.</p><div class="bars rv d2">' + cadreBars + '</div>') : '')

        + (dials ? sec('impact', 'Impact', 'dark', '<p class="eyebrow rv">Not just viewed — applied</p><h2 class="rv d1">Learning that changes practice.</h2><div class="dials">' + dials + '</div>' + (surveyN ? '<p class="muted rv d4" style="text-align:center;margin-top:26px">Based on ' + fmt(surveyN) + ' post-course survey responses.</p>' : '')) : '')

        + (ambCards ? sec('network', 'Network', '', '<p class="eyebrow rv">Reach that multiplies</p><h2 class="rv d1">A community that spreads itself.</h2><p class="lead rv d2" style="margin-bottom:24px">Volunteer ambassadors bring SURGhub to their own networks — and their learners go on to earn certificates.</p><div class="kpis">' + ambCards + '</div>') : '')

        + ((quoteCards || ratingBand) ? sec('voices', 'Voices', 'dark', '<p class="eyebrow rv">Rated by learners</p><h2 class="rv d1">Trusted by the people who use it.</h2>' + ratingBand + (quoteCards ? '<div class="quotes">' + quoteCards + '</div>' : '') + (quoteCards ? '<p class="muted rv" style="margin-top:20px">Curated, anonymised learner feedback — no names or personal details.</p>' : '')) : '')

        + sec('join', 'Join', 'darker', '<p class="eyebrow rv">Open · free · global</p><h1 class="rv d1" style="font-size:clamp(30px,5vw,58px)">Surgical education<br>for everyone, everywhere.</h1><p class="lead rv d2">Over ' + fmt(D.learners) + ' healthcare workers in ' + fmt(D.countries) + '+ countries are already learning on SURGhub. Join them — or partner with the Global Surgery Foundation to reach more.</p><a class="btn rv d3" href="https://surghub.org" target="_blank" rel="noopener">Explore SURGhub →</a><p class="foot rv d4">Aggregated, anonymised platform data — counts only, no personal information. Data as of ' + esc(D.snapshotDate) + '. Built with SURGdash.</p>');

      const CSS = ':root{--prussian:#04263d;--prussian-deep:#021a2c;--boston:#2f86c9;--boston-soft:#7fb6e3;--green:#3FB984;--slate:#94a3b8;--red:#e57373;--ink:#0f2330;--paper:#f6f9fc;--paper2:#eef4f9;--line:rgba(255,255,255,.12)}'
        + '*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--paper);line-height:1.6;-webkit-font-smoothing:antialiased}'
        + '.num{font-variant-numeric:tabular-nums}.mono{font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:.06em;color:#6d8ba3;text-transform:uppercase}'
        + '#prog{position:fixed;top:0;left:0;height:3px;width:0;background:var(--boston);z-index:60}'
        + '#dots{position:fixed;right:18px;top:50%;transform:translateY(-50%);z-index:55;display:flex;flex-direction:column;gap:11px}#dots a{width:9px;height:9px;border-radius:50%;background:rgba(120,140,160,.45);transition:all .3s}#dots a.on{background:var(--boston);transform:scale(1.45)}@media(max-width:760px){#dots{display:none}}'
        + 'section{padding:9vh 6vw;position:relative}.dark{background:var(--prussian);color:#eaf2f8}.darker{background:var(--prussian-deep);color:#eaf2f8}.wrap{max-width:1040px;margin:0 auto}'
        + '.eyebrow{font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:var(--boston);font-weight:600;margin:0 0 14px}.dark .eyebrow,.darker .eyebrow{color:var(--boston-soft)}'
        + 'h1{font-size:clamp(34px,6vw,76px);line-height:1.04;margin:.1em 0 .35em;font-weight:700;letter-spacing:-.02em}h2{font-size:clamp(26px,3.6vw,44px);line-height:1.1;margin:0 0 .5em;font-weight:700;letter-spacing:-.015em}'
        + '.lead{font-size:clamp(17px,2vw,21px);max-width:60ch;color:#3d5567}.dark .lead,.darker .lead{color:#b9cede}.muted{color:var(--slate);font-size:14px}.dark .muted,.darker .muted{color:#7f9bb1}'
        + '.rv{opacity:0;transform:translateY(26px);transition:opacity .7s ease,transform .7s cubic-bezier(.2,.7,.2,1)}.rv.in{opacity:1;transform:none}.rv.d1{transition-delay:.08s}.rv.d2{transition-delay:.16s}.rv.d3{transition-delay:.24s}.rv.d4{transition-delay:.32s}'
        + '#hero{min-height:100vh;display:flex;align-items:center;overflow:hidden}#dotsbg{position:absolute;inset:0;z-index:1;opacity:.55}.brandtag{font-weight:700;letter-spacing:.04em;color:#cfe2f1}.brandtag b{color:#fff}'
        + '.cue{position:absolute;bottom:34px;left:50%;transform:translateX(-50%);color:#9fc1dc;font-size:13px;letter-spacing:.14em;text-transform:uppercase;animation:bob 2s ease-in-out infinite;z-index:2}@keyframes bob{0%,100%{transform:translate(-50%,0)}50%{transform:translate(-50%,8px)}}'
        + '.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px;margin-top:34px}.kpi{background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:16px;padding:26px 24px}.kpi.lite{background:var(--paper2);border-color:#dce8f1}'
        + '.kpi .v{font-size:clamp(34px,5vw,54px);font-weight:800;line-height:1;letter-spacing:-.02em;color:#fff}.kpi.lite .v{color:var(--ink)}.kpi .v.green{color:var(--green)}.kpi .v.boston{color:var(--boston-soft)}.kpi.lite .v.boston{color:var(--boston)}'
        + '.kpi .l{margin-top:10px;font-size:15px;color:#a9c3d6}.kpi.lite .l{color:#5b7488}.kpi .s{margin-top:6px;font-size:13px;color:#7f9bb1}.pill{display:inline-block;margin-top:10px;font-size:12px;font-weight:600;background:rgba(63,185,132,.16);color:#8fe3bf;border-radius:999px;padding:3px 11px}'
        + '.chartcard{background:#fff;border:1px solid #e4edf4;border-radius:18px;padding:24px 22px 12px;position:relative}.legend{display:flex;gap:20px;flex-wrap:wrap;font-size:13px;color:#5b7488;margin-bottom:8px}.legend span{display:inline-flex;align-items:center;gap:7px}.sw{width:12px;height:12px;border-radius:3px;display:inline-block}.gline{fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.ann{font-size:13px;font-weight:700}#growth{display:block;width:100%;height:340px;cursor:crosshair}.tip{position:absolute;top:14px;right:22px;font-size:13px;background:#04263d;color:#eaf2f8;padding:6px 11px;border-radius:8px;opacity:0;transition:opacity .15s;pointer-events:none}'
        + '.bars{display:flex;flex-direction:column;gap:13px;margin-top:8px}.bar{display:grid;grid-template-columns:170px 1fr 70px;align-items:center;gap:14px}.bar .lab{font-size:15px}.track{height:18px;background:rgba(255,255,255,.1);border-radius:999px;overflow:hidden}body .track{background:rgba(120,140,160,.16)}.dark .track{background:rgba(255,255,255,.1)}.fill{height:100%;width:0;border-radius:999px;background:var(--boston);transition:width 1.1s cubic-bezier(.2,.7,.2,1)}.fill.slate{background:#7d96a8}.bar .val{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}'
        + '.cols{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}@media(max-width:820px){.cols{grid-template-columns:1fr;gap:28px}}.bignum{font-size:clamp(56px,11vw,118px);font-weight:800;letter-spacing:-.03em;line-height:.95;color:#fff}.statline{font-size:18px;color:#bdd3e4;margin-top:8px}'
        + '.conflict{margin-top:22px;background:rgba(229,115,115,.12);border:1px solid rgba(229,115,115,.35);border-radius:14px;padding:18px 20px}.conflict .v{font-size:34px;font-weight:800;color:#ffb4b4}.conflict .l{color:#e7c3c3;font-size:14px}'
        + '#map .mapoff{text-align:center;color:#6d8ba3;font-size:13px;padding:200px 0}.toggle{background:rgba(255,255,255,.06);border:1px solid var(--line);color:#cfe2f1;font-weight:600;font-size:14px;padding:11px 20px;border-radius:10px;cursor:pointer;transition:all .2s}.toggle:hover,.toggle.on{background:var(--boston);border-color:var(--boston);color:#fff}'
        + '.dials{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:26px;margin-top:30px}.dial{text-align:center}.dial svg{transform:rotate(-90deg)}.dial .pc{font-size:30px;font-weight:800;fill:#fff}.dial .cap{margin-top:12px;font-size:15px;color:#b9cede;max-width:24ch;margin-left:auto;margin-right:auto}'
        + '.quotes{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;margin-top:26px}.quote{background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:16px;padding:22px 24px 20px}.quote .q{font-family:Georgia,serif;font-size:19px;line-height:1.5;color:#eaf2f8;margin:0}.quote .mark{font-family:Georgia,serif;font-size:46px;line-height:0;color:var(--boston-soft);height:18px;display:block}.quote .by{margin:16px 0 0;font-size:13px;color:#9fc1dc;font-weight:600}'
        + '.stars{display:inline-flex;gap:2px;font-size:15px;color:rgba(255,255,255,.22);margin:6px 0 2px}.stars .on{color:#f5b301}'
        + '.ratingband{display:flex;align-items:center;gap:28px;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:18px;padding:26px 30px;margin:6px 0 30px;flex-wrap:wrap}.rb-pct{font-size:clamp(48px,8vw,76px);font-weight:800;color:var(--green);line-height:1}.rb-stars{font-size:22px;color:#f5b301;letter-spacing:2px}.rb-stars b{color:#fff;margin-left:10px;font-size:24px;letter-spacing:0}.rb-stars span{color:#9fc1dc;font-weight:400;font-size:16px;letter-spacing:0}.rb-sub{color:#b9cede;font-size:15px;margin-top:8px}'
        + '.btn{display:inline-block;margin-top:26px;background:var(--boston);color:#fff;font-weight:700;text-decoration:none;padding:15px 30px;border-radius:12px;font-size:16px;transition:transform .2s,background .2s}.btn:hover{transform:translateY(-2px);background:#3f97da}.foot{margin-top:42px;font-size:13px;color:#7f9bb1;border-top:1px solid var(--line);padding-top:20px}'
        + '@media(prefers-reduced-motion:reduce){.rv{transition:none;opacity:1;transform:none}.fill{transition:none}.cue{animation:none}}';

      return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<title>SURGhub — Impact Showcase</title>'
        + '<script src="https://www.gstatic.com/charts/loader.js"><\/script>'
        + '<style>' + CSS + '</style></head><body>'
        + body
        + '<script>var D = ' + json + ';(' + PAGE.toString() + ')();<\/script>'
        + '</body></html>';
    }
  };

  ROOT.ImpactShowcase = ImpactShowcase;
})();
