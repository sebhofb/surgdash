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
        const active = new Set(this.conflictList().map(c => c.iso3 || c.wb));
        const pct = (aud && aud.TotalUsers) ? (b.total / aud.TotalUsers * 100).toFixed(1) : null;

        const chips = b.rows.map(r => `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-rose-50 text-rose-800 border border-rose-200">${esc(r.name)} <strong>${this.formatNumber(r.n)}</strong></span>`).join(' ');
        const none = b.unmatched.length
            ? `<p class="text-xs text-slate-400 mt-2">No learners recorded from: ${b.unmatched.map(esc).join(', ')}.</p>` : '';

        // Editor: every World Bank country as a toggle, plus anything the user added.
        const extra = this.conflictList().filter(c => !this.CONFLICT_DEFAULT.some(d => d.iso3 === c.iso3 && d.wb === c.wb));
        const toggle = (c, isExtra) => {
            const on = active.has(c.iso3 || c.wb);
            return `<button onclick="App.toggleConflictCountry('${this.escapeJsArg(c.iso3 || c.wb)}')"
                class="px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${on ? 'bg-gsf-boston text-white border-gsf-boston' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'}"
                title="${on ? 'Counted — click to exclude' : 'Not counted — click to include'}">${esc(c.wb)}${isExtra ? ' *' : ''}</button>`;
        };

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

                <div data-edit-only class="border-t border-slate-200 pt-4 mt-4">
                    <div class="flex items-center justify-between flex-wrap gap-2 mb-2">
                        <p class="text-xs font-bold uppercase tracking-wide text-slate-500">Edit the list</p>
                        <div class="flex items-center gap-2">
                            <button onclick="App.addConflictCountry()" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-600 hover:text-gsf-prussian hover:bg-slate-50">+ Add a country</button>
                            ${custom ? '<button onclick="App.resetConflictList()" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-amber-300 text-amber-700 hover:bg-amber-50">Reset to World Bank list</button>' : ''}
                        </div>
                    </div>
                    <p class="text-xs text-slate-500 mb-3">Click a country to include or exclude it. Blue = counted. Changes are saved on this machine and travel with your Google Sheets backup; the KPI and its tooltip update immediately and say when the list has been edited.</p>
                    <div class="flex flex-wrap gap-1.5">
                        ${this.CONFLICT_DEFAULT.map(c => toggle(c, false)).join('')}
                        ${extra.map(c => toggle(c, true)).join('')}
                    </div>
                    ${extra.length ? '<p class="text-[11px] text-slate-400 mt-2">* added by you — outside the World Bank list.</p>' : ''}
                </div>
            </div>`;
    },
});
