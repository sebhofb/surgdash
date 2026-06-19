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
        { fl: '🇧🇩', country: 'Bangladesh', city: 'Comilla', name: 'Dr Sourov Das', role: 'Surgical trainee', init: 'SD', grad: 'linear-gradient(135deg,#2f86c9,#1f9c63)', img: SI.bangladesh, url: 'https://www.surghub.org/blog/impact-stories-dr-sourov-das-surgical-training-bangladesh',
          sum: 'A general-surgery trainee at Comilla Medical College Hospital, Dr Das used SURGhub’s burn-care courses to supplement his training — then drew on them to confidently treat a young girl with severe thermal injuries.' },
        { fl: '🇨🇩', country: 'DR Congo', city: 'Bukavu', name: 'William Baraka', role: 'Anaesthesia & critical care', init: 'WB', grad: 'linear-gradient(135deg,#9b8cff,#2f86c9)', img: SI.drc, url: 'https://www.surghub.org/blog/impact-stories-william-baraka-congo',
          sum: 'After losing his sister to a preventable anaesthesia complication, William turned that loss into a mission. In conflict-affected eastern DRC he draws on SURGhub’s perioperative resources to strengthen patient safety and train colleagues across Francophone Africa.' },
        { fl: '🇪🇬', country: 'Egypt', city: 'Giza', name: 'Dr Sanderene Abdelnor', role: 'Reconstructive surgery', init: 'SA', grad: 'linear-gradient(135deg,#f5b301,#e57373)', img: SI.egypt, url: 'https://www.surghub.org/blog/impact-stories-dr-sanderene-abdelnor-reconstructive-surgery-egypt',
          sum: 'A plastic & reconstructive surgeon in a high-volume Giza hospital, Dr Abdelnor used SURGhub’s guidance to introduce structured distraction techniques while treating a child with burn trauma — reshaping how she supports patients through recovery.' },
        { fl: '🇮🇳', country: 'India', city: 'Belagavi', name: 'Dr Shubhangi Patil', role: 'Surgeon & mentor', init: 'SP', grad: 'linear-gradient(135deg,#3FB984,#2f86c9)', img: SI.india, url: 'https://www.surghub.org/blog/impact-stories-dr-shubhangi-patil-surgical-art-belagavi',
          sum: 'An experienced surgeon who calls her craft “a work of art,” Dr Patil uses SURGhub to keep her skills current and to reach globally recognised surgical standards — and to mentor the next generation of surgeons in smaller towns.' },
        { fl: '🇰🇪', country: 'Kenya', city: 'Nakuru', name: 'Dennis Nyang’au', role: 'Emergency & critical care', init: 'DN', grad: 'linear-gradient(135deg,#2f86c9,#1f9c63)', img: SI.kenya, url: 'https://www.surghub.org/blog/impact-stories-dennis-nyangau-kenya',
          sum: 'A Kenya Red Cross emergency responder, Dennis completed SURGhub’s Essential Emergency & Critical Care course — then used it to stabilise a hit-and-run victim in the field, proving the principles work well beyond the hospital.' },
        { fl: '🇸🇱', country: 'Sierra Leone', city: 'Freetown', name: 'Dr Sheku Massaquoi', role: 'General surgeon', init: 'SM', grad: 'linear-gradient(135deg,#9b8cff,#3FB984)', img: SI.sierraleone, url: 'https://www.surghub.org/blog/impact-stories-dr-sheku-dennis-massaquoi-resilient-care',
          sum: 'A general surgeon at 34 Military Hospital in Freetown, Dr Massaquoi sets aside 90 minutes each morning to learn on SURGhub — training that directly shaped a palliative mastectomy he performed under regional anaesthesia for a patient unfit for general anaesthesia.' }
      ];
      const geoStops = '<div class="groute">' + STORIES.map(function (s) {
        return '<article class="gstop rv">'
          + '<div class="gstop-media" style="background:' + s.grad + '">' + (s.img ? '<img src="' + esc(s.img) + '" alt="' + esc(s.name) + ' — ' + esc(s.country) + '" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '') + '<span class="gstop-init">' + s.init + '</span></div>'
          + '<div class="gstop-text">'
            + '<div class="gstop-loc"><span class="gstop-flag">' + s.fl + '</span>' + esc(s.country) + (s.city ? ' · ' + esc(s.city) : '') + '</div>'
            + '<h3 class="gstop-nm">' + esc(s.name) + '</h3>'
            + '<div class="gstop-role">' + esc(s.role) + '</div>'
            + '<p class="gstop-sum">' + esc(s.sum) + '</p>'
            + '<a class="gstop-go" href="' + esc(s.url) + '" target="_blank" rel="noopener">Read the full story →</a>'
          + '</div></article>';
      }).join('') + '</div>';
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

        + sec('faces', 'On the ground', 'darker', '<h2 class="rv">The people behind the map.</h2><p class="lead rv d1" style="margin-bottom:8px">Behind every point on that map is a clinician putting new skills to work. A few of their stories — from Bangladesh to Sierra Leone.</p>' + geoStops + '<p class="muted rv" style="margin-top:30px">More learner stories on the <a href="https://www.surghub.org/blog" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">SURGhub blog</a>.</p>')

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
        + '.groute{display:flex;flex-direction:column;gap:54px;margin-top:42px}.gstop{display:grid;grid-template-columns:1.05fr .95fr;gap:40px;align-items:center}.gstop:nth-child(even) .gstop-media{order:2}@media(max-width:760px){.gstop{grid-template-columns:1fr;gap:18px}.gstop:nth-child(even) .gstop-media{order:0}}'
        + '.gstop-media{position:relative;aspect-ratio:16/9;border-radius:18px;overflow:hidden;display:flex;align-items:center;justify-content:center;box-shadow:0 22px 52px rgba(0,0,0,.4)}.gstop-media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:transform .5s cubic-bezier(.2,.7,.2,1)}.gstop:hover .gstop-media img{transform:scale(1.04)}.gstop-init{font-size:54px;font-weight:800;color:rgba(255,255,255,.9);letter-spacing:.02em}'
        + '.gstop-loc{display:flex;align-items:center;gap:9px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--boston-soft);font-weight:700}.gstop-flag{font-size:21px;line-height:1}.gstop-nm{font-size:clamp(22px,2.6vw,29px);font-weight:700;color:#eaf2f8;margin:11px 0 2px;letter-spacing:-.01em}.gstop-role{font-size:14px;color:#9fc1dc;font-weight:600;margin-bottom:13px}.gstop-sum{font-size:16px;line-height:1.62;color:#b9cede;margin:0 0 16px;max-width:54ch}.gstop-go{font-size:14px;font-weight:700;color:var(--boston-soft);text-decoration:none}.gstop:hover .gstop-go{color:#fff}'
        + '@media(prefers-reduced-motion:reduce){.rv{transition:none;opacity:1;transform:none}.fill{transition:none}.cue{animation:none}.kin .w{opacity:1;transform:none;transition:none}.aurora{animation:none}.num.pop{animation:none}.stars .on{transition:none}.quote.rv{transform:none}}';

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
