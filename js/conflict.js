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

    // Toggle one country in or out of the active list.
    // The key is `iso3 || wb`, matching what the button sends — a country the user
    // added has no ISO code, so keying on iso3 alone made its chip un-clickable:
    // findIndex(c => c.iso3 === name) never matched (its iso3 is ''), and the add
    // branch then looked it up in CONFLICT_DEFAULT, where it does not exist. Dead click.
    async toggleConflictCountry(key) {
        const k = String(key);
        const active = this.conflictList().slice();
        const i = active.findIndex(c => (c.iso3 || c.wb) === k);
        if (i >= 0) {
            active.splice(i, 1);
        } else {
            const add = this.CONFLICT_DEFAULT.find(c => (c.iso3 || c.wb) === k);
            if (!add) return;   // unknown key — do nothing rather than fail silently mid-list
            active.push(add);
        }
        // Keep World Bank order, with user-added countries after them.
        const order = this.CONFLICT_DEFAULT.map(c => c.iso3 || c.wb);
        const rank = (c) => { const r = order.indexOf(c.iso3 || c.wb); return r < 0 ? order.length : r; };
        active.sort((a, b) => rank(a) - rank(b) || String(a.wb).localeCompare(String(b.wb)));
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
        try { stats = aud && aud.AllCountryStats ? (typeof aud.AllCountryStats === 'string' ? JSON.parse(aud.AllCountryStats) : aud.AllCountryStats) : {}; } catch (e) { __swallowed(e); }
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
        // "What they say" joins feedback to a country through the email→demographics
        // map, which is also lazy.
        if (!this._emailDemoMap && !this._conflictDemoKick) {
            this._conflictDemoKick = true;
            Storage.getItem('surghub_email_demo').then(v => {
                if (v) { this._emailDemoMap = v; if (this.view === 'platform' && this._dashTab === 'conflict') this.renderView(); }
            }).catch(() => {});
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
                <p class="text-xs text-slate-500 mb-3">Each line is one country on the list, running total over time. A line that flattens is a country the platform has stopped reaching; a step up usually tracks a specific outreach push or partner cohort.</p>
                <div id="selector_selectedConflictCountries" class="mb-3">${this._conflictCountrySelector(audSnap)}</div>
                <div id="chart_conflict_countries" style="width:100%;height:420px"></div>
            </div>` : '';

        // ── map
        const map = `
            <div class="bg-white p-6 rounded-xl shadow-sm border mb-6">
                <h3 class="text-lg font-bold text-gsf-prussian mb-1">Where they are</h3>
                <p class="text-xs text-slate-500 mb-3">Only the ${this.conflictList().length} countries on the ${esc(S.label)} are shaded.</p>
                <div id="chart_conflict_map" style="width:100%;height:420px"></div>
            </div>`;

        // ── per-country table, joining the estimate with the observed activity.
        // Sortable: click a header to sort, click again to reverse.
        const sort = this._conflictSort || { col: 'n', dir: 'desc' };
        const sortVal = (r, col) => {
            const a = act && act.per[r.name];
            switch (col) {
                case 'name':     return r.name.toLowerCase();
                case 'learners': return a ? a.learners : -1;
                case 'enrol':    return a ? a.enrol : -1;
                case 'certs':    return a ? a.certs : -1;
                case 'rate':     return a && a.enrol ? a.certs / a.enrol : -1;
                case 'hours':    return a ? a.minutes : -1;
                default:         return r.n;      // 'n' and 'share' rank identically
            }
        };
        const sorted = b.rows.slice().sort((x, y) => {
            const vx = sortVal(x, sort.col), vy = sortVal(y, sort.col);
            const c = (typeof vx === 'string') ? vx.localeCompare(vy) : (vx - vy);
            return sort.dir === 'asc' ? c : -c;
        });
        const th = (col, label, align, hint) => {
            const on = sort.col === col;
            return `<th class="py-2.5 px-4 text-${align} font-medium cursor-pointer select-none hover:text-gsf-prussian whitespace-nowrap ${on ? 'text-gsf-prussian' : ''}"
                onclick="App._sortConflictTable('${col}')" title="Sort by ${esc(label)}">${label}${hint || ''}<span class="ml-1 text-[9px] ${on ? 'text-gsf-boston' : 'text-slate-300'}">${on ? (sort.dir === 'asc' ? '&#9650;' : '&#9660;') : '&#8645;'}</span></th>`;
        };
        const rows = sorted.map(r => {
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
                                ${th('name', 'Country', 'left')}
                                ${th('n', 'Registered', 'right', ' <span class="text-[10px] text-slate-400">est.</span>')}
                                ${th('share', 'Share', 'right')}
                                ${th('learners', 'Enrolled', 'right', ' <span class="text-[10px] text-slate-400">obs.</span>')}
                                ${th('enrol', 'Enrolments', 'right')}
                                ${th('certs', 'Certificates', 'right')}
                                ${th('rate', 'Cert rate', 'right')}
                                ${th('hours', 'Hours', 'right')}
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
            <div id="conflict-tab">
            <div class="bg-white rounded-xl border shadow-sm border-l-4 border-l-rose-400 p-5 mb-6">
                <div class="flex items-start justify-between gap-4 flex-wrap">
                    <div class="min-w-0 flex-1">
                        <h2 class="text-xl font-black text-gsf-prussian mb-1">Reach into conflict-affected settings</h2>
                        <p class="text-sm text-slate-600">${fmt(b.total)} registered learners — <strong>${share.toFixed(1)}%</strong> of the platform — in ${b.rows.length} of the ${this.conflictList().length} countries on the ${esc(S.label)}${this.isConflictListCustom() ? ' <span class="text-amber-700 font-semibold">(edited locally)</span>' : ''}.</p>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                        <button onclick="App.exportConflictXlsx()" title="Download this page as Excel — summary, countries, momentum, income comparison, gender, growth and quotes" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-600 hover:text-gsf-prussian hover:bg-slate-50 inline-flex items-center gap-1.5"><i data-lucide="file-spreadsheet" width="13"></i> Excel</button>
                        <button onclick="App._copyEngagementSection('conflict-tab', this, true)" title="Copy the whole page as a PNG" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-600 hover:text-gsf-prussian hover:bg-slate-50 inline-flex items-center gap-1.5"><i data-lucide="copy" width="13"></i> PNG</button>
                    </div>
                </div>
            </div>
            ${kpis}
            ${this._conflictBandsHtml()}
            ${growth}
            ${this._conflictMomentumHtml(audSnap)}
            ${map}
            ${table}
            ${this._conflictGenderHtml()}
            ${profile}
            ${this._conflictVoicesHtml(snapData)}
            ${this._conflictListEditorHtml()}
            </div>`;
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
            const sel = this.selectedConflictCountries || [];
            if (Object.keys(monthly).length) Charts.drawBreakdownTimeline('chart_conflict_countries', monthly, 8, sel.length ? sel : null, false);
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

// ── Additional cuts for the Conflict Settings tab ────────────────────────────
Object.assign(window.App, {

    // Gender, career profile and engagement for the conflict list vs the rest of
    // the platform. Deduplicated by user, because a learner enrolled in four
    // courses is one person, not four.
    conflictVsRest() {
        const anon = this._rawAnonymizedUsers;
        if (!Array.isArray(anon) || !anon.length) return null;
        const map = this._conflictMatchMap();
        const seen = { c: new Set(), r: new Set() };
        const gender = { c: {}, r: {} };
        let cU = 0, rU = 0;
        anon.forEach(x => {
            if (!x || !x.country || !x.user_uid) return;
            const inConflict = !!map.get(this._conflictNorm(x.country));
            const bucket = inConflict ? 'c' : 'r';
            if (seen[bucket].has(x.user_uid)) return;
            seen[bucket].add(x.user_uid);
            if (inConflict) cU++; else rU++;
            const g = String(x.gender || '').trim();
            if (g && g.toLowerCase() !== 'no data') gender[bucket][g] = (gender[bucket][g] || 0) + 1;
        });
        if (!cU) return null;
        const pcts = (o) => { const t = Object.values(o).reduce((s, v) => s + v, 0); return { total: t, rows: Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, n: v, pct: t ? v / t * 100 : 0 })) }; };
        return { conflictUsers: cU, restUsers: rU, gender: { conflict: pcts(gender.c), rest: pcts(gender.r) } };
    },

    // Three-way comparison so the conflict certification rate can be read
    // correctly: most of these countries are low-income anyway, so the honest
    // question is "conflict vs comparable-income", not "conflict vs everyone".
    conflictIncomeBands() {
        const anon = this._rawAnonymizedUsers;
        if (!Array.isArray(anon) || !anon.length || !window.IncomeClassification) return null;
        const map = this._conflictMatchMap();
        const band = { conflict: null, lowIncome: null, other: null };
        const mk = () => ({ enrol: 0, certs: 0, minutes: 0, users: new Set() });
        const b = { conflict: mk(), lowIncome: mk(), other: mk() };
        const tierCache = {};
        anon.forEach(x => {
            if (!x || !x.country) return;
            let key;
            if (map.get(this._conflictNorm(x.country))) key = 'conflict';
            else {
                let tier = tierCache[x.country];
                if (tier === undefined) { try { tier = IncomeClassification.classify(x.country); } catch (e) { tier = 'Unknown'; } tierCache[x.country] = tier; }
                key = (tier === 'LIC' || tier === 'LMIC') ? 'lowIncome' : 'other';
            }
            const t = b[key];
            t.enrol++;
            if (String(x.has_certificate) === 'Yes') t.certs++;
            t.minutes += Number(x.course_minutes) || 0;
            if (x.user_uid) t.users.add(x.user_uid);
        });
        Object.keys(b).forEach(k => {
            const t = b[k], u = t.users.size;
            band[k] = { enrol: t.enrol, certs: t.certs, minutes: t.minutes, learners: u,
                certRate: t.enrol ? t.certs / t.enrol * 100 : 0,
                coursesPerLearner: u ? t.enrol / u : 0,
                minutesPerLearner: u ? t.minutes / u : 0 };
        });
        return band;
    },

    // Momentum: the last three complete months against the three before them.
    // The share line shows the aggregate story; this says which countries are
    // driving it and which have gone quiet.
    conflictMomentum(audSnap) {
        const tl = this.conflictTimeline(audSnap);
        if (!tl) return null;
        // Drop the current (incomplete) month so a part-month never reads as a fall.
        const now = new Date();
        const nowM = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        const months = tl.months.filter(m => m < nowM);
        if (months.length < 6) return null;
        const recent = months.slice(-3), prior = months.slice(-6, -3);
        const sum = (obj, ms) => ms.reduce((s, m) => s + (obj[m] || 0), 0);
        const rows = Object.keys(tl.byCountry).map(c => {
            const a = sum(tl.byCountry[c], recent), p = sum(tl.byCountry[c], prior);
            return { name: c, recent: a, prior: p, delta: a - p, pct: p ? (a - p) / p * 100 : (a ? null : 0) };
        }).filter(r => r.recent || r.prior).sort((a, b) => b.recent - a.recent);
        return { recent, prior, rows,
            totalRecent: sum(tl.totalByMonth, recent), totalPrior: sum(tl.totalByMonth, prior),
            platformRecent: sum(tl.platformByMonth, recent), platformPrior: sum(tl.platformByMonth, prior) };
    },

    // Feedback written by learners in the listed countries: how they rate the
    // courses, and their strongest comments.
    conflictFeedback(snapData) {
        const demo = this._emailDemoMap;
        if (!demo || !this._djb2Hash) return null;
        const map = this._conflictMatchMap();
        const ai = this._aiScoreMap || {};
        let n = 0, rN = 0, rSum = 0, allN = 0, allRN = 0, allRSum = 0;
        const quotes = [];
        (snapData || []).forEach(d => {
            if (!d.FeedbackBank) return;
            let fb; try { fb = JSON.parse(d.FeedbackBank); } catch (e) { return; }
            if (!Array.isArray(fb)) return;
            fb.forEach(f => {
                if (!f) return;
                const r = Number(f.r) || 0;
                allN++; if (r >= 1 && r <= 5) { allRN++; allRSum += r; }
                const dm = f.e ? demo[String(f.e).trim().toLowerCase()] : null;
                const country = dm && dm.country;
                if (!country || !map.get(this._conflictNorm(country))) return;
                n++; if (r >= 1 && r <= 5) { rN++; rSum += r; }
                const a = ai[this._djb2Hash(String(f.t || '').trim())];
                const text = String((a && a.c) || f.t || '').trim();
                if (a && a.q && a.s >= 7 && text.split(/\s+/).length >= 6) {
                    quotes.push({ text, score: a.s, rating: r, course: d.Course || '',
                        country, cadre: (dm && dm.profession && window.Taxonomy && window.Taxonomy.canonProf) ? (window.Taxonomy.canonProf(dm.profession) || '') : '' });
                }
            });
        });
        if (!n) return null;
        // One quote per country first, so the panel is not four comments from Nigeria.
        quotes.sort((a, b) => b.score - a.score || b.rating - a.rating);
        const perCountry = [], used = new Set();
        quotes.forEach(q => { if (!used.has(q.country)) { used.add(q.country); perCountry.push(q); } });
        const top = perCountry.concat(quotes.filter(q => !perCountry.includes(q))).slice(0, 6);
        return { n, avg: rN ? rSum / rN : 0, rated: rN,
            platformAvg: allRN ? allRSum / allRN : 0, platformN: allN, quotes: top };
    },
});

// ── UI blocks for the added cuts ─────────────────────────────────────────────
Object.assign(window.App, {

    _conflictBandsHtml() {
        const b = this.conflictIncomeBands();
        if (!b) return '';
        const fmt = (n) => this.formatNumber(Math.round(n || 0));
        const gap = b.conflict.certRate - b.lowIncome.certRate;
        const row = (label, d, note, colour) => `
            <tr class="border-b border-slate-100 last:border-0">
                <td class="py-2.5 px-4"><span class="inline-flex items-center gap-2"><span class="w-2 h-2 rounded-full" style="background:${colour}"></span><span class="font-semibold text-gsf-prussian">${this.escapeHtml(label)}</span></span><br><span class="text-[11px] text-slate-400 ml-4">${this.escapeHtml(note)}</span></td>
                <td class="py-2.5 px-4 text-right">${fmt(d.learners)}</td>
                <td class="py-2.5 px-4 text-right font-bold" style="color:${colour}">${d.certRate.toFixed(1)}%</td>
                <td class="py-2.5 px-4 text-right text-slate-500">${d.coursesPerLearner.toFixed(2)}</td>
                <td class="py-2.5 px-4 text-right text-slate-500">${fmt(d.minutesPerLearner)}</td>
            </tr>`;
        return `
            <div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-6">
                <div class="p-5 border-b bg-slate-50">
                    <h3 class="text-lg font-bold text-gsf-prussian">Is it conflict, or is it income?</h3>
                    <p class="text-xs text-slate-500 mt-1">Almost every country on the list is low- or lower-middle income, so comparing them with the whole platform confuses two things. The row that matters is the middle one: low-income countries <em>not</em> on the conflict list.</p>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead class="text-slate-500 border-b"><tr>
                            <th class="py-2.5 px-4 text-left font-medium">Group</th>
                            <th class="py-2.5 px-4 text-right font-medium">Learners</th>
                            <th class="py-2.5 px-4 text-right font-medium">Certification rate</th>
                            <th class="py-2.5 px-4 text-right font-medium">Courses / learner</th>
                            <th class="py-2.5 px-4 text-right font-medium">Minutes / learner</th>
                        </tr></thead>
                        <tbody>
                            ${row('Conflict-affected', b.conflict, 'on the list', '#e57373')}
                            ${row('Low income, no conflict', b.lowIncome, 'LIC + LMIC, not on the list', '#B8860B')}
                            ${row('Everywhere else', b.other, 'UMIC + HIC', '#4389C8')}
                        </tbody>
                    </table>
                </div>
                <p class="px-5 py-3 text-xs border-t ${Math.abs(gap) < 5 ? 'text-slate-600 bg-emerald-50/60' : 'text-slate-600'}">
                    Against comparable-income countries the gap is <strong>${gap >= 0 ? '+' : ''}${gap.toFixed(1)} points</strong>, not the
                    ${(b.conflict.certRate - b.other.certRate).toFixed(1)} points the platform average implies.
                    ${Math.abs(gap) < 5 ? 'Most of the apparent shortfall is income, not conflict — and learners in these settings take <strong>more</strong> courses each than either comparison group.' : ''}
                </p>
            </div>`;
    },

    _conflictMomentumHtml(audSnap) {
        const m = this.conflictMomentum(audSnap);
        if (!m) return '';
        const fmt = (n) => this.formatNumber(Math.round(n || 0));
        const mName = (x) => { const d = new Date(x + '-02T12:00:00'); return isNaN(d) ? x : d.toLocaleDateString('en-GB', { month: 'short' }); };
        const label = mName(m.recent[0]) + '–' + mName(m.recent[2]) + ' vs ' + mName(m.prior[0]) + '–' + mName(m.prior[2]);
        const cPct = m.totalPrior ? (m.totalRecent - m.totalPrior) / m.totalPrior * 100 : null;
        const pPct = m.platformPrior ? (m.platformRecent - m.platformPrior) / m.platformPrior * 100 : null;
        const chip = (p) => p == null ? '<span class="text-slate-400">new</span>'
            : `<span class="font-bold ${p >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`;
        const rows = m.rows.slice(0, 12).map(r => `
            <tr class="border-b border-slate-100 last:border-0">
                <td class="py-2 px-4 font-medium text-gsf-prussian">${this.escapeHtml(r.name)}</td>
                <td class="py-2 px-4 text-right text-slate-400">${fmt(r.prior)}</td>
                <td class="py-2 px-4 text-right font-semibold">${fmt(r.recent)}</td>
                <td class="py-2 px-4 text-right">${chip(r.pct)}</td>
            </tr>`).join('');
        return `
            <div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-6">
                <div class="p-5 border-b bg-slate-50 flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <h3 class="text-lg font-bold text-gsf-prussian">Momentum</h3>
                        <p class="text-xs text-slate-500 mt-1">New registered learners, last three complete months against the three before (${this.escapeHtml(label)}). The current month is excluded so a part-month never reads as a fall.</p>
                    </div>
                    <div class="text-right shrink-0">
                        <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">Conflict ${chip(cPct)}</p>
                        <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400 mt-1">Platform ${chip(pPct)}</p>
                    </div>
                </div>
                ${(cPct != null && pPct != null) ? `<p class="px-5 py-2.5 text-xs bg-slate-50/60 border-b text-slate-600">${cPct >= pPct
                    ? 'Conflict settings are growing <strong>at least as fast</strong> as the platform this quarter, so their share is holding or rising.'
                    : 'The platform grew faster than conflict settings this quarter (<strong>' + pPct.toFixed(0) + '%</strong> vs <strong>' + cPct.toFixed(0) + '%</strong>), which is why their share of all learners is falling.'}</p>` : ''}
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead class="text-slate-500 border-b"><tr>
                            <th class="py-2.5 px-4 text-left font-medium">Country</th>
                            <th class="py-2.5 px-4 text-right font-medium">Previous 3 months</th>
                            <th class="py-2.5 px-4 text-right font-medium">Last 3 months</th>
                            <th class="py-2.5 px-4 text-right font-medium">Change</th>
                        </tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>`;
    },

    _conflictGenderHtml() {
        const vr = this.conflictVsRest();
        if (!vr || !vr.gender.conflict.total) return '';
        const bar = (data, colour) => `<div class="flex h-3 rounded-full overflow-hidden bg-slate-100">${data.rows.map((r, i) => `<div style="width:${r.pct}%;background:${i === 0 ? colour : (i === 1 ? colour + '88' : '#cbd5e1')}" title="${this.escapeHtml(r.k)} ${r.pct.toFixed(1)}%"></div>`).join('')}</div>
            <div class="flex flex-wrap gap-x-3 gap-y-1 mt-2">${data.rows.map((r, i) => `<span class="text-[11px] text-slate-500"><span class="inline-block w-2 h-2 rounded-full mr-1" style="background:${i === 0 ? colour : (i === 1 ? colour + '88' : '#cbd5e1')}"></span>${this.escapeHtml(r.k)} <strong class="text-gsf-prussian">${r.pct.toFixed(0)}%</strong></span>`).join('')}</div>`;
        const fem = (d) => (d.rows.find(r => /female/i.test(r.k)) || { pct: 0 }).pct;
        const diff = fem(vr.gender.conflict) - fem(vr.gender.rest);
        return `
            <div class="bg-white p-5 rounded-xl shadow-sm border mb-6">
                <h3 class="text-lg font-bold text-gsf-prussian mb-1">Who signs up — and who doesn't</h3>
                <p class="text-xs text-slate-500 mb-4">Gender of learners with at least one enrolment, observed (not extrapolated). ${Math.abs(diff) >= 8 ? `Women are <strong>${Math.abs(diff).toFixed(0)} points ${diff < 0 ? 'less' : 'more'}</strong> represented in conflict-affected settings than across the rest of the platform.` : 'The split is close to the rest of the platform.'}</p>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                        <p class="text-[10px] font-bold uppercase tracking-wide text-rose-700 mb-1.5">Conflict-affected &middot; ${this.formatNumber(vr.gender.conflict.total)} of ${this.formatNumber(vr.conflictUsers)} stated a gender</p>
                        ${bar(vr.gender.conflict, '#e57373')}
                    </div>
                    <div>
                        <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Rest of the platform &middot; ${this.formatNumber(vr.gender.rest.total)} of ${this.formatNumber(vr.restUsers)} stated a gender</p>
                        ${bar(vr.gender.rest, '#4389C8')}
                    </div>
                </div>
            </div>`;
    },

    _conflictVoicesHtml(snapData) {
        const f = this.conflictFeedback(snapData);
        if (!f) return '';
        const esc = (t) => this.escapeHtml(t);
        const delta = f.avg - f.platformAvg;
        return `
            <div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-6">
                <div class="p-5 border-b bg-slate-50 flex items-start justify-between gap-4 flex-wrap">
                    <div class="min-w-0">
                        <h3 class="text-lg font-bold text-gsf-prussian">What they say</h3>
                        <p class="text-xs text-slate-500 mt-1">${this.formatNumber(f.n)} course-feedback comments from learners in the listed countries, of ${this.formatNumber(f.platformN)} platform-wide.</p>
                    </div>
                    <div class="text-right shrink-0">
                        <p class="text-2xl font-black text-gsf-prussian leading-none">${f.avg.toFixed(2)}</p>
                        <p class="text-[11px] text-slate-400 mt-1">avg rating &middot; platform ${f.platformAvg.toFixed(2)} <span class="${Math.abs(delta) < 0.1 ? 'text-slate-400' : (delta >= 0 ? 'text-emerald-600' : 'text-amber-600')} font-bold">(${delta >= 0 ? '+' : ''}${delta.toFixed(2)})</span></p>
                    </div>
                </div>
                ${f.quotes.length ? `<div class="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
                    ${f.quotes.map(q => `<div class="border border-slate-200 rounded-lg p-4">
                        <p class="text-sm text-slate-700 leading-relaxed">&ldquo;${esc(q.text)}&rdquo;</p>
                        <p class="text-[11px] text-slate-400 mt-2">${esc([q.cadre, q.country].filter(Boolean).join(', '))}${q.course ? ' &middot; ' + esc(q.course) : ''}${q.rating ? ' &middot; <span class="text-amber-500">' + '★'.repeat(Math.round(q.rating)) + '</span>' : ''}</p>
                    </div>`).join('')}
                </div>
                <p class="px-5 pb-4 text-[11px] text-slate-400">Highest-rated comments, one per country before repeats. No names or contact details are stored with a comment.</p>` : ''}
            </div>`;
    },
});

// ── Export ───────────────────────────────────────────────────────────────────
Object.assign(window.App, {
    async exportConflictXlsx() {
        if (this.ensureAnonLoaded) await this.ensureAnonLoaded();
        if (!this._emailDemoMap) { try { this._emailDemoMap = (await Storage.getItem('surghub_email_demo')) || {}; } catch (e) { __swallowed(e); } }
        const aud = (this.userHistory || []).find(d => d.Timestamp === this.selectedDate)
            || (this.userHistory || []).slice().reduce((a, b) => (a && String(a.Timestamp) > String(b.Timestamp) ? a : b), null);
        if (!aud) return alert('No audience data yet — run Sync Learners first.');
        const snap = this.getAnalyticsSnap();
        const b = this.conflictBreakdown(aud);
        const act = this.conflictActivity();
        const mo = this.conflictMomentum(aud);
        const bands = this.conflictIncomeBands();
        const vr = this.conflictVsRest();
        const fb = this.conflictFeedback(snap);
        const tl = this.conflictTimeline(aud);

        const wb = XLSX.utils.book_new();
        const nice = (ws, o) => (this._niceSheet ? this._niceSheet(ws, o) : ws);

        const about = [
            ['SURGhub — reach into conflict-affected settings'],
            ['Generated', new Date().toISOString().slice(0, 10)],
            ['Data through', String(aud.Timestamp || '').slice(0, 10)],
            ['Classification', this.CONFLICT_SOURCE.label + (this.isConflictListCustom() ? ' (edited locally)' : '')],
            ['Effective', this.CONFLICT_SOURCE.effective],
            ['Criterion', this.CONFLICT_SOURCE.criterion],
            ['Source', this.CONFLICT_SOURCE.url],
            [''],
            ['Registered learners (estimate)', b.total],
            ['Share of all registered users', (aud.TotalUsers ? (b.total / aud.TotalUsers * 100).toFixed(1) : '') + '%'],
            ['Countries on the list', this.conflictList().length],
            ['Countries with learners', b.rows.length],
            [''],
            ['TWO BASES — DO NOT MIX', 'Registered learners and the monthly history are EXTRAPOLATED: country is known for ' + (aud.CountryKnownPct != null ? aud.CountryKnownPct : '~72') + '% of users and scaled up to the full base. Enrolments, certificates, learning time, gender and course choice are OBSERVED from the anonymised records and cover only learners with at least one enrolment. Dividing an observed column by an extrapolated one gives a wrong rate.'],
        ];
        if (act) about.push([''], ['Enrolments (observed)', act.enrol], ['Certificates (observed)', act.certs],
            ['Certification rate', act.certRate.toFixed(1) + '%'], ['Platform certification rate', act.platformCertRate.toFixed(1) + '%'],
            ['Learning hours (observed)', Math.round(act.minutes / 60)]);
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.aoa_to_sheet(about), { noFilter: true, widths: [{ wch: 34 }, { wch: 110 }] }), 'Summary');

        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(b.rows.map(r => {
            const a = act && act.per[r.name];
            return { 'Country': r.name, 'Registered learners (est.)': r.n,
                'Share of conflict total': b.total ? +(r.n / b.total * 100).toFixed(1) : 0,
                'Learners with an enrolment (obs.)': a ? a.learners : '', 'Enrolments (obs.)': a ? a.enrol : '',
                'Certificates (obs.)': a ? a.certs : '', 'Certification rate %': a && a.enrol ? +(a.certs / a.enrol * 100).toFixed(1) : '',
                'Learning hours (obs.)': a ? Math.round(a.minutes / 60) : '' };
        }))), 'By country');

        if (mo) XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(mo.rows.map(r => ({
            'Country': r.name, ['Previous 3 months (' + mo.prior.join(', ') + ')']: r.prior,
            ['Last 3 months (' + mo.recent.join(', ') + ')']: r.recent,
            'Change': r.delta, 'Change %': r.pct == null ? 'new' : +r.pct.toFixed(1) })))), 'Momentum');

        if (bands) XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet([
            { Group: 'Conflict-affected (on the list)', ...bands.conflict },
            { Group: 'Low income, not on the list (LIC + LMIC)', ...bands.lowIncome },
            { Group: 'Everywhere else (UMIC + HIC)', ...bands.other },
        ].map(r => ({ Group: r.Group, 'Learners (obs.)': r.learners, 'Enrolments': r.enrol, 'Certificates': r.certs,
            'Certification rate %': +r.certRate.toFixed(1), 'Courses per learner': +r.coursesPerLearner.toFixed(2),
            'Minutes per learner': Math.round(r.minutesPerLearner) })))), 'Income comparison');

        if (vr) XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(
            [].concat(vr.gender.conflict.rows.map(r => ({ Group: 'Conflict-affected', Gender: r.k, Learners: r.n, 'Share %': +r.pct.toFixed(1) })),
                      vr.gender.rest.rows.map(r => ({ Group: 'Rest of the platform', Gender: r.k, Learners: r.n, 'Share %': +r.pct.toFixed(1) }))))), 'Gender');

        if (tl) XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(tl.cumulative.map(p => ({
            Month: p.m, 'Cumulative learners in conflict settings': p.conflict,
            'Cumulative platform learners': p.platform, 'Share of platform %': p.share })))), 'Growth');

        if (fb && fb.quotes.length) XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(fb.quotes.map(q => ({
            Country: q.country, Cadre: q.cadre, Course: q.course, Rating: q.rating || '', Comment: q.text }))), { maxWidth: 90 }), 'Voices');

        const path = await electronAPI.invoke('pick-save-path', 'surghub_conflict_settings_' + new Date().toISOString().split('T')[0] + '.xlsx');
        if (!path) return;
        this._writeWorkbook(wb, path);
        this.showMsg('Saved ' + b.rows.length + ' countries → ' + path.split('/').pop());
    },
});

Object.assign(window.App, {
    // Click a header to sort the country table; click the same one again to reverse.
    _sortConflictTable(col) {
        const cur = this._conflictSort || { col: 'n', dir: 'desc' };
        // Text sorts A→Z first; numbers sort biggest-first first — what you expect
        // of each without having to click twice.
        this._conflictSort = (cur.col === col)
            ? { col, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
            : { col, dir: col === 'name' ? 'asc' : 'desc' };
        this.renderView();
    },

    // Which countries the "Growth by country" chart draws. Reuses the app's own
    // category selector (checkbox to remove, dropdown to add) so it behaves
    // exactly like the one on the Geography tab.
    _conflictCountrySelector(audSnap) {
        const t = this.conflictTimeline(audSnap);
        if (!t) return '';
        const all = Object.keys(t.byCountry)
            .sort((a, b) => Object.values(t.byCountry[b]).reduce((s, v) => s + v, 0) - Object.values(t.byCountry[a]).reduce((s, v) => s + v, 0));
        if (!all.length) return '';
        return this.buildCategorySelector(all, this.selectedConflictCountries || [], 'selectedConflictCountries',
            'chart_conflict_countries', 'ConflictCountryTimeline', 8);
    },
});
