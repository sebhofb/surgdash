// === Physician-workforce reach ===
// What share of a country's physicians has a SURGhub account?
//
// The version this replaces lived inside the Geography analysis and had four
// problems that all pushed the number the same way — up:
//
//  1. It classified doctors from the CANONICAL cadre, where Taxonomy collapses
//     'Anaesthesiologist', 'Anaesthesia technician' and 'Nurse anaesthetist' into one
//     'Anaesthesia' bucket and counted all three as physicians. The signup survey asks
//     these as three separate options — 1,799 / 838 / 527 responses — so 43% of that
//     bucket are non-physician anaesthesia providers, concentrated in exactly the
//     LMICs where task-sharing is the norm. This module classifies from the RAW tag
//     instead, so nurse anaesthetists and technicians never enter a physician count.
//  2. It multiplied every country's doctors by one global factor
//     (totalUsers / users-who-declared-a-profession), although the per-country
//     declaration rate ranges from about 67% to 97%. That systematically over-counts
//     low-declaration countries and under-counts high-declaration ones. Extrapolation
//     is now off by default, and when on it uses each country's OWN rate.
//  3. It counted anyone with an account. Most have never earned a certificate, so the
//     headline was an upper bound presented as a fact. There is now a certified-only
//     view, which needs no assumptions at all.
//  4. It skipped countries whose name failed to resolve, silently. They are now
//     reported on screen.
//
// Denominator: World Bank 'Physicians (per 1,000 people)' x population
// (window.HEALTH_WORKFORCE). Its vintage varies by country, so every row carries its
// year and rows 5+ years old are flagged rather than quietly averaged in.

Object.assign(window.App, {

    // Raw signup-survey tags, not canonical cadres — the canonical map is lossy here.
    PHYS_TAGS: {
        physician: ['doctor', 'surgeon', 'anesthesiology', 'anaesthesiologist', 'emergency-doctor',
                    'obstetrician', 'gynaecologist'],
        // Offered separately from 'Non-physician clinician / clinical officer' in the
        // survey, so a respondent choosing it is telling us they are a doctor.
        medicalOfficer: ['medical-officer'],
        // Doctors in training. The World Bank series counts practising doctors including
        // those in postgraduate training, so this is defensible to include — but it is a
        // choice, so it is a switch rather than a silent default.
        trainee: ['resident'],
        // Never physicians. Named explicitly so the exclusion is auditable.
        excluded: ['nurse-anaesthetist', 'anaesthesia-technician', 'medical-technician',
                   'clinical-officer', 'nurse', 'nursing', 'non-clinical'],
    },

    // Two denominators, in preference order. WHO publishes the headcount directly, so
    // no density x population arithmetic is needed — that arithmetic used to pair a
    // stale density year with a 2024 population. The World Bank series is sourced from
    // the same WHO NHWA reporting, so the fallback is a vintage difference, not a
    // definitional one.
    PHYS_SOURCES: {
        who: {
            key: 'who',
            short: 'WHO',
            label: 'WHO Global Health Observatory — Medical doctors (number), HWF_0002',
            url: 'https://www.who.int/data/gho/data/indicators/indicator-details/GHO/medical-doctors-(number)',
            densityUrl: 'https://www.who.int/data/gho/data/indicators/indicator-details/GHO/medical-doctors-(per-10-000-population)',
            portalUrl: 'https://apps.who.int/nhwaportal/',
            note: 'Headcount as reported by countries through the WHO NHWA portal (December 2025 update). Used wherever available.',
        },
        wb: {
            key: 'wb',
            short: 'World Bank',
            label: 'World Bank — Physicians (per 1,000 people), SH.MED.PHYS.ZS',
            url: 'https://data.worldbank.org/indicator/SH.MED.PHYS.ZS',
            note: 'Density x population. Sourced from the same WHO NHWA reporting but on an older vintage — used only where WHO has no figure.',
        },
    },
    // Kept for older callers.
    get PHYS_SOURCE() { return this.PHYS_SOURCES.who; },

    // stage: which career stages belong in the numerator.
    //   'practising'  — "In practice" only. What the WHO/World Bank series counts, and the
    //                   default: their denominator is practising doctors, so students,
    //                   retirees and academics do not belong in the numerator.
    //   'plusTraining' — adds doctors in postgraduate clinical training, who most national
    //                   reporting does include as practising practitioners.
    //   'all'         — everyone with a doctor profession, whatever their stage. What this
    //                   tab used to do, kept so the old figures are reproducible.
    _physOpts() {
        return Object.assign({ scope: 'liclmic', basis: 'declared', stage: 'practising', medOfficer: true },
            this._physReachOpts || {});
    },

    PHYS_STAGES: {
        practising:   { label: 'In practice', stages: ['In practice'],
                        note: 'Matches the source: WHO counts practising doctors.' },
        plusTraining: { label: '+ in training', stages: ['In practice', 'Postgraduate clinical'],
                        note: 'Adds postgraduate clinical trainees, whom most national reporting counts as practitioners.' },
        all:          { label: 'Any stage', stages: null,
                        note: 'Everyone with a doctor profession, including undergraduates and the retired — not comparable with the denominator.' },
    },

    _physStageOk(stage, opts) {
        const spec = this.PHYS_STAGES[opts.stage] || this.PHYS_STAGES.practising;
        if (!spec.stages) return true;
        return spec.stages.indexOf(String(stage || '').trim()) >= 0;
    },
    setPhysOpt(k, v) {
        const o = this._physOpts();
        o[k] = (v === 'true') ? true : (v === 'false') ? false : v;
        this._physReachOpts = o;
        this.renderView();
    },

    _physIsCounted(rawTag, opts) {
        const t = String(rawTag || '').trim().toLowerCase();
        if (!t) return false;
        const P = this.PHYS_TAGS;
        if (P.excluded.includes(t)) return false;
        if (P.physician.includes(t)) return true;
        if (opts.medOfficer && P.medicalOfficer.includes(t)) return true;
        // A 'resident' profession tag is a doctor in training — governed by the stage
        // control, not a separate switch, so the two cannot disagree.
        if (P.trainee.includes(t)) return opts.stage !== 'practising';
        return false;
    },

    // Resolve one country's physician denominator: WHO headcount if it has one,
    // otherwise the World Bank density x population. Returns null when neither does,
    // so the caller can report the country rather than drop it silently.
    _physDenominator(iso) {
        const WF = window.HEALTH_WORKFORCE, WHO = window.WHO_WORKFORCE;
        const wf = WF && WF[iso];
        if (!wf) return null;                       // no income group / population either
        const w = WHO && WHO[iso];
        const reg = w ? w.region : null;
        const regName = w ? w.regionName : null;
        if (w && w.physicians) {
            return { source: 'who', wf, physicians: w.physicians, year: w.physiciansYear,
                     per1000: w.per1000 != null ? w.per1000 : wf.physPer1000, region: reg, regionName: regName };
        }
        if (wf.physicians) {
            return { source: 'wb', wf, physicians: wf.physicians, year: wf.physYear, per1000: wf.physPer1000,
                     region: reg, regionName: regName };
        }
        return null;
    },

    // Per-country physician reach. Everything the tab needs, computed once.
    physicianReach() {
        const anon = this._rawAnonymizedUsers;
        const WF = window.HEALTH_WORKFORCE;
        const toISO = window.countryToISO;
        if (!Array.isArray(anon) || !anon.length || !WF || !toISO) return null;
        const opts = this._physOpts();

        // Per country: everyone, everyone who declared a profession, physicians, and
        // physicians holding at least one certificate.
        const per = {};
        anon.forEach(r => {
            if (!r || !r.country || !r.user_uid) return;
            const p = per[r.country] || (per[r.country] = { all: new Set(), declared: new Set(), phys: new Set(), certPhys: new Set() });
            p.all.add(r.user_uid);
            if (r.profession) p.declared.add(r.user_uid);
            if (this._physIsCounted(r.profession, opts) && this._physStageOk(r.career_stage, opts)) {
                p.phys.add(r.user_uid);
                if (String(r.has_certificate) === 'Yes') p.certPhys.add(r.user_uid);
            }
        });

        const rows = [], unresolved = [], noDenominator = [];
        Object.entries(per).forEach(([country, p]) => {
            const declaredPhys = p.phys.size;
            if (!declaredPhys) return;
            const iso = toISO(country);
            if (!iso) { unresolved.push({ country, n: declaredPhys }); return; }
            const den = this._physDenominator(iso);
            if (!den) { noDenominator.push({ country, n: declaredPhys }); return; }
            const wf = den.wf;
            // Each country's OWN declaration rate, not one global factor.
            const rate = p.all.size ? p.declared.size / p.all.size : 1;
            const estimated = rate > 0 ? Math.round(declaredPhys / rate) : declaredPhys;
            const certified = p.certPhys.size;
            const count = opts.basis === 'certified' ? certified : (opts.basis === 'estimated' ? estimated : declaredPhys);
            rows.push({
                country, iso, income: wf.income, physicians: den.physicians,
                per1000: den.per1000, year: den.year, population: wf.population,
                source: den.source, sourceShort: this.PHYS_SOURCES[den.source].short,
                region: den.region, regionName: den.regionName,
                wbPhysicians: wf.physicians, wbYear: wf.physYear,
                declared: declaredPhys, estimated, certified, count,
                declRate: rate * 100,
                stale: (2026 - den.year) >= 5,
                reach: den.physicians ? (count / den.physicians) * 100 : 0,
                certRate: declaredPhys ? (certified / declaredPhys) * 100 : 0,
                per100k: wf.population ? (declaredPhys / wf.population) * 100000 : 0,
            });
        });

        const inScope = (r) => opts.scope === 'all' || r.income === 'LIC' || r.income === 'LMIC';
        const scoped = rows.filter(inScope).sort((a, b) => b.reach - a.reach);
        const tot = (f) => scoped.reduce((s, r) => s + f(r), 0);
        const totPhys = tot(r => r.physicians), totCount = tot(r => r.count);

        // Income bands and physician-density bands, on the same basis as the table.
        const band = (list) => {
            const d = list.reduce((s, r) => s + r.count, 0), p = list.reduce((s, r) => s + r.physicians, 0);
            return { n: list.length, count: d, physicians: p, reach: p ? d / p * 100 : 0, oneIn: d ? Math.round(p / d) : null };
        };
        const byIncome = {};
        ['LIC', 'LMIC', 'UMIC', 'HIC'].forEach(k => { byIncome[k] = band(rows.filter(r => r.income === k)); });

        // WHO region — the reporting unit a UN hub's funders actually use. Comes straight
        // off ParentLocationCode in the WHO records, so there is no extra mapping to drift.
        const REG = window.WHO_REGIONS || {};
        const byRegion = Object.keys(REG)
            .map(code => Object.assign({ code, name: REG[code] }, band(scoped.filter(r => r.region === code))))
            .filter(b => b.n).sort((a, b) => b.count - a.count);

        // Overlap with the conflict list, so the two tabs can be read together.
        let conflict = null;
        if (Array.isArray(this.CONFLICT_DEFAULT)) {
            const iso3s = new Set(this.CONFLICT_DEFAULT.map(c => c.iso3).filter(Boolean));
            const list = rows.filter(r => { const w = (window.WHO_WORKFORCE || {})[r.iso]; return w && iso3s.has(w.iso3); });
            if (list.length) conflict = Object.assign({ countries: list.length, total: iso3s.size }, band(list));
        }
        const DENSITY_BANDS = [
            { label: 'Under 0.2', test: (r) => r.per1000 < 0.2 },
            { label: '0.2 – 0.5', test: (r) => r.per1000 >= 0.2 && r.per1000 < 0.5 },
            { label: '0.5 – 1.0', test: (r) => r.per1000 >= 0.5 && r.per1000 < 1 },
            { label: '1.0 and above', test: (r) => r.per1000 >= 1 },
        ].map(b => Object.assign({ label: b.label }, band(scoped.filter(b.test))));

        // Countries with a physician workforce and little or no SURGhub presence.
        const present = new Set(rows.map(r => r.country));
        const missing = [];
        Object.entries(WF).forEach(([iso, wf]) => {
            if (!wf.physicians || wf.physicians < 500) return;
            if (opts.scope !== 'all' && wf.income !== 'LIC' && wf.income !== 'LMIC') return;
            const hit = rows.find(r => r.iso === iso);
            if (!hit) missing.push({ country: wf.name, income: wf.income, physicians: wf.physicians, per1000: wf.physPer1000, declared: 0, reach: 0 });
            else if (hit.reach < 0.25) missing.push({ country: hit.country, income: hit.income, physicians: hit.physicians, per1000: hit.per1000, declared: hit.declared, reach: hit.reach });
        });
        missing.sort((a, b) => b.physicians - a.physicians);

        return {
            rows: scoped, allRows: rows, opts, byIncome, byRegion, conflict, densityBands: DENSITY_BANDS, missing,
            unresolved: unresolved.sort((a, b) => b.n - a.n), noDenominator,
            totals: {
                countries: scoped.length, physicians: totPhys, count: totCount,
                declared: tot(r => r.declared), estimated: tot(r => r.estimated), certified: tot(r => r.certified),
                reach: totPhys ? totCount / totPhys * 100 : 0,
                oneIn: totCount ? Math.round(totPhys / totCount) : null,
                oneInCertified: tot(r => r.certified) ? Math.round(totPhys / tot(r => r.certified)) : null,
                oneInDeclared: tot(r => r.declared) ? Math.round(totPhys / tot(r => r.declared)) : null,
                stale: scoped.filter(r => r.stale).length,
                fromWho: scoped.filter(r => r.source === 'who').length,
                fromWb: scoped.filter(r => r.source === 'wb').length,
                whoPhysicians: scoped.filter(r => r.source === 'who').reduce((s2, r) => s2 + r.physicians, 0),
                lostDeclared: unresolved.reduce((s, r) => s + r.n, 0) + noDenominator.reduce((s, r) => s + r.n, 0),
            },
        };
    },

    // Doctor-cadre signups over time, and their share of all signups. Uses the
    // audience ActivityTimeline, which is already extrapolated to the full base.
    physicianGrowth(audSnap) {
        if (!audSnap || !audSnap.ActivityTimeline) return null;
        let tl; try { tl = typeof audSnap.ActivityTimeline === 'string' ? JSON.parse(audSnap.ActivityTimeline) : audSnap.ActivityTimeline; } catch (e) { return null; }
        const opts = this._physOpts();
        const canon = (window.Taxonomy && window.Taxonomy.canonProf) ? window.Taxonomy.canonProf : null;
        // ActivityTimeline is keyed by display label, so map back through canonProf:
        // a label counts if its canonical cadre is one a raw physician tag maps to.
        const physCadres = new Set(this.PHYS_TAGS.physician.concat(opts.medOfficer ? this.PHYS_TAGS.medicalOfficer : [],
            opts.stage !== 'practising' ? this.PHYS_TAGS.trainee : []).map(t => canon ? canon(t) : t).filter(Boolean));
        const months = Object.keys(tl).filter(m => /^\d{4}-\d{2}$/.test(m)).sort();
        if (!months.length) return null;
        const now = new Date();
        const nowM = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        const out = months.filter(m => m < nowM).map(m => {
            let phys = 0, all = 0;
            Object.entries(tl[m] || {}).forEach(([label, n]) => {
                const v = Number(n) || 0; all += v;
                const c = canon ? canon(label) : label;
                if (c && physCadres.has(c)) phys += v;
            });
            return { m, phys, all, share: all ? phys / all * 100 : 0 };
        });
        return out.length ? out : null;
    },
});

// ── Dashboard › Physician-workforce reach ────────────────────────────────────
Object.assign(window.App, {
    // Which of the three bases the top-10 chart draws. All on by default so the
    // spread between "certified" and "estimated" is visible without clicking.
    _physSeries() {
        return Object.assign({ certified: true, declared: true, estimated: true }, this._physSeriesOn || {});
    },
    togglePhysSeries(key) {
        const s = this._physSeries();
        // Never leave the chart empty — the last remaining series stays on.
        if (s[key] && Object.values(s).filter(Boolean).length === 1) return;
        s[key] = !s[key];
        this._physSeriesOn = s;
        this.renderView();
    },

    _sortPhysTable(col) {
        const cur = this._physSort || { col: 'reach', dir: 'desc' };
        this._physSort = (cur.col === col) ? { col, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
            : { col, dir: col === 'country' ? 'asc' : 'desc' };
        this.renderView();
    },

    _dashPhysicianHtml(snapData, audSnap) {
        if (this._rawAnonymizedUsers == null && this.ensureAnonLoaded) {
            this.ensureAnonLoaded().then(() => { if (this.view === 'platform' && this._dashTab === 'physicians') this.renderView(); });
            return '<div class="bg-white p-12 text-center text-slate-400 italic rounded-xl border">Loading learner records…</div>';
        }
        const R = this.physicianReach();
        this._lastPhysReach = R;   // the chart drawer reuses this rather than re-aggregating 96k rows
        if (!R) return '<div class="bg-white p-12 text-center text-slate-500 italic rounded-xl border">No learner data yet — run <strong>Sync Learners</strong> on the Data Sync page.</div>';
        const o = R.opts, T = R.totals;
        const esc = (t) => this.escapeHtml(t);
        const fmt = (n) => this.formatNumber(Math.round(n || 0));
        const W = this.PHYS_SOURCES.who, B = this.PHYS_SOURCES.wb;

        const seg = (key, val, label, title) => `<button onclick="App.setPhysOpt('${key}','${val}')" title="${esc(title || '')}"
            class="px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${String(o[key]) === String(val) ? 'bg-gsf-boston text-white' : 'text-slate-500 hover:bg-slate-100'}">${label}</button>`;

        const controls = `
            <div class="flex flex-wrap items-center gap-3 mb-6">
                <div class="flex items-center gap-1 bg-white border rounded-lg p-0.5">${seg('scope', 'liclmic', 'LIC / LMIC')}${seg('scope', 'all', 'All incomes')}</div>
                <div class="flex items-center gap-1 bg-white border rounded-lg p-0.5">
                    ${seg('basis', 'certified', 'Certified', 'Physicians who have earned at least one certificate. No assumptions.')}
                    ${seg('basis', 'declared', 'Has an account', 'Physicians who registered and told us their profession. Counted, not modelled.')}
                    ${seg('basis', 'estimated', 'Estimated', 'Grossed up for physicians who never stated a profession, using the declaration rate of each country itself.')}
                </div>
                <div class="flex items-center gap-1 bg-white border rounded-lg p-0.5" title="Which career stages count. The WHO denominator is practising doctors.">
                    ${Object.entries(this.PHYS_STAGES).map(([k, v]) => seg('stage', k, v.label, v.note)).join('')}
                </div>
                <label class="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer bg-white border rounded-lg px-3 py-1.5">
                    <input type="checkbox" data-viewer-allowed ${o.medOfficer ? 'checked' : ''} onchange="App.setPhysOpt('medOfficer', this.checked ? 'true' : 'false')"> Include medical officers
                </label>
            </div>`;

        const basisWord = o.basis === 'certified' ? 'have completed and certified a SURGhub course'
            : o.basis === 'estimated' ? 'are estimated to have a SURGhub account' : 'have a SURGhub account';

        const headline = `
            <div class="bg-white rounded-xl border shadow-sm border-l-4 border-l-gsf-boston p-5 mb-6">
                <h2 class="text-xl font-black text-gsf-prussian mb-1">1 in ${T.oneIn || '—'} physicians ${basisWord}</h2>
                <p class="text-sm text-slate-600">Across ${T.countries} ${o.scope === 'all' ? 'countries' : 'low- and lower-middle-income countries'} with a published physician workforce — ${fmt(T.count)} of ${fmt(T.physicians)} physicians.</p>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                    ${[['Certified', T.certified, T.oneInCertified, 'Earned at least one certificate — no assumptions at all'],
                       ['Has an account', T.declared, T.oneInDeclared, 'Registered and told us they are a doctor — counted, not modelled'],
                       ['Estimated', T.estimated, T.estimated ? Math.round(T.physicians / T.estimated) : null, 'Grossed up for physicians who never stated a profession']]
                      .map(([l, v, one, why]) => `<div class="border rounded-lg p-3 ${(o.basis === 'certified' && l === 'Certified') || (o.basis === 'declared' && l === 'Has an account') || (o.basis === 'estimated' && l === 'Estimated') ? 'border-gsf-boston bg-sky-50/50' : 'border-slate-200'}" title="${esc(why)}">
                        <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">${l}</p>
                        <p class="text-lg font-black text-gsf-prussian leading-tight">${fmt(v)}</p>
                        <p class="text-[11px] text-slate-500">1 in ${one || '—'} physicians</p>
                      </div>`).join('')}
                </div>
                <p class="text-[11px] text-slate-400 mt-3">The three differ only in who counts. Quote the one whose assumption you are willing to defend — the left-hand figure needs none.</p>
                <p class="text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-100"><strong>Career stage: ${esc((this.PHYS_STAGES[o.stage] || {}).label || '')}.</strong> ${esc((this.PHYS_STAGES[o.stage] || {}).note || '')}${o.stage === 'practising' ? ' Undergraduates, academics and retired doctors are excluded because they are not in the denominator either.' : ''}</p>
            </div>`;

        const bandCard = (title, sub, list, keyFn) => `
            <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="p-4 border-b bg-slate-50"><h3 class="font-bold text-gsf-prussian">${title}</h3><p class="text-[11px] text-slate-500 mt-0.5">${sub}</p></div>
                <table class="w-full text-sm">
                    <tbody>${list.map(b => `<tr class="border-b border-slate-100 last:border-0">
                        <td class="py-2 px-4 font-semibold text-gsf-prussian">${esc(keyFn(b))}</td>
                        <td class="py-2 px-4 text-right text-slate-400 text-xs">${b.n} ${b.n === 1 ? 'country' : 'countries'}</td>
                        <td class="py-2 px-4 text-right text-slate-500">${fmt(b.count)}</td>
                        <td class="py-2 px-4 text-right font-bold text-gsf-prussian whitespace-nowrap">1 in ${b.oneIn || '—'}</td>
                    </tr>`).join('')}</tbody>
                </table>
            </div>`;

        const bands = `
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                ${bandCard('By income group', 'The mission test: is reach concentrated where it is needed?',
                    ['LIC', 'LMIC', 'UMIC', 'HIC'].map(k => Object.assign({ k }, R.byIncome[k])).filter(b => b.n),
                    (b) => ({ LIC: 'Low income', LMIC: 'Lower-middle', UMIC: 'Upper-middle', HIC: 'High income' })[b.k])}
                ${bandCard('By physician density', 'Physicians per 1,000 people in the country', R.densityBands.filter(b => b.n), (b) => b.label + ' / 1,000')}
            </div>
            ${R.byRegion && R.byRegion.length ? `
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                ${bandCard('By WHO region', 'The unit WHO and most funders report in', R.byRegion, (b) => b.name.replace(' Region', ''))}
                ${R.conflict ? `
                <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
                    <div class="p-4 border-b bg-slate-50"><h3 class="font-bold text-gsf-prussian">Conflict-affected countries</h3><p class="text-[11px] text-slate-500 mt-0.5">The ${R.conflict.total} on the World Bank FCV list — see the Conflict Settings tab</p></div>
                    <div class="p-4">
                        <p class="text-2xl font-black text-gsf-prussian leading-none">1 in ${R.conflict.oneIn || '—'}</p>
                        <p class="text-xs text-slate-500 mt-1">${fmt(R.conflict.count)} of ${fmt(R.conflict.physicians)} physicians across ${R.conflict.countries} of those countries, on the basis selected above.</p>
                        <p class="text-[11px] text-slate-400 mt-2">Compare with 1 in ${T.oneIn || '—'} across all ${T.countries} countries in scope.</p>
                        <button onclick="App._dashTab='conflict'; App.renderView()" class="mt-3 px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-600 hover:text-gsf-prussian hover:bg-slate-50">Open the Conflict tab &rarr;</button>
                    </div>
                </div>` : ''}
            </div>` : ''}
            <p class="text-[11px] text-slate-400 -mt-4 mb-6">A country with few physicians reaches a high percentage more easily — the right-hand table is a fact about ratios, not evidence of deliberate targeting. Learner counts themselves are essentially uncorrelated with physician density.</p>`;

        // ── main table
        const sort = this._physSort || { col: 'reach', dir: 'desc' };
        const sv = (r, c) => c === 'country' ? r.country.toLowerCase() : (c === 'income' ? r.income : (r[c] != null ? r[c] : -1));
        const sorted = R.rows.slice().sort((a, b) => {
            const x = sv(a, sort.col), y = sv(b, sort.col);
            const c = (typeof x === 'string') ? x.localeCompare(y) : (x - y);
            return sort.dir === 'asc' ? c : -c;
        });
        const th = (col, label, align, hint) => {
            const on = sort.col === col;
            return `<th class="py-2.5 px-3 text-${align} font-medium cursor-pointer select-none hover:text-gsf-prussian whitespace-nowrap ${on ? 'text-gsf-prussian' : ''}" onclick="App._sortPhysTable('${col}')" title="${esc(hint || label)}">${label}<span class="ml-1 text-[9px] ${on ? 'text-gsf-boston' : 'text-slate-300'}">${on ? (sort.dir === 'asc' ? '&#9650;' : '&#9660;') : '&#8645;'}</span></th>`;
        };
        const ser = this._physSeries();
        const serBtn = (k, label, colour) => `<button onclick="App.togglePhysSeries('${k}')"
            class="px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${ser[k] ? 'text-white' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'}"
            style="${ser[k] ? 'background:' + colour + ';border-color:' + colour : ''}">${label}</button>`;
        const chart = `
            <div class="bg-white p-6 rounded-xl shadow-sm border mb-6">
                <div class="flex items-start justify-between gap-3 flex-wrap mb-1">
                    <div>
                        <h3 class="text-lg font-bold text-gsf-prussian">Top 10 countries by physician reach</h3>
                        <p class="text-xs text-slate-500 mt-1">Ranked by the basis selected above (${o.basis === 'certified' ? 'certified' : o.basis === 'estimated' ? 'estimated' : 'has an account'}). Each bar shows all three so you can see the spread — click a chip to hide one.</p>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                        ${serBtn('certified', 'Certified', '#5B8C5A')}
                        ${serBtn('declared', 'Has an account', '#4389C8')}
                        ${serBtn('estimated', 'Estimated', '#B8860B')}
                    </div>
                </div>
                <div id="chart_phys_top10" style="width:100%;height:420px"></div>
            </div>`;

        const table = `
            <div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-6">
                <div class="p-5 border-b bg-slate-50 flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <h3 class="text-lg font-bold text-gsf-prussian">Country by country</h3>
                        <p class="text-xs text-slate-500 mt-1">${T.countries} countries. Reach uses the basis selected above; the certification rate is always of physicians who registered.</p>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                        <button onclick="App.exportPhysicianXlsx()" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-600 hover:text-gsf-prussian hover:bg-slate-50 inline-flex items-center gap-1.5"><i data-lucide="file-spreadsheet" width="13"></i> Excel</button>
                        <button onclick="App._copyEngagementSection('phys-tab', this, true)" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-600 hover:text-gsf-prussian hover:bg-slate-50 inline-flex items-center gap-1.5"><i data-lucide="copy" width="13"></i> PNG</button>
                    </div>
                </div>
                <div class="overflow-x-auto max-h-[560px] overflow-y-auto custom-scrollbar">
                    <table class="w-full text-sm">
                        <thead class="text-slate-500 border-b bg-white sticky top-0 z-10"><tr>
                            ${th('country', 'Country', 'left')}${th('income', 'Income', 'left')}
                            ${th('count', 'On SURGhub', 'right', 'Physicians counted on the selected basis')}
                            ${th('physicians', 'Physicians', 'right', 'World Bank density x population')}
                            ${th('reach', 'Reach', 'right')}${th('certRate', 'Cert rate', 'right', 'Share of registered physicians here with at least one certificate')}
                            ${th('per1000', 'Density', 'right', 'Physicians per 1,000 people')}${th('year', 'Data year', 'right')}${th('per100k', 'Per 100k pop', 'right', 'Physicians on SURGhub per 100,000 people \u2014 a check that does not use the workforce denominator at all')}${th('sourceShort', 'Source', 'left', 'Where this country\u2019s physician count comes from')}
                        </tr></thead>
                        <tbody>${sorted.map(r => `<tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                            <td class="py-2 px-3 font-medium text-gsf-prussian whitespace-nowrap">${esc(r.country)}</td>
                            <td class="py-2 px-3"><span class="text-[10px] font-bold text-slate-500">${r.income}</span></td>
                            <td class="py-2 px-3 text-right tabular-nums">${fmt(r.count)}</td>
                            <td class="py-2 px-3 text-right tabular-nums text-slate-500">${fmt(r.physicians)}</td>
                            <td class="py-2 px-3 text-right font-bold tabular-nums" style="color:${r.reach >= 5 ? '#3FB984' : '#4389C8'}">${r.reach >= 10 ? r.reach.toFixed(0) : r.reach.toFixed(r.reach < 1 ? 2 : 1)}%</td>
                            <td class="py-2 px-3 text-right tabular-nums text-slate-500">${r.declared ? r.certRate.toFixed(0) + '%' : '–'}</td>
                            <td class="py-2 px-3 text-right tabular-nums text-slate-400">${r.per1000}</td>
                            <td class="py-2 px-3 text-right tabular-nums ${r.stale ? 'text-amber-600 font-bold' : 'text-slate-400'}" ${r.stale ? 'title="5 or more years old — the density is applied to a 2024 population, so this row is the least reliable"' : ''}>${r.year}${r.stale ? ' ⚠' : ''}</td>
                            <td class="py-2 px-3 text-right tabular-nums text-slate-400" title="Independent of the physician denominator">${r.per100k.toFixed(2)}</td>
                            <td class="py-2 px-3 text-[10px] font-bold ${r.source === 'who' ? 'text-emerald-700' : 'text-amber-700'}" title="${r.source === 'who' ? 'WHO published headcount' : 'World Bank density x population — WHO has no figure for this country'}">${r.sourceShort}</td>
                        </tr>`).join('')}</tbody>
                    </table>
                </div>
            </div>`;

        const target = R.missing.length ? `
            <div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-6">
                <div class="p-5 border-b bg-slate-50">
                    <h3 class="text-lg font-bold text-gsf-prussian">Where SURGhub is not yet</h3>
                    <p class="text-xs text-slate-500 mt-1">Countries in scope with a physician workforce of 500+ and reach below 0.25% — the largest workforces SURGhub has barely touched.</p>
                </div>
                <div class="overflow-x-auto"><table class="w-full text-sm">
                    <thead class="text-slate-500 border-b"><tr>
                        <th class="py-2.5 px-4 text-left font-medium">Country</th><th class="py-2.5 px-4 text-left font-medium">Income</th>
                        <th class="py-2.5 px-4 text-right font-medium">Physicians</th><th class="py-2.5 px-4 text-right font-medium">On SURGhub</th><th class="py-2.5 px-4 text-right font-medium">Reach</th>
                    </tr></thead>
                    <tbody>${R.missing.slice(0, 15).map(m => `<tr class="border-b border-slate-100 last:border-0">
                        <td class="py-2 px-4 font-medium text-gsf-prussian">${esc(m.country)}</td>
                        <td class="py-2 px-4 text-[10px] font-bold text-slate-500">${m.income}</td>
                        <td class="py-2 px-4 text-right tabular-nums">${fmt(m.physicians)}</td>
                        <td class="py-2 px-4 text-right tabular-nums ${m.declared ? '' : 'text-rose-600 font-bold'}">${m.declared || 'none'}</td>
                        <td class="py-2 px-4 text-right tabular-nums text-slate-400">${m.reach ? m.reach.toFixed(2) + '%' : '—'}</td>
                    </tr>`).join('')}</tbody>
                </table></div>
            </div>` : '';

        const growth = `
            <div class="bg-white p-6 rounded-xl shadow-sm border mb-6">
                <div class="flex items-baseline justify-between gap-3 flex-wrap mb-1">
                    <h3 class="text-lg font-bold text-gsf-prussian">Doctors joining over time</h3>
                    <p class="text-xs text-slate-400">Monthly signups &middot; extrapolated</p>
                </div>
                <p class="text-xs text-slate-500 mb-4">Absolute doctor signups against their share of all signups. A rising bar with a falling line means the platform is growing faster among other cadres.</p>
                <div id="chart_phys_growth" style="width:100%;height:320px"></div>
            </div>`;

        // ── the honesty panel
        const reliability = `
            <div class="bg-slate-50 rounded-xl border border-slate-200 p-5 mb-6">
                <h3 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide mb-3">What this number does and does not include</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600 leading-relaxed">
                    <div>
                        <p class="font-bold text-gsf-prussian mb-1">Counted as physicians</p>
                        <p>Doctors, surgeons, anaesthesiologists, obstetricians and gynaecologists, emergency physicians${o.medOfficer ? ', general medical officers' : ''}${o.stage !== 'practising' ? ', and doctors in training' : ''} — restricted to ${esc((this.PHYS_STAGES[o.stage] || {}).label || '').toLowerCase()}.</p>
                        <p class="font-bold text-gsf-prussian mt-2 mb-1">Deliberately excluded</p>
                        <p><strong>Nurse anaesthetists and anaesthesia technicians</strong> — the signup survey asks these separately from anaesthesiologists, and they are not physicians. ${o.stage === 'practising' ? 'Doctors in training, undergraduates, academics and the retired are excluded on this setting, because the denominator counts practising doctors. ' : ''}Nurses, clinical officers, technicians and non-clinical staff never count.</p>
                    </div>
                    <div>
                        <p class="font-bold text-gsf-prussian mb-1">Known limits</p>
                        <ul class="list-disc list-inside space-y-1">
                            <li>Country is where a learner says they are <strong>based</strong>, not their nationality — a doctor who trained in Sudan and works in the Gulf counts in the Gulf.</li>
                            <li>The denominator's year varies by country. <strong>${T.stale} of ${T.countries}</strong> rows here are 5+ years old and marked ⚠ in the table.</li>
                            ${T.lostDeclared ? `<li><strong>${fmt(T.lostDeclared)}</strong> physicians sit in ${R.unresolved.length + R.noDenominator.length} places with no workforce figure${R.unresolved.length ? ' (' + R.unresolved.slice(0, 4).map(u => esc(u.country)).join(', ') + (R.unresolved.length > 4 ? '…' : '') + ')' : ''} and are excluded rather than silently absorbed.</li>` : ''}
                            <li>Career stage is set to <strong>${esc((this.PHYS_STAGES[o.stage] || {}).label || '')}</strong>. Stage is declared for 97% of physicians here, so this filter is well covered rather than guesswork.</li>
                        </ul>
                    </div>
                </div>
                <div class="mt-4 pt-3 border-t border-slate-200">
                    <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2">Where the physician counts come from</p>
                    <p class="text-xs text-slate-600 leading-relaxed"><strong>${T.fromWho} of ${T.countries}</strong> countries use the WHO published headcount; <strong>${T.fromWb}</strong> fall back to the World Bank. Every row says which, and the Excel export carries both figures so the difference is auditable.</p>
                    <ul class="mt-2 space-y-1.5 text-xs text-slate-600">
                        <li><span class="font-bold text-emerald-700">WHO</span> &mdash; ${esc(W.label)}. ${esc(W.note)}
                            <a href="#" onclick="electronAPI.openExternal('${this.escapeJsArg(W.url)}'); return false" class="text-gsf-boston hover:underline ml-1">Indicator &rarr;</a>
                            <a href="#" onclick="electronAPI.openExternal('${this.escapeJsArg(W.densityUrl)}'); return false" class="text-gsf-boston hover:underline ml-1">Density &rarr;</a>
                            <a href="#" onclick="electronAPI.openExternal('${this.escapeJsArg(W.portalUrl)}'); return false" class="text-gsf-boston hover:underline ml-1">NHWA portal &rarr;</a></li>
                        <li><span class="font-bold text-amber-700">World Bank</span> &mdash; ${esc(B.label)}. ${esc(B.note)}
                            <a href="#" onclick="electronAPI.openExternal('${this.escapeJsArg(B.url)}'); return false" class="text-gsf-boston hover:underline ml-1">Indicator &rarr;</a></li>
                    </ul>
                    <p class="text-[11px] text-slate-400 mt-2">Both series come from the same country reporting through WHO&rsquo;s NHWA platform, so the fallback is a difference of vintage, not of definition.</p>
                </div>
            </div>`;

        return `<div id="phys-tab">${headline}${controls}${bands}${chart}${growth}${table}${target}${reliability}</div>`;
    },

    _drawPhysicianCharts(audSnap) {
        if (!window.google || !google.visualization || !window.Charts) return;

        // ── Top 10 by reach, one grouped bar per country, three bases side by side.
        const top = document.getElementById('chart_phys_top10');
        if (top) {
            const R = this._lastPhysReach || this.physicianReach();
            const ser = this._physSeries();
            const rows = R ? R.rows.slice(0, 10) : [];
            if (!rows.length) {
                Charts.clearChart('chart_phys_top10', 'No countries with a physician workforce yet.');
            } else {
                const cols = [
                    { key: 'certified', label: 'Certified', colour: '#5B8C5A' },
                    { key: 'declared',  label: 'Has an account', colour: '#4389C8' },
                    { key: 'estimated', label: 'Estimated', colour: '#B8860B' },
                ].filter(c => ser[c.key]);
                const dt = new google.visualization.DataTable();
                dt.addColumn('string', 'Country');
                cols.forEach(c => {
                    dt.addColumn('number', c.label);
                    dt.addColumn({ type: 'string', role: 'tooltip', p: { html: true } });
                });
                // Rank order — a ColumnChart draws the first row leftmost, so the
                // highest-reach country leads.
                rows.forEach(r => {
                    const cells = [r.country];
                    cols.forEach(c => {
                        const n = r[c.key] || 0;
                        const pct = r.physicians ? (n / r.physicians * 100) : 0;
                        cells.push(+pct.toFixed(2));
                        cells.push('<div style="padding:8px 12px;font-size:12px;line-height:1.5">'
                            + '<strong>' + this.escapeHtml(r.country) + '</strong> &middot; ' + this.escapeHtml(c.label) + '<br>'
                            + this.formatNumber(n) + ' of ' + this.formatNumber(r.physicians) + ' physicians = <strong>' + pct.toFixed(2) + '%</strong><br>'
                            + '<span style="color:#94a3b8">1 in ' + (n ? Math.round(r.physicians / n) : '—') + ' &middot; workforce from ' + this.escapeHtml(r.sourceShort) + ' ' + r.year + '</span></div>');
                    });
                    dt.addRow(cells);
                });
                new google.visualization.ColumnChart(top).draw(dt, {
                    colors: cols.map(c => c.colour),
                    bar: { groupWidth: '70%' },
                    hAxis: { textStyle: { color: '#475569', fontSize: 11 }, slantedText: true, slantedTextAngle: 45,
                             gridlines: { color: 'transparent' }, baselineColor: '#e2e8f0' },
                    vAxis: { title: '% of the country\u2019s physicians', minValue: 0,
                             textStyle: { color: '#94a3b8', fontSize: 11 }, titleTextStyle: { color: '#94a3b8', fontSize: 11, italic: false },
                             gridlines: { color: '#f1f5f9' } },
                    legend: { position: 'top', alignment: 'start', textStyle: { fontSize: 12 } },
                    tooltip: { isHtml: true },
                    chartArea: { left: 70, right: 20, top: 40, bottom: 110 },
                    backgroundColor: 'transparent',
                });
            }
        }

        const el = document.getElementById('chart_phys_growth');
        if (!el) return;
        const g = this.physicianGrowth(audSnap);
        if (!g || !g.length) { Charts.clearChart('chart_phys_growth', 'No dated signup history yet.'); return; }
        const dt = new google.visualization.DataTable();
        dt.addColumn('string', 'Month');
        dt.addColumn('number', 'Doctors joining');
        dt.addColumn('number', '% of all signups');
        g.forEach(p => dt.addRow([p.m, Math.round(p.phys), +p.share.toFixed(1)]));
        new google.visualization.ComboChart(el).draw(dt, {
            seriesType: 'bars',
            series: { 0: { color: '#4389C8', targetAxisIndex: 0 }, 1: { type: 'line', color: '#E28743', targetAxisIndex: 1, lineWidth: 2 } },
            vAxes: { 0: { title: 'Doctors', textStyle: { color: '#94a3b8', fontSize: 11 }, gridlines: { color: '#f1f5f9' } },
                     1: { title: '% of signups', textStyle: { color: '#94a3b8', fontSize: 11 }, gridlines: { color: 'transparent' }, viewWindow: { min: 0, max: 100 } } },
            hAxis: Charts.hAxisDefaults ? Charts.hAxisDefaults() : {},
            legend: { position: 'top', alignment: 'start', textStyle: { fontSize: 12 } },
            chartArea: { left: 65, right: 65, top: 40, bottom: 60 }, backgroundColor: 'transparent',
        });
    },

    async exportPhysicianXlsx() {
        if (this.ensureAnonLoaded) await this.ensureAnonLoaded();
        const R = this.physicianReach();
        if (!R) return alert('No learner data yet.');
        const T = R.totals, o = R.opts;
        const wb = XLSX.utils.book_new();
        const nice = (ws, x) => (this._niceSheet ? this._niceSheet(ws, x) : ws);
        const about = [
            ['SURGhub — physician-workforce reach'],
            ['Generated', new Date().toISOString().slice(0, 10)],
            ['Scope', o.scope === 'all' ? 'All incomes' : 'LIC / LMIC'],
            ['Basis', o.basis],
            ['Career stage counted', (this.PHYS_STAGES[o.stage] || {}).label + ' — ' + (this.PHYS_STAGES[o.stage] || {}).note],
            ['Medical officers included', o.medOfficer ? 'yes' : 'no'],
            [''],
            ['Physicians on SURGhub (selected basis)', T.count], ['Physician workforce in scope', T.physicians],
            ['Reach', (T.reach || 0).toFixed(3) + '%'], ['One in', T.oneIn],
            ['Certified only', T.certified], ['Registered and declared', T.declared], ['Estimated', T.estimated],
            [''],
            ['Numerator', 'Classified from the RAW signup-survey tag, not the canonical cadre: nurse anaesthetists and anaesthesia technicians are asked separately from anaesthesiologists and are NOT counted as physicians.'],
            ['Extrapolation', 'The Estimated basis grosses each country up by ITS OWN profession-declaration rate, not one global factor.'],
            ['Denominator (preferred)', this.PHYS_SOURCES.who.label + '. ' + this.PHYS_SOURCES.who.note],
            ['Denominator source', this.PHYS_SOURCES.who.url],
            ['Denominator (fallback)', this.PHYS_SOURCES.wb.label + '. ' + this.PHYS_SOURCES.wb.note],
            ['Fallback source', this.PHYS_SOURCES.wb.url],
            ['Provenance', T.fromWho + ' of ' + T.countries + ' countries use the WHO headcount; ' + T.fromWb + ' fall back to the World Bank. The By-country sheet carries both figures for comparison.'],
            ['Vintage', T.stale + ' of ' + T.countries + ' rows use a density 5+ years old — see the Data year column.'],
            ['Country', 'Residence as stated by the learner, not nationality.'],
            ['Excluded', T.lostDeclared + ' physicians sit in places with no workforce figure and are left out rather than absorbed.'],
        ];
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.aoa_to_sheet(about), { noFilter: true, widths: [{ wch: 38 }, { wch: 110 }] }), 'Summary');
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(R.rows.map(r => ({
            Country: r.country, 'Income group': r.income,
            'Physicians on SURGhub (selected basis)': r.count, 'Certified': r.certified, 'Registered': r.declared, 'Estimated': r.estimated,
            'Physician workforce': r.physicians, 'Workforce source': this.PHYS_SOURCES[r.source].short,
            'Workforce data year': r.year,
            'World Bank figure (for comparison)': r.wbPhysicians || '', 'World Bank data year': r.wbYear || '',
            'Reach %': +r.reach.toFixed(3),
            'Certification rate %': +r.certRate.toFixed(1), 'Physicians per 1,000': r.per1000,
            'Density 5+ years old': r.stale ? 'yes' : '', 'Profession declaration rate %': +r.declRate.toFixed(1),
            'Physicians on SURGhub per 100k population': +r.per100k.toFixed(3),
        })))), 'By country');
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(
            ['LIC', 'LMIC', 'UMIC', 'HIC'].map(k => ({ 'Income group': k, Countries: R.byIncome[k].n, 'On SURGhub': R.byIncome[k].count,
                'Physician workforce': R.byIncome[k].physicians, 'Reach %': +R.byIncome[k].reach.toFixed(3), 'One in': R.byIncome[k].oneIn }))
            .concat(R.densityBands.map(b => ({ 'Income group': 'Density ' + b.label + ' per 1,000', Countries: b.n, 'On SURGhub': b.count,
                'Physician workforce': b.physicians, 'Reach %': +b.reach.toFixed(3), 'One in': b.oneIn })))
        )), 'Bands');
        if (R.missing.length) XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(R.missing.map(m => ({
            Country: m.country, 'Income group': m.income, 'Physician workforce': m.physicians,
            'Physicians per 1,000': m.per1000, 'On SURGhub': m.declared, 'Reach %': +m.reach.toFixed(3) })))), 'Not yet reached');
        const p = await electronAPI.invoke('pick-save-path', 'surghub_physician_reach_' + new Date().toISOString().split('T')[0] + '.xlsx');
        if (!p) return;
        this._writeWorkbook(wb, p);
        this.showMsg('Saved ' + R.rows.length + ' countries → ' + p.split('/').pop());
    },
});
