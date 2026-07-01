// Engagement Analysis — derives cross-tabbed insights from anonymized user records.
// Adds 4 sections to the Audience tab:
//   1. Country Engagement table  — which countries are most engaged per learner
//   2. Engagement Segments       — distribution of users by total learning minutes
//   3. Profession × Course       — heatmap of top professions vs top courses
//   4. Country × Course top-5    — top 5 courses per country
//
// All numbers are computed from `App._rawAnonymizedUsers` (one record per
// user-course learner) joined with `AllCountryStats` from the audience snapshot
// for the "registered users" headcount.

Object.assign(window.App, {
    // ── Sort + filter state for the Country Engagement table ─────────────
    _engCountrySortCol: 'enrolls',
    _engCountrySortAsc: false,
    _engMinEnrolments: 25,   // hide noisy long-tail
    _engSegBy: 'overall',    // 'overall' | 'country' | 'profession'

    _sortEngCountry(col) {
        if (this._engCountrySortCol === col) this._engCountrySortAsc = !this._engCountrySortAsc;
        else { this._engCountrySortCol = col; this._engCountrySortAsc = (col === 'country'); }
        this._refreshEngagementSection();
    },
    _setEngMinEnrolments(val) {
        this._engMinEnrolments = Math.max(0, Number(val) || 0);
        this._refreshEngagementSection();
    },
    _setEngSegBy(val) {
        this._engSegBy = val;
        this._refreshEngagementSection();
    },
    _refreshEngagementSection() {
        const el = document.getElementById('engagement-analysis');
        if (el) el.innerHTML = this._renderEngagementAnalysis(true, this._engCurrentGroup);
        if (window.lucide) lucide.createIcons();
        // Redraw embedded Google charts after the HTML swap
        setTimeout(() => {
            if (this._drawImpactMap)            this._drawImpactMap();
            if (this._drawReachGapMap)          this._drawReachGapMap();
            if (this._drawGrowthForecastChart)  this._drawGrowthForecastChart();
        }, 60);
    },

    // ── Action toolbar helpers (copy PNG, download PNG, download CSV) ─────
    _engActionBtns(sectionId, csvKind, csvName, clip) {
        const c = clip ? ', true' : '';
        return `<div class="flex items-center gap-1">
            <button onclick="App._copyEngagementSection('${sectionId}', this${c})" title="Copy section as PNG" class="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-gsf-boston"><i data-lucide="copy" width="13"></i></button>
            <button onclick="App._downloadEngagementSection('${sectionId}', '${csvName}'${c})" title="Download PNG" class="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-gsf-boston"><i data-lucide="image" width="13"></i></button>
            <button onclick="App._exportEngagementCsv('${csvKind}', '${csvName}')" title="Download CSV" class="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-gsf-boston"><i data-lucide="file-spreadsheet" width="13"></i></button>
        </div>`;
    },

    // Render the section to a canvas with capture-mode CSS applied
    async _captureEngagementSection(el, clip) {
        // clip=true → capture roughly what's on screen (keep inner scroll areas at their
        // capped height) instead of expanding every row, which makes an unusably tall
        // image for long tables. clip=false (default) → expand everything, open <details>.
        let dets = [], wasOpen = [], scrollers = [];
        if (!clip) {
            el.classList.add('eng-capture-mode');
            dets = [].slice.call(el.querySelectorAll('details'));
            wasOpen = dets.map(d => d.open);
            dets.forEach(d => { d.open = true; });
        } else {
            scrollers = [].slice.call(el.querySelectorAll('[class*="overflow-y-auto"]'));
            scrollers.forEach(s => { s.__ov = s.style.overflowY; s.style.overflowY = 'hidden'; });
        }
        // Give the browser a beat to re-layout with the capture styles before snapshotting
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        try {
            const h = clip ? el.clientHeight : el.scrollHeight;
            return await window.html2canvas(el, {
                scale: 3,
                backgroundColor: '#ffffff',
                useCORS: true,
                width: el.scrollWidth,
                height: h,
                windowWidth: el.scrollWidth + 40,
                windowHeight: Math.max(window.innerHeight, h + 40),
            });
        } finally {
            if (!clip) { el.classList.remove('eng-capture-mode'); dets.forEach((d, i) => { d.open = wasOpen[i]; }); }
            else { scrollers.forEach(s => { s.style.overflowY = s.__ov || ''; delete s.__ov; }); }
        }
    },

    async _copyEngagementSection(sectionId, btn, clip) {
        const el = document.getElementById(sectionId);
        if (!el || !window.html2canvas) return;
        try {
            const canvas = await this._captureEngagementSection(el, clip);
            const uri = canvas.toDataURL('image/png');
            if (window.electronAPI && electronAPI.invoke) {
                await electronAPI.invoke('clipboard-write-image', uri);
            }
            if (btn) {
                const orig = btn.innerHTML;
                btn.innerHTML = '<span class="text-[10px] font-bold text-green-600">✓</span>';
                setTimeout(() => { btn.innerHTML = orig; if (window.lucide) lucide.createIcons(); }, 1200);
            }
        } catch (e) { console.error('Copy section failed:', e); }
    },

    async _downloadEngagementSection(sectionId, name, clip) {
        const el = document.getElementById(sectionId);
        if (!el || !window.html2canvas) return;
        try {
            const canvas = await this._captureEngagementSection(el, clip);
            const uri = canvas.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = uri;
            a.download = (name || sectionId).replace(/[^a-zA-Z0-9_-]/g, '_') + '.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (e) { console.error('Download section failed:', e); }
    },

    _csvCell(v) {
        if (v === null || v === undefined) return '';
        const s = String(v);
        if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    },

    _downloadCsv(rows, name) {
        const csv = rows.map(r => r.map(c => this._csvCell(c)).join(',')).join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }); // BOM for Excel
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (name || 'export').replace(/[^a-zA-Z0-9_-]/g, '_') + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    _exportEngagementCsv(kind, name) {
        const data = this._computeEngagement();
        if (!data) return;
        let rows = [];

        if (kind === 'country') {
            rows.push(['# Coverage', 'Users with country', data.usersWithCountry, 'Total platform users', data.totalUsersPlatform, 'Coverage %', data.totalUsersPlatform > 0 ? ((data.usersWithCountry/data.totalUsersPlatform)*100).toFixed(1) : '']);
            rows.push([]);
            rows.push(['Country', 'Registered Users', 'Learners', 'Active Learners', 'Active %', 'Avg minutes / active', 'Certificates', 'Completion %']);
            Object.entries(data.byCountry)
                .filter(([_, v]) => v.enrolls >= this._engMinEnrolments)
                .forEach(([country, v]) => {
                    const activePct = v.enrolls > 0 ? (v.active / v.enrolls) * 100 : 0;
                    const avgMins = v.active > 0 ? v.totalMins / v.active : 0;
                    const completion = v.enrolls > 0 ? (v.certs / v.enrolls) * 100 : 0;
                    rows.push([country, data.countryUsers[country] || 0, v.enrolls, v.active, activePct.toFixed(1), avgMins.toFixed(1), v.certs, completion.toFixed(1)]);
                });
            // Unknown / unreported transparency row
            if (data.unknownAgg && data.unknownAgg.enrolls > 0) {
                const u = data.unknownAgg;
                const activePct = u.enrolls > 0 ? (u.active / u.enrolls) * 100 : 0;
                const avgMins = u.active > 0 ? u.totalMins / u.active : 0;
                const completion = u.enrolls > 0 ? (u.certs / u.enrolls) * 100 : 0;
                rows.push(['Unknown / unreported', data.usersUnknown || 0, u.enrolls, u.active, activePct.toFixed(1), avgMins.toFixed(1), u.certs, completion.toFixed(1)]);
            }
        }
        else if (kind === 'segments') {
            rows.push(['Segment Definition', 'Ghost = 0 min', 'Explorer = 1-30 min', 'Engaged = 30-300 min', 'Power = 300+ min']);
            rows.push([]);
            rows.push(['Group', 'Total Learners', 'Ghost', 'Explorer', 'Engaged', 'Power', 'Engaged+Power %']);
            const total = (c) => c.ghost + c.explorer + c.engaged + c.power;
            const engPct = (c) => { const t = total(c); return t > 0 ? (((c.engaged + c.power) / t) * 100).toFixed(1) : '0.0'; };
            rows.push(['Platform-wide', total(data.segCounts), data.segCounts.ghost, data.segCounts.explorer, data.segCounts.engaged, data.segCounts.power, engPct(data.segCounts)]);
            rows.push([]);
            rows.push(['── By Country ──']);
            Object.entries(data.segByCountry)
                .filter(([_, c]) => total(c) >= this._engMinEnrolments)
                .sort((a, b) => total(b[1]) - total(a[1]))
                .forEach(([k, c]) => rows.push([k, total(c), c.ghost, c.explorer, c.engaged, c.power, engPct(c)]));
            rows.push([]);
            rows.push(['── By Profession ──']);
            Object.entries(data.segByProf)
                .filter(([_, c]) => total(c) >= this._engMinEnrolments)
                .sort((a, b) => total(b[1]) - total(a[1]))
                .forEach(([k, c]) => rows.push([k, total(c), c.ghost, c.explorer, c.engaged, c.power, engPct(c)]));
        }
        else if (kind === 'profcourse') {
            const N_PROF = 10, N_COURSE = 10;
            const topProfs = Object.entries(data.profTotals).sort((a,b) => b[1]-a[1]).slice(0, N_PROF).map(([k]) => k);
            const topCourses = Object.entries(data.courseTotals).sort((a,b) => b[1]-a[1]).slice(0, N_COURSE).map(([k]) => k);
            rows.push(['Profession', ...topCourses, 'Total']);
            topProfs.forEach(p => {
                const row = [p];
                topCourses.forEach(c => row.push((data.profByCourse[p] && data.profByCourse[p][c]) || 0));
                row.push(data.profTotals[p] || 0);
                rows.push(row);
            });
            rows.push(['Course Total', ...topCourses.map(c => data.courseTotals[c] || 0), '']);
        }
        else if (kind === 'gender') {
            rows.push(['Gender', 'Learners', 'Active', 'Active %', 'Avg minutes / active', 'Certificates', 'Completion %']);
            ['Female', 'Male', 'Other / prefer not to say', 'Not declared'].forEach(k => {
                const v = data.byGender[k]; if (!v || v.enrolls === 0) return;
                const activePct = v.enrolls > 0 ? (v.active / v.enrolls) * 100 : 0;
                const avgMins = v.active > 0 ? v.totalMins / v.active : 0;
                const compl = v.enrolls > 0 ? (v.certs / v.enrolls) * 100 : 0;
                rows.push([k, v.enrolls, v.active, activePct.toFixed(1), avgMins.toFixed(1), v.certs, compl.toFixed(1)]);
            });
        }
        else if (kind === 'org') {
            rows.push(['Organisation type', 'Learners', 'Active', 'Active %', 'Avg minutes / active', 'Certificates', 'Completion %']);
            Object.entries(data.byOrg)
                .filter(([, v]) => v.enrolls > 0)
                .sort((a, b) => b[1].enrolls - a[1].enrolls)
                .forEach(([k, v]) => {
                    const activePct = v.enrolls > 0 ? (v.active / v.enrolls) * 100 : 0;
                    const avgMins = v.active > 0 ? v.totalMins / v.active : 0;
                    const compl = v.enrolls > 0 ? (v.certs / v.enrolls) * 100 : 0;
                    rows.push([k, v.enrolls, v.active, activePct.toFixed(1), avgMins.toFixed(1), v.certs, compl.toFixed(1)]);
                });
        }
        else if (kind === 'prof') {
            // Mirror the rendered Profession/Cadre table.
            if (data.byCadreAuth && Object.keys(data.byCadreAuth).length) {
                const total = Object.values(data.byCadreAuth).reduce((s, n) => s + (Number(n) || 0), 0);
                rows.push(['# Cadre from survey tag (Q3), extrapolated to the full learner base', 'Total learners', Math.round(total), 'Answered Q3', data.activityKnownCount || 0]);
                rows.push([]);
                rows.push(['Profession / cadre', 'Learners', '% of learners']);
                Object.entries(data.byCadreAuth)
                    .sort((a, b) => b[1] - a[1])
                    .forEach(([k, v]) => rows.push([k, Math.round(v), total > 0 ? ((v / total) * 100).toFixed(1) : '0.0']));
            } else {
                rows.push(['Profession / cadre', 'Learners', 'Enrolments']);
                Object.entries(data.byProf || {})
                    .filter(([, v]) => (v.enrolls || 0) > 0)
                    .sort((a, b) => (b[1].users || 0) - (a[1].users || 0))
                    .forEach(([k, v]) => rows.push([k, v.users || 0, v.enrolls || 0]));
            }
        }
        else if (kind === 'power') {
            if (!data.hasUserFields) {
                rows.push(['Per-user analytics not available — re-run Step 4 (Learner Demographics) to backfill user-level fields.']);
            } else {
                const users = Object.values(data.perUser);
                const sortedCerts = users.map(u => u.certs).sort((a, b) => b - a);
                const cutIdx = Math.max(0, Math.floor(users.length * 0.05) - 1);
                const threshold = Math.max(3, sortedCerts[cutIdx] || 3);
                rows.push(['# Power-user threshold', threshold + ' certs', 'Total users', users.length, 'Power users', users.filter(u => u.certs >= threshold).length]);
                rows.push([]);
                rows.push(['Certificates earned', 'Users']);
                const buckets = { '0': 0, '1': 0, '2': 0, '3-4': 0, '5-9': 0, '10+': 0 };
                users.forEach(u => {
                    if      (u.certs === 0) buckets['0']++;
                    else if (u.certs === 1) buckets['1']++;
                    else if (u.certs === 2) buckets['2']++;
                    else if (u.certs <= 4)  buckets['3-4']++;
                    else if (u.certs <= 9)  buckets['5-9']++;
                    else                    buckets['10+']++;
                });
                Object.entries(buckets).forEach(([k, n]) => rows.push([k, n]));
            }
        }
        else if (kind === 'impactmap') {
            const metricLabel = ({ avgMins: 'Avg minutes/active', completion: 'Completion %', activePct: 'Active %', enrolls: 'Learners' })[this._impactMapMetric] || this._impactMapMetric;
            rows.push(['# Metric shown on map', metricLabel, 'Min learners threshold', this._impactMapMin]);
            rows.push([]);
            rows.push(['Country', 'Learners', 'Active', 'Active %', 'Avg minutes / active', 'Certificates', 'Completion %']);
            Object.entries(data.byCountry)
                .filter(([, v]) => v.enrolls >= this._impactMapMin)
                .sort((a, b) => b[1].enrolls - a[1].enrolls)
                .forEach(([c, v]) => {
                    const activePct = v.enrolls > 0 ? (v.active / v.enrolls) * 100 : 0;
                    const avgMins = v.active > 0 ? v.totalMins / v.active : 0;
                    const compl = v.enrolls > 0 ? (v.certs / v.enrolls) * 100 : 0;
                    rows.push([c, v.enrolls, v.active, activePct.toFixed(1), avgMins.toFixed(1), v.certs, compl.toFixed(1)]);
                });
        }
        else if (kind === 'reachgap') {
            if (!window.IncomeClassification) { this._downloadCsv([['Income classification not loaded']], name); return; }
            const IC = window.IncomeClassification;
            const priorityList = IC.priorityCountries ? IC.priorityCountries() : [];
            rows.push(['Country', 'Status', 'Learners', 'Certificates', 'Completion %', 'Income tier']);
            priorityList.forEach(c => {
                const v = data.byCountry[c] || { enrolls: 0, certs: 0 };
                const compl = v.enrolls > 0 ? ((v.certs / v.enrolls) * 100).toFixed(1) : '0.0';
                const status = v.enrolls === 0 ? 'Unreached' : v.enrolls < 25 ? 'Underreached' : 'Reached';
                rows.push([c, status, v.enrolls, v.certs, compl, IC.label(IC.classify(c))]);
            });
        }
        else if (kind === 'income') {
            if (window.IncomeClassification) {
                const IC = window.IncomeClassification;
                rows.push(['Income tier', 'Countries', 'Learners', 'Active', 'Active %', 'Avg minutes / active', 'Certificates', 'Completion %']);
                ['LIC', 'LMIC', 'UMIC', 'HIC', 'Unknown'].forEach(t => {
                    const v = data.byIncome[t]; if (!v || v.enrolls === 0) return;
                    const activePct = v.enrolls > 0 ? (v.active / v.enrolls) * 100 : 0;
                    const avgMins = v.active > 0 ? v.totalMins / v.active : 0;
                    const compl = v.enrolls > 0 ? (v.certs / v.enrolls) * 100 : 0;
                    rows.push([IC.label(t), data.incomeCountryCount[t] || 0, v.enrolls, v.active, activePct.toFixed(1), avgMins.toFixed(1), v.certs, compl.toFixed(1)]);
                });
            }
        }
        else if (kind === 'brief') {
            const sel = this._briefCountry;
            if (!sel || !data.byCountry[sel]) { this._downloadCsv([['No country selected.']], name); return; }
            const c = data.byCountry[sel];
            const IC = window.IncomeClassification;
            const activePct = c.enrolls > 0 ? (c.active / c.enrolls) * 100 : 0;
            const avgMins   = c.active > 0 ? c.totalMins / c.active : 0;
            const completion = c.enrolls > 0 ? (c.certs / c.enrolls) * 100 : 0;
            rows.push(['Country Brief', sel]);
            rows.push(['Income tier', IC ? IC.label(IC.classify(sel)) : '']);
            rows.push(['Lancet priority', IC && IC.isLancetPriority(sel) ? 'Yes' : 'No']);
            rows.push(['Registered users', data.countryUsers[sel] || 0]);
            rows.push(['Learners', c.enrolls]);
            rows.push(['Certificates', c.certs]);
            rows.push(['Active %', activePct.toFixed(1)]);
            rows.push(['Avg minutes / active', avgMins.toFixed(1)]);
            rows.push(['Completion %', completion.toFixed(1)]);
            rows.push([]);
            rows.push(['# Top 5 courses', 'Learners', 'Certificates', 'Completion %']);
            Object.entries(data.countryByCourse[sel] || {})
                .sort((a, b) => b[1].enrolls - a[1].enrolls)
                .slice(0, 5)
                .forEach(([course, e]) => {
                    const compl = e.enrolls > 0 ? ((e.certs / e.enrolls) * 100).toFixed(1) : '0.0';
                    rows.push([course, e.enrolls, e.certs, compl]);
                });
            rows.push([]);
            rows.push(['# Top 5 professions', 'Learners']);
            const profCount = {};
            (this._rawAnonymizedUsers || []).forEach(r => {
                if (r.country !== sel) return;
                const p = (r.profession || '').trim();
                if (!p || p.toLowerCase() === 'unknown' || p === 'nan') return;
                profCount[p] = (profCount[p] || 0) + 1;
            });
            Object.entries(profCount).sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([p, n]) => rows.push([p, n]));
            rows.push([]);
            rows.push(['# Engagement segments', 'Count']);
            const segs = data.segByCountry[sel] || { ghost: 0, explorer: 0, engaged: 0, power: 0 };
            ['ghost', 'explorer', 'engaged', 'power'].forEach(k => rows.push([k, segs[k] || 0]));
        }
        else if (kind === 'social') {
            const s = this._computeSocialEngagement ? this._computeSocialEngagement(data) : null;
            if (!s) { this._downloadCsv([['No social activity data uploaded.']], name); return; }
            const totalUsers = s.social.length;
            rows.push(['# Social Engagement summary']);
            rows.push(['Total users in upload', totalUsers]);
            rows.push(['Total posts', s.totals.posts]);
            rows.push(['Total comments', s.totals.comments]);
            rows.push(['Total likes', s.totals.likes]);
            rows.push(['Users with social activity', s.totals.usersActive]);
            rows.push([]);
            rows.push(['# 4-quadrant (Learning × Social)']);
            ['evangelists', 'lurkers', 'sociallyOnly', 'ghosts'].forEach(k => {
                rows.push([s.quads[k].label, s.quads[k].count, ((s.quads[k].count / totalUsers) * 100).toFixed(1) + '%']);
            });
            rows.push([]);
            rows.push(['# Posts-per-user distribution']);
            Object.entries(s.postBuckets).forEach(([k, n]) => rows.push([k + ' posts', n]));
            rows.push([]);
            rows.push(['# Power-vs-casual social rate']);
            rows.push(['Power learners (≥3 certs) socially active %', s.powerSocialRate.toFixed(1)]);
            rows.push(['Casual learners (1–2 certs) socially active %', s.normalSocialRate.toFixed(1)]);
            rows.push([]);
            rows.push(['# Country breakdown']);
            rows.push(['Country', 'Users', 'Active %', 'Posts', 'Comments', 'Likes', 'Posts + Comments']);
            Object.entries(s.byCountry)
                .map(([c, v]) => ({ c, v }))
                .sort((a, b) => (b.v.posts + b.v.comments) - (a.v.posts + a.v.comments))
                .forEach(({ c, v }) => {
                    const rate = v.users > 0 ? ((v.active / v.users) * 100).toFixed(1) : '0.0';
                    rows.push([c, v.users, rate, v.posts, v.comments, v.likes, v.posts + v.comments]);
                });
            rows.push([]);
            rows.push(['# Top 20 contributors (by posts + comments)']);
            rows.push(['Rank', 'Name', 'Email', 'Country', 'Role', 'Posts', 'Comments', 'Likes', 'Courses', 'Completed', 'Certificates', 'Study minutes']);
            s.ranked.forEach((u, i) => rows.push([i + 1, u.name || '', u.email || '', u.last_login_country || '', u.role || '', u.posts, u.comments, u.likes, u.courses || 0, u.completed || 0, u.certificates, Math.round(u.study_minutes || 0)]));
        }
        else if (kind === 'funnel' || kind === 'tte' || kind === 'cohort') {
            const cd = this._computeCompletionAggregates ? this._computeCompletionAggregates() : null;
            if (!cd) { this._downloadCsv([['No course-completion data uploaded.']], name); return; }
            if (kind === 'funnel') {
                rows.push(['# Platform-wide funnel', 'Count']);
                ['enrolled', 'started', 'engaged', 'completed', 'certified'].forEach(k => rows.push([k, cd.overall[k]]));
                rows.push([]);
                rows.push(['# Per-course funnel (min 10 learners)']);
                rows.push(['Course', 'Enrolled', 'Started', 'Engaged', 'Completed', 'Certified', 'Start %', 'Engaged %', 'Completion %', 'Cert %']);
                cd.courseRows.filter(r => r.enrolled >= 10)
                    .sort((a, b) => b.certRate - a.certRate)
                    .forEach(r => rows.push([r.course, r.enrolled, r.started, r.engaged, r.completed, r.certified, r.startRate.toFixed(1), r.engagedRate.toFixed(1), r.completionRate.toFixed(1), r.certRate.toFixed(1)]));
            } else if (kind === 'tte') {
                rows.push(['Course', 'Certified n', 'p25 days', 'Median days', 'p75 days', 'p90 days', 'Avg score']);
                cd.courseRows.filter(r => r.certSampleSize >= 5)
                    .sort((a, b) => a.medianDays - b.medianDays)
                    .forEach(r => rows.push([r.course, r.certSampleSize, r.p25Days, r.medianDays, r.p75Days, r.p90Days, r.avgScore > 0 ? r.avgScore.toFixed(1) : '']));
            } else {
                rows.push(['Cohort month', 'Learners', 'Unique users', 'Started', 'Engaged', 'Completed', 'Certified', 'Engaged %', 'Completion %', 'Cert %']);
                cd.cohorts.forEach(c => rows.push([c.month, c.enrolments, c.uniqueUsers, c.started, c.engaged, c.completed, c.certified, c.engagedRate.toFixed(1), c.completionRate.toFixed(1), c.certRate.toFixed(1)]));
            }
        }
        else if (kind === 'provider') {
            const provRows = this._computeProviderScorecard ? this._computeProviderScorecard(data) : [];
            rows.push(['Provider', 'Courses', 'Learners', 'Certificates', 'Rating (response-weighted)', 'Completion %', 'Active %', 'Avg minutes / active', 'Composite Score (0–100)']);
            provRows.slice().sort((a, b) => b.score - a.score).forEach(r => {
                rows.push([r.provider, r.courses, r.enrolls, r.certs, r.rating > 0 ? r.rating.toFixed(2) : '', r.completion.toFixed(1), r.activePct.toFixed(1), r.avgMins.toFixed(1), r.score.toFixed(1)]);
            });
        }
        else if (kind === 'rating') {
            const snap = this.getAnalyticsSnap ? this.getAnalyticsSnap() : [];
            const courseRating = {};
            snap.forEach(d => { if (d.Course && Number(d.Rating) > 0) courseRating[d.Course] = Number(d.Rating); });
            const dim = this._ratingDim || 'country';
            const source = dim === 'profession' ? data.profByCourse : data.countryByCourse;
            const getEnrolls = (entry) => (entry && typeof entry === 'object') ? (entry.enrolls || 0) : (entry || 0);
            rows.push(['# Rating by ' + dim, 'Weighted by learner mix']);
            rows.push([]);
            rows.push([dim === 'profession' ? 'Profession' : 'Country', 'Weighted rating', 'Learners (rated courses)', 'Courses covered']);
            const out = Object.entries(source || {}).map(([group, courseMap]) => {
                let ws = 0, w = 0, cc = 0, ec = 0;
                Object.entries(courseMap).forEach(([course, entry]) => {
                    const r = courseRating[course]; if (!r) return;
                    const e = getEnrolls(entry); if (e <= 0) return;
                    ws += r * e; w += e; cc++; ec += e;
                });
                return { group, rating: w > 0 ? ws / w : 0, enrolls: ec, courses: cc };
            }).filter(r => r.enrolls >= this._engMinEnrolments && r.rating > 0);
            out.sort((a, b) => b.rating - a.rating).forEach(r => rows.push([r.group, r.rating.toFixed(2), r.enrolls, r.courses]));
        }
        else if (kind === 'countrycourse') {
            rows.push(['Country', 'Rank', 'Course', 'Learners', 'Certificates', 'Completion %']);
            const ranked = Object.entries(data.byCountry)
                .filter(([k]) => k)
                .sort((a, b) => b[1].enrolls - a[1].enrolls)
                .slice(0, 20);
            ranked.forEach(([country]) => {
                const courses = data.countryByCourse[country] || {};
                Object.entries(courses)
                    .sort((a, b) => b[1].enrolls - a[1].enrolls)
                    .slice(0, 5)
                    .forEach(([course, c], i) => {
                        const compl = c.enrolls > 0 ? ((c.certs / c.enrolls) * 100).toFixed(1) : '0.0';
                        rows.push([country, i + 1, course, c.enrolls, c.certs, compl]);
                    });
            });
        }
        else if (kind === 'physreach') {
            const WF = window.HEALTH_WORKFORCE, toISO = window.countryToISO;
            const totalDecl = Object.values(data.byProf || {}).reduce((s, v) => s + (v.users || 0), 0);
            const allUsers = data.totalUsersPlatform || totalDecl;
            const xScale = totalDecl > 0 ? allUsers / totalDecl : 1;
            const respPct = allUsers > 0 ? (totalDecl / allUsers) * 100 : 100;
            rows.push(['# "Doctors on SURGhub" = doctor-cadre learners (Physician, Surgeon, OB-GYN, Emergency Medicine, Medical Officer, Anaesthesia), extrapolated to the full learner base (x' + xScale.toFixed(2) + '; ~' + respPct.toFixed(0) + '% of learners declared a profession).']);
            rows.push(['# Physicians = World Bank Physicians per 1,000 (SH.MED.PHYS.ZS) x population (SP.POP.TOTL), latest available year per country.']);
            rows.push([]);
            rows.push(['Country', 'Income group', 'Doctors on SURGhub (declared)', 'Doctors on SURGhub (est.)', 'Physicians (est.)', 'Physician density / 1,000', 'Physician data year', 'Reach %']);
            const out = [];
            if (WF && toISO) {
                Object.entries(data.byCountryDoctors || {}).forEach(([country, cnt]) => {
                    const declared = Number(cnt) || 0;
                    if (declared <= 0) return;
                    const wf = WF[toISO(country)];
                    if (!wf || !wf.physicians) return;
                    const est = Math.round(declared * xScale);
                    out.push([country, wf.income, declared, est, wf.physicians, wf.physPer1000, wf.physYear, (est / wf.physicians * 100).toFixed(2)]);
                });
            }
            out.sort((a, b) => parseFloat(b[7]) - parseFloat(a[7]));
            rows.push(...out);
        }

        this._downloadCsv(rows, name);
    },

    // ── Aggregation ───────────────────────────────────────────────────────
    _computeEngagement() {
        const anon = this._rawAnonymizedUsers || [];
        if (anon.length === 0) return null;

        // Country counts from the audience snapshot (true registered-user count)
        const audSnap = (this.userHistory || []).find(d => d.Timestamp === this.selectedDate) || (this.userHistory || [])[0] || null;
        let countryUsers = {};
        if (audSnap && audSnap.AllCountryStats) {
            try { countryUsers = typeof audSnap.AllCountryStats === 'string' ? JSON.parse(audSnap.AllCountryStats) : audSnap.AllCountryStats; }
            catch(_) { countryUsers = {}; }
        }
        const totalUsersPlatform = (audSnap && Number(audSnap.TotalUsers)) || 0;
        const usersWithCountry = Object.values(countryUsers).reduce((s, n) => s + (Number(n) || 0), 0);
        const usersUnknown = Math.max(0, totalUsersPlatform - usersWithCountry);

        // Aggregates
        const byCountry = {};       // country -> {enrolls, active, certs, totalMins}
        const byProf = {};
        const profByCourse = {};    // prof -> course -> count
        const countryByCourse = {}; // country -> course -> {enrolls, certs}
        const segCounts = { ghost: 0, explorer: 0, engaged: 0, power: 0 };
        const segByCountry = {};    // country -> segCounts
        const segByProf = {};

        // Doctor-cadre learners per country (distinct users) — the "Doctors" group
        // used by the Profession/Cadre section. Numerator for physician-workforce reach.
        const DOCTOR_CADRES = new Set(['Physician', 'Surgeon', 'Obstetrics & Gynaecology', 'Emergency Medicine', 'Medical Officer', 'Anaesthesia']);
        const doctorUsersByCountry = {};   // country -> Set(user_uid)

        // Track the "unknown country" subset as its own bucket for transparency
        const unknownAgg = { enrolls: 0, active: 0, certs: 0, totalMins: 0 };

        // ── New per-dimension aggregates (Phase 1) ────────────────────────
        const byGender = {};        // gender -> {enrolls, active, certs, totalMins}
        const byOrg = {};           // org -> {enrolls, active, certs, totalMins}
        const byIncome = {};        // HIC/UMIC/LMIC/LIC/Unknown -> {enrolls, active, certs, totalMins, countries:Set}
        const incomeCountrySet = { HIC: new Set(), UMIC: new Set(), LMIC: new Set(), LIC: new Set(), Unknown: new Set() };

        const courseTotals = {};    // course -> learner count (for top-N selection)
        const profTotals = {};      // prof -> count (for top-N)

        const bucket = (m) => {
            if (!m || m <= 0) return 'ghost';
            if (m < 30) return 'explorer';
            if (m < 300) return 'engaged';
            return 'power';
        };

        anon.forEach(r => {
            const country = (r.country || '').trim();
            const prof = (r.profession || '').trim();
            const course = (r.course || '').trim();
            const mins = Number(r.course_minutes) || 0;
            const certed = r.has_certificate === 'Yes';
            const seg = bucket(mins);

            if (country) {
                const c = byCountry[country] = byCountry[country] || { enrolls: 0, active: 0, certs: 0, totalMins: 0 };
                c.enrolls++; c.totalMins += mins;
                if (mins > 0) c.active++;
                if (certed) c.certs++;

                const cs = segByCountry[country] = segByCountry[country] || { ghost: 0, explorer: 0, engaged: 0, power: 0 };
                cs[seg]++;
            } else {
                // No country declared — track separately so we can show a transparent "Unknown" row
                unknownAgg.enrolls++; unknownAgg.totalMins += mins;
                if (mins > 0) unknownAgg.active++;
                if (certed) unknownAgg.certs++;
            }

            if (prof && prof.toLowerCase() !== 'unknown' && prof !== 'nan') {
                const canon = this._canonProf(prof);  // group raw tags into canonical cadres
                if (canon) {
                    const p = byProf[canon] = byProf[canon] || { enrolls: 0, active: 0, certs: 0, totalMins: 0, _u: new Set() };
                    p.enrolls++; p.totalMins += mins;
                    if (r.user_uid) p._u.add(r.user_uid);
                    if (mins > 0) p.active++;
                    if (certed) p.certs++;
                    profTotals[canon] = (profTotals[canon] || 0) + 1;

                    if (country && r.user_uid && DOCTOR_CADRES.has(canon)) {
                        (doctorUsersByCountry[country] = doctorUsersByCountry[country] || new Set()).add(r.user_uid);
                    }

                    const ps = segByProf[canon] = segByProf[canon] || { ghost: 0, explorer: 0, engaged: 0, power: 0 };
                    ps[seg]++;
                }
            }

            if (course) {
                courseTotals[course] = (courseTotals[course] || 0) + 1;
                if (prof && prof.toLowerCase() !== 'unknown' && prof !== 'nan') {
                    profByCourse[prof] = profByCourse[prof] || {};
                    profByCourse[prof][course] = (profByCourse[prof][course] || 0) + 1;
                }
                if (country) {
                    countryByCourse[country] = countryByCourse[country] || {};
                    const ccr = countryByCourse[country][course] = countryByCourse[country][course] || { enrolls: 0, certs: 0 };
                    ccr.enrolls++;
                    if (certed) ccr.certs++;
                }
            }

            // ── Gender ────────────────────────────────────────────────────
            // Normalise common variations
            let genderNorm = '';
            const gLow = (r.gender || '').toLowerCase().trim();
            if (gLow === 'm' || gLow === 'male')        genderNorm = 'Male';
            else if (gLow === 'f' || gLow === 'female') genderNorm = 'Female';
            else if (gLow && gLow !== 'unknown' && gLow !== 'nan' && gLow !== 'n/a') genderNorm = 'Other / prefer not to say';
            else genderNorm = 'Not declared';
            const gAgg = byGender[genderNorm] = byGender[genderNorm] || { enrolls: 0, active: 0, certs: 0, totalMins: 0, _u: new Set() };
            gAgg.enrolls++; gAgg.totalMins += mins;
            if (r.user_uid) gAgg._u.add(r.user_uid);
            if (mins > 0) gAgg.active++;
            if (certed) gAgg.certs++;

            // ── Organisation type ─────────────────────────────────────────
            let orgNorm = (r.organisation_type || '').trim();
            if (!orgNorm || orgNorm.toLowerCase() === 'unknown' || orgNorm === 'nan') orgNorm = 'Not declared';
            const oAgg = byOrg[orgNorm] = byOrg[orgNorm] || { enrolls: 0, active: 0, certs: 0, totalMins: 0, _u: new Set() };
            oAgg.enrolls++; oAgg.totalMins += mins;
            if (r.user_uid) oAgg._u.add(r.user_uid);
            if (mins > 0) oAgg.active++;
            if (certed) oAgg.certs++;

            // ── Income tier (World Bank) ──────────────────────────────────
            const tier = window.IncomeClassification ? window.IncomeClassification.classify(country) : 'Unknown';
            const iAgg = byIncome[tier] = byIncome[tier] || { enrolls: 0, active: 0, certs: 0, totalMins: 0 };
            iAgg.enrolls++; iAgg.totalMins += mins;
            if (mins > 0) iAgg.active++;
            if (certed) iAgg.certs++;
            if (country) incomeCountrySet[tier].add(country);

            segCounts[seg]++;
        });

        // Convert country sets to counts
        const incomeCountryCount = {};
        Object.keys(incomeCountrySet).forEach(t => { incomeCountryCount[t] = incomeCountrySet[t].size; });

        // ── Per-user aggregates (uses denormalized user_* fields if present) ──
        // Each user appears multiple times (once per learner). Collapse on user_uid.
        const perUser = {};
        let hasUserFields = false;
        anon.forEach(r => {
            if (!r.user_uid) return;
            hasUserFields = true;
            if (!perUser[r.user_uid]) {
                perUser[r.user_uid] = {
                    uid: r.user_uid,
                    country: r.country || '',
                    profession: r.profession || '',
                    gender: r.gender || '',
                    org: r.organisation_type || '',
                    signup_month: r.signup_month || '',
                    courses: Number(r.user_course_count) || 0,
                    certs: Number(r.user_cert_count) || 0,
                    minutes: Number(r.user_total_minutes) || 0,
                };
            }
        });

        // Distinct-user counts per gender/org/profession (each anon row is one learner)
        Object.values(byGender).forEach(v => { v.users = v._u ? v._u.size : 0; delete v._u; });
        Object.values(byOrg).forEach(v => { v.users = v._u ? v._u.size : 0; delete v._u; });
        Object.values(byProf).forEach(v => { v.users = v._u ? v._u.size : 0; delete v._u; });

        // ── Authoritative per-cadre LEARNER counts ───────────────────────────
        // The anonymized records' `profession` comes from the free-text "describes
        // your activity" column, which is missing whole cadres (notably Medical
        // Student). The exact survey-tag classification (ActivityStats) is the real
        // source of truth and is what the Growth-by-Cadre chart uses. Build a
        // canonicalized cadre→learners map from it so the table matches the chart and
        // includes every cadre. ActivityStats is already extrapolated to the full base.
        let byCadreAuth = null;
        let activityKnownCount = 0;
        if (audSnap && audSnap.ActivityStats) {
            try {
                const actRaw = typeof audSnap.ActivityStats === 'string' ? JSON.parse(audSnap.ActivityStats) : audSnap.ActivityStats;
                byCadreAuth = {};
                Object.entries(actRaw || {}).forEach(([tag, n]) => {
                    const c = this._canonProf(tag);   // canon cadre, 'Other', or null (undeclared) → drop nulls
                    if (!c) return;
                    byCadreAuth[c] = (byCadreAuth[c] || 0) + (Number(n) || 0);
                });
                activityKnownCount = Number(audSnap.ActivityKnownCount) || 0;
            } catch (_) { byCadreAuth = null; }
        }

        const byCountryDoctors = {};
        Object.keys(doctorUsersByCountry).forEach(c => { byCountryDoctors[c] = doctorUsersByCountry[c].size; });

        return { byCountry, byProf, byCadreAuth, activityKnownCount, profByCourse, countryByCourse, segCounts, segByCountry, segByProf, courseTotals, profTotals, countryUsers, byCountryDoctors, unknownAgg, usersWithCountry, usersUnknown, totalUsersPlatform, byGender, byOrg, byIncome, incomeCountryCount, perUser, hasUserFields };
    },

    // ── Render the four sections ──────────────────────────────────────────
    // Panels grouped by Dashboard sub-tab. `group` picks a subset; omitted =
    // everything (legacy callers).
    _renderEngagementAnalysis(innerOnly, group) {
        const data = this._computeEngagement();
        if (!data) {
            return innerOnly
                ? '<p class="text-sm text-slate-400 italic">No anonymized user data yet — upload Learners (Step 4) to unlock engagement insights.</p>'
                : '';
        }
        this._engCurrentGroup = group || null;
        const P = {
            brief:         () => this._renderCountryBrief ? this._renderCountryBrief(data) : '',
            country:       () => this._renderCountryEngagementTable(data),
            income:        () => this._renderIncomeComparison(data),
            reachgap:      () => this._renderReachGap ? this._renderReachGap(data) : '',
            physreach:     () => this._renderPhysicianReach ? this._renderPhysicianReach(data) : '',
            forecast:      () => this._renderGrowthForecast ? this._renderGrowthForecast(data) : '',
            gender:        () => this._renderGenderBreakdown(data),
            org:           () => this._renderOrgBreakdown(data),
            scorecard:     () => this._renderProviderScorecard ? this._renderProviderScorecard(data) : '',
            rating:        () => this._renderRatingByGroup ? this._renderRatingByGroup(data) : '',
            completion:    () => this._renderCourseCompletionAnalyses ? this._renderCourseCompletionAnalyses() : '',
            prof:          () => this._renderProfessionBreakdown(data),
            countrycourse: () => this._renderCountryCourseTop5(data),
        };
        const GROUPS = {
            learners:    ['prof', 'org', 'gender'],
            geography:   ['brief', 'country', 'income', 'reachgap', 'physreach', 'countrycourse'],
            performance: ['scorecard', 'rating', 'completion'],
            forecast:    ['forecast'],
        };
        const keys = GROUPS[group] || ['brief', 'country', 'income', 'reachgap', 'physreach', 'forecast', 'gender', 'org', 'scorecard', 'rating', 'completion', 'prof', 'countrycourse'];
        const inner = keys.map(k => P[k]()).join('\n');
        // Defer Google chart draws until DOM mounted (each drawer no-ops if its
        // container isn't on the current sub-tab)
        if (window.App && window.google && window.google.visualization) {
            setTimeout(() => {
                if (this._drawReachGapMap)          this._drawReachGapMap();
                if (this._drawGrowthForecastChart)  this._drawGrowthForecastChart();
            }, 80);
        }
        if (innerOnly) return inner;
        return `<div id="engagement-analysis" class="space-y-8">${inner}</div>`;
    },

    // ── Physician-workforce reach ─────────────────────────────────────────
    // SURGhub registered users in a country as a % of that country's physician
    // workforce (World Bank physician density × population, window.HEALTH_WORKFORCE).
    // NB: the numerator is ALL registered users (not only doctors), so this is an
    // upper-bound proxy for physician penetration. Default view = LIC + LMIC.
    _setPhysReachScope(v) { this._physReachScope = v; this._refreshEngagementSection(); },
    _renderPhysicianReach(data) {
        const WF = window.HEALTH_WORKFORCE;
        const toISO = window.countryToISO;
        if (!WF || !toISO || !data || !data.byCountryDoctors) return '';
        const scope = this._physReachScope || 'liclmic';   // 'liclmic' | 'all'
        // Extrapolate declared doctors to the full learner base — the SAME method the
        // Profession/Cadre cards use (ex = ×totalUsers/declared) — so the numbers reflect
        // users who never declared a profession (not everyone fills the survey) and
        // reconcile with those figures. Per-country declared doctors are scaled by xScale.
        const totalDecl = Object.values(data.byProf || {}).reduce((s, v) => s + (v.users || 0), 0);
        const allUsers = data.totalUsersPlatform || totalDecl;
        const xScale = totalDecl > 0 ? allUsers / totalDecl : 1;
        const respPct = allUsers > 0 ? (totalDecl / allUsers) * 100 : 100;
        const rows = [];
        Object.entries(data.byCountryDoctors).forEach(([country, cnt]) => {
            const declared = Number(cnt) || 0;
            if (declared <= 0) return;
            const iso = toISO(country);
            const wf = iso ? WF[iso] : null;
            if (!wf || !wf.physicians) return;              // no workforce denominator → skip
            if (scope === 'liclmic' && wf.income !== 'LIC' && wf.income !== 'LMIC') return;
            const docs = Math.round(declared * xScale);     // scaled to the full learner base
            rows.push({ country, income: wf.income, docs, declared, physicians: wf.physicians,
                        per1000: wf.physPer1000, year: wf.physYear, pct: (docs / wf.physicians) * 100 });
        });
        if (!rows.length) return '';
        rows.sort((a, b) => b.pct - a.pct);
        const totDocs = rows.reduce((s, r) => s + r.docs, 0);
        const totPhys = rows.reduce((s, r) => s + r.physicians, 0);
        const aggPct = totPhys > 0 ? (totDocs / totPhys) * 100 : 0;

        const IC = window.IncomeClassification;
        const fmt = (n) => this.formatNumber(n);
        const pctStr = (p) => p >= 100 ? Math.round(p) + '%' : (p >= 10 ? p.toFixed(0) + '%' : p.toFixed(1) + '%');
        const incBadge = (g) => `<span style="display:inline-block;font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px;background:${(IC ? IC.color(g) : '#94a3b8')}22;color:${IC ? IC.color(g) : '#64748b'}">${IC ? IC.label(g) : g}</span>`;
        const body = rows.map(r => `<tr class="border-b last:border-0 hover:bg-slate-50">
            <td class="py-2 px-4 font-medium text-gsf-prussian">${this.escapeHtml(r.country)}</td>
            <td class="py-2 px-4">${incBadge(r.income)}</td>
            <td class="py-2 px-4 text-right text-slate-600" title="Scaled to the full learner base from ${fmt(r.declared)} who declared both profession and country">${fmt(r.docs)}<span class="text-slate-300 text-[10px]"> · from ${fmt(r.declared)}</span></td>
            <td class="py-2 px-4 text-right text-slate-600">${fmt(r.physicians)}<span class="text-slate-300 text-[10px]"> · ${r.per1000.toFixed(2)}/1k · ${r.year}</span></td>
            <td class="py-2 px-4 text-right font-bold" style="color:${r.pct >= 100 ? '#3FB984' : '#4389C8'}">${pctStr(r.pct)}</td>
        </tr>`).join('');
        const tab = (v, l) => `<button onclick="App._setPhysReachScope('${v}')" class="px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${scope === v ? 'bg-gsf-boston text-white' : 'text-slate-500 hover:bg-slate-100'}">${l}</button>`;
        return `<div id="eng-section-physreach" class="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div class="bg-slate-50 border-b p-5 flex justify-between items-start gap-3 flex-wrap">
                <div><h3 class="text-lg font-bold text-gsf-prussian flex items-center gap-2"><i data-lucide="stethoscope" width="18" class="text-gsf-boston"></i> Physician-workforce reach</h3>
                <p class="text-xs text-slate-500 mt-1 max-w-3xl">SURGhub <strong>doctor-cadre</strong> learners in each country as a share of that country's physician workforce. An estimated <strong>${fmt(totDocs)}</strong> doctors across <strong>${rows.length}</strong> ${scope === 'liclmic' ? 'LIC/LMIC ' : ''}countries vs an estimated <strong>${fmt(totPhys)}</strong> physicians — an aggregate <strong style="color:#4389C8">${pctStr(aggPct)}</strong>.</p></div>
                <div class="flex items-center gap-2 shrink-0">
                    <div class="flex items-center gap-1 bg-white border rounded-lg p-0.5">${tab('liclmic', 'LIC / LMIC')}${tab('all', 'All incomes')}</div>
                    ${this._engActionBtns('eng-section-physreach', 'physreach', 'Physician_Workforce_Reach', true)}
                </div>
            </div>
            <div class="overflow-x-auto max-h-[520px] overflow-y-auto custom-scrollbar"><table class="w-full text-left border-collapse text-sm">
                <thead class="sticky top-0 bg-white shadow-sm z-10"><tr class="border-b text-slate-500 text-xs">
                    <th class="py-3 px-4 font-medium">Country</th><th class="py-3 px-4 font-medium">Income</th>
                    <th class="py-3 px-4 font-medium text-right">Doctors on SURGhub (est.)</th>
                    <th class="py-3 px-4 font-medium text-right">Physicians (est.)</th>
                    <th class="py-3 px-4 font-medium text-right">Reach %</th>
                </tr></thead><tbody>${body}</tbody>
            </table></div>
            <div class="border-t bg-amber-50/50 px-5 py-3 text-[11px] text-slate-500 leading-relaxed"><strong>Caveats:</strong> "Doctors on SURGhub" counts learners whose self-reported cadre is a <em>doctor</em> (physician, surgeon, OB-GYN, emergency medicine, medical officer, anaesthesia — nurses, students and allied-health excluded), <em>scaled up to the full learner base</em> from the ~${respPct.toFixed(0)}% who declared a profession — the same extrapolation the Profession/Cadre figures use (each row shows the declared count it was scaled from). Doctors who never declared a country can't be placed in one, so per-country figures stay conservative. Physician counts are World Bank estimates (density × population, latest year per row) and lag reality; countries with no World Bank figure are omitted. Source: World Bank <em>Physicians (per 1,000 people)</em> — SH.MED.PHYS.ZS.</div>
        </div>`;
    },

    // ── 1. Country Engagement table ───────────────────────────────────────
    _renderCountryEngagementTable(data) {
        const { byCountry, countryUsers, unknownAgg, usersWithCountry, usersUnknown, totalUsersPlatform } = data;
        const min = this._engMinEnrolments;
        // Coverage badge: what % of platform users are represented in this table?
        const coveragePct = totalUsersPlatform > 0 ? ((usersWithCountry / totalUsersPlatform) * 100) : 100;
        const coverageBadge = totalUsersPlatform > 0
            ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200" title="Users who declared a country / total platform users. The Unknown row at the bottom shows engagement for the rest.">
                   <i data-lucide="info" width="11"></i>
                   Coverage: ${this.formatNumber(usersWithCountry)} of ${this.formatNumber(totalUsersPlatform)} users (${coveragePct.toFixed(0)}%)
               </span>`
            : '';
        const rows = Object.entries(byCountry)
            .filter(([_, v]) => v.enrolls >= min)
            .map(([country, v]) => ({
                country,
                users: countryUsers[country] || 0,
                enrolls: v.enrolls,
                active: v.active,
                activePct: v.enrolls > 0 ? (v.active / v.enrolls) * 100 : 0,
                avgMins: v.active > 0 ? v.totalMins / v.active : 0,
                completion: v.enrolls > 0 ? (v.certs / v.enrolls) * 100 : 0,
            }));

        const col = this._engCountrySortCol;
        const asc = this._engCountrySortAsc;
        rows.sort((a, b) => {
            let va, vb;
            if (col === 'country') { va = a.country.toLowerCase(); vb = b.country.toLowerCase(); }
            else { va = a[col]; vb = b[col]; }
            if (va < vb) return asc ? -1 : 1;
            if (va > vb) return asc ? 1 : -1;
            return 0;
        });

        const arrow = (c) => this._engCountrySortCol === c
            ? (this._engCountrySortAsc ? '&#9650;' : '&#9660;')
            : '<span class="text-slate-300">&#8597;</span>';
        const th = (key, label, align, hint) =>
            `<th class="py-3 px-3 font-medium ${align||''} cursor-pointer hover:text-gsf-boston select-none" ${hint ? `title="${hint}"` : ''} onclick="App._sortEngCountry('${key}')">${label} ${arrow(key)}</th>`;

        // For colour scaling: compute min/max of avgMins
        const mins = rows.map(r => r.avgMins);
        const maxMins = Math.max(...mins, 1);
        const heat = (v) => {
            const t = Math.min(1, v / maxMins);
            // Blue ramp matching brand
            const a = Math.round(15 + t * 55); // saturation
            return `background: rgba(67, 137, 200, ${0.08 + t * 0.5});`;
        };

        return `
            <div id="eng-section-country" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="bg-slate-50 border-b p-5 flex justify-between items-center gap-4 flex-wrap">
                    <div>
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="globe" class="text-gsf-boston"></i> Country Engagement</h2>
                        <p class="text-xs text-slate-500 mt-1">How engaged are learners in each country? Per-learner metrics. Countries with very few learners are noisy — adjust the filter to taste.</p>
                        <div class="mt-2">${coverageBadge}</div>
                    </div>
                    <div class="flex items-center gap-3">
                        <label class="inline-flex items-center gap-2 text-xs text-slate-600">
                            <span class="font-semibold text-slate-400 uppercase tracking-wide">Min learners</span>
                            <input type="number" data-viewer-allowed min="0" step="5" value="${this._engMinEnrolments}" onchange="App._setEngMinEnrolments(this.value)" class="w-20 px-2 py-1 border rounded text-slate-700 outline-none text-xs">
                        </label>
                        ${this._engActionBtns('eng-section-country', 'country', 'Country_Engagement')}
                    </div>
                </div>
                <div class="overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar">
                    <table class="w-full text-left border-collapse text-sm">
                        <thead class="sticky top-0 bg-white shadow-sm z-10"><tr class="border-b text-slate-500">
                            ${th('country', 'Country')}
                            ${th('users', 'Registered', 'text-right', 'Users from this country who declared their country on signup. From the platform’s own country breakdown.')}
                            ${th('enrolls', 'Learners', 'text-right', 'Total course learners — one per (user × course). A user enrolled in 3 courses counts 3 times.')}
                        </tr></thead>
                        <tbody>
                            ${rows.length === 0
                                ? '<tr><td colspan="3" class="py-6 text-center text-sm text-slate-400 italic">No countries meet the minimum-learners filter.</td></tr>'
                                : rows.map(r => `<tr class="border-b hover:bg-slate-50">
                                    <td class="py-2 px-3 font-bold text-xs text-gsf-prussian">${this.escapeHtml(r.country)}</td>
                                    <td class="py-2 px-3 text-right text-xs text-slate-500">${this.formatNumber(r.users)}</td>
                                    <td class="py-2 px-3 text-right text-xs font-medium">${this.formatNumber(r.enrolls)}</td>
                                </tr>`).join('')}
                            ${unknownAgg && unknownAgg.enrolls > 0 ? (() => {
                                const u = unknownAgg;
                                const activePct = u.enrolls > 0 ? (u.active / u.enrolls) * 100 : 0;
                                const avgMins = u.active > 0 ? u.totalMins / u.active : 0;
                                const completion = u.enrolls > 0 ? (u.certs / u.enrolls) * 100 : 0;
                                return `<tr class="border-t-2 border-slate-300 bg-amber-50/40" title="Users who did not declare a country on signup. Shown for transparency — these learners are NOT included in any country row above.">
                                    <td class="py-2 px-3 font-bold text-xs text-amber-700 italic">Unknown / unreported</td>
                                    <td class="py-2 px-3 text-right text-xs text-slate-500 italic">${this.formatNumber(usersUnknown)}</td>
                                    <td class="py-2 px-3 text-right text-xs font-medium italic">${this.formatNumber(u.enrolls)}</td>
                                </tr>`;
                            })() : ''}
                        </tbody>
                    </table>
                </div>
                <div class="bg-slate-50 border-t px-5 py-3 text-[11px] text-slate-500">
                    <strong>Note:</strong> Country rows include only users who declared a country on signup. The <em>Unknown / unreported</em> row at the bottom covers the rest.
                </div>
            </div>
        `;
    },

    // ── 2. Engagement Segments ────────────────────────────────────────────
    _renderEngagementSegments(data) {
        const segDef = [
            { key: 'ghost',    label: 'Ghost',    sub: '0 min',           color: '#e5e7eb', txt: 'text-slate-600' },
            { key: 'explorer', label: 'Explorer', sub: '1–30 min',        color: '#7A9E9F', txt: 'text-white' },
            { key: 'engaged',  label: 'Engaged',  sub: '30–300 min',      color: '#4389C8', txt: 'text-white' },
            { key: 'power',    label: 'Power',    sub: '300+ min',        color: '#1a5276', txt: 'text-white' },
        ];

        const renderBar = (counts, label, totalRight) => {
            const total = counts.ghost + counts.explorer + counts.engaged + counts.power;
            if (total === 0) return '';
            return `<div class="mb-3">
                <div class="flex justify-between items-baseline mb-1">
                    <span class="text-xs font-bold text-gsf-prussian">${this.escapeHtml(label)}</span>
                    <span class="text-[10px] text-slate-400">${this.formatNumber(total)} learners${totalRight ? ' · ' + totalRight : ''}</span>
                </div>
                <div class="flex w-full h-7 rounded-md overflow-hidden border border-slate-200">
                    ${segDef.map(s => {
                        const n = counts[s.key] || 0;
                        const pct = total > 0 ? (n / total) * 100 : 0;
                        if (pct < 0.5) return '';
                        return `<div title="${s.label} (${s.sub}): ${n.toLocaleString()} — ${pct.toFixed(1)}%" style="width:${pct}%; background:${s.color};" class="flex items-center justify-center text-[10px] font-bold ${s.txt}">${pct >= 8 ? pct.toFixed(0)+'%' : ''}</div>`;
                    }).join('')}
                </div>
            </div>`;
        };

        // Build the comparison view based on _engSegBy
        let comparisonHtml = '';
        if (this._engSegBy === 'country') {
            const rows = Object.entries(data.segByCountry)
                .map(([k, v]) => [k, v, (v.ghost + v.explorer + v.engaged + v.power)])
                .filter(([, , total]) => total >= this._engMinEnrolments)
                .sort((a, b) => {
                    // sort by "power+engaged share" desc — most engaged countries first
                    const sa = (a[1].engaged + a[1].power) / a[2];
                    const sb = (b[1].engaged + b[1].power) / b[2];
                    return sb - sa;
                })
                .slice(0, 15);
            comparisonHtml = rows.length === 0
                ? '<p class="text-sm text-slate-400 italic">No countries meet the minimum-learners filter.</p>'
                : rows.map(([country, c, total]) => {
                    const share = ((c.engaged + c.power) / total) * 100;
                    return renderBar(c, country, share.toFixed(0) + '% engaged+');
                }).join('');
        } else if (this._engSegBy === 'profession') {
            const rows = Object.entries(data.segByProf)
                .map(([k, v]) => [k, v, (v.ghost + v.explorer + v.engaged + v.power)])
                .filter(([, , total]) => total >= this._engMinEnrolments)
                .sort((a, b) => {
                    const sa = (a[1].engaged + a[1].power) / a[2];
                    const sb = (b[1].engaged + b[1].power) / b[2];
                    return sb - sa;
                })
                .slice(0, 15);
            comparisonHtml = rows.length === 0
                ? '<p class="text-sm text-slate-400 italic">No professions meet the minimum-learners filter.</p>'
                : rows.map(([prof, c, total]) => {
                    const share = ((c.engaged + c.power) / total) * 100;
                    return renderBar(c, prof, share.toFixed(0) + '% engaged+');
                }).join('');
        } else {
            comparisonHtml = renderBar(data.segCounts, 'Platform-wide');
        }

        return `
            <div id="eng-section-segments" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="bg-slate-50 border-b p-5 flex justify-between items-center gap-4 flex-wrap">
                    <div>
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="layers" class="text-gsf-boston"></i> Engagement Segments</h2>
                        <p class="text-xs text-slate-500 mt-1">Distribution of learners by total learning time. "Engaged+" = at least 30 minutes invested.</p>
                    </div>
                    <div class="flex items-center gap-3">
                        <div class="flex items-center gap-2 text-xs">
                            ${['overall', 'country', 'profession'].map(v => `<button onclick="App._setEngSegBy('${v}')" class="px-3 py-1.5 rounded-md font-bold ${this._engSegBy===v ? 'bg-gsf-boston text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">${v[0].toUpperCase()+v.slice(1)}</button>`).join('')}
                        </div>
                        ${this._engActionBtns('eng-section-segments', 'segments', 'Engagement_Segments')}
                    </div>
                </div>
                <div class="p-5">
                    <div class="flex flex-wrap gap-3 mb-5 text-xs">
                        ${segDef.map(s => `<div class="inline-flex items-center gap-2"><span class="inline-block w-3 h-3 rounded-sm" style="background:${s.color}"></span><span class="font-bold text-gsf-prussian">${s.label}</span><span class="text-slate-400">${s.sub}</span></div>`).join('')}
                    </div>
                    ${comparisonHtml}
                </div>
            </div>
        `;
    },

    // ── 3. Profession × Course heatmap ────────────────────────────────────
    _renderProfCourseHeatmap(data) {
        const N_PROF = 10, N_COURSE = 10;
        const topProfs = Object.entries(data.profTotals).sort((a,b) => b[1]-a[1]).slice(0, N_PROF).map(([k]) => k);
        const topCourses = Object.entries(data.courseTotals).sort((a,b) => b[1]-a[1]).slice(0, N_COURSE).map(([k]) => k);
        if (topProfs.length === 0 || topCourses.length === 0) return '';

        // Compute matrix + max for colour scale
        let maxVal = 0;
        const cell = (p, c) => (data.profByCourse[p] && data.profByCourse[p][c]) || 0;
        topProfs.forEach(p => topCourses.forEach(c => { const v = cell(p,c); if (v > maxVal) maxVal = v; }));

        const heat = (v) => {
            if (v <= 0) return 'background:#f8fafc;color:#cbd5e1';
            const t = v / maxVal;
            const opacity = 0.1 + t * 0.85;
            const textColor = t > 0.5 ? '#ffffff' : '#1a5276';
            return `background:rgba(26, 82, 118, ${opacity});color:${textColor};font-weight:${t>0.3 ? 'bold':'normal'}`;
        };

        // Truncate long names for headers
        const trunc = (s, n) => s.length > n ? s.slice(0, n-1) + '…' : s;

        return `
            <div id="eng-section-profcourse" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="bg-slate-50 border-b p-5 flex justify-between items-start gap-4 flex-wrap">
                    <div>
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="grid-3x3" class="text-gsf-boston"></i> Profession × Course</h2>
                        <p class="text-xs text-slate-500 mt-1">Where each profession concentrates its learners. Top ${N_PROF} professions × top ${N_COURSE} courses. Darker = more learners.</p>
                    </div>
                    ${this._engActionBtns('eng-section-profcourse', 'profcourse', 'Profession_x_Course')}
                </div>
                <div class="overflow-x-auto p-5">
                    <table class="text-xs border-collapse" style="min-width:100%">
                        <thead><tr>
                            <th class="text-left pr-3 py-2 sticky left-0 bg-white" style="min-width:200px"></th>
                            ${topCourses.map(c => `<th class="px-1 py-2 text-center font-medium text-slate-500" style="max-width:90px"><div title="${this.escapeHtml(c)}" style="writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;height:140px;line-height:1.1">${this.escapeHtml(trunc(c, 40))}</div></th>`).join('')}
                            <th class="px-2 py-2 text-right font-bold text-gsf-prussian">Total</th>
                        </tr></thead>
                        <tbody>
                            ${topProfs.map(p => `<tr>
                                <td class="pr-3 py-1 font-bold text-gsf-prussian sticky left-0 bg-white truncate" style="max-width:240px" title="${this.escapeHtml(p)}">${this.escapeHtml(trunc(p, 30))}</td>
                                ${topCourses.map(c => {
                                    const v = cell(p, c);
                                    return `<td class="px-1 py-1 text-center border border-white" style="${heat(v)};min-width:48px" title="${this.escapeHtml(p)} → ${this.escapeHtml(c)}: ${v.toLocaleString()}">${v > 0 ? v.toLocaleString() : ''}</td>`;
                                }).join('')}
                                <td class="px-2 py-1 text-right font-bold text-slate-700">${this.formatNumber(data.profTotals[p] || 0)}</td>
                            </tr>`).join('')}
                            <tr class="border-t-2">
                                <td class="pr-3 py-2 font-bold text-slate-500 sticky left-0 bg-white">Course total</td>
                                ${topCourses.map(c => `<td class="px-1 py-2 text-center text-[10px] font-bold text-slate-500">${this.formatNumber(data.courseTotals[c] || 0)}</td>`).join('')}
                                <td></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    // ── 4. Country × Course top-5 ─────────────────────────────────────────
    _renderCountryCourseTop5(data) {
        // Pick top 20 countries by learners
        const ranked = Object.entries(data.byCountry)
            .filter(([k]) => k)
            .sort((a, b) => b[1].enrolls - a[1].enrolls)
            .slice(0, 20);
        if (ranked.length === 0) return '';

        return `
            <div id="eng-section-countrycourse" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="bg-slate-50 border-b p-5 flex justify-between items-start gap-4 flex-wrap">
                    <div>
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="map" class="text-gsf-boston"></i> Top 5 Courses per Country</h2>
                        <p class="text-xs text-slate-500 mt-1">What learners in each country are actually taking. Use for localisation priorities and grant storytelling. Top 20 countries by learners shown.</p>
                    </div>
                    ${this._engActionBtns('eng-section-countrycourse', 'countrycourse', 'Top_Courses_by_Country')}
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 p-5">
                    ${ranked.map(([country, agg]) => {
                        const courses = data.countryByCourse[country] || {};
                        const top5 = Object.entries(courses)
                            .sort((a, b) => b[1].enrolls - a[1].enrolls)
                            .slice(0, 5);
                        if (top5.length === 0) return '';
                        const maxEnroll = top5[0][1].enrolls;
                        return `<div class="border rounded-lg p-4 bg-slate-50/50">
                            <div class="flex justify-between items-baseline mb-3 pb-2 border-b border-slate-200">
                                <h4 class="font-bold text-gsf-prussian text-sm">${this.escapeHtml(country)}</h4>
                                <span class="text-[10px] text-slate-500">${this.formatNumber(agg.enrolls)} learners</span>
                            </div>
                            <ol class="space-y-2">
                                ${top5.map(([course, c], i) => {
                                    const pct = maxEnroll > 0 ? (c.enrolls / maxEnroll) * 100 : 0;
                                    const compl = c.enrolls > 0 ? (c.certs / c.enrolls) * 100 : 0;
                                    return `<li class="text-xs">
                                        <div class="flex justify-between items-baseline gap-2">
                                            <span class="font-medium text-slate-700 truncate" title="${this.escapeHtml(course)}"><span class="text-slate-400 font-bold mr-1">${i+1}.</span>${this.escapeHtml(course)}</span>
                                            <span class="text-slate-500 whitespace-nowrap shrink-0">${this.formatNumber(c.enrolls)} <span class="text-slate-400">· ${compl.toFixed(0)}% cert</span></span>
                                        </div>
                                        <div class="mt-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                            <div class="h-1.5 rounded-full bg-gsf-boston" style="width:${pct}%"></div>
                                        </div>
                                    </li>`;
                                }).join('')}
                            </ol>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        `;
    },

    // ── 5. Gender breakdown ───────────────────────────────────────────────
    _renderGenderBreakdown(data) {
        const order = ['Female', 'Male', 'Other / prefer not to say'];
        const colours = { 'Female': '#D03734', 'Male': '#4389C8', 'Other / prefer not to say': '#7A9E9F' };
        const rows = order.map(k => [k, data.byGender[k] || { enrolls: 0, users: 0 }]).filter(([, v]) => v.enrolls > 0);
        if (rows.length === 0) return '';
        const totalE = rows.reduce((s, [, v]) => s + v.enrolls, 0);
        const totalU = rows.reduce((s, [, v]) => s + (v.users || 0), 0);
        const undeclaredU = ((data.byGender['Not declared'] || {}).users) || 0;
        const covPct = (totalU + undeclaredU) > 0 ? (totalU / (totalU + undeclaredU)) * 100 : 100;

        return `
            <div id="eng-section-gender" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="bg-slate-50 border-b p-5 flex justify-between items-start gap-4 flex-wrap">
                    <div>
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="users" class="text-gsf-boston"></i> Gender Breakdown</h2>
                        <p class="text-xs text-slate-500 mt-1">Composition of learners by declared gender — people and their learners.</p>
                    </div>
                    ${this._engActionBtns('eng-section-gender', 'gender', 'Gender_Breakdown')}
                </div>
                <div class="p-5">
                    <div class="flex w-full h-8 rounded-md overflow-hidden border border-slate-200 mb-5">
                        ${rows.map(([k, v]) => {
                            const pct = totalU > 0 ? ((v.users || 0) / totalU) * 100 : 0;
                            return `<div title="${k}: ${(v.users || 0).toLocaleString()} learners (${pct.toFixed(1)}%)" style="width:${pct}%; background:${colours[k]};" class="flex items-center justify-center text-[11px] font-bold text-white">${pct >= 8 ? k + ' ' + pct.toFixed(0) + '%' : ''}</div>`;
                        }).join('')}
                    </div>
                    <table class="w-full text-left text-sm">
                        <thead class="text-slate-500 border-b">
                            <tr>
                                <th class="py-2 px-3 font-medium">Gender</th>
                                <th class="py-2 px-3 font-medium text-right">Learners</th>
                                <th class="py-2 px-3 font-medium text-right">% of learners</th>
                                <th class="py-2 px-3 font-medium text-right">Enrolments</th>
                                <th class="py-2 px-3 font-medium text-right">% of enrolments</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(([k, v]) => {
                                const uShare = totalU > 0 ? ((v.users || 0) / totalU) * 100 : 0;
                                const eShare = totalE > 0 ? (v.enrolls / totalE) * 100 : 0;
                                return `<tr class="border-b hover:bg-slate-50">
                                    <td class="py-2 px-3 text-xs font-bold text-gsf-prussian flex items-center gap-2"><span class="inline-block w-3 h-3 rounded-sm" style="background:${colours[k]}"></span>${this.escapeHtml(k)}</td>
                                    <td class="py-2 px-3 text-right text-xs font-medium">${this.formatNumber(v.users || 0)}</td>
                                    <td class="py-2 px-3 text-right text-xs text-slate-500">${uShare.toFixed(1)}%</td>
                                    <td class="py-2 px-3 text-right text-xs font-medium">${this.formatNumber(v.enrolls)}</td>
                                    <td class="py-2 px-3 text-right text-xs text-slate-500">${eShare.toFixed(1)}%</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="bg-slate-50 border-t px-5 py-3 text-[11px] text-slate-500">Gender declared by <strong>${this.formatNumber(totalU)}</strong> learners (${covPct.toFixed(0)}% of those surveyed). Shares are of declared learners; the undeclared are assumed to follow the same split.</div>
            </div>
        `;
    },

    // ── 6. Organisation-type breakdown ────────────────────────────────────
    _renderOrgBreakdown(data) {
        const UNDECLARED = /^(not\s*declared|unknown|undeclared|n\/?a|nan|none|prefer)/i;
        const all = Object.entries(data.byOrg).filter(([k, v]) => v.enrolls > 0 && !UNDECLARED.test(String(k).trim()));
        if (all.length === 0) return '';
        all.sort((a, b) => (b[1].users || 0) - (a[1].users || 0));
        const top = all.slice(0, 12);
        const tail = all.slice(12);
        if (tail.length > 0) {
            const other = tail.reduce((acc, [, v]) => { acc.enrolls += v.enrolls; acc.users += (v.users || 0); return acc; }, { enrolls: 0, users: 0 });
            top.push([`Other (${tail.length} types)`, other]);
        }
        const totalE = top.reduce((s, [, v]) => s + v.enrolls, 0);
        const totalU = top.reduce((s, [, v]) => s + (v.users || 0), 0);
        const undeclaredU = ((data.byOrg['Not declared'] || {}).users) || 0;
        const covPct = (totalU + undeclaredU) > 0 ? (totalU / (totalU + undeclaredU)) * 100 : 100;
        // Extrapolate the declared subset to the full learner base.
        const allUsers = data.totalUsersPlatform || totalU;
        const xScale = totalU > 0 ? allUsers / totalU : 1;
        const ex = n => this.formatNumber(Math.round((n || 0) * xScale));

        // Summary cards: roll the canonical org-type labels up into the headline
        // sectors and show each as a #/% of declared learners (people).
        const grp = labels => labels.reduce((a, l) => {
            const v = data.byOrg[l];
            if (v && ((v.users || 0) > 0 || v.enrolls > 0)) { a.users += (v.users || 0); a.enrolls += v.enrolls; if ((v.users || 0) > 0) a.members.push({ name: l, users: v.users || 0 }); }
            return a;
        }, { users: 0, enrolls: 0, members: [] });
        const cardDefs = [
            { label: 'Government', color: '#206095', v: grp(['Government - National', 'Government - State', 'Government - Local']) },
            { label: 'UN system', color: '#4389C8', v: grp(['UN/UN System', 'UN/UN System (locally recruited)']) },
            { label: 'Regional / international', color: '#3FB984', v: grp(['Regional organization', 'International organization (non UN)']) },
            { label: 'Academia', color: '#A78BFA', v: grp(['Academia']) },
            { label: 'NGO', color: '#E28743', v: grp(['NGO']) },
            { label: 'Private sector', color: '#7A9E9F', v: grp(['Private Sector']) },
        ].filter(c => c.v.users > 0);
        // Register each card's underlying org-types so the popup can show who's included.
        this._groupBreakdowns = this._groupBreakdowns || {};
        const orgCards = cardDefs.length ? `<div class="grid grid-cols-2 md:grid-cols-3 gap-3 p-5 pb-0">${cardDefs.map((c, i) => {
            const pct = totalU > 0 ? (c.v.users / totalU) * 100 : 0;
            const key = 'org' + i;
            this._groupBreakdowns[key] = {
                title: c.label,
                subtitle: ex(c.v.users) + ' learners · ' + pct.toFixed(1) + '% of declared — grouped from ' + c.v.members.length + ' type' + (c.v.members.length === 1 ? '' : 's') + ':',
                members: c.v.members.slice().sort((a, b) => b.users - a.users).map(m => ({ name: m.name, countFmt: ex(m.users), pct: c.v.users > 0 ? (m.users / c.v.users) * 100 : 0 })),
                note: 'Counts are extrapolated to the full learner base from declared respondents.'
            };
            return `<button type="button" onclick="App._showGroupInfo('${key}')" class="text-left rounded-lg border border-slate-200 p-3 hover:border-gsf-boston hover:shadow-sm transition-all w-full" style="border-left:3px solid ${c.color}"><p class="text-[10px] font-bold uppercase tracking-wide text-slate-400 flex items-center gap-1">${c.label}<i data-lucide="info" width="11" class="text-slate-300"></i></p><p class="mt-1 text-xl font-black text-gsf-prussian" style="font-family:var(--num)">${ex(c.v.users)}</p><p class="text-xs text-slate-500">${pct.toFixed(1)}% of declared learners</p></button>`;
        }).join('')}</div>` : '';

        return `
            <div id="eng-section-org" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="bg-slate-50 border-b p-5 flex justify-between items-start gap-4 flex-wrap">
                    <div>
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="building" class="text-gsf-boston"></i> Organisation Type</h2>
                        <p class="text-xs text-slate-500 mt-1">Composition of learners by organisation type — people and their enrolments. Useful for partnership and outreach prioritisation.</p>
                    </div>
                    ${this._engActionBtns('eng-section-org', 'org', 'Organisation_Type')}
                </div>
                ${orgCards}
                <div class="overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar">
                    <table class="w-full text-left text-sm">
                        <thead class="sticky top-0 bg-white shadow-sm z-10 text-slate-500 border-b">
                            <tr>
                                <th class="py-3 px-3 font-medium">Organisation type</th>
                                <th class="py-3 px-3 font-medium text-right">Learners</th>
                                <th class="py-3 px-3 font-medium text-right">% of learners</th>
                                <th class="py-3 px-3 font-medium text-right">Enrolments</th>
                                <th class="py-3 px-3 font-medium text-right">% of enrolments</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${top.map(([k, v]) => {
                                const uShare = totalU > 0 ? ((v.users || 0) / totalU) * 100 : 0;
                                const eShare = totalE > 0 ? (v.enrolls / totalE) * 100 : 0;
                                return `<tr class="border-b hover:bg-slate-50">
                                    <td class="py-2 px-3 text-xs font-bold text-gsf-prussian">${this.escapeHtml(k)}</td>
                                    <td class="py-2 px-3 text-right text-xs font-medium">${ex(v.users)}</td>
                                    <td class="py-2 px-3 text-right text-xs text-slate-500">${uShare.toFixed(1)}%</td>
                                    <td class="py-2 px-3 text-right text-xs font-medium">${ex(v.enrolls)}</td>
                                    <td class="py-2 px-3 text-right text-xs text-slate-500">${eShare.toFixed(1)}%</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="bg-slate-50 border-t px-5 py-3 text-[11px] text-slate-500">Figures are <strong>extrapolated to the full learner base</strong> (${this.formatNumber(allUsers)} learners) from the <strong>${this.formatNumber(totalU)}</strong> with a declared organisation type (${covPct.toFixed(0)}% coverage), assuming respondents are representative. Shares are of declared learners.</div>
            </div>
        `;
    },

    // Canonical cadre groups (mirrors updater.js PROF_MAP). Specific roles are
    // listed before general ones so e.g. "emergency doctor" lands in Emergency
    // Medicine, not the catch-all Physician. Used to group raw profession tags.
    _PROF_MAP: [
        [['specialist surgeon', 'surgeon', 'surgery'], 'Surgeon'],
        [['anaesth', 'anesth'], 'Anaesthesia'],
        [['obstetric', 'gynaecolog', 'gynecolog', 'ob gyn', 'obgyn', 'ob/gyn'], 'Obstetrics & Gynaecology'],
        [['emergency'], 'Emergency Medicine'],
        [['midwif'], 'Midwife'],
        [['medical student'], 'Medical Student'],
        [['nursing student'], 'Nursing Student'],
        [['nurse', 'nursing'], 'Nursing'],
        [['intern', 'resident', 'trainee', 'registrar'], 'Trainee / Resident'],
        [['general medical officer', 'medical officer'], 'Medical Officer'],
        [['clinical officer', 'non-physician clinician', 'non physician clinician'], 'Clinical Officer'],
        [['paramedic', 'prehospital', 'pre hospital'], 'Paramedic'],
        [['pharmac'], 'Pharmacist'],
        [['dentist', 'dental'], 'Dentist'],
        [['physiotherap', 'physical therap'], 'Physiotherapist'],
        [['radiograph', 'radiolog'], 'Radiography'],
        [['technician', 'technologist'], 'Technician'],
        [['research'], 'Researcher'],
        [['public health', 'epidemiolog'], 'Public Health'],
        [['educator', 'teacher', 'lecturer', 'professor', 'faculty'], 'Educator / Faculty'],
        [['engineer', 'biomedical'], 'Engineer'],
        [['administrat', 'manager', 'management'], 'Administrator'],
        [['non-clinical', 'non clinical'], 'Non-Clinical'],
        [['physician', 'doctor', 'practitioner'], 'Physician'],
        [['student'], 'Student'],
    ],
    // Map a raw profession tag to its canonical cadre (or null to drop).
    _canonProf(raw) {
        if (window.Taxonomy && window.Taxonomy.canonProf) return window.Taxonomy.canonProf(raw);  // single source of truth
        if (!raw) return null;
        const s = String(raw).trim(); if (!s) return null;
        const low = s.toLowerCase();
        if (['nan', 'not specified', 'n/a', '-', 'unknown', 'none', 'other'].includes(low)) return low === 'other' ? 'Other' : null;
        const pm = s.match(/^other\s*\((.+)\)\s*$/i);
        const search = (pm ? pm[1].trim().toLowerCase() : low).replace(/[-_]+/g, ' ');
        for (const [kws, canon] of this._PROF_MAP) { for (const kw of kws) { if (search.includes(kw) || low.includes(kw)) return canon; } }
        return 'Other';
    },

    // ── 6b. Profession / cadre breakdown ──────────────────────────────────
    _renderProfessionBreakdown(data) {
        // Prefer the authoritative survey-tag cadre classification (ActivityStats):
        // it is the same source as the Growth-by-Cadre chart, so the table reconciles
        // with it and includes every cadre (e.g. Medical Student) that the free-text
        // "activity" column misses. Falls back to the legacy column path for snapshots
        // that predate the exact-tag breakdowns.
        if (data.byCadreAuth && Object.keys(data.byCadreAuth).length) return this._renderCadreTableFromTags(data);
        const UNDECLARED = /^(not\s*declared|unknown|undeclared|n\/?a|nan|none|prefer|other)/i;
        // Profession tags arrive kebab/lowercase (e.g. "medical-officer"); show them
        // tidily title-cased. (Distinct raw stems like nurse/nursing stay separate.)
        const pretty = s => /\(\d+ cadres\)/.test(s) ? s : String(s).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase());
        const all = Object.entries(data.byProf || {}).filter(([k, v]) => v.enrolls > 0 && !UNDECLARED.test(String(k).trim()));
        if (all.length === 0) return '';
        all.sort((a, b) => (b[1].users || 0) - (a[1].users || 0));
        const top = all.slice(0, 14);
        const tail = all.slice(14);
        if (tail.length > 0) {
            const other = tail.reduce((acc, [, v]) => { acc.enrolls += v.enrolls; acc.users += (v.users || 0); return acc; }, { enrolls: 0, users: 0 });
            top.push([`Other (${tail.length} cadres)`, other]);
        }
        const totalE = top.reduce((s, [, v]) => s + v.enrolls, 0);
        const totalU = top.reduce((s, [, v]) => s + (v.users || 0), 0);
        const allUsers = data.totalUsersPlatform || totalU;
        const covPct = allUsers > 0 ? (totalU / allUsers) * 100 : 100;
        // Extrapolate the declared subset to the full learner base (same method as
        // the country/gender figures): scale counts by totalUsers / surveyed.
        const xScale = totalU > 0 ? allUsers / totalU : 1;
        const ex = n => this.formatNumber(Math.round((n || 0) * xScale));
        // Broad-category summary cards (roll canonical cadres into headline groups),
        // mirroring the Organisation Type cards. Counts are extrapolated to the full base.
        const grp = labels => labels.reduce((a, l) => {
            const v = data.byProf[l];
            if (v && ((v.users || 0) > 0 || v.enrolls > 0)) { a.users += (v.users || 0); a.enrolls += v.enrolls; if ((v.users || 0) > 0) a.members.push({ name: pretty(l), users: v.users || 0 }); }
            return a;
        }, { users: 0, enrolls: 0, members: [] });
        const cardDefs = [
            { label: 'Doctors', color: '#206095', v: grp(['Physician', 'Surgeon', 'Obstetrics & Gynaecology', 'Emergency Medicine', 'Medical Officer', 'Anaesthesia']) },
            { label: 'Nurses & midwives', color: '#4389C8', v: grp(['Nursing', 'Midwife']) },
            { label: 'Trainees & students', color: '#A78BFA', v: grp(['Trainee / Resident', 'Medical Student', 'Nursing Student', 'Student']) },
            { label: 'Allied health', color: '#3FB984', v: grp(['Clinical Officer', 'Paramedic', 'Pharmacist', 'Dentist', 'Physiotherapist', 'Radiography', 'Technician']) },
            { label: 'Academic & research', color: '#E28743', v: grp(['Researcher', 'Educator / Faculty', 'Public Health']) },
            { label: 'Other / non-clinical', color: '#7A9E9F', v: grp(['Non-Clinical', 'Engineer', 'Administrator', 'Other']) },
        ].filter(c => c.v.users > 0);
        // Register each card's underlying cadres so the popup can show who's included.
        this._groupBreakdowns = this._groupBreakdowns || {};
        const profCards = cardDefs.length ? `<div class="grid grid-cols-2 md:grid-cols-3 gap-3 p-5 pb-0">${cardDefs.map((c, i) => {
            const pct = totalU > 0 ? (c.v.users / totalU) * 100 : 0;
            const key = 'prof' + i;
            this._groupBreakdowns[key] = {
                title: c.label,
                subtitle: ex(c.v.users) + ' learners · ' + pct.toFixed(1) + '% of declared — grouped from ' + c.v.members.length + ' cadre' + (c.v.members.length === 1 ? '' : 's') + ':',
                members: c.v.members.slice().sort((a, b) => b.users - a.users).map(m => ({ name: m.name, countFmt: ex(m.users), pct: c.v.users > 0 ? (m.users / c.v.users) * 100 : 0 })),
                note: 'Counts are extrapolated to the full learner base from declared respondents.'
            };
            return `<button type="button" onclick="App._showGroupInfo('${key}')" class="text-left rounded-lg border border-slate-200 p-3 hover:border-gsf-boston hover:shadow-sm transition-all w-full" style="border-left:3px solid ${c.color}"><p class="text-[10px] font-bold uppercase tracking-wide text-slate-400 flex items-center gap-1">${c.label}<i data-lucide="info" width="11" class="text-slate-300"></i></p><p class="mt-1 text-xl font-black text-gsf-prussian" style="font-family:var(--num)">${ex(c.v.users)}</p><p class="text-xs text-slate-500">${pct.toFixed(1)}% of declared learners</p></button>`;
        }).join('')}</div>` : '';
        return `
            <div id="eng-section-prof" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="bg-slate-50 border-b p-5 flex justify-between items-start gap-4 flex-wrap">
                    <div>
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="briefcase" class="text-gsf-boston"></i> Profession / Cadre</h2>
                        <p class="text-xs text-slate-500 mt-1">Composition of learners by profession — people and their enrolments. Useful for curriculum prioritisation and training-needs analysis.</p>
                    </div>
                    ${this._engActionBtns('eng-section-prof', 'prof', 'Profession_Cadre')}
                </div>
                ${profCards}
                <div class="overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar">
                    <table class="w-full text-left text-sm">
                        <thead class="sticky top-0 bg-white shadow-sm z-10 text-slate-500 border-b">
                            <tr>
                                <th class="py-3 px-3 font-medium">Profession / cadre</th>
                                <th class="py-3 px-3 font-medium text-right">Learners</th>
                                <th class="py-3 px-3 font-medium text-right">% of learners</th>
                                <th class="py-3 px-3 font-medium text-right">Enrolments</th>
                                <th class="py-3 px-3 font-medium text-right">% of enrolments</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${top.map(([k, v]) => {
                                const uShare = totalU > 0 ? ((v.users || 0) / totalU) * 100 : 0;
                                const eShare = totalE > 0 ? (v.enrolls / totalE) * 100 : 0;
                                return `<tr class="border-b hover:bg-slate-50">
                                    <td class="py-2 px-3 text-xs font-bold text-gsf-prussian">${this.escapeHtml(pretty(k))}</td>
                                    <td class="py-2 px-3 text-right text-xs font-medium">${ex(v.users)}</td>
                                    <td class="py-2 px-3 text-right text-xs text-slate-500">${uShare.toFixed(1)}%</td>
                                    <td class="py-2 px-3 text-right text-xs font-medium">${ex(v.enrolls)}</td>
                                    <td class="py-2 px-3 text-right text-xs text-slate-500">${eShare.toFixed(1)}%</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="bg-slate-50 border-t px-5 py-4 mt-3 text-[11px] text-slate-500">Figures are <strong>extrapolated to the full learner base</strong> (${this.formatNumber(allUsers)} learners) from the <strong>${this.formatNumber(totalU)}</strong> with a declared profession (${covPct.toFixed(0)}% coverage), assuming respondents are representative. Shares are of declared learners.</div>
            </div>
        `;
    },

    // Authoritative cadre table built from the exact survey-tag classification
    // (ActivityStats, canonicalized → data.byCadreAuth). Learner counts only — they
    // match the Growth-by-Cadre chart exactly and include every cadre. ActivityStats
    // is already extrapolated to the full learner base, so no further scaling here.
    _renderCadreTableFromTags(data) {
        const cadre = data.byCadreAuth || {};
        const entries = Object.entries(cadre).filter(([k, v]) => k && v > 0 && k !== 'Other');
        const otherV = (cadre['Other'] || 0);
        if (entries.length === 0) return '';
        const total = entries.reduce((s, [, v]) => s + v, 0) + otherV;
        const fmt = n => this.formatNumber(Math.round(n || 0));
        entries.sort((a, b) => b[1] - a[1]);
        const top = entries.slice(0, 14);
        const tail = entries.slice(14);
        let tailSum = tail.reduce((s, [, v]) => s + v, 0) + otherV;
        if (tailSum > 0) top.push([`Other (${tail.length + (otherV > 0 ? 1 : 0)} cadres)`, tailSum]);

        // Broad-category summary cards (same headline groups as before), from learners.
        const grp = labels => labels.reduce((a, l) => {
            const u = cadre[l] || 0;
            if (u > 0) { a.users += u; a.members.push({ name: l, users: u }); }
            return a;
        }, { users: 0, members: [] });
        const cardDefs = [
            { label: 'Doctors', color: '#206095', v: grp(['Physician', 'Surgeon', 'Obstetrics & Gynaecology', 'Emergency Medicine', 'Medical Officer', 'Anaesthesia']) },
            { label: 'Nurses & midwives', color: '#4389C8', v: grp(['Nursing', 'Midwife']) },
            { label: 'Trainees & students', color: '#A78BFA', v: grp(['Trainee / Resident', 'Medical Student', 'Nursing Student', 'Student']) },
            { label: 'Allied health', color: '#3FB984', v: grp(['Clinical Officer', 'Paramedic', 'Pharmacist', 'Dentist', 'Physiotherapist', 'Radiography', 'Technician']) },
            { label: 'Academic & research', color: '#E28743', v: grp(['Researcher', 'Educator / Faculty', 'Public Health']) },
            { label: 'Other / non-clinical', color: '#7A9E9F', v: grp(['Non-Clinical', 'Engineer', 'Administrator', 'Other']) },
        ].filter(c => c.v.users > 0);
        this._groupBreakdowns = this._groupBreakdowns || {};
        const profCards = cardDefs.length ? `<div class="grid grid-cols-2 md:grid-cols-3 gap-3 p-5 pb-0">${cardDefs.map((c, i) => {
            const pct = total > 0 ? (c.v.users / total) * 100 : 0;
            const key = 'prof' + i;
            this._groupBreakdowns[key] = {
                title: c.label,
                subtitle: fmt(c.v.users) + ' learners · ' + pct.toFixed(1) + '% of all — grouped from ' + c.v.members.length + ' cadre' + (c.v.members.length === 1 ? '' : 's') + ':',
                members: c.v.members.slice().sort((a, b) => b.users - a.users).map(m => ({ name: m.name, countFmt: fmt(m.users), pct: c.v.users > 0 ? (m.users / c.v.users) * 100 : 0 })),
                note: 'Learner counts from the survey-tag classification, extrapolated to the full learner base.'
            };
            return `<button type="button" onclick="App._showGroupInfo('${key}')" class="text-left rounded-lg border border-slate-200 p-3 hover:border-gsf-boston hover:shadow-sm transition-all w-full" style="border-left:3px solid ${c.color}"><p class="text-[10px] font-bold uppercase tracking-wide text-slate-400 flex items-center gap-1">${c.label}<i data-lucide="info" width="11" class="text-slate-300"></i></p><p class="mt-1 text-xl font-black text-gsf-prussian" style="font-family:var(--num)">${fmt(c.v.users)}</p><p class="text-xs text-slate-500">${pct.toFixed(1)}% of all learners</p></button>`;
        }).join('')}</div>` : '';

        const known = data.activityKnownCount || 0;
        const base = data.totalUsersPlatform || 0;
        const covPct = base > 0 ? (known / base) * 100 : 0;
        return `
            <div id="eng-section-prof" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="bg-slate-50 border-b p-5 flex justify-between items-start gap-4 flex-wrap">
                    <div>
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="briefcase" class="text-gsf-boston"></i> Profession / Cadre</h2>
                        <p class="text-xs text-slate-500 mt-1">Composition of learners by self-reported cadre (survey Q3 — "which best describes your activity"). Same classification as the Growth-by-Cadre chart. Useful for curriculum prioritisation and training-needs analysis.</p>
                    </div>
                    ${this._engActionBtns('eng-section-prof', 'prof', 'Profession_Cadre')}
                </div>
                ${profCards}
                <div class="overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar">
                    <table class="w-full text-left text-sm">
                        <thead class="sticky top-0 bg-white shadow-sm z-10 text-slate-500 border-b">
                            <tr>
                                <th class="py-3 px-3 font-medium">Profession / cadre</th>
                                <th class="py-3 px-3 font-medium text-right">Learners</th>
                                <th class="py-3 px-3 font-medium text-right">% of learners</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${top.map(([k, v]) => {
                                const share = total > 0 ? (v / total) * 100 : 0;
                                return `<tr class="border-b hover:bg-slate-50">
                                    <td class="py-2 px-3 text-xs font-bold text-gsf-prussian">${this.escapeHtml(k)}</td>
                                    <td class="py-2 px-3 text-right text-xs font-medium">${fmt(v)}</td>
                                    <td class="py-2 px-3 text-right text-xs text-slate-500">${share.toFixed(1)}%</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="bg-slate-50 border-t px-5 py-4 mt-3 text-[11px] text-slate-500">Cadre is from the survey tag (Q3), <strong>extrapolated to the full learner base</strong> (${this.formatNumber(base)} learners) from the <strong>${this.formatNumber(known)}</strong> who answered it (${covPct.toFixed(0)}% coverage), assuming respondents are representative. Shares are of all learners and total ${this.formatNumber(Math.round(total))}.</div>
            </div>
        `;
    },

    // ── 7. Power-user profile (certificates-based) ────────────────────────
    _renderPowerUserProfile(data) {
        // Requires user-level fields (added in updater.js). If missing, show CTA.
        if (!data.hasUserFields) {
            return `
                <div id="eng-section-power" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                    <div class="bg-slate-50 border-b p-5">
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="trophy" class="text-gsf-boston"></i> Power Users</h2>
                    </div>
                    <div class="p-8 text-center">
                        <p class="text-sm text-slate-600 mb-2">Per-user analytics not available on the current dataset.</p>
                        <p class="text-xs text-slate-400">Re-run <strong>Step 4 (Learner Demographics)</strong> on the Data Sync page to backfill user-level fields, then return here.</p>
                    </div>
                </div>
            `;
        }

        const users = Object.values(data.perUser);
        if (users.length === 0) return '';

        // Distribution of certificates per user
        const certBuckets = { '0': 0, '1': 0, '2': 0, '3-4': 0, '5-9': 0, '10+': 0 };
        users.forEach(u => {
            if      (u.certs === 0) certBuckets['0']++;
            else if (u.certs === 1) certBuckets['1']++;
            else if (u.certs === 2) certBuckets['2']++;
            else if (u.certs <= 4)  certBuckets['3-4']++;
            else if (u.certs <= 9)  certBuckets['5-9']++;
            else                    certBuckets['10+']++;
        });
        const totalUsers = users.length;
        const bucketColours = { '0': '#e5e7eb', '1': '#cbd5e1', '2': '#7A9E9F', '3-4': '#4389C8', '5-9': '#1a5276', '10+': '#D03734' };

        // Power-user threshold = top 5% by cert count (min 3 certs)
        const sortedCerts = users.map(u => u.certs).sort((a, b) => b - a);
        const cutIdx = Math.max(0, Math.floor(totalUsers * 0.05) - 1);
        const threshold = Math.max(3, sortedCerts[cutIdx] || 3);
        const powerUsers = users.filter(u => u.certs >= threshold);

        // Profile of power users: top countries, top professions
        const tally = (arr, key, n) => {
            const m = {};
            arr.forEach(u => { const v = (u[key] || '').trim(); if (v && v.toLowerCase() !== 'unknown' && v !== 'nan') m[v] = (m[v] || 0) + 1; });
            return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);
        };
        const allCountries = tally(users, 'country', 1000);
        const totalsByCountry = Object.fromEntries(allCountries);
        const powerCountries = tally(powerUsers, 'country', 10);
        const allProfs = tally(users, 'profession', 1000);
        const totalsByProf = Object.fromEntries(allProfs);
        const powerProfs = tally(powerUsers, 'profession', 10);

        // Index ratio: power-user-share / overall-share — values > 1 mean overrepresented
        const indexRow = (powerList, totalsMap, powerTotal, overallTotal) => powerList.map(([k, n]) => {
            const overall = totalsMap[k] || 0;
            const powerShare  = powerTotal   > 0 ? n / powerTotal      : 0;
            const overallShare = overallTotal > 0 ? overall / overallTotal : 0;
            const idx = overallShare > 0 ? powerShare / overallShare : 0;
            return { name: k, powerCount: n, overall, idx };
        });
        const countryIdx = indexRow(powerCountries, totalsByCountry, powerUsers.length, totalUsers);
        const profIdx    = indexRow(powerProfs,    totalsByProf,    powerUsers.length, totalUsers);

        const renderBuckets = () => {
            const total = Object.values(certBuckets).reduce((s, n) => s + n, 0);
            return `<div class="mb-5">
                <div class="flex w-full h-8 rounded-md overflow-hidden border border-slate-200">
                    ${Object.entries(certBuckets).map(([k, n]) => {
                        const pct = total > 0 ? (n / total) * 100 : 0;
                        if (pct < 0.5) return '';
                        return `<div title="${k} certs: ${n.toLocaleString()} users (${pct.toFixed(1)}%)" style="width:${pct}%; background:${bucketColours[k]};" class="flex items-center justify-center text-[10px] font-bold ${k==='0'||k==='1'?'text-slate-600':'text-white'}">${pct >= 6 ? k + ' · ' + pct.toFixed(0) + '%' : ''}</div>`;
                    }).join('')}
                </div>
                <div class="flex flex-wrap gap-3 mt-3 text-[10px] text-slate-500">
                    ${Object.entries(certBuckets).map(([k, n]) => `<span class="inline-flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:${bucketColours[k]}"></span><strong>${k}</strong> certs · ${this.formatNumber(n)}</span>`).join('')}
                </div>
            </div>`;
        };

        const renderIndexTable = (rows, label) => {
            if (rows.length === 0) return '<p class="text-xs text-slate-400 italic">No data.</p>';
            return `<table class="w-full text-xs">
                <thead class="text-slate-500 border-b"><tr>
                    <th class="py-2 px-2 font-medium text-left">${label}</th>
                    <th class="py-2 px-2 font-medium text-right">Power users</th>
                    <th class="py-2 px-2 font-medium text-right" title="Power-user share ÷ overall share. >1 means over-represented among power users.">Over-index ×</th>
                </tr></thead>
                <tbody>
                    ${rows.map(r => {
                        const idxClass = r.idx > 1.5 ? 'text-green-700 font-bold' : r.idx > 1 ? 'text-slate-700' : 'text-slate-400';
                        return `<tr class="border-b">
                            <td class="py-1.5 px-2 truncate font-medium" title="${this.escapeHtml(r.name)}">${this.escapeHtml(r.name)}</td>
                            <td class="py-1.5 px-2 text-right">${this.formatNumber(r.powerCount)}</td>
                            <td class="py-1.5 px-2 text-right ${idxClass}">${r.idx.toFixed(2)}×</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>`;
        };

        return `
            <div id="eng-section-power" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="bg-slate-50 border-b p-5 flex justify-between items-start gap-4 flex-wrap">
                    <div>
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="trophy" class="text-gsf-boston"></i> Power-User Profile</h2>
                        <p class="text-xs text-slate-500 mt-1">Who are your most dedicated learners? Power users earned ≥ ${threshold} certificates (top 5% threshold). Over-index = how much more concentrated a country/profession is among power users vs the overall base.</p>
                    </div>
                    ${this._engActionBtns('eng-section-power', 'power', 'Power_User_Profile')}
                </div>
                <div class="p-5">
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
                        ${[
                            { label: 'Users with learners', val: this.formatNumber(totalUsers), color: '#4389C8', hint: 'Only users who enrolled in at least one course (= the universe over which "power user" is defined). Platform-wide registered total is higher because it includes users who signed up but never enrolled.' },
                            { label: 'Power users', val: this.formatNumber(powerUsers.length) + ' <span class="text-sm text-slate-400">(' + ((powerUsers.length / totalUsers) * 100).toFixed(1) + '%)</span>', color: '#D03734', hint: 'Users at or above the certificate threshold.' },
                            { label: 'Power-user threshold', val: '≥ ' + threshold + ' certificates', color: '#1a5276', hint: 'Auto-set so power users are the top ~5% by cert count, with a floor of 3 certs.' },
                        ].map(k => `<div class="border rounded-lg p-4 bg-slate-50/50" title="${this.escapeHtml(k.hint)}">
                            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">${k.label}</div>
                            <div class="text-2xl font-black" style="color:${k.color}">${k.val}</div>
                        </div>`).join('')}
                    </div>
                    <p class="text-[11px] text-slate-500 italic mb-5">⓵ "Users with learners" is lower than the platform-wide Total Users count because some users sign up but never enrol in a course. Power-user analysis only makes sense over the enrolled population.</p>

                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Distribution: certificates earned per user</h4>
                    ${renderBuckets()}

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                        <div>
                            <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Top countries among power users</h4>
                            ${renderIndexTable(countryIdx, 'Country')}
                        </div>
                        <div>
                            <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Top professions among power users</h4>
                            ${renderIndexTable(profIdx, 'Profession')}
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    // ── 8. LMIC vs HIC comparison ─────────────────────────────────────────
    _renderIncomeComparison(data) {
        const order = ['LIC', 'LMIC', 'UMIC', 'HIC', 'Unknown'];
        const rows = order.map(t => [t, data.byIncome[t] || { enrolls: 0, active: 0, certs: 0, totalMins: 0 }]).filter(([, v]) => v.enrolls > 0);
        if (rows.length === 0 || !window.IncomeClassification) return '';
        const IC = window.IncomeClassification;
        const totalEnrolls = rows.reduce((s, [, v]) => s + v.enrolls, 0);
        const totalCerts   = rows.reduce((s, [, v]) => s + v.certs, 0);

        // Mission share = LIC + LMIC learner share
        const missionEnrolls = (data.byIncome['LIC'] && data.byIncome['LIC'].enrolls || 0) + (data.byIncome['LMIC'] && data.byIncome['LMIC'].enrolls || 0);
        const missionCerts   = (data.byIncome['LIC'] && data.byIncome['LIC'].certs   || 0) + (data.byIncome['LMIC'] && data.byIncome['LMIC'].certs   || 0);
        const missionEnrollPct = totalEnrolls > 0 ? (missionEnrolls / totalEnrolls) * 100 : 0;
        const missionCertPct   = totalCerts   > 0 ? (missionCerts   / totalCerts)   * 100 : 0;

        return `
            <div id="eng-section-income" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="bg-slate-50 border-b p-5 flex justify-between items-start gap-4 flex-wrap">
                    <div>
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="scale" class="text-gsf-boston"></i> LMIC vs HIC Comparison<span class="text-[9px] font-bold uppercase tracking-wider text-amber-700 border border-amber-300 bg-amber-50 rounded-full px-1.5 py-0.5 ml-2 align-middle">Beta</span></h2>
                        <p class="text-xs text-slate-500 mt-1">Engagement across World Bank income tiers. Mission audience (LIC + LMIC) breaks out at the bottom — useful for funders and impact reports.</p>
                    </div>
                    ${this._engActionBtns('eng-section-income', 'income', 'Income_Tier_Comparison')}
                </div>
                <div class="p-5">
                    <div class="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                        <div class="border rounded-lg p-4 bg-orange-50 border-orange-200">
                            <div class="text-[10px] font-bold text-orange-700 uppercase tracking-wide mb-1">Mission audience<br><span class="text-slate-500 font-normal normal-case">(LIC + LMIC)</span></div>
                            <div class="text-2xl font-black text-gsf-crimson">${missionEnrollPct.toFixed(0)}%</div>
                            <div class="text-[10px] text-slate-500 mt-1">${this.formatNumber(missionEnrolls)} learners</div>
                        </div>
                        <div class="border rounded-lg p-4">
                            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Countries in mission tiers</div>
                            <div class="text-2xl font-black text-gsf-prussian">${this.formatNumber((data.incomeCountryCount.LIC || 0) + (data.incomeCountryCount.LMIC || 0))}</div>
                            <div class="text-[10px] text-slate-500 mt-1">unique countries</div>
                        </div>
                        <div class="border rounded-lg p-4">
                            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Countries unclassified</div>
                            <div class="text-2xl font-black text-slate-500">${this.formatNumber(data.incomeCountryCount.Unknown || 0)}</div>
                            <div class="text-[10px] text-slate-500 mt-1">need country-map fix</div>
                        </div>
                    </div>

                    <div class="flex w-full h-10 rounded-md overflow-hidden border border-slate-200 mb-6">
                        ${rows.map(([t, v]) => {
                            const pct = totalEnrolls > 0 ? (v.enrolls / totalEnrolls) * 100 : 0;
                            return `<div title="${IC.label(t)}: ${v.enrolls.toLocaleString()} learners (${pct.toFixed(1)}%)" style="width:${pct}%; background:${IC.color(t)};" class="flex items-center justify-center text-[11px] font-bold text-white">${pct >= 6 ? IC.label(t) + ' · ' + pct.toFixed(0) + '%' : ''}</div>`;
                        }).join('')}
                    </div>

                    <table class="w-full text-left text-sm">
                        <thead class="text-slate-500 border-b">
                            <tr>
                                <th class="py-2 px-3 font-medium">Income tier</th>
                                <th class="py-2 px-3 font-medium text-right">Countries</th>
                                <th class="py-2 px-3 font-medium text-right">Learners</th>
                                <th class="py-2 px-3 font-medium text-right">Share</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(([t, v]) => {
                                const activePct = v.enrolls > 0 ? (v.active / v.enrolls) * 100 : 0;
                                const avgMins = v.active > 0 ? v.totalMins / v.active : 0;
                                const compl = v.enrolls > 0 ? (v.certs / v.enrolls) * 100 : 0;
                                const share = totalEnrolls > 0 ? (v.enrolls / totalEnrolls) * 100 : 0;
                                return `<tr class="border-b hover:bg-slate-50">
                                    <td class="py-2 px-3 text-xs font-bold text-gsf-prussian flex items-center gap-2"><span class="inline-block w-3 h-3 rounded-sm" style="background:${IC.color(t)}"></span>${IC.label(t)}</td>
                                    <td class="py-2 px-3 text-right text-xs text-slate-500">${data.incomeCountryCount[t] || 0}</td>
                                    <td class="py-2 px-3 text-right text-xs font-medium">${this.formatNumber(v.enrolls)}</td>
                                    <td class="py-2 px-3 text-right text-xs text-slate-500">${share.toFixed(1)}%</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                    <p class="text-[11px] text-slate-400 italic mt-3">Source: World Bank income classification (FY2024–2025). Countries with no income-tier match show as "Unclassified" — usually a country-name spelling we haven't mapped yet.</p>
                </div>
            </div>
        `;
    },
});
