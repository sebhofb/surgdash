// ── Device-local persistence of view preferences ──────────────────────────────
// Remembers the things people re-set every launch: the dashboard tab, the
// partial-month toggle, chart widths, trim/drama toggles, timeline ranges, the
// category pickers on the growth charts, the physician/nurse reach options.
//
// Stored at settings/ui_state.json (key surgdash_ui_state). The key is
// deliberately ABSENT from storage.js's reverse map, so it is never enumerated
// by Storage.keys() — never pushed to Sheets, never in an export, never restored
// onto another machine. Same pattern as surgdash_autopull_enabled.
//
// Mechanism — zero call-site changes:
//   • scalar prefs become accessor properties on App, so every existing
//     `App.includePartialMonth = this.checked` style write persists itself;
//   • object/array prefs (chart widths, selection arrays, option bags) are
//     mutated in place by existing code, so they are snapshotted at the top of
//     renderView(), which every interaction ends in.
// Writes are debounced (400 ms) and skipped when nothing changed.
// This file must load AFTER every module that declares one of these props.
Object.assign(window.App, {
    _UI_STATE_KEY: 'surgdash_ui_state',

    _UI_SCALARS: [
        'includePartialMonth', '_dashTab',
        'userGrowthTrim', 'userGrowthRange',
        'activityGrowthTrim', 'careerGrowthTrim', 'topicGrowthTrim', 'ambGrowthTrim',
        'countryTimelineRange', 'profTimelineRange', 'activityTimelineRange',
        'careerTimelineRange', 'topicTimelineRange', 'ambassadorsTimelineRange',
        'joinersPeriodDays',
        'instThreshold', 'instMonths', 'instShowPersonal', 'instViewMode',
        'cmpPreset', 'cmpAStart', 'cmpAEnd', 'cmpBStart', 'cmpBEnd', 'cmpCohortMode', 'cmpCohortDomain',
        'anomalyCollapsed',
    ],
    _UI_OBJECTS: [
        '_chartWidth',
        'selectedCountries', 'selectedProfessions', 'selectedAmbassadors',
        'selectedActivities', 'selectedCareerStages', 'selectedTopics',
        '_physReachOpts', '_nurseReachOpts',
        'selectedInstitutions', '_instSort',
    ],

    _uiState: null,          // null until _loadUiState() — accessors fall back to live values
    _uiDefaults: {},
    _uiSaveTimer: null,
    _uiLastJson: '',
    _uiAccessorsInstalled: false,

    _installUiStateAccessors() {
        if (this._uiAccessorsInstalled) return;
        this._uiAccessorsInstalled = true;
        const self = this;
        for (const p of this._UI_SCALARS) {
            const own = Object.getOwnPropertyDescriptor(this, p);
            if (own && (own.get || own.set)) continue;           // already an accessor — leave it
            this._uiDefaults[p] = this[p];
            let live = this[p];
            Object.defineProperty(this, p, {
                configurable: true, enumerable: true,
                get() { return (self._uiState && Object.prototype.hasOwnProperty.call(self._uiState, p)) ? self._uiState[p] : live; },
                set(v) { live = v; if (self._uiState) { self._uiState[p] = v; self._saveUiState(); } },
            });
        }
        for (const p of this._UI_OBJECTS) {
            try { this._uiDefaults[p] = this[p] === undefined ? undefined : JSON.parse(JSON.stringify(this[p])); }
            catch (e) { this._uiDefaults[p] = undefined; }
        }
    },

    async _loadUiState() {
        let v = null;
        try { v = await Storage.getItem(this._UI_STATE_KEY); } catch (e) { __swallowed(e, 'uiState.load'); }
        this._uiState = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
        // Objects are applied onto App directly (existing code mutates them in place).
        for (const p of this._UI_OBJECTS) {
            if (this._uiState[p] != null) {
                try { this[p] = JSON.parse(JSON.stringify(this._uiState[p])); } catch (e) { __swallowed(e, 'uiState.apply'); }
            }
        }
        // Scalars are served straight from _uiState by the accessors.
        this._uiLastJson = JSON.stringify(this._uiState);
    },

    // Called at the top of renderView(): capture in-place mutations of object prefs.
    _snapshotUiState() {
        if (!this._uiState) return;
        for (const p of this._UI_OBJECTS) {
            const v = this[p];
            if (v !== undefined) this._uiState[p] = v;
        }
        this._saveUiState();
    },

    _saveUiState() {
        if (!this._uiState) return;
        clearTimeout(this._uiSaveTimer);
        this._uiSaveTimer = setTimeout(async () => {
            try {
                const json = JSON.stringify(this._uiState);
                if (json === this._uiLastJson) return;
                this._uiLastJson = json;
                await Storage.setItem(this._UI_STATE_KEY, JSON.parse(json));
            } catch (e) { __swallowed(e, 'uiState.save'); }
        }, 400);
    },

    // "Reset view preferences": back to shipped defaults on this device.
    async resetUiState() {
        this._uiState = {};
        for (const p of this._UI_SCALARS) this[p] = this._uiDefaults[p];
        for (const p of this._UI_OBJECTS) {
            const d = this._uiDefaults[p];
            this[p] = d === undefined ? undefined : JSON.parse(JSON.stringify(d));
        }
        this._uiState = {};
        this._uiLastJson = '';
        clearTimeout(this._uiSaveTimer);
        try { await Storage.setItem(this._UI_STATE_KEY, {}); } catch (e) { __swallowed(e, 'uiState.reset'); }
        if (this.renderView) this.renderView();
    },

    _resetUiStateBtn() {
        return `<button data-viewer-allowed onclick="App.resetUiState()" title="Forget remembered view preferences on this device — dashboard tab, chart widths, toggles, pickers" class="px-2 py-0.5 text-[10px] font-bold rounded text-slate-400 hover:bg-slate-100 hover:text-gsf-boston border border-slate-200">↺ Reset view preferences</button>`;
    },
});

window.App._installUiStateAccessors();
