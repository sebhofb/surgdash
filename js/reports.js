// Provider Report Generation — Direct PDF download via Electron IPC
// Charts rendered via Google Charts in hidden window, merged with optional cover/back

(function() {
    const path = electronAPI.path;
    const os   = electronAPI.os;

    Object.assign(window.App, {
        // Persisted paths for cover/back PDFs
        reportCoverPath: '',
        reportBackPath: '',

        async initReportSettings() {
            try {
                const cover = await Storage.getItem('report_cover_path');
                const back = await Storage.getItem('report_back_path');
                if (cover) this.reportCoverPath = cover;
                if (back) this.reportBackPath = back;
            } catch(e) {}
        },

        async pickCoverPdf() {
            const p = await electronAPI.invoke('pick-pdf-file', 'Select Cover Page PDF');
            if (p) {
                this.reportCoverPath = p;
                await Storage.setItem('report_cover_path', p);
                this.renderView();
            }
        },

        async pickBackPdf() {
            const p = await electronAPI.invoke('pick-pdf-file', 'Select Back Page PDF');
            if (p) {
                this.reportBackPath = p;
                await Storage.setItem('report_back_path', p);
                this.renderView();
            }
        },

        async clearCoverPdf() {
            this.reportCoverPath = '';
            await Storage.removeItem('report_cover_path');
            this.renderView();
        },

        async clearBackPdf() {
            this.reportBackPath = '';
            await Storage.removeItem('report_back_path');
            this.renderView();
        },

        // Feedback cutoff date for reports (only include feedback from this date onwards)
        reportFeedbackFromDate: '',

        // Reporting period for provider reports ('YYYY-MM' months; either end may be
        // empty = open). Reports always keep all-time totals; when a period is set
        // they ALSO show what happened inside it (new learners, certificates,
        // survey responses + avg rating), computed from the monthly CourseTimeline
        // and RatingHistory data. Shared by single and batch report generation.
        reportPeriodFrom: '',
        reportPeriodTo: '',
        async setReportPeriod(which, value) {
            if (which === 'from') this.reportPeriodFrom = value || '';
            else this.reportPeriodTo = value || '';
            try { await Storage.setItem('report_period', { from: this.reportPeriodFrom, to: this.reportPeriodTo }); } catch (e) {}
            this.renderView();
        },
        async clearReportPeriod() {
            this.reportPeriodFrom = ''; this.reportPeriodTo = '';
            try { await Storage.removeItem('report_period'); } catch (e) {}
            this.renderView();
        },
        _periodLabel() {
            if (!this.reportPeriodFrom && !this.reportPeriodTo) return '';
            const f = (m) => { const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; const p = m.split('-'); return (M[+p[1] - 1] || '') + ' ' + p[0]; };
            return (this.reportPeriodFrom ? f(this.reportPeriodFrom) : 'Launch') + ' – ' + (this.reportPeriodTo ? f(this.reportPeriodTo) : 'present');
        },
        _periodFileSuffix() {
            if (!this.reportPeriodFrom && !this.reportPeriodTo) return '';
            return '_' + (this.reportPeriodFrom || 'start') + '_to_' + (this.reportPeriodTo || 'now');
        },

        // Build the report HTML for a provider (self-contained with Google Charts)
        // Shared data assembly for both report renderers (PDF + dark HTML).
        // Returns null when the provider has no courses; otherwise every
        // computed dataset the templates need.
        // Derive a scale that makes a dated timeline sum to the stored totals.
        // Returns {e, c} multipliers; 1 when there is no raw signal to scale.
        _reconcileScale(tl, storedLearners, storedCerts) {
            let rawE = 0, rawC = 0;
            Object.keys(tl || {}).forEach(date => { const v = tl[date]; if (v && typeof v === 'object') { rawE += v.e || 0; rawC += v.c || 0; } });
            const e = (rawE > 0 && Number(storedLearners) > 0) ? Number(storedLearners) / rawE : 1;
            const c = (rawC > 0 && Number(storedCerts) > 0) ? Number(storedCerts) / rawC : 1;
            return { e, c };
        },

        async _assembleReportData(providerName, opts) {
            opts = opts || {};
            const platform = !!opts.platform;   // platform mode: aggregate ALL providers (no filter)
            // Reports read the lazy-loaded anon + completion blobs (per-course top
            // countries, real learning-time/completion in the users sheet) — ensure
            // they're in before assembling, in case no engagement tab was opened first.
            if (this.ensureAnonLoaded) await this.ensureAnonLoaded();
            if (this.ensureCompletionLoaded) await this.ensureCompletionLoaded();
            const feedbackCutoff = this.reportFeedbackFromDate || '';
            const snapData = this.getAnalyticsSnap();
            const pSnap = platform ? snapData.slice() : snapData.filter(d => d.Provider === providerName);
            if (pSnap.length === 0) return null;

            const courseMins = this.getCourseLearningMinutes ? this.getCourseLearningMinutes() : {}; // anon fallback — matches the dashboard provider total
            let totalLrn = 0, totalCert = 0, totalResp = 0, rSum = 0, rCnt = 0, totalMin = 0;
            pSnap.forEach(d => {
                totalLrn += (Number(d.Learners) || 0);
                totalCert += (Number(d.Certificates) || 0);
                totalResp += (Number(d.Responses) || 0);
                totalMin += (this.courseLearningMinutes ? this.courseLearningMinutes(d, courseMins) : (Number(d.LearningMinutes) || 0));
                let r = Number(d.Rating) || 0;
                if (r > 0) { rSum += r; rCnt++; }
            });
            const avgRating = rCnt > 0 ? (rSum / rCnt).toFixed(2) : 'N/A';
            // null (not '0') when no learners, so report surfaces render '-' like the dashboard.
            const certRate = totalLrn > 0 ? ((totalCert / totalLrn) * 100).toFixed(1) : null;

            // Course table
            const coursesSorted = pSnap.sort((a, b) => (Number(b.Learners) || 0) - (Number(a.Learners) || 0));
            const courseRows = coursesSorted.map(d => {
                const r = Number(d.Rating) || 0;
                return '<tr>' +
                    '<td class="td-l">' + this.escapeHtml(d.Course) + '</td>' +
                    '<td class="td-r">' + this.formatNumber(d.Learners) + '</td>' +
                    '<td class="td-r">' + this.formatNumber(d.Certificates) + '</td>' +
                    '<td class="td-r">' + (r > 0 ? r.toFixed(2) : '-') + '</td>' +
                    '<td class="td-r">' + this.formatNumber(d.Responses) + '</td></tr>';
            }).join('');

            // Build provider-level timeline data
            let provTimeline = {};
            const historyData = platform ? this.getAnalyticsHistory() : this.getAnalyticsHistory().filter(d => d.Provider === providerName);
            historyData.forEach(d => {
                if (d.CourseTimeline) {
                    let parsed = window.Charts.safeParse(d.CourseTimeline);
                    let tl = parsed.timeline || parsed;
                    // Reconcile the dated curve to the authoritative stored totals.
                    // The dated source (cert records / signup dates) often covers
                    // only part of the real total, so the stored scale can be stale
                    // (e.g. 242 dated certs vs 626 stored). Recompute per course so
                    // the curve always sums to Learners / Certificates.
                    const sc = this._reconcileScale(tl, d.Learners, d.Certificates);
                    Object.keys(tl).forEach(date => {
                        let m = date.substring(0, 7);
                        if (!provTimeline[m]) provTimeline[m] = { e: 0, c: 0 };
                        if (typeof tl[date] === 'object') {
                            provTimeline[m].e += Math.round((tl[date].e || 0) * sc.e);
                            provTimeline[m].c += Math.round((tl[date].c || 0) * sc.c);
                        }
                    });
                }
            });

            // Build per-course timeline data for individual course charts
            let courseTimelines = {};
            historyData.forEach(d => {
                if (!d.CourseTimeline || !d.Course) return;
                let parsed = window.Charts.safeParse(d.CourseTimeline);
                let tl = parsed.timeline || parsed;
                const sc = this._reconcileScale(tl, d.Learners, d.Certificates);
                let monthly = {};
                Object.keys(tl).forEach(date => {
                    let m = date.substring(0, 7);
                    if (!monthly[m]) monthly[m] = { e: 0, c: 0 };
                    if (typeof tl[date] === 'object') {
                        monthly[m].e += Math.round((tl[date].e || 0) * sc.e);
                        monthly[m].c += Math.round((tl[date].c || 0) * sc.c);
                    }
                });
                courseTimelines[d.Course] = monthly;
            });

            // Build per-course rating data
            let courseRatings = {};
            historyData.forEach(d => {
                if (!d.RatingHistory || !d.Course) return;
                if (!(Number(d.Responses) > 0)) return; // survey stats cleared (e.g. de-duped shared survey) — no rating chart
                let hist = window.Charts.safeParse(d.RatingHistory);
                let monthly = {};
                Object.keys(hist).forEach(m => {
                    if (typeof hist[m] === 'object' && hist[m].sum !== undefined) {
                        monthly[m] = { sum: hist[m].sum, count: hist[m].count, vol: hist[m].count };
                    }
                });
                if (Object.keys(monthly).length > 0) courseRatings[d.Course] = monthly;
            });

            // Build provider-level rating history
            let ratingData = {};
            historyData.forEach(d => {
                if (!d.RatingHistory) return;
                if (!(Number(d.Responses) > 0)) return;
                let hist = window.Charts.safeParse(d.RatingHistory);
                Object.keys(hist).forEach(m => {
                    if (!ratingData[m]) ratingData[m] = { sum: 0, count: 0, vol: 0 };
                    if (typeof hist[m] === 'object' && hist[m].sum !== undefined) {
                        ratingData[m].sum += hist[m].sum;
                        ratingData[m].count += hist[m].count;
                        ratingData[m].vol += hist[m].count;
                    }
                });
            });

            // Reporting-period stats: filter the monthly provider timeline + rating
            // history to the selected window. All-time totals above stay untouched.
            const pFrom = this.reportPeriodFrom || '';
            const pTo = this.reportPeriodTo || '';
            const hasPeriod = !!(pFrom || pTo);
            const inPeriod = (m) => (!pFrom || m >= pFrom) && (!pTo || m <= pTo);
            let perEnrol = 0, perCert = 0, perResp = 0, perRatingSum = 0;
            if (hasPeriod) {
                Object.keys(provTimeline).forEach(m => { if (inPeriod(m)) { perEnrol += provTimeline[m].e || 0; perCert += provTimeline[m].c || 0; } });
                Object.keys(ratingData).forEach(m => { if (inPeriod(m)) { perResp += ratingData[m].count || 0; perRatingSum += ratingData[m].sum || 0; } });
            }
            const perAvgRating = perResp > 0 ? (perRatingSum / perResp).toFixed(2) : null;
            const periodLabel = this._periodLabel();

            // Survey question insights: all 1–5 scale questions captured by the survey
            // sync (QuestionStats per course), aggregated across the provider's courses.
            // Includes the transformative-change indicators ("information was new to me",
            // "likely I will use the information acquired"). All-time figures.
            const qAgg = {};
            const qOrder = [];
            pSnap.forEach(d => {
                if (!d.QuestionStats) return;
                let qs; try { qs = JSON.parse(d.QuestionStats); } catch (e) { return; }
                (Array.isArray(qs) ? qs : []).forEach(s => {
                    if (!s || !s.q || !s.n) return;
                    if (!qAgg[s.q]) { qAgg[s.q] = { sum: 0, n: 0, na: 0, hi: 0 }; qOrder.push(s.q); }
                    qAgg[s.q].sum += (s.avg || 0) * s.n;
                    qAgg[s.q].n += s.n;
                    qAgg[s.q].na += s.na || 0;
                    qAgg[s.q].hi += (s.dist ? ((s.dist[4] || 0) + (s.dist[5] || 0)) : 0);
                });
            });
            const cleanQ = (q) => String(q)
                .replace(/^on a scale from 1 to 5,?\s*/i, '')
                .replace(/^how strongly do you agree with the following statement:?\s*/i, '')
                .replace(/if you are currently unemployed.*$/i, '')
                .replace(/["“”]/g, '')
                .replace(/\s+/g, ' ').trim();
            // Fold known French/Spanish question variants into the English
            // canonical row so multilingual providers get one merged table.
            const CANON = [
                [/satisfaction concernant ce cours|satisfacci.n general/i, 'how would you rate your overall satisfaction with this course?'],
                [/objectifs mentionn|objetivos mencionados|objetivos enunciados|pertinencia de los contenidos para alcanzar/i, 'how well did the course help you achieve the learning objectives stated on the course description?'],
                [/pertinent et engageant|pertinente y atractivo|interactividad de los contenidos/i, 'how relevant and engaging was the course content?'],
                [/nouvelle pour moi|nuevo para m/i, 'the information presented in this course (e.g., knowledge, concepts, awareness, skills, etc.) was new to me"?'],
                [/pertinent pour mon travail|relevante para mi trabajo/i, 'the content of the course is relevant to my job"?'],
                [/informations acquises|informaci.n adquirida/i, 'it is likely that I will use the information acquired in this course"?'],
                [/r.ussite professionnelle|.xito laboral/i, 'How important are the knowledge/skills acquired in the event to your job success?'],
                [/facile . utiliser|f.cil de usar|interfaz|ergonom.a y la accesibilidad|accesibilidad de la plataforma/i, 'how user-friendly and reliable was the course platform?']
            ];
            const canonMerged = {};
            const canonOrder = [];
            qOrder.forEach(q => {
                let key = q;
                for (const [re, canon] of CANON) { if (re.test(q)) { key = canon; break; } }
                // The same question arrives in several prompt variants ("On a
                // scale from 1 to 5, ...", quoted statements, case differences):
                // merge on the cleaned case-folded text so each question is one
                // row regardless of survey version.
                const norm = cleanQ(key).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
                if (!canonMerged[norm]) { const dq = cleanQ(key); canonMerged[norm] = { sum: 0, n: 0, na: 0, hi: 0, disp: dq ? dq.charAt(0).toUpperCase() + dq.slice(1) : dq }; canonOrder.push(norm); }
                const v = qAgg[q];
                canonMerged[norm].sum += v.sum; canonMerged[norm].n += v.n; canonMerged[norm].na += v.na; canonMerged[norm].hi += v.hi;
            });
            Object.keys(qAgg).forEach(k => delete qAgg[k]);
            Object.assign(qAgg, canonMerged);
            qOrder.length = 0; canonOrder.forEach(k => qOrder.push(k));

            const surveyQRows = qOrder.filter(q => qAgg[q].n >= 3).map(q => {
                const v = qAgg[q];
                const qText = v.disp || cleanQ(q);
                return { q: qText, title: this._surveyQTitle ? this._surveyQTitle(qText) : '', avg: (v.sum / v.n), n: v.n, hiPct: (v.hi / v.n) * 100 };
            });

            // SURGhub platform-wide benchmarks (all providers) for the dark
            // report's subtle "vs platform" comparisons.
            const benchmarks = (() => {
                const impact = (typeof this._surveyImpactStats === 'function') ? this._surveyImpactStats(snapData) : null;
                let rs = 0, rc = 0;
                const gq = {}; const gCountries = {}; let gCountryTotal = 0;
                snapData.forEach(d => {
                    const r = Number(d.Rating) || 0; if (r > 0) { rs += r; rc++; }
                    if (d.QuestionStats) {
                        try {
                            (JSON.parse(d.QuestionStats) || []).forEach(s => {
                                if (!s || !s.q || !s.n) return;
                                const k = cleanQ(s.q);
                                if (!gq[k]) gq[k] = { sum: 0, n: 0, hi: 0 };
                                gq[k].sum += (s.avg || 0) * s.n; gq[k].n += s.n;
                                gq[k].hi += (s.dist ? ((s.dist[4] || 0) + (s.dist[5] || 0)) : 0);
                            });
                        } catch (e) {}
                    }
                    if (d.CountryStats) {
                        try {
                            Object.entries(JSON.parse(d.CountryStats)).forEach(([k, v]) => {
                                if (k && k !== 'Unknown' && k !== 'nan') { gCountries[k] = (gCountries[k] || 0) + v; gCountryTotal += v; }
                            });
                        } catch (e) {}
                    }
                });
                const questions = {};
                Object.keys(gq).forEach(k => { const v = gq[k]; if (v.n >= 3) questions[k] = { avg: v.sum / v.n, hiPct: (v.hi / v.n) * 100 }; });
                return { impact, avgRating: rc ? rs / rc : 0, questions, countries: gCountries, countryTotal: gCountryTotal };
            })();

            // Build per-course top 10 countries. PRIMARY: per-course CountryStats
            // (Growth Timelines — the canonical source the dashboard course page uses).
            // FALLBACK: anonymized user CSV (fuzzy course match) when CountryStats absent.
            let courseCountryData = {};
            let anonUsers = this._rawAnonymizedUsers;
            coursesSorted.forEach(course => {
                // CountryStats-first
                if (course.CountryStats) {
                    try {
                        const cs = JSON.parse(course.CountryStats);
                        const entries = Object.entries(cs).filter(([k]) => k && k !== 'Unknown' && k !== 'nan');
                        if (entries.length > 0) {
                            const sorted = entries.sort((a, b) => b[1] - a[1]).slice(0, 10);
                            const totalWithCountry = entries.reduce((s, [, v]) => s + (Number(v) || 0), 0);
                            courseCountryData[course.Course] = { top10: sorted, totalWithCountry, totalUsers: totalWithCountry, learners: Number(course.Learners) || 0 };
                            return;
                        }
                    } catch (e) {}
                }
                // Fallback: anonymized user CSV
                if (!anonUsers || anonUsers.length === 0) return;
                let courseUsers = anonUsers.filter(u => u.course === course.Course);
                if (courseUsers.length === 0) {
                    const normCourse = course.Course.toLowerCase().replace(/[^a-z0-9]/g, '');
                    courseUsers = anonUsers.filter(u => {
                        const normU = (u.course || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        return normU.length > 3 && normCourse.length > 3 &&
                            (normU.includes(normCourse) || normCourse.includes(normU));
                    });
                }
                if (courseUsers.length === 0) return;
                const countryCounts = {};
                courseUsers.forEach(u => {
                    if (u.country && u.country.trim()) {
                        const c = u.country.trim();
                        countryCounts[c] = (countryCounts[c] || 0) + 1;
                    }
                });
                const sorted = Object.entries(countryCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
                if (sorted.length > 0) {
                    courseCountryData[course.Course] = { top10: sorted, totalWithCountry: courseUsers.filter(u => u.country && u.country.trim()).length, totalUsers: courseUsers.length, learners: Number(course.Learners) || 0 };
                }
            });

            // Build provider-level country aggregation for GeoChart.
            // PRIMARY (API path): aggregate per-course CountryStats from the
            // Growth Timelines sync. FALLBACK (CSV): anonymized per-user records.
            let providerCountryData = {};
            let _usedCountryStats = false;
            coursesSorted.forEach(c => {
                if (!c.CountryStats) return;
                try {
                    const cs = JSON.parse(c.CountryStats);
                    Object.entries(cs).forEach(([k, v]) => {
                        if (k && k !== 'Unknown' && k !== 'nan') { providerCountryData[k] = (providerCountryData[k] || 0) + v; _usedCountryStats = true; }
                    });
                } catch (e) {}
            });
            if (!_usedCountryStats && anonUsers && anonUsers.length > 0) {
                const provCourseNames = coursesSorted.map(c => c.Course);
                anonUsers.forEach(u => {
                    let match = provCourseNames.includes(u.course);
                    if (!match) {
                        const normU = (u.course || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        match = provCourseNames.some(pc => {
                            const normP = pc.toLowerCase().replace(/[^a-z0-9]/g, '');
                            return normU.length > 3 && normP.length > 3 && (normU.includes(normP) || normP.includes(normU));
                        });
                    }
                    if (!match) return;
                    if (u.country && u.country.trim() && u.country !== 'Unknown' && u.country !== 'nan') {
                        const c = u.country.trim();
                        providerCountryData[c] = (providerCountryData[c] || 0) + 1;
                    }
                });
            }
            // Convert country names → ISO codes so the generated report's GeoChart
            // resolves regions natively (no Maps API key / geocoding needed).
            const providerCountryByIso = {};
            Object.entries(providerCountryData).forEach(([c, v]) => {
                const iso = (window.countryToISO && window.countryToISO(c)) || c;
                providerCountryByIso[iso] = (providerCountryByIso[iso] || 0) + v;
            });
            const providerCountryJson = JSON.stringify(providerCountryByIso);

            // Collect all feedback (unfiltered) for manual testimonial override
            let allFeedbackRaw = [];
            pSnap.forEach(c => {
                if (!c.FeedbackBank) return;
                try {
                    let fb = JSON.parse(c.FeedbackBank);
                    if (!Array.isArray(fb)) return;
                    fb.forEach(f => {
                        if (f.t && !f.t.match(/^no\s*data$/i) && f.t.trim().length > 10) {
                            allFeedbackRaw.push({ ...f, _course: c.Course });
                        }
                    });
                } catch(e) {}
            });

            // Apply date cutoff for auto-detected feedback
            let allFeedback = feedbackCutoff
                ? allFeedbackRaw.filter(f => !f.d || f.d >= feedbackCutoff)
                : allFeedbackRaw;

            let testimonials = [], suggestions = [], critical = [];
            if (window.FeedbackIntel && allFeedback.length > 0) {
                const scored = allFeedback.map(f => window.FeedbackIntel.scoreFeedback(f));
                testimonials = scored.filter(f => f._flags.includes('testimonial'))
                    .sort((a, b) => b._testimonialScore - a._testimonialScore).slice(0, 6);
                suggestions = scored.filter(f => f._flags.includes('suggestion'))
                    .sort((a, b) => b._score - a._score).slice(0, 6);
                critical = scored.filter(f => f.s === 'Critical' || f._flags.includes('critical'))
                    .sort((a, b) => b._score - a._score).slice(0, 6);
            } else {
                // Fallback without intelligence engine
                allFeedback.forEach(f => {
                    if (f.s === 'Positive') testimonials.push(f);
                    else if (f.s === 'Critical') critical.push(f);
                });
                testimonials = testimonials.slice(0, 6);
                critical = critical.slice(0, 6);
            }

            // ── AI curation (when feedback has been scored with Claude) ──
            // Junk never reaches a report; quotable comments scoring >= 7 take
            // priority over the keyword heuristic, capped at 2 per course for
            // diversity; cleaned pull-quotes replace the raw text (original
            // kept on _orig). Manual selections below still override everything.
            try {
                const aiMap = this._aiScoreMap || (await Storage.getItem('surghub_feedback_ai')) || {};
                if (Object.keys(aiMap).length) {
                    const aiOf = (f) => aiMap[this._djb2Hash(String(f.t || '').trim())];
                    const notJunk = (f) => { const a = aiOf(f); return !a || a.s > 0; };
                    testimonials = testimonials.filter(notJunk);
                    // Suggestions / Areas-for-Improvement: AI themes replace the
                    // old keyword engine entirely. Sections render only when the
                    // AI actually found that kind of feedback. Same min-score bar
                    // as testimonial auto-select (stored pref, default 7); deduped
                    // across courses AND across the two sections (identical
                    // comments submitted to sibling courses appear once); AI
                    // cleaned text with deterministic polish.
                    let minScore = 7;
                    try { const prefs = (await Storage.getItem('surghub_ai_prefs')) || {}; if (Number(prefs.minScore) >= 1) minScore = Number(prefs.minScore); } catch (e) {}
                    const seenThemed = new Set();
                    const themed = (theme) => allFeedback
                        .filter(f => { const a = aiOf(f); return a && a.s >= minScore && Array.isArray(a.t) && a.t.includes(theme); })
                        .sort((x, y) => (aiOf(y).s - aiOf(x).s))
                        .filter(f => {
                            const a = aiOf(f);
                            const k = String(a.c || f.t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 200);
                            if (!k || seenThemed.has(k)) return false;
                            seenThemed.add(k); return true;
                        })
                        .slice(0, 6)
                        .map(f => {
                            const a = aiOf(f);
                            const out = Object.assign({}, f, { _ai: a, _orig: f.t });
                            const best = a.c || f.t;
                            out.t = this._polishQuote ? this._polishQuote(best) : best;
                            return out;
                        });
                    suggestions = themed('suggestion');
                    critical = themed('complaint');
                    const perCourse = {};
                    const aiPicks = allFeedback
                        .filter(f => { const a = aiOf(f); return a && a.q && a.s >= 7; })
                        .sort((x, y) => aiOf(y).s - aiOf(x).s)
                        .filter(f => { const c = f._course || ''; perCourse[c] = (perCourse[c] || 0) + 1; return perCourse[c] <= 2; })
                        .slice(0, 6)
                        .map(f => {
                            const a = aiOf(f);
                            const out = Object.assign({}, f, { _ai: a });
                            if (a.c) { out._orig = f.t; out.t = this._polishQuote ? this._polishQuote(a.c) : a.c; }
                            return out;
                        });
                    if (aiPicks.length) testimonials = aiPicks;
                }
            } catch (e) { console.warn('[AICurate] report integration skipped:', e.message); }

            let courseTestimonials = null;   // { courseName: [entries] } — set when selections exist
            const fbSummaries = this._feedbackSummaries || (await Storage.getItem('surghub_feedback_summaries')) || {};

            // Load per-course testimonial selections
            let selectedTestimonialMap = {}; // { courseName: [text, ...] }
            try {
                const selMap = (await Storage.getItem('surghub_selected_testimonials')) || {};
                const provSel = selMap[providerName] || {};
                if (typeof provSel === 'object' && !Array.isArray(provSel)) {
                    selectedTestimonialMap = provSel;
                }
                // If any manual selections exist, override provider-level testimonials
                const allSelTexts = Object.values(selectedTestimonialMap).flat();
                if (allSelTexts.length > 0) {
                    const aiM = this._aiScoreMap || {};
                    const aiOf2 = (f) => aiM[this._djb2Hash(String(f.t || '').trim())];
                    let manualPicks = allFeedbackRaw.filter(f => allSelTexts.includes(f.t));
                    if (manualPicks.length > 0) {
                        // apply AI-cleaned quotes; keep the original
                        manualPicks = manualPicks.map(f => {
                            const ai = aiOf2(f);
                            const cleaned = (ai && ai.c) ? (this._polishQuote ? this._polishQuote(ai.c) : ai.c) : null;
                            return cleaned ? Object.assign({}, f, { _orig: f.t, t: cleaned, _ai: ai }) : Object.assign({}, f, { _ai: ai });
                        });
                        // Per-course sections show ALL selections for that course
                        courseTestimonials = {};
                        manualPicks.forEach(f => { const c = f._course || 'General'; (courseTestimonials[c] = courseTestimonials[c] || []).push(f); });
                        // Provider level: best 6 across courses (by AI score, max 2/course)
                        const perC = {};
                        testimonials = manualPicks.slice()
                            .sort((x, y) => (((y._ai || {}).s || 5)) - (((x._ai || {}).s || 5)))
                            .filter(f => { const c = f._course || ''; perC[c] = (perC[c] || 0) + 1; return perC[c] <= 2; })
                            .slice(0, 6);
                    }
                }
            } catch(e) { console.error('Testimonial override error:', e); }

            const reportDate = this.formatDate(new Date().toISOString().split('T')[0]);

            // Provider-scoped survey-impact stats (New Knowledge / Intent to
            // Apply) — used by the dark HTML report's Learning Impact band.
            const surveyImpact = (typeof this._surveyImpactStats === 'function') ? this._surveyImpactStats(pSnap) : null;

            // Optional provider page URL. SURGhub has no provider URL scheme, so
            // this only comes from a manual "Provider URL" column added to the
            // persisted Provider Map file (on any row naming this provider).
            let providerUrl = '';
            if (!platform) try {
                const provMapRows = (await Storage.getItem('surgdash_provider_map')) || [];
                const normName = (s) => String(s || '').trim().toLowerCase();
                const urlOf = (r) => String(r['Provider URL'] || r['Provider Page'] || r['Provider Link'] || '').trim();
                const match = provMapRows.find(r => normName(r['Providers'] || Object.values(r)[1]) === normName(providerName) && urlOf(r));
                if (match) providerUrl = urlOf(match);
                if (providerUrl && !/^https?:\/\//i.test(providerUrl)) providerUrl = 'https://' + providerUrl;
                // Known SURGhub provider pages (surghub.org/{slug}). Only
                // providers with a live page are listed (checked June 2026);
                // matched by distinctive token on the accent-folded name.
                if (!providerUrl) {
                    const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    const pn = fold(providerName);
                    const PROVIDER_PAGES = [
                        ['allsafe', 'all-safe-courses'],
                        ['americansocietyofanaesthesiologists', 'american-society-anesthesiologists-courses'],
                        ['amosmile', 'amosmile-courses'],
                        ['aoalliance', 'ao-alliance-courses'],
                        ['ausmed', 'ausmed-courses'],
                        ['behindtheknife', 'behind-the-knife-courses'],
                        ['canesca', 'canecsa-courses'],
                        ['cosecsa', 'cosecsa-courses'],
                        ['crashsavers', 'crashsavers-courses'],
                        ['ecancer', 'ecancer-courses'],
                        ['f2ar', 'federation-francophone-des-societes-danesthesie-f2ar-courses'],
                        ['baylor', 'global-trauma-collaboration-baylor-courses'],
                        ['ifrs', 'ifrs-courses'],
                        ['interburns', 'interburns-courses'],
                        ['redcross', 'international-committee-red-cross-courses'],
                        ['kingsglobalhealth', 'kings-global-health-partnerships-courses'],
                        ['lifebox', 'lifebox-courses'],
                        ['nihr', 'nihr-courses'],
                        ['safesurgeryinnovation', 'safe-surgery-innovation-courses'],
                        ['smiletrain', 'smile-train-courses'],
                        ['tecnologicodemonterrey', 'tecsalud-courses'],
                        ['universityofminnesota', 'university-of-minnesota-courses'],
                        ['westernaustralia', 'university-western-australia-courses']
                    ];
                    const hit = PROVIDER_PAGES.find(([tok]) => pn.includes(tok));
                    if (hit) providerUrl = 'https://www.surghub.org/' + hit[1];
                }
            } catch (e) {}

            let providerAwards = [], providerCountryAwards = [], courseAwardMap = {};
            try {
                const aw = this.computeAwards ? this.computeAwards() : null;
                if (aw) {
                    providerAwards = aw.provider[providerName] || [];
                    providerCountryAwards = aw.providerCountries[providerName] || [];
                    pSnap.forEach(d => { const ca = aw.course[d.Course]; if (ca && ca.length) courseAwardMap[d.Course] = ca; });
                }
            } catch (e) {}
            const awardsAsOf = this._currentQuarterLabel ? this._currentQuarterLabel() : '';

            // Platform mode: per-provider roll-up (Top Providers section) + provider count.
            let topProviders = [], providerCount = 0;
            if (platform) {
                const pm = {};
                pSnap.forEach(d => {
                    const p = String(d.Provider || 'Unknown').trim() || 'Unknown';
                    const m = pm[p] || (pm[p] = { name: p, courses: 0, lrn: 0, cert: 0, rSum: 0, rCnt: 0 });
                    m.courses++; m.lrn += Number(d.Learners) || 0; m.cert += Number(d.Certificates) || 0;
                    const r = Number(d.Rating) || 0; if (r > 0) { m.rSum += r; m.rCnt++; }
                });
                providerCount = Object.keys(pm).length;
                topProviders = Object.values(pm).map(m => ({
                    name: m.name, courses: m.courses, lrn: m.lrn, cert: m.cert,
                    certRate: m.lrn > 0 ? (m.cert / m.lrn * 100) : null,
                    avg: m.rCnt > 0 ? (m.rSum / m.rCnt) : null
                })).sort((a, b) => b.lrn - a.lrn);
            }

            return {
                providerName, isPlatform: platform, topProviders, providerCount,
                feedbackCutoff, reportDate, providerUrl, providerAwards, providerCountryAwards, courseAwardMap, awardsAsOf,
                pSnap, coursesSorted, courseRows,
                totalLrn, totalCert, totalResp, totalMin, avgRating, certRate,
                provTimeline, courseTimelines, courseRatings, ratingData,
                pFrom, pTo, hasPeriod, periodLabel, perEnrol, perCert, perResp, perAvgRating,
                surveyQRows, surveyImpact,
                courseCountryData, providerCountryData, providerCountryByIso, providerCountryJson,
                testimonials, suggestions, critical, allFeedbackCount: allFeedback.length,
                courseTestimonials, fbSummaries,
                benchmarks
            };
        },

        async _buildReportHtml(providerName) {
            const D = await this._assembleReportData(providerName);
            if (!D) return null;
            const {
                feedbackCutoff, reportDate, pSnap, coursesSorted, courseRows,
                totalLrn, totalCert, totalResp, totalMin, avgRating, certRate,
                provTimeline, courseTimelines, courseRatings, ratingData,
                pFrom, pTo, hasPeriod, periodLabel, perEnrol, perCert, perResp, perAvgRating,
                surveyQRows, courseCountryData, providerCountryData, providerCountryJson,
                testimonials, suggestions, critical
            } = D;
            const inPeriod = (m) => (!pFrom || m >= pFrom) && (!pTo || m <= pTo);
            const esc = (s) => this.escapeHtml(s);

            const feedbackCards = (items, bgColor, badge) => {
                if (items.length === 0) return '';
                return items.map(f => {
                    const stars = f.r > 0 ? '<span style="color:#f59e0b;font-size:11px;margin-left:6px">' + '★'.repeat(Math.round(f.r)) + '</span>' : '';
                    return '<div style="background:' + bgColor + ';border-radius:8px;padding:10px 12px;font-size:12px;break-inside:avoid;margin-bottom:6px">' +
                    (badge ? '<div style="font-size:9px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:4px">' + badge + '</div>' : '') +
                    '<div style="font-style:italic;margin-bottom:4px">&ldquo;' + esc(f.t || f.text || '') + '&rdquo;' + stars + '</div>' +
                    '<div style="font-size:10px;color:#64748b">' + esc(f._course || f.course || '') + '</div></div>';
                }
                ).join('');
            };

            // Group testimonials by course for injection into course sections
            // (full per-course selections when auto/manual selections exist)
            const testimonialsByCourse = D.courseTestimonials ? D.courseTestimonials : {};
            if (!D.courseTestimonials) testimonials.forEach(f => {
                const c = f._course || 'General';
                if (!testimonialsByCourse[c]) testimonialsByCourse[c] = [];
                testimonialsByCourse[c].push(f);
            });

            // Build per-course detail sections
            const courseDetailSections = coursesSorted.map((course, idx) => {
                const cName = course.Course;
                const chartId = 'course_chart_' + idx;
                const ratingChartId = 'course_rating_' + idx;
                const hasTimeline = courseTimelines[cName] && Object.keys(courseTimelines[cName]).length > 0;
                const hasRating = courseRatings[cName] && Object.keys(courseRatings[cName]).length > 0;
                const countryInfo = courseCountryData[cName];

                // Period activity line for this course (only when a period is set)
                let periodLine = '';
                if (hasPeriod) {
                    let pe = 0, pc = 0, pr = 0, prs = 0;
                    const ct = courseTimelines[cName] || {};
                    Object.keys(ct).forEach(m => { if (inPeriod(m)) { pe += ct[m].e || 0; pc += ct[m].c || 0; } });
                    const cr = courseRatings[cName] || {};
                    Object.keys(cr).forEach(m => { if (inPeriod(m)) { pr += cr[m].count || 0; prs += cr[m].sum || 0; } });
                    periodLine = '<div style="font-size:11px;color:#0c4a6e;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:4px 10px;margin-bottom:8px;display:inline-block"><strong>' + esc(periodLabel) + ':</strong> +' + this.formatNumber(pe) + ' learners &middot; +' + this.formatNumber(pc) + ' certificates' + (pr > 0 ? ' &middot; ' + this.formatNumber(pr) + ' responses (avg ' + (prs / pr).toFixed(2) + ')' : '') + '</div>';
                }

                let countryTable = '';
                if (countryInfo && countryInfo.top10.length > 0) {
                    countryTable = '<table style="width:100%;margin-top:8px"><thead><tr><th>Country</th><th class="r">Users</th><th class="r">%</th></tr></thead><tbody>' +
                        countryInfo.top10.map(([country, count]) =>
                            '<tr><td class="td-l">' + esc(country) + '</td><td class="td-r">' + this.formatNumber(count) + '</td><td class="td-r">' + (countryInfo.totalWithCountry > 0 ? ((count / countryInfo.totalWithCountry) * 100).toFixed(1) : '0') + '%</td></tr>'
                        ).join('') +
                        '</tbody></table>' +
                        '<div style="font-size:10px;color:#94a3b8;margin-top:4px">Country data available for ' + this.formatNumber(countryInfo.totalWithCountry) + ' of ' + this.formatNumber(countryInfo.learners || countryInfo.totalUsers) + ' learners' + ((countryInfo.learners && countryInfo.totalWithCountry < countryInfo.learners * 0.4) ? ' · low coverage — may not be representative' : '') + '</div>';
                }

                return `
                    <div style="page-break-inside:avoid;margin-bottom:20px;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px">
                        <div style="font-size:15px;font-weight:700;color:#002F4C;margin-bottom:4px">${esc(cName)}</div>
                        <div style="display:flex;gap:16px;margin-bottom:10px;font-size:12px">
                            <span><strong style="color:#4389C8">${this.formatNumber(course.Learners)}</strong> learners</span>
                            <span><strong>${this.formatNumber(course.Certificates)}</strong> certificates</span>
                            ${Number(course.Rating) > 0 ? '<span><strong style="color:#D03734">' + Number(course.Rating).toFixed(2) + '</strong> avg rating</span>' : ''}
                            ${Number(course.Responses) > 0 ? '<span><strong>' + this.formatNumber(course.Responses) + '</strong> responses</span>' : ''}
                        </div>
                        ${(D.fbSummaries && D.fbSummaries[cName] && D.fbSummaries[cName].s) ? '<p style="font-size:11.5px;color:#475569;font-style:italic;border-left:3px solid #e2e8f0;padding-left:8px;margin:0 0 10px">' + esc(D.fbSummaries[cName].s) + '</p>' : ''}
                        ${periodLine}
                        ${hasTimeline ? '<div id="' + chartId + '" style="width:100%;height:220px;margin-bottom:8px"></div>' : ''}
                        ${hasRating ? '<div id="' + ratingChartId + '" style="width:100%;height:200px;margin-bottom:8px"></div>' : ''}
                        ${countryTable ? '<div style="margin-top:8px"><div style="font-size:12px;font-weight:700;color:#002F4C;margin-bottom:4px">Top 10 Countries</div>' + countryTable + '</div>' : ''}
                        ${testimonialsByCourse[cName] ? '<div style="margin-top:12px"><div style="font-size:12px;font-weight:700;color:#002F4C;margin-bottom:6px">⭐ Testimonials</div><div class="fb-grid">' + feedbackCards(testimonialsByCourse[cName], '#f0fdf4', '') + '</div></div>' : ''}
                    </div>
                `;
            }).join('');

            // Serialize data for charts
            const timelineJson = JSON.stringify(provTimeline);
            const ratingJson = JSON.stringify(ratingData);
            const courseTimelinesJson = JSON.stringify(courseTimelines);
            const courseRatingsJson = JSON.stringify(courseRatings);
            // Map course names to chart element IDs
            const courseChartMap = {};
            const courseRatingMap = {};
            coursesSorted.forEach((c, idx) => {
                if (courseTimelines[c.Course]) courseChartMap[c.Course] = 'course_chart_' + idx;
                if (courseRatings[c.Course]) courseRatingMap[c.Course] = 'course_rating_' + idx;
            });
            const courseChartMapJson = JSON.stringify(courseChartMap);
            const courseRatingMapJson = JSON.stringify(courseRatingMap);

            // Count feedback stats for summary
            const fbTotal = D.allFeedbackCount;
            const fbTestimonials = testimonials.length;
            const fbSuggestions = suggestions.length;
            const fbCritical = critical.length;

            return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${esc(providerName)} Report</title>
<script src="https://www.gstatic.com/charts/loader.js"><\/script>
<style>
  @page { size: A4; margin: 12mm 12mm 16mm 12mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 0; color: #1e293b; font-size: 13px; }
  .page { max-width: 830px; margin: 0 auto; padding: 12mm 0; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 3px solid #002F4C; }
  .header h1 { font-size: 24px; color: #002F4C; margin: 0; }
  .header .meta { text-align: right; color: #64748b; font-size: 11px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(7,1fr); gap: 8px; margin-bottom: 20px; }
  .kpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 8px; text-align: center; }
  .kpi .label { font-size: 9px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 4px; }
  .kpi .value { font-size: 20px; font-weight: 900; color: #002F4C; }
  .kpi .value.blue { color: #4389C8; } .kpi .value.red { color: #D03734; } .kpi .value.green { color: #5B8C5A; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { padding: 6px 8px; text-align: left; font-size: 9px; font-weight: 700; text-transform: uppercase; color: #64748b; border-bottom: 2px solid #002F4C; }
  th.r { text-align: right; }
  .td-l { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; font-weight: 600; }
  .td-r { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; text-align: right; }
  .section-title { font-size: 16px; font-weight: 700; color: #002F4C; margin: 24px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0; page-break-after: avoid; }
  .section-block { page-break-inside: avoid; }
  .sub-title { font-size: 13px; font-weight: 700; color: #002F4C; margin: 14px 0 6px; }
  .chart-box { width: 100%; height: 260px; margin-bottom: 14px; }
  .fb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .summary-box { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; font-size: 13px; color: #0c4a6e; }
  .footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; text-align: center; }
  .page-break { page-break-before: always; }
</style>
</head><body>
<div class="page">
  <div class="header">
    <div><h1>${esc(providerName)}</h1><p style="color:#4389C8;font-weight:600;margin:4px 0 0;font-size:14px">SURGhub Performance Report</p></div>
    <div class="meta"><div>Report Date: ${reportDate}</div>${hasPeriod ? '<div style="color:#0c4a6e;font-weight:700">Reporting Period: ' + esc(periodLabel) + '</div>' : ''}<div>Generated by SURGdash &copy;</div></div>
  </div>

  <div class="kpi-grid">
    <div class="kpi"><div class="label">Courses</div><div class="value">${pSnap.length}</div></div>
    <div class="kpi"><div class="label">Enrolled Learners</div><div class="value blue">${this.formatNumber(totalLrn)}</div></div>
    <div class="kpi"><div class="label">Certificates</div><div class="value">${this.formatNumber(totalCert)}</div></div>
    <div class="kpi"><div class="label">Learning Time</div><div class="value green">${this.formatLearningTime(totalMin)}</div></div>
    <div class="kpi"><div class="label">Countries</div><div class="value">${Object.keys(providerCountryData).length || '-'}</div></div>
    <div class="kpi"><div class="label">Avg Rating</div><div class="value red">${avgRating} / 5</div></div>
    <div class="kpi"><div class="label">Responses</div><div class="value">${this.formatNumber(totalResp)}</div></div>
  </div>

  <div class="summary-box">
    <strong>Summary:</strong> ${esc(providerName)} has <strong>${pSnap.length} active course${pSnap.length !== 1 ? 's' : ''}</strong> on SURGhub,
    reaching <strong>${this.formatNumber(totalLrn)} learners</strong>${certRate != null ? ' with a <strong>' + certRate + '% certification rate</strong>' : ''}.
    ${totalResp > 0 ? 'Across <strong>' + this.formatNumber(totalResp) + ' survey responses</strong>, the average rating is <strong>' + avgRating + ' out of 5</strong>.' : ''}
  </div>

  ${(D.fbSummaries && D.fbSummaries['@provider:' + providerName] && D.fbSummaries['@provider:' + providerName].s) ? '<div class="summary-box" style="background:#fefce8;border-color:#fde68a;color:#713f12"><strong>What learners are saying:</strong> ' + esc(D.fbSummaries['@provider:' + providerName].s) + ' <span style="color:#a16207;font-size:11px">(AI summary of survey feedback)</span></div>' : ''}

  ${hasPeriod ? `<div class="section-block">
    <div class="section-title">Reporting Period &mdash; ${esc(periodLabel)}</div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi" style="background:#f0f9ff;border-color:#bae6fd"><div class="label">New Enrolments</div><div class="value blue">+${this.formatNumber(perEnrol)}</div></div>
      <div class="kpi" style="background:#f0f9ff;border-color:#bae6fd"><div class="label">New Certificates</div><div class="value">+${this.formatNumber(perCert)}</div></div>
      <div class="kpi" style="background:#f0f9ff;border-color:#bae6fd"><div class="label">Survey Responses</div><div class="value">${this.formatNumber(perResp)}</div></div>
      <div class="kpi" style="background:#f0f9ff;border-color:#bae6fd"><div class="label">Avg Rating (Period)</div><div class="value red">${perAvgRating !== null ? perAvgRating + ' / 5' : '&ndash;'}</div></div>
    </div>
    <div style="font-size:10px;color:#94a3b8;margin:-14px 0 6px">Activity recorded between ${esc(periodLabel)}. All other figures in this report are all-time totals.</div>
  </div>` : ''}

  <div class="section-block">
    <div class="section-title">Provider Growth Overview</div>
    <div id="chart_growth" class="chart-box"></div>
  </div>

  ${Object.keys(providerCountryData).length > 0 ? '<div class="section-block"><div class="section-title">Learner World Map</div><div id="chart_geo" style="width:100%;height:300px;margin-bottom:14px"></div></div>' : ''}

  <div class="section-block">
    <div class="section-title">Feedback Trends</div>
    <div id="chart_feedback" class="chart-box"></div>
  </div>

  ${surveyQRows.length > 0 ? `<div class="section-block">
    <div class="section-title">Survey Insights</div>
    <table><thead><tr><th>Question</th><th class="r">Responses</th><th class="r">Avg (1–5)</th><th class="r">% rating 4–5</th></tr></thead>
    <tbody>${surveyQRows.map(r =>
        '<tr><td class="td-l">' + (r.title ? '<strong style="color:#0468b1">' + esc(r.title) + ':</strong> ' : '') + esc(r.q) + '</td>' +
        '<td class="td-r">' + this.formatNumber(r.n) + '</td>' +
        '<td class="td-r">' + r.avg.toFixed(2) + '</td>' +
        '<td class="td-r"><strong>' + Math.round(r.hiPct) + '%</strong></td></tr>'
    ).join('')}</tbody></table>
    <div style="font-size:10px;color:#94a3b8;margin-top:4px">End-of-course survey, all responses to date, aggregated across this provider's courses. "N/A" answers (learners marking a question not applicable) are excluded.</div>
  </div>` : ''}

  <div class="section-block">
  <div class="section-title">Course Summary</div>
  <table><thead><tr><th>Course</th><th class="r">Enrolled Learners</th><th class="r">Certificates</th><th class="r">Rating</th><th class="r">Responses</th></tr></thead>
  <tbody>${courseRows}</tbody></table>
  </div>

  ${(() => {
    const provTop10 = Object.entries(providerCountryData).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (provTop10.length === 0) return '';
    const totalCountryUsers = Object.values(providerCountryData).reduce((a, b) => a + b, 0);
    return '<div class="section-block"><div class="section-title">Top 10 Countries</div>' +
      '<table><thead><tr><th>Country</th><th class="r">Enrolled Learners</th><th class="r">%</th></tr></thead><tbody>' +
      provTop10.map(([c, v]) => '<tr><td class="td-l">' + esc(c) + '</td><td class="td-r">' + this.formatNumber(v) + '</td><td class="td-r">' + (totalCountryUsers > 0 ? ((v / totalCountryUsers) * 100).toFixed(1) : '0') + '%</td></tr>').join('') +
      '</tbody></table>' +
      '<div style="font-size:10px;color:#94a3b8;margin-top:4px">' + Object.keys(providerCountryData).length + ' countries total \u2022 ' + this.formatNumber(totalCountryUsers) + ' users with country data</div></div>';
  })()}

  ${feedbackCutoff ? '<div style="margin-top:12px;padding:8px 12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;font-size:11px;color:#92400e"><strong>Note:</strong> Written feedback below is filtered to entries from <strong>' + this.formatDate(feedbackCutoff) + '</strong> onwards. Charts and learner data reflect all time.</div>' : ''}

  ${suggestions.length > 0 ? '<div class="section-block"><div class="section-title">\uD83D\uDCA1 Learner Suggestions</div><div class="fb-grid">' + feedbackCards(suggestions, '#faf5ff', '\uD83D\uDCA1 Suggestion') + '</div></div>' : ''}
  ${critical.length > 0 ? '<div class="section-block"><div class="section-title">Areas for Improvement</div><div class="fb-grid">' + feedbackCards(critical, '#fef2f2', '\u26A0 Critical') + '</div></div>' : ''}

  <div class="page-break"></div>
  <div class="section-title">Course Details</div>
  ${courseDetailSections}

  <div class="page-break"></div>
  <div class="section-block">
  <div class="section-title">Methodology & Notes</div>
  <div style="font-size:11px;color:#475569;line-height:1.6">
    <p style="margin-bottom:8px"><strong>Data sources:</strong> Learner, certificate, and survey data is sourced from the LearnWorlds platform. Demographic data (country, profession, gender) comes from the user profile survey, which was voluntary until late 2024 and is now mandatory for new registrations. Country data is supplemented with automatic browser geolocation where survey data is unavailable. Learner growth curves are based on learner signup dates clamped to each course's launch month: where a course launched after its learners first joined SURGhub, those learners are counted in the launch month, so monthly timing is approximate while totals are exact. Certificates use their actual issue dates. For courses where a per-learner progress export has been imported, exact course start dates are used instead.</p>
    <p style="margin-bottom:8px"><strong>Feedback analysis &amp; testimonials:</strong> Written feedback is scored with AI assistance (Anthropic's Claude) for testimonial quality and themes, and used to select the quotes shown in this report. Selected quotes may be lightly edited for spelling, capitalisation and length — wording and meaning are never altered, and comments whose meaning is unclear are excluded rather than reworded. This AI-assisted curation is experimental. The complete, unedited feedback is provided separately in the feedback file included in this reporting package.${feedbackCutoff ? ' <strong>Feedback in this report is filtered to entries from ' + this.formatDate(feedbackCutoff) + ' onwards.</strong>' : ''}</p>
    <p style="margin-bottom:8px"><strong>Limitations:</strong> Learner counts include all registered users (including inactive). Survey ratings reflect respondents only, not all enrollees. Country data from browser tracking may reflect VPN location. Demographic figures for charts are extrapolated from the surveyed subset to the full user base, assuming survey respondents are representative.</p>
    <p style="margin-bottom:0"><strong>For questions or additional detail, please contact the SURGhub team.</strong></p>
  </div>
  </div>

  <div class="footer" style="line-height:1.6">
    <p style="margin:0 0 6px">SURGhub is a joint initiative of the <strong>Global Surgery Foundation (GSF)</strong> and <strong>UNITAR</strong> (United Nations Institute for Training and Research), supported by the <strong>Royal College of Surgeons in Ireland (RCSI)</strong>, and implemented in association with the <strong>Johnson &amp; Johnson Foundation</strong>.</p>
    <p style="margin:0">SURGdash &copy; Global Surgery Foundation &mdash; Confidential</p>
  </div>
</div>

<script>
google.charts.load('current', {packages:['corechart','geochart']});
google.charts.setOnLoadCallback(drawCharts);

function drawCharts() {
  var tl = ${timelineJson};
  var months = Object.keys(tl).sort();
  // Shared chart styling
  var lineOpts = {
    lineWidth:2, curveType:'function', pointSize:0,
    chartArea:{width:'88%',height:'72%',top:24,bottom:48},
    legend:{position:'top',textStyle:{fontSize:10,color:'#475569'}},
    hAxis:{textStyle:{fontSize:8,color:'#94a3b8'},slantedText:true,slantedTextAngle:45,gridlines:{color:'transparent'},baselineColor:'#e2e8f0'},
    vAxis:{textStyle:{fontSize:9,color:'#94a3b8'},gridlines:{color:'#f1f5f9',count:5},minorGridlines:{count:0},viewWindow:{min:0},format:'#,###',baselineColor:'#e2e8f0'}
  };
  var comboOpts = {
    chartArea:{width:'85%',height:'68%',top:24,bottom:48},
    legend:{position:'top',textStyle:{fontSize:10,color:'#475569'}},
    hAxis:{textStyle:{fontSize:8,color:'#94a3b8'},slantedText:true,slantedTextAngle:45,gridlines:{color:'transparent'},baselineColor:'#e2e8f0'},
    bar:{groupWidth:'60%'}
  };

  // GeoChart - Provider learner map
  var geoData = ${providerCountryJson};
  var geoEl = document.getElementById('chart_geo');
  if (geoEl && Object.keys(geoData).length > 0) {
    var gdt = new google.visualization.DataTable();
    gdt.addColumn('string','Country');
    gdt.addColumn('number','Enrolled Learners');
    Object.keys(geoData).forEach(function(c){ gdt.addRow([c, geoData[c]]); });
    new google.visualization.GeoChart(geoEl).draw(gdt, {
      colorAxis:{colors:['#dbeafe','#4389C8','#002F4C']}, backgroundColor:'#ffffff',
      datalessRegionColor:'#f8fafc', legend:{textStyle:{fontSize:10}}
    });
  }

  // Provider Growth chart (monthly bars + cumulative lines)
  if (months.length > 0) {
    var dt = new google.visualization.DataTable();
    dt.addColumn('string','Month');
    dt.addColumn('number','Monthly Enroll.');
    dt.addColumn('number','Monthly Cert.');
    dt.addColumn('number','Cumulative Enroll.');
    dt.addColumn('number','Cumulative Cert.');
    var cumE=0, cumC=0;
    months.forEach(function(m){
      var mE = tl[m].e||0, mC = tl[m].c||0;
      cumE += mE; cumC += mC;
      var label = new Date(m+'-01').toLocaleDateString('en-US',{month:'short',year:'numeric'});
      dt.addRow([label, mE, mC, cumE, cumC]);
    });
    new google.visualization.ComboChart(document.getElementById('chart_growth')).draw(dt,
      Object.assign({}, comboOpts, {
        colors:['#91B5D9','#bcd4e8','#002F4C','#4389C8'],
        seriesType:'bars',
        series:{
          0:{type:'bars',targetAxisIndex:1},
          1:{type:'bars',targetAxisIndex:1},
          2:{type:'line',targetAxisIndex:0,lineWidth:2,pointSize:3,curveType:'function'},
          3:{type:'line',targetAxisIndex:0,lineWidth:2,pointSize:3,curveType:'function'}
        },
        vAxes:{
          0:{title:'',viewWindow:{min:0},textStyle:{fontSize:9,color:'#94a3b8'},gridlines:{color:'#f1f5f9',count:5},minorGridlines:{count:0},baselineColor:'#e2e8f0',format:'#,###'},
          1:{title:'',viewWindow:{min:0},textStyle:{fontSize:9,color:'#94a3b8'},gridlines:{color:'transparent'},minorGridlines:{count:0},baselineColor:'#e2e8f0',format:'#,###'}
        }
      })
    );
  }

  // Provider Feedback chart
  var rd = ${ratingJson};
  var rMonths = Object.keys(rd).sort();
  if (rMonths.length > 0) {
    var dt2 = new google.visualization.DataTable();
    dt2.addColumn('string','Month');
    dt2.addColumn('number','Responses');
    dt2.addColumn('number','Avg Rating');
    rMonths.forEach(function(m){
      var label = new Date(m+'-01').toLocaleDateString('en-US',{month:'short',year:'numeric'});
      var avg = rd[m].count > 0 ? rd[m].sum/rd[m].count : null;
      dt2.addRow([label, rd[m].vol, avg]);
    });
    new google.visualization.ComboChart(document.getElementById('chart_feedback')).draw(dt2, Object.assign({}, comboOpts, {
      colors:['#91B5D9','#D03734'], seriesType:'bars',
      series:{0:{type:'bars',targetAxisIndex:1},1:{type:'line',targetAxisIndex:0,lineWidth:2,pointSize:4,curveType:'function'}},
      vAxes:{
        0:{title:'',viewWindow:{min:0,max:5},textStyle:{fontSize:9,color:'#94a3b8'},gridlines:{color:'#f1f5f9',count:6},minorGridlines:{count:0},baselineColor:'#e2e8f0'},
        1:{title:'',viewWindow:{min:0},textStyle:{fontSize:9,color:'#94a3b8'},gridlines:{color:'transparent'},minorGridlines:{count:0},baselineColor:'#e2e8f0'}
      }
    }));
  }

  // Per-course growth charts
  var courseTL = ${courseTimelinesJson};
  var courseMap = ${courseChartMapJson};
  Object.keys(courseMap).forEach(function(cName) {
    var elId = courseMap[cName];
    var el = document.getElementById(elId);
    if (!el) return;
    var ctl = courseTL[cName];
    if (!ctl) return;
    var cMonths = Object.keys(ctl).sort();
    if (cMonths.length === 0) return;
    var dt3 = new google.visualization.DataTable();
    dt3.addColumn('string','Month');
    dt3.addColumn('number','Monthly Enroll.');
    dt3.addColumn('number','Monthly Cert.');
    dt3.addColumn('number','Cumulative Enroll.');
    dt3.addColumn('number','Cumulative Cert.');
    var cumE2=0, cumC2=0;
    cMonths.forEach(function(m){
      var mE2 = ctl[m].e||0, mC2 = ctl[m].c||0;
      cumE2 += mE2; cumC2 += mC2;
      var label = new Date(m+'-01').toLocaleDateString('en-US',{month:'short',year:'numeric'});
      dt3.addRow([label, mE2, mC2, cumE2, cumC2]);
    });
    new google.visualization.ComboChart(el).draw(dt3,
      Object.assign({}, comboOpts, {
        colors:['#91B5D9','#bcd4e8','#002F4C','#4389C8'],
        seriesType:'bars',
        series:{
          0:{type:'bars',targetAxisIndex:1},
          1:{type:'bars',targetAxisIndex:1},
          2:{type:'line',targetAxisIndex:0,lineWidth:2,pointSize:2,curveType:'function'},
          3:{type:'line',targetAxisIndex:0,lineWidth:2,pointSize:2,curveType:'function'}
        },
        vAxes:{
          0:{title:'',viewWindow:{min:0},textStyle:{fontSize:9,color:'#94a3b8'},gridlines:{color:'#f1f5f9',count:5},minorGridlines:{count:0},baselineColor:'#e2e8f0',format:'#,###'},
          1:{title:'',viewWindow:{min:0},textStyle:{fontSize:9,color:'#94a3b8'},gridlines:{color:'transparent'},minorGridlines:{count:0},baselineColor:'#e2e8f0',format:'#,###'}
        },
        chartArea:{width:'85%',height:'65%',top:18,bottom:42}
      })
    );
  });

  // Per-course rating charts
  var courseRD = ${courseRatingsJson};
  var ratingMap = ${courseRatingMapJson};
  Object.keys(ratingMap).forEach(function(cName) {
    var elId = ratingMap[cName];
    var el = document.getElementById(elId);
    if (!el) return;
    var crd = courseRD[cName];
    if (!crd) return;
    var crMonths = Object.keys(crd).sort();
    if (crMonths.length === 0) return;
    var dt4 = new google.visualization.DataTable();
    dt4.addColumn('string','Month');
    dt4.addColumn('number','Responses');
    dt4.addColumn('number','Avg Rating');
    crMonths.forEach(function(m){
      var label = new Date(m+'-01').toLocaleDateString('en-US',{month:'short',year:'numeric'});
      var avg = crd[m].count > 0 ? crd[m].sum/crd[m].count : null;
      dt4.addRow([label, crd[m].vol||crd[m].count, avg]);
    });
    new google.visualization.ComboChart(el).draw(dt4, Object.assign({}, comboOpts, {
      colors:['#91B5D9','#D03734'], seriesType:'bars',
      series:{0:{type:'bars',targetAxisIndex:1},1:{type:'line',targetAxisIndex:0,lineWidth:2,pointSize:3,curveType:'function'}},
      chartArea:{width:'85%',height:'62%',top:18,bottom:42},
      legend:{position:'top',textStyle:{fontSize:9,color:'#475569'}},
      vAxes:{
        0:{title:'',viewWindow:{min:0,max:5},textStyle:{fontSize:8,color:'#94a3b8'},gridlines:{color:'#f1f5f9',count:6},minorGridlines:{count:0},baselineColor:'#e2e8f0'},
        1:{title:'',viewWindow:{min:0},textStyle:{fontSize:8,color:'#94a3b8'},gridlines:{color:'transparent'},minorGridlines:{count:0},baselineColor:'#e2e8f0'}
      }
    }));
  });

  // Signal that charts are ready
  document.title = 'READY';
}
<\/script>
</body></html>`;
        },

        // ── Dark editorial HTML report — same data as the PDF, skinned like the
        // web snapshot (navy editorial theme, gold accents, Chart.js + GeoChart).
        // Self-contained single file: logos inlined as data URIs; chart libraries
        // load from CDN, so charts need an internet connection to render.
        async _buildDarkReportHtml(providerName, platform) {
            platform = !!platform;
            const D = await this._assembleReportData(providerName, { platform });
            if (!D) return null;
            const esc = (s) => this.escapeHtml(s);
            const fmt = (n) => this.formatNumber(n);

            // Logos. Provider logo convention: drop a PNG/JPG named after the
            // provider's safe name (lowercase, non-alphanumerics → _) into
            // build/provider_logos/ and it appears in the report header.
            let shLogo = '', shLogoColor = '', provLogo = '';
            try {
                const read = (f) => {
                    const p = path.join(electronAPI.appPath, 'build', f);
                    if (!electronAPI.fs.existsSync(p)) return '';
                    const mime = /\.jpe?g$/i.test(f) ? 'image/jpeg' : 'image/png';
                    return 'data:' + mime + ';base64,' + electronAPI.fs.readFileBase64(p);
                };
                for (const f of ['surghub_logo_color.png', 'surghub_logo_colour.png', 'SURGhub_app_square.png', 'surghub_logo.png']) { shLogoColor = read(f); if (shLogoColor) break; }
                for (const f of ['surghub_logo_white.png', 'SURGhub_app_square_white.png']) { shLogo = read(f); if (shLogo) break; }
                const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
                const provNorm = platform ? '' : norm(providerName);
                if (!platform) try {
                    const dir = path.join(electronAPI.appPath, 'build', 'provider_logos');
                    const files = electronAPI.fs.readdirSync ? electronAPI.fs.readdirSync(dir) : [];
                    const hit = files.find(f => /\.(png|jpe?g)$/i.test(f) && norm(f.replace(/\.[^.]+$/, '')) === provNorm)
                        || files.find(f => /\.(png|jpe?g)$/i.test(f) && (provNorm.includes(norm(f.replace(/\.[^.]+$/, ''))) || norm(f.replace(/\.[^.]+$/, '')).includes(provNorm)) && norm(f.replace(/\.[^.]+$/, '')).length >= 3);
                    if (hit) provLogo = read('provider_logos/' + hit);
                } catch (e) {}
            } catch (e) {}

            // Subtle "vs platform" delta chip. dec = decimals, pts = unit label.
            const B = D.benchmarks || {};
            const delta = (val, base, dec, pts, bare) => {
                if (base == null || !isFinite(base) || !isFinite(val)) return '';
                const d = val - base;
                const col = Math.abs(d) < 0.005 ? '#6d8ba3' : (d >= 0 ? '#3FB984' : '#E28743');
                return '<span style="font-family:var(--mono);font-size:9px;color:' + col + ';white-space:nowrap">' + (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(dec) + (pts ? ' pts' : '') + (bare ? '' : ' vs platform') + '</span>';
            };

            // opts: {noBar} drop accent bar · {info} click → definition modal ·
            //       {valueId} id on the value node so runtime JS can update it
            const card = (label, sub, value, color, opts) => {
                opts = opts || {};
                const clickAttrs = opts.info ? ' data-t="' + esc(label) + '" data-i="' + esc(opts.info) + '" onclick="kpiInfo(this)"' : '';
                return '<div class="kcard' + (opts.info ? ' kcard-click' : '') + '"' + clickAttrs + ' style="position:relative;background:linear-gradient(160deg,' + color + '14,#001a2b 72%);border:1px solid var(--border);border-radius:5px;padding:18px 18px 20px;overflow:hidden">'
                    + (opts.noBar ? '' : '<div style="position:absolute;top:0;left:0;right:0;height:3px;background:' + color + '"></div>')
                    + '<p style="margin:0;font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:' + color + '">' + label + '</p>'
                    + (sub ? '<p style="margin:2px 0 0;font-family:var(--mono);font-size:8.5px;letter-spacing:.04em;text-transform:uppercase;color:#6d8ba3">' + sub + '</p>' : '')
                    + '<p' + (opts.valueId ? ' id="' + opts.valueId + '"' : '') + ' style="margin:14px 0 0;font-family:var(--serif);font-size:30px;font-weight:700;color:#eef4f9;line-height:1">' + value + '</p>'
                    + (opts.info ? '<p class="kcard-hint">What we measure &rarr;</p>' : '')
                    + '</div>';
            };

            const secEyebrow = (t) => '<p class="sec-eyebrow">' + esc(t) + '</p>';

            // Public SURGhub course-page link. CourseId is the LearnWorlds course
            // id/slug stored by Sync Courses; courses synced before that field
            // existed render as plain text until the next sync. stopPropagation
            // keeps the link from also firing row/heading click handlers.
            const courseLink = (c, inner) => c.CourseId
                ? '<a class="shl" href="https://www.surghub.org/course/' + encodeURIComponent(String(c.CourseId)) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' + inner + '</a>'
                : inner;

            // Anonymous attribution ("Nurse, Kenya") via the email→demographics
            // map; the email itself never reaches the report.
            const whoFor = (f) => {
                const m = this._emailDemoMap || {};
                const d = f.e ? m[String(f.e).trim().toLowerCase()] : null;
                if (!d) return 'Learner';
                const parts = [d.profession, d.country].filter(Boolean).map(p => p.charAt(0).toUpperCase() + p.slice(1));
                return parts.length ? parts.join(', ') : 'Learner';
            };
            const quotes = [];   // serialized for the full-quote modal
            const quoteCard = (f) => {
                const stars = f.r > 0 ? '<span style="color:var(--accent);font-size:11px;margin-left:8px;letter-spacing:.1em;flex-shrink:0">' + '★'.repeat(Math.round(f.r)) + '</span>' : '';
                const who = whoFor(f);
                const idx = quotes.length;
                quotes.push({ t: String(f.t || ''), w: who, c: String(f._course || f.course || ''), r: Number(f.r) || 0 });
                return '<div class="qcard" onclick="showQuote(' + idx + ')" style="background:var(--surface2);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:5px;padding:12px 14px;font-size:12.5px;cursor:pointer">'
                    + '<div style="font-style:italic;color:#d4dde7;line-height:1.55;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden">&ldquo;' + esc(f.t || '') + '&rdquo;</div>'
                    + '<div style="margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:#9fb3c8">' + esc(who) + '</span>' + stars + '</div>'
                    + '<div style="margin-top:2px;font-family:var(--mono);font-size:9px;letter-spacing:.04em;color:#6d8ba3">' + esc(f._course || f.course || '') + '</div></div>';
            };

            const tHead = (cols) => '<thead><tr>' + cols.map(c => '<th style="padding:8px 10px;text-align:' + (c.r ? 'right' : 'left') + ';font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6d8ba3;border-bottom:1px solid var(--border)">' + c.t + '</th>').join('') + '</tr></thead>';
            const tdL = (v) => '<td style="padding:7px 10px;border-bottom:1px solid rgba(10,58,87,0.5);color:#d4dde7;font-weight:600">' + v + '</td>';
            const tdR = (v) => '<td style="padding:7px 10px;border-bottom:1px solid rgba(10,58,87,0.5);text-align:right;color:#b6c4d2;font-variant-numeric:tabular-nums">' + v + '</td>';

            // Per-course period stats + testimonial grouping
            const testimonialsByCourse = D.courseTestimonials ? D.courseTestimonials : {};
            if (!D.courseTestimonials) D.testimonials.forEach(f => { const c = f._course || 'General'; (testimonialsByCourse[c] = testimonialsByCourse[c] || []).push(f); });
            const inPeriod = (m) => (!D.pFrom || m >= D.pFrom) && (!D.pTo || m <= D.pTo);

            // Milestones: biggest learner/cert thresholds crossed in a timeline
            const mkMilestones = (tl) => {
                const th = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
                const find = (key) => { const ms = Object.keys(tl).sort(); let cum = 0, best = null; ms.forEach(m => { const prev = cum; cum += tl[m][key] || 0; th.forEach(t => { if (prev < t && cum >= t) best = { t, m }; }); }); return best; };
                const fmtM = (m) => new Date(m + '-02').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                const e = find('e'), c = find('c'); const bits = [];
                if (e) bits.push('crossed <strong style="color:#eef4f9">' + fmt(e.t) + ' learners</strong> in ' + fmtM(e.m));
                if (c) bits.push('<strong style="color:#eef4f9">' + fmt(c.t) + ' certificates</strong> in ' + fmtM(c.m));
                return bits;
            };

            const courseChartMap = {}, courseRatingMap = {};
            D.coursesSorted.forEach((c, idx) => {
                if (D.courseTimelines[c.Course] && Object.keys(D.courseTimelines[c.Course]).length) courseChartMap[c.Course] = 'cc_' + idx;
                if (D.courseRatings[c.Course] && Object.keys(D.courseRatings[c.Course]).length) courseRatingMap[c.Course] = 'cr_' + idx;
            });

            const courseSections = D.coursesSorted.map((course, idx) => {
                const cName = course.Course;
                // Period chip is filled/toggled by the in-report period picker
                const periodLine = '<p id="cpl_' + idx + '" style="margin:0 0 18px;display:none;font-family:var(--mono);font-size:10px;letter-spacing:.05em;color:var(--accent);background:var(--accent-soft);border:1px solid #FFC14538;border-radius:4px;padding:4px 10px"></p>';
                const ci = D.courseCountryData[cName];
                const countryTable = (ci && ci.top10.length) ?
                    '<div style="margin-top:22px"><p style="margin:0 0 6px;font-family:var(--mono);font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#9fb3c8">Top 10 Countries</p>'
                    + '<table style="width:100%;border-collapse:collapse;font-size:12px">' + tHead([{ t: 'Country' }, { t: 'Users', r: 1 }, { t: '%', r: 1 }]) + '<tbody>'
                    + ci.top10.map(([c, n]) => '<tr>' + tdL(esc(c)) + tdR(fmt(n)) + tdR(ci.totalWithCountry > 0 ? ((n / ci.totalWithCountry) * 100).toFixed(1) + '%' : '0%') + '</tr>').join('')
                    + '</tbody></table><p style="margin:5px 0 0;font-family:var(--mono);font-size:9px;color:#6d8ba3">Country data available for ' + fmt(ci.totalWithCountry) + ' of ' + fmt(ci.learners || ci.totalUsers) + ' learners' + ((ci.learners && ci.totalWithCountry < ci.learners * 0.4) ? ' &middot; <span style="color:var(--accent)">low coverage — this breakdown may not be representative</span>' : '') + '</p></div>' : '';
                const quotes = testimonialsByCourse[cName] ?
                    '<div style="margin-top:14px"><p style="margin:0 0 8px;font-family:var(--mono);font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--accent)">Testimonials</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px">' + testimonialsByCourse[cName].map(quoteCard).join('') + '</div></div>' : '';
                const charts = (courseChartMap[cName] || courseRatingMap[cName])
                    ? '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;margin:0 0 18px">'
                    + (courseChartMap[cName] ? '<div style="height:230px;position:relative"><canvas id="' + courseChartMap[cName] + '"></canvas></div>' : '')
                    + (courseRatingMap[cName] ? '<div style="height:230px;position:relative;padding-top:6px"><canvas id="' + courseRatingMap[cName] + '"></canvas></div>' : '')
                    + '</div>' : '';
                return '<div class="chart-card" id="course_' + idx + '" style="margin-bottom:24px;padding:28px 30px">'
                    + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:10px">'
                    + '<h3 style="margin:0;flex:1;min-width:0;font-size:23px;font-weight:700;color:#eef4f9;line-height:1.3"><span style="color:#6d8ba3;font-family:var(--mono);font-size:15px;font-weight:400;margin-right:10px">' + (idx + 1) + '</span>' + courseLink(course, esc(cName) + (course.CourseId ? ' <span style="font-size:13px;color:#6d8ba3">&#8599;</span>' : '')) + '</h3>'
                    + '<span style="flex-shrink:0;display:flex;gap:8px;align-items:center"><button class="dlb" onclick="dlCourseKpis(' + idx + ')">&#8595; Results card</button>'
                    + (courseChartMap[cName] ? '<button class="dlb" onclick="dlChart(&quot;' + courseChartMap[cName] + '&quot;,DLT[&quot;' + courseChartMap[cName] + '&quot;])">&#8595; Chart</button>' : '')
                    + '<a href="#" onclick="goSummary(event)" style="font-family:var(--mono);font-size:10px;letter-spacing:.06em;color:#6d8ba3;text-decoration:none;border:1px solid var(--border);border-radius:5px;padding:5px 10px;white-space:nowrap">&uarr; All courses</a></span>'
                    + '</div>'
                    + '<p style="margin:0 0 16px;font-size:14px;letter-spacing:.02em;color:#9fb3c8">'
                    + '<strong style="color:#4389C8;font-size:17px">' + fmt(course.Learners) + '</strong> learners &nbsp;&middot;&nbsp; <strong style="color:var(--accent);font-size:17px">' + fmt(course.Certificates) + '</strong> certificates'
                    + (Number(course.Rating) > 0 ? ' &nbsp;&middot;&nbsp; <strong style="color:#E28743;font-size:17px">' + Number(course.Rating).toFixed(2) + '</strong> avg rating' : '')
                    + (Number(course.Responses) > 0 ? ' &nbsp;&middot;&nbsp; <strong style="color:#eef4f9;font-size:17px">' + fmt(course.Responses) + '</strong> responses' : '') + '</p>'
                    + (function () { const bits = mkMilestones(D.courseTimelines[cName] || {}); return bits.length ? '<p style="margin:0 0 16px;font-size:11.5px;color:#9fb3c8">&#127942; This course ' + bits.join(' and ') + '</p>' : ''; })()
                    + ((D.courseAwardMap && D.courseAwardMap[cName]) ? '<p style="margin:0 0 16px;display:flex;flex-wrap:wrap;gap:8px">' + D.courseAwardMap[cName].slice().sort((a,b)=>a.rank-b.rank).map(a => '<span style="display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:10px;font-weight:600;color:var(--accent);background:transparent;border:1px solid var(--accent);border-radius:999px;padding:4px 11px">' + (a.rank===1?"\u{1F947}":a.rank===2?"\u{1F948}":"\u{1F949}") + ' ' + esc(a.label) + ' Course</span>').join('') + '</p>' : '')
                    + ((D.fbSummaries && D.fbSummaries[cName] && D.fbSummaries[cName].s) ? '<p style="margin:4px 0 20px;font-size:13.5px;color:#b6c4d2;font-style:italic;line-height:1.75;border-left:2px solid #FFC14538;padding:2px 0 2px 14px;max-width:950px">' + esc(D.fbSummaries[cName].s) + '</p>' : '')
                    + periodLine
                    + charts
                    + countryTable + quotes + '</div>';
            }).join('');
            // Course-name → detail-anchor + period-chip maps for the runtime
            const courseAnchor = {}; const coursePeriodChip = {};
            D.coursesSorted.forEach((c, idx) => { courseAnchor[c.Course] = 'course_' + idx; coursePeriodChip[c.Course] = 'cpl_' + idx; });

            const dlTitles = {}; const courseShare = [];
            D.coursesSorted.forEach((c, idx) => {
                if (courseChartMap[c.Course]) dlTitles[courseChartMap[c.Course]] = c.Course + ' — Growth';
                if (courseRatingMap[c.Course]) dlTitles[courseRatingMap[c.Course]] = c.Course + ' — Ratings';
                courseShare.push({ n: c.Course, k: [
                    { l: 'Enrolled Learners', v: fmt(c.Learners), c: '#4389C8' },
                    { l: 'Certificates', v: fmt(c.Certificates), c: '#FFC145' },
                    { l: 'Avg Rating', v: Number(c.Rating) > 0 ? Number(c.Rating).toFixed(2) + ' / 5' : '-', c: '#E28743' },
                    { l: 'Responses', v: fmt(c.Responses), c: '#5AA9E6' }
                ] });
            });

            // Headline figures for the downloadable, share-ready results card
            const kpiShare = [
                { l: 'Courses', v: fmt(D.pSnap.length), c: '#A78BFA' },
                { l: 'Enrolled Learners', v: fmt(D.totalLrn), c: '#4389C8' },
                { l: 'Courses Completed', v: fmt(D.totalCert), c: '#FFC145' },
                { l: 'Certification Rate', v: (D.certRate != null ? D.certRate + '%' : '-'), c: '#3FB984' },
                { l: 'Countries/Territories', v: String(Object.keys(D.providerCountryData).length || '-'), c: '#5AA9E6' },
                { l: 'Avg Rating', v: D.avgRating === 'N/A' ? '-' : D.avgRating + ' / 5', c: '#E28743' }
            ];

            // Partnership milestones — provider-level
            const provBits = mkMilestones(D.provTimeline);
            const milestone = provBits.length ? ('Milestones: ' + providerName + ' ' + provBits.join(' and ')) : '';

            const provTop10 = Object.entries(D.providerCountryData).sort((a, b) => b[1] - a[1]).slice(0, 10);
            const totalCountryUsers = Object.values(D.providerCountryData).reduce((a, b) => a + b, 0);

            const _si = D.surveyImpact || {};
            const _siCard = (heading, val, desc) => '<div><p style="margin:0 0 8px;font-family:var(--mono);font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#9fb3c8">' + heading + '</p><span style="font-family:var(--serif);font-size:32px;font-weight:700;color:var(--accent);line-height:1">' + val + '</span><p style="margin:6px 0 0;font-size:12px;color:#9fb3c8;line-height:1.5;text-wrap:balance">' + desc + '</p></div>';
            const impactBand = (D.surveyImpact || D.totalMin > 0) ? (
                '<div style="margin:0 0 28px">'
                + '<p style="margin:0 0 14px;font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);display:flex;align-items:center;justify-content:space-between">Learning Impact <button class="dlb" onclick="dlImpact()">&#8595; PNG</button></p>'
                + '<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:stretch">'
                + (D.totalMin > 0 ? '<div style="flex:1 1 220px;min-width:200px;border:1px solid #FFC14538;border-radius:5px;padding:20px 24px;background:linear-gradient(135deg,#FFC14512,#001a2b 70%);display:flex;flex-direction:column;justify-content:center">'
                    + '<p style="margin:0 0 8px;font-family:var(--mono);font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#9fb3c8">Learning Time</p>'
                    + '<span style="font-family:var(--serif);font-size:40px;font-weight:700;color:var(--accent);line-height:1">' + this.formatLearningTime(D.totalMin) + '</span>'
                    + '<p style="margin:8px 0 0;font-size:12.5px;color:#9fb3c8;line-height:1.5;text-wrap:balance;max-width:32ch">of <strong style="color:#eef4f9">study time</strong> recorded across all learners, all time</p>'
                    + '</div>' : '')
                + ((_si.contentNew || _si.willApply || _si.careerValue) ? '<div style="flex:2 1 380px;min-width:280px;border:1px solid #FFC14538;border-radius:5px;padding:20px 24px;background:linear-gradient(135deg,#FFC14512,#001a2b 70%)">'
                    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:18px 22px">'
                    + (_si.contentNew ? _siCard('New Knowledge', _si.contentNew.pct + '%', 'of surveyed learners said the course content was <strong style="color:#eef4f9">new to them</strong>') : '')
                    + (_si.willApply ? _siCard('Intent to Apply', _si.willApply.pct + '%', 'say they are <strong style="color:#eef4f9">likely to apply</strong> what they learned in their work') : '')
                    + (_si.careerValue ? _siCard('Career Value', _si.careerValue.pct + '%', 'rate what they learned as <strong style="color:#eef4f9">important to their job success</strong>') : '')
                    + '</div>'
                    + (function () { const ns = []; if (_si.contentNew) ns.push(_si.contentNew.n); if (_si.willApply) ns.push(_si.willApply.n); if (_si.careerValue) ns.push(_si.careerValue.n); if (!ns.length) return ''; const bn = Math.min.apply(null, ns); const rounded = bn >= 1000 ? Math.floor(bn / 1000) * 1000 : Math.floor(bn / 100) * 100; return '<p style="margin:14px 0 0;font-family:var(--mono);font-size:9px;letter-spacing:.06em;color:#6d8ba3">Survey figures based on ' + fmt(rounded) + '+ surveys &middot; share answering 4 or 5 on a 1–5 scale</p>'; })()
                    + '</div>' : '')
                + '</div>'
                + '</div>') : '';

            // Interactive: month pickers recompute the period stats client-side
            // from the serialized monthly data (see periodChanged in the runtime).
            const periodBand =
                secEyebrow('Reporting Period')
                + '<div class="chart-card" style="margin-bottom:28px">'
                + '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:16px">'
                + '<span style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#9fb3c8">From</span>'
                + '<input type="month" id="p-from" value="' + esc(D.pFrom) + '" onchange="periodChanged()" class="pm-in">'
                + '<span style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#9fb3c8">To</span>'
                + '<input type="month" id="p-to" value="' + esc(D.pTo) + '" onchange="periodChanged()" class="pm-in">'
                + '<button onclick="clearPeriod()" style="background:transparent;border:1px solid var(--border);border-radius:5px;color:#9fb3c8;font-family:var(--mono);font-size:10px;letter-spacing:.05em;padding:6px 12px;cursor:pointer">Clear</button>'
                + '<span id="p-note" style="font-family:var(--mono);font-size:9px;color:#6d8ba3;margin-left:auto"></span>'
                + '</div>'
                + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px">'
                + card('New Enrolments', 'In period', '&ndash;', '#4389C8', { noBar: true, valueId: 'pv-enrol' })
                + card('New Certificates', 'In period', '&ndash;', '#FFC145', { noBar: true, valueId: 'pv-cert' })
                + card('Survey Responses', 'In period', '&ndash;', '#5AA9E6', { noBar: true, valueId: 'pv-resp' })
                + card('Avg Rating', 'In period', '&ndash;', '#E28743', { noBar: true, valueId: 'pv-rating' })
                + '</div></div>';

            const surveyTable = D.surveyQRows.length ? (
                secEyebrow('Survey Insights')
                + '<div class="chart-card" style="margin-bottom:28px"><table style="width:100%;border-collapse:collapse;font-size:12.5px">'
                + tHead([{ t: 'Question' }, { t: 'Responses', r: 1 }, { t: 'Avg (1–5)', r: 1 }, { t: '% rating 4–5', r: 1 }])
                + '<tbody>' + D.surveyQRows.map(r => '<tr>' + tdL((r.title ? '<strong style="color:var(--accent)">' + esc(r.title) + ':</strong> ' : '') + '<span style="color:#9fb3c8">' + esc(r.q) + '</span>') + tdR(fmt(r.n)) + tdR(r.avg.toFixed(2)) + tdR('<strong style="color:var(--accent)">' + Math.round(r.hiPct) + '%</strong>') + '</tr>').join('') + '</tbody></table>'
                + '<p style="margin:8px 0 0;font-family:var(--mono);font-size:9px;color:#6d8ba3">End-of-course survey, all responses to date, aggregated across this provider’s courses. “N/A” answers are excluded.</p></div>') : '';

            const suggestionsBlock = ''; // Learner Suggestions removed from the dark export per request
            const criticalBlock = D.critical.length ? (secEyebrow('Areas for Improvement') + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;margin-bottom:28px">' + D.critical.map(quoteCard).join('') + '</div>') : '';

            // Platform-only: a Top Providers table (the platform's defining extra dimension).
            const topProvidersBlock = (platform && D.topProviders && D.topProviders.length) ? (
                secEyebrow('Top Providers')
                + '<div class="chart-card" style="margin-bottom:8px;padding:0;overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12.5px">'
                + '<thead><tr style="color:#6d8ba3;font-family:var(--mono);font-size:9px;letter-spacing:.08em;text-transform:uppercase">'
                + '<th style="padding:11px 16px;text-align:left">Provider</th><th style="padding:11px 16px;text-align:right">Courses</th><th style="padding:11px 16px;text-align:right">Enrolled learners</th><th style="padding:11px 16px;text-align:right">Certificates</th><th style="padding:11px 16px;text-align:right">Cert. rate</th><th style="padding:11px 16px;text-align:right">Avg rating</th></tr></thead><tbody>'
                + D.topProviders.map(p => '<tr style="border-top:1px solid var(--border)">'
                    + '<td style="padding:10px 16px;color:#eef4f9;font-weight:600">' + esc(p.name) + '</td>'
                    + '<td style="padding:10px 16px;text-align:right;color:#9fb3c8">' + fmt(p.courses) + '</td>'
                    + '<td style="padding:10px 16px;text-align:right;color:#d4dde7;font-weight:600">' + fmt(p.lrn) + '</td>'
                    + '<td style="padding:10px 16px;text-align:right;color:#9fb3c8">' + fmt(p.cert) + '</td>'
                    + '<td style="padding:10px 16px;text-align:right;color:#9fb3c8">' + (p.certRate != null ? p.certRate.toFixed(1) + '%' : '-') + '</td>'
                    + '<td style="padding:10px 16px;text-align:right;color:#9fb3c8">' + (p.avg != null ? p.avg.toFixed(2) : '-') + '</td></tr>').join('')
                + '</tbody></table></div>'
                + '<p style="margin:0 0 28px;font-size:10.5px;color:#6d8ba3">' + fmt(D.providerCount) + ' content partners contributing courses to SURGhub, ranked by enrolled learners.</p>'
            ) : '';

            // Platform-only closing (replaces the provider-partner "What's Next" CTA).
            const platformClosingBlock = `<div style="margin:18px 0 28px;border:1px solid #FFC14559;border-left:4px solid var(--accent);border-radius:8px;padding:24px 28px 22px;background:linear-gradient(135deg,#FFC14522,#001a2b 82%)">
    <p style="margin:0 0 5px;font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--accent)">What&rsquo;s Next</p>
    <h3 style="margin:0 0 7px;font-size:21px;font-weight:700;color:#eef4f9;line-height:1.2">${D.totalLrn > 0 ? 'Together we&rsquo;ve reached <span style="color:var(--accent)">' + fmt(D.totalLrn) + ' learners</span> &mdash; and counting' : 'Growing surgical education, together'}</h3>
    <p style="margin:0 0 18px;font-size:13px;color:#9fb3c8;line-height:1.6;max-width:820px">SURGhub is a free, open platform built with <strong style="color:#eef4f9">${fmt(D.providerCount)} content partners</strong>${D.providerCountryData ? ' reaching learners in <strong style="color:#eef4f9">' + fmt(Object.keys(D.providerCountryData).length) + ' countries</strong>' : ''}. Every course here is an organisation choosing to share its expertise openly &mdash; thank you to every partner, ambassador and learner who makes it possible.</p>
    <ul style="margin:0 0 18px;padding:0;list-style:none;display:grid;gap:9px">
      <li style="display:flex;gap:10px;font-size:12.5px;color:#9fb3c8;line-height:1.55"><span style="color:var(--accent);flex-shrink:0;font-weight:700">&#9656;</span><span><strong style="color:#d4dde7">Onboard new partners.</strong> Any organisation with surgical, anaesthesia or perioperative expertise can publish here &mdash; widening the catalogue and the reach.</span></li>
      <li style="display:flex;gap:10px;font-size:12.5px;color:#9fb3c8;line-height:1.55"><span style="color:var(--accent);flex-shrink:0;font-weight:700">&#9656;</span><span><strong style="color:#d4dde7">Deepen reach where the need is greatest.</strong> Outreach with partners and ambassadors in low- and lower-middle-income countries closes the surgical-training gap fastest.</span></li>
      <li style="display:flex;gap:10px;font-size:12.5px;color:#9fb3c8;line-height:1.55"><span style="color:var(--accent);flex-shrink:0;font-weight:700">&#9656;</span><span><strong style="color:#d4dde7">Share these results.</strong> Every chart and table in this report downloads as a branded image &mdash; ready for partners, funders and boards.</span></li>
    </ul>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;border-top:1px solid #FFC14524;padding-top:16px">
      <p style="margin:0;font-size:12.5px;color:#d4dde7;line-height:1.5">A joint initiative of the Global Surgery Foundation and UNITAR. &nbsp;<a href="https://www.surghub.org" target="_blank" rel="noopener" style="font-family:var(--mono);font-size:11px;letter-spacing:.04em;color:var(--accent);text-decoration:none;white-space:nowrap">Visit surghub.org &#8599;</a></p>
      ${shLogoColor ? '<div style="display:flex;align-items:center;background:#fff;border-radius:8px;padding:10px 14px;flex-shrink:0"><img src="' + shLogoColor + '" alt="SURGhub" style="height:42px;width:auto;max-width:130px;object-fit:contain;display:block"></div>' : (shLogo ? '<img src="' + shLogo + '" alt="SURGhub" style="height:46px;width:auto;filter:brightness(0) invert(1);flex-shrink:0">' : '')}
    </div>
  </div>`;

            return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(providerName)} — SURGhub ${platform ? 'Platform' : 'Provider'} Report</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"><\/script>
<script src="https://www.gstatic.com/charts/loader.js"><\/script>
<style>
:root{--bg:#001523;--surface:#002033;--surface2:#002a42;--border:#0a3a57;--ink:#eef4f9;--muted:#6d8ba3;--accent:#FFC145;--accent-soft:rgba(255,193,69,0.14);--serif:Georgia,'Times New Roman',serif;--mono:Arial,Helvetica,sans-serif;--sans:Arial,Helvetica,sans-serif;}
*{box-sizing:border-box;}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-weight:400;line-height:1.6;background-image:radial-gradient(1100px 620px at 82% -8%, rgba(255,193,69,0.06), transparent 60%),radial-gradient(900px 560px at 8% 4%, rgba(4,104,177,0.10), transparent 60%);background-attachment:fixed;}
h1,h2,h3{font-family:var(--serif);}
.sec-eyebrow{font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--accent);display:flex;align-items:center;gap:12px;margin:0 0 14px;}
.sec-eyebrow::after{content:'';height:1px;flex:1;max-width:120px;background:var(--accent);opacity:0.35;}
.chart-card{background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:22px;box-shadow:0 1px 3px rgba(0,0,0,0.35);}
.kcard{transition:transform .18s, box-shadow .18s, border-color .18s;}
.kcard:hover{transform:translateY(-2px);box-shadow:0 14px 34px rgba(0,0,0,0.5);}
.kcard-click{cursor:pointer;}
.kcard-hint{margin:10px 0 0;font-family:var(--mono);font-size:8px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);opacity:0;transition:opacity .15s;}
.kcard:hover .kcard-hint{opacity:.75;}
.kgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:28px;}
@media (max-width:760px){.kgrid{grid-template-columns:repeat(2,1fr);}}
.pm-in{background:var(--surface2);border:1px solid var(--border);border-radius:5px;color:var(--ink);font-family:var(--mono);font-size:11px;padding:6px 8px;color-scheme:dark;}
.nav-btn{display:inline-flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--border);cursor:pointer;border-radius:6px;padding:8px 16px;font-family:var(--mono);font-size:12px;letter-spacing:0.04em;color:var(--ink);font-weight:500;transition:all .15s;}
.nav-btn:hover{background:var(--surface2);border-color:var(--accent);}
.cs-row{cursor:pointer;}
.cs-row:hover td{background:rgba(255,255,255,.04);}
th.sortable{cursor:pointer;user-select:none;}
th.sortable:hover{color:var(--accent)!important;}
.dlb{background:transparent;border:1px solid var(--border);border-radius:4px;color:#6d8ba3;font-family:var(--mono);font-size:9px;letter-spacing:.05em;padding:3px 8px;cursor:pointer;transition:all .15s;}
.dlb:hover{color:var(--accent);border-color:var(--accent);}
a.shl{color:inherit;text-decoration:none;border-bottom:1px solid transparent;transition:color .15s,border-color .15s;}
a.shl:hover{color:var(--accent);border-bottom-color:var(--accent);}
.kpi-modal{display:none;position:fixed;inset:0;background:rgba(0,8,16,0.74);z-index:2000;align-items:center;justify-content:center;padding:24px;}
.kpi-modal-box{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:8px;max-width:440px;width:100%;padding:28px 30px;box-shadow:0 24px 64px rgba(0,0,0,.6);}
@media print{body{background:#001523!important;-webkit-print-color-adjust:exact;}}
</style>
</head><body>
<div style="max-width:1100px;margin:0 auto;padding:28px 24px">

  <div style="display:flex;align-items:center;justify-content:flex-end;margin-bottom:14px">
    <button class="nav-btn" id="meth-btn" onclick="togglePage()">Methodology &rarr;</button>
  </div>

<div id="page-main">
  <div style="border:1px solid var(--border);border-radius:5px;padding:22px 24px;margin-bottom:24px;background:linear-gradient(135deg,#4389C80D,#002033 62%)">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:34px;flex-wrap:wrap">
    <div style="min-width:0;flex:1">
      <p style="margin:0 0 5px;font-family:var(--mono);font-size:9px;font-weight:500;letter-spacing:.22em;text-transform:uppercase;color:var(--accent)">United Nations Global Surgery Learning Hub</p>
      <h1 style="margin:0;font-size:30px;font-weight:700;color:#eef4f9;line-height:1.12;letter-spacing:-0.01em">${D.providerUrl ? '<a class="shl" href="' + esc(D.providerUrl) + '" target="_blank" rel="noopener">' + esc(providerName) + ' <span style="font-size:15px;color:#6d8ba3">&#8599;</span></a>' : esc(providerName)}</h1>
      <p style="margin:12px 0 0;font-family:var(--mono);font-size:10.5px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:#6d8ba3;display:inline-flex;align-items:center;gap:7px"><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:#4389C8"></span>${platform ? 'Platform' : 'Provider'} Performance Report &middot; ${esc(D.reportDate)}<span id="hdr-period"></span></p>
      <p style="margin:14px 0 0;font-size:13px;color:#9fb3c8;line-height:1.6;font-weight:300">${platform
        ? 'SURGhub hosts <strong style="color:#eef4f9">' + fmt(D.pSnap.length) + ' course' + (D.pSnap.length !== 1 ? 's' : '') + '</strong> from <strong style="color:#eef4f9">' + fmt(D.providerCount) + ' content partners</strong>, reaching <strong style="color:#eef4f9">' + fmt(D.totalLrn) + ' enrolled learners</strong>' + (D.certRate != null ? ' at a <strong style="color:#eef4f9">' + D.certRate + '% certification rate</strong>' : '') + '.' + (D.totalResp > 0 ? ' Across ' + fmt(D.totalResp) + ' survey responses, the average rating is <strong style="color:#eef4f9">' + D.avgRating + ' / 5</strong>.' : '')
        : esc(providerName) + ' has <strong style="color:#eef4f9">' + D.pSnap.length + ' course' + (D.pSnap.length !== 1 ? 's' : '') + '</strong> live on SURGhub, reaching <strong style="color:#eef4f9">' + fmt(D.totalLrn) + ' learners</strong>' + (D.certRate != null ? ' with a <strong style="color:#eef4f9">' + D.certRate + '% certification rate</strong>' : '') + '.' + (D.totalResp > 0 ? ' Across ' + fmt(D.totalResp) + ' survey responses, the average rating is <strong style="color:#eef4f9">' + D.avgRating + ' / 5</strong>.' : '')}</p>
      <p style="margin:12px 0 0;font-size:12.5px;color:var(--accent);line-height:1.6">${platform ? 'Open surgical education for every member of the surgical team, everywhere.' : 'Thank you for training the world seamlessly with SURGhub.'}</p>
    </div>
    <div style="flex-shrink:0">
      ${(provLogo || shLogoColor)
        ? '<div style="display:flex;align-items:center;gap:18px;background:#fff;border-radius:10px;padding:12px 18px">'
            + (provLogo ? ((D.providerUrl ? '<a href="' + esc(D.providerUrl) + '" target="_blank" rel="noopener" title="View ' + esc(providerName) + ' on SURGhub">' : '')
                + '<img src="' + provLogo + '" alt="' + esc(providerName) + '" style="height:64px;width:auto;max-width:180px;object-fit:contain;display:block">'
                + (D.providerUrl ? '</a>' : '')) : '')
            + (provLogo && shLogoColor ? '<div style="width:1px;height:54px;background:#d6dde3;flex-shrink:0"></div>' : '')
            + (shLogoColor ? '<a href="https://www.surghub.org" target="_blank" rel="noopener" title="surghub.org"><img src="' + shLogoColor + '" alt="SURGhub" style="height:64px;width:auto;max-width:180px;object-fit:contain;display:block"></a>' : '')
            + '</div>'
        : (shLogo ? '<img src="' + shLogo + '" alt="SURGhub" style="height:84px;width:auto;filter:brightness(0) invert(1)">' : '')}
    </div>
    </div>
    <p style="margin:18px 0 0;font-family:var(--mono);font-size:9px;letter-spacing:.05em;color:#3f5468">This report was prepared with SURGdash &middot; &copy; Global Surgery Foundation.</p>
  </div>

  <div class="kgrid">
    ${card('Courses', 'Live on platform', fmt(D.pSnap.length), '#A78BFA', { info: 'The number of this provider’s courses published on SURGhub and included in this report.' })}
    ${card('Enrolled Learners', 'Across all courses', fmt(D.totalLrn), '#4389C8', { info: 'Total course learners across the provider’s courses, all time. A learner taking three courses counts three times.' })}
    ${card('Courses Completed', 'Certificates awarded', fmt(D.totalCert), '#FFC145', { info: 'Certificates awarded across the provider’s courses — each one represents a learner finishing a course.' })}
    ${card('Certification Rate', 'Certificates ÷ learners', (D.certRate != null ? D.certRate + '%' : '&ndash;'), '#3FB984', { info: 'Share of learners who earned a certificate — certificates divided by total learners, across the provider’s courses, all time. Learning time is shown in the Learning Impact section below.' })}
    ${card('Countries/Territories', 'Reached', Object.keys(D.providerCountryData).length || '&ndash;', '#5AA9E6', { info: 'Distinct countries and territories of learners enrolled in the provider’s courses, where the learner’s country is known.' })}
    ${card('Avg Rating', fmt(D.totalResp) + ' responses', D.avgRating === 'N/A' ? '&ndash;' : D.avgRating + ' / 5', '#E28743', { info: 'Average overall-satisfaction rating from end-of-course surveys, on a 1–5 scale. Reflects survey respondents only.' })}
  </div>
  <div style="display:flex;justify-content:flex-end;margin:-18px 0 24px"><button class="dlb" onclick="dlKpis()">&#8595; Download results card (PNG)</button></div>

  ${impactBand}

  ${(function(){
      const pa = (D.providerAwards || []).slice().sort((a,b)=>a.rank-b.rank);
      const pc = (D.providerCountryAwards || []).filter(c=>c.rank===1);
      const ca = D.courseAwardMap || {};
      const ce = Object.entries(ca);
      if (!pa.length && !pc.length && !ce.length && !provBits.length) return '';
      const medal = r => r===1?'\u{1F947}':r===2?'\u{1F948}':r===3?'\u{1F949}':'';
      // Neutral phrase per award key \u2014 reused for both provider and course popups.
      const PHRASE = {
          courses: 'the most published courses',
          enrol: 'the most learners',
          certs: 'the most certificates awarded',
          completion: 'the highest certificate-to-learner rate (min 100 learners for providers, 50 for courses)',
          mins: 'the most learning time generated',
          rating: 'the highest average end-of-course survey rating (min 150 responses for providers, 50 for courses)',
          q90: 'the most certificates awarded in the last 90 days (min 5)',
          reach: 'learners across the widest range of countries and territories (min 100 learners for providers, 50 for courses)',
          mission: 'the most learners in low- and lower-middle-income countries',
          impact: 'the highest learner intent to apply what they learned (min 150 survey responses for providers, 50 for courses)'
      };
      const buildInfo = (kind, name, key, rank, valueFmt) => {
          const ph = PHRASE[key] || 'outstanding reach and impact on SURGhub';
          const scope = kind === 'course' ? 'courses' : 'providers';
          // '|||' separates the definition from the ranking sentence — kpiInfo()
          // renders the ranking on its own line, emphasised.
          return 'Recognises the ' + kind + ' with ' + ph + '.|||' + name + ' ranks ' + (rank === 1 ? '#1' : '#' + rank) + ' across all SURGhub ' + scope + ' (' + valueFmt + '), as of ' + D.awardsAsOf + '.';
      };
      // Unified award card: medal + a PROVIDER/COURSE tag + award label, with an
      // optional smaller subtitle (the course name). Provider and course awards
      // live in one combined grid. Clickable -> kpiInfo popup carries the figure.
      const awardCard = (label, rank, tag, subtitle, info) =>
          '<div onclick="kpiInfo(this)" data-t="' + esc(label) + '" data-i="' + esc(info) + '" style="cursor:pointer;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:14px 18px;min-width:0;height:100%;display:flex;align-items:center;gap:14px;transition:border-color .15s;box-sizing:border-box" onmouseover="this.style.borderColor=&quot;var(--accent)&quot;" onmouseout="this.style.borderColor=&quot;var(--border)&quot;">'
            + '<span style="font-size:30px;line-height:1;flex-shrink:0">' + medal(rank) + '</span>'
            + '<span style="min-width:0">'
            + '<span style="display:inline-block;font-family:var(--mono);font-size:8.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:' + (tag === 'Course' ? '#5AA9E6' : '#FFC145') + '">' + tag + '</span>'
            + '<span style="display:block;font-size:14px;color:#eef4f9;font-weight:600;line-height:1.25;margin-top:2px">' + esc(label) + '</span>'
            + (subtitle ? '<span style="display:block;font-size:11.5px;color:#9fb3c8;margin-top:2px;line-height:1.3">' + esc(subtitle) + '</span>' : '')
            + '</span></div>';
      const allCards = [];
      pa.forEach(a => allCards.push(awardCard(a.label, a.rank, 'Provider', null, buildInfo('provider', providerName, a.key, a.rank, a.valueFmt))));
      ce.forEach(([cName, arr]) => { arr.slice().sort((a,b)=>a.rank-b.rank).forEach(a => { allCards.push(awardCard(a.label, a.rank, 'Course', cName, buildInfo('course', cName, a.key, a.rank, a.valueFmt))); }); });
      // Equal-size cards in a grid that fills the full width. Column count is chosen
      // to keep the last row as full as possible (no lone trailing card).
      const acols = allCards.length <= 4 ? Math.max(allCards.length, 1) : [4, 3, 2].reduce((b, c) => ((allCards.length % c) || c) > ((allCards.length % b) || b) ? c : b, 4);
      const cards = allCards.length ? ('<div style="display:grid;grid-template-columns:repeat(' + acols + ',minmax(0,1fr));grid-auto-rows:1fr;gap:12px;margin-bottom:24px">' + allCards.join('') + '</div>') : '';
      let mile = '';
      if (provBits.length) {
          mile = '<p style="margin:0 0 6px;font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)">Milestones</p>'
            + '<p style="margin:0 0 24px;font-size:12.5px;color:#d4dde7;line-height:1.65">&#127942; ' + esc(providerName) + ' ' + provBits.join(' and ') + '.</p>';
      }
      let geo = '';
      if (pc.length) {
          geo = '<p style="margin:0 0 6px;font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)">Geographic leadership</p>'
            + '<p style="margin:0 0 24px;font-size:12.5px;color:#d4dde7;line-height:1.65">&#127757; Most learners of any provider in ' + pc.slice(0,16).map(c=>esc(c.country)).join(', ') + (pc.length>16?', and '+(pc.length-16)+' more':'') + '.</p>';
      }
      return '<div class="chart-card" style="margin-bottom:28px">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px"><p class="sec-eyebrow" style="margin:0">Awards &amp; Recognition</p><button class="dlb" onclick="dlAwards()">&#8595; PNG</button></div>'
        + '<p style="margin:0 0 18px;font-size:12.5px;color:#9fb3c8;line-height:1.6">Where ' + esc(providerName) + ' and its courses stand across SURGhub, as of <strong style="color:#d4dde7">' + esc(D.awardsAsOf) + '</strong>. See the methodology for eligibility.</p>'
        + cards + mile + geo
        + '</div>';
  })()}

  ${(D.fbSummaries && D.fbSummaries['@provider:' + providerName] && D.fbSummaries['@provider:' + providerName].s) ? (secEyebrow('What Learners Are Saying') + '<div class="chart-card" style="margin-bottom:28px"><p style="margin:0;font-size:14px;color:#d4dde7;line-height:1.7;max-width:900px">' + esc(D.fbSummaries['@provider:' + providerName].s) + '</p>' + ((D.fbSummaries['@provider:' + providerName].t || []).length ? '<p style="margin:12px 0 0;font-family:var(--mono);font-size:10px;letter-spacing:.05em;color:var(--accent)">' + D.fbSummaries['@provider:' + providerName].t.map(esc).join(' · ') + '</p>' : '') + '<p style="margin:10px 0 0;font-family:var(--mono);font-size:9px;color:#6d8ba3">AI summary of end-of-course survey feedback</p></div>') : ''}

  ${periodBand}

  ${secEyebrow('Growth')}
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-bottom:14px">
    <div class="chart-card"><p style="margin:0 0 12px;font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#4389C8;display:flex;align-items:center;justify-content:space-between">Enrolled Learners <button class="dlb" onclick="dlChart('growth-enrol','Enrolled Learners')">&#8595; PNG</button></p><div style="height:230px;position:relative"><canvas id="growth-enrol"></canvas></div></div>
    <div class="chart-card"><p style="margin:0 0 12px;font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);display:flex;align-items:center;justify-content:space-between">Courses Completed <button class="dlb" onclick="dlChart('growth-cert','Courses Completed')">&#8595; PNG</button></p><div style="height:230px;position:relative"><canvas id="growth-cert"></canvas></div></div>
  </div>
  <div class="chart-card" style="margin-bottom:28px"><p style="margin:0 0 12px;font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#9fb3c8;display:flex;align-items:center;justify-content:space-between">Survey Responses &amp; Average Rating <button class="dlb" onclick="dlChart('feedback-chart','Survey Responses and Average Rating')">&#8595; PNG</button></p><div style="height:240px;position:relative"><canvas id="feedback-chart"></canvas></div></div>

  ${Object.keys(D.providerCountryData).length ? (
        secEyebrow('Learners Worldwide')
        + '<div class="chart-card" style="margin-bottom:14px;background:radial-gradient(900px 420px at 50% 0%, rgba(4,104,177,0.12), transparent 65%),var(--surface)">'
        + '<div style="text-align:right"><button class="dlb" onclick="dlMap()">&#8595; PNG</button></div><div id="geo-map" style="width:100%;height:420px;opacity:0.92"></div>'
        + '<div style="display:flex;align-items:center;gap:10px;margin-top:10px"><span style="font-family:var(--mono);font-size:9px;color:#6d8ba3">0%</span><div style="flex:1;max-width:220px;height:8px;border-radius:99px;background:linear-gradient(90deg,#123a5c,#1a5485,#2474b3,#3f97d6,#74bce9,#bce3fb)"></div><span id="geo-max" style="font-family:var(--mono);font-size:9px;color:#6d8ba3"></span><span style="font-family:var(--mono);font-size:9px;color:#6d8ba3;margin-left:8px">Share of total learners</span></div>'
        + '</div>'
        + '<div class="chart-card" style="margin-bottom:28px"><p style="margin:0 0 10px;font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#9fb3c8">Top 10 Countries</p>'
        + '<table style="width:100%;border-collapse:collapse;font-size:12.5px">' + tHead([{ t: 'Country' }, { t: 'Enrolled Learners', r: 1 }, { t: '%', r: 1 }]) + '<tbody>'
        + provTop10.map(([c, v]) => '<tr>' + tdL(esc(c)) + tdR(fmt(v)) + tdR(totalCountryUsers > 0 ? ((v / totalCountryUsers) * 100).toFixed(1) + '%' : '0%') + '</tr>').join('')
        + '</tbody></table><p style="margin:6px 0 0;font-family:var(--mono);font-size:9px;color:#6d8ba3">' + Object.keys(D.providerCountryData).length + ' countries/territories total &middot; ' + fmt(totalCountryUsers) + ' learners with country data</p></div>') : ''}

  ${surveyTable}

  ${topProvidersBlock}
  <div id="course-summary">${secEyebrow('Course Summary')}</div>
  <div class="chart-card" style="margin-bottom:28px">
    <p style="margin:0 0 10px;font-family:var(--mono);font-size:9px;letter-spacing:.06em;color:#6d8ba3">Click a column to sort &middot; click a course to jump to its details</p>
    <table id="cs-table" style="width:100%;border-collapse:collapse;font-size:12.5px">
      <thead><tr>${[{ t: 'Course' }, { t: 'Enrolled Learners', r: 1 }, { t: 'Certificates', r: 1 }, { t: 'Cert. rate', r: 1 }, { t: 'Rating', r: 1 }, { t: 'Responses', r: 1 }].map((c, i) =>
                '<th class="sortable" onclick="sortCS(' + i + ',' + (i === 0 ? "'s'" : "'n'") + ')" style="padding:8px 10px;text-align:' + (c.r ? 'right' : 'left') + ';font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6d8ba3;border-bottom:1px solid var(--border)">' + c.t + '<span id="cs-arr-' + i + '"></span></th>').join('')}</tr></thead>
      <tbody>${D.coursesSorted.map((d, idx) =>
                '<tr class="cs-row" onclick="goCourse(' + idx + ')">'
                + tdL('<span style="color:#6d8ba3;font-family:var(--mono);margin-right:8px">' + (idx + 1) + '</span>' + esc(d.Course) + (d.CourseId ? ' ' + courseLink(d, '<span style="font-size:11px;color:#6d8ba3" title="Open on SURGhub">&#8599;</span>') : '')).replace('<td ', '<td data-v="' + esc(d.Course).toLowerCase().replace(/"/g, '') + '" ')
                + tdR(fmt(d.Learners)).replace('<td ', '<td data-v="' + (Number(d.Learners) || 0) + '" ')
                + tdR(fmt(d.Certificates)).replace('<td ', '<td data-v="' + (Number(d.Certificates) || 0) + '" ')
                + tdR(this.formatCertRate(d.Certificates, d.Learners)).replace('<td ', '<td data-v="' + (this.formatCertRate(d.Certificates, d.Learners, { asNumber: true }) || 0) + '" ')
                + tdR(Number(d.Rating) > 0 ? Number(d.Rating).toFixed(2) : '&ndash;').replace('<td ', '<td data-v="' + (Number(d.Rating) || 0) + '" ')
                + tdR(fmt(d.Responses)).replace('<td ', '<td data-v="' + (Number(d.Responses) || 0) + '" ')
                + '</tr>').join('')}</tbody>
    </table>
  </div>

  ${D.feedbackCutoff ? '<p style="margin:0 0 18px;font-family:var(--mono);font-size:10px;color:var(--accent);background:var(--accent-soft);border:1px solid #FFC14538;border-radius:4px;padding:6px 12px;display:inline-block">Written feedback below is filtered to entries from ' + esc(this.formatDate(D.feedbackCutoff)) + ' onwards. Charts and learner data reflect all time.</p>' : ''}
  ${suggestionsBlock}
  ${criticalBlock}

  ${secEyebrow('Course Details')}
  ${courseSections}

  ${platform ? platformClosingBlock : `<div style="margin:18px 0 28px;border:1px solid #FFC14559;border-left:4px solid var(--accent);border-radius:8px;padding:24px 28px 22px;background:linear-gradient(135deg,#FFC14522,#001a2b 82%)">
    <p style="margin:0 0 5px;font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--accent)">What's Next</p>
    <h3 style="margin:0 0 7px;font-size:21px;font-weight:700;color:#eef4f9;line-height:1.2">${D.totalLrn > 0 ? 'Congratulations &mdash; together we&rsquo;ve reached <span style="color:var(--accent)">' + fmt(D.totalLrn) + ' learners</span>' : 'A few ways we can reach more learners &mdash; together'}</h3>
    <p style="margin:0 0 20px;font-size:13px;color:#9fb3c8;line-height:1.6;max-width:780px">${D.totalLrn > 0 ? 'And we can reach even more &mdash; together. ' : ''}These numbers grow fastest when we promote your course side by side. The SURGhub team will actively support every option below &mdash; just tell us which one and we'll set it up with you.</p>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px;margin-bottom:18px">
      <div style="border:1px solid #FFC14542;border-radius:7px;padding:16px 18px;background:#FFC14512">
        <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#FFD27a;line-height:1.3">&#128227;&nbsp; Promote your course in your own network &mdash; regularly</p>
        <p style="margin:0;font-size:12.5px;color:#aebccb;line-height:1.6">A short post to your members, a line in your newsletter, a mention at your next meeting or webinar &mdash; these reach exactly the clinicians this course is built for. It's the single biggest lever you hold, and most partners haven't tapped it yet. Tell us and we'll co-create the posts, graphics and copy, and run the promotion <strong style="color:#d4dde7">jointly with you</strong>.</p>
      </div>
      <div style="border:1px solid #FFC14542;border-radius:7px;padding:16px 18px;background:#FFC14512">
        <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#FFD27a;line-height:1.3">&#129309;&nbsp; Open doors to new communities, together</p>
        <p style="margin:0;font-size:12.5px;color:#aebccb;line-height:1.6">Know a society, training programme, hospital network, ministry or region that would value this training? Introduce us &mdash; and we'll <strong style="color:#d4dde7">plan and run joint outreach with you</strong> to bring them on board.</p>
      </div>
    </div>

    <p style="margin:0 0 9px;font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#6d8ba3">More ways to build on this</p>
    <ul style="margin:0 0 18px;padding:0;list-style:none;display:grid;gap:9px">
      <li style="display:flex;gap:10px;font-size:12.5px;color:#9fb3c8;line-height:1.55"><span style="color:var(--accent);flex-shrink:0;font-weight:700">&#9656;</span><span><strong style="color:#d4dde7">Publish your next course.</strong> Build on this momentum with new content &mdash; the SURGhub team supports you end to end, from outline to launch.</span></li>
      <li style="display:flex;gap:10px;font-size:12.5px;color:#9fb3c8;line-height:1.55"><span style="color:var(--accent);flex-shrink:0;font-weight:700">&#9656;</span><span><strong style="color:#d4dde7">Refresh or extend what's here.</strong> Update modules, add formats like video, interactive scenarios or assessments, or add languages to widen your reach.</span></li>
      <li style="display:flex;gap:10px;font-size:12.5px;color:#9fb3c8;line-height:1.55"><span style="color:var(--accent);flex-shrink:0;font-weight:700">&#9656;</span><span><strong style="color:#d4dde7">Share these results.</strong> Every chart and results card in this report downloads as a branded image &mdash; ready for your partners, funders, board and community.</span></li>
    </ul>

    <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;border-top:1px solid #FFC14524;padding-top:16px">
      <p style="margin:0;font-size:12.5px;color:#d4dde7;line-height:1.5">Ready to pick one? <strong style="color:#eef4f9">Reply to the SURGhub team</strong> and we'll make it happen with you. &nbsp;<a href="https://www.surghub.org" target="_blank" rel="noopener" style="font-family:var(--mono);font-size:11px;letter-spacing:.04em;color:var(--accent);text-decoration:none;white-space:nowrap">Visit surghub.org &#8599;</a></p>
      ${(provLogo || shLogoColor)
        ? '<div style="display:flex;align-items:center;gap:14px;background:#fff;border-radius:8px;padding:10px 14px;flex-shrink:0">'
            + (provLogo ? '<img src="' + provLogo + '" alt="' + esc(providerName) + '" style="height:42px;width:auto;max-width:130px;object-fit:contain;display:block">' : '')
            + (provLogo && shLogoColor ? '<div style="width:1px;height:36px;background:#d6dde3;flex-shrink:0"></div>' : '')
            + (shLogoColor ? '<img src="' + shLogoColor + '" alt="SURGhub" style="height:42px;width:auto;max-width:130px;object-fit:contain;display:block">' : '')
            + '</div>'
        : (shLogo ? '<img src="' + shLogo + '" alt="SURGhub" style="height:46px;width:auto;filter:brightness(0) invert(1);flex-shrink:0">' : '')}
    </div>
  </div>`}
</div>

<div id="page-meth" style="display:none">
  <p style="margin:0 0 5px;font-family:var(--mono);font-size:9px;font-weight:500;letter-spacing:.22em;text-transform:uppercase;color:var(--accent)">${esc(providerName)} &middot; ${platform ? 'Platform' : 'Provider'} Performance Report</p>
  <h2 style="margin:0 0 18px;font-size:26px;font-weight:700;color:#eef4f9">Methodology &amp; Notes</h2>
  <div class="chart-card" style="margin-bottom:28px;font-size:12.5px;color:#9fb3c8;line-height:1.65">
    <p style="margin:0 0 10px"><strong style="color:#d4dde7">Data sources:</strong> Learner, certificate, and survey data is sourced from the LearnWorlds platform. Demographic data (country, profession, gender) comes from the user profile survey, which was voluntary until late 2024 and is now mandatory for new registrations. Country data is supplemented with automatic browser geolocation where survey data is unavailable. Learner growth curves are based on learner signup dates clamped to each course's launch month: where a course launched after its learners first joined SURGhub, those learners are counted in the launch month, so monthly timing is approximate while totals are exact. Certificates use their actual issue dates. For courses where a per-learner progress export has been imported, exact course start dates are used instead.</p>
    <p style="margin:0 0 10px"><strong style="color:#d4dde7">Feedback analysis &amp; testimonials:</strong> Written feedback is scored with AI assistance (Anthropic's Claude) for testimonial quality and themes, and used to select the quotes shown in this report. Selected quotes may be lightly edited for spelling, capitalisation and length — wording and meaning are never altered, and comments whose meaning is unclear are excluded rather than reworded. This AI-assisted curation is experimental. The complete, unedited feedback is provided separately in the feedback file included in this reporting package.</p>
    <p style="margin:0 0 8px"><strong style="color:#d4dde7">Awards &amp; recognition:</strong> Recognition compares this provider and its courses against <strong>all active courses on SURGhub</strong> (including private ones), as a point-in-time standing refreshed each quarter. Categories:</p>
    <p style="margin:0 0 10px;line-height:2">📚 <strong style="color:#d4dde7">Most Courses</strong> &middot; 🏆 <strong style="color:#d4dde7">Most Learners</strong> &middot; 🎓 <strong style="color:#d4dde7">Most Certificates</strong> &middot; ✅ <strong style="color:#d4dde7">Highest Completion Rate</strong> &middot; ⏱️ <strong style="color:#d4dde7">Most Learning Time</strong> &middot; ⭐ <strong style="color:#d4dde7">Highest Rated</strong> &middot; 📈 <strong style="color:#d4dde7">Most Certificates This Quarter</strong> &middot; 🌐 <strong style="color:#d4dde7">Widest Reach</strong> &middot; 🤝 <strong style="color:#d4dde7">Mission Reach</strong> &middot; 💡 <strong style="color:#d4dde7">Highest Intent to Apply</strong> &middot; 🌍 <strong style="color:#d4dde7">Geographic Leadership</strong></p>
    <p style="margin:0 0 10px">Only top-three placements are shown. Eligibility: <em>Most Courses / Learners / Certificates / Learning Time / Mission Reach</em> — all providers and courses; <em>Highest Completion Rate</em> (certificates ÷ learners) and <em>Widest Reach</em> — courses with at least 50 learners, providers with at least 100; <em>Highest Rated</em> and <em>Highest Intent to Apply</em> (share of survey respondents answering 4 or 5 to "likely to apply what I learned") — courses with at least 50 survey responses, providers with at least 150; <em>Most Certificates This Quarter</em> — certificates issued in the last 90 days, minimum 5; <em>Geographic Leadership</em> — countries with at least 25 learners platform-wide, ranked by this provider's learner count there.</p>
    <p style="margin:0 0 10px"><strong style="color:#d4dde7">Limitations:</strong> Learner counts include all registered users (including inactive). Survey ratings reflect respondents only, not all enrollees. Country data from browser tracking may reflect VPN location. Demographic figures are extrapolated from the surveyed subset to the full user base, assuming survey respondents are representative.</p>
    <p style="margin:0"><strong style="color:#d4dde7">For questions or additional detail, please contact the SURGhub team.</strong></p>
  </div>
</div>

  <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:8px;text-align:center;font-family:var(--mono);font-size:10px;color:#6d8ba3;line-height:1.7">
    <p style="margin:0 0 6px;max-width:760px;margin-left:auto;margin-right:auto">SURGhub is a joint initiative of the <strong style="color:#9fb3c8">Global Surgery Foundation (GSF)</strong> and <strong style="color:#9fb3c8">UNITAR</strong>, supported by the <strong style="color:#9fb3c8">Royal College of Surgeons in Ireland (RCSI)</strong>, and implemented in association with the <strong style="color:#9fb3c8">Johnson &amp; Johnson Foundation</strong>.</p>
    <p style="margin:0">Generated by SURGdash &middot; Global Surgery Foundation &mdash; Confidential</p>
  </div>
</div>

<div class="kpi-modal" id="kpi-modal" onclick="if(event.target===this)closeKpi()">
  <div class="kpi-modal-box">
    <button onclick="closeKpi()" style="position:absolute;top:12px;right:14px;background:none;border:none;color:#6d8ba3;font-size:24px;line-height:1;cursor:pointer;padding:2px 6px">&times;</button>
    <p id="kpi-m-eyebrow" style="margin:0 0 10px;font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--accent)">What we measure</p>
    <h3 id="kpi-m-title" style="margin:0 0 14px;font-size:23px;font-weight:700;color:#eef4f9;line-height:1.2"></h3>
    <p id="kpi-m-body" style="margin:0;font-size:14px;color:#b6c4d2;line-height:1.65;font-weight:300"></p>
  </div>
</div>

<script>
var TL=${JSON.stringify(D.provTimeline)};
var RD=${JSON.stringify(D.ratingData)};
var CTL=${JSON.stringify(D.courseTimelines)};
var CRD=${JSON.stringify(D.courseRatings)};
var GEO=${D.providerCountryJson};
var CMAP=${JSON.stringify(courseChartMap)};
var RMAP=${JSON.stringify(courseRatingMap)};
var CHIPS=${JSON.stringify(coursePeriodChip)};
var QUOTES=${JSON.stringify(quotes)};
var PROV=${JSON.stringify(providerName)};
var KPIS=${JSON.stringify(kpiShare)};
var CKPIS=${JSON.stringify(courseShare)};
var DLT=${JSON.stringify(dlTitles)};
var SHLOGO=${JSON.stringify(shLogo)};
var IMPACT=${JSON.stringify(D.surveyImpact || null)};
var IMPACTLT=${JSON.stringify(D.totalMin > 0 ? this.formatLearningTime(D.totalMin) : '')};
var AWARDS=${JSON.stringify({
    provider: (D.providerAwards || []).slice().sort((a,b)=>a.rank-b.rank).map(a => ({ rank: a.rank, label: a.label, value: a.valueFmt })),
    countries: (D.providerCountryAwards || []).filter(c => c.rank === 1).map(c => c.country),
    courses: Object.entries(D.courseAwardMap || {}).map(([c, arr]) => ({ course: c, labels: arr.slice().sort((a,b)=>a.rank-b.rank).map(a => ({ rank: a.rank, label: a.label })) })),
    milestones: (provBits || []).map(b => b.replace(/<[^>]+>/g, '')),
    asOf: D.awardsAsOf || ''
})};
var SHLOGOC=${JSON.stringify(shLogoColor)};
var PLOGO=${JSON.stringify(provLogo)};
var PURL=${JSON.stringify(D.providerUrl || '')};
var GENDATE=${JSON.stringify(D.reportDate || '')};
var GRID='rgba(255,255,255,0.06)',TICK='#6d8ba3';
if(typeof Chart!=='undefined'){
  Chart.defaults.devicePixelRatio=3;
  // Reserve a strip beneath the x-axis labels so the period plugin can label the band there.
  try{Chart.defaults.layout.padding=Object.assign({},Chart.defaults.layout.padding,{bottom:20});}catch(e){}
  // Reporting-period overlay: charts always show the FULL timeline; the selected
  // period is marked with a soft band + dashed boundary lines instead of clipping
  // the axes. Each timeline chart stashes its raw YYYY-MM months on the canvas
  // (canvas.__months) so we can map period bounds to category-axis pixels.
  Chart.register({
    id:'periodBand',
    afterDatasetsDraw:function(chart){
      var ms=chart.canvas&&chart.canvas.__months; if(!ms||!ms.length) return;
      var p=curP(); if(!p.f&&!p.t) return;
      var xs=chart.scales.x, ca=chart.chartArea; if(!xs||!ca) return;
      var si=0; while(si<ms.length-1 && p.f && ms[si]<p.f) si++;
      var ei=ms.length-1; while(ei>0 && p.t && ms[ei]>p.t) ei--;
      if(si>ei) return;
      // Lines sit on the OUTER edges of the start/end bars (category-slot edges),
      // so the band brackets whole bars rather than slicing through their centres.
      var half = ms.length>1 ? Math.abs(xs.getPixelForValue(1)-xs.getPixelForValue(0))/2 : (ca.right-ca.left)/2;
      var x1=Math.max(ca.left, xs.getPixelForValue(si)-half);
      var x2=Math.min(ca.right, xs.getPixelForValue(ei)+half);
      var ctx=chart.ctx; ctx.save();
      ctx.fillStyle='rgba(255,193,69,0.07)';
      ctx.fillRect(Math.min(x1,x2),ca.top,Math.max(1,Math.abs(x2-x1)),ca.bottom-ca.top);
      ctx.setLineDash([4,3]);ctx.lineWidth=1.5;ctx.strokeStyle='rgba(255,193,69,0.65)';
      if(p.f){ctx.beginPath();ctx.moveTo(x1,ca.top);ctx.lineTo(x1,ca.bottom);ctx.stroke();}
      if(p.t){ctx.beginPath();ctx.moveTo(x2,ca.top);ctx.lineTo(x2,ca.bottom);ctx.stroke();}
      ctx.setLineDash([]);
      ctx.font='10px '+(getComputedStyle(document.body).fontFamily||'sans-serif');
      // Label sits BELOW the x-axis tick labels (in the reserved bottom strip), centred
      // under the band — readable on the dark card rather than washed out on the band.
      ctx.fillStyle='#FFC145';ctx.textBaseline='bottom';ctx.textAlign='center';
      var lcx=(Math.min(x1,x2)+Math.max(x1,x2))/2; lcx=Math.max(48,Math.min(chart.width-48,lcx));
      if(p.f||p.t) ctx.fillText('Reporting period',lcx,chart.height-4);
      ctx.restore();
    }
  });
}
function fmtN(n){return n==null?'':Math.round(n).toLocaleString('en-US');}
function fmtS(n){if(n>=1000000)return (n/1000000).toFixed(1)+'M';if(n>=1000){var k=n/1000;return (k%1?k.toFixed(1):k)+'k';}return n;}
function mLab(m){var d=new Date(m+'-02');return d.toLocaleDateString('en-US',{month:'short',year:'2-digit'});}
function ttCfg(){return {backgroundColor:'#04293f',borderColor:'#0a3a57',borderWidth:1,titleColor:'#eef4f9',bodyColor:'#cfdbe6',padding:10,displayColors:false};}
function xAx(){return {grid:{color:'transparent'},ticks:{color:TICK,font:{size:10},maxTicksLimit:8,maxRotation:0,autoSkip:true},border:{color:'rgba(255,255,255,0.12)'}};}
function yAx(cb){return {beginAtZero:true,grid:{color:GRID},ticks:{color:TICK,font:{size:10},callback:cb||function(v){return fmtS(v);}},border:{display:false}};}
// Current reporting period from the in-report picker. Charts always show the
// FULL timeline; the period is drawn as a marker band (see the periodBand
// plugin). inCurP is still used to compute period KPI totals/chips.
function curP(){var f=document.getElementById('p-from'),t=document.getElementById('p-to');return {f:(f&&f.value)||'',t:(t&&t.value)||''};}
function inCurP(m){var p=curP();return (!p.f||m>=p.f)&&(!p.t||m<=p.t);}
function cumSeries(tl,key){var ms=Object.keys(tl).sort();var cum=0,out=[];ms.forEach(function(m){cum+=(tl[m][key]||0);out.push({m:m,v:cum});});return out;}
function drawGrowth(id,label,tl,key,color){
  var el=document.getElementById(id); if(!el) return;
  var all=Object.keys(tl).sort(); if(!all.length) return;
  var cum=0,ms=[],monthly=[],cumArr=[];
  all.forEach(function(m){var v=tl[m][key]||0;cum+=v;ms.push(m);monthly.push(v);cumArr.push(cum);});
  if(!ms.length) return;
  el.__months=ms;
  new Chart(el.getContext('2d'),{data:{labels:ms.map(mLab),datasets:[
    {type:'line',label:'Cumulative',data:cumArr,borderColor:color,borderWidth:2.5,backgroundColor:color+'1f',fill:true,tension:0.32,pointRadius:0,pointHoverRadius:4,pointBackgroundColor:color,pointBorderColor:'#001523',pointBorderWidth:1.5,yAxisID:'y'},
    {type:'bar',label:'Monthly',data:monthly,backgroundColor:color+'59',borderRadius:2,yAxisID:'y1'}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:TICK,font:{size:10},boxWidth:14}},tooltip:Object.assign(ttCfg(),{callbacks:{label:function(c){return ' '+c.dataset.label+': '+fmtN(c.parsed.y);}}})},
      scales:{x:xAx(),y:yAx(),y1:{beginAtZero:true,position:'right',grid:{color:'transparent'},ticks:{color:TICK,font:{size:10},callback:function(v){return fmtS(v);}},border:{display:false}}}}});
}
function set(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
function fmtMonth(m){if(!m)return '';var d=new Date(m+'-02');return d.toLocaleDateString('en-US',{month:'short',year:'numeric'});}
function redrawAllCharts(){
  if(typeof Chart==='undefined'||!Chart.getChart) return;
  var ids=['growth-enrol','growth-cert','feedback-chart'];
  Object.keys(CMAP).forEach(function(c){ids.push(CMAP[c]);});
  Object.keys(RMAP).forEach(function(c){ids.push(RMAP[c]);});
  ids.forEach(function(id){var ch=Chart.getChart(id);if(ch)ch.destroy();});
  drawGrowth('growth-enrol','Enrolled Learners',TL,'e','#4389C8');
  drawGrowth('growth-cert','Courses completed',TL,'c','#FFC145');
  if(Object.keys(RD).length) drawRating('feedback-chart',RD);
  Object.keys(CMAP).forEach(function(c){ if(CTL[c]) drawCourse(CMAP[c],CTL[c]); });
  Object.keys(RMAP).forEach(function(c){ if(CRD[c]) drawRating(RMAP[c],CRD[c]); });
}
function periodChanged(skipCharts){
  if(!skipCharts) redrawAllCharts();
  var f=document.getElementById('p-from').value||'';
  var t=document.getElementById('p-to').value||'';
  var has=!!(f||t);
  var inP=function(m){return (!f||m>=f)&&(!t||m<=t);};
  var pe=0,pc=0,pr=0,prs=0;
  Object.keys(TL).forEach(function(m){if(inP(m)){pe+=TL[m].e||0;pc+=TL[m].c||0;}});
  Object.keys(RD).forEach(function(m){if(inP(m)){pr+=RD[m].count||0;prs+=RD[m].sum||0;}});
  var lbl=(f?fmtMonth(f):'Launch')+' – '+(t?fmtMonth(t):'today');
  set('pv-enrol',has?'+'+fmtN(pe):'–');
  set('pv-cert',has?'+'+fmtN(pc):'–');
  set('pv-resp',has?fmtN(pr):'–');
  set('pv-rating',has&&pr>0?(prs/pr).toFixed(2)+' / 5':'–');
  set('p-note',has?('Activity between '+lbl+' · all other figures are all-time totals'):'Select a period to see activity within it');
  var hp=document.getElementById('hdr-period');
  if(hp) hp.innerHTML=has?(' · <span style="color:#FFC145">Reporting period: '+lbl+'</span>'):'';
  Object.keys(CHIPS).forEach(function(cn){
    var el=document.getElementById(CHIPS[cn]); if(!el) return;
    if(!has){el.style.display='none';return;}
    var ct=CTL[cn]||{},cr=CRD[cn]||{},e=0,c=0,r=0,rs=0;
    Object.keys(ct).forEach(function(m){if(inP(m)){e+=ct[m].e||0;c+=ct[m].c||0;}});
    Object.keys(cr).forEach(function(m){if(inP(m)){r+=cr[m].count||0;rs+=cr[m].sum||0;}});
    el.style.display='inline-block';
    el.innerHTML=lbl+': +'+fmtN(e)+' learners · +'+fmtN(c)+' certificates'+(r>0?' · '+fmtN(r)+' responses (avg '+(rs/r).toFixed(2)+')':'');
  });
}
function clearPeriod(){document.getElementById('p-from').value='';document.getElementById('p-to').value='';periodChanged();}
function kpiInfo(el){
  document.getElementById('kpi-m-eyebrow').textContent='What we measure';
  document.getElementById('kpi-m-title').textContent=el.getAttribute('data-t');
  var escq=function(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');};
  var parts=String(el.getAttribute('data-i')||'').split('|||');
  // The ranking sentence (after '|||') drops onto its own line, emphasised.
  document.getElementById('kpi-m-body').innerHTML=escq(parts[0])+(parts[1]?'<br><br><strong style="color:var(--accent);font-weight:700;font-size:15px">'+escq(parts[1].trim())+'</strong>':'');
  document.getElementById('kpi-modal').style.display='flex';
}
function showQuote(i){
  var q=QUOTES[i]; if(!q) return;
  var escq=function(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');};
  document.getElementById('kpi-m-eyebrow').textContent='Learner Feedback';
  document.getElementById('kpi-m-title').textContent=q.w+(q.r>0?' · '+'★'.repeat(Math.round(q.r)):'');
  document.getElementById('kpi-m-body').innerHTML='<em style="line-height:1.7">“'+escq(q.t)+'”</em><br><br><span style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#6d8ba3">'+escq(q.c)+'</span>';
  document.getElementById('kpi-modal').style.display='flex';
}
function closeKpi(){document.getElementById('kpi-modal').style.display='none';}
function dlSave(c,name){var a=document.createElement('a');a.download=name.replace(/[^a-z0-9 _-]/gi,'')+'.png';a.href=c.toDataURL('image/png');a.click();}
var _logoImgs=null;
function _ldImg(src,cb){if(!src){cb(null);return;}var im=new Image();im.onload=function(){cb(im);};im.onerror=function(){cb(null);};im.src=src;}
function withLogo(cb){if(_logoImgs){cb(_logoImgs);return;}_ldImg(SHLOGO,function(a){_ldImg(SHLOGOC,function(b){_ldImg(PLOGO,function(p){_logoImgs={sh:a,shc:b,prov:p};cb(_logoImgs);});});});}
function rr(x,a,b,w,h,r){x.beginPath();x.moveTo(a+r,b);x.arcTo(a+w,b,a+w,b+h,r);x.arcTo(a+w,b+h,a,b+h,r);x.arcTo(a,b+h,a,b,r);x.arcTo(a,b,a+w,b,r);x.closePath();}
function tTrunc(x,t,max){if(x.measureText(t).width<=max)return t;while(t.length>1&&x.measureText(t+'…').width>max)t=t.slice(0,-1);return t+'…';}
function tile(x,px,py,wd,ht,k){
  var g=x.createLinearGradient(px,py,px+wd,py+ht);g.addColorStop(0,'#002a42');g.addColorStop(1,'#001a2b');
  x.fillStyle=g;rr(x,px,py,wd,ht,6);x.fill();
  x.strokeStyle='#0a3a57';x.lineWidth=1;rr(x,px+0.5,py+0.5,wd-1,ht-1,6);x.stroke();
  x.save();rr(x,px,py,wd,ht,6);x.clip();x.fillStyle=k.c;x.fillRect(px,py,wd,3);x.restore();
  x.fillStyle=k.c;x.font='700 12px Arial';x.fillText(tTrunc(x,k.l.toUpperCase(),wd-36),px+18,py+36);
  x.fillStyle='#eef4f9';x.font='700 38px Georgia';x.fillText(tTrunc(x,k.v,wd-36),px+18,py+ht-32);
}
function brandCanvas(w,h,draw,name,done){
  var S=3,c=document.createElement('canvas');c.width=w*S;c.height=h*S;var x=c.getContext('2d');x.scale(S,S);
  x.fillStyle='#001523';x.fillRect(0,0,w,h);
  var bg=x.createRadialGradient(w*0.8,0,60,w*0.8,0,w*0.9);bg.addColorStop(0,'rgba(255,193,69,0.05)');bg.addColorStop(1,'rgba(0,0,0,0)');
  x.fillStyle=bg;x.fillRect(0,0,w,h);
  withLogo(function(L){
    draw(x,w,h);
    L=L||{};
    var lh=26,pad=10,gap=12;
    if(L.prov&&L.shc){
      var pw=Math.min(L.prov.width/L.prov.height*lh,110),sw=Math.min(L.shc.width/L.shc.height*lh,110);
      var bw=pad*2+pw+gap*2+1+sw,bh=lh+pad*2,bx=w-20-bw,by=12;
      x.fillStyle='#fff';rr(x,bx,by,bw,bh,7);x.fill();
      x.drawImage(L.prov,bx+pad,by+pad,pw,lh);
      x.fillStyle='#d6dde3';x.fillRect(bx+pad+pw+gap,by+8,1,bh-16);
      x.drawImage(L.shc,bx+pad+pw+gap+1+gap,by+pad,sw,lh);
    } else if(L.shc){
      var sw2=Math.min(L.shc.width/L.shc.height*lh,120);
      x.fillStyle='#fff';rr(x,w-20-(sw2+pad*2),12,sw2+pad*2,lh+pad*2,7);x.fill();
      x.drawImage(L.shc,w-20-pad-sw2,12+pad,sw2,lh);
    } else if(L.sh){
      var lw=L.sh.width/L.sh.height*lh;x.globalAlpha=.92;x.drawImage(L.sh,w-28-lw,18,lw,lh);x.globalAlpha=1;
    }
    x.fillStyle='#6d8ba3';x.font='11px Arial';x.textBaseline='alphabetic';x.textAlign='left';x.fillText('Proudly hosted on SURGhub · '+(PURL?PURL.replace('https://','').replace('http://','').replace('www.',''):'surghub.org'),28,h-18);
    if(GENDATE){x.textAlign='right';x.fillText(GENDATE,w-28,h-18);x.textAlign='left';}
    x.strokeStyle='#0a3a57';x.lineWidth=2;x.strokeRect(1,1,w-2,h-2);
    dlSave(c,name);
    if(done)done();
  });
}
function dlChart(id,title){
  var srcC=document.getElementById(id); if(!srcC) return;
  // Re-render the chart 1.7x bigger on an offscreen canvas (animation off,
  // synchronous): fonts keep their pixel size, so labels come out
  // proportionally smaller and the chart crisper in the PNG.
  var live=(typeof Chart!=='undefined'&&Chart.getChart)?Chart.getChart(id):null;
  var cw=srcC.clientWidth||srcC.width,ch=srcC.clientHeight||srcC.height;
  var img=srcC,sw=cw,sh=ch,off=null,tmp=null;
  if(live){
    sw=Math.round(cw*1.7);sh=Math.round(ch*1.7);
    off=document.createElement('canvas');
    off.width=sw;off.height=sh;
    off.style.cssText='position:fixed;left:-10000px;top:0;width:'+sw+'px;height:'+sh+'px';
    document.body.appendChild(off);
    try{
      var cfg=live.config;
      tmp=new Chart(off.getContext('2d'),{type:cfg.type,data:cfg.data,options:Object.assign({},cfg.options,{responsive:false,animation:false,devicePixelRatio:3})});
      img=off;
    }catch(e){sw=cw;sh=ch;img=srcC;}
  }
  brandCanvas(sw+56,sh+110,function(x,w){
    x.fillStyle='#FFC145';x.font='700 15px Arial';x.fillText(tTrunc(x,(title+' — '+PROV).toUpperCase(),w-320),28,40);
    x.drawImage(img,28,62,sw,sh);
  },PROV+' - '+title,function(){
    if(tmp){try{tmp.destroy();}catch(e){}}
    if(off&&off.parentNode)off.parentNode.removeChild(off);
  });
}
function dlKpis(){
  brandCanvas(1000,620,function(x){
    x.fillStyle='#FFC145';x.font='700 12px Arial';x.fillText('UNITED NATIONS GLOBAL SURGERY LEARNING HUB',28,46);
    x.fillStyle='#eef4f9';x.font='700 34px Georgia';x.fillText(tTrunc(x,PROV,800),28,94);
    x.fillStyle='#6d8ba3';x.font='12px Arial';x.fillText('Results on SURGhub · all time',28,120);
    KPIS.forEach(function(k,i){tile(x,28+(i%3)*322,160+Math.floor(i/3)*190,304,170,k);});
  },PROV+' - SURGhub results');
}
function dlCourseKpis(i){
  var cs=CKPIS[i]; if(!cs) return;
  brandCanvas(1000,470,function(x){
    x.fillStyle='#FFC145';x.font='700 12px Arial';x.fillText('UNITED NATIONS GLOBAL SURGERY LEARNING HUB',28,46);
    x.fillStyle='#eef4f9';x.font='700 25px Georgia';x.fillText(tTrunc(x,cs.n,800),28,92);
    x.fillStyle='#6d8ba3';x.font='12px Arial';x.fillText('A course by '+PROV+' on SURGhub · all time',28,118);
    cs.k.forEach(function(k,j){tile(x,28+j*240,165,226,160,k);});
  },cs.n+' - SURGhub results');
}
function awMedal(r){return r===1?'\u{1F947}':r===2?'\u{1F948}':r===3?'\u{1F949}':'';}
function wrapLine(x,text,px,py,maxW,lh){var words=String(text).split(' '),line='',yy=py;for(var i=0;i<words.length;i++){var t=line?line+' '+words[i]:words[i];if(x.measureText(t).width>maxW&&line){x.fillText(line,px,yy);line=words[i];yy+=lh;}else line=t;}if(line)x.fillText(line,px,yy);return yy;}
function dlAwards(){
  var A=AWARDS; var ms=(A&&A.milestones)||[];
  if(!A||(!A.provider.length&&!A.countries.length&&!A.courses.length&&!ms.length)) return;
  // Combined provider + course award cards, each tagged PROVIDER / COURSE.
  var items=[];
  (A.provider||[]).forEach(function(a){items.push({rank:a.rank,label:a.label,tag:'PROVIDER',sub:String(a.value||''),tc:'#FFC145'});});
  (A.courses||[]).forEach(function(c){(c.labels||[]).forEach(function(l){items.push({rank:l.rank,label:l.label,tag:'COURSE',sub:c.course,tc:'#5AA9E6'});});});
  var W=1000,M=46,gx=16,gy=14,SG=32,lh=20;
  // Choose the column count that fills the last row most fully (no big right-hand gap),
  // tie-breaking toward more columns; <=4 items get one full row.
  var cols=items.length<=4?Math.max(items.length,1):[4,3,2].reduce(function(b,c){return ((items.length%c)||c)>((items.length%b)||b)?c:b;},4);
  var cw=(W-M*2-gx*(cols-1))/cols,ch=82;
  var crows=items.length?Math.ceil(items.length/cols):0;
  var maxW=W-M*2;
  var mc=document.createElement('canvas').getContext('2d');
  var nLines=function(font,text){mc.font=font;var words=String(text).split(' '),line='',n=1;for(var i=0;i<words.length;i++){var t=line?line+' '+words[i]:words[i];if(mc.measureText(t).width>maxW&&line){n++;line=words[i];}else line=t;}return n;};
  var msText=ms.length?(PROV+' '+ms.join(' and ')+'.'):'';
  var geoText=A.countries.length?('Most learners of any provider in '+A.countries.join(', ')+'.'):'';
  var msLines=ms.length?nLines('13px Arial',msText):0;
  var geoLines=A.countries.length?nLines('13px Arial',geoText):0;
  var H=118;
  if(crows) H+=crows*ch+(crows-1)*gy+SG;
  if(ms.length) H+=20+msLines*lh+SG;
  if(A.countries.length) H+=20+geoLines*lh+SG;
  H+=30;
  brandCanvas(W,H,function(x){
    x.fillStyle='#FFC145';x.font='700 11px Arial';x.fillText('UNITED NATIONS GLOBAL SURGERY LEARNING HUB',M,52);
    x.fillStyle='#eef4f9';x.font='700 23px Georgia';x.fillText(tTrunc(x,PROV+' \u2014 Awards & Recognition',maxW),M,84);
    if(A.asOf){x.fillStyle='#6d8ba3';x.font='12px Arial';x.fillText('As of '+A.asOf,M,105);}
    // Wrap a label into at most 2 lines that fit width (avoids truncating long
    // award names like "Highest Intent to Apply" in the narrower 4-col layout).
    var fit2=function(text,maxW){x.font='700 14px Arial';if(x.measureText(text).width<=maxW)return[text];var w=String(text).split(' '),l1='';for(var i=0;i<w.length;i++){var t=l1?l1+' '+w[i]:w[i];if(x.measureText(t).width<=maxW||!l1){l1=t;}else{var l2=w.slice(i).join(' ');if(x.measureText(l2).width>maxW){while(l2.length>1&&x.measureText(l2+'…').width>maxW)l2=l2.slice(0,-1);l2+='…';}return[l1,l2];}}return[l1];};
    var y=130;
    var fullRows=Math.floor(items.length/cols), lastCount=items.length-fullRows*cols;
    items.forEach(function(a,i){
      var row=Math.floor(i/cols), colInRow=i%cols;
      // Centre a partial last row so the grid reads as intentional (no lone right gap).
      var off=(row===fullRows && lastCount>0) ? (cols-lastCount)*(cw+gx)/2 : 0;
      var px=M+colInRow*(cw+gx)+off,py=y+row*(ch+gy),cy=py+ch/2,tx=px+54,tw=cw-54-14;
      var g=x.createLinearGradient(px,py,px+cw,py+ch);g.addColorStop(0,'#002a42');g.addColorStop(1,'#001a2b');
      x.fillStyle=g;rr(x,px,py,cw,ch,8);x.fill();
      x.strokeStyle='#0a3a57';x.lineWidth=1;rr(x,px+0.5,py+0.5,cw-1,ch-1,8);x.stroke();
      // Content vertically centred within the (equal-size) card; label wraps to 2 lines.
      var ll=fit2(a.label,tw),two=ll.length>1;
      x.font='24px Arial';x.fillText(awMedal(a.rank),px+18,cy+9);
      x.fillStyle=a.tc;x.font='700 9px Arial';x.fillText(a.tag,tx,two?cy-22:cy-13);
      x.fillStyle='#eef4f9';x.font='700 14px Arial';
      if(two){x.fillText(ll[0],tx,cy-4);x.fillText(ll[1],tx,cy+12);}else{x.fillText(ll[0],tx,cy+5);}
      x.fillStyle='#9fb3c8';x.font='12px Arial';x.fillText(tTrunc(x,a.sub,tw),tx,two?cy+30:cy+24);
    });
    if(crows) y+=crows*ch+(crows-1)*gy+SG;
    if(ms.length){
      x.fillStyle='#FFC145';x.font='700 10px Arial';x.fillText('MILESTONES',M,y);y+=20;
      x.fillStyle='#d4dde7';x.font='13px Arial';
      y=wrapLine(x,msText,M,y,maxW,lh)+SG;
    }
    if(A.countries.length){
      x.fillStyle='#FFC145';x.font='700 10px Arial';x.fillText('GEOGRAPHIC LEADERSHIP',M,y);y+=20;
      x.fillStyle='#d4dde7';x.font='13px Arial';
      y=wrapLine(x,geoText,M,y,maxW,lh)+SG;
    }
  },PROV+' - Awards');
}
function dlImpact(){
  var cards=[];
  if(IMPACTLT)cards.push({l:'LEARNING TIME',v:IMPACTLT,s:'of study time recorded across all learners, all time'});
  if(IMPACT&&IMPACT.contentNew)cards.push({l:'NEW KNOWLEDGE',v:IMPACT.contentNew.pct+'%',s:'said the course content was new to them'});
  if(IMPACT&&IMPACT.willApply)cards.push({l:'INTENT TO APPLY',v:IMPACT.willApply.pct+'%',s:'likely to apply what they learned at work'});
  if(IMPACT&&IMPACT.careerValue)cards.push({l:'CAREER VALUE',v:IMPACT.careerValue.pct+'%',s:'rate what they learned as important to their job success'});
  if(!cards.length) return;
  var n=cards.length,pad=28,gap=20,py=84,ht=270,wd=(1000-pad*2-gap*(n-1))/n,vfont=n>=3?52:72;
  brandCanvas(1000,470,function(x){
    x.fillStyle='#FFC145';x.font='700 12px Arial';x.fillText('LEARNING IMPACT — '+tTrunc(x,PROV.toUpperCase(),560),28,46);
    cards.forEach(function(k,j){
      var px=pad+j*(wd+gap);
      var g=x.createLinearGradient(px,py,px+wd,py+ht);g.addColorStop(0,'#002a42');g.addColorStop(1,'#001a2b');
      x.fillStyle=g;rr(x,px,py,wd,ht,6);x.fill();
      x.strokeStyle='#0a3a57';x.lineWidth=1;rr(x,px+0.5,py+0.5,wd-1,ht-1,6);x.stroke();
      x.save();rr(x,px,py,wd,ht,6);x.clip();x.fillStyle='#FFC145';x.fillRect(px,py,wd,3);x.restore();
      x.fillStyle='#9fb3c8';x.font='700 13px Arial';x.fillText(tTrunc(x,k.l,wd-48),px+24,py+46);
      x.fillStyle='#FFC145';x.font='700 '+vfont+'px Georgia';x.fillText(tTrunc(x,k.v,wd-48),px+24,py+132);
      x.fillStyle='#9fb3c8';x.font='14px Arial';wrapLine(x,k.s,px+24,py+170,wd-48,19);
    });
    var ns=[];if(IMPACT&&IMPACT.contentNew)ns.push(IMPACT.contentNew.n);if(IMPACT&&IMPACT.willApply)ns.push(IMPACT.willApply.n);if(IMPACT&&IMPACT.careerValue)ns.push(IMPACT.careerValue.n);
    if(ns.length){var bn=Math.min.apply(null,ns);var rd=bn>=1000?Math.floor(bn/1000)*1000:Math.floor(bn/100)*100;x.fillStyle='#6d8ba3';x.font='12px Arial';x.fillText('Survey figures based on '+fmtN(rd)+'+ surveys · share answering 4 or 5 on a 1–5 scale',28,408);}
  },PROV+' - Learning Impact');
}
function dlMap(){
  var el=document.getElementById('geo-map'); var svg=el?el.querySelector('svg'):null; if(!svg) return;
  var xml=new XMLSerializer().serializeToString(svg);
  var im=new Image();
  im.onload=function(){
    var cw=el.clientWidth,ch=el.clientHeight;
    brandCanvas(cw+56,ch+132,function(x,w,h){
      x.fillStyle='#FFC145';x.font='700 13px Arial';x.fillText(tTrunc(x,('Learners Worldwide — '+PROV).toUpperCase(),w-320),28,40);
      x.drawImage(im,28,62,cw,ch);
      var L=window._geoLeg;
      if(L){
        var lw=230,lx=w-28-lw,ly=h-58;
        var g=x.createLinearGradient(lx,0,lx+lw,0);
        L.ramp.forEach(function(c,i){g.addColorStop(i/(L.ramp.length-1),c);});
        x.fillStyle=g;x.fillRect(lx,ly,lw,10);
        x.strokeStyle='#0a3a57';x.lineWidth=1;x.strokeRect(lx+0.5,ly+0.5,lw-1,9);
        x.fillStyle='#9fb3c8';x.font='10px Arial';
        x.fillText('share of learners',lx,ly-7);
        x.fillText((L.lo<1?L.lo.toFixed(2):Math.round(L.lo))+'%',lx,ly+23);
        var hiT=L.max.toFixed(1)+'%';
        x.fillText(hiT,lx+lw-x.measureText(hiT).width,ly+23);
      }
    },PROV+' - Learners Worldwide');
  };
  im.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(xml);
}
function togglePage(){
  var main=document.getElementById('page-main'),meth=document.getElementById('page-meth'),btn=document.getElementById('meth-btn');
  if(main.style.display==='none'){main.style.display='';meth.style.display='none';btn.innerHTML='Methodology →';}
  else{main.style.display='none';meth.style.display='';btn.innerHTML='← Report';}
  window.scrollTo(0,0);
}
function goCourse(i){var el=document.getElementById('course_'+i);if(el)el.scrollIntoView({behavior:'smooth',block:'start'});}
function goSummary(ev){if(ev)ev.preventDefault();var el=document.getElementById('course-summary');if(el)el.scrollIntoView({behavior:'smooth',block:'start'});}
function sortCS(col,type){
  var tbl=document.getElementById('cs-table');var tb=tbl.tBodies[0];
  var dir=tbl.getAttribute('data-s')===col+'a'?'d':'a';
  tbl.setAttribute('data-s',col+dir);
  var rows=Array.prototype.slice.call(tb.rows);
  rows.sort(function(a,b){
    var va,vb;
    if(type==='s'){va=(a.cells[col].getAttribute('data-v')||a.cells[col].textContent).toLowerCase();vb=(b.cells[col].getAttribute('data-v')||b.cells[col].textContent).toLowerCase();return dir==='a'?va.localeCompare(vb):vb.localeCompare(va);}
    va=parseFloat(a.cells[col].getAttribute('data-v'))||0;vb=parseFloat(b.cells[col].getAttribute('data-v'))||0;
    return dir==='a'?va-vb:vb-va;
  });
  rows.forEach(function(r){tb.appendChild(r);});
  for(var i=0;i<5;i++){var ar=document.getElementById('cs-arr-'+i);if(ar)ar.textContent='';}
  var cur=document.getElementById('cs-arr-'+col);if(cur)cur.textContent=dir==='a'?' ↑':' ↓';
}
function drawCourse(id,tl){
  var el=document.getElementById(id); if(!el) return;
  var e=cumSeries(tl,'e'),c=cumSeries(tl,'c');
  el.__months=e.map(function(p){return p.m;});
  new Chart(el.getContext('2d'),{type:'line',data:{labels:e.map(function(p){return mLab(p.m);}),datasets:[
    {label:'Enrolled Learners',data:e.map(function(p){return p.v;}),borderColor:'#4389C8',borderWidth:2,backgroundColor:'#4389C81c',fill:true,tension:0.32,pointRadius:0,pointHoverRadius:3},
    {label:'Certificates',data:c.map(function(p){return p.v;}),borderColor:'#FFC145',borderWidth:2,backgroundColor:'#FFC14514',fill:true,tension:0.32,pointRadius:0,pointHoverRadius:3}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:TICK,font:{size:10},boxWidth:14}},tooltip:Object.assign(ttCfg(),{callbacks:{label:function(c){return ' '+c.dataset.label+': '+fmtN(c.parsed.y);}}})},
      scales:{x:xAx(),y:yAx()}}});
}
function drawRating(id,rd){
  var el=document.getElementById(id); if(!el) return;
  var ms=Object.keys(rd).sort(); if(!ms.length) return;
  el.__months=ms;
  new Chart(el.getContext('2d'),{data:{labels:ms.map(mLab),datasets:[
    {type:'bar',label:'Responses',data:ms.map(function(m){return rd[m].vol||rd[m].count||0;}),backgroundColor:'rgba(67,137,200,0.4)',borderRadius:2,yAxisID:'y1'},
    {type:'line',label:'Avg rating',data:ms.map(function(m){return rd[m].count>0?+(rd[m].sum/rd[m].count).toFixed(2):null;}),borderColor:'#FFC145',borderWidth:2,tension:0.3,pointRadius:2,pointBackgroundColor:'#FFC145',yAxisID:'y',clip:false}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:TICK,font:{size:10},boxWidth:14}},tooltip:ttCfg()},
      scales:{x:xAx(),y:{min:0,max:5,position:'left',grid:{color:GRID},ticks:{color:TICK,font:{size:10}},border:{display:false}},y1:{beginAtZero:true,position:'right',grid:{color:'transparent'},ticks:{color:TICK,font:{size:10},callback:function(v){return fmtS(v);}},border:{display:false}}}}});
}
document.addEventListener('DOMContentLoaded',function(){
  // Charts show the full timeline; the prefilled period is drawn as a marker band
  drawGrowth('growth-enrol','Enrolled Learners',TL,'e','#4389C8');
  drawGrowth('growth-cert','Courses completed',TL,'c','#FFC145');
  if(Object.keys(RD).length) drawRating('feedback-chart',RD);
  Object.keys(CMAP).forEach(function(c){ if(CTL[c]) drawCourse(CMAP[c],CTL[c]); });
  Object.keys(RMAP).forEach(function(c){ if(CRD[c]) drawRating(RMAP[c],CRD[c]); });
  periodChanged(true);
});
if(Object.keys(GEO).length){
  // Resolve any country-NAME keys to ISO-2 via Intl.DisplayNames (CLDR) so the
  // GeoChart never falls back to the keyless Geocoding service. Unresolvable
  // names are dropped from the map only (tables/counts use the full data).
  var ISO={};
  (function(){
    var REV={},A='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    var norm=function(s){return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/ & /g,' and ').replace(/[’']/g,'').replace(/\\bst\\.? /g,'saint ');};
    try{
      var dn=new Intl.DisplayNames(['en'],{type:'region'});
      for(var i=0;i<26;i++)for(var j=0;j<26;j++){var code=A[i]+A[j];try{var nm=dn.of(code);if(nm&&nm!==code)REV[norm(nm)]=code;}catch(e){}}
    }catch(e){}
    var FIX={'azerbaidjan':'AZ','guinea bissau':'GW','aland islands':'AX','turkiye':'TR','dr congo':'CD','drc':'CD','democratic republic of the congo':'CD','republic of the congo':'CG','ivory coast':'CI','cape verde':'CV','swaziland':'SZ','east timor':'TL','timor leste':'TL','macedonia':'MK','burma':'MM','antarctica':'AQ','kosovo':'XK','virgin islands us':'VI','virgin islands british':'VG','us virgin islands':'VI','british virgin islands':'VG','saint vincent and grenadines':'VC','micronesia':'FM','vatican':'VA','palestine':'PS','curacao':'CW','reunion':'RE','saint martin':'MF','sint maarten':'SX','brunei':'BN','laos':'LA','syria':'SY','russia':'RU','south korea':'KR','north korea':'KP','iran':'IR','venezuela':'VE','bolivia':'BO','tanzania':'TZ','vietnam':'VN','moldova':'MD','czech republic':'CZ'};
    Object.keys(GEO).forEach(function(k){
      var c=/^[A-Z]{2}$/.test(k)?k:(FIX[norm(k)]||REV[norm(k)]||null);
      if(c) ISO[c]=(ISO[c]||0)+(GEO[k]||0);
    });
  })();
  google.charts.load('current',{packages:['geochart']});
  google.charts.setOnLoadCallback(function(){
    var total=0; Object.keys(GEO).forEach(function(k){total+=GEO[k];});
    if(!total||!Object.keys(ISO).length) return;
    var ramp=['#123a5c','#1a5485','#2474b3','#3f97d6','#74bce9','#bce3fb'];
    var maxPct=0,minPct=100;
    var rows=Object.keys(ISO).map(function(k){var p=ISO[k]/total*100;if(p>maxPct)maxPct=p;if(p<minPct)minPct=p;return [k,p,ISO[k]];});
    var lo=Math.max(minPct||0.001,maxPct/316);
    var vals=ramp.map(function(_,i){return lo*Math.pow(maxPct/lo,i/(ramp.length-1));});
    var dt=new google.visualization.DataTable();
    dt.addColumn('string','Country'); dt.addColumn('number','Enrolled Learners');
    rows.forEach(function(r){dt.addRow([r[0],{v:Math.max(r[1],lo),f:fmtN(r[2])+' learners \u00b7 '+r[1].toFixed(r[1]<1?2:1)+'% of total'}]);});
    new google.visualization.GeoChart(document.getElementById('geo-map')).draw(dt,{
      colorAxis:{values:vals,colors:ramp},legend:'none',backgroundColor:'transparent',datalessRegionColor:'#0b2c46',defaultColor:'#0b2c46'});
    var mx=document.getElementById('geo-max'); if(mx) mx.textContent=maxPct.toFixed(1)+'%';
    window._geoLeg={lo:lo,max:maxPct,ramp:ramp};
  });
}
<\/script>
</body></html>`;
        },

        async generateProviderReport(providerName) {
            if (!providerName) return alert('No provider selected.');

            const html = await this._buildReportHtml(providerName);
            if (!html) return alert('No data for ' + providerName);

            const safeName = providerName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const savePath = await electronAPI.invoke('pick-save-path', safeName + '_report' + this._periodFileSuffix() + '.pdf');
            if (!savePath) return;

            this._showReportProgress('Generating report for ' + providerName + '...');

            const tempPath = path.join(os.tmpdir(), 'surghub_report_' + Date.now() + '.pdf');
            const result = await electronAPI.invoke('generate-pdf', { html, outputPath: tempPath });

            if (!result.success) {
                this._hideReportProgress();
                return alert('PDF generation failed: ' + result.error);
            }

            // Merge with cover/back if configured
            if (this.reportCoverPath || this.reportBackPath) {
                const mergeResult = await electronAPI.invoke('merge-pdfs', {
                    reportPdfPath: tempPath,
                    coverPath: this.reportCoverPath || null,
                    backPath: this.reportBackPath || null,
                    outputPath: savePath
                });
                this._hideReportProgress();
                if (!mergeResult.success) return alert('PDF merge failed: ' + mergeResult.error);
            } else {
                // Just move temp to final
                electronAPI.fs.renameSync(tempPath, savePath);
                this._hideReportProgress();
            }

            alert('Report saved: ' + savePath);
        },

        // Save the dark editorial HTML report for one provider.
        async exportProviderHtmlReport(providerName) {
            if (!providerName) return alert('No provider selected.');
            const html = await this._buildDarkReportHtml(providerName);
            if (!html) return alert('No data for ' + providerName);
            const safeName = providerName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const savePath = await electronAPI.invoke('pick-save-path', safeName + '_report' + this._periodFileSuffix() + '.html');
            if (!savePath) return;
            electronAPI.fs.writeFileSync(savePath, html);
            alert('Web report saved: ' + savePath + '\n\nSelf-contained file — open in any browser (charts need an internet connection).');
        },

        // Save the dark HTML report for the ENTIRE SURGhub platform (all providers combined).
        async exportPlatformHtmlReport() {
            const html = await this._buildDarkReportHtml('SURGhub', true);
            if (!html) return alert('No SURGhub course data to report yet — sync courses first.');
            const savePath = await electronAPI.invoke('pick-save-path', 'surghub_platform_report' + this._periodFileSuffix() + '.html');
            if (!savePath) return;
            electronAPI.fs.writeFileSync(savePath, html);
            alert('Platform web report saved: ' + savePath + '\n\nSelf-contained file — open in any browser (charts need an internet connection).');
        },

        _reportCancelled: false,

        async generateAllProviderReports() {
            const snapData = this.getAnalyticsSnap();
            const providers = [...new Set(snapData.map(d => d.Provider).filter(Boolean))].sort();
            if (providers.length === 0) return alert('No provider data available.');

            const folder = await electronAPI.invoke('pick-folder');
            if (!folder) return;

            this._reportCancelled = false;
            this._showReportProgress('Generating ' + providers.length + ' reports...', true);

            let success = 0, failed = 0;
            for (let i = 0; i < providers.length; i++) {
                if (this._reportCancelled) break;

                const prov = providers[i];
                this._showReportProgress('Generating report ' + (i + 1) + '/' + providers.length + ': ' + prov, true);

                const html = await this._buildReportHtml(prov);
                if (!html) { failed++; continue; }

                const safeName = prov.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                const tempPath = path.join(os.tmpdir(), 'surghub_report_' + Date.now() + '.pdf');
                const finalPath = path.join(folder, safeName + '_report' + this._periodFileSuffix() + '.pdf');

                const result = await electronAPI.invoke('generate-pdf', { html, outputPath: tempPath });
                if (this._reportCancelled) break;
                if (!result.success) { failed++; continue; }

                if (this.reportCoverPath || this.reportBackPath) {
                    const mergeResult = await electronAPI.invoke('merge-pdfs', {
                        reportPdfPath: tempPath,
                        coverPath: this.reportCoverPath || null,
                        backPath: this.reportBackPath || null,
                        outputPath: finalPath
                    });
                    if (mergeResult.success) success++;
                    else failed++;
                } else {
                    electronAPI.fs.renameSync(tempPath, finalPath);
                    success++;
                }
            }

            this._hideReportProgress();
            if (this._reportCancelled) {
                alert('Cancelled. ' + success + ' reports were saved before cancellation to:\n' + folder);
            } else {
                alert('Done! ' + success + ' reports saved to:\n' + folder + (failed > 0 ? '\n(' + failed + ' failed)' : ''));
            }
        },

        cancelReportGeneration() {
            this._reportCancelled = true;
        },

        // ── Full report packages: PDF + anonymized users + anonymized feedback ──
        // One folder per provider containing three files, named
        //   {provider}_report_{exportDate}{period}.pdf
        //   {provider}_users_{exportDate}{period}.xlsx    (one sheet per course)
        //   {provider}_feedback_{exportDate}{period}.xlsx (one sheet per course)
        // Users sheets: signup month, country, profession, gender, organisation,
        // learning time + completion (joined from the completion dataset where
        // available, falling back to certificate flag). Feedback sheets: date,
        // rating, type, country/profession (via the email→demographics map; the
        // email itself is never exported) and the written feedback text.

        async _getAnonUsers() {
            let anonUsers = this._rawAnonymizedUsers;
            if (!anonUsers || anonUsers.length === 0) {
                try { anonUsers = await Storage.getItem('surghub_anon_users'); } catch (e) {}
            }
            return anonUsers || [];
        },

        // Index per-(user, course) completion records by hashed email + normalized
        // course title, so users sheets can carry real learning time + completion.
        _buildCompletionIndex() {
            const idx = {};
            const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            (this._rawCompletion || []).forEach(rec => {
                const email = String(rec.email || '').trim().toLowerCase();
                if (!email) return;
                const uid = this._djb2Hash(email);
                [rec.course_resolved, rec.course].forEach(c => {
                    const n = norm(c);
                    if (n) idx[uid + '|' + n] = rec;
                });
            });
            return idx;
        },

        _appendCourseSheet(wb, rows, courseName) {
            let sheetName = courseName.substring(0, 28);
            if (sheetName.length < courseName.length) sheetName += '...';
            sheetName = sheetName.replace(/[:\\/?*\[\]]/g, '-');
            const baseName = sheetName;
            let counter = 1;
            while (wb.SheetNames && wb.SheetNames.includes(sheetName)) {
                sheetName = baseName.substring(0, 25) + '_' + counter++;
            }
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName);
        },

        _writeWorkbook(wb, filePath) {
            const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            electronAPI.fs.writeFileSync(filePath, new Uint8Array(out));
        },

        _buildUsersWorkbook(providerName, anonUsers) {
            const provCourses = this.getAnalyticsSnap().filter(d => d.Provider === providerName).map(d => d.Course);
            if (provCourses.length === 0 || !anonUsers || anonUsers.length === 0) return null;
            const completionIdx = this._buildCompletionIndex();
            const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            // Two passes: build all rows first while tracking which OPTIONAL columns
            // actually carry data anywhere — columns with no data at all (e.g. Gender /
            // Organisation Type on API-synced data, Learning Time without the
            // completion upload) are dropped from the workbook rather than exported empty.
            const perCourse = [];
            const hasData = { 'Gender': false, 'Organisation Type': false, 'Learning Time (min)': false };
            provCourses.forEach(courseName => {
                let courseUsers = anonUsers.filter(u => u.course === courseName);
                if (courseUsers.length === 0) {
                    const normCourse = norm(courseName);
                    courseUsers = anonUsers.filter(u => {
                        const normU = norm(u.course);
                        return normU.length > 3 && normCourse.length > 3 &&
                            (normU.includes(normCourse) || normCourse.includes(normU));
                    });
                }
                if (courseUsers.length === 0) return;
                const nCourse = norm(courseName);
                const rows = courseUsers.map((u, i) => {
                    const comp = u.user_uid ? completionIdx[u.user_uid + '|' + nCourse] : null;
                    const minutes = comp && comp.time_minutes ? Math.round(comp.time_minutes) : (u.course_minutes || '');
                    const completed = comp ? (comp.completed ? 'Yes' : 'No') : (u.has_certificate || 'No');
                    const row = {
                        'User #': i + 1,
                        'Signup Month': u.signup_month || '',
                        'Country': u.country || '',
                        'Profession': u.profession || '',
                        'Gender': u.gender || '',
                        'Organisation Type': u.organisation_type || '',
                        'Learning Time (min)': minutes || '',
                        'Completed': completed
                    };
                    Object.keys(hasData).forEach(k => { if (String(row[k]).trim() !== '') hasData[k] = true; });
                    return row;
                });
                perCourse.push({ courseName, rows });
            });
            if (perCourse.length === 0) return null;
            const dropCols = Object.keys(hasData).filter(k => !hasData[k]);
            const wb = XLSX.utils.book_new();
            perCourse.forEach(({ courseName, rows }) => {
                const cleaned = dropCols.length === 0 ? rows : rows.map(r => {
                    const c = { ...r };
                    dropCols.forEach(k => delete c[k]);
                    return c;
                });
                this._appendCourseSheet(wb, cleaned, courseName);
            });
            return wb;
        },

        async _buildFeedbackWorkbook(providerName) {
            const pSnap = this.getAnalyticsSnap().filter(d => d.Provider === providerName);
            if (pSnap.length === 0) return null;
            const demo = this._emailDemoMap || {};
            // AI rating per comment (0–10, blank if not yet scored). The Excel keeps
            // ALL raw comments unedited regardless of testimonial selection.
            const aiScores = (typeof this._getAiScores === 'function') ? (await this._getAiScores()) : (this._aiScoreMap || {});
            const wb = XLSX.utils.book_new();
            let sheetsAdded = 0;
            pSnap.forEach(c => {
                if (!c.FeedbackBank || !c.Course) return;
                let fb;
                try { fb = JSON.parse(c.FeedbackBank); } catch (e) { return; }
                if (!Array.isArray(fb)) return;
                const rows = fb
                    .filter(f => f.t && !String(f.t).match(/^no\s*data$/i) && String(f.t).trim().length > 0)
                    .map((f, i) => {
                        const d = f.e ? demo[String(f.e).trim().toLowerCase()] : null;
                        const ai = aiScores[this._djb2Hash(String(f.t || '').trim())];
                        return {
                            '#': i + 1,
                            'Date': f.d || '',
                            'Rating': (f.r !== undefined && f.r !== null && f.r !== '') ? f.r : '',
                            'Type': f.s || '',
                            'Country': d && d.country ? d.country : '',
                            'Profession': d && d.profession ? d.profession : '',
                            'Feedback': String(f.t).trim(),
                            'AI rating': (ai && typeof ai.s === 'number') ? ai.s : ''
                        };
                    });
                if (rows.length === 0) return;
                this._appendCourseSheet(wb, rows, c.Course);
                sheetsAdded++;
            });
            return sheetsAdded > 0 ? wb : null;
        },

        // Writes one provider's full package into {baseFolder}/{provider}/.
        // No dialogs — callers handle folder picking + progress + summaries.
        async _writeProviderPackage(providerName, baseFolder, dateStr, anonUsers) {
            const safeName = providerName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const suffix = '_' + dateStr + this._periodFileSuffix();
            const provDir = path.join(baseFolder, safeName);
            try { electronAPI.fs.mkdirSync(provDir, { recursive: true }); } catch (e) {}
            const status = { pdf: false, html: false, users: false, feedback: false };

            try {
                const darkHtml = await this._buildDarkReportHtml(providerName);
                if (darkHtml) {
                    electronAPI.fs.writeFileSync(path.join(provDir, safeName + '_report' + suffix + '.html'), darkHtml);
                    status.html = true;
                }
            } catch (e) { console.error('[Package] HTML report failed for', providerName, e); }

            const html = await this._buildReportHtml(providerName);
            if (html) {
                const tempPath = path.join(os.tmpdir(), 'surghub_report_' + Date.now() + '.pdf');
                const finalPath = path.join(provDir, safeName + '_report' + suffix + '.pdf');
                const result = await electronAPI.invoke('generate-pdf', { html, outputPath: tempPath });
                if (result.success) {
                    if (this.reportCoverPath || this.reportBackPath) {
                        const mergeResult = await electronAPI.invoke('merge-pdfs', {
                            reportPdfPath: tempPath,
                            coverPath: this.reportCoverPath || null,
                            backPath: this.reportBackPath || null,
                            outputPath: finalPath
                        });
                        status.pdf = !!mergeResult.success;
                    } else {
                        electronAPI.fs.renameSync(tempPath, finalPath);
                        status.pdf = true;
                    }
                }
            }

            try {
                const uwb = this._buildUsersWorkbook(providerName, anonUsers);
                if (uwb) { this._writeWorkbook(uwb, path.join(provDir, safeName + '_users' + suffix + '.xlsx')); status.users = true; }
            } catch (e) { console.error('[Package] users workbook failed for', providerName, e); }

            try {
                const fwb = await this._buildFeedbackWorkbook(providerName);
                if (fwb) { this._writeWorkbook(fwb, path.join(provDir, safeName + '_feedback' + suffix + '.xlsx')); status.feedback = true; }
            } catch (e) { console.error('[Package] feedback workbook failed for', providerName, e); }

            return status;
        },

        async exportProviderPackage(providerName) {
            if (!providerName) return alert('No provider selected.');
            const folder = await electronAPI.invoke('pick-folder');
            if (!folder) return;
            const dateStr = new Date().toISOString().split('T')[0];
            const anonUsers = await this._getAnonUsers();
            this._showReportProgress('Building report package for ' + providerName + '…');
            try {
                const s = await this._writeProviderPackage(providerName, folder, dateStr, anonUsers);
                this._hideReportProgress();
                alert('Report package for ' + providerName + ':\n\n' +
                    (s.pdf ? '✓' : '✗') + ' PDF report\n' +
                    (s.html ? '✓' : '✗') + ' Web report (.html)\n' +
                    (s.users ? '✓' : '✗') + ' Anonymized users (.xlsx)' + (s.users ? '' : ' — no user data; run Sync Growth Timelines then Sync Learners') + '\n' +
                    (s.feedback ? '✓' : '✗') + ' Anonymized feedback (.xlsx)' + (s.feedback ? '' : ' — no survey feedback synced') + '\n\n' +
                    'Saved to: ' + path.join(folder, providerName.replace(/[^a-z0-9]/gi, '_').toLowerCase()));
            } catch (e) {
                this._hideReportProgress();
                alert('Package export failed: ' + e.message);
            }
        },

        async exportAllProviderPackages() {
            const snapData = this.getAnalyticsSnap();
            const providers = [...new Set(snapData.map(d => d.Provider).filter(Boolean))].sort();
            if (providers.length === 0) return alert('No provider data available.');
            const folder = await electronAPI.invoke('pick-folder');
            if (!folder) return;
            const dateStr = new Date().toISOString().split('T')[0];
            const anonUsers = await this._getAnonUsers();
            this._reportCancelled = false;
            let ok = 0, partial = 0, failed = 0;
            for (let i = 0; i < providers.length; i++) {
                if (this._reportCancelled) break;
                const prov = providers[i];
                this._showReportProgress('Package ' + (i + 1) + '/' + providers.length + ': ' + prov, true);
                try {
                    const s = await this._writeProviderPackage(prov, folder, dateStr, anonUsers);
                    if (s.pdf && s.html && s.users && s.feedback) ok++;
                    else if (s.pdf || s.html || s.users || s.feedback) partial++;
                    else failed++;
                } catch (e) { console.error('[Package]', prov, e); failed++; }
            }
            this._hideReportProgress();
            alert((this._reportCancelled ? 'Cancelled. ' : 'Done! ') + ok + ' complete package' + (ok !== 1 ? 's' : '') +
                (partial > 0 ? ', ' + partial + ' partial (some files missing — check that user data + feedback are synced)' : '') +
                (failed > 0 ? ', ' + failed + ' failed' : '') +
                '\n\nEach provider has its own folder inside:\n' + folder);
        },

        _showReportProgress(msg, showCancel) {
            let el = document.getElementById('report-progress-overlay');
            if (!el) {
                el = document.createElement('div');
                el.id = 'report-progress-overlay';
                el.style.cssText = 'position:fixed;inset:0;background:rgba(0,47,76,0.85);display:flex;align-items:center;justify-content:center;z-index:9999';
                document.body.appendChild(el);
            }
            const cancelBtn = showCancel
                ? '<button onclick="App.cancelReportGeneration()" style="margin-top:16px;padding:8px 24px;border-radius:8px;font-size:13px;font-weight:700;background:#D03734;color:#fff;border:none;cursor:pointer">Cancel</button>'
                : '';
            el.innerHTML = '<div style="background:#fff;border-radius:16px;padding:32px 48px;text-align:center;max-width:500px">' +
                '<div style="font-size:18px;font-weight:700;color:#002F4C;margin-bottom:12px">Generating Reports</div>' +
                '<div style="font-size:14px;color:#64748b">' + this.escapeHtml(msg) + '</div>' +
                '<div style="margin-top:16px;width:100%;height:4px;background:#e2e8f0;border-radius:2px;overflow:hidden">' +
                '<div style="width:100%;height:100%;background:#4389C8;animation:pulse 1.5s ease-in-out infinite"></div></div>' +
                cancelBtn +
                '</div><style>@keyframes pulse{0%,100%{opacity:0.4}50%{opacity:1}}</style>';
        },

        _hideReportProgress() {
            const el = document.getElementById('report-progress-overlay');
            if (el) el.remove();
        }
    });

    // Load saved cover/back paths on startup
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => window.App.initReportSettings(), 500);
    });
})();
