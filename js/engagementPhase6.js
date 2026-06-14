// Phase 6 — Course Completion Detail analyses.
// Built on the surghub_completion dataset (uploaded via Data Sync Step 6).
//
// Sections added:
//   1. Time-to-completion per course   — median / p25 / p75 / p90 days from start → cert
//   2. Drop-off funnel per course      — Enrolled → Started → Engaged → Completed → Certified
//   3. Cohort retention                — monthly signup cohorts, % active and % certified to date
//
// All three derive from per-(user, course) records with start_date, completion_date,
// time_minutes, certificate, certificate_date. Cohorts are bucketed by start_month
// (LearnWorlds course-start, not platform signup).

Object.assign(window.App, {

    _completionCourseSortCol: 'p75Days',
    _completionCourseSortAsc: true,
    _sortCompletionCourse(col) {
        if (this._completionCourseSortCol === col) this._completionCourseSortAsc = !this._completionCourseSortAsc;
        else {
            this._completionCourseSortCol = col;
            this._completionCourseSortAsc = (col === 'course');
        }
        this._refreshEngagementSection();
    },

    _funnelSortCol: 'completionRate',
    _funnelSortAsc: false,
    _sortFunnel(col) {
        if (this._funnelSortCol === col) this._funnelSortAsc = !this._funnelSortAsc;
        else {
            this._funnelSortCol = col;
            this._funnelSortAsc = (col === 'course');
        }
        this._refreshEngagementSection();
    },

    // Helper — percentile of a sorted numeric array
    _percentile(sortedNums, p) {
        if (!sortedNums || sortedNums.length === 0) return 0;
        const idx = Math.min(sortedNums.length - 1, Math.max(0, Math.floor((p / 100) * sortedNums.length)));
        return sortedNums[idx];
    },

    _daysBetween(startISO, endISO) {
        if (!startISO || !endISO) return null;
        const s = new Date(startISO + 'T00:00:00');
        const e = new Date(endISO + 'T00:00:00');
        if (isNaN(s) || isNaN(e)) return null;
        return Math.round((e - s) / 86400000);
    },

    _computeCompletionAggregates() {
        const completion = this._rawCompletion || [];
        if (completion.length === 0) return null;

        // Per-course aggregation
        const byCourse = {};
        completion.forEach(r => {
            const c = r.course; if (!c) return;
            const agg = byCourse[c] = byCourse[c] || {
                course: c,
                enrolled: 0,
                started: 0,
                engaged: 0,
                completed: 0,
                certified: 0,
                daysToCompletion: [],
                totalMinutes: 0,
                avgScoreSum: 0,
                avgScoreCount: 0,
            };
            agg.enrolled++;
            if (r.start_date) agg.started++;
            if ((r.time_minutes || 0) >= 30) agg.engaged++;
            if (r.completed) agg.completed++;
            if (r.certificate) {
                agg.certified++;
                // Time-to-completion = days from start to certificate (preferred) or completion date
                const endIso = r.certificate_date || r.completion_date;
                const days = this._daysBetween(r.start_date, endIso);
                if (days !== null && days >= 0) agg.daysToCompletion.push(days);
            }
            agg.totalMinutes += Number(r.time_minutes) || 0;
            if (Number(r.score) > 0) { agg.avgScoreSum += Number(r.score); agg.avgScoreCount++; }
        });

        const courseRows = Object.values(byCourse).map(a => {
            const days = a.daysToCompletion.slice().sort((x, y) => x - y);
            return {
                course: a.course,
                enrolled: a.enrolled,
                started: a.started,
                engaged: a.engaged,
                completed: a.completed,
                certified: a.certified,
                startRate:      a.enrolled  > 0 ? (a.started   / a.enrolled) * 100 : 0,
                engagedRate:    a.enrolled  > 0 ? (a.engaged   / a.enrolled) * 100 : 0,
                completionRate: a.enrolled  > 0 ? (a.completed / a.enrolled) * 100 : 0,
                certRate:       a.enrolled  > 0 ? (a.certified / a.enrolled) * 100 : 0,
                medianDays:    this._percentile(days, 50),
                p25Days:       this._percentile(days, 25),
                p75Days:       this._percentile(days, 75),
                p90Days:       this._percentile(days, 90),
                avgMinutes:    a.enrolled > 0 ? a.totalMinutes / a.enrolled : 0,
                avgScore:      a.avgScoreCount > 0 ? a.avgScoreSum / a.avgScoreCount : 0,
                certSampleSize: days.length,
            };
        });

        // Cohort retention — group by start_month
        const cohortMap = {};
        completion.forEach(r => {
            const m = r.start_month; if (!m) return;
            const c = cohortMap[m] = cohortMap[m] || { month: m, enrolled: 0, started: 0, engaged: 0, completed: 0, certified: 0, users: new Set() };
            c.enrolled++;
            if (r.uid) c.users.add(r.uid);
            if (r.start_date) c.started++;
            if ((r.time_minutes || 0) >= 30) c.engaged++;
            if (r.completed) c.completed++;
            if (r.certificate) c.certified++;
        });
        const cohorts = Object.values(cohortMap)
            .map(c => ({
                month: c.month,
                enrolments: c.enrolled,
                uniqueUsers: c.users.size,
                started: c.started,
                engaged: c.engaged,
                completed: c.completed,
                certified: c.certified,
                startRate: c.enrolled > 0 ? (c.started / c.enrolled) * 100 : 0,
                engagedRate: c.enrolled > 0 ? (c.engaged / c.enrolled) * 100 : 0,
                completionRate: c.enrolled > 0 ? (c.completed / c.enrolled) * 100 : 0,
                certRate: c.enrolled > 0 ? (c.certified / c.enrolled) * 100 : 0,
            }))
            .sort((a, b) => a.month.localeCompare(b.month));

        // Overall funnel
        const overall = completion.reduce((acc, r) => {
            acc.enrolled++;
            if (r.start_date) acc.started++;
            if ((r.time_minutes || 0) >= 30) acc.engaged++;
            if (r.completed) acc.completed++;
            if (r.certificate) acc.certified++;
            return acc;
        }, { enrolled: 0, started: 0, engaged: 0, completed: 0, certified: 0 });

        return { courseRows, cohorts, overall };
    },

    _renderCourseCompletionAnalyses() {
        const data = this._computeCompletionAggregates();
        if (!data) {
            return `
                <div id="eng-section-completion" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                    <div class="bg-slate-50 border-b p-5">
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="clipboard-list" class="text-gsf-boston"></i> Course Completion Detail</h2>
                    </div>
                    <div class="p-8 text-center">
                        <p class="text-sm text-slate-600 mb-2">No course-completion data uploaded yet.</p>
                        <p class="text-xs text-slate-400">Run <strong>Step 6 (Course Completion Detail)</strong> on the Data Sync page to enable time-to-completion, drop-off funnel, and cohort retention.</p>
                    </div>
                </div>
            `;
        }

        return `
            ${this._renderCompletionFunnel(data)}
            ${this._renderTimeToCompletion(data)}
            ${this._renderCohortRetention(data)}
        `;
    },

    // ── 1. Drop-off funnel ─────────────────────────────────────────────────
    _renderCompletionFunnel(data) {
        const { overall, courseRows } = data;
        const stages = [
            { key: 'enrolled',  label: 'Enrolled',  color: '#cbd5e1' },
            { key: 'started',   label: 'Started',   color: '#7A9E9F' },
            { key: 'engaged',   label: 'Engaged (≥30 min)', color: '#4389C8' },
            { key: 'completed', label: 'Completed', color: '#1a5276' },
            { key: 'certified', label: 'Certified', color: '#16a34a' },
        ];
        const maxVal = overall.enrolled || 1;

        // Sortable course table
        const col = this._funnelSortCol;
        const asc = this._funnelSortAsc;
        const rows = courseRows.slice().filter(r => r.enrolled >= 10).sort((a, b) => {
            let va = a[col], vb = b[col];
            if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb || '').toLowerCase(); }
            else { va = Number(va) || 0; vb = Number(vb) || 0; }
            if (va < vb) return asc ? -1 : 1;
            if (va > vb) return asc ? 1 : -1;
            return 0;
        });

        const arrow = (c) => col === c ? (asc ? '&#9650;' : '&#9660;') : '<span class="text-slate-300">&#8597;</span>';
        const th = (key, label, align) =>
            `<th class="py-2 px-3 font-medium ${align||''} cursor-pointer hover:text-gsf-boston select-none" onclick="App._sortFunnel('${key}')">${label} ${arrow(key)}</th>`;

        return `
            <div id="eng-section-funnel" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="bg-slate-50 border-b p-5 flex justify-between items-start gap-4 flex-wrap">
                    <div>
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="git-pull-request-arrow" class="text-gsf-boston"></i> Drop-Off Funnel</h2>
                        <p class="text-xs text-slate-500 mt-1">Where learners leak between Enrolled and Certified. Stages: <em>Enrolled</em> (signed up) → <em>Started</em> (have a start date) → <em>Engaged</em> (≥30 minutes invested) → <em>Completed</em> (LearnWorlds completion flag) → <em>Certified</em>.</p>
                    </div>
                    ${this._engActionBtns('eng-section-funnel', 'funnel', 'Drop_Off_Funnel')}
                </div>
                <div class="p-5">
                    <!-- Overall funnel visual -->
                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Platform-wide funnel</h4>
                    <div class="space-y-2 mb-6">
                        ${stages.map((s, i) => {
                            const n = overall[s.key] || 0;
                            const pct = maxVal > 0 ? (n / maxVal) * 100 : 0;
                            const dropFromPrev = i === 0 ? null : (() => {
                                const prev = overall[stages[i-1].key] || 0;
                                if (prev === 0) return null;
                                const dropPct = ((prev - n) / prev) * 100;
                                return dropPct;
                            })();
                            return `<div class="flex items-center gap-3">
                                <div class="w-32 text-xs font-bold text-gsf-prussian shrink-0">${s.label}</div>
                                <div class="flex-1 h-7 bg-slate-100 rounded-md overflow-hidden relative">
                                    <div class="h-full flex items-center px-3 text-xs font-bold text-white" style="width:${Math.max(pct, 8)}%; background:${s.color}">${pct.toFixed(0)}%</div>
                                </div>
                                <div class="w-28 text-right text-xs font-medium text-slate-700 shrink-0">${this.formatNumber(n)}</div>
                                <div class="w-20 text-right text-xs shrink-0 ${dropFromPrev !== null ? (dropFromPrev > 50 ? 'text-red-700 font-bold' : dropFromPrev > 20 ? 'text-amber-700' : 'text-slate-400') : 'text-slate-300'}">
                                    ${dropFromPrev !== null ? '−' + dropFromPrev.toFixed(0) + '%' : '—'}
                                </div>
                            </div>`;
                        }).join('')}
                    </div>

                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Per-course funnel <span class="font-normal text-slate-400">(min 10 learners)</span></h4>
                    <div class="border rounded-lg overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar">
                        <table class="w-full text-xs">
                            <thead class="sticky top-0 bg-white shadow-sm z-10 text-slate-500 border-b">
                                <tr>
                                    ${th('course', 'Course', 'text-left')}
                                    ${th('enrolled', 'Enrolled', 'text-right')}
                                    ${th('startRate', 'Start %', 'text-right')}
                                    ${th('engagedRate', 'Engaged %', 'text-right')}
                                    ${th('completionRate', 'Completion %', 'text-right')}
                                    ${th('certRate', 'Cert %', 'text-right')}
                                </tr>
                            </thead>
                            <tbody>
                                ${rows.length === 0
                                    ? '<tr><td colspan="6" class="py-4 text-center text-slate-400 italic">No courses meet the minimum-learners filter.</td></tr>'
                                    : rows.map(r => `<tr class="border-b hover:bg-slate-50">
                                        <td class="py-1.5 px-3 font-medium text-gsf-prussian truncate" title="${this.escapeHtml(r.course)}" style="max-width:280px">${this.escapeHtml(r.course)}</td>
                                        <td class="py-1.5 px-3 text-right font-medium">${this.formatNumber(r.enrolled)}</td>
                                        <td class="py-1.5 px-3 text-right ${r.startRate >= 80 ? 'text-green-700 font-bold' : r.startRate >= 50 ? 'text-slate-700' : 'text-amber-700'}">${r.startRate.toFixed(0)}%</td>
                                        <td class="py-1.5 px-3 text-right ${r.engagedRate >= 50 ? 'text-green-700 font-bold' : 'text-slate-700'}">${r.engagedRate.toFixed(0)}%</td>
                                        <td class="py-1.5 px-3 text-right ${r.completionRate >= 40 ? 'text-green-700 font-bold' : r.completionRate >= 20 ? 'text-slate-700' : 'text-amber-700'}">${r.completionRate.toFixed(0)}%</td>
                                        <td class="py-1.5 px-3 text-right font-bold ${r.certRate >= 30 ? 'text-green-700' : r.certRate >= 15 ? 'text-gsf-boston' : 'text-amber-700'}">${r.certRate.toFixed(0)}%</td>
                                    </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    },

    // ── 2. Time-to-completion ──────────────────────────────────────────────
    _renderTimeToCompletion(data) {
        const col = this._completionCourseSortCol;
        const asc = this._completionCourseSortAsc;
        const rows = data.courseRows.slice()
            .filter(r => r.certSampleSize >= 5) // need a few certs for percentiles to mean anything
            .sort((a, b) => {
                let va = a[col], vb = b[col];
                if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb || '').toLowerCase(); }
                else { va = Number(va) || 0; vb = Number(vb) || 0; }
                if (va < vb) return asc ? -1 : 1;
                if (va > vb) return asc ? 1 : -1;
                return 0;
            });

        if (rows.length === 0) {
            return `
                <div id="eng-section-tte" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                    <div class="bg-slate-50 border-b p-5">
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="timer" class="text-gsf-boston"></i> Time-to-Completion</h2>
                    </div>
                    <div class="p-8 text-center text-sm text-slate-400 italic">No courses have ≥5 certified learners yet — percentiles need a minimum sample.</div>
                </div>
            `;
        }

        const arrow = (c) => col === c ? (asc ? '&#9650;' : '&#9660;') : '<span class="text-slate-300">&#8597;</span>';
        const th = (key, label, align) =>
            `<th class="py-2 px-3 font-medium ${align||''} cursor-pointer hover:text-gsf-boston select-none" onclick="App._sortCompletionCourse('${key}')">${label} ${arrow(key)}</th>`;

        const fmtDays = (n) => {
            if (!n) return '—';
            if (n < 1) return '<1 day';
            if (n < 30) return `${Math.round(n)} d`;
            return `${(n / 30).toFixed(1)} mo`;
        };

        return `
            <div id="eng-section-tte" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="bg-slate-50 border-b p-5 flex justify-between items-start gap-4 flex-wrap">
                    <div>
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="timer" class="text-gsf-boston"></i> Time-to-Completion</h2>
                        <p class="text-xs text-slate-500 mt-1">Days from course start to certificate. p75 = three in four completers finish within this; p90 is the long tail.</p>
                    </div>
                    ${this._engActionBtns('eng-section-tte', 'tte', 'Time_To_Completion')}
                </div>
                <div class="overflow-x-auto max-h-[600px] overflow-y-auto custom-scrollbar">
                    <table class="w-full text-xs">
                        <thead class="sticky top-0 bg-white shadow-sm z-10 text-slate-500 border-b">
                            <tr>
                                ${th('course', 'Course', 'text-left')}
                                ${th('certSampleSize', 'Certified n', 'text-right')}
                                ${th('p75Days', 'p75', 'text-right')}
                                ${th('p90Days', 'p90 (long tail)', 'text-right')}
                                ${th('avgScore', 'Avg score', 'text-right')}
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(r => `<tr class="border-b hover:bg-slate-50">
                                <td class="py-1.5 px-3 font-medium text-gsf-prussian truncate" title="${this.escapeHtml(r.course)}" style="max-width:280px">${this.escapeHtml(r.course)}</td>
                                <td class="py-1.5 px-3 text-right text-slate-500">${this.formatNumber(r.certSampleSize)}</td>
                                <td class="py-1.5 px-3 text-right font-bold text-gsf-boston">${fmtDays(r.p75Days)}</td>
                                <td class="py-1.5 px-3 text-right text-slate-500">${fmtDays(r.p90Days)}</td>
                                <td class="py-1.5 px-3 text-right ${r.avgScore >= 80 ? 'text-green-700 font-bold' : r.avgScore >= 60 ? 'text-slate-700' : 'text-amber-700'}">${r.avgScore > 0 ? r.avgScore.toFixed(0) : '—'}</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    // ── 3. Cohort retention ────────────────────────────────────────────────
    _renderCohortRetention(data) {
        const cohorts = data.cohorts.slice();
        if (cohorts.length === 0) return '';

        // Show monthly cohorts. Recent cohorts will have lower completion (less time elapsed)
        // — keep that in mind when reading the table. Show last 18 months by default.
        const last18 = cohorts.slice(-18);

        return `
            <div id="eng-section-cohort" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="bg-slate-50 border-b p-5 flex justify-between items-start gap-4 flex-wrap">
                    <div>
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="layout-grid" class="text-gsf-boston"></i> Cohort Progress</h2>
                        <p class="text-xs text-slate-500 mt-1">Monthly cohorts based on <em>course start month</em>. Each row shows how that cohort has progressed through the funnel as of today.</p>
                        <p class="text-[11px] text-amber-700 italic mt-1">⚠ Recent cohorts will show lower completion/cert rates simply because less time has passed. The trend matters more than the absolute numbers for newer rows.</p>
                    </div>
                    ${this._engActionBtns('eng-section-cohort', 'cohort', 'Cohort_Progress')}
                </div>
                <div class="overflow-x-auto max-h-[600px] overflow-y-auto custom-scrollbar">
                    <table class="w-full text-xs">
                        <thead class="sticky top-0 bg-white shadow-sm z-10 text-slate-500 border-b">
                            <tr>
                                <th class="py-2 px-3 font-medium text-left">Cohort (course start month)</th>
                                <th class="py-2 px-3 font-medium text-right">Learners</th>
                                <th class="py-2 px-3 font-medium text-right">Unique users</th>
                                <th class="py-2 px-3 font-medium text-right">Engaged %</th>
                                <th class="py-2 px-3 font-medium text-right">Completion %</th>
                                <th class="py-2 px-3 font-medium text-right">Cert %</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${last18.map(c => `<tr class="border-b hover:bg-slate-50">
                                <td class="py-1.5 px-3 font-medium text-gsf-prussian">${this.escapeHtml(this._formatCohortMonth(c.month))}</td>
                                <td class="py-1.5 px-3 text-right font-medium">${this.formatNumber(c.enrolments)}</td>
                                <td class="py-1.5 px-3 text-right text-slate-500">${this.formatNumber(c.uniqueUsers)}</td>
                                <td class="py-1.5 px-3 text-right ${c.engagedRate >= 50 ? 'text-green-700 font-bold' : 'text-slate-700'}">${c.engagedRate.toFixed(0)}%</td>
                                <td class="py-1.5 px-3 text-right ${c.completionRate >= 40 ? 'text-green-700 font-bold' : c.completionRate >= 20 ? 'text-slate-700' : 'text-amber-700'}">${c.completionRate.toFixed(0)}%</td>
                                <td class="py-1.5 px-3 text-right font-bold ${c.certRate >= 30 ? 'text-green-700' : c.certRate >= 15 ? 'text-gsf-boston' : 'text-amber-700'}">${c.certRate.toFixed(0)}%</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="bg-slate-50 border-t px-5 py-3 text-[11px] text-slate-500">
                    Showing last 18 monthly cohorts. CSV export contains the full history.
                </div>
            </div>
        `;
    },

    _formatCohortMonth(yyyymm) {
        if (!yyyymm) return '';
        const [y, m] = yyyymm.split('-');
        const d = new Date(Number(y), Number(m) - 1, 1);
        return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    },
});
