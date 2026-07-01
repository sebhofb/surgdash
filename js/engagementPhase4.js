// Phase 4 — Country Brief generator (#12)
//
// A single one-page card for any selected country. Pulls together everything
// from the engagement aggregates plus growth timeline and global benchmarks
// so it can be screenshotted / printed / pasted straight into a funder email.
//
// Placement: top of the Audience-tab engagement analysis, so it's the first
// thing the user sees once they have demographics data loaded.

Object.assign(window.App, {
    _briefCountry: '',   // selected country (empty = picker view only)

    _pickBriefCountry(name) {
        this._briefCountry = name || '';
        this._refreshEngagementSection();
    },
    // Typeahead handler — only re-render when the input matches a known country
    _tryPickBriefCountry(val) {
        const v = (val || '').trim();
        if (!v) return; // ignore empty
        // Match case-insensitively against the country list cached on App
        const lc = v.toLowerCase();
        const list = this._briefCountryList || [];
        const match = list.find(c => c.toLowerCase() === lc);
        if (match && match !== this._briefCountry) {
            this._briefCountry = match;
            this._refreshEngagementSection();
        }
    },
    _clearBriefCountry() {
        this._briefCountry = '';
        this._refreshEngagementSection();
    },

    // ── Tiny inline SVG sparkline ─────────────────────────────────────────
    _sparkline(values, width, height, color) {
        if (!values || values.length === 0) return '';
        const w = width || 240, h = height || 36;
        const max = Math.max(...values, 1);
        const min = Math.min(...values, 0);
        const span = max - min || 1;
        const step = values.length > 1 ? w / (values.length - 1) : w;
        const points = values.map((v, i) => {
            const x = i * step;
            const y = h - ((v - min) / span) * (h - 2) - 1;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
        const lastX = ((values.length - 1) * step).toFixed(1);
        const lastY = (h - ((values[values.length - 1] - min) / span) * (h - 2) - 1).toFixed(1);
        return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block">
            <polyline fill="none" stroke="${color || '#4389C8'}" stroke-width="1.8" points="${points}" />
            <circle cx="${lastX}" cy="${lastY}" r="2.5" fill="${color || '#4389C8'}" />
        </svg>`;
    },

    // ── Country brief render ──────────────────────────────────────────────
    _renderCountryBrief(data) {
        if (!data) return '';
        const IC = window.IncomeClassification;

        // Country list — keep all countries with enrolments, sorted alphabetically for browsing
        const knownCountries = Object.entries(data.byCountry)
            .filter(([c, v]) => c && v.enrolls > 0)
            .map(([c]) => c)
            .sort((a, b) => a.localeCompare(b));

        const sel = this._briefCountry && data.byCountry[this._briefCountry] ? this._briefCountry : '';
        // Stash the country list on App so the input handler can read it without
        // serialising the array into an HTML attribute (which breaks on quotes).
        this._briefCountryList = knownCountries;

        // Country picker — custom combobox (App._comboHtml), NOT a native <datalist>.
        // A native datalist leaves an orphaned popup floating in the corner when the
        // input is re-rendered on selection (clicking that stale popup then blanked the
        // app). The combobox closes its own list before re-rendering, so nothing orphans.
        const picker = `<div class="flex items-center gap-1">
            ${this._comboHtml('brief-country', knownCountries, sel, 'briefCountry')}
            ${sel ? `<button onclick="App._clearBriefCountry()" title="Clear selection" class="p-1.5 rounded hover:bg-white/20 text-white/80 hover:text-white"><i data-lucide="x" width="14"></i></button>` : ''}
        </div>`;

        // ── Empty state ──────────────────────────────────────────────────
        if (!sel) {
            return `
                <div id="eng-section-brief" class="bg-white rounded-xl shadow-sm border">
                    <div class="bg-gradient-to-r from-gsf-prussian to-gsf-boston text-white p-5 rounded-t-xl flex justify-between items-center gap-4 flex-wrap">
                        <div>
                            <h2 class="font-bold text-lg flex items-center gap-2"><i data-lucide="file-text"></i> Country Brief</h2>
                            <p class="text-xs text-white/80 mt-1">One-page snapshot for any country — KPIs, top courses, professions, growth. Built for screenshots and funder briefs.</p>
                        </div>
                        ${picker}
                    </div>
                    <div class="p-8 text-center">
                        <i data-lucide="globe" width="32" class="text-slate-300 mx-auto mb-2"></i>
                        <p class="text-sm text-slate-500">Pick a country above to generate its brief.</p>
                    </div>
                </div>
            `;
        }

        // ── Aggregated data for the selected country ─────────────────────
        const c = data.byCountry[sel];
        const activePct = c.enrolls > 0 ? (c.active / c.enrolls) * 100 : 0;
        const avgMins   = c.active > 0 ? c.totalMins / c.active : 0;
        const completion = c.enrolls > 0 ? (c.certs / c.enrolls) * 100 : 0;
        const users = data.countryUsers[sel] || 0;
        const tier = IC ? IC.classify(sel) : 'Unknown';
        const tierLabel = IC ? IC.label(tier) : tier;
        const tierColor = IC ? IC.color(tier) : '#94a3b8';
        const isPriority = IC ? IC.isLancetPriority(sel) : false;

        // Global benchmarks (over all declared-country enrolments)
        const allCountryRows = Object.values(data.byCountry);
        const gE = allCountryRows.reduce((s, v) => s + v.enrolls, 0);
        const gA = allCountryRows.reduce((s, v) => s + v.active, 0);
        const gC = allCountryRows.reduce((s, v) => s + v.certs, 0);
        const gM = allCountryRows.reduce((s, v) => s + v.totalMins, 0);
        const gActivePct  = gE > 0 ? (gA / gE) * 100 : 0;
        const gAvgMins    = gA > 0 ? gM / gA : 0;
        const gCompletion = gE > 0 ? (gC / gE) * 100 : 0;

        // Top 5 courses
        const topCourses = Object.entries(data.countryByCourse[sel] || {})
            .sort((a, b) => b[1].enrolls - a[1].enrolls)
            .slice(0, 5);

        // Top 5 professions for this country — need to recompute from anon records
        const profCount = {};
        (this._rawAnonymizedUsers || []).forEach(r => {
            if (r.country !== sel) return;
            const p = (r.profession || '').trim();
            if (!p || p.toLowerCase() === 'unknown' || p === 'nan') return;
            profCount[p] = (profCount[p] || 0) + 1;
        });
        const topProfs = Object.entries(profCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const totalProfEnroll = topProfs.reduce((s, [, n]) => s + n, 0);

        // Engagement segments for this country
        const segs = data.segByCountry[sel] || { ghost: 0, explorer: 0, engaged: 0, power: 0 };
        const segTotal = segs.ghost + segs.explorer + segs.engaged + segs.power;
        const segDef = [
            { key: 'ghost',    label: 'Ghost',    color: '#e5e7eb' },
            { key: 'explorer', label: 'Explorer', color: '#7A9E9F' },
            { key: 'engaged',  label: 'Engaged',  color: '#4389C8' },
            { key: 'power',    label: 'Power',    color: '#1a5276' },
        ];
        const engagedPlusPct = segTotal > 0 ? ((segs.engaged + segs.power) / segTotal) * 100 : 0;

        // Country growth sparkline from CountryTimeline (cumulative signups by month)
        let sparkSVG = '';
        let growthHint = '';
        const audSnap = (this.userHistory || []).find(d => d.Timestamp === this.selectedDate) || (this.userHistory || [])[0] || null;
        if (audSnap && audSnap.CountryTimeline) {
            try {
                const ctl = typeof audSnap.CountryTimeline === 'string' ? JSON.parse(audSnap.CountryTimeline) : audSnap.CountryTimeline;
                const months = Object.keys(ctl).sort();
                let cum = 0;
                const cumVals = [];
                months.forEach(m => {
                    cum += (Number((ctl[m] || {})[sel]) || 0);
                    cumVals.push(cum);
                });
                if (cumVals.length > 0) {
                    sparkSVG = this._sparkline(cumVals, 240, 40, '#4389C8');
                    const last = cumVals[cumVals.length - 1];
                    const prev12 = cumVals[Math.max(0, cumVals.length - 13)] || 0;
                    const delta = last - prev12;
                    growthHint = `+${this.formatNumber(delta)} new in last 12 mo`;
                }
            } catch (_) { /* ignore */ }
        }

        // Rating for this country (response/enrol-weighted from snap)
        const snap = this.getAnalyticsSnap ? this.getAnalyticsSnap() : [];
        const courseRating = {};
        snap.forEach(d => { if (d.Course && Number(d.Rating) > 0) courseRating[d.Course] = Number(d.Rating); });
        let rs = 0, rw = 0, benchRS = 0, benchRW = 0;
        Object.entries(data.countryByCourse[sel] || {}).forEach(([course, e]) => {
            const r = courseRating[course]; if (!r) return;
            rs += r * e.enrolls; rw += e.enrolls;
        });
        Object.entries(data.byCountry).forEach(([, v]) => { void v; }); // no-op, kept for readability
        snap.forEach(d => {
            const r = Number(d.Rating) || 0;
            const resps = Number(d.Responses) || 0;
            if (r > 0 && resps > 0) { benchRS += r * resps; benchRW += resps; }
        });
        const cRating = rw > 0 ? rs / rw : 0;
        const bench = benchRW > 0 ? benchRS / benchRW : 0;
        const ratingDelta = cRating - bench;

        // KPI delta formatter
        const deltaSpan = (cur, ref, suffix) => {
            const d = cur - ref;
            const cls = d > 0 ? 'text-green-700' : d < 0 ? 'text-red-700' : 'text-slate-400';
            const sign = d >= 0 ? '+' : '';
            return `<span class="${cls} text-[10px] font-bold ml-1">${sign}${d.toFixed(suffix === '%' ? 0 : 1)}${suffix || ''}</span>`;
        };

        return `
            <div id="eng-section-brief" class="bg-white rounded-xl shadow-md border">
                <div class="bg-gradient-to-r from-gsf-prussian to-gsf-boston text-white p-5 flex justify-between items-center gap-4 flex-wrap">
                    <div>
                        <h2 class="font-bold text-lg flex items-center gap-2"><i data-lucide="file-text"></i> Country Brief</h2>
                        <p class="text-xs text-white/80 mt-1">One-page snapshot — built for screenshots and funder briefs.</p>
                    </div>
                    <div class="flex items-center gap-2">
                        ${picker}
                        ${this._engActionBtns('eng-section-brief', 'brief', 'Country_Brief_' + sel.replace(/[^a-zA-Z0-9]/g, '_'))}
                    </div>
                </div>

                <!-- Hero strip -->
                <div class="p-6 border-b bg-gradient-to-br from-slate-50 to-white">
                    <div class="flex justify-between items-start gap-4 flex-wrap mb-4">
                        <div>
                            <h1 class="text-4xl font-black text-gsf-prussian mb-1">${this.escapeHtml(sel)}</h1>
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold text-white" style="background:${tierColor}">${tierLabel}</span>
                                ${isPriority ? '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">⚑ Lancet priority</span>' : ''}
                                <span class="text-xs text-slate-400">Snapshot · ${this.formatDate(audSnap && audSnap.Timestamp ? audSnap.Timestamp : new Date().toISOString().slice(0,10))}</span>
                            </div>
                        </div>
                        ${sparkSVG ? `<div class="text-right">
                            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Cumulative signups</div>
                            ${sparkSVG}
                            <div class="text-[10px] text-slate-500 mt-1">${growthHint}</div>
                        </div>` : ''}
                    </div>

                    <!-- KPIs -->
                    <div class="grid grid-cols-2 md:grid-cols-6 gap-3">
                        ${[
                            { label: 'Registered', val: this.formatNumber(users), color: '#1a5276' },
                            { label: 'Enrolments', val: this.formatNumber(c.enrolls), color: '#4389C8' },
                            { label: 'Certificates', val: this.formatNumber(c.certs), color: '#7A9E9F' },
                            { label: 'Active %', val: activePct.toFixed(0) + '%', color: activePct >= gActivePct ? '#16a34a' : '#dc2626', extra: deltaSpan(activePct, gActivePct, '%') },
                            { label: 'Avg time', val: this.formatLearningTime(avgMins), color: avgMins >= gAvgMins ? '#16a34a' : '#dc2626', extra: deltaSpan(avgMins, gAvgMins, ' min') },
                            { label: 'Completion %', val: completion.toFixed(0) + '%', color: completion >= gCompletion ? '#16a34a' : '#dc2626', extra: deltaSpan(completion, gCompletion, '%') },
                        ].map(k => `<div class="bg-white rounded-lg border p-3">
                            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">${k.label}</div>
                            <div class="text-xl font-black" style="color:${k.color}">${k.val}${k.extra || ''}</div>
                        </div>`).join('')}
                    </div>
                </div>

                <!-- Engagement segments + Rating panel -->
                <div class="grid grid-cols-1 md:grid-cols-3 gap-0 border-b">
                    <div class="md:col-span-2 p-5 border-r">
                        <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Engagement mix</h4>
                        ${segTotal > 0 ? `
                            <div class="flex w-full h-6 rounded-md overflow-hidden border border-slate-200 mb-2">
                                ${segDef.map(s => {
                                    const n = segs[s.key] || 0;
                                    const pct = segTotal > 0 ? (n / segTotal) * 100 : 0;
                                    if (pct < 0.5) return '';
                                    return `<div title="${s.label}: ${n.toLocaleString()} (${pct.toFixed(1)}%)" style="width:${pct}%; background:${s.color};" class="flex items-center justify-center text-[10px] font-bold ${s.key==='ghost'||s.key==='explorer'?'text-slate-700':'text-white'}">${pct >= 8 ? pct.toFixed(0) + '%' : ''}</div>`;
                                }).join('')}
                            </div>
                            <div class="flex flex-wrap gap-3 text-[10px] text-slate-500">
                                ${segDef.map(s => `<span class="inline-flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:${s.color}"></span><strong>${s.label}</strong> ${this.formatNumber(segs[s.key] || 0)}</span>`).join('')}
                            </div>
                            <p class="text-[11px] text-slate-500 mt-3"><strong class="text-gsf-prussian">${engagedPlusPct.toFixed(0)}%</strong> of enrolments are <strong>Engaged or Power</strong> (≥ 30 min invested).</p>
                        ` : '<p class="text-sm text-slate-400 italic">No engagement data.</p>'}
                    </div>
                    <div class="p-5 flex flex-col justify-center">
                        <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Course rating</h4>
                        ${cRating > 0 ? `
                            <div class="flex items-baseline gap-2">
                                <span class="text-4xl font-black text-gsf-boston">${cRating.toFixed(2)}</span>
                                <span class="text-sm text-slate-400">/ 5</span>
                            </div>
                            <p class="text-[11px] text-slate-500 mt-1">
                                ${ratingDelta >= 0.05 ? '<span class="text-green-700 font-bold">+' + ratingDelta.toFixed(2) + '</span>' : ratingDelta <= -0.05 ? '<span class="text-red-700 font-bold">' + ratingDelta.toFixed(2) + '</span>' : '<span class="text-slate-400">≈ benchmark</span>'}
                                vs global benchmark ${bench.toFixed(2)}
                            </p>
                            <p class="text-[10px] text-slate-400 mt-2">Weighted by ${this.formatNumber(rw)} enrolments across rated courses.</p>
                        ` : '<p class="text-sm text-slate-400 italic">No rating data.</p>'}
                    </div>
                </div>

                <!-- Top courses + Top professions -->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-0">
                    <div class="p-5 border-r">
                        <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Top 5 courses</h4>
                        ${topCourses.length > 0 ? `<ol class="space-y-2">
                            ${topCourses.map(([course, e], i) => {
                                const maxE = topCourses[0][1].enrolls;
                                const pct = maxE > 0 ? (e.enrolls / maxE) * 100 : 0;
                                const compl = e.enrolls > 0 ? (e.certs / e.enrolls) * 100 : 0;
                                return `<li>
                                    <div class="flex justify-between items-baseline text-xs gap-2 mb-1">
                                        <span class="font-medium text-slate-700 truncate" title="${this.escapeHtml(course)}"><span class="text-slate-400 font-bold mr-1">${i+1}.</span>${this.escapeHtml(course)}</span>
                                        <span class="text-slate-500 whitespace-nowrap shrink-0">${this.formatNumber(e.enrolls)} <span class="text-slate-400">· ${compl.toFixed(0)}% cert</span></span>
                                    </div>
                                    <div class="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                        <div class="h-full rounded-full bg-gsf-boston" style="width:${pct}%"></div>
                                    </div>
                                </li>`;
                            }).join('')}
                        </ol>` : '<p class="text-sm text-slate-400 italic">No course data.</p>'}
                    </div>
                    <div class="p-5">
                        <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Top 5 professions</h4>
                        ${topProfs.length > 0 ? `<ol class="space-y-2">
                            ${topProfs.map(([prof, n], i) => {
                                const pct = totalProfEnroll > 0 ? (n / totalProfEnroll) * 100 : 0;
                                const maxN = topProfs[0][1];
                                const barPct = maxN > 0 ? (n / maxN) * 100 : 0;
                                return `<li>
                                    <div class="flex justify-between items-baseline text-xs gap-2 mb-1">
                                        <span class="font-medium text-slate-700 truncate" title="${this.escapeHtml(prof)}"><span class="text-slate-400 font-bold mr-1">${i+1}.</span>${this.escapeHtml(prof)}</span>
                                        <span class="text-slate-500 whitespace-nowrap shrink-0">${this.formatNumber(n)} <span class="text-slate-400">· ${pct.toFixed(0)}%</span></span>
                                    </div>
                                    <div class="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                        <div class="h-full rounded-full bg-gsf-prussian" style="width:${barPct}%"></div>
                                    </div>
                                </li>`;
                            }).join('')}
                        </ol>` : '<p class="text-sm text-slate-400 italic">No profession data.</p>'}
                    </div>
                </div>

                <div class="bg-slate-50 border-t px-5 py-2 text-[10px] text-slate-400 text-center">
                    SURGdash · Country Brief · ${this.escapeHtml(sel)} · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
            </div>
        `;
    },
});
