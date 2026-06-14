// === SOURCE OF TRUTH OWNERSHIP ===
// Step 1 (Course Export) OWNS: Learners, Certificates, Provider, URL, IsShell
// Step 2 (Survey Fetch) OWNS: Rating, Responses, FeedbackBank, RatingHistory
// Step 3 (Timeline Sync) OWNS: CourseTimeline (daily breakdown + scale factors)
// Step 4 (Audience Sync) OWNS: userHistory entries (TotalUsers, country/prof stats)
// Step 5 (Ambassador Sync) OWNS: ambassadorData
// RULE: No step overwrites another step's fields.
// RULE: Course Export totals are authoritative for Learners/Certificates.
// RULE: Timeline provides the growth curve shape; its endpoint is scaled to match Course Export.

Object.assign(window.App, {
    async handleDbSave() {
        try {
            await Storage.setItem('surghub_data', this.data || []);
            // Only save userHistory if it has data (prevent wiping audience data during other steps)
            if (this.userHistory && this.userHistory.length > 0) {
                await Storage.setItem('surghub_history', this.userHistory);
            }
            if (this.ambassadorData) await Storage.setItem('surghub_ambassadors', this.ambassadorData);
            if (this.platformUniqueUsers) await Storage.setItem('surghub_unique_users', this.platformUniqueUsers.toString());
            // Local SURGhub data just changed (a LearnWorlds sync, CSV upload, or
            // include/edit) — mark it AHEAD of the cloud so the next launch's auto-pull
            // won't silently overwrite it with the older Google Sheets copy. The pull
            // never routes through handleDbSave, so it can't wrongly trip this. Cleared
            // on the next successful "Sync to Sheets" push.
            await Storage.setItem('surghub_unsynced_local', true);
            await Storage.setItem('surghub_local_mtime', new Date().toISOString());
        } catch (e) { console.error("Database Save error", e); }
    },

    async startAutomatedUpdate() {
        if (!this.masterFile) return alert("Please upload Course Export first.");
        this.isLoading = true; this.renderView();

        try {
            const masterRows = await window.Pipeline.processMasterUpload(this.masterFile);
            const provMap = this.mappingFile ? await window.Pipeline.readExcel(this.mappingFile) : [];
            const linkMap = this.linksFile ? await window.Pipeline.readExcel(this.linksFile) : [];
            await this._reconcileCourseFoundation(masterRows, provMap, linkMap, 'CSV upload');
        } catch (err) {
            this.isLoading = false; this.renderView();
            alert("Sync Courses error: " + err.message);
        }
    },

    // ── Provider Map & Course Links: persistent, decoupled from course export ──
    // The LearnWorlds API has no provider/survey-link data — those live in
    // SharePoint Excel files. Upload them once here; they're stored persistently
    // (survive SURGhub wipes, like API credentials) and auto-applied on every
    // course sync. This handler also applies them to the EXISTING course set
    // immediately, so you don't need to re-run the ~5 min API course fetch.
    async uploadProviderMapFile(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            const rows = await window.Pipeline.readExcel(file);
            if (!rows || rows.length === 0) throw new Error('File is empty or unreadable.');
            await Storage.setItem('surgdash_provider_map', rows);
            const applied = await this.applyProviderLinkMapping({ silent: true });
            this.showMsg(`Provider map saved (${rows.length} rows) ✓ — ${applied.provUpdated} courses updated. Auto-applies on future syncs.`);
            this.renderView();
        } catch (e) {
            alert('Provider map error: ' + e.message);
        }
        event.target.value = '';
    },

    async uploadCourseLinksFile(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            const rows = await window.Pipeline.readExcel(file);
            if (!rows || rows.length === 0) throw new Error('File is empty or unreadable.');
            await Storage.setItem('surgdash_course_links', rows);
            const applied = await this.applyProviderLinkMapping({ silent: true });
            this.showMsg(`Course links saved (${rows.length} rows) ✓ — ${applied.urlUpdated} survey links updated. Auto-applies on future syncs.`);
            this.renderView();
        } catch (e) {
            alert('Course links error: ' + e.message);
        }
        event.target.value = '';
    },

    // Apply the stored provider map + course links to the EXISTING course
    // records in memory (latest snapshot per course). No API fetch.
    async applyProviderLinkMapping(opts) {
        opts = opts || {};
        const provMap = (await Storage.getItem('surgdash_provider_map')) || [];
        const linkMap = (await Storage.getItem('surgdash_course_links')) || [];
        if (provMap.length === 0 && linkMap.length === 0) {
            if (!opts.silent) alert('No provider map or course links uploaded yet.');
            return { provUpdated: 0, urlUpdated: 0, provMissing: 0, urlMissing: 0 };
        }

        // Latest record per course
        const latestByCourse = {};
        (this.data || []).forEach(d => {
            if (d.IsShell || !d.Course) return;
            const prev = latestByCourse[d.Course];
            if (!prev || (d.Timestamp || '') > (prev.Timestamp || '')) latestByCourse[d.Course] = d;
        });

        let provUpdated = 0, urlUpdated = 0, provMissing = 0, urlMissing = 0;
        for (const course of Object.values(latestByCourse)) {
            const normTitle = window.Pipeline.normalizeString(course.Course);
            if (provMap.length) {
                const provider = this._matchProvider(normTitle, provMap);
                if (provider) {
                    if (provider !== course.Provider) { course.Provider = provider; provUpdated++; }
                } else { provMissing++; }
            }
            if (linkMap.length) {
                const url = this._matchLink(normTitle, linkMap);
                if (url) {
                    if (url !== course.URL) {
                        // Old stats came from the previously-linked survey —
                        // they don't describe this one. Rebuilt by Sync Surveys.
                        if (course.URL) this._clearSurveyStats(course);
                        course.URL = url; urlUpdated++;
                    }
                } else { urlMissing++; }
            }
        }
        const healed = linkMap.length ? this._dedupeSurveyAssignments(linkMap) : 0;
        if (healed) console.log('[Mapping] cleared cross-assigned survey stats on ' + healed + ' course(s).');
        await this.handleDbSave();
        if (!opts.silent) {
            const parts = [];
            if (provMap.length) parts.push(`${provUpdated} providers updated (${provMissing} unmatched)`);
            if (linkMap.length) parts.push(`${urlUpdated} survey links updated (${urlMissing} unmatched)`);
            alert('Mapping applied to existing courses ✓\n\n' + parts.join('\n'));
            this.renderView();
        }
        return { provUpdated, urlUpdated, provMissing, urlMissing };
    },

    // Shared fuzzy matcher. Exact normalized equality ALWAYS wins; otherwise
    // the longest containment match, and only when the two names are close in
    // length (>=60%). The old first-containment-wins logic let "Appendicitis"
    // (ALL SAFE) claim "Laparoscopic Appendectomy for Uncomplicated
    // Appendicitis" (HelloSurg) because it sat earlier in the file — wrong
    // provider AND the wrong course's survey link.
    _bestNameMatch(normTitle, rows, nameOf) {
        let best = null, bestLen = -1;
        for (const r of rows) {
            const mTitle = window.Pipeline.normalizeString(nameOf(r) || '');
            if (!mTitle) continue;
            if (mTitle === normTitle) return r;
            const shorter = Math.min(mTitle.length, normTitle.length);
            const longer = Math.max(mTitle.length, normTitle.length);
            if ((mTitle.includes(normTitle) || normTitle.includes(mTitle)) && (shorter / longer) >= 0.75 && mTitle.length > bestLen) {
                best = r; bestLen = mTitle.length;
            }
        }
        return best;
    },

    // Shared matcher: provider name for a normalized course title
    _matchProvider(normTitle, provMap) {
        const m = this._bestNameMatch(normTitle, provMap, r => r["All Courses"] || Object.values(r)[0]);
        return m ? (m["Providers"] || Object.values(m)[1] || null) : null;
    },

    // Shared matcher: survey-link URL for a normalized course title
    _matchLink(normTitle, linkMap) {
        const rows = linkMap.filter(r => !r["Include"] || String(r["Include"]).trim().toUpperCase() === "YES");
        const m = this._bestNameMatch(normTitle, rows, r => r["Course Name"] || Object.values(r)[0]);
        return m ? (m["Post-Course Survey Link"] || Object.values(m)[1] || null) : null;
    },

    // A survey assessment must belong to exactly ONE course. The old matcher
    // cross-assigned sibling courses ("Lap Cholecystectomy by Bangla Approach"
    // inherited Lap Cholecystectomy's survey → phantom 157 responses). Keep
    // the course whose name exactly matches a Course Links row (else the one
    // with the most learners) and strip the link + survey-derived stats from
    // the impostors so the next Sync Surveys rebuilds clean numbers.
    _dedupeSurveyAssignments(linkMap) {
        const assessOf = (u) => { const m = /assessment\/([a-f0-9]+)/i.exec(String(u || '')); return m ? m[1] : ''; };
        const exactNames = new Set((linkMap || []).map(r => window.Pipeline.normalizeString(r["Course Name"] || Object.values(r)[0] || '')).filter(Boolean));
        const latestByCourse = {};
        (this.data || []).forEach(d => {
            if (d.IsShell || !d.Course) return;
            const prev = latestByCourse[d.Course];
            if (!prev || (d.Timestamp || '') > (prev.Timestamp || '')) latestByCourse[d.Course] = d;
        });
        const byAssess = {};
        Object.values(latestByCourse).forEach(c => { const a = assessOf(c.URL); if (a) (byAssess[a] = byAssess[a] || []).push(c); });
        let healed = 0;
        Object.values(byAssess).forEach(group => {
            if (group.length < 2) return;
            const exact = group.filter(c => exactNames.has(window.Pipeline.normalizeString(c.Course)));
            const keep = exact[0] || group.slice().sort((a, b) => (Number(b.Learners) || 0) - (Number(a.Learners) || 0))[0];
            group.forEach(c => {
                if (c === keep) return;
                console.warn('[Mapping] "' + c.Course + '" shared a survey with "' + keep.Course + '" — clearing its survey link and stats.');
                this._clearSurveyStats(c);
                healed++;
            });
        });
        return healed;
    },

    // Survey-derived fields are only valid for the survey they came from.
    _clearSurveyStats(course) {
        course.URL = '';
        delete course.Responses;
        delete course.Rating;
        delete course.QuestionStats;
        delete course.FeedbackBank;
        delete course.RatingHistory; // else a 0-response course still shows a rating chart
    },

    async clearProviderLinkMapping() {
        if (!confirm('Remove the stored Provider Map and Course Links? Existing course providers/links stay as-is, but future syncs will no longer auto-apply them.')) return;
        await Storage.removeItem('surgdash_provider_map');
        await Storage.removeItem('surgdash_course_links');
        this.showMsg('Stored provider/links mapping cleared.');
        this.renderView();
    },

    // ── Sync Growth Timelines: per-course monthly enrolment + cert history ──
    // Heavy (~12 min) but slowly-changing — past months are fixed, only the
    // current month grows. Attaches CourseTimeline to each course record so the
    // Platform/Provider/Course Growth charts populate.
    async syncGrowthTimelinesFromApi(opts) {
        opts = opts || {};
        if (!window.LearnWorlds) { if (!opts.silent) alert('LearnWorlds module not loaded.'); throw new Error('module'); }
        const creds = await window.LearnWorlds.getCredentials();
        if (!creds.clientId || !creds.apiToken) {
            if (!opts.silent) this.showMsg('⚠ Add LearnWorlds API credentials first');
            throw new Error('No LearnWorlds credentials');
        }
        if (!opts.silent) {
            if (this._apiSyncInFlight) { this.showMsg('⚠ A sync is already running — let it finish or Cancel it first.'); throw new Error('Sync already running'); }
            if (!confirm('Sync Growth Timelines from LearnWorlds API?\n\nCollects month-by-month enrolment + certificate history for every course (~110k dated records). Fills the Platform / Provider / Course Growth charts.\n\nSlow: 30–60+ minutes at current scale (runs in the background; one summary at the end). Usually unnecessary — the User Progress upload (card 2) already builds exact history — but this is the only path that refreshes the learner→course maps behind the anonymized User Data exports.\n\nContinue?')) return;
            this._apiSyncInFlight = true;
            this._showApiSyncOverlay('Sync Growth Timelines');
        }
        try {
            try { window.LearnWorlds.startRawPull('growth-timelines'); } catch (e) {}
            const { timelines, userCourses, userCerts } = await window.LearnWorlds.fetchCourseTimelines(p => {
                const text = p.phase === 'courses'
                    ? `Listing courses (${p.current})…`
                    : `Building timelines ${p.current}/${p.total}…`;
                const pct = p.phase === 'courses' ? 5 : (p.current / Math.max(1, p.total)) * 92;
                this._updateApiSyncOverlay(text, pct);
            });
            try { window.LearnWorlds.finishRawPull(true); } catch (e) {}
            // Persist user→courses / user→certs maps (collected in the same pass, no
            // extra API calls). The Learners sync joins these onto user rows so the
            // anonymized per-course records exist without the slow deep-cert fetch.
            try {
                const nCourses = Object.keys(userCourses || {}).length;
                const nCerts = Object.keys(userCerts || {}).length;
                if (nCourses > 0) await Storage.setItem('surghub_user_courses', userCourses);
                if (nCerts > 0) await Storage.setItem('surghub_user_certs', userCerts);
                console.log(`[GrowthTimelines] Stored course lists for ${nCourses.toLocaleString()} learners, cert lists for ${nCerts.toLocaleString()}`);
            } catch (e) { console.warn('[GrowthTimelines] user-courses store failed:', e); }
            // Attach CourseTimeline to the latest record per course
            const latestByCourse = {};
            (this.data || []).forEach(d => {
                if (d.IsShell || !d.Course) return;
                const prev = latestByCourse[d.Course];
                if (!prev || (d.Timestamp || '') > (prev.Timestamp || '')) latestByCourse[d.Course] = d;
            });
            let attached = 0, totalE = 0, totalC = 0;
            for (const tl of timelines) {
                const rec = latestByCourse[tl.courseName];
                if (!rec) continue;
                if (Object.keys(tl.timeline).length > 0) {
                    rec.CourseTimeline = JSON.stringify({
                        totalE: tl.totalE, totalC: tl.totalC,
                        timeline: tl.timeline,
                        scale: { enrollScale: 1, certScale: 1 }   // counts are real, no scaling needed
                    });
                    attached++; totalE += tl.totalE; totalC += tl.totalC;
                }
                // Per-course country breakdown → powers Provider/Course learner maps + PDF
                if (tl.countryStats && Object.keys(tl.countryStats).length > 0) {
                    rec.CountryStats = JSON.stringify(tl.countryStats);
                }
            }
            const repairedTl = this._repairZeroCountsFromTimelines();
            if (repairedTl) console.log(`[GrowthTimelines] repaired ${repairedTl} zeroed course counts from record counts`);
            await this.handleDbSave();
            console.log(`[GrowthTimelines] Attached to ${attached} courses · ${totalE.toLocaleString()} dated enrolments, ${totalC.toLocaleString()} dated certs`);
            if (!opts.silent) {
                this._hideApiSyncOverlay();
                this._apiSyncInFlight = false;
                this.renderView();
                alert(`Growth Timelines synced ✓\n\n${attached} courses now have monthly history.\n${totalE.toLocaleString()} dated enrolments · ${totalC.toLocaleString()} dated certificates.`);
            }
            return { ok: true, coursesWithTimeline: attached, datedEnrolments: totalE, datedCerts: totalC };
        } catch (err) {
            if (!opts.silent) {
                this._hideApiSyncOverlay();
                this._apiSyncInFlight = false;
                if (err.message !== 'Sync already running') alert('Timeline sync error: ' + err.message);
            }
            throw err;
        }
    },

    // Fill zeroed course counts from Growth-Timeline record counts. The
    // timeline sync counts actual enrolment/cert records per course — the most
    // accurate source we have — while the analytics endpoint sometimes reports
    // 0 students for live courses. Only trusts unscaled (API-built) timelines
    // and only ever fills zeros; never lowers a positive count.
    _repairZeroCountsFromTimelines() {
        const latest = {};
        (this.data || []).forEach(d => {
            if (d.IsShell || !d.Course) return;
            const prev = latest[d.Course];
            if (!prev || (d.Timestamp || '') > (prev.Timestamp || '')) latest[d.Course] = d;
        });
        let repaired = 0;
        Object.values(latest).forEach(d => {
            if (!d.CourseTimeline) return;
            let parsed; try { parsed = JSON.parse(d.CourseTimeline); } catch (e) { return; }
            const scale = parsed.scale || {};
            if (scale.enrollScale != null && scale.enrollScale !== 1) return;  // scaled (CSV) timeline — totals not raw
            const tl = parsed.timeline || {};
            let e = parsed.totalE, c = parsed.totalC;
            if (e == null || c == null) {
                e = 0; c = 0;
                Object.values(tl).forEach(v => { if (v && typeof v === 'object') { e += v.e || 0; c += v.c || 0; } });
            }
            let did = false;
            if ((Number(d.Learners) || 0) === 0 && e > 0) { d.Learners = e; did = true; }
            if ((Number(d.Certificates) || 0) === 0 && c > 0) { d.Certificates = c; did = true; }
            if (did) { d.Timestamp = this.updateDate || d.Timestamp; repaired++; console.log('[Repair] filled counts from timeline for', d.Course, '→ L:', d.Learners, 'C:', d.Certificates); }
        });
        return repaired;
    },

    // Re-derive each stored timeline's scale so its curve sums to the CURRENT
    // authoritative totals. The dated source (cert records / signup dates) often
    // covers only part of the real total, and stored totals get refreshed from
    // the overview export AFTER the timeline was built — leaving a stale scale
    // (seen live: 242 dated certs vs 626 stored). Idempotent: scale is always
    // recomputed from the unchanged raw values.
    // Derive a course's overall rating from its captured QuestionStats when the
    // stored Rating is 0 (e.g. the survey's overall question was worded unusually
    // so the live rating-column detector missed it). Prefer an explicit
    // satisfaction/overall-quality question; else the mean of its 1–5 items.
    _ratingFromQuestionStats(qs) {
        if (!Array.isArray(qs)) return 0;
        const valid = qs.filter(q => q && (Number(q.n) >= 3) && (Number(q.avg) > 0));
        if (!valid.length) return 0;
        const find = (re) => valid.find(q => re.test(String(q.q || '').toLowerCase()));
        const sat = find(/overall satisfaction|satisfacci|niveau de satisfaction/);
        if (sat) return Number(sat.avg);
        const quality = find(/overall quality|rate the overall/);
        if (quality) return Number(quality.avg);
        return valid.reduce((s, q) => s + Number(q.avg || 0), 0) / valid.length;
    },
    _backfillRatingsFromQuestionStats() {
        const latest = {};
        (this.data || []).forEach(d => { if (d.IsShell || !d.Course) return; const p = latest[d.Course]; if (!p || (d.Timestamp || '') > (p.Timestamp || '')) latest[d.Course] = d; });
        let n = 0;
        Object.values(latest).forEach(d => {
            if (Number(d.Rating) > 0 || !d.QuestionStats) return;
            let qs; try { qs = JSON.parse(d.QuestionStats); } catch (e) { return; }
            const r = this._ratingFromQuestionStats(qs);
            if (r > 0) { d.Rating = r.toFixed(2); n++; }
        });
        if (n) console.log('[CourseSync] backfilled rating from survey questions for ' + n + ' course(s).');
        return n;
    },

    _rescaleTimelinesToTotals() {
        const latest = {};
        (this.data || []).forEach(d => {
            if (d.IsShell || !d.Course || !d.CourseTimeline) return;
            const prev = latest[d.Course];
            if (!prev || (d.Timestamp || '') > (prev.Timestamp || '')) latest[d.Course] = d;
        });
        let n = 0;
        Object.values(latest).forEach(d => {
            let parsed; try { parsed = JSON.parse(d.CourseTimeline); } catch (e) { return; }
            const tl = parsed.timeline || parsed;
            let rawE = 0, rawC = 0;
            Object.keys(tl).forEach(k => { const v = tl[k]; if (v && typeof v === 'object') { rawE += v.e || 0; rawC += v.c || 0; } });
            const L = Number(d.Learners) || 0, C = Number(d.Certificates) || 0;
            const eScale = (rawE > 0 && L > 0) ? L / rawE : 1;
            const cScale = (rawC > 0 && C > 0) ? C / rawC : 1;
            const out = { scale: { enrollScale: eScale, certScale: cScale }, timeline: tl, totalE: L || rawE, totalC: C || rawC };
            const next = JSON.stringify(out);
            if (next !== d.CourseTimeline) { d.CourseTimeline = next; n++; }
        });
        if (n) console.log('[CourseSync] rescaled ' + n + ' timeline(s) to match stored totals.');
        return n;
    },

    // Fold pre-launch buckets of stored timelines into the course's launch
    // month. Fixes historical curves built from account-creation dates (the
    // API exposes no per-enrolment date) without re-running the long sync.
    _clampTimelinesToLaunch() {
        const latest = {};
        (this.data || []).forEach(d => {
            if (d.IsShell || !d.Course) return;
            const prev = latest[d.Course];
            if (!prev || (d.Timestamp || '') > (prev.Timestamp || '')) latest[d.Course] = d;
        });
        let clamped = 0;
        Object.values(latest).forEach(d => {
            if (!d.CourseCreated || !d.CourseTimeline) return;
            const launchM = String(d.CourseCreated).substring(0, 7);
            if (!/^\d{4}-\d{2}$/.test(launchM)) return;
            let parsed; try { parsed = JSON.parse(d.CourseTimeline); } catch (e) { return; }
            const tl = parsed.timeline || {};
            let folded = false;
            Object.keys(tl).forEach(m => {
                if (m.substring(0, 7) >= launchM) return;
                const v = tl[m];
                if (!v || typeof v !== 'object') { delete tl[m]; return; }
                const tgt = tl[launchM] = tl[launchM] || { e: 0, c: 0 };
                tgt.e = (tgt.e || 0) + (v.e || 0);
                tgt.c = (tgt.c || 0) + (v.c || 0);
                delete tl[m];
                folded = true;
            });
            if (folded) {
                parsed.timeline = tl;
                d.CourseTimeline = JSON.stringify(parsed);
                clamped++;
                console.log('[Clamp] folded pre-launch history into', launchM, 'for', d.Course);
            }
        });
        return clamped;
    },

    // Rebuild course timelines from the Course Insights progress export
    // (surghub_completion): its per-user start dates are TRUE enrolment dates,
    // unlike the API's account-creation dates. Covered courses get an exact
    // monthly history; months newer than the file's coverage are kept from the
    // existing (API-built) timeline so freshness isn't lost.
    async _rebuildTimelinesFromCompletion() {
        let recs = this._rawCompletion;
        if (!recs || !recs.length) { try { recs = await Storage.getItem('surghub_completion'); } catch (e) {} }
        if (!recs || !recs.length) return 0;
        const byCourse = {};
        recs.forEach(r => { if (r && r.course) (byCourse[r.course] = byCourse[r.course] || []).push(r); });
        const latest = {};
        (this.data || []).forEach(d => {
            if (d.IsShell || !d.Course) return;
            const prev = latest[d.Course];
            if (!prev || (d.Timestamp || '') > (prev.Timestamp || '')) latest[d.Course] = d;
        });
        let rebuilt = 0;
        Object.entries(byCourse).forEach(([course, list]) => {
            const d = latest[course];
            if (!d) return;
            const tl = {};
            let tE = 0, tC = 0, maxM = '';
            list.forEach(r => {
                const sm = r.start_month || String(r.start_date || '').slice(0, 7);
                if (/^\d{4}-\d{2}$/.test(sm)) { (tl[sm] = tl[sm] || { e: 0, c: 0 }).e++; tE++; if (sm > maxM) maxM = sm; }
                const cm = String(r.completion_date || '').slice(0, 7);
                if (/^\d{4}-\d{2}$/.test(cm)) { (tl[cm] = tl[cm] || { e: 0, c: 0 }).c++; tC++; if (cm > maxM) maxM = cm; }
            });
            if (!tE) return;
            // Keep API-built months beyond the file's coverage window
            if (d.CourseTimeline) {
                try {
                    const p = JSON.parse(d.CourseTimeline);
                    const sc = p.scale || {};
                    if (sc.enrollScale == null || sc.enrollScale === 1) {
                        Object.entries(p.timeline || {}).forEach(([m, v]) => {
                            if (m > maxM && v && typeof v === 'object') { tl[m] = { e: v.e || 0, c: v.c || 0 }; tE += tl[m].e; tC += tl[m].c; }
                        });
                    }
                } catch (e) {}
            }
            d.CourseTimeline = JSON.stringify({ totalE: tE, totalC: tC, timeline: tl, scale: { enrollScale: 1, certScale: 1 }, src: 'completion' });
            rebuilt++;
        });
        if (rebuilt) console.log('[Timelines] rebuilt from exact start dates (progress export) for', rebuilt, 'courses');
        return rebuilt;
    },

    // ── Sync Learners & Ambassadors ─────────────────────────────────────
    // The single user-side sync: demographics + lead attribution + ambassador
    // timeline + per-learner certificate completions (cohort retention).
    // Course-level totals (certs, learning time, providers) come from the
    // separate "Sync Courses" button. ~10 min.
    async runDeepSync() {
        if (!window.LearnWorlds) return alert('LearnWorlds module not loaded.');
        const creds = await window.LearnWorlds.getCredentials();
        if (!creds.clientId || !creds.apiToken) {
            this.showMsg('⚠ Add LearnWorlds API credentials first');
            return;
        }
        if (!confirm(
            'Sync Learners & Ambassadors from LearnWorlds API?\n\n' +
            'Pulls all user data:\n' +
            '  • Demographics (country, profession, gender)\n' +
            '  • Lead attribution + historical leads\n' +
            '  • Ambassador referrals + per-promoter timeline\n\n' +
            'NOTE: course totals (Certificates, Learning Time) come from "Sync Courses".\n\n' +
            'Takes ~5 minutes. You can keep working, but don\'t close the app.\n\nContinue?'
        )) return;
        if (this._apiSyncInFlight) { this.showMsg('⚠ A sync is already running — let it finish or Cancel it first.'); return; }
        this._apiSyncInFlight = true;

        this._showApiSyncOverlay('Sync Learners & Ambassadors');
        this._updateApiSyncOverlay('Starting…', 0);
        const results = { stages: [], errors: [] };
        const stages = [
            { label: 'Demographics + lead attribution', fn: () => this.syncDemographicsFromApi({ silent: true }) },
            { label: 'Ambassadors per-promoter', fn: () => this.syncAmbassadorsFromApi({ silent: true }) }
        ];
        for (const stage of stages) {
            try {
                const r = await stage.fn();
                results.stages.push({ label: stage.label, ok: true, result: r });
                console.log('[DeepSync] ✓', stage.label, r);
            } catch (e) {
                results.stages.push({ label: stage.label, ok: false, error: e.message });
                results.errors.push(`${stage.label}: ${e.message}`);
                console.error('[DeepSync] ✗', stage.label, e);
            }
        }
        this._hideApiSyncOverlay();
        this._apiSyncInFlight = false;
        this.navigate('audience');

        const lines = ['Sync Learners & Ambassadors — Complete\n'];
        const demo = results.stages.find(s => s.label.startsWith('Demographics'));
        if (demo && demo.ok && demo.result) {
            const r = demo.result;
            lines.push(`✓ ${r.totalUsers.toLocaleString()} users`);
            if (r.ambassadorBonus) lines.push(`✓ ${r.ambassadorBonus.HistoricalTotal.toLocaleString()} historical leads`);
            const dcLine = this._demoCoverageLine(r.demoCoverage);
            if (dcLine) lines.push(dcLine);
        } else if (demo) {
            lines.push(`✗ Demographics: ${demo.error}`);
        }
        const amb = results.stages.find(s => s.label.startsWith('Ambassadors'));
        if (amb && amb.ok && amb.result) lines.push(`✓ Ambassadors timeline refreshed`);
        lines.push('\nℹ Total Certificates + Learning Time come from "Sync Courses" (course analytics) — run that if those cards are blank.');
        alert(lines.join('\n'));
    },

    // One-line summary of where gender + organisation type came from during
    // the demographics sync (user tags vs. uploaded signup survey). Returns
    // null if the sync didn't record coverage (older code path).
    _demoCoverageLine(dc) {
        if (!dc) return null;
        const g = (dc.tagGender || 0) + (dc.surveyGender || 0);
        const o = (dc.tagOrg || 0) + (dc.surveyOrg || 0);
        if (g === 0 && o === 0) {
            return 'ℹ Gender + organisation type: not found in user tags — upload the Signup Survey (Data Sync page) to fill them.';
        }
        return `✓ Gender on ${g.toLocaleString()} · org type on ${o.toLocaleString()} users (tags ${(dc.tagGender || 0).toLocaleString()}/${(dc.tagOrg || 0).toLocaleString()}, survey ${(dc.surveyGender || 0).toLocaleString()}/${(dc.surveyOrg || 0).toLocaleString()})`;
    },

    // Lightweight pre-sync rollback point: copy the headline canonical files
    // (data / history / ambassadors) into backups/presync_{ts}/ before a sync
    // overwrites them, keeping the most recent 15. Best-effort — wrapped so it can
    // never block or break a sync. The big, re-fetchable files (anon_users ~33MB,
    // completion ~38MB) are intentionally excluded to keep this cheap; full backups
    // still go via Google Sheets / the manual backup.
    async _backupSurghubBeforeSync() {
        try {
            const fs = electronAPI.fs, path = electronAPI.path;
            const root = Storage.DATA_DIR;
            const names = ['data.json', 'history.json', 'ambassadors.json'];
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const destDir = path.join(root, 'backups', 'presync_' + stamp);
            let copied = 0;
            for (const name of names) {
                const src = path.join(root, 'surghub', name);
                try {
                    if (fs.existsSync(src)) {
                        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
                        fs.writeFileSync(path.join(destDir, name), fs.readFileSync(src, 'utf8'), 'utf8');
                        copied++;
                    }
                } catch (e) { /* per-file best-effort */ }
            }
            if (copied) console.log('[presync-backup] saved ' + copied + ' file(s) →', destDir);
            // Rotate: keep only the 15 most recent presync_ snapshots
            try {
                const backupsDir = path.join(root, 'backups');
                const dirs = fs.readdirSync(backupsDir, { withFileTypes: true })
                    .filter(e => e.isDirectory && /^presync_/.test(e.name))
                    .map(e => e.name).sort();
                for (let i = 0; i < dirs.length - 15; i++) {
                    try { fs.rmSync(path.join(backupsDir, dirs[i]), { recursive: true, force: true }); } catch (e) {}
                }
            } catch (e) {}
        } catch (e) {
            console.warn('[presync-backup] skipped:', e && e.message);
        }
    },

    // ── Sync Everything: courses + learners + ambassadors, one click ─────
    // Runs the two API syncs back-to-back (sequential — they both write
    // this.data/surghub_data, so they must NOT overlap). One shared overlay,
    // one combined summary. ~15 min total.
    async runFullSync() {
        if (!window.LearnWorlds) return alert('LearnWorlds module not loaded.');
        const creds = await window.LearnWorlds.getCredentials();
        if (!creds.clientId || !creds.apiToken) {
            this.showMsg('⚠ Add LearnWorlds API credentials first');
            return;
        }
        if (!confirm(
            'Sync EVERYTHING from LearnWorlds API?\n\n' +
            'Runs back-to-back:\n' +
            '  1. Courses — enrolments, certificates, learning time, providers\n' +
            '  2. Learners & Ambassadors — demographics, lead attribution, referrals\n\n' +
            'Total: ~15 minutes (varies with connection / rate limits).\n\n' +
            'NOT included (run separately): Growth Timelines and Surveys.\n\n' +
            'You can keep working, but don\'t close the app. Continue?'
        )) return;
        if (this._apiSyncInFlight) { this.showMsg('⚠ A sync is already running — let it finish or Cancel it first.'); return; }
        this._apiSyncInFlight = true;
        try { await this._backupSurghubBeforeSync(); } catch (e) {}

        this._showApiSyncOverlay('Sync Everything');
        this._updateApiSyncOverlay('Starting…', 0);
        const stages = [
            { label: 'Courses', fn: () => this.syncCourseFoundationFromApi({ silent: true }) },
            { label: 'Demographics + lead attribution', fn: () => this.syncDemographicsFromApi({ silent: true }) },
            { label: 'Ambassadors', fn: () => this.syncAmbassadorsFromApi({ silent: true }) }
        ];
        const done = [];
        for (const stage of stages) {
            try {
                const r = await stage.fn();
                done.push({ label: stage.label, ok: true, result: r });
                console.log('[FullSync] ✓', stage.label, r);
            } catch (e) {
                done.push({ label: stage.label, ok: false, error: e.message });
                console.error('[FullSync] ✗', stage.label, e);
            }
        }
        this._hideApiSyncOverlay();
        this._apiSyncInFlight = false;
        this.navigate('platform');

        const lines = ['Sync Everything — Complete\n'];
        for (const s of done) {
            if (!s.ok) { lines.push(`✗ ${s.label}: ${s.error}`); continue; }
            const r = s.result || {};
            if (s.label === 'Courses') lines.push(`✓ Courses: ${r.courses != null ? r.courses : '?'} processed`);
            else if (s.label.startsWith('Demographics')) {
                lines.push(`✓ ${(r.totalUsers || 0).toLocaleString()} learners`);
                if (r.deepCertRecords != null) lines.push(`✓ ${r.deepCertRecords.toLocaleString()} certificate records`);
                if (r.ambassadorBonus) lines.push(`✓ ${r.ambassadorBonus.HistoricalTotal.toLocaleString()} historical leads`);
                const dcLine = this._demoCoverageLine(r.demoCoverage);
                if (dcLine) lines.push(dcLine);
            } else if (s.label === 'Ambassadors') {
                lines.push(`✓ Ambassadors timeline refreshed`);
            }
        }
        alert(lines.join('\n'));
        // Auto-run the provenance firewall now that all receipts are fresh.
        this.autoVerifyAfterSync();
    },

    // Pull Course Foundation directly from the LearnWorlds API. Produces the
    // same masterRows shape that processMasterUpload would, then runs the
    // shared reconciler so behaviour is identical to the CSV path.
    // ── Floating API-sync overlay (non-modal, bottom-right) ─────────────
    // Used by all *FromApi syncs so progress shows up regardless of which
    // section the user is viewing. Non-modal so the user can navigate while
    // a long sync runs.
    _showApiSyncOverlay(title) {
        let host = document.getElementById('lw-api-sync-overlay');
        if (host) host.remove();
        host = document.createElement('div');
        host.id = 'lw-api-sync-overlay';
        host.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.15);padding:14px 18px;min-width:320px;max-width:420px;';
        host.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                <div style="width:16px;height:16px;border:2px solid #16a34a;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
                <span id="lw-api-sync-title" style="font-size:13px;font-weight:700;color:#0f172a;">${title || 'LearnWorlds sync'}</span>
                <button onclick="App.cancelLearnWorldsSync()" style="margin-left:auto;background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:11px;font-weight:600;">Cancel</button>
            </div>
            <p id="lw-api-sync-text" style="font-size:12px;color:#64748b;margin:0 0 8px;line-height:1.4;">Starting…</p>
            <div style="width:100%;height:5px;background:#f1f5f9;border-radius:5px;overflow:hidden;">
                <div id="lw-api-sync-bar" style="width:0%;height:100%;background:linear-gradient(90deg,#16a34a,#059669);border-radius:5px;transition:width 0.3s ease;"></div>
            </div>`;
        document.body.appendChild(host);
    },
    _updateApiSyncOverlay(text, pct) {
        if (!document.getElementById('lw-api-sync-overlay')) this._showApiSyncOverlay();
        const t = document.getElementById('lw-api-sync-text');
        const b = document.getElementById('lw-api-sync-bar');
        if (t) t.textContent = text;
        if (b && typeof pct === 'number') b.style.width = Math.min(100, Math.max(0, pct)) + '%';
    },
    _hideApiSyncOverlay() {
        const o = document.getElementById('lw-api-sync-overlay');
        if (o) o.remove();
    },

    // User-callable abort — clicks Stop button or just navigates away.
    cancelLearnWorldsSync() {
        if (window.LearnWorlds && window.LearnWorlds.abort) {
            window.LearnWorlds.abort();
            this.loadingText = 'Cancelling…';
        }
    },

    async syncCourseFoundationFromApi(opts) {
        opts = opts || {};
        if (!window.LearnWorlds) {
            if (!opts.silent) alert("LearnWorlds module not loaded.");
            throw new Error('LearnWorlds module not loaded.');
        }
        const creds = await window.LearnWorlds.getCredentials();
        if (!creds.clientId || !creds.apiToken) {
            if (!opts.silent) {
                this.showMsg('⚠ Add LearnWorlds API credentials in Settings first');
                this.navigate('settings');
            }
            throw new Error('No LearnWorlds credentials');
        }
        if (!this._apiSyncInFlight) { try { await this._backupSurghubBeforeSync(); } catch (e) {} }
        if (!opts.silent) {
            if (this._apiSyncInFlight) { this.showMsg('⚠ A sync is already running — let it finish or Cancel it first.'); throw new Error('Sync already running'); }
            this._apiSyncInFlight = true;
            this._showApiSyncOverlay('Sync Courses');
        }
        this._updateApiSyncOverlay('Connecting to LearnWorlds…', 0);
        try {
            try { window.LearnWorlds.startRawPull('course-foundation'); } catch (e) {}
            const masterRows = await window.LearnWorlds.fetchCourseFoundation(p => {
                let text, pct;
                if (p.phase === 'list') {
                    text = `Listing courses (page ${p.page}/${p.totalPages})…`;
                    pct = (p.page / Math.max(1, p.totalPages)) * 30;
                } else if (p.phase === 'deep') {
                    text = `Fetching counts: ${(p.course || '').substring(0, 30)}… (${p.current}/${p.total})`;
                    pct = 30 + (p.current / Math.max(1, p.total)) * 65;
                } else {
                    text = 'Working…'; pct = 50;
                }
                this._updateApiSyncOverlay(text, pct);
            });
            try { window.LearnWorlds.finishRawPull(true); } catch (e) {}
            // Provider/links enrichment: prefer a freshly-attached file, else
            // fall back to the PERSISTED mapping (uploaded once, auto-applied
            // on every sync). This is why providers survive API course refreshes.
            const provMap = this.mappingFile
                ? await window.Pipeline.readExcel(this.mappingFile)
                : ((await Storage.getItem('surgdash_provider_map')) || []);
            const linkMap = this.linksFile
                ? await window.Pipeline.readExcel(this.linksFile)
                : ((await Storage.getItem('surgdash_course_links')) || []);
            if (provMap.length) console.log(`[CourseSync] Applying ${provMap.length}-row provider map`);
            if (linkMap.length) console.log(`[CourseSync] Applying ${linkMap.length}-row course-links map`);
            this._updateApiSyncOverlay('Reconciling local data…', 98);
            const summary = await this._reconcileCourseFoundation(masterRows, provMap, linkMap, 'LearnWorlds API', { silent: opts.silent, applyMapping: !!(this.mappingFile || this.linksFile) });
            if (!opts.silent) { this._hideApiSyncOverlay(); this._apiSyncInFlight = false; this.autoVerifyAfterSync(); }
            return { ok: true, courses: masterRows.length, summary };
        } catch (err) {
            if (!opts.silent) {
                this._hideApiSyncOverlay();
                this._apiSyncInFlight = false;
                if (err.message !== 'Sync already running') alert("LearnWorlds sync error: " + err.message);
            }
            throw err;
        }
    },

    // Shared reconciler — runs the merge/skip/refresh logic used by both the
    // CSV import path and the LearnWorlds API path. masterRows must contain
    // {Course, Learners, Certificates} (extra fields are ignored).
    async _reconcileCourseFoundation(masterRows, provMap, linkMap, sourceLabel, opts) {
        opts = opts || {};
        try {
            // Build lookups of the most recent existing entry, BY SLUG (CourseId) and
            // BY TITLE. An incoming row matches an existing record by slug first; if
            // none, it falls back to a title match ONLY when that title-record has no
            // conflicting slug (so a legacy title-only record GAINS this slug, while a
            // same-titled DIFFERENT course — e.g. a draft clone — stays a separate
            // record instead of being re-merged).
            const prevById = {};
            const prevByTitle = {};
            this.data.forEach(d => {
                if (d.IsShell || !d.Course) return;
                if (d.CourseId != null && String(d.CourseId) !== '') {
                    const p = prevById[d.CourseId];
                    if (!p || (d.Timestamp || '') > (p.Timestamp || '')) prevById[d.CourseId] = d;
                }
                const t = prevByTitle[d.Course];
                if (!t || (d.Timestamp || '') > (t.Timestamp || '')) prevByTitle[d.Course] = d;
            });

            let newCourses = 0;
            let skipped = 0;
            let metricsRefreshed = 0;
            let providerRefreshed = 0;
            let urlRefreshed = 0;
            let missingProvider = 0;
            let missingLink = 0;

            masterRows.forEach(row => {
                const title = String(row.Course).trim();
                const normTitle = window.Pipeline.normalizeString(title);
                // Slug-first match; title fallback only if it won't collide with a
                // different slug (keeps a course and its same-named clone separate).
                let prev = (row._courseId != null && String(row._courseId) !== '') ? prevById[row._courseId] : null;
                if (!prev) {
                    const t = prevByTitle[title];
                    if (t && (t.CourseId == null || String(t.CourseId) === '' || row._courseId == null || String(t.CourseId) === String(row._courseId))) prev = t;
                }

                // Provider: use mapping file if provided, else preserve existing, else Unknown
                let provider = prev ? prev.Provider : "Unknown Provider";
                if (provMap.length) {
                    const matched = this._matchProvider(normTitle, provMap);
                    if (matched) provider = matched;
                }

                // URL: use link file if provided, else preserve existing, else empty
                let url = prev ? (prev.URL || "") : "";
                if (linkMap.length) {
                    const matchedUrl = this._matchLink(normTitle, linkMap);
                    if (matchedUrl) url = matchedUrl;
                }

                if (prev) {
                    // Course already exists — don't create a duplicate snapshot row.
                    // BUT always refresh Learners / Certificates from the new export so
                    // the platform totals stay current. (Without this, re-running Step 1
                    // would leave stale enrollment/cert counts on existing courses.)
                    let updated = false;
                    // Zero-guard: enrolment/cert counts never legitimately drop to
                    // zero — a 0 from the API (analytics glitch, rate limit) must
                    // not wipe a real stored value. Seen live: analytics returned
                    // students:0 for courses with hundreds of learners.
                    if (row.Learners != null && Number(prev.Learners) !== Number(row.Learners)) {
                        if (Number(row.Learners) === 0 && Number(prev.Learners) > 0) {
                            console.warn('[CourseSync] kept existing Learners for', title, '— source reported 0 (was', prev.Learners, ')');
                        } else {
                            prev.Learners = row.Learners;
                            updated = true;
                        }
                    }
                    // Preservation guard: if the source couldn't determine cert count
                    // (row.Certificates is null — e.g. LearnWorlds API path on a plan
                    // that doesn't expose cert counts), keep the existing local value
                    // (likely from a prior CSV import). Only overwrite when source
                    // gave us a real number.
                    if (row.Certificates != null && Number(prev.Certificates) !== Number(row.Certificates)) {
                        if (Number(row.Certificates) === 0 && Number(prev.Certificates) > 0) {
                            console.warn('[CourseSync] kept existing Certificates for', title, '— source reported 0 (was', prev.Certificates, ')');
                        } else {
                            prev.Certificates = row.Certificates;
                            updated = true;
                        }
                    }
                    // Analytics enrichment (from /courses/{id}/analytics): learning
                    // minutes, success rate, avg time-to-finish. Only overwrite when
                    // the source provided a value (null = not available this run).
                    if (row.LearningMinutes != null && prev.LearningMinutes !== row.LearningMinutes) {
                        prev.LearningMinutes = row.LearningMinutes; updated = true;
                    }
                    if (row.SuccessRate != null) prev.SuccessRate = row.SuccessRate;
                    if (row.AvgFinishMinutes != null) prev.AvgFinishMinutes = row.AvgFinishMinutes;
                    // LearnWorlds course id (the slug used in the public course
                    // URL surghub.org/course/{id}) — only the API path supplies
                    // it; CSV imports leave any previously stored id intact.
                    // LearnWorlds slug + publication status (access/modified). Guard
                    // against a same-named DRAFT/zero-enrolment CLONE hijacking the
                    // identity of the published course that owns the real counts: only
                    // adopt the incoming id/status when THIS row carries learners (or
                    // the stored row has none yet). Without this, the draft clone
                    // "pen-programme-en" (0 learners) overwrote the published
                    // "pen-programme" (1,886) — same title, processed last.
                    const rowOwnsIdentity = Number(row.Learners) > 0 || !(Number(prev.Learners) > 0);
                    if (rowOwnsIdentity && row._courseId && prev.CourseId !== row._courseId) prev.CourseId = row._courseId;
                    // Publication status (access) follows the SLUG and is refreshed on
                    // every sync THAT RETURNS THIS COURSE — a course can flip
                    // free↔private↔draft with NO change in enrolments, so it must NOT be
                    // gated on learner count. (A course absent from a partial/rate-limited
                    // pull keeps its prior status, like every other field.) Update when this
                    // row IS this course (its slug == the record's CourseId, evaluated AFTER
                    // the identity update above), or to fill a first-time blank. A same-named
                    // DIFFERENT course (a clone with another slug) won't match, so it can't
                    // clobber the published status.
                    const _rowIsThisCourse = (row._courseId != null && row._courseId === prev.CourseId);
                    if (row._access != null && (_rowIsThisCourse || prev.Access == null) && prev.Access !== row._access) { prev.Access = row._access; updated = true; }
                    if (row._modified != null && _rowIsThisCourse && prev.Modified !== row._modified) prev.Modified = row._modified;
                    if (row._courseCreated && prev.CourseCreated !== row._courseCreated) prev.CourseCreated = row._courseCreated;
                    // Stamp the timestamp on the refreshed row so the directory shows it
                    // as recently synced (matches user expectation that re-running Step 1
                    // produces "fresh" data).
                    if (updated) prev.Timestamp = this.updateDate;
                    if (updated) metricsRefreshed++;

                    // Refresh Provider / URL ONLY when a mapping/links file was
                    // freshly uploaded this run (opts.applyMapping). Routine syncs
                    // leave existing courses' Provider/URL/manual edits untouched;
                    // stored maps still apply to NEW courses. Use "Apply to
                    // existing courses now" to push stored maps explicitly.
                    if (opts.applyMapping && provMap.length && provider && provider !== "Unknown Provider" && provider !== prev.Provider) {
                        prev.Provider = provider;
                        providerRefreshed++;
                    }
                    if (opts.applyMapping && linkMap.length && url && url !== prev.URL) {
                        prev.URL = url;
                        urlRefreshed++;
                    }
                    if (!updated) skipped++;
                } else {
                    // Genuinely new course — add it as a fresh row.
                    newCourses++;
                    this.data.push({
                        IsShell: false, Timestamp: this.updateDate, Provider: provider, Course: title,
                        Learners: row.Learners != null ? row.Learners : 0,
                        Certificates: row.Certificates != null ? row.Certificates : 0,
                        LearningMinutes: row.LearningMinutes != null ? row.LearningMinutes : null,
                        SuccessRate: row.SuccessRate != null ? row.SuccessRate : null,
                        AvgFinishMinutes: row.AvgFinishMinutes != null ? row.AvgFinishMinutes : null,
                        CourseId: row._courseId || null,
                        CourseCreated: row._courseCreated || null,
                        Access: row._access != null ? row._access : null,
                        Modified: row._modified || null,
                        Rating: 0, Responses: 0, URL: url
                    });
                }

                if (!provider || provider === "Unknown Provider") missingProvider++;
                if (!url) missingLink++;
            });

            const repairedFromTl = this._repairZeroCountsFromTimelines();
            const clampedTl = this._clampTimelinesToLaunch();
            const rebuiltTl = await this._rebuildTimelinesFromCompletion();
            // The rebuild writes exact totals (totalE/totalC) that the FIRST
            // repair pass couldn't use (scaled timelines are skipped by design).
            // Run the zero-repair again so 0-count courses heal in THIS sync
            // instead of the next one (seen live: Femoral Neck Fractures
            // stuck at Learners=0 with 188 certificates for a full day).
            const repairedAfterRebuild = this._repairZeroCountsFromTimelines();
            if (repairedAfterRebuild) console.log('[CourseSync] post-rebuild zero-repair fixed ' + repairedAfterRebuild + ' course(s).');
            this._rescaleTimelinesToTotals();
            this._backfillRatingsFromQuestionStats();
            const healedSurveys = linkMap.length ? this._dedupeSurveyAssignments(linkMap) : 0;
            if (healedSurveys) console.log('[CourseSync] cleared cross-assigned survey stats on ' + healedSurveys + ' course(s).');

            this.isLoading = false;
            await this.handleDbSave();
            this.renderView();

            const summaryLines = [];
            summaryLines.push(`${masterRows.length} course${masterRows.length !== 1 ? 's' : ''} processed.`);
            if (newCourses > 0)        summaryLines.push(`✓ ${newCourses} new course${newCourses !== 1 ? 's' : ''} added.`);
            if (metricsRefreshed > 0)  summaryLines.push(`↻ ${metricsRefreshed} course${metricsRefreshed !== 1 ? 's' : ''} updated with new enrollment / certificate counts.`);
            if (skipped > 0)           summaryLines.push(`↷ ${skipped} course${skipped !== 1 ? 's' : ''} unchanged.`);
            if (providerRefreshed > 0) summaryLines.push(`↻ ${providerRefreshed} provider${providerRefreshed !== 1 ? 's' : ''} updated from new mapping file.`);
            if (urlRefreshed > 0)      summaryLines.push(`↻ ${urlRefreshed} survey link${urlRefreshed !== 1 ? 's' : ''} updated from new links file.`);
            if (repairedFromTl > 0)    summaryLines.push(`✚ ${repairedFromTl} course${repairedFromTl !== 1 ? 's' : ''} repaired from timeline counts (source reported 0).`);
            if (clampedTl > 0)         summaryLines.push(`⏱ ${clampedTl} course timeline${clampedTl !== 1 ? 's' : ''} clamped to launch date (pre-launch signup dates folded in).`);
            if (rebuiltTl > 0)         summaryLines.push(`◷ ${rebuiltTl} course timeline${rebuiltTl !== 1 ? 's' : ''} rebuilt from exact start dates (progress export).`);
            const warnings = [];
            if (missingProvider > 0) warnings.push(`${missingProvider} missing provider`);
            if (missingLink > 0)     warnings.push(`${missingLink} missing survey link`);
            let msg = `Sync Courses complete (source: ${sourceLabel || 'CSV'})\n\n` + summaryLines.join("\n");
            if (warnings.length > 0) msg += "\n\n⚠ " + warnings.join(", ") + ".\nUpload a Provider Map or Course Links file to fix.";
            if (!opts.silent) alert(msg);
            return { newCourses, metricsRefreshed, skipped, providerRefreshed, urlRefreshed, missingProvider, missingLink, summary: summaryLines.join('; ') };
        } catch (err) {
            this.isLoading = false; this.renderView();
            throw err;
        }
    },

    async runSurveyFetch() {
        const tokenMatch = (this.tokenText || '').match(/access_token=([^&]+)/);
        if (!tokenMatch) return alert("Paste a fresh Survey-Exports download URL first.\n\nIt carries the short-lived access token the survey fetch needs (the API key can't authorise survey exports).");
        this.extractedToken = tokenMatch[1];

        // Latest entry per course that has a survey URL (from Course Links).
        const latestByCourse = {};
        this.data.forEach(d => {
            if (d.IsShell || !d.Course) return;
            const prev = latestByCourse[d.Course];
            if (!prev || (d.Timestamp || '') > (prev.Timestamp || '')) latestByCourse[d.Course] = d;
        });
        this.updateQueue = Object.values(latestByCourse).filter(d => d.URL);
        this.totalUpdateCount = this.updateQueue.length;
        this.currentUpdateIndex = 0;

        if (this.totalUpdateCount === 0) {
            const totalCourses = Object.keys(latestByCourse).length;
            if (totalCourses === 0) {
                return alert("No courses found.\n\nRun Sync Courses first.");
            }
            return alert(`No courses have survey links.\n\n${totalCourses} course${totalCourses !== 1 ? 's are' : ' is'} loaded, but none have a survey URL.\n\nUpload a Course Links file in the Sync Courses card.`);
        }

        if (this._apiSyncInFlight) { this.showMsg('⚠ A sync is already running — let it finish or Cancel it first.'); return; }
        this._apiSyncInFlight = true;
        this._showApiSyncOverlay('Sync Surveys');
        this._updateApiSyncOverlay(`Fetching survey data for ${this.totalUpdateCount} courses…`, 0);
        await this.executeSurveyLoop();
    },

    updateProgressUI() {
        const pText = document.getElementById('progress-text');
        const pBar = document.getElementById('progress-bar');
        const pCount = document.getElementById('progress-count');
        if (pText) pText.innerText = this.loadingText;
        if (pCount) pCount.innerText = `${this.currentUpdateIndex} / ${this.totalUpdateCount}`;
        if (pBar && this.totalUpdateCount > 0) pBar.style.width = `${(this.currentUpdateIndex / this.totalUpdateCount) * 100}%`;
    },

    async executeSurveyLoop() {
        let _ok = 0, _fail = 0, _expired = false;
        for (let i = 0; i < this.updateQueue.length; i++) {
            const course = this.updateQueue[i];
            this.currentUpdateIndex = i + 1;
            this._updateApiSyncOverlay(`Survey: ${course.Course.substring(0, 30)}… (${i + 1}/${this.updateQueue.length})`, ((i + 1) / this.updateQueue.length) * 100);
            await new Promise(r => setTimeout(r, 60));

            try {
                // Replace existing access_token with the fresh one, or append if missing
                let targetUrl = course.URL;
                if (targetUrl.includes('access_token=')) {
                    targetUrl = targetUrl.replace(/access_token=[^&]*/, 'access_token=' + this.extractedToken);
                } else {
                    targetUrl = targetUrl + (targetUrl.includes('?') ? '&' : '?') + 'access_token=' + this.extractedToken;
                }
                
                const res = await fetch(targetUrl);
                if (res.ok) {
                    const buffer = await res.arrayBuffer();
                    const bytes = new Uint8Array(buffer);
                    // Session-expired errors return HTTP 200 with a JSON body
                    // ('{"errors":[...session has expired...]}'). A real XLSX
                    // starts with the ZIP signature "PK" (0x50 0x4B). Detect the
                    // JSON-error case so we can stop and prompt for a fresh token.
                    if (bytes.length > 1 && bytes[0] === 0x7B /* { */) {
                        const txt = new TextDecoder().decode(bytes.slice(0, 220));
                        if (/session has expired|login again|"code":403/i.test(txt)) { _expired = true; break; }
                        _fail++; continue;
                    }
                    const wb = XLSX.read(bytes, { type: 'array' });
                    const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });

                    if (json && json.length > 0) {
                        course.Responses = json.length;
                        const cols = Object.keys(json[0]);
                        // Rating column: first question about overall satisfaction (EN/FR/ES)
                        // Use the FIRST "escala del 1 al 5" / "échelle de 1 à 5" / "rating" match = overall satisfaction
                        const rCol = cols.find(k => {
                            const lk = k.toLowerCase();
                            return lk.includes('rating') || lk.includes('overall satisfaction') || lk.includes('score') ||
                                // Spanish: first "escala" question is overall satisfaction
                                (lk.includes('escala del 1 al 5') && (lk.includes('satisfacción general') || lk.includes('satisfacci'))) ||
                                // French: first "échelle" question is overall satisfaction
                                (lk.includes('échelle de 1') && (lk.includes('satisfaction') || lk.includes('niveau de satisfaction'))) ||
                                // Generic multilingual: "satisfaction" in the first scale question
                                (lk.includes('1 al 5') && lk.includes('satisfac')) ||
                                (lk.includes('1 à 5') && lk.includes('satisfac')) ||
                                // Some courses word the overall question differently (e.g. "rate the
                                // overall quality of this module") — catch those too.
                                lk.includes('overall quality') || lk.includes('rate the overall');
                        });
                        // Fallback: if no satisfaction-style column matched, use the FIRST 1–5 scale
                        // question (conventionally the overall rating). Without this, courses whose
                        // overall question is worded unusually end up with Rating 0 (seen live:
                        // "Wound Healing after C-Section" → "rate the overall quality of this module").
                        const rColFinal = rCol || cols.find(k => {
                            const lk = k.toLowerCase();
                            return lk.includes('scale from 1 to 5') || lk.includes('1 to 5') ||
                                   lk.includes('escala del 1 al 5') || lk.includes('1 al 5') ||
                                   lk.includes('échelle de 1') || lk.includes('1 à 5');
                        });
                        const dateCol = cols.find(k => {
                            const lk = k.toLowerCase();
                            return lk.includes('date') || lk.includes('submitted') || lk.includes('created') || lk.includes('timestamp') ||
                                lk.includes('fecha') || lk.includes('soumis');
                        });
                        const textCols = cols.filter(k => {
                            const lk = k.toLowerCase();
                            return (
                                // English
                                lk.includes('comment') || lk.includes('feedback') || lk.includes('improve') ||
                                lk.includes('suggest') || lk.includes('additional') || lk.includes('tell us') || lk.includes('open') ||
                                // Spanish
                                lk.includes('comentario') || lk.includes('sugerencia') || lk.includes('mejores aspectos') ||
                                lk.includes('peores aspectos') || lk.includes('problemas técnicos') || lk.includes('problemas tecnicos') ||
                                // French
                                lk.includes('commentaire') || lk.includes('intéressants') || lk.includes('interessants') ||
                                lk.includes('amélioré') || lk.includes('ameliore') || lk.includes('problèmes techniques') ||
                                lk.includes('problemes techniques') || lk.includes("d'autres commentaires") ||
                                lk.includes('autres commentaires')
                            );
                        });

                        if (rColFinal) {
                            const ratings = json.map(r => window.Pipeline.cleanNum(r[rColFinal])).filter(v => v > 0);
                            if (ratings.length > 0) course.Rating = (ratings.reduce((a,b) => a+b, 0) / ratings.length).toFixed(2);
                        }

                        // Build RatingHistory: monthly { sum, count, volume }
                        // count = rows with valid rating (for average calculation)
                        // volume = total survey responses (for bar chart)
                        let ratingHistory = {};
                        json.forEach(row => {
                            let month = null;
                            if (dateCol && row[dateCol]) {
                                month = window.Pipeline.parseDateToMonth(row[dateCol]);
                            }
                            if (!month) month = this.updateDate.substring(0, 7); // fallback to update month
                            if (!ratingHistory[month]) ratingHistory[month] = { sum: 0, count: 0, volume: 0 };
                            ratingHistory[month].volume++;
                            if (rColFinal) {
                                let val = window.Pipeline.cleanNum(row[rColFinal]);
                                if (val > 0) {
                                    ratingHistory[month].sum += val;
                                    ratingHistory[month].count++;
                                }
                            }
                        });
                        course.RatingHistory = JSON.stringify(ratingHistory);

                        // ── Capture ALL 1–5 scale questions (not just overall satisfaction).
                        // The course survey carries Likert items like "the information was
                        // new to me" and "it is likely that I will use the information
                        // acquired" — key transformative-change indicators. Stats per
                        // question: avg + distribution of 1–5 answers; '0' = N/A (the two
                        // job questions allow it for unemployed learners); 'NO DATA' skipped.
                        const scaleCols = cols.filter(k => {
                            const lk = k.toLowerCase();
                            return lk.includes('scale from 1 to 5') || lk.includes('escala del 1 al 5') ||
                                lk.includes('échelle de 1') || lk.includes('echelle de 1') ||
                                lk.includes('how strongly do you agree') || lk.includes('how important') ||
                                lk.includes('qué tan de acuerdo') || lk.includes('que tan de acuerdo') ||
                                lk.includes('dans quelle mesure') || (rCol && k === rCol);
                        });
                        const qStats = [];
                        scaleCols.forEach(qc => {
                            let sum = 0, n = 0, na = 0; const dist = {};
                            json.forEach(row => {
                                const v = String(row[qc] === undefined || row[qc] === null ? '' : row[qc]).trim();
                                if (!/^[0-5]$/.test(v)) return;
                                const num = +v;
                                if (num === 0) { na++; return; }
                                sum += num; n++; dist[num] = (dist[num] || 0) + 1;
                            });
                            if (n > 0) qStats.push({ q: qc, avg: +(sum / n).toFixed(2), n, na, dist });
                        });
                        if (qStats.length > 0) course.QuestionStats = JSON.stringify(qStats);

                        // Build FeedbackBank: text comments with dates and sentiment
                        // Tag each entry with source column type for platform-level filtering
                        // Find User column for initials extraction
                        const userCol = cols.find(k => k.toLowerCase() === 'user' || k.toLowerCase() === 'usuario' || k.toLowerCase() === 'utilisateur');
                        let feedbackBank = [];
                        json.forEach(row => {
                            // Use the actual submission date (full YYYY-MM-DD) when available.
                            // Falls back to today's updateDate when the survey export has no date column.
                            // (Older code synthesised the 15th of every month — that's why old data shows
                            // dates clustered on the 15th. Re-run Step 2 to refresh with real dates.)
                            let date;
                            if (dateCol && row[dateCol]) {
                                date = window.Pipeline.parseDateToExact(row[dateCol]);
                                // parseDateToExact falls back to '2023-01-01' on parse failure — treat that
                                // as missing and use today instead so we don't dump everything into Jan 2023.
                                if (date === '2023-01-01') date = this.updateDate;
                            } else {
                                date = this.updateDate;
                            }
                            // Extract user initials and email from "Name (email)" format
                            let initials = '', email = '';
                            if (userCol && row[userCol]) {
                                const userStr = String(row[userCol]).trim();
                                const nameMatch = userStr.match(/^(.+?)\s*\(/);
                                const name = nameMatch ? nameMatch[1].trim() : (userStr.includes('@') ? '' : userStr);
                                if (name && name.toLowerCase() !== 'anonymous') {
                                    initials = name.split(/\s+/).map(w => w.charAt(0).toUpperCase()).join('').substring(0, 3);
                                }
                                const emailMatch = userStr.match(/\(([^)]+@[^)]+)\)/);
                                if (emailMatch) email = emailMatch[1].trim().toLowerCase();
                            }
                            textCols.forEach(tc => {
                                let text = String(row[tc] || '').trim();
                                if (text && text.length > 5 && !['nan','n/a','na','none','-','no'].includes(text.toLowerCase())) {
                                    let rating = rCol ? window.Pipeline.cleanNum(row[rCol]) : 0;
                                    let sentiment = rating >= 4 ? 'Positive' : rating > 0 && rating < 3 ? 'Critical' : 'Neutral';
                                    // Classify column type: 'additional' for open-ended, 'improve' for improvement-focused, 'general' for others
                                    let lk = tc.toLowerCase();
                                    let colType = (
                                        lk.includes('additional') || lk.includes('other') || lk.includes('tell us') || lk.includes('open') || lk.includes('anything else') ||
                                        lk.includes('comentario o sugerencia') || lk.includes("d'autres commentaires") || lk.includes('autres commentaires') ||
                                        lk.includes('problemas técnicos') || lk.includes('problemas tecnicos') || lk.includes('problèmes techniques') || lk.includes('problemes techniques')
                                    )
                                        ? 'additional'
                                        : (
                                            lk.includes('improve') || lk.includes('suggest') || lk.includes('change') || lk.includes('better') ||
                                            lk.includes('peores aspectos') || lk.includes('moins intéressants') || lk.includes('moins interessants') ||
                                            lk.includes('amélioré') || lk.includes('ameliore')
                                        )
                                        ? 'improve'
                                        : 'general';
                                    let entry = { t: text, d: date, s: sentiment, r: rating, c: colType };
                                    if (initials) entry.u = initials;
                                    if (email) entry.e = email;
                                    feedbackBank.push(entry);
                                }
                            });
                        });
                        if (feedbackBank.length > 0) course.FeedbackBank = JSON.stringify(feedbackBank);
                        _ok++;
                    } else { _fail++; }
                }
            } catch (err) { console.error(`Survey failed: ${course.Course}`, err); _fail++; }
        }

        // ── Signup survey (Gender + Organisation Type). Lives in the same
        // Survey Exports area as the course surveys, so the fresh token also
        // authorises it. Fetched automatically when an export URL is saved
        // (see setSignupSurveyUrl) — replaces the manual upload.
        let _signup = null, _signupErr = null;
        if (!_expired) {
            try {
                const su = await Storage.getItem('surghub_signup_survey_url');
                if (su && typeof su === 'string') {
                    this._updateApiSyncOverlay('Signup survey (gender + organisation type)…', 100);
                    const url = su.includes('access_token=')
                        ? su.replace(/access_token=[^&]*/, 'access_token=' + this.extractedToken)
                        : su + (su.includes('?') ? '&' : '?') + 'access_token=' + this.extractedToken;
                    const res = await fetch(url);
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    const bytes = new Uint8Array(await res.arrayBuffer());
                    if (bytes.length > 1 && bytes[0] === 0x7B /* { = JSON error body */) {
                        const txt = new TextDecoder().decode(bytes.slice(0, 220));
                        if (/session has expired|login again|"code":403/i.test(txt)) { _expired = true; }
                        else if (/being computed|reports log/i.test(txt)) throw new Error('the endpoint queued the export to the Reports Log instead of returning the file — this form may not support direct download (async=false)');
                        else throw new Error('unexpected JSON response');
                    } else {
                        const wb = XLSX.read(bytes, { type: 'array' });
                        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
                        _signup = await this._ingestSignupSurveyRows(rows);
                    }
                }
            } catch (e) {
                _signupErr = e.message;
                console.warn('[Surveys] signup-survey auto-fetch failed:', e.message);
            }
        }

        this._hideApiSyncOverlay();
        this._apiSyncInFlight = false;
        this.isLoading = false;
        await this.handleDbSave();
        this.renderView();
        if (_expired) {
            alert('Survey token expired ⚠\n\nThe access token in the pasted URL has expired. Open Survey Exports, export any assessment, copy the fresh download URL (Cmd+L → Cmd+C), paste it into the Sync Surveys box, and run again.');
        } else {
            let msg = `Sync Surveys Complete ✓\n\n${_ok} course${_ok !== 1 ? 's' : ''} with survey data, ${_fail} with none/failed.`;
            if (_signup) {
                msg += `\n\nSignup survey auto-fetched ✓\n${this.formatNumber(_signup.nDemo)} learners with gender/organisation type` +
                    (_signup.enrichedG + _signup.enrichedO > 0
                        ? ` (enriched ${this.formatNumber(_signup.enrichedG)} gender · ${this.formatNumber(_signup.enrichedO)} org records).`
                        : '.');
            } else if (_signupErr) {
                msg += `\n\n⚠ Signup-survey auto-fetch failed: ${_signupErr}\nCheck the saved URL (Auto-Fetch Setup) or upload the export manually.`;
            }
            alert(msg);
        }
    },

    // ==========================================
    // 3. TIMELINES
    // Timeline provides the growth curve shape (daily enrollment/cert counts).
    // Course Export totals (Learners, Certificates) remain the source of truth.
    // Scale factors are embedded so charts can align endpoints with Course Export.
    // ==========================================
    async processRetroactiveHistory(event) {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        // Prerequisite: Step 1 must have been run first
        const step1Courses = this.data.filter(d => !d.IsShell && d.Learners !== undefined);
        if (step1Courses.length === 0) {
            alert("Run Sync Courses (card 1) first — timelines are matched to the synced course list. No course data found.");
            event.target.value = '';
            return;
        }

        alert(`Matching timeline data to existing courses...`);

        try {
            // Build lookup: latest-timestamp entry per course (timeline attaches here only)
            const latestEntries = {};
            this.data.forEach(d => {
                if (!d.IsShell) {
                    const key = d.Course;
                    if (!latestEntries[key] || d.Timestamp > latestEntries[key].Timestamp) {
                        latestEntries[key] = d;
                    }
                }
            });

            let totalProcessed = 0;
            let unmatchedSheets = [];

            for (let i = 0; i < files.length; i++) {
                let file = files[i];
                let allSheets = file.name.toLowerCase().endsWith('.csv')
                    ? { [file.name]: await window.Pipeline.readExcel(file) }
                    : await window.Pipeline.readAllSheets(file);

                Object.keys(allSheets).forEach(sheetName => {
                    const rows = allSheets[sheetName];
                    if (!rows || rows.length === 0) return;

                    let timeline = { e: 0, c: 0 }, timelineDates = {};
                    const countryStats = {};   // per-course country tally (for learner maps)
                    // Country lives in the comma-separated "Tags" column (kebab-case,
                    // like the API). Fall back to a dedicated country column if present.
                    const hdrKeys = Object.keys(rows[0] || {});
                    const tagsKey = hdrKeys.find(k => /^tags$/i.test(k));
                    const countryKey = hdrKeys.find(k => /country of nationality|currently based|nationality|country/i.test(k));
                    rows.forEach(row => {
                        let cc = null;
                        if (tagsKey && row[tagsKey] && window.LearnWorlds && window.LearnWorlds.classifyTag) {
                            for (const tag of String(row[tagsKey]).split(',')) {
                                const cls = window.LearnWorlds.classifyTag(tag);
                                if (cls && cls.type === 'country') { cc = cls.value; break; }
                            }
                        }
                        if (!cc && countryKey && row[countryKey]) {
                            cc = window.resolveCountryName ? window.resolveCountryName(String(row[countryKey]).trim()) : String(row[countryKey]).trim();
                        }
                        if (cc && cc !== 'Unknown' && String(cc).toLowerCase() !== 'nan') countryStats[cc] = (countryStats[cc] || 0) + 1;
                        const sKey = Object.keys(row).find(k => {
                            const lk = k.toLowerCase();
                            return lk.includes('course start date') || lk.includes('start') || lk.includes('registered') || lk === 'date';
                        });
                        const cKey = Object.keys(row).find(k => {
                            const lk = k.toLowerCase();
                            return lk.includes('date of certificate') || lk.includes('certificate date') || lk.includes('completed on');
                        });

                        if (sKey && row[sKey] && row[sKey] !== '-') {
                            let dt = window.Pipeline.parseDateToExact(row[sKey]);
                            if (dt && dt !== '2023-01-01') {
                                if (!timelineDates[dt]) timelineDates[dt] = { e: 0, c: 0 };
                                timelineDates[dt].e++; timeline.e++;
                            }
                        }
                        if (cKey && row[cKey] && row[cKey] !== '-') {
                            let dt = window.Pipeline.parseDateToExact(row[cKey]);
                            if (dt && dt !== '2023-01-01') {
                                if (!timelineDates[dt]) timelineDates[dt] = { e: 0, c: 0 };
                                timelineDates[dt].c++; timeline.c++;
                            }
                        }
                    });

                    // Skip sheets with no actual timeline data
                    if (timeline.e === 0 && timeline.c === 0) return;

                    let normName = window.Pipeline.normalizeString(
                        sheetName.replace(/^Enrolment timeline(\.xlsx)? \- /i, '').replace(/\.csv$/i, '').replace(/\d+$/, '')
                    );

                    // Match to best course: prefer shortest "extra" characters
                    let bestMatch = null, bestScore = Infinity;
                    Object.values(latestEntries).forEach(d => {
                        if (d._timelineAssigned) return; // Already matched by a better sheet
                        const normCourse = window.Pipeline.normalizeString(d.Course);
                        if (normCourse.includes(normName) || normName.includes(normCourse)) {
                            // Score: how many extra characters differ (lower = closer match)
                            const score = Math.abs(normCourse.length - normName.length);
                            if (score < bestScore) {
                                bestScore = score;
                                bestMatch = d;
                            }
                        }
                    });

                    let matchFound = false;
                    if (bestMatch) {
                        const d = bestMatch;
                        const exportLearners = Number(d.Learners) || 0;
                        const exportCerts = Number(d.Certificates) || 0;
                        const scale = {
                            enrollScale: (exportLearners > 0 && timeline.e > 0) ? exportLearners / timeline.e : 1,
                            certScale: (exportCerts > 0 && timeline.c > 0) ? exportCerts / timeline.c : 1
                        };
                        d.CourseTimeline = JSON.stringify({
                            totalE: timeline.e, totalC: timeline.c,
                            timeline: timelineDates,
                            scale: scale
                        });
                        // If the timeline file carried a country column, store the
                        // per-course breakdown so the learner maps populate too.
                        if (Object.keys(countryStats).length > 0) d.CountryStats = JSON.stringify(countryStats);
                        d._timelineAssigned = true;
                        matchFound = true;
                    }

                    if (matchFound) totalProcessed++;
                    else unmatchedSheets.push(sheetName);
                });
            }

            // Clean up _timelineAssigned markers
            Object.values(latestEntries).forEach(d => { delete d._timelineAssigned; });

            // Clean up: remove CourseTimeline from older snapshots (only latest has it)
            this.data.forEach(d => {
                if (!d.IsShell && d.CourseTimeline && latestEntries[d.Course] && d !== latestEntries[d.Course]) {
                    delete d.CourseTimeline;
                }
            });

            // Detect mismatches for user awareness
            let mismatches = [];
            Object.values(latestEntries).forEach(d => {
                if (d.CourseTimeline) {
                    const tl = JSON.parse(d.CourseTimeline);
                    const exportL = Number(d.Learners) || 0;
                    const timelineL = tl.totalE || 0;
                    if (exportL > 0 && timelineL > 0) {
                        const drift = Math.abs(exportL - timelineL) / exportL;
                        if (drift > 0.02) {
                            mismatches.push({ course: d.Course, exportL, timelineL });
                        }
                    }
                }
            });
            this.timelineMismatches = mismatches;

            await this.handleDbSave();
            this.navigate('platform');

            let msg = `Timelines attached to ${totalProcessed} courses!`;
            if (unmatchedSheets.length > 0) {
                msg += `\n\n${unmatchedSheets.length} sheet(s) could not be matched to any course.`;
            }
            if (mismatches.length > 0) {
                msg += `\n\n${mismatches.length} course(s) have enrollment differences between Course Export and Timeline (this is normal — Course Export includes unenrolled users). Charts are scaled to match Course Export totals.`;
            }
            alert(msg);
        } catch (err) { alert(`Data Error: ${err.message}`); }
        event.target.value = '';
    },

    // ==========================================
    // 4. AUDIENCE SYNC
    // ==========================================
    async processStandaloneAudience(event) {
        const file = event.target.files[0];
        if (!file) return;
        this.isLoading = true; this.renderView();

        try {
            let finalDate = new Date().toISOString().split('T')[0];
            const dateMatch = file.name.match(/(\d{4}-\d{2}-\d{2})/);
            if (dateMatch) finalDate = dateMatch[1];

            const usersJson = await window.Pipeline.readExcel(file);
            if (!usersJson || usersJson.length === 0) {
                throw new Error('The file appears to be empty (no rows found).');
            }

            // Validate file structure BEFORE aggregation so we can reject obvious
            // mistakes (Survey export uploaded into Users slot, etc.) with a clear
            // message instead of silently misinterpreting the data.
            const validation = this._validateUsersFile(usersJson);
            if (!validation.ok) {
                throw new Error(validation.reason);
            }

            const aggregated = this.runAudienceAggregation(usersJson);
            const diag = aggregated._diag || {};
            delete aggregated._diag; // don't persist diagnostics into userHistory

            // Safety: refuse to overwrite existing learner data with an empty result.
            if (!aggregated.TotalUsers || aggregated.TotalUsers === 0) {
                const otherCols = (diag.otherCandidates || []).join(', ') || '(none)';
                throw new Error(
                    'Upload produced 0 users — nothing was changed.\n\n' +
                    'The file parsed (' + usersJson.length + ' rows), but no rows had a recognisable signup date in the expected range (May 2023 onwards).\n\n' +
                    'Detected signup column: ' + (diag.signupColumn || 'none') + '\n' +
                    'Other candidates: ' + otherCols + '\n\n' +
                    'Most likely cause: LearnWorlds renamed the signup-date column. Please check the file or report the new column name.'
                );
            }

            // Sanity check: warn if the count is suspiciously low relative to total rows.
            // If less than 30% of rows produced a counted user, the wrong column was probably picked.
            const countedPct = diag.rowsTotal > 0 ? (diag.rowsCounted / diag.rowsTotal) * 100 : 0;
            if (diag.rowsTotal >= 50 && countedPct < 30) {
                const otherCols = (diag.otherCandidates || []).join(', ') || '(none)';
                const proceed = confirm(
                    'Only ' + diag.rowsCounted.toLocaleString() + ' of ' + diag.rowsTotal.toLocaleString() +
                    ' rows (' + countedPct.toFixed(1) + '%) had a usable signup date.\n\n' +
                    'Detected signup-date column: "' + diag.signupColumn + '" (fill rate ' + diag.signupColumnFillPct + '%)\n' +
                    'Other candidate columns: ' + otherCols + '\n\n' +
                    'This often means the wrong column was picked, or the export is filtered/truncated.\n\n' +
                    'Continue saving anyway?'
                );
                if (!proceed) {
                    this.isLoading = false; this.renderView();
                    return;
                }
            }

            // Build anonymized per-user records for provider export
            this._rawAnonymizedUsers = this._buildAnonymizedUsers(usersJson);
            await Storage.setItem('surghub_anon_users', this._rawAnonymizedUsers);

            // Build email-to-demographics map for linking feedback to user profiles
            this._emailDemoMap = this._buildEmailDemoMap(usersJson);
            await Storage.setItem('surghub_email_demo', this._emailDemoMap);

            this.userHistory = this.userHistory.filter(d => d.Timestamp !== finalDate);
            this.userHistory.push({ Timestamp: finalDate, ...aggregated });
            this.selectedDate = finalDate;
            this.platformUniqueUsers = aggregated.TotalUsers;

            await this.handleDbSave();
            this.isLoading = false;
            this.navigate('audience');

            // Success summary — let the user verify counts at a glance
            const parts = [];
            parts.push('✓ ' + aggregated.TotalUsers.toLocaleString() + ' users loaded from ' + diag.rowsTotal.toLocaleString() + ' rows.');
            if (diag.signupColumn) parts.push('Signup-date column: "' + diag.signupColumn + '" (' + diag.signupColumnFillPct + '% filled).');
            if (diag.rowsSkippedBefore2023May > 0) parts.push(diag.rowsSkippedBefore2023May.toLocaleString() + ' rows skipped (signup before May 2023).');
            if (diag.rowsSkippedNoDate > 0) parts.push(diag.rowsSkippedNoDate.toLocaleString() + ' rows skipped (no parseable signup date).');
            App.showMsg(parts.join(' '));
        } catch (err) {
            this.isLoading = false; this.renderView();
            alert(`Data Error: ${err.message}`);
        }
        event.target.value = '';
    },

    // Build a slug -> course title mapping using known course titles
    _buildSlugMap() {
        const STOP = new Set(['a','an','the','and','or','for','in','of','to','is','on','at','by','with','from','as','its','it']);

        // Basic stemming: strip trailing 's' for plural matching
        function stem(w) {
            if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
            return w;
        }

        // Normalize British/American spelling + strip accents + curly quotes
        function spellNorm(s) {
            return s.replace(/ae/g, 'e')      // anaesthesia -> anesthesia
                    .replace(/oe/g, 'e')       // oesophagus -> esophagus
                    .replace(/ou/g, 'o')        // tumour -> tumor, colour -> color
                    .replace(/isation/g, 'ization')
                    .replace(/yse/g, 'yze');
        }

        // Strip accents: é->e, ô->o, etc. Also normalize curly quotes
        function stripAccents(s) {
            return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
                    .replace(/[\u201C\u201D\u201E\u201F]/g, '"');
        }

        function getWords(s) {
            return stripAccents(s).toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/[\s-]+/).filter(w => w && !STOP.has(w));
        }
        function getStemmedWords(s) {
            return new Set(getWords(s).map(w => stem(spellNorm(w))));
        }
        function normStemJoined(s) {
            return getWords(s).map(w => stem(spellNorm(w))).join('');
        }
        function normPlain(s) {
            return stripAccents(s).toLowerCase().replace(/[^a-z0-9]/g, '');
        }

        const titles = this.data.filter(d => !d.IsShell).map(d => d.Course).filter(Boolean);
        const uniqueTitles = [...new Set(titles)];
        const map = {};

        // Pre-compute normalized forms for all titles
        const titleData = uniqueTitles.map(t => ({
            title: t,
            norm: normPlain(t),
            normStem: normStemJoined(t),
            words: getStemmedWords(t)
        }));

        // Manual overrides for slugs that can't be fuzzy-matched
        // (abbreviations, completely different names, etc.)
        const MANUAL = {
            'ppe': 'Personal Protective Equipment',
            'facial-trauma': 'A Crash Course in Facial Fractures',
            'self-learn-pulse-ox': 'Pulse Oximetry',
            'laparoscopic-cholecystectomy-bangla-approach': 'Laparoscopic Cholecystectomy',
            'wound-healing-c-section': 'Wound Healing after C-Section',
            'fascia-iliaca-compartment-block': 'Fascia Iliaca Compartment Block: Landmark And Ultrasound Approach',
            'perioperative-management-spinal-cord-injuries': 'Key Concepts in the Perioperative Management of Spinal Cord Injuries',
            'ifna-perioperative-management-spinal-cord-injuries': 'Key Concepts in the Perioperative Management of Spinal Cord Injuries'
        };

        return function resolveSlug(slug) {
            if (map[slug]) return map[slug];

            // Clean slug
            let clean = slug.replace(/^https?:?\/?\/?\/?www\.?surghub\.org\/course\/?/i, '')
                .replace(/^httpswwwsurghuborgcourse/i, '');

            // Check manual overrides first
            if (MANUAL[clean]) {
                // Verify the manual title exists in our course list (trim for trailing spaces)
                const manualTitle = MANUAL[clean];
                const found = titleData.find(td => td.title === manualTitle || td.title.trim() === manualTitle);
                if (found) { map[slug] = found.title; return found.title; }
            }
            const ns = normPlain(clean);
            const nsStem = normStemJoined(clean.replace(/-/g, ' '));
            const slugWords = getStemmedWords(clean.replace(/-/g, ' '));

            let bestTitle = null, bestScore = 0;

            for (const td of titleData) {
                // Method 1: stemmed+spell-normalized substring match
                if (nsStem.length > 3 && td.normStem.length > 3) {
                    if (nsStem.includes(td.normStem) || td.normStem.includes(nsStem)) {
                        const score = 1000 - Math.abs(nsStem.length - td.normStem.length);
                        if (score > bestScore) { bestScore = score; bestTitle = td.title; }
                        continue;
                    }
                }
                // Method 2: plain substring match
                if (ns.length > 3 && td.norm.length > 3) {
                    if (ns.includes(td.norm) || td.norm.includes(ns)) {
                        const score = 900 - Math.abs(ns.length - td.norm.length);
                        if (score > bestScore) { bestScore = score; bestTitle = td.title; }
                        continue;
                    }
                }
                // Method 3: stemmed word overlap >= 50% of slug words, minimum 2 words
                if (slugWords.size > 0 && td.words.size > 0) {
                    let overlap = 0;
                    for (const w of slugWords) { if (td.words.has(w)) overlap++; }
                    const slugPct = overlap / slugWords.size;
                    const titlePct = overlap / td.words.size;
                    if (overlap >= 2 && (slugPct >= 0.5 || titlePct >= 0.5)) {
                        const score = 500 + Math.max(slugPct, titlePct) * 100 + overlap * 10;
                        if (score > bestScore) { bestScore = score; bestTitle = td.title; }
                    }
                }
            }

            // Cache result (use resolved title, or cleaned slug as fallback)
            map[slug] = bestTitle || clean;
            return map[slug];
        };
    },

    // Short deterministic one-way hash (djb2) — used to anonymize emails into a
    // stable user_uid so we can do per-user analytics without storing PII on disk.
    _djb2Hash(str) {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) hash = (((hash << 5) + hash) + str.charCodeAt(i)) | 0;
        return (hash >>> 0).toString(36);
    },

    _buildAnonymizedUsers(usersJson) {
        const resolveSlug = this._buildSlugMap();
        const records = [];
        usersJson.forEach(row => {
            const signup = row.signup || row.Signup || row['signup date'] || row['Signup date'] || '';
            const month = window.Pipeline.parseDateToMonth(signup);
            if (!month) return;

            const countryKeys = Object.keys(row);
            const rawCountry = [
                countryKeys.find(k => k.toLowerCase().includes('country of nationality')),
                countryKeys.find(k => k.toLowerCase().includes('currently based')),
                countryKeys.find(k => k.toLowerCase() === 'fc_country'),
                countryKeys.find(k => k.toLowerCase() === 'lc_country')
            ].reduce((found, k) => found || (k && row[k] ? String(row[k]).trim() : null), null);
            const country = window.resolveCountryName ? window.resolveCountryName(rawCountry) : rawCountry;

            const profKey = Object.keys(row).find(k => k.toLowerCase().includes('describes your activity'));
            const profession = profKey ? (row[profKey] || '').trim() : '';

            const genderKey = Object.keys(row).find(k => k.toLowerCase().includes('gender'));
            const gender = genderKey ? (row[genderKey] || '').trim() : '';

            const orgKey = Object.keys(row).find(k => k.toLowerCase().includes('organisation') || k.toLowerCase().includes('organization'));
            const org = orgKey ? (row[orgKey] || '').trim() : '';

            const courses = (row.courses || '').split(',').map(c => c.trim()).filter(Boolean);
            const certs = (row.certificates || '').split(',').map(c => c.trim()).filter(Boolean);

            // Per-user total learning minutes, split evenly across enrolled courses
            const totalMin = parseFloat(row['course minutes']) || parseFloat(row['total minutes']) || 0;
            const minPerCourse = courses.length > 0 && totalMin > 0 ? totalMin / courses.length : 0;

            // Per-user identifiers / aggregates — let the analytics code do per-user grouping
            // without storing email. user_uid is a one-way djb2 hash → stable across re-imports
            // for the same email but not reversible.
            const email = (row.email || row.Email || '').trim().toLowerCase();
            const user_uid = email ? this._djb2Hash(email) : '';
            const user_course_count = courses.length;
            const user_cert_count = certs.length;
            const user_total_minutes = Math.round(totalMin);

            // FUTURE: ingest LearnWorlds course-completion export (per-user-per-course with
            // start/completion dates + time-in-course) to enable cohort retention curves and
            // time-to-completion analyses. Today only signup_month + totals are available.

            courses.forEach(rawSlug => {
                const courseName = resolveSlug(rawSlug);
                records.push({
                    course: courseName,
                    signup_month: month,
                    country: country || '',
                    profession: profession,
                    gender: gender,
                    organisation_type: org,
                    has_certificate: certs.some(c => c.toLowerCase().includes(rawSlug.substring(0, 20).toLowerCase())) ? 'Yes' : 'No',
                    course_minutes: Math.round(minPerCourse),
                    // Per-user denormalized fields (same on every row of this user)
                    user_uid,
                    user_course_count,
                    user_cert_count,
                    user_total_minutes,
                });
            });
        });
        return records;
    },

    _buildEmailDemoMap(usersJson) {
        // Maps email -> { country, profession } for linking survey feedback to user profiles
        const map = {};
        usersJson.forEach(row => {
            const email = (row.email || row.Email || '').trim().toLowerCase();
            if (!email || !email.includes('@')) return;

            const keys = Object.keys(row);
            const countryKey = keys.find(k => k.toLowerCase().includes('country of nationality'))
                || keys.find(k => k.toLowerCase().includes('currently based'));
            const rawCountry = countryKey ? String(row[countryKey] || '').trim() : '';
            const country = rawCountry && window.resolveCountryName ? window.resolveCountryName(rawCountry) : rawCountry;

            const fcCountry = String(row.fc_country || row.FC_country || '').trim();
            const lcCountry = String(row.lc_country || row.LC_country || '').trim();

            const profKey = keys.find(k => k.toLowerCase().includes('describes your activity'));
            const profession = profKey ? (row[profKey] || '').trim() : '';

            map[email] = {
                country: country || fcCountry || lcCountry || '',
                profession: profession || ''
            };
        });
        return map;
    },

    // Validate that the uploaded file looks like a LearnWorlds USERS export
    // (not a Survey/Course/Ambassador export). Returns { ok: bool, reason, detected }.
    _validateUsersFile(usersJson) {
        if (!usersJson || usersJson.length === 0) {
            return { ok: false, reason: 'The file is empty.', detected: 'empty' };
        }
        const headers = Object.keys(usersJson[0] || {});
        const headerLower = headers.map(h => h.toLowerCase());
        const has = (...needles) => needles.some(n => headerLower.some(h => h === n.toLowerCase() || h.includes(n.toLowerCase())));

        // Strong markers of a Users export — needs at least 2 of these to pass
        const usersMarkers = {
            email:         has('email', 'e-mail'),
            signup:        has('signup', 'sign up', 'sign-up', 'date added', 'registered', 'registration'),
            courses:       has('courses', 'enrolled courses'),
            certificates:  has('certificates', 'certificate'),
            country:       has('fc_country', 'lc_country', 'country of nationality', 'currently based'),
            profession:    has('describes your activity', 'profession'),
            userId:        has('user id', 'userid', 'user_id')
        };
        const markersFound = Object.entries(usersMarkers).filter(([, v]) => v).map(([k]) => k);

        // Detect known wrong-file types so we can give a precise error
        const looksLikeSurvey = headerLower.some(h => h === 'date time') &&
            headerLower.some(h => h.includes('scale from 1 to 5') || h.includes('rating') || h.includes('how would you rate'));
        const looksLikeAmbassador = has('promoter') && has('referrals', 'referred');
        const looksLikeCourseExport = has('learners') && has('certificates') && !has('email') && !has('signup');

        if (looksLikeSurvey) {
            return { ok: false, detected: 'survey',
                reason: 'This looks like a Survey Submissions export (it has columns like "Date Time" and rating-scale questions).\n\nFor the Learners sync you need the Users export from:\nLearnWorlds → Users → Export\n\nThe Users export contains columns like Email, Signup, Country, Profession, Courses.' };
        }
        if (looksLikeAmbassador) {
            return { ok: false, detected: 'ambassador',
                reason: 'This looks like an Ambassador Leads export, not a Users export.\n\nFor the Learners sync you need the Users export from:\nLearnWorlds → Users → Export' };
        }
        if (looksLikeCourseExport) {
            return { ok: false, detected: 'course',
                reason: 'This looks like a Course Export, not a Users export.\n\nFor the Learners sync you need the Users export from:\nLearnWorlds → Users → Export' };
        }

        // Generic check: at least 2 of the Users-file markers must be present
        if (markersFound.length < 2) {
            return { ok: false, detected: 'unknown',
                reason: 'This file doesn\'t look like a LearnWorlds Users export.\n\nA Users export should have columns like: Email, Signup, Courses, Certificates, Country.\n\n' +
                    'Markers found in your file: ' + (markersFound.length ? markersFound.join(', ') : '(none)') + '\n' +
                    'Columns in your file: ' + headers.slice(0, 20).join(', ') + (headers.length > 20 ? ', …' : '') };
        }

        // Specifically require the signup-date column for aggregation to work
        if (!usersMarkers.signup) {
            return { ok: false, detected: 'no-signup',
                reason: 'The file looks like a Users export but has no recognisable signup-date column.\n\nExpected one of: Signup, Signup Date, Date Added, Registered.\n\nColumns in your file: ' +
                    headers.slice(0, 20).join(', ') + (headers.length > 20 ? ', …' : '') };
        }

        return { ok: true, markers: markersFound };
    },

    runAudienceAggregation(usersJson) {
        // Known profession categories: keyword -> canonical display name
        // Matches actual LearnWorlds survey values. Everything else -> "Other"
        const PROF_MAP = [
            [['specialist surgeon', 'surgeon'], 'Surgeon'],
            [['anaesthesiologist', 'anaesthetist', 'anesthetist', 'anaesthesia technician', 'nurse anaesthetist'], 'Anaesthesiology'],
            [['nurse'], 'Nurse'],
            [['medical student'], 'Medical Student'],
            [['general medical officer', 'medical officer'], 'Medical Officer'],
            [['physician'], 'Physician'],
            [['obstetrician'], 'Obstetrician'],
            [['gynaecologist', 'gynecologist'], 'Gynaecologist'],
            [['emergency medicine', 'emergency physician'], 'Emergency Medicine'],
            [['non-clinical professional', 'non-clinical'], 'Non-Clinical Professional'],
            [['medical technician', 'technician'], 'Medical Technician'],
            [['clinical officer', 'non-physician clinician'], 'Clinical Officer'],
            [['paramedic'], 'Paramedic'],
            [['pharmacist'], 'Pharmacist'],
            [['midwife', 'midwifery'], 'Midwife'],
            [['dentist', 'dental'], 'Dentist'],
            [['physiotherapist', 'physical therapist'], 'Physiotherapist'],
            [['researcher', 'research'], 'Researcher'],
            [['public health'], 'Public Health'],
            [['educator', 'teacher', 'lecturer', 'professor'], 'Educator'],
            [['radiographer', 'radiologist', 'radiology'], 'Radiographer'],
            [['engineer', 'engineering', 'biomedical'], 'Engineer'],
            [['intern', 'resident'], 'Intern/Resident'],
            [['support worker'], 'Support Worker'],
            [['nursing student'], 'Nursing Student']
        ];

        const normalizeProf = (raw) => {
            if (window.Taxonomy && window.Taxonomy.canonProf) return window.Taxonomy.canonProf(raw);  // single source of truth (shared with the dashboard)
            if (!raw) return null;
            let s = raw.trim();
            if (!s || ['nan', 'not specified', 'n/a', '-'].includes(s.toLowerCase())) return null;
            // If "Other (something)", extract what's in parentheses for matching
            let lower = s.toLowerCase();
            let parenMatch = s.match(/^other\s*\((.+)\)\s*$/i);
            let searchStr = parenMatch ? parenMatch[1].trim().toLowerCase() : lower;
            // Also try matching against the full string
            for (let [keywords, canonical] of PROF_MAP) {
                for (let kw of keywords) {
                    if (searchStr.includes(kw) || lower.includes(kw)) return canonical;
                }
            }
            // Plain "Other" or truly unknown
            return 'Other';
        };

        // ── Exact-tag breakdowns by survey question ──────────────────────────
        // LearnWorlds applies ONE tag per chosen answer, so each question is
        // cleanly separable by exact tag string (e.g. 'surgery'/topic-Q8 never
        // collides with 'surgeon'/activity-Q3). Driven off the user's tag list,
        // not fuzzy keyword matching — this is what fixes the "Intern/Resident"
        // flatline (legacy 'resident' tag, deprecated ~Jan 2026; trainees now
        // answer Q2 'postgraduate-clinical').
        const CAREER_STAGE_MAP = {
            'in-practice': 'In practice', 'postgraduate-clinical': 'Postgraduate clinical',
            'postgraduate-academic': 'Postgraduate academic', 'undergraduate': 'Undergraduate', 'retired': 'Retired'
        };
        const ACTIVITY_MAP = {
            'surgeon': 'Surgeon', 'anaesthesiologist': 'Anaesthesiologist', 'anaesthesia-technician': 'Anaesthesia technician',
            'nurse-anaesthetist': 'Nurse anaesthetist', 'nurse': 'Nurse', 'obstetrician': 'Obstetrician',
            'gynaecologist': 'Gynaecologist', 'doctor': 'Physician', 'medical-officer': 'General medical officer',
            'clinical-officer': 'Non-physician clinician', 'emergency-doctor': 'Emergency medicine doctor',
            'medical-technician': 'Medical technician', 'medical-student': 'Medical student',
            'non-clinical': 'Non-clinical professional', 'resident': 'Intern/Resident (legacy)'
        };
        // Prefer a specific activity over the deprecated 'resident' tag when a
        // user carries both (legacy survey + new survey answers).
        const ACTIVITY_PRIORITY = Object.keys(ACTIVITY_MAP).filter(k => k !== 'resident').concat(['resident']);
        const TOPIC_MAP = {
            'surgery': 'Surgery', 'trauma': 'Trauma', 'peri-operative': 'Peri-operative care',
            'nursing': 'Nursing', 'anesthesiology': 'Anaesthesiology', 'obstetrics': 'Gynaecology & Obstetrics'
        };
        // Pull a normalized tag list from a row. The API path stashes _tags_raw;
        // some CSV exports include a Tags column.
        const getRowTags = (row) => {
            let raw = row._tags_raw || row.tags || row.Tags || row.TAGS || '';
            if (Array.isArray(raw)) raw = raw.join(',');
            return String(raw).split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        };

        let totalUsers = 0, totalCerts = 0, totalCourseMinutes = 0;
        let knownCountry = 0, knownProf = 0;
        let surveyRespondents = 0; // Users who filled the survey (have survey country)
        let trackingOnly = 0;      // Users with tracking country but no survey
        let countries = {}, roles = {};
        let signups = {};
        let signupsDaily = {};
        let countryTimeline = {};
        let profTimeline = {};
        // Per-question breakdowns (exact-tag)
        let careerTimeline = {}, activityTimeline = {}, topicTimeline = {};
        let careerStats = {}, activityStats = {}, topicStats = {};
        let careerKnown = 0, activityKnown = 0, topicKnown = 0;

        // Helper to derive YYYY-MM-DD from any LearnWorlds signup field
        const parseDay = (raw) => {
            if (!raw) return null;
            const s = String(raw).trim();
            // ISO style first
            const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
            const d = new Date(s);
            if (isNaN(d.getTime())) return null;
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        // Robust signup-date column detection.
        //
        // Strategy: among ALL columns whose name suggests "signup", score each
        // by how many rows in the sample have a parseable date value. Pick the
        // highest-scoring column. This avoids the trap of an early row having
        // a stray value in a sparse column (e.g. "Last Login Date") fooling a
        // first-row-only check.
        const SIGNUP_EXACT = new Set(['signup', 'signup date', 'date of signup', 'signup_date', 'signupdate']);
        const SIGNUP_KEYWORDS = ['signup', 'sign up', 'sign-up', 'registered', 'registration', 'created', 'joined', 'date added', 'date added on'];
        const NEGATIVE_KEYWORDS = ['login', 'log in', 'last seen', 'last active', 'updated', 'modified', 'expired', 'completed', 'completion', 'enrolled', 'enrollment date'];

        const candidateKeys = (() => {
            if (usersJson.length === 0) return [];
            const keys = Object.keys(usersJson[0] || {});
            // 1) Exact-name matches (highest priority)
            const exact = keys.filter(k => SIGNUP_EXACT.has(k.toLowerCase().trim()));
            if (exact.length > 0) return exact;
            // 2) Keyword-name matches — exclude obvious negatives like "login"
            const kw = keys.filter(k => {
                const kl = k.toLowerCase();
                if (NEGATIVE_KEYWORDS.some(n => kl.includes(n))) return false;
                return SIGNUP_KEYWORDS.some(w => kl.includes(w));
            });
            if (kw.length > 0) return kw;
            // 3) Generic "date"/"time" columns — last resort
            return keys.filter(k => {
                const kl = k.toLowerCase();
                if (NEGATIVE_KEYWORDS.some(n => kl.includes(n))) return false;
                return kl.includes('date') || kl.includes('time');
            });
        })();

        // Score each candidate by sampled fill rate of parseable dates
        const sampleSize = Math.min(500, usersJson.length);
        const colScores = candidateKeys.map(k => {
            let hits = 0;
            for (let i = 0; i < sampleSize; i++) {
                const v = usersJson[i] && usersJson[i][k];
                if (v && parseDay(v)) hits++;
            }
            return { key: k, hits, fill: sampleSize > 0 ? hits / sampleSize : 0 };
        }).sort((a, b) => b.hits - a.hits);

        // Require at least 50% fill rate to consider a column the signup-date column
        const winner = colScores.find(c => c.fill >= 0.5) || colScores[0] || null;
        const signupKey = winner ? winner.key : null;

        if (!signupKey && usersJson.length > 0) {
            const cols = Object.keys(usersJson[0] || {}).slice(0, 25).join(', ');
            throw new Error(
                'Could not find a signup-date column in the uploaded file.\n\n' +
                'Looked for: signup, signup date, registered, created, joined, etc.\n\n' +
                'Columns found in your file: ' + cols +
                '\n\nIf LearnWorlds renamed the export column, please report the new name so we can add it.'
            );
        }
        // Stash diagnostics on the App so processStandaloneAudience can surface them
        this._lastSignupDetection = {
            chosen: signupKey,
            chosenFillPct: winner ? Math.round(winner.fill * 100) : 0,
            allCandidates: colScores.slice(0, 5).map(c => `${c.key} (${Math.round(c.fill * 100)}%)`)
        };

        // Skip-reason counters for diagnostics
        let skipNoMonth = 0, skipBeforeRange = 0;

        usersJson.forEach(row => {
            const rawSignup = signupKey ? row[signupKey] : (row.signup || row.Signup || row['signup date'] || row['Signup date']);
            // parseDay first — it returns null on parse failure (more reliable than
            // parseDateToMonth which falls back to '2023-01').
            const day = parseDay(rawSignup);
            if (!day) { skipNoMonth++; return; }
            const month = day.substring(0, 7);
            if (month < '2023-05') { skipBeforeRange++; return; }
            totalUsers++;
            signups[month] = (signups[month] || 0) + 1;
            signupsDaily[day] = (signupsDaily[day] || 0) + 1;

            const keys = Object.keys(row);

            // Survey country (user-entered via profile form)
            const surveyCountryKey = keys.find(k => k.toLowerCase().includes('country of nationality'))
                || keys.find(k => k.toLowerCase().includes('currently based'));
            const surveyCountry = surveyCountryKey ? String(row[surveyCountryKey] || '').trim() : '';

            // Tracking country (automatic from browser/IP)
            const fcCountry = String(row.fc_country || row.FC_country || '').trim();
            const lcCountry = String(row.lc_country || row.LC_country || '').trim();

            // Use survey country first, fall back to tracking
            const rawCountry = surveyCountry || fcCountry || lcCountry || '';
            const countryVal = rawCountry && window.resolveCountryName ? window.resolveCountryName(rawCountry) : (rawCountry || null);

            // Track survey vs tracking separately for accurate methodology note
            const hasSurvey = !!surveyCountry;
            if (hasSurvey) surveyRespondents++;
            else if (fcCountry || lcCountry) trackingOnly++;

            if (countryVal) {
                countries[countryVal] = (countries[countryVal] || 0) + 1;
                knownCountry++;
                if (!countryTimeline[month]) countryTimeline[month] = {};
                countryTimeline[month][countryVal] = (countryTimeline[month][countryVal] || 0) + 1;
            }

            const rKey = keys.find(k => k.toLowerCase().includes('describes your activity'));
            let role = rKey ? normalizeProf(row[rKey]) : null;
            if (role) {
                roles[role] = (roles[role] || 0) + 1;
                knownProf++;
                if (!profTimeline[month]) profTimeline[month] = {};
                profTimeline[month][role] = (profTimeline[month][role] || 0) + 1;
            }

            // ── Per-question breakdowns from exact tags (Q2 career, Q3 activity, Q8 topics) ──
            const tagSet = new Set(getRowTags(row));
            if (tagSet.size > 0) {
                // Q2 — career stage (single)
                for (const k in CAREER_STAGE_MAP) {
                    if (tagSet.has(k)) { const d = CAREER_STAGE_MAP[k]; careerStats[d] = (careerStats[d] || 0) + 1; careerKnown++; (careerTimeline[month] || (careerTimeline[month] = {}))[d] = (careerTimeline[month][d] || 0) + 1; break; }
                }
                // Q3 — activity (single, specific activity preferred over legacy 'resident')
                let act = null;
                for (const k of ACTIVITY_PRIORITY) { if (tagSet.has(k)) { act = ACTIVITY_MAP[k]; break; } }
                if (act) { activityStats[act] = (activityStats[act] || 0) + 1; activityKnown++; (activityTimeline[month] || (activityTimeline[month] = {}))[act] = (activityTimeline[month][act] || 0) + 1; }
                // Q8 — topics of interest (multi-select)
                let anyTopic = false;
                for (const k in TOPIC_MAP) {
                    if (tagSet.has(k)) { const d = TOPIC_MAP[k]; topicStats[d] = (topicStats[d] || 0) + 1; (topicTimeline[month] || (topicTimeline[month] = {}))[d] = (topicTimeline[month][d] || 0) + 1; anyTopic = true; }
                }
                if (anyTopic) topicKnown++;
            } else if (role) {
                // CSV-without-tags fallback: feed the activity timeline from the Q3 answer column.
                activityStats[role] = (activityStats[role] || 0) + 1; activityKnown++;
                (activityTimeline[month] || (activityTimeline[month] = {}))[role] = (activityTimeline[month][role] || 0) + 1;
            }

            if (row.certificates) totalCerts += String(row.certificates).split(',').length;

            // Accumulate learning time from "course minutes" or "total minutes"
            const cm = parseFloat(row['course minutes']) || parseFloat(row['total minutes']) || 0;
            if (cm > 0) totalCourseMinutes += cm;
        });

        // Extrapolation: scale surveyed sample up to total users
        const extrapolate = (counts, known, total) => {
            if (known === 0) return {};
            const scale = total / known;
            const res = {};
            Object.keys(counts).forEach(k => { res[k] = Math.round(counts[k] * scale); });
            return res;
        };

        // Also extrapolate monthly timelines
        const extrapolateTimeline = (tl, known, total) => {
            if (known === 0) return tl;
            const scale = total / known;
            const res = {};
            Object.keys(tl).forEach(m => {
                res[m] = {};
                Object.keys(tl[m]).forEach(k => { res[m][k] = Math.round(tl[m][k] * scale); });
            });
            return res;
        };

        // Country data: extrapolate from all users with any country data (survey + tracking)
        // Profession data: extrapolate from survey respondents only (tracking has no profession)
        const countryPct = totalUsers > 0 ? Math.round((knownCountry / totalUsers) * 100) : 0;
        const surveyPct = totalUsers > 0 ? Math.round((surveyRespondents / totalUsers) * 100) : 0;
        const profPct = totalUsers > 0 ? Math.round((knownProf / totalUsers) * 100) : 0;

        return {
            TotalUsers: totalUsers, TotalCertificates: totalCerts, TotalCourseMinutes: totalCourseMinutes,
            KnownCountry: Object.keys(countries).length, KnownProf: Object.keys(roles).filter(r => r !== 'Other').length,
            // Country coverage (survey + tracking combined)
            CountryKnownCount: knownCountry, CountryKnownPct: countryPct,
            // Survey-only coverage (for profession, gender, org)
            SurveyedCount: surveyRespondents, SurveyedPct: surveyPct,
            // Profession coverage
            ProfKnownCount: knownProf, ProfKnownPct: profPct,
            // Tracking-only count (for documentation)
            TrackingOnlyCount: trackingOnly,
            AllCountryStats: JSON.stringify(extrapolate(countries, knownCountry, totalUsers)),
            ProfStats: JSON.stringify(extrapolate(roles, knownProf, totalUsers)),
            Signups: JSON.stringify(signups),
            SignupsDaily: JSON.stringify(signupsDaily),
            CountryTimeline: JSON.stringify(extrapolateTimeline(countryTimeline, knownCountry, totalUsers)),
            ProfTimeline: JSON.stringify(extrapolateTimeline(profTimeline, knownProf, totalUsers)),
            // Per-question breakdowns (exact-tag): Career stage (Q2), Activity (Q3), Topics (Q8)
            CareerStageStats: JSON.stringify(extrapolate(careerStats, careerKnown, totalUsers)),
            ActivityStats: JSON.stringify(extrapolate(activityStats, activityKnown, totalUsers)),
            TopicStats: JSON.stringify(extrapolate(topicStats, topicKnown, totalUsers)),
            CareerStageTimeline: JSON.stringify(extrapolateTimeline(careerTimeline, careerKnown, totalUsers)),
            ActivityTimeline: JSON.stringify(extrapolateTimeline(activityTimeline, activityKnown, totalUsers)),
            TopicTimeline: JSON.stringify(extrapolateTimeline(topicTimeline, topicKnown, totalUsers)),
            CareerKnownCount: careerKnown, ActivityKnownCount: activityKnown, TopicKnownCount: topicKnown,
            // Diagnostics — surfaced after upload so the user can spot column-detection issues
            _diag: {
                rowsTotal: usersJson.length,
                rowsCounted: totalUsers,
                rowsSkippedNoDate: skipNoMonth,
                rowsSkippedBefore2023May: skipBeforeRange,
                signupColumn: signupKey,
                signupColumnFillPct: this._lastSignupDetection ? this._lastSignupDetection.chosenFillPct : null,
                otherCandidates: this._lastSignupDetection ? this._lastSignupDetection.allCandidates : []
            }
        };
    },

    // ==========================================
    // 5. SOCIAL ACTIVITY SYNC
    // Ingests SURGhub User-Segment export (segmentId=18, "Users with > 0 posts/comments")
    // CSV columns:
    //   Email · User name · Role · Registered · Last activity · Last login country ·
    //   Last login operating system · Last enrollment · Study time · Total time on platform ·
    //   Courses · Completed · Uncompleted · Certificates · Avg. score · Posts/ Likes/ Comments
    // The single social column "Posts/ Likes/ Comments" is formatted "5/10/3".
    // ==========================================
    _parseDurationToMinutes(val) {
        // Accepts "HH:MM:SS", "MM:SS", "H:MM", or a plain number (assumed minutes)
        if (val === null || val === undefined || val === '') return 0;
        const s = String(val).trim();
        if (s === '-' || s.toLowerCase() === 'nan') return 0;
        if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
        const parts = s.split(':').map(p => parseInt(p, 10));
        if (parts.some(isNaN)) return 0;
        if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
        if (parts.length === 2) return parts[0] + parts[1] / 60;
        return parseFloat(s) || 0;
    },

    _parseSocialCSV(rows) {
        // Find column keys flexibly so a small heading rename doesn't break the parse
        if (!rows || rows.length === 0) return [];
        const keys = Object.keys(rows[0]);
        const find = (substrings) => {
            for (const s of substrings) {
                const k = keys.find(kk => kk.toLowerCase().includes(s.toLowerCase()));
                if (k) return k;
            }
            return null;
        };
        const emailKey       = find(['email']);
        const nameKey        = find(['user name', 'username', 'name']);
        const roleKey        = find(['role']);
        const registeredKey  = find(['registered']);
        const lastActivityKey = find(['last activity']);
        const lastCountryKey = find(['last login country', 'login country']);
        const lastEnrollKey  = find(['last enrollment', 'last enrolment']);
        const studyTimeKey   = find(['study time']);
        const totalTimeKey   = find(['total time on platform', 'total time']);
        const coursesKey     = find(['courses']);
        const completedKey   = find(['completed']);
        const uncompletedKey = find(['uncompleted']);
        const certKey        = find(['certificates', 'certificate']);
        const avgScoreKey    = find(['avg', 'average score']);
        const plcKey         = find(['posts/ likes', 'posts/likes', 'posts / likes', 'posts, likes', 'posts likes comments']);

        if (!emailKey) throw new Error('Required column "Email" not found in social CSV.');

        const records = [];
        rows.forEach(row => {
            const email = String(row[emailKey] || '').trim().toLowerCase();
            if (!email || !email.includes('@')) return;
            const uid = this._djb2Hash(email);

            // Parse the combined social column "P/L/C"
            let posts = 0, likes = 0, comments = 0;
            if (plcKey && row[plcKey]) {
                const parts = String(row[plcKey]).split(/[\/,]/).map(s => parseInt(String(s).trim(), 10));
                posts    = isFinite(parts[0]) ? parts[0] : 0;
                likes    = isFinite(parts[1]) ? parts[1] : 0;
                comments = isFinite(parts[2]) ? parts[2] : 0;
            }

            const registeredMonth = registeredKey ? window.Pipeline.parseDateToMonth(row[registeredKey]) : '';
            const lastActivity    = lastActivityKey ? String(row[lastActivityKey] || '').trim() : '';

            records.push({
                uid,
                email,
                name: nameKey ? String(row[nameKey] || '').trim() : '',
                role: roleKey ? String(row[roleKey] || '').trim() : '',
                registered_month: registeredMonth || '',
                last_activity: lastActivity,
                last_login_country: lastCountryKey ? String(row[lastCountryKey] || '').trim() : '',
                last_enrollment: lastEnrollKey ? String(row[lastEnrollKey] || '').trim() : '',
                study_minutes: this._parseDurationToMinutes(studyTimeKey ? row[studyTimeKey] : 0),
                total_minutes: this._parseDurationToMinutes(totalTimeKey ? row[totalTimeKey] : 0),
                courses: parseInt(coursesKey ? row[coursesKey] : 0, 10) || 0,
                completed: parseInt(completedKey ? row[completedKey] : 0, 10) || 0,
                uncompleted: parseInt(uncompletedKey ? row[uncompletedKey] : 0, 10) || 0,
                certificates: parseInt(certKey ? row[certKey] : 0, 10) || 0,
                avg_score: parseFloat(avgScoreKey ? row[avgScoreKey] : 0) || 0,
                posts, likes, comments,
            });
        });
        return records;
    },

    async processStandaloneSocial(event) {
        const file = event.target.files[0];
        if (!file) return;
        this.isLoading = true; this.loadingText = 'Parsing social activity export…'; this.renderView();
        try {
            const rows = await window.Pipeline.readExcel(file);
            if (!rows || rows.length === 0) throw new Error('The file appears to be empty (no rows found).');
            const records = this._parseSocialCSV(rows);
            if (records.length === 0) throw new Error('No valid user rows parsed. Expected the SURGhub User-Segment export with an Email column.');

            await Storage.setItem('surghub_social', records);
            this._rawSocial = records;

            // Surface quick stats so the user knows what changed
            const withPosts = records.filter(r => r.posts > 0).length;
            const totalPosts = records.reduce((s, r) => s + r.posts, 0);
            const totalLikes = records.reduce((s, r) => s + r.likes, 0);
            const totalComments = records.reduce((s, r) => s + r.comments, 0);

            this.isLoading = false; this.renderView();
            alert(
                `Social activity loaded: ${records.length.toLocaleString()} users\n\n` +
                `Users with ≥ 1 post: ${withPosts.toLocaleString()}\n` +
                `Total posts: ${totalPosts.toLocaleString()}\n` +
                `Total likes: ${totalLikes.toLocaleString()}\n` +
                `Total comments: ${totalComments.toLocaleString()}`
            );
        } catch (e) {
            this.isLoading = false; this.renderView();
            alert('Social activity upload failed:\n\n' + (e.message || e));
            console.error(e);
        }
    },

    // ==========================================
    // 6. COURSE COMPLETION DETAIL SYNC
    // Ingests the LearnWorlds course-completion xlsx — one sheet per course,
    // rows = users with start/completion dates, time-spent, scores.
    //
    // Sheet names are truncated to 28 chars by Excel — we fuzzy-match back to
    // the full course names in surghub_data so all downstream views can join.
    //
    // Storage: surghub_completion = array of per-(user, course) records:
    //   { uid, email, name, course, course_resolved, start_month, start_date,
    //     completion_date, completed: bool, time_minutes, score, certificate: bool,
    //     certificate_date, certificate_score }
    // ==========================================

    // DD MMM YYYY → ISO YYYY-MM-DD (e.g. "08 Mar 2023" → "2023-03-08")
    _parseDayMonthYear(val) {
        if (val === null || val === undefined) return '';
        const s = String(val).trim();
        if (!s || s === '-' || s.toLowerCase() === 'nan') return '';
        // Try DD MMM YYYY first
        const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
        if (m) {
            const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
            const mm = months[m[2].slice(0, 3).toLowerCase()];
            if (mm) return `${m[3]}-${String(mm).padStart(2, '0')}-${String(parseInt(m[1], 10)).padStart(2, '0')}`;
        }
        // Fall back to Pipeline.parseDateToMonth for other shapes
        if (window.Pipeline && window.Pipeline.parseDateToMonth) {
            const month = window.Pipeline.parseDateToMonth(s);
            if (month) return month + '-01';
        }
        return '';
    },

    _isTruthyCheck(val) {
        // Course Completed / Certificate cells: ✓ = completed, '-' or NaN = not
        if (val === null || val === undefined) return false;
        const s = String(val).trim();
        if (!s || s === '-' || s.toLowerCase() === 'nan') return false;
        // ✓ (U+2713) or yes/y/true/1
        if (s === '✓' || s.toLowerCase() === 'yes' || s.toLowerCase() === 'y' || s === '1' || s.toLowerCase() === 'true') return true;
        return false;
    },

    // Match truncated sheet name (≤28 chars from Excel) → full course title
    // Uses prefix matching first, then word-overlap fallback. Cached.
    _buildCompletionCourseMatcher() {
        // Build from current course list
        const titles = (this.data || []).filter(d => !d.IsShell).map(d => d.Course).filter(Boolean);
        const unique = [...new Set(titles)];
        const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const normMap = new Map();
        unique.forEach(t => normMap.set(norm(t), t));

        const cache = {};
        return (sheetName) => {
            if (sheetName in cache) return cache[sheetName];
            const sn = norm(sheetName);
            if (!sn) return (cache[sheetName] = null);
            // Exact normalized match
            if (normMap.has(sn)) return (cache[sheetName] = normMap.get(sn));
            // Prefix match (sheet name is a truncated prefix of the full title)
            let best = null;
            for (const t of unique) {
                const tn = norm(t);
                if (tn.startsWith(sn) && sn.length >= 10) {
                    if (!best || t.length > best.length) best = t;
                }
            }
            if (best) return (cache[sheetName] = best);
            // Reverse prefix (full title is a prefix of sheet name — rare)
            for (const t of unique) {
                const tn = norm(t);
                if (sn.startsWith(tn) && tn.length >= 10) {
                    if (!best || t.length > best.length) best = t;
                }
            }
            return (cache[sheetName] = best);
        };
    },

    // ── Signup-survey demographics upload (assessment-submissions export) ──
    // The platform signup survey asks Gender + Organisation Type, but those answers
    // never reach LearnWorlds user TAGS (career stage / activity / topics / country
    // do), so the API Learners sync can't see them. This upload joins them in by
    // email: persists an email→{gender, organisation_type} map for future Learners
    // syncs AND retro-enriches existing anonymized user records in place (matched
    // via the one-way email hash — no emails are stored on the anonymized records).
    async processSignupSurvey(event) {
        const file = event.target.files[0];
        if (!file) return;
        event.target.value = '';
        this.isLoading = true; this.loadingText = 'Parsing signup survey…'; this.renderView();
        try {
            const sheets = await window.Pipeline.readAllSheets(file);
            const rows = Object.values(sheets || {}).find(r => r && r.length) || [];
            const r = await this._ingestSignupSurveyRows(rows);
            this.isLoading = false; this.renderView();
            alert('Signup survey imported ✓\n\n' +
                this.formatNumber(r.nRows) + ' rows · ' + this.formatNumber(r.nDemo) + ' learners with gender/organisation data.\n' +
                'Enriched existing anonymized records: ' + this.formatNumber(r.enrichedG) + ' gender · ' + this.formatNumber(r.enrichedO) + ' organisation type.\n\n' +
                'Future "Sync Learners" runs apply this automatically; provider User Data exports now include these columns.');
        } catch (err) {
            this.isLoading = false; this.renderView();
            alert('Signup survey import failed: ' + err.message);
        }
    },

    // Pure parse of signup-survey rows → { demo:{emailLower:{gender,organisation_type}},
    // nFromFile, missingCols }. No storage / no merge with the existing map / no
    // enrich — the SINGLE source of truth for the signup-survey column detection
    // and value cleaning, shared by the live ingest (which then merges + persists)
    // AND the read-only re-derive firewall (so the firewall can't drift from the
    // ingest). Faithful by construction.
    _parseSignupDemoFromRows(rows) {
        if (!rows || !rows.length) return { demo: {}, nFromFile: 0 };
        const keys = Object.keys(rows[0]);
        const userKey = keys.find(k => k.toLowerCase().replace(/^﻿/, '') === 'user') || keys.find(k => k.toLowerCase().includes('user'));
        const genderKey = keys.find(k => k.toLowerCase().includes('gender'));
        const orgKey = keys.find(k => k.toLowerCase().includes('organisation') || k.toLowerCase().includes('organization'));
        if (!userKey || (!genderKey && !orgKey)) return { demo: {}, nFromFile: 0, missingCols: true };
        const clean = (v) => { const s = String(v || '').trim(); return (!s || /^no\s*data$/i.test(s) || /^unreported$/i.test(s)) ? '' : s; };
        const normGender = (v) => { const s = clean(v); return /prefer not to disclose/i.test(s) ? 'Prefer not to say' : s; };
        const demo = {};   // emailLower -> { gender, organisation_type }
        let nFromFile = 0;
        rows.forEach(row => {
            const userStr = String(row[userKey] || '');
            const m = userStr.match(/\(([^)]+@[^)]+)\)/);
            const email = (m ? m[1] : (userStr.includes('@') ? userStr : '')).trim().toLowerCase();
            if (!email) return;
            const g = genderKey ? normGender(row[genderKey]) : '';
            const o = orgKey ? clean(row[orgKey]) : '';
            if (!g && !o) return;
            nFromFile++;
            const prev = demo[email] || {};
            demo[email] = { gender: g || prev.gender || '', organisation_type: o || prev.organisation_type || '' };
        });
        return { demo, nFromFile };
    },

    // Shared ingest core for the signup survey (upload + auto-fetch paths):
    // parses rows from the Assessment Submissions export, persists the
    // email→{gender, organisation_type} map, and retro-enriches existing
    // anonymized records via the one-way email hash.
    async _ingestSignupSurveyRows(rows) {
        if (!rows || !rows.length) throw new Error('No rows found in the file.');
        const parsed = this._parseSignupDemoFromRows(rows);
        if (parsed.missingCols) {
            throw new Error('Could not find the User and Gender/Organisation columns.\n\nExpected the signup-survey export (Assessment Submissions) with columns like "User", "What is your gender?", "What type of organisation are you affiliated with?".');
        }
        if (parsed.nFromFile === 0) throw new Error('No usable rows (no emails with gender/organisation answers).');
        // Capture the parsed rows VERBATIM as an immutable receipt (raw/ is never
        // exported) so the gender/organisation map — which exists ONLY in this
        // upload, never in the API tags — is traceable to source and re-derivable.
        // Best-effort: never blocks the import.
        try {
            if (window.LearnWorlds && window.LearnWorlds.captureRawArtifact) {
                window.LearnWorlds.captureRawArtifact('signup-survey', 'rows.jsonl', rows.map(r => JSON.stringify(r)).join('\n'));
            }
        } catch (e) { console.warn('[signup] receipt capture skipped:', e && e.message); }
        // Merge into the existing map (never replace): if LearnWorlds caps or
        // truncates an export, previously captured learners must survive.
        let demo = {};   // emailLower -> { gender, organisation_type }
        try { const prev = await Storage.getItem('surghub_signup_demo'); if (prev && typeof prev === 'object') demo = prev; } catch (e) {}
        Object.entries(parsed.demo).forEach(([email, d]) => {
            const prev = demo[email] || {};
            demo[email] = { gender: d.gender || prev.gender || '', organisation_type: d.organisation_type || prev.organisation_type || '' };
        });
        const nDemo = Object.keys(demo).length;
        await Storage.setItem('surghub_signup_demo', demo);

        // Retro-enrich existing anonymized user records via the email hash.
        let enrichedG = 0, enrichedO = 0;
        const byUid = {};
        Object.entries(demo).forEach(([email, d]) => { byUid[this._djb2Hash(email)] = d; });
        let anon = this._rawAnonymizedUsers;
        if (!anon || !anon.length) { try { anon = await Storage.getItem('surghub_anon_users'); } catch (e) {} }
        if (anon && anon.length) {
            anon.forEach(u => {
                const d = u.user_uid ? byUid[u.user_uid] : null;
                if (!d) return;
                if (!u.gender && d.gender) { u.gender = d.gender; enrichedG++; }
                if (!u.organisation_type && d.organisation_type) { u.organisation_type = d.organisation_type; enrichedO++; }
            });
            this._rawAnonymizedUsers = anon;
            await Storage.setItem('surghub_anon_users', anon);
        }
        return { nRows: rows.length, nDemo, enrichedG, enrichedO };
    },

    // Save / clear the signup survey's export download URL. When set, Sync
    // Surveys fetches it automatically with the same fresh access token it
    // uses for the course surveys (same Survey Exports area authorises both).
    async setSignupSurveyUrl() {
        const cur = (await Storage.getItem('surghub_signup_survey_url')) || '';
        const v = await this._textPrompt(
            'Signup-survey auto-fetch URL',
            'Paste the signup survey\'s export download URL.\n\n' +
            'Get it once: Survey Exports → export the signup survey (Assessment Submissions) → copy the download link (Cmd+L → Cmd+C).\n\n' +
            'Sync Surveys will then re-fetch it on every run using the fresh token — no more manual uploads. The expired token in the pasted URL is replaced automatically.\n\n' +
            'Clear the field and press OK to turn auto-fetch off.',
            cur
        );
        if (v === null) return;
        const url = v.trim();
        if (!url) {
            await Storage.removeItem('surghub_signup_survey_url');
            this.signupSurveyUrl = '';
            this.renderView();
            return alert('Signup-survey auto-fetch turned off.');
        }
        if (!/^https:\/\//i.test(url)) return alert('That doesn\'t look like a download URL (must start with https://).');
        // Normalize LearnWorlds assessment-export URLs so they stream the file
        // directly instead of queueing a Reports-log job (async=true returns a
        // JSON job ticket, not the file).
        let saved = url.replace(/([?&])async=[^&]*/, '$1async=false');
        if (/\/assessment\/[0-9a-f]{24}\/submissions\/export/i.test(saved)) {
            if (!/[?&]async=/.test(saved)) saved += (saved.includes('?') ? '&' : '?') + 'async=false';
            // Every known-working synchronous export uses type=excel; the csv
            // variant has been seen to 500 on async=false.
            saved = saved.replace(/([?&])type=csv\b/, '$1type=excel');
        }
        // Drop the UI-injected totalItems param — the export works without it
        // and it must never act as a row cap.
        saved = saved.replace(/&totalItems=[^&]*/g, '').replace(/\?totalItems=[^&]*&/, '?').replace(/\?totalItems=[^&]*$/, '');
        await Storage.setItem('surghub_signup_survey_url', saved);
        this.signupSurveyUrl = saved;
        this.renderView();
        alert('Saved ✓\n\nThe signup survey will now be fetched automatically on every "Sync Surveys" run, filling Gender + Organisation Type without manual uploads.');
    },

    async processStandaloneCompletion(event) {
        const file = event.target.files[0];
        if (!file) return;
        this.isLoading = true; this.loadingText = 'Parsing course completion xlsx…'; this.renderView();
        try {
            const sheets = await window.Pipeline.readAllSheets(file);
            if (!sheets || Object.keys(sheets).length === 0) throw new Error('No sheets found in the file.');

            const matchCourse = this._buildCompletionCourseMatcher();

            // Detect the Course Insights OVERVIEW export (one sheet, one row per
            // course, aggregate columns, no per-user rows). It has no start
            // dates, but its Learners/Enrollments/Certificates are authoritative
            // course totals — use it to reconcile the cards instead of failing.
            const firstRows = Object.values(sheets).find(r => r && r.length) || [];
            const fk = firstRows.length ? Object.keys(firstRows[0]).map(k => String(k).toLowerCase().trim()) : [];
            if (fk.includes('course title') && (fk.includes('learners') || fk.includes('enrollments')) && !fk.some(k => k.includes('start date'))) {
                const latest = {};
                (this.data || []).forEach(d => {
                    if (d.IsShell || !d.Course) return;
                    const p = latest[d.Course];
                    if (!p || (d.Timestamp || '') > (p.Timestamp || '')) latest[d.Course] = d;
                });
                const num = (v) => Number(String(v == null ? '' : v).replace(/[^0-9]/g, '')) || 0;
                let updL = 0, updC = 0, missed = 0;
                firstRows.forEach(row => {
                    const title = String(row['Course title'] || row['Course Title'] || '').trim();
                    if (!title) return;
                    const d = latest[title] || latest[matchCourse(title)];
                    if (!d) { missed++; return; }
                    const L = num(row.Learners) || num(row.Enrollments);
                    const C = num(row['Certificates Issued'] != null ? row['Certificates Issued'] : row['Certificates issued']);
                    if (L > 0 && Number(d.Learners) !== L) { d.Learners = L; d.Timestamp = this.updateDate || d.Timestamp; updL++; }
                    if (C > 0 && Number(d.Certificates) !== C) { d.Certificates = C; updC++; }
                });
                await this.handleDbSave();
                this.isLoading = false; this.renderView();
                alert('Heads up: this is the Course Insights OVERVIEW export (one row per course) — it has no per-user start dates.\n\nUsed it to reconcile course totals instead ✓\n' +
                    updL + ' learner counts and ' + updC + ' certificate counts updated from official course totals' + (missed ? ' · ' + missed + ' courses not matched' : '') + '.\n\nFor exact enrolment dates, download the PER-USER report: Course Insights → Summary → download xlsx (one sheet per course, with per-user start/completion dates), then upload that here.');
                return;
            }

            // Excel truncates sheet names (~28 chars) and dedupes collisions by
            // appending digits, so sibling courses sharing a long prefix can be
            // mis-assigned or dropped (e.g. three "Complex Lower Extremity
            // Trauma – ..." courses become ...Trau / ...Trau0 / ...Trau1).
            // Disambiguate collision groups by matching each sheet's row and
            // certificate counts against the known course totals.
            const sheetNames = Object.keys(sheets);
            const baseOf = (n) => String(n).replace(/\d+$/, '');
            const groups = {};
            sheetNames.forEach(n => { const b = baseOf(n); (groups[b] = groups[b] || []).push(n); });
            const latestRow = {};
            (this.data || []).forEach(d => {
                if (d.IsShell || !d.Course) return;
                const p = latestRow[d.Course];
                if (!p || (d.Timestamp || '') > (p.Timestamp || '')) latestRow[d.Course] = d;
            });
            const allCourses = Object.keys(latestRow);
            const normS = window.Pipeline.normalizeString;
            const assignOverride = {};
            Object.entries(groups).forEach(([base, names]) => {
                const nb = normS(base);
                let candidates = (nb.length >= 6) ? allCourses.filter(c => normS(c).startsWith(nb)) : [];
                if (!candidates.length && base.trim().length >= 4) candidates = allCourses.filter(c => c.startsWith(base.trim()));
                if (names.length <= 1 && candidates.length <= 1) return;
                if (!candidates.length) return;
                const pairs = [];
                names.forEach(sn => {
                    const rows = sheets[sn] || [];
                    const certRows = rows.filter(r => { const v = String(r['Certificate'] || '').trim(); return v && v !== '-'; }).length;
                    candidates.forEach(c => {
                        const L = Number(latestRow[c].Learners) || 0;
                        const C = Number(latestRow[c].Certificates) || 0;
                        pairs.push({ sn, c, score: Math.abs(rows.length - L) + Math.abs(certRows - C) * 0.5 });
                    });
                });
                pairs.sort((a, b) => a.score - b.score);
                const usedS = new Set(), usedC = new Set();
                pairs.forEach(p => {
                    if (usedS.has(p.sn) || usedC.has(p.c)) return;
                    usedS.add(p.sn); usedC.add(p.c);
                    assignOverride[p.sn] = p.c;
                });
            });
            if (Object.keys(assignOverride).length) console.log('[Completion] collision-group sheet assignments:', assignOverride);

            const records = [];
            let unmatchedSheets = [];
            let totalRowsRead = 0;
            let rowsKept = 0;

            for (const [sheetName, rows] of Object.entries(sheets)) {
                if (!rows || rows.length === 0) continue;
                const resolved = assignOverride[sheetName] || matchCourse(sheetName);
                if (!resolved) { unmatchedSheets.push(sheetName); continue; }

                // Identify columns flexibly
                const sample = rows[0];
                const keys = Object.keys(sample);
                const find = (substrs) => {
                    for (const s of substrs) {
                        const k = keys.find(kk => kk.toLowerCase().includes(s.toLowerCase()));
                        if (k) return k;
                    }
                    return null;
                };
                const emailKey       = find(['email']);
                const nameKey        = find(['user name', 'name']);
                const startKey       = find(['start date', 'course start']);
                const completionKey  = find(['completion date', 'course completion']);
                const completedKey   = find(['course completed', 'completed']);
                const timeKey        = find(['time spent']);
                const scoreKey       = find(['average course score', 'avg course score', 'avg score', 'score']);
                const certKey        = find(['^certificate$', 'certificate']);
                const certDateKey    = find(['date of certificate']);
                const certScoreKey   = find(['score of certificate']);

                rows.forEach(row => {
                    totalRowsRead++;
                    const email = String(row[emailKey] || '').trim().toLowerCase();
                    if (!email || !email.includes('@')) return;
                    const uid = this._djb2Hash(email);
                    const startDate      = this._parseDayMonthYear(startKey ? row[startKey] : '');
                    const completionDate = this._parseDayMonthYear(completionKey ? row[completionKey] : '');
                    const completed = this._isTruthyCheck(completedKey ? row[completedKey] : '');
                    const cert     = this._isTruthyCheck(certKey ? row[certKey] : '');
                    const timeMinutes = this._parseDurationToMinutes(timeKey ? row[timeKey] : 0);
                    const score = parseFloat(scoreKey ? row[scoreKey] : 0) || 0;
                    const certDate  = this._parseDayMonthYear(certDateKey ? row[certDateKey] : '');
                    const certScore = parseFloat(certScoreKey ? row[certScoreKey] : 0) || 0;

                    records.push({
                        uid,
                        email,
                        name: nameKey ? String(row[nameKey] || '').trim() : '',
                        course: resolved,
                        course_sheet: sheetName,
                        start_date: startDate,
                        start_month: startDate ? startDate.slice(0, 7) : '',
                        completion_date: completionDate,
                        completed,
                        time_minutes: Math.round(timeMinutes),
                        score,
                        certificate: cert,
                        certificate_date: certDate,
                        certificate_score: certScore,
                    });
                    rowsKept++;
                });
            }

            if (records.length === 0) throw new Error('No valid course-completion rows parsed.');

            await Storage.setItem('surghub_completion', records);
            this._rawCompletion = records;
            const rebuiltTl = await this._rebuildTimelinesFromCompletion();
            if (rebuiltTl) console.log('[Completion] timelines rebuilt for', rebuiltTl, 'courses from exact start dates');

            // Summary stats
            const uniqueUsers = new Set(records.map(r => r.uid)).size;
            const completed = records.filter(r => r.completed).length;
            const certified = records.filter(r => r.certificate).length;
            const sheetsMatched = Object.keys(sheets).length - unmatchedSheets.length;

            this.isLoading = false; this.renderView();
            alert(
                `Course completion loaded:\n\n` +
                `Sheets parsed: ${sheetsMatched} of ${Object.keys(sheets).length} ` +
                (unmatchedSheets.length > 0 ? `(${unmatchedSheets.length} sheets unmatched — see console)\n` : '\n') +
                `Rows: ${rowsKept.toLocaleString()} of ${totalRowsRead.toLocaleString()} kept\n` +
                `Unique users: ${uniqueUsers.toLocaleString()}\n` +
                `Completed enrolments: ${completed.toLocaleString()}\n` +
                `Certificates: ${certified.toLocaleString()}`
            );
            if (unmatchedSheets.length > 0) {
                console.warn('Unmatched sheets (could not map to a known course):', unmatchedSheets);
            }
        } catch (e) {
            this.isLoading = false; this.renderView();
            alert('Course completion upload failed:\n\n' + (e.message || e));
            console.error(e);
        }
    },

    // ==========================================
    // 7. AMBASSADOR SYNC (was 5, then 6)
    // ==========================================
    // ── Step 8: Ambassadors via LearnWorlds API ──────────────────────────
    // Fetches affiliates + their leads from /v2/affiliates and runs the same
    // aggregation as processStandaloneAmbassadors. No file upload needed.
    async syncAmbassadorsFromApi(opts) {
        opts = opts || {};
        if (!window.LearnWorlds) {
            if (!opts.silent) alert('LearnWorlds module not loaded.');
            throw new Error('LearnWorlds module not loaded.');
        }
        const creds = await window.LearnWorlds.getCredentials();
        if (!creds.clientId || !creds.apiToken) {
            if (!opts.silent) this.showMsg('⚠ Add LearnWorlds API credentials first');
            throw new Error('No LearnWorlds credentials');
        }
        if (!this._apiSyncInFlight) { try { await this._backupSurghubBeforeSync(); } catch (e) {} }
        if (!opts.silent) this._showApiSyncOverlay('Ambassadors');
        this._updateApiSyncOverlay('Probing global lead total…', 0);
        try {
            // Try to fetch the historical total before iterating per-affiliate
            let historicalTotal = null;
            let historicalMethod = null;
            try {
                const r = await window.LearnWorlds.fetchTotalLeadCount();
                if (r && r.count != null) {
                    historicalTotal = r.count;
                    historicalMethod = r.method;
                }
            } catch (e) {
                console.warn('[Ambassadors] Historical total probe failed:', e.message);
            }

            this._updateApiSyncOverlay('Connecting to LearnWorlds…', 5);
            try { window.LearnWorlds.startRawPull('ambassadors'); } catch (e) {}
            const { leads: leadsJson, mode, totalClicks: ambClicks, clicksByPromoter: ambClicksByPromoter } = await window.LearnWorlds.fetchAmbassadorLeads(p => {
                let text, pct;
                if (p.phase === 'list') {
                    text = `Listing affiliates (page ${p.current}/${p.total})…`;
                    pct = (p.current / Math.max(1, p.total)) * 20;
                } else if (p.phase === 'leads') {
                    text = `Leads: ${(p.name || '').slice(0, 30)}… (${p.current}/${p.total})`;
                    pct = 20 + (p.current / Math.max(1, p.total)) * 75;
                } else {
                    text = 'Working…'; pct = 50;
                }
                this._updateApiSyncOverlay(text, pct);
            });
            try { window.LearnWorlds.finishRawPull(true); } catch (e) {}
            console.log(`[LearnWorlds] Ambassadors mode: ${mode}, ${leadsJson.length} lead rows`);

            // Run the SAME aggregation as the CSV path (copy-paste safe), with
            // filter-reason tracking so we know why rows get dropped.
            let total = 0, promoters = {}, timeline = {}, promTimeline = {};
            let dropNoPromoter = 0, dropNoDate = 0, dropTooOld = 0;
            const sampleDateValues = [];
            leadsJson.forEach((row, idx) => {
                let p = row.promoter;
                if (!p || String(p).trim() === '') { dropNoPromoter++; return; }
                if (idx < 3) sampleDateValues.push({ promoter: p, registered: row.registered, rawKeys: row._raw ? Object.keys(row._raw) : null });
                let m = window.Pipeline.parseDateToMonth(row.registered);
                if (!m) { dropNoDate++; return; }
                if (m < '2023-05') { dropTooOld++; return; }
                p = String(p).trim();
                total++; timeline[m] = (timeline[m] || 0) + 1;
                promoters[p] = (promoters[p] || 0) + 1;
                if (!promTimeline[p]) promTimeline[p] = {};
                promTimeline[p][m] = (promTimeline[p][m] || 0) + 1;
            });
            if (total === 0 && leadsJson.length > 0) {
                console.warn('[Ambassadors] All', leadsJson.length, 'leads were filtered out. Reasons:',
                    { noPromoter: dropNoPromoter, dateUnparseable: dropNoDate, beforeMay2023: dropTooOld });
                console.warn('[Ambassadors] Sample rows that were dropped:', sampleDateValues);
                console.warn('[Ambassadors] First lead._raw object — inspect for the right date field:', leadsJson[0]?._raw);
            } else if (dropNoDate > 0 || dropTooOld > 0) {
                console.log('[Ambassadors] Aggregation: kept', total, '/ dropped', dropNoPromoter + dropNoDate + dropTooOld,
                    { noPromoter: dropNoPromoter, dateUnparseable: dropNoDate, beforeMay2023: dropTooOld });
            }
            // Source-of-truth policy: Step 4's /users data is authoritative for
            // top-level counts (every signed-up user is in /users; the /leads
            // endpoint sometimes misses leads when affiliate.leads counters go
            // stale). Step 8 owns only the per-promoter timeline detail.
            const prev = this.ambassadorData || {};
            // Top-level totals: prefer Step 4 numbers when present, else fall
            // back to whatever this Step 8 pass computed locally.
            const authoritativeTotal = (prev.AttributableFromUsers != null)
                ? prev.AttributableFromUsers : total;
            const authoritativeAmbassadors = (prev.ActiveAmbassadorsFromUsers != null)
                ? prev.ActiveAmbassadorsFromUsers : Object.keys(promoters).length;
            const next = {
                // Top-level cards
                TotalReferrals: authoritativeTotal,
                TotalAmbassadors: authoritativeAmbassadors,
                // Per-promoter detail — only Step 8 produces this (Step 4 doesn't
                // know which lead came from which referrer's monthly timeline)
                Timeline: timeline,
                Promoters: promoters,
                PromoterTimeline: promTimeline,
                TopPromoters: Object.keys(promoters).sort((a, b) => promoters[b] - promoters[a]),
                // Also record the per-/leads numbers so we can show both if useful
                LeadsEndpointReferrals: total,
                LeadsEndpointAmbassadors: Object.keys(promoters).length,
                // Referral-link clicks (link views) — total + per-promoter, from
                // the affiliate counters. Clicks = visits; leads = signups.
                TotalClicks: ambClicks || 0,
                ClicksByPromoter: ambClicksByPromoter || {}
            };
            // Historical: prefer this run's value if we got one, else keep prev
            if (historicalTotal != null) {
                next.HistoricalTotal = historicalTotal;
                next.HistoricalMethod = historicalMethod;
                next.OrphanLeads = Math.max(0, historicalTotal - authoritativeTotal);
            } else if (prev.HistoricalTotal != null) {
                next.HistoricalTotal = prev.HistoricalTotal;
                next.HistoricalMethod = prev.HistoricalMethod;
                next.AttributableFromUsers = prev.AttributableFromUsers;
                next.ActiveAmbassadorsFromUsers = prev.ActiveAmbassadorsFromUsers;
                next.OrphanLeads = prev.OrphanLeads;
                next.OrphanByReferrerId = prev.OrphanByReferrerId;
                next.AttributableByReferrerId = prev.AttributableByReferrerId;
                next.DerivedFrom = prev.DerivedFrom;
                next.DerivedAt = prev.DerivedAt;
            }
            this.ambassadorData = next;
            await this.handleDbSave();
            this.isLoading = false;
            if (!opts.silent) {
                this._hideApiSyncOverlay();
                this.navigate('ambassadors');
                const modeNote = mode === 'aggregate'
                    ? '\n\n⚠ Aggregate mode: per-lead endpoint unavailable on this plan. Used affiliate.sales/clicks aggregates — totals are correct, monthly timeline is a single bucket.'
                    : `\n\nMode: /${mode}`;
                let histNote = '';
                if (historicalTotal != null) {
                    const orphans = Math.max(0, historicalTotal - total);
                    histNote = `\n\n📊 Historical total (LW global): ${historicalTotal.toLocaleString()} leads`;
                    if (orphans > 0) histNote += `\n   = ${total.toLocaleString()} attributable + ${orphans.toLocaleString()} orphans (referrers deleted)`;
                    histNote += `\n   Method: ${historicalMethod}`;
                } else {
                    histNote = `\n\nℹ Historical total: not fetchable via /users filter. We'll derive it from Step 4 (Demographics) when you run that.`;
                }
                alert(`Ambassadors synced (LearnWorlds API)\n\n${total.toLocaleString()} attributable referrals from ${Object.keys(promoters).length} ambassadors.${modeNote}${histNote}`);
            }
            if (!opts.silent) this.autoVerifyAfterSync();
            return { ok: true, totalReferrals: total, ambassadors: Object.keys(promoters).length, mode, historicalTotal };
        } catch (err) {
            this.isLoading = false;
            if (!opts.silent) {
                this._hideApiSyncOverlay();
                this.renderView();
                alert('Ambassador API sync error: ' + err.message);
            }
            throw err;
        }
    },

    // ── Step 4: Demographics via LearnWorlds API ─────────────────────────
    // Paginates /v2/users, flattens custom fields into CSV-row shape, then
    // runs the same runAudienceAggregation as the CSV path.
    async syncDemographicsFromApi(opts) {
        opts = opts || {};
        if (!window.LearnWorlds) {
            if (!opts.silent) alert('LearnWorlds module not loaded.');
            throw new Error('LearnWorlds module not loaded.');
        }
        const creds = await window.LearnWorlds.getCredentials();
        if (!creds.clientId || !creds.apiToken) {
            if (!opts.silent) this.showMsg('⚠ Add LearnWorlds API credentials first');
            throw new Error('No LearnWorlds credentials');
        }
        if (!this._apiSyncInFlight) { try { await this._backupSurghubBeforeSync(); } catch (e) {} }
        if (!opts.silent) this._showApiSyncOverlay('Step 4: Demographics');
        this._updateApiSyncOverlay('Fetching users…', 0);
        try {
            try { window.LearnWorlds.startRawPull('demographics'); } catch (e) {}
            const { users: usersJson, leadAttribution } = await window.LearnWorlds.fetchAllUsers(p => {
                const text = `Fetching users (page ${p.current}/${p.total}, ${p.count.toLocaleString()} so far, ${p.totalLeadsSoFar.toLocaleString()} leads)…`;
                const pct = (p.current / Math.max(1, p.total)) * 90;
                this._updateApiSyncOverlay(text, pct);
            });
            try { window.LearnWorlds.finishRawPull(true); } catch (e) {}
            console.log(`[LearnWorlds] Fetched ${usersJson.length.toLocaleString()} users; first row keys:`, Object.keys(usersJson[0] || {}));

            // ── Join enrolment + certificate course lists collected by the Growth
            // Timelines sync (user→courses / user→certs maps, keyed by user id).
            // This is what lets _buildAnonymizedUsers emit per-course records on a
            // normal (non-deep) sync — without it, rows have no `courses` field and
            // the anonymized user data ends up empty.
            try {
                const ucMap = await Storage.getItem('surghub_user_courses');
                const certMap = await Storage.getItem('surghub_user_certs');
                if (ucMap && typeof ucMap === 'object') {
                    let joined = 0, certJoined = 0;
                    for (const row of usersJson) {
                        const list = ucMap[row.id];
                        if (list && list.length) {
                            const existing = (row.courses || '').split(',').map(s => s.trim()).filter(Boolean);
                            row.courses = Array.from(new Set(existing.concat(list))).join(', ');
                            joined++;
                        }
                        const cList = certMap ? certMap[row.id] : null;
                        if (cList && cList.length) {
                            const existingC = (row.certificates || '').split(',').map(s => s.trim()).filter(Boolean);
                            row.certificates = Array.from(new Set(existingC.concat(cList))).join(', ');
                            certJoined++;
                        }
                    }
                    console.log(`[LearnWorlds] Joined Growth-Timeline data: courses → ${joined.toLocaleString()} users, certs → ${certJoined.toLocaleString()} users`);
                } else {
                    console.warn('[LearnWorlds] No surghub_user_courses map — run "Sync Growth Timelines" once to enable per-course anonymized user records.');
                }
            } catch (e) { console.warn('[LearnWorlds] user-courses join skipped:', e.message); }

            // ── Gender + organisation type. Primary source: user tags (the
            // classifier matches plain, prefixed and long-form survey-answer
            // tags — see _classifyTag). Fallback: the uploaded assessment-
            // submissions export joined by email (see processSignupSurvey).
            const tagGender = usersJson.reduce((n, r) => n + (r.gender ? 1 : 0), 0);
            const tagOrg = usersJson.reduce((n, r) => n + (r.organisation_type ? 1 : 0), 0);
            this._demoCoverage = { tagGender, tagOrg, surveyGender: 0, surveyOrg: 0, total: usersJson.length };
            console.log(`[LearnWorlds] Tag-derived demographics: gender on ${tagGender.toLocaleString()} / org type on ${tagOrg.toLocaleString()} of ${usersJson.length.toLocaleString()} users`);
            try {
                const sd = await Storage.getItem('surghub_signup_demo');
                if (sd && typeof sd === 'object') {
                    for (const row of usersJson) {
                        const email = String(row.email || row.Email || '').trim().toLowerCase();
                        const d = email ? sd[email] : null;
                        if (!d) continue;
                        if (!row.gender && d.gender) { row.gender = d.gender; this._demoCoverage.surveyGender++; }
                        if (!row.organisation_type && d.organisation_type) { row.organisation_type = d.organisation_type; this._demoCoverage.surveyOrg++; }
                    }
                    console.log(`[LearnWorlds] Signup-survey upload filled gender on ${this._demoCoverage.surveyGender.toLocaleString()} more users, org type on ${this._demoCoverage.surveyOrg.toLocaleString()}`);
                }
            } catch (e) { console.warn('[LearnWorlds] signup-demo join skipped:', e.message); }

            // ── DEEP: collect certificate records BY COURSE (/certificates?course_id).
            // Each record = one completion with a learner id + issued date. This
            // gives per-user cert attribution (→ row.certificates) + completion
            // dates for cohort retention. Per-user learning MINUTES aren't available
            // from any cheap endpoint, so Learning Time comes from course analytics
            // (Refresh Courses), not here.
            let deepCerts = null;
            if (opts.deep) {
                deepCerts = await window.LearnWorlds.fetchAllCertificates(p => {
                    if (p.phase === 'courses') {
                        this._updateApiSyncOverlay(`Listing courses (${p.current})…`, 32);
                    } else {
                        this._updateApiSyncOverlay(
                            `Certificates ${p.current}/${p.total} · ${p.certs.toLocaleString()} collected…`,
                            32 + (p.current / Math.max(1, p.total)) * 55
                        );
                    }
                });
                console.log(`[DeepSync] ${deepCerts.total.toLocaleString()} certificate records across ${deepCerts.courseCount} courses for ${Object.keys(deepCerts.certCountByUser).length.toLocaleString()} distinct learners`);
                // Enrich each user row with their completed-course list so the
                // aggregator + anonymized records carry has_certificate correctly.
                const certsByUser = {};
                for (const rec of deepCerts.records) {
                    (certsByUser[rec.user] = certsByUser[rec.user] || []).push(rec.courseName);
                }
                let matched = 0;
                for (const row of usersJson) {
                    const list = certsByUser[row.id];
                    if (!list || !list.length) continue;
                    matched++;
                    row.certificates = list.join(', ');
                    // Enrolment list isn't available per-user from a cheap endpoint;
                    // approximate courses ⊇ certificates so anon records exist for
                    // completed courses (engagement quadrants still work for completers).
                    if (!row.courses) row.courses = list.join(', ');
                }
                console.log(`[DeepSync] Joined certificates to ${matched.toLocaleString()} of ${usersJson.length.toLocaleString()} users`);
            }

            // Validate before aggregating (reuse existing checker)
            const validation = this._validateUsersFile(usersJson);
            if (!validation.ok) {
                throw new Error('Users API response failed validation: ' + validation.reason +
                    '\n\nThis usually means the demographic custom fields (country, profession) are not exposed via the API on this plan. Open DevTools console and inspect the first row keys above. Fall back to Step 4 CSV import.');
            }

            const aggregated = this.runAudienceAggregation(usersJson);
            const diag = aggregated._diag || {};
            delete aggregated._diag;

            if (!aggregated.TotalUsers || aggregated.TotalUsers === 0) {
                throw new Error(
                    'Aggregation produced 0 users from ' + usersJson.length.toLocaleString() + ' API rows.\n\n' +
                    'Detected signup column: ' + (diag.signupColumn || 'none') + '\n' +
                    'Most likely: the LearnWorlds API exposes signup dates under a different field name than the CSV export. ' +
                    'Inspect the first row keys (printed above in console) and tell me which field carries the signup date.'
                );
            }

            this._rawAnonymizedUsers = this._buildAnonymizedUsers(usersJson);
            await Storage.setItem('surghub_anon_users', this._rawAnonymizedUsers);
            this._emailDemoMap = this._buildEmailDemoMap(usersJson);
            await Storage.setItem('surghub_email_demo', this._emailDemoMap);

            const finalDate = new Date().toISOString().split('T')[0];
            this.userHistory = this.userHistory.filter(d => d.Timestamp !== finalDate);
            this.userHistory.push({ Timestamp: finalDate, ...aggregated });
            this.selectedDate = finalDate;
            this.platformUniqueUsers = aggregated.TotalUsers;
            // ── Bonus: lead attribution from the same pagination ──────────
            // Cross-reference referrer_id counts (from /users) against the
            // current affiliates list to identify orphan leads (referred users
            // whose referrer affiliate has since been deleted).
            this._updateApiSyncOverlay('Computing lead attribution…', 95);
            let ambassadorBonus = null;
            try {
                const affiliateIds = await window.LearnWorlds.fetchAffiliateIds();
                let attributable = 0, orphan = 0;
                const orphanByReferrerId = {};
                const attributableByReferrerId = {};
                for (const [rid, count] of Object.entries(leadAttribution.referrerCounts)) {
                    if (affiliateIds.has(rid)) {
                        attributable += count;
                        attributableByReferrerId[rid] = count;
                    } else {
                        orphan += count;
                        orphanByReferrerId[rid] = count;
                    }
                }
                // True active-ambassador count = distinct referrer_ids that
                // still map to an existing affiliate. This is more accurate
                // than counting /affiliates/{id}/leads endpoint responses,
                // which can miss ambassadors whose `.leads` counter is stale.
                const activeAmbassadors = Object.keys(attributableByReferrerId).length;
                ambassadorBonus = {
                    HistoricalTotal: leadAttribution.totalLeads,
                    AttributableFromUsers: attributable,
                    ActiveAmbassadorsFromUsers: activeAmbassadors,
                    AttributableByReferrerId: attributableByReferrerId,
                    OrphanLeads: orphan,
                    OrphanByReferrerId: orphanByReferrerId,
                    DerivedFrom: 'users-pagination',
                    DerivedAt: new Date().toISOString()
                };
                console.log('[Ambassadors] Derived from /users:', {
                    total: leadAttribution.totalLeads,
                    attributable, orphan,
                    activeAmbassadors
                });
                // Merge into existing ambassadorData if present, else create stub
                this.ambassadorData = Object.assign({}, this.ambassadorData || {}, ambassadorBonus);
                await Storage.setItem('surghub_ambassadors', this.ambassadorData);
            } catch (e) {
                console.warn('[Ambassadors] Could not derive lead attribution:', e.message);
            }

            // ── DEEP: build completion records from certificate data (cohort
            // retention, time-to-completion via issued dates).
            if (opts.deep && deepCerts) {
                this._updateApiSyncOverlay('Building completion detail…', 97);
                const completionRecords = deepCerts.records.map(rec => ({
                    user_uid: this._djb2Hash(String(rec.user)),
                    course: rec.courseName,
                    completed_at: rec.issued,
                    completed: true,
                    score: rec.score
                }));
                this._rawCompletion = completionRecords;
                await Storage.setItem('surghub_completion', completionRecords);
                console.log(`[DeepSync] Stored ${completionRecords.length.toLocaleString()} completion records`);
            }

            this._updateApiSyncOverlay('Saving…', 99);
            await this.handleDbSave();
            if (!opts.silent) {
                this._hideApiSyncOverlay();
                this.navigate('audience');
                const bonusNote = ambassadorBonus
                    ? `\n\n📊 Lead attribution (bonus from same pull):\n   • ${ambassadorBonus.HistoricalTotal.toLocaleString()} total historical leads\n   • ${ambassadorBonus.AttributableFromUsers.toLocaleString()} attributable to ${ambassadorBonus.ActiveAmbassadorsFromUsers} active ambassadors\n   • ${ambassadorBonus.OrphanLeads.toLocaleString()} orphans (referrer deleted)`
                    : '';
                const dc = this._demoCoverage || {};
                const demoNote = `\n\nGender: ${(dc.tagGender || 0).toLocaleString()} from tags · ${(dc.surveyGender || 0).toLocaleString()} from signup-survey upload\nOrganisation type: ${(dc.tagOrg || 0).toLocaleString()} from tags · ${(dc.surveyOrg || 0).toLocaleString()} from signup-survey upload`;
                alert(`Step 4 Complete (LearnWorlds API)\n\n${aggregated.TotalUsers.toLocaleString()} users loaded from ${usersJson.length.toLocaleString()} API rows.\nSignup column: "${diag.signupColumn || 'n/a'}"${demoNote}${bonusNote}`);
            }
            if (!opts.silent) this.autoVerifyAfterSync();
            return {
                ok: true,
                totalUsers: aggregated.TotalUsers,
                apiRows: usersJson.length,
                signupColumn: diag.signupColumn || 'n/a',
                ambassadorBonus,
                totalCertificates: aggregated.TotalCertificates,
                deepCertRecords: deepCerts ? deepCerts.total : null,
                demoCoverage: this._demoCoverage
            };
        } catch (err) {
            if (!opts.silent) {
                this._hideApiSyncOverlay();
                alert('Demographics API sync error: ' + err.message);
            }
            throw err;
        }
    },

    async processStandaloneAmbassadors(event) {
        const file = event.target.files[0];
        if (!file) return;
        this.isLoading = true; this.renderView();

        try {
            const leadsJson = await window.Pipeline.readExcel(file);
            let total = 0, promoters = {}, timeline = {}, promTimeline = {};

            leadsJson.forEach(row => {
                let p = row.promoter || row.Promoter;
                if (!p || String(p).trim() === '' || String(p).trim().toLowerCase() === 'nan') return;
                let m = window.Pipeline.parseDateToMonth(row.registered || row.Registered);
                if (!m || m < '2023-05') return; 

                p = String(p).trim();
                total++; timeline[m] = (timeline[m] || 0) + 1;
                promoters[p] = (promoters[p] || 0) + 1;
                if (!promTimeline[p]) promTimeline[p] = {};
                promTimeline[p][m] = (promTimeline[p][m] || 0) + 1;
            });

            this.ambassadorData = {
                TotalReferrals: total, TotalAmbassadors: Object.keys(promoters).length,
                Timeline: timeline, Promoters: promoters, PromoterTimeline: promTimeline, TopPromoters: Object.keys(promoters).sort((a,b) => promoters[b] - promoters[a]),
                DerivedFrom: 'leads-csv', DerivedAt: new Date().toISOString()
            };
            await this.handleDbSave();
            this.isLoading = false;
            this.navigate('ambassadors');
        } catch (err) { 
            this.isLoading = false; this.renderView();
            alert(`Data Error: ${err.message}`); 
        }
        event.target.value = '';
    }
});