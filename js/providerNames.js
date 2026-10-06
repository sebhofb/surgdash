// ── Provider names corrected after the fact ─────────────────────────────────
//
// Provider names come from the team's provider map: a SharePoint Excel file that is
// uploaded under Data Sync and applied to new courses on every sync. A misspelling
// there spreads to every page, report, export and the Google Sheet. A correction
// listed here is applied in two places:
//   1. _matchProvider (updater.js) returns the corrected name, so neither a sync nor a
//      re-upload of an old copy of the map can bring the misspelling back;
//   2. applyProviderNameFixes() renames what is already stored, at start-up: the course
//      records, the provider map, the testimonial picks and AI summaries kept per
//      provider, the excluded-providers list, and this device's last weekly digest.
// Correct the SharePoint file as well; this list is the safety net.
Object.assign(window.App, {

    PROVIDER_NAME_FIXES: [
        ['CANESCA', 'CANECSA'],     // October 2026: two letters were swapped in the provider map
    ],

    _providerFixKey(s) {
        return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, '');
    },

    // The correct spelling of a provider's name. Matches the WHOLE name (case, spacing and
    // punctuation aside), so a different provider that merely contains it is left alone.
    fixProviderName(name) {
        if (name == null || name === '') return name;
        const k = this._providerFixKey(name);
        for (const [wrong, right] of (this.PROVIDER_NAME_FIXES || [])) {
            if (k === this._providerFixKey(wrong)) return right;
        }
        return name;
    },

    // Free text, such as an AI summary: the misspelling as a whole word, in any case.
    _fixProviderText(text) {
        let t = String(text);
        for (const [wrong, right] of (this.PROVIDER_NAME_FIXES || [])) {
            const esc = wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            t = t.replace(new RegExp('\\b' + esc + '\\b', 'gi'), right);
        }
        return t;
    },

    // Rows of the provider map ({'All Courses', 'Providers'}, or whatever the second
    // column is called, as _matchProvider reads it). Fixed in place; returns how many.
    _fixProviderMapRows(rows) {
        let n = 0;
        (Array.isArray(rows) ? rows : []).forEach(r => {
            if (!r || typeof r !== 'object') return;
            const col = ('Providers' in r) ? 'Providers' : Object.keys(r)[1];
            if (!col || !r[col]) return;
            const f = this.fixProviderName(r[col]);
            if (f !== r[col]) { r[col] = f; n++; }
        });
        return n;
    },

    // Two pick lists for the same provider (old and new spelling): keep both.
    _mergeProviderPicks(keep, extra) {
        if (keep == null) return extra;
        if (extra == null) return keep;
        if (Array.isArray(keep) && Array.isArray(extra)) return [...new Set(keep.concat(extra))];
        if (typeof keep === 'object' && typeof extra === 'object') return Object.assign({}, extra, keep);
        return keep;
    },

    // Rename what is stored. Safe to run on every start: it writes only what changed.
    // Writes are internal, so a viewer's screen gets no "unsynced changes" banner and its
    // auto-pull is not held back; on the editor's machine, Sync to Sheets carries the fix
    // to everyone else.
    async applyProviderNameFixes() {
        const out = { records: 0, map: 0, testimonials: 0, summaries: 0, excluded: 0, digest: 0 };
        if (!(this.PROVIDER_NAME_FIXES || []).length) return out;
        const save = (key, value) => Storage.setItem(key, value, { internal: true });
        const read = async (key) => { try { return await Storage.getItem(key); } catch (e) { __swallowed(e, 'providerNames.read'); return null; } };

        // Course records, in memory and on disk.
        if (Array.isArray(this.data)) {
            this.data.forEach(d => {
                if (!d || !d.Provider) return;
                const f = this.fixProviderName(d.Provider);
                if (f !== d.Provider) { d.Provider = f; out.records++; }
            });
            if (out.records) await save('surghub_data', this.data);
        }

        // The provider map, so "Apply to existing courses" and the next sync agree.
        const pm = await read('surgdash_provider_map');
        out.map = this._fixProviderMapRows(pm);
        if (out.map) await save('surgdash_provider_map', pm);

        // Testimonial picks, kept per provider.
        const sel = await read('surghub_selected_testimonials');
        if (sel && typeof sel === 'object' && !Array.isArray(sel)) {
            Object.keys(sel).forEach(k => {
                const f = this.fixProviderName(k);
                if (f === k) return;
                sel[f] = this._mergeProviderPicks(sel[f], sel[k]);
                delete sel[k];
                out.testimonials++;
            });
            if (out.testimonials) await save('surghub_selected_testimonials', sel);
        }

        // AI summaries: kept under '@provider:NAME', and the name also appears in the text.
        const sum = await read('surghub_feedback_summaries');
        if (sum && typeof sum === 'object' && !Array.isArray(sum)) {
            Object.keys(sum).forEach(k => {
                let key = k;
                if (k.indexOf('@provider:') === 0) {
                    const fixed = '@provider:' + this.fixProviderName(k.slice('@provider:'.length));
                    if (fixed !== k) {
                        if (!sum[fixed]) sum[fixed] = sum[k];
                        delete sum[k];
                        key = fixed;
                        out.summaries++;
                    }
                }
                const v = sum[key];
                if (v && typeof v.s === 'string') {
                    const s = this._fixProviderText(v.s);
                    if (s !== v.s) { v.s = s; out.summaries++; }
                }
            });
            if (out.summaries) {
                await save('surghub_feedback_summaries', sum);
                if (this._feedbackSummaries) this._feedbackSummaries = sum;
            }
        }

        // Providers excluded from analytics.
        const ex = await read('surghub_excluded_providers');
        if (Array.isArray(ex)) {
            const fixed = [...new Set(ex.map(p => this.fixProviderName(p)))];
            out.excluded = ex.filter((p, i) => this.fixProviderName(p) !== p).length;
            if (out.excluded) {
                await save('surghub_excluded_providers', fixed);
                if (this._excludedProviders instanceof Set) this._excludedProviders = new Set(fixed);
            }
        }

        // This device's last weekly digest, so next week's comparison lines up.
        const dg = await read('surgdash_digest');
        if (dg && typeof dg === 'object') {
            ['courses', 'providers'].forEach(list => (Array.isArray(dg[list]) ? dg[list] : []).forEach(row => {
                if (row && row.provider) { const f = this.fixProviderName(row.provider); if (f !== row.provider) { row.provider = f; out.digest++; } }
            }));
            if (out.digest) await save('surgdash_digest', dg);
        }

        const total = Object.values(out).reduce((s, v) => s + v, 0);
        if (total) console.log('[providerNames] renamed:', JSON.stringify(out));
        return out;
    },
});
