// === Conflict-affected settings ===
// The "Conflict Settings" KPI counts REGISTERED USERS whose recorded country is on a
// conflict classification list. Two things used to make it hard to defend:
//   · the list was six countries hardcoded in ui.js with no cited source, and
//   · it was code-only, so the methodology page's promise of "periodic review" was
//     not something the user could act on.
// Both are fixed here. The default is the World Bank's own published list; the user
// can override it from the methodology page, and the override is stored, not compiled.
//
// Matching is by explicit alias, never fuzzy. A loose stem match on the World Bank
// names silently picks "Congo" (Republic of the Congo, NOT on the list) over
// "DR Congo", and "Western Sahara" over "West Bank and Gaza" — both wrong, both
// silent. Every entry below lists the spellings the platform data actually uses.

Object.assign(window.App, {

    CONFLICT_KEY: 'surgdash_conflict_countries',

    // Cited on the KPI card and the methodology page.
    CONFLICT_SOURCE: {
        label: 'World Bank FY2027 Public FCV List',
        effective: '1 July 2026',
        url: 'https://thedocs.worldbank.org/en/doc/d2e218e68a25ba7a31147a7455f35cae-0090082026/original/A1-FY27-FCV-List.pdf',
        home: 'https://www.worldbank.org/en/topic/fragilityconflictviolence/brief/classification-of-fragile-and-conflict-affected-situations',
        criterion: '20% or more of the population lives in subnational units with elevated conflict-related fatalities (ACLED data, June 2025 – May 2026).',
        note: 'The World Bank publishes a second list — Institutional Fragility (IDA-eligible countries with a CPIA score below 3.0) — which covers structural fragility rather than active conflict. This KPI deliberately uses the conflict list only, so the card label stays accurate.'
    },

    // The 24 economies on the FY2027 Public FCV List, verbatim, each with the
    // spellings that appear (or could appear) in the platform's own country data.
    CONFLICT_DEFAULT: [
        { wb: 'Afghanistan',          iso3: 'AFG', aliases: [] },
        { wb: 'Burkina Faso',         iso3: 'BFA', aliases: [] },
        { wb: 'Cameroon',             iso3: 'CMR', aliases: [] },
        { wb: 'Central African Rep.', iso3: 'CAF', aliases: ['Central African Republic'] },
        { wb: 'Congo, Dem. Rep.',     iso3: 'COD', aliases: ['DR Congo', 'Democratic Republic of the Congo', 'Congo, the Democratic Republic of the', 'Congo (Kinshasa)'] },
        { wb: 'Ethiopia',             iso3: 'ETH', aliases: [] },
        { wb: 'Haiti',                iso3: 'HTI', aliases: [] },
        { wb: 'Iran, Islamic Rep.',   iso3: 'IRN', aliases: ['Iran', 'Iran, Islamic Republic of'] },
        { wb: 'Iraq',                 iso3: 'IRQ', aliases: [] },
        { wb: 'Lebanon',              iso3: 'LBN', aliases: [] },
        { wb: 'Libya',                iso3: 'LBY', aliases: [] },
        { wb: 'Mali',                 iso3: 'MLI', aliases: [] },
        { wb: 'Mozambique',           iso3: 'MOZ', aliases: [] },
        { wb: 'Myanmar',              iso3: 'MMR', aliases: ['Burma'] },
        { wb: 'Niger',                iso3: 'NER', aliases: [] },
        { wb: 'Nigeria',              iso3: 'NGA', aliases: [] },
        { wb: 'Papua New Guinea',     iso3: 'PNG', aliases: [] },
        { wb: 'Somalia',              iso3: 'SOM', aliases: [] },
        { wb: 'South Sudan',          iso3: 'SSD', aliases: [] },
        { wb: 'Sudan',                iso3: 'SDN', aliases: [] },
        { wb: 'Syrian Arab Republic', iso3: 'SYR', aliases: ['Syria'] },
        { wb: 'Ukraine',              iso3: 'UKR', aliases: [] },
        { wb: 'West Bank and Gaza',   iso3: 'PSE', aliases: ['Palestine', 'Palestinian Territory, Occupied', 'Palestinian Territories', 'State of Palestine', 'Occupied Palestinian Territory', 'Gaza'] },
        { wb: 'Yemen, Rep.',          iso3: 'YEM', aliases: ['Yemen'] },
    ],

    // Lowercase, strip punctuation, collapse spaces. "Congo, Dem. Rep." and
    // "congo dem rep" match; "Congo" and "DR Congo" stay distinct.
    _conflictNorm(s) {
        return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    },

    // Levenshtein, capped — just enough to catch a typo ("Isreal" → "Israel")
    // so an added country that matches nothing can suggest what was meant.
    _editDistance(a, b) {
        if (a === b) return 0;
        if (Math.abs(a.length - b.length) > 3) return 99;
        let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
        for (let i = 1; i <= a.length; i++) {
            const cur = [i];
            for (let j = 1; j <= b.length; j++) {
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            }
            prev = cur;
        }
        return prev[b.length];
    },

    // The active list: the user's saved override if there is one, else the default.
    // Lazily loaded; triggers one re-render when it lands.
    conflictList() {
        if (Array.isArray(this._conflictCustom)) return this._conflictCustom;
        if (!this._conflictLoadKicked) {
            this._conflictLoadKicked = true;
            Storage.getItem(this.CONFLICT_KEY).then(v => {
                // Only adopt the stored list if nothing has been set in the meantime —
                // an edit made while this read was in flight must win, not be clobbered
                // by the older on-disk value arriving late.
                if (Array.isArray(this._conflictCustom)) return;
                if (Array.isArray(v) && v.length) { this._conflictCustom = v; this.renderView(); }
            }).catch(() => {});
        }
        return this.CONFLICT_DEFAULT;
    },

    isConflictListCustom() { return Array.isArray(this._conflictCustom) && this._conflictCustom.length > 0; },

    // Display names for the active list.
    conflictCountries() { return this.conflictList().map(c => c.wb); },

    // Every accepted spelling → the canonical World Bank name.
    _conflictMatchMap() {
        const m = new Map();
        this.conflictList().forEach(c => {
            m.set(this._conflictNorm(c.wb), c.wb);
            (c.aliases || []).forEach(a => m.set(this._conflictNorm(a), c.wb));
        });
        return m;
    },

    // Per-country breakdown against an audience snapshot, plus the entries that
    // matched nothing — so a renamed country shows up instead of silently zeroing.
    conflictBreakdown(audSnap) {
        const out = { rows: [], total: 0, unmatched: [], countryTotal: 0 };
        if (!audSnap || !audSnap.AllCountryStats) return out;
        let stats;
        try { stats = typeof audSnap.AllCountryStats === 'string' ? JSON.parse(audSnap.AllCountryStats) : audSnap.AllCountryStats; }
        catch (e) { return out; }
        const map = this._conflictMatchMap();
        const hits = {};
        for (const [country, count] of Object.entries(stats)) {
            out.countryTotal += Number(count) || 0;
            const canon = map.get(this._conflictNorm(country));
            if (!canon) continue;
            hits[canon] = (hits[canon] || 0) + (Number(count) || 0);
        }
        this.conflictList().forEach(c => {
            const n = hits[c.wb] || 0;
            if (n > 0) out.rows.push({ name: c.wb, n });
            else out.unmatched.push(c.wb);
            out.total += n;
        });
        out.rows.sort((a, b) => b.n - a.n);
        return out;
    },

    getConflictLearners(audSnap) { return this.conflictBreakdown(audSnap).total; },

    // ── Editing ───────────────────────────────────────────────────────────────
    async setConflictList(list) {
        this._conflictLoadKicked = true;   // a pending lazy read must not overwrite this
        this._conflictCustom = (Array.isArray(list) && list.length) ? list : null;
        if (this._conflictCustom) await Storage.setItem(this.CONFLICT_KEY, this._conflictCustom);
        else await Storage.removeItem(this.CONFLICT_KEY);
        this.renderView();
    },

    // Toggle one World Bank country in or out of the active list.
    async toggleConflictCountry(iso3) {
        const active = this.conflictList().slice();
        const i = active.findIndex(c => c.iso3 === iso3);
        if (i >= 0) active.splice(i, 1);
        else {
            const add = this.CONFLICT_DEFAULT.find(c => c.iso3 === iso3);
            if (add) active.push(add);
        }
        // Keep default order so the list reads the same however it was edited.
        const order = this.CONFLICT_DEFAULT.map(c => c.iso3);
        active.sort((a, b) => order.indexOf(a.iso3) - order.indexOf(b.iso3));
        await this.setConflictList(active);
    },

    // Add a country that is not on the World Bank list (e.g. a GSF-specific
    // judgement). Stored with the platform's own spelling as an alias, so it
    // matches whatever the country data actually says.
    // NOTE: uses App._textPrompt, not window.prompt — Electron does not implement
    // prompt() at all, so a raw prompt() call silently does nothing.
    async addConflictCountry() {
        const typed = await this._textPrompt(
            'Add a country to the conflict list',
            'Type the country name. This sits outside the ' + this.CONFLICT_SOURCE.label + ', so the KPI will be marked as edited.',
            '');
        const name = String(typed || '').trim();
        if (!name) return;

        const active = this.conflictList().slice();
        if (active.some(c => this._conflictNorm(c.wb) === this._conflictNorm(name)
                || (c.aliases || []).some(a => this._conflictNorm(a) === this._conflictNorm(name)))) {
            return this.showMsg('“' + name + '” is already on the list.');
        }

        // Resolve against the country names the platform data actually uses, so a
        // typo lands as a warning now instead of a silent zero on the dashboard.
        const aud = (this.userHistory || []).slice()
            .reduce((a, b) => (a && String(a.Timestamp) > String(b.Timestamp) ? a : b), null);
        let stats = {};
        try { stats = aud && aud.AllCountryStats ? (typeof aud.AllCountryStats === 'string' ? JSON.parse(aud.AllCountryStats) : aud.AllCountryStats) : {}; } catch (e) {}
        const keys = Object.keys(stats);
        const exact = keys.find(k => this._conflictNorm(k) === this._conflictNorm(name));
        const entry = { wb: exact || name, iso3: '', aliases: exact && exact !== name ? [name] : [], custom: true };

        active.push(entry);
        await this.setConflictList(active);

        if (exact) {
            this.showMsg('Added ' + exact + ' — ' + this.formatNumber(stats[exact] || 0) + ' registered users. The KPI is now marked as edited.');
        } else {
            const n = this._conflictNorm(name);
            const near = keys
                .map(k => ({ k, d: this._editDistance(n, this._conflictNorm(k)) }))
                .filter(x => x.d <= 2 || x.k.toLowerCase().startsWith(n.slice(0, 5)) || n.startsWith(this._conflictNorm(x.k).slice(0, 5)))
                .sort((a, b) => a.d - b.d).slice(0, 4).map(x => x.k);
            this.showMsg('Added “' + name + '”, but no country of that name is in the current data, so it counts 0 for now.'
                + (near.length ? ' Did you mean: ' + near.join(', ') + '?' : ''), true);
        }
    },

    async resetConflictList() {
        if (!confirm('Reset to the ' + this.CONFLICT_SOURCE.label + ' (' + this.CONFLICT_DEFAULT.length + ' countries)?\n\nAny countries you added or removed will be discarded.')) return;
        await this.setConflictList(null);
        this.showMsg('Conflict list reset to the World Bank default');
    },
});

// ── Methodology page section: source, live breakdown, and the editor ──────────
Object.assign(window.App, {
    _conflictMethodologyHtml() {
        const S = this.CONFLICT_SOURCE;
        const esc = (t) => this.escapeHtml(t);
        const aud = (this.userHistory || []).find(d => d.Timestamp === this.selectedDate)
            || (this.userHistory || []).slice().reduce((a, b) => (a && String(a.Timestamp) > String(b.Timestamp) ? a : b), null)
            || null;
        const b = this.conflictBreakdown(aud);
        const custom = this.isConflictListCustom();
        const pct = (aud && aud.TotalUsers) ? (b.total / aud.TotalUsers * 100).toFixed(1) : null;

        const chips = b.rows.map(r => `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-rose-50 text-rose-800 border border-rose-200">${esc(r.name)} <strong>${this.formatNumber(r.n)}</strong></span>`).join(' ');
        const none = b.unmatched.length
            ? `<p class="text-xs text-slate-400 mt-2">No learners recorded from: ${b.unmatched.map(esc).join(', ')}.</p>` : '';

        return `
            <div class="bg-white rounded-xl border shadow-sm p-6">
                <h2 class="text-lg font-bold text-gsf-prussian mb-3 flex items-center gap-2"><i data-lucide="shield" width="20" class="text-gsf-boston"></i> Conflict Settings</h2>
                <p class="text-sm text-slate-600 mb-3">The <strong>&ldquo;Conflict Settings&rdquo;</strong> KPI on the Platform Overview shows the estimated number of <strong>registered users</strong> whose recorded country is on a published conflict classification. It supports GSF&rsquo;s mission to track reach into fragile and conflict-affected settings.</p>

                <div class="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
                    <p class="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Source</p>
                    <p class="text-sm text-gsf-prussian font-bold">${esc(S.label)}${custom ? ' <span class="text-amber-700 font-semibold">— edited locally</span>' : ''}</p>
                    <p class="text-xs text-slate-500 mt-1">Effective ${esc(S.effective)}. Inclusion criterion: ${esc(S.criterion)}</p>
                    <p class="text-xs text-slate-500 mt-2">${esc(S.note)}</p>
                    <div class="flex flex-wrap gap-3 mt-2">
                        <a href="#" onclick="electronAPI.openExternal('${this.escapeJsArg(S.url)}'); return false" class="text-xs text-gsf-boston hover:underline font-medium">Open the list (PDF) &rarr;</a>
                        <a href="#" onclick="electronAPI.openExternal('${this.escapeJsArg(S.home)}'); return false" class="text-xs text-gsf-boston hover:underline font-medium">How the World Bank builds it &rarr;</a>
                    </div>
                </div>

                <p class="text-sm text-slate-600 mb-2"><strong>Counted now:</strong> ${this.formatNumber(b.total)} registered users${pct ? ' (' + pct + '% of ' + this.formatNumber(aud.TotalUsers) + ')' : ''} across ${b.rows.length} ${b.rows.length === 1 ? 'country' : 'countries'}.</p>
                <div class="flex flex-wrap gap-1.5 mb-1">${chips || '<span class="text-xs text-slate-400 italic">No matching countries in the current data.</span>'}</div>
                ${none}

                <ul class="text-sm text-slate-600 space-y-1 list-disc list-inside mt-4 mb-3">
                    <li>Counts <strong>registered users</strong>, not enrolments — the &ldquo;Enrolled Learners&rdquo; card counts course enrolments and is a much larger number, so the two must not be divided into each other</li>
                    <li>Country figures are extrapolated (see above), so this is an <strong>estimate</strong>: country is known for ${aud && aud.CountryKnownPct != null ? aud.CountryKnownPct : '~72'}% of users and scaled up to the full base</li>
                    <li>The country recorded is where the learner says they are <strong>currently based</strong> (residence), not their nationality — so a displaced Sudanese clinician working in Cairo counts under Egypt, not Sudan</li>
                    <li>Matching is by explicit country name and alias, so a spelling the platform uses (&ldquo;DR Congo&rdquo;, &ldquo;Palestine&rdquo;) is mapped to its World Bank entry; any list entry with no match is listed above rather than silently counting zero</li>
                </ul>

                <div class="border-t border-slate-200 pt-4 mt-4 flex items-center justify-between gap-3 flex-wrap">
                    <p class="text-xs text-slate-500">The list is editable on the dashboard, next to the numbers it drives.</p>
                    <button onclick="App.view='platform'; App._dashTab='conflict'; App.renderView()" class="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-600 hover:text-gsf-prussian hover:bg-slate-50">Open the Conflict Settings tab &rarr;</button>
                </div>
            </div>`;
    },
});

// ── Dashboard › Conflict Settings tab ─────────────────────────────────────────
// Two data sources with different properties, kept visibly apart because mixing
// them silently would be dishonest:
//   · REGISTERED USERS + their growth come from the audience aggregate
//     (AllCountryStats / CountryTimeline). Country is known for ~72% of users and
//     scaled up, so these are estimates — same basis as the KPI card.
//   · ENROLMENTS, CERTIFICATES, LEARNING TIME, cadre mix and course choices come
//     from the anonymised per-user records, which are OBSERVED (never scaled) and
//     cover only users with at least one enrolment.
// Every card says which one it is.
Object.assign(window.App, {

    // Observed per-country activity for the active conflict list, from anon_users.
    conflictActivity() {
        const anon = this._rawAnonymizedUsers;
        if (!Array.isArray(anon) || !anon.length) return null;
        const map = this._conflictMatchMap();
        const per = {};          // canonical country → aggregates
        const users = {};        // canonical country → Set(user_uid)
        const courses = {};      // course → enrolments (conflict learners only)
        const cadre = {}, stage = {}, org = {};
        let enrol = 0, certs = 0, minutes = 0, matchedRows = 0;
        const uids = new Set();

        anon.forEach(r => {
            if (!r || !r.country) return;
            const canon = map.get(this._conflictNorm(r.country));
            if (!canon) return;
            matchedRows++;
            const p = per[canon] || (per[canon] = { enrol: 0, certs: 0, minutes: 0, learners: 0 });
            const isCert = String(r.has_certificate) === 'Yes';   // the field is the STRING 'No'/'Yes' — truthiness is always true
            p.enrol++; enrol++;
            if (isCert) { p.certs++; certs++; }
            const m = Number(r.course_minutes) || 0; p.minutes += m; minutes += m;
            (users[canon] || (users[canon] = new Set())).add(r.user_uid);
            uids.add(r.user_uid);
            if (r.course) courses[r.course] = (courses[r.course] || 0) + 1;
            // Canonicalise the cadre slug ('medical-officer' → 'Medical Officer') with
            // the app's own taxonomy, so this tab reads like every other cadre view.
            if (r.profession) {
                const c = (window.Taxonomy && window.Taxonomy.canonProf) ? window.Taxonomy.canonProf(r.profession) : r.profession;
                if (c) cadre[c] = (cadre[c] || 0) + 1;
            }
            if (r.career_stage)      stage[r.career_stage] = (stage[r.career_stage] || 0) + 1;
            if (r.organisation_type)  org[r.organisation_type] = (org[r.organisation_type] || 0) + 1;
        });
        if (!matchedRows) return null;
        Object.keys(per).forEach(k => { per[k].learners = users[k] ? users[k].size : 0; });

        // Platform-wide comparators, so "is this better or worse than average?" is answerable.
        let allEnrol = 0, allCerts = 0;
        anon.forEach(r => { if (!r) return; allEnrol++; if (String(r.has_certificate) === 'Yes') allCerts++; });

        return {
            per, courses, cadre, stage, org,
            enrol, certs, minutes, learners: uids.size,
            certRate: enrol ? certs / enrol * 100 : 0,
            platformCertRate: allEnrol ? allCerts / allEnrol * 100 : 0,
            coveredCountries: Object.keys(per).length
        };
    },

    // Monthly registered-user counts for the conflict list, from CountryTimeline.
    // Returns { months, byCountry: {country: {month: n}}, totalByMonth, cumulative }.
    conflictTimeline(audSnap) {
        if (!audSnap || !audSnap.CountryTimeline) return null;
        let tl;
        try { tl = typeof audSnap.CountryTimeline === 'string' ? JSON.parse(audSnap.CountryTimeline) : audSnap.CountryTimeline; }
        catch (e) { return null; }
        const map = this._conflictMatchMap();
        const months = Object.keys(tl).filter(m => /^\d{4}-\d{2}$/.test(m)).sort();
        if (!months.length) return null;
        const byCountry = {}, totalByMonth = {}, platformByMonth = {};
        months.forEach(m => {
            totalByMonth[m] = 0; platformByMonth[m] = 0;
            Object.entries(tl[m] || {}).forEach(([country, n]) => {
                const v = Number(n) || 0;
                platformByMonth[m] += v;
                const canon = map.get(this._conflictNorm(country));
                if (!canon) return;
                (byCountry[canon] || (byCountry[canon] = {}))[m] = ((byCountry[canon] || {})[m] || 0) + v;
                totalByMonth[m] += v;
            });
        });
        // Cumulative series for the headline chart
        let runC = 0, runP = 0;
        const cumulative = months.map(m => {
            runC += totalByMonth[m] || 0; runP += platformByMonth[m] || 0;
            return { m, conflict: Math.round(runC), platform: Math.round(runP), share: runP ? +(runC / runP * 100).toFixed(1) : 0 };
        });
        return { months, byCountry, totalByMonth, platformByMonth, cumulative };
    },
});

Object.assign(window.App, {
    _dashConflictHtml(snapData, audSnap) {
        const b = this.conflictBreakdown(audSnap);
        if (!audSnap || !audSnap.TotalUsers) return this._dashNoLearnerData ? this._dashNoLearnerData() : '<div class="bg-white p-12 text-center text-slate-500 italic rounded-xl border">No learner data yet — run Sync Learners.</div>';
        const S = this.CONFLICT_SOURCE;
        const esc = (t) => this.escapeHtml(t);
        const fmt = (n) => this.formatNumber(Math.round(n || 0));
        const act = this.conflictActivity();
        const tl = this.conflictTimeline(audSnap);
        const share = audSnap.TotalUsers ? (b.total / audSnap.TotalUsers * 100) : 0;

        // Lazy: the observed activity needs the ~31MB anon blob.
        if (!act && this.ensureAnonLoaded && this._rawAnonymizedUsers == null) {
            this.ensureAnonLoaded().then(() => { if (this.view === 'platform' && this._dashTab === 'conflict') this.renderView(); });
        }

        const card = (label, value, sub, colour, icon) => `
            <div class="bg-white rounded-xl border shadow-sm overflow-hidden">
                <div style="height:3px;background:${colour}"></div>
                <div class="p-4">
                    <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400 flex items-center gap-1.5"><i data-lucide="${icon}" width="11" style="color:${colour}"></i> ${esc(label)}</p>
                    <p class="text-2xl font-black text-gsf-prussian mt-1 leading-tight">${value}</p>
                    ${sub ? `<p class="text-[11px] text-slate-400 mt-0.5">${sub}</p>` : ''}
                </div>
            </div>`;

        const kpis = `
            <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
                ${card('Registered learners', fmt(b.total), share.toFixed(1) + '% of the platform', '#e57373', 'users')}
                ${card('Countries reached', b.rows.length + ' of ' + this.conflictList().length, 'on the list', '#206095', 'globe')}
                ${act ? card('Enrolments', fmt(act.enrol), 'observed', '#4389C8', 'user-plus') : ''}
                ${act ? card('Certificates', fmt(act.certs), 'observed', '#7A9E9F', 'award') : ''}
                ${act ? card('Certification rate', act.certRate.toFixed(1) + '%', 'platform ' + act.platformCertRate.toFixed(1) + '%', act.certRate >= act.platformCertRate ? '#5B8C5A' : '#B8860B', 'target') : ''}
                ${act ? card('Learning time', fmt(act.minutes / 60) + ' h', 'observed', '#5B8C5A', 'clock') : ''}
            </div>`;

        // ── growth
        const growth = tl ? `
            <div class="bg-white p-6 rounded-xl shadow-sm border mb-6">
                <div class="flex items-baseline justify-between gap-3 flex-wrap mb-1">
                    <h3 class="text-lg font-bold text-gsf-prussian">Growth in conflict-affected settings</h3>
                    <p class="text-xs text-slate-400">Cumulative registered learners &middot; extrapolated</p>
                </div>
                <p class="text-xs text-slate-500 mb-4">Their share of the platform is the line that matters: it says whether SURGhub is reaching these settings faster or slower than it is growing overall.</p>
                <div id="chart_conflict_growth" style="width:100%;height:340px"></div>
            </div>

            <div class="bg-white p-6 rounded-xl shadow-sm border mb-6">
                <div class="flex items-baseline justify-between gap-3 flex-wrap mb-1">
                    <h3 class="text-lg font-bold text-gsf-prussian">Growth by country</h3>
                    <p class="text-xs text-slate-400">Cumulative registered learners &middot; top 8 countries</p>
                </div>
                <p class="text-xs text-slate-500 mb-4">Each line is one country on the list, running total over time. A line that flattens is a country the platform has stopped reaching; a step up usually tracks a specific outreach push or partner cohort.</p>
                <div id="chart_conflict_countries" style="width:100%;height:420px"></div>
            </div>` : '';

        // ── map
        const map = `
            <div class="bg-white p-6 rounded-xl shadow-sm border mb-6">
                <h3 class="text-lg font-bold text-gsf-prussian mb-1">Where they are</h3>
                <p class="text-xs text-slate-500 mb-3">Only the ${this.conflictList().length} countries on the ${esc(S.label)} are shaded.</p>
                <div id="chart_conflict_map" style="width:100%;height:420px"></div>
            </div>`;

        // ── per-country table, joining the estimate with the observed activity
        const rows = b.rows.map(r => {
            const a = act && act.per[r.name];
            const cr = a && a.enrol ? (a.certs / a.enrol * 100) : null;
            return `<tr class="border-b border-slate-100 hover:bg-slate-50">
                <td class="py-2.5 px-4 font-semibold text-gsf-prussian">${esc(r.name)}</td>
                <td class="py-2.5 px-4 text-right">${fmt(r.n)}</td>
                <td class="py-2.5 px-4 text-right text-slate-500">${b.total ? (r.n / b.total * 100).toFixed(1) + '%' : '–'}</td>
                <td class="py-2.5 px-4 text-right">${a ? fmt(a.learners) : '<span class="text-slate-300">–</span>'}</td>
                <td class="py-2.5 px-4 text-right">${a ? fmt(a.enrol) : '<span class="text-slate-300">–</span>'}</td>
                <td class="py-2.5 px-4 text-right">${a ? fmt(a.certs) : '<span class="text-slate-300">–</span>'}</td>
                <td class="py-2.5 px-4 text-right ${cr != null && act && cr >= act.platformCertRate ? 'text-emerald-600 font-bold' : 'text-slate-500'}">${cr != null ? cr.toFixed(1) + '%' : '<span class="text-slate-300">–</span>'}</td>
                <td class="py-2.5 px-4 text-right text-slate-500">${a ? fmt(a.minutes / 60) : '<span class="text-slate-300">–</span>'}</td>
            </tr>`;
        }).join('');

        const table = `
            <div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-6">
                <div class="p-5 border-b bg-slate-50">
                    <h3 class="text-lg font-bold text-gsf-prussian">Country by country</h3>
                    <p class="text-xs text-slate-500 mt-1">Registered learners are <strong>extrapolated</strong> (country known for ${audSnap.CountryKnownPct != null ? audSnap.CountryKnownPct : '~72'}% of users, scaled up). Everything to the right of it is <strong>observed</strong> from the anonymised records and counts only learners who enrolled in at least one course — so those columns are lower by construction, and the two must not be divided into each other.</p>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead class="text-slate-500 border-b bg-white">
                            <tr>
                                <th class="py-2.5 px-4 text-left font-medium">Country</th>
                                <th class="py-2.5 px-4 text-right font-medium">Registered <span class="text-[10px] text-slate-400">est.</span></th>
                                <th class="py-2.5 px-4 text-right font-medium">Share</th>
                                <th class="py-2.5 px-4 text-right font-medium">Enrolled <span class="text-[10px] text-slate-400">obs.</span></th>
                                <th class="py-2.5 px-4 text-right font-medium">Enrolments</th>
                                <th class="py-2.5 px-4 text-right font-medium">Certificates</th>
                                <th class="py-2.5 px-4 text-right font-medium">Cert rate</th>
                                <th class="py-2.5 px-4 text-right font-medium">Hours</th>
                            </tr>
                        </thead>
                        <tbody>${rows || '<tr><td colspan="8" class="py-8 text-center text-slate-400 italic">No learners recorded from the listed countries.</td></tr>'}</tbody>
                    </table>
                </div>
                ${b.unmatched.length ? `<p class="px-5 py-3 text-xs text-slate-400 border-t">No learners yet from: ${b.unmatched.map(esc).join(', ')}.</p>` : ''}
            </div>`;

        // ── who they are + what they take
        const topList = (obj, n, label, colour) => {
            const e = Object.entries(obj || {}).sort((a, b2) => b2[1] - a[1]).slice(0, n);
            const tot = Object.values(obj || {}).reduce((s, v) => s + v, 0);
            if (!e.length) return '';
            return `<div class="bg-white p-5 rounded-xl shadow-sm border">
                <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-3">${esc(label)}</p>
                <div class="space-y-2">${e.map(([k, v]) => `
                    <div>
                        <div class="flex items-baseline justify-between gap-2 mb-0.5">
                            <span class="text-sm text-slate-700 truncate">${esc(k)}</span>
                            <span class="text-xs font-bold text-gsf-prussian shrink-0">${fmt(v)}</span>
                        </div>
                        <div class="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div class="h-full rounded-full" style="width:${tot ? (v / e[0][1] * 100).toFixed(1) : 0}%;background:${colour}"></div></div>
                    </div>`).join('')}</div>
            </div>`;
        };

        const profile = act ? `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                ${topList(act.cadre, 6, 'Who they are · cadre', '#4389C8')}
                ${topList(act.stage, 5, 'Career stage', '#7A9E9F')}
                ${topList(act.org, 5, 'Organisation type', '#B8860B')}
            </div>
            <div class="mb-6">${topList(act.courses, 10, 'What they take · top courses by enrolment', '#e57373')}</div>` : '';

        return `
            <div class="bg-white rounded-xl border shadow-sm border-l-4 border-l-rose-400 p-5 mb-6">
                <div class="flex items-start justify-between gap-4 flex-wrap">
                    <div class="min-w-0 flex-1">
                        <h2 class="text-xl font-black text-gsf-prussian mb-1">Reach into conflict-affected settings</h2>
                        <p class="text-sm text-slate-600">${fmt(b.total)} registered learners — <strong>${share.toFixed(1)}%</strong> of the platform — in ${b.rows.length} of the ${this.conflictList().length} countries on the ${esc(S.label)}${this.isConflictListCustom() ? ' <span class="text-amber-700 font-semibold">(edited locally)</span>' : ''}.</p>
                    </div>
                    <button onclick="App.view='methodology'; App.renderView()" class="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-600 hover:text-gsf-prussian hover:bg-slate-50">Source &amp; list &rarr;</button>
                </div>
            </div>
            ${kpis}
            ${growth}
            ${map}
            ${table}
            ${profile}
            ${this._conflictListEditorHtml()}`;
    },

    // Charts for the tab — called after the DOM is in place.
    _drawConflictCharts(audSnap) {
        if (!window.google || !google.visualization || !window.Charts) return;
        const tl = this.conflictTimeline(audSnap);
        const b = this.conflictBreakdown(audSnap);

        // 1. cumulative learners + share of platform (dual axis)
        const el = document.getElementById('chart_conflict_growth');
        if (el && tl) {
            const pts = tl.cumulative.filter(p => p.conflict > 0);
            if (pts.length) {
                const dt = new google.visualization.DataTable();
                dt.addColumn('string', 'Month');
                dt.addColumn('number', 'Learners in conflict settings');
                dt.addColumn('number', '% of all platform learners');
                pts.forEach(p => dt.addRow([p.m, p.conflict, p.share]));
                new google.visualization.ComboChart(el).draw(dt, {
                    seriesType: 'area',
                    series: { 0: { color: '#e57373', targetAxisIndex: 0 }, 1: { type: 'line', color: '#206095', targetAxisIndex: 1, lineWidth: 2 } },
                    vAxes: { 0: { title: 'Learners', textStyle: { color: '#94a3b8', fontSize: 11 }, gridlines: { color: '#f1f5f9' } },
                             1: { title: '% of platform', textStyle: { color: '#94a3b8', fontSize: 11 }, gridlines: { color: 'transparent' }, viewWindow: { min: 0 } } },
                    hAxis: Charts.hAxisDefaults ? Charts.hAxisDefaults() : {},
                    legend: { position: 'top', alignment: 'start', textStyle: { fontSize: 12 } },
                    chartArea: { left: 70, right: 70, top: 40, bottom: 60 },
                    backgroundColor: 'transparent'
                });
            } else { Charts.clearChart('chart_conflict_growth', 'No dated history for these countries yet.'); }
        }

        // 2. per-country monthly — reuse the app's own breakdown timeline
        if (document.getElementById('chart_conflict_countries') && tl) {
            const monthly = {};
            tl.months.forEach(m => {
                const row = {};
                Object.keys(tl.byCountry).forEach(c => { const v = tl.byCountry[c][m]; if (v) row[c] = v; });
                if (Object.keys(row).length) monthly[m] = row;
            });
            if (Object.keys(monthly).length) Charts.drawBreakdownTimeline('chart_conflict_countries', monthly, 8, null, false);
            else Charts.clearChart('chart_conflict_countries', 'No dated history for these countries yet.');
        }

        // 3. map, restricted to the listed countries
        const mapEl = document.getElementById('chart_conflict_map');
        if (mapEl) {
            if (b.rows.length) {
                const dt = new google.visualization.DataTable();
                dt.addColumn('string', 'Country');
                dt.addColumn('number', 'Learners');
                dt.addColumn({ type: 'string', role: 'tooltip', p: { html: true } });
                b.rows.forEach(r => {
                    const pct = b.total ? (r.n / b.total * 100).toFixed(1) : '0.0';
                    dt.addRow([(window.countryToISO && window.countryToISO(r.name)) || r.name, r.n,
                        '<div style="padding:8px 12px;font-size:12px"><strong>' + this.escapeHtml(r.name) + '</strong><br>' + this.formatNumber(r.n) + ' learners<br>' + pct + '% of the conflict total</div>']);
                });
                new google.visualization.GeoChart(mapEl).draw(dt, {
                    colorAxis: { colors: ['#fde2e2', '#e57373', '#8b2020'], minValue: 0 },
                    backgroundColor: 'transparent', datalessRegionColor: '#f1f5f9', defaultColor: '#f1f5f9',
                    tooltip: { isHtml: true }, legend: { textStyle: { fontSize: 11 } }
                });
            } else { Charts.clearChart('chart_conflict_map', 'No learners from the listed countries yet.'); }
        }
    },
});

// The editable list. Lives on the Conflict Settings dashboard tab, next to the
// numbers it drives — editing a classification while looking at its effect beats
// editing it on a separate reference page.
Object.assign(window.App, {
    _conflictListEditorHtml() {
        const S = this.CONFLICT_SOURCE;
        const esc = (t) => this.escapeHtml(t);
        const custom = this.isConflictListCustom();
        const active = new Set(this.conflictList().map(c => c.iso3 || c.wb));
        const extra = this.conflictList().filter(c => !this.CONFLICT_DEFAULT.some(d => d.iso3 === c.iso3 && d.wb === c.wb));
        const toggle = (c, isExtra) => {
            const on = active.has(c.iso3 || c.wb);
            return `<button onclick="App.toggleConflictCountry('${this.escapeJsArg(c.iso3 || c.wb)}')"
                class="px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${on ? 'bg-gsf-boston text-white border-gsf-boston' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'}"
                title="${on ? 'Counted — click to exclude' : 'Not counted — click to include'}">${esc(c.wb)}${isExtra ? ' *' : ''}</button>`;
        };
        return `
            <div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-6">
                <div class="p-5 border-b bg-slate-50">
                    <h3 class="text-lg font-bold text-gsf-prussian">The list &amp; where it comes from</h3>
                    <p class="text-sm text-gsf-prussian font-bold mt-2">${esc(S.label)}${custom ? ' <span class="text-amber-700 font-semibold">— edited locally</span>' : ''}</p>
                    <p class="text-xs text-slate-500 mt-1">Effective ${esc(S.effective)}. Inclusion criterion: ${esc(S.criterion)}</p>
                    <p class="text-xs text-slate-500 mt-2">${esc(S.note)}</p>
                    <div class="flex flex-wrap gap-3 mt-2">
                        <a href="#" onclick="electronAPI.openExternal('${this.escapeJsArg(S.url)}'); return false" class="text-xs text-gsf-boston hover:underline font-medium">Open the list (PDF) &rarr;</a>
                        <a href="#" onclick="electronAPI.openExternal('${this.escapeJsArg(S.home)}'); return false" class="text-xs text-gsf-boston hover:underline font-medium">How the World Bank builds it &rarr;</a>
                        <button onclick="App.view='methodology'; App.renderView()" class="text-xs text-gsf-boston hover:underline font-medium">Full methodology &rarr;</button>
                    </div>
                </div>
                <div data-edit-only class="p-5">
                    <div class="flex items-center justify-between flex-wrap gap-2 mb-2">
                        <p class="text-xs font-bold uppercase tracking-wide text-slate-500">Edit the list</p>
                        <div class="flex items-center gap-2">
                            <button onclick="App.addConflictCountry()" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-600 hover:text-gsf-prussian hover:bg-slate-50">+ Add a country</button>
                            ${custom ? '<button onclick="App.resetConflictList()" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-amber-300 text-amber-700 hover:bg-amber-50">Reset to World Bank list</button>' : ''}
                        </div>
                    </div>
                    <p class="text-xs text-slate-500 mb-3">Click a country to include or exclude it. Blue = counted. Every number on this page updates immediately, and the KPI card says when the list has been edited.</p>
                    <div class="flex flex-wrap gap-1.5">
                        ${this.CONFLICT_DEFAULT.map(c => toggle(c, false)).join('')}
                        ${extra.map(c => toggle(c, true)).join('')}
                    </div>
                    ${extra.length ? '<p class="text-[11px] text-slate-400 mt-2">* added by you — outside the World Bank list.</p>' : ''}
                </div>
            </div>`;
    },
});
