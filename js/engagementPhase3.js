// Phase 3 engagement sections — course / provider quality.
//   #8  Provider scorecard — composite score across rating, completion, active%, engagement
//   #13 Rating by country / profession — rating-weighted by learner mix
//
// Rationale: ratings come from per-course survey averages (already on snapData).
// We never have per-user ratings, so country/profession ratings are computed as
// the weighted average of course ratings using each group's learner mix.

Object.assign(window.App, {
    _providerSortCol: 'score',
    _providerSortAsc: false,
    _sortProvider(col) {
        if (this._providerSortCol === col) this._providerSortAsc = !this._providerSortAsc;
        else { this._providerSortCol = col; this._providerSortAsc = (col === 'provider'); }
        this._refreshEngagementSection();
    },

    _ratingDim: 'country', // 'country' | 'profession'
    _setRatingDim(v) {
        this._ratingDim = v;
        this._refreshEngagementSection();
    },

    // ── #8 Provider Scorecard ─────────────────────────────────────────────
    _computeProviderScorecard(data) {
        const snap = this.getAnalyticsSnap ? this.getAnalyticsSnap() : [];
        if (!snap || snap.length === 0) return [];

        // Aggregate by provider from course-level data
        const byProvider = {};
        snap.forEach(d => {
            const p = (d.Provider || '').trim();
            if (!p) return;
            const agg = byProvider[p] = byProvider[p] || {
                provider: p, courses: 0,
                enrolls: 0, certs: 0, responses: 0,
                ratingSum: 0, ratingCount: 0,    // unweighted (per-course ratings)
                ratingWeighted: 0,                // ratings weighted by responses
                ratingWeights: 0,
            };
            agg.courses++;
            agg.enrolls   += Number(d.Learners) || 0;
            agg.certs     += Number(d.Certificates) || 0;
            agg.responses += Number(d.Responses) || 0;
            const rating = Number(d.Rating) || 0;
            const resps = Number(d.Responses) || 0;
            if (rating > 0) {
                agg.ratingSum += rating; agg.ratingCount++;
                if (resps > 0) { agg.ratingWeighted += rating * resps; agg.ratingWeights += resps; }
            }
        });

        // Engagement metrics per provider from anon data (active%, avg minutes)
        // Anon records have only `course` not `provider`, so build a course→provider map
        const courseProv = {};
        snap.forEach(d => { if (d.Course && d.Provider) courseProv[d.Course] = d.Provider; });
        const provEng = {};   // provider -> {enrolls, active, totalMins}
        (this._rawAnonymizedUsers || []).forEach(r => {
            const p = courseProv[r.course]; if (!p) return;
            const e = provEng[p] = provEng[p] || { enrolls: 0, active: 0, totalMins: 0 };
            e.enrolls++;
            if (Number(r.course_minutes) > 0) e.active++;
            e.totalMins += Number(r.course_minutes) || 0;
        });

        // Score each provider
        const rows = Object.values(byProvider).map(agg => {
            const ratingAvg = agg.ratingWeights > 0
                ? agg.ratingWeighted / agg.ratingWeights
                : (agg.ratingCount > 0 ? agg.ratingSum / agg.ratingCount : 0);
            const completionPct = agg.enrolls > 0 ? (agg.certs / agg.enrolls) * 100 : 0;
            const eng = provEng[agg.provider] || { enrolls: 0, active: 0, totalMins: 0 };
            const activePct = eng.enrolls > 0 ? (eng.active / eng.enrolls) * 100 : 0;
            const avgMins   = eng.active > 0 ? eng.totalMins / eng.active : 0;

            // ── Composite score (0–100) ──────────────────────────────────
            // Each dimension normalised on its own scale, then weighted average.
            const n_rating     = Math.min(100, (ratingAvg / 5) * 100);    // /5 stars
            const n_completion = Math.min(100, completionPct);            // already %
            const n_active     = Math.min(100, activePct);                // already %
            // Engagement: log scale on minutes — capped at "5 hours = full marks"
            const n_engage     = Math.min(100, Math.max(0, (Math.log10(Math.max(1, avgMins)) / Math.log10(300)) * 100));

            // Weights (sum = 1.0). Active % dropped June 2026 (data too sparse).
            const W = { rating: 0.35, completion: 0.35, engage: 0.30 };
            // Skip dimensions where data is missing — re-distribute weights
            let score = 0, weightUsed = 0;
            if (ratingAvg > 0)      { score += n_rating     * W.rating;     weightUsed += W.rating; }
            if (agg.enrolls > 0)    { score += n_completion * W.completion; weightUsed += W.completion; }
            if (eng.active > 0)     { score += n_engage     * W.engage;     weightUsed += W.engage; }
            const composite = weightUsed > 0 ? score / weightUsed : 0;

            return {
                provider: agg.provider,
                courses: agg.courses,
                enrolls: agg.enrolls,
                certs: agg.certs,
                rating: ratingAvg,
                completion: completionPct,
                activePct,
                avgMins,
                score: composite,
            };
        });

        return rows;
    },

    _renderProviderScorecard(data) {
        const rows = this._computeProviderScorecard(data);
        if (rows.length === 0) return '';

        const col = this._providerSortCol;
        const asc = this._providerSortAsc;
        const sorted = rows.slice().sort((a, b) => {
            let va, vb;
            if (col === 'provider') { va = a.provider.toLowerCase(); vb = b.provider.toLowerCase(); }
            else { va = a[col] || 0; vb = b[col] || 0; }
            if (va < vb) return asc ? -1 : 1;
            if (va > vb) return asc ? 1 : -1;
            return 0;
        });

        const arrow = (c) => col === c
            ? (asc ? '&#9650;' : '&#9660;')
            : '<span class="text-slate-300">&#8597;</span>';
        const th = (key, label, align, hint) =>
            `<th class="py-3 px-3 font-medium ${align||''} cursor-pointer hover:text-gsf-boston select-none" ${hint ? `title="${hint}"` : ''} onclick="App._sortProvider('${key}')">${label} ${arrow(key)}</th>`;

        const scoreBar = (s) => {
            const pct = Math.max(0, Math.min(100, s));
            const colour = s >= 70 ? '#16a34a' : s >= 50 ? '#4389C8' : s >= 30 ? '#f59e0b' : '#dc2626';
            return `<div class="flex items-center justify-end gap-2">
                <div class="w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div style="width:${pct}%; background:${colour};" class="h-full rounded-full"></div>
                </div>
                <span class="font-bold tabular-nums" style="color:${colour}">${pct.toFixed(0)}</span>
            </div>`;
        };

        return `
            <div id="eng-section-provider" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="bg-slate-50 border-b p-5 flex justify-between items-start gap-4 flex-wrap">
                    <div>
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="award" class="text-gsf-boston"></i> Provider Scorecard<span class="text-[9px] font-bold uppercase tracking-wider text-amber-700 border border-amber-300 bg-amber-50 rounded-full px-1.5 py-0.5 ml-2 align-middle">Beta</span></h2>
                        <p class="text-xs text-slate-500 mt-1">Composite score (0–100) blending rating, completion % and engagement depth. Use to triage which providers need attention vs. which are pulling their weight.</p>
                    </div>
                    ${this._engActionBtns('eng-section-provider', 'provider', 'Provider_Scorecard')}
                </div>
                <div class="overflow-x-auto max-h-[600px] overflow-y-auto custom-scrollbar">
                    <table class="w-full text-left text-sm">
                        <thead class="sticky top-0 bg-white shadow-sm z-10 border-b text-slate-500">
                            <tr>
                                ${th('provider', 'Provider')}
                                ${th('courses', 'Courses', 'text-right')}
                                ${th('enrolls', 'Learners', 'text-right')}
                                ${th('certs', 'Certificates', 'text-right')}
                                ${th('rating', 'Rating', 'text-right', 'Weighted by survey responses per course.')}
                                ${th('completion', 'Completion %', 'text-right')}
                                ${th('avgMins', 'Avg time', 'text-right', 'Average time per active learner, across all the provider’s courses.')}
                                ${th('score', 'Score', 'text-right', 'Composite 0–100. Weights: rating 35%, completion 35%, engagement depth 30%. Dimensions with no data are skipped and weights redistributed.')}
                            </tr>
                        </thead>
                        <tbody>
                            ${sorted.map(r => `<tr class="border-b hover:bg-slate-50">
                                <td class="py-2 px-3 text-xs font-bold text-gsf-prussian truncate" title="${this.escapeHtml(r.provider)}">${this.escapeHtml(r.provider)}</td>
                                <td class="py-2 px-3 text-right text-xs text-slate-500">${r.courses}</td>
                                <td class="py-2 px-3 text-right text-xs font-medium">${this.formatNumber(r.enrolls)}</td>
                                <td class="py-2 px-3 text-right text-xs font-medium">${this.formatNumber(r.certs)}</td>
                                <td class="py-2 px-3 text-right text-xs ${r.rating >= 4 ? 'text-green-700 font-bold' : r.rating > 0 ? 'text-slate-700' : 'text-slate-300'}">${r.rating > 0 ? r.rating.toFixed(2) : '—'}</td>
                                <td class="py-2 px-3 text-right text-xs ${r.completion >= 50 ? 'text-green-700 font-bold' : 'text-slate-700'}">${r.completion.toFixed(0)}%</td>
                                <td class="py-2 px-3 text-right text-xs font-medium text-gsf-boston">${this.formatLearningTime(r.avgMins)}</td>
                                <td class="py-2 px-3 text-right text-xs">${scoreBar(r.score)}</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="bg-slate-50 border-t px-5 py-3 text-[11px] text-slate-500">
                    <strong>Score colours:</strong>
                    <span class="text-green-700 font-bold">70+ excellent</span>,
                    <span class="text-blue-700 font-bold">50–69 solid</span>,
                    <span class="text-amber-700 font-bold">30–49 needs attention</span>,
                    <span class="text-red-700 font-bold">&lt;30 critical</span>.
                </div>
            </div>
        `;
    },

    // ── #13 Rating by country / profession (weighted by learner mix) ────
    _renderRatingByGroup(data) {
        const snap = this.getAnalyticsSnap ? this.getAnalyticsSnap() : [];
        if (!snap || snap.length === 0) return '';

        // Build course->rating + course->responses maps
        const courseRating = {};
        const courseResp   = {};
        snap.forEach(d => {
            if (d.Course && Number(d.Rating) > 0) {
                courseRating[d.Course] = Number(d.Rating);
                courseResp[d.Course] = Number(d.Responses) || 0;
            }
        });

        const dim = this._ratingDim;
        const source = dim === 'profession' ? data.profByCourse : data.countryByCourse;
        // For country mode, countryByCourse values are { enrolls, certs }; for prof mode it's a flat number
        const getEnrolls = (entry) => (entry && typeof entry === 'object') ? (entry.enrolls || 0) : (entry || 0);

        const rows = Object.entries(source || {}).map(([group, courseMap]) => {
            let weightedSum = 0, weights = 0, coursesCovered = 0, enrollsCovered = 0;
            Object.entries(courseMap).forEach(([course, entry]) => {
                const r = courseRating[course]; if (!r) return;
                const enrolls = getEnrolls(entry); if (enrolls <= 0) return;
                weightedSum += r * enrolls;
                weights += enrolls;
                coursesCovered++;
                enrollsCovered += enrolls;
            });
            return {
                group,
                rating: weights > 0 ? weightedSum / weights : 0,
                enrolls: enrollsCovered,
                courses: coursesCovered,
            };
        }).filter(r => r.enrolls >= this._engMinEnrolments && r.rating > 0);

        // Sort by rating desc, take top + bottom for the table
        rows.sort((a, b) => b.rating - a.rating);

        // Global benchmark = simple response-weighted average across all courses
        let benchSum = 0, benchW = 0;
        Object.keys(courseRating).forEach(c => {
            const r = courseRating[c]; const w = courseResp[c] || 1;
            benchSum += r * w; benchW += w;
        });
        const benchmark = benchW > 0 ? benchSum / benchW : 0;

        const renderRow = (r) => {
            const delta = r.rating - benchmark;
            const deltaClass = delta >= 0.1 ? 'text-green-700 font-bold' : delta <= -0.1 ? 'text-red-700 font-bold' : 'text-slate-500';
            const deltaStr = (delta >= 0 ? '+' : '') + delta.toFixed(2);
            return `<tr class="border-b hover:bg-slate-50">
                <td class="py-1.5 px-3 text-xs font-medium text-gsf-prussian truncate" title="${this.escapeHtml(r.group)}">${this.escapeHtml(r.group)}</td>
                <td class="py-1.5 px-3 text-right text-xs font-bold text-gsf-boston">${r.rating.toFixed(2)}</td>
                <td class="py-1.5 px-3 text-right text-xs ${deltaClass}">${deltaStr}</td>
                <td class="py-1.5 px-3 text-right text-xs text-slate-500">${this.formatNumber(r.enrolls)}</td>
                <td class="py-1.5 px-3 text-right text-xs text-slate-500">${r.courses}</td>
            </tr>`;
        };

        const top10 = rows.slice(0, 10);
        const bottom10 = rows.slice(-10).reverse();

        return `
            <div id="eng-section-rating" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="bg-slate-50 border-b p-5 flex justify-between items-start gap-4 flex-wrap">
                    <div>
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="star" class="text-gsf-boston"></i> Rating by ${dim === 'profession' ? 'Profession' : 'Country'}</h2>
                        <p class="text-xs text-slate-500 mt-1">Rating-weighted average using each group's learner mix. We don't have per-user ratings — this estimates the experience by the courses they took. <strong>Δ vs benchmark</strong> = rating minus the global response-weighted average (${benchmark.toFixed(2)}).</p>
                    </div>
                    <div class="flex items-center gap-3">
                        <div class="flex items-center gap-2 text-xs">
                            <button onclick="App._setRatingDim('country')" class="px-3 py-1.5 rounded-md font-bold ${dim==='country' ? 'bg-gsf-boston text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">Country</button>
                            <button onclick="App._setRatingDim('profession')" class="px-3 py-1.5 rounded-md font-bold ${dim==='profession' ? 'bg-gsf-boston text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">Profession</button>
                        </div>
                        ${this._engActionBtns('eng-section-rating', 'rating', 'Rating_by_' + (dim === 'profession' ? 'Profession' : 'Country'))}
                    </div>
                </div>
                <div class="p-5">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <h4 class="text-xs font-bold text-green-700 uppercase tracking-wide mb-2">Highest-rated ${dim === 'profession' ? 'professions' : 'countries'}</h4>
                            <div class="border rounded-lg overflow-hidden">
                                <table class="w-full text-xs">
                                    <thead class="text-slate-500 border-b bg-slate-50"><tr>
                                        <th class="py-2 px-3 font-medium text-left">${dim === 'profession' ? 'Profession' : 'Country'}</th>
                                        <th class="py-2 px-3 font-medium text-right">Rating</th>
                                        <th class="py-2 px-3 font-medium text-right">Δ vs bench</th>
                                        <th class="py-2 px-3 font-medium text-right">Learners</th>
                                        <th class="py-2 px-3 font-medium text-right">Courses</th>
                                    </tr></thead>
                                    <tbody>${top10.length === 0 ? '<tr><td colspan="5" class="py-4 text-center text-slate-400 italic">No groups meet the minimum-learners filter.</td></tr>' : top10.map(renderRow).join('')}</tbody>
                                </table>
                            </div>
                        </div>
                        <div>
                            <h4 class="text-xs font-bold text-red-700 uppercase tracking-wide mb-2">Lowest-rated ${dim === 'profession' ? 'professions' : 'countries'}</h4>
                            <div class="border rounded-lg overflow-hidden">
                                <table class="w-full text-xs">
                                    <thead class="text-slate-500 border-b bg-slate-50"><tr>
                                        <th class="py-2 px-3 font-medium text-left">${dim === 'profession' ? 'Profession' : 'Country'}</th>
                                        <th class="py-2 px-3 font-medium text-right">Rating</th>
                                        <th class="py-2 px-3 font-medium text-right">Δ vs bench</th>
                                        <th class="py-2 px-3 font-medium text-right">Learners</th>
                                        <th class="py-2 px-3 font-medium text-right">Courses</th>
                                    </tr></thead>
                                    <tbody>${bottom10.length === 0 ? '<tr><td colspan="5" class="py-4 text-center text-slate-400 italic">—</td></tr>' : bottom10.map(renderRow).join('')}</tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                    <p class="text-[11px] text-slate-400 italic mt-3">
                        Method: Σ(course_rating × group_enrolments) / Σ(group_enrolments). A group's score reflects the rating of the courses its learners chose, not direct user surveys. The benchmark line uses response-weighted course ratings as the reference.
                    </p>
                </div>
            </div>
        `;
    },
});
