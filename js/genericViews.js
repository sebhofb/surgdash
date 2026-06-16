window.GenericViews = {

    // Module-level stores (avoid passing large objects through onclick attributes)
    _entries: {},          // id → {kind, obj, color} — used by calendar
    _currentEvents: [],    // events for the currently-rendered project dashboard
    _currentProjectId: null,
    _orgMultiYearData: null,    // cached for lightweight chart-only refresh
    _dashMultiYearData: null,

    // ===== HELPERS =====

    _fmt(n) { return n !== null && n !== undefined ? new Intl.NumberFormat('en-US').format(n) : '—'; },

    // Format an activity/event date, showing a range when an endDate is present.
    // e.g. "2024-04-15" or "2024-04-15 – 2024-04-18".
    _fmtEventDate(e) {
        const start = e && e.date ? String(e.date) : '';
        const end   = e && e.endDate ? String(e.endDate) : '';
        if (!start) return '';
        if (end && end !== start) return `${start} – ${end}`;
        return start;
    },

    // Read-only banner shown at the top of editable views when the app is in viewer mode.
    // `message` overrides the default copy. Returns empty string when edit mode is unlocked.
    _viewerNotice(message) {
        if (window.App && App.editUnlocked) return '';
        const msg = message || 'This view is read-only. Unlock editing to make changes.';
        return `
            <div class="mb-6 flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg" data-viewer-notice>
                <div class="shrink-0 mt-0.5 text-amber-600"><i data-lucide="lock" width="14"></i></div>
                <div class="flex-1 min-w-0">
                    <p class="text-xs font-bold uppercase tracking-wide text-amber-700">View-only mode</p>
                    <p class="text-sm text-amber-700 leading-snug">${App.escapeHtml(msg)}</p>
                </div>
                <button onclick="App.showUnlockPrompt()" class="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 transition-colors">
                    <i data-lucide="unlock" width="12"></i> Unlock editing
                </button>
            </div>`;
    },

    // Build chart filter controls HTML (year toggles + series toggles)
    // prefix = unique string for button onclick scoping (e.g. 'proj' or 'org')
    _buildChartControls(multiYearData, prefix) {
        if (!multiYearData || multiYearData.length === 0) return '';
        const hiddenYears  = App._chartHiddenYears  || [];
        const showTargets  = App._chartShowTargets  !== false;
        const showActuals  = App._chartShowActuals  !== false;
        const yearBtns = multiYearData.map(r => {
            const hidden = hiddenYears.includes(r.year);
            return `<button onclick="GenericViews._toggleChartYear(${r.year}, '${prefix}')"
                class="px-2.5 py-1 rounded text-xs font-semibold border transition-all ${hidden ? 'bg-white text-slate-400 border-slate-200' : 'bg-gsf-prussian/90 text-white border-transparent'}">${r.year}</button>`;
        }).join('');
        const actBtn = `<button onclick="GenericViews._toggleChartSeries('actuals','${prefix}')"
            class="px-2.5 py-1 rounded text-xs font-semibold border transition-all ${showActuals ? 'bg-gsf-boston text-white border-transparent' : 'bg-white text-slate-400 border-slate-200'}">■ Actuals</button>`;
        const tgtBtn = `<button onclick="GenericViews._toggleChartSeries('targets','${prefix}')"
            class="px-2.5 py-1 rounded text-xs font-semibold border transition-all ${showTargets ? 'bg-slate-500 text-white border-transparent' : 'bg-white text-slate-400 border-slate-200'}">— Targets</button>`;
        return `<div class="flex items-center gap-1.5 flex-wrap mb-4">
            <span class="text-[10px] text-slate-400 uppercase font-bold mr-1">Years:</span>${yearBtns}
            <span class="w-px h-4 bg-slate-200 mx-1"></span>
            ${actBtn}${tgtBtn}
        </div>`;
    },

    // Remove the topmost displayed year column. Just decrements App.kpiYearMax —
    // any underlying data in the removed year stays on disk and reappears if the
    // user re-adds the year with the + button.
    _removeLastYear() {
        const now = new Date();
        const minYear = now.getFullYear() + 1;
        const yearMax = App.kpiYearMax != null ? Math.max(App.kpiYearMax, minYear) : minYear;
        if (yearMax <= minYear) {
            if (App.showMsg) App.showMsg(`Already at minimum (${minYear}) — cannot remove further.`);
            return;
        }
        App.kpiYearMax = yearMax - 1;
        if (App.kpiYear === yearMax) App.kpiYear = yearMax - 1;
        App.renderView();
    },

    _toggleChartYear(year, prefix) {
        if (!App._chartHiddenYears) App._chartHiddenYears = [];
        const idx = App._chartHiddenYears.indexOf(year);
        if (idx >= 0) App._chartHiddenYears.splice(idx, 1);
        else App._chartHiddenYears.push(year);
        // 'all' year mode: KPI cards also change — need full re-render
        if (App.kpiYear === 'all') { App.renderView(); return; }
        GenericViews._refreshCharts(prefix);
    },

    _toggleChartSeries(series, prefix) {
        if (series === 'targets') App._chartShowTargets = !(App._chartShowTargets !== false);
        else                      App._chartShowActuals = !(App._chartShowActuals !== false);
        GenericViews._refreshCharts(prefix);
    },

    // Lightweight chart refresh — updates controls HTML and redraws charts without a full renderView()
    _refreshCharts(prefix) {
        const multiYearData = prefix === 'org'  ? GenericViews._orgMultiYearData
                            : prefix === 'dash' ? GenericViews._dashMultiYearData
                            : null;
        if (!multiYearData) { App.renderView(); return; }
        const ctrlEl = document.getElementById(prefix + '-chart-controls');
        if (ctrlEl) ctrlEl.innerHTML = GenericViews._buildChartControls(multiYearData, prefix);
        const idPrefix = prefix === 'org' ? 'org-chart-' : 'dash-chart-';
        GenericCharts.drawOrgYearlyProgress(multiYearData, null, idPrefix, GenericViews._getChartFilters());
    },

    _getChartFilters() {
        return {
            hiddenYears:  new Set(App._chartHiddenYears || []),
            showTargets:  App._chartShowTargets !== false,
            showActuals:  App._chartShowActuals !== false
        };
    },

    _isProjectActiveForYear(project, year) {
        if (project.startDate) {
            const startYear = new Date(project.startDate).getFullYear();
            if (year < startYear) return false;
        }
        if (project.endDate) {
            const endYear = new Date(project.endDate).getFullYear();
            if (year > endYear) return false;
        }
        return true;
    },

    // Normalise a date value to ISO YYYY-MM-DD, regardless of input format.
    // Handles:
    //   - Already-ISO strings: '2026-02-28' → unchanged
    //   - JS Date.toString() output: 'Sat Feb 28 2026 00:00:00 GMT+0100 (...)' (Google Sheets
    //     auto-converts text that looks like a date into a Date cell, so when Apps Script
    //     reads it back it becomes this verbose format)
    //   - Anything else parseable by Date()
    //   - Empty / null / falsy → '' so the date input shows as empty
    _normaliseDateStr(val) {
        if (!val) return '';
        const s = String(val).trim();
        if (!s) return '';
        // Fast path — already ISO YYYY-MM-DD or YYYY-MM-DDT...
        const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
        // Try Date parsing (covers "Sat Feb 28 2026 ...", "2/28/2026", etc.)
        const d = new Date(s);
        if (!isNaN(d.getTime())) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }
        return s; // give up — leave as-is
    },
    // Sanitise an array of items that have a `date` field
    _normaliseDates(items) {
        if (!Array.isArray(items)) return items;
        return items.map(it => {
            if (!it) return it;
            const out = { ...it };
            if (out.date)    out.date    = this._normaliseDateStr(out.date);
            if (out.endDate) out.endDate = this._normaliseDateStr(out.endDate);
            return out;
        });
    },

    _eventTypeBadge(type) {
        // Map legacy types so old data still renders sensibly
        const legacyMap = { facility: 'other', patients: 'other', estimate: 'other' };
        const effective = legacyMap[type] || type;
        const et = Projects.EVENT_TYPES[effective] || Projects.EVENT_TYPES.other;
        if (!et) return '';
        const bg = { workshop: 'bg-blue-100 text-blue-800', mentoring: 'bg-purple-100 text-purple-800', other: 'bg-slate-100 text-slate-700' };
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${bg[effective] || 'bg-slate-100 text-slate-700'}"><i data-lucide="${et.icon}" width="10"></i>${et.label}</span>`;
    },

    _kpiContribsSummary(event) {
        const parts = [];
        if (event.hcw_count)            parts.push(`<span class="text-blue-700">${this._fmt(event.hcw_count)} HCW</span>`);
        if (event.patient_count)        parts.push(`<span class="text-red-700">${this._fmt(event.patient_count)} patients</span>`);
        if (event.facilities_count)     parts.push(`<span class="text-amber-700">${this._fmt(event.facilities_count)} facilities</span>`);
        if (event.population)           parts.push(`<span class="text-emerald-700">${this._fmt(event.population)} pop.</span>`);
        if (event.patient_estimate)     parts.push(`<span class="text-slate-500">est. ${this._fmt(event.patient_estimate)} patients</span>`);
        if (event.population_estimate)  parts.push(`<span class="text-slate-500">est. ${this._fmt(event.population_estimate)} pop.</span>`);
        return parts.join(' · ');
    },

    // ===== DASHBOARD =====
    async renderDashboard(main, project) {
        const now  = new Date();
        const year = App.kpiYear === 'all' ? 'all' : (App.kpiYear || now.getFullYear());
        const [events, updates, allTargets, allActuals, qualityData, appSettings, allQualityKpis, allBudget] = await Promise.all([
            Projects.getEvents(project.id),
            Projects.getUpdates(project.id),
            Projects.getTargets(project.id),
            Projects.getActuals(project.id),
            Projects.getQualityData(project.id),
            Projects.getAppSettings(),
            Projects.getAllQualityKpis(),
            Projects.getBudget(project.id)
        ]);

        // Store for modal access (avoid passing large objects through onclick strings)
        this._currentEvents = events;
        this._currentProjectId = project.id;

        const isAllYear = year === 'all';
        const multiplierEnabled = project.hcwMultiplierEnabled && App.showHcwMultiplier;
        const multiplierRate    = project.hcwMultiplierRate !== undefined ? project.hcwMultiplierRate : 10;

        let targets = {}, yearTotals = {};
        if (isAllYear) {
            // Project-level all-time: stock KPIs (population, facilities) take the
            // max across years; flow KPIs sum. Matches the org roll-up + export.
            yearTotals = Projects.rollupAllYears(allActuals);
            targets    = Projects.rollupAllYears(allTargets);
        } else {
            targets    = { ...Projects.getTargetsForYear(allTargets, year) };
            yearTotals = { ...Projects.getActualsForYear(allActuals, year) };
        }

        // Apply HCW multiplier to actuals + targets
        if (multiplierEnabled) {
            if (yearTotals.hcw_strengthened) yearTotals.hcw_strengthened = Math.round(yearTotals.hcw_strengthened * multiplierRate);
            if (targets.hcw_strengthened)    targets.hcw_strengthened    = Math.round(targets.hcw_strengthened    * multiplierRate);
        }

        const yearEvents    = isAllYear ? events : events.filter(e => e.date.startsWith(String(year)));
        const recentEvents  = yearEvents.slice(0, 5);
        const recentUpdates = updates.slice(0, 3);
        // Combined timeline (events + milestones, sorted by date desc)
        const recentActivities = [
            ...yearEvents.map(e => ({ ...e, _kind: 'event' })),
            ...updates.map(u => ({ ...u, _kind: 'update' })),
        ].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 8);

        // Year selector
        const years = [];
        const yearMax = App.kpiYearMax != null ? Math.max(App.kpiYearMax, now.getFullYear() + 1) : now.getFullYear() + 1;
        for (let y = 2022; y <= yearMax; y++) years.push(y);
        const yearSelector = years.map(y =>
            `<button onclick="App.kpiYear=${y}; App.renderView()" class="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${y === year ? 'bg-gsf-boston text-white' : 'text-slate-500 hover:bg-slate-100'}">${y}</button>`
        ).join('') +
        `<span class="w-px h-5 bg-slate-300 mx-1 inline-block align-middle"></span>` +
        `<button onclick="App.kpiYear='all'; App.renderView()" class="ml-0.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${isAllYear ? 'bg-gsf-prussian text-white shadow-sm' : 'text-gsf-prussian bg-gsf-prussian/10 hover:bg-gsf-prussian/20'}" title="All-time totals across every year"><span class="text-[10px] ${isAllYear ? 'opacity-90' : 'opacity-70'}">★</span> All time</button>` +
        `<button onclick="App.kpiYearMax=${yearMax + 1}; App.renderView()" class="px-2.5 py-1.5 rounded-lg text-sm font-semibold text-slate-400 hover:bg-slate-100" title="Add future year">+</button><button onclick="GenericViews._removeLastYear()" class="px-2.5 py-1.5 rounded-lg text-sm font-semibold text-slate-400 hover:bg-red-50 hover:text-red-500" title="Remove the topmost year (only allowed if it has no data)">−</button>`;

        // KPI-id → event field that contributes to it. Used both for the card's event count
        // and for the click-through detail modal — keep these in sync to avoid the
        // "card says N events, modal says 0" mismatch.
        const KPI_EVENT_FIELD = { hcw_strengthened: 'hcw_count', patients_reached: 'patient_count', facilities_strengthened: 'facilities_count', population_access: 'population' };

        const kpiCards = Projects.STANDARD_KPIS.map(kpi => {
            const current = yearTotals[kpi.id] || 0;
            const target  = targets[kpi.id] || 0;
            const pct     = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : null;
            const evField = KPI_EVENT_FIELD[kpi.id];
            const contribPool = isAllYear ? events : yearEvents;
            const contribCount = evField ? contribPool.filter(e => Number(e[evField]) > 0).length : 0;
            // Use hex alpha suffixes for tinted shades of the KPI's own colour.
            // 0D ≈ 5% opacity (gradient wash) · 1A ≈ 10% (icon bg, track) · 33 ≈ 20% (border, divider)
            return `
            <div class="rounded-xl p-5 border cursor-pointer hover:shadow-lg transition-shadow group relative overflow-hidden"
                 style="background: linear-gradient(135deg, ${kpi.color}0D, #ffffff 65%); border-color: ${kpi.color}33"
                 onclick="GenericViews._showKpiDetail('${kpi.id}', ${isAllYear ? now.getFullYear() : year})">
                <div class="absolute top-0 left-0 right-0 h-1" style="background: ${kpi.color}"></div>
                <p class="text-[10px] font-black uppercase tracking-wider leading-tight mb-0.5" style="color:${kpi.color}">${kpi.nameBig || kpi.name}</p>
                ${kpi.nameSub ? `<p class="text-[10px] text-slate-500 font-medium leading-tight mb-3">${kpi.nameSub}</p>` : '<div class="mb-3"></div>'}
                <div class="flex items-baseline gap-2 mb-3">
                    <span class="text-4xl font-black tabular-nums" style="color:${kpi.color}">${this._fmt(current)}</span>
                    <span class="text-[11px] font-medium" style="color:${kpi.color}; opacity:0.55">${isAllYear ? 'all time' : 'in ' + year}</span>
                </div>
                ${target > 0 ? `
                    <div>
                        <div class="flex justify-between items-baseline text-[10px] mb-1.5">
                            <span class="text-slate-500">Target: <strong class="text-slate-700 tabular-nums">${this._fmt(target)}</strong></span>
                            <span class="font-black text-sm tabular-nums opacity-0 group-hover:opacity-100 transition-opacity" style="color:${kpi.color}">${pct}%</span>
                        </div>
                        <div class="w-full h-1.5 rounded-full overflow-hidden" style="background: ${kpi.color}1A">
                            <div class="h-full rounded-full transition-all" style="width:${pct}%; background:${kpi.color}"></div>
                        </div>
                    </div>
                ` : `<p class="text-[10px] text-slate-400 italic">${isAllYear ? 'No targets set' : 'No target set for ' + year}</p>`}
                <p class="text-[10px] font-medium mt-3 pt-2.5 border-t" style="border-color: ${kpi.color}26; color: ${kpi.color}; opacity: 0.75">
                    ${contribCount} contributing event${contribCount !== 1 ? 's' : ''}${isAllYear ? ' total' : ' this year'}
                </p>
            </div>`;
        }).join('');

        const eventRows = recentEvents.map(e => `
            <div onclick="GenericViews._showActivityDetail('${project.id}','event','${e.id}')" class="flex items-start gap-3 py-2.5 border-b border-slate-50 last:border-0 cursor-pointer hover:bg-slate-50 -mx-2 px-2 rounded transition-colors">
                <div class="text-[10px] text-slate-400 w-16 shrink-0 pt-0.5">${this._fmtEventDate(e)}</div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-0.5 flex-wrap">
                        ${this._eventTypeBadge(e.type)}
                        <span class="text-sm font-semibold text-slate-800 truncate">${App.escapeHtml(e.title || '')}</span>
                    </div>
                    <p class="text-xs text-slate-500">${this._kpiContribsSummary(e)}</p>
                </div>
            </div>`).join('');

        const updateRows = recentUpdates.map(u => `
            <div onclick="GenericViews._showActivityDetail('${project.id}','update','${u.id}')" class="border-l-2 pl-4 py-2 cursor-pointer hover:bg-slate-50 -mr-2 pr-2 rounded transition-colors" style="border-color:${project.color}">
                <p class="text-xs text-slate-400">${u.date}</p>
                <p class="text-sm font-semibold text-slate-800">${App.escapeHtml(u.title)}</p>
                ${u.body ? `<p class="text-xs text-slate-500 mt-0.5 line-clamp-2">${App.escapeHtml(u.body)}</p>` : ''}
            </div>`).join('');

        // Unified activity rows — events + milestones in one chronological timeline
        const activityRows = recentActivities.map(a => {
            if (a._kind === 'update') {
                return `<div onclick="GenericViews._showActivityDetail('${project.id}','update','${a.id}')" class="flex items-start gap-3 py-2.5 border-b border-slate-50 last:border-0 cursor-pointer hover:bg-slate-50 -mx-2 px-2 rounded transition-colors">
                    <div class="text-[10px] text-slate-400 w-16 shrink-0 pt-0.5">${a.date}</div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-purple-100 text-purple-700"><i data-lucide="flag" width="9"></i> Milestone</span>
                            <span class="text-sm font-semibold text-slate-800 truncate">${App.escapeHtml(a.title || '')}</span>
                        </div>
                        ${a.body ? `<p class="text-xs text-slate-500 line-clamp-1">${App.escapeHtml(a.body)}</p>` : ''}
                    </div>
                </div>`;
            }
            return `<div onclick="GenericViews._showActivityDetail('${project.id}','event','${a.id}')" class="flex items-start gap-3 py-2.5 border-b border-slate-50 last:border-0 cursor-pointer hover:bg-slate-50 -mx-2 px-2 rounded transition-colors">
                <div class="text-[10px] text-slate-400 w-16 shrink-0 pt-0.5">${this._fmtEventDate(a)}</div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-0.5 flex-wrap">
                        ${this._eventTypeBadge(a.type)}
                        <span class="text-sm font-semibold text-slate-800 truncate">${App.escapeHtml(a.title || '')}</span>
                    </div>
                    <p class="text-xs text-slate-500">${this._kpiContribsSummary(a)}</p>
                </div>
            </div>`;
        }).join('');

        main.innerHTML = `
            <div class="p-6 md:p-10 fade-in w-full max-w-6xl mx-auto">
                <header class="mb-6 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div class="px-5 py-4 flex items-start justify-between gap-4 flex-wrap" style="background:linear-gradient(135deg, ${project.color}08 0%, transparent 60%)">
                        <div class="flex items-center gap-3 min-w-0 flex-1">
                            <div class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-sm" style="background:${project.color}; box-shadow:0 2px 8px ${project.color}30">
                                <i data-lucide="${project.icon || 'folder'}" width="22" style="color:white"></i>
                            </div>
                            <div class="min-w-0">
                                <h1 class="text-xl font-bold text-gsf-prussian truncate">${App.escapeHtml(project.name)}</h1>
                                ${project.description ? `<p class="text-xs text-slate-500 mt-0.5 line-clamp-2">${App.escapeHtml(project.description)}</p>` : ''}
                            </div>
                        </div>
                        <div class="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1 shrink-0">${yearSelector}</div>
                    </div>
                    <div class="border-t border-slate-100 px-5 py-2 flex items-center gap-2 flex-wrap bg-slate-50/50">
                        <button data-edit-only onclick="GenericViews._exportProjectSnapshot('${project.id}', ${isAllYear ? "'all'" : year})" class="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold text-gsf-boston hover:bg-gsf-boston hover:text-white transition-all" title="Export an interactive web snapshot — shareable as a single HTML file"><i data-lucide="globe" width="12"></i> Snapshot</button>
                        <button data-edit-only onclick="GenericViews._exportSubmissionForm('${project.id}')" class="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold text-emerald-700 hover:bg-emerald-600 hover:text-white transition-all" title="Generate a standalone HTML submission form to send to a colleague"><i data-lucide="file-edit" width="12"></i> Submission Form</button>
                        ${project.hcwMultiplierEnabled ? `<span class="w-px h-4 bg-slate-200 mx-1"></span><button onclick="App.showHcwMultiplier=!App.showHcwMultiplier; App.renderView()" class="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-all ${multiplierEnabled ? 'bg-gsf-boston text-white' : 'text-slate-500 hover:bg-slate-100'}" title="HCW multiplier ×${multiplierRate}"><i data-lucide="trending-up" width="12"></i> ×${multiplierRate} HCW</button>` : ''}
                        ${(project.sheetsTabUrl || appSettings.googleSheetsViewUrl) || project.linkGsf || project.linkFolder || (project.linksExtra || []).some(l => l.url) ? `<span class="w-px h-4 bg-slate-200 mx-1 ml-auto"></span>` : '<span class="ml-auto"></span>'}
                        ${(project.sheetsTabUrl || appSettings.googleSheetsViewUrl) ? `<button onclick="electronAPI.openExternal('${App.escapeHtml(project.sheetsTabUrl || appSettings.googleSheetsViewUrl)}')" class="p-1.5 rounded text-emerald-600 hover:bg-emerald-50 transition-all" title="Open Google Sheet"><i data-lucide="sheet" width="14"></i></button>` : ''}
                        ${project.linkGsf ? `<button onclick="electronAPI.openExternal('${App.escapeHtml(project.linkGsf)}')" class="p-1.5 rounded text-slate-500 hover:bg-slate-100 transition-all" title="Open GSF page"><i data-lucide="external-link" width="14"></i></button>` : ''}
                        ${project.linkFolder ? `<button onclick="electronAPI.openExternal('${App.escapeHtml(project.linkFolder)}')" class="p-1.5 rounded text-slate-500 hover:bg-slate-100 transition-all" title="Open project folder"><i data-lucide="folder" width="14"></i></button>` : ''}
                        ${(project.linksExtra || []).map(l => l.url ? `<button onclick="electronAPI.openExternal('${App.escapeHtml(l.url)}')" class="p-1.5 rounded text-slate-500 hover:bg-slate-100 transition-all" title="${App.escapeHtml(l.label || l.url)}"><i data-lucide="link" width="14"></i></button>` : '').join('')}
                    </div>
                </header>

                <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">${kpiCards}</div>

                ${this._renderQualityImprovement(project, qualityData, allQualityKpis)}

                ${this._renderEconomicImpact(project, allBudget, allActuals, qualityData, year)}

                ${this._renderCostEffectiveness(project, allBudget, allActuals, allTargets, year)}

                <div id="dash-multi-year-section" class="mb-8"></div>

                ${this._buildQualitySection(project, qualityData, allQualityKpis)}

                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-8">
                    <div class="flex items-center justify-between mb-4">
                        <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide">Recent Activities</h2>
                        <button onclick="App.navigate('project-activities')" class="text-xs text-gsf-boston hover:underline font-medium">Log activity / view all</button>
                    </div>
                    ${recentActivities.length > 0 ? activityRows : '<p class="text-slate-400 text-sm italic">No activities logged yet.</p>'}
                </div>
            </div>

            <!-- KPI Detail modal -->
            <div id="kpi-detail-modal" class="hidden fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onclick="if(event.target===this)this.classList.add('hidden')">
                <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col">
                    <div class="p-5 border-b flex items-center justify-between">
                        <h3 id="kpi-modal-title" class="font-bold text-gsf-prussian text-lg"></h3>
                        <button onclick="document.getElementById('kpi-detail-modal').classList.add('hidden')" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" width="18"></i></button>
                    </div>
                    <div id="kpi-modal-body" class="overflow-y-auto p-5 flex-1"></div>
                </div>
            </div>

            <!-- Economic Impact verification modal (click-through from cards) -->
            <div id="econ-detail-modal" class="hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onclick="if(event.target===this) GenericViews._closeEconomicDetail()">
                <div class="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
                    <div id="econ-detail-body" class="overflow-y-auto flex-1"></div>
                </div>
            </div>

            <!-- Activity detail modal (opens when an event / update is clicked in a timeline) -->
            <div id="activity-detail-modal" class="hidden fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onclick="if(event.target===this) GenericViews._closeActivityDetail()">
                <div class="bg-white rounded-2xl shadow-2xl max-w-xl w-full max-h-[85vh] flex flex-col overflow-hidden">
                    <div id="activity-detail-body" class="overflow-y-auto flex-1"></div>
                </div>
            </div>

            <!-- Generic card detail modal — quality improvement, cost-effectiveness, etc. -->
            <div id="card-detail-modal" class="hidden fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onclick="if(event.target===this) GenericViews._closeCardDetail()">
                <div class="bg-white rounded-2xl shadow-2xl max-w-xl w-full max-h-[85vh] flex flex-col overflow-hidden">
                    <div class="px-5 py-4 border-b flex items-center justify-between">
                        <h3 id="card-detail-title" class="font-bold text-gsf-prussian text-lg"></h3>
                        <button onclick="GenericViews._closeCardDetail()" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" width="18"></i></button>
                    </div>
                    <div id="card-detail-body" class="overflow-y-auto p-5 flex-1"></div>
                </div>
            </div>`;

        if (window.lucide) lucide.createIcons();

        // Build multi-year data and inject charts
        const allYearNums = [...new Set([
            ...allTargets.map(t => t.year),
            ...allActuals.map(a => a.year)
        ])].sort();
        const multiYearData = allYearNums.map(yr => ({
            year: yr,
            targets: Projects.getTargetsForYear(allTargets, yr),
            actuals:  Projects.getActualsForYear(allActuals, yr)
        }));
        if (multiYearData.length > 0) {
            const chartControls = this._buildChartControls(multiYearData, 'dash');
            const chartGrid = Projects.STANDARD_KPIS.map(kpi => `
                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5 relative group">
                    <div class="flex items-center gap-2 mb-2">
                        <div class="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style="background:${kpi.color}20">
                            <i data-lucide="${kpi.icon}" width="12" style="color:${kpi.color}"></i>
                        </div>
                        <p class="text-xs font-black text-gsf-prussian uppercase tracking-wide flex-1">${kpi.nameBig || kpi.name}</p>
                        <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button data-copy-chart="dash-chart-${kpi.id}" onclick="GenericCharts.copyChart('dash-chart-${kpi.id}')" title="Copy to clipboard" class="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"><i data-lucide="copy" width="11"></i></button>
                            <button onclick="GenericCharts.downloadChart('dash-chart-${kpi.id}','${(kpi.nameBig||kpi.name).replace(/'/g,'')}')" title="Download PNG" class="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"><i data-lucide="download" width="11"></i></button>
                        </div>
                    </div>
                    <div id="dash-chart-${kpi.id}" style="min-height:220px;"></div>
                </div>`).join('');
            const section = document.getElementById('dash-multi-year-section');
            if (section) {
                GenericViews._dashMultiYearData = multiYearData;  // cache for lightweight refresh
                section.innerHTML = `<div class="mb-2"><h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide mb-3">Multi-Year Progress</h2><div id="dash-chart-controls"></div></div><div class="grid grid-cols-1 sm:grid-cols-2 gap-4">${chartGrid}</div>`;
                const ctrlEl = document.getElementById('dash-chart-controls');
                if (ctrlEl) ctrlEl.innerHTML = GenericViews._buildChartControls(multiYearData, 'dash');
                if (window.lucide) lucide.createIcons();
                setTimeout(() => {
                    GenericCharts.drawOrgYearlyProgress(multiYearData, year, 'dash-chart-', this._getChartFilters());
                }, 60);
            }
        }

        // Draw quality indicator charts
        const enabledQKpis = (project.enabledQualityKpis || []).map(id => allQualityKpis.find(k => k.id === id)).filter(Boolean);
        if (enabledQKpis.length > 0) {
            const qHidden = new Set(App._qualityHiddenYears || []);
            const visibleQData = qualityData.filter(d => !qHidden.has(d.year));
            setTimeout(() => this._drawQualityCharts(visibleQData, enabledQKpis, project), 100);
        }
    },

    // ===== QUALITY INDICATORS (quarterly KPIs) =====

    _toggleQualityYear(year) {
        if (!App._qualityHiddenYears) App._qualityHiddenYears = [];
        const idx = App._qualityHiddenYears.indexOf(year);
        if (idx >= 0) App._qualityHiddenYears.splice(idx, 1);
        else App._qualityHiddenYears.push(year);
        App.renderView();
    },

    // Quality improvement section: compare baseline → target (planned) and baseline → latest actual (achieved).
    // Direction-aware: for lowerIsBetter KPIs (MMR, NMR, SSI) "improvement" means going DOWN, expressed as a negative %.
    // For higherIsBetter KPIs (SSC compliance) "improvement" means going UP, expressed as a positive %.
    // Generic card-detail modal (used by Quality Improvement + Cost-Effectiveness cards).
    // Pattern across the dashboard: hover reveals more info on the card itself, click opens this modal.
    _showCardDetail(title, bodyHtml) {
        const modal = document.getElementById('card-detail-modal');
        const t = document.getElementById('card-detail-title');
        const b = document.getElementById('card-detail-body');
        if (!modal || !t || !b) return;
        t.textContent = title;
        b.innerHTML = bodyHtml;
        modal.classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
    },
    _closeCardDetail() {
        const m = document.getElementById('card-detail-modal');
        if (m) m.classList.add('hidden');
    },

    // ── Quality Improvement detail ─────────────────────────────────────────────
    async _showQualityImprovementDetail(kpiId) {
        const projectId = App.currentProject;
        const project = Projects.getProject(projectId);
        if (!project) return;
        const allQualityKpis = Projects.QUALITY_KPIS;
        const kpi = allQualityKpis.find(k => k.id === kpiId);
        if (!kpi) return;
        const qualityData = await Projects.getQualityData(projectId);

        const baseline = (project.qualityBaselines || {})[kpiId];
        const hasBaseline = baseline !== undefined && baseline !== null && !isNaN(baseline);
        const target = Projects.qualityTargetFor(project, kpiId, qualityData);
        const entries = (qualityData || [])
            .filter(d => d.kpiId === kpiId && Projects.qualityActual(d) !== null)
            .sort((a, b) => (a.year * 10 + a.quarter) - (b.year * 10 + b.quarter));
        const latestEntry = entries.slice(-1)[0];
        const latestActual = latestEntry ? Projects.qualityActual(latestEntry) : null;

        const pctChange = (val) => (hasBaseline && val !== null && Number(baseline) !== 0)
            ? ((Number(val) - Number(baseline)) / Number(baseline)) * 100 : null;
        const fmtPct = (n) => {
            if (n === null || n === undefined || !isFinite(n)) return '—';
            const s = n > 0 ? '+' : '';
            return `${s}${n.toFixed(Math.abs(n) >= 10 ? 0 : 1)}%`;
        };
        const fmtVal = (n) => (n === null || n === undefined || !isFinite(n)) ? '—'
            : `${Number(n).toFixed(Number.isInteger(Number(n)) ? 0 : 1)}${kpi.unit ? ' ' + kpi.unit : ''}`;

        const targetChange = pctChange(target);
        const actualChange = pctChange(latestActual);
        const goalDir = kpi.lowerIsBetter ? -1 : 1;
        const isImproving = (actualChange !== null) && (Math.sign(actualChange) === goalDir);

        const goalLabel = kpi.lowerIsBetter ? 'reduce' : 'increase';
        const body = `
            <div class="space-y-4">
                <div class="flex items-center gap-3 pb-3 border-b">
                    <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style="background:${kpi.color}20">
                        <i data-lucide="${kpi.icon}" width="20" style="color:${kpi.color}"></i>
                    </div>
                    <div>
                        <p class="text-xs font-bold uppercase tracking-wide" style="color:${kpi.color}">${kpi.shortName}</p>
                        <p class="text-sm text-slate-600">${kpi.name}</p>
                        <p class="text-[11px] text-slate-400">Goal: <strong>${goalLabel}</strong> · unit: ${kpi.unit || '—'}</p>
                    </div>
                </div>

                <div class="grid grid-cols-3 gap-3">
                    <div class="rounded-lg border border-slate-200 p-3">
                        <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">Baseline</p>
                        <p class="text-lg font-black text-slate-700 tabular-nums">${fmtVal(baseline)}</p>
                    </div>
                    <div class="rounded-lg border border-amber-200 p-3 bg-amber-50/30">
                        <p class="text-[10px] font-bold uppercase tracking-wide text-amber-700">Target</p>
                        <p class="text-lg font-black text-amber-800 tabular-nums">${fmtVal(target)}</p>
                        <p class="text-[10px] text-amber-700 mt-0.5">${targetChange !== null ? fmtPct(targetChange) + ' vs baseline' : ''}</p>
                    </div>
                    <div class="rounded-lg border border-slate-200 p-3" style="background:${(isImproving ? '#ecfdf5' : '#f8fafc')}">
                        <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500">Latest actual</p>
                        <p class="text-lg font-black tabular-nums" style="color:${isImproving ? '#047857' : '#334155'}">${fmtVal(latestActual)}</p>
                        ${latestEntry ? `<p class="text-[10px] text-slate-500 mt-0.5">Q${latestEntry.quarter} ${latestEntry.year}</p>` : '<p class="text-[10px] text-slate-400 italic mt-0.5">No data yet</p>'}
                    </div>
                </div>

                <div class="rounded-lg bg-slate-50 border border-slate-100 p-4">
                    <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2">Change vs baseline</p>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <p class="text-[10px] text-slate-400 mb-1">So far</p>
                            <p class="text-2xl font-black tabular-nums" style="color:${isImproving ? '#10b981' : '#64748b'}">${actualChange !== null ? fmtPct(actualChange) : '—'}</p>
                        </div>
                        <div>
                            <p class="text-[10px] text-slate-400 mb-1">Target</p>
                            <p class="text-2xl font-black tabular-nums text-slate-600">${targetChange !== null ? fmtPct(targetChange) : '—'}</p>
                        </div>
                    </div>
                </div>

                <p class="text-[11px] text-slate-400 italic">
                    Baseline and target are set in <button onclick="App.navigate('project-settings'); GenericViews._closeCardDetail()" class="text-gsf-boston hover:underline font-medium">Project Settings → Impact Assumptions</button>. Quarterly actuals are recorded in Data Entry.
                </p>
            </div>
        `;
        this._showCardDetail(`${kpi.shortName} — improvement vs baseline`, body);
    },

    // ── Cost-Effectiveness detail ──────────────────────────────────────────────
    async _showCostEffectivenessDetail(kpiId) {
        const projectId = App.currentProject;
        const project = Projects.getProject(projectId);
        if (!project) return;
        const kpi = Projects.STANDARD_KPIS.find(k => k.id === kpiId);
        if (!kpi) return;
        const year = App.kpiYear === 'all' ? 'all' : (App.kpiYear || new Date().getFullYear());
        const [allBudget, allActuals, allTargets] = await Promise.all([
            Projects.getBudget(projectId), Projects.getActuals(projectId), Projects.getTargets(projectId)
        ]);
        const ce = Projects.computeCostEffectiveness(allBudget, allActuals, allTargets, year);
        const { totalAllocated, actualCostPer, actualKpiTotals, targetCostPer, targetKpiTotals } = ce;
        const currency = project.currency || 'USD';

        const fmtMoney = (n) => {
            if (n === null || n === undefined || !isFinite(n)) return '—';
            const r = Math.round(n);
            if (r >= 1000000) return (r / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
            if (r >= 10000)   return (r / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
            return this._fmt(r);
        };
        const fmtN = (n) => (n === null || n === undefined) ? '—' : this._fmt(Math.round(n));

        const cA = actualCostPer[kpiId];  const nA = actualKpiTotals[kpiId];
        const cP = targetCostPer[kpiId];  const nP = targetKpiTotals[kpiId];
        const period = year === 'all' ? 'all time' : year;

        const body = `
            <div class="space-y-4">
                <div class="flex items-center gap-3 pb-3 border-b">
                    <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style="background:${kpi.color}20">
                        <i data-lucide="${kpi.icon}" width="20" style="color:${kpi.color}"></i>
                    </div>
                    <div>
                        <p class="text-xs font-bold uppercase tracking-wide" style="color:${kpi.color}">${kpi.nameBig || kpi.name}</p>
                        <p class="text-sm text-slate-600">Cost per ${(kpi.nameBig || kpi.name).toLowerCase()}</p>
                        <p class="text-[11px] text-slate-400">Period: <strong>${period}</strong></p>
                    </div>
                </div>

                <div class="rounded-lg bg-slate-50 border border-slate-100 p-4">
                    <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500">Total allocated budget</p>
                    <p class="text-2xl font-black text-slate-700 tabular-nums"><span class="text-xs text-slate-400 font-normal">${currency}</span> ${fmtMoney(totalAllocated)}</p>
                </div>

                <div>
                    <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2">Actual (achieved)</p>
                    <div class="rounded-lg border border-slate-200 p-4">
                        <p class="font-mono text-xs text-slate-600 mb-1">
                            ${currency} ${fmtMoney(totalAllocated)} ÷ ${fmtN(nA)} ${kpi.unit || 'units'}
                        </p>
                        <p class="text-2xl font-black text-slate-800 tabular-nums">${cA === null ? '<span class="text-slate-300">—</span>' : `<span class="text-xs text-slate-400 font-normal">${currency}</span> ${fmtMoney(cA)}`}</p>
                        ${cA === null ? '<p class="text-[10px] text-slate-400 italic">No actuals reported yet.</p>' : ''}
                    </div>
                </div>

                <div>
                    <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2">Planned (against target)</p>
                    <div class="rounded-lg border border-slate-200 p-4">
                        <p class="font-mono text-xs text-slate-600 mb-1">
                            ${currency} ${fmtMoney(totalAllocated)} ÷ ${fmtN(nP)} ${kpi.unit || 'units'}
                        </p>
                        <p class="text-xl font-bold text-slate-600 tabular-nums">${cP === null ? '<span class="text-slate-300">—</span>' : `<span class="text-xs text-slate-400 font-normal">${currency}</span> ${fmtMoney(cP)}`}</p>
                        ${cP === null ? '<p class="text-[10px] text-slate-400 italic">No targets set.</p>' : ''}
                    </div>
                </div>

                <p class="text-[11px] text-slate-400 italic">
                    Budget figures are sourced from Data Entry → Budget. KPI totals are the actuals/targets recorded for this period.
                </p>
            </div>
        `;
        this._showCardDetail(`Cost per ${(kpi.nameBig || kpi.name).toLowerCase()}`, body);
    },

    _renderQualityImprovement(project, qualityData, allQualityKpis) {
        const enabled = project.enabledQualityKpis || [];
        if (enabled.length === 0) return '';

        const kpiPool = allQualityKpis || Projects.QUALITY_KPIS;
        const activeKpis = kpiPool.filter(k => enabled.includes(k.id));
        if (activeKpis.length === 0) return '';

        const baselines = project.qualityBaselines || {};

        // Only render the section if at least one enabled KPI has a baseline set
        const anyBaseline = activeKpis.some(k => baselines[k.id] !== undefined && baselines[k.id] !== null && !isNaN(baselines[k.id]));
        if (!anyBaseline) return '';

        const fmtPct = (n) => {
            if (n === null || n === undefined || !isFinite(n)) return '—';
            const sign = n > 0 ? '+' : '';
            return `${sign}${n.toFixed(n >= 10 || n <= -10 ? 0 : 1)}%`;
        };
        const fmtVal = (n, unit) => {
            if (n === null || n === undefined || !isFinite(n)) return '—';
            return `${Number(n).toFixed(Number.isInteger(n) ? 0 : 1)}${unit ? ' ' + unit : ''}`;
        };

        const cards = activeKpis.map(kpi => {
            const baseline = baselines[kpi.id];
            const hasBaseline = baseline !== undefined && baseline !== null && !isNaN(baseline);

            const entries = qualityData
                .filter(d => d.kpiId === kpi.id)
                .sort((a, b) => (a.year * 10 + a.quarter) - (b.year * 10 + b.quarter));
            const latestActualEntry = entries.filter(e => Projects.qualityActual(e) !== null).slice(-1)[0];

            const latestActual = latestActualEntry ? Projects.qualityActual(latestActualEntry) : null;
            const latestTarget = Projects.qualityTargetFor(project, kpi.id, qualityData);

            // Compute changes (signed) — improvement direction depends on lowerIsBetter
            const pctChange = (val) => (hasBaseline && val !== null && Number(baseline) !== 0)
                ? ((Number(val) - Number(baseline)) / Number(baseline)) * 100
                : null;
            const targetChange = pctChange(latestTarget);
            const actualChange = pctChange(latestActual);

            // Did the actual move in the "improvement" direction relative to baseline?
            const goalDir = kpi.lowerIsBetter ? -1 : 1;
            const isImproving = (actualChange !== null) && (Math.sign(actualChange) === goalDir);
            const isWorsening = (actualChange !== null) && (Math.sign(actualChange) === -goalDir) && actualChange !== 0;

            // Progress toward goal: ratio of actual change to target change (0–100%+)
            let progressPct = null;
            if (targetChange !== null && actualChange !== null && Math.sign(targetChange) === goalDir && targetChange !== 0) {
                progressPct = Math.max(0, Math.min(120, (actualChange / targetChange) * 100));
            }

            const trendColor = isImproving ? '#10b981' : (isWorsening ? '#ef4444' : '#64748b');
            const trendIcon = isImproving ? 'trending-up' : (isWorsening ? 'trending-down' : 'minus');
            // Visual arrow for direction-of-good (down for lowerIsBetter, up for higherIsBetter)
            const goalLabel = kpi.lowerIsBetter ? 'Reduction goal' : 'Increase goal';

            if (!hasBaseline) {
                return `
                <div class="bg-white rounded-xl border border-dashed border-slate-200 p-4 flex flex-col">
                    <p class="text-xs font-black text-gsf-prussian uppercase tracking-wide mb-1">${kpi.shortName}</p>
                    <p class="text-[11px] text-slate-400 italic">Set a baseline to track improvement.</p>
                </div>`;
            }

            return `
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 relative overflow-hidden cursor-pointer hover:shadow-md transition-shadow group"
                onclick="GenericViews._showQualityImprovementDetail('${kpi.id}')">
                <div class="absolute top-0 left-0 h-1 w-full" style="background:${kpi.color}"></div>
                <span class="absolute top-2 right-2 text-[9px] font-bold uppercase opacity-0 group-hover:opacity-70 transition-opacity" style="color:${kpi.color}">Detail →</span>
                <p class="text-xs font-black text-gsf-prussian uppercase tracking-wide mb-2 truncate">${kpi.shortName}</p>
                <div class="flex items-baseline gap-2 mb-2">
                    <span class="text-2xl font-black tabular-nums" style="color:${trendColor}">${actualChange !== null ? fmtPct(actualChange) : '—'}</span>
                    <span class="text-[10px] font-bold uppercase tracking-wide text-slate-400">so far</span>
                </div>
                <div class="flex items-baseline gap-2 pt-2 border-t border-slate-100">
                    <span class="text-sm font-bold text-slate-500 tabular-nums">${targetChange !== null ? fmtPct(targetChange) : '—'}</span>
                    <span class="text-[10px] font-bold uppercase tracking-wide text-slate-400">target</span>
                </div>
                <!-- Hover: extra info fades in without resizing the card.
                     Space is always reserved so all cards in the row stay the same height. -->
                <div class="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="tabular-nums text-slate-700 font-semibold">${fmtVal(baseline, kpi.unit)}</span>
                        <i data-lucide="arrow-right" width="12" class="text-slate-300"></i>
                        <span class="tabular-nums text-slate-700 font-semibold">${fmtVal(latestActual, kpi.unit)}</span>
                        ${latestActualEntry ? `<span class="text-slate-400 text-[10px]">Q${latestActualEntry.quarter} ${latestActualEntry.year}</span>` : ''}
                    </div>
                </div>
            </div>`;
        }).join('');

        return `
            <div class="mb-8">
                <div class="flex items-center justify-between mb-3">
                    <h2 class="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <i data-lucide="target" width="13"></i> Quality Improvement vs Baseline
                    </h2>
                    <span class="text-[11px] text-slate-400 italic">Hover for context · click for detail</span>
                </div>
                <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">${cards}</div>
            </div>`;
    },

    _buildQualitySection(project, qualityData, allQualityKpis) {
        const enabled = project.enabledQualityKpis || [];
        if (enabled.length === 0) return '';

        const kpiPool = allQualityKpis || Projects.QUALITY_KPIS;
        const activeKpis = kpiPool.filter(k => enabled.includes(k.id));
        if (activeKpis.length === 0) return '';

        // Compute available years and apply hidden filter
        const hiddenYears = new Set(App._qualityHiddenYears || []);
        const availYears = [...new Set(qualityData.map(d => d.year))].sort();
        const yearBtns = availYears.length > 1 ? availYears.map(y =>
            `<button onclick="GenericViews._toggleQualityYear(${y})"
                class="px-2.5 py-1 rounded text-xs font-semibold border transition-all ${hiddenYears.has(y) ? 'bg-white text-slate-400 border-slate-200' : 'bg-gsf-prussian/90 text-white border-transparent'}">${y}</button>`
        ).join('') : '';
        const visibleData = qualityData.filter(d => !hiddenYears.has(d.year));

        const cards = activeKpis.map(kpi => {
            const entries = visibleData
                .filter(d => d.kpiId === kpi.id && Projects.qualityActual(d) !== null)
                .sort((a, b) => (a.year * 10 + a.quarter) - (b.year * 10 + b.quarter));
            const latest = entries.slice(-1)[0];
            const prev   = entries.slice(-2, -1)[0];

            let trendHtml = '';
            if (latest && prev) {
                const lVal = Projects.qualityActual(latest);
                const pVal = Projects.qualityActual(prev);
                const diff = lVal - pVal;
                const better = kpi.lowerIsBetter ? diff < 0 : diff > 0;
                const worse  = kpi.lowerIsBetter ? diff > 0 : diff < 0;
                const arrow  = diff > 0 ? 'trending-up' : diff < 0 ? 'trending-down' : 'minus';
                const clr    = better ? 'text-emerald-500' : worse ? 'text-red-500' : 'text-slate-400';
                trendHtml = `<i data-lucide="${arrow}" width="16" class="${clr}"></i>`;
            }

            const latestActual = latest ? Projects.qualityActual(latest) : null;
            const latestTarget = Projects.qualityTargetFor(project, kpi.id, qualityData);
            const pct = latestTarget && latestActual !== null
                ? (kpi.lowerIsBetter
                    ? (latestActual <= latestTarget ? 100 : Math.max(0, Math.round((1 - (latestActual - latestTarget) / latestTarget) * 100)))
                    : Math.min(100, Math.round((latestActual / latestTarget) * 100)))
                : null;

            return `
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5 relative group">
                <div class="flex items-center gap-2 mb-3">
                    <div class="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style="background:${kpi.color}20">
                        <i data-lucide="${kpi.icon}" width="13" style="color:${kpi.color}"></i>
                    </div>
                    <p class="text-xs font-black text-gsf-prussian uppercase tracking-wide flex-1">${kpi.shortName}</p>
                    ${trendHtml}
                    <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button data-copy-chart="quality-chart-${kpi.id}" onclick="GenericCharts.copyChart('quality-chart-${kpi.id}')" title="Copy to clipboard" class="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"><i data-lucide="copy" width="11"></i></button>
                        <button onclick="GenericCharts.downloadChart('quality-chart-${kpi.id}','${kpi.shortName.replace(/'/g,'')}')" title="Download PNG" class="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"><i data-lucide="download" width="11"></i></button>
                    </div>
                </div>
                ${latestActual !== null ? `
                    <div class="flex items-end gap-2 mb-1">
                        <span class="text-2xl font-black" style="color:${kpi.color}">${latestActual}</span>
                        <span class="text-xs text-slate-400 mb-0.5">${kpi.unit} · Q${latest.quarter} ${latest.year}</span>
                    </div>
                    ${latestTarget !== null ? `
                        <div class="mb-3">
                            <span class="text-[10px] text-slate-500">Target: ${latestTarget} ${kpi.unit}</span>
                        </div>
                    ` : '<div class="mb-3"></div>'}
                ` : `<p class="text-xs text-slate-400 italic mb-3">No data recorded yet</p>`}
                <div id="quality-chart-${kpi.id}" style="height:150px;"></div>
                <p class="text-[10px] text-slate-400 mt-1">${kpi.name}</p>
            </div>`;
        }).join('');

        return `
            <div class="mb-8">
                <div class="flex items-center justify-between mb-3">
                    <h2 class="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <i data-lucide="activity" width="13"></i> Quality Indicators
                    </h2>
                    <div class="flex items-center gap-2">
                        ${yearBtns ? `<div class="flex items-center gap-1">${yearBtns}</div>` : ''}
                        <button onclick="App.navigate('project-setup')" class="text-xs text-gsf-boston hover:underline font-medium flex items-center gap-1">
                            <i data-lucide="settings-2" width="12"></i> Edit in Setup
                        </button>
                    </div>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">${cards}</div>
            </div>`;
    },

    async _saveQualityKpiSelection(projectId) {
        const checkboxes = document.querySelectorAll('input[name="quality-kpi"]');
        const enabledQualityKpis = [];
        checkboxes.forEach(cb => { if (cb.checked) enabledQualityKpis.push(cb.value); });
        await Projects.updateProject(projectId, { enabledQualityKpis });
        App.showMsg('Quality indicators updated ✓');
        App.renderView();
    },

    async _saveSetupQualityKpis(projectId) {
        const year    = App.kpiYear || new Date().getFullYear();
        const quarter = App._qualityQuarter || Math.ceil((new Date().getMonth() + 1) / 3);

        const project = Projects.getProject(projectId);
        const enabled = project?.enabledQualityKpis || [];
        const entries = [];
        enabled.forEach(kpiId => {
            const tEl = document.getElementById(`qtarget-${kpiId}`);
            const aEl = document.getElementById(`qactual-${kpiId}`);
            const target = tEl && tEl.value !== '' ? parseFloat(tEl.value) : null;
            const actual = aEl && aEl.value !== '' ? parseFloat(aEl.value) : null;
            if (target !== null || actual !== null) {
                entries.push({ kpiId, year, quarter, target, actual });
            }
        });
        if (entries.length === 0) { App.showMsg('No quality data to save'); return; }
        await Projects.saveQualityBatch(projectId, entries);
        App.showMsg(`Q${quarter} ${year} quality data saved ✓`);
        App.renderView();
    },

    _drawQualityCharts(qualityData, enabledKpis, project) {
        if (!window.google?.visualization) return;
        const baselines = (project && project.qualityBaselines) || {};
        const projectTargets = (project && project.qualityTargets) || {};
        enabledKpis.forEach(kpi => {
            const el = document.getElementById(`quality-chart-${kpi.id}`);
            if (!el) return;
            const entries = qualityData
                .filter(d => d.kpiId === kpi.id && Projects.qualityActual(d) !== null)
                .sort((a, b) => (a.year * 10 + a.quarter) - (b.year * 10 + b.quarter));
            if (entries.length === 0) { el.innerHTML = '<p class="text-xs text-slate-300 italic text-center pt-8">No data</p>'; return; }

            const projectTarget = projectTargets[kpi.id];
            const hasTargets = projectTarget !== undefined && projectTarget !== null && !isNaN(projectTarget);
            const baseline = baselines[kpi.id];
            const hasBaseline = baseline !== undefined && baseline !== null && !isNaN(baseline);

            const data = new google.visualization.DataTable();
            data.addColumn('string', 'Quarter');
            data.addColumn('number', 'Actual');
            if (hasTargets)  data.addColumn('number', 'Target');
            if (hasBaseline) data.addColumn('number', 'Baseline');
            entries.forEach(e => {
                const label = e.quarter === 1 ? `${e.year}` : `Q${e.quarter}`;
                const row = [label, Projects.qualityActual(e)];
                if (hasTargets)  row.push(projectTarget);
                if (hasBaseline) row.push(baseline);
                data.addRow(row);
            });

            const colors = [kpi.color];
            if (hasTargets)  colors.push('#94a3b8');
            if (hasBaseline) colors.push('#f59e0b');

            // Build series options. Index 1 = Target (dashed), Index 2 (or 1) = Baseline (dotted, amber for visibility)
            const series = {};
            let nextIdx = 1;
            if (hasTargets) {
                series[nextIdx] = { lineDashStyle: [4, 4], lineWidth: 1.5, pointSize: 3 };
                nextIdx++;
            }
            if (hasBaseline) {
                series[nextIdx] = { lineDashStyle: [2, 4], lineWidth: 2.5, pointSize: 0 };
            }

            const chartId = `quality-chart-${kpi.id}`;
            const chart = new google.visualization.LineChart(el);
            const qOpts = {
                height: 160,
                legend: (hasTargets || hasBaseline) ? { position: 'top', alignment: 'end', textStyle: { fontSize: 10, color: '#64748b' } } : 'none',
                curveType: 'function',
                colors,
                chartArea: { left: 42, top: (hasTargets || hasBaseline) ? 26 : 12, right: 12, bottom: 28, width: '85%', height: '74%' },
                hAxis: { textStyle: { fontSize: 10, color: '#64748b' }, baselineColor: '#e2e8f0', gridlines: { color: 'transparent' }, maxAlternation: 1, showTextEvery: 1 },
                vAxis: { textStyle: { fontSize: 10, color: '#94a3b8' }, baselineColor: '#e2e8f0', gridlines: { color: '#f1f5f9', count: 4 }, minorGridlines: { count: 0 }, minValue: 0 },
                lineWidth: 3,
                pointSize: 6,
                pointShape: 'circle',
                backgroundColor: 'transparent',
                series,
                focusTarget: 'category',
                tooltip: { textStyle: { fontSize: 12, color: '#1e293b' }, showColorCode: true }
            };
            chart.draw(data, qOpts);
            GenericCharts._registerChart(chartId, 'LineChart', data, qOpts);
        });
    },

    _showKpiDetail(kpiId, year) {
        const modal   = document.getElementById('kpi-detail-modal');
        const title   = document.getElementById('kpi-modal-title');
        const body    = document.getElementById('kpi-modal-body');
        if (!modal || !title || !body) return;

        const kpi     = Projects.STANDARD_KPIS.find(k => k.id === kpiId);
        const fieldMap = { hcw_strengthened: 'hcw_count', patients_reached: 'patient_count', facilities_strengthened: 'facilities_count', population_access: 'population' };
        const field    = fieldMap[kpiId];
        const events   = this._currentEvents.filter(e => e[field] > 0);
        const yearEvs  = events.filter(e => e.date.startsWith(String(year)));

        title.innerHTML = `<span style="color:${kpi.color}">${kpi.name}</span>`;

        const rows = (yearEvs.length > 0 ? yearEvs : events).map(e => {
            const et  = Projects.EVENT_TYPES[e.type] || {};
            const val = e[field];
            return `
            <div class="flex items-start gap-3 py-3 border-b border-slate-50 last:border-0">
                <div class="w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5" style="background:${et.color || '#64748b'}20">
                    <i data-lucide="${et.icon || 'calendar'}" width="13" style="color:${et.color || '#64748b'}"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between gap-2 mb-0.5">
                        <span class="text-sm font-semibold text-slate-800 truncate">${App.escapeHtml(e.title || '')}</span>
                        <span class="text-sm font-black shrink-0" style="color:${kpi.color}">+${this._fmt(val)}</span>
                    </div>
                    <p class="text-xs text-slate-400">${e.date} · ${et.label || e.type}</p>
                    ${e.notes ? `<p class="text-xs text-slate-500 mt-0.5 italic">${App.escapeHtml(e.notes)}</p>` : ''}
                </div>
                <button onclick="GenericViews._editEvent('${this._currentProjectId}','${e.id}'); document.getElementById('kpi-detail-modal').classList.add('hidden')"
                        class="text-slate-300 hover:text-gsf-boston shrink-0 mt-0.5" title="Edit">
                    <i data-lucide="pencil" width="13"></i>
                </button>
            </div>`;
        }).join('');

        const total = yearEvs.reduce((s, e) => s + (Number(e[field]) || 0), 0);
        const shownEvs = yearEvs.length > 0 ? yearEvs : events;
        body.innerHTML = `
            <div class="flex items-center justify-between mb-4 pb-3 border-b">
                <div>
                    <p class="text-xs text-slate-500 uppercase font-bold tracking-wide">${year} Total</p>
                    <p class="text-3xl font-black" style="color:${kpi.color}">${this._fmt(total)} <span class="text-sm font-normal text-slate-400">${kpi.unit}</span></p>
                </div>
                <div class="text-right">
                    <p class="text-xs font-bold text-slate-600">${shownEvs.length} contributing event${shownEvs.length !== 1 ? 's' : ''}</p>
                    ${shownEvs.length > 4 ? '<p class="text-[10px] text-slate-400 mt-0.5">Scroll the list to see all</p>' : ''}
                </div>
            </div>
            ${rows || '<p class="text-slate-400 text-sm italic text-center py-4">No events contributing to this KPI in ' + year + '.</p>'}
            ${shownEvs.length > 0 ? `
                <div class="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
                    <p class="text-[11px] text-slate-400 italic">List is scrollable — use the project's Activities tab for filtering, editing, and full notes.</p>
                    <button onclick="document.getElementById('kpi-detail-modal').classList.add('hidden'); App.navigate('project-activities')"
                        class="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-gsf-boston hover:bg-gsf-boston hover:text-white border border-gsf-boston/30 transition-colors">
                        <i data-lucide="list" width="12"></i> View all in Activities →
                    </button>
                </div>
            ` : ''}`;

        if (window.lucide) lucide.createIcons();
        modal.classList.remove('hidden');
    },

    // ===== ACTIVITY LOG =====
    async renderDataEntry(main, project) {
        const today = new Date().toISOString().split('T')[0];
        const tab   = App.eventTab || 'event';
        const [events, updates, facilities] = await Promise.all([
            Projects.getEvents(project.id),
            Projects.getUpdates(project.id),
            Projects.getFacilities(project.id)
        ]);

        const editingId    = App.editingEventId  || null;
        const editingUpdId = App.editingUpdateId || null;
        const editingEv    = editingId    ? events.find(e => e.id === editingId)     : null;
        const editingUpd   = editingUpdId ? updates.find(u => u.id === editingUpdId) : null;
        const isEditing    = !!(editingEv || editingUpd);

        const allEntries = [
            ...events.map(e  => ({ ...e,  _kind: 'event' })),
            ...updates.map(u => ({ ...u,  _kind: 'update' }))
        ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);

        // Pre-fill helpers
        const pf = (field, fallback = '') => { if (!editingEv) return fallback; const v = editingEv[field]; return v !== undefined && v !== null ? String(v) : fallback; };

        // Event type dropdown options (legacy types map to 'other')
        const legacyMap = { facility: 'other', patients: 'other', estimate: 'other' };
        const currentType = legacyMap[pf('type')] || pf('type') || 'workshop';
        const typeOptions = Object.entries(Projects.EVENT_TYPES).map(([key, et]) =>
            `<option value="${key}" ${currentType === key ? 'selected' : ''}>${et.label}</option>`
        ).join('');

        // Facility checkboxes
        const editFacilities = editingEv && editingEv.facilities ? editingEv.facilities : [];
        const facilityChecks = facilities.length > 0 ? facilities.map(f => {
            const checked = editFacilities.includes(f.id) ? 'checked' : '';
            return `<label class="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" name="ev-fac" value="${f.id}" ${checked} class="rounded border-slate-300 text-gsf-boston focus:ring-gsf-boston/30" />
                <span class="text-sm text-slate-700">${App.escapeHtml(f.name)}</span>
                ${f.catchmentPop ? `<span class="text-[10px] text-slate-400 ml-auto">${this._fmt(Number(f.catchmentPop))} pop.</span>` : ''}
            </label>`;
        }).join('') : '<p class="text-xs text-slate-400 italic">No facilities added yet. <button onclick="App.navigate(\'project-setup\')" class="text-gsf-boston hover:underline">Add in Setup</button></p>';

        const eventForm = `
            <p class="text-xs text-slate-400 mb-4 -mt-2">Log an activity or event. These entries help you track what happened throughout the year.</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div class="sm:col-span-2">
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Title *</label>
                    <input type="text" id="ev-title" value="${App.escapeHtml(pf('title'))}" placeholder="e.g. Advanced Surgical Skills Training – Nairobi" required class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Date *</label>
                    <input type="date" id="ev-date" value="${pf('date', today)}" required class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Category</label>
                    <select id="ev-type" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30">${typeOptions}</select>
                </div>
                <div class="sm:col-span-2 bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Total HCWs Involved</label>
                            <input type="number" id="ev-hcw" value="${pf('hcw_count')}" min="0" placeholder="0" oninput="GenericViews._validateHcwNew()" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                        </div>
                        <div>
                            <label class="flex items-center gap-1.5 text-xs font-bold text-emerald-700 mb-1 uppercase">
                                <i data-lucide="corner-down-right" width="12"></i> Of which new this year
                            </label>
                            <input type="number" id="ev-hcw-new" value="${pf('hcw_new_count')}" min="0" placeholder="0" oninput="GenericViews._validateHcwNew()" class="w-full px-3 py-2 border border-emerald-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white" />
                        </div>
                    </div>
                    <p id="ev-hcw-warn" class="text-[11px] text-red-500 mt-2 hidden">⚠ "New this year" cannot exceed total HCWs involved.</p>
                    <p class="text-[11px] text-slate-400 mt-1">Tip: count only HCWs who haven't yet been logged in any other event this year.</p>
                </div>
                <div class="sm:col-span-2">
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Facilities Involved</label>
                    <div class="border rounded-lg p-3 max-h-40 overflow-y-auto custom-scrollbar space-y-0.5">${facilityChecks}
                        <label class="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-slate-50 cursor-pointer border-t border-slate-100 mt-1 pt-2">
                            <input type="checkbox" id="ev-fac-other" ${pf('facility_other') ? 'checked' : ''} class="rounded border-slate-300 text-gsf-boston focus:ring-gsf-boston/30" />
                            <span class="text-sm text-slate-700 italic">Other (not listed)</span>
                        </label>
                    </div>
                </div>
                <div class="sm:col-span-2">
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Notes</label>
                    <textarea id="ev-notes" rows="2" placeholder="What happened, key outcomes, observations..." class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30 resize-y">${App.escapeHtml(pf('notes'))}</textarea>
                </div>
            </div>`;

        const editingLabel = editingEv ? (editingEv.title || '') : editingUpd ? (editingUpd.title || '') : '';
        const editBanner = isEditing ? `
            <div class="flex items-center gap-3 mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
                <i data-lucide="pencil" width="14" class="text-amber-600 shrink-0"></i>
                <p class="text-sm text-amber-800 font-medium flex-1">Editing: <strong>${App.escapeHtml(editingLabel)}</strong></p>
                <button onclick="App.editingEventId=null; App.editingUpdateId=null; App.renderView()" class="text-xs text-amber-600 hover:text-amber-800 font-bold">Cancel edit</button>
            </div>` : '';

        const saveBtn = `<button onclick="GenericViews._saveEvent('${project.id}')" class="px-6 py-2.5 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors">${isEditing ? 'Update Event' : 'Log Event'}</button>`;

        const entryRows = allEntries.map(e => {
            const isEditingThis = e._kind === 'event' && e.id === editingId;
            if (e._kind === 'event') {
                const et = Projects.EVENT_TYPES[e.type] || {};
                const facNames = (e.facilities || []).map(fid => { const f = facilities.find(x => x.id === fid); return f ? f.name : ''; }).filter(Boolean);
                const detailParts = [];
                if (e.hcw_count)     detailParts.push(`<span class="text-blue-700">${this._fmt(e.hcw_count)} HCW${e.hcw_new_count ? ' (' + this._fmt(e.hcw_new_count) + ' new)' : ''}</span>`);
                const facCount = facNames.length + (e.facility_other ? 1 : 0);
                if (facCount)         detailParts.push(`<span class="text-amber-700">${facCount} facilit${facCount === 1 ? 'y' : 'ies'}</span>`);
                return `<tr class="border-b border-slate-100 hover:bg-slate-50 ${isEditingThis ? 'bg-amber-50' : ''}">
                    <td class="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">${e.date}</td>
                    <td class="px-4 py-2">${this._eventTypeBadge(e.type)}</td>
                    <td class="px-4 py-2 text-sm text-slate-800 font-medium">${App.escapeHtml(e.title || '')}</td>
                    <td class="px-4 py-2 text-xs">${detailParts.join(' · ')}</td>
                    <td class="px-4 py-2 whitespace-nowrap" data-edit-only>
                        <button onclick="GenericViews._editEvent('${project.id}','${e.id}')" class="text-gsf-boston hover:text-gsf-prussian text-xs font-bold mr-2">Edit</button>
                        <button onclick="GenericViews._deleteEvent('${project.id}','${e.id}')" class="text-red-400 hover:text-red-600 text-xs font-bold">Delete</button>
                    </td>
                </tr>`;
            } else {
                const tags = (e.tags || []).map(t => `<span class="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600">${App.escapeHtml(t)}</span>`).join(' ');
                return `<tr class="border-b border-slate-100 hover:bg-slate-50">
                    <td class="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">${e.date}</td>
                    <td class="px-4 py-2"><span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-100 text-slate-600"><i data-lucide="file-text" width="10"></i>Update</span></td>
                    <td class="px-4 py-2 text-sm text-slate-800 font-medium">${App.escapeHtml(e.title || '')}</td>
                    <td class="px-4 py-2 text-xs">${tags}</td>
                    <td class="px-4 py-2 whitespace-nowrap" data-edit-only>
                        <button onclick="GenericViews._editUpdate('${project.id}','${e.id}')" class="text-gsf-boston hover:text-gsf-prussian text-xs font-bold mr-2">Edit</button>
                        <button onclick="GenericViews._deleteNarrativeUpdate('${project.id}','${e.id}')" class="text-red-400 hover:text-red-600 text-xs font-bold">Delete</button>
                    </td>
                </tr>`;
            }
        }).join('');

        main.innerHTML = `
            <div class="p-6 md:p-10 fade-in w-full max-w-5xl mx-auto">
                <header class="mb-8">
                    <h1 class="text-2xl font-bold text-gsf-prussian">${isEditing ? 'Edit Entry' : 'Activity Log'}</h1>
                    <p class="text-sm text-slate-500 mt-1">Log events and updates. These are for your reference — actuals are entered in <button onclick="App.navigate('project-setup')" class="text-gsf-boston hover:underline font-medium">Project Setup</button>.</p>
                </header>

                <div class="bg-white rounded-xl border ${isEditing ? 'border-amber-300' : 'border-slate-200'} shadow-sm p-6 mb-8" data-edit-only>
                    ${editBanner}
                    ${eventForm}
                    ${saveBtn}
                </div>

                ${allEntries.length > 0 ? `
                    <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                        <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide mb-4">All Entries</h2>
                        <div class="overflow-x-auto">
                            <table class="w-full">
                                <thead><tr class="border-b-2 border-slate-200">
                                    <th class="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Date</th>
                                    <th class="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Type</th>
                                    <th class="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Title</th>
                                    <th class="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Details</th>
                                    <th class="px-4 py-2"></th>
                                </tr></thead>
                                <tbody>${entryRows}</tbody>
                            </table>
                        </div>
                    </div>
                ` : ''}
            </div>`;

        if (window.lucide) lucide.createIcons();
    },

    // ===== ACTIVITIES (merged Activity Log + Updates) =====
    async renderActivities(main, project) {
        const today = new Date().toISOString().split('T')[0];
        const [events, updates, facilities] = await Promise.all([
            Projects.getEvents(project.id),
            Projects.getUpdates(project.id),
            Projects.getFacilities(project.id)
        ]);

        // Which tab is active
        const tab = App.activityTab || 'event';  // 'event' or 'milestone'

        // ── Event editing state
        const editingEventId = App.editingEventId || null;
        const editingEv = editingEventId ? events.find(e => e.id === editingEventId) : null;
        const pfe = (field, fallback = '') => editingEv ? (editingEv[field] !== undefined ? editingEv[field] : fallback) : fallback;
        const editFacilities = editingEv ? (editingEv.facilities || []) : [];
        const currentType = Projects.canonicalEventType(pfe('type') || 'training_mentoring');
        // Only show canonical categories in the dropdown (filter legacy keys)
        const typeOptions = Object.entries(Projects.EVENT_TYPES)
            .filter(([, v]) => !v._legacy)
            .map(([k, v]) => `<option value="${k}" ${currentType === k ? 'selected' : ''}>${v.label}</option>`).join('');

        // ── Milestone (update) editing state
        const editingUpdId = App.editingUpdateId || null;
        const editingUpd = editingUpdId ? updates.find(u => u.id === editingUpdId) : null;
        const pfm = (field, fallback = '') => editingUpd ? (editingUpd[field] !== undefined ? editingUpd[field] : fallback) : fallback;
        const TAG_OPTIONS = ['', 'Milestone', 'Partnership', 'Publication', 'News Article', 'Event/Conference', 'Grant', 'Other'];
        const currentTag  = ((pfm('tags') || [])[0]) || '';

        const facilityChecks = facilities.length > 0 ? facilities.map(f => {
            const checked = editFacilities.includes(f.id) ? 'checked' : '';
            return `<label class="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" name="ev-fac" value="${f.id}" ${checked} class="rounded border-slate-300 text-gsf-boston focus:ring-gsf-boston/30" />
                <span class="text-sm text-slate-700">${App.escapeHtml(f.name)}</span>
                ${f.catchmentPop ? `<span class="text-[10px] text-slate-400 ml-auto">${this._fmt(Number(f.catchmentPop))} pop.</span>` : ''}
            </label>`;
        }).join('') : '<p class="text-xs text-slate-400 italic">No facilities added yet.</p>';

        // Tab buttons
        const tabBtns = `
            <div class="flex gap-1 bg-slate-100 rounded-lg p-1 mb-6">
                <button onclick="App.activityTab='event'; App.editingEventId=null; App.editingUpdateId=null; App.renderView()"
                    class="flex-1 px-4 py-2 rounded-md text-sm font-semibold transition-all ${tab === 'event' ? 'bg-white text-gsf-prussian shadow-sm' : 'text-slate-500 hover:text-slate-700'}">
                    <i data-lucide="users" width="13" class="inline mr-1.5"></i>Training Event
                </button>
                <button onclick="App.activityTab='milestone'; App.editingEventId=null; App.editingUpdateId=null; App.renderView()"
                    class="flex-1 px-4 py-2 rounded-md text-sm font-semibold transition-all ${tab === 'milestone' ? 'bg-white text-gsf-prussian shadow-sm' : 'text-slate-500 hover:text-slate-700'}">
                    <i data-lucide="flag" width="13" class="inline mr-1.5"></i>Other Milestone
                </button>
            </div>`;

        // ── Event form
        const eventEditBanner = editingEv ? `
            <div class="flex items-center gap-3 mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
                <i data-lucide="pencil" width="14" class="text-amber-600 shrink-0"></i>
                <p class="text-sm text-amber-800 font-medium flex-1">Editing: <strong>${App.escapeHtml(editingEv.title || '')}</strong></p>
                <button onclick="App.editingEventId=null; App.renderView()" class="text-xs text-amber-600 hover:text-amber-800 font-bold">Cancel</button>
            </div>` : '';

        const eventForm = `
            ${eventEditBanner}
            <p class="text-xs text-slate-400 mb-4 -mt-1">Pick a category (Training / Mentoring · Site Visit · Other Update). HCW and facility fields are optional — leave blank if it's just a news-style update.</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div class="sm:col-span-2">
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Title *</label>
                    <input type="text" id="ev-title" value="${App.escapeHtml(pfe('title'))}" placeholder="e.g. Advanced Surgical Skills Workshop – Nairobi" required class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Start Date *</label>
                    <input type="date" id="ev-date" value="${pfe('date', today)}" required class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">End Date <span class="font-normal text-slate-400 normal-case">(optional)</span></label>
                    <input type="date" id="ev-end-date" value="${pfe('endDate')}" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                </div>
                <div class="sm:col-span-2">
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Category</label>
                    <select id="ev-type" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30">${typeOptions}</select>
                </div>
                <div class="sm:col-span-2 bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Total HCWs Involved</label>
                            <input type="number" id="ev-hcw" value="${pfe('hcw_count')}" min="0" placeholder="0" oninput="GenericViews._validateHcwNew()" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                        </div>
                        <div>
                            <label class="flex items-center gap-1.5 text-xs font-bold text-emerald-700 mb-1 uppercase">
                                <i data-lucide="corner-down-right" width="12"></i> Of which new this year
                            </label>
                            <input type="number" id="ev-hcw-new" value="${pfe('hcw_new_count')}" min="0" placeholder="0" oninput="GenericViews._validateHcwNew()" class="w-full px-3 py-2 border border-emerald-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white" />
                        </div>
                    </div>
                    <p id="ev-hcw-warn" class="text-[11px] text-red-500 mt-2 hidden">⚠ "New this year" cannot exceed total HCWs involved.</p>
                    <p class="text-[11px] text-slate-400 mt-1">Tip: count only HCWs who haven't yet been logged in any other event this year.</p>
                </div>
                <div class="sm:col-span-2">
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Facilities Involved</label>
                    <div class="border rounded-lg p-3 max-h-36 overflow-y-auto custom-scrollbar space-y-0.5">${facilityChecks}
                        <label class="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-slate-50 cursor-pointer border-t border-slate-100 mt-1 pt-2">
                            <input type="checkbox" id="ev-fac-other" ${pfe('facility_other') ? 'checked' : ''} class="rounded border-slate-300 text-gsf-boston focus:ring-gsf-boston/30" />
                            <span class="text-sm text-slate-700 italic">Other (not listed)</span>
                        </label>
                    </div>
                </div>
                <div class="sm:col-span-2">
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Link <span class="font-normal text-slate-400 normal-case">(optional — e.g. report, agenda, photos)</span></label>
                    <input type="url" id="ev-link" value="${App.escapeHtml(pfe('link'))}" placeholder="https://…" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                </div>
                <div class="sm:col-span-2">
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Notes</label>
                    <textarea id="ev-notes" rows="2" placeholder="Key outcomes, observations…" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30 resize-y">${App.escapeHtml(pfe('notes'))}</textarea>
                </div>
            </div>
            <button onclick="GenericViews._saveEvent('${project.id}')" class="px-6 py-2.5 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors">${editingEv ? 'Update Activity' : 'Log Activity'}</button>`;

        // ── Milestone form
        const milestoneEditBanner = editingUpd ? `
            <div class="flex items-center gap-3 mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
                <i data-lucide="pencil" width="14" class="text-amber-600 shrink-0"></i>
                <p class="text-sm text-amber-800 font-medium flex-1">Editing: <strong>${App.escapeHtml(editingUpd.title || '')}</strong></p>
                <button onclick="App.editingUpdateId=null; App.renderView()" class="text-xs text-amber-600 hover:text-amber-800 font-bold">Cancel</button>
            </div>` : '';

        const milestoneForm = `
            ${milestoneEditBanner}
            <p class="text-xs text-slate-400 mb-4 -mt-1">Record partnerships, publications, grants, milestones, and other notable developments.</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div class="sm:col-span-2">
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Title *</label>
                    <input type="text" id="upd-title" value="${App.escapeHtml(pfm('title'))}" placeholder="Brief summary" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Date *</label>
                    <input type="date" id="upd-date" value="${pfm('date', today)}" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Tag</label>
                    <select id="upd-tags" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30">
                        ${TAG_OPTIONS.map(t => `<option value="${t}" ${currentTag === t ? 'selected' : ''}>${t || '— Select tag —'}</option>`).join('')}
                    </select>
                </div>
                <div class="sm:col-span-2">
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Link <span class="font-normal text-slate-400 normal-case">(optional)</span></label>
                    <input type="url" id="upd-link" value="${App.escapeHtml(pfm('link'))}" placeholder="https://…" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                </div>
                <div class="sm:col-span-2">
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Details</label>
                    <textarea id="upd-body" rows="4" placeholder="Describe the milestone, key outcomes, context…" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30 resize-y">${App.escapeHtml(pfm('body'))}</textarea>
                </div>
            </div>
            <button onclick="GenericViews._saveNarrativeUpdate('${project.id}')" class="px-6 py-2.5 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors">${editingUpd ? 'Save Changes' : 'Save Milestone'}</button>`;

        // ── Year filter (specific year | all time | custom range)
        const now = new Date();
        const yearMax = App.kpiYearMax != null ? Math.max(App.kpiYearMax, now.getFullYear() + 1) : now.getFullYear() + 1;
        const allYearsAv = [];
        for (let y = 2022; y <= yearMax; y++) allYearsAv.push(y);
        const aYear = App.activityYear ?? 'all';
        const aFrom = App.activityRangeFrom || 2022;
        const aTo   = App.activityRangeTo   || yearMax;
        const inFilter = (dateStr) => {
            if (!dateStr) return aYear === 'all';
            const y = Number(String(dateStr).slice(0, 4));
            if (isNaN(y)) return aYear === 'all';
            if (aYear === 'all') return true;
            if (aYear === 'range') return y >= aFrom && y <= aTo;
            return y === Number(aYear);
        };
        const yearChip = (val, label, active) =>
            `<button onclick="App.activityYear=${typeof val === 'string' ? `'${val}'` : val}; App.renderView()"
                class="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${active ? 'bg-gsf-boston text-white' : 'text-slate-500 hover:bg-slate-100'}">${label}</button>`;
        const yrButtons = allYearsAv.map(y => yearChip(y, String(y), aYear === y)).join('');
        const allTimeBtn = `<button onclick="App.activityYear='all'; App.renderView()"
            class="ml-0.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${aYear === 'all' ? 'bg-gsf-prussian text-white shadow-sm' : 'text-gsf-prussian bg-gsf-prussian/10 hover:bg-gsf-prussian/20'}"
            title="Show all activities across every year"><span class="text-[10px] ${aYear === 'all' ? 'opacity-90' : 'opacity-70'}">★</span> All time</button>`;
        const rangeBtn = `<button onclick="App.activityYear='range'; if(!App.activityRangeFrom)App.activityRangeFrom=${allYearsAv[0]}; if(!App.activityRangeTo)App.activityRangeTo=${allYearsAv[allYearsAv.length-1]}; App.renderView()"
            class="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${aYear === 'range' ? 'bg-gsf-prussian text-white' : 'text-slate-500 hover:bg-slate-100'}"
            title="Filter activities by a year range">Range…</button>`;
        const rangePicker = aYear === 'range' ? `
            <div class="flex items-center gap-2 px-3 py-2 mt-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                <span class="font-bold uppercase text-slate-500">From</span>
                <select onchange="App.activityRangeFrom=Number(this.value); App.renderView()" data-viewer-allowed
                    class="px-2 py-1 border border-slate-200 rounded text-sm bg-white">
                    ${allYearsAv.map(y => `<option value="${y}" ${y === aFrom ? 'selected' : ''}>${y}</option>`).join('')}
                </select>
                <span class="font-bold uppercase text-slate-500">to</span>
                <select onchange="App.activityRangeTo=Number(this.value); App.renderView()" data-viewer-allowed
                    class="px-2 py-1 border border-slate-200 rounded text-sm bg-white">
                    ${allYearsAv.map(y => `<option value="${y}" ${y === aTo ? 'selected' : ''}>${y}</option>`).join('')}
                </select>
            </div>` : '';
        const activityYearSelector = `
            <div class="flex items-center gap-1 bg-slate-100 rounded-lg p-1 flex-wrap" data-viewer-allowed>${yrButtons}<span class="w-px h-5 bg-slate-300 mx-1 inline-block align-middle"></span>${allTimeBtn}${rangeBtn}</div>
            ${rangePicker}`;
        const filterLabel = aYear === 'all' ? 'all time' : aYear === 'range' ? `${aFrom}–${aTo}` : String(aYear);

        // ── Combined history table (filtered to active year scope)
        const allEntries = [
            ...events.map(e => ({ ...e, _kind: 'event' })),
            ...updates.map(u => ({ ...u, _kind: 'milestone' }))
        ].filter(e => inFilter(e.date))
         .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        let historyRows = '';
        allEntries.forEach(e => {
            if (e._kind === 'event') {
                const facNames = (e.facilities || []).map(fid => { const f = facilities.find(x => x.id === fid); return f ? f.name : ''; }).filter(Boolean);
                const details = [];
                if (e.hcw_count)     details.push(`<span class="text-blue-600">${this._fmt(e.hcw_count)} HCW${e.hcw_new_count ? ' (' + this._fmt(e.hcw_new_count) + ' new)' : ''}</span>`);
                const facCount = facNames.length + (e.facility_other ? 1 : 0);
                if (facCount)         details.push(`<span class="text-amber-600">${facCount} facilit${facCount === 1 ? 'y' : 'ies'}</span>`);
                historyRows += `<tr class="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onclick="GenericViews._showActivityDetail('${project.id}','event','${e.id}')">
                    <td class="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">${this._fmtEventDate(e)}</td>
                    <td class="px-4 py-2">${this._eventTypeBadge(e.type)}</td>
                    <td class="px-4 py-2 text-sm text-slate-800 font-medium">${App.escapeHtml(e.title || '')}</td>
                    <td class="px-4 py-2 text-xs">${details.join(' · ')}</td>
                    <td class="px-4 py-2 whitespace-nowrap text-right" data-edit-only>
                        <button onclick="event.stopPropagation(); GenericViews._editEvent('${project.id}','${e.id}')" class="text-gsf-boston hover:text-gsf-prussian text-xs font-bold mr-2">Edit</button>
                        <button onclick="event.stopPropagation(); GenericViews._deleteEvent('${project.id}','${e.id}')" class="text-red-400 hover:text-red-600 text-xs font-bold">Delete</button>
                    </td>
                </tr>`;
            } else {
                const linkIcon = e.link ? ` <a href="${App.escapeHtml(e.link)}" onclick="event.stopPropagation(); electronAPI.openExternal('${App.escapeHtml(e.link)}'); return false;" class="inline-flex items-center text-gsf-boston hover:text-gsf-prussian ml-1" title="${App.escapeHtml(e.link)}"><i data-lucide="external-link" width="12"></i></a>` : '';
                historyRows += `<tr class="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onclick="GenericViews._showActivityDetail('${project.id}','update','${e.id}')">
                    <td class="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">${e.date}</td>
                    <td class="px-4 py-2"><span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-purple-100 text-purple-700"><i data-lucide="flag" width="10"></i>Milestone</span></td>
                    <td class="px-4 py-2 text-sm text-slate-800 font-medium">${App.escapeHtml(e.title || '')}${linkIcon}</td>
                    <td class="px-4 py-2 text-xs"></td>
                    <td class="px-4 py-2 whitespace-nowrap text-right" data-edit-only>
                        <button onclick="event.stopPropagation(); GenericViews._editUpdate('${project.id}','${e.id}')" class="text-gsf-boston hover:text-gsf-prussian text-xs font-bold mr-2">Edit</button>
                        <button onclick="event.stopPropagation(); GenericViews._deleteNarrativeUpdate('${project.id}','${e.id}')" class="text-red-400 hover:text-red-600 text-xs font-bold">Delete</button>
                    </td>
                </tr>`;
            }
        });

        // HCW totals — scoped to the Activities tab's own year filter (specific year, all-time, or range).
        const trainingEvents = events.filter(e => inFilter(e.date));
        const totalHcw    = trainingEvents.reduce((s, e) => s + (Number(e.hcw_count)     || 0), 0);
        const totalHcwNew = trainingEvents.reduce((s, e) => s + (Number(e.hcw_new_count) || 0), 0);
        const yearLabel = filterLabel;
        const hcwCounter = `
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                <div class="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
                    <div class="w-10 h-10 rounded-lg bg-gsf-boston/10 flex items-center justify-center shrink-0">
                        <i data-lucide="users" width="18" class="text-gsf-boston"></i>
                    </div>
                    <div class="flex-1">
                        <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">HCWs Logged (${yearLabel})</p>
                        <p class="text-xl font-black text-gsf-prussian leading-tight">${this._fmt(totalHcw)}</p>
                    </div>
                </div>
                <div class="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
                    <div class="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                        <i data-lucide="user-plus" width="18" class="text-emerald-600"></i>
                    </div>
                    <div class="flex-1">
                        <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">New (Unduplicated) HCWs (${yearLabel})</p>
                        <p class="text-xl font-black text-gsf-prussian leading-tight">${this._fmt(totalHcwNew)}</p>
                    </div>
                </div>
            </div>
            <p class="text-[11px] text-slate-400 italic mb-4 -mt-3">For tracking only — not auto-counted into KPIs. Enter actuals manually in <button onclick="App.navigate('project-setup')" class="text-gsf-boston hover:underline">Project Setup</button>.</p>`;

        main.innerHTML = `
            <div class="p-6 md:p-10 fade-in w-full max-w-5xl mx-auto">
                ${this._viewerNotice('Activities are read-only in view mode. Unlock editing to log new training, milestones, or edit existing entries.')}
                <header class="mb-6 flex items-start justify-between flex-wrap gap-3">
                    <div>
                        <h1 class="text-2xl font-bold text-gsf-prussian">Activities</h1>
                        <p class="text-sm text-slate-500 mt-1">Log any activity: training, mentoring, site visits, or other updates. KPI actuals are entered in <button onclick="App.navigate('project-setup')" class="text-gsf-boston hover:underline font-medium">Data Entry</button>.</p>
                    </div>
                    <div class="flex flex-col items-end gap-1">
                        ${activityYearSelector}
                        <p class="text-[10px] text-slate-400 italic">Showing <strong class="text-slate-600">${filterLabel}</strong></p>
                    </div>
                </header>

                ${hcwCounter}

                ${trainingEvents.some(e => e.hcw_count || e.hcw_new_count) ? `
                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-8">
                    <div class="flex items-baseline justify-between mb-4">
                        <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide">HCWs over time</h2>
                        <p class="text-[11px] text-slate-400">Cumulative across activities · click any point for activity detail</p>
                    </div>
                    <div id="hcw-time-chart" style="width:100%; height:280px;"></div>
                </div>` : ''}

                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-8" data-edit-only>
                    ${editingUpd ? milestoneForm : eventForm}
                </div>

                ${allEntries.length > 0 ? `
                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide mb-4">All Entries <span class="text-slate-400 font-normal normal-case">(${allEntries.length})</span></h2>
                    <div class="overflow-x-auto">
                        <table class="w-full">
                            <thead><tr class="border-b-2 border-slate-200">
                                <th class="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Date</th>
                                <th class="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Type</th>
                                <th class="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Title</th>
                                <th class="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Details</th>
                                <th class="px-4 py-2"></th>
                            </tr></thead>
                            <tbody>${historyRows}</tbody>
                        </table>
                    </div>
                </div>` : ''}
            </div>`;

        if (window.lucide) lucide.createIcons();
        // Render the HCWs-over-time chart after the DOM is in place
        if (trainingEvents.some(e => e.hcw_count || e.hcw_new_count)) {
            setTimeout(() => this._drawHcwOverTimeChart(project.id, trainingEvents), 100);
        }
    },

    // Cumulative HCWs over time — one line each for total and "new this year".
    // Each event becomes one visible point. Click any point to open its activity detail.
    _drawHcwOverTimeChart(projectId, trainingEvents) {
        const el = document.getElementById('hcw-time-chart');
        if (!el || !window.google?.visualization) return;
        // Include every event with a date AND some HCW activity. Strict number checks so
        // empty strings / null / undefined are excluded but legitimate zeros (for the *other*
        // field) still pass via OR.
        const hasH  = (v) => v !== null && v !== undefined && v !== '' && Number(v) > 0;
        const dated = (trainingEvents || []).filter(e => e.date && (hasH(e.hcw_count) || hasH(e.hcw_new_count)))
            .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        if (dated.length === 0) { el.innerHTML = '<p class="text-xs text-slate-300 italic text-center pt-16">No HCW data yet</p>'; return; }

        // Build cumulative totals over time — one snapshot per event.
        let cumTotal = 0, cumNew = 0;
        const points = dated.map(e => {
            cumTotal += Number(e.hcw_count)     || 0;
            cumNew   += Number(e.hcw_new_count) || 0;
            return { date: e.date, cumTotal, cumNew, event: e };
        });

        const dt = new google.visualization.DataTable();
        dt.addColumn('date', 'Date');
        dt.addColumn('number', 'Cumulative HCWs');
        dt.addColumn({ type: 'string', role: 'tooltip', p: { html: true } });
        dt.addColumn('number', 'New HCWs (cumulative)');
        dt.addColumn({ type: 'string', role: 'tooltip', p: { html: true } });

        const escape = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const fmtDate = (s) => { const [y,m,d] = String(s).split('-'); return new Date(Number(y), Number(m)-1, Number(d)); };
        points.forEach(p => {
            const tipTotal = `<div style="padding:6px 10px;font-size:12px;line-height:1.4">
                <strong>${escape(p.event.title)}</strong><br>
                <span style="color:#94a3b8">${escape(p.event.date)}</span><br>
                +${(Number(p.event.hcw_count) || 0).toLocaleString()} HCW this activity<br>
                <strong style="color:#4389C8">${p.cumTotal.toLocaleString()} HCW</strong> cumulative
            </div>`;
            const tipNew = `<div style="padding:6px 10px;font-size:12px;line-height:1.4">
                <strong>${escape(p.event.title)}</strong><br>
                <span style="color:#94a3b8">${escape(p.event.date)}</span><br>
                +${(Number(p.event.hcw_new_count) || 0).toLocaleString()} new HCW this activity<br>
                <strong style="color:#10b981">${p.cumNew.toLocaleString()} new HCW</strong> cumulative
            </div>`;
            dt.addRow([fmtDate(p.date), p.cumTotal, tipTotal, p.cumNew, tipNew]);
        });

        const chart = new google.visualization.LineChart(el);
        const opts = {
            height: 280,
            legend: { position: 'top', alignment: 'end', textStyle: { fontSize: 11, color: '#64748b' } },
            colors: ['#4389C8', '#10b981'],
            chartArea: { left: 60, top: 30, right: 30, bottom: 50, width: '88%', height: '76%' },
            hAxis: {
                textStyle: { fontSize: 11, color: '#64748b' },
                baselineColor: '#e2e8f0',
                gridlines: { color: 'transparent' },
                format: 'MMM yyyy'
            },
            vAxis: { textStyle: { fontSize: 10, color: '#94a3b8' }, baselineColor: '#e2e8f0', gridlines: { color: '#f1f5f9', count: 5 }, minorGridlines: { count: 0 }, minValue: 0, format: 'short' },
            // Straight-line segments (no smoothing) — clearer that each data point is a discrete event.
            lineWidth: 2.5,
            pointSize: 9,
            pointShape: 'circle',
            // Tooltip on hover: 'focus' means the tooltip appears when the user hovers a point.
            // 'datum' focus target ensures the tooltip is for the single hovered point (not the whole
            // category which would try to show two tooltips simultaneously and end up showing none).
            tooltip: { isHtml: true, trigger: 'focus', ignoreBounds: true },
            backgroundColor: 'transparent',
            interpolateNulls: false,
            focusTarget: 'datum',
            crosshair: { trigger: 'focus', orientation: 'vertical', color: '#cbd5e1', opacity: 0.4 }
        };
        chart.draw(dt, opts);

        // Click-to-open-activity-detail: when a data point is selected, open its event modal.
        google.visualization.events.addListener(chart, 'select', () => {
            const sel = chart.getSelection();
            if (!sel || sel.length === 0) return;
            const row = sel[0].row;
            if (row === null || row === undefined) return;
            const ev = points[row].event;
            if (ev && ev.id) GenericViews._showActivityDetail(projectId, 'event', ev.id);
        });
    },

    _editEvent(projectId, eventId) {
        if (!eventId || eventId === 'undefined' || eventId === 'null') {
            App.showMsg('This entry has no ID. Reloading the list to fix it…');
            App.renderView();
            return;
        }
        Projects.getEvents(projectId).then(events => {
            const ev = events.find(e => e.id === eventId);
            if (!ev) {
                App.showMsg('Could not find that entry. The list has been refreshed.', true);
                App.renderView();
                return;
            }
            App.editingEventId = eventId;
            App.editingUpdateId = null;
            App.activityTab = 'event';
            App.navigate('project-activities');
        });
    },

    _editUpdate(projectId, updateId) {
        // Guard against the literal string "undefined" — happens when an entry
        // has no id and the onclick template baked '${e.id}' as 'undefined'.
        if (!updateId || updateId === 'undefined' || updateId === 'null') {
            App.showMsg('This entry has no ID. Reloading the list to fix it…');
            App.renderView();
            return;
        }
        App.editingUpdateId = updateId;
        App.editingEventId  = null;
        App.activityTab = 'milestone';
        App.navigate('project-activities');
    },

    _validateHcwNew() {
        const hcwEl    = document.getElementById('ev-hcw');
        const hcwNewEl = document.getElementById('ev-hcw-new');
        const warnEl   = document.getElementById('ev-hcw-warn');
        if (!hcwEl || !hcwNewEl) return true;
        const total = parseFloat(hcwEl.value) || 0;
        const fresh = parseFloat(hcwNewEl.value) || 0;
        const invalid = fresh > total;
        if (warnEl) warnEl.classList.toggle('hidden', !invalid);
        hcwNewEl.classList.toggle('border-red-400', invalid);
        hcwNewEl.classList.toggle('border-emerald-200', !invalid);
        // Clamp on the fly so the user can't enter more than total
        if (invalid) hcwNewEl.value = total;
        return !invalid;
    },

    async _saveEvent(projectId) {
        const title = (document.getElementById('ev-title') || {}).value?.trim();
        const date  = (document.getElementById('ev-date')  || {}).value;
        if (!date || !title) { App.showMsg('Date and title are required.', true); return; }

        // Validate HCW counts: new <= total
        const hcwTotal = parseFloat((document.getElementById('ev-hcw')     || {}).value) || 0;
        const hcwFresh = parseFloat((document.getElementById('ev-hcw-new') || {}).value) || 0;
        if (hcwFresh > hcwTotal) {
            App.showMsg('"New this year" cannot exceed total HCWs involved.', true);
            return;
        }

        const editingId = App.editingEventId || null;
        const type  = (document.getElementById('ev-type') || {}).value || 'training_mentoring';
        const endDate = (document.getElementById('ev-end-date') || {}).value || '';
        if (endDate && endDate < date) { App.showMsg('End date cannot be before the start date.', true); return; }
        const event = { type, date, title };
        if (endDate) event.endDate = endDate;
        if (editingId) event.id = editingId;

        const notes = (document.getElementById('ev-notes') || {}).value?.trim();
        if (notes) event.notes = notes;

        const link = (document.getElementById('ev-link') || {}).value?.trim();
        if (link) event.link = link;

        if (hcwTotal) event.hcw_count     = hcwTotal;
        if (hcwFresh) event.hcw_new_count = hcwFresh;

        // Collect checked facilities and derive KPI fields
        const facChecks = document.querySelectorAll('input[name="ev-fac"]:checked');
        if (facChecks.length > 0) {
            const facIds = Array.from(facChecks).map(cb => cb.value);
            event.facilities = facIds;
            event.facilities_count = facIds.length;
            // Sum catchment population from facility records
            const allFacs = await Projects.getFacilities(projectId);
            const checkedFacs = allFacs.filter(f => facIds.includes(f.id));
            const pop = checkedFacs.reduce((sum, f) => sum + (Number(f.catchmentPop) || 0), 0);
            if (pop > 0) event.population = pop;
        }
        // "Other facility" checkbox
        const otherFacEl = document.getElementById('ev-fac-other');
        if (otherFacEl && otherFacEl.checked) event.facility_other = true;

        await Projects.saveEvent(projectId, event);
        App.editingEventId = null;
        App.renderView();
    },

    async _deleteEvent(projectId, eventId) {
        const events = await Projects.getEvents(projectId);
        const idx = events.findIndex(e => e.id === eventId);
        if (idx === -1) return;
        const removed = events.splice(idx, 1)[0];
        await Projects.replaceEvents(projectId, events);
        App.renderView();
        App.showUndo('Event deleted', async () => {
            const current = await Projects.getEvents(projectId);
            current.splice(idx, 0, removed);
            await Projects.replaceEvents(projectId, current);
            App.renderView();
        });
    },

    // ===== KPI PROGRESS =====
    async renderKpiProgress(main, project) {
        const now  = new Date();
        const year = App.kpiYear || now.getFullYear();
        const [allTargets, allActuals] = await Promise.all([
            Projects.getTargets(project.id),
            Projects.getActuals(project.id)
        ]);

        const targets    = Projects.getTargetsForYear(allTargets, year);
        const yearTotals = { ...Projects.getActualsForYear(allActuals, year) };

        const multiplierEnabled = project.hcwMultiplierEnabled && App.showHcwMultiplier;
        const multiplierRate    = project.hcwMultiplierRate !== undefined ? project.hcwMultiplierRate : 10;
        if (multiplierEnabled) {
            if (yearTotals.hcw_strengthened) yearTotals.hcw_strengthened = Math.round(yearTotals.hcw_strengthened * multiplierRate);
            if (targets.hcw_strengthened)    targets.hcw_strengthened    = Math.round(targets.hcw_strengthened    * multiplierRate);
        }

        // Build simple monthly data (no event-based cumulative — actuals are manual)
        const monthlyData = {};
        Projects.STANDARD_KPIS.forEach(kpi => {
            const total = yearTotals[kpi.id] || 0;
            // Spread actuals evenly across elapsed months for a simple chart
            const currentMonth = year === now.getFullYear() ? now.getMonth() + 1 : 12;
            monthlyData[kpi.id] = [];
            for (let m = 1; m <= 12; m++) {
                monthlyData[kpi.id].push([m, m <= currentMonth ? total : null]);
            }
        });

        const years = [];
        const yearMax = App.kpiYearMax != null ? Math.max(App.kpiYearMax, now.getFullYear() + 1) : now.getFullYear() + 1;
        for (let y = 2022; y <= yearMax; y++) years.push(y);
        const yearSelector = years.map(y =>
            `<button onclick="App.kpiYear=${y}; App.renderView()" class="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${y === year ? 'bg-gsf-boston text-white' : 'text-slate-500 hover:bg-slate-100'}">${y}</button>`
        ).join('') + `<button onclick="App.kpiYearMax=${yearMax + 1}; App.renderView()" class="px-2.5 py-1.5 rounded-lg text-sm font-semibold text-slate-400 hover:bg-slate-100" title="Add future year">+</button><button onclick="GenericViews._removeLastYear()" class="px-2.5 py-1.5 rounded-lg text-sm font-semibold text-slate-400 hover:bg-red-50 hover:text-red-500" title="Remove the topmost year (only allowed if it has no data)">−</button>`;

        const kpiCards = Projects.STANDARD_KPIS.map(kpi => {
            const current = yearTotals[kpi.id] || 0;
            const target  = targets[kpi.id] || 0;
            const pct     = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : null;

            return `
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex gap-8 items-start">
                <!-- Left: icon + title + stats -->
                <div class="shrink-0 w-64">
                    <div class="flex items-center gap-3 mb-4">
                        <div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style="background:${kpi.color}20">
                            <i data-lucide="${kpi.icon}" width="18" style="color:${kpi.color}"></i>
                        </div>
                        <div>
                            <h3 class="text-base font-black text-gsf-prussian leading-tight">${kpi.nameBig || kpi.name}</h3>
                            ${kpi.nameSub ? `<p class="text-xs text-slate-400 font-medium leading-tight mt-0.5">${kpi.nameSub}</p>` : ''}
                        </div>
                    </div>
                    <div class="flex items-end gap-2 mb-3">
                        <span class="text-4xl font-black" style="color:${kpi.color}">${this._fmt(current)}</span>
                        <span class="text-sm text-slate-400 mb-1">${kpi.unit}</span>
                    </div>
                    ${target > 0 ? `
                        <div class="mb-1">
                            <div class="flex justify-between text-xs text-slate-500 mb-1.5">
                                <span>Target: <strong style="color:${kpi.color}">${this._fmt(target)}</strong></span>
                                <span class="font-bold" style="color:${kpi.color}">${pct}%</span>
                            </div>
                            <div class="w-full bg-slate-100 rounded-full h-2">
                                <div class="h-2 rounded-full" style="width:${pct}%; background:${kpi.color}; transition:width 0.6s ease"></div>
                            </div>
                            <p class="text-[10px] text-slate-400 mt-1">${this._fmt(Math.max(0, target - current))} ${kpi.unit} remaining</p>
                        </div>
                    ` : `<p class="text-xs text-slate-400">No target — <button onclick="App.navigate('project-setup')" class="text-gsf-boston hover:underline">Set up in Data Entry</button></p>`}
                </div>
                <!-- Right: chart -->
                <div class="flex-1 min-w-0" id="chart-progress-${kpi.id}" style="min-height:130px;"></div>
            </div>`;
        }).join('');

        const multiplierToggle = project.hcwMultiplierEnabled ? `
            <button onclick="App.showHcwMultiplier=!App.showHcwMultiplier; App.renderView()" class="px-3 py-2 border rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${multiplierEnabled ? 'bg-gsf-boston text-white border-gsf-boston' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}" title="HCW multiplier (×${multiplierRate})">
                <i data-lucide="trending-up" width="14"></i> ×${multiplierRate} HCW
            </button>` : '';

        // Build multi-year data for project-level charts
        const allYearNums = [...new Set([
            ...allTargets.map(t => t.year),
            ...allActuals.map(a => a.year)
        ])].sort();
        const multiYearData = allYearNums.map(yr => {
            const t = { ...Projects.getTargetsForYear(allTargets, yr) };
            const a = { ...Projects.getActualsForYear(allActuals, yr) };
            if (multiplierEnabled) {
                if (a.hcw_strengthened) a.hcw_strengthened = Math.round(a.hcw_strengthened * multiplierRate);
                if (t.hcw_strengthened) t.hcw_strengthened = Math.round(t.hcw_strengthened * multiplierRate);
            }
            return { year: yr, targets: t, actuals: a };
        });

        const multiYearSection = multiYearData.length > 0 ? `
            <div class="mt-8">
                <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide mb-4">Multi-Year Progress</h2>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    ${Projects.STANDARD_KPIS.map(kpi => `
                    <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                        <div class="flex items-center gap-2 mb-2">
                            <div class="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style="background:${kpi.color}20">
                                <i data-lucide="${kpi.icon}" width="12" style="color:${kpi.color}"></i>
                            </div>
                            <p class="text-xs font-black text-gsf-prussian uppercase tracking-wide">${kpi.nameBig || kpi.name}</p>
                        </div>
                        <div id="proj-chart-${kpi.id}" style="min-height:220px;"></div>
                    </div>`).join('')}
                </div>
            </div>` : '';

        main.innerHTML = `
            <div class="p-6 md:p-10 fade-in w-full max-w-6xl mx-auto">
                <header class="mb-8 flex items-center justify-between flex-wrap gap-3">
                    <h1 class="text-2xl font-bold text-gsf-prussian">KPI Progress</h1>
                    <div class="flex items-center gap-2 flex-wrap">
                        <div class="flex items-center gap-1 bg-slate-100 rounded-lg p-1">${yearSelector}</div>
                        ${multiplierToggle}
                        <button onclick="App.navigate('project-setup')" class="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-semibold hover:bg-slate-50 transition-colors flex items-center gap-2">
                            <i data-lucide="database" width="14"></i> Data Entry
                        </button>
                    </div>
                </header>
                <div class="flex flex-col gap-4">${kpiCards}</div>
                ${multiYearSection}
            </div>`;

        if (window.lucide) lucide.createIcons();

        // Draw mini progress charts + multi-year charts
        setTimeout(() => {
            Projects.STANDARD_KPIS.forEach(kpi => {
                GenericCharts.drawCumulativeProgress(
                    'chart-progress-' + kpi.id,
                    monthlyData, kpi.id, targets[kpi.id] || 0, kpi.color
                );
            });
            if (multiYearData.length > 0) {
                GenericCharts.drawOrgYearlyProgress(multiYearData, year, 'proj-chart-');
            }
        }, 60);
    },

    _buildMonthlyCumulative(events, year) {
        // Returns { hcw_strengthened: [[month, cumulative], ...], ... } for a given year
        const kpiIds = Projects.STANDARD_KPIS.map(k => k.id);
        const result = {};
        kpiIds.forEach(id => { result[id] = []; });

        const yearEvents = events.filter(e => e.date && e.date.startsWith(String(year)));
        const monthTotals = {};
        for (let m = 1; m <= 12; m++) {
            monthTotals[m] = { hcw_strengthened: 0, patients_reached: 0, facilities_strengthened: 0, population_access: 0 };
        }
        yearEvents.forEach(e => {
            const m = parseInt(e.date.split('-')[1]);
            if (e.hcw_count)        monthTotals[m].hcw_strengthened      += Number(e.hcw_count) || 0;
            if (e.patient_count)    monthTotals[m].patients_reached       += Number(e.patient_count) || 0;
            if (e.facilities_count) monthTotals[m].facilities_strengthened += Number(e.facilities_count) || 0;
            if (e.population)       monthTotals[m].population_access       += Number(e.population) || 0;
        });

        kpiIds.forEach(id => {
            let cum = 0;
            for (let m = 1; m <= 12; m++) {
                cum += monthTotals[m][id];
                result[id].push([m, cum]);
            }
        });
        return result;
    },

    _showTargetEditor(projectId, year) {
        document.getElementById('target-editor').classList.remove('hidden');
        document.getElementById('target-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    async _saveTargets(projectId, year) {
        const kpiTargets = {};
        Projects.STANDARD_KPIS.forEach(kpi => {
            const el = document.getElementById('target-' + kpi.id);
            if (el && el.value !== '') kpiTargets[kpi.id] = parseFloat(el.value);
        });
        await Projects.saveTargets(projectId, year, kpiTargets);
        document.getElementById('target-editor').classList.add('hidden');
        App.renderView();
    },

    // ===== PROJECT SETUP =====
    async renderProjectSetup(main, project) {
        const now  = new Date();
        const year = App.kpiYear || now.getFullYear();
        const [facilities, allTargets, allActuals, allComments, kpiLog, qualityData, allQualityKpis, allBudget, kpiQComments] = await Promise.all([
            Projects.getFacilities(project.id),
            Projects.getTargets(project.id),
            Projects.getActuals(project.id),
            Projects.getKpiComments(project.id),
            Projects.getKpiLog(project.id),
            Projects.getQualityData(project.id),
            Projects.getAllQualityKpis(),
            Projects.getBudget(project.id),
            Projects.getKpiQuarterComments(project.id)
        ]);
        // Cache per-quarter KPI comments so the synchronous matrix renderer can read them.
        this._kpiQuarterCommentsCache = kpiQComments || [];
        const targets  = Projects.getTargetsForYear(allTargets, year);
        const actuals  = Projects.getActualsForYear(allActuals, year);
        const comments = Projects.getKpiCommentsForYear(allComments, year);

        const years = [];
        const yearMax = App.kpiYearMax != null ? Math.max(App.kpiYearMax, now.getFullYear() + 1) : now.getFullYear() + 1;
        for (let y = 2022; y <= yearMax; y++) years.push(y);
        const yearSelector = years.map(y =>
            `<button onclick="App.kpiYear=${y}; App.renderView()" class="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${y === year ? 'bg-gsf-boston text-white' : 'text-slate-500 hover:bg-slate-100'}">${y}</button>`
        ).join('') + `<button onclick="App.kpiYearMax=${yearMax + 1}; App.renderView()" class="px-2.5 py-1.5 rounded-lg text-sm font-semibold text-slate-400 hover:bg-slate-100" title="Add future year">+</button><button onclick="GenericViews._removeLastYear()" class="px-2.5 py-1.5 rounded-lg text-sm font-semibold text-slate-400 hover:bg-red-50 hover:text-red-500" title="Remove the topmost year (only allowed if it has no data)">−</button>`;

        const kpiRows = Projects.STANDARD_KPIS.map(kpi => {
            const tgt = targets[kpi.id] !== undefined ? targets[kpi.id] : '';
            const act = actuals[kpi.id] !== undefined ? actuals[kpi.id] : '';
            const tgtComment = App.escapeHtml((comments.targetComments || {})[kpi.id] || '');
            const actComment = App.escapeHtml((comments.actualComments || {})[kpi.id] || '');
            return `
            <div class="bg-slate-50 rounded-xl border border-slate-200 p-4">
                <div class="flex items-center gap-2 mb-3">
                    <i data-lucide="${kpi.icon}" width="14" style="color:${kpi.color}"></i>
                    <span class="text-xs font-black uppercase tracking-wide" style="color:${kpi.color}">${kpi.nameBig || kpi.name}</span>
                    <span class="text-xs text-slate-400">${kpi.nameSub || ''}</span>
                </div>
                <div class="grid grid-cols-2 gap-3 mb-2">
                    <div>
                        <label class="block text-[10px] font-bold text-slate-400 mb-1 uppercase">Target</label>
                        <input type="number" id="target-${kpi.id}" value="${tgt}" placeholder="0" min="0"
                            class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30 bg-white" />
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-slate-400 mb-1 uppercase">Actual</label>
                        <input type="number" id="actual-${kpi.id}" value="${act}" placeholder="0" min="0"
                            class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30 bg-white" />
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <textarea id="target-comment-${kpi.id}" rows="1" placeholder="Note on target…"
                            class="w-full px-2 py-1.5 border rounded-lg text-xs outline-none focus:ring-2 focus:ring-gsf-boston/30 bg-white resize-none text-slate-500">${tgtComment}</textarea>
                    </div>
                    <div>
                        <textarea id="actual-comment-${kpi.id}" rows="1" placeholder="Note on actual…"
                            class="w-full px-2 py-1.5 border rounded-lg text-xs outline-none focus:ring-2 focus:ring-gsf-boston/30 bg-white resize-none text-slate-500">${actComment}</textarea>
                    </div>
                </div>
            </div>`;
        }).join('');

        // Build KPI log HTML separately to avoid nested template literal issues
        // Filter to entries matching current year
        const yearLog = kpiLog.filter(e => e.year === year);
        let kpiLogHtml = '';
        if (yearLog.length > 0) {
            const logItems = yearLog.slice(0, 20).map(entry => {
                const dt    = new Date(entry.timestamp);
                const dtStr = dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                            + ' ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                const tc = entry.targetComments || {};
                const ac = entry.actualComments || {};
                const chips = Projects.STANDARD_KPIS
                    .filter(k => entry.targets[k.id] !== undefined || entry.actuals[k.id] !== undefined)
                    .map(k => {
                        const plan = entry.targets[k.id] !== undefined ? this._fmt(entry.targets[k.id]) : '—';
                        const act  = entry.actuals[k.id]  !== undefined ? this._fmt(entry.actuals[k.id])  : '—';
                        let chip = '<span class="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 bg-slate-100 rounded px-1.5 py-0.5">'
                             + '<span style="color:' + k.color + '">' + (k.nameBig || k.name) + '</span>'
                             + '<span class="text-amber-600">' + plan + '</span>'
                             + '<span class="text-slate-300">/</span>'
                             + '<span class="text-emerald-600">' + act + '</span>'
                             + '</span>';
                        // Show per-KPI notes if present
                        const notes = [];
                        if (tc[k.id]) notes.push('Plan: ' + App.escapeHtml(tc[k.id]));
                        if (ac[k.id]) notes.push('Actual: ' + App.escapeHtml(ac[k.id]));
                        if (notes.length) chip += '<span class="text-[9px] text-slate-400 italic ml-0.5">(' + notes.join('; ') + ')</span>';
                        return chip;
                    }).join(' ');
                const noteHtml = entry.note
                    ? '<p class="text-slate-400 italic text-[11px]">&ldquo;' + App.escapeHtml(entry.note) + '&rdquo;</p>'
                    : '';
                return '<div class="flex gap-3 text-xs pb-3 border-b border-slate-100 last:border-0 last:pb-0">'
                     + '<div class="text-[10px] text-slate-400 whitespace-nowrap pt-0.5 shrink-0">' + dtStr + '</div>'
                     + '<div class="flex-1 min-w-0">'
                     + '<div class="flex flex-wrap gap-1 mb-1">' + chips + '</div>'
                     + noteHtml
                     + '</div></div>';
            }).join('');
            kpiLogHtml = '<div class="mt-5 border-t border-slate-100 pt-4">'
                       + '<h3 class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-3">Entry History for ' + year + '</h3>'
                       + '<div class="space-y-3">' + logItems + '</div>'
                       + '</div>';
        }

        // --- Quality KPI entry section (quarterly, same card pattern as standard KPIs) ---
        const enabledQ = project.enabledQualityKpis || [];
        const activeQKpis = allQualityKpis.filter(k => enabledQ.includes(k.id));
        let qualityKpiHtml = '';
        if (activeQKpis.length > 0) {
            const quarter = App._qualityQuarter || Math.ceil((now.getMonth() + 1) / 3);
            const quarterBtns = [1,2,3,4].map(q =>
                `<button onclick="App._qualityQuarter=${q}; App.renderView()" class="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${q === quarter ? 'bg-gsf-boston text-white' : 'text-slate-500 hover:bg-slate-100'}">Q${q}</button>`
            ).join('');
            const qKpiCards = activeQKpis.map(kpi => {
                const entry = qualityData.find(d => d.kpiId === kpi.id && d.year === year && d.quarter === quarter);
                const tgt = entry?.target !== undefined && entry?.target !== null ? entry.target : '';
                const act = Projects.qualityActual(entry || {});
                const actVal = act !== null && act !== undefined ? act : '';
                return `
                <div class="bg-slate-50 rounded-xl border border-slate-200 p-4">
                    <div class="flex items-center gap-2 mb-3">
                        <div class="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style="background:${kpi.color}20">
                            <i data-lucide="${kpi.icon}" width="14" style="color:${kpi.color}"></i>
                        </div>
                        <span class="text-xs font-black uppercase tracking-wide" style="color:${kpi.color}">${kpi.shortName}</span>
                        <span class="text-xs text-slate-400">${kpi.name}</span>
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-[10px] font-bold text-slate-400 mb-1 uppercase">Target</label>
                            <input type="number" step="any" id="qtarget-${kpi.id}" value="${tgt}" placeholder="0"
                                class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30 bg-white" />
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-400 mb-1 uppercase">Actual</label>
                            <input type="number" step="any" id="qactual-${kpi.id}" value="${actVal}" placeholder="0"
                                class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30 bg-white" />
                        </div>
                    </div>
                    <p class="text-[10px] text-slate-400 mt-2">${kpi.unit}${kpi.lowerIsBetter ? ' · lower is better' : ''}</p>
                </div>`;
            }).join('');

            const qualityIsMatrix = App.qualityViewMode === 'matrix';
            qualityKpiHtml = `
                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
                    <div class="mb-4 flex items-end justify-between gap-3 flex-wrap">
                        <div>
                            <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide">Quality Indicators ${qualityIsMatrix ? '— Multi-Year View' : 'for ' + year}</h2>
                            <p class="text-xs text-slate-400 mt-0.5">${qualityIsMatrix ? 'Edit any quarterly cell. Changes save automatically when you click out — green flash + ✓ confirms.' : 'Enter quarterly targets and actuals for each enabled quality indicator.'}</p>
                        </div>
                        <div class="flex items-center gap-2">
                            ${!qualityIsMatrix ? `<div class="flex items-center gap-1 bg-slate-100 rounded-lg p-1">${quarterBtns}</div>` : ''}
                            <div class="inline-flex items-center gap-0.5 bg-slate-100 rounded-lg p-1" title="Switch between matrix and detail views">
                                <button onclick="App.qualityViewMode='matrix'; App.renderView()" class="px-3 py-1.5 rounded-md text-xs font-bold transition-all ${qualityIsMatrix ? 'bg-white shadow-sm text-gsf-boston' : 'text-slate-500 hover:text-slate-700'}"><i data-lucide="table" width="12" class="inline mr-1"></i> Matrix</button>
                                <button onclick="App.qualityViewMode='cards'; App.renderView()" class="px-3 py-1.5 rounded-md text-xs font-bold transition-all ${!qualityIsMatrix ? 'bg-white shadow-sm text-gsf-boston' : 'text-slate-500 hover:text-slate-700'}"><i data-lucide="layout-grid" width="12" class="inline mr-1"></i> Detail</button>
                            </div>
                        </div>
                    </div>
                    ${qualityIsMatrix
                        ? this._renderQualityMatrix(project, activeQKpis, qualityData, years)
                        : `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">${qKpiCards}</div>
                            <button onclick="GenericViews._saveSetupQualityKpis('${project.id}')" class="px-4 py-2 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors">Save Quality KPIs</button>`}
                </div>`;
        }

        const totalCatchment = facilities.reduce((s, f) => s + (Number(f.catchmentPop) || 0), 0);
        const totalPatients = facilities.reduce((s, f) => s + (Number(f.annualPatients) || 0), 0);
        const facilityRows = facilities.map((f, idx) => `
            <tr class="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onclick="GenericViews._showFacilityDetail('${project.id}', '${f.id}')">
                <td class="px-4 py-3 text-xs text-slate-400 text-center">${idx + 1}</td>
                <td class="px-4 py-3">
                    <div class="flex items-center gap-2">
                        <span class="text-sm font-semibold text-slate-800">${App.escapeHtml(f.name)}</span>
                        ${f.isHub ? '<span class="text-[9px] font-bold bg-gsf-boston/10 text-gsf-boston px-1.5 py-0.5 rounded uppercase tracking-wide">Hub</span>' : ''}
                    </div>
                </td>
                <td class="px-4 py-3 text-center">${(f.lat != null && f.lng != null) ? '<i data-lucide="map-pin" width="13" class="text-emerald-500 inline-block"></i>' : '<span class="text-slate-300">—</span>'}</td>
                <td class="px-4 py-3 text-sm text-slate-600 text-right">${f.catchmentPop ? this._fmt(Number(f.catchmentPop)) : '—'}</td>
                <td class="px-4 py-3 text-sm text-slate-600 text-right">${f.annualPatients ? this._fmt(Number(f.annualPatients)) : '—'}</td>
                <td class="px-4 py-3 text-xs text-slate-500 text-center tabular-nums">${f.yearAdded || '<span class="text-slate-300">—</span>'}</td>
                <td class="px-4 py-3 text-xs text-slate-400">${App.escapeHtml(f.notes || '')}</td>
                <td class="px-4 py-3 whitespace-nowrap text-right" data-edit-only>
                    <button onclick="event.stopPropagation(); GenericViews._editFacility('${project.id}', '${f.id}')" class="text-gsf-boston hover:text-gsf-prussian text-xs font-bold mr-3">Edit</button>
                    <button onclick="event.stopPropagation(); GenericViews._deleteFacility('${project.id}', '${f.id}')" class="text-red-400 hover:text-red-600 text-xs font-bold">Remove</button>
                </td>
            </tr>`).join('');

        main.innerHTML = `
            <div class="p-6 md:p-10 fade-in w-full max-w-4xl mx-auto">
                ${this._viewerNotice('Data Entry is read-only in view mode. Unlock editing to enter or change values.')}
                <header class="mb-8 flex items-center justify-between flex-wrap gap-3">
                    <h1 class="text-2xl font-bold text-gsf-prussian">Data Entry</h1>
                    <div class="flex items-center gap-2 flex-wrap">
                        <div class="flex items-center gap-1 bg-slate-100 rounded-lg p-1">${yearSelector}</div>
                        <button onclick="GenericViews._downloadIntakeTemplate('${project.id}')" data-edit-only
                            class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all" title="Download blank Excel intake template">
                            <i data-lucide="file-down" width="14" class="text-gsf-boston"></i> Template
                        </button>
                        <button onclick="GenericViews._exportFilledTemplate('${project.id}')" data-edit-only
                            class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all" title="Export current data as filled Excel sheet">
                            <i data-lucide="table-2" width="14" class="text-gsf-boston"></i> Export
                        </button>
                        <button onclick="GenericViews._importFromExcel('${project.id}')" data-edit-only
                            class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all" title="Import filled-in Excel intake sheet">
                            <i data-lucide="upload" width="14" class="text-gsf-boston"></i> Import
                        </button>
                        <button onclick="GenericViews._restorePreImportBackup('${project.id}')" data-edit-only
                            class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-500 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700 transition-all" title="Restore data from a pre-import backup">
                            <i data-lucide="history" width="14" class="text-amber-500"></i> Restore
                        </button>
                    </div>
                </header>

                <!-- KPIs: Targets + Actuals -->
                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
                    <div class="mb-4 flex items-end justify-between gap-3 flex-wrap">
                        <div>
                            <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide">KPIs ${App.kpiViewMode === 'matrix' ? '— Multi-Year View' : 'for ' + year}</h2>
                            <p class="text-xs text-slate-400 mt-0.5">${App.kpiViewMode === 'matrix' ? 'Edit any cell. Changes save automatically when you click out — green flash + ✓ confirms.' : 'Enter targets and actuals for each indicator. Add optional notes for context.'}</p>
                        </div>
                        <div class="inline-flex items-center gap-0.5 bg-slate-100 rounded-lg p-1" title="Switch between matrix (all years) and detail (one year + comments) views">
                            <button onclick="App.kpiViewMode='matrix'; App.renderView()" class="px-3 py-1.5 rounded-md text-xs font-bold transition-all ${App.kpiViewMode === 'matrix' ? 'bg-white shadow-sm text-gsf-boston' : 'text-slate-500 hover:text-slate-700'}"><i data-lucide="table" width="12" class="inline mr-1"></i> Matrix</button>
                            <button onclick="App.kpiViewMode='cards'; App.renderView()" class="px-3 py-1.5 rounded-md text-xs font-bold transition-all ${App.kpiViewMode === 'cards' ? 'bg-white shadow-sm text-gsf-boston' : 'text-slate-500 hover:text-slate-700'}"><i data-lucide="layout-grid" width="12" class="inline mr-1"></i> Detail</button>
                        </div>
                    </div>
                    ${App.kpiViewMode === 'matrix'
                        ? this._renderKpiMatrix(project, allTargets, allActuals, years)
                        : `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                                ${kpiRows}
                            </div>
                            <div class="mb-4">
                                <label class="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wide">Entry Note <span class="font-normal text-slate-300">(optional)</span></label>
                                <textarea id="kpi-log-note" rows="2" placeholder="Briefly describe what changed or why…"
                                    class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30 bg-white resize-none text-slate-600"></textarea>
                            </div>
                            <button onclick="GenericViews._saveSetupKpis('${project.id}', ${year})" data-edit-only class="px-4 py-2 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors">Save KPIs</button>`}
                    ${App.kpiViewMode === 'cards' ? kpiLogHtml : ''}
                </div>

                ${qualityKpiHtml}

                <!-- Facilities -->
                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <div class="mb-4 flex items-start justify-between">
                        <div>
                            <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide">Facilities</h2>
                            <p class="text-xs text-slate-400 mt-0.5">Facilities where you work. These can be referenced when logging events.</p>
                        </div>
                        <button onclick="GenericViews._importGeoFile('${project.id}')" data-edit-only
                            class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-all shrink-0" title="Import facilities from KML or GeoJSON">
                            <i data-lucide="map-pin-plus" width="13" class="text-gsf-boston"></i> Import KML / GeoJSON
                        </button>
                    </div>

                    ${facilities.length > 0 ? `
                        <div class="overflow-x-auto mb-6">
                            <table class="w-full">
                                <thead><tr class="border-b-2 border-slate-200">
                                    <th class="px-4 py-2 text-center text-xs font-bold text-slate-400 uppercase w-10">#</th>
                                    <th class="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Facility</th>
                                    <th class="px-4 py-2 text-center text-xs font-bold text-slate-500 uppercase w-10"><i data-lucide="map-pin" width="12" class="inline-block text-slate-400"></i></th>
                                    <th class="px-4 py-2 text-right text-xs font-bold text-slate-500 uppercase">Catchment</th>
                                    <th class="px-4 py-2 text-right text-xs font-bold text-slate-500 uppercase">Patients</th>
                                    <th class="px-4 py-2 text-center text-xs font-bold text-slate-500 uppercase">Year added</th>
                                    <th class="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Notes</th>
                                    <th></th>
                                </tr></thead>
                                <tbody>${facilityRows}</tbody>
                                ${facilities.length > 1 ? `<tfoot><tr class="border-t-2 border-slate-200 bg-slate-50">
                                    <td></td>
                                    <td class="px-4 py-2 text-xs font-bold text-slate-500 uppercase">Total (${facilities.length})</td>
                                    <td></td>
                                    <td class="px-4 py-2 text-sm font-bold text-slate-700 text-right">${totalCatchment ? this._fmt(totalCatchment) : '—'}</td>
                                    <td class="px-4 py-2 text-sm font-bold text-slate-700 text-right">${totalPatients ? this._fmt(totalPatients) : '—'}</td>
                                    <td></td><td></td><td></td>
                                </tr></tfoot>` : ''}
                            </table>
                        </div>
                    ` : `<p class="text-sm text-slate-400 italic mb-6">No facilities added yet.</p>`}

                    <div class="border-t border-slate-100 pt-5" data-edit-only>
                        <h3 class="text-xs font-bold text-slate-500 uppercase mb-3" id="fac-form-title">Add Facility</h3>
                        <input type="hidden" id="fac-edit-id" value="" />
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                            <div>
                                <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Facility Name *</label>
                                <input type="text" id="fac-name" placeholder="e.g. Kenyatta National Hospital" required class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            </div>
                            <div class="flex items-end pb-1">
                                <label class="flex items-center gap-2 cursor-pointer select-none">
                                    <input type="checkbox" id="fac-hub" class="w-4 h-4 rounded border-slate-300 text-gsf-boston focus:ring-gsf-boston/30" />
                                    <span class="text-sm font-semibold text-slate-600">Hub facility</span>
                                    <span class="text-[10px] text-slate-400">(otherwise Spoke)</span>
                                </label>
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Catchment Population</label>
                                <input type="number" id="fac-catchment" min="0" placeholder="e.g. 250000" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Patient Volume</label>
                                <input type="number" id="fac-patients" min="0" placeholder="e.g. 2000" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Year Added <span class="normal-case font-normal text-slate-400">(when this facility joined the project)</span></label>
                                <input type="number" id="fac-year-added" min="2000" max="2100" placeholder="e.g. ${new Date().getFullYear()}" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Notes</label>
                                <input type="text" id="fac-notes" placeholder="Facility type, level of care..." class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            </div>
                            <div class="sm:col-span-2">
                                <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Location <span class="normal-case font-normal text-slate-400">(for map)</span></label>
                                <div class="flex gap-2">
                                    <input type="text" id="fac-location-search" placeholder="Search: e.g. Kenyatta National Hospital, Nairobi"
                                        class="flex-1 px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30"
                                        onkeydown="if(event.key==='Enter'){event.preventDefault();GenericViews._geocodeSearch('fac');}" />
                                    <button type="button" onclick="GenericViews._geocodeSearch('fac')"
                                        class="px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg text-sm font-semibold text-slate-600 transition-colors flex items-center gap-1.5">
                                        <i data-lucide="search" width="13"></i> Find
                                    </button>
                                </div>
                                <div id="fac-geo-results" class="hidden mt-1 border border-slate-200 rounded-lg bg-white shadow-lg overflow-hidden z-50 relative"></div>
                                <div class="flex gap-3 mt-2">
                                    <div class="flex-1">
                                        <label class="block text-[10px] font-bold text-slate-400 mb-0.5 uppercase">Latitude</label>
                                        <input type="number" id="fac-lat" step="any" min="-90" max="90" placeholder="—" class="w-full px-2.5 py-1.5 border rounded-lg text-xs outline-none focus:ring-2 focus:ring-gsf-boston/30 bg-slate-50" />
                                    </div>
                                    <div class="flex-1">
                                        <label class="block text-[10px] font-bold text-slate-400 mb-0.5 uppercase">Longitude</label>
                                        <input type="number" id="fac-lng" step="any" min="-180" max="180" placeholder="—" class="w-full px-2.5 py-1.5 border rounded-lg text-xs outline-none focus:ring-2 focus:ring-gsf-boston/30 bg-slate-50" />
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="GenericViews._saveFacility('${project.id}')" class="px-4 py-2 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors" id="fac-save-btn">Add Facility</button>
                            <button id="fac-cancel-btn" onclick="GenericViews._cancelFacilityEdit()" class="hidden px-4 py-2 text-slate-500 hover:text-slate-700 text-sm font-medium border rounded-lg">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>`;

        if (window.lucide) lucide.createIcons();
    },

    // ── Shared workbook builder ────────────────────────────────────────────
    // filled=false → blank template; filled=true → pre-populate with current data
    async _buildIntakeWorkbook(projectId, filled = false) {
        const project = Projects.getProject(projectId);
        const allQualityKpis = await Projects.getAllQualityKpis();
        const enabledQ = (project.enabledQualityKpis || []);
        const activeQKpis = allQualityKpis.filter(k => enabledQ.includes(k.id));

        const now = new Date().getFullYear();
        const years = [];
        for (let y = 2022; y <= now + 2; y++) years.push(y);

        // Fetch existing data if filling
        let allTargets = [], allActuals = [], allFacilities = [], allQualityData = [], allEvents = [], allUpdates = [];
        if (filled) {
            [allTargets, allActuals, allFacilities, allQualityData, allEvents, allUpdates] = await Promise.all([
                Projects.getTargets(projectId),
                Projects.getActuals(projectId),
                Projects.getFacilities(projectId),
                Projects.getQualityData(projectId),
                Projects.getEvents(projectId),
                Projects.getUpdates(projectId)
            ]);
        } else {
            // For blank template, we still need facilities to populate the dropdown reference
            allFacilities = await Projects.getFacilities(projectId);
        }

        const wb = XLSX.utils.book_new();

        // ── Sheet 1: Instructions ────────────────────────────────────────────
        const instrRows = [
            [`SURGdash Data Intake — ${project.name}`],
            [],
            ['How to use this template:'],
            ['1. Fill in the "Facilities" sheet with the names of health facilities.'],
            ['2. Fill in the "Standard KPIs" sheet with annual targets and actuals.'],
            ['3. Fill in the "Quality Indicators" sheet with quarterly targets and actuals.'],
            ['4. Fill in the "Events" sheet with training events / activities logged.'],
            ['5. Fill in the "Milestones" sheet with narrative updates and milestones.'],
            ['6. Leave cells blank if data is not available for that period.'],
            ['7. Do not rename the sheets or change column headers.'],
            ['8. The "ID" column on Events / Milestones is auto-generated. Leave blank for new rows; keep it on existing rows to update them. Delete a row to delete that entry.'],
            ['9. Save the file and upload it in SURGdash via Data Entry → Import.'],
            [],
            ['Standard KPI definitions:'],
            ['  HCW Strengthened        — Number of healthcare workers trained or mentored'],
            ['  Patients Reached         — Number of patients who received surgical care'],
            ['  Facilities Strengthened  — Number of health facilities improved'],
            ['  Population Access        — Population with improved access to surgical care'],
            [],
            ['Events sheet — column reference:'],
            ['  Date (YYYY-MM-DD), Title, Category (Training / Mentoring / Other),'],
            ['  Total HCWs, Of which new this year, Facilities (semicolon-separated names from the Facilities sheet),'],
            ['  Other Facility (Yes/No), Notes, ID (do not edit).'],
            [],
            ['Milestones sheet — column reference:'],
            ['  Date (YYYY-MM-DD), Title, Tag, Link, Details, ID (do not edit).'],
            [],
            ['Quality Indicator definitions:'],
            ...activeQKpis.map(k => [`  ${k.shortName} (${k.name}) — ${k.unit}${k.lowerIsBetter ? ' · lower is better' : ''}`]),
            [],
            [(filled ? 'Exported' : 'Generated') + ' by SURGdash on ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })]
        ];
        const wsInstr = XLSX.utils.aoa_to_sheet(instrRows);
        wsInstr['!cols'] = [{ wch: 90 }];
        XLSX.utils.book_append_sheet(wb, wsInstr, 'Instructions');

        // ── Sheet 2: Facilities ──────────────────────────────────────────────
        const facHeaders = ['Facility Name', 'Catchment Population', 'Annual Patients', 'Notes', 'Latitude', 'Longitude'];
        const facData = filled && allFacilities.length
            ? allFacilities.map(f => [f.name || '', f.catchmentPop || '', f.annualPatients || '', f.notes || '', f.lat ?? '', f.lng ?? ''])
            : [['', '', '', '', '', ''], ['', '', '', '', '', ''], ['', '', '', '', '', '']];
        const wsFac = XLSX.utils.aoa_to_sheet([facHeaders, ...facData]);
        wsFac['!cols'] = [{ wch: 36 }, { wch: 22 }, { wch: 18 }, { wch: 36 }, { wch: 14 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, wsFac, 'Facilities');

        // ── Sheet 3: Standard KPIs ───────────────────────────────────────────
        const kpiHeaders = ['Year',
            'HCW Strengthened — Target', 'HCW Strengthened — Actual',
            'Patients Reached — Target', 'Patients Reached — Actual',
            'Facilities Strengthened — Target', 'Facilities Strengthened — Actual',
            'Population Access — Target', 'Population Access — Actual'
        ];
        const kpiIdMap = ['hcw_strengthened', 'patients_reached', 'facilities_strengthened', 'population_access'];
        const kpiRows = [kpiHeaders, ...years.map(y => {
            if (!filled) return [y, '', '', '', '', '', '', '', ''];
            const t = Projects.getTargetsForYear(allTargets, y);
            const a = Projects.getActualsForYear(allActuals, y);
            return [
                y,
                t.hcw_strengthened ?? '', a.hcw_strengthened ?? '',
                t.patients_reached ?? '', a.patients_reached ?? '',
                t.facilities_strengthened ?? '', a.facilities_strengthened ?? '',
                t.population_access ?? '', a.population_access ?? ''
            ];
        })];
        const wsKpi = XLSX.utils.aoa_to_sheet(kpiRows);
        wsKpi['!cols'] = [{ wch: 8 }, ...Array(8).fill({ wch: 30 })];
        XLSX.utils.book_append_sheet(wb, wsKpi, 'Standard KPIs');

        // ── Sheet 4: Quality Indicators (if any enabled) ─────────────────────
        if (activeQKpis.length > 0) {
            const qHeaders = ['Year', 'Quarter',
                ...activeQKpis.flatMap(k => [`${k.shortName} — Target`, `${k.shortName} — Actual`])
            ];
            const qRows = [qHeaders];
            years.forEach(y => {
                for (let q = 1; q <= 4; q++) {
                    if (!filled) {
                        qRows.push([y, q, ...activeQKpis.flatMap(() => ['', ''])]);
                    } else {
                        const vals = activeQKpis.flatMap(k => {
                            const entry = allQualityData.find(e => e.kpiId === k.id && e.year === y && e.quarter === q);
                            return [
                                entry?.target ?? '',
                                entry?.actual ?? ''
                            ];
                        });
                        qRows.push([y, q, ...vals]);
                    }
                }
            });
            const wsQ = XLSX.utils.aoa_to_sheet(qRows);
            wsQ['!cols'] = [{ wch: 8 }, { wch: 10 }, ...activeQKpis.flatMap(() => [{ wch: 26 }, { wch: 26 }])];
            XLSX.utils.book_append_sheet(wb, wsQ, 'Quality Indicators');
        }

        // ── Sheet 5: Events (training events / activities) ──────────────────
        const eventTypeLabel = (t) => {
            const legacyMap = { facility: 'Other', patients: 'Other', estimate: 'Other' };
            const eff = legacyMap[t] || t;
            return (Projects.EVENT_TYPES[eff] && Projects.EVENT_TYPES[eff].label) || 'Training';
        };
        const facNameById = {};
        allFacilities.forEach(f => { facNameById[f.id] = f.name; });
        const evHeaders = ['Date', 'Title', 'Category', 'Total HCWs', 'Of which new this year',
            'Facilities', 'Other Facility', 'Notes', 'ID'];
        let evData;
        if (filled && allEvents.length > 0) {
            evData = allEvents
                .slice()
                .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                .map(e => [
                    e.date || '',
                    e.title || '',
                    eventTypeLabel(e.type),
                    e.hcw_count || '',
                    e.hcw_new_count || '',
                    (e.facilities || []).map(fid => facNameById[fid] || '').filter(Boolean).join('; '),
                    e.facility_other ? 'Yes' : 'No',
                    e.notes || '',
                    e.id || ''
                ]);
        } else {
            evData = [['', '', 'Training', '', '', '', 'No', '', ''],
                      ['', '', 'Training', '', '', '', 'No', '', ''],
                      ['', '', 'Training', '', '', '', 'No', '', '']];
        }
        const wsEv = XLSX.utils.aoa_to_sheet([evHeaders, ...evData]);
        wsEv['!cols'] = [{ wch: 12 }, { wch: 36 }, { wch: 12 }, { wch: 12 }, { wch: 18 },
                         { wch: 36 }, { wch: 14 }, { wch: 36 }, { wch: 22 }];
        XLSX.utils.book_append_sheet(wb, wsEv, 'Events');

        // ── Sheet 6: Milestones (narrative updates) ─────────────────────────
        const upHeaders = ['Date', 'Title', 'Tag', 'Link', 'Details', 'ID'];
        let upData;
        if (filled && allUpdates.length > 0) {
            upData = allUpdates
                .slice()
                .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                .map(u => [
                    u.date || '',
                    u.title || '',
                    (u.tags || [])[0] || '',
                    u.link || '',
                    u.body || '',
                    u.id || ''
                ]);
        } else {
            upData = [['', '', '', '', '', ''], ['', '', '', '', '', ''], ['', '', '', '', '', '']];
        }
        const wsUp = XLSX.utils.aoa_to_sheet([upHeaders, ...upData]);
        wsUp['!cols'] = [{ wch: 12 }, { wch: 36 }, { wch: 16 }, { wch: 36 }, { wch: 50 }, { wch: 22 }];
        XLSX.utils.book_append_sheet(wb, wsUp, 'Milestones');

        return wb;
    },

    async _downloadIntakeTemplate(projectId) {
        try {
            const project = Projects.getProject(projectId);
            const wb = await this._buildIntakeWorkbook(projectId, false);
            const ipcRenderer = electronAPI;
            const savePath = await ipcRenderer.invoke('pick-save-path', `${project.name} — SURGdash Intake.xlsx`);
            if (!savePath) return;
            electronAPI.fs.writeFileSync(savePath, new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' })));
            App.showMsg('Blank template downloaded ✓');
        } catch (err) {
            console.error(err);
            alert('Template export failed: ' + err.message);
        }
    },

    async _exportFilledTemplate(projectId) {
        try {
            const project = Projects.getProject(projectId);
            const wb = await this._buildIntakeWorkbook(projectId, true);
            const ipcRenderer = electronAPI;
            const dateStr = new Date().toISOString().slice(0, 10);
            const savePath = await ipcRenderer.invoke('pick-save-path', `${project.name} — SURGdash Export ${dateStr}.xlsx`);
            if (!savePath) return;
            electronAPI.fs.writeFileSync(savePath, new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' })));
            App.showMsg('Data exported ✓');
        } catch (err) {
            console.error(err);
            alert('Export failed: ' + err.message);
        }
    },

    async _importFromExcel(projectId) {
        try {
            const ipcRenderer = electronAPI;
            const filePath = await ipcRenderer.invoke('pick-xlsx-open-path');
            if (!filePath) return;

            const buf = electronAPI.fs.readFileSync(filePath);
            const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
            const allQualityKpis = await Projects.getAllQualityKpis();

            // ── Pre-import backup ────────────────────────────────────────────
            const [existingTargets, existingActuals, existingQuality, existingFacilities, existingEvents, existingUpdates] = await Promise.all([
                Projects.getTargets(projectId),
                Projects.getActuals(projectId),
                Projects.getQualityData(projectId),
                Projects.getFacilities(projectId),
                Projects.getEvents(projectId),
                Projects.getUpdates(projectId)
            ]);
            const fs = electronAPI.fs;
            const path = electronAPI.path;
            const backupDir = path.join(electronAPI.os.homedir(), 'Documents', 'SURGdash', 'backups');
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
            const backupStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            fs.writeFileSync(
                path.join(backupDir, `${projectId}_pre-import_${backupStamp}.json`),
                JSON.stringify({ version: 2, projectId, timestamp: new Date().toISOString(),
                    targets: existingTargets, actuals: existingActuals,
                    quality: existingQuality, facilities: existingFacilities,
                    events: existingEvents, updates: existingUpdates }, null, 2), 'utf8'
            );

            // Helper: strip thousand-separators (commas) and parse to number
            // e.g. "1,234" → 1234,  "3.14" → 3.14,  1234 → 1234
            const toNum = val => {
                if (val === '' || val === null || val === undefined) return null;
                if (typeof val === 'number') return val;
                const cleaned = String(val).replace(/,/g, '').trim();
                const n = parseFloat(cleaned);
                return isNaN(n) ? null : n;
            };

            // ── Build mutable maps from existing data ────────────────────────
            const targetsByYear = {};
            existingTargets.forEach(t => { targetsByYear[t.year] = { ...t.kpis }; });
            const actualsByYear = {};
            existingActuals.forEach(a => { actualsByYear[a.year] = { ...a.kpis }; });

            let facCount = 0, kpiCount = 0, qualityCount = 0, eventCount = 0, updateCount = 0;

            // ── Parse Facilities sheet ───────────────────────────────────────
            const wsFac = wb.Sheets['Facilities'];
            if (wsFac) {
                const rows = XLSX.utils.sheet_to_json(wsFac, { header: 1, defval: '' });
                // row 0 is header; data starts at row 1
                const newFacilities = [];
                for (let r = 1; r < rows.length; r++) {
                    const row = rows[r];
                    const name = String(row[0] || '').trim();
                    if (!name) continue; // skip blank rows
                    // Try to match existing facility by name (case-insensitive) to preserve IDs
                    const existing = existingFacilities.find(f => f.name.toLowerCase() === name.toLowerCase());
                    const facLat = toNum(row[4]);
                    const facLng = toNum(row[5]);
                    newFacilities.push({
                        id:            existing?.id || ('fac-' + Date.now().toString(36) + '-' + r),
                        name,
                        catchmentPop:  toNum(row[1]) || 0,
                        annualPatients:toNum(row[2]) || 0,
                        notes:         String(row[3] || '').trim(),
                        ...(facLat !== null ? { lat: facLat } : {}),
                        ...(facLng !== null ? { lng: facLng } : {})
                    });
                    facCount++;
                }
                // Append any existing facilities that aren't in the sheet (preserve unlisted ones)
                existingFacilities.forEach(ef => {
                    if (!newFacilities.find(nf => nf.id === ef.id)) newFacilities.push(ef);
                });
                await Storage.setItem(`surgdash_facilities_${projectId}`, newFacilities);
            }

            // ── Parse Standard KPIs sheet ────────────────────────────────────
            const wsKpi = wb.Sheets['Standard KPIs'];
            if (wsKpi) {
                const rows = XLSX.utils.sheet_to_json(wsKpi, { header: 1, defval: '' });
                const kpiMap = {
                    'HCW Strengthened':        'hcw_strengthened',
                    'Patients Reached':         'patients_reached',
                    'Facilities Strengthened':  'facilities_strengthened',
                    'Population Access':        'population_access'
                };
                const header = rows[0] || [];
                const colMap = {}; // index → { id, type }
                header.forEach((h, i) => {
                    if (!h) return;
                    const str = String(h).trim();
                    for (const [label, id] of Object.entries(kpiMap)) {
                        if (str.startsWith(label)) {
                            colMap[i] = { id, type: str.toLowerCase().includes('actual') ? 'actual' : 'target' };
                        }
                    }
                });

                for (let r = 1; r < rows.length; r++) {
                    const row = rows[r];
                    const year = parseInt(row[0]);
                    if (!year || isNaN(year)) continue;
                    if (!targetsByYear[year]) targetsByYear[year] = {};
                    if (!actualsByYear[year]) actualsByYear[year] = {};

                    for (const [colIdx, { id, type }] of Object.entries(colMap)) {
                        const num = toNum(row[Number(colIdx)]);
                        if (num !== null) {
                            if (type === 'target') targetsByYear[year][id] = num;
                            else actualsByYear[year][id] = num;
                            kpiCount++;
                        }
                    }
                }

                // Write complete arrays once — avoids race condition
                const finalTargets = Object.entries(targetsByYear)
                    .filter(([, kpis]) => Object.keys(kpis).length > 0)
                    .map(([yr, kpis]) => ({ year: parseInt(yr), kpis }));
                const finalActuals = Object.entries(actualsByYear)
                    .filter(([, kpis]) => Object.keys(kpis).length > 0)
                    .map(([yr, kpis]) => ({ year: parseInt(yr), kpis }));
                await Promise.all([
                    Storage.setItem(`surgdash_targets_${projectId}`, finalTargets),
                    Storage.setItem(`surgdash_actuals_${projectId}`, finalActuals)
                ]);
            }

            // ── Parse Quality Indicators sheet ────────────────────────────────
            const wsQ = wb.Sheets['Quality Indicators'];
            if (wsQ) {
                const rows = XLSX.utils.sheet_to_json(wsQ, { header: 1, defval: '' });
                const header = rows[0] || [];
                const qColMap = {};
                header.forEach((h, i) => {
                    if (!h || i < 2) return;
                    const str = String(h).trim();
                    // Handle em-dash (—), en-dash (–), or plain hyphen
                    const shortName = str.split(/\s*[—–-]\s*/)[0].trim();
                    const isActual = str.toLowerCase().includes('actual');
                    const kpi = allQualityKpis.find(k => k.shortName === shortName);
                    if (kpi) qColMap[i] = { kpiId: kpi.id, type: isActual ? 'actual' : 'target' };
                });

                // Merge into existing quality data
                const qualityMap = {};
                existingQuality.forEach(e => { qualityMap[`${e.kpiId}|${e.year}|${e.quarter}`] = { ...e }; });

                for (let r = 1; r < rows.length; r++) {
                    const row = rows[r];
                    const year = parseInt(row[0]);
                    const quarter = parseInt(row[1]);
                    if (!year || !quarter || isNaN(year) || isNaN(quarter)) continue;

                    for (const [colIdx, { kpiId, type }] of Object.entries(qColMap)) {
                        const num = toNum(row[Number(colIdx)]);
                        if (num !== null) {
                            const key = `${kpiId}|${year}|${quarter}`;
                            if (!qualityMap[key]) qualityMap[key] = { kpiId, year, quarter, target: null, actual: null };
                            qualityMap[key][type] = num;
                            qualityCount++;
                        }
                    }
                }

                await Storage.setItem(`surgdash_quality_data_${projectId}`, Object.values(qualityMap));
            }

            // ── Parse Events sheet ────────────────────────────────────────────
            const wsEv = wb.Sheets['Events'];
            if (wsEv) {
                const rows = XLSX.utils.sheet_to_json(wsEv, { header: 1, defval: '' });
                // Refresh facilities (in case sheet just added some) and build name→id map
                const updatedFacilities = await Projects.getFacilities(projectId);
                const facIdByName = {};
                updatedFacilities.forEach(f => { facIdByName[f.name.toLowerCase().trim()] = f.id; });

                const categoryToType = {
                    'training':  'workshop',
                    'workshop':  'workshop',
                    'mentoring': 'mentoring',
                    'mentorship':'mentoring',
                    'other':     'other'
                };

                const truthy = v => /^(yes|y|true|1|x)$/i.test(String(v).trim());

                const newEvents = [];
                for (let r = 1; r < rows.length; r++) {
                    const row = rows[r];
                    const date  = String(row[0] || '').trim();
                    const title = String(row[1] || '').trim();
                    if (!date || !title) continue; // skip blank/header rows

                    const catRaw = String(row[2] || 'training').toLowerCase().trim();
                    const type = categoryToType[catRaw] || 'workshop';

                    const hcwTotal = toNum(row[3]);
                    let hcwNew = toNum(row[4]);
                    // Enforce: new ≤ total
                    if (hcwTotal !== null && hcwNew !== null && hcwNew > hcwTotal) hcwNew = hcwTotal;

                    // Facilities: semicolon or comma separated list of names → IDs
                    const facNames = String(row[5] || '').split(/[;,]/).map(s => s.trim()).filter(Boolean);
                    const facIds = [];
                    facNames.forEach(n => {
                        const id = facIdByName[n.toLowerCase()];
                        if (id) facIds.push(id);
                    });

                    const facOther = truthy(row[6]);
                    const notes    = String(row[7] || '').trim();
                    const id       = String(row[8] || '').trim();

                    const ev = { type, date, title };
                    if (id) ev.id = id;
                    if (notes) ev.notes = notes;
                    if (hcwTotal) ev.hcw_count = hcwTotal;
                    if (hcwNew)   ev.hcw_new_count = hcwNew;
                    if (facIds.length > 0) {
                        ev.facilities = facIds;
                        ev.facilities_count = facIds.length;
                        const pop = updatedFacilities.filter(f => facIds.includes(f.id))
                            .reduce((s, f) => s + (Number(f.catchmentPop) || 0), 0);
                        if (pop > 0) ev.population = pop;
                    }
                    if (facOther) ev.facility_other = true;

                    // Generate ID for new rows so subsequent re-imports can match
                    if (!ev.id) ev.id = 'ev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
                    newEvents.push(ev);
                    eventCount++;
                }
                // Replace events fully with the sheet (rows in sheet = source of truth)
                await Projects.replaceEvents(projectId, newEvents);
            }

            // ── Parse Milestones sheet ───────────────────────────────────────
            const wsUp = wb.Sheets['Milestones'];
            if (wsUp) {
                const rows = XLSX.utils.sheet_to_json(wsUp, { header: 1, defval: '' });
                const newUpdates = [];
                for (let r = 1; r < rows.length; r++) {
                    const row = rows[r];
                    const date  = String(row[0] || '').trim();
                    const title = String(row[1] || '').trim();
                    if (!date || !title) continue;

                    const tag   = String(row[2] || '').trim();
                    const link  = String(row[3] || '').trim();
                    const body  = String(row[4] || '').trim();
                    const id    = String(row[5] || '').trim();

                    const u = { date, title };
                    if (id) u.id = id;
                    if (tag)  u.tags = [tag];
                    if (link) u.link = link;
                    if (body) u.body = body;
                    if (!u.id) u.id = 'up-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
                    newUpdates.push(u);
                    updateCount++;
                }
                await Projects.replaceUpdates(projectId, newUpdates);
            }

            const parts = [];
            if (facCount)     parts.push(`${facCount} facilities`);
            if (kpiCount)     parts.push(`${kpiCount} KPI values`);
            if (qualityCount) parts.push(`${qualityCount} quality entries`);
            if (eventCount)   parts.push(`${eventCount} events`);
            if (updateCount)  parts.push(`${updateCount} milestones`);
            App.showMsg(`Import complete — ${parts.join(', ') || 'nothing changed'}. Backup saved.`);
            App.renderView();
        } catch (err) {
            console.error(err);
            alert('Import failed: ' + err.message);
        }
    },

    // Show restore modal (replaces prompt() which is blocked in Electron)
    // ── Restore from an automatic backup (the backups/ folder) ────────────
    // SURGdash auto-saves snapshots before syncs/pulls. This surfaces them so the
    // user can roll back in one click instead of hunting through the folder. Kinds:
    //   • pre-restore_*.json — FULL storage snapshot (everything)
    //   • presync_*/        — SURGhub data/history/ambassadors before a sync
    //   • pre-pull_*.json   — SURGfund project KPI data before a cloud pull
    _listAutoBackups() {
        const fs = electronAPI.fs, path = electronAPI.path;
        const dir = path.join(Storage.DATA_DIR, 'backups');
        const out = [];
        if (!fs.existsSync(dir)) return out;
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
        const tsOf = raw => { const m = String(raw).match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/); return m ? m[1] : ''; };
        const lbl = ts => { const m = ts.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : ts; };
        entries.forEach(e => {
            const name = e.name; if (!name) return;
            let kind = null, label = '';
            if (/^pre-restore_.*\.json$/.test(name)) { kind = 'full'; label = 'Full backup'; }
            else if (/^pre-pull_.*\.json$/.test(name)) { kind = 'projects'; label = 'Projects (pre cloud-pull)'; }
            else if (/^presync_/.test(name)) { kind = 'surghub'; label = 'SURGhub data (pre-sync)'; }
            if (!kind) return;
            const ts = tsOf(name);
            out.push({ name, kind, label, ts, when: lbl(ts) });
        });
        out.sort((a, b) => (a.ts < b.ts ? 1 : -1));   // newest first
        return out;
    },

    _showLocalBackupBrowser() {
        const list = this._listAutoBackups();
        if (!list.length) { alert('No automatic backups found yet in ~/Documents/SURGdash/backups.'); return; }
        GenericViews._autoBackupList = list;
        const dot = { full: '#206095', projects: '#4389C8', surghub: '#7A9E9F' };
        const rows = list.slice(0, 80).map((b, i) => `
            <button onclick="GenericViews._restoreAutoBackup(${i})"
                style="text-align:left;padding:10px 14px;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc;font-size:13px;color:#1e293b;cursor:pointer;display:flex;justify-content:space-between;gap:10px;align-items:center;"
                onmouseover="this.style.background='#f0f9ff';this.style.borderColor='#38bdf8'"
                onmouseout="this.style.background='#f8fafc';this.style.borderColor='#e2e8f0'">
                <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${dot[b.kind] || '#94a3b8'};margin-right:8px;vertical-align:middle"></span>${b.when}</span>
                <span style="font-size:11px;color:#64748b">${b.label}</span>
            </button>`).join('');
        const modalHtml = `
            <div id="autobackup-modal-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center;">
                <div style="background:#fff;border-radius:16px;padding:28px 32px;width:520px;max-width:92vw;box-shadow:0 8px 40px rgba(0,0,0,0.18);">
                    <h3 style="font-size:16px;font-weight:700;color:#0d2c4e;margin:0 0 4px">Restore from auto-backup</h3>
                    <p style="font-size:13px;color:#64748b;margin:0 0 14px">SURGdash auto-saves these before syncs and pulls. Pick one to restore — your current data is saved first, so it's reversible. <strong>Full</strong> = everything · <strong>Projects</strong> = SURGfund KPI data · <strong>SURGhub</strong> = learning data.</p>
                    <div style="display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto;margin-bottom:18px;">${rows}</div>
                    <button onclick="document.getElementById('autobackup-modal-overlay').remove()" style="width:100%;padding:10px;border-radius:8px;border:1px solid #e2e8f0;background:#f1f5f9;font-size:13px;font-weight:600;color:#64748b;cursor:pointer;">Cancel</button>
                </div>
            </div>`;
        const overlay = document.createElement('div');
        overlay.innerHTML = modalHtml;
        document.body.appendChild(overlay.firstElementChild);
    },

    async _restoreAutoBackup(idx) {
        const b = (GenericViews._autoBackupList || [])[idx];
        if (!b) return;
        document.getElementById('autobackup-modal-overlay')?.remove();
        const scope = b.kind === 'full' ? 'ALL data (projects + SURGhub + settings)'
                    : b.kind === 'projects' ? 'SURGfund project KPI data (targets, actuals, events, updates)'
                    : 'SURGhub learning data (overview, history, ambassadors)';
        if (!confirm(`Restore this ${b.label} from ${b.when}?\n\nThis overwrites ${scope} with the backup. Your current data is saved as a fresh backup first, so this is reversible.`)) return;
        const fs = electronAPI.fs, path = electronAPI.path;
        const dir = path.join(Storage.DATA_DIR, 'backups');
        // 1) Safety: snapshot current full state BEFORE any overwrite so the restore is
        // reversible. If this fails, ABORT — never destroy live data without a rollback.
        let safetyOk = false;
        try {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const allKeys = await Storage.keys();
            const cur = {};
            for (const k of allKeys) cur[k] = await Storage.getItem(k);
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            fs.writeFileSync(path.join(dir, `pre-restore_${stamp}.json`), JSON.stringify({ version: 1, timestamp: new Date().toISOString(), data: cur }, null, 2), 'utf8');
            safetyOk = true;
            const snaps = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.name && /^pre-restore_.*\.json$/.test(e.name)).map(e => e.name).sort();
            for (const old of snaps.slice(0, Math.max(0, snaps.length - 10))) { try { fs.unlinkSync(path.join(dir, old)); } catch (_) {} }
        } catch (e) { console.warn('pre-restore snapshot failed:', e); }
        if (!safetyOk) {
            alert('Could not write a safety backup of your current data — restore aborted to avoid unrecoverable data loss.\n\nCheck that ~/Documents/SURGdash/backups is writable with free space, then try again.');
            return;
        }

        App.showMsg('Restoring…');
        let n = 0;
        try {
            if (b.kind === 'full') {
                const backup = JSON.parse(fs.readFileSync(path.join(dir, b.name), 'utf8'));
                for (const [k, v] of Object.entries(backup.data || {})) { await Storage.setItem(k, v); n++; }
                // renderView() does NOT re-read storage — reload the SURGhub blob into
                // memory so platform/learner views reflect the restore without a restart.
                const d = await Storage.getItem('surghub_data'); if (d) App.data = d;
                const h = await Storage.getItem('surghub_history'); if (h) App.userHistory = h;
                const a = await Storage.getItem('surghub_ambassadors'); if (a) App.ambassadorData = a;
                const u = await Storage.getItem('surghub_unique_users'); if (u) App.platformUniqueUsers = parseInt(u);
                const an = await Storage.getItem('surghub_anon_users'); if (an) App._rawAnonymizedUsers = an;
                const ed = await Storage.getItem('surghub_email_demo'); if (ed) App._emailDemoMap = ed;
                // Completion (~37MB) isn't reloaded into memory here — invalidate its lazy
                // cache so the next reader re-reads the just-restored value, not a stale one.
                App._rawCompletion = null; App._completionLoadPromise = null; App._anonLoadPromise = null;
            } else if (b.kind === 'projects') {
                const backup = JSON.parse(fs.readFileSync(path.join(dir, b.name), 'utf8'));
                for (const [id, p] of Object.entries(backup.projects || {})) {
                    if (!Projects.registry.find(pp => pp.id === id)) continue;   // skip ids no longer in the registry (avoid orphan files)
                    if (p.targets     != null) { await Storage.setItem(`surgdash_targets_${id}`, p.targets); n++; }
                    if (p.actuals     != null) { await Storage.setItem(`surgdash_actuals_${id}`, p.actuals); n++; }
                    if (p.events      != null) { await Projects.replaceEvents(id, p.events);   n++; }
                    if (p.updates     != null) { await Projects.replaceUpdates(id, p.updates); n++; }
                    if (p.comments    != null) { await Storage.setItem(`surgdash_kpi_comments_${id}`, p.comments); n++; }
                    if (p.kpiLog      != null) { await Storage.setItem(`surgdash_kpi_log_${id}`, p.kpiLog); n++; }
                    if (p.qualityData != null) { await Storage.setItem(`surgdash_quality_data_${id}`, p.qualityData); n++; }
                    if (p.facilities  != null) { await Storage.setItem(`surgdash_facilities_${id}`, p.facilities); n++; }
                }
            } else if (b.kind === 'surghub') {
                const map = { 'data.json': 'surghub_data', 'history.json': 'surghub_history', 'ambassadors.json': 'surghub_ambassadors' };
                for (const [file, key] of Object.entries(map)) {
                    const fp = path.join(dir, b.name, file);
                    if (fs.existsSync(fp)) { try { await Storage.setItem(key, JSON.parse(fs.readFileSync(fp, 'utf8'))); n++; } catch (_) {} }
                }
                const d = await Storage.getItem('surghub_data'); if (d) App.data = d;
                const h = await Storage.getItem('surghub_history'); if (h) App.userHistory = h;
                const a = await Storage.getItem('surghub_ambassadors'); if (a) App.ambassadorData = a;
            }
            // Restored SURGhub data is now ahead of the cloud — set the unsynced sentinel
            // so the safe auto-pull won't clobber it before the user pushes it.
            if (b.kind === 'surghub' || b.kind === 'full') {
                try { await Storage.setItem('surghub_unsynced_local', true); await Storage.setItem('surghub_local_mtime', new Date().toISOString()); } catch (_) {}
            }
        } catch (e) {
            alert('Restore failed partway: ' + (e && e.message ? e.message : e) + '\n\nSome items may have been partially written. A safety backup of your pre-restore state was saved first (backups/pre-restore_*.json) — use "Restore from auto-backup" to roll back to it if needed.');
            return;
        }
        await Projects.loadRegistry();
        if (App.markDirty) App.markDirty();   // restored state differs from cloud → needs a Sync to push
        alert(`Restore complete ✓\n\nRestored ${n} item${n === 1 ? '' : 's'} from the ${b.label} (${b.when}).\n\nIf it looks right, click Sync to push it to Google Sheets.`);
        App.renderView();
    },

    async _restorePreImportBackup(projectId) {
        const fs = electronAPI.fs;
        const path = electronAPI.path;
        const backupDir = path.join(electronAPI.os.homedir(), 'Documents', 'SURGdash', 'backups');

        let files = [];
        if (fs.existsSync(backupDir)) {
            files = fs.readdirSync(backupDir)
                .filter(f => f.startsWith(projectId + '_pre-import_') && f.endsWith('.json'))
                .sort().reverse(); // newest first
        }

        if (!files.length) {
            alert('No pre-import backups found for this project.');
            return;
        }

        // Format timestamps for display
        const items = files.map((f, i) => {
            const raw = f.replace(projectId + '_pre-import_', '').replace('.json', '');
            // raw is like 2026-04-10T14-30-00 → "10 Apr 2026, 14:30"
            const parts = raw.split('T');
            const dateParts = (parts[0] || '').split('-');
            const timeParts = (parts[1] || '').split('-');
            const label = dateParts.length === 3
                ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}  ${timeParts.slice(0,2).join(':')}`
                : raw;
            return { f, label, i };
        });

        // Build modal HTML
        const modalHtml = `
            <div id="restore-modal-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center;">
                <div style="background:#fff;border-radius:16px;padding:28px 32px;width:420px;max-width:90vw;box-shadow:0 8px 40px rgba(0,0,0,0.18);">
                    <h3 style="font-size:16px;font-weight:700;color:#0d2c4e;margin:0 0 4px">Restore Pre-Import Backup</h3>
                    <p style="font-size:13px;color:#64748b;margin:0 0 16px">Select a snapshot to restore. Your current data will be saved as a backup first.</p>
                    <div style="display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto;margin-bottom:20px;">
                        ${items.map(({ label, i }) => `
                            <button onclick="GenericViews._doRestore('${projectId}', ${i})"
                                style="text-align:left;padding:10px 14px;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc;font-size:13px;color:#1e293b;cursor:pointer;transition:background 0.15s;"
                                onmouseover="this.style.background='#f0f9ff';this.style.borderColor='#38bdf8'"
                                onmouseout="this.style.background='#f8fafc';this.style.borderColor='#e2e8f0'">
                                <span style="color:#64748b;margin-right:8px">${i + 1}.</span>${label}
                            </button>`).join('')}
                    </div>
                    <button onclick="document.getElementById('restore-modal-overlay').remove()"
                        style="width:100%;padding:10px;border-radius:8px;border:1px solid #e2e8f0;background:#f1f5f9;font-size:13px;font-weight:600;color:#64748b;cursor:pointer;">
                        Cancel
                    </button>
                </div>
            </div>`;

        // Store files list for _doRestore to access
        GenericViews._restoreFiles = files;
        GenericViews._restoreProjectId = projectId;

        const overlay = document.createElement('div');
        overlay.innerHTML = modalHtml;
        document.body.appendChild(overlay.firstElementChild);
    },

    async _doRestore(projectId, idx) {
        document.getElementById('restore-modal-overlay')?.remove();
        const fs = electronAPI.fs;
        const path = electronAPI.path;
        const backupDir = path.join(electronAPI.os.homedir(), 'Documents', 'SURGdash', 'backups');
        const files = GenericViews._restoreFiles || [];
        if (!files[idx]) return;

        try {
            const backup = JSON.parse(fs.readFileSync(path.join(backupDir, files[idx]), 'utf8'));

            // Save current state before restoring
            const [curTargets, curActuals, curQuality, curFacilities, curEvents, curUpdates] = await Promise.all([
                Projects.getTargets(projectId),
                Projects.getActuals(projectId),
                Projects.getQualityData(projectId),
                Projects.getFacilities(projectId),
                Projects.getEvents(projectId),
                Projects.getUpdates(projectId)
            ]);
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            fs.writeFileSync(
                path.join(backupDir, `${projectId}_pre-restore_${stamp}.json`),
                JSON.stringify({ version: 2, projectId, timestamp: new Date().toISOString(),
                    targets: curTargets, actuals: curActuals, quality: curQuality,
                    facilities: curFacilities, events: curEvents, updates: curUpdates }, null, 2), 'utf8'
            );

            const ops = [
                Storage.setItem(`surgdash_targets_${projectId}`, backup.targets || []),
                Storage.setItem(`surgdash_actuals_${projectId}`, backup.actuals || []),
                Storage.setItem(`surgdash_quality_data_${projectId}`, backup.quality || [])
            ];
            // Newer backups (v2+) include facilities/events/updates — restore them too if present
            if (Array.isArray(backup.facilities)) ops.push(Storage.setItem(`surgdash_facilities_${projectId}`, backup.facilities));
            if (Array.isArray(backup.events))     ops.push(Projects.replaceEvents(projectId, backup.events));
            if (Array.isArray(backup.updates))    ops.push(Projects.replaceUpdates(projectId, backup.updates));
            await Promise.all(ops);

            App.showMsg('Backup restored successfully ✓');
            App.renderView();
        } catch (err) {
            console.error(err);
            alert('Restore failed: ' + err.message);
        }
    },

    // ===== COST-EFFECTIVENESS CARD on the project dashboard =====
    _renderCostEffectiveness(project, allBudget, allActuals, allTargets, year) {
        if (!allBudget || allBudget.length === 0) {
            return `
                <div class="bg-white rounded-xl border border-dashed border-emerald-200 p-5 mb-8 flex items-center gap-3">
                    <div class="bg-emerald-100 text-emerald-600 p-2 rounded-lg shrink-0"><i data-lucide="banknote" width="16"></i></div>
                    <div class="flex-1">
                        <p class="text-sm font-bold text-slate-700">No budget data yet</p>
                        <p class="text-xs text-slate-500">Add allocated budget in <button onclick="App.navigate('project-setup')" class="text-gsf-boston hover:underline font-medium">Data Entry</button> to unlock cost-per-result metrics.</p>
                    </div>
                </div>
            `;
        }
        const currency = project.currency || 'USD';
        const ce = Projects.computeCostEffectiveness(allBudget, allActuals, allTargets, year);
        const { totalAllocated, actualCostPer, actualKpiTotals, targetCostPer, targetKpiTotals } = ce;
        const isAllYear = year === 'all';

        const fmtMoney = (n) => {
            if (n === null || n === undefined || !isFinite(n)) return '—';
            const rounded = Math.round(n);
            if (rounded >= 1000000) return (rounded / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
            if (rounded >= 10000) return (rounded / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
            return this._fmt(rounded);
        };
        const fmtUnit = (n) => {
            if (n === null || n === undefined) return '—';
            return this._fmt(Math.round(n));
        };

        // Standardised pattern: hover reveals the formula on the card itself, click opens detail modal.
        const costCards = Projects.STANDARD_KPIS.map(kpi => {
            const cA = actualCostPer[kpi.id];   const nA = actualKpiTotals[kpi.id];
            const cP = targetCostPer[kpi.id];   const nP = targetKpiTotals[kpi.id];
            const formulaA = cA === null ? 'No actuals yet' : `${currency} ${fmtMoney(totalAllocated)} ÷ ${fmtUnit(nA)} ${kpi.unit || 'units'}`;
            const formulaP = cP === null ? 'No targets set' : `${currency} ${fmtMoney(totalAllocated)} ÷ ${fmtUnit(nP)} ${kpi.unit || 'units'}`;
            return `<div class="relative group border border-slate-200 rounded-lg p-4 bg-white cursor-pointer hover:shadow-md transition-shadow overflow-hidden" style="border-top: 2px solid ${kpi.color}"
                onclick="GenericViews._showCostEffectivenessDetail('${kpi.id}')">
                <span class="absolute top-2 right-2 text-[9px] font-bold uppercase opacity-0 group-hover:opacity-70 transition-opacity" style="color:${kpi.color}">Detail →</span>
                <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-3">Cost per ${(kpi.nameBig || kpi.name).toLowerCase()}</p>
                <div class="flex items-baseline justify-between gap-2 mb-2">
                    <span class="text-2xl font-black text-slate-800">${cA === null ? '<span class="text-slate-300">—</span>' : `<span class="text-xs text-slate-400 font-normal">${currency}</span> ${fmtMoney(cA)}`}</span>
                    <span class="text-[10px] font-bold uppercase text-slate-400">Actual</span>
                </div>
                <div class="flex items-baseline justify-between gap-2 pt-2 border-t border-slate-100">
                    <span class="text-lg font-bold text-slate-500">${cP === null ? '<span class="text-slate-300">—</span>' : `<span class="text-[10px] text-slate-400 font-normal">${currency}</span> ${fmtMoney(cP)}`}</span>
                    <span class="text-[10px] font-bold uppercase text-slate-400">Planned</span>
                </div>
                <!-- Hover: formula fades in (space is reserved → card height stays constant) -->
                <div class="mt-2 pt-2 border-t border-slate-100 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <p class="text-[9px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">Actual</p>
                    <p class="font-mono text-[10px] text-slate-600 leading-tight mb-1.5">${formulaA}</p>
                    <p class="text-[9px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">Planned</p>
                    <p class="font-mono text-[10px] text-slate-600 leading-tight">${formulaP}</p>
                </div>
            </div>`;
        }).join('');

        const periodLabel = isAllYear ? 'all time' : year;
        return `
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-8">
                <div class="flex items-end justify-between gap-3 flex-wrap mb-5">
                    <div>
                        <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide flex items-center gap-2"><i data-lucide="trending-up" width="14" class="text-slate-500"></i> Budget &amp; Cost-Effectiveness</h2>
                        <p class="text-xs text-slate-400 mt-0.5">Cost of project results for <strong class="text-slate-600">${periodLabel}</strong>. Each card shows <strong>Actual</strong> (achieved) and <strong>Planned</strong> (against target). Hover for the formula · click for detail.</p>
                    </div>
                    <div class="text-right">
                        <p class="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Allocated budget</p>
                        <p class="text-2xl font-black text-slate-700"><span class="text-xs text-slate-400 font-normal">${currency}</span> ${fmtMoney(totalAllocated)}</p>
                    </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    ${costCards}
                </div>
            </div>
        `;
    },

    // ===== ECONOMIC IMPACT — Calculation Detail Modal =====
    // Click any card on the Economic Impact section to open this modal.
    // Renders a fully-traced breakdown: definition, formula, inputs (with sources),
    // worked example with arithmetic, constants used, caveats, citations.
    async _showEconomicDetail(metricKey) {
        const projectId = App.currentProject;
        const project = Projects.getProject(projectId);
        if (!project) return;
        const year = App.kpiYear === 'all' ? 'all' : (App.kpiYear || new Date().getFullYear());
        const [allBudget, allActuals, qualityData] = await Promise.all([
            Projects.getBudget(project.id),
            Projects.getActuals(project.id),
            Projects.getQualityData(project.id),
        ]);
        const detail = Projects.computeMetricBreakdown(project, allBudget, allActuals, qualityData, year, metricKey);
        if (!detail) return;
        const modal = document.getElementById('econ-detail-modal');
        const body  = document.getElementById('econ-detail-body');
        if (!modal || !body) return;
        body.innerHTML = this._renderEconomicDetailHtml(detail, project);
        modal.classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
    },

    _closeEconomicDetail() {
        const modal = document.getElementById('econ-detail-modal');
        if (modal) modal.classList.add('hidden');
    },

    _renderEconomicDetailHtml(d, project) {
        const currency = project.currency || 'USD';
        const fmtNum = (n) => n === null || n === undefined || !isFinite(n) ? '—' : Math.round(Number(n)).toLocaleString('en-US');
        const fmt1 = (n) => n === null || n === undefined || !isFinite(n) ? '—' : Number(n).toFixed(1);
        const fmt2 = (n) => n === null || n === undefined || !isFinite(n) ? '—' : Number(n).toFixed(2);
        const fmtUnit = (val, unit) => {
            if (unit === currency || unit === currency + ' / DALY' || unit === currency + ' avoided' || (typeof unit === 'string' && unit.indexOf(currency) === 0))
                return `${currency} ${fmtNum(val)}`;
            if (unit === '× return') return `${fmt1(val)}×`;
            return `${fmt1(val)} ${unit || ''}`.trim();
        };

        // ── Inputs section ──
        const inputsTable = `
            <table class="w-full text-sm border-collapse">
                <thead class="border-b border-slate-200"><tr>
                    <th class="text-left py-2 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wide">Variable</th>
                    <th class="text-left py-2 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wide">Value</th>
                    <th class="text-left py-2 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wide">Source</th>
                </tr></thead>
                <tbody>
                    ${d.inputs.map(i => `<tr class="border-b border-slate-100">
                        <td class="py-2 px-3 font-mono text-xs text-gsf-prussian">${App.escapeHtml(i.name)}</td>
                        <td class="py-2 px-3 text-sm font-bold tabular-nums text-slate-700">${App.escapeHtml(String(i.value))} <span class="text-[10px] font-normal text-slate-400">${App.escapeHtml(i.unit || '')}</span></td>
                        <td class="py-2 px-3 text-xs text-slate-500 italic">${App.escapeHtml(i.source)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        `;

        // ── Worked example section (year-by-year OR single-step OR components) ──
        let workedHtml = '';
        if (d.steps && d.steps.length > 0) {
            workedHtml = `
                <table class="w-full text-sm border-collapse">
                    <thead class="border-b border-slate-200"><tr>
                        <th class="text-left py-2 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wide">Year</th>
                        <th class="text-left py-2 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wide">Calculation</th>
                        <th class="text-right py-2 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wide">Result</th>
                    </tr></thead>
                    <tbody>
                        ${d.steps.map(s => `<tr class="border-b border-slate-100 hover:bg-slate-50">
                            <td class="py-2 px-3 text-sm font-bold text-gsf-prussian align-top">${s.year}</td>
                            <td class="py-2 px-3 text-xs text-slate-600 font-mono">${App.escapeHtml(s.calc)}${s.sources && s.sources.length ? `<div class="text-[10px] text-slate-400 italic mt-0.5">Quarterly source: ${s.sources.map(q => `Q${q.q} = ${q.actual}`).join(', ')} → avg ${fmt2(s.current)}</div>` : ''}</td>
                            <td class="py-2 px-3 text-right text-sm font-bold text-gsf-prussian tabular-nums align-top">${fmtUnit(s.result, s.unit)}</td>
                        </tr>`).join('')}
                        <tr class="border-t-2 border-gsf-prussian/30 bg-slate-50">
                            <td class="py-2 px-3 text-xs font-bold text-slate-500 uppercase">Total</td>
                            <td class="py-2 px-3"></td>
                            <td class="py-2 px-3 text-right text-base font-black text-gsf-prussian tabular-nums">${fmtUnit(d.total, d.totalUnit)}</td>
                        </tr>
                    </tbody>
                </table>
            `;
        } else if (d.singleStep) {
            workedHtml = `
                <div class="bg-slate-50 rounded-lg p-4 border">
                    <p class="text-xs font-mono text-slate-600 mb-2">${App.escapeHtml(d.singleStep.calc)}</p>
                    <p class="text-base font-black text-gsf-prussian">= ${fmtUnit(d.singleStep.result, d.totalUnit)}</p>
                </div>
            `;
        } else if (d.components) {
            workedHtml = `
                <table class="w-full text-sm border-collapse">
                    <thead class="border-b border-slate-200"><tr>
                        <th class="text-left py-2 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wide">Component</th>
                        ${d.components[0]?.weight !== undefined ? `<th class="text-right py-2 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wide">Count</th><th class="text-right py-2 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wide">DALY weight</th>` : ''}
                        <th class="text-right py-2 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wide">Contribution</th>
                        ${d.components[0]?.metricKey ? `<th></th>` : ''}
                    </tr></thead>
                    <tbody>
                        ${d.components.map(c => `<tr class="border-b border-slate-100">
                            <td class="py-2 px-3 text-sm font-medium text-slate-700">${App.escapeHtml(c.label)}</td>
                            ${c.weight !== undefined ? `<td class="py-2 px-3 text-right text-xs tabular-nums">${fmt1(c.count)}</td><td class="py-2 px-3 text-right text-xs tabular-nums text-slate-500">× ${c.weight}</td>` : ''}
                            <td class="py-2 px-3 text-right text-sm font-bold text-gsf-prussian tabular-nums">${fmt1(c.contrib !== undefined ? c.contrib : c.result)}</td>
                            ${c.metricKey ? `<td class="py-2 px-3"><button onclick="GenericViews._showEconomicDetail('${c.metricKey}')" class="text-[11px] text-gsf-boston hover:underline font-medium whitespace-nowrap">Open detail →</button></td>` : ''}
                        </tr>`).join('')}
                        <tr class="border-t-2 border-gsf-prussian/30 bg-slate-50">
                            <td class="py-2 px-3 text-xs font-bold text-slate-500 uppercase">Total</td>
                            ${d.components[0]?.weight !== undefined ? `<td></td><td></td>` : ''}
                            <td class="py-2 px-3 text-right text-base font-black text-gsf-prussian tabular-nums">${fmtUnit(d.total, d.totalUnit)}</td>
                            ${d.components[0]?.metricKey ? `<td></td>` : ''}
                        </tr>
                    </tbody>
                </table>
            `;
        }

        // ── Benchmark callout (cost per DALY) ──
        const benchmarkHtml = d.benchmark ? `
            <div class="mt-3 px-4 py-3 rounded-lg ${d.benchmark.belowThreshold ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}">
                <p class="text-[10px] font-bold uppercase tracking-wide mb-1 ${d.benchmark.belowThreshold ? 'text-emerald-700' : 'text-amber-700'}">${d.benchmark.belowThreshold ? '✓' : '⚠'} ${App.escapeHtml(d.benchmark.label)}</p>
                <p class="text-xs ${d.benchmark.belowThreshold ? 'text-emerald-700' : 'text-amber-700'}">${App.escapeHtml(d.benchmark.value)}</p>
            </div>
        ` : '';

        return `
            <div class="px-6 pt-5 pb-3 border-b border-slate-200 sticky top-0 bg-white z-10 flex items-start justify-between gap-4">
                <div class="flex-1">
                    <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Calculation detail · verify &amp; validate</p>
                    <h3 class="text-xl font-black text-gsf-prussian">${App.escapeHtml(d.title)}</h3>
                </div>
                <button onclick="GenericViews._closeEconomicDetail()" class="text-slate-400 hover:text-slate-700 shrink-0 p-1"><i data-lucide="x" width="20"></i></button>
            </div>
            <div class="p-6 space-y-6 overflow-y-auto">

                <section>
                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Definition</h4>
                    <p class="text-sm text-slate-700 leading-relaxed">${App.escapeHtml(d.definition)}</p>
                </section>

                <section>
                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Formula</h4>
                    <div class="bg-slate-900 text-emerald-300 rounded-lg p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">${App.escapeHtml(d.formulaText)}${d.totalFormula ? '\n' + App.escapeHtml(d.totalFormula) : ''}</div>
                </section>

                <section>
                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Inputs (from this project)</h4>
                    <div class="border rounded-lg overflow-hidden">${inputsTable}</div>
                </section>

                <section>
                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Worked example</h4>
                    <div class="border rounded-lg overflow-hidden">${workedHtml}</div>
                    ${benchmarkHtml}
                </section>

                ${d.constants && d.constants.length > 0 ? `
                <section>
                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Constants used</h4>
                    <div class="border rounded-lg overflow-hidden">
                        <table class="w-full text-sm">
                            <thead class="border-b border-slate-200 bg-slate-50"><tr>
                                <th class="text-left py-2 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wide">Constant</th>
                                <th class="text-left py-2 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wide">Value</th>
                                <th class="text-left py-2 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wide">Source</th>
                            </tr></thead>
                            <tbody>
                                ${d.constants.map(c => `<tr class="border-b border-slate-100">
                                    <td class="py-2 px-3 font-mono text-xs text-gsf-prussian">${App.escapeHtml(c.name)}</td>
                                    <td class="py-2 px-3 text-sm font-bold tabular-nums text-slate-700">${App.escapeHtml(c.value)}</td>
                                    <td class="py-2 px-3 text-xs text-slate-500 italic">${c.source}</td>
                                </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                </section>` : ''}

                ${d.caveats && d.caveats.length > 0 ? `
                <section>
                    <h4 class="text-xs font-bold text-amber-700 uppercase tracking-widest mb-2">⚠ Caveats &amp; uncertainty</h4>
                    <ul class="space-y-1.5 text-sm text-slate-700 list-disc list-inside">
                        ${d.caveats.map(c => `<li>${App.escapeHtml(c)}</li>`).join('')}
                    </ul>
                </section>` : ''}

                ${d.citations && d.citations.length > 0 ? `
                <section>
                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Citations</h4>
                    <ul class="space-y-1.5 text-xs text-slate-600 list-disc list-inside">
                        ${d.citations.map(c => `<li>${c}</li>`).join('')}
                    </ul>
                </section>` : ''}

                <section class="pt-2 border-t border-slate-100">
                    <button onclick="GenericViews._closeEconomicDetail(); App.view='org-methodology'; App.renderView(); setTimeout(()=>{const el=document.getElementById('${d.methodologyAnchor}'); if(el) el.scrollIntoView({behavior:'smooth', block:'start'});}, 200)" class="inline-flex items-center gap-1.5 text-sm text-gsf-boston hover:underline font-bold">
                        <i data-lucide="book-open" width="14"></i>
                        Open full methodology for this metric →
                    </button>
                </section>
            </div>
        `;
    },

    // ===== ACTIVITY DETAIL MODAL (click an event/update in any timeline) =====
    // Make sure the modal element exists no matter which view we're on.
    // Originally the modal was mounted inside the dashboard's innerHTML, so it
    // disappeared on the Activities view. Lazy-create on first show.
    _ensureActivityModal() {
        if (document.getElementById('activity-detail-modal')) return;
        const div = document.createElement('div');
        div.innerHTML = `<div id="activity-detail-modal" class="hidden fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onclick="if(event.target===this) GenericViews._closeActivityDetail()">
            <div class="bg-white rounded-2xl shadow-2xl max-w-xl w-full max-h-[85vh] flex flex-col overflow-hidden">
                <div id="activity-detail-body" class="overflow-y-auto flex-1"></div>
            </div>
        </div>`;
        document.body.appendChild(div.firstChild);
    },

    async _showActivityDetail(projectId, kind, id) {
        this._ensureActivityModal();
        const project = Projects.getProject(projectId);
        if (!project) return;
        let item, facilities;
        if (kind === 'event') {
            const [events, facs] = await Promise.all([Projects.getEvents(projectId), Projects.getFacilities(projectId)]);
            item = events.find(e => e.id === id);
            facilities = facs;
        } else {
            const updates = await Projects.getUpdates(projectId);
            item = updates.find(u => u.id === id);
            facilities = [];
        }
        if (!item) return;
        const modal = document.getElementById('activity-detail-modal');
        const body  = document.getElementById('activity-detail-body');
        if (!modal || !body) return;
        body.innerHTML = this._renderActivityDetailHtml(kind, item, project, facilities);
        modal.classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
    },

    _closeActivityDetail() {
        const modal = document.getElementById('activity-detail-modal');
        if (modal) modal.classList.add('hidden');
    },

    _renderActivityDetailHtml(kind, item, project, facilities) {
        const projectColor = project.color || '#4389C8';

        if (kind === 'event') {
            const t = Projects.canonicalEventType(item.type);
            const et = Projects.EVENT_TYPES[t] || Projects.EVENT_TYPES.other_update;
            const facList = (item.facilities || [])
                .map(fid => (facilities || []).find(f => f.id === fid))
                .filter(Boolean);
            const formatDate = (d) => {
                if (!d) return '—';
                try { return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }
                catch (_) { return d; }
            };
            // Show a range when the activity spans multiple days
            const dateDisplay = (item.endDate && item.endDate !== item.date)
                ? `${formatDate(item.date)} – ${formatDate(item.endDate)}`
                : formatDate(item.date);
            return `
                <div class="px-6 pt-5 pb-4 border-b" style="background: linear-gradient(135deg, ${et.color}1A, #ffffff 70%)">
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 flex-wrap mb-2">
                                <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider" style="background:${et.color}; color:#fff">
                                    <i data-lucide="${et.icon}" width="11"></i> ${et.label}
                                </span>
                                <span class="text-xs text-slate-500">${dateDisplay}</span>
                            </div>
                            <h2 class="text-xl font-black text-gsf-prussian leading-tight">${App.escapeHtml(item.title || 'Untitled activity')}</h2>
                        </div>
                        <button onclick="GenericViews._closeActivityDetail()" class="text-slate-400 hover:text-slate-700 shrink-0 p-1"><i data-lucide="x" width="18"></i></button>
                    </div>
                </div>
                <div class="p-6 space-y-5">
                    ${(item.hcw_count || item.hcw_new_count || item.patient_count) ? `
                        <div class="grid grid-cols-3 gap-3">
                            ${item.hcw_count ? `<div class="border rounded-lg p-3 bg-blue-50/50 border-blue-100">
                                <p class="text-[10px] font-bold text-blue-700 uppercase tracking-wide">HCWs</p>
                                <p class="text-xl font-black text-blue-700 tabular-nums">${this._fmt(item.hcw_count)}</p>
                                ${item.hcw_new_count ? `<p class="text-[10px] text-emerald-700 mt-0.5">↳ ${this._fmt(item.hcw_new_count)} new this year</p>` : ''}
                            </div>` : ''}
                            ${item.patient_count ? `<div class="border rounded-lg p-3 bg-rose-50/50 border-rose-100">
                                <p class="text-[10px] font-bold text-rose-700 uppercase tracking-wide">Patients</p>
                                <p class="text-xl font-black text-rose-700 tabular-nums">${this._fmt(item.patient_count)}</p>
                            </div>` : ''}
                            ${facList.length ? `<div class="border rounded-lg p-3 bg-amber-50/50 border-amber-100">
                                <p class="text-[10px] font-bold text-amber-700 uppercase tracking-wide">Facilities</p>
                                <p class="text-xl font-black text-amber-700 tabular-nums">${facList.length}${item.facility_other ? '+' : ''}</p>
                            </div>` : ''}
                        </div>
                    ` : ''}

                    ${facList.length > 0 ? `
                        <div>
                            <h4 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Facilities involved</h4>
                            <ul class="space-y-1">
                                ${facList.map(f => `<li class="flex items-center gap-2 text-sm text-slate-700"><i data-lucide="map-pin" width="13" class="text-slate-400 shrink-0"></i><span>${App.escapeHtml(f.name)}</span>${f.isHub ? '<span class="text-[9px] font-bold bg-gsf-boston/10 text-gsf-boston px-1.5 py-0.5 rounded uppercase">Hub</span>' : ''}</li>`).join('')}
                                ${item.facility_other ? '<li class="flex items-center gap-2 text-sm text-slate-500 italic"><i data-lucide="map-pin" width="13" class="text-slate-300 shrink-0"></i>Other (not in facilities list)</li>' : ''}
                            </ul>
                        </div>
                    ` : ''}

                    ${item.notes ? `
                        <div>
                            <h4 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Notes</h4>
                            <p class="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">${App.escapeHtml(item.notes)}</p>
                        </div>
                    ` : ''}

                    ${item.link ? `
                        <div>
                            <h4 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Link</h4>
                            <a href="#" onclick="electronAPI.openExternal('${App.escapeHtml(item.link)}'); return false;" class="text-sm text-gsf-boston hover:underline break-all inline-flex items-center gap-1.5">
                                <i data-lucide="external-link" width="13"></i> ${App.escapeHtml(item.link)}
                            </a>
                        </div>
                    ` : ''}

                    <div class="flex items-center justify-end gap-2 pt-4 border-t border-slate-100" data-edit-only>
                        <button onclick="GenericViews._deleteEventFromModal('${project.id}', '${item.id}')" class="px-3 py-1.5 text-xs font-bold text-red-500 hover:bg-red-50 rounded-lg">Delete</button>
                        <button onclick="GenericViews._editActivityFromModal('${project.id}', 'event', '${item.id}')" class="px-4 py-1.5 bg-gsf-boston hover:bg-gsf-prussian text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5"><i data-lucide="pencil" width="12"></i> Edit</button>
                    </div>
                </div>
            `;
        } else {
            // 'update' / milestone — tags removed (legacy field stripped on read)
            const formatDate = (d) => {
                if (!d) return '—';
                try { return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }
                catch (_) { return d; }
            };
            return `
                <div class="px-6 pt-5 pb-4 border-b" style="background: linear-gradient(135deg, ${projectColor}1A, #ffffff 70%)">
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 flex-wrap mb-2">
                                <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-600 text-white">
                                    <i data-lucide="flag" width="11"></i> Milestone
                                </span>
                                <span class="text-xs text-slate-500">${formatDate(item.date)}</span>
                            </div>
                            <h2 class="text-xl font-black text-gsf-prussian leading-tight">${App.escapeHtml(item.title || 'Untitled')}</h2>
                        </div>
                        <button onclick="GenericViews._closeActivityDetail()" class="text-slate-400 hover:text-slate-700 shrink-0 p-1"><i data-lucide="x" width="18"></i></button>
                    </div>
                </div>
                <div class="p-6 space-y-5">
                    ${item.body ? `
                        <div>
                            <h4 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Details</h4>
                            <p class="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">${App.escapeHtml(item.body)}</p>
                        </div>
                    ` : ''}

                    ${item.link ? `
                        <div>
                            <h4 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Link</h4>
                            <a href="#" onclick="electronAPI.openExternal('${App.escapeHtml(item.link)}'); return false;" class="text-sm text-gsf-boston hover:underline break-all inline-flex items-center gap-1.5">
                                <i data-lucide="external-link" width="13"></i> ${App.escapeHtml(item.link)}
                            </a>
                        </div>
                    ` : ''}

                    <div class="flex items-center justify-end gap-2 pt-4 border-t border-slate-100" data-edit-only>
                        <button onclick="GenericViews._deleteUpdateFromModal('${project.id}', '${item.id}')" class="px-3 py-1.5 text-xs font-bold text-red-500 hover:bg-red-50 rounded-lg">Delete</button>
                        <button onclick="GenericViews._editActivityFromModal('${project.id}', 'update', '${item.id}')" class="px-4 py-1.5 bg-gsf-boston hover:bg-gsf-prussian text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5"><i data-lucide="pencil" width="12"></i> Edit</button>
                    </div>
                </div>
            `;
        }
    },

    // Open the activity form pre-filled for editing. Works whether we're on the
    // project's view or on the org dashboard — switches project first if needed.
    async _editActivityFromModal(projectId, kind, id) {
        this._closeActivityDetail();
        if (kind === 'event') App.editingEventId = id;
        else                  App.editingUpdateId = id;
        // Switch to the right project first if we're not already there
        if (App.currentProject !== projectId) {
            await App.switchProject(projectId);
        }
        // Then navigate to the activities view
        App.view = 'project-activities';
        App.renderView();
    },

    // Jump directly to a project's Activities view (used by org-dashboard activity rows)
    async _jumpToProjectActivities(projectId) {
        if (App.currentProject !== projectId) await App.switchProject(projectId);
        App.view = 'project-activities';
        App.renderView();
    },

    async _deleteEventFromModal(projectId, eventId) {
        if (!confirm('Delete this activity? This cannot be undone.')) return;
        await Projects.deleteEvent(projectId, eventId);
        this._closeActivityDetail();
        App.renderView();
    },

    async _deleteUpdateFromModal(projectId, updateId) {
        if (!confirm('Delete this milestone? This cannot be undone.')) return;
        await Projects.deleteUpdate(projectId, updateId);
        this._closeActivityDetail();
        App.renderView();
    },

    // ===== FACILITY DETAIL MODAL (click a facility row) =====
    _ensureFacilityModal() {
        if (document.getElementById('facility-detail-modal')) return;
        const div = document.createElement('div');
        div.innerHTML = `<div id="facility-detail-modal" class="hidden fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onclick="if(event.target===this) GenericViews._closeFacilityDetail()">
            <div class="bg-white rounded-2xl shadow-2xl max-w-xl w-full max-h-[85vh] flex flex-col overflow-hidden">
                <div id="facility-detail-body" class="overflow-y-auto flex-1"></div>
            </div>
        </div>`;
        document.body.appendChild(div.firstChild);
    },

    async _showFacilityDetail(projectId, facilityId) {
        this._ensureFacilityModal();
        const project = Projects.getProject(projectId);
        if (!project) return;
        const [facilities, events] = await Promise.all([
            Projects.getFacilities(projectId),
            Projects.getEvents(projectId)
        ]);
        const facility = facilities.find(f => f.id === facilityId);
        if (!facility) return;
        // Count related events (where this facility is referenced)
        const relatedEvents = events.filter(e => (e.facilities || []).includes(facilityId)).slice(0, 10);
        const modal = document.getElementById('facility-detail-modal');
        const body  = document.getElementById('facility-detail-body');
        if (!modal || !body) return;
        body.innerHTML = this._renderFacilityDetailHtml(facility, project, relatedEvents);
        modal.classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
    },

    _closeFacilityDetail() {
        const modal = document.getElementById('facility-detail-modal');
        if (modal) modal.classList.add('hidden');
    },

    _renderFacilityDetailHtml(f, project, relatedEvents) {
        const themeColor = project.color || '#4389C8';
        const hasCoords = f.lat != null && f.lng != null;
        const eventsHtml = relatedEvents.length === 0
            ? '<p class="text-sm text-slate-400 italic">No activities recorded at this facility yet.</p>'
            : relatedEvents.map(e => {
                const t = Projects.canonicalEventType(e.type);
                const et = Projects.EVENT_TYPES[t] || Projects.EVENT_TYPES.other_update;
                return `<div onclick="GenericViews._closeFacilityDetail(); GenericViews._showActivityDetail('${project.id}','event','${e.id}')" class="flex items-start gap-3 py-2 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50 -mx-2 px-2 rounded transition-colors">
                    <span class="text-[10px] text-slate-400 w-16 shrink-0 pt-0.5">${e.date}</span>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase" style="background:${et.color}15; color:${et.color}">${et.label}</span>
                            <span class="text-sm font-medium text-slate-700 truncate">${App.escapeHtml(e.title || '')}</span>
                        </div>
                        ${e.hcw_count ? `<p class="text-[10px] text-slate-500">${this._fmt(e.hcw_count)} HCW${e.hcw_new_count ? ` (${this._fmt(e.hcw_new_count)} new)` : ''}</p>` : ''}
                    </div>
                </div>`;
            }).join('');

        return `
            <div class="px-6 pt-5 pb-4 border-b" style="background: linear-gradient(135deg, ${themeColor}1A, #ffffff 70%)">
                <div class="flex items-start justify-between gap-3">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap mb-2">
                            <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider" style="background:${themeColor}; color:#fff">
                                <i data-lucide="${f.isHub ? 'star' : 'map-pin'}" width="11"></i> ${f.isHub ? 'Hub Facility' : 'Spoke Facility'}
                            </span>
                            ${f.yearAdded ? `<span class="text-xs text-slate-500">Joined project in <strong class="text-slate-700">${f.yearAdded}</strong></span>` : ''}
                        </div>
                        <h2 class="text-xl font-black text-gsf-prussian leading-tight">${App.escapeHtml(f.name)}</h2>
                        ${f.notes ? `<p class="text-xs text-slate-600 mt-1 italic">${App.escapeHtml(f.notes)}</p>` : ''}
                    </div>
                    <button onclick="GenericViews._closeFacilityDetail()" class="text-slate-400 hover:text-slate-700 shrink-0 p-1"><i data-lucide="x" width="18"></i></button>
                </div>
            </div>
            <div class="p-6 space-y-5">
                ${(f.catchmentPop || f.annualPatients) ? `
                    <div class="grid grid-cols-2 gap-3">
                        ${f.catchmentPop ? `<div class="border rounded-lg p-3 bg-emerald-50/50 border-emerald-100">
                            <p class="text-[10px] font-bold text-emerald-700 uppercase tracking-wide">Catchment population</p>
                            <p class="text-xl font-black text-emerald-700 tabular-nums">${this._fmt(Number(f.catchmentPop))}</p>
                        </div>` : ''}
                        ${f.annualPatients ? `<div class="border rounded-lg p-3 bg-rose-50/50 border-rose-100">
                            <p class="text-[10px] font-bold text-rose-700 uppercase tracking-wide">Patients / year</p>
                            <p class="text-xl font-black text-rose-700 tabular-nums">${this._fmt(Number(f.annualPatients))}</p>
                        </div>` : ''}
                    </div>
                ` : ''}

                ${hasCoords ? `
                    <div>
                        <h4 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Location</h4>
                        <p class="text-sm text-slate-700 tabular-nums"><i data-lucide="map-pin" width="13" class="inline mr-1 text-emerald-500"></i> ${Number(f.lat).toFixed(4)}, ${Number(f.lng).toFixed(4)}</p>
                    </div>
                ` : '<p class="text-[11px] text-slate-400 italic">No coordinates set — facility won\'t appear on the project map.</p>'}

                <div>
                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Recent activities at this facility</h4>
                    <div class="border rounded-lg p-3">${eventsHtml}</div>
                </div>

                <div class="flex items-center justify-end gap-2 pt-4 border-t border-slate-100" data-edit-only>
                    <button onclick="GenericViews._deleteFacilityFromModal('${project.id}', '${f.id}')" class="px-3 py-1.5 text-xs font-bold text-red-500 hover:bg-red-50 rounded-lg">Remove</button>
                    <button onclick="GenericViews._closeFacilityDetail(); GenericViews._editFacility('${project.id}', '${f.id}')" class="px-4 py-1.5 bg-gsf-boston hover:bg-gsf-prussian text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5"><i data-lucide="pencil" width="12"></i> Edit</button>
                </div>
            </div>
        `;
    },

    async _deleteFacilityFromModal(projectId, facilityId) {
        if (!confirm('Remove this facility? Events that reference it will keep the reference but won\'t show its name.')) return;
        await Projects.deleteFacility(projectId, facilityId);
        this._closeFacilityDetail();
        App.renderView();
    },

    // ===== ECONOMIC IMPACT card on the project dashboard =====
    _renderEconomicImpact(project, allBudget, allActuals, qualityData, year) {
        const impact = Projects.computeEconomicImpact(project, allBudget, allActuals, qualityData, year);
        if (!impact) {
            return `
                <div class="bg-white rounded-xl border border-dashed border-emerald-200 p-5 mb-8 flex items-start gap-3">
                    <div class="bg-emerald-100 text-emerald-600 p-2 rounded-lg shrink-0"><i data-lucide="trending-up" width="16"></i></div>
                    <div class="flex-1">
                        <p class="text-sm font-bold text-slate-700">Economic Impact not configured</p>
                        <p class="text-xs text-slate-500">Set baselines + volumes in <button onclick="App.navigate('project-settings')" class="text-gsf-boston hover:underline font-medium">Project Settings → Impact Assumptions</button> to estimate deaths averted, DALYs, bed-days saved, and cost-per-DALY.</p>
                    </div>
                </div>
            `;
        }

        const currency = project.currency || 'USD';
        const isAllYear = year === 'all';
        const periodLabel = isAllYear ? 'all time' : year;
        const fmtMoney = (n) => {
            if (n === null || n === undefined || !isFinite(n)) return '—';
            const r = Math.round(n);
            if (r >= 1000000) return (r / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
            if (r >= 10000) return (r / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
            return this._fmt(r);
        };
        const fmtN = (n) => n === null || n === undefined || !isFinite(n) ? '—' : this._fmt(Math.round(n));
        const fmt1 = (n) => n === null || n === undefined || !isFinite(n) ? '—' : Number(n).toFixed(1);

        const headlineDeaths = Math.round(impact.totalDeathsAverted);
        const headlineDalys  = Math.round(impact.dalysAverted);
        const headlineValue  = impact.economicValue;

        // Breakdown rows by source
        const breakdownRows = [
            { label: 'Maternal deaths averted',  value: impact.maternalDeathsAverted, source: 'Δ MMR × live births',     color: '#D03734', icon: 'heart',           metricKey: 'maternal' },
            { label: 'Neonatal deaths averted',  value: impact.neonatalDeathsAverted, source: 'Δ NMR × live births',     color: '#E28743', icon: 'baby',            metricKey: 'neonatal' },
            { label: 'SSI deaths averted',       value: impact.ssiDeathsAverted,      source: 'Δ SSI × surgical vol × 5% case fatality', color: '#8B5CF6', icon: 'shield-alert', metricKey: 'ssi_deaths' },
            { label: 'SSC-attributable deaths averted', value: impact.sscDeathsAverted, source: 'Δ SSC × Haynes 47% effect',  color: '#059669', icon: 'clipboard-check', metricKey: 'ssc_deaths' },
        ].filter(r => r.value > 0.5);  // hide tiny rows that round to 0

        // Cost-per-DALY card with WHO threshold context
        // Unified card template — same visual weight for every metric.
        // Inline-style colours so Tailwind's CDN JIT doesn't drop dynamic classes.
        const themes = {
            rose:    { from: '#fff1f2', border: '#fecdd3', label: '#be123c', value: '#be123c', sub: '#f43f5e' },
            emerald: { from: '#ecfdf5', border: '#a7f3d0', label: '#047857', value: '#047857', sub: '#10b981' },
            amber:   { from: '#fffbeb', border: '#fde68a', label: '#b45309', value: '#b45309', sub: '#f59e0b' },
            slate:   { from: '#f8fafc', border: '#e2e8f0', label: '#475569', value: '#334155', sub: '#64748b' },
            blue:    { from: '#eff6ff', border: '#bfdbfe', label: '#1d4ed8', value: '#1e40af', sub: '#3b82f6' },
            violet:  { from: '#f5f3ff', border: '#ddd6fe', label: '#6d28d9', value: '#6d28d9', sub: '#8b5cf6' },
            orange:  { from: '#fff7ed', border: '#fed7aa', label: '#c2410c', value: '#c2410c', sub: '#ea580c' },
            cyan:    { from: '#ecfeff', border: '#a5f3fc', label: '#0e7490', value: '#0e7490', sub: '#06b6d4' },
        };
        const card = (label, value, sub, theme, metricKey) => {
            const c = themes[theme] || themes.slate;
            const click = metricKey ? `onclick="GenericViews._showEconomicDetail('${metricKey}')"` : '';
            const hint  = metricKey ? '<span class="absolute top-2 right-2 text-[9px] font-bold uppercase opacity-0 group-hover:opacity-70 transition-opacity" style="color:' + c.label + '">View formula →</span>' : '';
            return `<div class="rounded-lg p-4 border relative group ${metricKey ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}" style="background:linear-gradient(135deg,${c.from},#ffffff); border-color:${c.border}" ${click}>
                ${hint}
                <p class="text-[10px] font-bold uppercase tracking-wide mb-1" style="color:${c.label}">${label}</p>
                <p class="text-2xl font-black" style="color:${c.value}">${value}</p>
                <p class="text-[10px] mt-1" style="color:${c.sub}; opacity:0.85">${sub}</p>
            </div>`;
        };

        // Cost-per-DALY theme depends on WHO threshold
        const cpdTheme = impact.costPerDaly === null ? 'slate' : (impact.belowWhoThreshold ? 'emerald' : 'amber');
        const cpdValue = impact.costPerDaly !== null
            ? `<span class="text-sm font-normal opacity-70">${currency}</span> ${fmtMoney(impact.costPerDaly)}`
            : '<span class="text-slate-300">—</span>';
        const cpdSub = impact.costPerDaly !== null
            ? `${impact.belowWhoThreshold ? '✓ Below' : '⚠ Above'} WHO threshold (${currency} ${fmtMoney(impact.whoThreshold)} = 3× GDP/cap)`
            : 'Awaiting quality-indicator actuals';

        const roiValue = impact.roi !== null && impact.roi >= 0.1 ? impact.roi.toFixed(1) + '×' : '<span class="text-slate-300">—</span>';
        const budgetSub = impact.costPerDaly !== null ? `Buys ${fmtN(impact.dalysAverted)} DALYs averted` : 'Yearly budget for this period';

        return `
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-8">
                <div class="flex items-end justify-between gap-3 flex-wrap mb-5">
                    <div>
                        <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide flex items-center gap-2"><i data-lucide="heart-pulse" width="14" class="text-emerald-600"></i> Economic Impact</h2>
                        <p class="text-xs text-slate-400 mt-0.5">Estimated health and economic gains for <strong>${periodLabel}</strong>, derived from baselines vs. quality-indicator actuals × volumes. <button onclick="App.view='org-methodology'; App.renderView()" class="text-gsf-boston hover:underline">Methodology</button></p>
                    </div>
                </div>

                <!-- ── Tier 1: Impact Headlines ── -->
                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Impact headlines <span class="font-normal normal-case text-slate-300 italic">— click any card to see the formula &amp; verify the math</span></p>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                    ${card('Deaths averted', fmtN(headlineDeaths),
                           'Maternal + neonatal + surgical', 'rose', 'deaths_total')}
                    ${card('DALYs averted', fmtN(headlineDalys),
                           'Disability-adjusted life-years', 'emerald', 'dalys')}
                    ${card('Economic value',
                           `<span class="text-sm font-normal opacity-70">${currency}</span> ${fmtMoney(headlineValue)}`,
                           'DALYs × GDP per capita', 'amber', 'economic_value')}
                </div>

                <!-- ── Tier 2: Cost-Effectiveness ── -->
                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Cost-effectiveness</p>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                    ${card('Cost per DALY averted', cpdValue, cpdSub, cpdTheme, 'cost_per_daly')}
                    ${card('Estimated return', roiValue,
                           `Economic value per ${currency} 1 of budget`, 'blue', 'roi')}
                    ${card('Allocated budget',
                           `<span class="text-sm font-normal opacity-70">${currency}</span> ${fmtMoney(impact.totalAllocated)}`,
                           budgetSub, 'slate', 'budget')}
                </div>

                <!-- ── Tier 3: Tangible Operational Outcomes ── -->
                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Tangible outcomes</p>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                    ${card('SSIs averted', fmtN(impact.ssisAverted),
                           `${fmtN(impact.bedDaysSaved)} bed-days saved`, 'violet', 'ssis_averted')}
                    ${card('Care cost avoided',
                           `<span class="text-sm font-normal opacity-70">${currency}</span> ${fmtMoney(impact.ssiCostSaved)}`,
                           'Hospital treatment costs saved from SSI reduction', 'orange', 'care_cost_avoided')}
                    ${card('HCW lifetime reach', fmtN(impact.hcwLifetimeEncounters),
                           `Patient encounters from ${fmtN(impact.hcwTrained)} strengthened HCWs (25-yr career)`, 'cyan', 'hcw_lifetime')}
                </div>

                <!-- Compact breakdown table -->
                ${breakdownRows.length > 0 ? `
                    <details class="mb-3">
                        <summary class="text-[10px] font-bold text-slate-400 uppercase tracking-widest cursor-pointer hover:text-slate-600 select-none mb-2">Deaths averted — breakdown by source ▾</summary>
                        <div class="border rounded-lg overflow-hidden">
                            <table class="w-full text-xs">
                                <tbody>
                                    ${breakdownRows.map(r => `<tr class="border-b last:border-0 hover:bg-slate-50 cursor-pointer" onclick="GenericViews._showEconomicDetail('${r.metricKey}')">
                                        <td class="px-3 py-2 flex items-center gap-2" style="border-left:3px solid ${r.color}">
                                            <i data-lucide="${r.icon}" width="12" style="color:${r.color}"></i>
                                            <span class="font-medium text-slate-700">${r.label}</span>
                                        </td>
                                        <td class="px-3 py-2 text-right font-bold tabular-nums" style="color:${r.color}">${fmt1(r.value)}</td>
                                        <td class="px-3 py-2 text-right text-[10px] text-slate-400 italic">${r.source} →</td>
                                    </tr>`).join('')}
                                </tbody>
                            </table>
                        </div>
                    </details>
                ` : ''}

                <p class="text-[11px] text-slate-400 italic">⚠ Conservative point estimates using published coefficients (DCP3, Lancet Commission on Global Surgery, Haynes 2009 SSC trial, WHO Global Burden of Disease). Real impact depends on counterfactual, attribution, and context. See <button onclick="App.view='org-methodology'; App.renderView()" class="text-gsf-boston hover:underline">Methodology</button> for the full chain.</p>
            </div>
        `;
    },

    // ===== BUDGET MATRIX (per-year allocated + spent) =====
    _renderBudgetMatrix(project, allBudget, years) {
        const projectIdJs = String(project.id).replace(/'/g, "\\'");
        const visibleYears = years.slice();
        const currency = project.currency || 'USD';
        const cell = (y, kind) => {
            const row = allBudget.find(b => b.year === y);
            if (!row) return '';
            const v = row[kind];
            return (v === undefined || v === null) ? '' : v;
        };
        const rowTotal = (kind) => visibleYears.reduce((s, y) => s + (Number(cell(y, kind)) || 0), 0);

        const inputCell = (y, kind) => {
            const range = this._cellRange(project, y, null);
            if (range !== 'active') return this._outOfRangeCell(range);
            const id = `bud-cell-${kind}-${y}`;
            const badgeId = `bud-badge-${kind}-${y}`;
            const v = cell(y, kind);
            return `<td class="px-1.5 py-1.5 border-b border-slate-100">
                <div class="kpi-cell-wrap">
                    <input type="number" id="${id}" value="${v}" placeholder="—" min="0" step="any"
                        data-orig="${v}"
                        oninput="GenericViews._onKpiInputChange(this)"
                        onblur="GenericViews._saveBudgetCell('${projectIdJs}', ${y}, '${kind}', this, '${badgeId}')"
                        onkeydown="if(event.key==='Enter'){event.preventDefault(); this.blur();}"
                        class="kpi-cell-input w-full px-2 py-1.5 border border-slate-200 rounded text-sm text-right outline-none focus:ring-2 focus:ring-gsf-boston/30 bg-white tabular-nums" />
                    <span id="${badgeId}" class="kpi-cell-badge"></span>
                </div>
            </td>`;
        };

        const headerCells = visibleYears.map(y => `<th class="px-2 py-2 text-xs font-bold text-slate-600 text-center bg-slate-50 border-b border-slate-200" style="min-width:110px">${y}</th>`).join('');
        const tAlloc = rowTotal('allocated');

        const rangeBanner = (project.startDate || project.endDate)
            ? `<div class="mb-3 px-3 py-2 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-500 flex items-center gap-2">
                   <i data-lucide="calendar-clock" width="13" class="text-slate-400"></i>
                   <span>Project active period drives the editable range. Cost-per-result is computed on the dashboard.</span>
               </div>`
            : '';

        return `
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
                <div class="mb-4 flex items-end justify-between gap-3 flex-wrap">
                    <div>
                        <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide flex items-center gap-2"><i data-lucide="banknote" width="14" class="text-emerald-600"></i> Budget</h2>
                        <p class="text-xs text-slate-400 mt-0.5">Annual budget allocated to the project. Auto-saves on blur. Used to derive cost-per-result on the dashboard.</p>
                    </div>
                    <label class="inline-flex items-center gap-2 text-xs text-slate-600">
                        <span class="font-semibold text-slate-400 uppercase tracking-wide">Currency</span>
                        <select onchange="GenericViews._saveProjectCurrency('${projectIdJs}', this.value)" class="bg-white border rounded px-2 py-1 text-slate-700 outline-none text-xs">
                            ${['USD','EUR','GBP','CHF','KES','NGN','ZAR','GHS','RWF','SLL'].map(c => `<option value="${c}" ${currency===c?'selected':''}>${c}</option>`).join('')}
                        </select>
                    </label>
                </div>
                ${rangeBanner}
                <div class="overflow-x-auto -mx-2 px-2">
                    <table class="w-full border-collapse text-sm" style="min-width:600px">
                        <thead>
                            <tr>
                                <th class="kpi-matrix-sticky-col px-3 py-2 text-left text-[10px] font-bold text-slate-400 uppercase border-b border-slate-200" style="min-width:200px">Line</th>
                                ${headerCells}
                                <th class="px-3 py-2 text-right text-[10px] font-bold text-slate-400 uppercase bg-slate-50 border-b border-slate-200">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style="border-top:2px solid #10B98125">
                                <td class="kpi-matrix-sticky-col px-3 py-2 align-top" style="border-left:3px solid #10B981; min-width:200px">
                                    <div class="flex items-center gap-2">
                                        <i data-lucide="wallet" width="14" class="text-emerald-600"></i>
                                        <div>
                                            <div class="text-xs font-black uppercase tracking-wide text-emerald-700">Allocated</div>
                                            <div class="text-[10px] text-slate-400">Annual budget</div>
                                        </div>
                                    </div>
                                </td>
                                ${visibleYears.map(y => inputCell(y, 'allocated')).join('')}
                                <td class="px-3 py-1.5 text-right text-xs font-bold text-emerald-700 bg-emerald-50/40 border-b border-slate-100">${tAlloc ? this._fmt(Math.round(tAlloc)) : '—'}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    async _saveBudgetCell(projectId, year, kind, input, badgeId) {
        if (!input) return;
        const v = input.value;
        const orig = input.dataset.orig;
        if (String(v) === String(orig)) return;
        const badge = badgeId ? document.getElementById(badgeId) : null;
        input.classList.remove('dirty', 'saved', 'error');
        input.classList.add('saving');
        if (badge) { badge.textContent = '…'; badge.className = 'kpi-cell-badge saving show'; }
        try {
            const ok = await Projects.saveOneBudgetField(projectId, year, kind, v);
            if (!ok) throw new Error('Invalid value');
            input.dataset.orig = v;
            input.classList.remove('saving');
            input.classList.add('saved');
            if (badge) { badge.textContent = '✓'; badge.className = 'kpi-cell-badge saved show'; }
            setTimeout(() => { input.classList.remove('saved'); if (badge) badge.classList.remove('show'); }, 1400);
            clearTimeout(this._budgetRerenderTimer);
            this._budgetRerenderTimer = setTimeout(() => { App.renderView(); }, 1500);
        } catch (e) {
            input.classList.remove('saving');
            input.classList.add('error');
            if (badge) { badge.textContent = '✗'; badge.className = 'kpi-cell-badge error show'; }
            setTimeout(() => { input.classList.remove('error'); if (badge) badge.classList.remove('show'); }, 2500);
            console.error('Budget cell save failed:', e);
        }
    },

    async _saveProjectCurrency(projectId, currency) {
        await Projects.updateProject(projectId, { currency });
        App.renderView();
    },

    // Returns 'active' | 'before' | 'after' for a given year (and optional quarter)
    // relative to the project's startDate / endDate. If no dates set, always 'active'.
    _cellRange(project, year, quarter) {
        if (!project) return 'active';
        if (project.startDate) {
            const d = new Date(project.startDate);
            const sy = d.getFullYear();
            const sq = Math.ceil((d.getMonth() + 1) / 3);
            if (year < sy) return 'before';
            if (year === sy && quarter && quarter < sq) return 'before';
        }
        if (project.endDate) {
            const d = new Date(project.endDate);
            const ey = d.getFullYear();
            const eq = Math.ceil((d.getMonth() + 1) / 3);
            if (year > ey) return 'after';
            if (year === ey && quarter && quarter > eq) return 'after';
        }
        return 'active';
    },

    _outOfRangeCell(rangeState) {
        // Disabled greyed-out cell shown in place of an input when out of project range
        const label = rangeState === 'before' ? 'Before project start' : 'After project end';
        return `<td class="px-1.5 py-1.5 border-b border-slate-100">
            <div class="w-full px-2 py-1.5 border border-dashed border-slate-200 rounded text-xs text-slate-300 text-center italic bg-slate-50/40 cursor-not-allowed select-none" title="${label}">—</div>
        </td>`;
    },

    // ===== KPI MATRIX (all years at a glance, auto-save per cell) =====
    // Target: one cell per year (annual figure).
    // Actual: four CUMULATIVE Q-columns per year. Q4 = year total. If only
    // Q2 has data, year total = Q2. Backward compat: if an old entry has
    // kpis[kpiId] but no quarters, we surface it as Q4 (full-year value).
    _renderKpiMatrix(project, allTargets, allActuals, years) {
        const projectIdJs = String(project.id).replace(/'/g, "\\'");
        const visibleYears = years.slice();

        // Target value for a year (single annual cell)
        const targetVal = (kpi, y) => {
            const yr = allTargets.find(t => t.year === y);
            const v = yr && yr.kpis[kpi.id];
            return (v === undefined || v === null) ? '' : v;
        };
        // Actual cumulative value for a year × quarter
        const actualQVal = (kpi, y, q) => {
            const yr = allActuals.find(t => t.year === y);
            if (!yr) return '';
            // New format: quarters map
            if (yr.quarters && yr.quarters[q] && yr.quarters[q][kpi.id] !== undefined && yr.quarters[q][kpi.id] !== null) {
                return yr.quarters[q][kpi.id];
            }
            // Legacy: year total surfaced as Q4 (only if no quarter data exists at all for this KPI in this year)
            const hasAnyQ = [1,2,3,4].some(qq => yr.quarters && yr.quarters[qq] && yr.quarters[qq][kpi.id] !== undefined && yr.quarters[qq][kpi.id] !== null);
            if (!hasAnyQ && q === 4 && yr.kpis[kpi.id] !== undefined && yr.kpis[kpi.id] !== null) {
                return yr.kpis[kpi.id];
            }
            return '';
        };

        // Year totals = last cumulative Q (= effectively kpis[kpiId] after save)
        const yearTotalActual = (kpi, y) => {
            const yr = allActuals.find(t => t.year === y);
            return (yr && yr.kpis[kpi.id] != null) ? yr.kpis[kpi.id] : 0;
        };
        const rowTotalTarget = (kpi) => visibleYears.reduce((s, y) => s + (Number(targetVal(kpi, y)) || 0), 0);
        const rowTotalActual = (kpi) => visibleYears.reduce((s, y) => s + (Number(yearTotalActual(kpi, y)) || 0), 0);

        const targetCell = (kpi, y) => {
            const range = this._cellRange(project, y, null);
            if (range !== 'active') {
                const label = range === 'before' ? 'Before project start' : 'After project end';
                return `<td colspan="4" class="px-1.5 py-1.5 border-b border-slate-100 border-l border-slate-200">
                    <div class="w-full px-2 py-1.5 border border-dashed border-slate-200 rounded text-xs text-slate-300 text-center italic bg-slate-50/40 cursor-not-allowed select-none" title="${label}">—</div>
                </td>`;
            }
            const id = `kpi-cell-target-${kpi.id}-${y}`;
            const badgeId = `kpi-badge-target-${kpi.id}-${y}`;
            const v = targetVal(kpi, y);
            return `<td colspan="4" class="px-1.5 py-1.5 border-b border-slate-100 border-l border-slate-200">
                <div class="kpi-cell-wrap">
                    <input type="number" id="${id}" value="${v}" placeholder="—" min="0"
                        data-orig="${v}"
                        oninput="GenericViews._onKpiInputChange(this)"
                        onblur="GenericViews._saveKpiCell('${projectIdJs}', ${y}, '${kpi.id}', 'target', this, '${badgeId}')"
                        onkeydown="if(event.key==='Enter'){event.preventDefault(); this.blur();}"
                        class="kpi-cell-input w-full px-2 py-1.5 border border-slate-200 rounded text-sm text-right outline-none focus:ring-2 focus:ring-gsf-boston/30 bg-white tabular-nums" />
                    <span id="${badgeId}" class="kpi-cell-badge"></span>
                </div>
            </td>`;
        };

        const qComments = this._kpiQuarterCommentsCache || [];
        const actualQCell = (kpi, y, q) => {
            const range = this._cellRange(project, y, q);
            if (range !== 'active') return this._outOfRangeCell(range);
            const id = `kpi-cell-actual-${kpi.id}-${y}-q${q}`;
            const badgeId = `kpi-badge-actual-${kpi.id}-${y}-q${q}`;
            const v = actualQVal(kpi, y, q);
            const isQ4 = q === 4;
            const note = Projects.kpiQuarterComment(qComments, kpi.id, y, q);
            const hasNote = !!note;
            // Comment affordance: a tiny dot/note button, filled emerald when a note exists.
            const noteBtn = `<button type="button"
                onclick="event.stopPropagation(); GenericViews._editKpiQuarterComment('${projectIdJs}', '${kpi.id}', ${y}, ${q}, event)"
                title="${hasNote ? App.escapeHtml(note) : 'Add a note for this quarter'}"
                class="kpi-note-btn ${hasNote ? 'has-note' : ''}"><i data-lucide="message-square" width="9"></i></button>`;
            return `<td class="px-1 py-1.5 border-b border-slate-100 ${q === 1 ? 'border-l border-slate-200' : ''}">
                <div class="kpi-cell-wrap relative">
                    <input type="number" id="${id}" value="${v}" placeholder="—" min="0"
                        data-orig="${v}"
                        oninput="GenericViews._onKpiInputChange(this)"
                        onblur="GenericViews._saveKpiQuarterCell('${projectIdJs}', ${y}, ${q}, '${kpi.id}', this, '${badgeId}')"
                        onkeydown="if(event.key==='Enter'){event.preventDefault(); this.blur();}"
                        class="kpi-cell-input w-full px-1.5 py-1 pr-5 border border-slate-200 rounded text-xs text-right outline-none focus:ring-2 focus:ring-gsf-boston/30 ${isQ4 ? 'bg-emerald-50/40 font-semibold' : 'bg-white'} tabular-nums" style="min-width:62px"
                        title="${isQ4 ? 'Q4 cumulative = year total' : `By end of Q${q}, cumulative since start of year`}" />
                    ${noteBtn}
                    <span id="${badgeId}" class="kpi-cell-badge"></span>
                </div>
            </td>`;
        };

        // Header: year groups, each spanning 4 quarter columns
        const yearHeader = visibleYears.map(y =>
            `<th colspan="4" class="px-2 py-1.5 text-xs font-bold text-slate-600 text-center bg-slate-50 border-b border-slate-200 border-l border-slate-200">${y}</th>`
        ).join('');
        const quarterHeader = visibleYears.map(_ =>
            ['Q1','Q2','Q3','Q4'].map((q, i) => `<th class="px-1 py-1 text-[10px] font-bold text-slate-400 text-center bg-slate-50/50 border-b border-slate-200 ${i === 0 ? 'border-l border-slate-200' : ''}" style="min-width:70px">${q}${i === 3 ? '<div class="text-[8px] font-normal text-emerald-600 normal-case">= total</div>' : ''}</th>`).join('')
        ).join('');

        const rows = Projects.STANDARD_KPIS.map(kpi => {
            const tTotal = rowTotalTarget(kpi);
            const aTotal = rowTotalActual(kpi);
            const targetCells  = visibleYears.map(y => targetCell(kpi, y)).join('');
            const actualCells  = visibleYears.flatMap(y => [1,2,3,4].map(q => actualQCell(kpi, y, q))).join('');
            return `
                <tr class="border-t-2 border-slate-100" style="border-top-color:${kpi.color}25; border-top-width:2px">
                    <td rowspan="2" class="kpi-matrix-sticky-col px-3 py-2 border-r border-slate-200 align-top" style="border-left:3px solid ${kpi.color}; min-width:200px">
                        <div class="flex items-center gap-2">
                            <i data-lucide="${kpi.icon}" width="14" style="color:${kpi.color}"></i>
                            <div>
                                <div class="text-xs font-black uppercase tracking-wide" style="color:${kpi.color}">${kpi.nameBig || kpi.name}</div>
                                ${kpi.nameSub ? `<div class="text-[10px] text-slate-400 leading-tight">${kpi.nameSub}</div>` : ''}
                            </div>
                        </div>
                    </td>
                    <td class="px-3 py-1.5 text-[10px] font-bold uppercase text-amber-700 bg-amber-50/30 border-b border-slate-100" style="min-width:60px">Target</td>
                    ${targetCells}
                    <td class="px-3 py-1.5 text-right text-xs font-bold text-amber-700 bg-amber-50/40 border-b border-slate-100">${tTotal ? this._fmt(tTotal) : '—'}</td>
                </tr>
                <tr>
                    <td class="px-3 py-1.5 text-[10px] font-bold uppercase text-emerald-700 bg-emerald-50/30" style="min-width:60px">Actual</td>
                    ${actualCells}
                    <td class="px-3 py-1.5 text-right text-xs font-bold text-emerald-700 bg-emerald-50/40">${aTotal ? this._fmt(aTotal) : '—'}</td>
                </tr>
            `;
        }).join('');

        const headerCells = yearHeader; // alias kept for the legacy header line below
        const yearMax = App.kpiYearMax != null ? Math.max(App.kpiYearMax, new Date().getFullYear() + 1) : new Date().getFullYear() + 1;

        // Range banner — shows the user which years are editable
        const rangeBanner = (project.startDate || project.endDate)
            ? `<div class="mb-3 px-3 py-2 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-500 flex items-center gap-2">
                   <i data-lucide="calendar-clock" width="13" class="text-slate-400"></i>
                   <span>Project active period:
                       <strong class="text-slate-700">${project.startDate ? new Date(project.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '— open start'}</strong>
                       to
                       <strong class="text-slate-700">${project.endDate ? new Date(project.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '— open end'}</strong>.
                       Years outside this range are greyed out and locked.
                   </span>
               </div>`
            : `<div class="mb-3 px-3 py-2 bg-blue-50/60 border border-blue-100 rounded text-[11px] text-blue-700 flex items-center gap-2">
                   <i data-lucide="info" width="13"></i>
                   <span>No project start/end date set — all years are editable. Set dates in <strong>Project Settings</strong> to grey out cells outside the active period.</span>
               </div>`;

        return `
            ${rangeBanner}
            <div class="mb-3 px-3 py-2 bg-emerald-50/40 border border-emerald-100 rounded text-[11px] text-emerald-800 flex items-center gap-2">
                <i data-lucide="info" width="13" class="text-emerald-600"></i>
                <span><strong>Actuals are cumulative.</strong> Enter the running total at end of each quarter — Q1 (Jan–Mar), Q2 (Jan–Jun), Q3 (Jan–Sep), Q4 (full year). Q4 is the year total.</span>
            </div>
            <div class="overflow-x-auto -mx-2 px-2">
                <table class="w-full border-collapse text-sm" style="min-width:700px">
                    <thead>
                        <tr>
                            <th rowspan="2" class="kpi-matrix-sticky-col px-3 py-2 text-left text-[10px] font-bold text-slate-400 uppercase border-b border-slate-200 align-bottom" style="min-width:200px">Indicator</th>
                            <th rowspan="2" class="px-3 py-2 text-left text-[10px] font-bold text-slate-400 uppercase bg-slate-50 border-b border-slate-200 align-bottom">Field</th>
                            ${yearHeader}
                            <th rowspan="2" class="px-3 py-2 text-right text-[10px] font-bold text-slate-400 uppercase bg-slate-50 border-b border-slate-200 align-bottom">Total</th>
                        </tr>
                        <tr>${quarterHeader}</tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <div class="mt-4 flex items-center justify-between gap-3 flex-wrap">
                <p class="text-[11px] text-slate-400 italic">
                    <i data-lucide="info" width="11" class="inline -mt-0.5"></i>
                    Press <kbd class="px-1 py-0.5 bg-slate-100 border rounded text-[10px]">Tab</kbd> or click out of a cell to save. <kbd class="px-1 py-0.5 bg-slate-100 border rounded text-[10px]">Enter</kbd> also commits.
                    Target is per year; Actuals are cumulative quarter-by-quarter.
                </p>
                <div class="flex items-center gap-2">
                    <button onclick="GenericViews._removeLastYear()" class="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:bg-red-50 hover:text-red-500 border border-slate-200" title="Remove the topmost year column (only allowed if it has no data)">
                        <i data-lucide="minus" width="12" class="inline"></i> Remove year
                    </button>
                    <button onclick="App.kpiYearMax=${yearMax + 1}; App.renderView()" class="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100 border border-slate-200" title="Add an extra year column">
                        <i data-lucide="plus" width="12" class="inline"></i> Add year column
                    </button>
                </div>
            </div>
        `;
    },

    // Mark a matrix cell as "dirty" (unsaved edit in progress)
    _onKpiInputChange(input) {
        if (!input) return;
        const v = input.value;
        const orig = input.dataset.orig;
        if (String(v) !== String(orig)) {
            input.classList.remove('saved', 'error', 'saving');
            input.classList.add('dirty');
        } else {
            input.classList.remove('dirty', 'saved', 'error', 'saving');
        }
    },

    // Save a single KPI cell when its input blurs. Shows green ✓ on success.
    async _saveKpiCell(projectId, year, kpiId, kind, input, badgeId) {
        if (!input) return;
        const v = input.value;
        const orig = input.dataset.orig;
        if (String(v) === String(orig)) return; // no change

        const badge = badgeId ? document.getElementById(badgeId) : null;
        input.classList.remove('dirty', 'saved', 'error');
        input.classList.add('saving');
        if (badge) { badge.textContent = '…'; badge.className = 'kpi-cell-badge saving show'; }

        try {
            const ok = await Projects.saveOneKpi(projectId, year, kpiId, kind, v);
            if (!ok) throw new Error('Invalid value (negative numbers not allowed).');
            input.dataset.orig = v;
            input.classList.remove('saving');
            input.classList.add('saved');
            if (badge) { badge.textContent = '✓'; badge.className = 'kpi-cell-badge saved show'; }
            setTimeout(() => {
                input.classList.remove('saved');
                if (badge) badge.classList.remove('show');
            }, 1400);
            // Don't full re-render — just update the row total in place
            this._refreshKpiRowTotals(projectId, kpiId, kind);
        } catch (e) {
            input.classList.remove('saving');
            input.classList.add('error');
            if (badge) { badge.textContent = '✗'; badge.className = 'kpi-cell-badge error show'; }
            setTimeout(() => {
                input.classList.remove('error');
                if (badge) badge.classList.remove('show');
            }, 2500);
            console.error('KPI cell save failed:', e);
        }
    },

    // After saving a cell, recompute the row total cell without a full re-render.
    async _refreshKpiRowTotals(projectId, kpiId, kind) {
        try {
            const all = kind === 'target' ? await Projects.getTargets(projectId) : await Projects.getActuals(projectId);
            let total = 0;
            all.forEach(yr => { total += (Number(yr.kpis[kpiId]) || 0); });
            // The row total cell isn't easily addressable by ID — best to re-render the entire view
            // when totals change, but only every few saves to avoid flicker. For now, leave totals
            // until the next view re-render (e.g. when user navigates or changes year).
            // To keep it responsive: trigger a debounced full render after 1.5s of no edits.
            clearTimeout(this._kpiRerenderTimer);
            this._kpiRerenderTimer = setTimeout(() => {
                // Only re-render if user is still on the same view
                if (App.view === 'setup' || App.view === 'kpis' || App.view === 'projects') {
                    App.renderView();
                }
            }, 1500);
        } catch (_) { /* totals can update on next render */ }
    },

    // Save a single cumulative-quarter cell from the core-KPI matrix.
    async _saveKpiQuarterCell(projectId, year, quarter, kpiId, input, badgeId) {
        if (!input) return;
        const badge = badgeId ? document.getElementById(badgeId) : null;
        const v = input.value;
        input.classList.remove('dirty', 'saved', 'error');
        input.classList.add('saving');
        if (badge) { badge.textContent = '…'; badge.className = 'kpi-cell-badge saving show'; }
        try {
            const ok = await Projects.saveOneKpiQuarter(projectId, year, quarter, kpiId, v);
            if (!ok) throw new Error('save failed');
            input.dataset.orig = v;
            input.classList.remove('saving');
            input.classList.add('saved');
            if (badge) { badge.textContent = '✓'; badge.className = 'kpi-cell-badge saved show'; }
            setTimeout(() => { input.classList.remove('saved'); if (badge) badge.classList.remove('show'); }, 1400);
            // Debounced full re-render so row totals + dashboards refresh
            clearTimeout(this._kpiRerenderTimer);
            this._kpiRerenderTimer = setTimeout(() => {
                if (App.view === 'setup' || App.view === 'kpis' || App.view === 'projects') App.renderView();
            }, 1500);
        } catch (e) {
            input.classList.remove('saving');
            input.classList.add('error');
            if (badge) { badge.textContent = '✗'; badge.className = 'kpi-cell-badge error show'; }
            setTimeout(() => { input.classList.remove('error'); if (badge) badge.classList.remove('show'); }, 2500);
            console.error('KPI quarter cell save failed:', e);
        }
    },

    // Edit the per-quarter comment for a core-KPI actual cell via an in-app popover
    // (textarea + Save/Clear), anchored to the clicked note button. Persists with
    // saveKpiQuarterComment and refreshes the note indicator without a full re-render.
    async _editKpiQuarterComment(projectId, kpiId, year, quarter, ev) {
        const anchor = (ev && ev.currentTarget) ? ev.currentTarget
            : (typeof event !== 'undefined' && event.currentTarget) ? event.currentTarget : null;
        // Close any existing popover first
        this._closeKpiNotePopover();

        const arr = await Projects.getKpiQuarterComments(projectId);
        const current = Projects.kpiQuarterComment(arr, kpiId, year, quarter);
        const kpi = Projects.STANDARD_KPIS.find(k => k.id === kpiId);
        const label = (kpi && (kpi.nameBig || kpi.name)) || kpiId;

        const pop = document.createElement('div');
        pop.id = 'kpi-note-popover';
        pop.className = 'fixed z-50 bg-white rounded-lg shadow-2xl border border-slate-200 p-3';
        pop.style.width = '280px';
        pop.onclick = (e) => e.stopPropagation();
        pop.innerHTML = `
            <div class="flex items-center justify-between mb-2">
                <div class="text-[11px] font-bold text-gsf-prussian">${App.escapeHtml(label)} · ${year} Q${quarter}</div>
                <button id="kpi-note-close" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" width="14"></i></button>
            </div>
            <textarea id="kpi-note-text" rows="3" placeholder="Explain this quarter's figure…"
                class="w-full px-2.5 py-2 border border-slate-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-gsf-boston/30 resize-none">${App.escapeHtml(current)}</textarea>
            <div class="flex items-center justify-between mt-2">
                <button id="kpi-note-clear" class="text-[11px] text-slate-400 hover:text-red-500 font-medium">Clear</button>
                <div class="flex gap-1.5">
                    <button id="kpi-note-cancel" class="px-2.5 py-1 rounded text-[11px] font-semibold text-slate-500 hover:bg-slate-100">Cancel</button>
                    <button id="kpi-note-save" class="px-3 py-1 rounded text-[11px] font-bold bg-gsf-boston text-white hover:bg-gsf-prussian">Save</button>
                </div>
            </div>`;
        document.body.appendChild(pop);

        // Position near the anchor
        if (anchor) {
            const r = anchor.getBoundingClientRect();
            const pr = pop.getBoundingClientRect();
            let left = r.right - pr.width;
            let top = r.bottom + 6;
            if (left < 8) left = 8;
            if (top + pr.height > window.innerHeight - 8) top = r.top - pr.height - 6;
            pop.style.left = Math.max(8, left) + 'px';
            pop.style.top = Math.max(8, top) + 'px';
        } else {
            pop.style.left = '50%'; pop.style.top = '120px'; pop.style.transform = 'translateX(-50%)';
        }
        if (window.lucide) lucide.createIcons();
        const ta = document.getElementById('kpi-note-text');
        if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }

        const save = async (val) => {
            await Projects.saveKpiQuarterComment(projectId, kpiId, year, quarter, val);
            this._kpiQuarterCommentsCache = await Projects.getKpiQuarterComments(projectId);
            this._closeKpiNotePopover();
            App.showMsg((val || '').trim() ? 'Note saved ✓' : 'Note cleared');
            App.renderView();
        };
        document.getElementById('kpi-note-save').onclick   = () => save(document.getElementById('kpi-note-text').value);
        document.getElementById('kpi-note-clear').onclick  = () => save('');
        document.getElementById('kpi-note-cancel').onclick = () => this._closeKpiNotePopover();
        document.getElementById('kpi-note-close').onclick  = () => this._closeKpiNotePopover();
        // Cmd/Ctrl+Enter saves
        ta.onkeydown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(ta.value); } if (e.key === 'Escape') this._closeKpiNotePopover(); };
        // Dismiss on outside click
        setTimeout(() => {
            this._kpiNoteDismiss = (e) => { if (!pop.contains(e.target)) this._closeKpiNotePopover(); };
            document.addEventListener('click', this._kpiNoteDismiss);
        }, 0);
    },

    _closeKpiNotePopover() {
        const el = document.getElementById('kpi-note-popover');
        if (el) el.remove();
        if (this._kpiNoteDismiss) { document.removeEventListener('click', this._kpiNoteDismiss); this._kpiNoteDismiss = null; }
    },

    // ===== QUALITY MATRIX (KPIs × year-quarters, auto-save) =====
    _renderQualityMatrix(project, activeQKpis, qualityData, years) {
        if (!activeQKpis || activeQKpis.length === 0) {
            return `<p class="text-sm text-slate-400 italic">No quality indicators enabled for this project.</p>`;
        }
        const projectIdJs = String(project.id).replace(/'/g, "\\'");
        const visibleYears = years.slice();

        const cellVal = (kpi, y, q, kind) => {
            const entry = qualityData.find(d => d.kpiId === kpi.id && d.year === y && d.quarter === q);
            if (!entry) return '';
            if (kind === 'target') return entry.target !== undefined && entry.target !== null ? entry.target : '';
            const actual = Projects.qualityActual(entry);
            return actual !== undefined && actual !== null ? actual : '';
        };

        const inputCell = (kpi, y, q, kind) => {
            const range = this._cellRange(project, y, q);
            if (range !== 'active') return this._outOfRangeCell(range);
            const id = `qual-cell-${kind}-${kpi.id}-${y}-q${q}`;
            const badgeId = `qual-badge-${kind}-${kpi.id}-${y}-q${q}`;
            const v = cellVal(kpi, y, q, kind);
            return `<td class="px-1 py-1.5 border-b border-slate-100">
                <div class="kpi-cell-wrap">
                    <input type="number" step="any" id="${id}" value="${v}" placeholder="—"
                        data-orig="${v}"
                        oninput="GenericViews._onKpiInputChange(this)"
                        onblur="GenericViews._saveQualityCell('${projectIdJs}', ${y}, ${q}, '${kpi.id}', '${kind}', this, '${badgeId}')"
                        onkeydown="if(event.key==='Enter'){event.preventDefault(); this.blur();}"
                        class="kpi-cell-input w-full px-1.5 py-1 border border-slate-200 rounded text-xs text-right outline-none focus:ring-2 focus:ring-gsf-boston/30 bg-white tabular-nums" style="min-width:62px" />
                    <span id="${badgeId}" class="kpi-cell-badge"></span>
                </div>
            </td>`;
        };

        // Header: year groups, each with Q1-Q4 sub-headers
        const yearHeader = visibleYears.map(y =>
            `<th colspan="4" class="px-2 py-1.5 text-xs font-bold text-slate-600 text-center bg-slate-50 border-b border-slate-200 border-l border-slate-200">${y}</th>`
        ).join('');
        const quarterHeader = visibleYears.map(_ =>
            ['Q1','Q2','Q3','Q4'].map((q, i) => `<th class="px-1 py-1 text-[10px] font-bold text-slate-400 text-center bg-slate-50/50 border-b border-slate-200 ${i === 0 ? 'border-l border-slate-200' : ''}" style="min-width:70px">${q}</th>`).join('')
        ).join('');

        const baselines = project.qualityBaselines || {};
        const targets   = project.qualityTargets   || {};
        const rows = activeQKpis.map(kpi => {
            const actualCells = visibleYears.flatMap(y => [1,2,3,4].map(q => inputCell(kpi, y, q, 'actual'))).join('');
            const bVal = baselines[kpi.id];
            const tVal = targets[kpi.id];
            const hasBaseRead = bVal !== undefined && bVal !== null && !isNaN(bVal);
            const hasTgtRead  = tVal !== undefined && tVal !== null && !isNaN(tVal);
            // Baseline + Target are now set in Project Settings → Impact Assumptions.
            // The label cell shows them as read-only chips with a quick-jump link.
            const baselineChip = `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-[10px] tabular-nums ${hasBaseRead ? 'text-slate-700' : 'text-slate-300 italic'}">${hasBaseRead ? bVal : 'not set'}</span>`;
            const targetChip   = `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 border border-amber-100 text-[10px] tabular-nums ${hasTgtRead ? 'text-amber-800' : 'text-amber-300 italic'}">${hasTgtRead ? tVal : 'not set'}</span>`;
            const labelCell = `<td class="kpi-matrix-sticky-col px-3 py-1.5 border-r border-slate-200 align-middle" style="border-left:3px solid ${kpi.color}; min-width:200px" title="${App.escapeHtml(kpi.name)}${kpi.lowerIsBetter ? ' — lower is better' : ''}">
                <div class="flex items-center gap-2">
                    <i data-lucide="${kpi.icon}" width="14" style="color:${kpi.color}" class="shrink-0"></i>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-baseline gap-1.5">
                            <span class="text-xs font-black uppercase tracking-wide" style="color:${kpi.color}">${kpi.shortName || kpi.name}</span>
                            <span class="text-[9px] text-slate-400">${kpi.unit || ''}</span>
                        </div>
                        <div class="flex items-center gap-1.5 mt-0.5 text-[10px]">
                            <span class="text-slate-400">Base:</span>${baselineChip}
                            <span class="text-amber-700">Tgt:</span>${targetChip}
                        </div>
                    </div>
                </div>
            </td>`;
            return `
                <tr style="border-top:2px solid ${kpi.color}25">
                    ${labelCell}
                    <td class="px-3 py-1.5 text-[10px] font-bold uppercase text-emerald-700 bg-emerald-50/30 border-b border-slate-100" style="min-width:60px">Actual</td>
                    ${actualCells}
                </tr>
            `;
        }).join('');

        const rangeBanner = (project.startDate || project.endDate)
            ? `<div class="mb-3 px-3 py-2 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-500 flex items-center gap-2">
                   <i data-lucide="calendar-clock" width="13" class="text-slate-400"></i>
                   <span>Project active period:
                       <strong class="text-slate-700">${project.startDate ? new Date(project.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '— open start'}</strong>
                       to
                       <strong class="text-slate-700">${project.endDate ? new Date(project.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '— open end'}</strong>.
                       Quarters outside this range are greyed out and locked.
                   </span>
               </div>`
            : '';

        return `
            ${rangeBanner}
            <div class="overflow-x-auto -mx-2 px-2">
                <table class="w-full border-collapse text-sm" style="min-width:900px">
                    <thead>
                        <tr>
                            <th rowspan="2" class="kpi-matrix-sticky-col px-3 py-2 text-left text-[10px] font-bold text-slate-400 uppercase border-b border-slate-200" style="min-width:180px">Indicator</th>
                            <th rowspan="2" class="px-3 py-2 text-left text-[10px] font-bold text-slate-400 uppercase bg-slate-50 border-b border-slate-200">Field</th>
                            ${yearHeader}
                        </tr>
                        <tr>${quarterHeader}</tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <p class="text-[11px] text-slate-400 italic mt-3">
                <i data-lucide="info" width="11" class="inline -mt-0.5"></i>
                Enter quarterly actuals only. Baseline &amp; target are set in <button onclick="App.navigate('project-settings')" class="text-gsf-boston hover:underline font-medium">Project Settings → Impact Assumptions</button>. Press <kbd class="px-1 py-0.5 bg-slate-100 border rounded text-[10px]">Tab</kbd> or <kbd class="px-1 py-0.5 bg-slate-100 border rounded text-[10px]">Enter</kbd> to save.
            </p>
        `;
    },

    async _saveQualityBaselineInline(projectId, kpiId, input) {
        if (!input) return;
        const v = input.value.trim();
        const orig = input.dataset.orig || '';
        if (String(v) === String(orig)) return;
        input.classList.remove('dirty', 'saved', 'error');
        input.classList.add('saving');
        try {
            const ok = await Projects.saveQualityBaseline(projectId, kpiId, v === '' ? null : v);
            if (!ok) throw new Error('Invalid baseline');
            input.dataset.orig = v;
            input.classList.remove('saving');
            input.classList.add('saved');
            setTimeout(() => input.classList.remove('saved'), 1400);
        } catch (e) {
            input.classList.remove('saving');
            input.classList.add('error');
            setTimeout(() => input.classList.remove('error'), 2500);
        }
    },

    // Live wiring for the Settings → Impact Assumptions baseline input.
    // When the user types a baseline, update both target inputs' data-baseline attribute
    // and enable/disable the % field accordingly. Also re-compute the partner from the
    // currently-entered absolute target so % shows the right value immediately.
    _onSettingsBaselineInput(input, kpiId) {
        const raw = input.value.trim();
        const baseline = parseFloat(raw);
        const hasBase = raw !== '' && !isNaN(baseline) && baseline >= 0;
        // Find both target sibling inputs anywhere in the form (abs + pct)
        const abs = document.querySelector(`input[data-kpi="${kpiId}"][data-target-kind="abs"]`);
        const pct = document.querySelector(`input[data-kpi="${kpiId}"][data-target-kind="pct"]`);
        [abs, pct].forEach(el => {
            if (!el) return;
            el.dataset.baseline = hasBase ? String(baseline) : '';
        });
        if (pct) {
            pct.disabled = !hasBase;
            // Toggle the visual locked/unlocked styling
            if (hasBase) {
                pct.classList.remove('bg-slate-100', 'text-slate-300', 'cursor-not-allowed');
                pct.classList.add('bg-amber-50/30');
                pct.placeholder = '%';
                pct.title = `% ${pct.dataset.lower === '1' ? 'reduction' : 'increase'} vs baseline (positive = improvement)`;
            } else {
                pct.classList.add('bg-slate-100', 'text-slate-300', 'cursor-not-allowed');
                pct.classList.remove('bg-amber-50/30');
                pct.placeholder = '—';
                pct.value = '';
                pct.title = 'Set a baseline first to enter % change';
            }
        }
        // Recompute partner so the % reflects the existing absolute target (if any)
        if (hasBase && abs && abs.value.trim() !== '') {
            this._onQualityTargetInput(abs);
        }
    },

    // Recompute the partner field (abs ↔ %) whenever the user types in either input.
    // Both fields write the same `data-baseline` and `data-lower` attributes;
    // the partner is found via the same kpiId on the row.
    _onQualityTargetInput(input) {
        const kpiId = input.dataset.kpi;
        const kind  = input.dataset.targetKind;
        const baseline = parseFloat(input.dataset.baseline);
        const lower = input.dataset.lower === '1';
        const v = input.value.trim();
        // Find sibling
        const wrap = input.parentElement;
        const partner = wrap.querySelector(`input[data-kpi="${kpiId}"][data-target-kind="${kind === 'abs' ? 'pct' : 'abs'}"]`);
        if (!partner) return;
        if (v === '' || isNaN(parseFloat(v)) || isNaN(baseline) || baseline === 0) {
            partner.value = '';
            input.classList.add('dirty');
            return;
        }
        const num = parseFloat(v);
        if (kind === 'abs') {
            // value → % improvement
            const rawDelta = (baseline - num) / baseline * 100;
            const pct = lower ? rawDelta : -rawDelta;
            partner.value = Math.round(pct);
        } else {
            // % improvement → absolute value
            const pct = num;
            const signedDelta = lower ? pct : -pct;
            const abs = baseline - (signedDelta / 100) * baseline;
            partner.value = Math.round(abs * 100) / 100;
        }
        input.classList.add('dirty');
        partner.classList.add('dirty');
    },

    async _saveQualityTargetInline(projectId, kpiId, input) {
        if (!input) return;
        // Always derive and save the ABSOLUTE value (so the % field is just a UX helper).
        let absStr;
        if (input.dataset.targetKind === 'pct') {
            // Read the sibling abs input (already populated by _onQualityTargetInput)
            const wrap = input.parentElement;
            const absInput = wrap.querySelector(`input[data-kpi="${kpiId}"][data-target-kind="abs"]`);
            absStr = (absInput && absInput.value.trim()) || '';
            // Reset orig markers
            input.dataset.orig = input.value.trim();
            if (absInput) absInput.dataset.orig = absStr;
        } else {
            absStr = input.value.trim();
            input.dataset.orig = absStr;
            // Update the sibling % field's orig so it doesn't trigger a duplicate save on its own blur
            const wrap = input.parentElement;
            const pctInput = wrap.querySelector(`input[data-kpi="${kpiId}"][data-target-kind="pct"]`);
            if (pctInput) pctInput.dataset.orig = pctInput.value.trim();
        }
        input.classList.remove('dirty', 'saved', 'error');
        input.classList.add('saving');
        try {
            const ok = await Projects.saveQualityTarget(projectId, kpiId, absStr === '' ? null : absStr);
            if (!ok) throw new Error('Invalid target');
            input.classList.remove('saving');
            input.classList.add('saved');
            // Clear dirty/badge on sibling too
            const wrap = input.parentElement;
            const sib = wrap.querySelector(`input[data-kpi="${kpiId}"][data-target-kind="${input.dataset.targetKind === 'abs' ? 'pct' : 'abs'}"]`);
            if (sib) { sib.classList.remove('dirty', 'error'); sib.classList.add('saved'); }
            setTimeout(() => { input.classList.remove('saved'); if (sib) sib.classList.remove('saved'); }, 1400);
        } catch (e) {
            input.classList.remove('saving');
            input.classList.add('error');
            setTimeout(() => input.classList.remove('error'), 2500);
        }
    },

    async _applyQualityTargetToAll(projectId, kpiId) {
        // Suggest the most-recent non-empty target as the default
        const qualityData = await Projects.getQualityData(projectId);
        const existing = qualityData
            .filter(d => d.kpiId === kpiId && d.target !== null && d.target !== undefined)
            .sort((a, b) => (b.year * 10 + b.quarter) - (a.year * 10 + a.quarter))[0];
        const suggested = existing ? String(existing.target) : '';
        const raw = prompt(
            `Set the same target value for every year and quarter of "${kpiId}":\n\n` +
            `Leave blank to clear all targets. This overwrites any existing values.`,
            suggested
        );
        if (raw === null) return; // cancel
        const v = raw.trim();
        if (v !== '' && (isNaN(parseFloat(v)) || parseFloat(v) < 0)) {
            alert('Please enter a non-negative number or leave blank.');
            return;
        }
        await Projects.applyQualityTargetToAllYears(projectId, kpiId, v === '' ? null : v);
        App.renderView();
    },

    async _saveQualityCell(projectId, year, quarter, kpiId, kind, input, badgeId) {
        if (!input) return;
        const v = input.value;
        const orig = input.dataset.orig;
        if (String(v) === String(orig)) return;

        const badge = badgeId ? document.getElementById(badgeId) : null;
        input.classList.remove('dirty', 'saved', 'error');
        input.classList.add('saving');
        if (badge) { badge.textContent = '…'; badge.className = 'kpi-cell-badge saving show'; }

        try {
            const ok = await Projects.saveOneQualityField(projectId, kpiId, year, quarter, kind, v);
            if (!ok) throw new Error('Invalid value.');
            input.dataset.orig = v;
            input.classList.remove('saving');
            input.classList.add('saved');
            if (badge) { badge.textContent = '✓'; badge.className = 'kpi-cell-badge saved show'; }
            setTimeout(() => {
                input.classList.remove('saved');
                if (badge) badge.classList.remove('show');
            }, 1400);
        } catch (e) {
            input.classList.remove('saving');
            input.classList.add('error');
            if (badge) { badge.textContent = '✗'; badge.className = 'kpi-cell-badge error show'; }
            setTimeout(() => {
                input.classList.remove('error');
                if (badge) badge.classList.remove('show');
            }, 2500);
            console.error('Quality cell save failed:', e);
        }
    },

    async _saveSetupKpis(projectId, year) {
        const kpiTargets = {}, kpiActuals = {}, targetComments = {}, actualComments = {};
        Projects.STANDARD_KPIS.forEach(kpi => {
            const tEl = document.getElementById(`target-${kpi.id}`);
            const aEl = document.getElementById(`actual-${kpi.id}`);
            const tcEl = document.getElementById(`target-comment-${kpi.id}`);
            const acEl = document.getElementById(`actual-comment-${kpi.id}`);
            if (tEl && tEl.value !== '') kpiTargets[kpi.id] = parseFloat(tEl.value);
            if (aEl && aEl.value !== '') kpiActuals[kpi.id] = parseFloat(aEl.value);
            if (tcEl && tcEl.value.trim()) targetComments[kpi.id] = tcEl.value.trim();
            if (acEl && acEl.value.trim()) actualComments[kpi.id] = acEl.value.trim();
        });
        const note = (document.getElementById('kpi-log-note') || {}).value?.trim() || '';
        await Promise.all([
            Projects.saveTargets(projectId, year, kpiTargets),
            Projects.saveActuals(projectId, year, kpiActuals),
            Projects.saveKpiComments(projectId, year, targetComments, actualComments),
            Projects.addKpiLogEntry(projectId, {
                id:        'log-' + Date.now().toString(36),
                timestamp: new Date().toISOString(),
                year,
                note,
                targets:        { ...kpiTargets },
                actuals:        { ...kpiActuals },
                targetComments: { ...targetComments },
                actualComments: { ...actualComments }
            })
        ]);
        App.renderView();
    },

    async _saveFacility(projectId) {
        const name = (document.getElementById('fac-name') || {}).value?.trim();
        if (!name) { App.showMsg('Facility name is required.', true); document.getElementById('fac-name')?.focus(); return; }
        const catchmentPop   = parseFloat((document.getElementById('fac-catchment') || {}).value) || 0;
        const annualPatients = parseFloat((document.getElementById('fac-patients')  || {}).value) || 0;
        const notes          = (document.getElementById('fac-notes') || {}).value?.trim() || '';
        const isHub          = !!(document.getElementById('fac-hub') || {}).checked;
        const yearAddedRaw   = (document.getElementById('fac-year-added') || {}).value?.trim();
        const yearAdded      = yearAddedRaw ? parseInt(yearAddedRaw, 10) : null;
        if (yearAdded !== null && (isNaN(yearAdded) || yearAdded < 2000 || yearAdded > 2100)) { App.showMsg('Year added must be between 2000 and 2100.', true); document.getElementById('fac-year-added')?.focus(); return; }
        const latVal         = (document.getElementById('fac-lat')   || {}).value?.trim();
        const lngVal         = (document.getElementById('fac-lng')   || {}).value?.trim();
        const lat            = latVal !== '' ? parseFloat(latVal) : null;
        const lng            = lngVal !== '' ? parseFloat(lngVal) : null;
        if (lat !== null && (isNaN(lat) || lat < -90 || lat > 90)) { App.showMsg('Latitude must be between -90 and 90.', true); document.getElementById('fac-lat')?.focus(); return; }
        if (lng !== null && (isNaN(lng) || lng < -180 || lng > 180)) { App.showMsg('Longitude must be between -180 and 180.', true); document.getElementById('fac-lng')?.focus(); return; }
        const editId         = (document.getElementById('fac-edit-id') || {}).value || '';
        const record = { name, isHub };
        if (editId)              record.id            = editId;
        if (catchmentPop)        record.catchmentPop  = catchmentPop;
        if (annualPatients)      record.annualPatients = annualPatients;
        if (yearAdded)           record.yearAdded     = yearAdded;
        if (notes)               record.notes          = notes;
        if (lat !== null && !isNaN(lat)) record.lat   = lat;
        if (lng !== null && !isNaN(lng)) record.lng   = lng;
        await Projects.saveFacility(projectId, record);
        App.renderView();
    },

    _editFacility(projectId, facilityId) {
        Projects.getFacilities(projectId).then(facilities => {
            const f = facilities.find(x => x.id === facilityId);
            if (!f) return;
            document.getElementById('fac-form-title').textContent = 'Edit Facility';
            document.getElementById('fac-save-btn').textContent   = 'Save Changes';
            document.getElementById('fac-edit-id').value    = f.id;
            document.getElementById('fac-name').value       = f.name || '';
            document.getElementById('fac-hub').checked      = !!f.isHub;
            document.getElementById('fac-catchment').value  = f.catchmentPop    || '';
            document.getElementById('fac-patients').value   = f.annualPatients  || '';
            const yearEl = document.getElementById('fac-year-added'); if (yearEl) yearEl.value = f.yearAdded || '';
            document.getElementById('fac-notes').value      = f.notes           || '';
            document.getElementById('fac-lat').value        = f.lat !== undefined && f.lat !== null ? f.lat : '';
            document.getElementById('fac-lng').value        = f.lng !== undefined && f.lng !== null ? f.lng : '';
            if (f.lat && f.lng) {
                const s = document.getElementById('fac-location-search');
                if (s && !s.value) s.value = f.name || '';
            }
            document.getElementById('fac-geo-results')?.classList.add('hidden');
            document.getElementById('fac-cancel-btn').classList.remove('hidden');
            document.getElementById('fac-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    },

    _cancelFacilityEdit() {
        document.getElementById('fac-form-title').textContent = 'Add Facility';
        document.getElementById('fac-save-btn').textContent   = 'Add Facility';
        document.getElementById('fac-edit-id').value   = '';
        document.getElementById('fac-name').value      = '';
        document.getElementById('fac-hub').checked     = false;
        document.getElementById('fac-catchment').value = '';
        document.getElementById('fac-patients').value  = '';
        const yEl = document.getElementById('fac-year-added'); if (yEl) yEl.value = '';
        document.getElementById('fac-notes').value     = '';
        document.getElementById('fac-lat').value              = '';
        document.getElementById('fac-lng').value              = '';
        document.getElementById('fac-location-search').value  = '';
        document.getElementById('fac-geo-results')?.classList.add('hidden');
        document.getElementById('fac-cancel-btn').classList.add('hidden');
    },

    async _deleteFacility(projectId, facilityId) {
        const facilities = await Projects.getFacilities(projectId);
        const idx = facilities.findIndex(f => f.id === facilityId);
        if (idx === -1) return;
        const removed = facilities.splice(idx, 1)[0];
        await Storage.setItem(`surgdash_facilities_${projectId}`, facilities);
        App.renderView();
        App.showUndo('Facility removed', async () => {
            const current = await Projects.getFacilities(projectId);
            current.splice(idx, 0, removed);
            await Storage.setItem(`surgdash_facilities_${projectId}`, current);
            App.renderView();
        });
    },

    // ── KML / GeoJSON Import ──

    async _importGeoFile(projectId) {
        try {
            const filePath = await electronAPI.invoke('pick-geo-file');
            if (!filePath) return;

            const raw = electronAPI.fs.readFileSync(filePath, 'utf8');
            const ext = electronAPI.path.extname(filePath).toLowerCase();
            let features = [];

            if (ext === '.geojson' || ext === '.json') {
                const geo = JSON.parse(raw);
                const list = geo.type === 'FeatureCollection' ? geo.features
                    : geo.type === 'Feature' ? [geo]
                    : geo.type === 'Point' ? [{ type: 'Feature', geometry: geo, properties: {} }]
                    : [];
                list.forEach(f => {
                    if (!f.geometry) return;
                    const coords = f.geometry.type === 'Point' ? [f.geometry.coordinates]
                        : f.geometry.type === 'MultiPoint' ? f.geometry.coordinates
                        : null;
                    if (!coords) return;
                    coords.forEach(c => {
                        features.push({
                            name: (f.properties && (f.properties.name || f.properties.Name || f.properties.NAME)) || 'Unnamed',
                            lng: c[0], lat: c[1]
                        });
                    });
                });
            } else if (ext === '.kml') {
                const parser = new DOMParser();
                const doc = parser.parseFromString(raw, 'text/xml');
                const placemarks = doc.querySelectorAll('Placemark');
                placemarks.forEach(pm => {
                    const nameEl = pm.querySelector('name');
                    const coordEl = pm.querySelector('coordinates');
                    if (!coordEl) return;
                    const parts = coordEl.textContent.trim().split(',');
                    if (parts.length < 2) return;
                    features.push({
                        name: nameEl ? nameEl.textContent.trim() : 'Unnamed',
                        lng: parseFloat(parts[0]),
                        lat: parseFloat(parts[1])
                    });
                });
            } else {
                App.showMsg('Unsupported file type. Use .kml, .geojson, or .json', true);
                return;
            }

            features = features.filter(f => !isNaN(f.lat) && !isNaN(f.lng) && f.lat >= -90 && f.lat <= 90 && f.lng >= -180 && f.lng <= 180);

            if (features.length === 0) {
                App.showMsg('No valid locations found in file.', true);
                return;
            }

            // Preview dialog
            const previewRows = features.map((f, i) =>
                `<tr class="border-b border-slate-100">
                    <td class="px-3 py-1.5 text-xs text-slate-400">${i + 1}</td>
                    <td class="px-3 py-1.5 text-sm font-medium">${App.escapeHtml(f.name)}</td>
                    <td class="px-3 py-1.5 text-xs text-slate-500">${f.lat.toFixed(4)}, ${f.lng.toFixed(4)}</td>
                </tr>`
            ).join('');

            const modal = document.createElement('div');
            modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;';
            modal.innerHTML = `
                <div style="background:#fff;border-radius:16px;padding:24px;max-width:520px;width:90%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.2)">
                    <h3 style="font-size:16px;font-weight:700;color:#002F4C;margin:0 0 4px">Import ${features.length} Facilities</h3>
                    <p style="font-size:12px;color:#64748b;margin:0 0 12px">These will be added as Spoke facilities. You can change type after import.</p>
                    <div style="overflow-y:auto;flex:1;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:16px">
                        <table style="width:100%;border-collapse:collapse">
                            <thead><tr style="background:#f8fafc"><th style="padding:6px 12px;text-align:left;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase">#</th><th style="padding:6px 12px;text-align:left;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase">Name</th><th style="padding:6px 12px;text-align:left;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase">Coordinates</th></tr></thead>
                            <tbody>${previewRows}</tbody>
                        </table>
                    </div>
                    <div style="display:flex;gap:8px;justify-content:flex-end">
                        <button id="geo-cancel" style="padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;border:1px solid #e2e8f0;background:#fff;color:#64748b;cursor:pointer">Cancel</button>
                        <button id="geo-confirm" style="padding:8px 16px;border-radius:8px;font-size:13px;font-weight:700;border:none;background:#4389C8;color:#fff;cursor:pointer">Import All</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);

            return new Promise(resolve => {
                modal.querySelector('#geo-cancel').onclick = () => { modal.remove(); resolve(); };
                modal.querySelector('#geo-confirm').onclick = async () => {
                    modal.remove();
                    for (const f of features) {
                        await Projects.saveFacility(projectId, { name: f.name, lat: f.lat, lng: f.lng, isHub: false });
                    }
                    App.showMsg(`Imported ${features.length} facilities.`);
                    App.renderView();
                    resolve();
                };
            });
        } catch (err) {
            console.error('Geo import error:', err);
            App.showMsg('Import failed: ' + err.message, true);
        }
    },

    // ── Geocoding helpers (Nominatim / OpenStreetMap — free, no API key) ──

    async _geocodeSearch(prefix) {
        // prefix = 'fac' (facility form) or 'setting' (project settings)
        const searchInput = document.getElementById(`${prefix}-location-search`);
        const resultsDiv  = document.getElementById(`${prefix}-geo-results`);
        if (!searchInput || !resultsDiv) return;

        const query = searchInput.value.trim();
        if (!query) return;

        searchInput.disabled = true;
        resultsDiv.classList.remove('hidden');
        resultsDiv.innerHTML = '<div class="px-4 py-3 text-sm text-slate-400 italic">Searching…</div>';

        try {
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&addressdetails=1`;
            const res = await fetch(url, { headers: { 'Accept-Language': 'en', 'User-Agent': 'SURGdash/1.0' } });
            const results = await res.json();

            if (!results.length) {
                resultsDiv.innerHTML = '<div class="px-4 py-3 text-sm text-slate-400 italic">No results found. Try a broader search.</div>';
            } else {
                resultsDiv.innerHTML = results.map((r, i) => {
                    const lat  = parseFloat(r.lat);
                    const lng  = parseFloat(r.lon);
                    const name = r.display_name.split(',').slice(0, 3).join(', ');
                    return `<button type="button"
                        data-geo-lat="${lat}" data-geo-lng="${lng}" data-geo-name="${App.escapeHtml(name)}" data-geo-prefix="${prefix}"
                        class="w-full text-left px-4 py-2.5 text-sm hover:bg-gsf-boston/5 border-b border-slate-100 last:border-0 transition-colors geo-result-btn">
                        <span class="font-medium text-slate-800">${App.escapeHtml(name)}</span>
                        <span class="text-xs text-slate-400 ml-2">${lat.toFixed(4)}, ${lng.toFixed(4)}</span>
                    </button>`;
                }).join('');
                // Wire up via event delegation (avoids quote-escaping in onclick)
                resultsDiv.querySelectorAll('.geo-result-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        GenericViews._geocodeSelect(
                            btn.dataset.geoPrefix,
                            parseFloat(btn.dataset.geoLat),
                            parseFloat(btn.dataset.geoLng),
                            btn.dataset.geoName
                        );
                    });
                });
            }
        } catch (err) {
            resultsDiv.innerHTML = '<div class="px-4 py-3 text-sm text-red-400">Search failed — check your internet connection.</div>';
        } finally {
            searchInput.disabled = false;
        }
    },

    _geocodeSelect(prefix, lat, lng, displayName) {
        const latInput    = document.getElementById(`${prefix}-lat`);
        const lngInput    = document.getElementById(`${prefix}-lng`);
        const searchInput = document.getElementById(`${prefix}-location-search`);
        const resultsDiv  = document.getElementById(`${prefix}-geo-results`);

        if (latInput)    latInput.value    = lat;
        if (lngInput)    lngInput.value    = lng;
        if (searchInput) searchInput.value = displayName.split(',').slice(0, 3).join(', ');
        if (resultsDiv)  resultsDiv.classList.add('hidden');
    },

    // ===== CALENDAR =====
    async renderCalendar(main, project) {
        const now   = new Date();
        const year  = (App.calYear  != null) ? App.calYear  : now.getFullYear();
        const month = (App.calMonth != null) ? App.calMonth : now.getMonth(); // 0-indexed

        const [events, updates] = await Promise.all([
            Projects.getEvents(project.id),
            Projects.getUpdates(project.id)
        ]);

        this._renderCalendarGrid(main, project.name, project.color, year, month, events, updates, [project]);
    },

    _renderCalendarGrid(main, title, color, year, month, events, updates, projects) {
        // Populate the entries store (avoid passing large objects through onclick attributes)
        this._entries = {};
        events.forEach(e => {
            const et = Projects.EVENT_TYPES[e.type] || {};
            this._entries[e.id] = { kind: 'event', obj: e, color: et.color || color || '#64748b' };
        });
        updates.forEach(u => {
            this._entries[u.id] = { kind: 'update', obj: u, color: '#64748b' };
        });

        // Build day map
        const dayMap = {};
        events.forEach(e => {
            if (!dayMap[e.date]) dayMap[e.date] = [];
            const et = Projects.EVENT_TYPES[e.type] || {};
            dayMap[e.date].push({ kind: 'event', label: e.title || e.type, color: et.color || '#64748b', id: e.id });
        });
        updates.forEach(u => {
            if (!dayMap[u.date]) dayMap[u.date] = [];
            dayMap[u.date].push({ kind: 'update', label: u.title, color: '#64748b', id: u.id });
        });

        const firstDay  = new Date(year, month, 1).getDay(); // 0=Sun
        const daysInMon = new Date(year, month + 1, 0).getDate();
        const startOffset = (firstDay + 6) % 7; // shift to Mon=0
        const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const DAYS   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        const todayStr = new Date().toISOString().split('T')[0];

        let cells = '';
        const totalCells = Math.ceil((startOffset + daysInMon) / 7) * 7;
        for (let i = 0; i < totalCells; i++) {
            const dayNum = i - startOffset + 1;
            if (dayNum < 1 || dayNum > daysInMon) {
                cells += `<div class="min-h-[100px] bg-slate-50/50 rounded-lg p-1.5"></div>`;
                continue;
            }
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            const isToday = dateStr === todayStr;
            const entries = dayMap[dateStr] || [];
            const pills   = entries.slice(0, 3).map(en => `
                <div class="text-[10px] font-semibold rounded px-1.5 py-0.5 truncate cursor-pointer hover:opacity-80" style="background:${en.color}20; color:${en.color}; border:1px solid ${en.color}40"
                     onclick="GenericViews._showEntryById('${en.id}')" title="${App.escapeHtml(en.label)}">
                    ${App.escapeHtml(en.label)}
                </div>`).join('');
            const more = entries.length > 3 ? `<div class="text-[9px] text-slate-400 font-bold">+${entries.length - 3} more</div>` : '';

            cells += `
                <div class="min-h-[100px] bg-white border border-slate-100 rounded-lg p-1.5 ${isToday ? 'ring-2 ring-gsf-boston' : ''}">
                    <span class="text-xs font-bold ${isToday ? 'bg-gsf-boston text-white rounded-full w-5 h-5 flex items-center justify-center' : 'text-slate-600'} mb-1">${dayNum}</span>
                    <div class="space-y-0.5 mt-1">${pills}${more}</div>
                </div>`;
        }

        const isOrg = (main._isOrg);

        main.innerHTML = `
            <div class="p-6 md:p-10 fade-in w-full max-w-6xl mx-auto">
                <header class="mb-6 flex items-center justify-between flex-wrap gap-3">
                    <h1 class="text-2xl font-bold text-gsf-prussian">${App.escapeHtml(title)} — Calendar</h1>
                    <div class="flex items-center gap-3">
                        <button onclick="${isOrg ? 'GenericViews._calNavOrg' : 'GenericViews._calNav'}(-1)" class="w-8 h-8 rounded-lg border hover:bg-slate-50 flex items-center justify-center">
                            <i data-lucide="chevron-left" width="16"></i>
                        </button>
                        <span class="font-bold text-gsf-prussian min-w-[140px] text-center">${MONTHS[month]} ${year}</span>
                        <button onclick="${isOrg ? 'GenericViews._calNavOrg' : 'GenericViews._calNav'}(1)" class="w-8 h-8 rounded-lg border hover:bg-slate-50 flex items-center justify-center">
                            <i data-lucide="chevron-right" width="16"></i>
                        </button>
                    </div>
                </header>

                <!-- Legend -->
                <div class="flex flex-wrap gap-3 mb-4 text-xs">
                    ${Object.entries(Projects.EVENT_TYPES).map(([k, v]) => `
                        <span class="flex items-center gap-1.5 font-medium" style="color:${v.color}">
                            <span class="w-2.5 h-2.5 rounded-full" style="background:${v.color}"></span>${v.label}
                        </span>`).join('')}
                    <span class="flex items-center gap-1.5 font-medium text-slate-500">
                        <span class="w-2.5 h-2.5 rounded-full bg-slate-400"></span>Narrative Update
                    </span>
                </div>

                <div class="grid grid-cols-7 gap-1 mb-1">
                    ${DAYS.map(d => `<div class="text-center text-[11px] font-bold text-slate-400 uppercase py-1">${d}</div>`).join('')}
                </div>
                <div class="grid grid-cols-7 gap-1">${cells}</div>
            </div>

            <!-- Detail modal -->
            <div id="cal-detail-modal" class="hidden fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onclick="if(event.target===this)this.classList.add('hidden')">
                <div class="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
                    <div id="cal-detail-content"></div>
                    <button onclick="document.getElementById('cal-detail-modal').classList.add('hidden')" class="mt-4 w-full py-2 border rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50">Close</button>
                </div>
            </div>`;

        if (window.lucide) lucide.createIcons();
    },

    _calNav(direction) {
        const now  = new Date();
        let y = (App.calYear  != null) ? App.calYear  : now.getFullYear();
        let m = (App.calMonth != null) ? App.calMonth : now.getMonth();
        m += direction;
        if (m < 0)  { m = 11; y--; }
        if (m > 11) { m = 0;  y++; }
        App.calYear = y; App.calMonth = m;
        App.renderView();
    },

    _calNavOrg(direction) {
        const now  = new Date();
        let y = (App.calYear  != null) ? App.calYear  : now.getFullYear();
        let m = (App.calMonth != null) ? App.calMonth : now.getMonth();
        m += direction;
        if (m < 0)  { m = 11; y--; }
        if (m > 11) { m = 0;  y++; }
        App.calYear = y; App.calMonth = m;
        App.renderView();
    },

    _showEntryById(id) {
        const entry = this._entries[id];
        if (!entry) return;
        const { kind, obj, color } = entry;

        const modal   = document.getElementById('cal-detail-modal');
        const content = document.getElementById('cal-detail-content');
        if (!modal || !content) return;

        if (kind === 'event') {
            const et = Projects.EVENT_TYPES[obj.type] || {};
            const contribs = [];
            if (obj.hcw_count)        contribs.push(`<strong>${new Intl.NumberFormat().format(obj.hcw_count)}</strong> HCWs strengthened`);
            if (obj.patient_count)    contribs.push(`<strong>${new Intl.NumberFormat().format(obj.patient_count)}</strong> patients reached`);
            if (obj.facilities_count) contribs.push(`<strong>${new Intl.NumberFormat().format(obj.facilities_count)}</strong> facilities`);
            if (obj.population)       contribs.push(`<strong>${new Intl.NumberFormat().format(obj.population)}</strong> population covered`);

            content.innerHTML = `
                <div class="flex items-center gap-3 mb-4">
                    <div class="w-10 h-10 rounded-lg flex items-center justify-center" style="background:${color}20">
                        <i data-lucide="${et.icon || 'calendar'}" width="20" style="color:${color}"></i>
                    </div>
                    <div>
                        <p class="font-bold text-gsf-prussian">${App.escapeHtml(obj.title || '')}</p>
                        <p class="text-xs text-slate-400">${obj.date} · ${et.label || obj.type}</p>
                    </div>
                </div>
                ${contribs.length > 0 ? `<div class="bg-slate-50 rounded-lg p-3 mb-3 text-sm space-y-1">${contribs.map(c => `<p>${c}</p>`).join('')}</div>` : ''}
                ${obj.notes ? `<p class="text-sm text-slate-600 mb-3">${App.escapeHtml(obj.notes)}</p>` : ''}
                <button onclick="GenericViews._editEvent(GenericViews._currentProjectId,'${obj.id}'); document.getElementById('cal-detail-modal').classList.add('hidden')"
                        class="text-xs text-gsf-boston hover:underline font-semibold flex items-center gap-1">
                    <i data-lucide="pencil" width="11"></i> Edit this event
                </button>`;
        } else {
            const tags = (obj.tags || []).map(t => `<span class="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold uppercase rounded-full">${App.escapeHtml(t)}</span>`).join(' ');
            content.innerHTML = `
                <div class="mb-4">
                    <p class="text-xs text-slate-400 mb-1">${obj.date}</p>
                    <p class="font-bold text-gsf-prussian text-lg">${App.escapeHtml(obj.title || '')}</p>
                    ${tags ? `<div class="flex gap-1 mt-2 flex-wrap">${tags}</div>` : ''}
                </div>
                ${obj.body ? `<p class="text-sm text-slate-600 whitespace-pre-line">${App.escapeHtml(obj.body)}</p>` : ''}`;
        }

        if (window.lucide) lucide.createIcons();
        modal.classList.remove('hidden');
    },

    // ===== ORG DASHBOARD =====
    async renderOrgDashboard(main) {
        const now        = new Date();
        const year       = App.kpiYear === 'all' ? 'all' : (App.kpiYear || now.getFullYear());
        const appSettings = await Projects.getAppSettings();

        const hasSampleProject = Projects.registry.some(p => p.type === 'generic' && p.isSample);
        const genericProjects = Projects.registry.filter(p => p.type === 'generic' && (App.includeSample || !p.isSample));
        if (genericProjects.length === 0) {
            const appSettings = await Projects.getAppSettings();
            if (!App.editUnlocked) {
                // First-launch viewer: prompt for Sheets URL
                const alreadyHasUrl = !!(appSettings.googleSheetsUrl);
                main.innerHTML = `<div class="p-10 max-w-lg mx-auto">
                    <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
                        <div class="w-12 h-12 bg-gsf-prussian/10 rounded-full flex items-center justify-center mx-auto mb-4">
                            <i data-lucide="download-cloud" width="22" class="text-gsf-prussian"></i>
                        </div>
                        <h2 class="text-lg font-bold text-gsf-prussian mb-2">Load Project Data</h2>
                        <p class="text-sm text-slate-500 mb-1">Paste the <strong>Apps Script URL</strong> shared with you by your SURGdash administrator.</p>
                        <p class="text-xs text-slate-400 mb-5">It looks like: <span class="font-mono bg-slate-100 px-1.5 py-0.5 rounded">https://script.google.com/macros/s/…/exec</span></p>
                        <div class="flex gap-2 mb-3">
                            <input type="text" id="viewer-sheets-url" data-viewer-allowed value="${App.escapeHtml(appSettings.googleSheetsUrl || '')}"
                                placeholder="https://script.google.com/macros/s/…/exec"
                                class="flex-1 px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            <button id="viewer-load-btn" onclick="GenericViews._saveViewerSheetsUrlAndPull()"
                                class="shrink-0 px-4 py-2 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors flex items-center gap-1.5">
                                <i data-lucide="download" width="13"></i> Load Data
                            </button>
                        </div>
                        <label class="flex items-start gap-2.5 text-left mb-3 px-1 cursor-pointer">
                            <input type="checkbox" id="viewer-autopull-toggle" data-viewer-allowed checked
                                class="mt-0.5 rounded border-slate-300 text-gsf-boston focus:ring-gsf-boston/30" />
                            <span class="text-[11px] text-slate-500 leading-relaxed">Keep this device up to date automatically (pulls the latest on launch &amp; every 5&nbsp;min). <strong class="text-slate-600">Only turn this off if you are an admin who edits data on this device</strong> — auto-pull overwrites local data.</span>
                        </label>
                        ${alreadyHasUrl ? `<button onclick="GenericViews._saveViewerSheetsUrlAndPull()" class="w-full mt-1 px-4 py-2 border border-slate-200 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"><i data-lucide="refresh-cw" width="13"></i> Refresh with saved URL</button>` : ''}
                        <p id="viewer-load-status" class="mt-3 text-xs text-slate-400 min-h-[18px]"></p>
                    </div>
                </div>`;
            } else {
                const hasSheetsUrl = !!(appSettings && appSettings.googleSheetsUrl);
                main.innerHTML = `<div class="p-10 max-w-2xl mx-auto">
                    <div class="text-center text-slate-500 mb-8">
                        <div class="w-14 h-14 bg-gsf-prussian/10 rounded-full flex items-center justify-center mx-auto mb-4">
                            <i data-lucide="folder-plus" width="24" class="text-gsf-prussian"></i>
                        </div>
                        <p class="text-lg font-bold text-gsf-prussian mb-2">No projects yet</p>
                        <p class="text-sm">Get started by creating a new project, restoring a backup, or pulling from the cloud.</p>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <button onclick="App.navigate('new-project')" class="flex flex-col items-center gap-2 px-5 py-5 bg-white border-2 border-gsf-boston rounded-xl text-sm font-bold text-gsf-boston hover:bg-gsf-boston hover:text-white transition-colors">
                            <i data-lucide="plus" width="20"></i>
                            <span>New Project</span>
                            <span class="text-[10px] font-normal opacity-70">Start a blank project</span>
                        </button>
                        <button data-edit-only onclick="GenericViews._localRestore()" class="flex flex-col items-center gap-2 px-5 py-5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 hover:border-gsf-boston hover:text-gsf-boston transition-colors">
                            <i data-lucide="hard-drive-upload" width="20"></i>
                            <span>Restore Local Backup</span>
                            <span class="text-[10px] font-normal text-slate-400">Load a .json backup file</span>
                        </button>
                        ${hasSheetsUrl ? `
                            <button onclick="GenericViews._pullFromSheets()" class="flex flex-col items-center gap-2 px-5 py-5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 hover:border-emerald-600 hover:text-emerald-700 transition-colors">
                                <i data-lucide="download-cloud" width="20"></i>
                                <span>Pull from Cloud</span>
                                <span class="text-[10px] font-normal text-slate-400">Sync from Google Sheets</span>
                            </button>
                        ` : `
                            <button onclick="App.navigate('org-settings')" class="flex flex-col items-center gap-2 px-5 py-5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 hover:border-slate-400 transition-colors">
                                <i data-lucide="cloud" width="20"></i>
                                <span>Connect Cloud</span>
                                <span class="text-[10px] font-normal text-slate-400">Set Sheets URL in Settings</span>
                            </button>
                        `}
                    </div>

                    <p class="text-center text-[11px] text-slate-400 italic mt-6">Tip: the same actions are available any time from the icons in the org dashboard's top-right action bar.</p>
                </div>`;
            }
            if (window.lucide) lucide.createIcons();
            return;
        }

        // Load all project data
        const projectData = await Promise.all(genericProjects.map(async p => {
            const [events, allTargets, allActuals, updates] = await Promise.all([
                Projects.getEvents(p.id),
                Projects.getTargets(p.id),
                Projects.getActuals(p.id),
                Projects.getUpdates(p.id)
            ]);
            return { project: p, events, updates, allTargets, allActuals };
        }));

        // Per-project actual + target from stored data
        const hiddenYrsForAll = new Set(App._chartHiddenYears || []);
        const projectKpis = projectData.map(d => {
            let actual, target;
            if (year === 'all') {
                // Stock KPIs (population, facilities) take max-per-project across
                // years; flow KPIs sum. Matches the web export so totals agree.
                actual = Projects.rollupAllYears(d.allActuals, hiddenYrsForAll);
                target = Projects.rollupAllYears(d.allTargets, hiddenYrsForAll);
            } else {
                actual = Projects.getActualsForYear(d.allActuals, year);
                target = Projects.getTargetsForYear(d.allTargets, year);
            }
            return { ...d, actual, target };
        });

        // Org-wide aggregates (only active projects for selected year; all projects for 'all')
        const orgActuals  = { hcw_strengthened: 0, patients_reached: 0, facilities_strengthened: 0, population_access: 0 };
        const orgTargets  = { hcw_strengthened: 0, patients_reached: 0, facilities_strengthened: 0, population_access: 0 };
        projectKpis.forEach(d => {
            if (year !== 'all' && !this._isProjectActiveForYear(d.project, year)) return;
            Projects.STANDARD_KPIS.forEach(kpi => {
                orgActuals[kpi.id] += d.actual[kpi.id] || 0;
                orgTargets[kpi.id] += d.target[kpi.id] || 0;
            });
        });

        // HCW multiplier: apply if any project has it enabled and toggle is on
        const anyMultiplierEnabled = genericProjects.some(p => p.hcwMultiplierEnabled);
        const orgShowMultiplier    = anyMultiplierEnabled && App.showHcwMultiplier;
        if (orgShowMultiplier) {
            // Re-aggregate actuals and targets with per-project multiplier
            orgActuals.hcw_strengthened = 0;
            orgTargets.hcw_strengthened = 0;
            projectKpis.forEach(d => {
                if (!this._isProjectActiveForYear(d.project, year)) return;
                const rawAct = d.actual.hcw_strengthened || 0;
                const rawTgt = d.target.hcw_strengthened || 0;
                const rate = d.project.hcwMultiplierEnabled ? (d.project.hcwMultiplierRate !== undefined ? d.project.hcwMultiplierRate : 10) : 1;
                orgActuals.hcw_strengthened += d.project.hcwMultiplierEnabled ? Math.round(rawAct * rate) : rawAct;
                orgTargets.hcw_strengthened += d.project.hcwMultiplierEnabled ? Math.round(rawTgt * rate) : rawTgt;
            });
        }

        // All events with project reference (for recent activity display)
        const allEvents = projectData.flatMap(d => d.events.map(e => ({ ...e, _project: d.project })));
        // Combined activities: events + milestones (updates) across all projects
        const allActivities = [
            ...projectData.flatMap(d => d.events.map(e => ({ ...e, _kind: 'event',  _project: d.project }))),
            ...projectData.flatMap(d => (d.updates || []).map(u => ({ ...u, _kind: 'update', _project: d.project }))),
        ];

        // Multi-year aggregated data for charts
        const allYearsSet = new Set();
        projectData.forEach(d => {
            (d.allTargets || []).forEach(t => allYearsSet.add(t.year));
            (d.allActuals || []).forEach(a => allYearsSet.add(a.year));
        });
        const allYears = Array.from(allYearsSet).sort();
        const multiYearData = allYears.map(yr => {
            const row = { year: yr, actuals: {}, targets: {} };
            Projects.STANDARD_KPIS.forEach(kpi => { row.actuals[kpi.id] = 0; row.targets[kpi.id] = 0; });
            projectData.forEach(d => {
                const a = Projects.getActualsForYear(d.allActuals, yr);
                const t = Projects.getTargetsForYear(d.allTargets, yr);
                Projects.STANDARD_KPIS.forEach(kpi => {
                    let aVal = a[kpi.id] || 0;
                    let tVal = t[kpi.id] || 0;
                    if (orgShowMultiplier && kpi.id === 'hcw_strengthened' && d.project.hcwMultiplierEnabled) {
                        const rate = d.project.hcwMultiplierRate !== undefined ? d.project.hcwMultiplierRate : 10;
                        aVal = Math.round(aVal * rate);
                        tVal = Math.round(tVal * rate);
                    }
                    row.actuals[kpi.id] += aVal;
                    row.targets[kpi.id] += tVal;
                });
            });
            return row;
        });

        // SURGhub KPIs
        const audSnapLatest = (App.userHistory || []).sort((a, b) => b.Timestamp.localeCompare(a.Timestamp))[0] || null;
        const yearStr = year === 'all' ? String(now.getFullYear()) : String(year);

        // All-time: unique users from audience data, certificates from course data
        const surghubSnap = App.getAnalyticsSnap ? App.getAnalyticsSnap() : [];
        let totalCerts = 0;
        surghubSnap.forEach(d => { totalCerts += Number(d.Certificates) || 0; });
        const surghubTotal = {
            learners:     audSnapLatest ? (audSnapLatest.TotalUsers || 0) : (App.platformUniqueUsers || 0),
            certificates: totalCerts
        };
        const surghubTotal_countries = audSnapLatest ? (audSnapLatest.KnownCountry || 0) : 0;

        // Year: new unique users from Signups timeline (monthly new account signups)
        const surghubYear = { learners: 0, certificates: 0 };
        let learnersAfterYear = 0;
        if (audSnapLatest && audSnapLatest.Signups && window.Charts) {
            const signups = window.Charts.safeParse(audSnapLatest.Signups);
            Object.entries(signups).forEach(([month, count]) => {
                const c = Number(count) || 0;
                if (month.startsWith(yearStr)) surghubYear.learners += c;
                else if (month > yearStr) learnersAfterYear += c;
            });
        }
        // Year: certificates from CourseTimeline incremental data
        let certsAfterYear = 0;
        (App.data || []).forEach(d => {
            if (!d.CourseTimeline || d.IsShell || d.Excluded || !window.Charts) return;
            const scaled = window.Charts.getScaledTimeline(d.CourseTimeline, true);
            Object.entries(scaled).forEach(([month, vals]) => {
                const c = vals.c || 0;
                if (month.startsWith(yearStr)) surghubYear.certificates += c;
                else if (month > yearStr) certsAfterYear += c;
            });
        });

        // Cumulative totals at end of selected year
        const surghubYearEnd = {
            learners:     Math.max(0, surghubTotal.learners - learnersAfterYear),
            certificates: Math.max(0, surghubTotal.certificates - certsAfterYear)
        };

        // Countries for selected year — unique countries with new signups that year
        // + cumulative countries up to end of year
        let surghubYear_countries = 0;
        let surghubYearEnd_countries = 0;
        if (audSnapLatest && audSnapLatest.CountryTimeline && window.Charts) {
            const ctl = window.Charts.safeParse(audSnapLatest.CountryTimeline);
            const yearCountries = new Set();
            const cumCountries  = new Set();
            Object.entries(ctl).forEach(([month, countries]) => {
                if (typeof countries === 'object') {
                    const valid = Object.keys(countries).filter(c => c && c !== 'Unknown' && c !== 'nan');
                    if (month.startsWith(yearStr)) valid.forEach(c => yearCountries.add(c));
                    if (month <= yearStr + '-12') valid.forEach(c => cumCountries.add(c));
                }
            });
            surghubYear_countries = yearCountries.size;
            surghubYearEnd_countries = cumCountries.size;
        }

        const hasSurghubData = surghubTotal.learners > 0 || surghubTotal.certificates > 0;

        const years = [];
        const yearMax = App.kpiYearMax != null ? Math.max(App.kpiYearMax, now.getFullYear() + 1) : now.getFullYear() + 1;
        for (let y = 2022; y <= yearMax; y++) years.push(y);
        const isAllYear = year === 'all';
        const yearSelector = years.map(y =>
            `<button onclick="App.kpiYear=${y}; App.renderView()" class="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${y === year ? 'bg-gsf-boston text-white' : 'text-slate-500 hover:bg-slate-100'}">${y}</button>`
        ).join('') +
        `<span class="w-px h-5 bg-slate-300 mx-1 inline-block align-middle"></span>` +
        `<button onclick="App.kpiYear='all'; App.renderView()" class="ml-0.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${isAllYear ? 'bg-gsf-prussian text-white shadow-sm' : 'text-gsf-prussian bg-gsf-prussian/10 hover:bg-gsf-prussian/20'}" title="All-time cumulative totals"><span class="text-[10px] ${isAllYear ? 'opacity-90' : 'opacity-70'}">★</span> All time</button>` +
        `<button onclick="App.kpiYearMax=${yearMax + 1}; App.renderView()" class="px-2.5 py-1.5 rounded-lg text-sm font-semibold text-slate-400 hover:bg-slate-100" title="Add future year">+</button><button onclick="GenericViews._removeLastYear()" class="px-2.5 py-1.5 rounded-lg text-sm font-semibold text-slate-400 hover:bg-red-50 hover:text-red-500" title="Remove the topmost year (only allowed if it has no data)">−</button>`;

        const kpiCards = Projects.STANDARD_KPIS.map(kpi => {
            const v   = orgActuals[kpi.id] || 0;
            const tgt = orgTargets[kpi.id] || 0;
            const pct = tgt > 0 ? Math.min(100, Math.round((v / tgt) * 100)) : null;
            return `
            <div class="rounded-xl p-5 border group relative overflow-hidden"
                 style="background: linear-gradient(135deg, ${kpi.color}0D, #ffffff 65%); border-color: ${kpi.color}33">
                <div class="absolute top-0 left-0 right-0 h-1" style="background: ${kpi.color}"></div>
                <p class="text-[10px] font-black uppercase tracking-wider leading-tight mb-0.5" style="color:${kpi.color}">${kpi.nameBig || kpi.name}</p>
                ${kpi.nameSub ? `<p class="text-[10px] text-slate-500 font-medium leading-tight mb-3">${kpi.nameSub}</p>` : '<div class="mb-3"></div>'}
                <div class="flex items-baseline gap-2 mb-3">
                    <span class="text-4xl font-black tabular-nums" style="color:${kpi.color}">${this._fmt(v)}</span>
                    <span class="text-[11px] font-medium" style="color:${kpi.color}; opacity:0.55">${isAllYear ? 'all time' : 'in ' + year}</span>
                </div>
                ${pct !== null ? `
                    <div>
                        <div class="flex justify-between items-baseline text-[10px] mb-1.5">
                            <span class="text-slate-500">Target: <strong class="text-slate-700 tabular-nums">${this._fmt(tgt)}</strong></span>
                            <span class="font-black text-sm tabular-nums opacity-0 group-hover:opacity-100 transition-opacity" style="color:${kpi.color}">${pct}%</span>
                        </div>
                        <div class="w-full h-1.5 rounded-full overflow-hidden" style="background: ${kpi.color}1A">
                            <div class="h-full rounded-full transition-all" style="width:${pct}%; background:${kpi.color}"></div>
                        </div>
                    </div>
                ` : `<p class="text-[10px] text-slate-400 italic">${isAllYear ? 'No targets set' : 'No target set for ' + year}</p>`}
            </div>`; }).join('');

        // Per-project breakdown rows
        const projectRows = projectKpis.map(d => {
            const lastActivity = d.events[0]?.date || d.updates[0]?.date || '—';
            return `
            <tr class="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onclick="App.switchProject('${d.project.id}')">
                <td class="px-4 py-3">
                    <div class="flex items-center gap-2">
                        <div class="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style="background:${d.project.color}20">
                            <i data-lucide="${d.project.icon || 'folder'}" width="12" style="color:${d.project.color}"></i>
                        </div>
                        <span class="text-sm font-semibold text-slate-800">${App.escapeHtml(d.project.name)}</span>
                    </div>
                </td>
                ${Projects.STANDARD_KPIS.map(kpi => {
                    const v   = d.actual[kpi.id] || 0;
                    const tgt = d.target[kpi.id] || 0;
                    const pct = tgt > 0 ? Math.min(100, Math.round((v / tgt) * 100)) : null;
                    return `<td class="px-4 py-3">
                        <span class="text-sm font-bold text-slate-800">${this._fmt(v)}</span>
                        ${tgt > 0 ? `<p class="text-[10px] text-slate-400 mt-0.5">of ${this._fmt(tgt)} · <span class="font-bold" style="color:${kpi.color}">${pct}%</span></p>` : '<p class="text-[10px] text-slate-300 mt-0.5">no target</p>'}
                    </td>`;
                }).join('')}
                <td class="px-4 py-3 text-xs text-slate-400">${lastActivity}</td>
            </tr>`;
        }).join('');

        // Recent activities across all projects — events + milestones, last 10
        const recentAll = allActivities
            .filter(a => a.date)
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 10)
            .map(a => {
                const projColor = a._project.color || '#64748b';
                const projName  = App.escapeHtml(a._project.name);
                // Project-name jump-link helper (clicking it switches to project's Activities view)
                const projLink = `<button onclick="event.stopPropagation(); GenericViews._jumpToProjectActivities('${a._project.id}')" class="text-[10px] font-bold text-slate-500 hover:text-gsf-boston hover:underline">${projName}</button>`;
                if (a._kind === 'update') {
                    return `<div onclick="GenericViews._showActivityDetail('${a._project.id}','update','${a.id}')" class="flex items-start gap-3 py-2.5 border-b border-slate-50 last:border-0 cursor-pointer hover:bg-slate-50 -mx-2 px-2 rounded transition-colors">
                        <div class="text-[10px] text-slate-400 w-16 shrink-0 pt-0.5">${a.date}</div>
                        <div class="w-2 h-2 rounded-full mt-1.5 shrink-0" style="background:${projColor}"></div>
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 flex-wrap mb-0.5">
                                ${projLink}
                                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-purple-100 text-purple-700"><i data-lucide="flag" width="9"></i> Milestone</span>
                            </div>
                            <p class="text-sm font-semibold text-slate-800 truncate">${App.escapeHtml(a.title || '')}</p>
                            ${a.body ? `<p class="text-xs text-slate-500 line-clamp-1">${App.escapeHtml(a.body)}</p>` : ''}
                        </div>
                    </div>`;
                }
                return `<div onclick="GenericViews._showActivityDetail('${a._project.id}','event','${a.id}')" class="flex items-start gap-3 py-2.5 border-b border-slate-50 last:border-0 cursor-pointer hover:bg-slate-50 -mx-2 px-2 rounded transition-colors">
                    <div class="text-[10px] text-slate-400 w-16 shrink-0 pt-0.5">${a.date}</div>
                    <div class="w-2 h-2 rounded-full mt-1.5 shrink-0" style="background:${projColor}"></div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap mb-0.5">
                            ${projLink}
                            ${this._eventTypeBadge(a.type)}
                        </div>
                        <p class="text-sm font-semibold text-slate-800 truncate">${App.escapeHtml(a.title || '')}</p>
                        <p class="text-xs text-slate-500">${this._kpiContribsSummary(a)}</p>
                    </div>
                </div>`;
            }).join('');

        const surghubSection = hasSurghubData ? `
            <div class="mb-8">
                <h2 class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <i data-lucide="graduation-cap" width="13"></i> SURGhub Learning Platform
                </h2>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    ${[
                        { label: 'Learners on SURGhub', yearVal: surghubYear.learners, yearEndVal: surghubYearEnd.learners, totalVal: surghubTotal.learners, color: '#4389C8', icon: 'users' },
                        { label: 'Certificates Issued',  yearVal: surghubYear.certificates, yearEndVal: surghubYearEnd.certificates, totalVal: surghubTotal.certificates, color: '#002F4C', icon: 'award' },
                        { label: 'Countries',            yearVal: surghubYear_countries, yearEndVal: surghubYearEnd_countries, totalVal: surghubTotal_countries, color: '#10B981', icon: 'globe' }
                    ].map(k => `
                        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                            <div class="flex items-center gap-2 mb-3">
                                <div class="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style="background:${k.color}20">
                                    <i data-lucide="${k.icon}" width="14" style="color:${k.color}"></i>
                                </div>
                                <p class="text-xs font-bold text-slate-500 uppercase tracking-wide">${k.label}</p>
                            </div>
                            <div class="flex items-end gap-2 mb-1">
                                <span class="text-2xl font-black" style="color:${k.color}">${k.yearVal > 0 ? this._fmt(k.yearVal) : '—'}</span>
                                <span class="text-xs text-slate-400 mb-0.5">new in ${year}</span>
                            </div>
                            <p class="text-[10px] text-slate-400">
                                Total end of ${year}: <strong class="text-slate-600">${this._fmt(k.yearEndVal)}</strong>
                                · All-time: ${this._fmt(k.totalVal)}
                            </p>
                        </div>`).join('')}
                </div>
            </div>` : '';

        const totalsFooter = `
            <tfoot>
                <tr class="bg-slate-50 border-t-2 border-slate-200">
                    <td class="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Total</td>
                    ${Projects.STANDARD_KPIS.map(kpi => {
                        const v   = orgActuals[kpi.id] || 0;
                        const tgt = orgTargets[kpi.id] || 0;
                        const pct = tgt > 0 ? Math.min(100, Math.round((v / tgt) * 100)) : null;
                        return `<td class="px-4 py-3">
                            <span class="text-sm font-black" style="color:${kpi.color}">${this._fmt(v)}</span>
                            ${tgt > 0 ? `<p class="text-[10px] text-slate-400 mt-0.5">of ${this._fmt(tgt)} · <span class="font-bold" style="color:${kpi.color}">${pct}%</span></p>` : ''}
                        </td>`;
                    }).join('')}
                    <td></td>
                </tr>
            </tfoot>`;

        main.innerHTML = `
            <div class="p-6 md:p-10 fade-in w-full max-w-6xl mx-auto">
                <header class="mb-6 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div class="px-5 py-4 flex items-start justify-between gap-4 flex-wrap" style="background:linear-gradient(135deg, #1B3A5708 0%, transparent 60%)">
                        <div class="flex items-center gap-3 min-w-0 flex-1">
                            <div class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-sm bg-gsf-prussian" style="box-shadow:0 2px 8px rgba(27,58,87,0.25)">
                                <i data-lucide="building-2" width="22" style="color:white"></i>
                            </div>
                            <div class="min-w-0">
                                <h1 class="text-xl font-bold text-gsf-prussian">Organisation Overview</h1>
                                <p class="text-xs text-slate-500 mt-0.5">${genericProjects.length} active project${genericProjects.length !== 1 ? 's' : ''}</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-2 shrink-0">
                            ${hasSampleProject ? `<label class="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 cursor-pointer select-none" title="Blend the demonstration (sample) project in or out of the organisation totals and charts">
                                <input type="checkbox" data-viewer-allowed ${App.includeSample ? 'checked' : ''} onchange="App.toggleSampleInclude(this.checked)" class="accent-purple-600 cursor-pointer">
                                <i data-lucide="flask-conical" width="12" class="text-purple-500"></i> Sample
                            </label>` : `<button onclick="App.addSampleProject()" class="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:border-purple-300 hover:text-purple-700 transition-colors select-none" title="Add a demonstration project — fully populated with KPIs, quality data, facilities and events — then blend it into the dashboard to preview a complete org view"><i data-lucide="flask-conical" width="12" class="text-purple-500"></i> Add sample</button>`}
                            <div class="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1">${yearSelector}</div>
                        </div>
                    </div>
                    <div class="border-t border-slate-100 px-5 py-2 flex items-center gap-2 flex-wrap bg-slate-50/50">
                        <button data-edit-only onclick="GenericViews._exportAllProjectsPdf()" class="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold text-gsf-boston hover:bg-gsf-boston hover:text-white transition-all" title="Generate combined PDF report for all projects"><i data-lucide="file-stack" width="12"></i> All Projects PDF</button>
                        <button data-edit-only onclick="GenericViews._exportIntakeForm()" class="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold text-emerald-700 hover:bg-emerald-600 hover:text-white transition-all" title="Generate a new-project intake form for a colleague to fill in"><i data-lucide="user-plus" width="12"></i> Intake Form</button>
                        <button data-edit-only onclick="GenericViews._exportOrgSnapshot(${isAllYear ? "'all'" : year})" class="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-all" title="Export interactive web snapshot (internal — beta banner, full data)"><i data-lucide="globe" width="12"></i> Snapshot</button>
                        <button data-edit-only onclick="GenericViews._showExternalSnapshotPicker(${isAllYear ? "'all'" : year})" class="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-all" title="Export a clean, website-ready snapshot — pick exactly which projects, years, and indicators to include"><i data-lucide="share-2" width="12"></i> External</button>
                        ${anyMultiplierEnabled ? `<button onclick="App.showHcwMultiplier=!App.showHcwMultiplier; App.renderView()" class="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-all ${orgShowMultiplier ? 'bg-gsf-boston text-white' : 'text-slate-500 hover:bg-slate-100'}" title="Apply HCW multiplier effect"><i data-lucide="trending-up" width="12"></i> HCW</button>` : ''}
                        <span class="w-px h-4 bg-slate-200 mx-1"></span>
                        <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Sheets</span>
                        <button id="sheets-sync-btn" onclick="GenericViews._syncToSheets()" data-edit-only class="p-1.5 rounded text-emerald-600 hover:bg-emerald-50 transition-all" title="Push all projects + org summary to Google Sheets"><i data-lucide="upload" width="14"></i></button>
                        <button id="sheets-pull-btn" onclick="GenericViews._pullFromSheets()" class="p-1.5 rounded text-emerald-600 hover:bg-emerald-50 transition-all" title="Pull KPI data back from Google Sheets"><i data-lucide="download" width="14"></i></button>
                        ${appSettings.googleSheetsViewUrl ? `<button onclick="electronAPI.openExternal('${App.escapeHtml(appSettings.googleSheetsViewUrl)}')" class="p-1.5 rounded text-emerald-600 hover:bg-emerald-50 transition-all" title="Open Google Sheet"><i data-lucide="sheet" width="14"></i></button>` : ''}
                        <span data-edit-only class="w-px h-4 bg-slate-200 mx-1"></span>
                        <span data-edit-only class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Local</span>
                        <button data-edit-only onclick="GenericViews._localBackup()" class="p-1.5 rounded text-slate-500 hover:bg-slate-100 transition-all" title="Save a complete JSON backup — SURGfund projects + SURGhub data + settings"><i data-lucide="hard-drive-download" width="14"></i></button>
                        <button data-edit-only onclick="GenericViews._localRestore()" class="p-1.5 rounded text-slate-500 hover:bg-slate-100 transition-all" title="Restore from a previous full backup file (edit mode only)"><i data-lucide="hard-drive-upload" width="14"></i></button>
                        <button data-edit-only onclick="GenericViews._showLocalBackupBrowser()" class="p-1.5 rounded text-slate-500 hover:bg-slate-100 transition-all" title="Restore from an automatic backup — the pre-sync / pre-pull snapshots SURGdash saves on its own (one-click, no file hunting)"><i data-lucide="history" width="14"></i></button>
                    </div>
                </header>

                <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">${kpiCards}</div>

                ${allYears.length >= 2 ? `
                <div class="mt-8 mb-3">
                    <h2 class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <i data-lucide="trending-up" width="13"></i> Progress Over Time
                    </h2>
                    <div id="org-chart-controls"></div>
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        ${Projects.STANDARD_KPIS.map(kpi => `
                            <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5 relative group">
                                <div class="flex items-center gap-2 mb-2">
                                    <div class="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style="background:${kpi.color}20">
                                        <i data-lucide="${kpi.icon}" width="12" style="color:${kpi.color}"></i>
                                    </div>
                                    <p class="text-xs font-black text-gsf-prussian uppercase tracking-wide flex-1">${kpi.nameBig || kpi.name}</p>
                                    <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button data-copy-chart="org-chart-${kpi.id}" onclick="GenericCharts.copyChart('org-chart-${kpi.id}')" title="Copy to clipboard" class="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"><i data-lucide="copy" width="11"></i></button>
                                        <button onclick="GenericCharts.downloadChart('org-chart-${kpi.id}','${(kpi.nameBig||kpi.name).replace(/'/g,'')}')" title="Download PNG" class="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"><i data-lucide="download" width="11"></i></button>
                                    </div>
                                </div>
                                <div id="org-chart-${kpi.id}" style="min-height:220px;"></div>
                            </div>`).join('')}
                    </div>
                </div>
                ` : ''}

                ${surghubSection}

                <div class="bg-white rounded-xl border border-slate-200 shadow-sm mb-6 overflow-hidden mt-8">
                    <div class="bg-slate-50 border-b px-5 py-3">
                        <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide">Project Breakdown — ${isAllYear ? 'All Time' : year}</h2>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full">
                            <thead><tr class="border-b border-slate-200">
                                <th class="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Project</th>
                                ${Projects.STANDARD_KPIS.map(kpi => `<th class="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">${kpi.nameBig || kpi.name.split(' ').slice(0, 2).join(' ')}</th>`).join('')}
                                <th class="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Last Activity</th>
                            </tr></thead>
                            <tbody>${projectRows}</tbody>
                            ${totalsFooter}
                        </table>
                    </div>
                </div>

                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide mb-4">Recent Activity</h2>
                    ${recentAll || '<p class="text-slate-400 text-sm italic">No activities logged yet across any project.</p>'}
                </div>
            </div>`;

        if (window.lucide) lucide.createIcons();

        // Draw multi-year charts
        if (allYears.length >= 2) {
            GenericViews._orgMultiYearData = multiYearData;   // cache for lightweight refresh
            const ctrlEl = document.getElementById('org-chart-controls');
            if (ctrlEl) ctrlEl.innerHTML = GenericViews._buildChartControls(multiYearData, 'org');
            setTimeout(() => {
                GenericCharts.drawOrgYearlyProgress(multiYearData, year, 'org-chart-', GenericViews._getChartFilters());
            }, 80);
        }
    },

    // ===== ORG TABLE =====
    async renderOrgTable(main) {
        const now  = new Date();
        const year = App.kpiYear === 'all' ? 'all' : (App.kpiYear || now.getFullYear());

        const genericProjects = Projects.registry.filter(p => p.type === 'generic' && (App.includeSample || !p.isSample));

        const projectData = await Promise.all(genericProjects.map(async p => {
            const [allTargets, allActuals] = await Promise.all([
                Projects.getTargets(p.id),
                Projects.getActuals(p.id)
            ]);
            return { project: p, allTargets, allActuals };
        }));

        const years = [];
        const yearMax = App.kpiYearMax != null ? Math.max(App.kpiYearMax, now.getFullYear() + 1) : now.getFullYear() + 1;
        for (let y = 2022; y <= yearMax; y++) years.push(y);
        const isAllYear = year === 'all';
        const yearSelector = years.map(y =>
            `<button onclick="App.kpiYear=${y}; App.renderView()" class="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${y === year ? 'bg-gsf-boston text-white' : 'text-slate-500 hover:bg-slate-100'}">${y}</button>`
        ).join('') +
        `<span class="w-px h-5 bg-slate-300 mx-1 inline-block align-middle"></span>` +
        `<button onclick="App.kpiYear='all'; App.renderView()" class="ml-0.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${isAllYear ? 'bg-gsf-prussian text-white shadow-sm' : 'text-gsf-prussian bg-gsf-prussian/10 hover:bg-gsf-prussian/20'}" title="All-time cumulative totals"><span class="text-[10px] ${isAllYear ? 'opacity-90' : 'opacity-70'}">★</span> All time</button>` +
        `<button onclick="App.kpiYearMax=${yearMax + 1}; App.renderView()" class="px-2.5 py-1.5 rounded-lg text-sm font-semibold text-slate-400 hover:bg-slate-100" title="Add future year">+</button><button onclick="GenericViews._removeLastYear()" class="px-2.5 py-1.5 rounded-lg text-sm font-semibold text-slate-400 hover:bg-red-50 hover:text-red-500" title="Remove the topmost year (only allowed if it has no data)">−</button>`;

        // Per-project actuals + targets from stored data
        const anyMultiplierEnabled = genericProjects.some(p => p.hcwMultiplierEnabled);
        const tableShowMultiplier  = anyMultiplierEnabled && App.showHcwMultiplier;
        const hiddenYrsForAll = new Set(App._chartHiddenYears || []);
        const projectKpis = projectData.map(d => {
            let actual, target;
            if (isAllYear) {
                // Stock KPIs (population, facilities) take max-per-project across
                // years; flow KPIs sum. Matches the web export so totals agree.
                actual = Projects.rollupAllYears(d.allActuals, hiddenYrsForAll);
                target = Projects.rollupAllYears(d.allTargets, hiddenYrsForAll);
            } else {
                actual = { ...Projects.getActualsForYear(d.allActuals, year) };
                target = { ...Projects.getTargetsForYear(d.allTargets, year) };
                if (tableShowMultiplier && d.project.hcwMultiplierEnabled) {
                    const rate = d.project.hcwMultiplierRate !== undefined ? d.project.hcwMultiplierRate : 10;
                    if (actual.hcw_strengthened) actual.hcw_strengthened = Math.round(actual.hcw_strengthened * rate);
                    if (target.hcw_strengthened) target.hcw_strengthened = Math.round(target.hcw_strengthened * rate);
                }
            }
            return { ...d, actual, target };
        });

        // Org-wide column totals (only active projects for specific year; all for 'all')
        const orgActuals  = { hcw_strengthened: 0, patients_reached: 0, facilities_strengthened: 0, population_access: 0 };
        const orgTargets  = { hcw_strengthened: 0, patients_reached: 0, facilities_strengthened: 0, population_access: 0 };
        projectKpis.forEach(d => {
            if (!isAllYear && !GenericViews._isProjectActiveForYear(d.project, year)) return;
            Projects.STANDARD_KPIS.forEach(kpi => {
                orgActuals[kpi.id] += d.actual[kpi.id] || 0;
                orgTargets[kpi.id] += d.target[kpi.id] || 0;
            });
        });

        const rows = projectKpis.map(d => {
            const isActive = isAllYear || GenericViews._isProjectActiveForYear(d.project, year);
            const cells = Projects.STANDARD_KPIS.map(kpi => {
                const val = d.actual[kpi.id] || 0;
                const g   = d.target[kpi.id] || 0;
                const pct = g > 0 ? Math.min(100, Math.round((val / g) * 100)) : null;
                return `
                <td class="px-5 py-3 text-right">
                    <span class="text-sm font-bold text-slate-800">${this._fmt(val)}</span>
                    ${g > 0 ? `<p class="text-[10px] text-slate-400 mt-0.5">of ${this._fmt(g)}</p>` : ''}
                    ${pct !== null
                        ? `<div class="flex items-center justify-end gap-1.5 mt-1">
                               <div class="w-16 bg-slate-100 rounded-full h-1">
                                   <div class="h-1 rounded-full" style="width:${pct}%; background:${kpi.color}"></div>
                               </div>
                               <span class="text-[10px] font-bold" style="color:${kpi.color}">${pct}%</span>
                           </div>`
                        : `<p class="text-[10px] text-slate-300 mt-1">no target</p>`}
                </td>`;
            }).join('');

            return `
            <tr class="border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${isActive ? '' : 'opacity-40'}" onclick="App.switchProject('${d.project.id}')" title="${isActive ? '' : 'Inactive for ' + year}">
                <td class="px-5 py-3">
                    <div class="flex items-center gap-2.5">
                        <div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style="background:${d.project.color}20">
                            <i data-lucide="${d.project.icon || 'folder'}" width="13" style="color:${d.project.color}"></i>
                        </div>
                        <div>
                            <p class="text-sm font-semibold text-slate-800">${App.escapeHtml(d.project.name)}${isActive ? '' : ' <span class="text-[10px] text-slate-400 font-normal">(inactive)</span>'}</p>
                            ${d.project.description ? `<p class="text-[10px] text-slate-400 truncate max-w-[180px]">${App.escapeHtml(d.project.description)}</p>` : ''}
                        </div>
                    </div>
                </td>
                ${cells}
            </tr>`;
        }).join('');

        // Totals footer row
        const footerCells = Projects.STANDARD_KPIS.map(kpi => {
            const v   = orgActuals[kpi.id] || 0;
            const tgt = orgTargets[kpi.id] || 0;
            const pct = tgt > 0 ? Math.min(100, Math.round((v / tgt) * 100)) : null;
            return `
            <td class="px-5 py-3 text-right">
                <span class="text-sm font-black" style="color:${kpi.color}">${this._fmt(v)}</span>
                ${tgt > 0 ? `<p class="text-[10px] text-slate-400 mt-0.5">of ${this._fmt(tgt)} · <span class="font-bold" style="color:${kpi.color}">${pct}%</span></p>` : ''}
            </td>`;
        }).join('');

        main.innerHTML = `
            <div class="p-6 md:p-10 fade-in w-full max-w-6xl mx-auto">
                <header class="mb-8 flex items-center justify-between flex-wrap gap-3">
                    <div>
                        <h1 class="text-2xl font-bold text-gsf-prussian">KPI Table</h1>
                        <p class="text-sm text-slate-500 mt-1">All projects · ${genericProjects.length} project${genericProjects.length !== 1 ? 's' : ''} · ${isAllYear ? 'All-time totals' : year}</p>
                    </div>
                    <div class="flex items-center gap-2 flex-wrap">
                        <div class="flex items-center gap-1 bg-slate-100 rounded-lg p-1">${yearSelector}</div>
                        ${anyMultiplierEnabled ? `<button onclick="App.showHcwMultiplier=!App.showHcwMultiplier; App.renderView()" class="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-semibold transition-all ${tableShowMultiplier ? 'bg-gsf-boston text-white border-gsf-boston' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}" title="Apply HCW multiplier effect"><i data-lucide="trending-up" width="14"></i> HCW</button>` : ''}
                        <button data-edit-only onclick="GenericViews._exportOrgExcel(${year})" class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all">
                            <i data-lucide="file-spreadsheet" width="14" class="text-emerald-600"></i> Excel
                        </button>
                        <button data-edit-only onclick="GenericViews._exportOrgPdf(${year})" class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all">
                            <i data-lucide="file-text" width="14" class="text-red-500"></i> PDF
                        </button>
                        <button data-edit-only onclick="GenericViews._exportOrgSnapshot(${isAllYear ? "'all'" : year})" class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all" title="Export interactive web snapshot">
                            <i data-lucide="globe" width="14" class="text-gsf-boston"></i> Web Snapshot
                        </button>
                        <button data-edit-only onclick="GenericViews._exportAllProjectsPdf()" class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gsf-boston bg-gsf-boston text-sm font-semibold text-white hover:bg-gsf-prussian transition-all" title="Generate combined PDF report for all projects">
                            <i data-lucide="file-stack" width="14"></i> All Projects PDF
                        </button>
                    </div>
                </header>

                ${genericProjects.length === 0 ? `<p class="text-slate-400 italic">No projects yet.</p>` : `
                <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div class="overflow-x-auto">
                        <table class="w-full">
                            <thead>
                                <tr class="bg-slate-50 border-b border-slate-200">
                                    <th class="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Project</th>
                                    ${Projects.STANDARD_KPIS.map(kpi => {
                                        const head = kpi.nameBig || kpi.name;
                                        const sub  = kpi.nameSub || '';
                                        return `
                                        <th class="px-5 py-3 text-right" style="color:${kpi.color}">
                                            <div class="flex items-center justify-end gap-1.5 text-xs font-black uppercase tracking-wide">
                                                <i data-lucide="${kpi.icon}" width="11"></i>
                                                ${head}
                                            </div>
                                            ${sub ? `<p class="text-[9px] font-normal normal-case text-slate-400 mt-0.5 text-right">${sub}</p>` : ''}
                                        </th>`;
                                    }).join('')}
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                            <tfoot>
                                <tr class="bg-slate-50 border-t-2 border-slate-200">
                                    <td class="px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Total</td>
                                    ${footerCells}
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>`}
            </div>`;

        if (window.lucide) lucide.createIcons();
    },

    // ===== ORG EXPORTS =====
    async _exportOrgExcel(year) {
        try {
            const genericProjects = Projects.registry.filter(p => p.type === 'generic' && !p.isSample);
            const projectData = await Promise.all(genericProjects.map(async p => {
                const [events, allTargets, allActuals] = await Promise.all([Projects.getEvents(p.id), Projects.getTargets(p.id), Projects.getActuals(p.id)]);
                return { project: p, events, allTargets, allActuals };
            }));

            const wb = XLSX.utils.book_new();

            // Sheet 1 — KPI Summary
            const orgTotals = { };
            Projects.STANDARD_KPIS.forEach(kpi => { orgTotals[kpi.id] = 0; });
            const summaryRows = projectData.map(d => {
                const act = Projects.getActualsForYear(d.allActuals, year);
                const tgt = Projects.getTargetsForYear(d.allTargets, year);
                const row = { 'Project': d.project.name };
                Projects.STANDARD_KPIS.forEach(kpi => {
                    const v = act[kpi.id] || 0;
                    row[kpi.name] = v;
                    row[kpi.name + ' Target'] = tgt[kpi.id] || '';
                    row[kpi.name + ' %'] = tgt[kpi.id] > 0 ? Math.round((v / tgt[kpi.id]) * 100) + '%' : '';
                    orgTotals[kpi.id] += v;
                });
                return row;
            });
            // Totals row
            const totRow = { 'Project': 'TOTAL' };
            Projects.STANDARD_KPIS.forEach(kpi => { totRow[kpi.name] = orgTotals[kpi.id] || 0; totRow[kpi.name + ' Target'] = ''; totRow[kpi.name + ' %'] = ''; });
            summaryRows.push(totRow);
            const ws1 = XLSX.utils.json_to_sheet(summaryRows);
            ws1['!cols'] = [{ wch: 28 }, ...Projects.STANDARD_KPIS.flatMap(() => [{ wch: 16 }, { wch: 12 }, { wch: 8 }])];
            XLSX.utils.book_append_sheet(wb, ws1, `KPI Summary ${year}`);

            // Sheet 2 — All Events
            const eventRows = projectData.flatMap(d => d.events.map(e => ({
                'Project':      d.project.name,
                'Date':         e.date,
                'Type':         (Projects.EVENT_TYPES[e.type] || {}).label || e.type,
                'Title':        e.title || '',
                'HCWs (KPI)':   e.hcw_count || '',
                'HCWs (Total)': e.hcw_total  || '',
                'Patients':     e.patient_count   || '',
                'Facilities':   e.facilities_count || '',
                'Population':   e.population       || '',
                'Notes':        e.notes || ''
            }))).sort((a, b) => b.Date.localeCompare(a.Date));
            const ws2 = XLSX.utils.json_to_sheet(eventRows);
            ws2['!cols'] = [{ wch: 25 }, { wch: 12 }, { wch: 18 }, { wch: 35 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 35 }];
            XLSX.utils.book_append_sheet(wb, ws2, 'All Events');

            const ipcRenderer = electronAPI;
            const savePath = await ipcRenderer.invoke('pick-save-path', `org_kpi_report_${year}.xlsx`);
            if (!savePath) return;
            const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            electronAPI.fs.writeFileSync(savePath, new Uint8Array(wbOut));
            App.showMsg('Excel report saved!');
        } catch (err) {
            console.error(err);
            alert('Export failed: ' + err.message);
        }
    },

    async _exportOrgPdf(year) {
        try {
            const genericProjects = Projects.registry.filter(p => p.type === 'generic' && !p.isSample);
            const projectData = await Promise.all(genericProjects.map(async p => {
                const [allTargets, allActuals] = await Promise.all([Projects.getTargets(p.id), Projects.getActuals(p.id)]);
                return { project: p, allTargets, allActuals };
            }));
            const orgTotals = {};
            Projects.STANDARD_KPIS.forEach(kpi => { orgTotals[kpi.id] = 0; });
            projectData.forEach(d => {
                const act = Projects.getActualsForYear(d.allActuals, year);
                Projects.STANDARD_KPIS.forEach(kpi => { orgTotals[kpi.id] += act[kpi.id] || 0; });
            });
            const fmt = n => n !== null && n !== undefined ? new Intl.NumberFormat('en-US').format(n) : '—';

            const kpiCards = Projects.STANDARD_KPIS.map(kpi => `
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:18px;flex:1;min-width:180px">
                    <p style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;margin:0 0 6px">${kpi.name}</p>
                    <p style="font-size:26px;font-weight:900;color:${kpi.color};margin:0">${fmt(orgTotals[kpi.id])}</p>
                    <p style="font-size:10px;color:#94a3b8;margin:4px 0 0">${kpi.unit} in ${year}</p>
                </div>`).join('');

            const tableRows = projectData.map(d => {
                const act = Projects.getActualsForYear(d.allActuals, year);
                const tgt = Projects.getTargetsForYear(d.allTargets, year);
                const cells = Projects.STANDARD_KPIS.map(kpi => {
                    const val = act[kpi.id] || 0;
                    const g   = tgt[kpi.id] || 0;
                    const pct = g > 0 ? Math.round((val / g) * 100) : null;
                    return `<td style="padding:10px 14px;text-align:right;border-bottom:1px solid #f1f5f9">
                        <strong>${fmt(val)}</strong>
                        ${g > 0 ? `<br><span style="font-size:10px;color:#94a3b8">of ${fmt(g)} · ${pct}%</span>` : ''}
                    </td>`;
                }).join('');
                return `<tr>
                    <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9">
                        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${d.project.color};margin-right:8px;vertical-align:middle"></span>
                        <strong>${d.project.name}</strong>
                    </td>${cells}</tr>`;
            }).join('');

            const totCells = Projects.STANDARD_KPIS.map(kpi =>
                `<td style="padding:10px 14px;text-align:right;font-weight:900;color:${kpi.color}">${fmt(orgTotals[kpi.id])}</td>`
            ).join('');

            const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
            <style>
                * { font-family: -apple-system, Arial, sans-serif; box-sizing: border-box; }
                body { margin: 0; padding: 32px 40px; background: #f8fafc; color: #1e293b; }
                @page { size: A4 landscape; margin: 20mm; }
            </style></head><body>
            <div style="margin-bottom:28px;border-bottom:3px solid #002F4C;padding-bottom:16px">
                <h1 style="font-size:22px;font-weight:900;color:#002F4C;margin:0">Organisation KPI Report</h1>
                <p style="color:#64748b;margin:4px 0 0;font-size:13px">Year: ${year} &nbsp;·&nbsp; Generated: ${new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })}</p>
            </div>
            <div style="display:flex;gap:12px;margin-bottom:28px">${kpiCards}</div>
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
                <div style="background:#f8fafc;padding:12px 14px;border-bottom:2px solid #e2e8f0">
                    <strong style="font-size:12px;text-transform:uppercase;color:#64748b;letter-spacing:.05em">Project Breakdown — ${year}</strong>
                </div>
                <table style="width:100%;border-collapse:collapse">
                    <thead><tr style="background:#f8fafc">
                        <th style="padding:10px 14px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;border-bottom:1px solid #e2e8f0">Project</th>
                        ${Projects.STANDARD_KPIS.map(k => `<th style="padding:10px 14px;text-align:right;font-size:11px;color:${k.color};text-transform:uppercase;border-bottom:1px solid #e2e8f0">${k.name}</th>`).join('')}
                    </tr></thead>
                    <tbody>${tableRows}</tbody>
                    <tfoot><tr style="background:#f8fafc;border-top:2px solid #e2e8f0">
                        <td style="padding:10px 14px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Total</td>
                        ${totCells}
                    </tr></tfoot>
                </table>
            </div>
            <script>document.title='READY';</script></body></html>`;

            const ipcRenderer = electronAPI;
            const savePath = await ipcRenderer.invoke('pick-save-path', `org_kpi_report_${year}.pdf`);
            if (!savePath) return;
            const result = await ipcRenderer.invoke('generate-pdf', { html, outputPath: savePath });
            if (result.success) App.showMsg('PDF report saved!');
            else alert('PDF export failed: ' + result.error);
        } catch (err) {
            console.error(err);
            alert('Export failed: ' + err.message);
        }
    },

    // Build Leaflet map HTML for embedding in PDF (rendered in hidden BrowserWindow)
    _buildPdfMapHtml(markers, options = {}) {
        const { center = [15, 20], zoom = 2, width = 860, height = 400 } = options;
        const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,"\\'").replace(/"/g,'&quot;');
        const markerJs = markers.map(m => {
            const lbl = m.label ? esc(m.label) : null;
            if (m.isHub) {
                return `L.marker([${m.lat},${m.lng}],{icon:L.divIcon({html:'<svg width="18" height="18" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="${m.color}" stroke="#fff" stroke-width="2"/><path d="M10 4.5l1.4 2.8 3.1.5-2.2 2.2.5 3.1L10 11.4 7.2 13.1l.5-3.1-2.2-2.2 3.1-.5z" fill="#fff"/></svg>',className:'',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(map)${lbl ? `.bindTooltip('${lbl}',{permanent:true,direction:'right',offset:[8,0],className:'lbl'})` : ''};`;
            } else if (m.isDiamond) {
                return `L.marker([${m.lat},${m.lng}],{icon:L.divIcon({html:'<div style="width:14px;height:14px;background:${m.color};transform:rotate(45deg);border-radius:2px;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>',className:'',iconSize:[14,14],iconAnchor:[7,7]})}).addTo(map)${lbl ? `.bindTooltip('${lbl}',{permanent:true,direction:'right',offset:[8,0],className:'lbl'})` : ''};`;
            } else {
                return `L.circleMarker([${m.lat},${m.lng}],{radius:5,fillColor:'#fff',color:'${m.color}',weight:2,fillOpacity:0.7}).addTo(map)${lbl ? `.bindTooltip('${lbl}',{permanent:true,direction:'right',offset:[6,0],className:'lbl'})` : ''};`;
            }
        }).join('\n');

        return `<!DOCTYPE html><html><head><meta charset="UTF-8">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
        <style>body{margin:0;padding:0}#map{width:${width}px;height:${height}px}.lbl{background:rgba(255,255,255,.9)!important;border:1px solid #e2e8f0!important;border-radius:4px!important;padding:1px 5px!important;font-size:10px!important;font-weight:600!important;color:#334155!important;box-shadow:0 1px 3px rgba(0,0,0,.1)!important;white-space:nowrap!important}.lbl::before{display:none!important}</style>
        </head><body><div id="map"></div>
        <script>
        var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([${center}],${zoom});
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{subdomains:'abcd',maxZoom:19}).addTo(map);
        ${markerJs}
        var bounds=L.latLngBounds([${markers.map(m=>`[${m.lat},${m.lng}]`).join(',')}]);
        if(bounds.isValid())map.fitBounds(bounds,{padding:[30,30],maxZoom:8});
        map.whenReady(function(){setTimeout(function(){document.title='READY'},3000)});
        <\/script></body></html>`;
    },

    async _capturePdfMap(markers, options = {}) {
        if (markers.length === 0) return null;
        const html = this._buildPdfMapHtml(markers, options);
        const tmpHtml = electronAPI.path.join(electronAPI.os.tmpdir(), `surgdash_map_${Date.now()}.pdf`);
        const result = await electronAPI.invoke('generate-pdf', { html, outputPath: tmpHtml });
        if (!result.success) return null;
        const buf = electronAPI.fs.readFileSync(tmpHtml);
        try { electronAPI.fs.unlinkSync(tmpHtml); } catch (_) {}
        return new Uint8Array(buf);
    },

    async _exportAllProjectsPdf() {
        try {
            const genericProjects = Projects.registry.filter(p => p.type === 'generic' && !p.isSample);
            if (genericProjects.length === 0) { App.showMsg('No projects to export.', true); return; }

            const savePath = await electronAPI.invoke('pick-save-path', 'All_Projects_Report.pdf');
            if (!savePath) return;

            App.showMsg('Generating combined report — this may take a moment...');
            const year = new Date().getFullYear();
            const fmt = v => new Intl.NumberFormat('en-US').format(v);
            const pdfBuffers = [];

            // Load all project data upfront
            const allData = await Promise.all(genericProjects.map(async project => {
                const [events, updates, allTargets, allActuals, facilities] = await Promise.all([
                    Projects.getEvents(project.id),
                    Projects.getUpdates(project.id),
                    Projects.getTargets(project.id),
                    Projects.getActuals(project.id),
                    Projects.getFacilities(project.id)
                ]);
                return { project, events, updates, allTargets, allActuals, facilities };
            }));

            // ── Page 1: Organisation Overview ──
            const orgKpiRows = Projects.STANDARD_KPIS.map(kpi => {
                let totalVal = 0, totalTgt = 0;
                allData.forEach(d => {
                    totalVal += (Projects.getActualsForYear(d.allActuals, year)[kpi.id] || 0);
                    totalTgt += (Projects.getTargetsForYear(d.allTargets, year)[kpi.id] || 0);
                });
                const pct = totalTgt ? Math.round((totalVal / totalTgt) * 100) : null;
                return `<tr>
                    <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">${kpi.name}</td>
                    <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${fmt(totalVal)} ${kpi.unit}</td>
                    <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${totalTgt ? fmt(totalTgt) : '\u2014'}</td>
                    <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${pct !== null ? pct + '%' : '\u2014'}</td>
                </tr>`;
            }).join('');

            const projSummaryRows = allData.map(d => {
                const a = Projects.getActualsForYear(d.allActuals, year);
                return `<tr><td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;font-weight:600"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${d.project.color||'#4389C8'};margin-right:6px;vertical-align:middle"></span>${d.project.name}</td>${Projects.STANDARD_KPIS.map(k => `<td style="padding:6px 12px;text-align:right;border-bottom:1px solid #f1f5f9">${fmt(a[k.id]||0)}</td>`).join('')}</tr>`;
            }).join('');

            // Org-level KPI cards for page 1 (gradient + accent stripe matching the app)
            const orgKpiCards = Projects.STANDARD_KPIS.map(kpi => {
                let totalVal = 0, totalTgt = 0;
                allData.forEach(d => {
                    totalVal += (Projects.getActualsForYear(d.allActuals, year)[kpi.id] || 0);
                    totalTgt += (Projects.getTargetsForYear(d.allTargets, year)[kpi.id] || 0);
                });
                const pct = totalTgt > 0 ? Math.min(100, Math.round(totalVal / totalTgt * 100)) : null;
                return `<div class="kpi-card" style="background:linear-gradient(135deg,${kpi.color}14,#ffffff 65%);border-color:${kpi.color}33">
                    <div class="accent" style="background:${kpi.color}"></div>
                    <p class="ttl" style="color:${kpi.color}">${kpi.nameBig || kpi.name}</p>
                    <p class="sub">${kpi.nameSub || ''}</p>
                    <div style="display:flex;align-items:baseline;gap:6px">
                        <span class="num" style="color:${kpi.color}">${fmt(totalVal)}</span>
                        <span style="font-size:9px;color:${kpi.color};opacity:.55">in ${year}</span>
                    </div>
                    <p class="unit">${kpi.unit}</p>
                    ${pct !== null ? `<div class="bar-wrap"><div class="bar-bg" style="background:${kpi.color}1A"><div class="bar-fg" style="width:${pct}%;background:${kpi.color}"></div></div><span class="pct" style="color:${kpi.color}">${pct}%</span></div>
                        <p class="tgt">Target: <strong style="color:#334155">${fmt(totalTgt)}</strong></p>` :
                        `<p class="tgt" style="font-style:italic">No target set</p>`}
                </div>`;
            }).join('');

            const page1Inner = `
                <div class="title-block">
                    <h1>Organisation Report</h1>
                    <p class="subtitle"><strong>${genericProjects.length} projects</strong> \u00b7 Year ${year} \u00b7 Generated ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}</p>
                </div>
                <h2 class="section">Programme-wide KPIs</h2>
                <div class="kpi-grid">${orgKpiCards}</div>
                <h2 class="section">Project Breakdown</h2>
                <table class="kpi-table">
                    <thead><tr>
                        <th>Project</th>
                        ${Projects.STANDARD_KPIS.map(k => `<th style="text-align:right;color:${k.color}">${k.nameBig || k.name}</th>`).join('')}
                    </tr></thead>
                    <tbody>${allData.map(d => {
                        const a = Projects.getActualsForYear(d.allActuals, year);
                        return `<tr>
                            <td class="label"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${d.project.color || '#4389C8'};margin-right:5px;vertical-align:middle"></span>${App.escapeHtml(d.project.shortName || d.project.name)}</td>
                            ${Projects.STANDARD_KPIS.map(k => `<td style="text-align:right">${fmt(a[k.id] || 0)}</td>`).join('')}
                        </tr>`;
                    }).join('')}</tbody>
                </table>
                <p class="pdf-footnote">Source: SURGdash \u00b7 The Global Surgery Foundation</p>`;

            const overviewHtml = this._brandedPdfShell({
                title: 'GSF Organisation Report',
                year,
                page1Inner,
                additionalPages: []
            });

            let tmpPath = electronAPI.path.join(electronAPI.os.tmpdir(), `surgdash_report_overview_${Date.now()}.pdf`);
            let result = await electronAPI.invoke('generate-pdf', { html: overviewHtml, outputPath: tmpPath });
            if (result.success) {
                pdfBuffers.push(new Uint8Array(electronAPI.fs.readFileSync(tmpPath)));
                try { electronAPI.fs.unlinkSync(tmpPath); } catch (_) {}
            }

            // ── Page 1b: Organisation Map ──
            const orgMapMarkers = [];
            allData.forEach(d => {
                const loc = d.project.locations && d.project.locations[0];
                if (loc && loc.lat && loc.lng) {
                    orgMapMarkers.push({ lat: loc.lat, lng: loc.lng, color: d.project.color || '#4389C8', isDiamond: true, label: d.project.shortName || d.project.name });
                }
                (d.facilities || []).forEach(f => {
                    if (f.lat != null && f.lng != null && !isNaN(f.lat) && !isNaN(f.lng)) {
                        orgMapMarkers.push({ lat: f.lat, lng: f.lng, color: d.project.color || '#4389C8', isHub: !!f.isHub, label: f.name });
                    }
                });
            });
            if (orgMapMarkers.length > 0) {
                const mapPdf = await this._capturePdfMap(orgMapMarkers);
                if (mapPdf) pdfBuffers.push(mapPdf);
            }

            // ── Per-project pages ──
            for (const d of allData) {
                const { project, events, updates, allTargets, allActuals, facilities } = d;
                const yearTotals = Projects.getActualsForYear(allActuals, year);
                const targets = Projects.getTargetsForYear(allTargets, year);

                // Per-project KPI cards matching the branded shell
                const projKpiCards = Projects.STANDARD_KPIS.map(kpi => {
                    const v = yearTotals[kpi.id] || 0;
                    const g = targets[kpi.id] || 0;
                    const pct = g > 0 ? Math.min(100, Math.round(v / g * 100)) : null;
                    return `<div class="kpi-card" style="background:linear-gradient(135deg,${kpi.color}14,#ffffff 65%);border-color:${kpi.color}33">
                        <div class="accent" style="background:${kpi.color}"></div>
                        <p class="ttl" style="color:${kpi.color}">${kpi.nameBig || kpi.name}</p>
                        <p class="sub">${kpi.nameSub || ''}</p>
                        <div style="display:flex;align-items:baseline;gap:6px"><span class="num" style="color:${kpi.color}">${fmt(v)}</span><span style="font-size:9px;color:${kpi.color};opacity:.55">in ${year}</span></div>
                        <p class="unit">${kpi.unit}</p>
                        ${pct !== null ? `<div class="bar-wrap"><div class="bar-bg" style="background:${kpi.color}1A"><div class="bar-fg" style="width:${pct}%;background:${kpi.color}"></div></div><span class="pct" style="color:${kpi.color}">${pct}%</span></div><p class="tgt">Target: <strong style="color:#334155">${fmt(g)}</strong></p>` : `<p class="tgt" style="font-style:italic">No target set</p>`}
                    </div>`;
                }).join('');

                const eventEntries = events.slice(0, 10).map(e => {
                    const et = Projects.EVENT_TYPES[e.type] || {};
                    const details = [];
                    if (e.hcw_count)        details.push(`${fmt(e.hcw_count)} HCWs${e.hcw_new_count ? ` (${fmt(e.hcw_new_count)} new)` : ''}`);
                    if (e.facilities_count) details.push(`${e.facilities_count} facilit${e.facilities_count === 1 ? 'y' : 'ies'}`);
                    return `<div class="entry">
                        <div class="date">${e.date || ''}</div>
                        <div>
                            <p class="title">${App.escapeHtml(e.title || '')}</p>
                            <p class="meta">${App.escapeHtml(et.label || e.type || '\u2014')}${details.length ? ' \u00b7 ' + details.join(' \u00b7 ') : ''}</p>
                        </div>
                    </div>`;
                }).join('');

                const updateEntries = updates.slice(0, 5).map(u => `<div class="entry">
                    <div class="date">${u.date || ''}</div>
                    <div>
                        <p class="title">${App.escapeHtml(u.title || '')}</p>
                        ${u.body ? `<p class="body">${App.escapeHtml(u.body)}</p>` : ''}
                    </div>
                </div>`).join('');

                const projPage1 = `
                    <div class="title-block" style="border-bottom-color:${project.color || '#002F4C'}">
                        <h1 style="color:${project.color || '#002F4C'}">${App.escapeHtml(project.name)}</h1>
                        <p class="subtitle">Year ${year} \u00b7 Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                    </div>
                    ${project.description ? `<p style="font-size:11px;color:#475569;margin:0 0 14px;line-height:1.5">${App.escapeHtml(project.description)}</p>` : ''}
                    <h2 class="section">Key Performance Indicators</h2>
                    <div class="kpi-grid">${projKpiCards}</div>
                    ${eventEntries ? `<h2 class="section">Recent Activities</h2>${eventEntries}` : ''}
                    ${updateEntries ? `<h2 class="section">Narrative Updates</h2>${updateEntries}` : ''}
                    <p class="pdf-footnote">Source: SURGdash \u00b7 The Global Surgery Foundation</p>`;

                const html = this._brandedPdfShell({
                    title: `${project.shortName || project.name} \u00b7 SURGdash Report`,
                    year,
                    page1Inner: projPage1,
                    additionalPages: []
                });

                tmpPath = electronAPI.path.join(electronAPI.os.tmpdir(), `surgdash_report_${project.id}_${Date.now()}.pdf`);
                result = await electronAPI.invoke('generate-pdf', { html, outputPath: tmpPath });
                if (result.success) {
                    pdfBuffers.push(new Uint8Array(electronAPI.fs.readFileSync(tmpPath)));
                    try { electronAPI.fs.unlinkSync(tmpPath); } catch (_) {}
                }

                // ── Per-project map page ──
                const projMarkers = [];
                const loc = project.locations && project.locations[0];
                if (loc && loc.lat && loc.lng) {
                    projMarkers.push({ lat: loc.lat, lng: loc.lng, color: project.color || '#4389C8', isDiamond: true, label: project.shortName || project.name });
                }
                (facilities || []).forEach(f => {
                    if (f.lat != null && f.lng != null && !isNaN(parseFloat(f.lat)) && !isNaN(parseFloat(f.lng))) {
                        projMarkers.push({ lat: parseFloat(f.lat), lng: parseFloat(f.lng), color: project.color || '#4389C8', isHub: !!f.isHub, label: f.name });
                    }
                });
                if (projMarkers.length > 0) {
                    const mapPdf = await this._capturePdfMap(projMarkers);
                    if (mapPdf) pdfBuffers.push(mapPdf);
                }
            }

            if (pdfBuffers.length === 0) { App.showMsg('No PDFs generated.', true); return; }

            // Merge all PDFs using pdf-lib
            const { PDFDocument } = PDFLib;
            const merged = await PDFDocument.create();
            for (const buf of pdfBuffers) {
                const doc = await PDFDocument.load(buf);
                const pages = await merged.copyPages(doc, doc.getPageIndices());
                pages.forEach(p => merged.addPage(p));
            }
            const mergedBytes = await merged.save();
            electronAPI.fs.writeFileSync(savePath, mergedBytes);
            App.showMsg(`Combined PDF saved (${genericProjects.length} projects).`);
        } catch (err) {
            console.error('All-projects PDF error:', err);
            App.showMsg('Export failed: ' + err.message, true);
        }
    },

    // ===== IMPORT submission JSON from a colleague =====
    async _importSubmissionFile(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const submission = JSON.parse(text);
            // Intake form → new project (separate path from update submissions)
            if (submission._type === 'surgdash_intake') {
                await this._importIntakeSubmission(submission);
                event.target.value = '';
                return;
            }
            if (submission._type !== 'surgdash_submission') {
                throw new Error('Not a SURGdash submission file. Expected _type = "surgdash_submission" or "surgdash_intake".');
            }
            const project = Projects.getProject(submission.projectId);
            if (!project) {
                throw new Error('Project not found: ' + submission.projectId + '. The submission references a project that no longer exists or wasn\'t imported into this app.');
            }
            await Projects.addPendingSubmission(submission);
            App.showMsg('Submission imported ✓ — review in Submissions queue.');
            event.target.value = '';
            App.renderView();
            App.navigate('pending-submissions');
        } catch (e) {
            console.error(e);
            alert('Could not import submission:\n\n' + (e.message || e));
            event.target.value = '';
        }
    },

    // Import an intake form. Shows a confirm dialog, then creates a new project with
    // the supplied metadata + impact assumptions. Avoids the pending-submissions queue
    // because creating a project is a single atomic action.
    async _importIntakeSubmission(submission) {
        const data = submission.data || {};
        const submitter = submission.submitter || {};
        const summary = [
            `New project intake from: ${submitter.name || '(unnamed submitter)'}`,
            `Project name: ${data.name || '(missing)'}`,
            data.description ? `Description: ${data.description.slice(0, 80)}…` : null,
            data.startDate ? `Start: ${data.startDate}` : null,
            data.endDate   ? `End: ${data.endDate}` : null,
        ].filter(Boolean).join('\n');
        if (!confirm(`Create new project?\n\n${summary}\n\nClick OK to add the project, Cancel to abort.`)) return;

        // Build the project record
        const newProject = {
            name:        data.name || 'Untitled project',
            shortName:   data.shortName || null,
            description: data.description || '',
            color:       data.color || '#4389C8',
            icon:        data.icon || 'folder',
            currency:    data.currency || 'USD',
            startDate:   data.startDate || null,
            endDate:     data.endDate || null,
            linkGsf:     data.linkGsf || '',
            linkFolder:  data.linkFolder || '',
            linksExtra:  Array.isArray(data.linksExtra) ? data.linksExtra : [],
            locations:   Array.isArray(data.locations) ? data.locations : [],
            enabledQualityKpis: Array.isArray(data.enabledQualityKpis) ? data.enabledQualityKpis : [],
            qualityBaselines: data.qualityBaselines || {},
            qualityTargets:   data.qualityTargets   || {},
            impactAssumptions: data.impactAssumptions || {},
        };
        try {
            const created = await Projects.createProject(newProject);
            App.showMsg(`Project "${newProject.name}" created ✓`);
            if (created && created.id) {
                App.currentProject = created.id;
                App.navigate('project-dashboard');
            } else {
                App.renderView();
            }
        } catch (e) {
            console.error(e);
            alert('Could not create the project:\n\n' + (e.message || e));
        }
    },

    async _exportIntakeForm() {
        // Snapshot of what we need on the form so the colleague sees current quality KPI options.
        const allQualityKpis = await Projects.getAllQualityKpis();
        const snapshot = {
            _type: 'surgdash_intake_form',
            _version: 1,
            generatedAt: new Date().toISOString(),
            qualityKpis: allQualityKpis.map(k => ({
                id: k.id, name: k.name, shortName: k.shortName, unit: k.unit,
                color: k.color, lowerIsBetter: !!k.lowerIsBetter
            })),
            iconChoices: ['folder', 'stethoscope', 'heart', 'globe', 'building-2', 'graduation-cap', 'baby', 'shield-check', 'briefcase-medical', 'cross', 'sparkles', 'target', 'flag'],
            colorChoices: ['#4389C8', '#D03734', '#10B981', '#E28743', '#8B5CF6', '#F59E0B', '#EC4899', '#059669', '#0EA5E9', '#7C3AED'],
        };

        const html = this._buildIntakeFormHtml(snapshot);
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `surgdash-intake-form-${new Date().toISOString().slice(0,10)}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        App.showMsg('Intake form downloaded ✓ — send to your colleague.');
    },

    _buildIntakeFormHtml(snapshot) {
        const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const SNAP_JSON = JSON.stringify(snapshot);

        const qualityRows = snapshot.qualityKpis.map(k => `
            <div class="qkpi-row" data-kpi="${esc(k.id)}" data-lower="${k.lowerIsBetter ? '1' : '0'}">
                <label class="qkpi-toggle">
                    <input type="checkbox" data-q-enable="${esc(k.id)}" />
                    <span class="qkpi-name" style="border-left:3px solid ${esc(k.color)}">
                        <strong>${esc(k.shortName)}</strong>
                        <span class="qkpi-sub">${esc(k.name)} · ${esc(k.unit)}${k.lowerIsBetter ? ' · lower is better' : ''}</span>
                    </span>
                </label>
                <div class="qkpi-values" data-q-values="${esc(k.id)}" hidden>
                    <div class="qkpi-field">
                        <label>Baseline</label>
                        <input type="number" step="any" data-q-base="${esc(k.id)}" placeholder="—" />
                    </div>
                    <div class="qkpi-field">
                        <label>Target (value)</label>
                        <input type="number" step="any" data-q-tgt-abs="${esc(k.id)}" placeholder="value" />
                    </div>
                    <div class="qkpi-field">
                        <label>Target (% improvement)</label>
                        <input type="number" step="any" data-q-tgt-pct="${esc(k.id)}" placeholder="%" />
                    </div>
                </div>
            </div>`).join('');

        const colorChips = snapshot.colorChoices.map((c, i) =>
            `<label class="color-chip"><input type="radio" name="proj-color" value="${esc(c)}" ${i === 0 ? 'checked' : ''} /><span style="background:${esc(c)}"></span></label>`
        ).join('');

        return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SURGdash — New Project Intake Form</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
* { box-sizing: border-box; font-family: 'Inter', sans-serif; }
body { margin: 0; background: linear-gradient(180deg, #f1f5f9 0%, #f8fafc 240px); color: #0f172a; line-height: 1.5; }
.wrap { max-width: 920px; margin: 0 auto; padding: 32px 24px 120px; }
header { padding-bottom: 20px; border-bottom: 3px solid #002F4C; margin-bottom: 24px; }
header h1 { margin: 0 0 4px; font-size: 24px; font-weight: 900; color: #002F4C; }
header p { margin: 0; font-size: 13px; color: #64748b; }
.intro { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 14px 18px; margin-bottom: 24px; font-size: 13px; color: #1e3a8a; }
.intro ol { margin: 8px 0 0; padding-left: 20px; }
.intro li { margin-bottom: 4px; }
.section { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px 22px; margin-bottom: 18px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
.section h2 { margin: 0 0 4px; font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: .08em; display:flex; align-items:center; gap:8px; }
.section .sub { margin: 0 0 14px; font-size: 12px; color: #64748b; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.full { grid-column: 1 / -1; }
label.field { display: block; }
label.field > span { display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .04em; }
label.field .req { color: #dc2626; }
input[type=text], input[type=number], input[type=date], textarea, select {
    width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 8px;
    font-size: 13px; outline: none; transition: border-color .15s, box-shadow .15s; background: #fff;
}
input:focus, textarea:focus, select:focus { border-color: #4389C8; box-shadow: 0 0 0 3px rgba(67,137,200,0.15); }
textarea { resize: vertical; min-height: 70px; font-family: inherit; }
.color-chips { display: flex; gap: 8px; flex-wrap: wrap; }
.color-chip { cursor: pointer; }
.color-chip input { display: none; }
.color-chip span { display: block; width: 26px; height: 26px; border-radius: 50%; border: 2px solid transparent; transition: border .15s, transform .15s; }
.color-chip input:checked + span { border-color: #0f172a; transform: scale(1.1); }
.qkpi-row { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; background: #fafbfc; }
.qkpi-toggle { display: flex; align-items: center; gap: 10px; cursor: pointer; }
.qkpi-toggle input { width: 16px; height: 16px; cursor: pointer; }
.qkpi-name { flex: 1; padding-left: 8px; font-size: 13px; color: #0f172a; }
.qkpi-name .qkpi-sub { display: block; font-size: 11px; font-weight: 400; color: #64748b; }
.qkpi-values { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #f1f5f9; }
.qkpi-field label { display: block; font-size: 10px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 3px; }
.qkpi-field input { padding: 6px 8px; font-size: 13px; }
.locations-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
.loc-row { display: grid; grid-template-columns: 2fr 1fr 1fr auto; gap: 6px; align-items: center; }
.loc-row input { padding: 6px 8px; font-size: 12px; }
.btn { padding: 9px 18px; background: #002F4C; color: #fff; font-weight: 700; font-size: 13px; border: none; border-radius: 8px; cursor: pointer; transition: background .15s; }
.btn:hover:not(:disabled) { background: #4389C8; }
.btn:disabled { background: #cbd5e1; cursor: not-allowed; }
.btn.secondary { background: #f1f5f9; color: #475569; }
.btn.secondary:hover { background: #e2e8f0; }
.btn.small { padding: 5px 10px; font-size: 11px; }
.footer-bar { position: fixed; bottom: 0; left: 0; right: 0; background: #fff; border-top: 1px solid #e2e8f0; padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; box-shadow: 0 -2px 8px rgba(0,0,0,0.04); z-index: 50; }
.dirty-count { font-size: 13px; color: #64748b; }
.req { color: #dc2626; }
.tip { font-size: 11px; color: #94a3b8; margin-top: 4px; font-style: italic; }
</style>
</head>
<body>
<div class="wrap">

<header>
    <h1>SURGdash — New Project Intake</h1>
    <p>Fill in the project details below, then click <strong>Export</strong>. Email the downloaded file to the SURGdash admin to create the project.</p>
</header>

<div class="intro">
    <strong>How this works:</strong>
    <ol>
        <li>Enter your contact details and the project information.</li>
        <li>Enable the quality indicators you'll track and supply baseline + target for each.</li>
        <li>Add the volumes the dashboard needs to estimate economic impact (annual surgical volume, live births, GDP/cap).</li>
        <li>Click <strong>Export</strong> at the bottom — a small JSON file will download.</li>
        <li>Email that file back to the SURGdash admin to create the project.</li>
    </ol>
</div>

<div class="section">
    <h2>Your details</h2>
    <p class="sub">So we know who submitted the intake.</p>
    <div class="grid">
        <label class="field"><span>Your name <span class="req">*</span></span><input type="text" id="submitter-name" placeholder="Jane Doe" required></label>
        <label class="field"><span>Email</span><input type="text" id="submitter-email" placeholder="jane@example.org"></label>
        <label class="field full"><span>Organisation / role</span><input type="text" id="submitter-org" placeholder="e.g. Country Lead, Sierra Leone"></label>
    </div>
</div>

<div class="section">
    <h2>Project identity</h2>
    <p class="sub">Name and a short description so colleagues recognise it on the dashboard.</p>
    <div class="grid">
        <label class="field"><span>Project name <span class="req">*</span></span><input type="text" id="proj-name" placeholder="e.g. Surgical Mentoring — Sierra Leone" required></label>
        <label class="field"><span>Short name <span style="color:#94a3b8;text-transform:none;font-weight:400">(optional)</span></span><input type="text" id="proj-short" placeholder="e.g. SLM"></label>
        <label class="field full"><span>Description</span><textarea id="proj-desc" placeholder="One or two sentences about the project's focus and goals."></textarea></label>
        <label class="field"><span>Start date</span><input type="date" id="proj-start"></label>
        <label class="field"><span>End date</span><input type="date" id="proj-end"></label>
        <label class="field"><span>Currency</span>
            <select id="proj-currency">
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="CHF">CHF</option>
                <option value="KES">KES (Kenyan Shilling)</option>
                <option value="SLE">SLE (Sierra Leone)</option>
                <option value="INR">INR (Indian Rupee)</option>
                <option value="ETB">ETB (Ethiopian Birr)</option>
                <option value="RWF">RWF (Rwandan Franc)</option>
            </select>
        </label>
        <label class="field">
            <span>Project colour</span>
            <div class="color-chips" id="color-chips">${colorChips}</div>
        </label>
    </div>
</div>

<div class="section">
    <h2>Locations</h2>
    <p class="sub">Cities or facilities for the project. Latitude and longitude are optional but enable the map view.</p>
    <div class="locations-list" id="locations-list">
        <div class="loc-row">
            <input type="text" data-loc-name placeholder="Location name (e.g. Freetown)">
            <input type="number" step="any" data-loc-lat placeholder="Latitude">
            <input type="number" step="any" data-loc-lng placeholder="Longitude">
            <button class="btn secondary small" onclick="addLocRow()">+</button>
        </div>
    </div>
    <p class="tip">Add more rows with the + button. Lookup coords with Google Maps right-click → coordinates.</p>
</div>

<div class="section">
    <h2>Links</h2>
    <p class="sub">Optional. Useful so colleagues can jump straight to the project's external resources.</p>
    <div class="grid">
        <label class="field full"><span>GSF page URL</span><input type="text" id="proj-link-gsf" placeholder="https://globalsurgeryfoundation.org/…"></label>
        <label class="field full"><span>Drive / SharePoint folder</span><input type="text" id="proj-link-folder" placeholder="https://…"></label>
    </div>
</div>

<div class="section">
    <h2>Quality indicators</h2>
    <p class="sub">Tick each indicator you'll track on this project, then enter its baseline (pre-intervention value) and your end-of-project target. Either type the absolute target or the % improvement — the other field auto-fills.</p>
    <div id="quality-list">${qualityRows}</div>
</div>

<div class="section">
    <h2>Impact volumes</h2>
    <p class="sub">Drive the dashboard's economic-impact estimates (deaths averted, DALYs, cost-per-DALY).</p>
    <div class="grid">
        <label class="field"><span>Annual surgical volume</span><input type="number" min="0" id="ia-vol" placeholder="e.g. 5000"></label>
        <label class="field"><span>Annual live births</span><input type="number" min="0" id="ia-births" placeholder="e.g. 3500"></label>
        <label class="field full"><span>GDP per capita (USD)</span><input type="number" min="0" id="ia-gdp" placeholder="e.g. 1500">
            <p class="tip">Common references: Sierra Leone ≈ 530 · Rwanda ≈ 1,000 · Ethiopia ≈ 1,200 · Kenya ≈ 2,100 · India ≈ 2,500.</p>
        </label>
    </div>
</div>

<div class="section">
    <h2>Notes</h2>
    <p class="sub">Anything else the admin should know about this project.</p>
    <textarea id="proj-notes" placeholder="Optional notes for the admin…"></textarea>
</div>

</div>

<div class="footer-bar">
    <span class="dirty-count" id="dirty-count">Ready to export</span>
    <div style="display:flex;gap:10px">
        <button class="btn secondary" onclick="clearForm()">Reset</button>
        <button class="btn" id="export-btn" onclick="exportIntake()">Export</button>
    </div>
</div>

<script>
const SNAPSHOT = ${SNAP_JSON};

function $(s, r) { return (r||document).querySelector(s); }
function $$(s, r) { return Array.from((r||document).querySelectorAll(s)); }

// Toggle quality KPI value rows on enable
$$('[data-q-enable]').forEach(cb => {
    cb.addEventListener('change', () => {
        const id = cb.dataset.qEnable;
        const block = $('[data-q-values="' + id + '"]');
        if (block) block.hidden = !cb.checked;
        updateDirtyCount();
    });
});

// Auto-link value ↔ % for each KPI (positive % = improvement direction)
$$('[data-q-base]').forEach(b => b.addEventListener('input', () => recomputePct(b.dataset.qBase)));
$$('[data-q-tgt-abs]').forEach(a => a.addEventListener('input', () => syncFromAbs(a.dataset.qTgtAbs)));
$$('[data-q-tgt-pct]').forEach(p => p.addEventListener('input', () => syncFromPct(p.dataset.qTgtPct)));

function recomputePct(kpiId) {
    const abs = $('[data-q-tgt-abs="' + kpiId + '"]');
    if (abs && abs.value !== '') syncFromAbs(kpiId);
}
function syncFromAbs(kpiId) {
    const row = $('[data-kpi="' + kpiId + '"]');
    const lower = row && row.dataset.lower === '1';
    const b = parseFloat($('[data-q-base="' + kpiId + '"]').value);
    const v = parseFloat($('[data-q-tgt-abs="' + kpiId + '"]').value);
    const pct = $('[data-q-tgt-pct="' + kpiId + '"]');
    if (!pct) return;
    if (isNaN(b) || b === 0 || isNaN(v)) { pct.value = ''; return; }
    const raw = ((b - v) / b) * 100;
    pct.value = Math.round(lower ? raw : -raw);
}
function syncFromPct(kpiId) {
    const row = $('[data-kpi="' + kpiId + '"]');
    const lower = row && row.dataset.lower === '1';
    const b = parseFloat($('[data-q-base="' + kpiId + '"]').value);
    const p = parseFloat($('[data-q-tgt-pct="' + kpiId + '"]').value);
    const abs = $('[data-q-tgt-abs="' + kpiId + '"]');
    if (!abs) return;
    if (isNaN(b) || b === 0 || isNaN(p)) return;
    const signed = lower ? p : -p;
    abs.value = Math.round((b - (signed / 100) * b) * 100) / 100;
}

function addLocRow() {
    const list = $('#locations-list');
    const row = document.createElement('div');
    row.className = 'loc-row';
    row.innerHTML = '<input type="text" data-loc-name placeholder="Location name">' +
                    '<input type="number" step="any" data-loc-lat placeholder="Latitude">' +
                    '<input type="number" step="any" data-loc-lng placeholder="Longitude">' +
                    '<button class="btn secondary small" onclick="this.parentElement.remove();updateDirtyCount();">×</button>';
    list.appendChild(row);
    updateDirtyCount();
}

function clearForm() {
    if (!confirm('Reset all fields?')) return;
    $$('input, textarea, select').forEach(el => {
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = (el.name === 'proj-color' && el.value === SNAPSHOT.colorChoices[0]);
        else el.value = '';
    });
    $$('[data-q-values]').forEach(el => el.hidden = true);
    updateDirtyCount();
}

function updateDirtyCount() {
    const filled = $$('input, textarea').filter(el => {
        if (el.type === 'checkbox' || el.type === 'radio') return el.checked && el.value;
        return (el.value || '').trim() !== '';
    }).length;
    $('#dirty-count').textContent = filled > 0 ? filled + ' field' + (filled !== 1 ? 's' : '') + ' filled' : 'Ready to export';
}
document.addEventListener('input', updateDirtyCount);
document.addEventListener('change', updateDirtyCount);

function exportIntake() {
    const name = $('#proj-name').value.trim();
    const submitter = $('#submitter-name').value.trim();
    if (!name) { alert('Please enter a project name.'); return; }
    if (!submitter) { alert('Please enter your name.'); return; }

    const num = v => { v = (v || '').trim(); if (v === '') return null; const n = parseFloat(v); return isNaN(n) ? null : n; };
    const text = id => ($(id).value || '').trim() || null;
    const colorEl = $$('[name="proj-color"]').find(r => r.checked);

    // Locations
    const locations = $$('.loc-row').map(r => ({
        name: ($('[data-loc-name]', r).value || '').trim(),
        lat: num($('[data-loc-lat]', r).value),
        lng: num($('[data-loc-lng]', r).value),
    })).filter(l => l.name);

    // Quality indicators
    const enabledQualityKpis = [];
    const qualityBaselines = {};
    const qualityTargets   = {};
    $$('[data-q-enable]').forEach(cb => {
        if (!cb.checked) return;
        const id = cb.dataset.qEnable;
        enabledQualityKpis.push(id);
        const b = num($('[data-q-base="' + id + '"]').value);
        const t = num($('[data-q-tgt-abs="' + id + '"]').value);
        if (b !== null) qualityBaselines[id] = b;
        if (t !== null) qualityTargets[id]   = t;
    });

    const payload = {
        _type: 'surgdash_intake',
        _version: 1,
        generatedAt: SNAPSHOT.generatedAt,
        submittedAt: new Date().toISOString(),
        submitter: {
            name:  submitter,
            email: text('#submitter-email'),
            org:   text('#submitter-org'),
        },
        notes: text('#proj-notes'),
        data: {
            name,
            shortName: text('#proj-short'),
            description: text('#proj-desc'),
            color: colorEl ? colorEl.value : SNAPSHOT.colorChoices[0],
            icon: 'folder',
            currency: $('#proj-currency').value,
            startDate: text('#proj-start'),
            endDate:   text('#proj-end'),
            linkGsf:   text('#proj-link-gsf') || '',
            linkFolder: text('#proj-link-folder') || '',
            linksExtra: [],
            locations,
            enabledQualityKpis,
            qualityBaselines,
            qualityTargets,
            impactAssumptions: {
                annualSurgicalVolume: num($('#ia-vol').value),
                annualLiveBirths:     num($('#ia-births').value),
                gdpPerCapita:         num($('#ia-gdp').value),
            },
        },
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';
    a.href = url;
    a.download = 'surgdash-intake-' + safe + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    alert('Saved ' + a.download + '\\n\\nEmail this file to the SURGdash admin.');
}
</script>
</body></html>`;
    },

    // ===== PENDING SUBMISSIONS REVIEW QUEUE =====
    async renderPendingSubmissions(main) {
        const list = await Projects.getPendingSubmissions();
        const pending = list.filter(s => s.status === 'pending');
        const resolved = list.filter(s => s.status !== 'pending').slice(0, 20); // last 20

        const renderChange = (subId, change, idx, applied) => {
            const fmtV = (v) => v === null || v === undefined ? '<em style="color:#cbd5e1">empty</em>' : v;
            const changedAfter = applied || change.status === 'applied';
            const rejected = change.status === 'rejected';
            const bgClass = changedAfter ? 'bg-emerald-50' : rejected ? 'bg-slate-50 opacity-60' : 'bg-white';
            const actionsHtml = changedAfter
                ? '<span class="text-[10px] font-bold uppercase text-emerald-700 shrink-0">✓ Applied</span>'
                : rejected ? '<span class="text-[10px] font-bold uppercase text-slate-400 shrink-0">Rejected</span>'
                : `<div class="flex gap-1 shrink-0">
                    <button onclick="GenericViews._approveChange('${subId}', ${idx})" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded">Approve</button>
                    <button onclick="GenericViews._rejectChange('${subId}', ${idx})" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-bold rounded">Reject</button>
                </div>`;

            // Event-type changes get a richer card layout (date, title, type pill, facility count)
            if (change.type === 'event') {
                const ev = change.event || {};
                const typeColor = ev.type === 'workshop' ? '#4389C8' : ev.type === 'mentoring' ? '#8B5CF6' : '#64748b';
                const typeLabel = ev.type === 'workshop' ? 'Training' : ev.type === 'mentoring' ? 'Mentoring' : 'Other';
                return `<div class="flex items-start gap-3 py-3 px-3 ${bgClass} border-b last:border-b-0">
                    <div class="w-2 h-12 rounded-sm shrink-0" style="background:${typeColor}"></div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap mb-1">
                            <span class="text-[10px] font-bold uppercase tracking-wide text-slate-500">New activity</span>
                            <span class="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style="background:${typeColor}15;color:${typeColor}">${typeLabel}</span>
                            <span class="text-xs text-slate-400">${App.escapeHtml(this._fmtEventDate(ev))}</span>
                        </div>
                        <p class="text-sm font-bold text-gsf-prussian">${App.escapeHtml(ev.title || '(no title)')}</p>
                        <p class="text-xs text-slate-600 mt-1">
                            ${ev.hcw_count ? `<strong>${ev.hcw_count}</strong> HCW${ev.hcw_new_count ? ` (${ev.hcw_new_count} new)` : ''}` : ''}
                            ${ev.patient_count ? ` · <strong>${ev.patient_count}</strong> patients` : ''}
                            ${ev.facility_ids && ev.facility_ids.length ? ` · ${ev.facility_ids.length} facilit${ev.facility_ids.length === 1 ? 'y' : 'ies'}` : ''}
                            ${ev.facility_other ? ' · + other facility' : ''}
                        </p>
                        ${ev.notes ? `<p class="text-xs text-slate-500 mt-1 italic">"${App.escapeHtml(ev.notes)}"</p>` : ''}
                    </div>
                    ${actionsHtml}
                </div>`;
            }

            // Cell-change layout (kpi / quality / budget / baseline / kpiComment)
            let label;
            if (change.type === 'kpi') {
                const kpi = Projects.STANDARD_KPIS.find(k => k.id === change.kpiId);
                const q = change.quarter ? ` Q${change.quarter}` : '';
                label = `<strong>${kpi ? (kpi.nameBig || kpi.name) : change.kpiId}</strong> · ${change.year}${q} · ${change.field}`;
            } else if (change.type === 'kpiComment') {
                const kpi = Projects.STANDARD_KPIS.find(k => k.id === change.kpiId);
                label = `<strong>Note: ${kpi ? (kpi.nameBig || kpi.name) : change.kpiId}</strong> · ${change.year} Q${change.quarter}`;
            } else if (change.type === 'baseline') {
                label = `<strong>Baseline: ${change.kpiId}</strong>`;
            } else if (change.type === 'quality') {
                label = `<strong>Quality: ${change.kpiId}</strong> · ${change.year} Q${change.quarter} · ${change.field}`;
            } else if (change.type === 'budget') {
                label = `<strong>Budget</strong> · ${change.year} · ${change.field}`;
            } else {
                label = change.type;
            }
            return `<div class="flex items-center gap-3 py-2 px-3 ${bgClass} border-b last:border-b-0">
                <div class="flex-1 min-w-0">
                    <p class="text-xs text-slate-600">${label}</p>
                    <p class="text-sm font-mono mt-0.5">
                        <span class="text-slate-400">${fmtV(change.old)}</span>
                        <span class="mx-2 text-slate-300">→</span>
                        <span class="font-bold text-gsf-prussian">${fmtV(change.new)}</span>
                    </p>
                </div>
                ${actionsHtml}
            </div>`;
        };

        const renderSubmission = (s, locked) => {
            const proj = Projects.getProject(s.projectId);
            const projColor = proj ? proj.color : '#64748b';
            const projName = proj ? proj.name : s.projectName + ' (project not found)';
            const dt = new Date(s.submittedAt);
            const recv = new Date(s.receivedAt);
            const changes = s.changes || [];
            const counts = changes.reduce((a, c) => { a[c.status || 'pending'] = (a[c.status || 'pending'] || 0) + 1; return a; }, {});
            return `
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-4">
                <div class="flex items-start justify-between gap-3 mb-4 flex-wrap">
                    <div class="flex items-start gap-3 min-w-0 flex-1">
                        <div class="w-3 h-12 rounded-sm shrink-0" style="background:${projColor}"></div>
                        <div class="min-w-0">
                            <h3 class="text-base font-bold text-gsf-prussian truncate">${App.escapeHtml(projName)}</h3>
                            <p class="text-xs text-slate-500 mt-0.5">
                                Submitted by <strong>${App.escapeHtml(s.submitter || 'Unknown')}</strong>${s.submitterEmail ? ' &lt;' + App.escapeHtml(s.submitterEmail) + '&gt;' : ''}
                                on ${dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · received ${recv.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </p>
                            ${s.message ? `<p class="text-xs text-slate-600 mt-1.5 italic bg-slate-50 border-l-2 border-slate-300 pl-2 py-1">"${App.escapeHtml(s.message)}"</p>` : ''}
                        </div>
                    </div>
                    ${!locked ? `<div class="flex gap-2 shrink-0">
                        <button onclick="GenericViews._approveAllChanges('${s.id}')" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg">Approve all</button>
                        <button onclick="GenericViews._dismissSubmission('${s.id}')" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-lg" title="Reject the whole submission and remove from queue">Dismiss</button>
                    </div>` : `<div class="flex items-center gap-2 shrink-0">
                        <span class="text-[10px] font-bold uppercase tracking-wide ${s.status === 'approved' ? 'text-emerald-700' : 'text-slate-400'}">${s.status}</span>
                        <button onclick="GenericViews._dismissSubmission('${s.id}')" class="text-[11px] text-slate-400 hover:text-red-500 underline" title="Remove from history">Remove</button>
                    </div>`}
                </div>

                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">${changes.length} change${changes.length === 1 ? '' : 's'}${counts.applied ? ' · ' + counts.applied + ' applied' : ''}${counts.rejected ? ' · ' + counts.rejected + ' rejected' : ''}</p>
                <div class="border rounded-lg overflow-hidden">
                    ${changes.length === 0
                        ? '<p class="text-sm text-slate-400 italic text-center py-4">No changes (empty submission)</p>'
                        : changes.map((c, i) => renderChange(s.id, c, i, c.status === 'applied')).join('')}
                </div>
            </div>`;
        };

        main.innerHTML = `
            <div class="p-6 md:p-10 fade-in w-full max-w-5xl mx-auto">
                <header class="mb-6 flex items-end justify-between gap-3 flex-wrap">
                    <div>
                        <h1 class="text-2xl font-bold text-gsf-prussian">Submissions Queue</h1>
                        <p class="text-sm text-slate-500 mt-1">Colleague-submitted data changes awaiting review. Each change can be approved or rejected individually.</p>
                    </div>
                    <button onclick="document.getElementById('submission-file-input').click()" class="flex items-center gap-2 px-4 py-2 bg-gsf-boston text-white text-sm font-bold rounded-lg hover:bg-gsf-prussian">
                        <i data-lucide="upload" width="14"></i> Import submission file
                    </button>
                    <input id="submission-file-input" type="file" accept=".json" class="hidden" onchange="GenericViews._importSubmissionFile(event)" />
                </header>

                <section>
                    <h2 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Pending review (${pending.length})</h2>
                    ${pending.length === 0
                        ? `<div class="bg-white border border-dashed border-slate-200 rounded-xl p-8 text-center">
                            <i data-lucide="inbox" width="32" class="text-slate-300 mx-auto mb-2"></i>
                            <p class="text-sm text-slate-500">No submissions waiting.</p>
                            <p class="text-xs text-slate-400 mt-1">When a colleague sends you a submission JSON, drop it in via the button above.</p>
                        </div>`
                        : pending.map(s => renderSubmission(s, false)).join('')}
                </section>

                ${resolved.length > 0 ? `
                <section class="mt-8">
                    <h2 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Recently resolved</h2>
                    ${resolved.map(s => renderSubmission(s, true)).join('')}
                </section>
                ` : ''}
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    },

    async _approveChange(submissionId, changeIdx) {
        const list = await Projects.getPendingSubmissions();
        const sub = list.find(s => s.id === submissionId);
        if (!sub) return;
        const change = sub.changes[changeIdx];
        if (!change || change.status === 'applied') return;
        const result = await Projects.applySubmissionChange(sub.projectId, change);
        if (!result.ok) {
            alert('Could not apply change: ' + (result.error || 'unknown error'));
            return;
        }
        sub.changes[changeIdx].status = 'applied';
        // If all changes are now resolved, mark submission approved
        const remaining = sub.changes.filter(c => !c.status || c.status === 'pending').length;
        if (remaining === 0) sub.status = 'approved';
        await Projects.updateSubmission(submissionId, { changes: sub.changes, status: sub.status });
        App.renderView();
    },

    async _rejectChange(submissionId, changeIdx) {
        const list = await Projects.getPendingSubmissions();
        const sub = list.find(s => s.id === submissionId);
        if (!sub) return;
        sub.changes[changeIdx].status = 'rejected';
        const remaining = sub.changes.filter(c => !c.status || c.status === 'pending').length;
        if (remaining === 0) sub.status = 'rejected';
        await Projects.updateSubmission(submissionId, { changes: sub.changes, status: sub.status });
        App.renderView();
    },

    async _approveAllChanges(submissionId) {
        const list = await Projects.getPendingSubmissions();
        const sub = list.find(s => s.id === submissionId);
        if (!sub) return;
        let failures = 0;
        for (let i = 0; i < sub.changes.length; i++) {
            const c = sub.changes[i];
            if (c.status === 'applied' || c.status === 'rejected') continue;
            const result = await Projects.applySubmissionChange(sub.projectId, c);
            if (result.ok) sub.changes[i].status = 'applied';
            else failures++;
        }
        sub.status = failures === 0 ? 'approved' : 'partial';
        await Projects.updateSubmission(submissionId, { changes: sub.changes, status: sub.status });
        if (failures > 0) alert(`${failures} change${failures === 1 ? '' : 's'} could not be applied — check the console.`);
        App.renderView();
    },

    async _dismissSubmission(submissionId) {
        if (!confirm('Remove this submission from the queue? Any not-yet-applied changes will be lost.')) return;
        await Projects.deleteSubmission(submissionId);
        App.renderView();
    },

    // ===== SUBMISSION FORM — generate a standalone HTML file for a colleague =====
    // Colleague opens the file in their browser, edits cells, clicks "Export changes",
    // gets a small JSON file they email back. Admin imports → queue → review → approve.
    async _exportSubmissionForm(projectId) {
        const project = Projects.getProject(projectId);
        if (!project) { alert('Project not found.'); return; }
        const [allTargets, allActuals, qualityData, allBudget, allQualityKpis, facilities, events, kpiQComments] = await Promise.all([
            Projects.getTargets(projectId),
            Projects.getActuals(projectId),
            Projects.getQualityData(projectId),
            Projects.getBudget(projectId),
            Projects.getAllQualityKpis(),
            Projects.getFacilities(projectId),
            Projects.getEvents(projectId),
            Projects.getKpiQuarterComments(projectId),
        ]);

        const now = new Date();
        const yearMax = (App.kpiYearMax != null) ? Math.max(App.kpiYearMax, now.getFullYear() + 1) : now.getFullYear() + 1;
        const years = [];
        for (let y = 2022; y <= yearMax; y++) years.push(y);

        // Build snapshot blob (embedded into the form so the colleague sees current values)
        const snapshot = {
            _type: 'surgdash_submission_form',
            _version: 1,
            projectId,
            projectName: project.name,
            projectShort: project.shortName || project.name,
            currency: project.currency || 'USD',
            generatedAt: now.toISOString(),
            generatedBy: 'SURGdash',
            years,
            startDate: project.startDate || null,
            endDate: project.endDate || null,
            standardKpis: Projects.STANDARD_KPIS.map(k => ({ id: k.id, name: k.name, nameBig: k.nameBig, nameSub: k.nameSub, color: k.color })),
            qualityKpis: (project.enabledQualityKpis || []).map(id => allQualityKpis.find(k => k.id === id)).filter(Boolean).map(k => ({ id: k.id, name: k.name, shortName: k.shortName, unit: k.unit, color: k.color, lowerIsBetter: !!k.lowerIsBetter })),
            // Project-level quality baselines + targets (so the form can show/edit them)
            qualityBaselines: project.qualityBaselines || {},
            qualityTargets:   project.qualityTargets   || {},
            kpiValues: {},     // { year: { kpiId: { target, actual } } }
            qualityValues: {}, // { year: { quarter: { kpiId: { target, actual } } } }
            budgetValues: {},  // { year: allocated }
            facilities: (facilities || []).map(f => ({ id: f.id, name: f.name, isHub: !!f.isHub })),
            recentEvents: (events || []).slice(0, 20).map(e => ({
                date: e.date, endDate: e.endDate || '', title: e.title, type: e.type,
                hcw_count: e.hcw_count || 0, hcw_new_count: e.hcw_new_count || 0,
                patient_count: e.patient_count || 0,
                facility_ids: e.facility_ids || []
            })),
        };
        // Populate KPI values. Target stays annual; actuals are captured per quarter
        // (cumulative) to mirror the app's data-entry matrix. A per-quarter comment
        // accompanies each actual cell.
        snapshot.kpiQuarterly = {};  // { year: { quarter: { kpiId: actual } } }
        snapshot.kpiComments  = {};  // { year: { quarter: { kpiId: commentText } } }
        years.forEach(y => {
            const t = Projects.getTargetsForYear(allTargets, y);
            const a = Projects.getActualsForYear(allActuals, y);
            snapshot.kpiValues[y] = {};
            Projects.STANDARD_KPIS.forEach(k => {
                snapshot.kpiValues[y][k.id] = {
                    target: t[k.id] !== undefined && t[k.id] !== null ? t[k.id] : null,
                    actual: a[k.id] !== undefined && a[k.id] !== null ? a[k.id] : null,
                };
            });
            const actualsEntry = allActuals.find(r => r.year === y);
            const quarters = (actualsEntry && actualsEntry.quarters) || {};
            snapshot.kpiQuarterly[y] = {};
            snapshot.kpiComments[y]  = {};
            [1, 2, 3, 4].forEach(q => {
                snapshot.kpiQuarterly[y][q] = {};
                snapshot.kpiComments[y][q]  = {};
                Projects.STANDARD_KPIS.forEach(k => {
                    const qv = quarters[q] && quarters[q][k.id];
                    snapshot.kpiQuarterly[y][q][k.id] = (qv !== undefined && qv !== null) ? qv : null;
                    snapshot.kpiComments[y][q][k.id] = Projects.kpiQuarterComment(kpiQComments, k.id, y, q) || '';
                });
            });
        });
        // Populate quality values
        snapshot.qualityKpis.forEach(k => {
            years.forEach(y => {
                [1, 2, 3, 4].forEach(q => {
                    const entry = qualityData.find(d => d.kpiId === k.id && d.year === y && d.quarter === q);
                    if (!snapshot.qualityValues[y]) snapshot.qualityValues[y] = {};
                    if (!snapshot.qualityValues[y][q]) snapshot.qualityValues[y][q] = {};
                    snapshot.qualityValues[y][q][k.id] = {
                        target: entry && entry.target !== null && entry.target !== undefined ? entry.target : null,
                        actual: entry ? Projects.qualityActual(entry) : null,
                    };
                });
            });
        });
        // Populate budget
        (allBudget || []).forEach(b => {
            snapshot.budgetValues[b.year] = b.allocated !== null && b.allocated !== undefined ? b.allocated : null;
        });

        const json = JSON.stringify(snapshot).replace(/<\//g, '<\\/');
        const filenameBase = (project.shortName || project.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
        const html = this._buildSubmissionFormHtml(snapshot, json);
        const savePath = await electronAPI.invoke('pick-save-path', `submission_form_${filenameBase}_${now.toISOString().slice(0, 10)}.html`);
        if (!savePath) return;
        electronAPI.fs.writeFileSync(savePath, html, 'utf-8');
        App.showMsg('Submission form saved ✓ Send it to your colleague — they can fill it in offline.');
    },

    _buildSubmissionFormHtml(snapshot, jsonString) {
        // Self-contained HTML. No external deps. Inline CSS + JS. Embedded data snapshot.
        // Colleague edits inputs → dirty fields tracked → on export, JSON downloaded.
        const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SURGdash — Submission for ${esc(snapshot.projectName)}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
* { box-sizing: border-box; font-family: 'Inter', sans-serif; }
body { margin: 0; background: #f8fafc; color: #0f172a; line-height: 1.5; }
.wrap { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
header { padding-bottom: 20px; border-bottom: 3px solid #002F4C; margin-bottom: 24px; }
header h1 { margin: 0 0 4px; font-size: 22px; font-weight: 900; color: #002F4C; }
header p { margin: 0; font-size: 13px; color: #64748b; }
.intro { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 14px 18px; margin-bottom: 24px; font-size: 13px; color: #1e3a8a; }
.intro strong { color: #1e40af; }
.section { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
.section h2 { margin: 0 0 4px; font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: .08em; }
.section .sub { margin: 0 0 14px; font-size: 12px; color: #64748b; }
.identity { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 4px; }
.identity .full { grid-column: 1 / -1; }
.identity label { display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .04em; }
.identity input, .identity textarea { width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; outline: none; transition: border-color .15s; }
.identity input:focus, .identity textarea:focus { border-color: #4389C8; box-shadow: 0 0 0 3px rgba(67,137,200,0.15); }
.identity textarea { resize: vertical; min-height: 60px; }
.identity .req { color: #dc2626; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { background: #f8fafc; text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
th.num { text-align: center; }
td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
td.label { font-weight: 700; min-width: 200px; border-left-width: 3px; border-left-style: solid; padding-left: 12px; }
/* Frozen first column on the indicator-entry matrices.
   Both the header cell and the row label cell stick to the left edge
   so the indicator name stays visible while the user scrolls horizontally. */
.scroll table th:first-child,
.scroll table td.label { position: sticky; left: 0; z-index: 2; background: #ffffff; box-shadow: 2px 0 6px -3px rgba(0,0,0,0.08); }
.scroll table th:first-child { background: #f8fafc; z-index: 3; }
/* In the Quality table, the second-row Q1-Q4 sub-headers also need
   a higher z so they don't slide under the sticky column. */
.scroll table thead th { z-index: 2; }
.scroll table thead th:first-child { z-index: 3; }
td.field { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #94a3b8; }
td.field.target { background: rgba(245,158,11,0.06); color: #b45309; }
td.field.actual { background: rgba(16,185,129,0.06); color: #047857; }
input.cell { width: 100%; padding: 6px 8px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; text-align: right; font-variant-numeric: tabular-nums; outline: none; transition: all .15s; background: #fff; }
input.cell:focus { border-color: #4389C8; box-shadow: 0 0 0 2px rgba(67,137,200,0.2); }
input.cell.dirty { background: #fef3c7; border-color: #f59e0b; box-shadow: 0 0 0 2px rgba(245,158,11,0.15); }
input.cell.locked { background: #f8fafc; color: #cbd5e1; cursor: not-allowed; border-style: dashed; }
.scroll { overflow-x: auto; }
.year-group { padding: 6px 4px; text-align: center; border-left: 1px solid #e2e8f0; min-width: 90px; }
.year-group .yr { font-weight: 800; color: #002F4C; font-size: 12px; }
.year-group .qtr { font-size: 9px; color: #94a3b8; font-weight: 600; }
.footer-bar { position: sticky; bottom: 0; background: #fff; border-top: 1px solid #e2e8f0; padding: 14px 18px; margin: 24px -24px -32px; display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; box-shadow: 0 -2px 8px rgba(0,0,0,0.04); }
.dirty-count { font-size: 13px; color: #64748b; }
.dirty-count.has-changes { color: #b45309; font-weight: 600; }
.btn { padding: 10px 22px; background: #002F4C; color: #fff; font-weight: 700; font-size: 13px; border: none; border-radius: 8px; cursor: pointer; transition: background .15s; }
.btn:hover { background: #4389C8; }
.btn:disabled { background: #cbd5e1; cursor: not-allowed; }
.btn.secondary { background: #f1f5f9; color: #475569; }
.btn.secondary:hover { background: #e2e8f0; }
.diff-hint { font-size: 11px; color: #94a3b8; margin-top: 6px; font-style: italic; }
.snapshot-note { font-size: 11px; color: #94a3b8; margin-top: 16px; font-style: italic; text-align: center; }
.req { color: #dc2626; }
</style>
</head>
<body>
<div class="wrap">

<header>
    <h1>${esc(snapshot.projectName)} — Data Submission</h1>
    <p>Edit the cells you want to update, then click <strong>Export changes</strong> at the bottom. Send the downloaded file to ${esc(snapshot.generatedBy)}.</p>
</header>

<div class="intro">
    <p style="margin: 0 0 8px"><strong>How this works:</strong></p>
    <ol style="margin: 0; padding-left: 20px;">
        <li>Cells show the <em>current</em> values stored in SURGdash.</li>
        <li>Type into any cell to update it. Changed cells turn amber.</li>
        <li>Cells outside the project's active period are locked (dashed border).</li>
        <li>Use the <strong>Activities</strong> section at the bottom to log new training events, mentoring visits, or milestones.</li>
        <li>Fill in your name (and an optional note) below, then click <strong>Export changes</strong>.</li>
        <li>Email the downloaded JSON file back to the SURGdash admin. They'll review and apply your changes.</li>
    </ol>
</div>

<div class="section">
    <h2>Your details</h2>
    <p class="sub">Required so we know who submitted the update and can follow up if needed.</p>
    <div class="identity">
        <div>
            <label>Your name <span class="req">*</span></label>
            <input id="submitter-name" type="text" placeholder="e.g. Maria Achieng" required />
        </div>
        <div>
            <label>Email (optional)</label>
            <input id="submitter-email" type="email" placeholder="you@example.org" />
        </div>
        <div class="full">
            <label>What's changed? (optional message)</label>
            <textarea id="submitter-message" placeholder="e.g. Q1 2026 actuals just received from MoH"></textarea>
        </div>
    </div>
</div>

<div class="section">
    <h2>KPIs</h2>
    <p class="sub">Annual targets and actuals. Tab between cells to move quickly.</p>
    <div class="scroll" id="kpi-table-wrap"></div>
</div>

${snapshot.qualityKpis.length > 0 ? `
<div class="section">
    <h2>Quality Indicator Baselines</h2>
    <p class="sub">Pre-intervention baseline value for each indicator (the starting point improvement is measured against). Leave blank if unchanged.</p>
    <div id="baseline-wrap"></div>
</div>

<div class="section">
    <h2>Quality Indicators</h2>
    <p class="sub">Quarterly targets and actuals for each enabled quality indicator.</p>
    <div class="scroll" id="quality-table-wrap"></div>
</div>
` : ''}

<div class="section">
    <h2>Budget</h2>
    <p class="sub">Annual budget allocated to the project (in ${esc(snapshot.currency)}).</p>
    <div class="scroll" id="budget-table-wrap"></div>
</div>

<div class="section">
    <h2>Activities &mdash; log new training events, mentoring visits, or other milestones</h2>
    <p class="sub">Add any new events that aren't already listed below. Existing events are shown for reference (read-only) so you don't double-log.</p>

    <div id="existing-events-wrap" style="margin-bottom: 18px"></div>

    <div style="border: 1px dashed #cbd5e1; border-radius: 10px; padding: 16px; background: #f8fafc">
        <p style="margin: 0 0 12px; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: .04em">Add a new activity</p>

        <div class="event-form" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div style="grid-column: 1 / -1">
                <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px;text-transform:uppercase">Title <span class="req">*</span></label>
                <input id="ev-title" type="text" placeholder="e.g. Advanced Surgical Skills Training — Nairobi" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px" />
            </div>
            <div>
                <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px;text-transform:uppercase">Start date <span class="req">*</span></label>
                <input id="ev-date" type="date" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px" />
            </div>
            <div>
                <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px;text-transform:uppercase">End date <span style="color:#94a3b8;font-weight:400;text-transform:none">(optional)</span></label>
                <input id="ev-end-date" type="date" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px" />
            </div>
            <div>
                <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px;text-transform:uppercase">Category</label>
                <select id="ev-type" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;background:#fff">
                    <option value="workshop">Training / workshop</option>
                    <option value="mentoring">Mentoring / supervision</option>
                    <option value="other">Other (meeting, review, etc.)</option>
                </select>
            </div>
            <div>
                <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px;text-transform:uppercase">Total HCWs involved</label>
                <input id="ev-hcw" type="number" min="0" placeholder="0" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px" />
            </div>
            <div>
                <label style="display:block;font-size:11px;font-weight:700;color:#10b981;margin-bottom:4px;text-transform:uppercase">↳ Of which new this year</label>
                <input id="ev-hcw-new" type="number" min="0" placeholder="0" style="width:100%;padding:8px 10px;border:1px solid #a7f3d0;border-radius:8px;font-size:13px;background:#fff" />
            </div>
            <div>
                <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px;text-transform:uppercase">Patients reached (if any)</label>
                <input id="ev-patients" type="number" min="0" placeholder="0" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px" />
            </div>
            <div style="grid-column: 1 / -1">
                <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px;text-transform:uppercase">Facilities involved</label>
                ${snapshot.facilities.length > 0 ? `<div id="ev-fac-list" style="border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;max-height:150px;overflow-y:auto;background:#fff"></div>`
                  : '<p style="margin:0;font-size:12px;color:#94a3b8;font-style:italic">No facilities configured for this project.</p>'}
            </div>
            <div style="grid-column: 1 / -1">
                <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px;text-transform:uppercase">Notes</label>
                <textarea id="ev-notes" rows="2" placeholder="What happened, key outcomes, observations…" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;resize:vertical"></textarea>
            </div>
            <div style="grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px">
                <button type="button" onclick="resetEventForm()" class="btn secondary">Reset</button>
                <button type="button" onclick="stageEvent()" class="btn" style="background:#10B981">+ Stage this activity</button>
            </div>
        </div>
    </div>

    <div id="staged-events-wrap" style="margin-top: 16px"></div>
</div>

<div class="footer-bar">
    <div class="dirty-count" id="dirty-count">No changes yet</div>
    <button class="btn" id="export-btn" onclick="exportSubmission()">Export changes</button>
</div>

<p class="snapshot-note">Snapshot taken ${new Date(snapshot.generatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · Project ID: ${esc(snapshot.projectId)}</p>

</div>

<script>
const SNAPSHOT = ${jsonString};

// ── Cell editing & dirty tracking ───────────────────────────────────────
let dirtyCount = 0;
function updateDirtyCount() {
    const el = document.getElementById('dirty-count');
    if (dirtyCount === 0) { el.textContent = 'No changes yet'; el.classList.remove('has-changes'); }
    else { el.textContent = dirtyCount + ' change' + (dirtyCount === 1 ? '' : 's') + ' staged'; el.classList.add('has-changes'); }
}
function onCellChange(input) {
    const orig = input.dataset.orig;
    const cur = input.value.trim();
    const wasDirty = input.classList.contains('dirty');
    const isDirty = cur !== orig;
    if (isDirty && !wasDirty) { input.classList.add('dirty'); dirtyCount++; }
    if (!isDirty && wasDirty) { input.classList.remove('dirty'); dirtyCount--; }
    updateDirtyCount();
}

// ── Active-period check (grey out cells outside startDate..endDate) ─────
function cellRange(year, quarter) {
    if (SNAPSHOT.startDate) {
        const d = new Date(SNAPSHOT.startDate);
        const sy = d.getFullYear(), sq = Math.ceil((d.getMonth() + 1) / 3);
        if (year < sy) return 'before';
        if (year === sy && quarter && quarter < sq) return 'before';
    }
    if (SNAPSHOT.endDate) {
        const d = new Date(SNAPSHOT.endDate);
        const ey = d.getFullYear(), eq = Math.ceil((d.getMonth() + 1) / 3);
        if (year > ey) return 'after';
        if (year === ey && quarter && quarter > eq) return 'after';
    }
    return 'active';
}
function makeInput(value, year, quarter, fieldKind, kpiId) {
    const range = cellRange(year, quarter || null);
    const v = (value === null || value === undefined) ? '' : value;
    if (range !== 'active') {
        return '<input class="cell locked" value="—" disabled title="Outside project active period" />';
    }
    return '<input class="cell" type="number" step="any" min="0" value="' + v + '" data-orig="' + v + '"'
         + ' data-kind="' + fieldKind + '" data-year="' + year + '"'
         + (quarter ? ' data-quarter="' + quarter + '"' : '')
         + (kpiId ? ' data-kpi="' + kpiId + '"' : '')
         + ' oninput="onCellChange(this)" />';
}

// ── Render KPI matrix ───────────────────────────────────────────────────
// Mirrors the app: Target is annual (one cell spanning the year's 4 quarters);
// Actuals are cumulative per quarter (Q1=Jan–Mar … Q4=full year). Each actual
// cell has a small comment input beneath it.
function renderKpiTable() {
    const years = SNAPSHOT.years;
    let html = '<table><thead><tr><th rowspan="2">Indicator</th><th rowspan="2">Field</th>';
    years.forEach(y => html += '<th colspan="4" style="text-align:center;border-left:1px solid #e2e8f0">' + y + '</th>');
    html += '</tr><tr>';
    years.forEach(() => ['Q1', 'Q2', 'Q3', 'Q4'].forEach((q, i) => html += '<th class="num" style="' + (i===0?'border-left:1px solid #e2e8f0':'') + ';min-width:90px">' + q + (i===3?'<div style="font-size:8px;color:#10B981;font-weight:600">= year total</div>':'') + '</th>'));
    html += '</tr></thead><tbody>';
    SNAPSHOT.standardKpis.forEach(kpi => {
        // Target row — single annual cell spanning all 4 quarter columns per year
        html += '<tr><td rowspan="2" class="label" style="border-left-color:' + kpi.color + '"><div style="color:' + kpi.color + '; font-weight:900; font-size:11px; text-transform:uppercase">' + (kpi.nameBig || kpi.name) + '</div>'
              + (kpi.nameSub ? '<div style="font-size:10px; color:#94a3b8; font-weight:400">' + kpi.nameSub + '</div>' : '') + '</td>'
              + '<td class="field target">Target<div style="font-size:9px;font-weight:400;text-transform:none">(annual)</div></td>';
        years.forEach(y => {
            const v = ((SNAPSHOT.kpiValues[y] || {})[kpi.id] || {}).target;
            html += '<td colspan="4" style="border-left:1px solid #e2e8f0">' + makeInput(v, y, null, 'kpi:target', kpi.id) + '</td>';
        });
        html += '</tr>';
        // Actual row — cumulative per quarter, with a comment input under each cell
        html += '<tr><td class="field actual">Actual<div style="font-size:9px;font-weight:400;text-transform:none">(cumulative)</div></td>';
        years.forEach(y => {
            [1, 2, 3, 4].forEach((q, i) => {
                const v = (((SNAPSHOT.kpiQuarterly[y] || {})[q] || {})[kpi.id]);
                const c = (((SNAPSHOT.kpiComments[y] || {})[q] || {})[kpi.id]) || '';
                html += '<td style="' + (i===0?'border-left:1px solid #e2e8f0':'') + ';vertical-align:top">'
                      + makeQuarterActual(v, y, q, kpi.id)
                      + makeCommentInput(c, y, q, kpi.id)
                      + '</td>';
            });
        });
        html += '</tr>';
    });
    html += '</tbody></table>';
    document.getElementById('kpi-table-wrap').innerHTML = html;
}

// A quarterly cumulative actual cell (number input) for a core KPI.
function makeQuarterActual(value, year, quarter, kpiId) {
    const range = cellRange(year, quarter);
    if (range !== 'active') return '<input class="cell locked" value="—" disabled title="Outside project active period" />';
    const v = (value === null || value === undefined) ? '' : value;
    return '<input class="cell" type="number" step="any" min="0" value="' + v + '" data-orig="' + v + '"'
         + ' data-kind="kpi:actual" data-year="' + year + '" data-quarter="' + quarter + '" data-kpi="' + kpiId + '"'
         + ' oninput="onCellChange(this)" />';
}

// A small free-text comment input that travels with a quarterly actual.
function makeCommentInput(value, year, quarter, kpiId) {
    const range = cellRange(year, quarter);
    if (range !== 'active') return '';
    const v = (value === null || value === undefined) ? '' : String(value).replace(/"/g, '&quot;');
    return '<input class="cell comment" type="text" value="' + v + '" data-orig="' + v + '"'
         + ' data-kind="kpiComment" data-year="' + year + '" data-quarter="' + quarter + '" data-kpi="' + kpiId + '"'
         + ' placeholder="comment…" title="Optional note for this quarter\\'s figure"'
         + ' style="margin-top:3px;font-size:10px;text-align:left;color:#64748b;padding:3px 5px" oninput="onCellChange(this)" />';
}

// ── Render Quality matrix (year × Q1-Q4) ────────────────────────────────
function renderQualityTable() {
    if (SNAPSHOT.qualityKpis.length === 0) return;
    const years = SNAPSHOT.years;
    let html = '<table><thead>'
             + '<tr><th rowspan="2">Indicator</th><th rowspan="2">Field</th>';
    years.forEach(y => html += '<th colspan="4" style="text-align:center;border-left:1px solid #e2e8f0">' + y + '</th>');
    html += '</tr><tr>';
    years.forEach(() => ['Q1', 'Q2', 'Q3', 'Q4'].forEach((q, i) => html += '<th class="num" style="' + (i===0?'border-left:1px solid #e2e8f0':'') + ';min-width:65px">' + q + '</th>'));
    html += '</tr></thead><tbody>';
    SNAPSHOT.qualityKpis.forEach(kpi => {
        // Target row
        html += '<tr><td rowspan="2" class="label" style="border-left-color:' + kpi.color + '"><div style="color:' + kpi.color + ';font-weight:900;font-size:11px;text-transform:uppercase">' + (kpi.shortName || kpi.name) + '</div><div style="font-size:10px;color:#94a3b8">' + (kpi.name) + ' · ' + (kpi.unit || '') + (kpi.lowerIsBetter ? ' · lower is better' : '') + '</div></td>'
              + '<td class="field target">Target</td>';
        years.forEach(y => {
            [1, 2, 3, 4].forEach(q => {
                const v = (((SNAPSHOT.qualityValues[y] || {})[q] || {})[kpi.id] || {}).target;
                html += '<td>' + makeInput(v, y, q, 'quality:target', kpi.id) + '</td>';
            });
        });
        html += '</tr><tr><td class="field actual">Actual</td>';
        years.forEach(y => {
            [1, 2, 3, 4].forEach(q => {
                const v = (((SNAPSHOT.qualityValues[y] || {})[q] || {})[kpi.id] || {}).actual;
                html += '<td>' + makeInput(v, y, q, 'quality:actual', kpi.id) + '</td>';
            });
        });
        html += '</tr>';
    });
    html += '</tbody></table>';
    document.getElementById('quality-table-wrap').innerHTML = html;
}

// ── Render quality baselines (one editable input per indicator) ─────────
function renderBaselineTable() {
    const wrap = document.getElementById('baseline-wrap');
    if (!wrap || !SNAPSHOT.qualityKpis || SNAPSHOT.qualityKpis.length === 0) return;
    const base = SNAPSHOT.qualityBaselines || {};
    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">';
    SNAPSHOT.qualityKpis.forEach(kpi => {
        const v = (base[kpi.id] !== undefined && base[kpi.id] !== null) ? base[kpi.id] : '';
        html += '<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;border-left:3px solid ' + kpi.color + '">'
              + '<div style="font-size:11px;font-weight:900;text-transform:uppercase;color:' + kpi.color + '">' + escHtml(kpi.shortName || kpi.name) + '</div>'
              + '<div style="font-size:10px;color:#94a3b8;margin-bottom:6px">' + escHtml(kpi.unit || '') + (kpi.lowerIsBetter ? ' · lower is better' : '') + '</div>'
              + '<input class="cell" type="number" step="any" min="0" value="' + v + '" data-orig="' + v + '"'
              + ' data-kind="baseline" data-kpi="' + escHtml(kpi.id) + '" oninput="onCellChange(this)" placeholder="baseline" />'
              + '</div>';
    });
    html += '</div>';
    wrap.innerHTML = html;
}

// ── Render Budget matrix ────────────────────────────────────────────────
function renderBudgetTable() {
    const years = SNAPSHOT.years;
    let html = '<table><thead><tr><th>Line</th>';
    years.forEach(y => html += '<th class="num"><div class="year-group"><div class="yr">' + y + '</div></div></th>');
    html += '</tr></thead><tbody><tr><td class="label" style="border-left-color:#10B981"><div style="color:#10B981;font-weight:900;font-size:11px;text-transform:uppercase">Allocated</div><div style="font-size:10px;color:#94a3b8">' + SNAPSHOT.currency + '</div></td>';
    years.forEach(y => {
        const v = SNAPSHOT.budgetValues[y];
        html += '<td>' + makeInput(v, y, null, 'budget:allocated', null) + '</td>';
    });
    html += '</tr></tbody></table>';
    document.getElementById('budget-table-wrap').innerHTML = html;
}

// ── Export changes as JSON file ─────────────────────────────────────────
function exportSubmission() {
    const submitter = document.getElementById('submitter-name').value.trim();
    if (!submitter) {
        alert('Please enter your name before exporting.');
        document.getElementById('submitter-name').focus();
        return;
    }
    const email = document.getElementById('submitter-email').value.trim();
    const message = document.getElementById('submitter-message').value.trim();

    const dirtyInputs = document.querySelectorAll('input.cell.dirty');
    if (dirtyInputs.length === 0) {
        if (!confirm('No cells have been changed. Export an empty submission anyway?')) return;
    }
    const changes = [];
    dirtyInputs.forEach(input => {
        const [type, field] = (input.dataset.kind || '').split(':');
        const newRaw = input.value.trim();
        const newVal = newRaw === '' ? null : Number(newRaw);
        const origRaw = input.dataset.orig || '';
        const oldVal = origRaw === '' ? null : Number(origRaw);
        const change = { type, field, new: newVal, old: oldVal, year: Number(input.dataset.year) };
        if (input.dataset.quarter) change.quarter = Number(input.dataset.quarter);
        if (input.dataset.kpi) change.kpiId = input.dataset.kpi;
        changes.push(change);
    });

    const submission = {
        _type: 'surgdash_submission',
        _version: 1,
        projectId: SNAPSHOT.projectId,
        projectName: SNAPSHOT.projectName,
        snapshotTakenAt: SNAPSHOT.generatedAt,
        submittedAt: new Date().toISOString(),
        submitter: submitter,
        submitterEmail: email,
        message: message,
        changes: changes,
    };
    const json = JSON.stringify(submission, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (SNAPSHOT.projectShort || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
    a.href = url;
    a.download = 'submission_' + safeName + '_' + new Date().toISOString().slice(0,10) + '_' + submitter.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    alert('Submission file downloaded. Please email it to your SURGdash admin so they can review and apply your changes.');
}

// ── Activities (events) — read-only list + staged-new list ──────────────
const stagedEvents = []; // user-added events to include in export
function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function evDateRange(e) { var s = e && e.date ? String(e.date) : ''; var en = e && e.endDate ? String(e.endDate) : ''; if (!s) return ''; return (en && en !== s) ? (s + ' – ' + en) : s; }
function eventTypeLabel(t) { return t === 'workshop' ? 'Training' : t === 'mentoring' ? 'Mentoring' : 'Other'; }
function eventTypeColor(t) { return t === 'workshop' ? '#4389C8' : t === 'mentoring' ? '#8B5CF6' : '#64748b'; }

function renderExistingEvents() {
    const wrap = document.getElementById('existing-events-wrap');
    if (!wrap) return;
    if (!SNAPSHOT.recentEvents || SNAPSHOT.recentEvents.length === 0) {
        wrap.innerHTML = '<p style="margin:0;font-size:12px;color:#94a3b8;font-style:italic">No events logged yet for this project.</p>';
        return;
    }
    const facMap = {}; SNAPSHOT.facilities.forEach(f => facMap[f.id] = f.name);
    let html = '<p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase">Recent activities <span style="font-weight:400;color:#94a3b8;text-transform:none">(read-only — already logged)</span></p>';
    html += '<div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">';
    SNAPSHOT.recentEvents.forEach((e, i) => {
        const facNames = (e.facility_ids || []).map(id => facMap[id]).filter(Boolean).slice(0, 3);
        const extraCount = Math.max(0, (e.facility_ids || []).length - 3);
        const extras = extraCount > 0 ? (' +' + extraCount + ' more') : '';
        const tc = eventTypeColor(e.type);
        html += '<div style="padding:8px 12px;border-bottom:1px solid #f1f5f9;display:flex;gap:10px;align-items:center;font-size:12px;background:' + (i % 2 ? '#fff' : '#fafbfc') + '">'
              + '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + tc + ';flex-shrink:0"></span>'
              + '<span style="color:#94a3b8;font-size:10px;font-weight:600;width:110px;flex-shrink:0">' + escHtml(evDateRange(e)) + '</span>'
              + '<span style="font-size:9px;font-weight:700;text-transform:uppercase;color:' + tc + ';background:' + tc + '15;padding:2px 6px;border-radius:4px;flex-shrink:0">' + eventTypeLabel(e.type) + '</span>'
              + '<span style="flex:1;font-weight:500;color:#334155">' + escHtml(e.title) + '</span>'
              + '<span style="color:#64748b;font-size:11px;flex-shrink:0">' + (e.hcw_count || 0) + ' HCW</span>'
              + (facNames.length ? '<span style="color:#94a3b8;font-size:11px;flex-shrink:0">@ ' + escHtml(facNames.join(', ')) + extras + '</span>' : '')
              + '</div>';
    });
    html += '</div>';
    wrap.innerHTML = html;
}

function renderFacilityCheckboxes() {
    const list = document.getElementById('ev-fac-list'); if (!list) return;
    let html = '';
    SNAPSHOT.facilities.forEach(f => {
        html += '<label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:13px"><input type="checkbox" data-fac-id="' + escHtml(f.id) + '" />'
              + '<span style="color:#334155">' + escHtml(f.name) + '</span>'
              + (f.isHub ? '<span style="font-size:9px;font-weight:700;background:#002F4C;color:#fff;padding:1px 5px;border-radius:3px;text-transform:uppercase">Hub</span>' : '')
              + '</label>';
    });
    html += '<label style="display:flex;align-items:center;gap:8px;padding:4px 0;border-top:1px solid #f1f5f9;margin-top:4px;padding-top:8px;cursor:pointer;font-size:13px;color:#94a3b8;font-style:italic"><input type="checkbox" data-fac-other="1" /><span>Other (not listed)</span></label>';
    list.innerHTML = html;
}

function resetEventForm() {
    document.getElementById('ev-title').value = '';
    document.getElementById('ev-date').value = '';
    var endEl = document.getElementById('ev-end-date'); if (endEl) endEl.value = '';
    document.getElementById('ev-type').value = 'workshop';
    document.getElementById('ev-hcw').value = '';
    document.getElementById('ev-hcw-new').value = '';
    document.getElementById('ev-patients').value = '';
    document.getElementById('ev-notes').value = '';
    document.querySelectorAll('#ev-fac-list input[type="checkbox"]').forEach(cb => cb.checked = false);
}

function stageEvent() {
    const title = document.getElementById('ev-title').value.trim();
    const date  = document.getElementById('ev-date').value.trim();
    const endDate = (document.getElementById('ev-end-date') || {}).value ? document.getElementById('ev-end-date').value.trim() : '';
    if (!title) { alert('Please give the activity a title.'); document.getElementById('ev-title').focus(); return; }
    if (!date)  { alert('Please pick a start date.'); document.getElementById('ev-date').focus(); return; }
    if (endDate && endDate < date) { alert('End date cannot be before the start date.'); return; }
    const type   = document.getElementById('ev-type').value;
    const hcw    = parseInt(document.getElementById('ev-hcw').value, 10) || 0;
    const hcwNew = parseInt(document.getElementById('ev-hcw-new').value, 10) || 0;
    const pat    = parseInt(document.getElementById('ev-patients').value, 10) || 0;
    if (hcwNew > hcw) { alert('"Of which new" cannot exceed total HCWs.'); return; }
    const notes  = document.getElementById('ev-notes').value.trim();
    const facIds = []; let facOther = false;
    document.querySelectorAll('#ev-fac-list input[type="checkbox"]').forEach(cb => {
        if (!cb.checked) return;
        if (cb.dataset.facOther) facOther = true;
        else if (cb.dataset.facId) facIds.push(cb.dataset.facId);
    });
    const event = {
        date, title, type,
        hcw_count: hcw,
        hcw_new_count: hcwNew,
        patient_count: pat,
        facility_ids: facIds,
        facility_other: facOther,
        facilities_count: facIds.length + (facOther ? 1 : 0),
        notes,
    };
    if (endDate) event.endDate = endDate;
    stagedEvents.push(event);
    resetEventForm();
    renderStagedEvents();
    updateDirtyCount();
}

function removeStagedEvent(idx) {
    stagedEvents.splice(idx, 1);
    renderStagedEvents();
    updateDirtyCount();
}

function renderStagedEvents() {
    const wrap = document.getElementById('staged-events-wrap'); if (!wrap) return;
    if (stagedEvents.length === 0) { wrap.innerHTML = ''; return; }
    const facMap = {}; SNAPSHOT.facilities.forEach(f => facMap[f.id] = f.name);
    let html = '<p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#10B981;text-transform:uppercase">Staged for submission (' + stagedEvents.length + ')</p>'
             + '<div style="border:1px solid #a7f3d0;border-radius:8px;background:#ecfdf5;overflow:hidden">';
    stagedEvents.forEach((e, i) => {
        const facNames = (e.facility_ids || []).map(id => facMap[id]).filter(Boolean);
        const tc = eventTypeColor(e.type);
        html += '<div style="padding:10px 12px;border-bottom:1px solid #d1fae5;display:flex;gap:10px;align-items:flex-start;font-size:12px">'
              + '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + tc + ';flex-shrink:0;margin-top:5px"></span>'
              + '<div style="flex:1;min-width:0">'
              + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
              + '<span style="color:#94a3b8;font-size:10px;font-weight:600">' + escHtml(evDateRange(e)) + '</span>'
              + '<span style="font-size:9px;font-weight:700;text-transform:uppercase;color:' + tc + ';background:' + tc + '15;padding:2px 6px;border-radius:4px">' + eventTypeLabel(e.type) + '</span>'
              + '<span style="font-weight:600;color:#0f172a">' + escHtml(e.title) + '</span>'
              + '</div>'
              + '<div style="font-size:11px;color:#475569;margin-top:3px">'
              + (e.hcw_count ? e.hcw_count + ' HCW' + (e.hcw_new_count ? ' (' + e.hcw_new_count + ' new)' : '') + ' · ' : '')
              + (e.patient_count ? e.patient_count + ' patients · ' : '')
              + (facNames.length ? '@ ' + escHtml(facNames.join(', ')) + (e.facility_other ? ' (+ other)' : '') : (e.facility_other ? '@ Other' : ''))
              + '</div>'
              + (e.notes ? '<p style="margin:4px 0 0;font-size:11px;color:#64748b;font-style:italic">' + escHtml(e.notes) + '</p>' : '')
              + '</div>'
              + '<button onclick="removeStagedEvent(' + i + ')" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:18px;line-height:1;padding:0 4px" title="Remove">×</button>'
              + '</div>';
    });
    html += '</div>';
    wrap.innerHTML = html;
}

// Patch updateDirtyCount to include staged events in the count
const _origUpdateDirtyCount = updateDirtyCount;
updateDirtyCount = function () {
    const cellChanges = document.querySelectorAll('input.cell.dirty').length;
    const events = stagedEvents.length;
    const total = cellChanges + events;
    const el = document.getElementById('dirty-count'); if (!el) return;
    if (total === 0) { el.textContent = 'No changes yet'; el.classList.remove('has-changes'); return; }
    const parts = [];
    if (cellChanges > 0) parts.push(cellChanges + ' cell change' + (cellChanges === 1 ? '' : 's'));
    if (events > 0)      parts.push(events + ' new activit' + (events === 1 ? 'y' : 'ies'));
    el.textContent = parts.join(' + ') + ' staged';
    el.classList.add('has-changes');
};

// Patch exportSubmission to include staged events in the changes array
const _origExportSubmission = exportSubmission;
exportSubmission = function () {
    const submitter = document.getElementById('submitter-name').value.trim();
    if (!submitter) { alert('Please enter your name before exporting.'); document.getElementById('submitter-name').focus(); return; }
    const email = document.getElementById('submitter-email').value.trim();
    const message = document.getElementById('submitter-message').value.trim();
    const dirtyInputs = document.querySelectorAll('input.cell.dirty');
    if (dirtyInputs.length === 0 && stagedEvents.length === 0) {
        if (!confirm('No cells changed and no activities staged. Export an empty submission anyway?')) return;
    }
    const changes = [];
    dirtyInputs.forEach(input => {
        const [type, field] = (input.dataset.kind || '').split(':');
        const newRaw = input.value.trim();
        const origRaw = input.dataset.orig || '';
        // Comment cells carry free text; everything else is numeric.
        const isText = (type === 'kpiComment');
        const newVal = isText ? (newRaw || null) : (newRaw === '' ? null : Number(newRaw));
        const oldVal = isText ? (origRaw || null) : (origRaw === '' ? null : Number(origRaw));
        const change = { type, field, new: newVal, old: oldVal, year: Number(input.dataset.year) };
        if (input.dataset.quarter) change.quarter = Number(input.dataset.quarter);
        if (input.dataset.kpi) change.kpiId = input.dataset.kpi;
        changes.push(change);
    });
    stagedEvents.forEach(ev => { changes.push({ type: 'event', event: ev }); });
    const submission = {
        _type: 'surgdash_submission', _version: 1,
        projectId: SNAPSHOT.projectId, projectName: SNAPSHOT.projectName,
        snapshotTakenAt: SNAPSHOT.generatedAt, submittedAt: new Date().toISOString(),
        submitter, submitterEmail: email, message, changes,
    };
    const json = JSON.stringify(submission, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (SNAPSHOT.projectShort || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
    a.href = url;
    a.download = 'submission_' + safeName + '_' + new Date().toISOString().slice(0,10) + '_' + submitter.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    alert('Submission file downloaded. Please email it to your SURGdash admin so they can review and apply your changes.');
};

// Bootstrap
renderKpiTable();
renderBaselineTable();
renderQualityTable();
renderBudgetTable();
renderExistingEvents();
renderFacilityCheckboxes();
updateDirtyCount();
</script>

</body>
</html>`;
    },

    // Per-project web snapshot — wraps _exportOrgSnapshot with a single-project filter.
    // Lets you share an interactive dashboard for one project (incl. the sample) on its own.
    async _exportProjectSnapshot(projectId, year) {
        const project = Projects.getProject(projectId);
        if (!project) { alert('Project not found.'); return; }
        return this._exportOrgSnapshot(year, {
            singleProjectId: projectId,
            title: project.name + (project.isSample ? ' (Sample)' : ''),
            filenameBase: (project.shortName || project.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '') || 'project',
            includeSample: true,
        });
    },

    // ── External snapshot picker ───────────────────────────────────────────
    // Shows a modal letting the user choose exactly which projects, years and
    // indicators to include, then hands off to _exportOrgSnapshot with the
    // `external: true` flag + filter sets.
    async _showExternalSnapshotPicker(defaultYear) {
        const allProjects = Projects.registry.filter(p => p.type === 'generic');
        const allKpis = await Projects.getAllQualityKpis();
        // Collect every year that has data across all projects
        const yearSet = new Set();
        for (const p of allProjects) {
            const [t, a, q] = await Promise.all([
                Projects.getTargets(p.id), Projects.getActuals(p.id), Projects.getQualityData(p.id)
            ]);
            (t || []).forEach(r => yearSet.add(r.year));
            (a || []).forEach(r => yearSet.add(r.year));
            (q || []).forEach(r => yearSet.add(r.year));
        }
        const years = Array.from(yearSet).sort();
        // Union of quality KPIs enabled across the selected real projects
        const enabledQ = new Set();
        allProjects.forEach(p => (p.enabledQualityKpis || []).forEach(id => enabledQ.add(id)));
        const qKpis = allKpis.filter(k => enabledQ.has(k.id));

        const chip = (id, label, checked, group) => `<label class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer text-xs">
            <input type="checkbox" data-group="${group}" data-id="${App.escapeHtml(String(id))}" ${checked ? 'checked' : ''} class="rounded border-slate-300 text-gsf-boston" /> ${App.escapeHtml(label)}</label>`;

        // Remove any existing picker
        const existing = document.getElementById('ext-snapshot-modal');
        if (existing) existing.remove();
        const modal = document.createElement('div');
        modal.id = 'ext-snapshot-modal';
        modal.className = 'fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4';
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
        modal.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[88vh] flex flex-col overflow-hidden">
                <div class="px-6 py-4 border-b flex items-center justify-between">
                    <div>
                        <h3 class="text-lg font-bold text-gsf-prussian">External snapshot</h3>
                        <p class="text-xs text-slate-500 mt-0.5">Pick exactly what to include. The output is website-ready — no beta banner, no exclude chips, simple Month YYYY date.</p>
                    </div>
                    <button onclick="document.getElementById('ext-snapshot-modal').remove()" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" width="18"></i></button>
                </div>
                <div class="overflow-y-auto p-6 space-y-5 flex-1">
                    <div>
                        <div class="flex items-center justify-between mb-2">
                            <p class="text-xs font-bold text-slate-500 uppercase tracking-wide">Projects</p>
                            <div class="flex gap-1">
                                <button onclick="GenericViews._extSnapToggleGroup('project', true)" class="text-[10px] text-gsf-boston hover:underline">Select all</button>
                                <span class="text-slate-300">·</span>
                                <button onclick="GenericViews._extSnapToggleGroup('project', false)" class="text-[10px] text-slate-500 hover:underline">Clear</button>
                            </div>
                        </div>
                        <div class="flex flex-wrap gap-1.5">${allProjects.map(p => chip(p.id, (p.shortName || p.name) + (p.isSample ? ' (sample)' : ''), !p.isSample, 'project')).join('')}</div>
                    </div>
                    <div>
                        <div class="flex items-center justify-between mb-2">
                            <p class="text-xs font-bold text-slate-500 uppercase tracking-wide">Years</p>
                            <div class="flex gap-1">
                                <button onclick="GenericViews._extSnapToggleGroup('year', true)" class="text-[10px] text-gsf-boston hover:underline">Select all</button>
                                <span class="text-slate-300">·</span>
                                <button onclick="GenericViews._extSnapToggleGroup('year', false)" class="text-[10px] text-slate-500 hover:underline">Clear</button>
                            </div>
                        </div>
                        <div class="flex flex-wrap gap-1.5">${years.length ? years.map(y => chip(y, String(y), true, 'year')).join('') : '<p class="text-xs text-slate-400 italic">No project data yet — sync or enter data first.</p>'}</div>
                    </div>
                    <div>
                        <p class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Core indicators</p>
                        <div class="flex flex-wrap gap-1.5">${Projects.STANDARD_KPIS.map(k => chip(k.id, (k.nameBig || k.name), true, 'kpi')).join('')}</div>
                    </div>
                    ${qKpis.length ? `<div>
                        <p class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Quality indicators</p>
                        <div class="flex flex-wrap gap-1.5">${qKpis.map(k => chip(k.id, (k.shortName || k.name), true, 'qkpi')).join('')}</div>
                    </div>` : ''}
                    <div>
                        <p class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Title</p>
                        <input type="text" id="ext-snap-title" value="GSF Programme Snapshot" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                        <p class="text-[11px] text-slate-400 italic mt-2">The methodology page is built into the snapshot file — reachable via "Read the full methodology" from the footer note.</p>
                    </div>
                </div>
                <div class="px-6 py-4 border-t bg-slate-50 flex items-center justify-end gap-2">
                    <button onclick="document.getElementById('ext-snapshot-modal').remove()" class="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-200">Cancel</button>
                    <button onclick="GenericViews._runExternalSnapshot(${defaultYear === 'all' ? "'all'" : defaultYear})" class="px-5 py-2 rounded-lg text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5"><i data-lucide="download" width="13"></i> Generate</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        if (window.lucide) lucide.createIcons();
    },

    _extSnapToggleGroup(group, on) {
        document.querySelectorAll(`#ext-snapshot-modal input[data-group="${group}"]`).forEach(cb => { cb.checked = !!on; });
    },

    async _runExternalSnapshot(defaultYear) {
        const sel = (group) => Array.from(document.querySelectorAll(`#ext-snapshot-modal input[data-group="${group}"]:checked`)).map(cb => cb.dataset.id);
        const includeProjects = sel('project');
        const includeYears    = sel('year').map(Number);
        const includeKpis     = sel('kpi');
        const includeQKpis    = sel('qkpi');
        if (includeProjects.length === 0) { alert('Pick at least one project.'); return; }
        if (includeKpis.length === 0 && includeQKpis.length === 0) { alert('Pick at least one indicator.'); return; }
        const title = (document.getElementById('ext-snap-title')?.value || 'GSF Programme Snapshot').trim() || 'GSF Programme Snapshot';
        const modal = document.getElementById('ext-snapshot-modal');
        if (modal) modal.remove();
        await this._exportOrgSnapshot(defaultYear, {
            external: true,
            title,
            filenameBase: 'gsf_programme_snapshot',
            includeSample: includeProjects.some(id => { const p = Projects.getProject(id); return p && p.isSample; }),
            includeProjects: new Set(includeProjects),
            includeYears: includeYears.length ? new Set(includeYears) : null,
            includeKpis: new Set(includeKpis),
            includeQualityKpis: new Set(includeQKpis),
        });
    },

    async _exportOrgSnapshot(year, opts = {}) {
        try {
            const singleId = opts.singleProjectId || null;
            const includeSample = !!opts.includeSample;
            const external = !!opts.external;
            // In external mode: `includeProjects` controls VISIBILITY only — unselected
            // projects still contribute to organisation-wide KPI totals and charts, they
            // just don't appear in the project breakdown table, map markers, or get
            // their own project page. Outside external mode the selection still narrows
            // the data set (no change).
            const projectAllowed = opts.includeProjects ? (id => opts.includeProjects.has(id)) : (() => true);
            const baseFilter = singleId
                ? (p => p.id === singleId)
                : (p => p.type === 'generic' && (includeSample || !p.isSample));
            const filterFn = external
                ? baseFilter
                : (p => baseFilter(p) && projectAllowed(p.id));
            const genericProjects = Projects.registry.filter(filterFn);
            const dashboardTitle = opts.title || 'Organisation KPI Dashboard';
            const filenameBase = opts.filenameBase || 'org_dashboard';
            const [allQualityKpis, projectData] = await Promise.all([
                Projects.getAllQualityKpis(),
                Promise.all(genericProjects.map(async p => {
                    const [allTargets, allActuals, qualityData, facilities, allBudget] = await Promise.all([
                        Projects.getTargets(p.id), Projects.getActuals(p.id),
                        Projects.getQualityData(p.id), Projects.getFacilities(p.id),
                        Projects.getBudget(p.id)
                    ]);
                    return { project: p, allTargets, allActuals, qualityData, facilities, allBudget };
                }))
            ]);

            // Build embedded data blob
            const allYearsSet = new Set();
            const projBlob = {};
            projectData.forEach(d => {
                const t = {}, a = {};
                (d.allTargets || []).forEach(r => { t[r.year] = r.kpis; allYearsSet.add(r.year); });
                (d.allActuals || []).forEach(r => { a[r.year] = r.kpis; allYearsSet.add(r.year); });
                // quality data: array of {kpiId, year, quarter, target, actual}
                const qd = (d.qualityData || []).map(e => ({
                    kpiId: e.kpiId, year: e.year, quarter: e.quarter,
                    target: e.target !== undefined ? e.target : null,
                    actual: e.actual !== undefined ? e.actual : (e.value !== undefined ? e.value : null)
                }));
                projBlob[d.project.id] = {
                    targets: t, actuals: a, qualityData: qd,
                    budget: (d.allBudget || []).map(b => ({
                        year: b.year,
                        allocated: (b.allocated === undefined || b.allocated === null) ? null : Number(b.allocated)
                    })),
                    facilities: (d.facilities || []).filter(f => f.name).map(f => ({
                        name: f.name,
                        isHub: !!f.isHub,
                        lat: (f.lat !== undefined && f.lat !== null) ? f.lat : null,
                        lng: (f.lng !== undefined && f.lng !== null) ? f.lng : null,
                        catchmentPop: f.catchmentPop || 0,
                        annualPatients: f.annualPatients || 0,
                        notes: f.notes || ''
                    }))
                };
            });

            // Plain-language definition per core KPI — shown in the "What we measure"
            // box and in the click-to-explain popup on each KPI card.
            const KPI_DEFS = {
                hcw_strengthened: 'Surgical, anaesthesia, obstetric and nursing professionals trained, mentored, or supported through GSF-funded work.',
                patients_reached: 'Patients who benefited from improved surgical care at supported facilities. For maternal-health projects, each birth counts two — the mother and, on average, one newborn.',
                population_access: 'People living in the catchment areas of the facilities GSF strengthens — those now within reach of safer surgical care.',
                facilities_strengthened: 'Health facilities receiving structured support: training, equipment, mentoring, or quality improvement.'
            };

            // SURGhub platform summary (all-time). Read-only aggregation of already-synced
            // LearnWorlds analytics — no SURGhub sync/collection logic is touched. Omitted
            // for single-project snapshots. Rendered on its own linked page in the snapshot.
            let surghub = null;
            if (!singleId) {
                try {
                    const _snap = (App.getAnalyticsSnap ? App.getAnalyticsSnap() : []) || [];
                    const _aud = (App.userHistory || []).slice()
                        .sort((a, b) => String(b.Timestamp || '').localeCompare(String(a.Timestamp || '')))[0] || null;
                    const _parse = (window.Charts && window.Charts.safeParse)
                        ? (s) => window.Charts.safeParse(s)
                        : (s) => { try { return JSON.parse(s) || {}; } catch (e) { return {}; } };
                    const _scale = (window.Charts && window.Charts.getScaledTimeline)
                        ? (t) => window.Charts.getScaledTimeline(t, true)
                        : (t) => _parse(t);
                    let _certs = 0, _enrol = 0;
                    _snap.forEach(d => { _certs += Number(d.Certificates) || 0; _enrol += Number(d.Learners) || 0; });
                    const _learners = _aud ? (Number(_aud.TotalUsers) || 0) : (Number(App.platformUniqueUsers) || 0);
                    const _countries = _aud ? (Number(_aud.KnownCountry) || 0) : 0;
                    // Cumulative learners over time, from monthly new signups.
                    const _signups = (_aud && _aud.Signups) ? _parse(_aud.Signups) : {};
                    // Cumulative certificates over time, summed across all course timelines.
                    const _certMonth = {};
                    _snap.forEach(d => {
                        if (!d.CourseTimeline) return;
                        const sc = _scale(d.CourseTimeline) || {};
                        Object.keys(sc).forEach(m => { _certMonth[m] = (_certMonth[m] || 0) + ((sc[m] && sc[m].c) || 0); });
                    });
                    // Both growth charts share ONE fixed month axis: platform launch (Jun 2023)
                    // → last fully completed month. The in-progress month is excluded so the tail
                    // doesn't flatten on partial data; any pre-launch activity folds into the first
                    // point so the cumulative totals stay correct.
                    const _nd = new Date();
                    const _nowMonth = _nd.getFullYear() + '-' + String(_nd.getMonth() + 1).padStart(2, '0');
                    const SHUB_START = '2023-06';
                    let _end = '';
                    [_signups, _certMonth].forEach(mp => Object.keys(mp).forEach(m => {
                        if (/^\d{4}-\d{2}$/.test(m) && m < _nowMonth && m > _end) _end = m;
                    }));
                    const _monthRange = (s, e) => {
                        const out = [];
                        if (!s || !e || e < s) return out;
                        let y = +s.slice(0, 4), mo = +s.slice(5, 7);
                        const ey = +e.slice(0, 4), em = +e.slice(5, 7);
                        while (y < ey || (y === ey && mo <= em)) { out.push(y + '-' + String(mo).padStart(2, '0')); mo++; if (mo > 12) { mo = 1; y++; } }
                        return out;
                    };
                    const _cum = (mp) => {
                        let base = 0;
                        Object.keys(mp).forEach(m => { if (/^\d{4}-\d{2}$/.test(m) && m < SHUB_START) base += Number(mp[m]) || 0; });
                        let r = base;
                        return _monthRange(SHUB_START, _end).map(m => { r += Number(mp[m]) || 0; return { m: m, v: Math.round(r) }; });
                    };
                    // Courses: only count those with a meaningful audience (>50 learners).
                    const _courses = _snap.filter(d => (Number(d.Learners) || 0) > 50).length;
                    // Per-country learner counts for the heatmap → ISO alpha-2 (mirrors the app's
                    // own country maps: aggregateCourseCountries + countryToISO).
                    let _countryMap = null;
                    try {
                        const _cc = (App.aggregateCourseCountries ? App.aggregateCourseCountries(_snap) : { counts: {} }).counts || {};
                        const _iso = {};
                        Object.keys(_cc).forEach(name => {
                            const code = (window.countryToISO && window.countryToISO(name)) || null;
                            if (code) _iso[code] = (_iso[code] || 0) + (Number(_cc[name]) || 0);
                        });
                        if (Object.keys(_iso).length) _countryMap = _iso;
                    } catch (e) { _countryMap = null; }
                    // Transformative-learning survey stats ("content was new to me" /
                    // "likely to apply"), aggregated across all courses' QuestionStats.
                    let _surveyImpact = null;
                    try { _surveyImpact = App._surveyImpactStats ? App._surveyImpactStats(_snap) : null; } catch (e) { _surveyImpact = null; }
                    if (_learners > 0 || _certs > 0 || _enrol > 0 || _courses > 0) {
                        surghub = {
                            learners: _learners, certificates: _certs, enrolments: _enrol,
                            countries: _countries, courses: _courses,
                            learnersSeries: _cum(_signups), certsSeries: _cum(_certMonth),
                            countryMap: _countryMap,
                            surveyImpact: _surveyImpact
                        };
                    }
                } catch (e) { surghub = null; }
            }

            const data = {
                projects: genericProjects.map(p => ({
                    id: p.id, name: p.name, color: p.color, icon: p.icon || 'folder',
                    description: p.description || '',
                    programme: p.programme || '',
                    programmeName: (Projects.programmeById(p.programme) || {}).name || '',
                    programmeIcon: (Projects.programmeById(p.programme) || {}).svg || '',
                    programmeColor: (Projects.programmeById(p.programme) || {}).color || '',
                    startDate: p.startDate || null, endDate: p.endDate || null,
                    linkGsf: p.linkGsf || '',
                    // External mode: false = aggregates only, hidden from list/map/pages.
                    _visible: external ? projectAllowed(p.id) : true,
                    isSample: !!p.isSample,
                    enabledQualityKpis: p.enabledQualityKpis || [],
                    qualityBaselines: p.qualityBaselines || {},
                    qualityTargets:   p.qualityTargets   || {},
                    currency: p.currency || 'USD',
                    impactAssumptions: p.impactAssumptions || null,
                    lat: (p.lat !== undefined && p.lat !== null) ? p.lat : null,
                    lng: (p.lng !== undefined && p.lng !== null) ? p.lng : null,
                    locations: (Array.isArray(p.locations) && p.locations.length > 0) ? p.locations
                        : (p.lat != null ? [{ name: '', lat: p.lat, lng: p.lng }] : [])
                })),
                // Honour external-mode indicator filters
                kpis: Projects.STANDARD_KPIS
                    .filter(k => !opts.includeKpis || opts.includeKpis.has(k.id))
                    .map(k => ({ id: k.id, name: k.name, nameBig: k.nameBig, nameSub: k.nameSub, unit: k.unit, icon: k.icon, color: k.color, def: KPI_DEFS[k.id] || '' })),
                qualityKpis: allQualityKpis
                    .filter(k => !opts.includeQualityKpis || opts.includeQualityKpis.has(k.id))
                    .map(k => ({ id: k.id, name: k.name, shortName: k.shortName, unit: k.unit, color: k.color, lowerIsBetter: !!k.lowerIsBetter })),
                years: Array.from(allYearsSet).sort().filter(y => !opts.includeYears || opts.includeYears.has(y)),
                projectData: projBlob,
                economicConstants: Projects.ECONOMIC_CONSTANTS,
                defaultYear: year,
                // External snapshots use a "Month YYYY" date (no day) so they read like
                // a published programme report rather than an internal export.
                generatedAt: external
                    ? new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
                    : new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
                external,
                methodologyUrl: opts.methodologyUrl || '',
                surghub: surghub,
                // Full GSF programme key for the legend (shown regardless of which are in use).
                programmes: (Projects.PROGRAMMES || []).map(pr => ({ id: pr.id, name: pr.name, svg: pr.svg, color: pr.color }))
            };

            const json = JSON.stringify(data).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');
            const yearArg = year === 'all' ? "'all'" : year;
            // Hidden project page divs (initially hidden; JS populates & shows them).
            // External-mode hidden projects don't get a page div (they only contribute to totals).
            const projPageDivs = data.projects.filter(p => p._visible !== false)
                .map(p => `<div id="page-proj-${p.id}" style="display:none"></div>`).join('\n');

            // GSF logo embedded as a data-URI so the file is self-contained. Prefer a
            // white/transparent logo for the dark header; fall back to the transparent
            // blue globe (good on dark); the navy-tile icon is the last resort.
            // Drop a white logo at build/gsf_logo_white.png to have it picked up first.
            let gsfLogo = '';    // full logo (with wordmark) — org header
            let gsfEmblem = '';  // emblem only — small corner badge on project pages
            let surghubLogo = ''; // SURGhub wordmark — drop a white PNG at build/surghub_logo_white.png
            let surgfundLogo = ''; // SURGfund wordmark — shown beside the Projects heading
            try {
                const _read = (f) => {
                    const _lp = electronAPI.path.join(electronAPI.appPath, 'build', f);
                    return electronAPI.fs.existsSync(_lp) ? ('data:image/png;base64,' + electronAPI.fs.readFileBase64(_lp)) : '';
                };
                for (const _f of ['gsf_logo_white.png', 'gsf_logo_dark_bg.png', 'gsf_logo_full.png']) { gsfLogo = _read(_f); if (gsfLogo) break; }
                for (const _f of ['Global Surgery Foundation_logo_symbol.png', 'gsf_logo_symbol.png']) { gsfEmblem = _read(_f); if (gsfEmblem) break; }
                if (!gsfLogo) gsfLogo = gsfEmblem;       // no full logo present → fall back to emblem
                if (!gsfEmblem) gsfEmblem = gsfLogo;
                for (const _f of ['surghub_logo_white.png', 'SURGhub_app_square_white.png', 'surghub_logo.png', 'surghub_white.png']) { surghubLogo = _read(_f); if (surghubLogo) break; }
                for (const _f of ['SURGfund_logo white.png', 'surgfund_logo_white.png', 'SURGfund_logo_white.png', 'surgfund_logo.png']) { surgfundLogo = _read(_f); if (surgfundLogo) break; }
            } catch (e) {}

            // Methodology page is context-aware: quality-indicator language only
            // appears when quality indicators are in the snapshot; hidden projects
            // (aggregated but not listed) are named; sections renumber dynamically.
            const hasQuality = data.qualityKpis.length > 0;
            const hiddenProjectNames = external ? data.projects.filter(p => p._visible === false).map(p => p.name) : [];
            const _mSec = [];
            _mSec.push({ t: 'What this snapshot shows', b:
                `<p class="text-sm text-slate-600 leading-relaxed mb-3">Numbers are aggregated across the projects, years, and indicators selected at the time of export. Each project's contribution sums into the headline organisation totals. Hidden projects (where the export was filtered) <strong>still contribute to those totals</strong> — they only disappear from the project list and map.</p>`
                + (hiddenProjectNames.length ? `<p class="text-sm text-slate-600 leading-relaxed mb-3"><strong>Included in the aggregate totals but not listed individually:</strong> ${hiddenProjectNames.map(n => App.escapeHtml(n)).join(', ')}.</p>` : '') });
            _mSec.push({ t: 'Headline numbers', b:
                `<p class="text-sm text-slate-600 leading-relaxed mb-3">Each figure is the <strong>actual achieved</strong> for that year. For the <strong>current year and future years</strong> — where results aren't in yet — the figure shown is the year's <strong>goal</strong>, clearly labelled. To keep this snapshot focused on outcomes, progress-against-target (bars and percentages) is intentionally not shown.</p>` });
            _mSec.push({ t: 'Core indicators', b:
                `<ul class="text-sm text-slate-600 leading-relaxed list-disc pl-5 space-y-1.5 mb-3">
        <li><strong>Healthcare workers strengthened</strong> — surgical, anaesthesia, obstetric, paediatric and nursing professionals trained, mentored, or supported through GSF-funded interventions. Counted at activity level; "new" sub-counts deduplicate workers across activities within the same year.</li>
        <li><strong>Patients reached with improved surgical care</strong> — patients estimated to have benefited from improved care at supported facilities during the reporting period. <em>For maternal-health projects, 2 patients are counted per birth — the mother and, on average, one newborn.</em></li>
        <li><strong>Facilities strengthened</strong> — health facilities receiving structured support (training, equipment, mentoring, quality improvement) during the period.</li>
        <li><strong>Population with improved access to surgical care</strong> — catchment population of the supported facilities, taken from facility-level catchment estimates.</li>
    </ul>` });
            if (hasQuality) _mSec.push({ t: 'Quality indicators', b:
                `<p class="text-sm text-slate-600 leading-relaxed mb-2">Quality figures are reported quarterly and shown <strong>cumulative within the year</strong> — Q1 covers Jan–Mar, Q2 covers Jan–Jun, and so on, so the Q4 value equals the annual total. Improvement is measured against a project-set baseline (the pre-intervention value).</p>
    <ul class="text-sm text-slate-600 leading-relaxed list-disc pl-5 space-y-1.5 mb-3">
        <li><strong>MMR &amp; NMR</strong> (maternal &amp; neonatal mortality) — recorded as rates per 100,000 live births / per 1,000 live births at supported maternity facilities.</li>
        <li><strong>SSI rate</strong> (surgical site infection) — percentage of surgeries with documented SSI within 30 days.</li>
        <li><strong>SSC utilisation</strong> (WHO Surgical Safety Checklist) — percentage of operations where the full checklist was completed.</li>
    </ul>` });
            _mSec.push({ t: 'Targets &amp; revisions', b:
                `<p class="text-sm text-slate-600 leading-relaxed mb-3">Targets are set at the start of each year by each project lead and aggregated to the organisation level. They may be revised mid-year after programme reviews; revisions are reflected in the next sync. Historical targets are not retrospectively edited.</p>` });
            _mSec.push({ t: 'Data sources', b:
                `<ul class="text-sm text-slate-600 leading-relaxed list-disc pl-5 space-y-1.5 mb-3">
        <li>Activity logs entered by country and project leads (events, training, site visits).</li>
        ${hasQuality ? '<li>Quarterly submissions from each supported facility (quality indicators).</li>' : ''}
        <li>Project setup data: baselines, targets, catchment population, currency, locations.</li>
        <li>Economic context constants: WHO cost-effectiveness threshold (3× GDP per capita), Lancet/DCP3 effect sizes for deaths-averted calculations, World Bank GDP per capita.</li>
    </ul>` });
            if (data.surghub) _mSec.push({ t: 'SURGhub — Learning Platform', b:
                `<p class="text-sm text-slate-600 leading-relaxed mb-2">SURGhub figures come from the platform's own records (LearnWorlds) and are shown as all-time totals on the SURGhub page of this snapshot.</p>
    <ul class="text-sm text-slate-600 leading-relaxed list-disc pl-5 space-y-1.5 mb-3">
        <li><strong>Learners</strong> — unique registered accounts on the platform.</li>
        <li><strong>Learners</strong> — total course learners; a learner taking three courses counts three times.</li>
        <li><strong>Courses completed</strong> — certificates issued on completion of a course.</li>
        <li><strong>Growth timing</strong> — learner curves use learner signup dates clamped to each course's launch month, so monthly timing is approximate (totals are exact); certificates use actual issue dates.</li>
        <li><strong>Countries/Territories</strong> — distinct countries or territories identified from learner profiles.</li>
        <li><strong>Courses</strong> — courses live on the platform with a meaningful audience (more than 50 learners).</li>
        <li><strong>Growth charts</strong> — cumulative monthly totals from dated platform records, ending at the last fully completed month.</li>
        <li><strong>Learner map</strong> — each country's share of total learners, from per-course learner records.</li>
        <li><strong>Learning impact</strong> — from end-of-course surveys. The percentages are the share of respondents answering 4 or 5 on a 1–5 scale to the statements <em>"the information presented in this course was new to me"</em> and <em>"it is likely that I will use the information acquired in this course"</em>. Survey counts are rounded down.</li>
    </ul>` });
            _mSec.push({ t: 'Known limitations', b:
                `<ul class="text-sm text-slate-600 leading-relaxed list-disc pl-5 space-y-1.5 mb-3">
        <li>Patient and population figures rely on facility catchment estimates; uncertainty is wider for newly-onboarded facilities.</li>
        <li>"New this year" HCW counts are entered by the activity logger; we do not yet cross-check identifiers across projects.</li>
        <li>Economic impact estimates (deaths averted, DALYs, cost-per-DALY) use literature effect sizes and should be read as point estimates, not measured outcomes.</li>
    </ul>` });
            const methodologySectionsHtml = _mSec.map((s, i) =>
                `<h2 class="sec-eyebrow" style="margin-top:34px!important;margin-bottom:14px!important">${String(i + 1).padStart(2, '0')} / ${s.t}</h2>${s.b}`).join('\n');

            // "What we measure" — short mission intro + a definition card per selected
            // core KPI, coloured by the KPI, so a public reader understands the headlines.
            const coreMetricsInner = data.kpis.length === 0 ? '' : `
        <h3 class="sec-eyebrow mb-3">What we measure</h3>
        <p style="margin:0 0 20px;font-size:14px;color:#b6c4d2;line-height:1.65;max-width:780px;font-weight:300">At the Global Surgery Foundation, we work to ensure that every dollar donated drives meaningful, measurable change for people and communities in low- and middle-income countries. We track our progress against ${data.kpis.length === 1 ? 'this core indicator' : 'these core indicators'}:</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px">
            ${data.kpis.map(k => `<div style="border:1px solid ${k.color}40;border-radius:5px;padding:16px 18px;background:linear-gradient(150deg,${k.color}1F,#002033 65%)">
                <p style="margin:0 0 8px;font-family:var(--mono);font-size:11px;font-weight:700;color:${k.color};text-transform:uppercase;letter-spacing:.1em;line-height:1.3">${App.escapeHtml(k.nameBig || k.name)}${k.nameSub ? ' <span style="font-weight:400;text-transform:none;letter-spacing:0;color:'+k.color+';opacity:.85">'+App.escapeHtml(k.nameSub)+'</span>' : ''}</p>
                <p style="margin:0;font-size:12.5px;color:#b6c4d2;line-height:1.55;font-weight:300">${KPI_DEFS[k.id] || App.escapeHtml(k.nameSub || k.name)}</p>
            </div>`).join('')}`
            + `</div>`;

            const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${App.escapeHtml(dashboardTitle)} \u2014 SURGdash</title>
<script src="https://cdn.tailwindcss.com"><\/script>
<script>tailwind.config={theme:{extend:{colors:{'gsf-prussian':'#002F4C','gsf-boston':'#4389C8'}}}};<\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"><\/script>
${(data.surghub && data.surghub.countryMap) ? '<script src="https://www.gstatic.com/charts/loader.js"><\/script>' : ''}
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
/* ── Editorial theme · GSF brand type (Arial primary, Georgia secondary) ── */
:root{
  --bg:#001523;--surface:#002033;--surface2:#002a42;--border:#0a3a57;
  --ink:#eef4f9;--muted:#6d8ba3;--accent:#FFC145;--accent-soft:rgba(255,193,69,0.14);
  --serif:Georgia,'Times New Roman',serif;--mono:Arial,Helvetica,sans-serif;--sans:Arial,Helvetica,sans-serif;
}
*{box-sizing:border-box;}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);font-weight:400;line-height:1.6;background-image:radial-gradient(1100px 620px at 82% -8%, rgba(255,193,69,0.06), transparent 60%),radial-gradient(900px 560px at 8% 4%, rgba(4,104,177,0.10), transparent 60%),repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(255,255,255,0.012) 39px, rgba(255,255,255,0.012) 40px);background-attachment:fixed;}
h1,h2,h3,h4{font-family:var(--serif);}
.fade-in{animation:fadeIn .35s ease;}@keyframes fadeIn{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}
@keyframes fadeUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
/* Scroll-reveal — sections fade up as they enter the viewport.
   FAIL-SAFE: only below-the-fold elements are "armed" (hidden) by JS; everything
   else stays visible, so the page is never blank even if the observer never fires. */
.reveal.armed{opacity:0;transform:translateY(26px);transition:opacity .7s cubic-bezier(.4,0,.2,1), transform .7s cubic-bezier(.4,0,.2,1);}
.reveal.armed.in{opacity:1;transform:none;}
@media (prefers-reduced-motion: reduce){.reveal.armed{opacity:1!important;transform:none!important;transition:none!important;}}
/* Brand hero */
.gsf-hero{display:flex;align-items:center;gap:20px;flex-wrap:wrap;}
.gsf-hero img{height:66px;width:auto;filter:brightness(0) invert(1) drop-shadow(0 1px 5px rgba(0,0,0,.4));}
.gsf-hero h1{font-family:'Arial Black','Arial Bold',var(--sans)!important;font-weight:900!important;font-size:clamp(18px,2.1vw,25px)!important;line-height:1.1;letter-spacing:-0.01em;}
.gsf-hero h1 em{font-style:normal;color:var(--accent);}
.hero-eyebrow{font-family:var(--mono);font-size:10.5px;font-weight:500;letter-spacing:0.22em;text-transform:uppercase;color:var(--accent);margin:0 0 8px;}
.gsf-rule{border:none;border-top:1px solid var(--border);}
/* Section eyebrow (mono, gold, trailing rule) — matches "chapter-number" */
.sec-eyebrow{font-family:var(--mono)!important;font-size:10px!important;font-weight:700!important;letter-spacing:0.2em!important;text-transform:uppercase;color:var(--accent)!important;display:flex;align-items:center;gap:12px;margin-bottom:14px!important;}
.sec-eyebrow::after{content:'';height:1px;flex:1;max-width:120px;background:var(--accent);opacity:0.35;}
/* Year buttons */
.yr-btn{padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-family:var(--mono);font-size:12px;font-weight:500;letter-spacing:0.04em;background:transparent;color:var(--muted);transition:all .15s;}
.yr-btn:hover{background:rgba(255,255,255,.05);color:var(--ink);}
.yr-btn.active{background:var(--accent);color:#1a1200;font-weight:700;box-shadow:0 2px 12px rgba(255,193,69,.28);}
.yr-btn-all{margin-left:6px;padding:6px 14px;border:none;cursor:pointer;font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:0.04em;background:var(--accent-soft);color:var(--accent);border-radius:6px;transition:all .15s;position:relative;display:inline-flex;align-items:center;gap:5px;}
.yr-btn-all::before{content:'';position:absolute;left:-6px;top:20%;height:60%;width:1px;background:var(--border);}
.yr-btn-all:hover{background:rgba(255,193,69,0.24);}
.yr-btn-all.active-all{background:var(--accent);color:#1a1200;box-shadow:0 2px 14px rgba(255,193,69,0.4);}
.yr-btn-all .star{font-size:11px;opacity:0.85;}
.yr-btn-sm{padding:3px 9px;border-radius:5px;border:none;cursor:pointer;font-family:var(--mono);font-size:11px;font-weight:600;background:rgba(4,104,177,0.85);color:#fff;transition:all .15s;}
.yr-btn-sm.excluded{background:transparent;color:var(--muted);border:1px solid var(--border);}
.nav-back{display:inline-flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--border);cursor:pointer;border-radius:6px;padding:8px 16px;font-family:var(--mono);font-size:12px;letter-spacing:0.04em;color:var(--ink);font-weight:500;transition:all .15s;}
.nav-back:hover{background:var(--surface2);border-color:var(--accent);}
/* Cards */
.kpi-card{position:relative;border-radius:5px;padding:22px 20px 18px;border:1px solid var(--border);background:var(--surface);box-shadow:0 1px 3px rgba(0,0,0,0.4);transition:box-shadow .18s, transform .18s, border-color .18s;overflow:hidden;}
.kpi-card:hover{box-shadow:0 14px 34px rgba(0,0,0,0.5);transform:translateY(-2px);}
.kpi-card.clickable{cursor:pointer;}
.kpi-hint{margin:10px 0 0;font-family:var(--mono);font-size:8px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);opacity:0;transition:opacity .15s;}
.kpi-card:hover .kpi-hint{opacity:.75;}
/* KPI "what we measure" popup */
.kpi-modal{display:none;position:fixed;inset:0;background:rgba(0,8,16,0.74);backdrop-filter:blur(3px);z-index:2000;align-items:center;justify-content:center;padding:24px;animation:fadeIn .2s ease;}
.kpi-modal-box{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:8px;max-width:460px;width:100%;padding:28px 30px;box-shadow:0 24px 64px rgba(0,0,0,.6);}
.kpi-modal-x{position:absolute;top:12px;right:14px;background:none;border:none;color:var(--muted);font-size:24px;line-height:1;cursor:pointer;padding:2px 6px;}
.kpi-modal-x:hover{color:var(--ink);}
.kpi-modal-eyebrow{margin:0 0 10px;font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;}
.kpi-modal-title{margin:0 0 14px;font-family:var(--serif);font-size:23px;font-weight:700;color:var(--ink);line-height:1.2;}
.kpi-modal-body{margin:0;font-size:14px;color:#b6c4d2;line-height:1.65;font-weight:300;}
.kpi-card .accent{position:absolute;top:0;left:0;right:0;height:3px;}
.kpi-card .ttl{font-family:var(--mono);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;margin:0 0 3px;line-height:1.3;}
.kpi-card .sub{font-family:var(--mono);font-size:8.5px;color:var(--muted);font-weight:400;letter-spacing:.02em;margin:0 0 14px;line-height:1.35;text-transform:uppercase;}
.kpi-card .num{font-family:var(--serif);font-size:42px;font-weight:700;line-height:1;letter-spacing:-0.01em;font-variant-numeric:tabular-nums;}
.kpi-card .unit{font-family:var(--mono);font-size:10px;color:var(--muted);font-weight:400;letter-spacing:.05em;text-transform:uppercase;margin:6px 0 12px;}
.kpi-card .bar-wrap{display:flex;align-items:center;gap:8px;margin-bottom:4px;}
.kpi-card .bar-bg{flex:1;height:6px;border-radius:99px;background:rgba(255,255,255,.08);}
.kpi-card .bar-fg{height:6px;border-radius:99px;}
.kpi-card .pct{font-family:var(--mono);font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;}
.kpi-card .tgt{font-family:var(--mono);font-size:10px;color:var(--muted);margin:2px 0 0;}
.goal-chip{font-family:var(--mono);font-size:8px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:2px 7px;border-radius:99px;line-height:1.4;position:relative;top:-3px;}
.kpi-card .footer{font-family:var(--mono);font-size:10px;font-weight:500;letter-spacing:.04em;margin-top:14px;padding-top:10px;border-top:1px solid var(--border);opacity:0.85;}
.chart-card{background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.35);}
.proj-row:hover td{background:rgba(255,255,255,.04);}
.proj-row td{transition:background .1s;}
/* Project breakdown cards */
.proj-card{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:16px 18px;overflow:hidden;cursor:pointer;--pc:var(--accent);transition:transform .16s, box-shadow .16s, border-color .16s;min-height:80px;display:flex;align-items:center;}
.proj-card > div:last-child{width:100%;}
.proj-card:hover{transform:translateY(-2px);box-shadow:0 14px 32px rgba(0,0,0,0.5);border-color:var(--pc);}
.proj-card.ended{opacity:.5;}
.proj-card.ended:hover{opacity:1;}
.proj-card-accent{position:absolute;top:0;left:0;right:0;height:3px;}
.proj-card-name{margin:0;flex:1;min-width:0;font-size:13.5px;font-weight:700;color:#eef4f9;line-height:1.32;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
/* Permanent map labels (facility / location names) */
.leaflet-tooltip.map-lbl{background:rgba(0,21,35,0.9);border:1px solid var(--border);box-shadow:0 1px 4px rgba(0,0,0,0.6);color:var(--ink);font-family:var(--mono);font-size:9.5px;font-weight:500;letter-spacing:0.04em;padding:2px 6px;border-radius:4px;white-space:nowrap;}
.leaflet-tooltip.map-lbl:before{display:none;}
.no-lbls .leaflet-tooltip.map-lbl{display:none;}
.lbl-toggle{background:var(--surface);color:var(--ink);font-family:var(--mono);padding:4px 9px;border-radius:5px;font-size:10.5px;font-weight:500;letter-spacing:0.04em;cursor:pointer;display:flex;align-items:center;gap:5px;box-shadow:0 1px 4px rgba(0,0,0,.5);user-select:none;border:1px solid var(--border);}
.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:var(--surface2)!important;color:var(--ink)!important;box-shadow:0 4px 18px rgba(0,0,0,.5)!important;}
.leaflet-container a.leaflet-popup-close-button{color:var(--muted)!important;}
.leaflet-control-zoom a{background:var(--surface)!important;color:var(--ink)!important;border-color:var(--border)!important;}
/* Quality improvement chip row */
.qi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1px;background:var(--border);border:1px solid var(--border);border-radius:5px;overflow:hidden;}
.qi-card{position:relative;background:var(--surface);border:none;border-radius:0;padding:18px 16px;overflow:hidden;}
.qi-card .stripe{position:absolute;top:0;left:0;right:0;height:3px;}
.qi-card .lbl{font-family:var(--mono);font-size:10px;font-weight:700;color:var(--ink);text-transform:uppercase;letter-spacing:.1em;margin:0 0 10px;}
.qi-card .big{font-family:var(--serif);font-size:30px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1;}
.qi-card .lbl-sm{font-family:var(--mono);font-size:9px;font-weight:500;text-transform:uppercase;color:var(--muted);letter-spacing:.08em;}
.qi-card .row{display:flex;align-items:baseline;gap:6px;}
.qi-card .div{margin-top:10px;padding-top:10px;border-top:1px solid var(--border);}
.qi-card .arrow{display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:11px;color:var(--ink);margin-top:6px;font-variant-numeric:tabular-nums;}
/* ── Editorial overrides for the Tailwind utility classes in the static markup ── */
.bg-white{background:var(--surface)!important;}
.bg-slate-50,.bg-slate-100{background:var(--surface2)!important;}
.bg-amber-50{background:rgba(255,193,69,0.08)!important;}
.border,.border-b,.border-t,.border-slate-100,.border-slate-200{border-color:var(--border)!important;}
.border-amber-200{border-color:rgba(255,193,69,0.3)!important;}
.rounded-xl,.rounded-lg{border-radius:5px!important;}
.shadow-sm,.shadow{box-shadow:0 1px 3px rgba(0,0,0,0.35)!important;}
.text-\\[\\#002F4C\\]{color:var(--ink)!important;}
.border-\\[\\#002F4C\\]{border-color:var(--border)!important;}
.text-slate-800{color:var(--ink)!important;}
.text-slate-700{color:#d4dde7!important;}
.text-slate-600{color:#b6c4d2!important;}
.text-slate-500{color:var(--muted)!important;}
.text-slate-400{color:var(--muted)!important;}
.text-slate-300{color:#4f6378!important;}
.text-amber-700,.text-amber-800,.text-amber-600{color:var(--accent)!important;}
<\/style>
</head>
<body class="text-slate-800 min-h-screen">

${singleId ? '' : `<!-- ORG OVERVIEW PAGE -->
<div id="page-org" class="max-w-6xl mx-auto px-4 py-8 fade-in">
    ${external ? '' : `<div class="flex items-start gap-3 mb-6 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
        <span class="text-amber-600 font-black text-xs uppercase tracking-wider mt-0.5 shrink-0">\u26a0 Beta</span>
        <p class="text-sm text-amber-700">Exported from <strong>SURGdash (Beta)</strong>. Data reflects stored values at time of export. Verify against primary sources for official reporting.</p>
    </div>`}
    <div class="flex items-center justify-between flex-wrap gap-4 mb-6 pb-4 border-b-2 border-[#002F4C]">
        <div class="gsf-hero">
            ${gsfLogo ? `<a href="https://www.globalsurgeryfoundation.org" target="_blank" rel="noopener" title="globalsurgeryfoundation.org" style="display:inline-flex;flex-shrink:0"><img src="${gsfLogo}" alt="Global Surgery Foundation"></a>` : ''}
            <h1 class="text-[#002F4C] tracking-tight">Impact Data Dashboard<span style="display:inline-block;vertical-align:middle;margin-left:11px;position:relative;top:-2px;font-family:var(--mono);font-weight:700;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:var(--accent);border:1px solid var(--accent);border-radius:999px;padding:3px 9px">Beta</span></h1>
        </div>
        <div class="flex flex-col items-end gap-2.5">
            <div id="org-year-selector" class="flex items-center gap-1 bg-slate-100 rounded-xl p-1 flex-wrap"></div>
            ${external ? '' : '<div id="org-year-excl" class="flex items-center gap-1 flex-wrap" style="display:none!important"></div>'}
            <div class="flex items-center justify-end gap-3 flex-wrap">
                ${data.surghub ? `<button onclick="showSurghubPage()" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:7px 13px;font-family:var(--mono);font-size:11px;letter-spacing:0.06em;font-weight:500;color:var(--accent);cursor:pointer" title="SURGhub surgical education platform">SURGhub Platform &rarr;</button>` : ''}
                ${external ? `<button onclick="showMethodologyPage()" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:7px 13px;font-family:var(--mono);font-size:11px;letter-spacing:0.06em;font-weight:500;color:var(--accent);cursor:pointer" title="How these figures are collected & calculated">Methodology &rarr;</button>` : ''}
            </div>
        </div>
    </div>
    <div id="org-kpi-cards" class="reveal grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8"></div>
    <div id="org-charts-section" class="reveal mb-8">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:14px">
            <h2 class="sec-eyebrow" style="margin-bottom:0!important">Progress Over Time</h2>
            <div id="org-chart-controls"></div>
        </div>
        <div id="org-charts-grid" class="grid grid-cols-1 lg:grid-cols-2 gap-4"></div>
    </div>
    <div class="reveal mb-8">
        <h2 id="org-table-title" class="sec-eyebrow mb-4"></h2>
        <div id="org-project-table"></div>
    </div>
    <div id="org-map-section" class="reveal mb-8">
        <h2 class="sec-eyebrow mb-3">Project Locations</h2>
        <div id="org-map" style="height:420px;border-radius:5px;overflow:hidden;border:1px solid var(--border);background:#001020"></div>
    </div>
    ${(coreMetricsInner || external) ? `<div class="reveal bg-white border border-slate-200 rounded-xl px-6 py-5 mb-4 shadow-sm">
        ${coreMetricsInner}
        ${(coreMetricsInner && external) ? '<hr style="border:none;border-top:1px solid var(--border);margin:24px 0">' : ''}
        ${external ? `<h3 class="sec-eyebrow mb-3">Methodology &amp; Notes</h3>
        <p class="text-xs text-slate-600 leading-relaxed mb-2">
            <strong>What you see.</strong> Numbers are aggregated across the selected projects and years. Core indicators (healthcare workers strengthened, patients reached, facilities strengthened, population with improved surgical access) come from activity logs and quarterly returns.${hasQuality ? ' Quality indicators are quarterly cumulative figures collected from each supported facility.' : ''}
        </p>
        <p class="text-xs text-slate-600 leading-relaxed mb-2">
            Figures are <strong>actuals achieved</strong>. For the current and future years — where results aren't in yet — the figure shown is the year's <strong>goal</strong> (clearly labelled). This snapshot reports outcomes, so progress-against-target is not shown. Goals are set at the start of each year and may be revised mid-year following programme reviews.
        </p>
        <p class="text-xs text-amber-700 leading-relaxed bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-2">
            ⚠ <strong>Beta data &amp; selected datasets.</strong> This is a beta version of the GSF programme dashboard, and it shows <strong>selected data sets only — not all programme data</strong>. Figures are regularly updated and may differ slightly from the official final numbers while we continue testing and refining the methodology. For confirmed figures, please contact the GSF team.
        </p>
        <p class="text-xs text-slate-600" style="margin-top:18px"><button onclick="showMethodologyPage()" style="background:none;border:none;padding:0;color:var(--accent);font-weight:600;text-decoration:underline;cursor:pointer;font-size:inherit;font-family:var(--mono);letter-spacing:0.03em">Read the full methodology →</button></p>` : ''}
    </div>` : ''}
    <p class="text-center text-xs" style="font-family:var(--mono);letter-spacing:0.04em;margin-bottom:7px"><a href="https://www.globalsurgeryfoundation.org/impact#AnnualReports" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;font-weight:600">Read the GSF Annual Reports &rarr;</a></p>
    <p class="text-center text-xs text-slate-400" style="font-family:var(--mono);letter-spacing:0.04em">${data.generatedAt} &nbsp;&middot;&nbsp; SURGdash &copy; GSF${external ? '' : ' (Beta)'}</p>
</div>`}

${external ? `<!-- METHODOLOGY PAGE (external snapshots only) — full, in-file page reachable
     from the summary note on the org and per-project pages. -->
<div id="page-methodology" class="max-w-4xl mx-auto px-4 py-8 fade-in" style="display:none">
    <button class="nav-back" onclick="showOrgPage()" style="margin-bottom:18px">&#8592; Back to overview</button>
    <div class="border-b-2 border-[#002F4C] pb-4 mb-6">
        <h1 class="text-2xl font-black text-[#002F4C] tracking-tight">Methodology</h1>
        <p class="text-sm text-slate-500 mt-0.5">How the figures in this snapshot are collected, calculated, and reported.</p>
    </div>

    <div class="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 mb-6">
        <p class="text-sm text-amber-800 font-semibold mb-1">⚠ Beta data — read this first</p>
        <p class="text-xs text-amber-700 leading-relaxed">This snapshot is generated from a beta version of the GSF programme dashboard, and it includes <strong>selected data sets only — not all programme data</strong>. Data is updated continually and may differ slightly from the official final figures while the methodology is still being refined. For confirmed figures or queries about specific numbers, please contact the GSF team directly.</p>
    </div>

    ${methodologySectionsHtml}

    <p class="text-xs text-slate-500 italic mt-8 pt-4 border-t border-slate-200">Questions about a specific figure? Contact the GSF team using the address on the GSF letterhead.</p>
    <p class="text-center text-xs text-slate-400 mt-8">SURGdash &copy; GSF</p>
</div>` : ''}

<!-- PROJECT PAGES (one hidden div per project; filled by JS).
     For a single-project snapshot this is the ONLY page rendered. -->
${singleId ? data.projects.map(p => `<div id="page-proj-${p.id}"></div>`).join('\n') : projPageDivs}
${data.surghub ? '<div id="page-surghub" style="display:none"></div>' : ''}

<script>
var DATA = ${json};
var GSF_LOGO = ${JSON.stringify(gsfEmblem || '')};
var SURGHUB_LOGO = ${JSON.stringify(surghubLogo || '')};
var SURGFUND_LOGO = ${JSON.stringify(surgfundLogo || '')};
var fmt=function(n){return n!=null?new Intl.NumberFormat('en-US').format(n):'\u2014';};
var fmtShort=function(n){if(n==null)return'\u2014';if(n>=1e6)return(n/1e6).toFixed(1).replace(/\\.0$/,'')+' M';if(n>=1e3)return(n/1e3).toFixed(n>=1e4?0:1).replace(/\\.0$/,'')+' k';return String(n);};
// Headline KPI numbers: round millions to "12.4 M" so big figures (population)
// stay short; everything under a million keeps its full grouped form.
var fmtM=function(n){if(n==null)return'\u2014';if(n>=1e6)return(n/1e6).toFixed(1).replace(/\\.0$/,'')+' M';return fmt(n);};

// ── SCROLL-REVEAL ──
// Sections fade up as they scroll into view (one-shot per element). Fail-safe:
// only elements BELOW the fold are armed (hidden); on-screen content shows at
// once. A scroll listener backs up the IntersectionObserver in case its
// callbacks never fire, so content can never get stuck invisible.
var _revealObs=null,_revealScrollBound=false;
function _revealCheckArmed(){
    var vh=window.innerHeight||document.documentElement.clientHeight||800;
    var armed=document.querySelectorAll('.reveal.armed:not(.in)');
    for(var i=0;i<armed.length;i++){
        if(armed[i].getBoundingClientRect().top < vh*0.9){armed[i].classList.add('in');if(_revealObs)_revealObs.unobserve(armed[i]);}
    }
}
function _setupReveal(){
    var els=[].slice.call(document.querySelectorAll('.reveal:not(.in):not(.armed)'));
    if(!els.length)return;
    var vh=window.innerHeight||document.documentElement.clientHeight||800;
    if(!('IntersectionObserver' in window)){els.forEach(function(e){e.classList.add('in');});return;}
    if(!_revealObs){
        _revealObs=new IntersectionObserver(function(ents){
            ents.forEach(function(en){if(en.isIntersecting){en.target.classList.add('in');_revealObs.unobserve(en.target);}});
        },{root:null,rootMargin:'0px 0px -8% 0px',threshold:0.05});
    }
    els.forEach(function(e){
        // On-screen / above the fold → reveal immediately (never hide it).
        if(e.getBoundingClientRect().top < vh*0.9){e.classList.add('in');return;}
        e.classList.add('armed');
        _revealObs.observe(e);
    });
    if(!_revealScrollBound){
        _revealScrollBound=true;
        window.addEventListener('scroll',_revealCheckArmed,{passive:true});
        window.addEventListener('resize',_revealCheckArmed,{passive:true});
    }
}

// ── ORG STATE ──
// Snapshots default to "All time" view — gives the recipient the full impact at first glance.
// (The originally-selected year from the app UI is still available via the year-selector buttons.)
var orgYear='all';
var orgHiddenYears=[];
var orgShowActuals=true;
var orgShowTargets=true;

function orgIsHidden(y){return orgHiddenYears.indexOf(y)>=0;}

function orgSelectYear(y){orgYear=y;orgHiddenYears=[];renderOrg();}
function orgToggleYear(y){var i=orgHiddenYears.indexOf(y);if(i>=0)orgHiddenYears.splice(i,1);else orgHiddenYears.push(y);renderOrg();}
function orgToggleSeries(s){if(s==='a')orgShowActuals=!orgShowActuals;else orgShowTargets=!orgShowTargets;renderOrg();}

// Stock KPIs — values represent a state at a point in time (same catchment year
// after year), so summing across years double-counts. For multi-year totals we
// take the max-per-project then sum across projects. Flow KPIs (HCWs trained,
// patients reached) keep their normal across-years sum behaviour.
// External snapshots use this stock rule; the internal snapshot keeps the
// historical sum-everywhere behaviour (toggled by DATA.external).
var STOCK_KPIS = { facilities_strengthened: 1, population_access: 1 };
function _isStock(kid){ return DATA.external && !!STOCK_KPIS[kid]; }

function getOrgTotals(){
    var a={},t={};
    DATA.kpis.forEach(function(k){a[k.id]=0;t[k.id]=0;});
    DATA.projects.forEach(function(p){
        // Per-project across-year aggregation, then add to the org total.
        var per=_projectYearTotals(p);
        DATA.kpis.forEach(function(k){ a[k.id] += per.a[k.id]||0; t[k.id] += per.t[k.id]||0; });
    });
    return{a:a,t:t};
}

// One project's contribution for the current orgYear selection. Flow KPIs sum
// across years; stock KPIs take the max value observed (best estimate of total
// reach), so the same catchment isn't counted multiple times.
function _projectYearTotals(p){
    var pd=DATA.projectData[p.id]||{};
    var a={},t={};
    DATA.kpis.forEach(function(k){a[k.id]=0;t[k.id]=0;});
    if(orgYear==='all'){
        DATA.years.forEach(function(y){
            if(orgIsHidden(y))return;
            DATA.kpis.forEach(function(k){
                var av=((pd.actuals||{})[y]||{})[k.id]||0;
                var tv=((pd.targets||{})[y]||{})[k.id]||0;
                if(_isStock(k.id)){
                    if(av>a[k.id]) a[k.id]=av;
                    if(tv>t[k.id]) t[k.id]=tv;
                }else{
                    a[k.id]+=av; t[k.id]+=tv;
                }
            });
        });
    }else{
        DATA.kpis.forEach(function(k){
            a[k.id]=((pd.actuals||{})[orgYear]||{})[k.id]||0;
            t[k.id]=((pd.targets||{})[orgYear]||{})[k.id]||0;
        });
    }
    return{a:a,t:t};
}

// ── "What we measure" popup — opened by clicking a KPI card. ──
var _kpiEsc=function(e){if(e.key==='Escape')hideKpiInfo();};
function showKpiInfo(kid){
    var k=DATA.kpis.find(function(x){return x.id===kid;});
    if(!k||!k.def)return;
    var ov=document.getElementById('kpi-modal');
    if(!ov){ov=document.createElement('div');ov.id='kpi-modal';ov.className='kpi-modal';ov.addEventListener('click',function(e){if(e.target===ov)hideKpiInfo();});document.body.appendChild(ov);}
    ov.innerHTML='<div class="kpi-modal-box" style="border-top:3px solid '+k.color+'">'
        +'<button class="kpi-modal-x" onclick="hideKpiInfo()" aria-label="Close">&times;<\/button>'
        +'<p class="kpi-modal-eyebrow" style="color:'+k.color+'">What we measure<\/p>'
        +'<h3 class="kpi-modal-title">'+(k.nameBig||k.name)+(k.nameSub?' <span style="font-weight:400;color:#9fb3c8;font-size:16px">'+k.nameSub+'<\/span>':'')+'<\/h3>'
        +'<p class="kpi-modal-body">'+k.def+'<\/p>'
        +'<\/div>';
    ov.style.display='flex';
    document.addEventListener('keydown',_kpiEsc);
}
function hideKpiInfo(){var ov=document.getElementById('kpi-modal');if(ov)ov.style.display='none';document.removeEventListener('keydown',_kpiEsc);}

// ── Core KPI card — ACTUALS ONLY. Past/closed years and the all-time view show the
//    ACTUAL achieved; the current year and future years (where results aren't in yet)
//    show the year's GOAL instead, clearly labelled. Target-matching (progress bars /
//    percentages) is intentionally not shown — out of scope for this export.
function _kpiShell(kpi,inner,isGoal,cornerHTML){
    // Actual cards: solid filled, solid border. Goal cards: flatter fill + a
    // dashed outline so they read clearly as projected/aspirational at a glance.
    var box=isGoal
        ?'background:linear-gradient(150deg,'+kpi.color+'10,#001523 74%);border:1.6px dashed '+kpi.color+'80'
        :'background:linear-gradient(150deg,'+kpi.color+'24,#002033 60%);border:1px solid '+kpi.color+'40';
    var clickable=!!kpi.def;
    return'<div class="kpi-card'+(isGoal?' kpi-goal':'')+(clickable?' clickable':'')+'" style="'+box+'"'+(clickable?' onclick="showKpiInfo(&#39;'+kpi.id+'&#39;)"':'')+'>'
        +'<div class="accent" style="background:'+kpi.color+(isGoal?';opacity:.5;height:2px':'')+'"><\/div>'
        +(cornerHTML||'')
        +'<p class="ttl" style="color:'+kpi.color+';padding-right:74px">'+(kpi.nameBig||kpi.name)+'<\/p>'
        +(kpi.nameSub?'<p class="sub">'+kpi.nameSub+'<\/p>':'<div style="height:10px"><\/div>')
        +inner
        +(clickable?'<p class="kpi-hint">ⓘ What we measure<\/p>':'')
        +'<\/div>';
}
function _kpiCard(kpi,v,g,label,isAll,year){
    var c=kpi.color;
    var goalYear=!isAll && Number(year)>=new Date().getFullYear();   // current or future → show the goal
    var num=function(txt,style){return'<span class="num" style="color:'+c+(style?';'+style:'')+'">'+txt+'<\/span>';};
    // The period (and "Goal" for current/future years) sits in the top-right corner.
    var mutedCorner=function(t){return'<span style="position:absolute;top:13px;right:14px;font-family:var(--mono);font-size:8.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#6d8ba3">'+t+'<\/span>';};
    var goalCorner=function(t){return'<span class="goal-chip" style="position:absolute;top:11px;right:12px;background:'+c+'24;color:'+c+';border:1px dashed '+c+'80">'+t+'<\/span>';};
    var period=isAll?'All time':('In '+year);
    if(goalYear){
        // Goal numbers render in italic serif inside a dashed-outline card; the
        // corner badge merges the "Goal" flag with the year.
        var corner=(g>0)?goalCorner('Goal · '+year):mutedCorner(period);
        return _kpiShell(kpi,'<div style="display:flex;align-items:baseline;gap:7px;flex-wrap:wrap;margin-bottom:6px">'+num(g>0?fmtM(g):'—','font-style:italic;opacity:.72')+'<\/div>', true, corner);
    }
    return _kpiShell(kpi,'<div style="display:flex;align-items:baseline;gap:7px;flex-wrap:wrap;margin-bottom:6px">'+num(v>0?fmtM(v):'—')+'<\/div>', false, mutedCorner(period));
}

function renderOrg(){
    var isAll=orgYear==='all';
    // Year selector
    var ySel=document.getElementById('org-year-selector');
    ySel.innerHTML=DATA.years.map(function(y){
        return '<button class="yr-btn'+(y===orgYear?' active':'')+'" onclick="orgSelectYear('+y+')">'+y+'<\/button>';
    }).join('')+'<button class="yr-btn-all'+(isAll?' active-all':'')+'" onclick="orgSelectYear(&#39;all&#39;)" title="Show all-time totals across every year"><span class="star">★<\/span> All time<\/button>';
    // Exclude chips: only shown in internal (non-external) snapshots.
    var yExcl=document.getElementById('org-year-excl');
    if(yExcl){
        if(isAll&&DATA.years.length>1){
            yExcl.style.cssText='';
            yExcl.innerHTML='<span style="font-size:10px;color:#6d8ba3;font-weight:700;text-transform:uppercase;margin-right:4px;">Exclude:<\/span>'
                +DATA.years.map(function(y){return'<button class="yr-btn-sm'+(orgIsHidden(y)?' excluded':'')+'" onclick="orgToggleYear('+y+')">'+y+'<\/button>';}).join('');
        }else{yExcl.style.cssText='display:none!important';}
    }

    // KPI cards
    var tot=getOrgTotals();
    var label=isAll?'\u2014 all time':'in '+orgYear;
    // Headline-target view: for the current year or later AND for "All time"
    // (where summing actuals across past + future is misleading), the target
    // becomes the headline number; the actual moves to the secondary line.
    // Only past-year single-year views keep actuals as the headline.
    document.getElementById('org-kpi-cards').innerHTML=DATA.kpis.map(function(kpi){
        return _kpiCard(kpi, tot.a[kpi.id]||0, tot.t[kpi.id]||0, label, isAll, orgYear);
    }).join('');

    // Project table \u2014 actuals only; for the current/future year the figures are goals.
    var goalYear=!isAll && Number(orgYear)>=new Date().getFullYear();
    document.getElementById('org-table-title').textContent='Projects';
    var NOW=new Date();
    // Each visible project renders as a card in a responsive grid; hidden projects
    // still roll into the totals shown at the top. Projects whose active period has
    // ended are faded back.
    var cards=DATA.projects.map(function(p){
        if (p._visible === false) return '';
        var ended=p.endDate && new Date(p.endDate) < NOW;
        // KPI-card styling: a subtle gradient wash (no top bar) tinted by the project's
        // programme colour, so same-programme projects share the same tint. Symbol is neutral.
        var gc=(p.programmeColor||p.color||'#4389C8');
        return'<div class="proj-card'+(ended?' ended':'')+'" data-pid="'+p.id+'" onclick="showProjectPage(this.dataset.pid)" style="--pc:'+gc+';background:linear-gradient(155deg,'+gc+'3d,'+gc+'10 50%,#001a2b 88%)">'
            +'<div style="display:flex;align-items:center;gap:11px">'
            +(p.programmeIcon
                ? '<span title="'+(p.programmeName||'').replace(/"/g,'&quot;')+'" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:7px;background:rgba(255,255,255,0.06);flex-shrink:0"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#9fb4c9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+p.programmeIcon+'<\/svg><\/span>'
                : '<span style="width:9px;height:9px;border-radius:3px;background:#6d8ba3;flex-shrink:0"><\/span>')
            +'<p class="proj-card-name" title="'+(p.name||'').replace(/"/g,'&quot;')+'">'+p.name+'<\/p>'
            +(ended?'<span style="font-family:var(--mono);font-size:7.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6d8ba3;border:1px solid var(--border);border-radius:99px;padding:2px 7px;flex-shrink:0;white-space:nowrap">Completed<\/span>':'<span style="color:#3f5870;font-size:16px;line-height:1;flex-shrink:0">›<\/span>')
            +'<\/div><\/div>';
    }).filter(function(c){return c;});
    // SURGhub platform tile in the directory (links to the dedicated page).
    if(DATA.surghub){
        // SURGhub is the learning platform, not a SURGfund field project — give it a
        // distinct gold treatment + a "Platform" tag so it stands apart from the cards above.
        cards.push('<div class="proj-card" onclick="showSurghubPage()" style="--pc:#FFC145;border:1px solid #FFC14540;background:linear-gradient(155deg,#FFC14526,#FFC1450a 52%,#001a2b 90%)">'
            +'<div style="display:flex;align-items:center;gap:11px">'
            +'<span title="SURGhub" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:7px;background:#FFC14524;flex-shrink:0"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#FFC145" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/><\/svg><\/span>'
            +'<p class="proj-card-name">SURGhub — Learning Platform<\/p>'
            +'<span style="font-family:var(--mono);font-size:7.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#FFC145;border:1px solid #FFC14559;border-radius:99px;padding:2px 8px;flex-shrink:0;white-space:nowrap">Platform<\/span>'
            +'<\/div><\/div>');
    }
    // Programme legend: the full GSF programme key. Each symbol is tinted with its
    // programme colour — matching the gradient wash used on the project cards above.
    var _legendItems=(DATA.programmes||[]).map(function(pr){
        var pc=pr.color||'#8aa0b6';
        return '<span style="display:inline-flex;align-items:center;gap:6px">'
            +'<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:5px;background:'+pc+'26;flex-shrink:0"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="'+pc+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+pr.svg+'<\/svg><\/span>'
            +'<span style="font-family:var(--mono);font-size:10px;letter-spacing:.04em;color:#9fb4c9">'+pr.name+'<\/span>'
            +'<\/span>';
    });
    var legendHTML=_legendItems.length?'<div style="display:flex;flex-wrap:wrap;gap:18px;align-items:center;margin-top:16px;padding-top:14px;border-top:1px solid var(--border)"><span style="font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6d8ba3;margin-right:2px">Programmes<\/span>'+_legendItems.join('')+'<\/div>':'';
    document.getElementById('org-project-table').innerHTML=
        (cards.length?'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px">'+cards.join('')+'<\/div>'+legendHTML:'<p style="font-family:var(--mono);font-size:11px;color:#6d8ba3">No projects to display.<\/p>')

    // Org charts
    drawOrgCharts();
    _setupReveal();
}

// ── CHART.JS HELPERS (modern, sleek styling) ──
var CHART_TXT='#7d96ad', CHART_GRID='rgba(255,255,255,0.05)', CHART_FONT="Arial, Helvetica, sans-serif";
function _hexA(hex,a){var h=String(hex).replace('#','');if(h.length===3)h=h.split('').map(function(x){return x+x;}).join('');var r=parseInt(h.substr(0,2),16),g=parseInt(h.substr(2,2),16),b=parseInt(h.substr(4,2),16);return 'rgba('+r+','+g+','+b+','+a+')';}
function _canvasCtx(el){el.style.position='relative';el.innerHTML='<canvas><\/canvas>';return el.querySelector('canvas').getContext('2d');}
function _barFill(color){return function(c){var ch=c.chart,a=ch.chartArea;if(!a)return _hexA(color,0.85);var g=ch.ctx.createLinearGradient(0,a.top,0,a.bottom);g.addColorStop(0,_hexA(color,0.98));g.addColorStop(1,_hexA(color,0.32));return g;};}
function _areaFill(color){return function(c){var ch=c.chart,a=ch.chartArea;if(!a)return _hexA(color,0.12);var g=ch.ctx.createLinearGradient(0,a.top,0,a.bottom);g.addColorStop(0,_hexA(color,0.34));g.addColorStop(1,_hexA(color,0.02));return g;};}
function _tooltipCfg(){return {backgroundColor:'#002a42',titleColor:'#eef4f9',bodyColor:'#cfe0f1',borderColor:'#0a3a57',borderWidth:1,padding:10,cornerRadius:6,displayColors:true,usePointStyle:true,boxPadding:5,titleFont:{family:CHART_FONT,weight:'700',size:11},bodyFont:{family:CHART_FONT,size:12}};}
function _legendCfg(show){return {display:!!show,position:'top',align:'end',labels:{boxWidth:8,boxHeight:8,usePointStyle:true,pointStyle:'circle',color:CHART_TXT,font:{family:CHART_FONT,size:11},padding:14}};}
function _xScale(){return {grid:{display:false},border:{display:false},ticks:{color:CHART_TXT,font:{family:CHART_FONT,size:11},padding:6}};}
function _yScale(fmtFn){return {beginAtZero:true,grid:{color:CHART_GRID,drawTicks:false},border:{display:false},ticks:{color:CHART_TXT,font:{family:CHART_FONT,size:10},padding:10,maxTicksLimit:5,callback:function(v){return (fmtFn||fmtShort)(v);}}};}
// Draws the value above each bar (replaces Google's annotations) — keeps the
// static snapshot readable without hover. Goal-year labels render italic + tinted.
var _barValuePlugin={id:'barValue',afterDatasetsDraw:function(chart,a,opts){var ctx=chart.ctx;var gf=(opts&&opts.goalFlags)||[];chart.data.datasets.forEach(function(d,di){if(d.type==='line')return;var meta=chart.getDatasetMeta(di);if(meta.hidden)return;ctx.save();ctx.textAlign='center';ctx.textBaseline='bottom';meta.data.forEach(function(bar,i){var v=d.data[i];if(v==null||v===0)return;var isG=gf[i];ctx.font=(isG?'italic 700 10px ':'700 10px ')+CHART_FONT;ctx.fillStyle=isG?((opts&&opts.color)||'#c7d0db'):'#c7d0db';ctx.fillText((opts&&opts.fmt?opts.fmt(v):v),bar.x,bar.y-5);});ctx.restore();});}};
// Subtly marks a project's active window on its charts: a faint highlight band over
// the years the project ran, with a dashed start/end boundary line + tiny label shown
// only where an out-of-period year is actually visible on that side. Years outside the
// active window also get dimmed axis labels (handled in _drawKpiBars). No-op unless an
// active-flag array is supplied (org charts never pass one).
var _lifecyclePlugin={id:'lifecycle',beforeDatasetsDraw:function(chart,a,opts){
    if(!opts||!opts.active)return;
    var active=opts.active,n=active.length;var xs=chart.scales.x,area=chart.chartArea;if(!xs||!area)return;
    var first=-1,last=-1,i;for(i=0;i<n;i++){if(active[i]){if(first<0)first=i;last=i;}}
    if(first<0)return;                       // project never active in the shown range
    if(first===0&&last===n-1)return;          // active across the whole range: nothing to mark
    var step=(n>1)?Math.abs(xs.getPixelForValue(1)-xs.getPixelForValue(0)):(area.right-area.left);
    var half=step/2;
    var left=Math.max(area.left,xs.getPixelForValue(first)-half);
    var right=Math.min(area.right,xs.getPixelForValue(last)+half);
    var ctx=chart.ctx;ctx.save();
    ctx.fillStyle='rgba(255,255,255,0.035)';
    ctx.fillRect(left,area.top,right-left,area.bottom-area.top);
    ctx.setLineDash([3,3]);ctx.lineWidth=1;ctx.strokeStyle='rgba(159,179,200,0.32)';
    ctx.font='700 8px '+CHART_FONT;ctx.fillStyle='rgba(159,179,200,0.6)';ctx.textBaseline='top';
    if(first>0){ctx.beginPath();ctx.moveTo(left,area.top);ctx.lineTo(left,area.bottom);ctx.stroke();ctx.textAlign='left';ctx.fillText('STARTED',left+5,area.top+1);}
    if(last<n-1){ctx.beginPath();ctx.moveTo(right,area.top);ctx.lineTo(right,area.bottom);ctx.stroke();ctx.textAlign='right';ctx.fillText('ENDED',right-5,area.top+1);}
    ctx.restore();
}};
// One bar per year: past years show the solid actual, the current/future years show an
// outlined goal bar. On project pages an optional life arg adds the subtle active-
// period band + start/end markers (see _lifecyclePlugin) and dims inactive-year labels.
function _drawKpiBars(el,kpi,labels,actuals,targets,goalFlags,life){
    var data=goalFlags.map(function(g,i){return g?targets[i]:actuals[i];});
    var xScale=_xScale();
    if(life&&life.active){xScale.ticks=Object.assign({},xScale.ticks,{color:function(c){return life.active[c.index]?CHART_TXT:'rgba(125,150,173,0.4)';}});}
    new Chart(_canvasCtx(el),{type:'bar',data:{labels:labels,datasets:[{
        label:(kpi.nameBig||kpi.name),data:data,
        backgroundColor:function(c){var i=c.dataIndex,a=c.chart.chartArea;if(goalFlags[i])return _hexA(kpi.color,0.16);if(!a)return _hexA(kpi.color,0.85);var g=c.chart.ctx.createLinearGradient(0,a.top,0,a.bottom);g.addColorStop(0,_hexA(kpi.color,0.98));g.addColorStop(1,_hexA(kpi.color,0.32));return g;},
        hoverBackgroundColor:function(c){return goalFlags[c.dataIndex]?_hexA(kpi.color,0.28):_hexA(kpi.color,1);},
        borderColor:function(c){return goalFlags[c.dataIndex]?_hexA(kpi.color,0.95):'transparent';},
        borderWidth:goalFlags.map(function(g){return g?1.5:0;}),
        borderRadius:6,borderSkipped:false,maxBarThickness:54,categoryPercentage:0.64,barPercentage:0.82
    }]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:18,right:6,left:2,bottom:0}},plugins:{legend:{display:false},tooltip:_tooltipCfg(),barValue:{fmt:fmtShort,goalFlags:goalFlags,color:kpi.color},lifecycle:life||{}},scales:{x:xScale,y:_yScale(fmtShort)},animation:{duration:600,easing:'easeOutQuart'}},plugins:[_barValuePlugin,_lifecyclePlugin]});
}
// Small caption explaining the solid (actuals) vs outlined (goal) bars.
function _chartCaption(){return '<p style="margin:0;font-family:var(--mono);font-size:9.5px;letter-spacing:.05em;color:#6d8ba3;text-transform:uppercase;display:flex;align-items:center;gap:6px;flex-wrap:wrap">'
    +'<span style="display:inline-block;width:11px;height:11px;border-radius:2px;background:'+_hexA('#8aa0b6',0.85)+'"><\/span>Actual'
    +'<span style="display:inline-block;width:11px;height:11px;border-radius:2px;border:1.5px solid #8aa0b6;background:'+_hexA('#8aa0b6',0.16)+';margin-left:12px"><\/span>Goal<\/p>';}

function drawOrgCharts(){
    var grid=document.getElementById('org-charts-grid');
    if(DATA.years.length<2){grid.innerHTML='';document.getElementById('org-charts-section').style.display='none';return;}
    document.getElementById('org-charts-section').style.display='';
    var ctrl=document.getElementById('org-chart-controls');
    if(ctrl)ctrl.innerHTML=_chartCaption();
    grid.innerHTML=DATA.kpis.map(function(k){
        return'<div class="chart-card"><p style="margin:0 0 14px;font-family:var(--mono);font-size:10px;font-weight:700;color:#6d8ba3;text-transform:uppercase;letter-spacing:.14em">'+(k.nameBig||k.name)+'<\/p><div id="ochart-'+k.id+'" style="position:relative;height:230px"><\/div><\/div>';
    }).join('');
    setTimeout(function(){
        var NOW=new Date().getFullYear();
        var visYears=DATA.years.filter(function(yr){return !orgIsHidden(yr);});
        var labels=visYears.map(String);
        var goalFlags=visYears.map(function(yr){return Number(yr)>=NOW;});
        DATA.kpis.forEach(function(kpi){
            var el=document.getElementById('ochart-'+kpi.id);if(!el)return;
            var actuals=[],targets=[];
            visYears.forEach(function(yr){
                var aSum=0,tSum=0;
                DATA.projects.forEach(function(p){var pd=DATA.projectData[p.id]||{};aSum+=((pd.actuals||{})[yr]||{})[kpi.id]||0;tSum+=((pd.targets||{})[yr]||{})[kpi.id]||0;});
                var future=Number(yr)>=NOW;
                actuals.push((!future&&aSum>0)?aSum:null);   // actual bar on past years only
                targets.push(tSum>0?tSum:null);              // target/goal bar on every year
            });
            _drawKpiBars(el,kpi,labels,actuals,targets,goalFlags);
        });
    },30);
}

// ── PROJECT STATE ──
var projYear='all';
var projId=null;
var projHiddenYears=[];
var projShowActuals=true;
var projShowTargets=true;

function projIsHidden(y){return projHiddenYears.indexOf(y)>=0;}
function projSelectYear(y){projYear=y;projHiddenYears=[];renderProjectPage(projId);}
function projToggleYear(y){var i=projHiddenYears.indexOf(y);if(i>=0)projHiddenYears.splice(i,1);else projHiddenYears.push(y);renderProjectPage(projId);}
function projToggleSeries(s){if(s==='a')projShowActuals=!projShowActuals;else projShowTargets=!projShowTargets;renderProjectPage(projId);}

function _hideAllPages(){
    var orgEl=document.getElementById('page-org'); if(orgEl) orgEl.style.display='none';
    var mEl=document.getElementById('page-methodology'); if(mEl) mEl.style.display='none';
    var sEl=document.getElementById('page-surghub'); if(sEl) sEl.style.display='none';
    DATA.projects.forEach(function(p){var el=document.getElementById('page-proj-'+p.id);if(el)el.style.display='none';});
}

function showProjectPage(pid){
    projId=pid;
    projYear=orgYear;
    projHiddenYears=orgHiddenYears.slice();
    _hideAllPages();
    var pEl=document.getElementById('page-proj-'+pid);
    if(pEl) pEl.style.display='';
    renderProjectPage(pid);
    window.scrollTo(0,0);
}

function showOrgPage(){
    var orgEl=document.getElementById('page-org');
    if(!orgEl) return; // single-project snapshot — no org page exists
    _hideAllPages();
    orgEl.style.display='';
    window.scrollTo(0,0);
}

function showMethodologyPage(){
    var mEl=document.getElementById('page-methodology');
    if(!mEl) return;
    _hideAllPages();
    mEl.style.display='';
    window.scrollTo(0,0);
}

// ── SURGHUB PLATFORM PAGE ──
function showSurghubPage(){
    _hideAllPages();
    var el=document.getElementById('page-surghub'); if(!el) return;
    el.style.display='';            // make visible before drawing so charts size correctly
    renderSurghub();
    window.scrollTo(0,0);
}
// Month key "YYYY-MM" -> "Jan '23" for chart axes (real apostrophe via double-quoted string).
function _mLabel(m){var p=String(m).split('-');var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];var mo=+p[1];return (mo>=1&&mo<=12?MON[mo-1]:'')+" '"+String(p[0]).slice(2);}
// Cumulative growth line (area fill) for the SURGhub charts.
function _drawGrowthLine(el,label,series,color){
    if(!el) return;
    if(!series||!series.length){el.innerHTML='<p style="text-align:center;color:#6d8ba3;font-size:12px;padding:90px 0">No data<\/p>';return;}
    var labels=series.map(function(p){return _mLabel(p.m);});
    var data=series.map(function(p){return p.v;});
    new Chart(_canvasCtx(el),{type:'line',data:{labels:labels,datasets:[{
        label:label,data:data,borderColor:color,borderWidth:2.5,backgroundColor:_areaFill(color),fill:true,tension:0.32,
        pointRadius:0,pointHoverRadius:4,pointBackgroundColor:color,pointBorderColor:'#001523',pointBorderWidth:1.5
    }]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:10,right:10,left:2,bottom:0}},
        interaction:{mode:'index',intersect:false},
        plugins:{legend:{display:false},tooltip:Object.assign({},_tooltipCfg(),{mode:'index',intersect:false,callbacks:{label:function(c){return ' '+label+': '+fmt(c.parsed.y);}}})},
        scales:{x:Object.assign(_xScale(),{ticks:Object.assign({},_xScale().ticks,{maxTicksLimit:8,autoSkip:true,maxRotation:0})}),y:_yScale(fmtShort)},
        animation:{duration:700,easing:'easeOutQuart'}}});
}
function renderSurghub(){
    var el=document.getElementById('page-surghub'); if(!el) return;
    var s=DATA.surghub; if(!s){el.innerHTML='';return;}
    function card(label,sub,value,color){
        return '<div style="position:relative;background:linear-gradient(160deg,'+color+'14,#001a2b 72%);border:1px solid var(--border);border-radius:5px;padding:18px 18px 20px;overflow:hidden">'
            +'<div style="position:absolute;top:0;left:0;right:0;height:3px;background:'+color+'"><\/div>'
            +'<p style="margin:0;font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:'+color+'">'+label+'<\/p>'
            +(sub?'<p style="margin:2px 0 0;font-family:var(--mono);font-size:8.5px;letter-spacing:.04em;text-transform:uppercase;color:#6d8ba3">'+sub+'<\/p>':'')
            +'<p style="margin:14px 0 0;font-family:var(--serif);font-size:32px;font-weight:700;color:#eef4f9;line-height:1">'+fmt(value)+'<\/p>'
            +'<\/div>';
    }
    var cards=[
        card('Learners','Unique people',s.learners,'#4389C8'),
        card('Courses Completed','Certificates awarded',s.certificates,'#FFC145'),
        card('Learners','Course learners',s.enrolments,'#5AA9E6'),
        card('Countries/Territories','Reached',s.countries,'#3FB984'),
        card('Courses','Live on platform',s.courses,'#A78BFA')
    ].join('');
    var hasOrg=!!document.getElementById('page-org');
    var hdrBack='<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px">'
        +(hasOrg?'<button class="nav-back" onclick="showOrgPage()">&#8592; Overview<\/button>':'<span><\/span>')
        +(GSF_LOGO?'<a href="https://www.globalsurgeryfoundation.org" target="_blank" rel="noopener" title="globalsurgeryfoundation.org"><img src="'+GSF_LOGO+'" alt="GSF" style="height:34px;width:auto;filter:brightness(0) invert(1);opacity:.92"><\/a>':'')
        +'<\/div>';
    el.innerHTML='<div style="max-width:1100px;margin:0 auto;padding:28px 24px" class="fade-in">'
        +hdrBack
        +'<div style="border:1px solid #0a3a57;border-radius:5px;padding:22px 24px;margin-bottom:24px;background:linear-gradient(135deg,#4389C80D,#002033 62%);display:flex;align-items:center;justify-content:space-between;gap:34px;flex-wrap:wrap">'
        +'<div style="min-width:0;flex:1;max-width:900px">'
            +'<p style="margin:0 0 5px;font-family:var(--mono);font-size:9px;font-weight:500;letter-spacing:.22em;text-transform:uppercase;color:var(--accent)">United Nations Global Surgery Learning Hub<\/p>'
            +'<h1 style="margin:0;font-family:var(--serif);font-size:30px;font-weight:700;color:#eef4f9;line-height:1.12;letter-spacing:-0.01em">SURGhub<\/h1>'
            +'<p style="margin:12px 0 0;font-family:var(--mono);font-size:10.5px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:#6d8ba3;display:inline-flex;align-items:center;gap:7px"><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:#4389C8;flex-shrink:0"><\/span>Launched June 2023<\/p>'
            +'<p style="margin:14px 0 0;font-size:13.5px;color:#9fb3c8;line-height:1.65;font-weight:300">The United Nations Global Surgery Learning Hub (SURGhub) is the premier training platform in global surgical care. A joint initiative of the Global Surgery Foundation (GSF) and the United Nations Institute for Training and Research (UNITAR), supported by the Royal College of Surgeons in Ireland (RCSI) and implemented in association with the Johnson &amp; Johnson Foundation.<\/p>'
            +'<div style="margin:16px 0 0;display:flex;flex-wrap:wrap;gap:10px 22px;align-items:center">'
                +'<a href="https://surghub.org" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:11px;letter-spacing:.04em;color:var(--accent);text-decoration:none">Visit surghub.org &#8599;<\/a>'
                +'<a href="https://www.globalsurgeryfoundation.org/surghub" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:11px;letter-spacing:.04em;color:var(--accent);text-decoration:none">SURGhub on the GSF website &#8599;<\/a>'
            +'<\/div>'
        +'<\/div>'
        +(SURGHUB_LOGO ? '<img src="'+SURGHUB_LOGO+'" alt="SURGhub" style="height:90px;width:auto;flex-shrink:0;filter:brightness(0) invert(1)">' : '')
        +'<\/div>'
        +'<div class="reveal" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:28px">'+cards+'<\/div>'
        +(s.surveyImpact?(
            '<div class="reveal" style="margin:0 0 28px;border:1px solid #FFC14538;border-radius:5px;padding:18px 22px;background:linear-gradient(135deg,#FFC14512,#001a2b 70%)">'
            +'<p style="margin:0 0 14px;font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--accent)">Learning Impact<\/p>'
            +'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px">'
            +(s.surveyImpact.contentNew?(
                '<div><p style="margin:0 0 8px;font-family:var(--mono);font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#9fb3c8">New Knowledge<\/p>'
                +'<span style="font-family:var(--serif);font-size:36px;font-weight:700;color:var(--accent);line-height:1">'+s.surveyImpact.contentNew.pct+'%<\/span>'
                +'<p style="margin:6px 0 0;font-size:12.5px;color:#9fb3c8;line-height:1.5">of surveyed learners said the course content was <strong style="color:#eef4f9">new to them<\/strong><\/p><\/div>'
            ):'')
            +(s.surveyImpact.willApply?(
                '<div><p style="margin:0 0 8px;font-family:var(--mono);font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#9fb3c8">Intent to Apply<\/p>'
                +'<span style="font-family:var(--serif);font-size:36px;font-weight:700;color:var(--accent);line-height:1">'+s.surveyImpact.willApply.pct+'%<\/span>'
                +'<p style="margin:6px 0 0;font-size:12.5px;color:#9fb3c8;line-height:1.5">say they are <strong style="color:#eef4f9">likely to apply<\/strong> what they learned in their work<\/p><\/div>'
            ):'')
            +'<\/div>'
            +(function(){
                var ns=[];
                if(s.surveyImpact.contentNew)ns.push(s.surveyImpact.contentNew.n);
                if(s.surveyImpact.willApply)ns.push(s.surveyImpact.willApply.n);
                if(!ns.length)return '';
                var bn=Math.min.apply(null,ns);
                var rounded=bn>=1000?Math.floor(bn/1000)*1000:Math.floor(bn/100)*100;
                return '<p style="margin:14px 0 0;font-family:var(--mono);font-size:9px;letter-spacing:.06em;color:#54708a;text-transform:uppercase">Based on '+fmt(rounded)+'+ surveys<\/p>';
            })()
            +'<\/div>'
        ):'')
        +'<div class="reveal" style="margin-bottom:10px"><h2 style="margin:0;font-family:var(--mono);font-size:10px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.2em">Growth Over Time<\/h2><\/div>'
        +'<div class="reveal" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px">'
            +'<div class="chart-card"><p style="margin:0 0 14px;font-family:var(--mono);font-size:10px;font-weight:700;color:#6d8ba3;text-transform:uppercase;letter-spacing:.14em">Learners<\/p><div id="shub-learners" style="position:relative;height:280px"><\/div><\/div>'
            +'<div class="chart-card"><p style="margin:0 0 14px;font-family:var(--mono);font-size:10px;font-weight:700;color:#6d8ba3;text-transform:uppercase;letter-spacing:.14em">Courses Completed<\/p><div id="shub-certs" style="position:relative;height:280px"><\/div><\/div>'
        +'<\/div>'
        +(s.countryMap?(
            '<div class="reveal" style="margin:32px 0 10px"><h2 style="margin:0;font-family:var(--mono);font-size:10px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.2em">Learners by Country<\/h2><\/div>'
            +'<div class="chart-card" style="padding:16px 16px 18px;background:radial-gradient(135% 150% at 50% -18%, #0d3454 0%, #021726 70%)"><div id="shub-map" style="width:100%;height:470px;opacity:0.9"><\/div><div id="shub-map-legend" style="margin-top:8px"><\/div><\/div>'
        ):'')
        +'<p style="margin:22px 0 0;font-family:var(--mono);font-size:9.5px;letter-spacing:.04em;color:#6d8ba3;text-transform:uppercase">Cumulative totals · SURGhub platform data<\/p>'
        +'<\/div>';
    _drawGrowthLine(document.getElementById('shub-learners'),'Learners',s.learnersSeries,'#4389C8');
    _drawGrowthLine(document.getElementById('shub-certs'),'Courses completed',s.certsSeries,'#FFC145');
    if(s.countryMap) _drawCountryMap('shub-map',s.countryMap);
}
// Country choropleth (Google GeoChart) for the SURGhub page. ISO alpha-2 keyed counts.
// Retries until the gstatic loader is ready; degrades to a notice if offline.
function _drawCountryMap(elId,iso,tries){
    var el=document.getElementById(elId); if(!el||!iso) return;
    tries=tries||0;
    if(typeof google==='undefined'||!google.charts||!google.charts.load){
        if(tries<40){setTimeout(function(){_drawCountryMap(elId,iso,tries+1);},150);}
        else{el.innerHTML='<p style="text-align:center;color:#6d8ba3;font-size:12px;padding:200px 0">Country map unavailable offline<\/p>';}
        return;
    }
    google.charts.load('current',{packages:['geochart']});
    google.charts.setOnLoadCallback(function(){
        if(!google.visualization||!google.visualization.GeoChart){el.innerHTML='<p style="text-align:center;color:#6d8ba3;font-size:12px;padding:200px 0">Country map unavailable<\/p>';return;}
        // Colour each country by its SHARE of total learners (not raw counts).
        var total=0,pairs=[];
        for(var k in iso){if(Object.prototype.hasOwnProperty.call(iso,k)){var v=Number(iso[k])||0;if(v>0){total+=v;pairs.push([k,v]);}}}
        if(total<=0||!pairs.length){el.innerHTML='<p style="text-align:center;color:#6d8ba3;font-size:12px;padding:200px 0">No country data<\/p>';return;}
        var fmtPct=function(p){return p>=10?Math.round(p)+'%':(p>=1?p.toFixed(1)+'%':p.toFixed(2)+'%');};
        var dt=new google.visualization.DataTable();
        dt.addColumn('string','Country');dt.addColumn('number','Share of learners (%)');
        var pcts=[];
        pairs.forEach(function(pr){var pct=pr[1]/total*100;pcts.push(pct);dt.addRow([pr[0],Math.round(pct*100)/100]);});
        pcts.sort(function(a,b){return a-b;});
        // LOG colour scale. Shares span orders of magnitude (a handful of countries are
        // many times bigger than the rest), so a log ramp spreads the many small countries
        // into a smooth gradient and stops the big ones from flattening everything else.
        // Breakpoints are placed at log-even VALUES (real %, so tooltip/legend stay honest);
        // a mostly-blue ramp only tips into gold at the very top. GeoChart needs solid hex.
        var maxPct=pcts[pcts.length-1];
        var minPct=pcts[0];
        var lo=Math.max(minPct||0.001, maxPct/316);   // floor the low end to ~2.5 decades
        var ramp=['#123a5c','#1a5485','#2474b3','#3f97d6','#74bce9','#bce3fb'];
        var values=[];
        var canLog=(maxPct>lo&&lo>0);
        if(canLog){var rr=maxPct/lo;for(var ci=0;ci<ramp.length;ci++){values.push(lo*Math.pow(rr,ci/(ramp.length-1)));}}
        var colorAxis=canLog?{values:values,colors:ramp}:{minValue:0,colors:['#1d5e90','#62a8df','#FFC145']};
        var opts={backgroundColor:'transparent',datalessRegionColor:'#0b2c46',defaultColor:'#0b2c46',colorAxis:colorAxis,legend:'none',keepAspectRatio:true,tooltip:{textStyle:{color:'#06243a',fontSize:12}}};
        try{new google.visualization.GeoChart(el).draw(dt,opts);}catch(e){}
        // Clean, on-theme legend (the native GeoChart legend renders boxed, hard-to-read text).
        var legEl=document.getElementById(elId+'-legend');
        if(legEl){
            legEl.innerHTML='<div style="display:flex;align-items:center;gap:10px;max-width:460px;margin:0 auto"><span style="font-family:var(--mono);font-size:10px;color:#6d8ba3">0%<\/span><span style="flex:1;height:9px;border-radius:99px;background:linear-gradient(90deg,'+ramp.join(',')+')"><\/span><span style="font-family:var(--mono);font-size:10px;color:#6d8ba3">'+fmtPct(maxPct)+'<\/span><\/div>'
                +'<p style="margin:8px 0 0;text-align:center;font-family:var(--mono);font-size:9px;letter-spacing:.08em;color:#54708a;text-transform:uppercase">Share of total learners<\/p>';
        }
    });
}

function renderProjectPage(pid){
    var p=DATA.projects.find(function(x){return x.id===pid;});
    if(!p)return;
    var container=document.getElementById('page-proj-'+pid);
    if(!container)return;
    var pd=DATA.projectData[pid]||{};
    var isAll=projYear==='all';

    // Timeframe shown in the header: start date always, end date when one is set.
    var _MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function _fmtMY(d){if(!d)return '';var m=/^(\\d{4})-(\\d{1,2})/.exec(String(d));if(m){var mo=+m[2];return (mo>=1&&mo<=12?_MON[mo-1]+' ':'')+m[1];}var y=/^(\\d{4})/.exec(String(d));return y?y[1]:'';}
    var _ps=_fmtMY(p.startDate), _pe=_fmtMY(p.endDate);
    var periodLabel = (_ps&&_pe) ? (_ps+' – '+_pe) : (_ps ? ('Started '+_ps) : (_pe ? ('Ended '+_pe) : ''));

    // Actuals + targets for selected year. Stock KPIs (population reached, facilities
    // strengthened) represent a state at a point in time — the same catchment year after
    // year — so the all-time view takes the max per project, not the sum (which would
    // multiply the same population by the number of years).
    var a={},t={};DATA.kpis.forEach(function(k){a[k.id]=0;t[k.id]=0;});
    if(isAll){DATA.years.forEach(function(y){if(projIsHidden(y))return;DATA.kpis.forEach(function(k){
        var av=((pd.actuals||{})[y]||{})[k.id]||0, tv=((pd.targets||{})[y]||{})[k.id]||0;
        if(_isStock(k.id)){ if(av>a[k.id])a[k.id]=av; if(tv>t[k.id])t[k.id]=tv; }
        else { a[k.id]+=av; t[k.id]+=tv; }
    });});}
    else{DATA.kpis.forEach(function(k){a[k.id]=((pd.actuals||{})[projYear]||{})[k.id]||0;t[k.id]=((pd.targets||{})[projYear]||{})[k.id]||0;});}

    var label=isAll?'\u2014 all time':'in '+projYear;

    // Year selector HTML
    var ySel=DATA.years.map(function(y){
        return'<button class="yr-btn'+(y===projYear?' active':'')+'" onclick="projSelectYear('+y+')">'+y+'<\/button>';
    }).join('')+'<button class="yr-btn-all'+(isAll?' active-all':'')+'" onclick="projSelectYear(&#39;all&#39;)" title="Show all-time totals"><span class="star">★<\/span> All time<\/button>';
    // Exclude chips: omitted in external snapshots.
    var yExcl='';
    if(!DATA.external && isAll && DATA.years.length>1){
        yExcl='<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px">'
            +'<span style="font-size:10px;color:#6d8ba3;font-weight:700;text-transform:uppercase">Exclude:<\/span>'
            +DATA.years.map(function(y){return'<button class="yr-btn-sm'+(projIsHidden(y)?' excluded':'')+'" onclick="projToggleYear('+y+')">'+y+'<\/button>';}).join('')
            +'<\/div>';
    }

    // KPI cards (matched to live SURGdash app — gradient wash + accent stripe + clean type).
    // Same headline convention as the org overview: for the current year, future
    // years, and "all time", the TARGET is the headline and the actual moves to a
    // secondary "so far / to date" line; closed past years keep the actual as headline.
    var cards=DATA.kpis.map(function(kpi){
        return _kpiCard(kpi, a[kpi.id]||0, t[kpi.id]||0, label, isAll, projYear);
    }).join('');

    // Chart grid (one per KPI). Core KPI charts only render with ≥2 years of data;
    // quality-indicator charts (any year count) are appended into the same grid so
    // every "Progress Over Time" chart is the same size.
    var coreChartDivs=(DATA.years.length>=2)?DATA.kpis.map(function(k){
        return'<div class="chart-card">'
            +'<p style="margin:0 0 14px;font-family:var(--mono);font-size:10px;font-weight:700;color:#6d8ba3;text-transform:uppercase;letter-spacing:.14em">'+(k.nameBig||k.name)+'<\/p>'
            +'<div id="pchart-'+pid+'-'+k.id+'" style="position:relative;height:250px"><\/div><\/div>';
    }).join(''):'';
    var qualChartDivs=buildQualityChartDivs(pid);

    var seriesCtrl=_chartCaption();

    // Header is a unified card (gradient wash + colored icon tile) matching the live app.
    // Back button appears only if an org page is also present in this snapshot.
    var hasOrg = !!document.getElementById('page-org');
    var hdrBack = '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px">'
        + (hasOrg ? '<button class="nav-back" onclick="showOrgPage()">&#8592; Overview<\/button>' : '<span><\/span>')
        + (GSF_LOGO ? '<a href="https://www.globalsurgeryfoundation.org" target="_blank" rel="noopener" title="globalsurgeryfoundation.org"><img src="'+GSF_LOGO+'" alt="GSF" style="height:34px;width:auto;filter:brightness(0) invert(1);opacity:.92"><\/a>' : '')
        + '<\/div>';
    // Single-project snapshots get their own beta banner (org page is absent).
    // External snapshots suppress the banner — it's a public-facing export.
    var betaBanner = (hasOrg || DATA.external) ? '' :
        '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:18px;padding:10px 14px;background:rgba(255,193,69,0.10);border:1px solid rgba(255,193,69,0.30);border-radius:6px">'
        +'<span style="color:#FFC145;font-weight:900;font-size:11px;text-transform:uppercase;letter-spacing:.06em;flex-shrink:0;margin-top:1px">⚠ Beta<\/span>'
        +'<p style="margin:0;font-size:12px;color:#FFC145;line-height:1.4">Exported from <strong>SURGdash (Beta)<\/strong> on '+DATA.generatedAt+'. Data reflects stored values at time of export.<\/p>'
        +'<\/div>';
    container.innerHTML=
        '<div style="max-width:1100px;margin:0 auto;padding:28px 24px" class="fade-in">'
        + hdrBack
        + betaBanner
        +'<div style="border:1px solid #0a3a57;border-radius:5px;padding:20px 22px;margin-bottom:24px;background:linear-gradient(135deg,'+p.color+'0D,#002033 62%)">'
        +'<div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:18px 48px">'
        +'<div style="min-width:0;flex:1">'
        +'<p style="margin:0 0 5px;font-family:var(--mono);font-size:9px;font-weight:500;letter-spacing:.22em;text-transform:uppercase;color:var(--accent)">Project Snapshot<\/p>'
        +'<h1 style="margin:0;font-family:var(--serif);font-size:30px;font-weight:700;color:#eef4f9;line-height:1.12;letter-spacing:-0.01em">'+p.name+'<\/h1>'
        +(periodLabel?'<p style="margin:9px 0 0;font-family:var(--mono);font-size:10.5px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:#6d8ba3;display:inline-flex;align-items:center;gap:7px"><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:'+p.color+';flex-shrink:0"><\/span>'+periodLabel+'<\/p>':'')
        +'<\/div>'
        +'<div style="display:flex;flex-direction:column;align-items:flex-end;gap:10px;flex-shrink:0">'
        +'<div style="display:flex;gap:4px;background:#001b2c;border:1px solid #0a3a57;border-radius:6px;padding:4px">'+ySel+'<\/div>'
        +yExcl
        +(p.linkGsf?'<a href="'+(p.linkGsf||'').replace(/"/g,'&quot;')+'" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:11px;letter-spacing:.04em;color:var(--accent);text-decoration:none">View project on the GSF website &#8599;<\/a>':'')
        +'<\/div><\/div>'
        +(p.description?'<p style="margin:15px 0 0;font-size:13.5px;color:#9fb3c8;line-height:1.6;font-weight:300;max-width:780px">'+p.description+'<\/p>':'')
        +'<\/div>'
        +'<div class="reveal" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:28px">'+cards+'<\/div>'
        // Progress Over Time — core KPI charts + quality-indicator charts in one
        // uniform grid (same size). Shown if there's at least one chart to draw.
        +((coreChartDivs || qualChartDivs)
            ?'<div class="reveal" style="margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">'
                +'<h2 style="margin:0;font-family:var(--mono);font-size:10px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.2em">Progress Over Time<\/h2>'
                +(coreChartDivs?'<div>'+seriesCtrl+'<\/div>':'')+'<\/div>'
                +'<div class="reveal" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:12px;margin-bottom:28px">'+coreChartDivs+qualChartDivs+'<\/div>'
            :'')
        +buildQualityImprovement(pid)
        +buildQualitySection(pid)
        +buildEconomicSection(pid)
        +'<div id="pmap-'+pid+'" class="reveal" style="height:320px;border-radius:5px;overflow:hidden;border:1px solid #0a3a57;margin-bottom:28px"><\/div>'
        +(DATA.external ? '<div class="reveal" style="background:#002a42;border:1px solid #0a3a57;border-radius:5px;padding:14px 18px;margin-top:20px">'
            +'<h3 style="margin:0 0 10px;font-family:var(--mono);font-size:10px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.2em">Methodology &amp; Notes<\/h3>'
            +'<p style="margin:0 0 6px;font-size:11px;color:#b6c4d2;line-height:1.5"><strong>What you see.<\/strong> Activity counts come from logged events; HCW figures track unique healthcare workers strengthened over time. Quality indicators are cumulative quarterly figures collected at supported facilities.<\/p>'
            +'<p style="margin:0 0 6px;font-size:11px;color:#b6c4d2;line-height:1.5">Figures are <em>actuals achieved<\/em>; the current and future years show the <em>goal<\/em> for that year (labelled). Progress-against-target is not shown.<\/p>'
            +'<p style="margin:0 0 8px;font-size:11px;color:#FFC145;line-height:1.5;background:rgba(255,193,69,0.10);border:1px solid rgba(255,193,69,0.30);border-radius:6px;padding:8px 10px">⚠ <strong>Beta data &amp; selected datasets.<\/strong> Shows selected data sets only — not all programme data. Regularly updated; may differ slightly from official final figures while we continue testing.<\/p>'
            +'<p style="margin:18px 0 0;font-size:11px"><button onclick="showMethodologyPage()" style="background:none;border:none;padding:0;color:var(--accent);font-weight:600;text-decoration:underline;cursor:pointer;font-size:inherit;font-family:var(--mono);letter-spacing:0.03em">Read the full methodology &rarr;<\/button><\/p>'
            +'<\/div>' : '')
        +'<p style="text-align:center;font-family:var(--mono);font-size:11px;letter-spacing:0.04em;color:#6d8ba3;margin-top:24px">'+DATA.generatedAt+' &middot; SURGdash &copy; GSF'+(DATA.external?'':' (Beta)')+'<\/p>'
        +'<\/div>';

    _setupReveal();
    setTimeout(function(){
        if(DATA.years.length>=2) drawProjectCharts(pid);
        drawQualityCharts(pid);
        initProjectMap(pid);
    },80);
}

// Quality Improvement vs Baseline — mirrors the live dashboard's _renderQualityImprovement.
// 4 compact cards: "% so far" (signed, direction-aware) + target % + baseline → latest line.
function buildQualityImprovement(pid){
    var p=DATA.projects.find(function(x){return x.id===pid;});
    if(!p)return'';
    var enabled=p.enabledQualityKpis||[];
    if(enabled.length===0)return'';
    var activeKpis=DATA.qualityKpis.filter(function(k){return enabled.indexOf(k.id)>=0;});
    if(activeKpis.length===0)return'';
    var pd=DATA.projectData[pid]||{};
    var qd=(pd.qualityData||[]);
    var baselines=p.qualityBaselines||{};
    var targets=p.qualityTargets||{};
    // Need at least one baseline for the section to be useful
    var anyBaseline=activeKpis.some(function(k){var b=baselines[k.id];return b!==undefined&&b!==null&&!isNaN(b);});
    if(!anyBaseline)return'';

    var fmtPct=function(n){if(n===null||n===undefined||!isFinite(n))return'—';var s=n>0?'+':'';return s+(Math.abs(n)>=10?Math.round(n):n.toFixed(1))+'%';};
    var fmtV=function(n,u){if(n===null||n===undefined||!isFinite(n))return'—';return(Number.isInteger(n)?n:Number(n).toFixed(1))+(u?' '+u:'');};

    var cards=activeKpis.map(function(kpi){
        var b=baselines[kpi.id];
        var hasB=b!==undefined&&b!==null&&!isNaN(b);
        if(!hasB){
            return'<div class="qi-card" style="border-style:dashed">'
                +'<p class="lbl">'+kpi.shortName+'<\/p>'
                +'<p style="font-size:11px;color:#6d8ba3;font-style:italic;margin:0">Set a baseline to track improvement.<\/p>'
                +'<\/div>';
        }
        // Latest actual
        var entries=qd.filter(function(e){return e.kpiId===kpi.id&&e.actual!==null&&e.actual!==undefined;})
            .sort(function(x,y){return(x.year*10+x.quarter)-(y.year*10+y.quarter);});
        var latest=entries.length?entries[entries.length-1]:null;
        var latestActual=latest?latest.actual:null;
        var t=targets[kpi.id];
        var hasT=t!==undefined&&t!==null&&!isNaN(t);
        var pctChange=function(v){if(!hasB||v===null||v===undefined||Number(b)===0)return null;return((Number(v)-Number(b))/Number(b))*100;};
        var tgtChange=pctChange(hasT?t:null);
        var actChange=pctChange(latestActual);
        var goalDir=kpi.lowerIsBetter?-1:1;
        var imp=actChange!==null&&Math.sign(actChange)===goalDir;
        var wrs=actChange!==null&&Math.sign(actChange)===-goalDir&&actChange!==0;
        var clr=imp?'#10b981':(wrs?'#ef4444':'#6d8ba3');
        return'<div class="qi-card">'
            +'<div class="stripe" style="background:'+kpi.color+'"><\/div>'
            +'<p class="lbl">'+kpi.shortName+'<\/p>'
            +'<div class="row"><span class="big" style="color:'+clr+'">'+(actChange!==null?fmtPct(actChange):'—')+'<\/span>'
                +'<span class="lbl-sm">so far<\/span><\/div>'
            +'<div class="div row"><span style="font-size:13px;font-weight:700;color:#b6c4d2;font-variant-numeric:tabular-nums">'+(tgtChange!==null?fmtPct(tgtChange):'—')+'<\/span>'
                +'<span class="lbl-sm">target<\/span><\/div>'
            +'<div class="arrow"><span style="color:#e8edf4;font-weight:600">'+fmtV(b,kpi.unit)+'<\/span>'
                +'<span style="color:#cbd5e1">→<\/span>'
                +'<span style="color:#e8edf4;font-weight:600">'+fmtV(latestActual,kpi.unit)+'<\/span>'
                +(latest?'<span style="color:#6d8ba3;font-size:10px">Q'+latest.quarter+' '+latest.year+'<\/span>':'')
                +'<\/div>'
            +'<\/div>';
    }).join('');

    return'<div class="reveal" style="margin-bottom:28px">'
        +'<h2 class="sec-eyebrow" style="margin:0 0 16px!important">Quality Improvement vs Baseline<\/h2>'
        +'<div class="qi-grid">'+cards+'<\/div>'
        +'<\/div>';
}

function buildQualitySection(pid){
    var p=DATA.projects.find(function(x){return x.id===pid;});
    if(!p)return'';
    var enabled=p.enabledQualityKpis||[];
    if(enabled.length===0)return'';
    var activeKpis=DATA.qualityKpis.filter(function(k){return enabled.indexOf(k.id)>=0;});
    if(activeKpis.length===0)return'';
    var pd=DATA.projectData[pid]||{};
    var qd=(pd.qualityData||[]);
    var targets=p.qualityTargets||{};   // targets are project-level (not per-quarter)
    var isAll=projYear==='all';

    // Filter data to selected year (or all)
    var filtered=isAll?qd:qd.filter(function(e){return e.year===projYear;});

    var cards=activeKpis.map(function(kpi){
        // Get latest entry (highest year+quarter combo)
        var entries=filtered.filter(function(e){return e.kpiId===kpi.id&&(e.actual!==null||e.target!==null);})
            .sort(function(a,b){return(a.year*10+a.quarter)-(b.year*10+b.quarter);});
        // Prefer the most recent entry with an ACTUAL value. Falls back to last
        // target-only entry so we can still show "Target: X" when no actuals yet.
        var withActual=entries.filter(function(e){return e.actual!==null&&e.actual!==undefined;});
        var latest=withActual.length?withActual[withActual.length-1]:(entries.length?entries[entries.length-1]:null);
        var latestActual=latest?latest.actual:null;
        var _t=targets[kpi.id];
        var latestTarget=(_t!==undefined&&_t!==null&&!isNaN(_t))?Number(_t):null;
        var pct=latestTarget!==null&&latestActual!==null&&latestTarget>0
            ?(kpi.lowerIsBetter
                ?(latestActual<=latestTarget?100:Math.max(0,Math.round((1-(latestActual-latestTarget)/latestTarget)*100)))
                :Math.min(100,Math.round(latestActual/latestTarget*100)))
            :null;
        var qLabel=latest?(isAll?'Q'+latest.quarter+' '+latest.year:'Q'+latest.quarter):'—';
        return'<div class="kpi-card">'
            +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
            +'<div style="width:24px;height:24px;border-radius:6px;background:'+kpi.color+'20;flex-shrink:0"><\/div>'
            +'<div><p style="margin:0;font-size:10px;font-weight:900;color:#eef4f9;text-transform:uppercase;letter-spacing:.06em">'+kpi.shortName+'<\/p>'
            +'<p style="margin:0;font-size:9px;color:#6d8ba3">'+kpi.name+'<\/p><\/div><\/div>'
            +(latestActual!==null
                ?'<p style="margin:0 0 2px;font-size:24px;font-weight:900;color:'+kpi.color+'">'+latestActual+' <span style="font-size:12px;font-weight:500;color:#6d8ba3">'+kpi.unit+'<\/span><\/p>'
                :'<p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#cbd5e1">No data<\/p>')
            +'<p style="margin:0 0 8px;font-size:10px;color:#6d8ba3">Latest: '+qLabel+(kpi.lowerIsBetter?' \u00b7 lower is better':'')+'<\/p>'
            +(pct!==null
                ?'<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
                    +'<div style="flex:1;background:#0a3a57;border-radius:99px;height:5px"><div style="width:'+pct+'%;background:'+kpi.color+';height:5px;border-radius:99px"><\/div><\/div>'
                    +'<span style="font-size:11px;font-weight:700;color:'+kpi.color+'">'+pct+'%<\/span><\/div>'
                    +'<p style="margin:0;font-size:10px;color:#6d8ba3">Target: <strong style="color:'+kpi.color+'">'+latestTarget+' '+kpi.unit+'<\/strong><\/p>'
                :(latestTarget!==null?'<p style="margin:0;font-size:10px;color:#6d8ba3">Target: <strong style="color:'+kpi.color+'">'+latestTarget+' '+kpi.unit+'<\/strong><\/p>':''))
            +'<\/div>';
    }).join('');

    return'<div class="reveal" style="margin-bottom:28px">'
        +'<h2 class="sec-eyebrow" style="margin:0 0 16px!important">Quality Indicators<\/h2>'
        +'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">'+cards+'<\/div>'
        +'<\/div>';
}

// Quality-indicator chart divs (rendered into the combined "Progress Over Time"
// grid alongside the core KPI charts, so all charts are the same size).
function buildQualityChartDivs(pid){
    var p=DATA.projects.find(function(x){return x.id===pid;});
    if(!p)return'';
    var enabled=p.enabledQualityKpis||[];
    if(enabled.length===0)return'';
    var activeKpis=DATA.qualityKpis.filter(function(k){return enabled.indexOf(k.id)>=0;});
    if(activeKpis.length===0)return'';
    return activeKpis.map(function(k){
        return'<div class="chart-card">'
            +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
            +'<p style="margin:0;font-size:10px;font-weight:900;color:#eef4f9;text-transform:uppercase;letter-spacing:.06em">'+k.shortName+' <span style="font-weight:400;color:#6d8ba3;text-transform:none">'+k.name+'<\/span><\/p>'
            +(k.lowerIsBetter?'<span style="font-size:9px;color:#6d8ba3;font-weight:600">lower is better<\/span>':'')
            +'<\/div>'
            +'<div id="qchart-'+pid+'-'+k.id+'" style="position:relative;height:250px"><\/div><\/div>';
    }).join('');
}

// ── ECONOMIC IMPACT (mirrors Projects.computeEconomicImpact / _renderEconomicImpact) ──
function computeEconomicImpact(pid){
    var p=DATA.projects.find(function(x){return x.id===pid;});
    if(!p||!p.impactAssumptions)return null;
    var ia=p.impactAssumptions;
    var bSSI=Number(ia.baselineSSI),bMMR=Number(ia.baselineMMR),bNMR=Number(ia.baselineNMR),bSSC=Number(ia.baselineSSC);
    var surgicalVol=Number(ia.annualSurgicalVolume)||0,liveBirths=Number(ia.annualLiveBirths)||0,gdp=Number(ia.gdpPerCapita)||0;
    var hasInput=(bSSI>0||bMMR>0||bNMR>0||bSSC>=0)&&(surgicalVol>0||liveBirths>0);
    if(!hasInput)return null;
    var C=DATA.economicConstants;
    var pd=DATA.projectData[pid]||{};
    var qd=pd.qualityData||[];
    var actuals=pd.actuals||{};
    var budget=pd.budget||[];
    var isAll=projYear==='all';
    var years=isAll?DATA.years:[projYear];
    var yearAvg=function(kpiId,y){
        var es=qd.filter(function(e){return e.kpiId===kpiId&&e.year===y&&e.actual!==null&&e.actual!==undefined;});
        if(es.length===0)return null;
        return es.reduce(function(s,e){return s+Number(e.actual);},0)/es.length;
    };
    var maternalD=0,neonatalD=0,ssis=0,ssiD=0,sscD=0,bedDays=0,ssiCost=0,hcw=0;
    years.forEach(function(y){
        if(bMMR>0&&liveBirths>0){var c=yearAvg('mmr',y);if(c!==null)maternalD+=Math.max(0,bMMR-c)/100000*liveBirths;}
        if(bNMR>0&&liveBirths>0){var c=yearAvg('nmr',y);if(c!==null)neonatalD+=Math.max(0,bNMR-c)/1000*liveBirths;}
        if(bSSI>0&&surgicalVol>0){var c=yearAvg('ssi_rate',y);if(c!==null){var x=Math.max(0,(bSSI-c)/100)*surgicalVol;ssis+=x;ssiD+=x*C.SSI_CASE_FATALITY;bedDays+=x*C.SSI_EXTRA_LOS_DAYS;ssiCost+=x*C.SSI_COST_PER_CASE;}}
        if(bSSC>=0&&surgicalVol>0){var c=yearAvg('ssc_util',y);if(c!==null){var d=Math.max(0,(c-bSSC)/100);sscD+=surgicalVol*C.SURGICAL_BASELINE_MORTALITY*C.SSC_EFFECT_SIZE*d;}}
        var ac=actuals[y];if(ac)hcw+=Number(ac.hcw_strengthened||0);
    });
    var dalys=maternalD*C.MATERNAL_DALY_PER_DEATH+neonatalD*C.NEONATAL_DALY_PER_DEATH+ssiD*C.SURGICAL_DALY_PER_DEATH+sscD*C.SURGICAL_DALY_PER_DEATH;
    var econ=dalys*gdp;
    var hcwEnc=hcw*C.HCW_LIFETIME_ENCOUNTERS;
    var bRows=isAll?budget:budget.filter(function(b){return b.year===projYear;});
    var totalAlloc=bRows.reduce(function(s,b){return s+(Number(b.allocated)||0);},0);
    var costPerDaly=dalys>0?totalAlloc/dalys:null;
    var whoThresh=gdp*C.WHO_THRESHOLD_MULTIPLIER;
    var roi=totalAlloc>0?econ/totalAlloc:null;
    return{
        maternalD:maternalD,neonatalD:neonatalD,ssis:ssis,ssiD:ssiD,sscD:sscD,
        totalD:maternalD+neonatalD+ssiD+sscD,bedDays:bedDays,ssiCost:ssiCost,
        dalys:dalys,econ:econ,hcw:hcw,hcwEnc:hcwEnc,
        totalAlloc:totalAlloc,costPerDaly:costPerDaly,whoThresh:whoThresh,
        belowThresh:costPerDaly!==null&&whoThresh>0&&costPerDaly<whoThresh,
        roi:roi,currency:p.currency||'USD'
    };
}

function buildEconomicSection(pid){
    var ei=computeEconomicImpact(pid);
    if(!ei)return'';  // section hidden when no inputs configured
    var cur=ei.currency;
    var fmtM=function(n){if(n===null||n===undefined||!isFinite(n))return'—';var r=Math.round(n);if(r>=1e6)return(r/1e6).toFixed(2).replace(/\.?0+$/,'')+'M';if(r>=1e4)return(r/1e3).toFixed(1).replace(/\.0$/,'')+'k';return fmt(r);};
    var fN=function(n){return n===null||n===undefined||!isFinite(n)?'—':fmt(Math.round(n));};
    var f1=function(n){return n===null||n===undefined||!isFinite(n)?'—':Number(n).toFixed(1);};
    // Theme palette — kept in sync with the live dashboard's _renderEconomicImpact.
    // Dark-theme accent hues (bright enough to read on the dark card surface).
    var themes={
        rose:{accent:'#fb7185'}, emerald:{accent:'#34d399'}, amber:{accent:'#fbbf24'},
        slate:{accent:'#cbd5e1'}, blue:{accent:'#60a5fa'}, violet:{accent:'#a78bfa'},
        orange:{accent:'#fb923c'}, cyan:{accent:'#22d3ee'}
    };
    var card=function(label,value,sub,theme){
        var c=themes[theme]||themes.slate;
        return'<div style="position:relative;overflow:hidden;border:1px solid #0a3a57;border-radius:5px;padding:16px;background:linear-gradient(150deg,'+c.accent+'1A,#001a2b 60%)">'
            +'<div style="position:absolute;top:0;left:0;right:0;height:2px;background:'+c.accent+'"><\/div>'
            +'<p style="margin:0 0 7px;font-family:var(--mono);font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#6d8ba3">'+label+'<\/p>'
            +'<p style="margin:0;font-family:var(--serif);font-size:30px;font-weight:700;line-height:1;color:'+c.accent+'">'+value+'<\/p>'
            +'<p style="margin:7px 0 0;font-size:10.5px;color:#6d8ba3;font-weight:300;line-height:1.4">'+sub+'<\/p><\/div>';
    };

    // Tier 2 — cost-effectiveness
    var cpdTheme=ei.costPerDaly===null?'slate':(ei.belowThresh?'emerald':'amber');
    var cpdValue=ei.costPerDaly!==null
        ? '<span style="font-size:13px;font-weight:400;opacity:.7">'+cur+'<\/span> '+fmtM(ei.costPerDaly)
        : '<span style="color:#cbd5e1">—<\/span>';
    var cpdSub=ei.costPerDaly!==null
        ? (ei.belowThresh?'✓ Below':'⚠ Above')+' WHO threshold ('+cur+' '+fmtM(ei.whoThresh)+' = 3× GDP/cap)'
        : 'Awaiting quality-indicator actuals';
    var roiValue=ei.roi!==null&&ei.roi>=0.1 ? ei.roi.toFixed(1)+'×' : '<span style="color:#cbd5e1">—<\/span>';
    var budgetSub=ei.costPerDaly!==null ? 'Buys '+fN(ei.dalys)+' DALYs averted' : 'Yearly budget for this period';

    // Compact breakdown table (collapsible via <details>)
    var rows=[
        {label:'Maternal deaths averted',v:ei.maternalD,src:'Δ MMR × live births',clr:'#D03734',icon:'♥'},
        {label:'Neonatal deaths averted',v:ei.neonatalD,src:'Δ NMR × live births',clr:'#E28743',icon:'●'},
        {label:'SSI deaths averted',v:ei.ssiD,src:'Δ SSI × surgical vol × 5% case fatality',clr:'#8B5CF6',icon:'⚠'},
        {label:'SSC-attributable deaths averted',v:ei.sscD,src:'Δ SSC × Haynes 47% effect',clr:'#059669',icon:'✓'}
    ].filter(function(r){return r.v>0.5;});
    var breakdown='';
    if(rows.length){
        breakdown='<details style="margin-bottom:12px"><summary style="font-size:10px;font-weight:700;color:#6d8ba3;text-transform:uppercase;letter-spacing:.08em;cursor:pointer;user-select:none;margin-bottom:6px">Deaths averted — breakdown by source ▾<\/summary>'
            +'<div style="border:1px solid #0a3a57;border-radius:6px;overflow:hidden"><table style="width:100%;border-collapse:collapse;font-size:12px"><tbody>'
            +rows.map(function(r){return'<tr style="border-bottom:1px solid #0a3a57"><td style="padding:8px 12px;border-left:3px solid '+r.clr+'"><span style="color:'+r.clr+';font-weight:700;margin-right:6px">'+r.icon+'<\/span>'+r.label+'<\/td><td style="padding:8px 12px;text-align:right;font-weight:700;color:'+r.clr+';font-variant-numeric:tabular-nums">'+f1(r.v)+'<\/td><td style="padding:8px 12px;text-align:right;font-size:10px;color:#6d8ba3;font-style:italic">'+r.src+'<\/td><\/tr>';}).join('')
            +'<\/tbody><\/table><\/div><\/details>';
    }

    var sectionHeader=function(t){return'<p style="margin:0 0 10px;font-family:var(--mono);font-size:9.5px;font-weight:700;color:#6d8ba3;text-transform:uppercase;letter-spacing:.16em">'+t+'<\/p>';};
    var row=function(cards){return'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px">'+cards.join('')+'<\/div>';};

    return'<div class="reveal" style="background:#002033;border:1px solid #0a3a57;border-radius:5px;padding:22px;margin-bottom:28px;box-shadow:0 1px 3px rgba(0,0,0,.05)">'
        +'<h2 class="sec-eyebrow" style="margin:0 0 6px!important">❤ Economic Impact<\/h2>'
        +'<p style="margin:0 0 18px;font-size:11px;color:#6d8ba3">Estimated health and economic gains derived from quality-indicator improvements × volumes. Conservative point estimates.<\/p>'

        +sectionHeader('Impact headlines')
        +row([
            card('Deaths averted', fN(Math.round(ei.totalD)), 'Maternal + neonatal + surgical', 'rose'),
            card('DALYs averted', fN(Math.round(ei.dalys)), 'Disability-adjusted life-years', 'emerald'),
            card('Economic value', '<span style="font-size:13px;font-weight:400;opacity:.7">'+cur+'<\/span> '+fmtM(ei.econ), 'DALYs × GDP per capita', 'amber'),
        ])

        +sectionHeader('Cost-effectiveness')
        +row([
            card('Cost per DALY averted', cpdValue, cpdSub, cpdTheme),
            card('Estimated return', roiValue, 'Economic value per '+cur+' 1 of budget', 'blue'),
            card('Allocated budget', '<span style="font-size:13px;font-weight:400;opacity:.7">'+cur+'<\/span> '+fmtM(ei.totalAlloc), budgetSub, 'slate'),
        ])

        +sectionHeader('Tangible outcomes')
        +row([
            card('SSIs averted', fN(ei.ssis), fN(ei.bedDays)+' bed-days saved', 'violet'),
            card('Care cost avoided', '<span style="font-size:13px;font-weight:400;opacity:.7">'+cur+'<\/span> '+fmtM(ei.ssiCost), 'Hospital treatment costs saved from SSI reduction', 'orange'),
            card('HCW lifetime reach', fN(ei.hcwEnc), 'Patient encounters from '+fN(ei.hcw)+' strengthened HCWs (25-yr career)', 'cyan'),
        ])

        +breakdown
        +'<p style="margin:0;font-size:10px;font-style:italic;color:#6d8ba3">⚠ Conservative point estimates using published coefficients (DCP3, Lancet Commission, Haynes 2009, WHO GBD). Real impact depends on counterfactual, attribution, and context.<\/p>'
        +'<\/div>';
}

function drawQualityCharts(pid){
    var p=DATA.projects.find(function(x){return x.id===pid;});
    if(!p)return;
    var enabled=p.enabledQualityKpis||[];
    var activeKpis=DATA.qualityKpis.filter(function(k){return enabled.indexOf(k.id)>=0;});
    if(activeKpis.length===0)return;
    var pd=DATA.projectData[pid]||{};
    var qd=(pd.qualityData||[]);
    var isAll=projYear==='all';
    var filtered=isAll?qd:qd.filter(function(e){return e.year===projYear;});

    var baselines=p.qualityBaselines||{};
    activeKpis.forEach(function(kpi){
        var el=document.getElementById('qchart-'+pid+'-'+kpi.id);if(!el)return;
        var entries=filtered.filter(function(e){return e.kpiId===kpi.id&&(e.actual!==null||e.target!==null);})
            .sort(function(a,b){return(a.year*10+a.quarter)-(b.year*10+b.quarter);});
        if(entries.length===0){el.innerHTML='<p style="text-align:center;color:#6d8ba3;font-size:12px;padding:90px 0">No data<\/p>';return;}
        var hasTargets=entries.some(function(e){return e.target!==null;});
        var labels=entries.map(function(e){return isAll?(e.quarter===1?String(e.year):'Q'+e.quarter):'Q'+e.quarter;});
        var aData=entries.map(function(e){return (e.actual!==null&&e.actual!==undefined)?e.actual:null;});
        var ds=[{label:'Actual',data:aData,borderColor:kpi.color,borderWidth:2.5,backgroundColor:_areaFill(kpi.color),fill:true,tension:0.35,pointRadius:3,pointHoverRadius:5,pointBackgroundColor:kpi.color,pointBorderColor:'#001523',pointBorderWidth:1.5,spanGaps:true,order:2}];
        if(hasTargets){var tData=entries.map(function(e){return (e.target!==null&&e.target!==undefined)?e.target:null;});
            ds.push({label:'Target',data:tData,borderColor:_hexA('#9fb3c8',0.9),borderWidth:2,borderDash:[5,4],pointRadius:0,tension:0.35,fill:false,spanGaps:true,order:1});}
        var b=baselines[kpi.id];var hasB=(b!==undefined&&b!==null&&!isNaN(b));
        if(hasB){ds.push({label:'Baseline',data:labels.map(function(){return Number(b);}),borderColor:_hexA('#e0b463',0.6),borderWidth:1.5,borderDash:[2,3],pointRadius:0,fill:false,order:0});}
        new Chart(_canvasCtx(el),{type:'line',data:{labels:labels,datasets:ds},options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:10,right:8,left:2,bottom:0}},plugins:{legend:_legendCfg(hasTargets||hasB),tooltip:_tooltipCfg()},scales:{x:_xScale(),y:_yScale()},animation:{duration:600,easing:'easeOutQuart'}}});
    });
}

function drawProjectCharts(pid){
    var pd=DATA.projectData[pid]||{};
    var p=DATA.projects.find(function(x){return x.id===pid;})||{};
    var NOW=new Date().getFullYear();
    var labels=DATA.years.map(String);
    var goalFlags=DATA.years.map(function(yr){return Number(yr)>=NOW;});
    // Active window from the project's start/end dates (year part only). Years outside
    // this window are subtly marked on each chart via _lifecyclePlugin.
    var _m,sY=null,eY=null;
    if(p.startDate){_m=/^(\\d{4})/.exec(String(p.startDate));sY=_m?+_m[1]:null;}
    if(p.endDate){_m=/^(\\d{4})/.exec(String(p.endDate));eY=_m?+_m[1]:null;}
    var activeFlags=DATA.years.map(function(yr){var y=Number(yr);if(sY!=null&&y<sY)return false;if(eY!=null&&y>eY)return false;return true;});
    var life={active:activeFlags};
    DATA.kpis.forEach(function(kpi){
        var el=document.getElementById('pchart-'+pid+'-'+kpi.id);if(!el)return;
        var hasData=false;
        var actuals=[],targets=[];
        DATA.years.forEach(function(yr){
            var aVal=((pd.actuals||{})[yr]||{})[kpi.id]||0;
            var tVal=((pd.targets||{})[yr]||{})[kpi.id]||0;
            if(aVal>0||tVal>0)hasData=true;
            var future=Number(yr)>=NOW;
            actuals.push((!future&&aVal>0)?aVal:null);   // actual bar on past years only
            targets.push(tVal>0?tVal:null);              // target/goal bar on every year
        });
        if(!hasData){el.innerHTML='<p style="text-align:center;color:#6d8ba3;font-size:12px;padding:80px 0">No data<\/p>';return;}
        _drawKpiBars(el,kpi,labels,actuals,targets,goalFlags,life);
    });
}

// ── MAP ──
var _orgMap=null;
var _projMaps={};

function _tileLayer(map){
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{
        attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains:'abcd',maxZoom:19
    }).addTo(map);
}

// "Labels" on/off control for permanent marker labels. Toggles a CSS class on
// the map container (cheap, no per-marker work). Labels start ON.
function _addLabelToggle(map,el){
    if(!window.L||!map||!el)return;
    var Ctrl=L.Control.extend({options:{position:'topright'},onAdd:function(){
        var d=L.DomUtil.create('div','lbl-toggle');
        d.innerHTML='<input type="checkbox" checked style="margin:0;cursor:pointer"> Labels';
        var cb=d.querySelector('input');
        L.DomEvent.disableClickPropagation(d);
        cb.addEventListener('change',function(){ el.classList[cb.checked?'remove':'add']('no-lbls'); });
        return d;
    }});
    map.addControl(new Ctrl());
}

// Greedy label placement: after markers settle, give each permanent label the
// side (right/left/top/bottom) with the least overlap against already-placed
// labels and marker icons — so they stop piling on top of each other.
function _layoutLabels(list,map){
    if(!window.L||!map)return;
    var labeled=(list||[]).filter(function(m){return m&&m.label&&m.marker&&m.marker.getLatLng;});
    if(!labeled.length)return;
    var P=function(m){return map.latLngToContainerPoint(m.marker.getLatLng());};
    var overlaps=function(a,b){return !(a.r<=b.l||a.l>=b.r||a.b<=b.t||a.t>=b.b);};
    var area=function(a,b){return Math.max(0,Math.min(a.r,b.r)-Math.max(a.l,b.l))*Math.max(0,Math.min(a.b,b.b)-Math.max(a.t,b.t));};
    var placed=[];
    labeled.forEach(function(m){var pt=P(m);placed.push({l:pt.x-11,t:pt.y-11,r:pt.x+11,b:pt.y+11,_m:1});});
    var rectFor=function(pt,dir,w,h){var g=12;
        if(dir==='right')return{l:pt.x+g,t:pt.y-h/2,r:pt.x+g+w,b:pt.y+h/2};
        if(dir==='left') return{l:pt.x-g-w,t:pt.y-h/2,r:pt.x-g,b:pt.y+h/2};
        if(dir==='top')  return{l:pt.x-w/2,t:pt.y-g-h,r:pt.x+w/2,b:pt.y-g};
        return{l:pt.x-w/2,t:pt.y+g,r:pt.x+w/2,b:pt.y+g+h};};
    labeled.sort(function(a,b){var pa=P(a),pb=P(b);return pa.y-pb.y||pa.x-pb.x;});
    labeled.forEach(function(m){
        var pt=P(m),w=Math.min(230,m.label.length*6.0+14),h=16,best=null,bestScore=Infinity;
        ['right','left','top','bottom'].forEach(function(dir,di){
            var r=rectFor(pt,dir,w,h),score=di*0.5;
            placed.forEach(function(pr){if(overlaps(r,pr))score+=area(r,pr)+(pr._m?400:0);});
            if(score<bestScore){bestScore=score;best={dir:dir,rect:r};}
        });
        placed.push(best.rect);
        var off=best.dir==='right'?[10,0]:best.dir==='left'?[-10,0]:best.dir==='top'?[0,-9]:[0,9];
        try{m.marker.unbindTooltip();}catch(e){}
        m.marker.bindTooltip(m.label,{permanent:true,direction:best.dir,offset:off,className:'map-lbl'});
    });
}

function initOrgMap(){
    if(!window.L)return;
    var el=document.getElementById('org-map');
    if(!el)return;
    if(_orgMap){try{_orgMap.remove();}catch(e){}}
    _orgMap=L.map(el,{zoomControl:true});
    _tileLayer(_orgMap);
    var _esc=function(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');};
    var EPS=0.001;
    // Step 1: build clusters — only from visible projects (external mode may hide some)
    var clusters=[];
    DATA.projects.forEach(function(p){
        if(p._visible===false)return;
        var locs=(p.locations&&p.locations.length>0)?p.locations:(p.lat!=null?[{name:'',lat:p.lat,lng:p.lng}]:[]);
        locs.forEach(function(loc){
            var pLat=parseFloat(loc.lat),pLng=parseFloat(loc.lng);
            if(isNaN(pLat)||isNaN(pLng))return;
            var ex=clusters.find(function(c){return Math.abs(c.lat-pLat)<EPS&&Math.abs(c.lng-pLng)<EPS;});
            var entry={project:p,label:loc.name||p.name};
            if(ex){ex.items.push(entry);}else{clusters.push({lat:pLat,lng:pLng,items:[entry]});}
        });
    });
    // Step 2: collect all bounds
    var bounds=[];
    clusters.forEach(function(c){bounds.push([c.lat,c.lng]);});
    DATA.projects.forEach(function(p){
        ((DATA.projectData[p.id]||{}).facilities||[]).forEach(function(f){
            var fLat=parseFloat(f.lat),fLng=parseFloat(f.lng);
            if(!isNaN(fLat)&&!isNaN(fLng))bounds.push([fLat,fLng]);
        });
    });
    // Step 3: set map view before placing markers so zoom is known for pixel math
    if(bounds.length===1)_orgMap.setView(bounds[0],10);
    else if(bounds.length>1)_orgMap.fitBounds(bounds,{padding:[40,40],maxZoom:9});
    else{
        _orgMap.setView([15,20],2);
        el.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#6d8ba3;font-size:13px;pointer-events:none">No location data &mdash; add coordinates in project settings<\/div>';
    }
    // Step 4+5: add cluster markers with dynamic pixel-based spread
    var _allM=[];
    var _makeDiamond=function(c){return L.divIcon({html:'<div style="width:16px;height:16px;background:'+c+';transform:rotate(45deg);border-radius:3px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)"><\/div>',className:'',iconSize:[16,16],iconAnchor:[8,8]});};
    clusters.forEach(function(cluster){
        var lat=cluster.lat,lng=cluster.lng,items=cluster.items;
        if(items.length<=5){
            items.forEach(function(it){
                var color=it.project.color||'#4389C8';
                var m=L.marker([lat,lng],{icon:_makeDiamond(color)}).addTo(_orgMap)
                    .bindPopup('<strong style="font-size:13px;color:#eef4f9">'+_esc(it.label)+'<\/strong>'+(it.label!==it.project.name?'<br><span style="font-size:11px;color:#6d8ba3">'+_esc(it.project.name)+'<\/span>':'')+(it.project.description?'<br><span style="font-size:12px;color:#6d8ba3">'+_esc(it.project.description.slice(0,100))+'<\/span>':''));
                var line=L.polyline([[lat,lng],[lat,lng]],{color:color,weight:1.5,opacity:0,dashArray:'4,4'}).addTo(_orgMap);
                _allM.push({marker:m,trueLat:lat,trueLng:lng,line:line,label:_esc(it.label)});
            });
        }else{
            var listRows=items.map(function(it){return'<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #0a3a57"><span style="width:9px;height:9px;border-radius:50%;background:'+(it.project.color||'#4389C8')+';flex-shrink:0"><\/span><span style="font-size:13px;font-weight:600;color:#eef4f9;flex:1">'+_esc(it.label)+'<\/span><\/div>';}).join('');
            var icon=L.divIcon({html:'<div style="width:34px;height:34px;border-radius:50%;background:#FFC145;border:2.5px solid #001523;box-shadow:0 2px 8px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#001523;font-family:var(--mono)">'+items.length+'<\/div>',className:'',iconSize:[34,34],iconAnchor:[17,17]});
            L.marker([lat,lng],{icon:icon}).addTo(_orgMap).bindPopup('<div style="min-width:200px;font-family:sans-serif"><p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#6d8ba3;text-transform:uppercase">'+items.length+' projects at this location<\/p>'+listRows+'<\/div>',{maxWidth:300});
        }
    });
    // Add facility markers — only for visible projects
    DATA.projects.forEach(function(p){
        if(p._visible===false)return;
        var color=p.color||'#4389C8';
        ((DATA.projectData[p.id]||{}).facilities||[]).forEach(function(f){
            if(f.lat==null||f.lng==null)return;
            var hub=!!f.isHub;
            var m=hub
                ?L.marker([f.lat,f.lng],{icon:L.divIcon({html:'<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="'+color+'" stroke="#fff" stroke-width="2"/><path d="M10 4.5l1.4 2.8 3.1.5-2.2 2.2.5 3.1L10 11.4 7.2 13.1l.5-3.1-2.2-2.2 3.1-.5z" fill="#fff"/></svg>',className:'',iconSize:[20,20],iconAnchor:[10,10]})}).addTo(_orgMap)
                :L.circleMarker([f.lat,f.lng],{radius:6,fillColor:'#fff',color:color,weight:2,fillOpacity:0.7}).addTo(_orgMap);
            m.bindPopup('<span style="font-size:10px;color:'+color+';font-weight:700">'+_esc(p.name)+'<\/span><br><strong style="font-size:12px;color:#eef4f9">'+_esc(f.name)+'<\/strong>'
                    +(hub?'<br><span style="font-size:10px;font-weight:700;color:#FFC145;background:rgba(255,193,69,0.18);padding:1px 6px;border-radius:4px">HUB<\/span>':'')
                    +(f.catchmentPop?'<br><span style="font-size:11px;color:#6d8ba3">Catchment: '+f.catchmentPop.toLocaleString()+'<\/span>':'')
                    +(f.annualPatients?'<br><span style="font-size:11px;color:#6d8ba3">Patients\/yr: '+f.annualPatients.toLocaleString()+'<\/span>':''));
            var line=L.polyline([[f.lat,f.lng],[f.lat,f.lng]],{color:color,weight:1.5,opacity:0,dashArray:'4,4'}).addTo(_orgMap);
            _allM.push({marker:m,trueLat:f.lat,trueLng:f.lng,line:line});
        });
    });
    // Magnetic repulsion
    var _MIN_D=22;
    var _repel=function(){
        if(_allM.length<2)return;
        var z=_orgMap.getZoom();
        var pts=_allM.map(function(m){var p=_orgMap.project([m.trueLat,m.trueLng],z);return{x:p.x,y:p.y};});
        for(var iter=0;iter<12;iter++){
            for(var i=0;i<pts.length;i++){
                for(var j=i+1;j<pts.length;j++){
                    var dx=pts[j].x-pts[i].x,dy=pts[j].y-pts[i].y;
                    var dist=Math.sqrt(dx*dx+dy*dy);
                    if(dist<_MIN_D&&dist>0){var push=(_MIN_D-dist)/2;var nx=dx/dist,ny=dy/dist;pts[i].x-=nx*push;pts[i].y-=ny*push;pts[j].x+=nx*push;pts[j].y+=ny*push;}
                    else if(dist===0){var ang=(i*2.39996)%(Math.PI*2);pts[i].x-=Math.cos(ang)*_MIN_D/2;pts[i].y-=Math.sin(ang)*_MIN_D/2;pts[j].x+=Math.cos(ang)*_MIN_D/2;pts[j].y+=Math.sin(ang)*_MIN_D/2;}
                }
            }
        }
        pts.forEach(function(pt,i){
            var m=_allM[i];var newLL=_orgMap.unproject(L.point(pt.x,pt.y),z);
            var orig=_orgMap.project([m.trueLat,m.trueLng],z);
            var displaced=Math.abs(pt.x-orig.x)>1||Math.abs(pt.y-orig.y)>1;
            if(m.marker.setLatLng)m.marker.setLatLng(newLL);
            else if(m.marker._latlng){m.marker._latlng=newLL;m.marker.redraw();}
            if(displaced){m.line.setLatLngs([[m.trueLat,m.trueLng],[newLL.lat,newLL.lng]]);m.line.setStyle({opacity:0.45});}
            else{m.line.setStyle({opacity:0});}
        });
    };
    _repel();
    _layoutLabels(_allM,_orgMap);
    _orgMap.on('zoomend',function(){_repel();_layoutLabels(_allM,_orgMap);});
    if(_allM.length)_addLabelToggle(_orgMap,el);
    setTimeout(function(){if(_orgMap){_orgMap.invalidateSize();_layoutLabels(_allM,_orgMap);}},150);
}

function initProjectMap(pid){
    if(!window.L)return;
    var el=document.getElementById('pmap-'+pid);
    if(!el)return;
    var p=DATA.projects.find(function(x){return x.id===pid;});
    if(!p)return;
    var color=p.color||'#4389C8';
    var facs=((DATA.projectData[pid]||{}).facilities||[]).filter(function(f){return f.lat!=null&&f.lng!=null;});
    var locs=(p.locations&&p.locations.length>0)?p.locations:(p.lat!=null?[{name:'',lat:p.lat,lng:p.lng}]:[]);
    if(locs.length===0&&facs.length===0){el.style.background='#001020';el.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#6d8ba3;font-size:13px">No location data<\/div>';return;}
    if(_projMaps[pid]){try{_projMaps[pid].remove();}catch(e){}}
    var map=L.map(el,{zoomControl:true});
    _projMaps[pid]=map;
    _tileLayer(map);
    var bounds=[];
    var _mkDia=function(c){return L.divIcon({html:'<div style="width:16px;height:16px;background:'+c+';transform:rotate(45deg);border-radius:3px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)"><\/div>',className:'',iconSize:[16,16],iconAnchor:[8,8]});};
    var _pm=[];
    locs.forEach(function(loc,li){
        var pLat=parseFloat(loc.lat),pLng=parseFloat(loc.lng);
        if(isNaN(pLat)||isNaN(pLng))return;
        var label=loc.name||(li===0?p.name:'Location '+(li+1));
        var m=L.marker([pLat,pLng],{icon:_mkDia(color)})
            .addTo(map).bindPopup('<strong style="font-size:13px;color:#eef4f9">'+label+'<\/strong>'+(loc.name?'<br><span style="font-size:11px;color:#6d8ba3">'+p.name+'<\/span>':''));
        var line=L.polyline([[pLat,pLng],[pLat,pLng]],{color:color,weight:1.5,opacity:0,dashArray:'4,4'}).addTo(map);
        _pm.push({marker:m,trueLat:pLat,trueLng:pLng,line:line,label:label});
        bounds.push([pLat,pLng]);
    });
    facs.forEach(function(f){
        var hub=!!f.isHub;
        var m=hub
            ?L.marker([f.lat,f.lng],{icon:L.divIcon({html:'<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="'+color+'" stroke="#fff" stroke-width="2"/><path d="M10 4.5l1.4 2.8 3.1.5-2.2 2.2.5 3.1L10 11.4 7.2 13.1l.5-3.1-2.2-2.2 3.1-.5z" fill="#fff"/></svg>',className:'',iconSize:[20,20],iconAnchor:[10,10]})}).addTo(map)
            :L.circleMarker([f.lat,f.lng],{radius:7,fillColor:'#fff',color:color,weight:2,fillOpacity:0.7}).addTo(map);
        m.bindPopup('<strong style="font-size:13px;color:#eef4f9">'+f.name+'<\/strong>'
                +(hub?'<br><span style="font-size:10px;font-weight:700;color:#FFC145;background:rgba(255,193,69,0.18);padding:1px 6px;border-radius:4px">HUB<\/span>':'')
                +(f.catchmentPop?'<br><span style="font-size:11px;color:#6d8ba3">Catchment: '+f.catchmentPop.toLocaleString()+'<\/span>':'')
                +(f.annualPatients?'<br><span style="font-size:11px;color:#6d8ba3">Patients\/yr: '+f.annualPatients.toLocaleString()+'<\/span>':''));
        var line=L.polyline([[f.lat,f.lng],[f.lat,f.lng]],{color:color,weight:1.5,opacity:0,dashArray:'4,4'}).addTo(map);
        _pm.push({marker:m,trueLat:f.lat,trueLng:f.lng,line:line,label:f.name});
        bounds.push([f.lat,f.lng]);
    });
    if(bounds.length===1)map.setView(bounds[0],9);
    else map.fitBounds(bounds,{padding:[40,40],maxZoom:11});
    // Magnetic repulsion
    var _MD=22;
    var _rep=function(){
        if(_pm.length<2)return;
        var z=map.getZoom();
        var pts=_pm.map(function(m){var pp=map.project([m.trueLat,m.trueLng],z);return{x:pp.x,y:pp.y};});
        for(var it=0;it<12;it++){for(var i=0;i<pts.length;i++){for(var j=i+1;j<pts.length;j++){
            var dx=pts[j].x-pts[i].x,dy=pts[j].y-pts[i].y,d=Math.sqrt(dx*dx+dy*dy);
            if(d<_MD&&d>0){var pu=(_MD-d)/2,nx=dx/d,ny=dy/d;pts[i].x-=nx*pu;pts[i].y-=ny*pu;pts[j].x+=nx*pu;pts[j].y+=ny*pu;}
            else if(d===0){var a=(i*2.39996)%(Math.PI*2);pts[i].x-=Math.cos(a)*_MD/2;pts[i].y-=Math.sin(a)*_MD/2;pts[j].x+=Math.cos(a)*_MD/2;pts[j].y+=Math.sin(a)*_MD/2;}
        }}}
        pts.forEach(function(pt,i){
            var m=_pm[i],nll=map.unproject(L.point(pt.x,pt.y),z);
            var orig=map.project([m.trueLat,m.trueLng],z);
            var dis=Math.abs(pt.x-orig.x)>1||Math.abs(pt.y-orig.y)>1;
            if(m.marker.setLatLng)m.marker.setLatLng(nll);
            else if(m.marker._latlng){m.marker._latlng=nll;m.marker.redraw();}
            if(dis){m.line.setLatLngs([[m.trueLat,m.trueLng],[nll.lat,nll.lng]]);m.line.setStyle({opacity:0.45});}
            else{m.line.setStyle({opacity:0});}
        });
    };
    _rep();_layoutLabels(_pm,map);
    map.on('zoomend',function(){_rep();_layoutLabels(_pm,map);});
    if(_pm.length)_addLabelToggle(map,el);
    setTimeout(function(){map.invalidateSize();_layoutLabels(_pm,map);},150);
}

(function(){
    var singleId = ${singleId ? `'${String(singleId).replace(/'/g, "\\'")}'` : 'null'};
    // For multi-project snapshots: render the org overview first.
    // For single-project snapshots: skip the org page entirely (it isn't in the DOM)
    // and render the one project page directly — no "back to overview" round-trip.
    function boot(){
        if (singleId) {
            try { showProjectPage(singleId); } catch(e){}
        } else {
            renderOrg(); initOrgMap();
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
<\/script>
</body>
</html>`;

            const ipcRenderer = electronAPI;
            const savePath = await ipcRenderer.invoke('pick-save-path', `${filenameBase}_${year}.html`);
            if (!savePath) return;
            electronAPI.fs.writeFileSync(savePath, html, 'utf-8');
            App.showMsg('Web snapshot saved!');
        } catch (err) {
            console.error(err);
            alert('Export failed: ' + err.message);
        }
    },

    // ===== ORG CALENDAR =====
    // ===== ORG-LEVEL ACTIVITIES (read-only roll-up across all projects) =====
    // Combines events + milestones from every SURGfund project into one timeline.
    // Re-uses the per-project filter UI (specific year / all time / range) and the
    // cumulative HCW-over-time chart so admins can see programme-wide activity.
    async renderOrgActivities(main) {
        const registry = Projects.registry || [];
        const projects = registry.filter(p => p.type === 'generic' && !p.isSample);
        const sample   = registry.find(p => p.type === 'generic' && p.isSample);
        if (sample && App.includeSample) projects.push(sample); // sample blends in/out via the org toggle

        // Load events + updates for every project in parallel
        const perProject = await Promise.all(projects.map(async p => {
            const [events, updates] = await Promise.all([
                Projects.getEvents(p.id),
                Projects.getUpdates(p.id)
            ]);
            return { project: p, events, updates };
        }));

        // Flatten + tag with project, then sort newest-first
        const allEvents = [];
        const allUpdates = [];
        perProject.forEach(({ project, events, updates }) => {
            (events  || []).forEach(e => allEvents.push({ ...e, _project: project }));
            (updates || []).forEach(u => allUpdates.push({ ...u, _project: project }));
        });

        // ── Year / range filter — same widget as the per-project Activities tab.
        const now = new Date();
        const yearMax = App.kpiYearMax != null ? Math.max(App.kpiYearMax, now.getFullYear() + 1) : now.getFullYear() + 1;
        const allYearsAv = [];
        for (let y = 2022; y <= yearMax; y++) allYearsAv.push(y);
        const aYear = App.activityYear ?? 'all';
        const aFrom = App.activityRangeFrom || 2022;
        const aTo   = App.activityRangeTo   || yearMax;
        const inFilter = (dateStr) => {
            if (!dateStr) return aYear === 'all';
            const y = Number(String(dateStr).slice(0, 4));
            if (isNaN(y)) return aYear === 'all';
            if (aYear === 'all') return true;
            if (aYear === 'range') return y >= aFrom && y <= aTo;
            return y === Number(aYear);
        };
        const yearChip = (val, label, active) =>
            `<button onclick="App.activityYear=${typeof val === 'string' ? `'${val}'` : val}; App.renderView()"
                class="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${active ? 'bg-gsf-boston text-white' : 'text-slate-500 hover:bg-slate-100'}">${label}</button>`;
        const yrButtons = allYearsAv.map(y => yearChip(y, String(y), aYear === y)).join('');
        const allTimeBtn = `<button onclick="App.activityYear='all'; App.renderView()"
            class="ml-0.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${aYear === 'all' ? 'bg-gsf-prussian text-white shadow-sm' : 'text-gsf-prussian bg-gsf-prussian/10 hover:bg-gsf-prussian/20'}"
            title="Show all activities across every year"><span class="text-[10px] ${aYear === 'all' ? 'opacity-90' : 'opacity-70'}">★</span> All time</button>`;
        const rangeBtn = `<button onclick="App.activityYear='range'; if(!App.activityRangeFrom)App.activityRangeFrom=${allYearsAv[0]}; if(!App.activityRangeTo)App.activityRangeTo=${allYearsAv[allYearsAv.length-1]}; App.renderView()"
            class="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${aYear === 'range' ? 'bg-gsf-prussian text-white' : 'text-slate-500 hover:bg-slate-100'}"
            title="Filter activities by a year range">Range…</button>`;
        const rangePicker = aYear === 'range' ? `
            <div class="flex items-center gap-2 px-3 py-2 mt-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                <span class="font-bold uppercase text-slate-500">From</span>
                <select onchange="App.activityRangeFrom=Number(this.value); App.renderView()" data-viewer-allowed
                    class="px-2 py-1 border border-slate-200 rounded text-sm bg-white">
                    ${allYearsAv.map(y => `<option value="${y}" ${y === aFrom ? 'selected' : ''}>${y}</option>`).join('')}
                </select>
                <span class="font-bold uppercase text-slate-500">to</span>
                <select onchange="App.activityRangeTo=Number(this.value); App.renderView()" data-viewer-allowed
                    class="px-2 py-1 border border-slate-200 rounded text-sm bg-white">
                    ${allYearsAv.map(y => `<option value="${y}" ${y === aTo ? 'selected' : ''}>${y}</option>`).join('')}
                </select>
            </div>` : '';
        const activityYearSelector = `
            <div class="flex items-center gap-1 bg-slate-100 rounded-lg p-1 flex-wrap" data-viewer-allowed>${yrButtons}<span class="w-px h-5 bg-slate-300 mx-1 inline-block align-middle"></span>${allTimeBtn}${rangeBtn}</div>
            ${rangePicker}`;
        const filterLabel = aYear === 'all' ? 'all time' : aYear === 'range' ? `${aFrom}–${aTo}` : String(aYear);

        // ── Apply filter to events + updates
        const filteredEvents  = allEvents.filter(e => inFilter(e.date));
        const filteredUpdates = allUpdates.filter(u => inFilter(u.date));

        // ── HCW counters (programme-wide)
        const totalHcw    = filteredEvents.reduce((s, e) => s + (Number(e.hcw_count)     || 0), 0);
        const totalHcwNew = filteredEvents.reduce((s, e) => s + (Number(e.hcw_new_count) || 0), 0);
        const totalActivities = filteredEvents.length + filteredUpdates.length;
        const projectsActive  = new Set([
            ...filteredEvents.map(e => e._project.id),
            ...filteredUpdates.map(u => u._project.id),
        ]).size;

        const statCards = `
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <div class="bg-white border border-slate-200 rounded-xl p-4">
                    <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">Activities</p>
                    <p class="text-xl font-black text-gsf-prussian leading-tight">${this._fmt(totalActivities)}</p>
                </div>
                <div class="bg-white border border-slate-200 rounded-xl p-4">
                    <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">Projects active</p>
                    <p class="text-xl font-black text-gsf-prussian leading-tight">${this._fmt(projectsActive)}</p>
                </div>
                <div class="bg-white border border-slate-200 rounded-xl p-4">
                    <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">HCWs logged</p>
                    <p class="text-xl font-black text-gsf-prussian leading-tight">${this._fmt(totalHcw)}</p>
                </div>
                <div class="bg-white border border-slate-200 rounded-xl p-4">
                    <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">New (unduplicated)</p>
                    <p class="text-xl font-black text-gsf-prussian leading-tight">${this._fmt(totalHcwNew)}</p>
                </div>
            </div>`;

        // ── Combined timeline (events + updates), newest first
        const allEntries = [
            ...filteredEvents .map(e => ({ ...e, _kind: 'event'     })),
            ...filteredUpdates.map(u => ({ ...u, _kind: 'milestone' })),
        ].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        const rows = allEntries.map(e => {
            const projColor = e._project.color || '#64748b';
            const projName  = App.escapeHtml(e._project.shortName || e._project.name);
            const projChip  = `<button onclick="event.stopPropagation(); GenericViews._jumpToProjectActivities('${e._project.id}')"
                class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide hover:underline" style="background:${projColor}1A;color:${projColor}" title="Jump to ${projName}'s Activities">${projName}</button>`;
            if (e._kind === 'event') {
                const details = [];
                if (e.hcw_count)        details.push(`<span class="text-blue-600">${this._fmt(e.hcw_count)} HCW${e.hcw_new_count ? ' (' + this._fmt(e.hcw_new_count) + ' new)' : ''}</span>`);
                if (e.facilities_count) details.push(`<span class="text-amber-600">${e.facilities_count} facilit${e.facilities_count === 1 ? 'y' : 'ies'}</span>`);
                return `<tr class="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onclick="GenericViews._showActivityDetail('${e._project.id}','event','${e.id}')">
                    <td class="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">${this._fmtEventDate(e)}</td>
                    <td class="px-4 py-2">${projChip}</td>
                    <td class="px-4 py-2">${this._eventTypeBadge(e.type)}</td>
                    <td class="px-4 py-2 text-sm text-slate-800 font-medium">${App.escapeHtml(e.title || '')}</td>
                    <td class="px-4 py-2 text-xs">${details.join(' · ')}</td>
                </tr>`;
            }
            const linkIcon = e.link ? ` <a href="${App.escapeHtml(e.link)}" onclick="event.stopPropagation(); electronAPI.openExternal('${App.escapeHtml(e.link)}'); return false;" class="inline-flex items-center text-gsf-boston hover:text-gsf-prussian ml-1"><i data-lucide="external-link" width="12"></i></a>` : '';
            return `<tr class="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onclick="GenericViews._showActivityDetail('${e._project.id}','update','${e.id}')">
                <td class="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">${e.date || ''}</td>
                <td class="px-4 py-2">${projChip}</td>
                <td class="px-4 py-2"><span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-purple-100 text-purple-700"><i data-lucide="flag" width="10"></i>Milestone</span></td>
                <td class="px-4 py-2 text-sm text-slate-800 font-medium">${App.escapeHtml(e.title || '')}${linkIcon}</td>
                <td class="px-4 py-2 text-xs"></td>
            </tr>`;
        }).join('');

        const hasHcwData = filteredEvents.some(e => Number(e.hcw_count) > 0 || Number(e.hcw_new_count) > 0);

        main.innerHTML = `
            <div class="p-6 md:p-10 fade-in w-full max-w-6xl mx-auto">
                <header class="mb-6 flex items-start justify-between flex-wrap gap-3">
                    <div>
                        <h1 class="text-2xl font-bold text-gsf-prussian">Activity Log</h1>
                        <p class="text-sm text-slate-500 mt-1">All activities across every project — read-only roll-up. Click any row to open the full activity card.</p>
                    </div>
                    <div class="flex flex-col items-end gap-1">
                        ${activityYearSelector}
                        <p class="text-[10px] text-slate-400 italic">Showing <strong class="text-slate-600">${filterLabel}</strong> · ${projects.length} project${projects.length !== 1 ? 's' : ''}</p>
                    </div>
                </header>

                ${statCards}

                ${hasHcwData ? `
                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-8">
                    <div class="flex items-baseline justify-between mb-4">
                        <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide">HCWs over time — programme-wide</h2>
                        <p class="text-[11px] text-slate-400">Cumulative across all projects · hover any point for activity detail</p>
                    </div>
                    <div id="org-hcw-time-chart" style="width:100%; height:300px;"></div>
                </div>` : ''}

                ${allEntries.length > 0 ? `
                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide mb-4">All Entries <span class="text-slate-400 font-normal normal-case">(${allEntries.length})</span></h2>
                    <div class="overflow-x-auto">
                        <table class="w-full">
                            <thead><tr class="border-b-2 border-slate-200">
                                <th class="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Date</th>
                                <th class="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Project</th>
                                <th class="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Type</th>
                                <th class="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Title</th>
                                <th class="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Details</th>
                            </tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>
                ` : '<p class="text-sm text-slate-400 italic text-center py-8">No activities in this period.</p>'}
            </div>`;

        if (window.lucide) lucide.createIcons();
        if (hasHcwData) {
            setTimeout(() => this._drawOrgHcwOverTimeChart(filteredEvents), 100);
        }
    },

    // Org-wide variant of the per-project HCW-over-time chart. Each point is one activity;
    // hovering shows the activity card (project + title + cumulative running totals).
    _drawOrgHcwOverTimeChart(events) {
        const el = document.getElementById('org-hcw-time-chart');
        if (!el || !window.google?.visualization) return;
        const hasH  = (v) => v !== null && v !== undefined && v !== '' && Number(v) > 0;
        const dated = (events || []).filter(e => e.date && (hasH(e.hcw_count) || hasH(e.hcw_new_count)))
            .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        if (dated.length === 0) { el.innerHTML = '<p class="text-xs text-slate-300 italic text-center pt-16">No HCW data yet</p>'; return; }

        let cumTotal = 0, cumNew = 0;
        const points = dated.map(e => {
            cumTotal += Number(e.hcw_count)     || 0;
            cumNew   += Number(e.hcw_new_count) || 0;
            return { date: e.date, cumTotal, cumNew, event: e };
        });

        const dt = new google.visualization.DataTable();
        dt.addColumn('date', 'Date');
        dt.addColumn('number', 'Cumulative HCWs');
        dt.addColumn({ type: 'string', role: 'tooltip', p: { html: true } });
        dt.addColumn('number', 'New HCWs (cumulative)');
        dt.addColumn({ type: 'string', role: 'tooltip', p: { html: true } });

        const escape = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const fmtDate = (s) => { const [y,m,d] = String(s).split('-'); return new Date(Number(y), Number(m)-1, Number(d)); };
        points.forEach(p => {
            const projName = (p.event._project && (p.event._project.shortName || p.event._project.name)) || '';
            const projColor = (p.event._project && p.event._project.color) || '#64748b';
            const projLine = projName
                ? `<div style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;background:${projColor}1A;color:${projColor};margin-bottom:4px">${escape(projName)}</div>`
                : '';
            const tipTotal = `<div style="padding:8px 10px;font-size:12px;line-height:1.4;max-width:260px">
                ${projLine}
                <strong>${escape(p.event.title)}</strong><br>
                <span style="color:#94a3b8">${escape(p.event.date)}</span><br>
                +${(Number(p.event.hcw_count) || 0).toLocaleString()} HCW this activity<br>
                <strong style="color:#4389C8">${p.cumTotal.toLocaleString()} HCW</strong> cumulative
            </div>`;
            const tipNew = `<div style="padding:8px 10px;font-size:12px;line-height:1.4;max-width:260px">
                ${projLine}
                <strong>${escape(p.event.title)}</strong><br>
                <span style="color:#94a3b8">${escape(p.event.date)}</span><br>
                +${(Number(p.event.hcw_new_count) || 0).toLocaleString()} new HCW this activity<br>
                <strong style="color:#10b981">${p.cumNew.toLocaleString()} new HCW</strong> cumulative
            </div>`;
            dt.addRow([fmtDate(p.date), p.cumTotal, tipTotal, p.cumNew, tipNew]);
        });

        const chart = new google.visualization.LineChart(el);
        const opts = {
            height: 300,
            legend: { position: 'top', alignment: 'end', textStyle: { fontSize: 11, color: '#64748b' } },
            colors: ['#4389C8', '#10b981'],
            chartArea: { left: 60, top: 30, right: 30, bottom: 50, width: '88%', height: '76%' },
            hAxis: { textStyle: { fontSize: 11, color: '#64748b' }, baselineColor: '#e2e8f0', gridlines: { color: 'transparent' }, format: 'MMM yyyy' },
            vAxis: { textStyle: { fontSize: 10, color: '#94a3b8' }, baselineColor: '#e2e8f0', gridlines: { color: '#f1f5f9', count: 5 }, minorGridlines: { count: 0 }, minValue: 0, format: 'short' },
            lineWidth: 2.5,
            pointSize: 9,
            pointShape: 'circle',
            tooltip: { isHtml: true, trigger: 'focus', ignoreBounds: true },
            backgroundColor: 'transparent',
            interpolateNulls: false,
            focusTarget: 'datum',
            crosshair: { trigger: 'focus', orientation: 'vertical', color: '#cbd5e1', opacity: 0.4 }
        };
        chart.draw(dt, opts);

        google.visualization.events.addListener(chart, 'select', () => {
            const sel = chart.getSelection();
            if (!sel || sel.length === 0) return;
            const row = sel[0].row;
            if (row === null || row === undefined) return;
            const ev = points[row].event;
            if (ev && ev.id && ev._project) GenericViews._showActivityDetail(ev._project.id, 'event', ev.id);
        });
    },

    async renderOrgCalendar(main) {
        const genericProjects = Projects.registry.filter(p => p.type === 'generic' && (App.includeSample || !p.isSample));
        const allData = await Promise.all(genericProjects.map(async p => {
            const [events, updates] = await Promise.all([Projects.getEvents(p.id), Projects.getUpdates(p.id)]);
            return { project: p, events, updates };
        }));

        // Tag events with project info for display
        const allEvents  = allData.flatMap(d => d.events.map(e  => ({ ...e, _projectName: d.project.name, _projectColor: d.project.color })));
        const allUpdates = allData.flatMap(d => d.updates.map(u => ({ ...u, _projectName: d.project.name, _projectColor: d.project.color })));

        const now   = new Date();
        const year  = (App.calYear  != null) ? App.calYear  : now.getFullYear();
        const month = (App.calMonth != null) ? App.calMonth : now.getMonth();

        main._isOrg = true;
        this._renderCalendarGrid(main, 'Organisation', '#002F4C', year, month, allEvents, allUpdates, genericProjects);
    },

    // ===== UPDATES TIMELINE =====
    async renderUpdates(main, project) {
        const updates = await Projects.getUpdates(project.id);
        const today = new Date().toISOString().split('T')[0];
        const editingUpdId = App.editingUpdateId || null;
        const editingUpd   = editingUpdId ? updates.find(u => u.id === editingUpdId) : null;
        const pfUpd = (field, fallback = '') => editingUpd ? (editingUpd[field] !== undefined ? editingUpd[field] : fallback) : fallback;
        const showForm = App.showUpdateForm || !!editingUpd;

        const TAG_OPTIONS = ['', 'Milestone', 'Partnership', 'Publication', 'News Article', 'Event/Conference', 'Grant', 'Other'];
        const currentTag  = (pfUpd('tags') || [])[0] || '';

        const addForm = `
            <div class="bg-white rounded-xl border ${editingUpd ? 'border-amber-300' : 'border-slate-200'} shadow-sm p-6 mb-8">
                ${editingUpd ? `<div class="flex items-center gap-3 mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <i data-lucide="pencil" width="14" class="text-amber-600 shrink-0"></i>
                    <p class="text-sm text-amber-800 font-medium flex-1">Editing: <strong>${App.escapeHtml(editingUpd.title || '')}</strong></p>
                    <button onclick="App.editingUpdateId=null; App.showUpdateForm=false; App.renderView()" class="text-xs text-amber-600 hover:text-amber-800 font-bold">Cancel</button>
                </div>` : ''}
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    <div class="sm:col-span-2">
                        <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Title *</label>
                        <input type="text" id="upd-title" value="${App.escapeHtml(pfUpd('title'))}" placeholder="Brief summary" required class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Date *</label>
                        <input type="date" id="upd-date" value="${pfUpd('date', today)}" required class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Tag</label>
                        <select id="upd-tags" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30">
                            ${TAG_OPTIONS.map(t => `<option value="${t}" ${currentTag === t ? 'selected' : ''}>${t || '— Select tag —'}</option>`).join('')}
                        </select>
                    </div>
                    <div class="sm:col-span-2">
                        <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Link <span class="font-normal text-slate-400 normal-case">(optional)</span></label>
                        <input type="url" id="upd-link" value="${App.escapeHtml(pfUpd('link'))}" placeholder="https://…" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                    </div>
                    <div class="sm:col-span-2">
                        <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Details</label>
                        <textarea id="upd-body" rows="4" placeholder="Describe progress, milestones, challenges..." class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30 resize-y">${App.escapeHtml(pfUpd('body'))}</textarea>
                    </div>
                </div>
                <button onclick="GenericViews._saveNarrativeUpdate('${project.id}')" class="px-6 py-2.5 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors">${editingUpd ? 'Save Changes' : 'Save Update'}</button>
            </div>`;

        const updateCards = updates.map(u => {
            const tagHtml = (u.tags || []).map(t => `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-100 text-slate-600">${App.escapeHtml(t)}</span>`).join(' ');
            return `
                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-3">
                    <div class="flex items-start justify-between gap-4">
                        <div class="flex-1">
                            <div class="flex items-center gap-2 mb-1">
                                <span class="text-xs font-medium text-slate-400">${u.date}</span>
                                ${tagHtml}
                            </div>
                            <h3 class="text-sm font-bold text-slate-800">${App.escapeHtml(u.title)}${u.link ? ` <a href="${App.escapeHtml(u.link)}" onclick="event.stopPropagation(); electronAPI.openExternal('${App.escapeHtml(u.link)}'); return false;" class="inline-flex items-center text-gsf-boston hover:text-gsf-prussian ml-1" title="${App.escapeHtml(u.link)}"><i data-lucide="external-link" width="12"></i></a>` : ''}</h3>
                            ${u.body ? `<p class="text-sm text-slate-600 mt-1 whitespace-pre-line">${App.escapeHtml(u.body)}</p>` : ''}
                        </div>
                        <div class="flex items-center gap-2 shrink-0">
                            <button onclick="GenericViews._editUpdate('${project.id}', '${u.id}')" class="text-slate-300 hover:text-gsf-boston" title="Edit">
                                <i data-lucide="pencil" width="14"></i>
                            </button>
                            <button onclick="GenericViews._deleteNarrativeUpdate('${project.id}', '${u.id}')" class="text-slate-300 hover:text-red-500" title="Delete">
                                <i data-lucide="trash-2" width="14"></i>
                            </button>
                        </div>
                    </div>
                </div>`;
        }).join('');

        main.innerHTML = `
            <div class="p-6 md:p-10 fade-in w-full max-w-6xl mx-auto">
                <header class="mb-8 flex items-center justify-between">
                    <h1 class="text-2xl font-bold text-gsf-prussian">Updates</h1>
                    ${!showForm ? `<button onclick="App.showUpdateForm=true; App.renderView()" class="px-4 py-2 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors flex items-center gap-2">
                        <i data-lucide="plus" width="16"></i> Add Update
                    </button>` : ''}
                </header>
                ${showForm ? addForm : ''}
                ${updates.length === 0 && !showForm ? '<p class="text-slate-400 italic">No updates yet.</p>' : updateCards}
            </div>`;

        if (window.lucide) lucide.createIcons();
    },

    async _saveNarrativeUpdate(projectId) {
        const date  = (document.getElementById('upd-date')  || document.getElementById('update-date'))?.value;
        const title = (document.getElementById('upd-title') || document.getElementById('update-title'))?.value?.trim();
        const body  = (document.getElementById('upd-body')  || document.getElementById('update-body'))?.value?.trim();
        const link  = (document.getElementById('upd-link'))?.value?.trim() || '';
        const tagsVal = (document.getElementById('upd-tags') || document.getElementById('update-tags'))?.value?.trim();
        if (!date || !title) { App.showMsg('Date and title are required.', true); return; }
        const tags = tagsVal ? [tagsVal] : [];
        const id = App.editingUpdateId || null;
        await Projects.saveUpdate(projectId, { id, date, title, body, tags, link });
        App.editingUpdateId = null;
        App.showUpdateForm = false;
        App.renderView();
    },

    async _deleteNarrativeUpdate(projectId, updateId) {
        const updates = await Projects.getUpdates(projectId);
        const idx = updates.findIndex(u => u.id === updateId);
        if (idx === -1) return;
        const removed = updates.splice(idx, 1)[0];
        await Projects.replaceUpdates(projectId, updates);
        App.renderView();
        App.showUndo('Update deleted', async () => {
            const current = await Projects.getUpdates(projectId);
            current.splice(idx, 0, removed);
            await Projects.replaceUpdates(projectId, current);
            App.renderView();
        });
    },

    // ===== ORG METHODOLOGY =====
    renderOrgMethodology(main) {
        const s = (title, body, anchor) => `<div class="mb-8 scroll-mt-4" ${anchor ? `id="${anchor}"` : ''}><h3 class="text-sm font-black text-gsf-prussian uppercase tracking-wide mb-3 flex items-center gap-2"><span class="w-1.5 h-5 rounded bg-gsf-polo inline-block"></span>${App.escapeHtml(title)}</h3><div class="text-sm text-slate-600 leading-relaxed space-y-3">${body}</div></div>`;
        const kpiCard = (icon, color, name, def, examples, dataCollection) => `
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-4">
                <div class="flex items-center gap-3 mb-4">
                    <div class="w-10 h-10 rounded-lg flex items-center justify-center" style="background:${color}15"><i data-lucide="${icon}" width="20" style="color:${color}"></i></div>
                    <div><p class="text-base font-black text-gsf-prussian">${name}</p></div>
                </div>
                <div class="text-sm text-slate-600 leading-relaxed space-y-3">
                    <p>${def}</p>
                    ${examples ? `<div class="bg-slate-50 rounded-lg p-4 mt-3"><p class="text-xs font-bold text-slate-500 uppercase mb-2">Examples</p><ul class="list-disc list-inside text-sm text-slate-600 space-y-1">${examples}</ul></div>` : ''}
                    ${dataCollection ? `<div class="mt-3"><p class="text-xs font-bold text-slate-500 uppercase mb-1">Data Collection</p><p class="text-sm text-slate-500">${dataCollection}</p></div>` : ''}
                </div>
            </div>`;

        main.innerHTML = `
            <div class="max-w-4xl mx-auto py-8 px-4">
                <div class="mb-8">
                    <h1 class="text-2xl font-black text-gsf-prussian mb-1">Impact Measurement Framework</h1>
                    <p class="text-sm text-slate-400">Version 2.2 &middot; GSF Methodology</p>
                </div>

                ${s('About SURGdash', `
                    <p>SURGdash is GSF's internal impact tracking and reporting tool. It aggregates data across all GSF-supported projects to provide real-time visibility into the organisation's reach and impact across its core domains.</p>
                    <p>The app tracks <strong>four core KPIs</strong> (Healthcare Workers Strengthened, Patients Reached, Population with Improved Access, and Facilities Strengthened), quality indicators, project events, and facility-level data. Each project can set annual targets and record actuals, which roll up into the organisation-wide dashboard.</p>
                    <p>Data can be entered manually, synchronised to Google Sheets for collaborative editing, and exported as snapshots or reports. All data is stored locally with optional cloud backup.</p>
                `)}

                ${s('Impact Levels', `
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div class="bg-blue-50 rounded-xl p-5 border border-blue-100">
                            <p class="text-xs font-black text-blue-800 uppercase mb-2">Level 1: Reach (Macro)</p>
                            <p class="text-sm text-blue-900">High-reach activities that support large numbers of healthcare workers and promote general awareness, knowledge, or knowledge-sharing. These are typically light-touch and results may not be directly attributable to changes in behaviour or patient outcomes.</p>
                            <p class="text-xs text-blue-700 mt-2 italic">Examples: SURGhub self-paced courses, open-access webinars, standalone learning events.</p>
                        </div>
                        <div class="bg-emerald-50 rounded-xl p-5 border border-emerald-100">
                            <p class="text-xs font-black text-emerald-800 uppercase mb-2">Level 2: Impact (Micro)</p>
                            <p class="text-sm text-emerald-900">Targeted, outcome-focused interventions designed to achieve measurable and transformative change at the facility, subnational, and country level. These are structured to strengthen the surgical workforce, improve care quality, and expand access.</p>
                            <p class="text-xs text-emerald-700 mt-2 italic">Examples: Country-level SURGfund projects, blended learning with mentoring, supervision, and follow-up.</p>
                        </div>
                    </div>
                    <p class="mt-3 text-slate-500 text-xs">Both levels are tracked separately. Only Level 2 initiatives are included in core metric reporting, but both contribute meaningfully to GSF's mission.</p>
                `)}

                <div class="mb-2 mt-10"><h2 class="text-lg font-black text-gsf-prussian uppercase tracking-wide">Core Impact Domains</h2><p class="text-sm text-slate-400 mt-1">GSF measures impact across three core domains plus one supplementary metric.</p></div>

                ${kpiCard('stethoscope', '#4389C8', 'Healthcare Workers Strengthened',
                    'The total number of unique healthcare workers who have participated in at least one learning or capacity-building activity delivered through GSF initiatives, whether online or in person, during the specified reporting period. This captures the reach and uptake of GSF-supported capacity-building interventions. Where relevant, the indicator may be disaggregated by gender and health workforce cadre.',
                    '<li>Participants in in-person training workshops on clinical and non-technical skills</li><li>Mentors/trainers who participated in dedicated facilitator skills workshops</li><li>Participants in virtual training or online Communities of Practice with tracked participation</li><li>Unique registered users in self-paced online courses (Level 1)</li>',
                    'Participant registration records, partner reporting templates (with unique identifiers to avoid double counting), project-specific SURGhub platforms, and mentor/supervisor logs.'
                )}

                ${kpiCard('heart', '#D03734', 'Patients Reached with Improved Surgical Care',
                    'The number of patients who have received improved surgical care through a surgical care system strengthened by a GSF-supported intervention. These are individuals whose surgical care has become safer, more timely, more effective, or more respectful due to improvements in workforce capacity, facility readiness, referral systems, and the use of data for continuous learning. The metric captures indirect but measurable benefits resulting from systems-level improvements.',
                    '<li>Patients benefiting from specific services in facilities participating in GSF-supported projects (e.g. women delivering in maternal health facilities, cervical cancer screening)</li><li>Patients treated by healthcare workers trained or mentored through GSF initiatives</li><li>Patients benefiting from new surgical services at a supported facility</li><li>Patients able to access care due to stronger referral systems or improved care coordination</li>',
                    'Facility data on patient volumes (surgical logs, operating theatre registers) as communicated by implementing partners, aggregated counts of procedures or admissions from supported facilities.'
                )}

                ${kpiCard('globe', '#10B981', 'Population with Improved Access to Surgical Care',
                    'The number of people living within catchment areas of health facilities supported by GSF projects, who now have improved access to more timely, safer, and more affordable surgical care. This is a proxy for potential population-level impact. While this figure does not represent individuals who directly accessed care, it captures the broader population who now have improved access to better-quality services as a result of GSF\'s interventions.',
                    '<li>Catchment population of district, region, or service area where supported facilities operate</li><li>Populations are not double-counted when multiple facilities are supported within the same region</li>',
                    'Catchment population figures from supported hospitals or health authorities. Where data is unavailable, conservative estimates are applied based on administrative population, census data, or service utilisation data as a proxy.'
                )}

                ${kpiCard('building-2', '#E28743', 'Facilities Strengthened',
                    'The number of health facilities meaningfully strengthened through GSF-supported activities to improve their capacity to deliver safe, timely, and high-quality surgical care. A facility is considered "strengthened" if it has benefited from at least one of: deployment or training of surgical workforce, introduction or expansion of essential surgical services, provision of critical equipment or infrastructure, implementation of new clinical protocols or quality improvement processes, or integration into a referral network strengthened by GSF.',
                    '<li>Hospitals, surgical centres, health centres with surgical capability, or maternity units offering obstetric surgery</li><li>Captures institutional capacity building, not one-time activities or ad hoc support</li>',
                    'Partner reports, baseline and endline facility assessments, implementation logs, infrastructure or equipment checklists, documentation of service availability and readiness.'
                )}

                ${s('Data Quality Assurance', `
                    <div class="bg-slate-50 rounded-xl p-5 border border-slate-200">
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                            <div><p class="font-bold text-slate-700 mb-1">Data Sources</p><p class="text-slate-500">Implementing partners and health facilities, GSF-supported digital platforms (e.g. SURGhub), national health information systems, and field verification or audit when appropriate.</p></div>
                            <div><p class="font-bold text-slate-700 mb-1">Frequency</p><p class="text-slate-500">Regular reporting by partners as per partnership agreements, annual aggregation and synthesis, and continuous data capture via digital platforms where feasible.</p></div>
                            <div><p class="font-bold text-slate-700 mb-1">Quality Controls</p><p class="text-slate-500">Standardised templates and guidance for partners, use of unique identifiers to prevent duplication, spot audits and cross-validation with health system data, and routine review of M&amp;E tools.</p></div>
                            <div><p class="font-bold text-slate-700 mb-1">Use of Data</p><p class="text-slate-500">Strategic decision-making, donor reporting and accountability, advocacy and policy influence, and organisational learning and improvement.</p></div>
                        </div>
                    </div>
                `)}

                ${s('Quality Indicators', `
                    <p>In addition to the four core KPIs, each project can track <strong>quarterly quality and outcome indicators</strong>. These are context-specific metrics that provide deeper insight into project performance. Preset indicators include Surgical Site Infection Rate (SSI), Maternal Mortality Rate (MMR), Perinatal Mortality Rate (PMR), and C-section Rate, but projects can define custom quality KPIs relevant to their context.</p>
                    <p>Quality indicators are tracked per quarter, with optional targets, and visualised as trend charts on each project's dashboard.</p>
                `)}

                <div class="mb-2 mt-10"><h2 class="text-lg font-black text-gsf-prussian uppercase tracking-wide">Economic Impact Framework</h2><p class="text-sm text-slate-400 mt-1">How quality-indicator improvements convert to lives saved, DALYs averted, and economic value — and how each project's allocated budget compares to the cost.</p></div>

                ${s('Overview', `
                    <p>For projects that supply <strong>Impact Assumptions</strong> in Settings (baseline rates, annual volumes, GDP per capita), the dashboard estimates the <strong>health and economic value</strong> created by the project's improvements in quality indicators.</p>
                    <p>The framework uses the global health field's standard currency, the <strong>Disability-Adjusted Life-Year (DALY)</strong> — one year of healthy life lost to death or disability. It is the basis of WHO's Global Burden of Disease, the World Bank's Disease Control Priorities (3rd edition), and most major funders' cost-effectiveness analyses.</p>
                    <p class="text-xs text-slate-500 italic">All numbers are conservative point estimates using published coefficients. Real impact depends on counterfactual, attribution, and context — these figures are best read as <em>directional</em> evidence of cost-effectiveness, not exact accounts.</p>
                `)}

                ${s('What inputs drive the calculation', `
                    <div class="bg-emerald-50 rounded-xl p-5 border border-emerald-100">
                        <p class="text-sm font-bold text-emerald-900 mb-2">Per-project Impact Assumptions (set in Settings):</p>
                        <ul class="text-sm text-emerald-900 space-y-1 list-disc list-inside">
                            <li><strong>Baseline SSI Rate (%)</strong> — pre-intervention surgical-site infection rate at supported facilities</li>
                            <li><strong>Baseline SSC Utilisation (%)</strong> — pre-intervention Surgical Safety Checklist adoption</li>
                            <li><strong>Baseline MMR (per 100k live births)</strong> — pre-intervention maternal mortality</li>
                            <li><strong>Baseline NMR (per 1k live births)</strong> — pre-intervention neonatal mortality</li>
                            <li><strong>Annual surgical volume</strong> — total surgeries per year across supported facilities</li>
                            <li><strong>Annual live births</strong> — basis for converting MMR/NMR to absolute deaths</li>
                            <li><strong>GDP per capita (USD)</strong> — for DALY monetisation and the WHO cost-effectiveness threshold</li>
                        </ul>
                    </div>
                    <p class="text-xs text-slate-500 mt-3">The dashboard reads these alongside the project's quarterly quality-indicator actuals and yearly KPI actuals. If essential inputs are missing, the Economic Impact section is hidden and the user is prompted to configure them.</p>
                `)}

                ${s('SSI Rate → bed-days, mortality, dollars', `
                    <p>For each project year, we compute the <strong>delta in SSI rate</strong> (baseline − actual) and apply it to the annual surgical volume:</p>
                    <div class="bg-slate-50 rounded-lg p-4 my-2 font-mono text-xs text-slate-700">
                        SSIs averted = (baseline_SSI − current_SSI) / 100 × surgical_volume<br>
                        Bed-days saved = SSIs_averted × 8<br>
                        Dollars saved = SSIs_averted × USD 1,500<br>
                        SSI-attributable deaths averted = SSIs_averted × 5%
                    </div>
                    <p class="text-xs text-slate-500"><strong>Coefficients:</strong> 8-day extra length-of-stay per SSI (CDC, ECDC); USD 1,500 mid-LMIC care cost (Allegranzi et al., 2011, <em>Lancet</em>); 5% case-fatality (midpoint of 3-11% range across LMIC studies).</p>
                `, 'econ-ssi')}

                ${s('MMR → maternal deaths averted', `
                    <div class="bg-slate-50 rounded-lg p-4 my-2 font-mono text-xs text-slate-700">
                        Maternal deaths averted = (baseline_MMR − current_MMR) / 100,000 × annual_live_births
                    </div>
                    <p>Each maternal death is weighted at <strong>32 DALYs</strong> (Years of Life Lost — WHO Global Burden of Disease, peri-natal-age women).</p>
                    <p class="text-xs text-slate-500">Note: this captures only direct mortality reduction. Severe maternal morbidity (the iceberg below mortality) and downstream orphan-effect costs are not included — making this a conservative estimate.</p>
                `, 'econ-mmr')}

                ${s('NMR → neonatal deaths averted (the biggest DALY lever)', `
                    <div class="bg-slate-50 rounded-lg p-4 my-2 font-mono text-xs text-slate-700">
                        Neonatal deaths averted = (baseline_NMR − current_NMR) / 1,000 × annual_live_births
                    </div>
                    <p>Each neonatal death is weighted at <strong>70 DALYs</strong>. Newborns lose nearly a full life expectancy, making NMR reduction the single highest-leverage indicator in the dataset.</p>
                    <p class="text-xs text-slate-500">Note: long-term morbidity in survivors (e.g. cerebral palsy from birth asphyxia) is excluded.</p>
                `, 'econ-nmr')}

                ${s('SSC Utilisation → mortality and morbidity reduction', `
                    <p>Based on the WHO Safe Surgery Saves Lives trial (Haynes et al., 2009, <em>New England Journal of Medicine</em>), which observed that full Surgical Safety Checklist adoption reduced in-hospital surgical mortality from <strong>1.5% → 0.8%</strong> (a 47% relative reduction).</p>
                    <div class="bg-slate-50 rounded-lg p-4 my-2 font-mono text-xs text-slate-700">
                        Adoption delta = (current_SSC% − baseline_SSC%) / 100<br>
                        SSC deaths averted = surgical_volume × 1.5% × 47% × adoption_delta
                    </div>
                    <p class="text-xs text-slate-500">Each SSC-attributable death is weighted at <strong>30 DALYs</strong> (average surgical patient). We attribute proportionally — at 50% adoption delta, we credit half the published effect size.</p>
                `, 'econ-ssc')}

                ${s('Aggregation, monetisation, ROI', `
                    <p>Across the project's full duration (or selected year):</p>
                    <div class="bg-slate-50 rounded-lg p-4 my-2 font-mono text-xs text-slate-700">
                        Total DALYs averted = (maternal × 32) + (neonatal × 70) + (SSI × 30) + (SSC × 30)<br>
                        Economic value = DALYs_averted × GDP_per_capita<br>
                        Cost per DALY averted = total_allocated_budget ÷ DALYs_averted<br>
                        Estimated return (×) = economic_value ÷ total_allocated_budget
                    </div>
                    <p>A project is <strong class="text-emerald-700">"highly cost-effective"</strong> by the WHO threshold when its cost-per-DALY is below <strong>3× GDP per capita</strong> of the country it serves. The dashboard colour-codes this automatically (green when below, amber when above).</p>
                    <p class="text-xs text-slate-500"><strong>Why GDP per capita?</strong> It's the WHO-CHOICE standard for valuing a year of healthy life in a given economy, and lets us compare interventions across very different settings on the same scale.</p>
                `, 'econ-aggregation')}

                ${s('HCW lifetime impact multiplier', `
                    <p>Beyond direct quality-indicator outcomes, every healthcare worker strengthened creates an economic multiplier through their future practice:</p>
                    <div class="bg-slate-50 rounded-lg p-4 my-2 font-mono text-xs text-slate-700">
                        Lifetime patient encounters = HCWs_strengthened × 17,500
                    </div>
                    <p class="text-xs text-slate-500"><strong>Coefficient:</strong> 17,500 = ~1,000 patients/year × 25-year career × 0.7 discount factor (network effects and attrition). Drawn from WHO Human Resources for Health methodology.</p>
                `, 'econ-hcw')}

                ${s('What this is NOT', `
                    <ul class="list-disc list-inside text-sm text-slate-600 space-y-1.5">
                        <li><strong>Not a causal claim.</strong> The framework attributes 100% of quality-indicator improvements to the project, which is unrealistic. In reality, secular trends, other interventions, and reporting changes contribute. A more rigorous attribution analysis would apply a counterfactual.</li>
                        <li><strong>Not a complete accounting.</strong> We exclude severe morbidity (only deaths), long-term productivity in survivors with disability, and downstream effects on dependents.</li>
                        <li><strong>Not a substitute for evaluation.</strong> Independent impact evaluation (cluster-randomised or quasi-experimental) is the gold standard. This is a quick estimate using transparent assumptions.</li>
                        <li><strong>Conservative.</strong> Coefficients are picked from the lower bounds of published ranges so headline numbers don't overstate impact.</li>
                    </ul>
                `)}

                ${s('Citations', `
                    <ul class="list-disc list-inside text-sm text-slate-600 space-y-1.5">
                        <li>Haynes AB, et al. (2009). <em>A surgical safety checklist to reduce morbidity and mortality in a global population.</em> N Engl J Med 360:491-9.</li>
                        <li>Allegranzi B, et al. (2011). <em>Burden of endemic health-care-associated infection in developing countries: systematic review and meta-analysis.</em> Lancet 377:228-41.</li>
                        <li>Meara JG, et al. (2015). <em>Global Surgery 2030: evidence and solutions for achieving health, welfare, and economic development.</em> Lancet Commission on Global Surgery.</li>
                        <li>Disease Control Priorities, Third Edition (DCP3), Volume 1: Essential Surgery (2015). World Bank.</li>
                        <li>WHO Global Burden of Disease — disability weights and DALY methodology (latest update).</li>
                        <li>WHO-CHOICE cost-effectiveness thresholds: highly cost-effective if &lt; 1× GDP/cap, cost-effective if &lt; 3× GDP/cap per DALY averted.</li>
                    </ul>
                `)}

                <div class="mt-10 pt-6 border-t border-slate-200">
                    <p class="text-xs text-slate-400">This framework is reviewed annually to ensure alignment with evolving best practices, partner feedback, and strategic priorities. Metric definitions and data processes are updated as needed for clarity, feasibility, and relevance.</p>
                </div>
            </div>`;
        if (window.lucide) lucide.createIcons();
    },

    // ===== ORG SETTINGS =====
    async renderOrgSettings(main) {
        const allKpis    = await Projects.getAllQualityKpis();
        const presetKpis = allKpis.filter(k => k.preset);
        const customKpis = allKpis.filter(k => !k.preset);
        const appSettings = await Projects.getAppSettings();
        const autoPullOn = !!(await Storage.getItem('surgdash_autopull_enabled'));

        const presetRows = presetKpis.map(kpi => `
            <div class="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div class="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style="background:${kpi.color}20">
                    <i data-lucide="${kpi.icon}" width="14" style="color:${kpi.color}"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-semibold text-slate-800">${kpi.shortName} — ${kpi.name}</p>
                    <p class="text-xs text-slate-400">${kpi.unit} · ${kpi.lowerIsBetter ? 'lower is better' : 'higher is better'}</p>
                </div>
                <span class="text-[10px] font-bold text-slate-400 uppercase px-2 py-0.5 bg-slate-200 rounded">Built-in</span>
            </div>`).join('');

        const customRows = customKpis.length > 0 ? customKpis.map(kpi => `
            <div class="flex items-center gap-3 p-3 rounded-lg bg-white border border-slate-200">
                <div class="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style="background:${kpi.color}20">
                    <i data-lucide="${kpi.icon || 'activity'}" width="14" style="color:${kpi.color}"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-semibold text-slate-800">${kpi.shortName} — ${kpi.name}</p>
                    <p class="text-xs text-slate-400">${kpi.unit} · ${kpi.lowerIsBetter ? 'lower is better' : 'higher is better'}</p>
                </div>
                <button onclick="GenericViews._deleteCustomQualityKpi('${kpi.id}')" class="text-red-400 hover:text-red-600 text-xs font-bold shrink-0">Remove</button>
            </div>`).join('') : '<p class="text-sm text-slate-400 italic">No custom quality indicators yet.</p>';

        main.innerHTML = `
            <div class="p-6 md:p-10 fade-in w-full max-w-3xl mx-auto">
                <header class="mb-8">
                    <h1 class="text-2xl font-bold text-gsf-prussian">Organisation Settings</h1>
                </header>

                <!-- Edit Password -->
                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6" data-edit-only>
                    <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide mb-1">Edit Password</h2>
                    <p class="text-xs text-slate-400 mb-4 max-w-lg">Set a password to protect edit mode. When a password is set, the app starts in read-only mode and requires the password to unlock editing. Share the app with colleagues — they see data but cannot modify it.</p>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label class="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wide">New Password</label>
                            <input type="password" id="edit-pw-input" placeholder="${App._editPasswordHash ? 'Enter new password to change' : 'Set a password'}"
                                class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wide">Confirm Password</label>
                            <input type="password" id="edit-pw-confirm" placeholder="Re-enter password"
                                class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <button onclick="GenericViews._saveEditPassword()" class="px-4 py-2 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors">${App._editPasswordHash ? 'Update Password' : 'Set Password'}</button>
                        ${App._editPasswordHash ? `<button onclick="GenericViews._removeEditPassword()" class="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-bold hover:bg-red-50 transition-colors">Remove Password</button>` : ''}
                    </div>
                    ${App._editPasswordHash ? `<div class="mt-3 flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2"><i data-lucide="shield-check" width="13"></i> Password is set — the app will start in read-only mode. Only you can unlock editing.</div>` : `<div class="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"><i data-lucide="alert-triangle" width="13"></i> No password set — the app is fully editable by anyone. Set a password before sharing with colleagues.</div>`}
                </div>

                <!-- Provider-Reporting Password -->
                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6" data-edit-only>
                    <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide mb-1">Provider-Reporting Password <span class="ml-1 text-[9px] font-bold uppercase tracking-wider text-amber-700 border border-amber-300 bg-amber-50 rounded-full px-1.5 py-0.5 align-middle">Limited access</span></h2>
                    <p class="text-xs text-slate-400 mb-4 max-w-lg">A second password for a teammate who only needs to build SURGhub provider reports — export reports, select / auto-select testimonials, and set the feedback date filter. They <strong>cannot</strong> edit SURGfund, run Data Sync, change Settings, or set the API key. Requires an edit password to be set above (so the app starts locked).</p>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label class="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wide">New Reporting Password</label>
                            <input type="password" id="report-pw-input" placeholder="${App._reportPasswordHash ? 'Enter new password to change' : 'Set a reporting password'}"
                                class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wide">Confirm Password</label>
                            <input type="password" id="report-pw-confirm" placeholder="Re-enter password"
                                class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <button onclick="GenericViews._saveReportPassword()" class="px-4 py-2 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors">${App._reportPasswordHash ? 'Update Password' : 'Set Password'}</button>
                        ${App._reportPasswordHash ? `<button onclick="GenericViews._removeReportPassword()" class="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-bold hover:bg-red-50 transition-colors">Remove Password</button>` : ''}
                    </div>
                    ${App._reportPasswordHash ? `<div class="mt-3 flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2"><i data-lucide="shield-check" width="13"></i> Reporting password is set — share it with the teammate who builds provider reports.</div>` : ''}
                </div>

                <!-- Google Sheets URL -->
                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
                    <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide mb-1">Google Sheets Integration</h2>
                    <p class="text-xs text-slate-400 mb-4">Enter your Google Apps Script Web App URL to sync data. After updating the script code, redeploy as a Web App.</p>
                    <div class="space-y-3">
                        <div>
                            <label class="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wide">Apps Script Web App URL <span class="font-normal text-slate-300">(for syncing data)</span></label>
                            <div class="flex gap-2">
                                <input type="text" id="org-sheets-url" value="${App.escapeHtml(appSettings.googleSheetsUrl || '')}"
                                    placeholder="https://script.google.com/macros/s/…/exec"
                                    class="flex-1 px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                                <button onclick="GenericViews._saveOrgSheetsUrl()" class="px-4 py-2 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors">Save</button>
                            </div>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wide">Spreadsheet URL <span class="font-normal text-slate-300">(for the Open Sheet button)</span></label>
                            <div class="flex gap-2">
                                <input type="text" id="org-sheets-view-url" value="${App.escapeHtml(appSettings.googleSheetsViewUrl || '')}"
                                    placeholder="https://docs.google.com/spreadsheets/d/…"
                                    class="flex-1 px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                                <button onclick="GenericViews._saveOrgSheetsViewUrl()" class="px-4 py-2 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors">Save</button>
                            </div>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wide">Claude (Anthropic) API key <span class="font-normal text-slate-300">(for AI testimonial scoring)</span></label>
                            <div class="flex gap-2 items-center">
                                <button onclick="App.setAnthropicKey()" class="px-4 py-2 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors">Set / change key</button>
                                <span class="text-xs text-slate-400">Stored locally on this machine only — never synced, exported, or shared.</span>
                            </div>
                        </div>
                        <div class="pt-3 border-t border-slate-100">
                            <label class="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wide">Automatic cloud pull <span class="font-normal text-slate-300">(this device only)</span></label>
                            <label class="flex items-start gap-3 cursor-pointer">
                                <input type="checkbox" id="org-autopull-toggle" data-viewer-allowed ${autoPullOn ? 'checked' : ''} onchange="GenericViews._toggleAutoPull(this.checked)"
                                    class="mt-0.5 rounded border-slate-300 text-gsf-boston focus:ring-gsf-boston/30" />
                                <span class="text-xs text-slate-500 leading-relaxed">Automatically pull updates from the cloud on launch and every 5&nbsp;min.
                                    <strong class="text-slate-600">Leave OFF if you edit data on this device</strong> — a pull overwrites local data, so auto-pull can revert unsynced edits. Turn ON only for a read-only viewer screen. You can always Pull/Push manually with the buttons above. ${autoPullOn ? '<span class="text-amber-600 font-semibold">Currently ON.</span>' : '<span class="text-emerald-600 font-semibold">Currently OFF — manual only (recommended for editors).</span>'}</span>
                            </label>
                            <div class="mt-2.5">
                                <button onclick="App.checkCloudUpdatesManually()" class="inline-flex items-center gap-1.5 px-3 py-1.5 border border-emerald-300 text-emerald-700 rounded-lg text-xs font-bold hover:bg-emerald-50 transition-colors">
                                    <i data-lucide="cloud-download" width="13"></i> Check for cloud updates
                                </button>
                                <span class="ml-2 text-[11px] text-slate-400">Asks the cloud if there's newer data — shows the banner if so, or confirms you're up to date.</span>
                            </div>
                        </div>
                    </div>
                    <div class="mt-4 bg-slate-900 rounded-lg p-4 flex items-start justify-between gap-3">
                        <p class="text-xs text-emerald-300 font-mono leading-relaxed break-all flex-1">Paste the Apps Script code below into your Google Sheet's script editor, then deploy as a Web App (Execute as: Me, Access: Anyone).</p>
                        <button onclick="navigator.clipboard.writeText(GenericViews._getAppsScriptCode()); this.textContent='Copied!'; setTimeout(()=>this.textContent='Copy Script',2000)"
                            class="shrink-0 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-bold transition-colors">Copy Script</button>
                    </div>
                </div>

                <!-- Built-in Quality Indicators -->
                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
                    <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide mb-1">Built-in Quality Indicators</h2>
                    <p class="text-xs text-slate-400 mb-4">These standard quarterly quality KPIs are available for all projects. They cannot be edited or removed.</p>
                    <div class="space-y-2">${presetRows}</div>
                </div>

                <!-- Custom Quality Indicators -->
                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
                    <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide mb-1">Custom Quality Indicators</h2>
                    <p class="text-xs text-slate-400 mb-4">Add organisation-specific quarterly quality KPIs. Once created, they appear in each project's Settings to enable.</p>
                    <div class="space-y-2 mb-5">${customRows}</div>

                    <div class="border-t border-slate-100 pt-5">
                        <h3 class="text-xs font-bold text-slate-500 uppercase mb-3">Add Custom Indicator</h3>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                            <div>
                                <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Full Name *</label>
                                <input type="text" id="cq-name" placeholder="e.g. Caesarean Section Rate"
                                    class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Short Name *</label>
                                <input type="text" id="cq-short" placeholder="e.g. CSR" maxlength="8"
                                    class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Unit *</label>
                                <input type="text" id="cq-unit" placeholder="e.g. % or per 1k"
                                    class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Colour</label>
                                <input type="color" id="cq-color" value="#6366F1"
                                    class="w-full h-10 px-1 py-1 border rounded-lg cursor-pointer" />
                            </div>
                            <div class="sm:col-span-2">
                                <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Icon</label>
                                <input type="hidden" id="cq-icon" value="activity" />
                                <div class="flex flex-wrap gap-2">
                                    ${['activity','heart','shield','shield-alert','clipboard-check','heart-pulse','thermometer','stethoscope','microscope','flask-conical','syringe','pill','baby','users','building-2','globe','target','trending-up','bar-chart-2','percent'].map(ic =>
                                        `<button type="button" onclick="document.getElementById('cq-icon').value='${ic}'; document.querySelectorAll('[data-cq-icon-btn]').forEach(b=>{b.classList.remove('ring-2','ring-gsf-boston','bg-gsf-boston/10')}); this.classList.add('ring-2','ring-gsf-boston','bg-gsf-boston/10')" data-cq-icon-btn
                                            class="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-100 transition-colors ${ic === 'activity' ? 'ring-2 ring-gsf-boston bg-gsf-boston/10' : ''}" title="${ic}">
                                            <i data-lucide="${ic}" width="16" class="text-slate-600"></i>
                                        </button>`
                                    ).join('')}
                                </div>
                            </div>
                            <div class="flex items-center gap-3 pt-5">
                                <input type="checkbox" id="cq-lower" class="rounded border-slate-300 text-gsf-boston focus:ring-gsf-boston/30" />
                                <label for="cq-lower" class="text-sm text-slate-700 cursor-pointer">Lower is better</label>
                            </div>
                        </div>
                        <button onclick="GenericViews._addCustomQualityKpi()" class="px-5 py-2 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors">Add Indicator</button>
                    </div>
                </div>

                <!-- ── Danger Zone — wipe all local data ──────────────────── -->
                <div class="bg-white rounded-xl border-2 border-red-200 shadow-sm p-6 mb-6" data-edit-only>
                    <h2 class="text-sm font-bold uppercase tracking-wide text-red-700 mb-1 flex items-center gap-2"><i data-lucide="alert-triangle" width="14"></i> Danger Zone</h2>
                    <p class="text-xs text-slate-500 mb-4 max-w-xl">Permanently delete every SURGfund project, SURGhub dataset, setting, and backup record from this machine. A <strong>full local backup is automatically downloaded first</strong> — if you cancel the save dialog the wipe is aborted. Use this only to clean the app before handing it to someone else or starting over.</p>
                    <div class="flex items-center gap-3 flex-wrap">
                        <button onclick="GenericViews._wipeAllData()" class="px-5 py-2.5 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700 transition-colors flex items-center gap-2">
                            <i data-lucide="trash-2" width="14"></i> Wipe all data…
                        </button>
                        <p class="text-[11px] text-slate-400 italic">You'll be asked to confirm twice and to save a backup first.</p>
                    </div>
                </div>
            </div>`;

        if (window.lucide) lucide.createIcons();
    },

    // ── Wipe everything (with forced backup first) ─────────────────────────
    // Flow:
    //   1. First confirm() — strong warning about permanence.
    //   2. Force a backup: open the save dialog with a sensible default filename.
    //      Cancel → abort the whole wipe (no backup = no wipe).
    //   3. Second confirm() — type-to-confirm via prompt() requiring the word DELETE.
    //   4. Call Storage.clear() to nuke ~/Documents/SURGdash/.
    //   5. Reload window so the app boots from a clean slate.
    async _wipeAllData() {
        console.log('[wipe] _wipeAllData started');
        // Guard: edit mode required. If a viewer somehow reaches this method
        // (e.g. via console), refuse — wiping is a destructive admin action.
        if (!App.editUnlocked && App._editPasswordHash) {
            alert('Unlock editing first — wipe requires edit mode.');
            return;
        }
        // Detect cloud-sync state up front so the warnings are honest about scope.
        const appSettings = await Projects.getAppSettings();
        const hasSheetsUrl = !!(appSettings && appSettings.googleSheetsUrl);
        const cloudWarning = hasSheetsUrl
            ? '\n\n⚠ A Google Sheets cloud sync is configured. The sheet on Google\'s servers is NOT touched by this wipe — but the auto-pull on next launch would put all that data back. The sync URL will be removed locally so the wipe sticks. To also delete the cloud copy, delete or clear the sheet manually in Google Sheets.'
            : '';
        if (!confirm('⚠ Wipe ALL data?\n\nThis permanently deletes every SURGfund project, every SURGhub snapshot, every setting, and every backup record on this machine. You CANNOT undo this.\n\nA full backup will be downloaded first.' + cloudWarning)) {
            console.log('[wipe] cancelled at first confirm');
            return;
        }

        // Step 1 — force a backup. Use the same payload as _localBackup.
        const ipcRenderer = electronAPI;
        const defaultName = `SURGdash_pre-wipe_backup_${new Date().toISOString().slice(0,19).replace(/[:T]/g, '-')}.json`;
        console.log('[wipe] requesting save path…');
        const filePath = await ipcRenderer.invoke('pick-save-path', defaultName);
        if (!filePath) {
            console.log('[wipe] cancelled at save dialog');
            alert('Wipe cancelled — you closed the backup save dialog without choosing a location.\n\nNo data was deleted.');
            return;
        }
        console.log('[wipe] save path:', filePath);
        App.showMsg('Collecting data for backup…');
        try {
            // Defensive: flush the in-memory registry to disk in case any pending
            // edit hadn't been persisted yet. Stops the "but I just changed that!"
            // class of bugs where a forced-backup misses unsaved RAM state.
            try { await Projects.saveRegistry(); } catch (_) {}

            const allKeys = await Storage.keys();
            const data = {};
            for (const key of allKeys) data[key] = await Storage.getItem(key);

            // Belt-and-suspenders: also stamp the in-memory registry directly into
            // the backup payload, overriding the file-based one. If anything in
            // Storage.keys() walking was incomplete, we still capture what the app
            // currently knows about. (Tagged so restore can prefer file values when
            // they exist but fall back to this if the per-file copy is missing.)
            if (Projects.registry && Projects.registry.length) {
                data['surgdash_projects'] = JSON.parse(JSON.stringify(Projects.registry));
            }

            // Quick stats so the user (and console) sees what was captured.
            const projsInBackup = (data['surgdash_projects'] || []).filter(p => p && p.type === 'generic');
            const withImpact = projsInBackup.filter(p => p.impactAssumptions && Object.values(p.impactAssumptions).some(v => v != null && v !== '')).length;
            const withBaselines = projsInBackup.filter(p => p.qualityBaselines && Object.keys(p.qualityBaselines).length).length;
            console.log('[wipe] captured', allKeys.length, 'keys ·', projsInBackup.length, 'projects ·', withImpact, 'with impact ·', withBaselines, 'with baselines');

            const backup = { version: 1, exportedAt: new Date().toISOString(), data, _summary: { wipeBackup: true, keys: allKeys.length, projects: projsInBackup.length, withImpact, withBaselines } };
            const write = await ipcRenderer.invoke('write-file', { filePath, content: JSON.stringify(backup, null, 2) });
            if (!write.success) {
                console.error('[wipe] backup write failed:', write.error);
                alert('Backup failed — wipe aborted.\n\n' + write.error);
                return;
            }
            console.log('[wipe] backup saved (' + allKeys.length + ' keys)');
        } catch (e) {
            console.error('[wipe] backup exception:', e);
            alert('Backup failed — wipe aborted.\n\n' + (e.message || e));
            return;
        }

        // Step 2 — final confirm before destruction.
        if (!confirm('✓ Backup saved.\n\nFinal confirmation — really wipe ALL local data now?\n\nThis cannot be undone. Click OK to wipe.')) {
            alert('Wipe cancelled. Backup file is safe at the path you chose.');
            return;
        }
        console.log('[wipe] user confirmed — starting deletion');

        // Step 3 — tear down anything that could re-save state OR pull from the cloud
        // mid-wipe / right after the reload.
        try { if (App._autoPullInterval) clearInterval(App._autoPullInterval); } catch (_) {}
        try { if (App._autoPullTimer)    clearTimeout(App._autoPullTimer);    } catch (_) {}
        try { if (App._viewerInputObserver) App._viewerInputObserver.disconnect(); } catch (_) {}
        // Block the auto-pull from running again before the reload happens
        App._startAutoPull = () => {};
        // Stub out save paths so post-clear in-flight code can't write anything new
        Projects.saveRegistry = async () => {};
        Projects.registry = [];

        // Nuke everything directly via the preload fs API. We use the EXACT same
        // DATA_DIR that Storage uses (so iCloud-Drive-rerouted Documents folders
        // are handled correctly), and we walk + unlink every file manually before
        // attempting the recursive rmSync — that way even if rmSync silently fails
        // the actual data files are already gone.
        const fs   = electronAPI.fs;
        const path = electronAPI.path;
        const DATA_DIR = Storage.DATA_DIR;
        const errors = [];
        let unlinkedCount = 0;
        let removedDirCount = 0;

        // Recursive walker: unlink every file, then rmdir empty dirs on the way out.
        const walkAndDelete = (dir) => {
            if (!fs.existsSync(dir)) return;
            let entries;
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
            catch (e) { errors.push(`readdir ${dir}: ${e.message || e}`); return; }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory) {
                    walkAndDelete(full);
                    try { fs.rmSync(full, { recursive: true, force: true }); removedDirCount++; }
                    catch (e) { errors.push(`rmdir ${full}: ${e.message || e}`); }
                } else {
                    try { fs.unlinkSync(full); unlinkedCount++; }
                    catch (e) { errors.push(`unlink ${full}: ${e.message || e}`); }
                }
            }
        };

        let dbsDeleted = 0;
        const dbErrors = [];

        try {
            console.log('[wipe] DATA_DIR =', DATA_DIR);
            if (!fs.existsSync(DATA_DIR)) {
                console.log('[wipe] DATA_DIR does not exist — nothing to delete');
            } else {
                walkAndDelete(DATA_DIR);
                // Final pass — recursively rm the now-mostly-empty directory itself.
                try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); }
                catch (e) { errors.push(`rmSync DATA_DIR: ${e.message || e}`); }
            }
            // Recreate empty data dir
            try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { errors.push(`mkdir: ${e.message || e}`); }

            // Clear browser-side stores too — SURGhub course/learner/learner data lives
            // in IndexedDB (SURGhub_Analytics), and a legacy localforage DB may also exist
            // for users who migrated from the old storage backend. localStorage is used
            // in a few places too (e.g. UI prefs). Without these, SURGhub data appears
            // to "come back" after a wipe.
            try { localStorage.clear();   } catch (e) { dbErrors.push(`localStorage: ${e.message || e}`); }
            try { sessionStorage.clear(); } catch (e) { dbErrors.push(`sessionStorage: ${e.message || e}`); }

            const deleteDb = (name) => new Promise((resolve) => {
                try {
                    const req = indexedDB.deleteDatabase(name);
                    req.onsuccess = () => { dbsDeleted++; console.log('[wipe] dropped IndexedDB:', name); resolve(); };
                    req.onerror = (ev) => { dbErrors.push(`IndexedDB ${name}: ${ev.target.error}`); resolve(); };
                    req.onblocked = () => { dbErrors.push(`IndexedDB ${name}: blocked (open in another tab?)`); resolve(); };
                } catch (e) { dbErrors.push(`IndexedDB ${name}: ${e.message || e}`); resolve(); }
            });
            // Close the in-memory DB handle first so deleteDatabase isn't blocked
            try { if (window.DB && window.DB.db && window.DB.db.close) { window.DB.db.close(); window.DB.db = null; } } catch (_) {}
            // Enumerate every IndexedDB this origin owns (covers anything we don't know about)
            let allDbNames = ['SURGhub_Analytics', 'localforage'];
            try {
                if (indexedDB.databases) {
                    const list = await indexedDB.databases();
                    list.forEach(d => { if (d.name && !allDbNames.includes(d.name)) allDbNames.push(d.name); });
                }
            } catch (_) {}
            for (const name of allDbNames) await deleteDb(name);

            // Sanity check — is the registry actually gone?
            const registryFile = path.join(DATA_DIR, 'projects.json');
            const stillThere = fs.existsSync(registryFile);

            console.log('[wipe] unlinked files:', unlinkedCount, 'removed dirs:', removedDirCount, 'IndexedDBs:', dbsDeleted, 'errors:', errors.length, 'dbErrors:', dbErrors.length, 'registry-still-there:', stillThere);

            if (stillThere || errors.length > 0 || dbErrors.length > 0) {
                alert(
                    `Wipe ran but didn't fully complete.\n\n` +
                    `Data directory: ${DATA_DIR}\n` +
                    `Files unlinked: ${unlinkedCount}\n` +
                    `Dirs removed: ${removedDirCount}\n` +
                    `IndexedDBs dropped: ${dbsDeleted}\n` +
                    `Registry file still present: ${stillThere ? 'YES (problem!)' : 'no'}\n\n` +
                    (errors.length   ? `File errors:\n${errors.slice(0, 5).join('\n')}\n` : '') +
                    (dbErrors.length ? `IndexedDB errors:\n${dbErrors.slice(0, 5).join('\n')}\n` : '') +
                    `\nYour backup is safe. The developer console has the full log. ` +
                    `If files remain, delete the folder manually:\n  ${DATA_DIR}`
                );
                return;
            }

            // Modal-style confirmation so the user is certain it ran — toast can
            // be missed at the top-right corner. After they dismiss, we reload.
            alert(
                `✓ Wipe complete.\n\n` +
                `Files deleted: ${unlinkedCount}\n` +
                `Directories removed: ${removedDirCount}\n` +
                `IndexedDBs dropped: ${dbsDeleted} (incl. SURGhub course/learner data)\n` +
                `localStorage + sessionStorage cleared.\n` +
                `Data directory: ${DATA_DIR}\n\n` +
                `Click OK to reload the app with a clean slate.`
            );
            window.location.reload();
        } catch (e) {
            console.error('Wipe failed (outer):', e);
            alert('Wipe failed: ' + (e.message || e) +
                `\n\nData directory: ${DATA_DIR}\n` +
                'Your backup is safe at the file you saved.\nOpen the developer console for details.');
        }
    },

    async _addCustomQualityKpi() {
        const name  = (document.getElementById('cq-name')?.value || '').trim();
        const short = (document.getElementById('cq-short')?.value || '').trim();
        const unit  = (document.getElementById('cq-unit')?.value || '').trim();
        if (!name || !short || !unit) { alert('Name, short name, and unit are required.'); return; }
        const color  = document.getElementById('cq-color')?.value || '#6366F1';
        const icon   = (document.getElementById('cq-icon')?.value || '').trim() || 'activity';
        const lower  = document.getElementById('cq-lower')?.checked || false;
        const id     = short.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Date.now().toString(36);

        const custom = (await Storage.getItem('surgdash_custom_quality_kpis')) || [];
        custom.push({ id, name, shortName: short, unit, color, icon, lowerIsBetter: lower, preset: false });
        await Projects.saveCustomQualityKpis(custom);
        App.showMsg(`${short} added ✓`);
        App.renderView();
    },

    async _deleteCustomQualityKpi(id) {
        const custom = ((await Storage.getItem('surgdash_custom_quality_kpis')) || []).filter(k => k.id !== id);
        await Projects.saveCustomQualityKpis(custom);
        App.showMsg('Indicator removed ✓');
        App.renderView();
    },

    // ===== REPORTS =====
    async renderReports(main, project) {
        const events  = await Projects.getEvents(project.id);
        const updates = await Projects.getUpdates(project.id);
        const hasData = events.length > 0 || updates.length > 0;

        main.innerHTML = `
            <div class="p-6 md:p-10 fade-in w-full max-w-6xl mx-auto">
                <header class="mb-8"><h1 class="text-2xl font-bold text-gsf-prussian">Reports</h1></header>

                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
                    <h2 class="text-lg font-bold text-gsf-prussian mb-2">Project Summary Report</h2>
                    <p class="text-sm text-slate-500 mb-4">Generate a PDF report with KPI data, trend charts, and recent narrative updates.</p>
                    ${!hasData ? '<p class="text-amber-600 text-sm mb-4">Add some events or updates first to generate a meaningful report.</p>' : ''}
                    <div class="flex items-center gap-3">
                        <button data-edit-only onclick="GenericViews._generateReport('${project.id}')" class="px-6 py-2.5 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors flex items-center gap-2 ${!hasData ? 'opacity-50 pointer-events-none' : ''}">
                            <i data-lucide="file-text" width="16"></i> Generate PDF
                        </button>
                        <button data-edit-only onclick="GenericViews._exportKpiData('${project.id}')" class="px-6 py-2.5 border-2 border-gsf-boston text-gsf-boston rounded-lg text-sm font-bold hover:bg-gsf-boston hover:text-white transition-colors flex items-center gap-2 ${events.length === 0 ? 'opacity-50 pointer-events-none' : ''}">
                            <i data-lucide="download" width="16"></i> Export to Excel
                        </button>
                    </div>
                    <div id="report-status" class="mt-3 text-sm"></div>
                </div>
            </div>`;

        if (window.lucide) lucide.createIcons();
    },

    // ── Branded PDF system ─────────────────────────────────────────────────
    // All exported PDFs share the same look: GSF letterhead on page 1 (logo +
    // tagline + footer with Geneva address + globe watermark), a slim Prussian
    // banner on subsequent pages, and SURGdash KPI card styling.
    //
    // The letterhead PNG and the small GSF symbol are read once and embedded
    // as base64 data URIs so the print BrowserWindow doesn't have to load
    // anything from disk during PDF generation.
    _brandingAssets() {
        if (this._brandingCache) return this._brandingCache;
        const path = electronAPI.path;
        const fsApi = electronAPI.fs;
        const tryRead = (rel) => {
            try {
                const p = path.join(electronAPI.appPath, ...rel);
                if (!fsApi.existsSync(p)) return '';
                return 'data:image/png;base64,' + fsApi.readFileBase64(p);
            } catch (_) { return ''; }
        };
        this._brandingCache = {
            letterhead: tryRead(['build', 'gsf_letterhead.png']),
            // Symbol logo for subsequent-page banners
            symbol:     tryRead(['build', 'gsf_logo_symbol.png'])
                     || tryRead(['build', 'Global Surgery Foundation_logo_symbol.png'])
        };
        return this._brandingCache;
    },

    // Generic CSS + page-template shared by every branded PDF. Consumers
    // produce the inner content for page 1 and any additional pages.
    _brandedPdfShell({ title, year, page1Inner, additionalPages = [], includeCharts = false }) {
        const { letterhead, symbol } = this._brandingAssets();
        const generated = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        const chartScript = includeCharts ? `
            <script type="text/javascript" src="https://www.gstatic.com/charts/loader.js"></script>
            <script>
                google.charts.load('current', { packages: ['corechart'] });
                google.charts.setOnLoadCallback(() => {
                    if (window.__drawAllCharts) window.__drawAllCharts();
                    // Allow a tick for paint, then signal READY to the main process.
                    setTimeout(() => { document.title = 'READY'; }, 600);
                });
            </script>` : `<script>document.title = 'READY';<\/script>`;

        // Page numbers are injected directly into each .pdf-page as an absolutely-
        // positioned element. Chromium's displayHeaderFooter sits in the page margin,
        // which is occupied here by the letterhead's address footer — the numbers
        // would be invisible. Building them inline gives us reliable placement just
        // above the letterhead's address strip.
        const totalPages = 1 + additionalPages.length;
        const pageNum = (n) => `<div class="page-num">${n} / ${totalPages}</div>`;

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${App.escapeHtml(title)}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@page { size: A4; margin: 0; }
body { font-family: 'Inter', sans-serif; margin: 0; color: #1e293b; line-height: 1.4; }

/* Every page is exactly A4 with the GSF letterhead as a background. Content
   sits in the white centre area between the header logo / tagline (top ~30mm)
   and the address footer (bottom ~20mm). Page numbers are rendered by Chromium
   in the print margin via displayHeaderFooter. */
.pdf-page {
    width: 210mm; min-height: 297mm;
    position: relative;
    page-break-after: always;
    ${letterhead ? `background: url('${letterhead}') no-repeat top left; background-size: 210mm 297mm;` : 'background: #fff;'}
    /* Bottom padding leaves room for the letterhead's address block AND the centred page number. */
    padding: 34mm 16mm 40mm 16mm;
}
.pdf-page:last-child { page-break-after: auto; }

/* Centred page number, sitting just above the letterhead's address strip. */
.page-num {
    position: absolute; left: 0; right: 0; bottom: 14mm;
    text-align: center;
    font-size: 9pt; font-weight: 600; color: #002F4C;
    letter-spacing: 0.05em;
}

.title-block {
    border-bottom: 2px solid #002F4C;
    padding-bottom: 10px;
    margin-bottom: 18px;
}
.title-block h1 {
    font-size: 22px; font-weight: 900; color: #002F4C; margin: 0 0 4px;
    letter-spacing: -0.3px;
}
.title-block .subtitle { font-size: 11px; color: #64748b; margin: 0; }

/* Continuation banner on subsequent pages (small, tucked under the letterhead
   logo area to indicate which report this is). */
.cont-banner {
    font-size: 10px; color: #002F4C; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; margin: 0 0 12px;
    padding-bottom: 6px; border-bottom: 1px solid #e2e8f0;
}

/* KPI cards — match the live SURGdash app (gradient wash + accent stripe) */
.kpi-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 18px; }
.kpi-card { position: relative; border-radius: 10px; padding: 12px 14px; border: 1px solid #e2e8f0; overflow: hidden; min-height: 96px; }
.kpi-card .accent { position: absolute; top: 0; left: 0; right: 0; height: 3px; }
.kpi-card .ttl { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; margin: 0 0 2px; }
.kpi-card .sub { font-size: 9px; color: #94a3b8; margin: 0 0 6px; }
.kpi-card .num { font-size: 22px; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; }
.kpi-card .unit { font-size: 10px; color: #94a3b8; margin: 2px 0 6px; }
.kpi-card .bar-wrap { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.kpi-card .bar-bg { flex: 1; height: 4px; border-radius: 99px; background: #f1f5f9; }
.kpi-card .bar-fg { height: 4px; border-radius: 99px; }
.kpi-card .pct { font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums; }
.kpi-card .tgt { font-size: 9px; color: #64748b; margin: 2px 0 0; }

/* Quality improvement compact card */
.qi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
.qi-card { position: relative; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; overflow: hidden; }
.qi-card .stripe { position: absolute; top: 0; left: 0; right: 0; height: 2px; }
.qi-card .lbl { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 4px; color: #002F4C; }
.qi-card .big { font-size: 16px; font-weight: 900; font-variant-numeric: tabular-nums; line-height: 1; }
.qi-card .small { font-size: 9px; color: #64748b; }
.qi-card .arrow { font-size: 9px; color: #475569; margin-top: 4px; font-variant-numeric: tabular-nums; }

/* Section heading */
h2.section { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: #002F4C; margin: 18px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e2e8f0; }

/* Activity / update list rows */
.entry { display: grid; grid-template-columns: 60px 1fr; gap: 10px; padding: 6px 0; border-bottom: 1px solid #f1f5f9; font-size: 11px; page-break-inside: avoid; }
.entry .date { color: #94a3b8; font-weight: 600; }
.entry .title { font-weight: 700; color: #0f172a; margin: 0 0 1px; }
.entry .body { color: #475569; margin: 0; line-height: 1.4; }
.entry .meta { color: #64748b; font-size: 10px; margin-top: 1px; }
.entry-pill { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; background: #f3e8ff; color: #7e22ce; margin-right: 4px; vertical-align: 1px; }

/* Year grouping for the activity log */
.year-group { margin-bottom: 14px; page-break-inside: auto; }
.year-group .year-head { display: flex; align-items: baseline; gap: 8px; padding: 6px 0; border-bottom: 2px solid #002F4C; margin-bottom: 6px; }
.year-group .year-label { font-size: 16px; font-weight: 900; color: #002F4C; letter-spacing: -0.3px; }
.year-group .year-meta  { font-size: 10px; color: #64748b; }

/* Tables */
table.kpi-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 14px; }
table.kpi-table th { padding: 6px 10px; text-align: left; font-size: 9px; text-transform: uppercase; color: #64748b; border-bottom: 2px solid #e2e8f0; background: #f8fafc; letter-spacing: 0.04em; }
table.kpi-table td { padding: 6px 10px; border-bottom: 1px solid #f1f5f9; font-variant-numeric: tabular-nums; }
table.kpi-table td.label { font-weight: 700; color: #0f172a; }

/* Chart card */
.chart-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px 14px; margin-bottom: 12px; }
.chart-card .chart-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: #002F4C; margin: 0 0 4px; }
.chart-card .chart-sub { font-size: 10px; color: #94a3b8; margin: 0 0 6px; }
.chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

/* Footer line shown at the bottom of every page (small print) */
.pdf-footnote { font-size: 8px; color: #94a3b8; text-align: center; margin-top: 12px; font-style: italic; }
</style>
${chartScript}
</head>
<body>
<div class="pdf-page">
    ${page1Inner}
    ${pageNum(1)}
</div>
${additionalPages.map((inner, i) => `
    <div class="pdf-page">
        <p class="cont-banner">${App.escapeHtml(title)} · continued</p>
        ${inner}
        ${pageNum(i + 2)}
    </div>`).join('')}
</body>
</html>`;
    },

    async _generateReport(projectId) {
        const statusEl = document.getElementById('report-status');
        if (statusEl) statusEl.innerHTML = '<span class="text-gsf-boston">Generating branded report…</span>';
        try {
            const project    = Projects.getProject(projectId);
            const [events, updates, allTargets, allActuals, qualityData, allQualityKpis] = await Promise.all([
                Projects.getEvents(projectId),
                Projects.getUpdates(projectId),
                Projects.getTargets(projectId),
                Projects.getActuals(projectId),
                Projects.getQualityData(projectId),
                Projects.getAllQualityKpis()
            ]);
            const year       = App.kpiYear === 'all' ? new Date().getFullYear() : (App.kpiYear || new Date().getFullYear());
            const yearTotals = Projects.getActualsForYear(allActuals, year);
            const targets    = Projects.getTargetsForYear(allTargets, year);
            const fmt = v => new Intl.NumberFormat('en-US').format(v);

            // ── Page 1: KPI summary cards + title block ──
            const kpiCards = Projects.STANDARD_KPIS.map(kpi => {
                const v = yearTotals[kpi.id] || 0;
                const g = targets[kpi.id] || 0;
                const pct = g > 0 ? Math.min(100, Math.round(v / g * 100)) : null;
                return `<div class="kpi-card" style="background:linear-gradient(135deg,${kpi.color}14,#ffffff 65%);border-color:${kpi.color}33">
                    <div class="accent" style="background:${kpi.color}"></div>
                    <p class="ttl" style="color:${kpi.color}">${kpi.nameBig || kpi.name}</p>
                    <p class="sub">${kpi.nameSub || ''}</p>
                    <div style="display:flex;align-items:baseline;gap:6px">
                        <span class="num" style="color:${kpi.color}">${fmt(v)}</span>
                        <span style="font-size:9px;color:${kpi.color};opacity:.55">in ${year}</span>
                    </div>
                    <p class="unit">${kpi.unit}</p>
                    ${pct !== null ? `<div class="bar-wrap"><div class="bar-bg" style="background:${kpi.color}1A"><div class="bar-fg" style="width:${pct}%;background:${kpi.color}"></div></div><span class="pct" style="color:${kpi.color}">${pct}%</span></div>
                        <p class="tgt">Target: <strong style="color:#334155">${fmt(g)}</strong></p>` :
                        `<p class="tgt" style="font-style:italic">No target set</p>`}
                </div>`;
            }).join('');

            // Quality Improvement compact strip (only if at least one baseline is set)
            const enabledQKpis = (project.enabledQualityKpis || []).map(id => allQualityKpis.find(k => k.id === id)).filter(Boolean);
            const qBaselines = project.qualityBaselines || {};
            const anyBaseline = enabledQKpis.some(k => qBaselines[k.id] != null);
            const qualityImprovement = (enabledQKpis.length && anyBaseline) ? (() => {
                const tiles = enabledQKpis.map(kpi => {
                    const b = qBaselines[kpi.id];
                    if (b == null) return '';
                    const t = Projects.qualityTargetFor(project, kpi.id, qualityData);
                    const latest = qualityData.filter(d => d.kpiId === kpi.id && Projects.qualityActual(d) !== null)
                        .sort((a, c) => (a.year * 10 + a.quarter) - (c.year * 10 + c.quarter)).slice(-1)[0];
                    const latestVal = latest ? Projects.qualityActual(latest) : null;
                    const pct = (v) => (v != null && Number(b) !== 0) ? ((v - b) / b) * 100 : null;
                    const goalDir = kpi.lowerIsBetter ? -1 : 1;
                    const actChange = pct(latestVal);
                    const tgtChange = pct(t);
                    const clr = (actChange !== null && Math.sign(actChange) === goalDir) ? '#10b981'
                              : (actChange !== null && Math.sign(actChange) === -goalDir && actChange !== 0) ? '#ef4444' : '#64748b';
                    const fmtPct = (n) => n == null || !isFinite(n) ? '—' : `${n > 0 ? '+' : ''}${Math.abs(n) >= 10 ? Math.round(n) : n.toFixed(1)}%`;
                    return `<div class="qi-card">
                        <div class="stripe" style="background:${kpi.color}"></div>
                        <p class="lbl">${kpi.shortName}</p>
                        <div class="big" style="color:${clr}">${fmtPct(actChange)}</div>
                        <p class="small">so far · target ${fmtPct(tgtChange)}</p>
                    </div>`;
                }).join('');
                return `<h2 class="section">Quality Improvement vs Baseline</h2><div class="qi-grid">${tiles}</div>`;
            })() : '';

            const page1Inner = `
                <div class="title-block">
                    <h1>${App.escapeHtml(project.name)}</h1>
                    <p class="subtitle"><strong>${year} Performance Report</strong> · Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                </div>
                ${project.description ? `<p style="font-size:11px;color:#475569;margin:0 0 14px;line-height:1.5">${App.escapeHtml(project.description)}</p>` : ''}
                <h2 class="section">Key Performance Indicators · ${year}</h2>
                <div class="kpi-grid">${kpiCards}</div>
                ${qualityImprovement}
                <p class="pdf-footnote">Source: SURGdash · The Global Surgery Foundation</p>`;

            // ── Page 2: Multi-year KPI charts ──
            const allYearsSet = new Set([...allTargets.map(t => t.year), ...allActuals.map(a => a.year)]);
            const yearList = [...allYearsSet].sort();
            // Embed the data needed to draw charts via Google Charts in the PDF window.
            const chartData = Projects.STANDARD_KPIS.map(kpi => ({
                id: kpi.id, name: kpi.nameBig || kpi.name, color: kpi.color,
                rows: yearList.map(y => ({
                    year: String(y),
                    actual: (Projects.getActualsForYear(allActuals, y)[kpi.id] || 0),
                    target: (Projects.getTargetsForYear(allTargets, y)[kpi.id] || 0)
                }))
            }));

            const chartPageInner = yearList.length >= 1 ? `
                <h2 class="section">Multi-Year Progress</h2>
                <p style="font-size:10px;color:#64748b;margin:0 0 10px">Actuals (bars) vs targets (dashed line) per KPI across recorded years.</p>
                <div class="chart-grid">
                    ${Projects.STANDARD_KPIS.map(kpi => `
                        <div class="chart-card">
                            <p class="chart-title" style="color:${kpi.color}">${kpi.nameBig || kpi.name}</p>
                            <p class="chart-sub">${kpi.unit} · all years</p>
                            <div id="pdf-chart-${kpi.id}" style="width:100%;height:180px"></div>
                        </div>
                    `).join('')}
                </div>
                <script>
                window.__pdfCharts = ${JSON.stringify(chartData)};
                window.__drawAllCharts = function() {
                    if (!window.google || !google.visualization) return;
                    window.__pdfCharts.forEach(function(c) {
                        var el = document.getElementById('pdf-chart-' + c.id);
                        if (!el) return;
                        var data = new google.visualization.DataTable();
                        data.addColumn('string', 'Year');
                        data.addColumn('number', 'Actual');
                        data.addColumn('number', 'Target');
                        c.rows.forEach(function(r) { data.addRow([r.year, r.actual || null, r.target || null]); });
                        var chart = new google.visualization.ComboChart(el);
                        chart.draw(data, {
                            height: 180,
                            seriesType: 'bars',
                            series: { 0: { type: 'bars', color: c.color }, 1: { type: 'line', color: '#64748b', lineDashStyle: [3, 4], lineWidth: 2, pointSize: 4 } },
                            legend: { position: 'top', alignment: 'end', textStyle: { fontSize: 9, color: '#64748b' } },
                            bar: { groupWidth: '48%' },
                            chartArea: { left: 44, right: 12, top: 26, bottom: 28, width: '85%', height: '70%' },
                            hAxis: { textStyle: { fontSize: 9, color: '#64748b' }, baselineColor: '#e2e8f0', gridlines: { color: 'transparent' } },
                            vAxis: { textStyle: { fontSize: 9, color: '#94a3b8' }, baselineColor: '#e2e8f0', gridlines: { color: '#f1f5f9', count: 4 }, minorGridlines: { count: 0 }, minValue: 0, format: 'short' },
                            backgroundColor: 'transparent'
                        });
                    });
                };
                <\/script>
            ` : '';

            // ── Activities, grouped by year, newest first ──
            const allActivities = [
                ...events .map(e => ({ ...e, _kind: 'event'  })),
                ...updates.map(u => ({ ...u, _kind: 'update' })),
            ].filter(e => e.date)
             .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            const byYear = new Map();
            allActivities.forEach(a => {
                const y = String(a.date).slice(0, 4);
                if (!byYear.has(y)) byYear.set(y, []);
                byYear.get(y).push(a);
            });
            const renderEntry = (e) => {
                if (e._kind === 'event') {
                    const et = Projects.EVENT_TYPES[e.type] || {};
                    const details = [];
                    if (e.hcw_count)        details.push(`${fmt(e.hcw_count)} HCWs${e.hcw_new_count ? ` (${fmt(e.hcw_new_count)} new)` : ''}`);
                    if (e.patient_count)    details.push(`${fmt(e.patient_count)} patients`);
                    if (e.facilities_count) details.push(`${e.facilities_count} facilit${e.facilities_count === 1 ? 'y' : 'ies'}`);
                    return `<div class="entry">
                        <div class="date">${e.date || ''}</div>
                        <div>
                            <p class="title">${App.escapeHtml(e.title || '')}</p>
                            <p class="meta">${App.escapeHtml(et.label || e.type || '—')}${details.length ? ' · ' + details.join(' · ') : ''}</p>
                            ${e.notes ? `<p class="body">${App.escapeHtml(e.notes)}</p>` : ''}
                        </div>
                    </div>`;
                }
                return `<div class="entry">
                    <div class="date">${e.date || ''}</div>
                    <div>
                        <p class="title"><span class="entry-pill">Milestone</span> ${App.escapeHtml(e.title || '')}</p>
                        ${e.body ? `<p class="body">${App.escapeHtml(e.body)}</p>` : ''}
                    </div>
                </div>`;
            };
            const yearsDesc = [...byYear.keys()].sort((a, b) => b.localeCompare(a));
            const activitiesInner = yearsDesc.length ? `
                <h2 class="section">Activity Log · grouped by year</h2>
                ${yearsDesc.map(y => {
                    const entries = byYear.get(y);
                    const yearEvents = entries.filter(e => e._kind === 'event');
                    const yearHcw    = yearEvents.reduce((s, e) => s + (Number(e.hcw_count) || 0), 0);
                    const yearHcwNew = yearEvents.reduce((s, e) => s + (Number(e.hcw_new_count) || 0), 0);
                    const meta = [];
                    if (yearHcw)    meta.push(`${fmt(yearHcw)} HCWs`);
                    if (yearHcwNew) meta.push(`${fmt(yearHcwNew)} new`);
                    return `<div class="year-group">
                        <div class="year-head"><span class="year-label">${y}</span><span class="year-meta">${entries.length} ${entries.length === 1 ? 'activity' : 'activities'}${meta.length ? ' · ' + meta.join(' · ') : ''}</span></div>
                        ${entries.map(renderEntry).join('')}
                    </div>`;
                }).join('')}
            ` : '';

            // ── HCW-over-time chart page (mirrors the live app Activities tab) ──
            const hcwEvents = events.filter(e => e.date && (Number(e.hcw_count) > 0 || Number(e.hcw_new_count) > 0))
                .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
            let cumT = 0, cumN = 0;
            const hcwPoints = hcwEvents.map(e => {
                cumT += Number(e.hcw_count)     || 0;
                cumN += Number(e.hcw_new_count) || 0;
                return { date: e.date, cumT, cumN, title: e.title || '' };
            });
            const hcwChartInner = hcwPoints.length ? `
                <h2 class="section">Healthcare Workers Over Time</h2>
                <p style="font-size:10px;color:#64748b;margin:0 0 8px">Cumulative across all logged training and mentoring activities.</p>
                <div class="chart-card">
                    <div id="pdf-hcw-chart" style="width:100%;height:260px"></div>
                </div>
                <script>
                window.__hcwPoints = ${JSON.stringify(hcwPoints)};
                (function() {
                    var prev = window.__drawAllCharts;
                    window.__drawAllCharts = function() {
                        if (prev) prev();
                        if (!window.google || !google.visualization) return;
                        var el = document.getElementById('pdf-hcw-chart');
                        if (!el) return;
                        var dt = new google.visualization.DataTable();
                        dt.addColumn('date', 'Date');
                        dt.addColumn('number', 'Cumulative HCWs');
                        dt.addColumn('number', 'New HCWs (cumulative)');
                        window.__hcwPoints.forEach(function(p) {
                            var d = p.date.split('-');
                            dt.addRow([new Date(+d[0], +d[1]-1, +d[2]), p.cumT, p.cumN]);
                        });
                        var chart = new google.visualization.LineChart(el);
                        chart.draw(dt, {
                            height: 260,
                            legend: { position: 'top', alignment: 'end', textStyle: { fontSize: 10, color: '#64748b' } },
                            colors: ['#4389C8', '#10b981'],
                            chartArea: { left: 50, top: 30, right: 20, bottom: 40, width: '88%', height: '76%' },
                            hAxis: { format: 'MMM yyyy', textStyle: { fontSize: 9, color: '#64748b' }, baselineColor: '#e2e8f0', gridlines: { color: 'transparent' } },
                            vAxis: { textStyle: { fontSize: 9, color: '#94a3b8' }, baselineColor: '#e2e8f0', gridlines: { color: '#f1f5f9', count: 5 }, minorGridlines: { count: 0 }, minValue: 0, format: 'short' },
                            lineWidth: 2.5, pointSize: 6, pointShape: 'circle',
                            backgroundColor: 'transparent'
                        });
                    };
                })();
                <\/script>
            ` : '';

            const additionalPages = [];
            if (chartPageInner)  additionalPages.push(chartPageInner);
            if (hcwChartInner)   additionalPages.push(hcwChartInner);
            if (activitiesInner) additionalPages.push(activitiesInner);

            const html = this._brandedPdfShell({
                title: `${project.shortName || project.name} · SURGdash Report`,
                year,
                page1Inner,
                additionalPages,
                includeCharts: !!(chartPageInner || hcwChartInner)
            });

            const ipcRenderer = electronAPI;
            const outputPath = await ipcRenderer.invoke('pick-save-path', `${project.name} Report ${year}.pdf`);
            if (!outputPath) { if (statusEl) statusEl.innerHTML = ''; return; }
            const result = await ipcRenderer.invoke('generate-pdf', { html, outputPath });
            if (result.success) {
                if (statusEl) statusEl.innerHTML = `<span class="text-emerald-600 font-medium">Report saved ✓</span>`;
            } else {
                if (statusEl) statusEl.innerHTML = `<span class="text-red-500">Error: ${result.error}</span>`;
            }
        } catch (err) {
            console.error(err);
            if (statusEl) statusEl.innerHTML = `<span class="text-red-500">Error: ${err.message}</span>`;
        }
    },

    async _exportKpiData(projectId) {
        // Reuse the full intake workbook (KPIs + Facilities + Quality + Events + Milestones)
        // so the file is round-trippable: edit in Excel → re-import in Data Entry.
        try {
            const project = Projects.getProject(projectId);
            const wb = await this._buildIntakeWorkbook(projectId, true);
            const ipcRenderer = electronAPI;
            const dateStr = new Date().toISOString().slice(0, 10);
            const outputPath = await ipcRenderer.invoke('pick-save-path', `${project.name} — SURGdash Export ${dateStr}.xlsx`);
            if (!outputPath) return;
            const buffer = new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
            electronAPI.fs.writeFileSync(outputPath, buffer);
            App.showMsg('Data exported ✓');
        } catch (err) {
            console.error('Export error:', err);
            alert('Export failed: ' + err.message);
        }
    },

    // ===== MAP VIEWS =====

    _initLeafletMap(elId, defaultView = [15, 20], defaultZoom = 2) {
        if (!window.L) return null;
        const el = document.getElementById(elId);
        if (!el) return null;

        // Size the map to fill the remaining viewport height
        const rect = el.getBoundingClientRect();
        const height = Math.max(window.innerHeight - rect.top - 2, 300);
        el.style.height = height + 'px';

        // Destroy any previous Leaflet instance on this element
        if (el._leaflet_map) { try { el._leaflet_map.remove(); } catch(e){} }

        const map = L.map(el, { zoomControl: true, scrollWheelZoom: true });
        el._leaflet_map = map;

        // CARTO Voyager tiles — no Referer required, works in Electron
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 19
        }).addTo(map);

        map.setView(defaultView, defaultZoom);
        // Ensure tiles render correctly after any layout shift
        setTimeout(() => map.invalidateSize(), 100);

        // Facility marker layers: cluster group + plain group for toggle
        map._facilityMarkers = [];  // raw marker references
        map._plainGroup = L.layerGroup().addTo(map);
        if (L.markerClusterGroup) {
            map._clusterGroup = L.markerClusterGroup({
                maxClusterRadius: 40,
                spiderfyOnMaxZoom: true,
                showCoverageOnHover: false,
                zoomToBoundsOnClick: true
            });
            // Start with clustering OFF — user can enable via the toggle button.
            // Plain group is already added above; cluster group stays detached until toggled on.
            map._clusteringEnabled = false;
        } else {
            map._clusteringEnabled = false;
        }

        // Add permanent watermark
        const wm = document.createElement('div');
        wm.className = 'map-watermark';
        wm.innerHTML = '<img src="build/gsf_logo_symbol.png" /><span>SURGdash &copy;</span>';
        el.style.position = 'relative';
        el.appendChild(wm);

        return map;
    },

    // Map label state: { 'org-proj': bool, 'org-fac': bool, 'proj': bool }
    _mapLabelsVisible: {},

    _toggleMapClustering(mapElId) {
        const el = document.getElementById(mapElId);
        if (!el || !el._leaflet_map) return;
        const map = el._leaflet_map;
        if (!map._clusterGroup) return;

        const markers = map._facilityMarkers || [];
        if (map._clusteringEnabled) {
            // Switch to plain (show all)
            map._clusterGroup.clearLayers();
            map.removeLayer(map._clusterGroup);
            map.addLayer(map._plainGroup);
            markers.forEach(m => map._plainGroup.addLayer(m));
            map._clusteringEnabled = false;
        } else {
            // Switch to clustered
            map._plainGroup.clearLayers();
            map.removeLayer(map._plainGroup);
            map.addLayer(map._clusterGroup);
            markers.forEach(m => map._clusterGroup.addLayer(m));
            map._clusteringEnabled = true;
        }

        // Update button state
        const btn = document.getElementById(mapElId + '-cluster-btn');
        if (btn) {
            if (map._clusteringEnabled) {
                btn.style.background = '#002F4C'; btn.style.color = '#fff'; btn.style.borderColor = '#002F4C';
            } else {
                btn.style.background = '#fff'; btn.style.color = '#64748b'; btn.style.borderColor = '#e2e8f0';
            }
        }
    },

    // kind: 'proj'|'fac' for org map, omitted for project map
    _toggleMapLabels(prefix, kind) {
        const key = kind ? prefix + '-' + kind : prefix;
        const visible = !this._mapLabelsVisible[key];
        this._mapLabelsVisible[key] = visible;

        const mapElId = prefix === 'org' ? 'org-leaflet-map' : 'proj-leaflet-map';
        const markers = prefix === 'org' ? this._orgMapMarkers : this._projMapMarkers;
        const mapRef = prefix === 'org' ? this._orgMapRef : this._projMapRef;

        // Update _ttVisible on marker entries matching the kind
        if (markers) {
            markers.forEach(m => {
                if (!m._ttContent) return;
                const matchesKind = !kind || (m._ttKind === kind);
                if (matchesKind) m._ttVisible = visible;
            });
        }

        // Re-layout handles rebinding with correct hidden/visible state
        if (mapRef && markers) {
            this._layoutLabels(mapElId, markers, mapRef);
        } else {
            // Fallback: toggle via DOM
            const mapEl = document.getElementById(mapElId);
            if (mapEl) {
                const selector = kind ? '.map-label-' + kind : '.map-label';
                mapEl.querySelectorAll(selector).forEach(el => {
                    if (visible) el.classList.remove('map-label-hidden');
                    else el.classList.add('map-label-hidden');
                });
                this._repelLabels(mapElId);
            }
        }

        // Toggle button active state
        const btnId = kind ? prefix + '-map-labels-' + kind + '-btn' : prefix + '-map-labels-btn';
        const btn = document.getElementById(btnId);
        if (btn) {
            if (visible) {
                btn.style.background = '#002F4C';
                btn.style.color = '#fff';
                btn.style.borderColor = '#002F4C';
            } else {
                btn.style.background = '#fff';
                btn.style.color = '#64748b';
                btn.style.borderColor = '#e2e8f0';
            }
        }
    },

    // Stored references for label optimization after toggle
    _orgMapRef: null, _orgMapMarkers: null,
    _projMapRef: null, _projMapMarkers: null,

    // Optimize tooltip directions: pick best direction per label to avoid overlap with nearby markers
    _optimizeTooltipDirections(markers, map) {
        const withTooltips = markers.filter(m => m._ttContent);
        if (withTooltips.length === 0) return;

        // Get current pixel positions of ALL markers (for avoidance)
        const allPx = markers.map(m => {
            const ll = m.marker.getLatLng ? m.marker.getLatLng() : m.marker._latlng;
            const p = map.latLngToContainerPoint(ll);
            return { x: p.x, y: p.y };
        });

        const mapSize = map.getSize();

        withTooltips.forEach((m) => {
            // This marker's pixel position
            const ll = m.marker.getLatLng ? m.marker.getLatLng() : m.marker._latlng;
            const mPx = map.latLngToContainerPoint(ll);

            // Score each direction: lower = better
            const dirs = [
                { dir: 'right',  offset: [10, 0],  labelCx:  80, labelCy: 0 },
                { dir: 'left',   offset: [-10, 0], labelCx: -80, labelCy: 0 },
                { dir: 'bottom', offset: [0, 8],   labelCx:  0,  labelCy: 20 },
                { dir: 'top',    offset: [0, -8],  labelCx:  0,  labelCy: -20 },
            ];

            let bestDir = dirs[0];
            let bestScore = Infinity;

            dirs.forEach(d => {
                const lx = mPx.x + d.labelCx;
                const ly = mPx.y + d.labelCy;
                let score = 0;

                // Penalty for each nearby marker the label would cover
                allPx.forEach((p, j) => {
                    if (markers[j] === m) return;
                    const dx = Math.abs(lx - p.x);
                    const dy = Math.abs(ly - p.y);
                    if (dx < 65 && dy < 12) score += 10;
                    else if (dx < 90 && dy < 16) score += 3;
                });

                // Penalty for being near map edge
                if (lx < 40 || lx > mapSize.x - 40) score += 5;
                if (ly < 20 || ly > mapSize.y - 20) score += 5;

                // Slight preference for right (most readable)
                if (d.dir === 'right') score -= 0.5;
                if (d.dir === 'left') score -= 0.3;

                if (score < bestScore) { bestScore = score; bestDir = d; }
            });

            // Determine if hidden based on toggle state
            const cls = m._ttBaseClass + (m._ttVisible ? '' : ' map-label-hidden');

            // Rebind tooltip with optimal direction
            m.marker.unbindTooltip();
            m.marker.bindTooltip(m._ttContent, {
                permanent: true,
                direction: bestDir.dir,
                offset: bestDir.offset,
                className: cls
            });
        });
    },

    // Push visible labels apart so they don't overlap (2D repulsion)
    _repelLabels(mapElId) {
        const mapEl = document.getElementById(mapElId);
        if (!mapEl) return;
        const labels = Array.from(mapEl.querySelectorAll('.map-label:not(.map-label-hidden)'));
        if (labels.length < 2) return;

        // Reset any prior offset
        labels.forEach(el => { el.style.marginTop = ''; el.style.marginLeft = ''; });

        // Get bounding rects
        const rects = labels.map(el => el.getBoundingClientRect());
        const offsets = rects.map(() => ({ dx: 0, dy: 0 }));
        const PAD = 3; // padding between labels

        // Iterative repulsion in screen space
        for (let iter = 0; iter < 30; iter++) {
            let moved = false;
            for (let i = 0; i < rects.length; i++) {
                for (let j = i + 1; j < rects.length; j++) {
                    const ri = { left: rects[i].left + offsets[i].dx, top: rects[i].top + offsets[i].dy,
                                 right: rects[i].right + offsets[i].dx, bottom: rects[i].bottom + offsets[i].dy };
                    const rj = { left: rects[j].left + offsets[j].dx, top: rects[j].top + offsets[j].dy,
                                 right: rects[j].right + offsets[j].dx, bottom: rects[j].bottom + offsets[j].dy };
                    const overlapX = Math.min(ri.right, rj.right) - Math.max(ri.left, rj.left) + PAD;
                    const overlapY = Math.min(ri.bottom, rj.bottom) - Math.max(ri.top, rj.top) + PAD;
                    if (overlapX > 0 && overlapY > 0) {
                        // Push apart along the axis with less overlap
                        if (overlapY < overlapX) {
                            const push = (overlapY / 2) + 1;
                            if (ri.top < rj.top) { offsets[i].dy -= push; offsets[j].dy += push; }
                            else { offsets[i].dy += push; offsets[j].dy -= push; }
                        } else {
                            const push = (overlapX / 2) + 1;
                            if (ri.left < rj.left) { offsets[i].dx -= push; offsets[j].dx += push; }
                            else { offsets[i].dx += push; offsets[j].dx -= push; }
                        }
                        moved = true;
                    }
                }
            }
            if (!moved) break;
        }

        // Apply offsets as margin
        labels.forEach((el, i) => {
            if (offsets[i].dy !== 0) el.style.marginTop = offsets[i].dy + 'px';
            if (offsets[i].dx !== 0) el.style.marginLeft = offsets[i].dx + 'px';
        });
    },

    // Full label layout: optimize directions then repel
    _layoutLabels(mapElId, markers, map) {
        this._optimizeTooltipDirections(markers, map);
        // Wait for Leaflet to reposition tooltips after rebind, then repel
        setTimeout(() => this._repelLabels(mapElId), 60);
    },

    async renderOrgMap(main) {
        const allProjects = Projects.registry.filter(p => p.type !== 'org' && p.type !== 'surghub' && (App.includeSample || !p.isSample));

        main.innerHTML = `
            <div style="display:flex;flex-direction:column;height:100%">
                <div style="padding:20px 32px 12px;flex-shrink:0;border-bottom:1px solid #e2e8f0;background:#fff">
                    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
                        <div>
                            <h1 style="font-size:20px;font-weight:800;color:#002F4C;margin:0 0 2px">Project Map</h1>
                            <p style="font-size:13px;color:#94a3b8;margin:0">All project locations and facilities. Add coordinates in each project's Settings.</p>
                        </div>
                        <div style="display:flex;align-items:center;gap:16px;font-size:12px;color:#64748b">
                            <span style="display:flex;align-items:center;gap:6px"><span style="width:12px;height:12px;background:#002F4C;display:inline-block;transform:rotate(45deg);border-radius:2px"></span> Project Location</span>
                            <span style="display:flex;align-items:center;gap:6px"><svg width="14" height="14" viewBox="0 0 20 20" style="flex-shrink:0"><circle cx="10" cy="10" r="9" fill="#002F4C" stroke="#fff" stroke-width="2"/><path d="M10 4.5l1.4 2.8 3.1.5-2.2 2.2.5 3.1L10 11.4 7.2 13.1l.5-3.1-2.2-2.2 3.1-.5z" fill="#fff"/></svg> Hub</span>
                            <span style="display:flex;align-items:center;gap:6px"><span style="width:11px;height:11px;border-radius:50%;background:#fff;border:2px solid #002F4C;display:inline-block;box-sizing:border-box"></span> Spoke</span>
                            <span style="border-left:1px solid #e2e8f0;height:16px"></span>
                            <button id="org-map-labels-proj-btn" onclick="GenericViews._toggleMapLabels('org','proj')" title="Show project location names" style="display:flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;cursor:pointer;font-size:11px;font-weight:600;color:#64748b"><i data-lucide="map-pin" width="11"></i> Projects</button>
                            <button id="org-map-labels-fac-btn" onclick="GenericViews._toggleMapLabels('org','fac')" title="Show facility names" style="display:flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;cursor:pointer;font-size:11px;font-weight:600;color:#64748b"><i data-lucide="building-2" width="11"></i> Facilities</button>
                            <button id="org-leaflet-map-cluster-btn" onclick="GenericViews._toggleMapClustering('org-leaflet-map')" title="Toggle facility clustering" style="display:flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;cursor:pointer;font-size:11px;font-weight:600;color:#64748b"><i data-lucide="group" width="11"></i> Cluster</button>
                            <button data-copy-map="org-leaflet-map" onclick="GenericCharts.copyMap('org-leaflet-map')" title="Copy map to clipboard" style="display:flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;cursor:pointer;font-size:11px;font-weight:600;color:#64748b"><i data-lucide="copy" width="11"></i> Copy</button>
                            <button onclick="GenericCharts.downloadMap('org-leaflet-map','Organisation_Map')" title="Download map as PNG" style="display:flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;cursor:pointer;font-size:11px;font-weight:600;color:#64748b"><i data-lucide="download" width="11"></i> Save</button>
                        </div>
                    </div>
                </div>
                <div id="org-leaflet-map"></div>
            </div>`;

        // Fetch all facility data before rendering map
        const projectData = await Promise.all(
            allProjects.map(async p => ({ project: p, facilities: await Projects.getFacilities(p.id) }))
        );

        requestAnimationFrame(() => {
            const map = this._initLeafletMap('org-leaflet-map');
            if (!map) return;

            const EPS = 0.001;

            // ── Step 1: build clusters ──────────────────────────────────────
            const clusters = [];
            projectData.forEach(({ project }) => {
                const locs = (Array.isArray(project.locations) && project.locations.length > 0)
                    ? project.locations
                    : (project.lat != null ? [{ name: '', lat: project.lat, lng: project.lng }] : []);
                locs.forEach(loc => {
                    const pLat = parseFloat(loc.lat), pLng = parseFloat(loc.lng);
                    if (isNaN(pLat) || isNaN(pLng)) return;
                    const ex = clusters.find(c => Math.abs(c.lat - pLat) < EPS && Math.abs(c.lng - pLng) < EPS);
                    const entry = { project, label: loc.name || project.name };
                    if (ex) ex.items.push(entry);
                    else clusters.push({ lat: pLat, lng: pLng, items: [entry] });
                });
            });

            // ── Step 2: collect all bounds (clusters + facilities) ──────────
            const bounds = [];
            clusters.forEach(c => bounds.push([c.lat, c.lng]));
            projectData.forEach(({ facilities }) => {
                facilities.forEach(fac => {
                    const fLat = parseFloat(fac.lat), fLng = parseFloat(fac.lng);
                    if (!isNaN(fLat) && !isNaN(fLng)) bounds.push([fLat, fLng]);
                });
            });

            // ── Step 3: set map view ────────────────────────────────────────
            if (bounds.length === 1) map.setView(bounds[0], 10);
            else if (bounds.length > 1) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 9 });

            // ── Step 4+5: add all markers with magnetic repulsion ──
            const allOrgMarkers = []; // { marker, trueLat, trueLng, line }

            const makePopup = (project, label, color) => `
                <div style="min-width:190px;font-family:sans-serif">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                        <span style="width:10px;height:10px;background:${color};flex-shrink:0;transform:rotate(45deg);border-radius:2px"></span>
                        <strong style="font-size:14px;color:#002F4C">${App.escapeHtml(label)}</strong>
                    </div>
                    ${label !== project.name ? `<div style="font-size:11px;color:#94a3b8;margin-bottom:6px">${App.escapeHtml(project.name)}</div>` : ''}
                    ${project.description ? `<p style="font-size:12px;color:#64748b;margin:0 0 10px;line-height:1.4">${App.escapeHtml(project.description.slice(0,120))}${project.description.length>120?'…':''}</p>` : ''}
                    <button data-map-pid="${project.id}" style="background:${color};color:#fff;border:none;padding:5px 14px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;width:100%">Open Project →</button>
                </div>`;

            // Diamond-shaped DivIcon for project locations
            const makeDiamond = (color) => L.divIcon({
                html: `<div style="width:16px;height:16px;background:${color};transform:rotate(45deg);border-radius:3px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>`,
                className: '', iconSize: [16, 16], iconAnchor: [8, 8]
            });

            clusters.forEach(cluster => {
                const { lat, lng, items } = cluster;

                if (items.length <= 5) {
                    items.forEach(({ project, label }) => {
                        const color = project.color || '#4389C8';
                        const m = L.marker([lat, lng], { icon: makeDiamond(color) })
                            .addTo(map).bindPopup(makePopup(project, label, color), { maxWidth: 280 });
                        const pShort = project.shortName || project.name;
                        const projTooltip = label !== project.name
                            ? `<span style="color:${color};font-weight:700">${App.escapeHtml(pShort)}</span> <span style="color:#94a3b8;font-weight:400">(${App.escapeHtml(label)})</span>`
                            : `<span style="color:${color};font-weight:700">${App.escapeHtml(pShort)}</span>`;
                        m.bindTooltip(projTooltip, { permanent: true, direction: 'right', offset: [10, 0], className: 'map-label map-label-proj map-label-hidden' });
                        const line = L.polyline([[lat, lng], [lat, lng]], { color, weight: 1.5, opacity: 0, dashArray: '4,4' }).addTo(map);
                        allOrgMarkers.push({ marker: m, trueLat: lat, trueLng: lng, line, _ttContent: projTooltip, _ttBaseClass: 'map-label map-label-proj', _ttKind: 'proj', _ttVisible: false });
                    });
                } else {
                    const icon = L.divIcon({
                        html: `<div style="width:34px;height:34px;border-radius:50%;background:#002F4C;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;color:#fff;font-family:sans-serif">${items.length}</div>`,
                        className: '', iconSize: [34, 34], iconAnchor: [17, 17]
                    });
                    const listRows = items.map(it => `
                        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f1f5f9">
                            <span style="width:9px;height:9px;border-radius:50%;background:${it.project.color||'#4389C8'};flex-shrink:0"></span>
                            <span style="font-size:13px;font-weight:600;color:#002F4C;flex:1">${App.escapeHtml(it.label)}</span>
                            <button data-map-pid="${it.project.id}" style="font-size:11px;color:#4389C8;font-weight:700;border:none;background:none;cursor:pointer;padding:2px 6px;white-space:nowrap">Open →</button>
                        </div>`).join('');
                    L.marker([lat, lng], { icon }).addTo(map)
                        .bindPopup(`<div style="min-width:210px;font-family:sans-serif"><p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase">${items.length} projects at this location</p>${listRows}</div>`, { maxWidth: 300 });
                }
            });

            // ── Step 6: add facility markers (Hub = circle with star, Spoke = small hollow circle) ─
            const makeHubIcon = (c) => L.divIcon({
                html: `<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="${c}" stroke="#fff" stroke-width="2"/><path d="M10 4.5l1.4 2.8 3.1.5-2.2 2.2.5 3.1L10 11.4 7.2 13.1l.5-3.1-2.2-2.2 3.1-.5z" fill="#fff"/></svg>`,
                className: '', iconSize: [20, 20], iconAnchor: [10, 10]
            });

            const facLayer = map._clusteringEnabled ? map._clusterGroup : map._plainGroup;
            projectData.forEach(({ project, facilities }) => {
                const pColor = project.color || '#4389C8';
                facilities.forEach(fac => {
                    const fLat = parseFloat(fac.lat), fLng = parseFloat(fac.lng);
                    if (isNaN(fLat) || isNaN(fLng)) return;
                    const hub = !!fac.isHub;
                    const m = hub
                        ? L.marker([fLat, fLng], { icon: makeHubIcon(pColor) })
                        : L.circleMarker([fLat, fLng], { radius: 6, fillColor: '#fff', color: pColor, weight: 2, fillOpacity: 0.7 });
                    facLayer.addLayer(m);
                    map._facilityMarkers.push(m);
                    m
                        .bindPopup(`
                            <div style="min-width:160px;font-family:sans-serif">
                                <div style="font-size:10px;font-weight:700;color:${pColor};text-transform:uppercase;margin-bottom:3px">${App.escapeHtml(project.name)}</div>
                                <strong style="font-size:13px;color:#002F4C">${App.escapeHtml(fac.name)}</strong>
                                ${hub ? '<div style="font-size:10px;font-weight:700;color:#002F4C;margin-top:3px;background:#002F4C15;display:inline-block;padding:1px 6px;border-radius:4px">HUB</div>' : ''}
                                ${fac.catchmentPop ? `<div style="font-size:12px;color:#64748b;margin-top:5px">Catchment pop: <b>${Number(fac.catchmentPop).toLocaleString()}</b></div>` : ''}
                                ${fac.annualPatients ? `<div style="font-size:12px;color:#64748b">Annual patients: <b>${Number(fac.annualPatients).toLocaleString()}</b></div>` : ''}
                                ${fac.notes ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px">${App.escapeHtml(fac.notes)}</div>` : ''}
                            </div>`, { maxWidth: 260 });
                    const facLabel = hub
                        ? `<b style="color:${pColor}">${App.escapeHtml(fac.name)}</b> <span style="background:${pColor};color:#fff;font-size:8px;font-weight:800;padding:1px 4px;border-radius:3px;letter-spacing:0.5px;vertical-align:1px">HUB</span>`
                        : `<span style="color:${pColor}">${App.escapeHtml(fac.name)}</span>`;
                    m.bindTooltip(facLabel, { permanent: true, direction: 'right', offset: [8, 0], className: 'map-label map-label-fac map-label-hidden' });
                    const line = L.polyline([[fLat, fLng], [fLat, fLng]], { color: pColor, weight: 1.5, opacity: 0, dashArray: '4,4' }).addTo(map);
                    allOrgMarkers.push({ marker: m, trueLat: fLat, trueLng: fLng, line, _ttContent: facLabel, _ttBaseClass: 'map-label map-label-fac', _ttKind: 'fac', _ttVisible: false });
                });
            });

            // Magnetic repulsion: push overlapping markers apart in pixel space
            const ORG_MIN_DIST = 22;
            const repelOrgMarkers = () => {
                if (allOrgMarkers.length < 2) return;
                const z = map.getZoom();
                const pts = allOrgMarkers.map(m => {
                    const p = map.project([m.trueLat, m.trueLng], z);
                    return { x: p.x, y: p.y };
                });
                for (let iter = 0; iter < 12; iter++) {
                    for (let i = 0; i < pts.length; i++) {
                        for (let j = i + 1; j < pts.length; j++) {
                            let dx = pts[j].x - pts[i].x;
                            let dy = pts[j].y - pts[i].y;
                            let dist = Math.sqrt(dx * dx + dy * dy);
                            if (dist < ORG_MIN_DIST && dist > 0) {
                                const push = (ORG_MIN_DIST - dist) / 2;
                                const nx = dx / dist, ny = dy / dist;
                                pts[i].x -= nx * push; pts[i].y -= ny * push;
                                pts[j].x += nx * push; pts[j].y += ny * push;
                            } else if (dist === 0) {
                                const angle = (i * 2.39996) % (Math.PI * 2);
                                pts[i].x -= Math.cos(angle) * ORG_MIN_DIST / 2;
                                pts[i].y -= Math.sin(angle) * ORG_MIN_DIST / 2;
                                pts[j].x += Math.cos(angle) * ORG_MIN_DIST / 2;
                                pts[j].y += Math.sin(angle) * ORG_MIN_DIST / 2;
                            }
                        }
                    }
                }
                pts.forEach((pt, i) => {
                    const m = allOrgMarkers[i];
                    const newLL = map.unproject(L.point(pt.x, pt.y), z);
                    const orig = map.project([m.trueLat, m.trueLng], z);
                    const displaced = Math.abs(pt.x - orig.x) > 1 || Math.abs(pt.y - orig.y) > 1;
                    if (m.marker.setLatLng) m.marker.setLatLng(newLL);
                    else if (m.marker._latlng) { m.marker._latlng = newLL; m.marker.redraw(); }
                    if (displaced) {
                        m.line.setLatLngs([[m.trueLat, m.trueLng], [newLL.lat, newLL.lng]]);
                        m.line.setStyle({ opacity: 0.45 });
                    } else {
                        m.line.setStyle({ opacity: 0 });
                    }
                });
            };
            repelOrgMarkers();
            GenericViews._orgMapRef = map;
            GenericViews._orgMapMarkers = allOrgMarkers;
            map.on('zoomend', () => { repelOrgMarkers(); setTimeout(() => GenericViews._layoutLabels('org-leaflet-map', allOrgMarkers, map), 80); });

            // Wire up "Open Project" buttons via event delegation (handles single + multi-project popups)
            map.on('popupopen', e => {
                e.popup.getElement()?.querySelectorAll('[data-map-pid]').forEach(btn => {
                    btn.onclick = () => {
                        map.closePopup();
                        App.currentProject = btn.dataset.mapPid;
                        App.view = 'project-dashboard';
                        App.renderView();
                    };
                });
            });

            // No-data overlay
            if (bounds.length === 0) {
                const el = document.getElementById('org-leaflet-map');
                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:22px 28px;border-radius:14px;box-shadow:0 4px 24px rgba(0,0,0,0.13);text-align:center;z-index:1000;pointer-events:none;font-family:sans-serif';
                overlay.innerHTML = '<div style="font-size:28px;margin-bottom:8px">📍</div><p style="font-weight:700;color:#002F4C;margin:0 0 6px;font-size:15px">No locations set yet</p><p style="font-size:12px;color:#64748b;margin:0;line-height:1.5">Add coordinates in each project\'s Settings,<br>or in the Facilities form in Data Entry.</p>';
                if (el) { el.style.position = 'relative'; el.appendChild(overlay); }
            }
        });
    },

    async renderProjectMap(main, project) {
        const facilities = await Projects.getFacilities(project.id);
        const color = project.color || '#4389C8';
        const hasFacilities = facilities.length > 0;

        main.innerHTML = `
            <div style="display:flex;flex-direction:column;height:100%">
                <div style="padding:20px 32px 12px;flex-shrink:0;border-bottom:1px solid #e2e8f0;background:#fff">
                    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
                        <div>
                            <h1 style="font-size:20px;font-weight:800;color:#002F4C;margin:0 0 2px">Project Map</h1>
                            <p style="font-size:13px;color:#94a3b8;margin:0">${App.escapeHtml(project.name)}${hasFacilities ? ' &mdash; ' + facilities.length + ' facilit' + (facilities.length === 1 ? 'y' : 'ies') : ''}</p>
                        </div>
                        <div style="display:flex;gap:8px;align-items:center">
                            <button id="proj-map-labels-btn" onclick="GenericViews._toggleMapLabels('proj')" title="Toggle labels" style="display:flex;align-items:center;gap:4px;padding:5px 10px;border:1px solid #e2e8f0;border-radius:7px;background:#fff;cursor:pointer;font-size:11px;font-weight:600;color:#64748b"><i data-lucide="tag" width="11"></i> Labels</button>
                            <button id="proj-leaflet-map-cluster-btn" onclick="GenericViews._toggleMapClustering('proj-leaflet-map')" title="Toggle facility clustering" style="display:flex;align-items:center;gap:4px;padding:5px 10px;border:1px solid #e2e8f0;border-radius:7px;background:#fff;cursor:pointer;font-size:11px;font-weight:600;color:#64748b"><i data-lucide="group" width="11"></i> Cluster</button>
                            <button data-copy-map="proj-leaflet-map" onclick="GenericCharts.copyMap('proj-leaflet-map')" title="Copy map to clipboard" style="display:flex;align-items:center;gap:4px;padding:5px 10px;border:1px solid #e2e8f0;border-radius:7px;background:#fff;cursor:pointer;font-size:11px;font-weight:600;color:#64748b"><i data-lucide="copy" width="11"></i> Copy</button>
                            <button onclick="GenericCharts.downloadMap('proj-leaflet-map','${App.escapeHtml((project.shortName||project.name).replace(/'/g,''))}_Map')" title="Download map as PNG" style="display:flex;align-items:center;gap:4px;padding:5px 10px;border:1px solid #e2e8f0;border-radius:7px;background:#fff;cursor:pointer;font-size:11px;font-weight:600;color:#64748b"><i data-lucide="download" width="11"></i> Save</button>
                            <span style="border-left:1px solid #e2e8f0;height:20px"></span>
                            <button onclick="App.navigate('project-setup')" style="font-size:12px;color:#4389C8;background:none;border:1px solid #e2e8f0;padding:5px 12px;border-radius:7px;cursor:pointer;font-weight:600">
                                Manage Facilities
                            </button>
                            <button onclick="App.navigate('project-settings')" style="font-size:12px;color:#64748b;background:none;border:1px solid #e2e8f0;padding:5px 12px;border-radius:7px;cursor:pointer;font-weight:600">
                                Edit Location
                            </button>
                        </div>
                    </div>
                </div>
                <div id="proj-leaflet-map"></div>
            </div>`;

        requestAnimationFrame(() => {
            const map = this._initLeafletMap('proj-leaflet-map');
            if (!map) return;

            const bounds = [];

            // Project locations (supports multiple)
            const projLocations = (Array.isArray(project.locations) && project.locations.length > 0)
                ? project.locations
                : (project.lat != null ? [{ name: '', lat: project.lat, lng: project.lng }] : []);

            const makeDiamond = (c) => L.divIcon({
                html: `<div style="width:16px;height:16px;background:${c};transform:rotate(45deg);border-radius:3px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>`,
                className: '', iconSize: [16, 16], iconAnchor: [8, 8]
            });

            // Collect all markers for magnetic repulsion
            const allMarkers = []; // { marker, trueLat, trueLng, line, radius }
            const connectorLines = [];

            projLocations.forEach((loc, i) => {
                const pLat = parseFloat(loc.lat); const pLng = parseFloat(loc.lng);
                if (isNaN(pLat) || isNaN(pLng)) return;
                const label = loc.name || (i === 0 ? project.name : `Location ${i + 1}`);
                const m = L.marker([pLat, pLng], { icon: makeDiamond(color) }).addTo(map).bindPopup(`
                    <div style="font-family:sans-serif">
                        <strong style="font-size:14px;color:#002F4C">${App.escapeHtml(label)}</strong>
                        ${loc.name ? `<div style="font-size:12px;color:#94a3b8;margin-top:2px">${App.escapeHtml(project.name)}</div>` : ''}
                        ${i === 0 && project.description ? `<p style="font-size:12px;color:#64748b;margin:6px 0 0;line-height:1.4">${App.escapeHtml(project.description.slice(0,120))}${project.description.length > 120 ? '…' : ''}</p>` : ''}
                    </div>`, { maxWidth: 260 });
                const ttLabel = App.escapeHtml(label);
                m.bindTooltip(ttLabel, { permanent: true, direction: 'right', offset: [10, 0], className: 'map-label map-label-hidden' });
                const line = L.polyline([[pLat, pLng], [pLat, pLng]], { color: color, weight: 1.5, opacity: 0.5, dashArray: '4,4' }).addTo(map);
                allMarkers.push({ marker: m, trueLat: pLat, trueLng: pLng, line, radius: 12, _ttContent: ttLabel, _ttBaseClass: 'map-label', _ttKind: 'all', _ttVisible: false });
                connectorLines.push(line);
                bounds.push([pLat, pLng]);
            });

            // Facilities (Hub = circle with star, Spoke = small hollow circle)
            const makeHubIcon = (c) => L.divIcon({
                html: `<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="${c}" stroke="#fff" stroke-width="2"/><path d="M10 4.5l1.4 2.8 3.1.5-2.2 2.2.5 3.1L10 11.4 7.2 13.1l.5-3.1-2.2-2.2 3.1-.5z" fill="#fff"/></svg>`,
                className: '', iconSize: [20, 20], iconAnchor: [10, 10]
            });

            const projFacLayer = map._clusteringEnabled ? map._clusterGroup : map._plainGroup;
            facilities.forEach(fac => {
                const fLat = fac.lat !== null && fac.lat !== undefined ? parseFloat(fac.lat) : NaN;
                const fLng = fac.lng !== null && fac.lng !== undefined ? parseFloat(fac.lng) : NaN;
                if (isNaN(fLat) || isNaN(fLng)) return;
                const hub = !!fac.isHub;
                const m = hub
                    ? L.marker([fLat, fLng], { icon: makeHubIcon(color) })
                    : L.circleMarker([fLat, fLng], { radius: 7, fillColor: '#fff', color: color, weight: 2, fillOpacity: 0.7 });
                projFacLayer.addLayer(m);
                map._facilityMarkers.push(m);
                m.bindPopup(`
                    <div style="min-width:160px;font-family:sans-serif">
                        <strong style="font-size:13px;color:#002F4C">${App.escapeHtml(fac.name)}</strong>
                        ${hub ? '<div style="font-size:10px;font-weight:700;color:#002F4C;margin-top:3px;background:#002F4C15;display:inline-block;padding:1px 6px;border-radius:4px">HUB</div>' : ''}
                        ${fac.catchmentPop ? `<div style="font-size:12px;color:#64748b;margin-top:5px">Catchment: <b>${Number(fac.catchmentPop).toLocaleString()}</b></div>` : ''}
                        ${fac.annualPatients ? `<div style="font-size:12px;color:#64748b">Patients/yr: <b>${Number(fac.annualPatients).toLocaleString()}</b></div>` : ''}
                        ${fac.notes ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px">${App.escapeHtml(fac.notes)}</div>` : ''}
                    </div>`, { maxWidth: 240 });
                const facLabel = hub
                    ? `<b style="color:#002F4C">${App.escapeHtml(fac.name)}</b> <span style="background:#002F4C;color:#fff;font-size:8px;font-weight:800;padding:1px 4px;border-radius:3px;letter-spacing:0.5px;vertical-align:1px">HUB</span>`
                    : App.escapeHtml(fac.name);
                m.bindTooltip(facLabel, { permanent: true, direction: 'right', offset: [8, 0], className: 'map-label map-label-hidden' });
                const line = L.polyline([[fLat, fLng], [fLat, fLng]], { color: color, weight: 1.5, opacity: 0.5, dashArray: '4,4' }).addTo(map);
                allMarkers.push({ marker: m, trueLat: fLat, trueLng: fLng, line, radius: hub ? 10 : 7, _ttContent: facLabel, _ttBaseClass: 'map-label', _ttKind: 'all', _ttVisible: false });
                connectorLines.push(line);
                bounds.push([fLat, fLng]);
            });

            // Magnetic repulsion: push overlapping markers apart in pixel space
            const MIN_DIST = 22; // minimum pixel distance between marker centres
            const repelMarkers = () => {
                if (allMarkers.length < 2) { connectorLines.forEach(l => l.setStyle({ opacity: 0 })); return; }
                const z = map.getZoom();
                // Convert true positions to pixel space
                const pts = allMarkers.map(m => {
                    const p = map.project([m.trueLat, m.trueLng], z);
                    return { x: p.x, y: p.y };
                });
                // Run repulsion iterations
                for (let iter = 0; iter < 12; iter++) {
                    for (let i = 0; i < pts.length; i++) {
                        for (let j = i + 1; j < pts.length; j++) {
                            let dx = pts[j].x - pts[i].x;
                            let dy = pts[j].y - pts[i].y;
                            let dist = Math.sqrt(dx * dx + dy * dy);
                            if (dist < MIN_DIST && dist > 0) {
                                const push = (MIN_DIST - dist) / 2;
                                const nx = dx / dist; const ny = dy / dist;
                                pts[i].x -= nx * push; pts[i].y -= ny * push;
                                pts[j].x += nx * push; pts[j].y += ny * push;
                            } else if (dist === 0) {
                                // Identical position — nudge apart at arbitrary angle
                                const angle = (i * 2.39996) % (Math.PI * 2); // golden angle
                                pts[i].x -= Math.cos(angle) * MIN_DIST / 2;
                                pts[i].y -= Math.sin(angle) * MIN_DIST / 2;
                                pts[j].x += Math.cos(angle) * MIN_DIST / 2;
                                pts[j].y += Math.sin(angle) * MIN_DIST / 2;
                            }
                        }
                    }
                }
                // Apply repelled positions back to lat/lng
                pts.forEach((pt, i) => {
                    const m = allMarkers[i];
                    const newLatLng = map.unproject(L.point(pt.x, pt.y), z);
                    const displaced = Math.abs(pt.x - map.project([m.trueLat, m.trueLng], z).x) > 1
                                   || Math.abs(pt.y - map.project([m.trueLat, m.trueLng], z).y) > 1;
                    if (m.marker.setLatLng) m.marker.setLatLng(newLatLng);
                    else if (m.marker._latlng) { m.marker._latlng = newLatLng; m.marker.redraw(); }
                    // Show/hide connector line
                    if (displaced) {
                        m.line.setLatLngs([[m.trueLat, m.trueLng], [newLatLng.lat, newLatLng.lng]]);
                        m.line.setStyle({ opacity: 0.45 });
                    } else {
                        m.line.setStyle({ opacity: 0 });
                    }
                });
            };
            repelMarkers();
            GenericViews._projMapRef = map;
            GenericViews._projMapMarkers = allMarkers;
            map.on('zoomend', () => { repelMarkers(); setTimeout(() => GenericViews._layoutLabels('proj-leaflet-map', allMarkers, map), 80); });

            if (bounds.length === 1) {
                map.setView(bounds[0], 9);
                setTimeout(repelMarkers, 50);
            } else if (bounds.length > 1) {
                map.fitBounds(bounds, { padding: [60, 60], maxZoom: 11 });
                setTimeout(repelMarkers, 50);
            }

            // No-data overlay
            if (bounds.length === 0) {
                const el = document.getElementById('proj-leaflet-map');
                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:22px 28px;border-radius:14px;box-shadow:0 4px 24px rgba(0,0,0,0.13);text-align:center;z-index:1000;pointer-events:none;font-family:sans-serif';
                overlay.innerHTML = '<div style="font-size:28px;margin-bottom:8px">📍</div><p style="font-weight:700;color:#002F4C;margin:0 0 6px;font-size:15px">No locations set</p><p style="font-size:12px;color:#64748b;margin:0;line-height:1.5">Add the project\'s coordinates in Settings,<br>and facility coordinates in Data Entry → Facilities.</p>';
                if (el) { el.style.position = 'relative'; el.appendChild(overlay); }
            }
        });
    },

    // ===== PROJECT SETTINGS =====
    async renderProjectSettings(main, project) {
        const iconOptions  = ['briefcase','heart','globe','target','zap','shield','star','flag','rocket','building-2','graduation-cap','microscope','stethoscope','leaf','users','truck','wrench','lightbulb'];
        const colorOptions = ['#4389C8','#D03734','#E28743','#10B981','#8B5CF6','#EC4899','#F59E0B','#002F4C'];
        const allQualityKpis = await Projects.getAllQualityKpis();
        const allBudget = await Projects.getBudget(project.id);
        // Year list for the budget matrix — same logic as Data Entry view
        const now = new Date();
        const yrMax = App.kpiYearMax != null ? Math.max(App.kpiYearMax, now.getFullYear() + 1) : now.getFullYear() + 1;
        const settingsYears = [];
        for (let y = 2022; y <= yrMax; y++) settingsYears.push(y);
        // Normalize any stored date (full JS string, ISO, or null) → YYYY-MM-DD for <input type="date">
        const toISODate = d => {
            if (!d) return '';
            if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return d;
            const p = new Date(d);
            return isNaN(p.getTime()) ? '' : p.toISOString().slice(0, 10);
        };

        main.innerHTML = `
            <div class="p-6 md:p-10 fade-in w-full max-w-4xl mx-auto">
                ${this._viewerNotice('Project Settings are read-only in view mode. Unlock editing to change project metadata, baselines, or quality indicator selection.')}
                <header class="mb-8"><h1 class="text-2xl font-bold text-gsf-prussian">Project Settings</h1></header>

                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
                    <h2 class="text-lg font-bold text-gsf-prussian mb-4">Project Details</h2>
                    <div class="space-y-4">
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Name</label>
                                <input type="text" id="setting-name" value="${App.escapeHtml(project.name)}" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Short Name <span class="normal-case font-normal text-slate-400">(for tabs / sheets)</span></label>
                                <input type="text" id="setting-short-name" value="${App.escapeHtml(project.shortName || '')}" placeholder="${App.escapeHtml(project.name)}" maxlength="30" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Description</label>
                            <textarea id="setting-desc" rows="2" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30 resize-y">${App.escapeHtml(project.description || '')}</textarea>
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Start Date <span class="normal-case font-normal text-slate-400">(optional)</span></label>
                                <input type="date" id="setting-start-date" value="${toISODate(project.startDate)}" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">End Date <span class="normal-case font-normal text-slate-400">(optional)</span></label>
                                <input type="date" id="setting-end-date" value="${toISODate(project.endDate)}" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Programme <span class="normal-case font-normal text-slate-400">(GSF area)</span></label>
                            <select id="setting-programme" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30 bg-white">
                                <option value="">— None —</option>
                                ${Projects.PROGRAMMES.map(pr => `<option value="${pr.id}" ${project.programme === pr.id ? 'selected' : ''}>${pr.name}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                </div>

                <!-- Locations section (separate card) -->
                ${(() => {
                    const locs = (Array.isArray(project.locations) && project.locations.length > 0)
                        ? project.locations
                        : (project.lat != null ? [{ id: 'loc_initial', name: '', lat: project.lat, lng: project.lng }] : []);
                    const locRows = locs.map((loc, i) => `
                        <div class="flex gap-2 items-center" data-loc-row="${i}">
                            <input type="text" value="${App.escapeHtml(loc.name || '')}" placeholder="Location name (optional)"
                                class="px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30 flex-1 loc-row-name" />
                            <input type="number" step="any" value="${loc.lat !== null ? loc.lat : ''}" placeholder="Lat"
                                class="px-2 py-2 border rounded-lg text-xs outline-none focus:ring-2 focus:ring-gsf-boston/30 w-28 loc-row-lat" />
                            <input type="number" step="any" value="${loc.lng !== null ? loc.lng : ''}" placeholder="Lng"
                                class="px-2 py-2 border rounded-lg text-xs outline-none focus:ring-2 focus:ring-gsf-boston/30 w-28 loc-row-lng" />
                            <button onclick="this.closest('[data-loc-row]').remove()"
                                class="text-red-400 hover:text-red-600 shrink-0 p-1"><i data-lucide="x" width="14"></i></button>
                        </div>`).join('');
                    return `
                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
                    <h2 class="text-lg font-bold text-gsf-prussian mb-1">Project Locations</h2>
                    <p class="text-sm text-slate-400 mb-4">Named locations shown as pins on the project map. Add as many as needed.</p>
                    <div id="locations-list" class="space-y-2 mb-4">${locRows}</div>
                    <div class="border-t border-slate-100 pt-4">
                        <p class="text-xs font-bold text-slate-500 uppercase mb-3">Add Location</p>
                        <div class="mb-2">
                            <input type="text" id="add-loc-name" placeholder="Location name (optional)"
                                class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                        </div>
                        <div class="flex gap-2 mb-1">
                            <input type="text" id="add-loc-location-search" placeholder="Search: e.g. Kampala, Uganda"
                                class="flex-1 px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30"
                                onkeydown="if(event.key==='Enter'){event.preventDefault();GenericViews._geocodeSearch('add-loc');}" />
                            <button type="button" onclick="GenericViews._geocodeSearch('add-loc')"
                                class="px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg text-sm font-semibold text-slate-600 transition-colors flex items-center gap-1.5">
                                <i data-lucide="search" width="13"></i> Find
                            </button>
                        </div>
                        <div id="add-loc-geo-results" class="hidden mt-1 border border-slate-200 rounded-lg bg-white shadow-lg overflow-hidden z-50 relative"></div>
                        <div class="flex gap-3 mt-2 items-end">
                            <div class="flex-1">
                                <label class="block text-[10px] font-bold text-slate-400 mb-0.5 uppercase">Latitude</label>
                                <input type="number" id="add-loc-lat" step="any" placeholder="—"
                                    class="w-full px-2.5 py-1.5 border rounded-lg text-xs outline-none focus:ring-2 focus:ring-gsf-boston/30 bg-slate-50" />
                            </div>
                            <div class="flex-1">
                                <label class="block text-[10px] font-bold text-slate-400 mb-0.5 uppercase">Longitude</label>
                                <input type="number" id="add-loc-lng" step="any" placeholder="—"
                                    class="w-full px-2.5 py-1.5 border rounded-lg text-xs outline-none focus:ring-2 focus:ring-gsf-boston/30 bg-slate-50" />
                            </div>
                            <button onclick="GenericViews._addLocationRow()"
                                class="px-4 py-1.5 bg-gsf-boston text-white rounded-lg text-xs font-bold hover:bg-gsf-prussian transition-colors shrink-0">
                                + Add
                            </button>
                        </div>
                    </div>
                    <div class="mt-4 pt-4 border-t border-slate-100 flex justify-end">
                        <button onclick="GenericViews._saveProjectSettings('${project.id}')" class="px-5 py-2 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors">Save Locations</button>
                    </div>
                </div>`;
                })()}

                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
                    <h2 class="text-lg font-bold text-gsf-prussian mb-4">Appearance</h2>
                    <div class="space-y-4">
                        <div>
                            <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Color</label>
                            <div class="flex gap-2 mt-1">
                                ${colorOptions.map(c => `<button onclick="document.getElementById('setting-color').value='${c}'; document.querySelectorAll('[data-color-btn]').forEach(b=>b.classList.remove('ring-2','ring-offset-2')); this.classList.add('ring-2','ring-offset-2')" data-color-btn class="w-8 h-8 rounded-full border-2 border-white shadow-sm ${c === project.color ? 'ring-2 ring-offset-2' : ''}" style="background:${c}"></button>`).join('')}
                                <input type="hidden" id="setting-color" value="${project.color}" />
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Icon</label>
                            <div class="flex flex-wrap gap-2 mt-1">
                                ${iconOptions.map(ic => `<button onclick="document.getElementById('setting-icon').value='${ic}'; document.querySelectorAll('[data-icon-btn]').forEach(b=>b.classList.remove('bg-gsf-boston/10','ring-1')); this.classList.add('bg-gsf-boston/10','ring-1')" data-icon-btn class="w-9 h-9 rounded-lg flex items-center justify-center border hover:bg-slate-50 ${ic === project.icon ? 'bg-gsf-boston/10 ring-1' : ''}"><i data-lucide="${ic}" width="18" class="text-slate-600"></i></button>`).join('')}
                                <input type="hidden" id="setting-icon" value="${project.icon || 'briefcase'}" />
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Links section -->
                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
                    <h2 class="text-lg font-bold text-gsf-prussian mb-1">Project Links</h2>
                    <p class="text-sm text-slate-400 mb-4">Quick access links for this project.</p>
                    <div class="space-y-4">
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">GSF Project Page</label>
                                <input type="url" id="setting-link-gsf" value="${App.escapeHtml(project.linkGsf || '')}" placeholder="https://..." class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Working Folder</label>
                                <input type="text" id="setting-link-folder" value="${App.escapeHtml(project.linkFolder || '')}" placeholder="https:// or /path/to/folder" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Google Sheets Tab URL <span class="normal-case font-normal text-slate-400">(opens this project's tab directly)</span></label>
                            <input type="url" id="setting-sheets-tab-url" value="${App.escapeHtml(project.sheetsTabUrl || '')}" placeholder="https://docs.google.com/spreadsheets/d/…#gid=…" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            <p class="text-[10px] text-slate-400 mt-1">Copy the URL from Google Sheets when viewing this project's tab. Overrides the org-level spreadsheet URL for this project's Sheet button.</p>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-500 mb-2 uppercase">Additional Links</label>
                            <div id="extra-links-list" class="space-y-2 mb-2">
                                ${(project.linksExtra || []).map((l, i) => `
                                <div class="flex gap-2 items-center" data-extra-link="${i}">
                                    <input type="text" value="${App.escapeHtml(l.label)}" placeholder="Label" class="px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30 w-36 shrink-0 extra-link-label" />
                                    <input type="text" value="${App.escapeHtml(l.url)}" placeholder="URL or path" class="px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30 flex-1 extra-link-url" />
                                    <button onclick="this.closest('[data-extra-link]').remove()" class="text-red-400 hover:text-red-600 shrink-0 p-1"><i data-lucide="x" width="14"></i></button>
                                </div>`).join('')}
                            </div>
                            <button onclick="GenericViews._addExtraLink()" class="text-xs text-gsf-boston hover:underline font-semibold flex items-center gap-1">
                                <i data-lucide="plus" width="12"></i> Add link
                            </button>
                        </div>
                    </div>
                    <div class="mt-4 pt-4 border-t border-slate-100 flex justify-end">
                        <button onclick="GenericViews._saveProjectLinks('${project.id}')" class="px-5 py-2 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors">Save Links</button>
                    </div>
                </div>

                <div class="bg-slate-50 rounded-xl border border-slate-200 p-6 mb-6">
                    <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide mb-2">Standard KPIs</h2>
                    <p class="text-sm text-slate-500 mb-3">All projects use the standard organisational KPIs. Set yearly targets from the <button onclick="App.navigate('project-kpi-progress')" class="text-gsf-boston hover:underline font-medium">KPI Progress</button> view.</p>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                        ${Projects.STANDARD_KPIS.map(kpi => `
                            <div class="flex items-center gap-2 text-sm text-slate-600 bg-white rounded-lg p-3 border border-slate-200">
                                <i data-lucide="${kpi.icon}" width="14" style="color:${kpi.color}"></i>
                                <span>${kpi.name}</span>
                            </div>`).join('')}
                    </div>
                    <div class="border-t border-slate-200 pt-4">
                        <h3 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">HCW Multiplier Effect</h3>
                        <p class="text-xs text-slate-400 mb-3">Optionally apply a multiplier to HCW numbers to account for onward teaching impact (e.g. ×10 means each HCW trained reaches 10 people). When enabled, a toggle appears on the dashboard.</p>
                        <div class="flex items-center gap-4">
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" id="setting-hcw-multiplier-enabled" ${project.hcwMultiplierEnabled ? 'checked' : ''} class="rounded border-slate-300 text-gsf-boston focus:ring-gsf-boston/30" />
                                <span class="text-sm text-slate-700 font-medium">Enable HCW multiplier</span>
                            </label>
                            <div class="flex items-center gap-2">
                                <span class="text-sm text-slate-500">×</span>
                                <input type="number" id="setting-hcw-multiplier-rate" value="${project.hcwMultiplierRate !== undefined ? project.hcwMultiplierRate : 10}" min="0.1" max="1000" step="0.1"
                                    class="w-20 px-3 py-1.5 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            </div>
                        </div>
                    </div>
                </div>

                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
                    <h2 class="text-lg font-bold text-gsf-prussian mb-1">Quality Indicators</h2>
                    <p class="text-sm text-slate-400 mb-4">Select quarterly quality/outcome KPIs to track for this project. Data is entered per quarter in Project Setup.</p>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        ${allQualityKpis.map(kpi => {
                            const checked = (project.enabledQualityKpis || []).includes(kpi.id);
                            return `
                            <label class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${checked ? 'border-gsf-boston/40 bg-gsf-boston/5' : 'border-slate-200 hover:bg-slate-50'}">
                                <input type="checkbox" name="quality-kpi" value="${kpi.id}" ${checked ? 'checked' : ''}
                                    class="rounded border-slate-300 text-gsf-boston focus:ring-gsf-boston/30" />
                                <div class="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style="background:${kpi.color}20">
                                    <i data-lucide="${kpi.icon}" width="14" style="color:${kpi.color}"></i>
                                </div>
                                <div class="flex-1 min-w-0">
                                    <p class="text-sm font-semibold text-slate-800">${kpi.shortName}</p>
                                    <p class="text-xs text-slate-500 truncate">${kpi.name}</p>
                                </div>
                                <span class="text-xs text-slate-400 shrink-0">${kpi.unit}</span>
                            </label>`;
                        }).join('')}
                    </div>
                    <div class="mt-4 pt-4 border-t border-slate-100 flex justify-end">
                        <button onclick="GenericViews._saveQualityKpiSelection('${project.id}')" class="px-5 py-2 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors">Save Selection</button>
                    </div>
                </div>

                <!-- ── Impact Assumptions (drives the Economic Impact section) ── -->
                ${(() => {
                    const ia = project.impactAssumptions || {};
                    const v = k => (ia[k] === undefined || ia[k] === null) ? '' : ia[k];
                    const enabledQ = project.enabledQualityKpis || [];
                    const qPool = Projects.QUALITY_KPIS.filter(k => enabledQ.includes(k.id));
                    const qBase = project.qualityBaselines || {};
                    const qTgt  = project.qualityTargets   || {};
                    // For each enabled quality KPI, render Baseline + Target (value + % helper)
                    const qRows = qPool.map(kpi => {
                        const bVal = qBase[kpi.id];
                        const tVal = qTgt[kpi.id];
                        const hasBase = bVal !== undefined && bVal !== null && !isNaN(bVal);
                        const pctFromVal = (val) => {
                            if (!hasBase || val === '' || val === null || val === undefined || isNaN(val) || Number(bVal) === 0) return '';
                            const raw = ((Number(bVal) - Number(val)) / Number(bVal)) * 100;
                            const signed = kpi.lowerIsBetter ? raw : -raw;
                            return Math.round(signed);
                        };
                        const tPct = pctFromVal(tVal);
                        const dataAttrs = `data-kpi="${kpi.id}" data-baseline="${hasBase ? bVal : ''}" data-lower="${kpi.lowerIsBetter ? '1' : '0'}"`;
                        return `
                        <div class="border border-slate-200 rounded-lg p-3 bg-slate-50/30">
                            <div class="flex items-center gap-2 mb-2">
                                <i data-lucide="${kpi.icon}" width="14" style="color:${kpi.color}"></i>
                                <div class="flex-1">
                                    <p class="text-xs font-black uppercase tracking-wide" style="color:${kpi.color}">${kpi.shortName}</p>
                                    <p class="text-[10px] text-slate-400">${kpi.name} · ${kpi.unit}${kpi.lowerIsBetter ? ' · lower is better' : ''}</p>
                                </div>
                            </div>
                            <div class="grid grid-cols-2 gap-2">
                                <div>
                                    <label class="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">Baseline</label>
                                    <input type="number" step="any" placeholder="—"
                                        id="setting-qbase-${kpi.id}"
                                        data-qbase="${kpi.id}"
                                        value="${hasBase ? bVal : ''}"
                                        oninput="GenericViews._onSettingsBaselineInput(this, '${kpi.id}')"
                                        class="w-full px-2 py-1.5 border border-slate-200 rounded text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30 bg-white tabular-nums" />
                                </div>
                                <div>
                                    <label class="block text-[10px] font-bold uppercase tracking-wide text-amber-700 mb-1">Target</label>
                                    <div class="flex items-center gap-1">
                                        <input type="number" step="any" placeholder="value" ${dataAttrs} data-target-kind="abs"
                                            id="setting-qtgt-${kpi.id}"
                                            data-qtgt="${kpi.id}"
                                            value="${tVal !== undefined && tVal !== null ? tVal : ''}"
                                            oninput="GenericViews._onQualityTargetInput(this)"
                                            class="w-full px-2 py-1.5 border border-amber-200 rounded text-sm text-right outline-none focus:ring-2 focus:ring-amber-400/30 bg-amber-50/30 tabular-nums" />
                                        <input type="number" step="any" placeholder="${hasBase ? '%' : '—'}" ${dataAttrs} data-target-kind="pct" ${hasBase ? '' : 'disabled'}
                                            value="${tPct !== '' ? tPct : ''}"
                                            oninput="GenericViews._onQualityTargetInput(this)"
                                            class="w-16 px-2 py-1.5 border border-amber-200 rounded text-sm text-right outline-none focus:ring-2 focus:ring-amber-400/30 ${hasBase ? 'bg-amber-50/30' : 'bg-slate-100 text-slate-300 cursor-not-allowed'} tabular-nums"
                                            title="${hasBase ? `% ${kpi.lowerIsBetter ? 'reduction' : 'increase'} vs baseline (positive = improvement)` : 'Set a baseline first to enter % change'}" />
                                        <span class="text-[10px] text-slate-400">%</span>
                                    </div>
                                </div>
                            </div>
                        </div>`;
                    }).join('');
                    return `
                    <div class="bg-white rounded-xl border border-emerald-200 shadow-sm p-6 mb-6">
                        <h2 class="text-lg font-bold text-gsf-prussian mb-1 flex items-center gap-2"><i data-lucide="trending-up" width="18" class="text-emerald-600"></i> Impact Assumptions</h2>
                        <p class="text-sm text-slate-500 mb-4">Drive the dashboard's <strong>Economic Impact</strong> &amp; <strong>Quality Improvement</strong> sections. Set the baseline and target for each enabled Quality Indicator below, plus the volumes that convert quality changes into deaths averted, DALYs, and cost-per-DALY.</p>

                        ${qPool.length > 0 ? `
                            <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2">Quality Indicators — Baseline &amp; Target</p>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">${qRows}</div>
                        ` : `
                            <p class="text-[11px] text-amber-700 bg-amber-50/50 border border-amber-100 rounded px-3 py-2 mb-4 flex items-center gap-2"><i data-lucide="info" width="13"></i> Enable Quality Indicators above to set their baselines and targets here.</p>
                        `}

                        <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2 pt-3 border-t border-slate-100">Volumes &amp; Economic Inputs</p>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Annual Surgical Volume</label>
                                <input type="number" min="0" id="setting-surgical-volume" value="${v('annualSurgicalVolume')}" placeholder="e.g. 5000" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                                <p class="text-[10px] text-slate-400 mt-1">Total surgeries per year across supported facilities.</p>
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Annual Live Births</label>
                                <input type="number" min="0" id="setting-live-births" value="${v('annualLiveBirths')}" placeholder="e.g. 3500" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                                <p class="text-[10px] text-slate-400 mt-1">For maternal &amp; neonatal mortality conversion.</p>
                            </div>
                            <div class="md:col-span-2">
                                <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">GDP per capita <span class="normal-case font-normal text-slate-400">(USD, World Bank — for DALY monetisation)</span></label>
                                <input type="number" min="0" id="setting-gdp-per-capita" value="${v('gdpPerCapita')}" placeholder="e.g. 1500" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                                <p class="text-[10px] text-slate-400 mt-1">Common references: Kenya ≈ 2,100 · Sierra Leone ≈ 530 · Rwanda ≈ 1,000 · Ethiopia ≈ 1,200 · India ≈ 2,500. Used to convert DALYs averted to economic value, and to compute the WHO cost-effectiveness threshold (3× GDP/cap).</p>
                            </div>
                        </div>
                        <p class="text-[11px] text-slate-400 italic mt-3">📖 Full methodology and citations are in the <button onclick="App.view='org-methodology'; App.renderView()" class="text-gsf-boston hover:underline font-medium">Methodology</button> section.</p>
                    </div>`;
                })()}

                <!-- ── Budget — allocated funding per year (drives Cost-Effectiveness) ── -->
                <div class="bg-white rounded-xl border border-emerald-200 shadow-sm p-6 mb-6">
                    <h2 class="text-lg font-bold text-gsf-prussian mb-1 flex items-center gap-2"><i data-lucide="banknote" width="18" class="text-emerald-600"></i> Budget</h2>
                    <p class="text-sm text-slate-500 mb-4">Allocated funding per year. Drives the dashboard's <strong>Budget &amp; Cost-Effectiveness</strong> section. Cells auto-save on blur — no need to click Save Settings.</p>
                    ${this._renderBudgetMatrix(project, allBudget, settingsYears)}
                </div>

                <div class="flex items-center justify-between">
                    <button onclick="GenericViews._saveProjectSettings('${project.id}')" id="save-settings-btn" class="px-8 py-3 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors flex items-center gap-2">
                        <i data-lucide="save" width="14"></i> Save Settings
                    </button>
                    <span id="save-settings-hint" class="text-[11px] text-amber-600 font-bold hidden ml-3">⚠ You have unsaved changes</span>
                    <button data-edit-only onclick="GenericViews._confirmDeleteProject('${project.id}')" class="px-4 py-2 text-red-500 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors">Delete Project</button>
                </div>
            </div>`;

        if (window.lucide) lucide.createIcons();

        // Wire the dirty hint: any input change in the settings form lights up the
        // "unsaved changes" warning until the Save button is clicked. Removes the
        // silent-loss footgun where users edit values, navigate away, and never
        // realise nothing was persisted.
        const hint = document.getElementById('save-settings-hint');
        const saveBtn = document.getElementById('save-settings-btn');
        if (hint && saveBtn) {
            const showDirty = () => {
                hint.classList.remove('hidden');
                saveBtn.classList.add('animate-pulse');
            };
            main.querySelectorAll('input, textarea, select').forEach(el => {
                el.addEventListener('input', showDirty);
                el.addEventListener('change', showDirty);
            });
        }
    },

    async _saveProjectLinks(projectId) {
        const linkGsf      = (document.getElementById('setting-link-gsf')?.value       || '').trim();
        const linkFolder   = (document.getElementById('setting-link-folder')?.value    || '').trim();
        const sheetsTabUrl = (document.getElementById('setting-sheets-tab-url')?.value || '').trim() || null;
        const extraRows    = document.querySelectorAll('#extra-links-list [data-extra-link]');
        const linksExtra   = [];
        extraRows.forEach(row => {
            const label = row.querySelector('.extra-link-label')?.value.trim() || '';
            const url   = row.querySelector('.extra-link-url')?.value.trim()   || '';
            if (label || url) linksExtra.push({ label, url });
        });
        await Projects.updateProject(projectId, { linkGsf, linkFolder, linksExtra, sheetsTabUrl });
        App.showMsg('Links saved ✓');
        App.renderView();
    },

    async _saveProjectSettings(projectId) {
        const name        = document.getElementById('setting-name')?.value.trim();
        const shortName   = (document.getElementById('setting-short-name')?.value || '').trim() || null;
        const description = document.getElementById('setting-desc')?.value.trim();
        const color       = document.getElementById('setting-color')?.value;
        const icon        = document.getElementById('setting-icon')?.value;
        const linkGsf     = (document.getElementById('setting-link-gsf')?.value    || '').trim();
        const linkFolder  = (document.getElementById('setting-link-folder')?.value || '').trim();
        const sheetsTabUrl = (document.getElementById('setting-sheets-tab-url')?.value || '').trim() || null;
        const extraRows   = document.querySelectorAll('#extra-links-list [data-extra-link]');
        const linksExtra  = [];
        extraRows.forEach(row => {
            const label = row.querySelector('.extra-link-label')?.value.trim() || '';
            const url   = row.querySelector('.extra-link-url')?.value.trim()   || '';
            if (label || url) linksExtra.push({ label, url });
        });
        const startDate = (document.getElementById('setting-start-date')?.value || '').trim() || null;
        const endDate   = (document.getElementById('setting-end-date')?.value   || '').trim() || null;
        const programme = (document.getElementById('setting-programme')?.value   || '').trim();
        const hcwMultiplierEnabled = document.getElementById('setting-hcw-multiplier-enabled')?.checked || false;
        const hcwMultiplierRate    = parseFloat(document.getElementById('setting-hcw-multiplier-rate')?.value) || 10;
        // Locations
        const locationRows = document.querySelectorAll('#locations-list [data-loc-row]');
        const locations = [];
        locationRows.forEach(row => {
            const locName = (row.querySelector('.loc-row-name')?.value || '').trim();
            const locLat  = parseFloat(row.querySelector('.loc-row-lat')?.value || '');
            const locLng  = parseFloat(row.querySelector('.loc-row-lng')?.value || '');
            if (!isNaN(locLat) && !isNaN(locLng)) {
                locations.push({ id: `loc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name: locName, lat: locLat, lng: locLng });
            }
        });
        if (!name) return;
        // Derive single lat/lng for backward compat (first location)
        const lat = locations[0]?.lat ?? null;
        const lng = locations[0]?.lng ?? null;
        // Impact assumptions (drives the Economic Impact dashboard section)
        const num = id => {
            const el = document.getElementById(id); if (!el) return null;
            const v = el.value.trim(); if (v === '') return null;
            const n = parseFloat(v); return isNaN(n) ? null : n;
        };
        // Preserve any legacy baseline* values already stored (they're now read-only;
        // the live source of truth is project.qualityBaselines, edited in Data Entry).
        const existingIA = (Projects.getProject(projectId) || {}).impactAssumptions || {};
        const impactAssumptions = {
            // Legacy baselines — kept untouched for backward-compat fallback
            baselineSSI: existingIA.baselineSSI ?? null,
            baselineSSC: existingIA.baselineSSC ?? null,
            baselineMMR: existingIA.baselineMMR ?? null,
            baselineNMR: existingIA.baselineNMR ?? null,
            annualSurgicalVolume: num('setting-surgical-volume'),
            annualLiveBirths:     num('setting-live-births'),
            gdpPerCapita:         num('setting-gdp-per-capita'),
        };
        // Quality KPI baselines + targets (moved here from Data Entry → all impact inputs in one place)
        const qualityBaselines = Object.assign({}, (Projects.getProject(projectId) || {}).qualityBaselines || {});
        const qualityTargets   = Object.assign({}, (Projects.getProject(projectId) || {}).qualityTargets   || {});
        document.querySelectorAll('[data-qbase]').forEach(el => {
            const id = el.dataset.qbase;
            const v = el.value.trim();
            if (v === '') delete qualityBaselines[id];
            else {
                const n = parseFloat(v);
                if (!isNaN(n) && n >= 0) qualityBaselines[id] = n;
            }
        });
        document.querySelectorAll('[data-qtgt]').forEach(el => {
            // The pct sibling is data-target-kind="pct" — only persist the abs value here
            if (el.dataset.targetKind && el.dataset.targetKind !== 'abs') return;
            const id = el.dataset.qtgt;
            const v = el.value.trim();
            if (v === '') delete qualityTargets[id];
            else {
                const n = parseFloat(v);
                if (!isNaN(n) && n >= 0) qualityTargets[id] = n;
            }
        });
        await Projects.updateProject(projectId, { name, shortName, description, color, icon, programme, linkGsf, linkFolder, linksExtra, sheetsTabUrl, startDate, endDate, hcwMultiplierEnabled, hcwMultiplierRate, locations, lat, lng, impactAssumptions, qualityBaselines, qualityTargets });
        // Quick summary so the user can see exactly what landed (especially the
        // economic / quality fields where silent saves have caused confusion).
        const iaCount = Object.values(impactAssumptions).filter(v => v != null && v !== '').length;
        const qbCount = Object.keys(qualityBaselines).length;
        const qtCount = Object.keys(qualityTargets).length;
        const bits = [];
        if (iaCount) bits.push(`${iaCount} impact field${iaCount === 1 ? '' : 's'}`);
        if (qbCount) bits.push(`${qbCount} baseline${qbCount === 1 ? '' : 's'}`);
        if (qtCount) bits.push(`${qtCount} target${qtCount === 1 ? '' : 's'}`);
        App.showMsg('Settings saved ✓' + (bits.length ? ` — ${bits.join(' · ')}` : ''));
        App.renderView();
    },

    _addLocationRow() {
        const name = (document.getElementById('add-loc-name')?.value || '').trim();
        const lat  = document.getElementById('add-loc-lat')?.value?.trim();
        const lng  = document.getElementById('add-loc-lng')?.value?.trim();
        if (!lat || !lng || isNaN(parseFloat(lat)) || isNaN(parseFloat(lng))) {
            App.showMsg('Set coordinates first — use the search or type them manually.'); return;
        }
        const list = document.getElementById('locations-list');
        if (!list) return;
        const idx  = list.querySelectorAll('[data-loc-row]').length;
        const row  = document.createElement('div');
        row.className = 'flex gap-2 items-center';
        row.setAttribute('data-loc-row', idx);
        row.innerHTML = `
            <input type="text" value="${App.escapeHtml(name)}" placeholder="Location name (optional)"
                class="px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30 flex-1 loc-row-name" />
            <input type="number" step="any" value="${parseFloat(lat)}" placeholder="Lat"
                class="px-2 py-2 border rounded-lg text-xs outline-none focus:ring-2 focus:ring-gsf-boston/30 w-28 loc-row-lat" />
            <input type="number" step="any" value="${parseFloat(lng)}" placeholder="Lng"
                class="px-2 py-2 border rounded-lg text-xs outline-none focus:ring-2 focus:ring-gsf-boston/30 w-28 loc-row-lng" />
            <button onclick="this.closest('[data-loc-row]').remove()"
                class="text-red-400 hover:text-red-600 shrink-0 p-1"><i data-lucide="x" width="14"></i></button>`;
        if (window.lucide) lucide.createIcons({ nodes: [row] });
        list.appendChild(row);
        // Clear add form
        ['add-loc-name', 'add-loc-location-search', 'add-loc-lat', 'add-loc-lng'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });
        const res = document.getElementById('add-loc-geo-results');
        if (res) { res.innerHTML = ''; res.classList.add('hidden'); }
    },

    _getAppsScriptCode() {
        return `// SURGdash Google Sheets Sync
// Paste into Google Apps Script → Save → Deploy as Web App
// Execute as: Me  |  Access: Anyone

// ── doGet: read live data from each project sheet so manual edits are picked up
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    // Cheap freshness check — return ONLY the spreadsheet's last-modified time so the
    // app can detect new cloud data without downloading every sheet. (?meta=1)
    if (e && e.parameter && e.parameter.meta) {
      var _lm = '';
      // Primary: the push timestamp (no extra permission). Bonus: the Drive file's
      // last-modified time, if the Drive scope happens to be granted (also catches
      // manual sheet edits). Return whichever is newer.
      try { _lm = PropertiesService.getScriptProperties().getProperty('lastSync') || ''; } catch (_p) {}
      // Manual edits typed into the Sheet (caught by the onEdit trigger below).
      try { var _le = PropertiesService.getScriptProperties().getProperty('lastEdit') || ''; if (_le > _lm) _lm = _le; } catch (_q) {}
      // Bonus, only if the Drive scope happens to be granted (also catches edits
      // made before the trigger existed).
      try { var _d = DriveApp.getFileById(ss.getId()).getLastUpdated(); if (_d) { var _di = _d.toISOString(); if (_di > _lm) _lm = _di; } } catch (_e) {}
      return _json({ ok: true, meta: true, lastModified: _lm });
    }
    const SKIP = new Set(['📊 Organisation', '__SURGdash__', '📋 SURGdash Backup']);
    const projects = [];
    ss.getSheets().forEach(sheet => {
      if (SKIP.has(sheet.getName())) return;
      const p = _readProjectSheet(sheet);
      if (p) projects.push(p);
    });
    return _json({ ok: true, projects });
  } catch(err) { return _json({ ok: false, error: err.message }); }
}

function _readProjectSheet(sheet) {
  var vals = sheet.getDataRange().getValues();
  if (!vals.length) return null;

  var project = { name: sheet.getName(), shortName: '', years: [], events: [], updates: [], kpiLog: [], linksExtra: [], qualityData: [], facilities: [], locations: [] };
  var section = null;
  var kpiHeaderSeen = false;
  var evHeaderSeen  = false;
  var updHeaderSeen = false;
  var logHeaderSeen = false;
  var qHdrSeen      = false;
  var facHdrSeen    = false;

  for (var i = 0; i < vals.length; i++) {
    var row   = vals[i];
    var first = String(row[0] || '').trim();

    // Detect section headers (merged cells with dark background — value in col A)
    if (first === 'PROJECT INFO')        { section = 'info';     continue; }
    if (first === 'LINKS')              { section = 'links';    continue; }
    if (first === 'KPIs BY YEAR')        { section = 'kpis';     kpiHeaderSeen = false; continue; }
    if (first === 'KPI COMMENTS')        { section = 'comments'; continue; }
    if (first === 'KPI CHANGE LOG')      { section = 'kpilog';   logHeaderSeen = false; continue; }
    if (first === 'QUALITY INDICATORS')  { section = 'quality';  qHdrSeen = false; continue; }
    if (first.startsWith('EVENTS'))      { section = 'events';   evHeaderSeen  = false; continue; }
    if (first === 'UPDATES')             { section = 'updates';  updHeaderSeen = false; continue; }
    if (first === 'FACILITIES')          { section = 'facilities'; facHdrSeen = false; continue; }
    if (first === '')                    { continue; }

    if (section === 'info') {
      if (first === 'Name')              project.name               = String(row[1] || '');
      if (first === 'Short Name')        project.shortName          = String(row[1] || '');
      if (first === 'Description')       project.description        = String(row[1] || '');
      if (first === 'Color')             project.color              = String(row[1] || '');
      if (first === 'Icon')              project.icon               = String(row[1] || '');
      if (first === 'Start Date')        project.startDate          = _date(row[1]);
      if (first === 'End Date')          project.endDate            = _date(row[1]);
      if (first === 'HCW Multiplier')    project.hcwMultiplierEnabled = String(row[1] || '').toLowerCase() === 'yes';
      if (first === 'HCW Multiplier Rate') {
        var v = Number(row[1]);
        if (!isNaN(v)) project.hcwMultiplierRate = v;
      }
      if (first === 'Quality KPIs') {
        var qstr = String(row[1] || '').trim();
        project.enabledQualityKpis = qstr ? qstr.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
      }
      if (first === 'Latitude')       { var v = Number(row[1]); if (!isNaN(v)) project.lat = v; }
      if (first === 'Longitude')      { var v = Number(row[1]); if (!isNaN(v)) project.lng = v; }
      if (first === 'Sheets Tab URL') project.sheetsTabUrl = String(row[1] || '').trim();
      if (first === 'Locations') {
        try { project.locations = JSON.parse(String(row[1] || '[]')); } catch(e) { project.locations = []; }
      }
    }

    if (section === 'links') {
      if (first === 'GSF Page')      project.linkGsf    = String(row[1] || '').trim();
      if (first === 'Working Folder') project.linkFolder = String(row[1] || '').trim();
      if (first.startsWith('Extra Link')) {
        var lurl = String(row[1] || '').trim();
        var llabel = String(row[2] || '').trim();
        if (lurl) project.linksExtra.push({ url: lurl, label: llabel });
      }
    }

    if (section === 'kpis') {
      if (!kpiHeaderSeen) { kpiHeaderSeen = true; continue; } // skip column header row
      var year = Number(row[0]);
      if (!year) continue;
      project.years.push({
        year: year,
        targets: {
          hcw_strengthened:        _num(row[1]),
          patients_reached:         _num(row[3]),
          facilities_strengthened:  _num(row[5]),
          population_access:        _num(row[7])
        },
        actuals: {
          hcw_strengthened:        _num(row[2]),
          patients_reached:         _num(row[4]),
          facilities_strengthened:  _num(row[6]),
          population_access:        _num(row[8])
        },
        targetComments: {},
        actualComments: {}
      });
    }

    if (section === 'comments') {
      var cyear = Number(row[0]);
      if (!cyear) continue;
      var label = String(row[1] || '').trim();
      var labelMap = {
        'HCW Strengthened': 'hcw_strengthened',
        'Patients Reached': 'patients_reached',
        'Facilities Strengthened': 'facilities_strengthened',
        'Population Access': 'population_access'
      };
      var key = labelMap[label];
      if (!key) continue;
      var yr = project.years.find(function(y) { return y.year === cyear; });
      if (!yr) continue;
      if (row[2]) yr.targetComments[key] = String(row[2]);
      if (row[3]) yr.actualComments[key] = String(row[3]);
    }

    if (section === 'quality') {
      if (!qHdrSeen) { qHdrSeen = true; continue; }
      var qKpiId = String(row[0] || '').trim();
      if (!qKpiId) continue;
      var qYear = Number(row[1]);
      var qQuarter = Number(row[2]);
      var qTarget = _num(row[3]);
      var qActual = _num(row[4]);
      if (qKpiId && qYear && qQuarter) {
        if (!project.qualityData) project.qualityData = [];
        project.qualityData.push({ kpiId: qKpiId, year: qYear, quarter: qQuarter, target: qTarget !== undefined ? qTarget : null, actual: qActual !== undefined ? qActual : null });
      }
    }

    if (section === 'kpilog') {
      if (!logHeaderSeen) { logHeaderSeen = true; continue; }
      var ts = String(row[0] || '').trim();
      if (!ts) continue;
      project.kpiLog.push({
        id: 'log-' + i,
        timestamp: ts,
        year: Number(row[1]) || 0,
        note: String(row[2] || ''),
        targets: {
          hcw_strengthened: _num(row[3]), patients_reached: _num(row[5]),
          facilities_strengthened: _num(row[7]), population_access: 0
        },
        actuals: {
          hcw_strengthened: _num(row[4]), patients_reached: _num(row[6]),
          facilities_strengthened: _num(row[8]), population_access: 0
        }
      });
    }

    if (section === 'events') {
      if (!evHeaderSeen) { evHeaderSeen = true; continue; }
      const date = String(row[0] || '').trim();
      if (!date) continue;
      project.events.push({
        id:            'ev-' + date + '-' + i,
        date,
        type:          String(row[1] || ''),
        title:         String(row[2] || ''),
        hcw_count:     _num(row[3]) || undefined,
        patient_count: _num(row[4]) || undefined,
        notes:         String(row[5] || '') || undefined
      });
    }

    if (section === 'updates') {
      if (!updHeaderSeen) { updHeaderSeen = true; continue; }
      const date = String(row[0] || '').trim();
      if (!date) continue;
      const tag = String(row[1] || '').trim();
      project.updates.push({
        id:    'upd-' + date + '-' + i,
        date,
        tags:  tag ? [tag] : [],
        title: String(row[2] || ''),
        body:  String(row[3] || '')
      });
    }

    if (section === 'facilities') {
      if (!facHdrSeen) { facHdrSeen = true; continue; }
      var fname = String(row[0] || '').trim();
      if (!fname) continue;
      var fLat = _num(row[2]), fLng = _num(row[3]);
      project.facilities.push({
        id: 'fac-' + i,
        name: fname,
        isHub: String(row[1] || '').toLowerCase() === 'yes',
        lat: fLat !== undefined ? fLat : null,
        lng: fLng !== undefined ? fLng : null,
        catchmentPop: _num(row[4]) || null,
        annualPatients: _num(row[5]) || null,
        notes: String(row[6] || '') || ''
      });
    }
  }

  return project.name ? project : null;
}

function _num(v) {
  const n = Number(v);
  return isNaN(n) || v === '' ? undefined : n;
}

function _date(v) {
  if (!v && v !== 0) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
  var s = String(v).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
  return s;
}

// ── doPost: write project data or org summary ─────────────────────────────────
function doPost(e) {
  try {
    const d  = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (d.type === 'org_summary') {
      _writeOrgSummary(ss, d);
    } else if (d.type === 'full_backup') {
      _storeFullBackup(ss, d);
    } else {
      _writeProject(ss, d);
      _storeRaw(ss, d);       // save JSON snapshot for doGet
    }
    // Record when the cloud last changed so the app's quick "?meta=1" check can
    // detect new data cheaply. ScriptProperties needs no extra permission.
    try { PropertiesService.getScriptProperties().setProperty('lastSync', new Date().toISOString()); } catch(_e) {}
    return _json({ ok: true });
  } catch(err) { return _json({ ok: false, error: err.message }); }
}

// Simple trigger: fires whenever someone edits a cell by hand. Stamps the edit
// time so the app's quick "?meta=1" check can flag manual sheet changes too — not
// just pushes from the app. No installation or extra permission needed (a function
// literally named onEdit auto-runs on this bound spreadsheet, and ScriptProperties
// needs no OAuth scope). Programmatic writes (the app's push) don't fire this — they
// stamp lastSync in doPost instead.
function onEdit(e) {
  try { PropertiesService.getScriptProperties().setProperty('lastEdit', new Date().toISOString()); } catch(_e) {}
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Raw JSON store (hidden sheet) ─────────────────────────────────────────────
function _storeRaw(ss, d) {
  let sheet = ss.getSheetByName('__SURGdash__');
  if (!sheet) {
    sheet = ss.insertSheet('__SURGdash__');
    sheet.getRange(1,1,1,3).setValues([['Project','JSON','Updated']]);
    sheet.hideSheet();
  }
  const vals = sheet.getDataRange().getValues();
  let rowIdx = -1;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] === d.name) { rowIdx = i + 1; break; }
  }
  const newRow = [d.name, JSON.stringify(d), d.syncedAt || new Date().toISOString()];
  if (rowIdx > 0) sheet.getRange(rowIdx, 1, 1, 3).setValues([newRow]);
  else sheet.appendRow(newRow);
}

// ── Full JSON backup sheet ────────────────────────────────────────────────────
function _storeFullBackup(ss, d) {
  var SHEET_NAME = '📋 SURGdash Backup';
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (sheet) { sheet.clearContents(); sheet.clearFormats(); }
  else { sheet = ss.insertSheet(SHEET_NAME); }

  // Split JSON into 49000-char chunks across columns (Sheets cell limit is 50000)
  var json = JSON.stringify(d);
  var CHUNK = 49000;
  var chunks = [];
  for (var i = 0; i < json.length; i += CHUNK) { chunks.push(json.substring(i, i + CHUNK)); }

  var syncedAt = d.syncedAt || new Date().toISOString();
  var projectCount = (d.projects || []).length;

  // Header row
  var hdr = ['Backed Up At', 'Projects', 'Chunks'];
  for (var c = 0; c < chunks.length; c++) hdr.push('JSON Part ' + (c + 1));
  sheet.getRange(1, 1, 1, hdr.length).setValues([hdr])
    .setFontWeight('bold').setBackground('#002F4C').setFontColor('#FFFFFF');

  // Data row
  var dataRow = [syncedAt, projectCount, chunks.length];
  for (var c = 0; c < chunks.length; c++) dataRow.push(chunks[c]);
  sheet.getRange(2, 1, 1, dataRow.length).setValues([dataRow]);

  // Formatting
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 70);
  sheet.setColumnWidth(3, 60);
  for (var c = 4; c <= dataRow.length; c++) {
    sheet.setColumnWidth(c, 400);
    sheet.getRange(2, c).setWrap(false);
  }
  SpreadsheetApp.flush();
}

// ── Organisation summary sheet (first tab) ────────────────────────────────────
function _writeOrgSummary(ss, data) {
  var NAME = '📊 Organisation';

  // Delete sheets for projects no longer in SURGdash (match by shortName or name)
  var PROTECTED = new Set([NAME, '__SURGdash__']);
  var currentNames = new Set((data.projects || []).map(function(p) { return (p.shortName || p.name || '').substring(0, 95); }));
  ss.getSheets().forEach(function(s) {
    var n = s.getName();
    if (!PROTECTED.has(n) && !currentNames.has(n)) {
      if (ss.getSheets().length > 1) ss.deleteSheet(s);
    }
  });

  var sheet = ss.getSheetByName(NAME);
  if (!sheet) { sheet = ss.insertSheet(NAME); ss.setActiveSheet(sheet); ss.moveActiveSheet(1); }
  sheet.clearContents();
  sheet.clearFormats();

  var row = 1;
  var cols = 9;

  function hdr(label, bg) {
    sheet.getRange(row, 1, 1, cols).merge()
      .setValue(label).setFontWeight('bold')
      .setBackground(bg || '#002F4C').setFontColor(bg ? '#002F4C' : '#FFFFFF').setFontSize(10);
    row++;
  }
  function wr(vals, bold, bg) {
    var r = sheet.getRange(row, 1, 1, vals.length);
    r.setValues([vals]);
    if (bold) r.setFontWeight('bold');
    if (bg)   r.setBackground(bg);
    row++;
  }

  // Title
  sheet.getRange(row, 1, 1, cols).merge()
    .setValue('Organisation KPI Summary').setFontSize(16).setFontWeight('bold').setFontColor('#002F4C');
  row++;
  sheet.getRange(row, 1, 1, cols).merge()
    .setValue('Generated: ' + data.generatedAt).setFontColor('#64748b').setFontSize(9);
  row += 2;

  var kpiKeys = ['hcw_strengthened','patients_reached','facilities_strengthened','population_access'];

  // Per-year tables
  var years = [];
  var yearSet = {};
  (data.projects||[]).forEach(function(p) { (p.years||[]).forEach(function(y) { yearSet[y.year] = true; }); });
  years = Object.keys(yearSet).sort();
  years.forEach(function(yr) {
    yr = Number(yr);
    hdr(yr + ' — KPI Results');
    // Row 1: KPI group names merged over Plan + Actual
    sheet.getRange(row, 1, 1, 9).setValues([['Project','HCW','','Patients','','Facilities','','Population','']]).setFontWeight('bold').setBackground('#E8F0F8');
    [[2,3],[4,5],[6,7],[8,9]].forEach(function(p) { sheet.getRange(row, p[0], 1, 2).merge(); });
    row++;
    // Row 2: Plan / Actual sub-headers
    sheet.getRange(row, 1, 1, 9).setValues([['','Plan','Actual','Plan','Actual','Plan','Actual','Plan','Actual']]).setFontWeight('bold');
    [2,4,6,8].forEach(function(c) { sheet.getRange(row, c).setBackground('#FEF3C7'); });
    [3,5,7,9].forEach(function(c) { sheet.getRange(row, c).setBackground('#DCFCE7'); });
    row++;
    var totT = {}, totA = {};
    kpiKeys.forEach(function(k) { totT[k] = 0; totA[k] = 0; });
    var dataStart = row;
    (data.projects||[]).forEach(function(p) {
      var y = (p.years||[]).find(function(y) { return y.year === yr; }) || { targets:{}, actuals:{} };
      wr([p.name].concat(kpiKeys.reduce(function(a, k) { a.push(y.targets[k]||'', y.actuals[k]||''); return a; }, [])));
      kpiKeys.forEach(function(k) { totT[k] += Number(y.targets[k])||0; totA[k] += Number(y.actuals[k])||0; });
    });
    wr(['TOTAL'].concat(kpiKeys.reduce(function(a, k) { a.push(totT[k]||'', totA[k]||''); return a; }, [])), true, '#FEF3C7');
    // Number format for data rows + total
    var numRows = (data.projects||[]).length + 1;
    sheet.getRange(dataStart, 2, numRows, 8).setNumberFormat('#,##0');
    row++;
  });

  // Formatting: even column widths
  sheet.setColumnWidth(1, 160);
  [2,3,4,5,6,7,8,9].forEach(function(c) { sheet.setColumnWidth(c, 100); });
  SpreadsheetApp.flush();
}

// ── Per-project sheet ─────────────────────────────────────────────────────────
function _writeProject(ss, d) {
  var sheetName = (d.shortName || d.name || 'Project').substring(0, 95);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.clearContents();
  sheet.clearFormats();

  var row = 1;
  function hdr(label) {
    sheet.getRange(row, 1, 1, 9).merge()
      .setValue(label).setFontWeight('bold').setBackground('#002F4C').setFontColor('#FFFFFF').setFontSize(10);
    row++;
  }
  function wr(vals, bold) {
    var r = sheet.getRange(row, 1, 1, vals.length);
    r.setValues([vals]);
    if (bold) r.setFontWeight('bold').setBackground('#E8F0F8');
    row++;
  }

  hdr('PROJECT INFO');
  wr(['Name', d.name||''], true);
  wr(['Short Name', d.shortName||'']);
  wr(['Description', d.description||'']);
  wr(['Color', d.color||'']);
  wr(['Icon', d.icon||'']);
  // Write dates as text to prevent Google Sheets auto-conversion
  var dateRange;
  sheet.getRange(row, 1, 1, 2).setValues([['Start Date', d.startDate||'']]);
  sheet.getRange(row, 2).setNumberFormat('@');
  row++;
  sheet.getRange(row, 1, 1, 2).setValues([['End Date', d.endDate||'']]);
  sheet.getRange(row, 2).setNumberFormat('@');
  row++;
  wr(['HCW Multiplier', d.hcwMultiplierEnabled ? 'Yes' : 'No']);
  wr(['HCW Multiplier Rate', d.hcwMultiplierRate !== undefined ? d.hcwMultiplierRate : '']);
  wr(['Quality KPIs', (d.enabledQualityKpis||[]).join(', ')]);
  if (d.lat != null) wr(['Latitude', d.lat]);
  if (d.lng != null) wr(['Longitude', d.lng]);
  if (d.sheetsTabUrl) wr(['Sheets Tab URL', d.sheetsTabUrl]);
  if ((d.locations||[]).length > 0) wr(['Locations', JSON.stringify(d.locations)]);
  wr(['Synced At', d.syncedAt||'']);
  row++;

  hdr('LINKS');
  wr(['GSF Page', d.linkGsf||'']);
  wr(['Working Folder', d.linkFolder||'']);
  (d.linksExtra||[]).forEach(function(l, i) {
    wr(['Extra Link ' + (i + 1), l.url||'', l.label||'']);
  });
  row++;

  hdr('KPIs BY YEAR');
  // Row 1: KPI names merged over Plan + Actual columns
  sheet.getRange(row, 1, 1, 9).setValues([['Year','HCW','','Patients','','Facilities','','Population','']]).setFontWeight('bold').setBackground('#E8F0F8');
  [[2,3],[4,5],[6,7],[8,9]].forEach(function(p) { sheet.getRange(row, p[0], 1, 2).merge(); });
  row++;
  // Row 2: Plan / Actual sub-headers with amber (plan) and green (actual) highlights
  sheet.getRange(row, 1, 1, 9).setValues([['','Plan','Actual','Plan','Actual','Plan','Actual','Plan','Actual']]).setFontWeight('bold');
  [2,4,6,8].forEach(function(c) { sheet.getRange(row, c).setBackground('#FEF3C7'); });
  [3,5,7,9].forEach(function(c) { sheet.getRange(row, c).setBackground('#DCFCE7'); });
  row++;
  (d.years||[]).forEach(function(yr) {
    wr([yr.year,
        yr.targets.hcw_strengthened||'',       yr.actuals.hcw_strengthened||'',
        yr.targets.patients_reached||'',        yr.actuals.patients_reached||'',
        yr.targets.facilities_strengthened||'', yr.actuals.facilities_strengthened||'',
        yr.targets.population_access||'',       yr.actuals.population_access||'']);
  });
  // Apply thousands number format to KPI data area
  if ((d.years||[]).length > 0) {
    var kpiDataStart = row - (d.years||[]).length;
    sheet.getRange(kpiDataStart, 2, (d.years||[]).length, 8).setNumberFormat('#,##0');
  }
  row++;

  var hasComments = (d.years||[]).some(function(yr) {
    return Object.keys(yr.targetComments||{}).length || Object.keys(yr.actualComments||{}).length;
  });
  if (hasComments) {
    hdr('KPI COMMENTS');
    wr(['Year','KPI','Target Note','Actual Note'], true);
    var kpis   = ['hcw_strengthened','patients_reached','facilities_strengthened','population_access'];
    var labels = ['HCW Strengthened','Patients Reached','Facilities Strengthened','Population Access'];
    (d.years||[]).forEach(function(yr) {
      kpis.forEach(function(k, i) {
        var tc = (yr.targetComments||{})[k], ac = (yr.actualComments||{})[k];
        if (tc || ac) wr([yr.year, labels[i], tc||'', ac||'']);
      });
    });
    row++;
  }

  // KPI Change Log
  if ((d.kpiLog||[]).length > 0) {
    hdr('KPI CHANGE LOG');
    wr(['Timestamp','Year','Note','HCW Plan','HCW Actual','Patients Plan','Patients Actual','Facilities Plan','Facilities Actual'], true);
    var logStart = row;
    (d.kpiLog||[]).slice(0, 100).forEach(function(entry) {
      var ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '';
      var t = entry.targets || {};
      var a = entry.actuals || {};
      wr([ts, entry.year||'', entry.note||'',
          t.hcw_strengthened||'', a.hcw_strengthened||'',
          t.patients_reached||'', a.patients_reached||'',
          t.facilities_strengthened||'', a.facilities_strengthened||'']);
    });
    sheet.getRange(logStart, 4, (d.kpiLog||[]).length, 6).setNumberFormat('#,##0');
    row++;
  }

  if ((d.qualityData||[]).length > 0) {
    hdr('QUALITY INDICATORS');
    wr(['KPI ID','Year','Quarter','Target','Actual'], true);
    (d.qualityData||[]).forEach(function(q) {
      var act = q.actual !== undefined && q.actual !== null ? q.actual : (q.value !== null ? q.value : '');
      var tgt = q.target !== undefined && q.target !== null ? q.target : '';
      wr([q.kpiId||'', q.year||'', q.quarter||'', tgt, act]);
    });
    row++;
  }

  hdr('EVENTS (most recent 200)');
  wr(['Date','Type','Title','HCWs','Patients','Notes'], true);
  (d.events||[]).forEach(function(ev) { wr([ev.date||'', ev.type||'', ev.title||'', ev.hcw_count||'', ev.patient_count||'', ev.notes||'']); });
  row++;

  hdr('UPDATES');
  wr(['Date','Tag','Title','Body'], true);
  (d.updates||[]).forEach(function(u) { wr([u.date||'', (u.tags||[]).join(', '), u.title||'', u.body||'']); });
  row++;

  if ((d.facilities||[]).length > 0) {
    hdr('FACILITIES');
    wr(['Name','Hub','Latitude','Longitude','Catchment Pop','Annual Patients','Notes'], true);
    (d.facilities||[]).forEach(function(f) {
      wr([f.name||'', f.isHub ? 'Yes' : '', f.lat!=null?f.lat:'', f.lng!=null?f.lng:'',
          f.catchmentPop||'', f.annualPatients||'', f.notes||'']);
    });
  }

  // Formatting: set even column widths and number formats
  sheet.setColumnWidth(1, 120);
  [2,3,4,5,6,7,8,9].forEach(function(c) { sheet.setColumnWidth(c, 100); });
  SpreadsheetApp.flush();
}`;
    },

    // GET via main-process HTTP (handles redirects automatically)
    async _sheetsGet(targetUrl) {
        const res = await electronAPI.invoke('http-request', { url: targetUrl, method: 'GET' });
        if (res.error) throw new Error(res.error);
        const body = res.body;
        try {
            const r = JSON.parse(body);
            if (r.ok === false) throw new Error(r.error || 'Script error');
            return r;
        } catch (_) {
            const preview = body.slice(0, 300).replace(/\s+/g, ' ').trim();
            const hint = body.includes('<html') || body.includes('<!DOCTYPE')
                ? '\n\nThe script returned an HTML page — this usually means the Apps Script deployment needs to be updated. Open Apps Script → Deploy → Manage deployments → create a New Deployment with the latest code, then paste the new URL here.'
                : '';
            throw new Error(`Invalid response from Apps Script.${hint}\n\nResponse preview: ${preview}`);
        }
    },

    // ── Local JSON backup / restore ───────────────────────────────────────────
    async _localBackup() {
        const ipcRenderer = electronAPI;
        const defaultName = `SURGdash_backup_${new Date().toISOString().slice(0,10)}.json`;
        const filePath = await ipcRenderer.invoke('pick-save-path', defaultName);
        if (!filePath) return;

        App.showMsg('Collecting data…');
        // Flush any pending in-memory registry edits to disk before walking it.
        try { await Projects.saveRegistry(); } catch (_) {}

        const allKeys = await Storage.keys();
        const data = {};
        for (const key of allKeys) {
            data[key] = await Storage.getItem(key);
        }
        // Belt-and-suspenders: also stamp the in-memory registry directly so
        // anything missed by the storage walk (or a key with no reverse mapping)
        // is still captured. The in-memory snapshot is authoritative for
        // project-level fields like impactAssumptions, qualityBaselines, qualityTargets.
        if (Projects.registry && Projects.registry.length) {
            data['surgdash_projects'] = JSON.parse(JSON.stringify(Projects.registry));
        }
        // Quick summary of what's being backed up
        const counts = {
            surgfundProjects: (data['surgdash_projects'] || []).filter(p => p.type === 'generic').length,
            surghubData: !!(data['surghub_data'] && data['surghub_data'].length),
            surghubHistory: !!(data['surghub_history'] && data['surghub_history'].length),
            surghubAmbassadors: !!data['surghub_ambassadors'],
            surghubAnon: !!(data['surghub_anon_users'] && data['surghub_anon_users'].length),
            surghubSocial: !!(data['surghub_social'] && data['surghub_social'].length),
            surghubCompletion: !!(data['surghub_completion'] && data['surghub_completion'].length),
        };
        const backup = { version: 1, exportedAt: new Date().toISOString(), data, _summary: counts };
        const result = await ipcRenderer.invoke('write-file', { filePath, content: JSON.stringify(backup, null, 2) });
        if (result.success) {
            const surghubBits = [];
            if (counts.surghubData)        surghubBits.push('courses');
            if (counts.surghubHistory)     surghubBits.push('audience history');
            if (counts.surghubAmbassadors) surghubBits.push('ambassadors');
            if (counts.surghubAnon)        surghubBits.push('learner demographics');
            if (counts.surghubSocial)      surghubBits.push('social');
            if (counts.surghubCompletion)  surghubBits.push('completion data');
            const surghubSummary = surghubBits.length > 0
                ? `${surghubBits.length} SURGhub dataset${surghubBits.length === 1 ? '' : 's'} (${surghubBits.join(', ')})`
                : 'no SURGhub data found';
            App.showMsg(`Backup saved ✓ — ${counts.surgfundProjects} SURGfund project${counts.surgfundProjects === 1 ? '' : 's'} + ${surghubSummary} + settings`);
        } else {
            alert('Backup failed: ' + result.error);
        }
    },

    async _localRestore() {
        const ipcRenderer = electronAPI;
        const filePath = await ipcRenderer.invoke('pick-json-open-path');
        if (!filePath) return;

        const fileResult = await ipcRenderer.invoke('read-file', filePath);
        if (!fileResult.success) { alert('Could not read file: ' + fileResult.error); return; }

        let backup;
        try { backup = JSON.parse(fileResult.content); } catch (e) { alert('Invalid backup file.'); return; }
        if (!backup.data || !backup.version) { alert('Not a valid SURGdash backup file.'); return; }

        // ── Pre-restore inspection: scan what's in the backup so the user knows
        // exactly what's going to land. Helps catch "but I had X configured!" cases.
        const data = backup.data;
        const projectsInBackup = Array.isArray(data['surgdash_projects']) ? data['surgdash_projects'] : [];
        const genericProjects = projectsInBackup.filter(p => p && p.type === 'generic');
        let projectsWithImpact = 0, projectsWithBaselines = 0, projectsWithTargets = 0, projectsWithSheetsUrl = 0;
        genericProjects.forEach(p => {
            if (p.impactAssumptions && Object.values(p.impactAssumptions).some(v => v !== null && v !== undefined && v !== '')) projectsWithImpact++;
            if (p.qualityBaselines && Object.keys(p.qualityBaselines).length > 0) projectsWithBaselines++;
            if (p.qualityTargets   && Object.keys(p.qualityTargets).length   > 0) projectsWithTargets++;
        });
        const appSettings = data['surgdash_app_settings'] || {};
        if (appSettings.googleSheetsUrl) projectsWithSheetsUrl = 1;
        const summary =
            `Backup contents:\n` +
            `  · Keys: ${Object.keys(data).length}\n` +
            `  · Projects: ${genericProjects.length} generic${projectsInBackup.length !== genericProjects.length ? ` (+${projectsInBackup.length - genericProjects.length} non-generic)` : ''}\n` +
            `  · With impact assumptions: ${projectsWithImpact}\n` +
            `  · With quality baselines: ${projectsWithBaselines}\n` +
            `  · With quality targets:   ${projectsWithTargets}\n` +
            `  · Sheets URL set:         ${projectsWithSheetsUrl ? 'yes' : 'no'}\n`;
        console.log('[restore]', summary);
        console.log('[restore] all keys in backup:', Object.keys(data));

        const confirmed = confirm(
            `Restore backup from ${backup.exportedAt ? new Date(backup.exportedAt).toLocaleString() : 'unknown date'}?\n\n` +
            summary +
            `\nThis will overwrite all current data. This cannot be undone.`
        );
        if (!confirmed) return;

        // Pre-restore backup of current state
        try {
            const allKeys = await Storage.keys();
            const currentData = {};
            for (const key of allKeys) currentData[key] = await Storage.getItem(key);
            const fs = electronAPI.fs, path = electronAPI.path;
            const backupDir = path.join(Storage.DATA_DIR, 'backups');
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            fs.writeFileSync(
                path.join(backupDir, `pre-restore_${stamp}.json`),
                JSON.stringify({ version: 1, timestamp: new Date().toISOString(), data: currentData }, null, 2), 'utf8'
            );
        } catch (e) { console.warn('Pre-restore backup failed:', e); }

        App.showMsg('Restoring…');
        let written = 0;
        for (const [key, value] of Object.entries(backup.data)) {
            await Storage.setItem(key, value);
            written++;
        }
        await Projects.loadRegistry();
        // Verify the registry round-tripped correctly — count what actually landed.
        const inMem = Projects.registry.filter(p => p.type === 'generic');
        const inMemWithImpact = inMem.filter(p => p.impactAssumptions && Object.values(p.impactAssumptions).some(v => v !== null && v !== undefined && v !== '')).length;
        const inMemWithBaselines = inMem.filter(p => p.qualityBaselines && Object.keys(p.qualityBaselines).length > 0).length;
        console.log('[restore] written:', written, 'keys. In-memory: projects=', inMem.length, 'impact=', inMemWithImpact, 'baselines=', inMemWithBaselines);

        alert(
            `Restore complete ✓\n\n` +
            `Wrote ${written} key${written === 1 ? '' : 's'} to disk.\n` +
            `Projects loaded: ${inMem.length} generic\n` +
            `  · With impact assumptions: ${inMemWithImpact}\n` +
            `  · With quality baselines:  ${inMemWithBaselines}\n\n` +
            (inMemWithImpact < projectsWithImpact || inMemWithBaselines < projectsWithBaselines
                ? '⚠ Some economic / baseline data in the backup did NOT round-trip into memory. Open the DevTools console for the full key list.'
                : 'All economic / baseline data was restored.')
        );
        App.renderView();
    },

    // POST via main-process HTTP (handles redirects automatically)
    async _sheetsPost(targetUrl, data) {
        // Apps Script can stall on large payloads — never hang the UI: 90s cap.
        const res = await Promise.race([
            this._sheetsPostRaw(targetUrl, data),
            new Promise((_, rej) => setTimeout(() => rej(new Error('Google Sheets did not respond within 90s — try again (large payloads can need a second push).')), 90000))
        ]);
        return res;
    },

    async _sheetsPostRaw(targetUrl, data) {
        const res = await electronAPI.invoke('http-request', {
            url: targetUrl,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: data
        });
        if (res.error) throw new Error(res.error);
        try {
            const r = JSON.parse(res.body);
            if (!r.ok) throw new Error(r.error || 'Script returned an error');
            return r;
        } catch (_) { return { ok: true }; }
    },

    async _buildProjectPayload(project) {
        const [allTargets, allActuals, allComments, events, updates, kpiLog, qualityData, facilities] = await Promise.all([
            Projects.getTargets(project.id),
            Projects.getActuals(project.id),
            Projects.getKpiComments(project.id),
            Projects.getEvents(project.id),
            Projects.getUpdates(project.id),
            Projects.getKpiLog(project.id),
            Projects.getQualityData(project.id),
            Projects.getFacilities(project.id)
        ]);
        const yearSet = new Set();
        allTargets.forEach(t => yearSet.add(t.year));
        allActuals.forEach(a => yearSet.add(a.year));
        const years = Array.from(yearSet).sort().map(yr => {
            const c = Projects.getKpiCommentsForYear(allComments, yr);
            const actualsEntry = allActuals.find(a => a.year === yr);
            return {
                year: yr,
                targets: Projects.getTargetsForYear(allTargets, yr),
                actuals: Projects.getActualsForYear(allActuals, yr),
                // Per-quarter cumulative actuals for core KPIs: { 1:{kpiId:val}, 2:{…}, … }
                quarters: (actualsEntry && actualsEntry.quarters) ? actualsEntry.quarters : null,
                targetComments: c.targetComments || {},
                actualComments: c.actualComments || {}
            };
        });
        return JSON.stringify({
            // Full metadata for round-trip project creation
            isSample: !!project.isSample,
            name: project.name, shortName: project.shortName || '',
            description: project.description || '',
            color: project.color || '#4389C8', icon: project.icon || 'briefcase',
            startDate: project.startDate || '', endDate: project.endDate || '',
            hcwMultiplierEnabled: project.hcwMultiplierEnabled || false,
            hcwMultiplierRate: project.hcwMultiplierRate !== undefined ? project.hcwMultiplierRate : 10,
            programme: project.programme || '',
            linkGsf: project.linkGsf || '',
            linkFolder: project.linkFolder || '',
            lat: project.lat != null ? project.lat : null,
            lng: project.lng != null ? project.lng : null,
            locations: project.locations || [],
            sheetsTabUrl: project.sheetsTabUrl || '',
            linksExtra: project.linksExtra || [],
            enabledQualityKpis: project.enabledQualityKpis || [],
            qualityData: qualityData || [],
            facilities: facilities || [],
            syncedAt: new Date().toISOString(), years,
            // Full objects including IDs for lossless round-trip
            events:  events.slice(0, 500).map(e => ({ ...e })),
            updates: updates.map(u => ({ ...u })),
            kpiLog:  kpiLog.slice(0, 100).map(e => ({ ...e })),
            _truncated: {
                events: events.length > 500 ? events.length : false,
                kpiLog: kpiLog.length > 100 ? kpiLog.length : false
            }
        });
    },

    async _saveEditPassword() {
        const pw = (document.getElementById('edit-pw-input')?.value || '');
        const confirm = (document.getElementById('edit-pw-confirm')?.value || '');
        if (!pw) { App.showMsg('Please enter a password.', true); return; }
        if (pw.length < 4) { App.showMsg('Password must be at least 4 characters.', true); return; }
        if (pw !== confirm) { App.showMsg('Passwords do not match.', true); return; }
        await App.setEditPassword(pw);
        App.showMsg('Edit password saved.');
        App.renderView();
    },

    async _removeEditPassword() {
        if (!confirm('Remove the edit password? The app will be fully editable by anyone.')) return;
        await App.setEditPassword(null);
        App.showMsg('Edit password removed.');
        App.renderView();
    },

    async _saveReportPassword() {
        const pw = (document.getElementById('report-pw-input')?.value || '');
        const confirmPw = (document.getElementById('report-pw-confirm')?.value || '');
        if (!pw) { App.showMsg('Please enter a password.', true); return; }
        if (pw.length < 4) { App.showMsg('Password must be at least 4 characters.', true); return; }
        if (pw !== confirmPw) { App.showMsg('Passwords do not match.', true); return; }
        if (App._editPasswordHash && pw === document.getElementById('edit-pw-input')?.value) { /* harmless overlap */ }
        await App.setReportPassword(pw);
        App.showMsg('Provider-reporting password saved.');
        App.renderView();
    },

    async _removeReportPassword() {
        if (!confirm('Remove the provider-reporting password? That teammate will no longer be able to unlock reporting access.')) return;
        await App.setReportPassword(null);
        App.showMsg('Provider-reporting password removed.');
        App.renderView();
    },

    async _saveViewerSheetsUrlAndPull() {
        const url = (document.getElementById('viewer-sheets-url')?.value || '').trim();
        const statusEl = document.getElementById('viewer-load-status');
        const btn = document.getElementById('viewer-load-btn');
        if (!url) {
            if (statusEl) statusEl.textContent = '⚠ Please paste the Apps Script URL first.';
            return;
        }
        if (!url.includes('script.google.com')) {
            if (statusEl) statusEl.textContent = '⚠ That doesn\'t look like an Apps Script URL. Check you\'re using the correct link.';
            return;
        }
        // Persist the per-device auto-pull choice from the onboarding toggle (defaults
        // ON for viewers; admins uncheck it). Read it now, BEFORE the card below is
        // replaced by the progress UI. Stored device-locally, never pushed to Sheets.
        const _autoPullEl = document.getElementById('viewer-autopull-toggle');
        const _autoPullOn = _autoPullEl ? _autoPullEl.checked : true;
        await Storage.setItem('surgdash_autopull_enabled', _autoPullOn, { internal: true });
        if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }

        // Replace the welcome card with a full progress UI
        const wrapper = btn ? btn.closest('.bg-white.rounded-xl') : null;
        if (wrapper) {
            wrapper.innerHTML = `
                <div class="py-6 px-4 text-center">
                    <div class="w-12 h-12 border-4 border-gsf-boston border-t-transparent rounded-full mx-auto mb-4" style="animation:spin 0.8s linear infinite"></div>
                    <h2 class="text-lg font-bold text-gsf-prussian mb-2">Loading Project Data</h2>
                    <p id="viewer-pull-progress" class="text-sm text-slate-500 mb-4">Connecting to Google Sheets…</p>
                    <div class="w-64 mx-auto bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div id="viewer-pull-bar" class="h-full bg-gsf-boston rounded-full transition-all duration-300" style="width:10%"></div>
                    </div>
                </div>`;
        }

        await Projects.saveAppSettings({ googleSheetsUrl: url });

        // Run the pull with progress callback
        try {
            const result = await this._sheetsGet(url);
            const remoteProjects = result.projects || [];
            const progressEl = document.getElementById('viewer-pull-progress');
            const barEl = document.getElementById('viewer-pull-bar');
            const total = remoteProjects.length + (result.surghubStorage ? 1 : 0);

            if (total === 0) {
                if (progressEl) progressEl.textContent = 'No data found in Google Sheets. Check with your administrator.';
                if (barEl) barEl.style.width = '100%';
                return;
            }

            let created = 0, updated = 0, step = 0;

            for (let i = 0; i < remoteProjects.length; i++) {
                const remote = remoteProjects[i];
                // Skip the demo/sample example project (see _pullFromSheets).
                if (remote.isSample || remote.name === 'Sample SURGfund Project') continue;
                step++;
                const pct = Math.round((step / total) * 90) + 10;
                if (progressEl) progressEl.textContent = `Syncing project ${i + 1}/${remoteProjects.length}: ${remote.shortName || remote.name}…`;
                if (barEl) barEl.style.width = pct + '%';

                // Find or create local project
                let local = Projects.registry.find(p => p.type === 'generic' && p.name === remote.name);
                if (!local) {
                    await Projects.createProject({
                        name:        remote.name,
                        description: remote.description || '',
                        color:       remote.color || '#4389C8',
                        icon:        remote.icon  || 'briefcase'
                    });
                    local = Projects.registry.find(p => p.name === remote.name && p.type === 'generic');
                    if (local) {
                        await Projects.updateProject(local.id, {
                            shortName:           remote.shortName   || null,
                            startDate:           remote.startDate   || '',
                            endDate:             remote.endDate     || '',
                            hcwMultiplierEnabled: remote.hcwMultiplierEnabled || false,
                            hcwMultiplierRate:    remote.hcwMultiplierRate !== undefined ? remote.hcwMultiplierRate : 10,
                            programme:           remote.programme  || '',
                            linkGsf:             remote.linkGsf    || '',
                            linkFolder:          remote.linkFolder  || '',
                            linksExtra:          remote.linksExtra  || [],
                            enabledQualityKpis:  remote.enabledQualityKpis || [],
                            lat:                 remote.lat != null ? remote.lat : null,
                            lng:                 remote.lng != null ? remote.lng : null,
                            locations:           remote.locations   || [],
                            sheetsTabUrl:        remote.sheetsTabUrl || ''
                        });
                    }
                    created++;
                } else {
                    await Projects.updateProject(local.id, {
                        description:          remote.description || local.description,
                        shortName:            remote.shortName   !== undefined ? (remote.shortName || null) : (local.shortName || null),
                        color:                remote.color       || local.color,
                        icon:                 remote.icon        || local.icon,
                        startDate:            remote.startDate   !== undefined ? remote.startDate : (local.startDate || ''),
                        endDate:              remote.endDate     !== undefined ? remote.endDate   : (local.endDate   || ''),
                        hcwMultiplierEnabled: remote.hcwMultiplierEnabled !== undefined ? remote.hcwMultiplierEnabled : (local.hcwMultiplierEnabled || false),
                        hcwMultiplierRate:    remote.hcwMultiplierRate    !== undefined ? remote.hcwMultiplierRate    : (local.hcwMultiplierRate    !== undefined ? local.hcwMultiplierRate : 10),
                        programme:            remote.programme   !== undefined ? remote.programme  : (local.programme  || ''),
                        linkGsf:              remote.linkGsf     !== undefined ? remote.linkGsf    : (local.linkGsf    || ''),
                        linkFolder:           remote.linkFolder  !== undefined ? remote.linkFolder  : (local.linkFolder  || ''),
                        linksExtra:           remote.linksExtra  !== undefined ? remote.linksExtra  : (local.linksExtra  || []),
                        enabledQualityKpis:   remote.enabledQualityKpis !== undefined ? remote.enabledQualityKpis : (local.enabledQualityKpis || []),
                        lat:                  remote.lat != null ? remote.lat : (local.lat != null ? local.lat : null),
                        lng:                  remote.lng != null ? remote.lng : (local.lng != null ? local.lng : null),
                        locations:            remote.locations !== undefined ? remote.locations : (local.locations || []),
                        sheetsTabUrl:         remote.sheetsTabUrl !== undefined ? remote.sheetsTabUrl : (local.sheetsTabUrl || '')
                    });
                    updated++;
                }
                if (!local) continue;

                // Fully replace KPI data (all years)
                const allTargets = (remote.years || []).map(yr => ({ year: yr.year, kpis: yr.targets || {} }));
                const allActuals = (remote.years || []).map(yr => { const e = { year: yr.year, kpis: yr.actuals || {} }; if (yr.quarters && Object.keys(yr.quarters).length) e.quarters = yr.quarters; return e; });
                await Storage.setItem(`surgdash_targets_${local.id}`, allTargets);
                await Storage.setItem(`surgdash_actuals_${local.id}`, allActuals);

                const allComments = (remote.years || [])
                    .filter(yr => Object.keys(yr.targetComments || {}).length || Object.keys(yr.actualComments || {}).length)
                    .map(yr => ({ year: yr.year, targetComments: yr.targetComments || {}, actualComments: yr.actualComments || {} }));
                await Storage.setItem(`surgdash_kpi_comments_${local.id}`, allComments);

                // Normalise date fields — Google Sheets auto-converts date-shaped
                // strings to Date cells, which round-trip back as verbose locale
                // strings (e.g. "Sat Feb 28 2026 00:00:00 GMT+0100 (...)"). The HTML
                // date input can't parse those, so we coerce them back to ISO here.
                await Projects.replaceEvents(local.id,  this._normaliseDates(remote.events  || []));
                await Projects.replaceUpdates(local.id, this._normaliseDates(remote.updates || []));
                if (remote.kpiLog && remote.kpiLog.length > 0) {
                    await Storage.setItem(`surgdash_kpi_log_${local.id}`, remote.kpiLog);
                }
                if (remote.qualityData && remote.qualityData.length > 0) {
                    await Storage.setItem(`surgdash_quality_data_${local.id}`, remote.qualityData);
                }
                if (remote.facilities && remote.facilities.length > 0) {
                    await Storage.setItem(`surgdash_facilities_${local.id}`, remote.facilities);
                }
            }

            // Restore SURGhub data if present
            let surghubRestored = false;
            if (result.surghubStorage && typeof result.surghubStorage === 'object') {
                if (progressEl) progressEl.textContent = 'Syncing SURGhub data…';
                if (barEl) barEl.style.width = '95%';
                // Same guard as the standard pull path — never silently overwrite
                // unsynced local SURGhub imports with a (potentially older) Sheets copy.
                const hasLocalDirty = await Storage.getItem('surghub_unsynced_local');
                let proceedSurghub = !hasLocalDirty;
                if (hasLocalDirty) {
                    const localAt = await Storage.getItem('surghub_local_mtime');
                    proceedSurghub = confirm(`Your local SURGhub data has unsynced changes (imported ${localAt || 'recently'}).\n\nRestoring will OVERWRITE it with the Google Sheets copy, which may be older.\n\nOK = overwrite. Cancel = keep local (recommended — Sync to Sheets first).`);
                }
                if (proceedSurghub) {
                    const _SURGHUB_INTERNAL = new Set(['surghub_local_mtime', 'surghub_unsynced_local', 'surghub_last_synced']);
                    for (const [key, value] of Object.entries(result.surghubStorage)) {
                        if (_SURGHUB_INTERNAL.has(key)) continue;
                        if (key.startsWith('surghub_') && value != null) {
                            await Storage.setItem(key, value);
                        }
                    }
                } else {
                    console.log('[SURGhub] Restore-pull skipped overwrite — local has unsynced changes.');
                }
                const stored = await Storage.getItem('surghub_data');
                if (stored) App.data = stored;
                const hist = await Storage.getItem('surghub_history');
                if (hist) App.userHistory = hist;
                const amb = await Storage.getItem('surghub_ambassadors');
                if (amb) App.ambassadorData = amb;
                const users = await Storage.getItem('surghub_unique_users');
                if (users) App.platformUniqueUsers = parseInt(users);
                const anon = await Storage.getItem('surghub_anon_users');
                if (anon) App._rawAnonymizedUsers = anon;
                App._anonLoadPromise = null;
                // Completion (~37MB) isn't reloaded into memory on a pull — invalidate its
                // lazy cache so the next reader re-reads the just-pulled value, not a stale one.
                App._rawCompletion = null; App._completionLoadPromise = null;
                const emailDemo = await Storage.getItem('surghub_email_demo');
                if (emailDemo) App._emailDemoMap = emailDemo;
                surghubRestored = true;
            }

            // Internal write — must not re-trigger auto-sync (would create a loop)
            await Projects.saveAppSettings({ googleSheetsLastPull: new Date().toISOString() }, { internal: true });
            // Local data now matches the cloud — clear the dirty flag
            if (App.markClean) App.markClean();

            if (progressEl) progressEl.textContent = 'Done! Loading dashboard…';
            if (barEl) barEl.style.width = '100%';

            const parts = [];
            if (created) parts.push(`${created} project${created !== 1 ? 's' : ''} loaded`);
            if (updated) parts.push(`${updated} updated`);
            if (surghubRestored) parts.push('SURGhub data synced');
            App.showMsg(`Pull complete: ${parts.join(', ')} ✓`);

            // Reload registry, update date, and re-render everything including sidebar
            await Projects.loadRegistry();
            const dates = App.getAvailableDates();
            if (dates.length > 0) App.selectedDate = dates[dates.length - 1];
            // Force sidebar rebuild (skip-cache)
            App._lastSidebarProject = null;
            App.renderView();
            // Honour the onboarding auto-pull choice for this session too (next launch
            // reads the persisted flag regardless).
            if (_autoPullOn) App._startAutoPull();
        } catch (err) {
            console.error('Viewer pull error:', err);
            const progressEl = document.getElementById('viewer-pull-progress');
            if (progressEl) progressEl.innerHTML = `<span class="text-red-500">Pull failed: ${App.escapeHtml(err.message)}</span>`;
            App.showMsg('Pull failed: ' + err.message, true);
        }
    },

    async _saveOrgSheetsUrl() {
        const url = (document.getElementById('org-sheets-url')?.value || '').trim();
        await Projects.saveAppSettings({ googleSheetsUrl: url || null });
        App.showMsg(url ? 'Apps Script URL saved.' : 'URL cleared.');
        App.renderView();
    },

    async _saveOrgSheetsViewUrl() {
        const url = (document.getElementById('org-sheets-view-url')?.value || '').trim();
        await Projects.saveAppSettings({ googleSheetsViewUrl: url || null });
        App.showMsg(url ? 'Spreadsheet URL saved.' : 'URL cleared.');
        App.renderView();
    },

    // Per-device auto-pull opt-in. OFF (manual) is the safe default; ON is for
    // read-only viewer screens. Starts/stops the auto-pull timer immediately.
    async _toggleAutoPull(on) {
        await Storage.setItem('surgdash_autopull_enabled', !!on, { internal: true });
        if (on) {
            App._startAutoPull();
            App.showMsg('Auto-pull ON for this device — it will refresh from the cloud on launch and every 5 min.');
        } else {
            if (App._autoPullInterval) { clearInterval(App._autoPullInterval); App._autoPullInterval = null; }
            App.showMsg('Auto-pull OFF — this device updates only when you click Pull. Safe for editing.');
        }
        App.renderView();
    },

    // Auto-sync was removed — it caused loops, race conditions, and silent data
    // loss when per-project sheets fell out of sync with the backup blob.
    // The model is now: edit locally → orange banner → click manual Sync.
    // The close-confirmation dialog also prompts the user to sync on quit.

    // Global sync progress overlay — visible from any view (incl. during quit-time sync).
    _showSyncOverlay() {
        if (document.getElementById('sync-progress-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'sync-progress-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);backdrop-filter:blur(2px);z-index:10000;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#fff;border-radius:16px;padding:28px 36px;width:420px;max-width:92vw;box-shadow:0 12px 48px rgba(0,0,0,0.25);text-align:center;">
                <div style="width:48px;height:48px;border:4px solid #4389C8;border-top-color:transparent;border-radius:50%;margin:0 auto 18px;animation:spin 0.8s linear infinite;"></div>
                <h3 style="font-size:16px;font-weight:700;color:#002F4C;margin:0 0 6px;">Syncing to Google Sheets</h3>
                <p id="sync-progress-text" style="font-size:13px;color:#64748b;margin:0 0 14px;line-height:1.5;">Preparing…</p>
                <div style="width:100%;height:6px;background:#f1f5f9;border-radius:6px;overflow:hidden;">
                    <div id="sync-progress-bar" style="width:5%;height:100%;background:linear-gradient(90deg,#4389C8,#002F4C);border-radius:6px;transition:width 0.3s ease;"></div>
                </div>
                <p style="font-size:11px;color:#94a3b8;margin:14px 0 0;">Please don't close the app until this finishes.</p>
            </div>`;
        document.body.appendChild(overlay);
    },
    _updateSyncOverlay(text, pct) {
        const t = document.getElementById('sync-progress-text');
        const b = document.getElementById('sync-progress-bar');
        if (t) t.textContent = text;
        if (b && typeof pct === 'number') b.style.width = Math.min(100, Math.max(0, pct)) + '%';
    },
    _hideSyncOverlay() {
        const o = document.getElementById('sync-progress-overlay');
        if (o) o.remove();
    },

    async _syncToSheets() {
        const appSettings = await Projects.getAppSettings();
        // Allow live edit in the URL field to take precedence
        const url = (document.getElementById('org-sheets-url')?.value || '').trim()
                 || appSettings.googleSheetsUrl || '';
        if (!url) {
            alert('Please enter the Google Apps Script Web App URL first, then click Save URL.'); return;
        }

        // Include the sample project too — it gives the recipient a fully-populated
        // example tab so they can see how a complete project sheet looks. The sample
        // is flagged (isSample) so the Apps Script excludes it from org-wide totals.
        const projects = Projects.registry.filter(p => p.type === 'generic');
        const totalSteps = projects.length + 2; // + org summary + full backup

        const btn = document.getElementById('sheets-sync-btn');
        const setBtn = (label, disabled = true) => {
            if (!btn) return;
            btn.disabled = disabled;
            btn.innerHTML = label;
            if (window.lucide) lucide.createIcons();
        };
        setBtn('<span style="display:inline-block;animation:spin 1s linear infinite">↻</span> Syncing…');
        this._showSyncOverlay();
        this._updateSyncOverlay('Preparing…', 2);

        const errors    = [];
        const syncedAt  = new Date().toISOString();
        const allPayloads = [];

        // Push each project
        for (let i = 0; i < projects.length; i++) {
            const p = projects[i];
            const stepLabel = `${p.shortName || p.name}`;
            setBtn(`<span style="display:inline-block;animation:spin 1s linear infinite">↻</span> ${i + 1}/${totalSteps}: ${App.escapeHtml(stepLabel)}…`);
            this._updateSyncOverlay(`Syncing project ${i + 1}/${projects.length}: ${stepLabel}`, ((i + 1) / totalSteps) * 100);
            try {
                const payloadStr = await this._buildProjectPayload(p);
                await this._sheetsPost(url, payloadStr);
                allPayloads.push(JSON.parse(payloadStr));
            } catch (err) {
                console.error(`Sheets sync error (${p.name}):`, err);
                errors.push(`${p.name}: ${err.message}`);
            }
        }

        // Push org summary
        const orgStep = projects.length + 1;
        setBtn(`<span style="display:inline-block;animation:spin 1s linear infinite">↻</span> ${orgStep}/${totalSteps}: Organisation summary…`);
        this._updateSyncOverlay('Pushing organisation summary…', (orgStep / totalSteps) * 100);
        try {
            const orgPayload = JSON.stringify({
                type: 'org_summary',
                generatedAt: new Date().toLocaleString(),
                projects: allPayloads
            });
            await this._sheetsPost(url, orgPayload);
        } catch (err) {
            console.error('Sheets org summary error:', err);
            errors.push(`Organisation summary: ${err.message}`);
        }

        // Push full JSON backup (last step) — this is the biggest step (includes SURGhub data)
        const backupStep = projects.length + 2;
        setBtn(`<span style="display:inline-block;animation:spin 1s linear infinite">↻</span> ${backupStep}/${totalSteps}: Full backup…`);
        this._updateSyncOverlay('Pushing full backup (SURGhub data)…', (backupStep / totalSteps) * 95);
        try {
            const appSettings = await Projects.getAppSettings();
            const customQualityKpis = (await Storage.getItem('surgdash_custom_quality_kpis')) || [];
            // Include raw Storage dump for lossless round-trip (all data including SURGhub)
            const allKeys = await Storage.keys();
            const rawStorage = {};
            const surghubStorage = {};
            // Internal sync-state keys — must stay LOCAL so they can guard
            // pull/push correctly. Shipping them to Sheets would clobber the
            // dirty-flag on the next pull.
            const SURGHUB_INTERNAL_KEYS = new Set(['surghub_local_mtime', 'surghub_unsynced_local', 'surghub_last_synced']);
            // API credentials never leave this machine — they are re-entered
            // manually after a restore instead of living in the spreadsheet.
            const SECRET_KEYS = new Set(['anthropic_api_key', 'learnworlds_api_token', 'learnworlds_client_id']);
            for (const key of allKeys) {
                if (SURGHUB_INTERNAL_KEYS.has(key)) continue;
                if (SECRET_KEYS.has(key)) continue;
                if (key.startsWith('surghub_')) {
                    surghubStorage[key] = await Storage.getItem(key);
                } else {
                    rawStorage[key] = await Storage.getItem(key);
                }
            }
            // SURGhub data is far too large for one Apps Script POST (~75MB
            // measured — over the ~50MB request cap): stream it to its own
            // sheet in ~4.4MB parts, then push a slim backup without it.
            const surghubJson = JSON.stringify(surghubStorage);
            const PART_CHARS = 49000 * 90; // 90 sheet rows per POST
            const totalParts = Math.max(1, Math.ceil(surghubJson.length / PART_CHARS));
            let chunked = true;
            try {
                for (let p = 0; p < totalParts; p++) {
                    this._updateSyncOverlay(`Pushing SURGhub data (part ${p + 1}/${totalParts})…`, ((backupStep - 1 + ((p + 1) / (totalParts + 1))) / totalSteps) * 95);
                    await this._sheetsPost(url, JSON.stringify({
                        type: 'surghub_chunk',
                        part: p + 1,
                        totalParts,
                        syncedAt,
                        data: surghubJson.slice(p * PART_CHARS, (p + 1) * PART_CHARS)
                    }));
                }
            } catch (err) {
                // Apps Script deployment predates the chunk route — fall back to
                // the legacy single POST (only viable for small datasets).
                console.warn('[Sheets] Chunked SURGhub push failed, falling back to embedded backup:', err.message);
                chunked = false;
            }
            this._updateSyncOverlay('Pushing backup…', (backupStep / totalSteps) * 95);
            const backupPayload = {
                type: 'full_backup',
                syncedAt,
                appSettings,
                customQualityKpis,
                projects: allPayloads,
                rawStorage
            };
            if (!chunked) backupPayload.surghubStorage = surghubStorage;
            await this._sheetsPost(url, JSON.stringify(backupPayload));
            if (!chunked) throw new Error('SURGhub data could not be pushed in parts — update the Google Apps Script to the latest version from scripts/google-apps-script.js and redeploy, then sync again.');
            // Successful push — cloud now matches local SURGhub state, so it's
            // safe for future pulls to apply the Sheets copy again.
            await Storage.setItem('surghub_unsynced_local', false);
            await Storage.setItem('surghub_last_synced', syncedAt);
            console.log('[SURGhub] Cloud push succeeded at', syncedAt, '— pull-overwrite block lifted.');
        } catch (err) {
            console.error('Sheets full backup error:', err);
            errors.push(`Full backup: ${err.message}`);
        }

        // Save URL and timestamp centrally
        this._updateSyncOverlay('Finalising…', 99);
        // Internal write — we just pushed everything, don't re-trigger auto-sync
        await Projects.saveAppSettings({ googleSheetsUrl: url, googleSheetsLastSync: syncedAt }, { internal: true });
        // The server stamps its OWN lastSync (its clock, at the END of this multi-part
        // upload). Adopt that as our last-synced marker — otherwise the freshness check
        // reads our just-finished push as "new data" (our local syncedAt is the push
        // START, minutes behind the server's end-of-upload stamp + any clock skew).
        try {
            const _meta = await App._fetchCloudMeta();
            if (_meta && _meta.ok && _meta.lastModified) {
                await Projects.saveAppSettings({ googleSheetsLastSync: _meta.lastModified }, { internal: true });
            }
        } catch (_) { /* best-effort — falls back to local syncedAt */ }
        this._updateSyncOverlay('Done ✓', 100);
        // Brief pause so the user sees 100% before the overlay disappears
        await new Promise(r => setTimeout(r, 350));
        this._hideSyncOverlay();

        // Check for truncation warnings
        const truncatedNames = allPayloads
            .filter(p => p._truncated && (p._truncated.events || p._truncated.kpiLog))
            .map(p => p.name || p.shortName);

        if (errors.length === 0) {
            let msg = `Synced ${projects.length} project${projects.length !== 1 ? 's' : ''} + org summary ✓`;
            if (truncatedNames.length > 0) {
                msg += `\nNote: events/log trimmed for Sheets tab: ${truncatedNames.join(', ')}. Full data is in the backup.`;
            }
            App.showMsg(msg);
        } else {
            alert(`Sync completed with ${errors.length} error${errors.length !== 1 ? 's' : ''}:\n\n${errors.join('\n')}`);
        }
        setBtn('<i data-lucide="sheet" width="14"></i> Sync to Sheets', false);
        App.renderView();
        // Clear the in-memory dirty flag ONLY on a fully clean sync — if any push
        // failed (project/org/SURGhub backup), stay dirty so the data isn't falsely
        // recorded as "synced" and then overwritten by the next pull.
        if (App.markClean && errors.length === 0) App.markClean();
    },

    // True if any of a project's local data files were modified after baselineMs
    // (i.e. edited locally since we last reconciled with the cloud). Covers every
    // file class the pull would overwrite: targets/actuals/events/updates/facilities/
    // budget/kpi (projects/{id}/), kpi comments + log + quarter comments
    // (projects/{comments_|log_|quarter_comments_}{id}/), and quality data (other/).
    _projectLocallyDirty(projectId, baselineMs) {
        const fs = electronAPI.fs, path = electronAPI.path;
        const dirs = [
            path.join(Storage.DATA_DIR, 'projects', projectId),
            path.join(Storage.DATA_DIR, 'projects', 'comments_' + projectId),
            path.join(Storage.DATA_DIR, 'projects', 'log_' + projectId),
            path.join(Storage.DATA_DIR, 'projects', 'quarter_comments_' + projectId),
        ];
        for (const dir of dirs) {
            try {
                if (!fs.existsSync(dir)) continue;
                for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
                    if (!f.name || !f.name.endsWith('.json')) continue;
                    try { if (fs.statSync(path.join(dir, f.name)).mtimeMs > baselineMs) return true; } catch (_) {}
                }
            } catch (_) {}
        }
        try {
            const qf = path.join(Storage.DATA_DIR, 'other', 'surgdash_quality_data_' + projectId + '.json');
            if (fs.existsSync(qf) && fs.statSync(qf).mtimeMs > baselineMs) return true;
        } catch (_) {}
        return false;
    },

    async _pullFromSheets(silent = false) {
        const appSettings = await Projects.getAppSettings();
        const url = (document.getElementById('org-sheets-url')?.value || '').trim()
                 || appSettings.googleSheetsUrl || '';
        if (!url) {
            if (!silent) alert('No Google Sheets URL configured. Enter and save one first.');
            return;
        }

        const btn = document.getElementById('sheets-pull-btn');
        const setBtn = (label, disabled = true) => {
            if (!btn) return;
            btn.disabled = disabled;
            btn.innerHTML = label;
            if (window.lucide) lucide.createIcons();
        };
        setBtn('<span style="display:inline-block;animation:spin 1s linear infinite">↻</span> Pulling…');

        // Show status indicator for silent (startup) pulls
        const statusEl = document.getElementById('status-indicator');
        const origStatus = statusEl ? statusEl.innerHTML : '';
        if (silent && statusEl) {
            statusEl.innerHTML = '<div class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></div> <span class="text-amber-400">Syncing from cloud…</span>';
        }
        // Show a prominent progress banner during silent (startup) pulls
        let pullBanner = null;
        if (silent) {
            const mainBody = document.getElementById('view-body');
            if (mainBody) {
                pullBanner = document.createElement('div');
                pullBanner.id = 'pull-progress-banner';
                pullBanner.className = 'flex items-center gap-3 px-5 py-3 bg-gsf-boston/10 border-b border-gsf-boston/20 text-sm text-gsf-prussian font-medium fade-in';
                pullBanner.innerHTML = '<div class="w-4 h-4 border-2 border-gsf-boston border-t-transparent rounded-full" style="animation:spin 0.8s linear infinite"></div> Syncing data from Google Sheets…';
                mainBody.parentElement.insertBefore(pullBanner, mainBody);
            }
        }

        // ── Conflict detection: warn if local data changed since last push ──
        try {
            const lastSync = appSettings.googleSheetsLastSync;
            if (lastSync) {
                const lastSyncMs = new Date(lastSync).getTime();
                const fs = electronAPI.fs, path = electronAPI.path;
                const projDir = path.join(Storage.DATA_DIR, 'projects');
                let locallyModified = false;
                if (fs.existsSync(projDir)) {
                    const dirs = fs.readdirSync(projDir, { withFileTypes: true });
                    for (const d of dirs) {
                        if (!d.isDirectory) continue;
                        const subDir = path.join(projDir, d.name);
                        const files = fs.readdirSync(subDir, { withFileTypes: true });
                        for (const f of files) {
                            if (!f.isFile || !f.name.endsWith('.json')) continue;
                            try {
                                const stat = fs.statSync(path.join(subDir, f.name));
                                if (stat.mtimeMs > lastSyncMs) { locallyModified = true; break; }
                            } catch (_) {}
                        }
                        if (locallyModified) break;
                    }
                }
                if (locallyModified && !silent && App.editUnlocked) {
                    const proceed = confirm('Local data has been modified since the last sync to Sheets.\n\nPulling will overwrite these changes. Continue?');
                    if (!proceed) {
                        setBtn('<i data-lucide="download" width="14"></i> Pull from Sheets', false);
                        return;
                    }
                }
            }
        } catch (e) { console.warn('Conflict detection check failed:', e); }

        try {
            const result = await this._sheetsGet(url);
            const remoteProjects = result.projects || [];

            if (remoteProjects.length === 0 && !result.surghubStorage) {
                if (!silent) alert('No project data found in Google Sheets.\n\nRun "Sync to Sheets" first to populate the sheet, then pull back.');
                setBtn('<i data-lucide="download" width="14"></i> Pull from Sheets', false);
                if (statusEl) statusEl.innerHTML = origStatus;
                if (pullBanner) pullBanner.remove();
                return;
            }

            // Projects to delete locally (exist locally but not in Sheets)
            const remoteNames  = new Set(remoteProjects.map(p => p.name));
            const localGeneric = Projects.registry.filter(p => p.type === 'generic' && !p.isSample);
            const toDelete     = localGeneric.filter(p => !remoteNames.has(p.name));

            // Confirm deletions (skip during silent/startup pulls)
            if (toDelete.length > 0 && !silent) {
                const names = toDelete.map(p => `• ${p.name}`).join('\n');
                const ok = confirm(
                    `Full mirror pull will permanently delete ${toDelete.length} local project${toDelete.length !== 1 ? 's' : ''} not found in Google Sheets:\n\n${names}\n\nThis cannot be undone. Continue?`
                );
                if (!ok) { setBtn('<i data-lucide="download" width="14"></i> Pull from Sheets', false); if (statusEl) statusEl.innerHTML = origStatus; return; }
            }
            // Silent pulls never delete local projects — only add/update
            if (silent) toDelete.length = 0;

            // ── Pre-pull backup of all local generic project data ──
            try {
                const fs = electronAPI.fs, path = electronAPI.path;
                const backupDir = path.join(Storage.DATA_DIR, 'backups');
                if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
                const snapshot = {};
                for (const p of localGeneric) {
                    snapshot[p.id] = {
                        name: p.name,
                        targets:     await Projects.getTargets(p.id),
                        actuals:     await Projects.getActuals(p.id),
                        events:      await Projects.getEvents(p.id),
                        updates:     await Projects.getUpdates(p.id),
                        // Capture the rest of what a pull overwrites so a pre-pull
                        // restore rolls back the WHOLE project, not a partial subset.
                        comments:    await Storage.getItem(`surgdash_kpi_comments_${p.id}`),
                        kpiLog:      await Storage.getItem(`surgdash_kpi_log_${p.id}`),
                        qualityData: await Storage.getItem(`surgdash_quality_data_${p.id}`),
                        facilities:  await Storage.getItem(`surgdash_facilities_${p.id}`),
                    };
                }
                const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                fs.writeFileSync(
                    path.join(backupDir, `pre-pull_${stamp}.json`),
                    JSON.stringify({ version: 1, timestamp: new Date().toISOString(), projects: snapshot }, null, 2), 'utf8'
                );
                // Rotate — keep the 20 most recent pre-pull snapshots (filenames carry
                // a sortable ISO-ish stamp, so a lexicographic sort is chronological).
                try {
                    const snaps = fs.readdirSync(backupDir, { withFileTypes: true })
                        .filter(e => e.name && /^pre-pull_.*\.json$/.test(e.name)).map(e => e.name).sort();
                    for (const old of snaps.slice(0, Math.max(0, snaps.length - 20))) {
                        try { fs.unlinkSync(path.join(backupDir, old)); } catch (_) {}
                    }
                } catch (_) {}
            } catch (e) { console.warn('Pre-pull backup failed:', e); }

            let created = 0, updated = 0;
            const skippedDirty = [];
            // On SILENT (launch / 5-min) pulls, never overwrite a project the user
            // edited locally but hasn't pushed yet — mirror the SURGhub unsynced guard.
            // Baseline = the last time local & cloud were reconciled (last push OR last
            // pull) + 15s slack; a project with a newer file is locally-ahead → keep it.
            // Manual pulls keep their explicit overwrite-confirm above instead.
            const _lastSyncMs = appSettings.googleSheetsLastSync ? new Date(appSettings.googleSheetsLastSync).getTime() : 0;
            const _lastPullMs = appSettings.googleSheetsLastPull ? new Date(appSettings.googleSheetsLastPull).getTime() : 0;
            const dirtyBaselineMs = Math.max(_lastSyncMs, _lastPullMs) + 15000;

            for (let i = 0; i < remoteProjects.length; i++) {
                const remote = remoteProjects[i];
                // Skip the demo/sample project — it exists in Sheets purely as a populated
                // example. The app manages its own sample locally; pulling it would create
                // a duplicate real project.
                if (remote.isSample || remote.name === 'Sample SURGfund Project') continue;
                if (pullBanner) pullBanner.innerHTML = `<div class="w-4 h-4 border-2 border-gsf-boston border-t-transparent rounded-full" style="animation:spin 0.8s linear infinite"></div> Syncing project ${i + 1}/${remoteProjects.length}: ${App.escapeHtml(remote.shortName || remote.name)}…`;
                setBtn(`<span style="display:inline-block;animation:spin 1s linear infinite">↻</span> ${i + 1}/${remoteProjects.length}: ${App.escapeHtml(remote.shortName || remote.name)}…`);

                // Find or create local project
                let local = Projects.registry.find(p => p.type === 'generic' && p.name === remote.name);
                // SILENT pull: if this project has unsynced local edits, KEEP them —
                // do not overwrite with the (possibly older) cloud copy. New projects
                // have no local files, so they're never "dirty" and still get created.
                // "Dirty" = a per-project DATA file OR the registry METADATA
                // (lastModified, stamped by updateProject) changed since we last
                // reconciled with the cloud.
                const _metaDirty = local && local.lastModified && new Date(local.lastModified).getTime() > dirtyBaselineMs;
                if (silent && local && (_metaDirty || this._projectLocallyDirty(local.id, dirtyBaselineMs))) {
                    skippedDirty.push(local.shortName || local.name);
                    continue;
                }
                if (!local) {
                    await Projects.createProject({
                        name:        remote.name,
                        description: remote.description || '',
                        color:       remote.color || '#4389C8',
                        icon:        remote.icon  || 'briefcase'
                    });
                    local = Projects.registry.find(p => p.name === remote.name && p.type === 'generic');
                    if (local) {
                        await Projects.updateProject(local.id, {
                            shortName:           remote.shortName   || null,
                            startDate:           remote.startDate   || '',
                            endDate:             remote.endDate     || '',
                            hcwMultiplierEnabled: remote.hcwMultiplierEnabled || false,
                            hcwMultiplierRate:    remote.hcwMultiplierRate !== undefined ? remote.hcwMultiplierRate : 10,
                            programme:           remote.programme  || '',
                            linkGsf:             remote.linkGsf    || '',
                            linkFolder:          remote.linkFolder  || '',
                            linksExtra:          remote.linksExtra  || [],
                            enabledQualityKpis:  remote.enabledQualityKpis || [],
                            lat:                 remote.lat != null ? remote.lat : null,
                            lng:                 remote.lng != null ? remote.lng : null,
                            locations:           remote.locations   || [],
                            sheetsTabUrl:        remote.sheetsTabUrl || ''
                        });
                    }
                    created++;
                } else {
                    // Update metadata from remote
                    await Projects.updateProject(local.id, {
                        description:          remote.description || local.description,
                        shortName:            remote.shortName   !== undefined ? (remote.shortName || null) : (local.shortName || null),
                        color:                remote.color       || local.color,
                        icon:                 remote.icon        || local.icon,
                        startDate:            remote.startDate   !== undefined ? remote.startDate : (local.startDate || ''),
                        endDate:              remote.endDate     !== undefined ? remote.endDate   : (local.endDate   || ''),
                        hcwMultiplierEnabled: remote.hcwMultiplierEnabled !== undefined ? remote.hcwMultiplierEnabled : (local.hcwMultiplierEnabled || false),
                        hcwMultiplierRate:    remote.hcwMultiplierRate    !== undefined ? remote.hcwMultiplierRate    : (local.hcwMultiplierRate    !== undefined ? local.hcwMultiplierRate : 10),
                        programme:            remote.programme   !== undefined ? remote.programme  : (local.programme  || ''),
                        linkGsf:              remote.linkGsf     !== undefined ? remote.linkGsf    : (local.linkGsf    || ''),
                        linkFolder:           remote.linkFolder  !== undefined ? remote.linkFolder  : (local.linkFolder  || ''),
                        linksExtra:           remote.linksExtra  !== undefined ? remote.linksExtra  : (local.linksExtra  || []),
                        enabledQualityKpis:   remote.enabledQualityKpis !== undefined ? remote.enabledQualityKpis : (local.enabledQualityKpis || []),
                        lat:                  remote.lat != null ? remote.lat : (local.lat != null ? local.lat : null),
                        lng:                  remote.lng != null ? remote.lng : (local.lng != null ? local.lng : null),
                        locations:            remote.locations !== undefined ? remote.locations : (local.locations || []),
                        sheetsTabUrl:         remote.sheetsTabUrl !== undefined ? remote.sheetsTabUrl : (local.sheetsTabUrl || '')
                    });
                    updated++;
                }
                if (!local) continue;

                // Fully replace KPI data (all years)
                const allTargets = (remote.years || []).map(yr => ({ year: yr.year, kpis: yr.targets || {} }));
                const allActuals = (remote.years || []).map(yr => { const e = { year: yr.year, kpis: yr.actuals || {} }; if (yr.quarters && Object.keys(yr.quarters).length) e.quarters = yr.quarters; return e; });
                await Storage.setItem(`surgdash_targets_${local.id}`, allTargets);
                await Storage.setItem(`surgdash_actuals_${local.id}`, allActuals);

                // Fully replace comments
                const allComments = (remote.years || [])
                    .filter(yr => Object.keys(yr.targetComments || {}).length || Object.keys(yr.actualComments || {}).length)
                    .map(yr => ({ year: yr.year, targetComments: yr.targetComments || {}, actualComments: yr.actualComments || {} }));
                await Storage.setItem(`surgdash_kpi_comments_${local.id}`, allComments);

                // Fully replace events, updates, and KPI log
                // Normalise date fields — Google Sheets auto-converts date-shaped
                // strings to Date cells, which round-trip back as verbose locale
                // strings (e.g. "Sat Feb 28 2026 00:00:00 GMT+0100 (...)"). The HTML
                // date input can't parse those, so we coerce them back to ISO here.
                await Projects.replaceEvents(local.id,  this._normaliseDates(remote.events  || []));
                await Projects.replaceUpdates(local.id, this._normaliseDates(remote.updates || []));
                if (remote.kpiLog && remote.kpiLog.length > 0) {
                    await Storage.setItem(`surgdash_kpi_log_${local.id}`, remote.kpiLog);
                }

                // Fully replace quality indicator data
                if (remote.qualityData && remote.qualityData.length > 0) {
                    await Storage.setItem(`surgdash_quality_data_${local.id}`, remote.qualityData);
                }

                // Fully replace facilities
                if (remote.facilities && remote.facilities.length > 0) {
                    await Storage.setItem(`surgdash_facilities_${local.id}`, remote.facilities);
                }
            }

            // Delete ghost local projects
            for (const p of toDelete) {
                await Projects.deleteProject(p.id);
            }

            // Restore SURGhub data if present in the response
            let surghubRestored = false;
            let surghubSkipped = false;
            if (pullBanner) pullBanner.innerHTML = '<div class="w-4 h-4 border-2 border-gsf-boston border-t-transparent rounded-full" style="animation:spin 0.8s linear infinite"></div> Syncing SURGhub data…';
            if (result.surghubStorage && typeof result.surghubStorage === 'object') {
                // Guard: if there are unsynced local SURGhub changes (e.g. user just
                // imported a fresh SURGhub JSON snapshot but hasn't clicked Sync yet),
                // do NOT overwrite local with the (older) Sheets copy. Silent pulls
                // skip outright; manual pulls prompt the user.
                const hasLocalDirty = await Storage.getItem('surghub_unsynced_local');
                let proceedSurghub = !hasLocalDirty;
                if (hasLocalDirty && !silent) {
                    const localAt = await Storage.getItem('surghub_local_mtime');
                    const msg = `Your local SURGhub data has unsynced changes (imported ${localAt || 'recently'}).\n\nPulling will OVERWRITE it with the Google Sheets copy, which may be older.\n\nClick OK to overwrite, or Cancel to keep your local data (recommended — push it to Sheets with the Sync button first).`;
                    proceedSurghub = confirm(msg);
                }
                if (proceedSurghub) {
                    const _SURGHUB_INTERNAL = new Set(['surghub_local_mtime', 'surghub_unsynced_local', 'surghub_last_synced']);
                    for (const [key, value] of Object.entries(result.surghubStorage)) {
                        if (_SURGHUB_INTERNAL.has(key)) continue;
                        if (key.startsWith('surghub_') && value != null) {
                            await Storage.setItem(key, value);
                        }
                    }
                } else {
                    surghubSkipped = true;
                    console.log('[SURGhub] Pull skipped overwrite — local has unsynced changes.');
                }
                // Reload SURGhub data into memory
                const stored = await Storage.getItem('surghub_data');
                if (stored) App.data = stored;
                const hist = await Storage.getItem('surghub_history');
                if (hist) App.userHistory = hist;
                const amb = await Storage.getItem('surghub_ambassadors');
                if (amb) App.ambassadorData = amb;
                const users = await Storage.getItem('surghub_unique_users');
                if (users) App.platformUniqueUsers = parseInt(users);
                const anon = await Storage.getItem('surghub_anon_users');
                if (anon) App._rawAnonymizedUsers = anon;
                App._anonLoadPromise = null;
                // Completion (~37MB) isn't reloaded into memory on a pull — invalidate its
                // lazy cache so the next reader re-reads the just-pulled value, not a stale one.
                App._rawCompletion = null; App._completionLoadPromise = null;
                const emailDemo = await Storage.getItem('surghub_email_demo');
                if (emailDemo) App._emailDemoMap = emailDemo;
                surghubRestored = proceedSurghub;
            }

            // Internal write — must not re-trigger auto-sync (would create a loop).
            // CRITICAL (data-loss fix): only advance the pull baseline when we FULLY
            // reconciled with the cloud. If we preserved any local edits above (the
            // SURGhub blob, or SURGfund projects skipped as dirty), advancing
            // googleSheetsLastPull would push the dirty-baseline PAST those edits' file
            // mtimes — so the NEXT silent pull would no longer see them as dirty and
            // would silently overwrite them with the older cloud copy (one-cycle
            // protection only). Holding the old baseline keeps them protected until the
            // user pushes (which advances googleSheetsLastSync and clears the dirty state).
            const _fullyReconciled = !surghubSkipped && skippedDirty.length === 0;
            if (_fullyReconciled) {
                await Projects.saveAppSettings({ googleSheetsLastPull: new Date().toISOString() }, { internal: true });
            }
            // Local data now matches the cloud — clear the dirty flag, but only if we
            // didn't PRESERVE any local changes that still need pushing (SURGhub blob
            // or projects with unsynced edits we skipped). Leaving it dirty keeps the
            // unsynced banner up so the user knows to Sync those changes to the cloud.
            if (App.markClean && _fullyReconciled) App.markClean();

            const parts = [];
            if (created) parts.push(`${created} created`);
            if (updated) parts.push(`${updated} updated`);
            if (toDelete.length) parts.push(`${toDelete.length} deleted`);
            if (surghubRestored) parts.push('SURGhub data synced');
            if (surghubSkipped) parts.push('SURGhub local kept (push to Sheets to sync)');
            if (skippedDirty.length) parts.push(`${skippedDirty.length} project${skippedDirty.length !== 1 ? 's' : ''} with local edits kept — click Sync to push`);
            if (!silent || parts.length > 0) App.showMsg(`Pull complete: ${parts.join(', ')} ✓`);
            setBtn('<i data-lucide="download" width="12" class="text-emerald-600"></i> Pull', false);
            // Restore status indicator and remove banner
            if (statusEl) statusEl.innerHTML = origStatus;
            if (pullBanner) pullBanner.remove();
            // Always re-render so sidebar and views reflect new data
            await Projects.loadRegistry();
            // Update selectedDate in case new data arrived
            const dates = App.getAvailableDates();
            if (dates.length > 0) {
                App.selectedDate = dates[dates.length - 1];
            }
            // Force sidebar rebuild (skip-cache)
            App._lastSidebarProject = null;
            App.renderView();
        } catch (err) {
            console.error('Sheets pull error:', err);
            if (statusEl) statusEl.innerHTML = origStatus;
            if (pullBanner) pullBanner.remove();
            if (!silent) alert('Pull failed: ' + err.message);
            setBtn('<i data-lucide="download" width="12" class="text-emerald-600"></i> Pull', false);
        }
    },

    _addExtraLink() {
        const list = document.getElementById('extra-links-list');
        if (!list) return;
        const idx = list.children.length;
        const div = document.createElement('div');
        div.className = 'flex gap-2 items-center';
        div.setAttribute('data-extra-link', idx);
        div.innerHTML = `
            <input type="text" placeholder="Label" class="px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30 w-36 shrink-0 extra-link-label" />
            <input type="text" placeholder="URL or path" class="px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30 flex-1 extra-link-url" />
            <button onclick="this.closest('[data-extra-link]').remove()" class="text-red-400 hover:text-red-600 shrink-0 p-1"><i data-lucide="x" width="14"></i></button>`;
        list.appendChild(div);
        if (window.lucide) lucide.createIcons();
    },

    async _confirmDeleteProject(projectId) {
        if (!App.editUnlocked) return;   // viewers can't delete (button is also hidden via data-edit-only)
        const project = Projects.getProject(projectId);
        if (!confirm(`Delete "${project.name}" and all its data? This cannot be undone.`)) return;
        await Projects.deleteProject(projectId);
        await App.switchProject('surghub');
    },

    // ===== NEW PROJECT =====
    renderNewProject(main) {
        const iconOptions  = ['briefcase','heart','globe','target','zap','shield','star','flag','rocket','building-2','graduation-cap','microscope','stethoscope','leaf','users','truck','wrench','lightbulb'];
        const colorOptions = ['#4389C8','#D03734','#E28743','#10B981','#8B5CF6','#EC4899','#F59E0B','#002F4C'];

        const hasSample = Projects.registry.some(p => p.isSample);

        main.innerHTML = `
            <div class="p-6 md:p-10 fade-in w-full max-w-4xl mx-auto">
                <header class="mb-8">
                    <h1 class="text-2xl font-bold text-gsf-prussian">Create New Project</h1>
                    <p class="text-sm text-slate-500 mt-1">Set up a new project to track standard organisational KPIs and progress updates.</p>
                </header>

                <!-- Sample project quick-start card -->
                <div class="bg-purple-50 border border-purple-200 rounded-xl p-5 mb-6 flex items-start gap-4 flex-wrap">
                    <div class="bg-purple-500 text-white p-3 rounded-lg shrink-0">
                        <i data-lucide="flask-conical" width="22"></i>
                    </div>
                    <div class="flex-1 min-w-[260px]">
                        <h2 class="text-sm font-bold text-purple-900 mb-1">Don't want to start from scratch?</h2>
                        <p class="text-xs text-purple-800 mb-3">Create a <strong>sample project</strong> pre-populated with KPIs, quality indicators, facilities, training events, and narrative updates. It's clearly marked as a demo, doesn't count toward your organisation totals, and you can delete it any time.</p>
                        ${hasSample
                            ? `<button onclick="App.switchProject(Projects.registry.find(p=>p.isSample).id)" class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-bold transition-colors"><i data-lucide="arrow-right" width="14" class="inline mr-1"></i> Open existing sample project</button>`
                            : `<button onclick="GenericViews._createSampleProject()" class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-bold transition-colors"><i data-lucide="sparkles" width="14" class="inline mr-1"></i> Create sample project</button>`
                        }
                    </div>
                </div>

                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
                    <div class="space-y-4">
                        <div>
                            <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Project Name *</label>
                            <input type="text" id="new-name" placeholder="e.g. SURG Ethiopia" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Description</label>
                            <textarea id="new-desc" rows="2" placeholder="Brief description of this project" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30 resize-y"></textarea>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Color</label>
                            <div class="flex gap-2 mt-1">
                                ${colorOptions.map((c, i) => `<button onclick="document.getElementById('new-color').value='${c}'; document.querySelectorAll('[data-newcolor-btn]').forEach(b=>b.classList.remove('ring-2','ring-offset-2')); this.classList.add('ring-2','ring-offset-2')" data-newcolor-btn class="w-8 h-8 rounded-full border-2 border-white shadow-sm ${i === 0 ? 'ring-2 ring-offset-2' : ''}" style="background:${c}"></button>`).join('')}
                                <input type="hidden" id="new-color" value="#4389C8" />
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Icon</label>
                            <div class="flex flex-wrap gap-2 mt-1">
                                ${iconOptions.map((ic, i) => `<button onclick="document.getElementById('new-icon').value='${ic}'; document.querySelectorAll('[data-newicon-btn]').forEach(b=>b.classList.remove('bg-gsf-boston/10','ring-1')); this.classList.add('bg-gsf-boston/10','ring-1')" data-newicon-btn class="w-9 h-9 rounded-lg flex items-center justify-center border hover:bg-slate-50 ${i === 0 ? 'bg-gsf-boston/10 ring-1' : ''}"><i data-lucide="${ic}" width="18" class="text-slate-600"></i></button>`).join('')}
                                <input type="hidden" id="new-icon" value="briefcase" />
                            </div>
                        </div>
                    </div>
                </div>

                <div class="bg-slate-50 rounded-xl border border-slate-200 p-6 mb-6">
                    <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide mb-2">Included KPIs</h2>
                    <p class="text-sm text-slate-500 mb-3">All projects include the four standard organisational KPIs.</p>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        ${Projects.STANDARD_KPIS.map(kpi => `
                            <div class="flex items-center gap-2 text-sm text-slate-600 bg-white rounded-lg p-3 border border-slate-200">
                                <i data-lucide="${kpi.icon}" width="14" style="color:${kpi.color}"></i>
                                <span>${kpi.name}</span>
                            </div>`).join('')}
                    </div>
                </div>

                <div class="flex gap-3">
                    <button onclick="GenericViews._createProject()" class="px-8 py-3 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors">Create Project</button>
                    <button onclick="App.switchProject(App.currentProject === 'org' ? (Projects.registry.find(p=>p.type!=='surghub')?.id || 'surghub') : App.currentProject)" class="px-6 py-3 text-slate-500 hover:text-slate-700 rounded-lg text-sm font-medium">Cancel</button>
                </div>
            </div>`;

        if (window.lucide) lucide.createIcons();
    },

    async _createProject() {
        const name        = document.getElementById('new-name').value.trim();
        if (!name) { document.getElementById('new-name').focus(); return; }
        const description = document.getElementById('new-desc').value.trim();
        const color       = document.getElementById('new-color').value;
        const icon        = document.getElementById('new-icon').value;
        const project = await Projects.createProject({ name, description, color, icon, kpiDefinitions: [] });
        await App.switchProject(project.id);
    },

    async _createSampleProject() {
        try {
            const project = await Projects.createSampleProject();
            App.showMsg && App.showMsg('Sample project created ✓ — KPIs, quality indicators, facilities, and events populated.');
            await App.switchProject(project.id);
        } catch (e) {
            console.error('Sample project creation failed:', e);
            alert('Failed to create sample project: ' + (e.message || e));
        }
    },

    async _obsolete_createDemoProjects() {
        const demoProjects = [
            { name: 'Safe Surgery Sierra Leone',     description: 'Strengthening surgical capacity at district hospitals in Sierra Leone',          color: '#4389C8', icon: 'heart' },
            { name: 'Rwanda Surgical Training',      description: 'National surgical, obstetric and anaesthesia plan implementation',               color: '#D03734', icon: 'stethoscope' },
            { name: 'Ethiopia Perioperative Care',   description: 'Perioperative quality improvement across Addis Ababa teaching hospitals',        color: '#10B981', icon: 'shield' },
            { name: 'Tanzania Safe Anaesthesia',     description: 'Anaesthesia training and equipment programme in rural Tanzania',                 color: '#8B5CF6', icon: 'zap' },
            { name: 'Bangladesh Surgical Access',    description: 'Expanding surgical access in underserved sub-districts of Dhaka Division',       color: '#E28743', icon: 'globe' },
            { name: 'Pacific Islands Programme',     description: 'Surgical workforce strengthening across Fiji, Samoa and Tonga',                  color: '#EC4899', icon: 'flag' },
            { name: 'Global Surgical Data Hub',      description: 'Multi-country data collection and surgical indicator monitoring',                color: '#002F4C', icon: 'target' }
        ];

        const scales = [1.0, 0.8, 0.6, 0.5, 0.7, 0.35, 0.25];

        // Base values per year for a scale=1 project
        const baseTargets = {
            2022: { hcw: 80,  patients: 3000,  pop: 150000,  fac: 4 },
            2023: { hcw: 120, patients: 5000,  pop: 250000,  fac: 6 },
            2024: { hcw: 180, patients: 8000,  pop: 400000,  fac: 8 },
            2025: { hcw: 250, patients: 12000, pop: 600000,  fac: 10 },
            2026: { hcw: 320, patients: 16000, pop: 800000,  fac: 12 },
            2027: { hcw: 400, patients: 20000, pop: 1000000, fac: 14 },
            2028: { hcw: 480, patients: 25000, pop: 1200000, fac: 16 },
            2029: { hcw: 550, patients: 30000, pop: 1400000, fac: 18 },
            2030: { hcw: 600, patients: 35000, pop: 1500000, fac: 20 }
        };

        // Deterministic pseudo-random for reproducible actuals (85-110% of target)
        let _seed = 42;
        const rand = () => { _seed = (_seed * 16807 + 7) % 2147483647; return _seed; };
        const randPct = () => 0.85 + (rand() % 250) / 1000;
        const randRange = (lo, hi) => lo + (rand() % (hi - lo));

        const facilityNames = [
            ['Connaught Hospital', 'Bo Government Hospital', 'Kenema Government Hospital', 'Makeni Regional Hospital', 'Princess Christian Maternity Hospital'],
            ['CHUK Kigali', 'CHUB Butare', 'Kibagabaga Hospital', 'Ruhengeri Hospital', 'Nyamata Hospital'],
            ['Black Lion Hospital', 'St Paul\'s Hospital', 'Yekatit 12 Hospital', 'Zewditu Memorial Hospital', 'Alert Hospital'],
            ['Muhimbili National Hospital', 'Bugando Medical Centre', 'Mount Meru Hospital', 'Mbeya Zonal Hospital'],
            ['Dhaka Medical College', 'Sher-e-Bangla Medical College', 'Faridpur Medical College', 'Tangail General Hospital', 'Manikganj District Hospital'],
            ['Colonial War Memorial Hospital', 'Lautoka Hospital', 'Tupua Tamasese Meaole Hospital'],
            ['Geneva Data Centre', 'Regional Coordination Hub']
        ];

        const currentYear = new Date().getFullYear();

        for (let i = 0; i < demoProjects.length; i++) {
            const dp = demoProjects[i];
            const s  = scales[i];
            const project = await Projects.createProject({
                name: dp.name,
                description: dp.description,
                color: dp.color,
                icon: dp.icon,
                kpiDefinitions: []
            });

            // Facilities
            const facs = facilityNames[i] || [];
            for (const fname of facs) {
                await Projects.saveFacility(project.id, {
                    name: fname,
                    catchmentPop:   Math.round(randRange(80000, 480000) * s),
                    annualPatients: Math.round(randRange(500, 4500) * s),
                    notes: ''
                });
            }

            // Targets + actuals for every year
            for (let yr = 2022; yr <= 2030; yr++) {
                const bt = baseTargets[yr];
                const targets = {
                    hcw_strengthened:        Math.round(bt.hcw * s),
                    patients_reached:        Math.round(bt.patients * s),
                    population_access:       Math.round(bt.pop * s),
                    facilities_strengthened: Math.max(1, Math.round(bt.fac * s))
                };
                await Projects.saveTargets(project.id, yr, targets);

                // Actuals for past/current years only
                if (yr <= currentYear) {
                    const actuals = {
                        hcw_strengthened:        Math.round(targets.hcw_strengthened * randPct()),
                        patients_reached:        Math.round(targets.patients_reached * randPct()),
                        population_access:       Math.round(targets.population_access * randPct()),
                        facilities_strengthened: Math.max(1, Math.round(targets.facilities_strengthened * randPct()))
                    };
                    await Projects.saveActuals(project.id, yr, actuals);
                }
            }

            // Sample events across 2022-2025
            const eventSets = [
                { yr: '2022-04-12', type: 'workshop', title: `Basic Surgical Skills – ${dp.name.split(' ').pop()}`, hcw_count: Math.round(20 * s) },
                { yr: '2022-09-20', type: 'workshop', title: `Anaesthesia Fundamentals`,                             hcw_count: Math.round(15 * s) },
                { yr: '2023-03-08', type: 'workshop', title: `Emergency Obstetric Care Training`,                     hcw_count: Math.round(22 * s) },
                { yr: '2023-07-15', type: 'facility', title: `Facility Baseline Assessment` },
                { yr: '2023-11-30', type: 'patients', title: `Annual Patient Volume – 2023`,                          patient_count: Math.round(2500 * s) },
                { yr: '2024-02-20', type: 'workshop', title: `Advanced Trauma Life Support`,                          hcw_count: Math.round(30 * s) },
                { yr: '2024-06-10', type: 'workshop', title: `Perioperative Nursing Course`,                          hcw_count: Math.round(18 * s) },
                { yr: '2024-12-31', type: 'patients', title: `Annual Patient Volume – 2024`,                          patient_count: Math.round(4000 * s) },
                { yr: '2025-03-05', type: 'workshop', title: `Surgical Safety Checklist Rollout`,                     hcw_count: Math.round(35 * s) },
                { yr: '2025-06-18', type: 'workshop', title: `Quality Improvement Workshop`,                          hcw_count: Math.round(25 * s) },
                { yr: '2025-09-22', type: 'facility', title: `Mid-Year Facility Review` },
                { yr: '2025-12-15', type: 'patients', title: `Annual Patient Volume – 2025`,                          patient_count: Math.round(6000 * s) }
            ];
            for (const ev of eventSets) {
                await Projects.saveEvent(project.id, { type: ev.type, date: ev.yr, title: ev.title, hcw_count: ev.hcw_count, patient_count: ev.patient_count });
            }

            // Narrative updates
            const updates = [
                { date: '2023-01-15', title: 'Programme launched',     body: 'Official launch of the programme with local health ministry.' },
                { date: '2024-06-01', title: 'Mid-year progress',      body: 'Training activities on track. Facilities engaged and responsive.' },
                { date: '2025-01-10', title: 'Annual review completed', body: 'Strong progress across all KPIs. Expansion planned for next phase.' }
            ];
            for (const u of updates) {
                await Projects.saveUpdate(project.id, u);
            }
        }
    }
};
