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
    async _assemble(opts) {
      opts = opts || {};
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
      // High income (HIC) bar intentionally omitted from the chart — the story is reach into lower-income
      // settings. incTotal still includes HIC so the shown bars read as a share of ALL located learners.
      const incomeOrder = [['LIC', 'Low income'], ['LMIC', 'Lower-middle'], ['UMIC', 'Upper-middle']];
      const income = incTotal > 0 ? incomeOrder.map(([t, label]) => ({ tier: t, label: label, count: inc[t], pct: Math.round(inc[t] / incTotal * 100) })) : [];
      const lmicShare = incTotal > 0 ? Math.round((inc.LMIC + inc.LIC) / incTotal * 100) : 0;

      // Reach-gap priority — mirror the in-app Reach-Gap (Lancet) card EXACTLY so the numbers match:
      // share of located learners (per-country ENROLMENTS from _computeEngagement) in the Lancet
      // priority country list (IC.isLancetPriority — LIC/LMIC + selected UMIC with surgical-care gaps).
      let priorityShare = lmicShare, priorityCountries = [];
      try {
        const eng = (ROOT.App && App._computeEngagement) ? App._computeEngagement() : null;
        const bc = eng && eng.byCountry;
        if (bc && IC && IC.isLancetPriority) {
          const rows = Object.keys(bc).map(name => ({ name: name, count: Number(bc[name].enrolls) || 0 }));
          const totalE = rows.reduce((s, r) => s + r.count, 0);
          const priE = rows.filter(r => IC.isLancetPriority(r.name)).reduce((s, r) => s + r.count, 0);
          if (totalE > 0) {
            priorityShare = Math.round(priE / totalE * 100);
            priorityCountries = rows.filter(r => IC.isLancetPriority(r.name) && r.count > 0)
              .sort((a, b) => b.count - a.count).slice(0, 8)
              .map(r => ({ name: r.name, count: r.count, pct: Math.round(r.count / totalE * 100) }));
          }
        }
      } catch (e) { /* fall through to the course-country fallback */ }
      // Fallback when per-user engagement data isn't loaded: LMIC/LIC course-country aggregation.
      if (!priorityCountries.length) {
        const t = incTotal || 1;
        priorityCountries = Object.keys(cc).map(name => ({ name: name, count: Number(cc[name]) || 0, tier: IC ? IC.classify(name) : 'Unknown' }))
          .filter(r => r.count > 0 && (r.tier === 'LMIC' || r.tier === 'LIC'))
          .sort((a, b) => b.count - a.count).slice(0, 8)
          .map(r => ({ name: r.name, count: r.count, pct: Math.round(r.count / t * 100) }));
      }

      const conflict = App.getConflictLearners ? App.getConflictLearners(aud) : 0;

      // cadres (authoritative ActivityStats) — counts only
      let cadres = [];
      // Route the platform's ActivityStats labels through the canonical profession taxonomy so the
      // showcase shows the SAME summarised cadre categories as the Learners tab (e.g. nurse→Nursing),
      // re-aggregating counts per bucket. Falls back to raw labels if the taxonomy isn't loaded.
      try {
        const a = parse(aud && aud.ActivityStats);
        const canon = (ROOT.Taxonomy && Taxonomy.canonProf) ? Taxonomy.canonProf : null;
        const agg = {};
        Object.keys(a).forEach(k => { const v = Number(a[k]) || 0; if (v <= 0) return; const cat = canon ? canon(k) : k; if (!cat || String(cat).toLowerCase() === 'unknown' || cat === 'Other') return; agg[cat] = (agg[cat] || 0) + v; });
        cadres = Object.keys(agg).map(k => ({ name: k, v: agg[k] })).sort((a, b) => b.v - a.v).slice(0, 6);
      } catch (e) { cadres = []; }

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

      // Learner voices — built by _collectCandidates so the in-app picker and the export share the
      // exact same selection logic. If the caller pre-selected a set (from the picker), honour it.
      let quotes;
      if (Array.isArray(opts.quotes)) quotes = opts.quotes.slice(0, 12);
      else { try { quotes = (await this._collectCandidates(opts)).slice(0, 9); } catch (e) { quotes = []; } }

      // logos (base64-inlined; optional)
      let gsf = '', surghub = '', ambl = '';
      try {
        const read = (f) => { const lp = electronAPI.path.join(electronAPI.appPath, 'build', f); if (!electronAPI.fs.existsSync(lp)) return ''; const mime = /\.jpe?g$/i.test(f) ? 'image/jpeg' : 'image/png'; return 'data:' + mime + ';base64,' + electronAPI.fs.readFileBase64(lp); };
        ['gsf_logo_white.png', 'gsf_logo_symbol.png', 'Global Surgery Foundation_logo_symbol.png', 'gsf_logo_full.png'].some(f => (gsf = read(f)));
        ['surghub_logo_white.png', 'SURGhub_app_square_white.png', 'surghub_logo_color.png', 'surghub_logo.png', 'surghub_white.png'].some(f => (surghub = read(f)));
        ['surghub_ambassadors.png', 'SURGhub_Ambassadors.png', 'surghub_ambassadors_logo.png', 'surghub_ambassador.png'].some(f => (ambl = read(f)));
      } catch (e) {}

      // Best-effort: pull each linked article's social/hero image (og:image) so the story + feature
      // cards show a real photo. Remote URL (loads when the page is opened online; the card falls back
      // to a branded gradient + initials otherwise). Time-boxed so it never blocks the export.
      const ogImage = async (pageUrl, fallback) => {
        try {
          const r = await Promise.race([
            (ROOT.electronAPI && electronAPI.invoke) ? electronAPI.invoke('http-request', { url: pageUrl, method: 'GET' }) : Promise.resolve(null),
            new Promise(res => setTimeout(() => res(null), 6000))
          ]);
          const h = (r && r.body) || '';
          let m = h.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*\scontent=["']([^"']+)["']/i);
          if (!m) m = h.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
          const u = (m && m[1]) ? m[1].trim() : (fallback || '');
          return /^https?:\/\//i.test(u) ? u : (fallback || '');
        } catch (e) { return fallback || ''; }
      };
      // Learner-story hero images for the geographic-reach section (one per country, A–Z) plus the
      // ambassador feature. Pulled live from each article's og:image, with the last-known URL as a
      // fallback so the cards still show a photo if the fetch is blocked/offline.
      let storyImgs = {};
      try {
        const SRC = [
          ['kenya',       'https://www.surghub.org/blog/impact-stories-dennis-nyangau-kenya',                      'https://lwfiles.mycourse.app/globalsurgery-public/e8ec75ddced4d332f133aae56cab6c5c.png'],
          ['sierraleone', 'https://www.surghub.org/blog/impact-stories-dr-sheku-dennis-massaquoi-resilient-care',  'https://lwfiles.mycourse.app/globalsurgery-public/2c455e1bbf586dbf235aed0014d53a76.png'],
          ['drc',         'https://www.surghub.org/blog/impact-stories-william-baraka-congo',                      'https://lwfiles.mycourse.app/globalsurgery-public/cba96310c64045a6a853b14597f262b3.png'],
          ['india',       'https://www.surghub.org/blog/impact-stories-dr-shubhangi-patil-surgical-art-belagavi',  'https://lwfiles.mycourse.app/globalsurgery-public/b9a80dd453cb04045740bb8d41765904.png'],
          ['egypt',       'https://www.surghub.org/blog/impact-stories-dr-sanderene-abdelnor-reconstructive-surgery-egypt', 'https://lwfiles.mycourse.app/globalsurgery-public/7553fc0356907fb5c04093a75d8fed2d.png'],
          ['bangladesh',  'https://www.surghub.org/blog/impact-stories-dr-sourov-das-surgical-training-bangladesh', 'https://lwfiles.mycourse.app/globalsurgery-public/133c0c57043cd551669e7b61c010247a.png'],
          ['amb',         'https://www.surghub.org/blog/driven-by-the-community-surghub-surpasses-50000-users',    '']
        ];
        const og = await Promise.all(SRC.map(s => ogImage(s[1], s[2])));
        SRC.forEach((s, i) => { storyImgs[s[0]] = og[i]; });
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
        income: income, lmicShare: lmicShare, priorityShare: priorityShare, priorityCountries: priorityCountries, conflict: conflict,
        cadres: cadres, survey: survey, amb: amb, rating: rating, quotes: quotes,
        storyImgs: storyImgs,
        logos: { gsf: gsf, surghub: surghub, ambassadors: ambl }
      };
    },

    async export(opts) {
      try {
        if (!ROOT.App || !App.getAnalyticsSnap) { App.showMsg && App.showMsg('SURGhub data isn’t loaded yet.', true); return; }
        App.showMsg && App.showMsg('Building the impact showcase…');
        const D = await this._assemble(opts || {});
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

    // Collect the candidate testimonials for the chosen AI scoring source (sorted best-first).
    // Shared by the export and the in-app picker. Aggregates only; cadre+country looked up from
    // the email→demo map but never the email/name itself.
    async _collectCandidates(opts) {
      opts = opts || {};
      const snap = (ROOT.App && App.getAnalyticsSnap) ? (App.getAnalyticsSnap() || []) : [];
      const tSource = (opts.source === 'feedback' || opts.source === 'curated') ? opts.source : 'marketing';
      const minScore = (opts.minScore != null && !isNaN(opts.minScore)) ? Number(opts.minScore) : 7;
      const normT = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 140);
      const djb2 = (ROOT.App && App._djb2Hash) ? function (s) { return App._djb2Hash(s); } : null;
      const demo = (ROOT.App && App._emailDemoMap) ? App._emailDemoMap : ((ROOT.Storage ? (await Storage.getItem('surghub_email_demo')) : null) || {});
      const tcase = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
      const out = [];
      try {
        if (tSource === 'curated' || !djb2) {
          const ratingMap = {};
          snap.forEach(d => { if (!d || !d.FeedbackBank) return; let fb; try { fb = JSON.parse(d.FeedbackBank); } catch (e) { return; } (Array.isArray(fb) ? fb : []).forEach(f => { const r = Number(f && f.r) || 0; if (r >= 1 && r <= 5 && f.t) ratingMap[normT(f.t)] = r; }); });
          const sel = (ROOT.Storage ? (await Storage.getItem('surghub_selected_testimonials')) : null) || {};
          Object.keys(sel).forEach(prov => { const courses = sel[prov] || {}; Object.keys(courses).forEach(cn => { (courses[cn] || []).forEach(t => {
            if (typeof t === 'string') { const txt = t.trim(); if (txt.length >= 45 && txt.length <= 320 && txt.indexOf('@') === -1) out.push({ text: txt, course: cn, r: ratingMap[normT(txt)] || null, cadre: '', country: '', score: 0 }); }
          }); }); });
        } else {
          const aiMap = (ROOT.Storage ? (await Storage.getItem(tSource === 'feedback' ? 'surghub_feedback_ai' : 'surghub_marketing_ai')) : null) || {};
          const seen = {};
          snap.forEach(d => {
            if (!d || !d.FeedbackBank) return;
            let fb; try { fb = JSON.parse(d.FeedbackBank); } catch (e) { return; }
            (Array.isArray(fb) ? fb : []).forEach(f => {
              const txt = String((f && f.t) || '').trim(); if (!txt) return;
              const h = djb2(txt); if (seen[h]) return;
              const a = aiMap[h]; if (!a) return;
              const usable = (tSource === 'feedback') ? (a.q && Number(a.s) >= minScore) : (a.u && Number(a.s) >= minScore);
              if (!usable) return;
              const quote = String(a.c || '').trim();
              if (quote.length < 25 || quote.indexOf('@') !== -1) return;
              seen[h] = 1;
              const dm = f.e ? demo[String(f.e).trim().toLowerCase()] : null;
              out.push({
                text: quote, score: Number(a.s) || 0,
                r: (f.r !== undefined && f.r !== null && f.r !== '') ? (Number(f.r) || null) : null,
                cadre: (dm && dm.profession) ? tcase(dm.profession) : '',
                country: (dm && dm.country) ? String(dm.country) : '',
                course: d.Course || ''
              });
            });
          });
          out.sort((x, y) => y.score - x.score);
        }
      } catch (e) { /* return what we have */ }
      return out;
    },

    // Entry point from the Reports tab: gather candidates and let the user pick which (and how
    // many) to feature, then export with that exact selection.
    async openPicker(opts) {
      opts = opts || {};
      try {
        if (!ROOT.App || !App.getAnalyticsSnap) { App.showMsg && App.showMsg('SURGhub data isn’t loaded yet.', true); return; }
        App.showMsg && App.showMsg('Finding the best testimonials…');
        const cands = await this._collectCandidates(opts);
        if (!cands.length) {
          App.showMsg && App.showMsg('No testimonials matched “' + (opts.source || 'marketing') + '” at score ≥ ' + (opts.minScore != null ? opts.minScore : 7) + '. Building without quotes — tip: run “Score all feedback” first, or lower the score / change the source.', 'warn');
          return this.export(Object.assign({}, opts, { quotes: [] }));
        }
        this._showPicker(cands.slice(0, 14), opts);
      } catch (e) { console.error('[ImpactShowcase] picker', e); App.showMsg && App.showMsg('Could not open the testimonial picker: ' + ((e && e.message) || e), true); }
    },

    _showPicker(cands, opts) {
      const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const defN = Math.min(6, cands.length);
      const srcLabel = opts.source === 'curated' ? 'curated picks' : (opts.source === 'feedback' ? 'AI top-rated feedback' : 'AI marketing quotes');
      const star = (r) => { r = Math.round(Number(r) || 0); if (r < 1) return ''; let s = ''; for (let i = 1; i <= 5; i++) s += (i <= r ? '★' : '☆'); return '<span style="color:#f5b301;letter-spacing:1px">' + s + '</span>'; };
      const rows = cands.map((q, i) => {
        const by = [q.cadre, q.country].filter(Boolean).join(', ') || q.course || 'SURGhub learner';
        return '<label style="display:flex;align-items:flex-start;gap:12px;padding:11px 13px;border:1px solid #e2e8f0;border-radius:10px;cursor:pointer">'
          + '<input type="checkbox" class="shub-pick" data-idx="' + i + '"' + (i < defN ? ' checked' : '') + ' style="margin-top:3px;width:16px;height:16px;accent-color:#206095;flex:none">'
          + '<div style="min-width:0"><div style="font-size:12px;color:#64748b;margin-bottom:2px">' + star(q.r) + ' <span style="color:#94a3b8">— ' + esc(by) + (q.score ? ' · score ' + q.score : '') + '</span></div>'
          + '<div style="font-size:14px;color:#334155;line-height:1.45">' + esc(q.text) + '</div></div></label>';
      }).join('');
      const html = '<div id="shub-picker" style="position:fixed;inset:0;z-index:2000;background:rgba(2,20,35,.55);display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,-apple-system,sans-serif">'
        + '<div style="background:#fff;border-radius:16px;max-width:740px;width:100%;max-height:86vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.35)">'
        + '<div style="padding:20px 24px;border-bottom:1px solid #eef2f6">'
          + '<h3 style="margin:0;font-size:18px;font-weight:700;color:#04263d">Choose testimonials for the showcase</h3>'
          + '<p style="margin:5px 0 0;font-size:13px;color:#64748b">' + cands.length + ' candidates · ' + esc(srcLabel) + '. The top ' + defN + ' are pre-selected — tick/untick any, or set a number.</p>'
          + '<div style="margin-top:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">'
            + '<label style="font-size:13px;color:#475569;font-weight:600">Select top <input id="shub-topn" type="number" min="0" max="' + cands.length + '" value="' + defN + '" style="width:56px;margin-left:6px;border:1px solid #cbd5e1;border-radius:6px;padding:5px 7px;font-size:13px"></label>'
            + '<span id="shub-count" style="font-size:13px;color:#64748b"></span>'
          + '</div>'
        + '</div>'
        + '<div style="padding:14px 24px;overflow:auto;display:flex;flex-direction:column;gap:8px">' + rows + '</div>'
        + '<div style="padding:14px 24px;border-top:1px solid #eef2f6;display:flex;justify-content:flex-end;gap:10px">'
          + '<button id="shub-cancel" style="padding:10px 18px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font-weight:600;color:#475569;cursor:pointer">Cancel</button>'
          + '<button id="shub-build" style="padding:10px 22px;border:none;border-radius:8px;background:#04263d;color:#fff;font-weight:700;cursor:pointer">Build showcase →</button>'
        + '</div></div></div>';
      const holder = document.createElement('div'); holder.innerHTML = html;
      const root = holder.firstChild; document.body.appendChild(root);
      const self = this;
      const picks = () => [].slice.call(root.querySelectorAll('.shub-pick'));
      const cnt = () => { document.getElementById('shub-count').textContent = picks().filter(c => c.checked).length + ' selected'; };
      cnt();
      picks().forEach(c => c.addEventListener('change', cnt));
      document.getElementById('shub-topn').addEventListener('input', function () { const n = parseInt(this.value, 10) || 0; picks().forEach((c, i) => { c.checked = i < n; }); cnt(); });
      document.getElementById('shub-cancel').addEventListener('click', () => root.remove());
      root.addEventListener('click', (e) => { if (e.target === root) root.remove(); });
      document.getElementById('shub-build').addEventListener('click', () => {
        const chosen = picks().filter(c => c.checked).map(c => cands[+c.getAttribute('data-idx')]);
        root.remove();
        self.export(Object.assign({}, opts, { quotes: chosen }));
      });
    },

    _html(D) {
      const fmt = (n) => (Number(n) || 0) >= 1000 ? (Number(n) || 0).toLocaleString('en-US') : String(Number(n) || 0);
      const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const json = JSON.stringify(D).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');
      // country name → flag emoji (regional-indicator pair), baked in at build time so it stays offline.
      const flag = (country) => { try { const iso = ROOT.countryToISO ? ROOT.countryToISO(country) : null; if (!iso || String(iso).length !== 2) return ''; return String.fromCodePoint.apply(null, String(iso).toUpperCase().split('').map(function (c) { return 0x1F1E6 + c.charCodeAt(0) - 65; })) + ' '; } catch (e) { return ''; } };

      const kpi = (val, suf, cls, label, sub, pill, dly) =>
        '<div class="kpi rv' + (dly ? ' ' + dly : '') + '"><div class="v ' + (cls || '') + ' num" data-to="' + (val || 0) + '"' + (suf ? ' data-suffix="' + suf + '"' : '') + '>0</div>'
        + '<div class="l">' + label + '</div>' + (sub ? '<div class="s">' + sub + '</div>' : '') + (pill ? '<span class="pill">' + pill + '</span>' : '') + '</div>';

      // Each scale card carries its own .rv + staggered delay class so the numbers reveal & count up
      // one-by-one as the section scrolls into view (rather than a wall of six numbers at once).
      // Just the three headline numbers — registered learners, courses, countries. (Enrolments,
      // certificates and learning-hours live in the growth / other sections, not this opening grid.)
      const scaleCards = [
        kpi(D.learners, '', '', 'Registered learners', 'healthcare workers worldwide', '', 'd1'),
        kpi(D.courses, '', 'boston', 'Courses', (D.providers ? ('from ' + D.providers + ' expert providers') : ''), '', 'd2'),
        kpi(D.countries, '+', 'green', 'Countries reached', 'on every continent', '', 'd3')
      ].join('');

      const incomeBars = (D.income || []).map(r =>
        '<div class="bar"><span class="lab">' + esc(r.label) + '</span><div class="track"><div class="fill ' + (r.tier === 'LIC' || r.tier === 'LMIC' ? '' : 'slate') + '" data-w="' + r.pct + '"></div></div><span class="val num" data-to="' + r.pct + '" data-suffix="%">0</span></div>'
      ).join('');

      const cadreMax = (D.cadres || []).reduce((m, c) => Math.max(m, c.v), 0) || 1;
      const cadreBars = (D.cadres || []).map((c, i) =>
        '<div class="bar rv" style="transition-delay:' + (Math.min(i, 9) * 0.06) + 's"><span class="lab">' + esc(c.name) + '</span><div class="track"><div class="fill" data-w="' + Math.max(4, Math.round(c.v / cadreMax * 100)) + '"></div></div><span class="val num" data-to="' + c.v + '">0</span></div>'
      ).join('');

      const dials = D.survey ? [
        D.survey.contentNew ? '<div class="dial rv" data-pct="' + D.survey.contentNew.pct + '" data-color="#5aa7e0" data-cap="said the content was <b style=&quot;color:#5aa7e0&quot;>new</b> to them"></div>' : '',
        D.survey.willApply ? '<div class="dial rv" data-pct="' + D.survey.willApply.pct + '" data-color="#4fd09a" data-cap="intend to <b style=&quot;color:#4fd09a&quot;>apply</b> what they learned"></div>' : '',
        D.survey.careerValue ? '<div class="dial rv" data-pct="' + D.survey.careerValue.pct + '" data-color="#f5b301" data-cap="rate it important to their <b style=&quot;color:#f5b301&quot;>work</b>"></div>' : ''
      ].join('') : '';
      const surveyN = D.survey ? Math.max((D.survey.willApply || {}).n || 0, (D.survey.contentNew || {}).n || 0, (D.survey.careerValue || {}).n || 0) : 0;

      const ambCards = D.amb ? (
        '<div class="kpi rv lite d1"><div class="v boston num" data-to="' + D.amb.referrers + '">0</div><div class="l">Active ambassadors</div></div>'
        + '<div class="kpi rv lite d2"><div class="v num" data-to="' + D.amb.bridged + '">0</div><div class="l">Learners they brought in</div></div>'
        + (D.amb.hasOutcomes ? '<div class="kpi rv lite d3"><div class="v num" data-to="' + D.amb.active + '">0</div><div class="l">Became active learners</div></div>' : '')
        + (D.amb.hasOutcomes ? '<div class="kpi rv lite d4"><div class="v green num" data-to="' + D.amb.certs + '">0</div><div class="l">Certificates earned</div></div>' : '')
      ) : '';

      const stars = (r) => { r = Math.round(Number(r) || 0); if (r < 1) return ''; let s = '<span class="stars">'; for (let i = 1; i <= 5; i++) s += '<span class="' + (i <= r ? 'on' : '') + '">★</span>'; return s + '</span>'; };

      const quoteCards = (D.quotes || []).map((q, i) => {
        const by = [q.cadre, q.country].filter(Boolean).join(', ') || q.course || 'A SURGhub learner';
        return '<div class="quote rv" style="transition-delay:' + (Math.min(i, 8) * 0.06) + 's"><span class="mark">“</span><p class="q">' + esc(q.text) + '</p>' + (q.r ? stars(q.r) : '') + '<p class="by">' + flag(q.country) + esc(by) + '</p></div>';
      }).join('');

      // Overall platform rating band (shown atop the voices section)
      const ratingBand = D.rating ? (
        '<div class="ratingband rv d1">'
        + '<div class="rb-block"><div class="rb-pct num" data-to="' + D.rating.pct45 + '" data-suffix="%">0</div><div class="rb-pct-lab">gave 4 or 5 stars</div></div>'
        + '<div class="rb-block rb-avg-block"><div class="rb-stars">★★★★★</div><div class="rb-avg"><b>' + D.rating.avg + '</b> average rating</div></div>'
        + (D.logos.surghub ? '<img class="rb-logo" src="' + D.logos.surghub + '" alt="SURGhub">' : '')
        + '<div class="rb-foot">Based on ' + fmt(D.rating.n) + ' learner ratings</div></div>'
      ) : '';

      // Cert-rate highlight for the growth section — framed against typical online-course completion.
      const certHi = (D.certRate != null ? '<div class="certhi rv d2"><div class="certhi-num num" data-to="' + D.certRate + '" data-suffix="%">0</div><div class="certhi-lab">of learners finish and certify — <b>2–3× the typical completion rate</b> for online learning platforms.</div></div>' : '');

      // Editorial deep-links to the public surghub.org blog — two learner stories + a featured ambassador
      // piece. Each shows the article's hero photo when online; otherwise a branded gradient + initials.
      const SI = D.storyImgs || {};
      // Geographic-reach journey — real learners, ordered A–Z by country. Text is baked in (offline-safe);
      // each hero photo loads from the article when online and falls back to a branded gradient + initials.
      const STORIES = [
        { fl: '🇧🇩', country: 'Bangladesh', city: 'Comilla', lon: 91.18, lat: 23.46, name: 'Dr Sourov Das', role: 'Surgical trainee', init: 'SD', grad: 'linear-gradient(135deg,#2f86c9,#1f9c63)', img: SI.bangladesh, url: 'https://www.surghub.org/blog/impact-stories-dr-sourov-das-surgical-training-bangladesh',
          sum: 'A general-surgery trainee at Comilla Medical College Hospital, Dr Das used SURGhub’s burn-care courses to supplement his training — then drew on them to confidently treat a young girl with severe thermal injuries.' },
        { fl: '🇨🇩', country: 'DR Congo', city: 'Bukavu', lon: 28.85, lat: -2.51, name: 'William Baraka', role: 'Anaesthesia & critical care', init: 'WB', grad: 'linear-gradient(135deg,#9b8cff,#2f86c9)', img: SI.drc, url: 'https://www.surghub.org/blog/impact-stories-william-baraka-congo',
          sum: 'After losing his sister to a preventable anaesthesia complication, William turned that loss into a mission. In conflict-affected eastern DRC he draws on SURGhub’s perioperative resources to strengthen patient safety and train colleagues across Francophone Africa.' },
        { fl: '🇪🇬', country: 'Egypt', city: 'Giza', lon: 31.21, lat: 30.01, name: 'Dr Sanderene Abdelnor', role: 'Reconstructive surgery', init: 'SA', grad: 'linear-gradient(135deg,#f5b301,#e57373)', img: SI.egypt, url: 'https://www.surghub.org/blog/impact-stories-dr-sanderene-abdelnor-reconstructive-surgery-egypt',
          sum: 'A plastic & reconstructive surgeon in a high-volume Giza hospital, Dr Abdelnor used SURGhub’s guidance to introduce structured distraction techniques while treating a child with burn trauma — reshaping how she supports patients through recovery.' },
        { fl: '🇮🇳', country: 'India', city: 'Belagavi', lon: 74.50, lat: 15.85, name: 'Dr Shubhangi Patil', role: 'Surgeon & mentor', init: 'SP', grad: 'linear-gradient(135deg,#3FB984,#2f86c9)', img: SI.india, url: 'https://www.surghub.org/blog/impact-stories-dr-shubhangi-patil-surgical-art-belagavi',
          sum: 'An experienced surgeon who calls her craft “a work of art,” Dr Patil uses SURGhub to keep her skills current and to reach globally recognised surgical standards — and to mentor the next generation of surgeons in smaller towns.' },
        { fl: '🇰🇪', country: 'Kenya', city: 'Nakuru', lon: 36.07, lat: -0.30, name: 'Dennis Nyang’au', role: 'Emergency & critical care', init: 'DN', grad: 'linear-gradient(135deg,#2f86c9,#1f9c63)', img: SI.kenya, url: 'https://www.surghub.org/blog/impact-stories-dennis-nyangau-kenya',
          sum: 'A Kenya Red Cross emergency responder, Dennis completed SURGhub’s Essential Emergency & Critical Care course — then used it to stabilise a hit-and-run victim in the field, proving the principles work well beyond the hospital.' },
        { fl: '🇸🇱', country: 'Sierra Leone', city: 'Freetown', lon: -13.23, lat: 8.48, name: 'Dr Sheku Massaquoi', role: 'General surgeon', init: 'SM', grad: 'linear-gradient(135deg,#9b8cff,#3FB984)', img: SI.sierraleone, url: 'https://www.surghub.org/blog/impact-stories-dr-sheku-dennis-massaquoi-resilient-care',
          sum: 'A general surgeon at 34 Military Hospital in Freetown, Dr Massaquoi sets aside 90 minutes each morning to learn on SURGhub — training that directly shaped a palliative mastectomy he performed under regional anaesthesia for a patient unfit for general anaesthesia.' }
      ];
      // Scroll-driven globe: a sticky canvas globe that rotates to centre each learner's country
      // as their card scrolls into view (the active marker glows). Steps carry lon/lat in data-*.
      const geoSteps = STORIES.map(function (s, i) {
        return '<article class="gstep rv" data-lon="' + s.lon + '" data-lat="' + s.lat + '" data-country="' + esc(s.country) + '" data-flag="' + s.fl + '" data-i="' + i + '">'
          + '<div class="gstep-card">'
            + '<div class="gstep-media" style="background:' + s.grad + '">' + (s.img ? '<img src="' + esc(s.img) + '" alt="' + esc(s.name) + ' — ' + esc(s.country) + '" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '') + '<span class="gstep-init">' + s.init + '</span></div>'
            + '<div class="gstep-body">'
              + '<div class="gstep-loc"><span class="gstep-flag">' + s.fl + '</span>' + esc(s.country) + (s.city ? ' · ' + esc(s.city) : '') + '</div>'
              + '<h3 class="gstep-nm">' + esc(s.name) + '</h3>'
              + '<div class="gstep-role">' + esc(s.role) + '</div>'
              + '<p class="gstep-sum">' + esc(s.sum) + '</p>'
              + '<a class="gstep-go" href="' + esc(s.url) + '" target="_blank" rel="noopener">Read the full story →</a>'
            + '</div>'
          + '</div></article>';
      }).join('')
        // Final step: the platform-wide reminder, presented like a story card. When it scrolls
        // to centre, the same globe spins and lights up with a dot + line for every learner country.
        + '<article class="gstep gstep-reach rv" data-reach="1" data-i="' + STORIES.length + '">'
          + '<div class="reach-card"><p class="reach-line">Six stories from a global classroom — and counting. SURGhub now reaches <b class="num" data-to="' + D.learners + '">0</b> health workers across <b class="num" data-to="' + D.countries + '">0</b> countries around the world.</p></div>'
        + '</article>';
      const geoScrolly = '<div class="globe-scrolly">'
        + '<div class="globe-stage"><canvas id="globe"></canvas><div id="globe-cap" class="globe-cap" aria-hidden="true"></div></div>'
        + '<div class="globe-steps">' + geoSteps + '</div>'
        + '</div>';
      const ambFeature = '<a class="feature rv d3" href="https://www.surghub.org/blog/driven-by-the-community-surghub-surpasses-50000-users" target="_blank" rel="noopener">' + (SI.amb ? '<div class="feature-img"><img src="' + esc(SI.amb) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></div>' : '') + '<div class="feature-body"><span class="feature-k">From the community</span><span class="feature-t">Driven by the community: passing 50,000 learners</span><span class="feature-s">Three ambassadors on what keeps them growing SURGhub — read the story →</span></div></a>';

      // Subtle network-globe backdrop for the "spreads itself" section (meridians + a few nodes).
      const netGlobe = '<svg class="netbg" viewBox="0 0 480 480" aria-hidden="true">'
        + '<circle cx="240" cy="240" r="200" fill="none" stroke="#2f86c9" stroke-width="1.2"/>'
        + '<ellipse cx="240" cy="240" rx="78" ry="200" fill="none" stroke="#2f86c9" stroke-width="1.2"/>'
        + '<ellipse cx="240" cy="240" rx="150" ry="200" fill="none" stroke="#2f86c9" stroke-width="1.2"/>'
        + '<ellipse cx="240" cy="240" rx="200" ry="78" fill="none" stroke="#2f86c9" stroke-width="1.2"/>'
        + '<ellipse cx="240" cy="240" rx="200" ry="150" fill="none" stroke="#2f86c9" stroke-width="1.2"/>'
        + '<line x1="40" y1="240" x2="440" y2="240" stroke="#2f86c9" stroke-width="1.2"/>'
        + '<line x1="240" y1="40" x2="240" y2="440" stroke="#2f86c9" stroke-width="1.2"/>'
        + '<g fill="#3FB984"><circle cx="240" cy="40" r="5"/><circle cx="410" cy="170" r="5"/><circle cx="120" cy="360" r="5"/><circle cx="372" cy="356" r="5"/></g>'
        + '</svg>';

      // Cadre donut (replaces the cadre bars) — precise inline-SVG arc segments + a legend.
      const donutColors = ['#2f86c9', '#3FB984', '#7fb6e3', '#f5b301', '#9b8cff', '#5fd0c5'];
      const cadreTotal = (D.cadres || []).reduce((s, c) => s + (Number(c.v) || 0), 0) || 1;
      let _da = -Math.PI / 2; const _R = 44, _CX = 60, _CY = 60;
      const donutSegs = (D.cadres || []).map((c, i) => {
        const frac = (Number(c.v) || 0) / cadreTotal; const a0 = _da, a1 = _da + frac * 2 * Math.PI; _da = a1;
        const col = donutColors[i % donutColors.length];
        const pt = (ang) => (_CX + _R * Math.cos(ang)).toFixed(2) + ' ' + (_CY + _R * Math.sin(ang)).toFixed(2);
        if (frac >= 0.999) return '<circle cx="' + _CX + '" cy="' + _CY + '" r="' + _R + '" fill="none" stroke="' + col + '" stroke-width="20"/>';
        const large = (a1 - a0) > Math.PI ? 1 : 0, g = 0.02, s0 = a0 + g, s1 = a1 - g;
        return '<path d="M ' + pt(s0) + ' A ' + _R + ' ' + _R + ' 0 ' + large + ' 1 ' + pt(s1) + '" fill="none" stroke="' + col + '" stroke-width="20"/>';
      }).join('');
      const cadreDonut = (D.cadres && D.cadres.length) ? (
        '<div class="donutbox rv d2"><div class="donut-wrap"><svg class="donutsvg" viewBox="0 0 120 120" role="img" aria-label="Learners by cadre">' + donutSegs + '</svg></div>'
        + '<div class="donut-legend">' + (D.cadres || []).map((c, i) => { const pct = Math.round((Number(c.v) || 0) / cadreTotal * 100); return '<div class="leg"><span class="legdot" style="background:' + donutColors[i % donutColors.length] + '"></span><span class="legnm">' + esc(c.name) + '</span><span class="legpct">' + pct + '%</span></div>'; }).join('') + '</div></div>'
      ) : '';

      // Top reached priority (low-/lower-middle-income) countries — ranked list with flags.
      const priorityList = (D.priorityCountries || []).map((c, i) =>
        '<div class="prow rv" style="transition-delay:' + (Math.min(i, 8) * 0.05) + 's"><span class="prank">' + (i + 1) + '</span><span class="pflag">' + flag(c.name) + '</span><span class="pname">' + esc(c.name) + '</span></div>'
      ).join('');

      // Ambassador CTA (network section) — uses the SURGhub Ambassadors mark if present in build/.
      const ambCTA = '<a class="ambcta rv d4" href="https://www.surghub.org/ambassadors" target="_blank" rel="noopener">'
        + (D.logos.ambassadors ? '<img class="ambcta-logo" src="' + D.logos.ambassadors + '" alt="SURGhub Ambassadors">' : '')
        + '<div class="ambcta-body"><div class="ambcta-t">Become a SURGhub Ambassador</div><div class="ambcta-s">Help bring open surgical education to your own professional network.</div></div>'
        + '<span class="ambcta-btn">Get involved →</span></a>';

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

        function countUp(el) { var to = +el.getAttribute('data-to'), suf = el.getAttribute('data-suffix') || ''; if (reduce) { el.textContent = fmt(to) + suf; return; } var st = null; function step(ts) { st = st || ts; var p = Math.min((ts - st) / 1400, 1), e = 1 - Math.pow(1 - p, 4); el.textContent = fmt(Math.round(to * e)) + suf; if (p < 1) requestAnimationFrame(step); else if (!el.ownerSVGElement) { el.classList.add('pop'); setTimeout(function () { el.classList.remove('pop'); }, 420); } } requestAnimationFrame(step); }

        // split a kinetic headline into word spans (line breaks preserved) so they can rise in one-by-one.
        function wrapWords(el) { try { var parts = el.innerHTML.split(/<br\s*\/?>/i); el.innerHTML = parts.map(function (seg) { return seg.split(/\s+/).filter(Boolean).map(function (w) { return '<span class="w">' + w + '</span>'; }).join(' '); }).join('<br>'); } catch (e) {} }
        [].slice.call(document.querySelectorAll('.kin')).forEach(wrapWords);

        function buildDial(d) {
          var pct = +d.getAttribute('data-pct'), cap = d.getAttribute('data-cap') || '', color = d.getAttribute('data-color') || '#7fb6e3', r = 58, c = 2 * Math.PI * r;
          d.innerHTML = '<svg width="150" height="150" viewBox="0 0 150 150"><circle cx="75" cy="75" r="' + r + '" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="12"\/><circle class="ring" cx="75" cy="75" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + c + '" style="transition:stroke-dashoffset 1.4s cubic-bezier(.2,.7,.2,1)"\/><text class="pc" x="75" y="75" text-anchor="middle" dominant-baseline="central" transform="rotate(90 75 75)">0%<\/text><\/svg><p class="cap">' + cap + '<\/p>';
          d._fire = function () { var ring = d.querySelector('.ring'), txt = d.querySelector('.pc'); if (reduce) { ring.style.strokeDashoffset = c * (1 - pct / 100); txt.textContent = pct + '%'; return; } requestAnimationFrame(function () { ring.style.strokeDashoffset = c * (1 - pct / 100); }); var st = null; function step(ts) { st = st || ts; var p = Math.min((ts - st) / 1400, 1), e = 1 - Math.pow(1 - p, 4); txt.textContent = Math.round(pct * e) + '%'; if (p < 1) requestAnimationFrame(step); } requestAnimationFrame(step); };
        }
        [].slice.call(document.querySelectorAll('.dial')).forEach(buildDial);

        // growth charts — learners + certificates, each drawn separately into its own box, each with
        // its own y-scale and hover scrubber. The SVG is built as a COMPLETE <svg> string set on a DIV
        // wrapper's innerHTML so the HTML parser creates real SVG-namespaced nodes (setting innerHTML
        // directly on an <svg> makes some browsers parse <text>/<path> as HTML and collapse the labels).
        function drawOneSeries(wrapId, tipId, series, stroke, areaFill, unit) {
          var wrap = document.getElementById(wrapId); if (!wrap || wrap._done) return;
          var A = series || []; if (!A.length) { wrap.style.display = 'none'; wrap._done = 1; return; }
          var W = wrap.clientWidth || (wrap.getBoundingClientRect ? wrap.getBoundingClientRect().width : 0) || 0;
          var H = 300;
          if (W < 50) { requestAnimationFrame(function () { drawOneSeries(wrapId, tipId, series, stroke, areaFill, unit); }); return; }
          wrap._done = 1;
          var padL = 10, padR = 12, padT = 22, padB = 30, n = A.length;
          var maxY = 1; A.forEach(function (p) { maxY = Math.max(maxY, p.v); });
          function X(i) { return padL + (W - padL - padR) * (i / (Math.max(1, n - 1))); }
          function Y(v) { return padT + (H - padT - padB) * (1 - v / maxY); }
          function path(arr) { var d = ''; for (var i = 0; i < arr.length; i++) { d += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(arr[i].v).toFixed(1) + ' '; } return d.trim(); }
          var area = 'M' + X(0) + ' ' + Y(0) + ' ' + path(A).slice(1) + ' L' + X(n - 1) + ' ' + Y(0) + ' Z';
          var lab0 = A[0].m, lab1 = A[n - 1].m, cid = wrapId + '-svg';
          var inner = '<line x1="' + padL + '" y1="' + Y(0) + '" x2="' + (W - padR) + '" y2="' + Y(0) + '" stroke="#e4edf4"\/>'
            + '<line x1="' + padL + '" y1="' + Y(maxY * 0.5) + '" x2="' + (W - padR) + '" y2="' + Y(maxY * 0.5) + '" stroke="#eef4f9"\/>'
            + '<path d="' + area + '" fill="' + areaFill + '"\/>'
            + '<path class="gline" d="' + path(A) + '" stroke="' + stroke + '"\/>'
            + '<text x="' + (W - padR) + '" y="' + (Y(A[n - 1].v) - 10) + '" text-anchor="end" class="ann num" fill="' + stroke + '" data-to="' + A[n - 1].v + '">0<\/text>'
            + '<text x="' + padL + '" y="' + (H - 9) + '" font-size="12" fill="#90a6b8">' + lab0 + '<\/text>'
            + '<text x="' + (W - padR) + '" y="' + (H - 9) + '" text-anchor="end" font-size="12" fill="#90a6b8">' + lab1 + '<\/text>'
            + '<line class="gcur" x1="0" y1="' + padT + '" x2="0" y2="' + Y(0) + '" stroke="#9fc1dc" stroke-width="1" opacity="0"\/>'
            + '<circle class="gdot" r="4.5" fill="' + stroke + '" opacity="0"\/>';
          wrap.innerHTML = '<svg id="' + cid + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Cumulative ' + unit + ' over time" style="display:block;width:100%;height:' + H + 'px">' + inner + '<\/svg>';
          var svg = document.getElementById(cid);
          var tip = document.getElementById(tipId), cur = svg.querySelector('.gcur'), dot = svg.querySelector('.gdot');
          // draw-in: the full path is already painted at offset 0 (fully visible). ONLY if geometry is
          // valid and motion is allowed do we retract the dash and let the line draw itself back in — so
          // a thrown getTotalLength / reduced-motion just leaves a solid line. Decoration never gates it.
          var line = svg.querySelector('.gline'), annEl = svg.querySelector('.ann');
          try {
            var len = line.getTotalLength ? line.getTotalLength() : 0;
            if (len > 0 && !reduce) {
              line.style.strokeDasharray = len; line.style.strokeDashoffset = len; line.getBoundingClientRect();
              line.style.transition = 'stroke-dashoffset 1.6s cubic-bezier(.2,.7,.2,1)';
              requestAnimationFrame(function () { line.style.strokeDashoffset = '0'; });
              setTimeout(function () { line.style.strokeDashoffset = '0'; }, 1900); // backstop: guarantee the line ends fully drawn
              if (dot) { dot.setAttribute('opacity', '1'); var t0 = null; (function ride(ts) { t0 = t0 || ts; var p = Math.min((ts - t0) / 1600, 1); try { var pt = line.getPointAtLength(len * p); dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y); } catch (e) {} if (p < 1) requestAnimationFrame(ride); else dot.setAttribute('opacity', '0'); })(); }
            }
          } catch (e) {}
          if (annEl && !annEl._d) { annEl._d = 1; if (reduce) annEl.textContent = fmt(A[n - 1].v); else setTimeout(function () { countUp(annEl); }, 520); }
          svg.addEventListener('mousemove', function (ev) {
            var r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * W;
            var i = Math.round((x - padL) / ((W - padL - padR) / Math.max(1, n - 1))); i = Math.max(0, Math.min(n - 1, i));
            cur.setAttribute('x1', X(i)); cur.setAttribute('x2', X(i)); cur.setAttribute('opacity', '.8');
            dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(A[i].v)); dot.setAttribute('opacity', '1');
            if (tip) { tip.style.opacity = 1; tip.innerHTML = '<b>' + A[i].m + '<\/b> &nbsp; <span style="color:' + stroke + '">' + fmt(A[i].v) + ' ' + unit + '<\/span>'; }
          });
          svg.addEventListener('mouseleave', function () { cur.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0'); if (tip) tip.style.opacity = 0; });
        }
        function drawGrowth() {
          drawOneSeries('growth-wrap-learners', 'tip-learners', D.learnersSeries || [], '#2f86c9', 'rgba(47,134,201,.12)', 'learners');
          drawOneSeries('growth-wrap-certs', 'tip-certs', D.certsSeries || [], '#3FB984', 'rgba(63,185,132,.13)', 'certificates');
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
        if (mapBtn) mapBtn.addEventListener('click', function () { mapFocus = !mapFocus; mapBtn.textContent = mapFocus ? 'Show every country' : 'See only the hardest places'; mapBtn.classList.toggle('on', mapFocus); var el = document.getElementById('map'); if (el) { el.innerHTML = ''; if (!reduce) { el.style.transition = 'transform .6s cubic-bezier(.2,.7,.2,1)'; el.style.transformOrigin = '50% 62%'; el.style.transform = mapFocus ? 'scale(1.06)' : ''; } } drawMap(mapFocus ? D.countryMapLMIC : D.countryMap); });

        // hero starfield
        (function () { var cv = document.getElementById('dotsbg'); if (!cv) return; var ctx = cv.getContext('2d'); function sz() { cv.width = cv.offsetWidth; cv.height = cv.offsetHeight; } sz(); addEventListener('resize', sz); var pts = []; for (var i = 0; i < 70; i++) pts.push({ x: Math.random(), y: Math.random(), r: Math.random() * 2 + .6, s: Math.random() * .4 + .1 }); var a = reduce ? 0.5 : 0.2; function frame() { ctx.clearRect(0, 0, cv.width, cv.height); if (a < 0.52) a += 0.0024; ctx.fillStyle = 'rgba(127,182,227,' + a + ')'; pts.forEach(function (p) { p.y -= p.s / 700; if (p.y < 0) p.y = 1; ctx.beginPath(); ctx.arc(p.x * cv.width, p.y * cv.height, p.r, 0, 7); ctx.fill(); }); if (!reduce) requestAnimationFrame(frame); } frame(); })();

        // reveal logic — ONE place, used by the observer, the no-observer fallback and the watchdog.
        // Idempotent: every action guards on .in / _d / _df / _done / drewMap, so re-running is a no-op.
        var drewMap = false;
        function revealEl(el) {
          if (!el || el.classList.contains('in')) return; el.classList.add('in');
          if (el.classList.contains('kin')) [].slice.call(el.querySelectorAll('.w')).forEach(function (w, i) { w.style.transitionDelay = (i * 0.06) + 's'; });
          if (el.hasAttribute && el.hasAttribute('data-to') && !el._d) { el._d = 1; countUp(el); }
          [].slice.call(el.querySelectorAll('[data-to]')).forEach(function (c) { if (!c._d) { c._d = 1; countUp(c); } });
          [].slice.call(el.querySelectorAll('.fill[data-w]')).forEach(function (f) { f.style.width = f.getAttribute('data-w') + '%'; });
          if (el.classList.contains('dial') && el._fire && !el._df) { el._df = 1; var di = el.parentNode ? [].indexOf.call(el.parentNode.children, el) : 0; setTimeout(el._fire, reduce ? 0 : Math.max(0, di) * 260); }
          if (el.querySelector && (el.querySelector('#growth-wrap-learners') || el.querySelector('#growth-wrap-certs'))) drawGrowth();
          if (el.querySelector && el.querySelector('#map') && !drewMap) { drewMap = true; el._map = 1; drawMap(D.countryMap); }
        }
        var revItems = [].slice.call(document.querySelectorAll('.rv,.dial,.kin'));
        if (!('IntersectionObserver' in window)) {
          // No observer support → reveal & draw everything now (visible-without-scroll beats hidden-forever).
          revItems.forEach(revealEl);
        } else {
          var io = new IntersectionObserver(function (ents) { ents.forEach(function (en) { if (!en.isIntersecting) return; revealEl(en.target); io.unobserve(en.target); }); }, { threshold: .22 });
          revItems.forEach(function (el) { io.observe(el); });
          // FAIL-SAFE: after a beat, reveal anything in or above the current viewport the observer missed
          // (init race / odd environments). Below-the-fold stays untouched so the scroll story is intact.
          setTimeout(function () { var vh = window.innerHeight || document.documentElement.clientHeight || 0; revItems.forEach(function (el) { if (!el.classList.contains('in')) { var r = el.getBoundingClientRect(); if (r.top < vh * 0.92) revealEl(el); } }); }, 1800);
        }

        // ---- scroll-driven globe (geographic-reach section): a sticky orthographic canvas globe
        // that rotates to centre each learner's country as their card scrolls in; on the final
        // "reach" step it spins and lights up with a dot + line for every learner country worldwide.
        // Self-contained (no libs); degrades to the plain story cards if canvas is unavailable.
        initGlobe();
        function initGlobe() {
          var cv = document.getElementById('globe'); if (!cv || !cv.getContext) return;
          var ctx; try { ctx = cv.getContext('2d'); } catch (e) { return; } if (!ctx) return;
          var steps = [].slice.call(document.querySelectorAll('#faces .gstep'));
          if (!steps.length) { var st = cv.parentNode; if (st) st.style.display = 'none'; return; }
          var d2r = Math.PI / 180;
          var LP = (typeof LAND !== 'undefined' && LAND) ? LAND : [];
          var cap = document.getElementById('globe-cap');
          function vec(lon, lat) { var a = lat * d2r, o = lon * d2r; return [Math.cos(a) * Math.cos(o), Math.cos(a) * Math.sin(o), Math.sin(a)]; }
          function ll(x, y, z) { var r = Math.sqrt(x * x + y * y + z * z) || 1; return { lon: Math.atan2(y, x) / d2r, lat: Math.asin(z / r) / d2r }; }
          function gdist(a, b) { var dl = (a.lon - b.lon) * d2r, p = a.lat * d2r, q = b.lat * d2r; return Math.acos(Math.max(-1, Math.min(1, Math.sin(p) * Math.sin(q) + Math.cos(p) * Math.cos(q) * Math.cos(dl)))); }
          function arcPts(p0, p1) { var v0 = vec(p0.lon, p0.lat), v1 = vec(p1.lon, p1.lat); var dot = Math.max(-1, Math.min(1, v0[0] * v1[0] + v0[1] * v1[1] + v0[2] * v1[2])); var om = Math.acos(dot); var out = []; if (om < 1e-3) return out; var so = Math.sin(om); for (var t = 0; t <= 1.0001; t += 1 / 24) { var s0 = Math.sin((1 - t) * om) / so, s1 = Math.sin(t * om) / so; out.push(ll(s0 * v0[0] + s1 * v1[0], s0 * v0[1] + s1 * v1[1], s0 * v0[2] + s1 * v1[2])); } return out; }
          // steps: learner stories carry lon/lat; the finale step (data-reach) lights up the whole world
          var pts = [], reachIdx = -1;
          steps.forEach(function (s, i) { if (s.getAttribute('data-reach')) { pts.push(null); reachIdx = i; } else pts.push({ lon: +s.getAttribute('data-lon'), lat: +s.getAttribute('data-lat'), country: s.getAttribute('data-country'), flag: s.getAttribute('data-flag'), idx: i }); });
          var story = pts.filter(Boolean);
          var sArcs = []; for (var si = 0; si < story.length - 1; si++) { var ss = arcPts(story[si], story[si + 1]); if (ss.length) sArcs.push(ss); }
          // reach layer: every learner country (D.countryMap) -> dot; lines fan to nearest hubs (+ hub web)
          var CZ = (typeof CENTROIDS !== 'undefined' && CENTROIDS) ? CENTROIDS : {};
          var cm = (D && D.countryMap) ? D.countryMap : {};
          var rdots = [], maxv = 0;
          for (var iso in cm) { if (!Object.prototype.hasOwnProperty.call(cm, iso)) continue; var v = Number(cm[iso]) || 0; var c = CZ[iso] || CZ[String(iso).toUpperCase()]; if (v > 0 && c) { rdots.push({ lon: c[0], lat: c[1], v: v }); if (v > maxv) maxv = v; } }
          rdots.sort(function (a, b) { return b.v - a.v; });
          rdots.forEach(function (d, i) { d.rank = i / (rdots.length || 1); d.r = Math.sqrt((d.v || 0) / (maxv || 1)); });
          var hubs = rdots.slice(0, Math.min(6, rdots.length)), rArcs = [];
          rdots.forEach(function (d) { var cand = []; for (var h = 0; h < hubs.length; h++) { if (hubs[h] === d) continue; cand.push({ h: hubs[h], dd: gdist(d, hubs[h]) }); } cand.sort(function (a, b) { return a.dd - b.dd; }); for (var k = 0; k < Math.min(2, cand.length); k++) { if (cand[k].dd > 0.05) { var seg = arcPts(d, cand[k].h); if (seg.length) rArcs.push({ seg: seg, rank: d.rank }); } } });
          for (var hi = 0; hi < hubs.length; hi++) for (var hj = hi + 1; hj < hubs.length; hj++) { var hs = arcPts(hubs[hi], hubs[hj]); if (hs.length) rArcs.push({ seg: hs, rank: 0 }); }
          var dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1)), W = 0, H = 0, R = 0, cx = 0, cy = 0;
          function size() { var r = cv.getBoundingClientRect(); W = Math.max(40, r.width); H = Math.max(40, r.height); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); R = Math.min(W, H) * 0.42; cx = W / 2; cy = H / 2; }
          size();
          function proj(lon, lat, l0, a0) { var dl = (lon - l0) * d2r, a = lat * d2r, b = a0 * d2r; var cc = Math.sin(b) * Math.sin(a) + Math.cos(b) * Math.cos(a) * Math.cos(dl); var x = Math.cos(a) * Math.sin(dl); var y = Math.cos(b) * Math.sin(a) - Math.sin(b) * Math.cos(a) * Math.cos(dl); return { x: cx + R * x, y: cy - R * y, c: cc }; }
          var start = story[0] || { lon: 20, lat: 12 };
          var cur = { lon: start.lon, lat: start.lat }, tgt = { lon: start.lon, lat: start.lat }, active = -1, reachActive = false, reachRev = 0;
          function draw(now) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
            var atm = ctx.createRadialGradient(cx, cy, R * 0.62, cx, cy, R * 1.24); atm.addColorStop(0, 'rgba(47,134,201,0)'); atm.addColorStop(0.74, 'rgba(47,134,201,0.12)'); atm.addColorStop(1, 'rgba(47,134,201,0)'); ctx.fillStyle = atm; ctx.beginPath(); ctx.arc(cx, cy, R * 1.24, 0, 7); ctx.fill();
            var oc = ctx.createRadialGradient(cx - R * 0.32, cy - R * 0.36, R * 0.15, cx, cy, R); oc.addColorStop(0, '#0e3f63'); oc.addColorStop(1, '#04263d'); ctx.fillStyle = oc; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
            ctx.strokeStyle = 'rgba(127,182,227,.22)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
            for (var i = 0; i < LP.length; i += 2) { var p = proj(LP[i], LP[i + 1], cur.lon, cur.lat); if (p.c < 0.04) continue; ctx.fillStyle = 'rgba(143,197,235,' + (0.22 + 0.5 * p.c).toFixed(3) + ')'; ctx.beginPath(); ctx.arc(p.x, p.y, 0.8 + 1.0 * p.c, 0, 7); ctx.fill(); }
            var sa = 1 - reachRev;
            if (sa > 0.01) {
              for (var aj = 0; aj < sArcs.length; aj++) { ctx.strokeStyle = 'rgba(127,182,227,' + (0.16 * sa).toFixed(3) + ')'; ctx.lineWidth = 1.2; ctx.beginPath(); var seg = sArcs[aj], on = false; for (var t2 = 0; t2 < seg.length; t2++) { var q = proj(seg[t2].lon, seg[t2].lat, cur.lon, cur.lat); if (q.c < 0) { on = false; continue; } if (!on) { ctx.moveTo(q.x, q.y); on = true; } else ctx.lineTo(q.x, q.y); } ctx.stroke(); }
              var pulse = reduce ? 1 : (0.5 + 0.5 * Math.sin((now || 0) / 520));
              for (var m = 0; m < story.length; m++) { var pm = proj(story[m].lon, story[m].lat, cur.lon, cur.lat); if (pm.c < 0) continue; if (story[m].idx === active) { ctx.fillStyle = 'rgba(63,185,132,' + (sa * (0.16 + 0.16 * pulse)).toFixed(3) + ')'; ctx.beginPath(); ctx.arc(pm.x, pm.y, 10 + 6 * pulse, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(63,185,132,' + sa.toFixed(3) + ')'; ctx.beginPath(); ctx.arc(pm.x, pm.y, 5.5, 0, 7); ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(255,255,255,' + (0.92 * sa).toFixed(3) + ')'; ctx.stroke(); } else { ctx.fillStyle = 'rgba(127,182,227,' + (sa * (0.45 + 0.45 * pm.c)).toFixed(3) + ')'; ctx.beginPath(); ctx.arc(pm.x, pm.y, 3.1, 0, 7); ctx.fill(); } }
            }
            if (reachRev > 0.01) {
              for (var ra = 0; ra < rArcs.length; ra++) { var ar = rArcs[ra]; var av = Math.max(0, Math.min(1, (reachRev - ar.rank) / 0.3)); if (av <= 0) continue; ctx.strokeStyle = 'rgba(95,208,197,' + (0.05 + 0.24 * av * reachRev).toFixed(3) + ')'; ctx.lineWidth = 1; ctx.beginPath(); var rseg = ar.seg, ron = false; for (var rt = 0; rt < rseg.length; rt++) { var rq = proj(rseg[rt].lon, rseg[rt].lat, cur.lon, cur.lat); if (rq.c < 0.02) { ron = false; continue; } if (!ron) { ctx.moveTo(rq.x, rq.y); ron = true; } else ctx.lineTo(rq.x, rq.y); } ctx.stroke(); }
              for (var rd = 0; rd < rdots.length; rd++) { var d = rdots[rd]; var dv = Math.max(0, Math.min(1, (reachRev - d.rank * 0.7) / 0.18)); if (dv <= 0) continue; var dm = proj(d.lon, d.lat, cur.lon, cur.lat); if (dm.c < 0.02) continue; var tw = reduce ? 1 : (0.8 + 0.2 * Math.sin((now || 0) / 540 + rd)); var rad = (1.4 + 2.8 * d.r) * (0.62 + 0.5 * dm.c); var al = dv * reachRev * (0.55 + 0.45 * dm.c) * tw; ctx.fillStyle = 'rgba(63,185,132,' + (al * 0.26).toFixed(3) + ')'; ctx.beginPath(); ctx.arc(dm.x, dm.y, rad * 2.5, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(126,240,193,' + al.toFixed(3) + ')'; ctx.beginPath(); ctx.arc(dm.x, dm.y, rad, 0, 7); ctx.fill(); }
            }
          }
          function shortest(d) { d = (d + 540) % 360 - 180; return d; }
          var raf = 0, vis = false;
          function loop(now) {
            if (reachActive) { if (!reduce) { cur.lon += 0.16; cur.lat += (10 - cur.lat) * 0.05; reachRev += (1 - reachRev) * 0.05; } }
            else { if (!reduce) { if (pts[active]) { cur.lon += shortest(tgt.lon - cur.lon) * 0.085; cur.lat += (tgt.lat - cur.lat) * 0.085; } reachRev += (0 - reachRev) * 0.08; } }
            draw(now);
            if (reduce || !vis) { raf = 0; return; } raf = requestAnimationFrame(loop);
          }
          function kick() { if (!raf && !reduce) raf = requestAnimationFrame(loop); }
          function setActive(i) {
            i = Math.max(0, Math.min(steps.length - 1, i)); if (i === active) return; active = i; reachActive = (i === reachIdx);
            if (!reachActive && pts[i]) { tgt.lon = pts[i].lon; tgt.lat = pts[i].lat; }
            if (cap) { cap.innerHTML = ''; var f = document.createElement('span'); f.className = 'gc-flag'; var c = document.createElement('span'); if (reachActive) { f.textContent = '\u{1F30D}'; c.textContent = (D && D.countries ? fmt(D.countries) + ' countries' : 'Worldwide'); } else { f.textContent = (pts[i] && pts[i].flag) || ''; c.textContent = (pts[i] && pts[i].country) || ''; } cap.appendChild(f); cap.appendChild(c); }
            for (var j = 0; j < steps.length; j++) steps[j].classList.toggle('on', j === i);
            if (reduce) { reachRev = reachActive ? 1 : 0; if (reachActive) cur.lat = 10; else if (pts[i]) { cur.lon = pts[i].lon; cur.lat = pts[i].lat; } draw(0); } else kick();
          }
          function pick() { var mid = (window.innerHeight || 0) * 0.5, best = 0, bd = 1e9; for (var i = 0; i < steps.length; i++) { var r = steps[i].getBoundingClientRect(); var ctr = r.top + r.height / 2; var d = Math.abs(ctr - mid); if (d < bd) { bd = d; best = i; } } setActive(best); }
          if ('IntersectionObserver' in window) { var io2 = new IntersectionObserver(function (es) { es.forEach(function (e) { vis = e.isIntersecting; if (vis) kick(); }); }, { threshold: 0.01 }); io2.observe(cv); } else { vis = true; }
          addEventListener('scroll', pick, { passive: true });
          addEventListener('resize', function () { size(); draw(0); });
          setActive(0); draw(0); pick();
        }
      }

      const heroBrand = D.logos.surghub
        ? '<img src="' + D.logos.surghub + '" alt="SURGhub" style="height:34px;width:auto;margin-bottom:18px">'
        : '<p class="brandtag rv">● <b>SURGhub</b> — Global Surgery Foundation</p>';

      const body =
        '<div id="prog"></div><nav id="dots"></nav>'
        + '<section id="hero" class="darker" data-dot="The hub"><div class="aurora"></div><canvas id="dotsbg"></canvas><div class="wrap" style="position:relative;z-index:2">'
        + heroBrand
        + '<h1 class="kin">Surgical knowledge,<br>made borderless.</h1>'
        + '<p class="lead rv d2">An estimated <b>5 billion people</b> lack access to safe, timely surgical care. Closing that gap depends not only on operating rooms, but on the knowledge to run them safely. SURGhub makes that knowledge openly available to health workers worldwide.</p>'
        + '<p class="muted rv d3" style="margin-top:14px">Access gap: The Lancet Commission on Global Surgery.</p>'
        + '</div><div class="cue">Scroll to explore ↓</div></section>'

        + sec('scale', 'The scale', 'dark', '<h2 class="rv">A global classroom for surgical care.</h2><p class="lead rv d1" style="margin-bottom:8px">No tuition and no travel: one platform, open to every member of the surgical team.</p><div class="kpis">' + scaleCards + '</div>')

        + sec('growth', 'Growth', '', '<h2 class="rv">Sustained growth since launch.</h2><p class="lead rv d1" style="margin-bottom:24px">Since launching in June 2023, both registrations and course completions have grown steadily. Hover either chart to read any month.</p>'
        + '<div class="growthgrid">'
        + '<div class="chartcard rv d2"><div class="legend"><span><i class="sw" style="background:#2f86c9"></i>Registered learners</span></div><div id="tip-learners" class="tip"></div><div id="growth-wrap-learners" class="growthbox"></div></div>'
        + '<div class="chartcard rv d3"><div class="legend"><span><i class="sw" style="background:#3FB984"></i>Certificates earned</span></div><div id="tip-certs" class="tip"></div><div id="growth-wrap-certs" class="growthbox"></div></div>'
        + '</div>' + certHi)

        + sec('reach', 'Reach', 'dark', '<div class="cols"><div><h2 class="rv">Where surgical care is hardest to reach.</h2><p class="lead rv d1" style="margin:0 0 20px;font-size:18px">Most located learners are in the countries with the greatest unmet need for surgical care.</p>'
        + '<div class="reach-hi rv d1"><div class="reach-hi-num num" data-to="' + (D.priorityShare || 0) + '" data-suffix="%">0</div><div class="reach-hi-lab"><b>Priority learner share</b><br>of located learners are in Lancet Commission priority countries.</div></div>'
        + '<p class="muted rv d3" style="margin-top:16px">Priority countries are the low- and lower-middle-income settings the Lancet Commission on Global Surgery identifies as carrying the largest unmet need for safe, timely surgical care.</p></div>'
        + '<div class="rv d2"><p class="muted" style="margin-bottom:12px;letter-spacing:.14em;text-transform:uppercase;font-size:12px">Top reached priority countries</p><div class="plist">' + priorityList + '</div></div></div>'
        + '<div class="rv d2" style="margin-top:34px"><div id="map" style="width:100%;height:460px"></div><div id="map-legend"></div><div style="text-align:center;margin-top:14px"><button id="lmic-toggle" class="toggle">See only the hardest places</button></div></div>')

        + sec('faces', 'On the ground', 'darker', '<h2 class="rv">The people behind the map.</h2><p class="lead rv d1" style="margin-bottom:8px">Behind every point on that map is a clinician putting new skills to work. Scroll to travel the globe — from Bangladesh to Sierra Leone.</p>' + geoScrolly + '<p class="muted rv" style="margin-top:22px;text-align:center">More learner stories on the <a href="https://www.surghub.org/blog" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">SURGhub blog</a>.</p>')

        + (cadreDonut ? sec('who', 'Who', '', '<h2 class="rv">The whole surgical team.</h2><p class="lead rv d1" style="margin-bottom:22px">Safe surgery depends on the whole team. SURGhub serves surgeons, nurses, anaesthesia providers, midwives, and the students training to join them.</p>' + cadreDonut) : '')

        + (dials ? sec('impact', 'Impact', 'dark', '<h2 class="rv">Learning that changes practice.</h2><p class="lead rv d1" style="margin-bottom:8px">In post-course surveys, learners report applying what they have learned:</p><div class="dials">' + dials + '</div>' + (surveyN ? '<p class="muted rv d4" style="text-align:center;margin-top:26px">Based on ' + fmt(surveyN) + ' post-course survey responses.</p>' : '')) : '')

        + (ambCards ? sec('network', 'Network', '', netGlobe + '<div class="netfg"><h2 class="rv">Growth driven by its community.</h2><p class="lead rv d1" style="margin-bottom:24px">Volunteer ambassadors introduce SURGhub to their professional networks. The learners they bring go on to complete courses and certify.</p><div class="kpis">' + ambCards + '</div>' + ambFeature + ambCTA + '</div>') : '')

        + ((quoteCards || ratingBand) ? sec('voices', 'Voices', 'dark', '<h2 class="rv">Trusted by the people who use it.</h2><p class="lead rv d1" style="margin-bottom:20px">Anonymised feedback from learners.</p>' + ratingBand + (quoteCards ? '<div class="quotes">' + quoteCards + '</div>' : '') + (quoteCards ? '<p class="muted rv" style="margin-top:20px">Anonymised learner feedback. No names or personal details.</p>' : '')) : '')

        + sec('join', 'Join', 'darker', '<div class="aurora aurora-join"></div><div class="joinwrap"><div class="joinmain"><p class="eyebrow rv">Open · accessible · global</p><h1 class="kin" style="font-size:clamp(30px,5vw,58px)">Surgical education<br>for everyone, everywhere.</h1><p class="lead rv d2">Over ' + fmt(D.learners) + ' healthcare workers across ' + fmt(D.countries) + '+ countries are already learning on SURGhub. Join them, or partner with the Global Surgery Foundation to reach more.</p><a class="btn rv d3" href="https://surghub.org" target="_blank" rel="noopener">Explore SURGhub →</a></div>'
        + (D.logos.surghub ? '<div class="joinlogo rv d2"><img src="' + D.logos.surghub + '" alt="SURGhub"></div>' : '')
        + '</div>'
        + '<div class="foot rv d4"><p class="joint">SURGhub is a joint initiative of the Global Surgery Foundation (GSF) and UNITAR (United Nations Institute for Training and Research), supported by the Royal College of Surgeons in Ireland (RCSI), and implemented in association with the Johnson &amp; Johnson Foundation.</p><p class="footmeta">Aggregated, anonymised platform data — counts only, no personal information. Data as of ' + esc(D.snapshotDate) + '. Built with SURGdash · © Global Surgery Foundation.</p></div>');

      const CSS = ':root{--prussian:#04263d;--prussian-deep:#021a2c;--boston:#2f86c9;--boston-soft:#7fb6e3;--green:#3FB984;--slate:#94a3b8;--red:#e57373;--ink:#0f2330;--paper:#f6f9fc;--paper2:#eef4f9;--line:rgba(255,255,255,.12)}'
        + '*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--paper);line-height:1.6;-webkit-font-smoothing:antialiased}'
        + '.num{font-variant-numeric:tabular-nums}.mono{font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:.06em;color:#6d8ba3;text-transform:uppercase}'
        + '#prog{position:fixed;top:0;left:0;height:3px;width:0;background:var(--boston);z-index:60}'
        + '#dots{position:fixed;right:18px;top:50%;transform:translateY(-50%);z-index:55;display:flex;flex-direction:column;gap:11px}#dots a{width:9px;height:9px;border-radius:50%;background:rgba(120,140,160,.45);transition:all .3s}#dots a.on{background:var(--boston);transform:scale(1.45)}@media(max-width:760px){#dots{display:none}}'
        + 'section{padding:9vh 6vw;position:relative}.dark{background:var(--prussian);color:#eaf2f8}.darker{background:var(--prussian-deep);color:#eaf2f8}.wrap{max-width:1040px;margin:0 auto}'
        + '.eyebrow{font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:var(--boston);font-weight:600;margin:0 0 14px}.dark .eyebrow,.darker .eyebrow{color:var(--boston-soft)}'
        + 'h1{font-size:clamp(34px,6vw,76px);line-height:1.04;margin:.1em 0 .35em;font-weight:700;letter-spacing:-.02em}h2{font-size:clamp(26px,3.6vw,44px);line-height:1.1;margin:0 0 .5em;font-weight:700;letter-spacing:-.015em}'
        + '.lead{font-size:clamp(17px,2vw,21px);max-width:60ch;color:#3d5567}.dark .lead,.darker .lead{color:#b9cede}.muted{color:var(--slate);font-size:14px}.dark .muted,.darker .muted{color:#7f9bb1}'
        + '.rv{opacity:0;transform:translateY(26px);transition:opacity .7s ease,transform .7s cubic-bezier(.2,.7,.2,1)}.rv.in{opacity:1;transform:none}.rv.d1{transition-delay:.08s}.rv.d2{transition-delay:.16s}.rv.d3{transition-delay:.24s}.rv.d4{transition-delay:.32s}.rv.d5{transition-delay:.40s}.rv.d6{transition-delay:.48s}.rv.d7{transition-delay:.56s}.rv.d8{transition-delay:.64s}'
        + '#hero{min-height:100vh;display:flex;align-items:center;overflow:hidden}#dotsbg{position:absolute;inset:0;z-index:1;opacity:.55}.brandtag{font-weight:700;letter-spacing:.04em;color:#cfe2f1}.brandtag b{color:#fff}'
        + '.cue{position:absolute;bottom:34px;left:50%;transform:translateX(-50%);color:#9fc1dc;font-size:13px;letter-spacing:.14em;text-transform:uppercase;animation:bob 2s ease-in-out infinite;z-index:2}@keyframes bob{0%,100%{transform:translate(-50%,0)}50%{transform:translate(-50%,8px)}}'
        + '.chap{display:inline-block;margin-right:10px;padding:2px 8px;border:1px solid var(--boston-soft);border-radius:6px;font-size:11px;font-weight:700;letter-spacing:.05em;color:#fff;background:rgba(127,182,227,.16);vertical-align:middle}'
        + '.aurora{position:absolute;inset:-25%;z-index:0;pointer-events:none;background:radial-gradient(38% 46% at 22% 30%,rgba(47,134,201,.34),transparent 72%),radial-gradient(40% 48% at 80% 68%,rgba(63,185,132,.22),transparent 72%);filter:blur(46px);animation:drift 26s ease-in-out infinite}.aurora-join{opacity:.6}@keyframes drift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(3%,2.5%) scale(1.06)}}'
        + '.kin .w{display:inline-block;opacity:0;transform:translateY(20px);transition:opacity .6s ease,transform .6s cubic-bezier(.2,.7,.2,1)}.kin.in .w{opacity:1;transform:none}'
        + '.num.pop{animation:pop .42s cubic-bezier(.2,.8,.3,1)}@keyframes pop{0%{transform:scale(1.06)}55%{transform:scale(1.012)}100%{transform:scale(1)}}'
        + '.quote.rv{transform:translateY(28px) scale(.985)}.quote.rv.in{transform:none}.stars .on{transition:color .5s ease .15s}.quote.rv:not(.in) .stars .on{color:rgba(255,255,255,.28)}'
        + '#join{overflow:hidden}#join .joinwrap,#join .foot{position:relative;z-index:1}'
        + '.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px;margin-top:34px}.kpi{background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:16px;padding:26px 24px;transition:transform .25s ease,border-color .25s ease,background .25s ease}.kpi:hover{transform:translateY(-4px);border-color:rgba(127,182,227,.45);background:rgba(255,255,255,.08)}.kpi.lite{background:var(--paper2);border-color:#dce8f1}.kpi.lite:hover{border-color:var(--boston);background:#fff}'
        + '.kpi .v{font-size:clamp(34px,5vw,54px);font-weight:800;line-height:1;letter-spacing:-.02em;color:#fff}.kpi.lite .v{color:var(--ink)}.kpi .v.green{color:var(--green)}.kpi .v.boston{color:var(--boston-soft)}.kpi.lite .v.boston{color:var(--boston)}'
        + '.kpi .l{margin-top:10px;font-size:15px;color:#a9c3d6}.kpi.lite .l{color:#5b7488}.kpi .s{margin-top:6px;font-size:13px;color:#7f9bb1}.pill{display:inline-block;margin-top:10px;font-size:12px;font-weight:600;background:rgba(63,185,132,.16);color:#8fe3bf;border-radius:999px;padding:3px 11px}'
        + '.chartcard{background:#fff;border:1px solid #e4edf4;border-radius:18px;padding:24px 22px 16px;position:relative;transition:transform .25s ease,box-shadow .25s ease}.chartcard:hover{transform:translateY(-3px);box-shadow:0 18px 44px rgba(4,38,61,.14)}.growthgrid{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:8px}@media(max-width:820px){.growthgrid{grid-template-columns:1fr}}.legend{display:flex;gap:20px;flex-wrap:wrap;font-size:13px;color:#5b7488;margin-bottom:8px}.legend span{display:inline-flex;align-items:center;gap:7px}.sw{width:12px;height:12px;border-radius:3px;display:inline-block}.gline{fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.ann{font-size:13px;font-weight:700}.growthbox{width:100%;height:300px;cursor:crosshair}.growthbox svg{display:block;width:100%;height:300px}.tip{position:absolute;top:14px;right:22px;font-size:13px;background:#04263d;color:#eaf2f8;padding:6px 11px;border-radius:8px;opacity:0;transition:opacity .15s;pointer-events:none}'
        + '.bars{display:flex;flex-direction:column;gap:13px;margin-top:8px}.bar{display:grid;grid-template-columns:170px 1fr 70px;align-items:center;gap:14px}.bar .lab{font-size:15px}.track{height:18px;background:rgba(255,255,255,.1);border-radius:999px;overflow:hidden}body .track{background:rgba(120,140,160,.16)}.dark .track{background:rgba(255,255,255,.1)}.fill{height:100%;width:0;border-radius:999px;background:var(--boston);transition:width 1.1s cubic-bezier(.2,.7,.2,1)}.fill.slate{background:#7d96a8}.bar .val{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}'
        + '.cols{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}@media(max-width:820px){.cols{grid-template-columns:1fr;gap:28px}}.bignum{font-size:clamp(56px,11vw,118px);font-weight:800;letter-spacing:-.03em;line-height:.95;color:#fff}.statline{font-size:18px;color:#bdd3e4;margin-top:8px}'
        + '.conflict{margin-top:22px;background:rgba(229,115,115,.12);border:1px solid rgba(229,115,115,.35);border-radius:14px;padding:18px 20px}.conflict .v{font-size:34px;font-weight:800;color:#ffb4b4}.conflict .l{color:#e7c3c3;font-size:14px}.reach-hi{margin-top:20px;display:flex;align-items:center;gap:20px;background:rgba(63,185,132,.10);border:1px solid rgba(63,185,132,.34);border-radius:16px;padding:18px 22px}.reach-hi-num{font-size:clamp(46px,7.5vw,76px);font-weight:800;line-height:.88;color:var(--green);letter-spacing:-.02em;flex:none}.reach-hi-lab{font-size:15px;color:#cfe6da}.reach-hi-lab b{color:#eaf7f0;font-weight:700}'
        + '#map .mapoff{text-align:center;color:#6d8ba3;font-size:13px;padding:200px 0}.toggle{background:rgba(255,255,255,.06);border:1px solid var(--line);color:#cfe2f1;font-weight:600;font-size:14px;padding:11px 20px;border-radius:10px;cursor:pointer;transition:all .2s}.toggle:hover,.toggle.on{background:var(--boston);border-color:var(--boston);color:#fff}'
        + '.dials{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:26px;margin-top:30px}.dial{text-align:center}.dial svg{transform:rotate(-90deg)}.dial .pc{font-size:30px;font-weight:800;fill:#fff}.dial .cap{margin-top:12px;font-size:15px;color:#b9cede;max-width:24ch;margin-left:auto;margin-right:auto}'
        + '.quotes{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:30px;margin-top:32px}.quote{display:flex;flex-direction:column;align-items:center;text-align:center;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:16px;padding:34px 30px 30px;transition:transform .25s ease,border-color .25s ease,background .25s ease}.quote:hover{transform:translateY(-4px);border-color:rgba(127,182,227,.5);background:rgba(255,255,255,.08)}.quote .q{font-family:Georgia,serif;font-size:19px;line-height:1.5;color:#eaf2f8;margin:0}.quote .mark{font-family:Georgia,serif;font-size:52px;line-height:1;color:var(--boston-soft);margin:0 0 4px;display:block}.quote .by{margin:18px 0 0;font-size:13px;color:#9fc1dc;font-weight:600}'
        + '.stars{display:inline-flex;gap:2px;font-size:15px;color:rgba(255,255,255,.22);margin:6px 0 2px}.stars .on{color:#f5b301}'
        + '.ratingband{display:flex;align-items:center;column-gap:52px;row-gap:0;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:18px;padding:28px 42px;margin:10px 0 34px;flex-wrap:wrap}.rb-block{display:flex;flex-direction:column;justify-content:center}.rb-pct{font-size:clamp(50px,7.5vw,74px);font-weight:800;color:var(--green);line-height:1}.rb-pct-lab{font-size:15px;color:#b9cede;margin-top:8px}.rb-avg-block{padding-left:52px;border-left:1px solid var(--line)}@media(max-width:600px){.rb-avg-block{padding-left:0;border-left:0}}.rb-stars{font-size:28px;color:#f5b301;letter-spacing:5px;line-height:1}.rb-avg{font-size:15px;color:#b9cede;margin-top:10px}.rb-avg b{color:#fff;font-size:23px;margin-right:6px}.rb-logo{margin-left:auto;align-self:center;height:74px;width:auto;opacity:.92}@media(max-width:600px){.rb-logo{display:none}}.rb-foot{flex-basis:100%;font-size:13px;color:#7f9bb1;margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}'
        + '.btn{display:inline-block;margin-top:26px;background:var(--boston);color:#fff;font-weight:700;text-decoration:none;padding:15px 30px;border-radius:12px;font-size:16px;transition:transform .2s,background .2s}.btn:hover{transform:translateY(-2px);background:#3f97da}.joinwrap{display:flex;align-items:center;justify-content:space-between;gap:48px;flex-wrap:wrap}.joinmain{flex:1;min-width:300px}.joinlogo{flex:none}.joinlogo img{height:130px;width:auto;opacity:.96;filter:drop-shadow(0 10px 26px rgba(0,0,0,.4))}@media(max-width:820px){.joinlogo img{height:80px}}.foot{margin-top:48px;font-size:13px;color:#7f9bb1;border-top:1px solid var(--line);padding-top:22px}.foot .joint{margin:0 0 10px;color:#9fb6c9;max-width:82ch}.foot .footmeta{margin:0;color:#6d8ba3}'
        + '.certhi{margin-top:24px;display:flex;align-items:center;gap:22px;background:#fff;border:1px solid #d7ead9;border-left:5px solid var(--green);border-radius:16px;padding:22px 26px}.certhi-num{font-size:clamp(40px,6vw,64px);font-weight:800;line-height:.9;color:#1f9c63;letter-spacing:-.02em;flex:none}.certhi-lab{font-size:16px;color:#3d5567}.certhi-lab b{color:var(--ink)}'
        + '.feature{display:flex;align-items:stretch;text-decoration:none;margin-top:26px;background:linear-gradient(120deg,rgba(47,134,201,.10),rgba(63,185,132,.10));border:1px solid #dce8f1;border-radius:16px;overflow:hidden;transition:transform .25s ease,border-color .25s ease}.feature:hover{transform:translateY(-3px);border-color:var(--boston)}.feature-img{flex:none;width:240px;overflow:hidden;background:#04263d;display:flex;align-items:center;justify-content:center}.feature-img img{width:100%;height:100%;min-height:160px;object-fit:contain;display:block}.feature-body{padding:24px 28px}@media(max-width:680px){.feature{flex-direction:column}.feature-img{width:100%;height:200px}}.feature-k{display:block;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--boston);font-weight:700}.feature-t{display:block;font-size:21px;font-weight:700;color:var(--ink);margin-top:8px}.feature-s{display:block;font-size:15px;color:#5b7488;margin-top:8px}'
        + '.ambcta{display:flex;align-items:center;gap:22px;flex-wrap:wrap;text-decoration:none;margin-top:18px;background:#fff;border:1px solid #dce8f1;border-radius:16px;padding:20px 24px;transition:transform .25s ease,border-color .25s ease}.ambcta:hover{transform:translateY(-3px);border-color:var(--boston)}.ambcta-logo{flex:none;width:64px;height:64px;border-radius:12px;object-fit:cover}.ambcta-body{flex:1;min-width:200px}.ambcta-t{font-size:19px;font-weight:700;color:var(--ink)}.ambcta-s{font-size:14px;color:#5b7488;margin-top:3px}.ambcta-btn{flex:none;background:var(--boston);color:#fff;font-weight:700;padding:12px 22px;border-radius:10px;font-size:15px;transition:background .2s}.ambcta:hover .ambcta-btn{background:#3f97da}'
        + '.donutbox{display:flex;align-items:center;gap:44px;flex-wrap:wrap;margin-top:24px}.donut-wrap{flex:none;width:220px;height:220px}.donutsvg{width:220px;height:220px;display:block}.donut-legend{flex:1;min-width:260px;display:flex;flex-direction:column;gap:12px}.leg{display:grid;grid-template-columns:16px 1fr auto;align-items:center;gap:14px}.legdot{width:14px;height:14px;border-radius:4px;display:inline-block}.legnm{font-size:15px;color:#334155}.legpct{font-size:16px;color:var(--ink);font-weight:700;text-align:right;font-variant-numeric:tabular-nums}'
        + '#network{overflow:hidden}.netfg{position:relative;z-index:1}.netbg{position:absolute;right:-90px;top:50%;transform:translateY(-50%);width:560px;height:560px;opacity:.14;pointer-events:none;z-index:0}@media(max-width:760px){.netbg{display:none}}'
        + '.plist{display:flex;flex-direction:column}.prow{display:grid;grid-template-columns:26px 26px 1fr;align-items:center;gap:12px;padding:11px 4px;border-bottom:1px solid rgba(255,255,255,.07)}.prank{font-size:13px;font-weight:700;color:#7f9bb1;font-variant-numeric:tabular-nums}.pflag{font-size:18px}.pname{font-size:16px;color:#eaf2f8}'
        + '.globe-scrolly{display:grid;grid-template-columns:0.92fr 1.08fr;gap:50px;margin-top:34px}@media(max-width:860px){.globe-scrolly{grid-template-columns:1fr;gap:0}}'
        + '.globe-stage{position:sticky;top:11vh;height:78vh;display:flex;align-items:center;justify-content:center;background:var(--prussian-deep)}@media(max-width:860px){.globe-stage{top:0;height:46vh;margin:0 -6vw;z-index:2}}#globe{width:100%;height:100%;display:block;touch-action:pan-y}'
        + '.globe-cap{position:absolute;left:0;right:0;bottom:5%;display:flex;align-items:center;justify-content:center;gap:11px;font-size:18px;font-weight:700;letter-spacing:.01em;color:#eaf2f8;pointer-events:none;text-shadow:0 2px 14px rgba(0,0,0,.6);transition:opacity .4s ease}.globe-cap .gc-flag{font-size:26px;line-height:1}'
        + '.globe-steps{display:flex;flex-direction:column}.gstep{min-height:64vh;display:flex;align-items:center}@media(max-width:860px){.gstep{min-height:auto;padding:26px 0}}'
        + '.gstep-card{width:100%;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:18px;overflow:hidden;opacity:.45;transform:scale(.985);transition:opacity .45s ease,transform .45s cubic-bezier(.2,.7,.2,1),border-color .45s ease,background .45s ease}.gstep.on .gstep-card{opacity:1;transform:none;border-color:rgba(63,185,132,.5);background:rgba(255,255,255,.08)}'
        + '.gstep-media{position:relative;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;overflow:hidden}.gstep-media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.gstep-init{font-size:48px;font-weight:800;color:rgba(255,255,255,.9);letter-spacing:.02em}'
        + '.gstep-body{padding:20px 24px 22px}.gstep-loc{display:flex;align-items:center;gap:9px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--boston-soft);font-weight:700}.gstep-flag{font-size:20px;line-height:1}.gstep-nm{font-size:clamp(20px,2.4vw,26px);font-weight:700;color:#eaf2f8;margin:10px 0 2px;letter-spacing:-.01em}.gstep-role{font-size:14px;color:#9fc1dc;font-weight:600;margin-bottom:11px}.gstep-sum{font-size:15.5px;line-height:1.6;color:#b9cede;margin:0 0 15px}.gstep-go{font-size:14px;font-weight:700;color:var(--boston-soft);text-decoration:none}.gstep-card:hover .gstep-go{color:#fff}'
        + '.gstep-reach{justify-content:center}.reach-card{width:100%;text-align:center}.reach-line{font-size:clamp(21px,2.6vw,30px);font-weight:700;line-height:1.42;color:#eaf2f8;margin:0 auto;max-width:30ch}.reach-line b{font-weight:800;font-variant-numeric:tabular-nums}.reach-line b:first-of-type{color:var(--green)}.reach-line b:last-of-type{color:var(--boston-soft)}'
        + '@media(prefers-reduced-motion:reduce){.rv{transition:none;opacity:1;transform:none}.gstep-card{opacity:1;transform:none}.fill{transition:none}.cue{animation:none}.kin .w{opacity:1;transform:none;transition:none}.aurora{animation:none}.num.pop{animation:none}.stars .on{transition:none}.quote.rv{transform:none}}';

      // Continents for the scroll globe — a flat [lon,lat,…] land-dot mask (Natural Earth 110m,
      // sampled on a 3° grid at build time). Baked in so the globe shows real land offline.
      const LANDJSON = '[-72,-53,-69,-53,-75,-50,-72,-50,-69,-50,-72,-47,-69,-47,-72,-44,-69,-44,-66,-44,171,-44,-72,-41,-69,-41,-66,-41,-63,-41,147,-41,174,-41,-72,-38,-69,-38,-66,-38,-63,-38,-60,-38,141,-38,144,-38,147,-38,177,-38,-72,-35,-69,-35,-66,-35,-63,-35,-60,-35,117,-35,141,-35,144,-35,147,-35,150,-35,-69,-32,-66,-32,-63,-32,-60,-32,-57,-32,-54,-32,21,-32,24,-32,27,-32,117,-32,120,-32,123,-32,126,-32,135,-32,138,-32,141,-32,144,-32,147,-32,150,-32,-69,-29,-66,-29,-63,-29,-60,-29,-57,-29,-54,-29,-51,-29,18,-29,21,-29,24,-29,27,-29,30,-29,117,-29,120,-29,123,-29,126,-29,129,-29,132,-29,135,-29,138,-29,141,-29,144,-29,147,-29,150,-29,153,-29,-69,-26,-66,-26,-63,-26,-60,-26,-57,-26,-54,-26,-51,-26,15,-26,18,-26,21,-26,24,-26,27,-26,30,-26,114,-26,117,-26,120,-26,123,-26,126,-26,129,-26,132,-26,135,-26,138,-26,141,-26,144,-26,147,-26,150,-26,153,-26,-69,-23,-66,-23,-63,-23,-60,-23,-57,-23,-54,-23,-51,-23,-48,-23,-45,-23,15,-23,18,-23,21,-23,24,-23,27,-23,30,-23,33,-23,45,-23,114,-23,117,-23,120,-23,123,-23,126,-23,129,-23,132,-23,135,-23,138,-23,141,-23,144,-23,147,-23,150,-23,-69,-20,-66,-20,-63,-20,-60,-20,-57,-20,-54,-20,-51,-20,-48,-20,-45,-20,-42,-20,15,-20,18,-20,21,-20,24,-20,27,-20,30,-20,33,-20,45,-20,48,-20,120,-20,123,-20,126,-20,129,-20,132,-20,135,-20,138,-20,141,-20,144,-20,147,-20,-72,-17,-69,-17,-66,-17,-63,-17,-60,-17,-57,-17,-54,-17,-51,-17,-48,-17,-45,-17,-42,-17,12,-17,15,-17,18,-17,21,-17,24,-17,27,-17,30,-17,33,-17,36,-17,45,-17,48,-17,123,-17,126,-17,129,-17,132,-17,135,-17,138,-17,144,-17,-75,-14,-72,-14,-69,-14,-66,-14,-63,-14,-60,-14,-57,-14,-54,-14,-51,-14,-48,-14,-45,-14,-42,-14,-39,-14,15,-14,18,-14,21,-14,24,-14,27,-14,30,-14,33,-14,36,-14,39,-14,48,-14,132,-14,135,-14,-75,-11,-72,-11,-69,-11,-66,-11,-63,-11,-60,-11,-57,-11,-54,-11,-51,-11,-48,-11,-45,-11,-42,-11,-39,-11,15,-11,18,-11,21,-11,24,-11,27,-11,30,-11,33,-11,36,-11,39,-11,-78,-8,-75,-8,-72,-8,-69,-8,-66,-8,-63,-8,-60,-8,-57,-8,-54,-8,-51,-8,-48,-8,-45,-8,-42,-8,-39,-8,-36,-8,15,-8,18,-8,21,-8,24,-8,27,-8,30,-8,33,-8,36,-8,39,-8,111,-8,114,-8,138,-8,141,-8,147,-8,159,-8,-81,-5,-78,-5,-75,-5,-72,-5,-69,-5,-66,-5,-63,-5,-60,-5,-57,-5,-54,-5,-51,-5,-48,-5,-45,-5,-42,-5,-39,-5,12,-5,15,-5,18,-5,21,-5,24,-5,27,-5,30,-5,33,-5,36,-5,39,-5,105,-5,120,-5,123,-5,138,-5,141,-5,144,-5,-78,-2,-75,-2,-72,-2,-69,-2,-66,-2,-63,-2,-60,-2,-57,-2,-54,-2,-51,-2,-48,-2,-45,-2,12,-2,15,-2,18,-2,21,-2,24,-2,27,-2,30,-2,33,-2,36,-2,39,-2,102,-2,111,-2,114,-2,120,-2,138,-2,-78,1,-75,1,-72,1,-69,1,-66,1,-63,1,-60,1,-57,1,-54,1,-51,1,12,1,15,1,18,1,21,1,24,1,27,1,30,1,33,1,36,1,39,1,42,1,99,1,102,1,111,1,114,1,117,1,-75,4,-72,4,-69,4,-66,4,-63,4,-60,4,-57,4,-54,4,9,4,12,4,15,4,18,4,21,4,24,4,27,4,30,4,33,4,36,4,39,4,42,4,45,4,102,4,114,4,117,4,-75,7,-72,7,-69,7,-66,7,-63,7,-60,7,-9,7,-6,7,-3,7,0,7,3,7,6,7,9,7,12,7,15,7,18,7,21,7,24,7,27,7,30,7,33,7,36,7,39,7,42,7,45,7,48,7,81,7,126,7,-84,10,-75,10,-72,10,-69,10,-66,10,-63,10,-12,10,-9,10,-6,10,-3,10,0,10,3,10,6,10,9,10,12,10,15,10,18,10,21,10,24,10,27,10,30,10,33,10,36,10,39,10,42,10,45,10,48,10,78,10,99,10,105,10,123,10,-87,13,-84,13,-15,13,-12,13,-9,13,-6,13,-3,13,0,13,3,13,6,13,9,13,12,13,15,13,18,13,21,13,24,13,27,13,30,13,33,13,36,13,39,13,42,13,45,13,75,13,78,13,99,13,102,13,105,13,108,13,-96,16,-93,16,-90,16,-15,16,-12,16,-9,16,-6,16,-3,16,0,16,3,16,6,16,9,16,12,16,15,16,18,16,21,16,24,16,27,16,30,16,33,16,36,16,39,16,45,16,48,16,51,16,75,16,78,16,99,16,102,16,105,16,108,16,120,16,-102,19,-99,19,-90,19,-72,19,-15,19,-12,19,-9,19,-6,19,-3,19,0,19,3,19,6,19,9,19,12,19,15,19,18,19,21,19,24,19,27,19,30,19,33,19,36,19,42,19,45,19,48,19,51,19,54,19,57,19,75,19,78,19,81,19,84,19,96,19,99,19,102,19,105,19,-105,22,-102,22,-99,22,-84,22,-78,22,-15,22,-12,22,-9,22,-6,22,-3,22,0,22,3,22,6,22,9,22,12,22,15,22,18,22,21,22,24,22,27,22,30,22,33,22,36,22,42,22,45,22,48,22,51,22,54,22,57,22,72,22,75,22,78,22,81,22,84,22,87,22,90,22,93,22,96,22,99,22,102,22,105,22,108,22,111,22,-111,25,-108,25,-105,25,-102,25,-99,25,-78,25,-12,25,-9,25,-6,25,-3,25,0,25,3,25,6,25,9,25,12,25,15,25,18,25,21,25,24,25,27,25,30,25,33,25,39,25,42,25,45,25,48,25,51,25,69,25,72,25,75,25,78,25,81,25,84,25,87,25,90,25,93,25,96,25,99,25,102,25,105,25,108,25,111,25,114,25,117,25,-114,28,-111,28,-108,28,-105,28,-102,28,-99,28,-81,28,-12,28,-9,28,-6,28,-3,28,0,28,3,28,6,28,9,28,12,28,15,28,18,28,21,28,24,28,27,28,30,28,33,28,36,28,39,28,42,28,45,28,48,28,54,28,57,28,60,28,63,28,66,28,69,28,72,28,75,28,78,28,81,28,84,28,87,28,90,28,93,28,96,28,99,28,102,28,105,28,108,28,111,28,114,28,117,28,120,28,-111,31,-108,31,-105,31,-102,31,-99,31,-96,31,-93,31,-90,31,-87,31,-84,31,-9,31,-6,31,-3,31,0,31,3,31,6,31,9,31,12,31,15,31,21,31,24,31,27,31,30,31,33,31,36,31,39,31,42,31,45,31,48,31,51,31,54,31,57,31,60,31,63,31,66,31,69,31,72,31,75,31,78,31,81,31,84,31,87,31,90,31,93,31,96,31,99,31,102,31,105,31,108,31,111,31,114,31,117,31,120,31,-117,34,-114,34,-111,34,-108,34,-105,34,-102,34,-99,34,-96,34,-93,34,-90,34,-87,34,-84,34,-81,34,-78,34,-6,34,-3,34,0,34,3,34,6,34,9,34,36,34,39,34,42,34,45,34,48,34,51,34,54,34,57,34,60,34,63,34,66,34,69,34,72,34,75,34,78,34,81,34,84,34,87,34,90,34,93,34,96,34,99,34,102,34,105,34,108,34,111,34,114,34,117,34,120,34,132,34,-120,37,-117,37,-114,37,-111,37,-108,37,-105,37,-102,37,-99,37,-96,37,-93,37,-90,37,-87,37,-84,37,-81,37,-78,37,-6,37,-3,37,6,37,9,37,15,37,30,37,33,37,36,37,39,37,42,37,45,37,48,37,54,37,57,37,60,37,63,37,66,37,69,37,72,37,75,37,78,37,81,37,84,37,87,37,90,37,93,37,96,37,99,37,102,37,105,37,108,37,111,37,114,37,117,37,120,37,129,37,138,37,-123,40,-120,40,-117,40,-114,40,-111,40,-108,40,-105,40,-102,40,-99,40,-96,40,-93,40,-90,40,-87,40,-84,40,-81,40,-78,40,-75,40,-9,40,-6,40,-3,40,0,40,9,40,21,40,24,40,27,40,30,40,33,40,36,40,39,40,42,40,45,40,48,40,54,40,57,40,60,40,63,40,66,40,69,40,72,40,75,40,78,40,81,40,84,40,87,40,90,40,93,40,96,40,99,40,102,40,105,40,108,40,111,40,114,40,117,40,123,40,126,40,141,40,-123,43,-120,43,-117,43,-114,43,-111,43,-108,43,-105,43,-102,43,-99,43,-96,43,-93,43,-90,43,-87,43,-84,43,-81,43,-78,43,-75,43,-72,43,-9,43,-6,43,-3,43,0,43,3,43,12,43,18,43,21,43,24,43,27,43,42,43,45,43,54,43,57,43,60,43,63,43,66,43,69,43,72,43,75,43,78,43,81,43,84,43,87,43,90,43,93,43,96,43,99,43,102,43,105,43,108,43,111,43,114,43,117,43,120,43,123,43,126,43,129,43,141,43,144,43,-123,46,-120,46,-117,46,-114,46,-111,46,-108,46,-105,46,-102,46,-99,46,-96,46,-93,46,-90,46,-87,46,-84,46,-81,46,-78,46,-75,46,-72,46,-69,46,-66,46,-60,46,0,46,3,46,6,46,9,46,12,46,15,46,18,46,21,46,24,46,27,46,30,46,39,46,42,46,45,46,48,46,54,46,57,46,60,46,63,46,66,46,69,46,72,46,75,46,78,46,81,46,84,46,87,46,90,46,93,46,96,46,99,46,102,46,105,46,108,46,111,46,114,46,117,46,120,46,123,46,126,46,129,46,132,46,135,46,-120,49,-117,49,-114,49,-111,49,-108,49,-105,49,-102,49,-99,49,-96,49,-93,49,-90,49,-87,49,-84,49,-81,49,-78,49,-75,49,-72,49,-69,49,-66,49,-57,49,-54,49,0,49,3,49,6,49,9,49,12,49,15,49,18,49,21,49,24,49,27,49,30,49,33,49,36,49,39,49,42,49,45,49,48,49,51,49,54,49,57,49,60,49,63,49,66,49,69,49,72,49,75,49,78,49,81,49,84,49,87,49,90,49,93,49,96,49,99,49,102,49,105,49,108,49,111,49,114,49,117,49,120,49,123,49,126,49,129,49,132,49,135,49,138,49,-126,52,-123,52,-120,52,-117,52,-114,52,-111,52,-108,52,-105,52,-102,52,-99,52,-96,52,-93,52,-90,52,-87,52,-84,52,-78,52,-75,52,-72,52,-69,52,-66,52,-63,52,-60,52,-57,52,-9,52,-3,52,0,52,6,52,9,52,12,52,15,52,18,52,21,52,24,52,27,52,30,52,33,52,36,52,39,52,42,52,45,52,48,52,51,52,54,52,57,52,60,52,63,52,66,52,69,52,72,52,75,52,78,52,81,52,84,52,87,52,90,52,93,52,96,52,99,52,102,52,105,52,108,52,111,52,114,52,117,52,120,52,123,52,126,52,129,52,132,52,135,52,138,52,141,52,-129,55,-126,55,-123,55,-120,55,-117,55,-114,55,-111,55,-108,55,-105,55,-102,55,-99,55,-96,55,-93,55,-90,55,-87,55,-84,55,-78,55,-75,55,-72,55,-69,55,-66,55,-63,55,-60,55,-3,55,9,55,12,55,21,55,24,55,27,55,30,55,33,55,36,55,39,55,42,55,45,55,48,55,51,55,54,55,57,55,60,55,63,55,66,55,69,55,72,55,75,55,78,55,81,55,84,55,87,55,90,55,93,55,96,55,99,55,102,55,105,55,108,55,111,55,114,55,117,55,120,55,123,55,126,55,129,55,132,55,135,55,156,55,159,55,-156,58,-132,58,-129,58,-126,58,-123,58,-120,58,-117,58,-114,58,-111,58,-108,58,-105,58,-102,58,-99,58,-96,58,-93,58,-75,58,-72,58,-69,58,-66,58,-63,58,12,58,15,58,27,58,30,58,33,58,36,58,39,58,42,58,45,58,48,58,51,58,54,58,57,58,60,58,63,58,66,58,69,58,72,58,75,58,78,58,81,58,84,58,87,58,90,58,93,58,96,58,99,58,102,58,105,58,108,58,111,58,114,58,117,58,120,58,123,58,126,58,129,58,132,58,135,58,138,58,159,58,162,58,-165,61,-162,61,-159,61,-156,61,-153,61,-150,61,-147,61,-144,61,-141,61,-138,61,-135,61,-132,61,-129,61,-126,61,-123,61,-120,61,-117,61,-114,61,-111,61,-108,61,-105,61,-102,61,-99,61,-96,61,-75,61,-72,61,-48,61,-45,61,6,61,9,61,12,61,15,61,24,61,27,61,30,61,33,61,36,61,39,61,42,61,45,61,48,61,51,61,54,61,57,61,60,61,63,61,66,61,69,61,72,61,75,61,78,61,81,61,84,61,87,61,90,61,93,61,96,61,99,61,102,61,105,61,108,61,111,61,114,61,117,61,120,61,123,61,126,61,129,61,132,61,135,61,138,61,141,61,144,61,147,61,150,61,153,61,156,61,165,61,168,61,171,61,-159,64,-156,64,-153,64,-150,64,-147,64,-144,64,-141,64,-138,64,-135,64,-132,64,-129,64,-126,64,-123,64,-120,64,-117,64,-114,64,-111,64,-108,64,-105,64,-102,64,-99,64,-96,64,-93,64,-90,64,-84,64,-81,64,-72,64,-69,64,-66,64,-51,64,-48,64,-45,64,-42,64,-21,64,-18,64,12,64,15,64,18,64,24,64,27,64,30,64,33,64,36,64,39,64,42,64,45,64,48,64,51,64,54,64,57,64,60,64,63,64,66,64,69,64,72,64,75,64,78,64,81,64,84,64,87,64,90,64,93,64,96,64,99,64,102,64,105,64,108,64,111,64,114,64,117,64,120,64,123,64,126,64,129,64,132,64,135,64,138,64,141,64,144,64,147,64,150,64,153,64,156,64,159,64,162,64,165,64,168,64,171,64,174,64,177,64,-180,67,-177,67,-174,67,-162,67,-159,67,-156,67,-153,67,-150,67,-147,67,-144,67,-141,67,-138,67,-135,67,-132,67,-129,67,-126,67,-123,67,-120,67,-117,67,-114,67,-111,67,-108,67,-105,67,-102,67,-99,67,-96,67,-93,67,-90,67,-87,67,-84,67,-72,67,-69,67,-66,67,-51,67,-48,67,-45,67,-42,67,-39,67,-36,67,15,67,18,67,21,67,24,67,27,67,30,67,33,67,36,67,39,67,45,67,48,67,51,67,54,67,57,67,60,67,63,67,66,67,69,67,72,67,75,67,78,67,81,67,84,67,87,67,90,67,93,67,96,67,99,67,102,67,105,67,108,67,111,67,114,67,117,67,120,67,123,67,126,67,129,67,132,67,135,67,138,67,141,67,144,67,147,67,150,67,153,67,156,67,159,67,162,67,165,67,168,67,171,67,174,67,177,67,-162,70,-159,70,-156,70,-153,70,-150,70,-147,70,-144,70,-117,70,-114,70,-111,70,-108,70,-105,70,-102,70,-96,70,-93,70,-84,70,-81,70,-78,70,-75,70,-72,70,-69,70,-54,70,-51,70,-48,70,-45,70,-42,70,-39,70,-36,70,-33,70,-30,70,-27,70,-24,70,21,70,24,70,27,70,30,70,69,70,72,70,75,70,78,70,81,70,84,70,87,70,90,70,93,70,96,70,99,70,102,70,105,70,108,70,111,70,114,70,117,70,120,70,123,70,126,70,129,70,132,70,135,70,138,70,141,70,144,70,147,70,150,70,153,70,156,70,159,70,171,70,-123,73,-120,73,-108,73,-99,73,-96,73,-93,73,-87,73,-84,73,-78,73,-54,73,-51,73,-48,73,-45,73,-42,73,-39,73,-36,73,-33,73,-30,73,-27,73,-24,73,54,73,81,73,84,73,87,73,90,73,93,73,96,73,99,73,102,73,105,73,108,73,111,73,114,73,117,73,120,73,126,73,-114,76,-108,76,-102,76,-99,76,-93,76,-60,76,-57,76,-54,76,-51,76,-48,76,-45,76,-42,76,-39,76,-36,76,-33,76,-30,76,-27,76,-24,76,-21,76,60,76,63,76,66,76,96,76,99,76,102,76,105,76,108,76,111,76,138,76,141,76,-105,79,-93,79,-90,79,-84,79,-81,79,-78,79,-66,79,-63,79,-60,79,-57,79,-54,79,-51,79,-48,79,-45,79,-42,79,-39,79,-36,79,-33,79,-30,79,-27,79,-24,79,-21,79,12,79,15,79,18,79,21,79,96,79,99,79,102,79,-90,82,-87,82,-84,82,-81,82,-78,82,-75,82,-72,82,-69,82,-66,82,-60,82,-57,82,-54,82,-51,82,-48,82,-45,82,-42,82,-39,82,-36,82,-33,82,-30,82,-27,82]';

      // Country centroids (ISO alpha-2 → [lon,lat], Natural Earth 110m) for the finale reach globe.
      const CENTJSON = '{"AF":[66.1,33.9],"AO":[17.5,-12.3],"AL":[20,41.1],"AE":[54.2,23.9],"AR":[-65.1,-35.2],"AM":[45,40.2],"AQ":[21.3,-80.5],"TF":[69.5,-49.3],"AU":[134.4,-25.6],"AT":[14.1,47.6],"AZ":[47.7,40.3],"BI":[29.9,-3.4],"BE":[4.6,50.7],"BJ":[2.3,9.6],"BF":[-1.8,12.3],"BD":[90.3,23.8],"BG":[25.2,42.8],"BS":[-77.9,24.5],"BA":[17.8,44.2],"BY":[28,53.5],"BZ":[-88.7,17.2],"BO":[-64.6,-16.7],"BR":[-53.1,-10.8],"BN":[114.9,4.7],"BT":[90.5,27.4],"BW":[23.8,-22.1],"CF":[20.4,6.5],"CA":[-101.6,57.7],"CH":[8.1,46.8],"CL":[-71.7,-37.3],"CN":[103.9,36.6],"CI":[-5.6,7.6],"CM":[12.6,5.7],"CD":[23.6,-2.9],"CG":[15.1,-0.8],"CO":[-73.1,3.9],"CR":[-84.2,10],"CU":[-79,21.6],"CY":[33,34.9],"CZ":[15.3,49.8],"DE":[10.3,51.1],"DJ":[42.5,11.8],"DK":[9.3,56.2],"DO":[-70.5,18.9],"DZ":[2.6,28.2],"EC":[-78.4,-1.5],"EG":[29.8,26.5],"ER":[38.7,15.4],"ES":[-3.6,40.3],"EE":[25.8,58.6],"ET":[39.6,8.7],"FI":[26.2,64.5],"FJ":[178,-17.8],"FK":[-59.4,-51.7],"FR":[2.3,46.6],"GA":[11.7,-0.6],"GB":[-2.7,53.9],"GE":[43.5,42.2],"GH":[-1.2,7.9],"GN":[-11.1,10.4],"GM":[-15.4,13.5],"GW":[-15.1,12],"GQ":[10.4,1.6],"GR":[22.6,39.3],"GL":[-41.5,74.8],"GT":[-90.4,15.7],"GY":[-59,4.8],"HN":[-86.6,14.8],"HR":[16.6,45],"HT":[-72.7,18.9],"HU":[19.4,47.2],"ID":[114,-0.3],"IN":[79.6,22.9],"IE":[-8,53.2],"IR":[54.3,32.5],"IQ":[43.8,33],"IS":[-18.8,65.1],"IL":[35,31.5],"IT":[12.2,43.5],"JM":[-77.3,18.1],"JO":[36.8,31.2],"JP":[136.9,36],"KZ":[67.3,48.2],"KE":[37.8,0.6],"KG":[74.6,41.5],"KH":[104.9,12.7],"KR":[127.8,36.4],"XK":[20.9,42.6],"KW":[47.6,29.3],"LA":[103.8,18.4],"LB":[35.9,33.9],"LR":[-9.4,6.4],"LY":[18,27],"LK":[80.7,7.7],"LS":[28.2,-29.6],"LT":[23.9,55.3],"LU":[6,49.8],"LV":[24.8,56.8],"MA":[-8.4,29.9],"MD":[28.4,47.2],"MG":[46.7,-19.4],"MX":[-102.6,23.9],"MK":[21.7,41.6],"ML":[-3.5,17.3],"MM":[96.5,21],"ME":[19.3,42.8],"MN":[102.9,46.8],"MZ":[35.5,-17.2],"MR":[-10.3,20.2],"MW":[34.2,-13.2],"MY":[114.7,3.5],"NA":[17.2,-22.1],"NC":[165.5,-21.3],"NE":[9.3,17.3],"NG":[8,9.5],"NI":[-85,12.8],"NL":[5.5,52.3],"NO":[14.2,64.5],"NP":[84,28.2],"NZ":[170.5,-44],"OM":[56.1,20.6],"PK":[69.4,30],"PA":[-80.1,8.5],"PE":[-74.4,-9.2],"PH":[121.5,15.8],"PG":[144.3,-6.6],"PL":[19.3,52.1],"PR":[-66.5,18.2],"KP":[127.2,40.1],"PT":[-8.1,39.6],"PY":[-58.4,-23.2],"PS":[35.3,31.9],"QA":[51.2,25.3],"RO":[24.9,45.9],"RU":[99.2,61.7],"RW":[29.9,-2],"EH":[-12.1,24.3],"SA":[44.5,24.1],"SD":[29.9,16],"SS":[30.2,7.3],"SN":[-14.5,14.4],"SB":[159.1,-7.9],"SL":[-11.8,8.5],"SV":[-88.9,13.7],"SO":[45.7,4.8],"RS":[20.8,44.2],"SR":[-55.9,4.1],"SK":[19.5,48.7],"SI":[14.9,46.1],"SE":[16.6,62.8],"SZ":[31.4,-26.5],"SY":[38.5,35],"TD":[18.6,15.3],"TG":[1,8.4],"TH":[101,15],"TJ":[71,38.6],"TM":[59.3,39.1],"TL":[126,-8.8],"TT":[-61.3,10.4],"TN":[9.5,34.2],"TR":[35.4,39],"TW":[121,23.7],"TZ":[34.8,-6.3],"UG":[32.4,1.3],"UA":[31.2,49.1],"UY":[-56,-32.8],"US":[-99.1,39.5],"UZ":[63.2,41.7],"VE":[-66.2,7.2],"VN":[106.3,16.7],"VU":[166.9,-15.2],"YE":[47.5,15.9],"ZA":[25.1,-29],"ZM":[27.7,-13.4],"ZW":[29.8,-18.9]}';

      return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<title>SURGhub — Impact Showcase</title>'
        + '<script src="https://www.gstatic.com/charts/loader.js"><\/script>'
        + '<style>' + CSS + '</style></head><body>'
        + body
        + '<script>var D = ' + json + ';var LAND = ' + LANDJSON + ';var CENTROIDS = ' + CENTJSON + ';(' + PAGE.toString() + ')();<\/script>'
        + '</body></html>';
    }
  };

  ROOT.ImpactShowcase = ImpactShowcase;
})();
