Object.assign(window.App, {
    CONFLICT_COUNTRIES: ['Palestine', 'Sudan', 'Ukraine', 'Yemen', 'Israel', 'Somalia'],

    // ── Top Ambassadors — time-window filter ──────────────────────────────
    // Filters the "Top Ambassadors" bar chart on the Ambassadors tab by referral
    // signup month. PromoterTimeline is monthly-bucketed, so granularity is months.
    ambTopWindow: 'all',     // '1' | '3' | '6' | '12' | 'all' | 'custom'
    ambTopCustomStart: '',   // YYYY-MM (only used when window = 'custom')
    ambTopCustomEnd: '',
    ambTopLimit: 15,         // bars to show
    _setAmbTopWindow(v) {
        this.ambTopWindow = v;
        if (v !== 'custom') { this.ambTopCustomStart = ''; this.ambTopCustomEnd = ''; }
        this.renderView();
    },
    _setAmbTopCustomStart(v) { this.ambTopWindow = 'custom'; this.ambTopCustomStart = v; this.renderView(); },
    _setAmbTopCustomEnd(v)   { this.ambTopWindow = 'custom'; this.ambTopCustomEnd = v;   this.renderView(); },
    _setAmbTopLimit(v) { this.ambTopLimit = Math.max(5, Math.min(50, Number(v) || 15)); this.renderView(); },

    // Returns { filtered: { name: count }, label: 'Last 90 days' } based on window state
    _filterTopAmbassadors() {
        const snap = this.ambassadorData || {};
        const pTL = snap.PromoterTimeline || {};

        const win = this.ambTopWindow || 'all';
        let label = 'All time';
        let startStr = '0000-00', endStr = '9999-99';

        if (win !== 'all') {
            // Build the inclusive window of YYYY-MM strings
            const today = new Date();
            const endY = today.getFullYear(), endM = today.getMonth() + 1; // 1-12
            const lastMonth = `${endY}-${String(endM).padStart(2, '0')}`;
            if (win === 'custom') {
                startStr = this.ambTopCustomStart || '';
                endStr   = this.ambTopCustomEnd   || lastMonth;
                if (!startStr) { label = 'Custom (no start)'; return { filtered: {}, label, startStr, endStr }; }
                label = `Custom · ${startStr} → ${endStr}`;
            } else {
                const n = parseInt(win, 10);
                const startDate = new Date(endY, endM - 1 - (n - 1), 1);
                startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
                endStr = lastMonth;
                label = n === 1 ? 'This month' : `Last ${n} months`;
            }
        }

        const filtered = {};
        Object.entries(pTL).forEach(([promoter, byMonth]) => {
            let sum = 0;
            Object.entries(byMonth).forEach(([m, n]) => {
                if (m >= startStr && m <= endStr) sum += Number(n) || 0;
            });
            if (sum > 0) filtered[promoter] = sum;
        });
        const totalInWindow = Object.values(filtered).reduce((s, n) => s + n, 0);
        return { filtered, label, startStr, endStr, totalInWindow };
    },
    _shCourseSortCol: 'learners',
    _shCourseSortAsc: false,
    // All Courses table on Platform tab — default: by Certificates ↓
    _platCourseSortCol: 'certs',
    _platCourseSortAsc: false,
    // User Growth chart — period (months) and y-axis trim ("drama mode")
    userGrowthRange: 'all',
    userGrowthTrim: false,
    // Country / Profession / Ambassador growth trim states (period already on App for first two)
    countryGrowthTrim: false,
    profGrowthTrim: false,
    ambGrowthRange: 'all',
    ambGrowthTrim: false,
    // Reset a chart's per-session state to defaults: width, period, trim, bars toggle, partial-month
    _resetChart(elementId) {
        // Clear width
        delete this._chartWidth[elementId];
        // Per-chart state resets
        if (elementId === 'chart_audience_growth') {
            this.userGrowthRange = 'all';
            this.userGrowthTrim = false;
            const cb = document.getElementById('toggle-aud-growth-bars'); if (cb) cb.checked = false;
        } else if (elementId === 'chart_country_timeline') {
            this.countryTimelineRange = 'all';
            this.countryGrowthTrim = false;
            const cb = document.getElementById('toggle-country-bars'); if (cb) cb.checked = false;
        } else if (elementId === 'chart_activity_timeline') {
            this.activityTimelineRange = 'all'; this.activityGrowthTrim = false;
            const cb = document.getElementById('toggle-activity-bars'); if (cb) cb.checked = false;
        } else if (elementId === 'chart_career_timeline') {
            this.careerTimelineRange = 'all'; this.careerGrowthTrim = false;
            const cb = document.getElementById('toggle-career-bars'); if (cb) cb.checked = false;
        } else if (elementId === 'chart_topic_timeline') {
            this.topicTimelineRange = 'all'; this.topicGrowthTrim = false;
            const cb = document.getElementById('toggle-topic-bars'); if (cb) cb.checked = false;
        } else if (elementId === 'chart_ambassador_total') {
            this.ambGrowthRange = 'all';
            this.ambGrowthTrim = false;
            const cb = document.getElementById('toggle-amb-growth-bars'); if (cb) cb.checked = false;
        } else if (elementId === 'chart_growth') {
            // Shared element id across Platform / Provider / Course views — clear bar toggles for all
            ['toggle-plat-growth-bars', 'toggle-prov-growth-bars', 'toggle-crs-growth-bars'].forEach(id => {
                const cb = document.getElementById(id); if (cb) cb.checked = false;
            });
        }
        // Reset shared partial-month flag too
        this.includePartialMonth = false;
        this.renderView();
    },
    _resetChartBtn(elementId) {
        return `<button onclick="App._resetChart('${elementId}')" title="Reset this chart's view to defaults (width, period, trim, monthly bars)" class="ml-1 px-2 py-0.5 text-[10px] font-bold rounded text-slate-400 hover:bg-slate-100 hover:text-gsf-boston border border-slate-200">↺ Reset</button>`;
    },
    _sortPlatCourseDir(col) {
        if (this._platCourseSortCol === col) this._platCourseSortAsc = !this._platCourseSortAsc;
        else { this._platCourseSortCol = col; this._platCourseSortAsc = (col === 'course' || col === 'provider'); }
        this.renderView();
    },
    // Ambassador Performance table sort (mirrors the course-table pattern).
    _sortAmbDir(col) {
        if (this._ambSortCol === col) this._ambSortAsc = !this._ambSortAsc;
        else { this._ambSortCol = col; this._ambSortAsc = (col === 'name'); }
        this.renderView();
    },
    // Chart width control — narrower charts make growth slopes look steeper
    _chartWidth: {},  // map: elementId -> 'compact' | 'standard' | 'wide'
    _setChartWidth(elementId, width) {
        this._chartWidth[elementId] = width;
        // Full re-render — the view's own draw triggers handle the chart redraw cleanly
        this.renderView();
    },
    // Inline style helper for chart width wrapper divs
    _chartWidthStyle(elementId) {
        const w = this._chartWidth[elementId] || 'wide';
        const map = { compact: '520px', standard: '820px', wide: '100%' };
        return `max-width: ${map[w]}; margin: ${w==='wide' ? '0' : '0 auto'};`;
    },
    _chartWidthBtns(elementId) {
        const cur = this._chartWidth[elementId] || 'wide';
        const btn = (val, label, title) =>
            `<button onclick="App._setChartWidth('${elementId}','${val}')" title="${title}" class="px-2 py-0.5 text-[10px] font-bold rounded ${cur===val ? 'bg-gsf-boston text-white' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'}">${label}</button>`;
        return `<div class="inline-flex items-center gap-0.5 ml-2 border border-slate-200 rounded p-0.5" title="Chart width — narrower charts make growth slopes look steeper">
            ${btn('compact','S','Compact width — steepest slopes')}
            ${btn('standard','M','Standard width')}
            ${btn('wide','L','Full width')}
        </div>`;
    },
    getConflictLearners(audSnap) {
        if (!audSnap || !audSnap.AllCountryStats) return 0;
        try {
            const stats = typeof audSnap.AllCountryStats === 'string' ? JSON.parse(audSnap.AllCountryStats) : audSnap.AllCountryStats;
            // Normalise both sides (lowercase, de-hyphen) so 'palestine' / 'Palestine'
            // / 'PALESTINE' all match regardless of how the source cased it.
            const norm = s => String(s || '').toLowerCase().replace(/[-_]/g, ' ').trim();
            const conflictSet = new Set(this.CONFLICT_COUNTRIES.map(norm));
            let sum = 0;
            for (const [country, count] of Object.entries(stats)) {
                if (conflictSet.has(norm(country))) sum += (Number(count) || 0);
            }
            return sum;
        } catch(e) { return 0; }
    },
    formatNumber(val) { return new Intl.NumberFormat('en-US').format(val || 0); },
    // Compute per-course learning minutes from anonymized user data
    getCourseLearningMinutes() {
        const anon = this._rawAnonymizedUsers;
        if (!anon || anon.length === 0) return {};
        const mins = {};
        anon.forEach(u => {
            if (u.course && u.course_minutes > 0) {
                mins[u.course] = (mins[u.course] || 0) + u.course_minutes;
            }
        });
        return mins;
    },
    // Single source of truth for a course's learning minutes: prefer the API-enriched
    // LearningMinutes, fall back to the anonymized-user course_minutes when it's null
    // (a freshly-synced course has LearningMinutes===null). Every learning-time SUM and
    // per-course display must route through this so totals reconcile with the rows.
    courseLearningMinutes(d, map) {
        map = map || (this.getCourseLearningMinutes ? this.getCourseLearningMinutes() : {});
        return Number(d && d.LearningMinutes != null ? d.LearningMinutes : (map[d && d.Course] || 0)) || 0;
    },
    // Single source of truth for certification rate: certs ÷ learners as a 1-decimal
    // percent string, or '-' when there are no learners. Pass {asNumber:true} for the
    // raw number (or null when no learners) for charts / data packs.
    formatCertRate(cert, lrn, opts) {
        const c = Number(cert) || 0, l = Number(lrn) || 0;
        if (l <= 0) return (opts && opts.asNumber) ? null : '-';
        const pct = (c / l) * 100;
        return (opts && opts.asNumber) ? +pct.toFixed(1) : pct.toFixed(1) + '%';
    },
    formatLearningTime(minutes) {
        if (!minutes || minutes <= 0) return '-';
        const years = minutes / 525960; // avg minutes per year (365.25 * 24 * 60)
        if (years >= 1) return years.toFixed(1) + ' yrs';
        const months = minutes / 43830; // avg minutes per month (365.25/12 * 24 * 60)
        if (months >= 1) return months.toFixed(1) + ' mo';
        const days = minutes / 1440;
        if (days >= 1) return days.toFixed(1) + ' d';
        const hours = minutes / 60;
        return hours.toFixed(1) + ' h';
    },
    // Aggregate the transformative-learning survey questions across a set of
    // course records' QuestionStats (captured by Sync Surveys): "the information
    // was new to me", "it is likely that I will use the information acquired", and
    // "how important are the knowledge/skills to your job success?" (career value).
    // Returns { contentNew, willApply, careerValue } each {pct, avg, n} (only when
    // ≥3 responses exist), or null until survey data has been synced.
    _surveyImpactStats(records) {
        const agg = { newSum: 0, newN: 0, newHi: 0, applySum: 0, applyN: 0, applyHi: 0, careerSum: 0, careerN: 0, careerHi: 0 };
        (records || []).forEach(d => {
            if (!d || !d.QuestionStats) return;
            let qs; try { qs = JSON.parse(d.QuestionStats); } catch (e) { return; }
            (Array.isArray(qs) ? qs : []).forEach(s => {
                if (!s || !s.q || !s.n) return;
                const lq = String(s.q).toLowerCase();
                const hi = s.dist ? ((s.dist[4] || 0) + (s.dist[5] || 0)) : 0;
                if (lq.includes('was new to me') || lq.includes('nuevo para m') || lq.includes('nouvelle pour moi') || lq.includes('nouvelles pour moi')) {
                    agg.newSum += (s.avg || 0) * s.n; agg.newN += s.n; agg.newHi += hi;
                } else if (lq.includes('will use the information') || lq.includes('use the information acquired') ||
                           (lq.includes('usar') && lq.includes('informaci')) ||
                           (lq.includes('utilise') && lq.includes('information'))) {
                    agg.applySum += (s.avg || 0) * s.n; agg.applyN += s.n; agg.applyHi += hi;
                } else if (lq.includes('job success') || lq.includes('ussite professionnelle') || lq.includes('xito laboral')) {
                    // "How important are the knowledge/skills acquired … to your job success?" (1–5 importance)
                    agg.careerSum += (s.avg || 0) * s.n; agg.careerN += s.n; agg.careerHi += hi;
                }
            });
        });
        const out = {};
        if (agg.newN >= 3) out.contentNew = { pct: Math.round(agg.newHi / agg.newN * 100), avg: +(agg.newSum / agg.newN).toFixed(2), n: agg.newN };
        if (agg.applyN >= 3) out.willApply = { pct: Math.round(agg.applyHi / agg.applyN * 100), avg: +(agg.applySum / agg.applyN).toFixed(2), n: agg.applyN };
        if (agg.careerN >= 3) out.careerValue = { pct: Math.round(agg.careerHi / agg.careerN * 100), avg: +(agg.careerSum / agg.careerN).toFixed(2), n: agg.careerN };
        return (out.contentNew || out.willApply || out.careerValue) ? out : null;
    },

    // Shared "Learning Impact" band (Platform Overview + Provider page).
    _surveyImpactBand(records) {
        const si = this._surveyImpactStats(records);
        if (!si) return '';
        const stat = (s, heading, label) => !s ? '' : `
            <div>
                <p class="text-[10px] font-bold uppercase tracking-widest text-white/60 mb-1.5">${heading}</p>
                <p class="text-4xl font-black text-[#FFC145]">${s.pct}%</p>
                <p class="text-sm text-white/90 mt-1">${label}</p>
            </div>`;
        const ns = [si.contentNew, si.willApply, si.careerValue].filter(Boolean).map(s => s.n);
        const bn = ns.length ? Math.min(...ns) : 0;
        const rounded = bn >= 1000 ? Math.floor(bn / 1000) * 1000 : Math.floor(bn / 100) * 100;
        const stat2 = (s, heading, label) => !s ? '' : `
            <div>
                <p class="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">${heading}</p>
                <p class="text-4xl font-black text-gsf-boston">${s.pct}%</p>
                <p class="text-sm text-slate-600 mt-1">${label}</p>
            </div>`;
        return `
            <div class="bg-white rounded-xl p-6 mb-8 border shadow-sm" title="Share of end-of-course survey respondents answering 4 or 5 on a 1–5 scale">
                <div class="flex items-center gap-2 mb-4"><i data-lucide="sparkles" width="16" class="text-gsf-boston"></i><h3 class="text-sm font-bold uppercase tracking-wide text-gsf-prussian">Learning Impact</h3></div>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    ${stat2(si.contentNew, 'New Knowledge', 'say the course content was <strong>new to them</strong>')}
                    ${stat2(si.willApply, 'Intent to Apply', 'say they are <strong>likely to apply</strong> what they learned')}
                    ${stat2(si.careerValue, 'Career Value', 'rate what they learned as <strong>important to their job success</strong>')}
                </div>
                ${bn > 0 ? '<p class="text-[10px] text-slate-400 mt-3 uppercase tracking-wide">Based on ' + this.formatNumber(rounded) + '+ surveys</p>' : ''}
            </div>`;
    },

    // Distinct-country count across a set of course records' CountryStats
    // (collected by Growth Timelines / CSV timeline upload). Returns {counts, countryCount}.
    aggregateCourseCountries(records) {
        const counts = {};
        let usedStats = false;
        (records || []).forEach(d => {
            if (!d || !d.CountryStats) return;
            try {
                const cs = typeof d.CountryStats === 'string' ? JSON.parse(d.CountryStats) : d.CountryStats;
                Object.entries(cs).forEach(([k, v]) => {
                    if (k && k !== 'Unknown' && k !== 'nan') { counts[k] = (counts[k] || 0) + (Number(v) || 0); usedStats = true; }
                });
            } catch (e) {}
        });
        // FALLBACK (mirrors the provider report): when NO course here has CountryStats,
        // tally distinct countries from the anonymized-user CSV scoped to these courses,
        // so the dashboard "Countries" matches the PDF/web report.
        if (!usedStats) {
            const anon = this._rawAnonymizedUsers;
            if (anon && anon.length) {
                const names = (records || []).map(d => d && d.Course).filter(Boolean);
                anon.forEach(u => {
                    let match = names.includes(u.course);
                    if (!match) {
                        const normU = (u.course || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        match = names.some(pc => {
                            const normP = pc.toLowerCase().replace(/[^a-z0-9]/g, '');
                            return normU.length > 3 && normP.length > 3 && (normU.includes(normP) || normP.includes(normU));
                        });
                    }
                    if (!match) return;
                    if (u.country && u.country.trim() && u.country !== 'Unknown' && u.country !== 'nan') {
                        const c = u.country.trim();
                        counts[c] = (counts[c] || 0) + 1;
                    }
                });
            }
        }
        return { counts, countryCount: Object.keys(counts).length };
    },
    // Top-N learner countries card for a set of course records (uses CountryStats).
    // Returns '' when there's no country data. Rendered as a plain table so it
    // also exports cleanly via the per-page HTML export (no live chart needed).
    _countryTableHtml(records, limit = 10) {
        const { counts } = this.aggregateCourseCountries(records);
        const refLearners = (records || []).reduce((s, r) => s + (Number(r.Learners) || 0), 0);
        return this._renderCountryTable(counts, limit, refLearners);
    },
    // Render a Top-N countries card from a pre-aggregated {country: count} object
    // (used by the provider/course tables above and the platform-total audience tab).
    _renderCountryTable(countsObj, limit = 10, refLearners = 0) {
        const counts = {};
        Object.entries(this._safeParseObj(countsObj)).forEach(([k, v]) => {
            if (k && k !== 'Unknown' && k !== 'nan') counts[k] = (counts[k] || 0) + (Number(v) || 0);
        });
        const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        if (entries.length === 0) return '';
        const total = entries.reduce((s, [, v]) => s + v, 0);
        const rows = entries.slice(0, limit).map(([c, v], i) => {
            const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0';
            return `<tr class="border-b last:border-0 hover:bg-slate-50">
                <td class="py-2 px-3 text-slate-400 text-xs w-8">${i + 1}</td>
                <td class="py-2 px-3 font-medium text-gsf-prussian">${this.escapeHtml(c)}</td>
                <td class="py-2 px-3 text-right font-bold text-gsf-boston">${this.formatNumber(v)}</td>
                <td class="py-2 px-3 text-right text-slate-500 text-xs">${pct}%</td>
            </tr>`;
        }).join('');
        return `<div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
            <h3 class="text-lg font-bold mb-4 flex items-center gap-2 text-gsf-prussian"><i data-lucide="map-pin" class="text-gsf-boston"></i> Top ${Math.min(limit, entries.length)} Countries</h3>
            <table class="w-full text-sm border-collapse">
                <thead><tr class="border-b text-slate-500"><th class="py-2 px-3 text-left font-medium w-8">#</th><th class="py-2 px-3 text-left font-medium">Country</th><th class="py-2 px-3 text-right font-medium">Learners</th><th class="py-2 px-3 text-right font-medium">%</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <p class="text-xs text-slate-400 mt-3">${entries.length} countries total · ${this.formatNumber(total)}${refLearners ? ' of ' + this.formatNumber(refLearners) : ''} learners with country data${refLearners && total < refLearners * 0.4 ? ' · <span class="text-amber-600 font-medium">low coverage — may not be representative</span>' : ''}</p>
        </div>`;
    },
    // Per-ambassador performance table: Leads (signups) · Clicks (link visits) ·
    // Conversion. Built from snap.Promoters + snap.ClicksByPromoter. Returns ''
    // when no click data is present (e.g. older snapshots / CSV uploads).
    // Ambassador awards — top performers across all ambassadors, mirroring the
    // provider/course award language. Computed on render from the leads/clicks data.
    // ── Ambassador → learner bridge (derived from the immutable raw captures) ──
    // Joins each learner's referrer_id (demographics raw) to the affiliate roster
    // (ambassadors raw, id → name) → per-ambassador downstream reach, naming even
    // referrers absent from the top-promoter list. Persists a small, EXPORT-SAFE
    // summary (names + counts only, never emails) to surghub_referrer_bridge.
    async buildReferrerBridgeFromRaw() {
        const fs = electronAPI.fs, path = electronAPI.path;
        const rawDir = path.join(Storage.DATA_DIR, 'surghub', 'raw');
        const latest = re => { try { return fs.readdirSync(rawDir, { withFileTypes: true }).filter(e => e.isDirectory && re.test(e.name)).map(e => e.name).sort().pop(); } catch (e) { return null; } };
        const demoDir = latest(/^demographics__/), ambDir = latest(/^ambassadors__/);
        if (!demoDir) { this.showMsg('⚠ No demographics raw capture yet — run a Learners / Demographics sync first.'); return; }
        this.showMsg('Building downstream reach from raw…');
        try {
            // referrer_id → distinct learner count + that referrer's learner EMAILS
            // (emails are used in-memory only to join outcomes from completion.json;
            // they are NEVER persisted — the stored summary is name + counts only).
            const reach = {}; const seenU = new Set(); const refEmails = {};
            for (const ln of String(fs.readFileSync(path.join(rawDir, demoDir, 'pull.jsonl'), 'utf8')).split('\n')) {
                if (!ln) continue; let r; try { r = JSON.parse(ln); } catch (e) { continue; }
                let b; try { b = JSON.parse(r.body); } catch (e) { continue; }
                for (const u of (b.data || [])) {
                    if (!u || seenU.has(u.id)) continue; seenU.add(u.id);
                    if (u.referrer_id) {
                        reach[u.referrer_id] = (reach[u.referrer_id] || 0) + 1;
                        const em = (u.email || '').trim().toLowerCase();
                        // Set, not array — a learner with two accounts under one referrer
                        // shares an email; count that learner's outcomes once, not per account.
                        if (em) (refEmails[u.referrer_id] = refEmails[u.referrer_id] || new Set()).add(em);
                    }
                }
            }
            // referrer_id → name (affiliate roster). Names only — emails are dropped.
            const name = {}; let roster = 0; let anonN = 0;
            if (ambDir) {
                for (const ln of String(fs.readFileSync(path.join(rawDir, ambDir, 'pull.jsonl'), 'utf8')).split('\n')) {
                    if (!ln) continue; let r; try { r = JSON.parse(ln); } catch (e) { continue; }
                    if (!/^\/affiliates(\?|$)/.test(r.path)) continue;
                    let b; try { b = JSON.parse(r.body); } catch (e) { continue; }
                    for (const a of (b.data || [])) {
                        if (a && a.id && name[a.id] === undefined) {
                            // Some affiliates put their email in username OR first/last —
                            // take the first candidate with no '@', else a redacted label.
                            const cands = [(a.username || '').trim(), ((a.first_name || '') + ' ' + (a.last_name || '')).trim()];
                            const safe = cands.find(c => c && c.indexOf('@') < 0);
                            // Fallback label uses an ordinal, NOT an id fragment — keeps
                            // any referrer_id bytes out of the Sheets-pushed bridge.
                            name[a.id] = safe || ('Ambassador #' + (++anonN));
                            roster++;
                        }
                    }
                }
            }
            // Learner OUTCOMES per referrer — join completion.json BY EMAIL (the only
            // clean per-learner outcome source: anon_users has 0 certs and user_certs
            // is corrupt). Per referrer we sum, over the learners they referred:
            // distinct courses enrolled, certificates earned, learning minutes, and how
            // many of their learners actually started a course (active).
            let emailOutcome = null;
            try {
                const comp = (Array.isArray(this._rawCompletion) && this._rawCompletion.length)
                    ? this._rawCompletion
                    : await Storage.getItem('surghub_completion');
                if (Array.isArray(comp) && comp.length) {
                    emailOutcome = {};
                    for (const rec of comp) {
                        const em = String((rec && rec.email) || '').trim().toLowerCase(); if (!em) continue;
                        const o = emailOutcome[em] || (emailOutcome[em] = { courses: new Set(), certs: 0, minutes: 0 });
                        if (rec.course) o.courses.add(rec.course);
                        if (rec.certificate) o.certs++;
                        o.minutes += Number(rec.time_minutes) || 0;
                    }
                }
            } catch (e) { emailOutcome = null; }
            const hasOutcomes = !!emailOutcome;
            const outcomeFor = id => {
                const o = { active: 0, courses: 0, certs: 0, minutes: 0 };
                for (const em of (refEmails[id] || [])) { const e = emailOutcome[em]; if (!e) continue; o.active++; o.courses += e.courses.size; o.certs += e.certs; o.minutes += e.minutes; }
                return o;
            };
            const rows = Object.keys(reach).map(id => {
                const base = { name: name[id] || null, reach: reach[id] };
                if (hasOutcomes) { const o = outcomeFor(id); base.active = o.active; base.courses = o.courses; base.certs = o.certs; base.minutes = o.minutes; }
                return base;
            }).sort((a, b) => b.reach - a.reach);
            let named = 0, namedReach = 0, unnamed = 0, unnamedReach = 0;
            rows.forEach(x => { if (x.name) { named++; namedReach += x.reach; } else { unnamed++; unnamedReach += x.reach; } });
            const summary = {
                builtAt: new Date().toISOString(), fromDemoPull: demoDir, fromAmbPull: ambDir || null, rosterSize: roster,
                distinctReferrers: rows.length, totalBridged: rows.reduce((s, x) => s + x.reach, 0),
                named, namedReach, unnamed, unnamedReach,
                hasOutcomes,
                ...(hasOutcomes ? {
                    totalCourses: rows.reduce((s, x) => s + (x.courses || 0), 0),
                    totalCerts: rows.reduce((s, x) => s + (x.certs || 0), 0),
                    totalMinutes: rows.reduce((s, x) => s + (x.minutes || 0), 0),
                    activeLearners: rows.reduce((s, x) => s + (x.active || 0), 0),
                } : {}),
                // name + counts only — NO learner emails (refEmails stays in memory).
                byName: rows.map(x => ({ name: x.name || '(unnamed referrer)', reach: x.reach,
                    ...(hasOutcomes ? { active: x.active || 0, courses: x.courses || 0, certs: x.certs || 0, minutes: x.minutes || 0 } : {}) }))
            };
            await Storage.setItem('surghub_referrer_bridge', summary, { internal: true });
            this._referrerBridge = summary;
            const outMsg = hasOutcomes ? ' · ' + this.formatNumber(summary.totalCerts) + ' certs / ' + this.formatNumber(summary.totalCourses) + ' courses by referred learners' : '';
            this.showMsg('Downstream reach built — ' + this.formatNumber(summary.totalBridged) + ' learners across ' + summary.distinctReferrers + ' referrers' + outMsg + ' ✓');
            this.renderView();
        } catch (e) {
            console.error('[referrer-bridge]', e);
            this.showMsg('⚠ Could not build downstream reach: ' + (e && e.message));
        }
    },
    // ── Re-derivability check (the derive() firewall) ──────────────────────
    // Re-runs the EXACT live aggregation (runAudienceAggregation) over the users
    // reconstructed from the captured raw, and diffs against the stored snapshot.
    // Read-only — proves which on-screen numbers are reproducible from the receipts
    // (and flags which still depend on an uncaptured input). Never flips/mutates.
    async verifyAudienceAgainstRaw(opts) {
        opts = opts || {}; const silent = !!opts.silent;
        const fs = electronAPI.fs, path = electronAPI.path;
        const rawDir = path.join(Storage.DATA_DIR, 'surghub', 'raw');
        let demoDir = null;
        try { demoDir = fs.readdirSync(rawDir, { withFileTypes: true }).filter(e => e.isDirectory && /^demographics__/.test(e.name)).map(e => e.name).sort().pop(); } catch (e) {}
        if (!demoDir) { if (!silent) this.showMsg('⚠ No demographics raw capture yet — run a Learners / Demographics sync first.'); return; }
        if (!(window.LearnWorlds && window.LearnWorlds.flattenUsersFromRawPages) || !this.runAudienceAggregation) { if (!silent) this.showMsg('⚠ Derive engine unavailable.'); return; }
        if (!silent) this.showMsg('Re-deriving the snapshot from raw…');
        try {
            const bodies = [];
            for (const ln of String(fs.readFileSync(path.join(rawDir, demoDir, 'pull.jsonl'), 'utf8')).split('\n')) {
                if (!ln) continue; let r; try { r = JSON.parse(ln); } catch (e) { continue; }
                if (!/^\/users(\?|$)/.test(r.path)) continue;
                try { bodies.push(JSON.parse(r.body)); } catch (e) {}
            }
            const usersJson = window.LearnWorlds.flattenUsersFromRawPages(bodies);
            const derived = this.runAudienceAggregation(usersJson);
            // Compare against the LATEST snapshot by Timestamp. The history array
            // is stored newest-first, so the old `[length-1]` grabbed the OLDEST
            // snapshot — causing false "differs" against fresh raw. Max-by-Timestamp
            // matches what the dashboard shows (its default snapshot is userHistory[0]
            // / the latest date) and the latest demographics raw (same sync).
            let stored = this.audienceData || {};
            const _hist = (this.userHistory || []).filter(h => h && h.Timestamp);
            if (_hist.length) stored = _hist.reduce((a, b) => String(b.Timestamp || '') > String(a.Timestamp || '') ? b : a);
            else if (this.userHistory && this.userHistory.length) stored = this.userHistory[this.userHistory.length - 1];
            const tolOf = s => Math.max(2, s * 0.005);
            // Total / Profession / Country / Survey all reproduce from the /users
            // receipt — country + survey come from user TAGS (re-derived via the
            // same flatten + classifier), NOT from the signup-survey upload.
            const mk = (f, label) => { const d = Number(derived[f]) || 0, s = Number(stored[f]) || 0; const match = Math.abs(d - s) <= tolOf(s); return { label, derived: d, stored: s, match, note: match ? 'reproduces from the /users receipt exactly' : 'differs from the stored snapshot — worth investigating' }; };
            const checks = [
                mk('TotalUsers', 'Total learners'),
                mk('ProfKnownCount', 'Profession known'),
                mk('CountryKnownCount', 'Country (from tags)'),
                mk('SurveyedCount', 'Survey responses'),
            ];
            // Gender + Organisation type exist ONLY in the signup-survey upload
            // (the /users tags carry none, proven on real data). This is a pure
            // PROVENANCE check: re-parse the captured signup-survey receipt with the
            // SAME parser the live ingest uses, and confirm it reproduces the live
            // signup_demo MAP (entry-for-entry, not via the user set — so there is
            // no per-course vs per-user cardinality ambiguity). Proves these two
            // demographics are now backed by an immutable receipt.
            try {
                const sd = await Storage.getItem('surghub_signup_demo');
                if (sd && typeof sd === 'object' && Object.keys(sd).length) {
                    const mapCov = (map) => { let g = 0, o = 0; for (const d of Object.values(map || {})) { if (d && d.gender) g++; if (d && d.organisation_type) o++; } return { g, o }; };
                    const live = mapCov(sd);
                    const receiptRows = (window.LearnWorlds.readLatestArtifactRows && window.LearnWorlds.readLatestArtifactRows('signup-survey')) || [];
                    const parsedR = (receiptRows.length && this._parseSignupDemoFromRows) ? (this._parseSignupDemoFromRows(receiptRows) || {}) : null;
                    if (parsedR && !parsedR.missingCols) {
                        const der = mapCov(parsedR.demo);
                        const gMatch = Math.abs(der.g - live.g) <= tolOf(live.g);
                        const oMatch = Math.abs(der.o - live.o) <= tolOf(live.o);
                        const partial = 'the latest receipt has fewer entries than the live map — earlier uploads contributed the rest';
                        checks.push({ label: 'Gender (signup survey)', derived: der.g, stored: live.g, match: gMatch, note: gMatch ? 'reproduces the live gender map from the captured receipt' : partial });
                        checks.push({ label: 'Organisation type (signup survey)', derived: der.o, stored: live.o, match: oMatch, note: oMatch ? 'reproduces the live organisation map from the captured receipt' : partial });
                    } else if (parsedR && parsedR.missingCols) {
                        const badNote = 'the captured signup-survey receipt has unexpected columns and could not be parsed — re-capture it via “Sync Surveys” / re-upload';
                        checks.push({ label: 'Gender (signup survey)', derived: 0, stored: live.g, match: false, note: badNote });
                        checks.push({ label: 'Organisation type (signup survey)', derived: 0, stored: live.o, match: false, note: badNote });
                    } else {
                        const noRecNote = 'no signup-survey receipt captured yet — re-run “Sync Surveys” (or re-upload the signup survey) to capture one';
                        checks.push({ label: 'Gender (signup survey)', derived: 0, stored: live.g, match: false, noReceipt: true, note: noRecNote });
                        checks.push({ label: 'Organisation type (signup survey)', derived: 0, stored: live.o, match: false, noReceipt: true, note: noRecNote });
                    }
                }
            } catch (e) { console.warn('[derive-verify] gender/org check skipped:', e && e.message); }
            // Course metrics (Learners / Certificates / Learning Time) from the
            // course-foundation receipt, and Ambassador metrics from the
            // ambassadors + /users receipts — each in its own try so one failing
            // never blocks the others.
            try { const cc = await this._verifyCourseMetricsFromRaw(); if (cc && cc.length) checks.push(...cc); } catch (e) { console.warn('[derive-verify] course check skipped:', e && e.message); }
            try { const ac = await this._verifyAmbassadorMetricsFromRaw(usersJson); if (ac && ac.length) checks.push(...ac); } catch (e) { console.warn('[derive-verify] ambassador check skipped:', e && e.message); }
            try { const tc = await this._verifyTimelineConsistency(); if (tc && tc.length) checks.push(...tc); } catch (e) { console.warn('[derive-verify] timeline check skipped:', e && e.message); }
            this._deriveVerify = { builtAt: new Date().toISOString(), fromPull: demoDir, checks };
            try { await Storage.setItem('surghub_derive_verify', this._deriveVerify, { internal: true }); } catch (e) {}
            if (!silent) this.showMsg('Re-derive check complete ✓');
            this.renderView();
        } catch (e) { console.error('[derive-verify]', e); if (!silent) this.showMsg('⚠ Re-derive failed: ' + (e && e.message)); }
    },
    // Run the firewall automatically after a (user-initiated) sync and shout if a
    // number that previously reproduced from the receipts no longer does. Best-
    // effort: never throws into the sync. Compares against the previously stored
    // result to flag REGRESSIONS specifically (was ●, now ✗) vs persistent ▲.
    async autoVerifyAfterSync() {
        try {
            const prev = this._deriveVerify || (await Storage.getItem('surghub_derive_verify'));
            await this.verifyAudienceAgainstRaw({ silent: true });   // sets + persists this._deriveVerify
            const cur = this._deriveVerify;
            if (!cur || !cur.checks || !cur.checks.length) return;    // no demographics raw yet — stay quiet
            const prevByLabel = {}; ((prev && prev.checks) || []).forEach(c => { prevByLabel[c.label] = c; });
            // ✗ = a real mismatch (not merely an uncaptured-receipt ○).
            const failing = cur.checks.filter(c => !c.match && !c.noReceipt);
            const regressed = failing.filter(c => prevByLabel[c.label] && prevByLabel[c.label].match);
            const failLabels = failing.map(c => c.label), regrLabels = regressed.map(c => c.label);
            this._verifyAlert = failing.length ? { at: cur.builtAt, failing: failLabels, regressed: regrLabels } : null;
            const nMatch = cur.checks.filter(c => c.match).length;
            if (failing.length) {
                const lead = regrLabels.length ? ('⚠ Provenance REGRESSION — ' + regrLabels.join(', ') + ' no longer reproduce') : ('⚠ Provenance check — ' + failLabels.join(', ') + ' don’t reproduce');
                this.showMsg(lead + ' from the receipts. Open Data Health → “Re-derive from raw” to investigate.');
            } else {
                this.showMsg('✓ Provenance verified — all ' + nMatch + ' numbers reproduce from the receipts');
            }
            this.renderView();
        } catch (e) { console.warn('[auto-verify]', e && e.message); }
    },
    // Re-derive Course Learners / Certificates / Learning Time from the latest
    // course-foundation receipt (/courses/{slug}/analytics → students /
    // certificates_issued / total_study_time÷60), summed over the SAME included
    // set the dashboard uses (!IsShell, minus excluded providers), and diff
    // against the stored surghub_data totals. Read-only. Returns an array of
    // check rows (or null if surghub_data is empty).
    // Growth-timeline (CourseTimeline) CONSISTENCY check. The slow growth-timeline
    // sync is usually skipped, so NO raw receipt exists — instead of a re-derive this
    // verifies the per-course monthly timelines against the receipt-verified course
    // Learners/Certificates and flags the real failure mode: a course gains learners
    // but its timeline gets no fresh recent month, so _rescaleTimelinesToTotals smears
    // the new learners back onto OLD months. The TOTAL still reconciles (so the
    // headline is safe) but the Platform-Growth chart AND the Ask-data growth answers
    // (both trust the STORED scale) understate recent growth. Two rows: coverage
    // (a learner-bearing course with no timeline at all) and freshness (lagging
    // timelines holding undated learner mass). Consistency-only → never noReceipt.
    async _verifyTimelineConsistency() {
        const num = v => Number(v) || 0;
        // Same included set as the headline (mirrors _verifyCourseMetricsFromRaw).
        let snap = [];
        try { if (typeof this.getPlatformSnap === 'function' && Array.isArray(this.data) && this.data.length) snap = this.getPlatformSnap() || []; } catch (e) {}
        if (!snap.length) {
            const data = (await Storage.getItem('surghub_data')) || [];
            if (!Array.isArray(data) || !data.length) return null;
            let exProv = []; try { exProv = (await Storage.getItem('surghub_excluded_providers')) || []; } catch (e) {}
            const exP = new Set(exProv);
            const all = data.filter(d => d && !d.IsShell && !exP.has(d.Provider));
            const latest = {};
            all.forEach(d => { if (!latest[d.Course] || d.Timestamp > latest[d.Course].Timestamp) latest[d.Course] = d; });
            snap = Object.values(latest);
            if (this.hideLowLearners) snap = snap.filter(d => num(d.Learners) >= 50);
        }
        if (!snap.length) return null;
        const ckey = d => (window.courseKey ? window.courseKey(d) : (d.CourseId || d.Course));
        const parseTL = s => { try { return (s && typeof s === 'object') ? s : JSON.parse(s || '{}'); } catch (e) { return null; } };
        const monthRe = /^\d{4}-\d{2}$/;
        const now = new Date();
        const nowMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        const monthsBehind = (m, ref) => { if (!m || !ref) return 99; const a = m.split('-').map(Number), b = ref.split('-').map(Number); return (b[0] - a[0]) * 12 + (b[1] - a[1]); };

        let learnerBearing = 0, covered = 0, sumLtl = 0, sumCtl = 0;
        const missing = [];          // learner-bearing course with no timeline at all
        const tlRows = [];
        snap.forEach(d => {
            const L = num(d.Learners), C = num(d.Certificates);
            const ct = d.CourseTimeline ? parseTL(d.CourseTimeline) : null;
            if (L > 0) learnerBearing++;
            // Bucket timeline keys to YYYY-MM exactly like Charts.getScaledTimeline
            // (key.substring(0,7)) — some courses (e.g. FDI) store day-level keys,
            // which the chart buckets fine, so they must NOT count as "no timeline".
            let rawE = 0; const monthSet = {};
            if (ct && ct.timeline) {
                Object.keys(ct.timeline).forEach(k => {
                    const mk = String(k).substring(0, 7);
                    if (!monthRe.test(mk)) return;
                    const v = ct.timeline[k];
                    rawE += num(v && typeof v === 'object' ? v.e : v);
                    monthSet[mk] = true;
                });
            }
            const months = Object.keys(monthSet).sort();
            if (!months.length) { if (L > 0) missing.push({ k: ckey(d), L }); return; }
            if (L > 0) covered++;
            sumLtl += L; sumCtl += C;
            const escale = (ct.scale && Number(ct.scale.enrollScale)) || 1;
            tlRows.push({ k: ckey(d), L, rawE, escale, last: months[months.length - 1], undated: Math.max(0, L - rawE) });
        });

        // Freshness: a timeline LAGS when it covers <~95% of its Learners by date
        // (enrollScale > 1.05 → undated mass exists) AND its newest month is >=2 months
        // behind the current month — i.e. the undated learners are recent ones that
        // never got a bucket and were back-smeared by the rescale. (enrollScale≈1 means
        // the dated curve is complete, so an old last-month is genuine, not stale.)
        const stale = tlRows.filter(r => r.escale > 1.05 && monthsBehind(r.last, nowMonth) >= 2).sort((a, b) => b.undated - a.undated);
        const staleMass = stale.reduce((s, r) => s + r.undated, 0);

        const out = [];
        const covMatch = missing.length === 0;
        const missL = missing.reduce((s, m) => s + m.L, 0);
        out.push({
            label: 'Growth-timeline coverage',
            derived: covered, stored: learnerBearing,
            match: covMatch,
            note: covMatch
                ? covered + ' courses with learners all carry a growth timeline (Σ ' + this.formatNumber(sumLtl) + ' learners / ' + this.formatNumber(sumCtl) + ' certs reconciles with the headline).'
                : missing.length + ' course(s) with ' + this.formatNumber(missL) + ' learners have NO growth timeline — absent from the Platform-Growth chart & Ask-data trends (e.g. ' + missing.slice(0, 3).map(m => m.k).join(', ') + '). Run the growth-timeline sync.'
        });
        const tol = Math.max(100, Math.round(sumLtl * 0.01));
        const freshMatch = staleMass <= tol;
        const stalePct = sumLtl > 0 ? (staleMass / sumLtl * 100) : 0;
        out.push({
            label: 'Growth-timeline freshness',
            derived: sumLtl - staleMass, stored: sumLtl,
            match: freshMatch,
            note: freshMatch
                ? 'Recent-month shape is fresh — only ' + this.formatNumber(staleMass) + ' learners (' + stalePct.toFixed(2) + '%) sit on a lagging timeline, within the ' + this.formatNumber(tol) + ' tolerance.'
                : this.formatNumber(staleMass) + ' learners (' + stalePct.toFixed(1) + '%) sit on timelines lagging ≥2 months while the course kept gaining learners — the Platform-Growth chart & Ask-data UNDERSTATE recent growth. Worst: ' + stale.slice(0, 3).map(r => r.k + ' (→' + r.last + ', ' + this.formatNumber(r.undated) + ' undated)').join('; ') + '. Re-run the growth-timeline sync or upload User Progress.'
        });
        return out;
    },

    async _verifyCourseMetricsFromRaw() {
        const fs = electronAPI.fs, path = electronAPI.path;
        const rawDir = path.join(Storage.DATA_DIR, 'surghub', 'raw');
        const num = v => Number(v) || 0;
        // Use the dashboard's OWN included set (getPlatformSnap dedupes by course
        // name → latest timestamp, drops shells + excluded providers, honours the
        // hideLowLearners toggle) so the firewall sums EXACTLY what the headline
        // KPI sums — faithful by construction. Fall back to replicating it from
        // surghub_data only if this.data isn't loaded.
        let snap = [];
        try { if (typeof this.getPlatformSnap === 'function' && Array.isArray(this.data) && this.data.length) snap = this.getPlatformSnap() || []; } catch (e) {}
        if (!snap.length) {
            const data = (await Storage.getItem('surghub_data')) || [];
            if (!Array.isArray(data) || !data.length) return null;
            let exProv = []; try { exProv = (await Storage.getItem('surghub_excluded_providers')) || []; } catch (e) {}
            const exP = new Set(exProv);
            const all = data.filter(d => d && !d.IsShell && !exP.has(d.Provider));
            const latest = {};
            all.forEach(d => { if (!latest[d.Course] || d.Timestamp > latest[d.Course].Timestamp) latest[d.Course] = d; });
            snap = Object.values(latest);
            if (this.hideLowLearners) snap = snap.filter(d => num(d.Learners) >= 50);
        }
        const included = snap;
        const full = { L: 0, C: 0, M: 0 };
        for (const d of included) { full.L += num(d.Learners); full.C += num(d.Certificates); full.M += num(d.LearningMinutes); }
        const tolOf = s => Math.max(2, s * 0.005);
        // Gather ALL retained course-foundation receipts, newest-first. Course
        // counts are reconciled across syncs (a zero-guard preserves a prior value
        // when a pull reports 0 / can't refresh), so a course's number can be
        // backed by an EARLIER retained pull — merge them, newest usable wins.
        let cfDirs = [];
        try { cfDirs = fs.readdirSync(rawDir, { withFileTypes: true }).filter(e => e.isDirectory && /^course-foundation__/.test(e.name)).map(e => e.name).sort().reverse(); } catch (e) {}
        if (!cfDirs.length) {
            const nr = 'no course-foundation receipt yet — run Sync Courses to capture one';
            return [
                { label: 'Course learners', derived: 0, stored: full.L, match: false, noReceipt: true, note: nr },
                { label: 'Certificates', derived: 0, stored: full.C, match: false, noReceipt: true, note: nr },
                { label: 'Learning time (min)', derived: 0, stored: full.M, match: false, noReceipt: true, note: nr },
            ];
        }
        const first = (o, keys) => { for (const k of keys) { if (o && o[k] != null) return Number(o[k]) || 0; } return null; };
        // Faithfully mirror learnworlds.js _fetchCourseCounters: prefer /analytics
        // with students>0; else the /courses/{slug}/users count (meta.totalItems)
        // + /certificates fallback. anal/usersFb keep the NEWEST usable value.
        const anal = {}, usersFb = {}, certFb = {}, access = {};
        for (const dir of cfDirs) {
            let txt = ''; try { txt = String(fs.readFileSync(path.join(rawDir, dir, 'pull.jsonl'), 'utf8')); } catch (e) { continue; }
            for (const ln of txt.split('\n')) {
                if (!ln) continue; let r; try { r = JSON.parse(ln); } catch (e) { continue; }
                let b; try { b = JSON.parse(r.body); } catch (e) { continue; }
                if (r.path === '/courses') { for (const c of ((b && b.data) || [])) { if (c && c.id != null && !(String(c.id) in access)) access[String(c.id)] = c.access; } continue; }
                let m = /^\/courses\/([^/]+)\/analytics/.exec(r.path || '');
                if (m) { if (((first(b, ['students', 'enrolled_users', 'enrollments']) || 0) > 0) && !(m[1] in anal)) anal[m[1]] = b; continue; }
                m = /^\/courses\/([^/]+)\/users/.exec(r.path || '');
                if (m) { if (!(m[1] in usersFb)) usersFb[m[1]] = (b && b.meta && Number(b.meta.totalItems)) || 0; continue; }
                if (r.path === '/certificates') { const cid = r.params && r.params.course_id; if (cid != null && !(String(cid) in certFb)) certFb[String(cid)] = (b && b.meta && Number(b.meta.totalItems)) || 0; }
            }
        }
        let withId = 0, matched = 0; const der = { L: 0, C: 0, M: 0 }; const uncovered = [];
        for (const d of included) {
            const rec = { id: d.CourseId ? String(d.CourseId) : String(d.Course || '(unnamed)'), access: (d.CourseId && access[String(d.CourseId)]) || null, L: num(d.Learners), C: num(d.Certificates), M: num(d.LearningMinutes) };
            if (!d.CourseId) { if (rec.L > 0 || rec.C > 0 || rec.M > 0) uncovered.push(rec); continue; }
            withId++;
            const a = anal[d.CourseId];
            if (a) {
                matched++;
                der.L += first(a, ['students', 'enrolled_users', 'enrollments']) || 0;
                const c = first(a, ['certificates_issued', 'certificates', 'completions']); der.C += (c != null ? c : 0);
                der.M += Math.round((first(a, ['total_study_time', 'study_time', 'total_time']) || 0) / 60);
            } else if (d.CourseId in usersFb) {
                matched++; const L = usersFb[d.CourseId]; der.L += L;
                if (L > 0) der.C += (certFb[d.CourseId] != null ? certFb[d.CourseId] : 0);
                // learningMinutes is 0 on the fallback path (mirrors _fetchCourseCounters)
            } else if (rec.L > 0 || rec.C > 0 || rec.M > 0) {
                uncovered.push(rec);
            }
        }
        // LearnWorlds' /analytics reports 0 students for DRAFT (unpublished) courses,
        // so a course set to draft after it had enrolments keeps a preserved count
        // that no current pull can re-derive. Treat draft/private uncovered courses
        // as EXPECTED (analytics legitimately reports 0) and subtract their preserved
        // counts from the comparison; a PUBLISHED ('free') course going missing is a
        // real problem and keeps the row amber + named.
        const isExpectedZero = c => c.access && c.access !== 'free';
        const expected = uncovered.filter(isExpectedZero);
        // "Concerning" = a course with REAL learners that's missing from every
        // receipt (a genuine provenance gap). A 0-learner orphan/stray (e.g. a
        // legacy duplicate-title record with no slug) isn't worth a ▲ — its trivial
        // counts fall within tolerance.
        const concerning = uncovered.filter(c => !isExpectedZero(c) && (Number(c.L) || 0) > 0);
        const draftSum = { L: 0, C: 0, M: 0 };
        for (const c of expected) { draftSum.L += c.L; draftSum.C += c.C; draftSum.M += c.M; }
        const nDraft = expected.length, draftLrn = draftSum.L;
        const mk = (label, d, full_, dkey) => {
            const s = full_ - draftSum[dkey];                  // published-course total
            const match = concerning.length === 0 && Math.abs(d - s) <= tolOf(s);
            let note;
            if (match) note = nDraft > 0
                ? ('all ' + matched + ' published courses reproduce from the receipts; ' + nDraft + ' draft/archived courses (+' + this.formatNumber(draftLrn) + ' learners) carry counts preserved from history — LearnWorlds analytics reports 0 for unpublished courses, so they aren’t re-derivable (they remain in the ' + this.formatNumber(full_) + ' dashboard total)')
                : ('reproduces from the course-foundation receipts (' + matched + ' courses)');
            else if (concerning.length) { const c0 = concerning.sort((a, b) => b.L - a.L)[0]; note = concerning.length + ' PUBLISHED course(s) missing from every retained receipt — investigate (largest: ' + c0.id + ', ' + this.formatNumber(c0.L) + ' learners); re-run Sync Courses'; }
            else note = 'differs from the receipt analytics — worth investigating';
            return { label, derived: d, stored: s, match, note };
        };
        return [mk('Course learners', der.L, full.L, 'L'), mk('Certificates', der.C, full.C, 'C'), mk('Learning time (min)', der.M, full.M, 'M')];
    },
    // Re-derive Active Ambassadors / Leads / Referral Clicks from the receipts:
    // referrer_id from the already-flattened /users rows (usersJson) intersected
    // with the /affiliates roster in the latest ambassadors receipt; clicks summed
    // from that roster. Diff against stored surghub_ambassadors. Read-only.
    async _verifyAmbassadorMetricsFromRaw(usersJson) {
        const fs = electronAPI.fs, path = electronAPI.path;
        const rawDir = path.join(Storage.DATA_DIR, 'surghub', 'raw');
        const stored = (await Storage.getItem('surghub_ambassadors')) || {};
        // Compare against the canonical /users-derived attribution fields when
        // present (the firewall re-derives from /users, so this is apples-to-
        // apples and unaffected by the date-filtered leads-endpoint fallback that
        // can back the displayed TotalReferrals/TotalAmbassadors). Fall back to the
        // headline values only if the /users attribution wasn't stored.
        const sActive = (stored.ActiveAmbassadorsFromUsers != null) ? Number(stored.ActiveAmbassadorsFromUsers) : (Number(stored.TotalAmbassadors) || 0);
        const sLeads = (stored.AttributableFromUsers != null) ? Number(stored.AttributableFromUsers) : (Number(stored.TotalReferrals) || 0);
        const sClicks = Number(stored.TotalClicks) || 0;
        const tolOf = s => Math.max(2, s * 0.005);
        let ambDir = null;
        try { ambDir = fs.readdirSync(rawDir, { withFileTypes: true }).filter(e => e.isDirectory && /^ambassadors__/.test(e.name)).map(e => e.name).sort().pop(); } catch (e) {}
        if (!ambDir) {
            const nr = 'no ambassadors receipt yet — run Sync Ambassadors to capture one';
            return [
                { label: 'Active ambassadors', derived: 0, stored: sActive, match: false, noReceipt: true, note: nr },
                { label: 'Ambassador leads', derived: 0, stored: sLeads, match: false, noReceipt: true, note: nr },
                { label: 'Referral clicks', derived: 0, stored: sClicks, match: false, noReceipt: true, note: nr },
            ];
        }
        const roster = new Set(); let clicks = 0;
        for (const ln of String(fs.readFileSync(path.join(rawDir, ambDir, 'pull.jsonl'), 'utf8')).split('\n')) {
            if (!ln) continue; let r; try { r = JSON.parse(ln); } catch (e) { continue; }
            if (r.path !== '/affiliates') continue;
            let b; try { b = JSON.parse(r.body); } catch (e) { continue; }
            for (const a of ((b && b.data) || [])) { roster.add(String(a.id)); clicks += Number(a.clicks) || 0; }
        }
        const refc = {};
        for (const u of (usersJson || [])) { const rid = u && u.referrer_id; if (rid != null && String(rid).trim() !== '') { const k = String(rid); refc[k] = (refc[k] || 0) + 1; } }
        let active = 0, leads = 0;
        for (const k of Object.keys(refc)) { if (roster.has(k)) { active++; leads += refc[k]; } }
        const mk = (label, d, s, okNote) => { const match = Math.abs(d - s) <= tolOf(s); return { label, derived: d, stored: s, match, note: match ? okNote : 'differs from the receipts — if the /users and affiliates pulls are from different syncs, re-sync both together' }; };
        return [
            mk('Active ambassadors', active, sActive, 'reproduces from the /users referrer_id × affiliates roster'),
            mk('Ambassador leads', leads, sLeads, 'reproduces from the /users referrer_id × affiliates roster'),
            mk('Referral clicks', clicks, sClicks, 'reproduces from the affiliates receipt'),
        ];
    },
    // Small pill showing a course's real LearnWorlds publication status
    // (access: 'free' → Published, 'private' → Private, 'draft' → Draft).
    // Returns '' when unknown so older un-resynced records render unchanged.
    _courseStatusBadge(access) {
        if (!access) return '';
        const map = { free: ['Published', 'bg-green-100 text-green-700'], private: ['Private', 'bg-sky-100 text-sky-700'], draft: ['Draft', 'bg-amber-100 text-amber-700'] };
        const m = map[String(access).toLowerCase()];
        if (!m) return '';
        return ` <span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold align-middle ${m[1]}" title="LearnWorlds course status">${m[0]}</span>`;
    },
    _deriveVerifySection() {
        const dv = this._deriveVerify;
        if (!dv) {
            return `<div class="bg-white p-6 rounded-xl shadow-sm border mb-8"><div class="flex items-center justify-between gap-3 flex-wrap"><div><h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="git-compare-arrows" class="text-gsf-boston"></i> Re-derive from raw (provenance check)</h2><p class="text-xs text-slate-500 mt-1">Re-runs the live aggregation over the captured raw and checks the numbers reproduce — proof your figures are traceable to the receipts.</p></div><button onclick="App.verifyAudienceAgainstRaw()" class="shrink-0 px-4 py-2 bg-gsf-boston text-white text-sm font-bold rounded-lg hover:bg-gsf-prussian transition-colors"><i data-lucide="git-compare-arrows" class="inline mr-1.5" width="14"></i> Verify against raw</button></div></div>`;
        }
        const rows = dv.checks.map(c => {
            const icon = c.match ? '<span class="text-green-600">●</span>' : (c.noReceipt ? '<span class="text-slate-400">○</span>' : '<span class="text-amber-500">▲</span>');
            const detail = c.note || (c.match ? 'reproduces from the receipts exactly' : 'differs — worth investigating');
            return `<div class="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0"><span class="mt-0.5 text-xs">${icon}</span><div class="min-w-0 flex-1"><div class="flex items-center justify-between gap-3"><p class="text-sm font-bold text-gsf-prussian">${c.label}</p><p class="text-sm text-slate-500" style="font-family:var(--num)">${this.formatNumber(c.derived)} <span class="text-slate-400 font-normal">vs ${this.formatNumber(c.stored)} stored</span></p></div><p class="text-xs text-slate-500">${detail}</p></div></div>`;
        }).join('');
        const nMatch = dv.checks.filter(c => c.match).length;
        const failing = dv.checks.filter(c => !c.match && !c.noReceipt);
        const banner = failing.length
            ? `<div class="bg-red-50 border-b border-red-200 px-5 py-3 flex items-start gap-2"><span class="text-red-600 text-sm mt-0.5">⚠</span><div class="text-xs text-red-700 leading-relaxed"><span class="font-bold">${failing.length} number${failing.length > 1 ? 's' : ''} no longer reproduce${failing.length > 1 ? '' : 's'} from the receipts:</span> ${failing.map(c => this.escapeHtml(c.label)).join(', ')}. Investigate before trusting ${failing.length > 1 ? 'these figures' : 'this figure'} in a report.</div></div>`
            : '';
        return `<div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-8"><div class="bg-slate-50 border-b p-5 flex justify-between items-start gap-3 flex-wrap"><div><h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="git-compare-arrows" class="text-gsf-boston"></i> Re-derive from raw (provenance check)</h2><p class="text-xs text-slate-500 mt-1">Runs automatically after every sync, and re-ran here over the captured receipts — ${nMatch}/${dv.checks.length} reproduce exactly. ● reproduces · ▲ differs · ○ no receipt captured yet.</p></div><button onclick="App.verifyAudienceAgainstRaw()" class="shrink-0 px-3 py-1.5 border rounded-lg text-xs font-bold text-slate-600 hover:text-gsf-boston hover:bg-slate-50 transition-colors"><i data-lucide="refresh-cw" width="12"></i> Re-check</button></div>${banner}<div class="px-5 py-2">${rows}</div></div>`;
    },

    _ambassadorAwards(snap) {
        const promoters = (snap && snap.Promoters) || {};
        const clicks = (snap && snap.ClicksByPromoter) || {};
        const tl = (snap && snap.PromoterTimeline) || {};
        const names = Object.keys(promoters);
        // Downstream-outcome awards source: the raw-built referrer bridge, when it
        // carries learner outcomes. Named + PII-safe (drops unnamed/email entries).
        const bridge = this._referrerBridge;
        const hasOut = !!(bridge && bridge.hasOutcomes && Array.isArray(bridge.byName) && bridge.byName.length);
        if (names.length < 3 && !hasOut) return '';
        const medal = r => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : '';
        // Drop email-form promoter names before ranking — same PII withholding the
        // table/scatter/re-engagement/outcome-award surfaces use (an ambassador's CSV
        // name is sometimes an email). AND with the supplied eligibleFn (e.g. clicks>=20).
        const rank = (scoreFn, eligibleFn) => names.filter(n => n.indexOf('@') < 0 && (eligibleFn ? eligibleFn(n) : true)).map(n => ({ n, v: scoreFn(n) })).filter(o => o.v > 0).sort((a, b) => b.v - a.v).slice(0, 3);
        const outRank = (key) => hasOut
            ? bridge.byName.filter(x => x.name && x.name !== '(unnamed referrer)' && x.name.indexOf('@') < 0)
                .map(x => ({ n: x.name, v: Number(x[key]) || 0 })).filter(o => o.v > 0)
                .sort((a, b) => b.v - a.v).slice(0, 3)
            : [];
        // Per-ambassador REFERRALS = complete bridge reach when built (the source the
        // headline "Attributable Referrals" card uses), else synced promoter leads.
        const complete = !!(bridge && Array.isArray(bridge.byName) && bridge.byName.length);
        const referralTop = complete
            ? bridge.byName.filter(x => x.name && x.name !== '(unnamed referrer)' && x.name.indexOf('@') < 0)
                .map(x => ({ n: x.name, v: Number(x.reach) || 0 })).filter(o => o.v > 0)
                .sort((a, b) => b.v - a.v).slice(0, 3)
            : rank(n => promoters[n] || 0);
        const cats = [
            { label: 'Most Referrals', icon: 'user-plus', color: '#4389C8', fmt: v => this.formatNumber(v), top: referralTop },
            { label: 'Most Link Clicks', icon: 'mouse-pointer-click', color: '#E28743', fmt: v => this.formatNumber(v), top: rank(n => clicks[n] || 0) },
            { label: 'Best Conversion', icon: 'percent', color: '#3FB984', fmt: v => v.toFixed(0) + '%', top: rank(n => (clicks[n] >= 20 ? (promoters[n] || 0) / clicks[n] * 100 : 0), n => (clicks[n] || 0) >= 20) },
            { label: 'Most Consistent', icon: 'calendar-check', color: '#7A9E9F', fmt: v => v + (v === 1 ? ' mo' : ' mos'), top: rank(n => Object.keys(tl[n] || {}).filter(m => (tl[n][m] || 0) > 0).length) },
            { label: 'Most Learner Certs', icon: 'award', color: '#3FB984', fmt: v => this.formatNumber(v), top: outRank('certs') },
            { label: 'Most Learner Enrolments', icon: 'book-open', color: '#206095', fmt: v => this.formatNumber(v), top: outRank('courses') },
        ].filter(c => c.top.length);
        if (!cats.length) return '';
        return `<div class="bg-white rounded-xl shadow-sm border p-6 mb-8">
            <h3 class="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1 flex items-center gap-2"><i data-lucide="trophy" class="text-amber-500" width="15"></i> Ambassador Awards</h3>
            <p class="text-xs text-slate-400 mb-4">Top performers across all ambassadors · as of ${this._currentQuarterLabel()}</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                ${cats.map(c => `<div class="rounded-lg border border-slate-200 p-3" style="border-left:3px solid ${c.color}">
                    <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5"><i data-lucide="${c.icon}" width="12" style="color:${c.color}"></i>${c.label}</p>
                    <ol class="space-y-1.5">${c.top.map((o, i) => `<li class="flex items-center gap-2 text-sm"><span class="w-4 text-center">${medal(i + 1)}</span><span class="font-semibold text-gsf-prussian truncate flex-1" title="${this.escapeHtml(o.n)}">${this.escapeHtml(o.n)}</span><span class="text-slate-500 text-xs font-bold shrink-0">${c.fmt(o.v)}</span></li>`).join('')}</ol>
                </div>`).join('')}
            </div>
        </div>`;
    },

    _ambassadorPerformanceTable(snap) {
        const clicksByP = (snap && snap.ClicksByPromoter) || {};
        const promoters = (snap && snap.Promoters) || {};
        // Leads source: the COMPLETE raw attribution if it's been built (names every
        // referrer, incl. the ones the sync couldn't put a name to), else the synced
        // promoter list. Clicks overlay by name where available.
        const bridge = this._referrerBridge;
        const complete = !!(bridge && Array.isArray(bridge.byName) && bridge.byName.length);
        const leadsByName = {};
        if (complete) bridge.byName.forEach(x => { leadsByName[x.name] = x.reach; });
        else Object.keys(promoters).forEach(n => { leadsByName[n] = Number(promoters[n]) || 0; });
        if (Object.keys(leadsByName).length === 0 && Object.keys(clicksByP).length === 0) return '';
        // Downstream learner OUTCOMES (courses/certs earned by each ambassador's
        // referred learners) when the raw-built bridge carries them.
        const showOut = !!(complete && bridge.hasOutcomes);
        const outByName = {};
        if (showOut) bridge.byName.forEach(x => { outByName[x.name] = { active: x.active || 0, courses: x.courses || 0, certs: x.certs || 0, minutes: x.minutes || 0 }; });
        const names = new Set([...Object.keys(leadsByName), ...Object.keys(clicksByP)]);
        const rows = [...names].map(name => {
            const leads = Number(leadsByName[name]) || 0;
            const clicks = Number(clicksByP[name]) || 0;
            const o = outByName[name];
            return { name, leads, clicks, convNum: clicks > 0 ? (leads / clicks) * 100 : -1, conv: clicks > 0 ? ((leads / clicks) * 100).toFixed(1) + '%' : '–', active: o ? o.active : null, courses: o ? o.courses : null, certs: o ? o.certs : null, minutes: o ? o.minutes : null };
        });
        // Sortable by column (mirrors the All-Courses table). Default: leads desc.
        const sortCol = this._ambSortCol || 'leads';
        const sortAsc = this._ambSortCol ? !!this._ambSortAsc : false;
        rows.sort((a, b) => {
            let va, vb;
            if (sortCol === 'name') { va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase(); }
            else if (sortCol === 'conv') { va = a.convNum; vb = b.convNum; }
            else { va = a[sortCol] == null ? -1 : a[sortCol]; vb = b[sortCol] == null ? -1 : b[sortCol]; }
            if (va < vb) return sortAsc ? -1 : 1;
            if (va > vb) return sortAsc ? 1 : -1;
            return (b.leads - a.leads) || (b.clicks - a.clicks); // stable tiebreak
        });
        const totalNamed = rows.length;
        rows.splice(200); // cap display
        const body = rows.map(r => `<tr class="border-b last:border-0 hover:bg-slate-50">
            <td class="py-2 px-4 font-medium text-gsf-prussian">${this.escapeHtml(r.name.indexOf('@') >= 0 ? 'Ambassador (name withheld)' : r.name)}</td>
            <td class="py-2 px-4 text-right font-bold text-gsf-boston">${this.formatNumber(r.leads)}</td>
            <td class="py-2 px-4 text-right text-slate-600">${this.formatNumber(r.clicks)}</td>
            <td class="py-2 px-4 text-right text-slate-500 text-xs">${r.conv}</td>
            ${showOut ? `<td class="py-2 px-4 text-right text-slate-600">${r.active == null ? '–' : this.formatNumber(r.active)}</td><td class="py-2 px-4 text-right text-slate-600">${r.courses == null ? '–' : this.formatNumber(r.courses)}</td><td class="py-2 px-4 text-right font-semibold text-emerald-700">${r.certs == null ? '–' : this.formatNumber(r.certs)}</td><td class="py-2 px-4 text-right text-slate-500">${r.minutes == null ? '–' : this.formatNumber(Math.round(r.minutes / 60))}</td>` : ''}
        </tr>`).join('');
        const note = complete
            ? `Complete attribution — every one of ${this.formatNumber(bridge.distinctReferrers)} referrers matched to a name (${this.formatNumber(bridge.totalBridged)} referrals), recovered from the raw capture. Referrals = signups via referral · Clicks = referral-link visits.${showOut ? ` <strong>Active</strong> = referred learners who started a course · <strong>Learner courses / certs</strong> = courses enrolled and certificates earned by those learners · <strong>Learning hrs</strong> = total learning time they logged — ${this.formatNumber(bridge.totalCerts)} certs / ${this.formatNumber(bridge.totalCourses)} courses / ${this.formatNumber(Math.round((bridge.totalMinutes || 0) / 60))} hrs across ${this.formatNumber(bridge.activeLearners)} active referred learners, as of the last User-Progress upload.` : ''}`
            : `Referrals = signups via referral · Clicks = referral-link visits · Conversion = referrals ÷ clicks. ${totalNamed > 200 ? 'Showing the top 200 of ' + this.formatNumber(totalNamed) : 'Showing the ' + totalNamed} named referrers from the last sync — a few referrals aren't yet matched to a name.`;
        const buildBtn = complete
            ? `<button onclick="App.buildReferrerBridgeFromRaw()" class="shrink-0 px-3 py-1.5 border rounded-lg text-xs font-bold text-slate-600 hover:text-gsf-boston hover:bg-slate-50 transition-colors" title="Re-match referrals to names from the latest raw capture"><i data-lucide="refresh-cw" width="12"></i> Refresh</button>`
            : `<button onclick="App.buildReferrerBridgeFromRaw()" class="shrink-0 px-3 py-1.5 bg-gsf-boston text-white text-xs font-bold rounded-lg hover:bg-gsf-prussian transition-colors" title="Match every referral to a name using the raw capture — names the ambassadors the sync missed"><i data-lucide="git-merge" width="12"></i> Complete from raw</button>`;
        const arrow = (c) => sortCol === c
            ? (sortAsc ? '&#9650;' : '&#9660;')
            : '<span class="text-slate-300">&#8597;</span>';
        const th = (key, label, align) =>
            `<th class="py-3 px-4 font-medium ${align || ''} cursor-pointer hover:text-gsf-boston select-none" onclick="App._sortAmbDir('${key}')">${label} ${arrow(key)}</th>`;
        return `<div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-8">
            <div class="bg-slate-50 border-b p-5 flex justify-between items-start gap-3 flex-wrap"><div><h3 class="text-lg font-bold text-gsf-prussian">Ambassador Performance</h3>
                <p class="text-xs text-slate-500 mt-1">${note}</p><p class="text-[11px] text-slate-400 mt-1">Click a column header to sort.</p></div>${buildBtn}</div>
            <div class="overflow-x-auto max-h-[480px] overflow-y-auto custom-scrollbar">
                <table class="w-full text-left border-collapse text-sm">
                    <thead class="sticky top-0 bg-white shadow-sm z-10"><tr class="border-b text-slate-500">
                        ${th('name', 'Ambassador')}
                        ${th('leads', 'Referrals', 'text-right')}
                        ${th('clicks', 'Clicks', 'text-right')}
                        ${th('conv', 'Conversion', 'text-right')}
                        ${showOut ? th('active', 'Active', 'text-right') + th('courses', 'Learner courses', 'text-right') + th('certs', 'Learner certs', 'text-right') + th('minutes', 'Learning hrs', 'text-right') : ''}
                    </tr></thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
        </div>`;
    },

    // Program-health: ambassadors who were active but have gone quiet. Flags anyone
    // with prior real activity (>= MIN_PRIOR total leads) whose last month with any
    // leads is >= DORMANT_MONTHS before the most recent month present in the data.
    // Source: snap.PromoterTimeline (name → {YYYY-MM: leads}) — name + month only,
    // no contact data. (PromoterTimeline starts 2023-05 and drops undated leads, so
    // this is a "recently gone quiet" signal, not a full lifetime history.)
    _ambassadorReengagement(snap) {
        const DORMANT_MONTHS = 3, MIN_PRIOR = 5, MAX_SHOW = 12;
        const tl = (snap && snap.PromoterTimeline) || {};
        const names = Object.keys(tl);
        if (names.length < 5) return '';
        let latest = '';
        names.forEach(n => Object.keys(tl[n] || {}).forEach(m => { if ((tl[n][m] || 0) > 0 && m > latest) latest = m; }));
        if (!latest) return '';
        const monthsBetween = (a, b) => { const [ay, am] = a.split('-').map(Number); const [by, bm] = b.split('-').map(Number); return (by - ay) * 12 + (bm - am); };
        const dormant = names.map(n => {
            const series = tl[n] || {};
            const active = Object.keys(series).filter(m => (series[m] || 0) > 0);
            if (!active.length) return null;
            const total = active.reduce((s, m) => s + (series[m] || 0), 0);
            const lastActive = active.sort().pop();
            return { n, total, lastActive, gap: monthsBetween(lastActive, latest) };
        }).filter(Boolean)
            .filter(x => x.total >= MIN_PRIOR && x.gap >= DORMANT_MONTHS && x.n.indexOf('@') < 0)
            .sort((a, b) => b.total - a.total || b.gap - a.gap);
        if (!dormant.length) return '';
        const shown = dormant.slice(0, MAX_SHOW);
        const moLabel = m => new Date(m + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        const rows = shown.map(x => `<li class="flex items-center justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
            <span class="font-semibold text-gsf-prussian truncate flex-1" title="${this.escapeHtml(x.n)}">${this.escapeHtml(x.n)}</span>
            <span class="text-xs text-slate-500 shrink-0">${this.formatNumber(x.total)} leads · last active <span class="font-semibold text-slate-600">${moLabel(x.lastActive)}</span> <span class="text-amber-600">(${x.gap} mo ago)</span></span>
        </li>`).join('');
        const more = dormant.length > MAX_SHOW ? `<p class="text-[11px] text-slate-400 mt-2">+ ${this.formatNumber(dormant.length - MAX_SHOW)} more dormant ambassador${dormant.length - MAX_SHOW === 1 ? '' : 's'}.</p>` : '';
        return `<div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-8">
            <div class="bg-amber-50 border-b border-amber-100 p-5">
                <h3 class="text-lg font-bold text-gsf-prussian flex items-center gap-2"><i data-lucide="bell-ring" class="text-amber-500" width="18"></i> Needs Re-engagement <span class="text-sm font-semibold text-amber-600">(${this.formatNumber(dormant.length)})</span></h3>
                <p class="text-xs text-slate-500 mt-1">Ambassadors with ${MIN_PRIOR}+ historic referrals who have brought no new leads in the last ${DORMANT_MONTHS} months (latest data month: ${moLabel(latest)}). Worth a nudge.</p>
            </div>
            <div class="p-5"><ol class="space-y-0.5">${rows}</ol>${more}</div>
        </div>`;
    },
    formatDate(dateString) {
        if (!dateString) return 'No Date';
        const [y, m, d] = dateString.split('-');
        return new Date(y, m - 1, d || 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },
    escapeHtml(unsafe) {
        if (!unsafe) return '';
        return String(unsafe).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    },

    // Chart export buttons (copy + download) for SURGhub charts
    // Toggle to include the current (incomplete) calendar month in monthly timeline charts.
    // Default: hide partial months for a cleaner view (matches Stripe / Mixpanel etc.).
    _partialMonthToggle() {
        const cm = (window.Charts && Charts._currentMonth) ? Charts._currentMonth() : '';
        const monthLabel = cm ? new Date(cm + '-01').toLocaleDateString('en-US', { month: 'short' }) : 'current month';
        return `<label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer ml-auto" title="When off, only complete months are shown to avoid the misleading flatline at the end. Turn on to see the in-progress month.">
            <input type="checkbox" data-viewer-allowed ${this.includePartialMonth ? 'checked' : ''} onchange="App.includePartialMonth=this.checked; App.renderView()">
            <span>Include ${this.escapeHtml(monthLabel)} (partial)</span>
        </label>`;
    },
    // Footnote shown beneath a chart when the partial month is included.
    _partialMonthCaption() {
        if (!this.includePartialMonth || !window.Charts || !window.Charts._partialMonthCaption) return '';
        const txt = Charts._partialMonthCaption();
        return `<p class="text-[11px] text-slate-400 italic mt-2 text-right">⚠ ${txt}. Cumulative growth may appear to slow until the month completes.</p>`;
    },

    _chartBtns(elementId, name) {
        return `<div class="flex items-center gap-1 ml-auto">
            <button data-copy-chart="${elementId}" onclick="Charts.copyChart('${elementId}')" title="Copy to clipboard" class="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"><i data-lucide="copy" width="11"></i></button>
            <button onclick="Charts.downloadChart('${elementId}','${(name||elementId).replace(/'/g,'')}')" title="Download PNG" class="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"><i data-lucide="download" width="11"></i></button>
        </div>`;
    },

    // Compute joiner stats for a specific period.
    // - periodDays + anchor ('now'|'prev'): preset window. "now" excludes today (partial day skews stats).
    // - explicitRange { startStr, endStr }: literal date range. anchor='prev' computes immediately-prior window of equal length.
    _computeJoinersForPeriod(snap, periodDays, anchor, explicitRange) {
        const dailyMap = snap.SignupsDaily ? this._safeParseObj(snap.SignupsDaily) : null;
        const monthlyMap = snap.Signups ? this._safeParseObj(snap.Signups) : {};
        const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const parseYMD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
        // Calendar-day arithmetic (DST-safe — avoids ms drift across clock changes,
        // which would otherwise make a "last 7 days" window span 8 days near a transition).
        const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
        const today = new Date(); today.setHours(0,0,0,0);
        // Yesterday — used as the latest "fully-counted" day (today is still partial)
        const yesterday = addDays(today, -1);
        // Preset windows (last 7/30/90) end on the day BEFORE the last data sync.
        // The sync day itself is a partial day (data was pulled mid-day), so the
        // last fully-counted day is the day prior. Sync date = the selected snapshot
        // date (falling back to the snapshot's own Timestamp, then calendar yesterday).
        const _syncStr = (this.selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(this.selectedDate)) ? this.selectedDate
            : (snap.Timestamp && /^\d{4}-\d{2}-\d{2}/.test(String(snap.Timestamp)) ? String(snap.Timestamp).slice(0, 10) : null);
        const anchorDay = _syncStr ? addDays(parseYMD(_syncStr), -1) : yesterday;

        let startDate, endDate, days;
        if (explicitRange && explicitRange.startStr && explicitRange.endStr) {
            const a = parseYMD(explicitRange.startStr);
            const b = parseYMD(explicitRange.endStr);
            startDate = a <= b ? a : b;
            endDate   = a <= b ? b : a;
            days = Math.round((endDate - startDate) / 86400000) + 1;
            if (anchor === 'prev') {
                // Prior window of same length, ending the day before start
                endDate   = addDays(startDate, -1);
                startDate = addDays(endDate, -(days - 1));
            }
        } else {
            days = periodDays;
            if (anchor === 'prev') {
                // Window ending the day before the "now" window (relative to the data's latest day)
                endDate   = addDays(anchorDay, -periodDays);
                startDate = addDays(endDate, -(periodDays - 1));
            } else {
                // "Now" window ends the day before the last data sync
                endDate   = anchorDay;
                startDate = addDays(anchorDay, -(periodDays - 1));
            }
        }
        const startStr = fmt(startDate), endStr = fmt(endDate);

        let total = 0;
        let usedDaily = false;
        if (dailyMap && Object.keys(dailyMap).length > 0) {
            usedDaily = true;
            Object.entries(dailyMap).forEach(([day, n]) => {
                if (day >= startStr && day <= endStr) total += n;
            });
        } else {
            // Approximate using monthly: sum monthly buckets, scaling partial months by days-in-window
            Object.entries(monthlyMap).forEach(([month, n]) => {
                const [y, m] = month.split('-').map(Number);
                const monthStart = new Date(y, m - 1, 1);
                const monthEnd   = new Date(y, m, 0); // last day of month
                const overlapStart = monthStart > startDate ? monthStart : startDate;
                const overlapEnd   = monthEnd   < endDate   ? monthEnd   : endDate;
                if (overlapEnd >= overlapStart) {
                    const overlapDays = Math.round((overlapEnd - overlapStart) / 86400000) + 1;
                    const monthDays   = Math.round((monthEnd - monthStart) / 86400000) + 1;
                    total += Math.round(n * (overlapDays / monthDays));
                }
            });
        }
        return {
            total,
            avgDaily: days > 0 ? total / days : 0,
            startStr, endStr, days,
            usedDaily
        };
    },

    _safeParseObj(strOrObj) {
        if (!strOrObj) return {};
        if (typeof strOrObj === 'object') return strOrObj;
        try { return JSON.parse(strOrObj) || {}; } catch (_) { return {}; }
    },

    _renderDailyJoinersPanel(snap) {
        return this._renderRatePanel(snap, {
            periodKey: 'joinersPeriodDays', csKey: 'joinersCustomStart', ceKey: 'joinersCustomEnd',
            csbKey: 'joinersCustomStartB', cebKey: 'joinersCustomEndB',
            title: 'Daily Joiners', icon: 'user-plus', noun: 'new users joining'
        });
    },
    // Daily certificates awarded — mirrors Daily Joiners but sourced from the
    // per-course growth timelines (cert dates), aggregated platform-wide.
    _renderDailyCertsPanel() {
        return this._renderRatePanel(this._buildCertDailySnap(), {
            periodKey: 'certsPeriodDays', csKey: 'certsCustomStart', ceKey: 'certsCustomEnd',
            csbKey: 'certsCustomStartB', cebKey: 'certsCustomEndB',
            title: 'Daily Certificates', icon: 'award', noun: 'certificates awarded'
        });
    },
    // Build a {SignupsDaily, Signups} snapshot of daily/monthly certificate counts
    // from course CourseTimelines (cert field, scaled), so the rate panel can reuse
    // the same period logic as Daily Joiners. Returns null when no cert dates exist.
    _buildCertDailySnap() {
        // True daily certificate counts from the per-learner completion records
        // (certificate_date is a real award date). CourseTimeline is only monthly,
        // so it can't power a daily 7/30/90-day window — that produced the
        // bogus '1 this week vs 2,532 last week' artifact.
        const comp = this._rawCompletion || [];
        if (!comp.length) return null;
        const daily = {}, monthly = {};
        let any = false;
        comp.forEach(r => {
            if (!r.certificate) return;
            const d = String(r.certificate_date || r.completion_date || '').slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
            daily[d] = (daily[d] || 0) + 1;
            const m = d.slice(0, 7);
            monthly[m] = (monthly[m] || 0) + 1;
            any = true;
        });
        if (!any) return null;
        return { SignupsDaily: daily, Signups: monthly };
    },
    // Generic "average per day" comparison panel (period presets + custom A/B
    // ranges). Powers both Daily Joiners and Daily Certificates via cfg state keys.
    _renderRatePanel(snap, cfg) {
        if (!snap || !snap.Signups) return '';
        const period = this[cfg.periodKey] || 30;
        const isCustom = period === 'custom';
        const PERIODS = [
            { d: 7,   l: 'Last 7 days' },
            { d: 30,  l: 'Last 30 days' },
            { d: 90,  l: 'Last 90 days' },
            { d: 180, l: 'Last 6 months' },
            { d: 365, l: 'Last 12 months' }
        ];

        // Default custom ranges when first switching to custom mode
        const today = new Date(); today.setHours(0,0,0,0);
        const yesterday = new Date(today.getTime() - 86400000);
        const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (isCustom && (!this[cfg.csKey] || !this[cfg.ceKey])) {
            this[cfg.ceKey] = fmt(yesterday);
            this[cfg.csKey] = fmt(new Date(yesterday.getTime() - 29 * 86400000));
        }
        if (isCustom && (!this[cfg.csbKey] || !this[cfg.cebKey])) {
            const aStart = new Date(this[cfg.csKey]);
            const aEnd   = new Date(this[cfg.ceKey]);
            const aDays  = Math.round((aEnd - aStart) / 86400000) + 1;
            const bEnd   = new Date(aStart.getTime() - 86400000);
            const bStart = new Date(bEnd.getTime() - (aDays - 1) * 86400000);
            this[cfg.cebKey] = fmt(bEnd);
            this[cfg.csbKey] = fmt(bStart);
        }

        let cur, prev;
        if (isCustom) {
            cur  = this._computeJoinersForPeriod(snap, null, 'now',  { startStr: this[cfg.csKey],  endStr: this[cfg.ceKey] });
            prev = this._computeJoinersForPeriod(snap, null, 'now',  { startStr: this[cfg.csbKey], endStr: this[cfg.cebKey] });
        } else {
            cur  = this._computeJoinersForPeriod(snap, period, 'now');
            prev = this._computeJoinersForPeriod(snap, period, 'prev');
        }

        const fmtN = (n) => Math.round(n).toLocaleString();
        const fmtAvg = (n) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1));
        const deltaAvg = cur.avgDaily - prev.avgDaily;
        const pctChange = prev.avgDaily > 0 ? ((deltaAvg / prev.avgDaily) * 100) : (cur.avgDaily > 0 ? 100 : 0);
        const arrow = deltaAvg > 0 ? '▲' : (deltaAvg < 0 ? '▼' : '–');
        const deltaColor = deltaAvg > 0 ? '#10B981' : (deltaAvg < 0 ? '#D03734' : '#94a3b8');

        const periodBtns = PERIODS.map(p => `
            <button onclick="App.${cfg.periodKey}=${p.d}; App.renderView()"
                class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${!isCustom && period === p.d ? 'bg-gsf-boston text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}">${p.l}</button>
        `).join('') + `
            <button onclick="App.${cfg.periodKey}='custom'; App.renderView()"
                class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${isCustom ? 'bg-gsf-boston text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}">
                <i data-lucide="calendar" width="11"></i> Custom
            </button>`;

        const customControls = isCustom ? `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <div class="p-3 bg-gsf-boston/5 rounded-lg border border-gsf-boston/20">
                    <p class="text-[10px] font-bold uppercase tracking-wide text-gsf-boston mb-2">Period A (current)</p>
                    <div class="flex flex-wrap items-center gap-2">
                        <input type="date" value="${this[cfg.csKey] || ''}" max="${fmt(yesterday)}"
                            onchange="App.${cfg.csKey}=this.value; App.renderView()"
                            class="bg-white border rounded px-2 py-1 text-slate-700 outline-none text-xs" />
                        <span class="text-xs font-semibold text-slate-500">→</span>
                        <input type="date" value="${this[cfg.ceKey] || ''}" max="${fmt(yesterday)}"
                            onchange="App.${cfg.ceKey}=this.value; App.renderView()"
                            class="bg-white border rounded px-2 py-1 text-slate-700 outline-none text-xs" />
                        <span class="text-[11px] text-slate-400">(${cur.days} day${cur.days !== 1 ? 's' : ''})</span>
                    </div>
                </div>
                <div class="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2">Period B (compare)</p>
                    <div class="flex flex-wrap items-center gap-2">
                        <input type="date" value="${this[cfg.csbKey] || ''}" max="${fmt(yesterday)}"
                            onchange="App.${cfg.csbKey}=this.value; App.renderView()"
                            class="bg-white border rounded px-2 py-1 text-slate-700 outline-none text-xs" />
                        <span class="text-xs font-semibold text-slate-500">→</span>
                        <input type="date" value="${this[cfg.cebKey] || ''}" max="${fmt(yesterday)}"
                            onchange="App.${cfg.cebKey}=this.value; App.renderView()"
                            class="bg-white border rounded px-2 py-1 text-slate-700 outline-none text-xs" />
                        <span class="text-[11px] text-slate-400">(${prev.days} day${prev.days !== 1 ? 's' : ''})</span>
                        <button onclick="App.${cfg.csbKey}=''; App.${cfg.cebKey}=''; App.renderView()" title="Reset to immediately-prior window" class="ml-1 text-slate-400 hover:text-gsf-boston text-[10px] underline">reset</button>
                    </div>
                </div>
            </div>` : '';

        const dataNote = cur.usedDaily
            ? '<span class="text-emerald-600">Daily resolution</span>'
            : '<span class="text-amber-600" title="Re-upload the source file with the latest version of the app to enable daily resolution.">Approximated from monthly data</span>';

        return `
            <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
                <div class="flex flex-wrap items-end justify-between gap-3 mb-4">
                    <div>
                        <h3 class="text-lg font-bold text-gsf-prussian flex items-center gap-2"><i data-lucide="${cfg.icon}" width="16" class="text-gsf-boston"></i> ${cfg.title}</h3>
                        <p class="text-xs text-slate-400 mt-0.5">Average ${cfg.noun} per day. ${dataNote}</p>
                    </div>
                    <div class="flex flex-wrap gap-1.5">${periodBtns}</div>
                </div>
                ${customControls}

                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div class="bg-gradient-to-br from-gsf-boston/5 to-gsf-prussian/5 rounded-xl border border-gsf-boston/20 p-5">
                        <p class="text-[10px] font-bold uppercase tracking-wide text-gsf-boston mb-1">${isCustom ? 'Period A' : 'This Period'}</p>
                        <p class="text-3xl font-black text-gsf-prussian leading-tight">${fmtAvg(cur.avgDaily)}<span class="text-base text-slate-400 font-medium ml-1">/ day</span></p>
                        <p class="text-xs text-slate-500 mt-1">${fmtN(cur.total)} total · ${cur.startStr} → ${cur.endStr}</p>
                    </div>

                    <div class="bg-slate-50 rounded-xl border border-slate-200 p-5">
                        <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">${isCustom ? 'Period B' : 'Prior Period'}</p>
                        <p class="text-3xl font-black text-slate-500 leading-tight">${fmtAvg(prev.avgDaily)}<span class="text-base text-slate-400 font-medium ml-1">/ day</span></p>
                        <p class="text-xs text-slate-400 mt-1">${fmtN(prev.total)} total · ${prev.startStr} → ${prev.endStr}</p>
                    </div>

                    <div class="bg-white rounded-xl border border-slate-200 p-5">
                        <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Change</p>
                        <p class="text-3xl font-black leading-tight" style="color:${deltaColor}">${arrow} ${fmtAvg(Math.abs(deltaAvg))}<span class="text-base text-slate-400 font-medium ml-1">/ day</span></p>
                        <p class="text-xs mt-1" style="color:${deltaColor}">${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}% ${isCustom ? 'A vs B' : 'vs prior period'}</p>
                    </div>
                </div>
                <p class="text-[11px] text-slate-400 italic mt-3">Today is excluded from these stats — partial days skew daily averages, especially for short windows.</p>
            </div>`;
    },

    // Bars toggle + period selector for breakdown timeline charts.
    // kind: 'country' | 'prof' | 'amb-top' — used to derive element IDs and App state keys
    _timelineControls(kind, currentRange) {
        const stateKeyMap = { 'country': 'countryTimelineRange', 'prof': 'profTimelineRange', 'activity': 'activityTimelineRange', 'career': 'careerTimelineRange', 'topic': 'topicTimelineRange', 'amb-top': 'ambassadorsTimelineRange' };
        const stateKey = stateKeyMap[kind];
        const toggleId = kind === 'amb-top' ? 'toggle-amb-top-bars' : `toggle-${kind}-bars`;
        const ranges = [
            { v: '3',  l: 'Last 3 mo' },
            { v: '6',  l: 'Last 6 mo' },
            { v: '12', l: 'Last 12 mo' },
            { v: '24', l: 'Last 24 mo' },
            { v: 'all', l: 'All time' }
        ];
        const opts = ranges.map(r => `<option value="${r.v}" ${String(currentRange) === r.v ? 'selected' : ''}>${r.l}</option>`).join('');
        const redrawCall = kind === 'amb-top'
            ? `if(window.Charts && App.ambassadorData) Charts.drawAmbassadors(App.ambassadorData)`
            : `if(window.Charts){const s=(App.userHistory||[]).find(d=>d.Timestamp===App.selectedDate)||(App.userHistory||[])[0]||{}; if(s.TotalUsers) Charts.drawAudience(s);}`;
        return `<div class="flex flex-wrap items-center gap-4 mb-3">
            <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                <input type="checkbox" data-viewer-allowed id="${toggleId}" onchange="${redrawCall}"> Show monthly bars
            </label>
            <label class="inline-flex items-center gap-2 text-sm text-slate-600">
                <span class="text-xs font-semibold text-slate-400 uppercase">Period</span>
                <select data-viewer-allowed onchange="App.${stateKey}=this.value; ${redrawCall}" class="bg-white border rounded px-2 py-1 text-slate-700 outline-none text-xs">${opts}</select>
            </label>
        </div>`;
    },

    // Reusable audience breakdown-timeline section (header + period/bars + trim +
    // category selector + chart). Used for Activity / Career Stage / Topics.
    _audienceBreakdownSection(cfg) {
        const redraw = "const s=(App.userHistory||[]).find(d=>d.Timestamp===App.selectedDate)||(App.userHistory||[])[0]||{}; if(window.Charts && s.TotalUsers) window.Charts.drawAudience(s)";
        const trimOn = !!this[cfg.trimKey];
        const selector = (cfg.list && cfg.list.length > 0)
            ? this.buildCategorySelector(cfg.list, this[cfg.selProp] || [], cfg.selProp, cfg.chartId, cfg.field, 5)
            : '';
        return `
            <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
                <h3 class="text-lg font-bold mb-1 flex items-center gap-2 text-gsf-prussian">${this.escapeHtml(cfg.title)} ${this._chartWidthBtns(cfg.chartId)} ${this._resetChartBtn(cfg.chartId)} ${this._chartBtns(cfg.chartId, cfg.exportName)}</h3>
                ${cfg.note ? `<p class="text-xs text-slate-400 mb-3">${cfg.note}</p>` : ''}
                <div class="flex flex-wrap gap-4 items-center">
                    ${this._timelineControls(cfg.kind, this[cfg.rangeKey] || 'all')}
                    <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer mb-3" title="Drama mode — start y-axis near the first visible value to exaggerate slope. Use sparingly.">
                        <input type="checkbox" data-viewer-allowed ${trimOn ? 'checked' : ''} onchange="App.${cfg.trimKey}=this.checked; ${redraw}">
                        <span>Trim y-axis <span class="text-[10px] text-slate-400">(drama)</span></span>
                    </label>
                    ${this._partialMonthToggle()}
                </div>
                ${trimOn ? '<p class="text-[11px] text-amber-600 italic mb-2">⚠ Y-axis trimmed — slopes exaggerated.</p>' : ''}
                <div id="selector_${cfg.selProp}">${selector}</div>
                <div style="${this._chartWidthStyle(cfg.chartId)}">
                    <div id="${cfg.chartId}" style="width: 100%; height: 450px;"></div>
                </div>
                ${this._partialMonthCaption()}
            </div>`;
    },

    // "Last updated" badge — finds the latest timestamp from data/history
    _lastUpdatedBadge(kind) {
        let ts = null;
        if (kind === 'course') {
            const dates = this.data.filter(d => !d.IsShell).map(d => d.Timestamp).filter(Boolean);
            if (dates.length) ts = dates.sort().pop();
        } else if (kind === 'audience') {
            const dates = (this.userHistory || []).map(d => d.Timestamp).filter(Boolean);
            if (dates.length) ts = dates.sort().pop();
        } else if (kind === 'ambassador') {
            // Prefer the actual sync timestamp (DerivedAt) so the badge reflects
            // when the data was pulled — consistent with the audience tab — rather
            // than the latest referral month (which read as a stale "Jun 1").
            if (this.ambassadorData && this.ambassadorData.DerivedAt) {
                ts = String(this.ambassadorData.DerivedAt).slice(0, 10);
            } else if (this.ambassadorData && this.ambassadorData.Timeline) {
                const months = Object.keys(this.ambassadorData.Timeline).sort();
                if (months.length) ts = months.pop();
            }
        }
        if (!ts) return '';
        return `<span class="inline-flex items-center gap-1.5 text-xs text-slate-400 font-medium"><i data-lucide="clock" width="12" class="text-slate-300"></i> Data from ${this.formatDate(ts)}</span>`;
    },

    // Copy a single KPI card as hi-res PNG image
    async _copyKpiCard(el) {
        if (!el) return;
        try {
            const html2canvas = window.html2canvas;
            const canvas = await html2canvas(el, { scale: 4, backgroundColor: null, useCORS: true });
            const uri = canvas.toDataURL('image/png');
            await electronAPI.invoke('clipboard-write-image', uri);
            el.style.outline = '2px solid #4389C8';
            setTimeout(() => { el.style.outline = ''; }, 600);
        } catch(e) { console.error('KPI card copy failed:', e); }
    },

    // Copy all KPI cards in a grid as one hi-res PNG
    async _copyAllKpiCards(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        try {
            const html2canvas = window.html2canvas;
            const canvas = await html2canvas(container, { scale: 4, backgroundColor: null, useCORS: true });
            const uri = canvas.toDataURL('image/png');
            await electronAPI.invoke('clipboard-write-image', uri);
            const btn = document.querySelector('[data-copy-all-kpis]');
            if (btn) { const orig = btn.innerHTML; btn.textContent = 'Copied!'; setTimeout(() => { btn.innerHTML = orig; if (window.lucide) lucide.createIcons(); }, 1500); }
        } catch(e) { console.error('Copy all KPI cards failed:', e); }
    },

    // Sort course directory
    _sortCourseDir(col) {
        if (this._shCourseSortCol === col) this._shCourseSortAsc = !this._shCourseSortAsc;
        else { this._shCourseSortCol = col; this._shCourseSortAsc = col === 'course' || col === 'provider'; }
        this.renderView();
    },

    renderSidebar() {
        const navEl = document.getElementById('project-nav');
        if (!navEl) return;

        const cur = this.currentProject;
        const projects = Projects.registry;

        // Skip full rebuild only if same project is still active AND the sample's
        // sidebar visibility (driven by App.includeSample) hasn't changed AND the
        // access tier is the same (the lock-button icon below depends on it, and a
        // tier change must not be short-circuited).
        const sbLockKey = App.editUnlocked ? 'edit' : (App.reportAccess ? 'report' : 'locked');
        if (this._lastSidebarProject === cur && this._lastSidebarSample === this.includeSample && this._lastSidebarLock === sbLockKey && navEl.querySelector('[data-proj]')) {
            return;
        }
        this._lastSidebarProject = cur;
        this._lastSidebarSample = this.includeSample;
        this._lastSidebarLock = sbLockKey;

        const item = (id, icon, label, distinct, draggable) => {
            const active = id === cur;
            const base = distinct
                ? `w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all ${active ? 'bg-white/15 text-white' : 'text-slate-300 hover:bg-white/8 hover:text-white'}`
                : `w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${active ? 'bg-white/15 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`;
            const dragAttr = draggable ? `draggable="true" data-drag-proj="${id}"` : '';
            return `<button data-proj="${id}" ${dragAttr} onclick="App.switchProject('${id}')" class="${base} ${active ? 'nav-on' : ''}" style="${draggable ? 'cursor:grab' : ''}">
                ${draggable ? '<i data-lucide="grip-vertical" width="10" class="text-slate-600 shrink-0 opacity-40"></i>' : ''}
                <i data-lucide="${icon}" width="${distinct ? 16 : 15}" class="${active ? 'text-gsf-polo' : 'text-slate-500'}"></i>
                <span class="truncate flex-1 text-left">${label}</span>
                <span class="active-dot w-1.5 h-1.5 rounded-full bg-gsf-polo shrink-0 ${active ? 'opacity-100' : 'opacity-0'}"></span>
            </button>`;
        };

        let html = '';

        // ── Organisation (distinctive card button) ──
        const orgActive = cur === 'org';
        const hubActive = cur === 'surghub';
        html += `<div class="mb-2 px-2">
            <button data-proj="org" onclick="App.switchProject('org')" class="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-bold transition-all ${orgActive ? 'bg-gradient-to-r from-gsf-polo/30 to-gsf-boston/20 text-white ring-1 ring-gsf-polo/50 shadow-sm shadow-gsf-polo/20' : 'bg-gradient-to-r from-white/8 to-gsf-polo/8 text-slate-200 hover:from-white/12 hover:to-gsf-polo/15 hover:text-white'}">
                <span class="flex items-center justify-center w-7 h-7 rounded-lg ${orgActive ? 'bg-gsf-polo/40' : 'bg-gsf-polo/15'}"><i data-lucide="building-2" width="14" class="${orgActive ? 'text-white' : 'text-gsf-polo/70'}"></i></span>
                <span class="flex-1 text-left">Organisation</span>
                <span class="active-dot w-1.5 h-1.5 rounded-full bg-gsf-polo shrink-0 ${orgActive ? 'opacity-100' : 'opacity-0'}"></span>
            </button>
        </div>`;

        // ── Divider ──
        html += `<div class="my-2 mx-1 border-t border-white/10"></div>`;

        // ── Projects section ──
        html += `<div>
            <p class="px-3 pb-1.5 text-[9px] font-bold uppercase tracking-widest"><span class="text-gsf-boston">SURG</span><span class="text-gsf-polo/60">fund Projects</span></p>
            <div id="sidebar-project-list" class="space-y-0.5">`;
        // The sample/demo project only appears in the sidebar when it's blended in
        // (App.includeSample). Keep it visible if it happens to be the current
        // project so the user is never stranded on a hidden page.
        const fieldProjects = projects.filter(p => p.type !== 'surghub' && (App.includeSample || !p.isSample || p.id === cur));
        if (fieldProjects.length === 0) {
            html += `<p class="px-3 py-2 text-xs text-slate-500 italic">No projects yet</p>`;
        } else {
            fieldProjects.forEach(p => {
                const active = p.id === cur;
                const pColor = p.color || '#4389C8';
                const base = active
                    ? `w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all bg-gradient-to-r from-white/15 to-white/5 text-white ring-1 ring-white/10`
                    : `w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all text-slate-300 hover:bg-gradient-to-r hover:from-white/8 hover:to-white/3 hover:text-white`;
                const sampleBadge = p.isSample
                    ? `<span class="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-400/30 shrink-0" title="Demonstration project — excluded from organisation totals">SAMPLE</span>`
                    : '';
                const sampleStyle = p.isSample ? 'opacity:0.85;' : '';
                html += `<button data-proj="${p.id}" draggable="true" data-drag-proj="${p.id}" onclick="App.switchProject('${p.id}')" class="${base} ${p.isSample ? 'border border-dashed border-purple-400/30' : ''}" style="cursor:grab; ${sampleStyle}">
                    <i data-lucide="grip-vertical" width="10" class="text-slate-600 shrink-0 opacity-40"></i>
                    <i data-lucide="${p.icon || 'folder'}" width="15" class="shrink-0" style="color:${pColor}"></i>
                    <span class="truncate flex-1 text-left">${p.shortName || p.name}</span>
                    ${sampleBadge}
                    <span class="active-dot w-1.5 h-1.5 rounded-full shrink-0 ${active ? 'opacity-100' : 'opacity-0'}" style="background:${pColor}"></span>
                </button>`;
            });
        }
        html += `</div>
            <button onclick="App.navigate('new-project')" data-edit-only class="w-full flex items-center gap-2.5 px-3 py-2 mt-1 rounded-lg text-xs font-medium text-gsf-polo/60 hover:text-gsf-polo hover:bg-white/5 transition-all">
                <i data-lucide="plus" width="13"></i> New Project
            </button>
            <button onclick="App.navigate('pending-submissions')" data-edit-only class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-gsf-polo/60 hover:text-gsf-polo hover:bg-white/5 transition-all" id="sidebar-submissions-btn">
                <i data-lucide="inbox" width="13"></i> Submissions
                <span id="sidebar-submissions-badge" class="ml-auto hidden text-[10px] font-black bg-gsf-crimson text-white px-1.5 py-0.5 rounded-full"></span>
            </button>
        </div>`;

        // ── SURGhub (separated below projects, project-like style) ──
        html += `<div class="my-2 mx-1 border-t border-white/10"></div>`;
        html += `<div class="px-2">
            <p class="px-3 pb-1.5 text-[9px] font-bold text-amber-400/50 uppercase tracking-widest">Learning Platform</p>
            <button data-proj="surghub" onclick="App.switchProject('surghub')" class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${hubActive ? 'bg-gradient-to-r from-amber-500/20 to-amber-400/5 text-white ring-1 ring-amber-400/20' : 'text-slate-300 hover:bg-gradient-to-r hover:from-white/8 hover:to-white/3 hover:text-white'}">
                <i data-lucide="graduation-cap" width="15" class="shrink-0" style="color:#E28743"></i>
                <span class="truncate flex-1 text-left">SURGhub</span>
                <span class="active-dot w-1.5 h-1.5 rounded-full shrink-0 ${hubActive ? 'opacity-100' : 'opacity-0'}" style="background:#E28743"></span>
            </button>
        </div>`;

        navEl.innerHTML = html;
        if (window.lucide) lucide.createIcons();

        // ── Update pending-submissions badge ──
        (async () => {
            try {
                const subs = await Projects.getPendingSubmissions();
                const pending = subs.filter(s => s.status === 'pending').length;
                const badge = document.getElementById('sidebar-submissions-badge');
                if (badge) {
                    if (pending > 0) { badge.textContent = String(pending); badge.classList.remove('hidden'); }
                    else { badge.classList.add('hidden'); }
                }
            } catch (e) { /* sidebar shouldn't crash on storage errors */ }
        })();

        // ── Update sidebar lock button visibility + icon ──
        const lockBtn = document.getElementById('sidebar-lock-btn');
        if (lockBtn) {
            if (App._editPasswordHash || App._reportPasswordHash) {
                const unlocked = App.editUnlocked || App.reportAccess;
                lockBtn.style.display = '';
                lockBtn.title = unlocked ? 'Lock' : 'Unlock';
                lockBtn.innerHTML = unlocked
                    ? '<i data-lucide="lock-open" width="12"></i>'
                    : '<i data-lucide="lock" width="12"></i>';
                if (window.lucide) lucide.createIcons();
            } else {
                lockBtn.style.display = 'none';
            }
        }

        // ── Drag-and-drop reordering for projects ──
        // Remove old listeners before attaching new ones (prevents accumulation)
        const list = document.getElementById('sidebar-project-list');
        if (list) {
            let dragId = null;
            const onDragStart = e => {
                const btn = e.target.closest('[data-drag-proj]');
                if (!btn) return;
                dragId = btn.dataset.dragProj;
                btn.style.opacity = '0.4';
                e.dataTransfer.effectAllowed = 'move';
            };
            const onDragEnd = e => {
                const btn = e.target.closest('[data-drag-proj]');
                if (btn) btn.style.opacity = '';
                dragId = null;
                list.querySelectorAll('[data-drag-proj]').forEach(b => b.style.borderTop = '');
            };
            const onDragOver = e => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const target = e.target.closest('[data-drag-proj]');
                list.querySelectorAll('[data-drag-proj]').forEach(b => b.style.borderTop = '');
                if (target && target.dataset.dragProj !== dragId) {
                    target.style.borderTop = '2px solid #4389C8';
                }
            };
            const onDrop = async e => {
                e.preventDefault();
                const target = e.target.closest('[data-drag-proj]');
                if (!target || !dragId || target.dataset.dragProj === dragId) return;
                const dropId = target.dataset.dragProj;
                // Reorder registry
                const reg = Projects.registry;
                const fromIdx = reg.findIndex(p => p.id === dragId);
                const toIdx = reg.findIndex(p => p.id === dropId);
                if (fromIdx < 0 || toIdx < 0) return;
                const [moved] = reg.splice(fromIdx, 1);
                const newToIdx = reg.findIndex(p => p.id === dropId);
                reg.splice(newToIdx, 0, moved);
                await Projects.saveRegistry();
                this._lastSidebarProject = null; // force full re-render
                this.renderSidebar();
            };

            // Clean up previous listeners if stored
            if (this._sidebarDragCleanup) this._sidebarDragCleanup();

            list.addEventListener('dragstart', onDragStart);
            list.addEventListener('dragend', onDragEnd);
            list.addEventListener('dragover', onDragOver);
            list.addEventListener('drop', onDrop);

            // Store cleanup function for next renderSidebar() call
            this._sidebarDragCleanup = () => {
                list.removeEventListener('dragstart', onDragStart);
                list.removeEventListener('dragend', onDragEnd);
                list.removeEventListener('dragover', onDragOver);
                list.removeEventListener('drop', onDrop);
            };
        }
    },

    renderTabBar() {
        const tabsEl = document.getElementById('view-tabs');
        if (!tabsEl) return;

        // No tab bar for new-project view
        if (this.view === 'new-project') { tabsEl.innerHTML = ''; return; }

        const project = this.getCurrentProject();
        const projectKey = this.currentProject;

        // Same project + same lock state: just update active states.
        // lockKey MUST capture every access tier that changes which tabs are
        // locked — edit, provider-reporting, and fully-locked all differ. (Missing
        // reportAccess here left the Reports tab locked after entering report mode,
        // because the guard short-circuited the rebuild.)
        const lockKey = App.editUnlocked ? 'edit' : (App.reportAccess ? 'report' : 'locked');
        if (this._lastTabBarProject === projectKey && this._lastTabBarLock === lockKey && tabsEl.querySelector('[data-tab-view]')) {
            tabsEl.querySelectorAll('[data-tab-view]').forEach(btn => {
                if (btn.classList.contains('cursor-not-allowed')) return; // skip locked tabs
                const active = btn.dataset.tabView === this.view;
                btn.className = active
                    ? 'flex items-center gap-1.5 px-4 py-3 text-sm font-semibold text-gsf-prussian border-b-2 border-[#E0A93F] transition-colors whitespace-nowrap'
                    : 'flex items-center gap-1.5 px-4 py-3 text-sm font-medium text-slate-500 hover:text-gsf-prussian border-b-2 border-transparent hover:border-slate-200 transition-colors whitespace-nowrap';
            });
            return;
        }
        this._lastTabBarProject = projectKey;
        this._lastTabBarLock = lockKey;

        const tab = (view, icon, label, locked = false) => {
            const active = this.view === view;
            if (locked) {
                return `<button data-tab-view="${view}" onclick="App.showUnlockPrompt()"
                    class="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-slate-300 border-b-2 border-transparent cursor-not-allowed whitespace-nowrap" title="Unlock editing to access this tab">
                    <i data-lucide="lock" width="11" class="text-slate-300"></i><i data-lucide="${icon}" width="14"></i><span class="opacity-60">${label}</span>
                </button>`;
            }
            return `<button data-tab-view="${view}" onclick="App.navigate('${view}')"
                class="flex items-center gap-1.5 px-4 py-3 text-sm font-${active ? 'semibold' : 'medium'} ${active ? 'text-gsf-prussian border-b-2 border-[#E0A93F]' : 'text-slate-500 hover:text-gsf-prussian border-b-2 border-transparent hover:border-slate-200'} transition-colors whitespace-nowrap">
                <i data-lucide="${icon}" width="14"></i>${label}
            </button>`;
        };
        const editLocked = !App.editUnlocked && !!App._editPasswordHash;
        // Reports tab opens for full edit OR the provider-reporting role. Locked
        // only when neither is unlocked and some password is set.
        const reportTabLocked = !App.editUnlocked && !App.reportAccess && (!!App._editPasswordHash || !!App._reportPasswordHash);

        let contextLabel = '';
        let tabs = '';

        if (project.type === 'org') {
            contextLabel = 'Organisation';
            tabs = tab('org-dashboard',  'layout-dashboard', 'Overview')
                 + tab('org-calendar',   'calendar',         'Calendar')
                 + tab('org-activities', 'pencil-line',      'Activities')
                 + tab('org-map',        'map-pin',          'Map')
                 + tab('org-methodology','book-open',        'Methodology')
                 + tab('org-settings',   'settings',         'Settings');
        } else if (project.type === 'surghub') {
            contextLabel = 'SURGhub';
            tabs = tab('platform',    'layout-dashboard', 'Dashboard')
                 + tab('provider',    'building-2',       'Providers')
                 + tab('course',      'book-open',        'Courses')
                 + tab('ambassadors', 'award',            'Ambassadors')
                 + tab('sh-reports',  'file-text',        'Reports',    reportTabLocked)
                 + tab('manage',      'list',             'Directory')
                 + tab('upload',      'refresh-cw',       'Data Sync',  editLocked)
                 + tab('methodology', 'book-open',        'Methodology');
        } else {
            contextLabel = project.shortName || project.name;
            tabs = tab('project-dashboard',  'layout-dashboard', 'Dashboard')
                 + tab('project-calendar',   'calendar',         'Calendar')
                 + tab('project-setup',      'database',         'Data Entry')
                 + tab('project-activities', 'pencil-line',      'Activities')
                 + tab('project-map',        'map-pin',          'Map')
                 + tab('project-reports',    'bar-chart-3',      'Reports')
                 + tab('project-settings',   'settings',         'Settings');
        }

        const surghubLoadBtn = (project.type === 'surghub' && !App.editUnlocked && this.data && this.data.length > 0)
            ? `<div class="ml-auto shrink-0 px-3 border-l border-slate-100">
                <button onclick="document.getElementById('surghub-tab-import').click()"
                    class="flex items-center gap-1.5 px-3 py-1.5 bg-gsf-prussian text-white text-xs font-bold rounded-lg hover:bg-gsf-boston transition-colors whitespace-nowrap">
                    <i data-lucide="upload-cloud" width="12"></i> Load Snapshot
                </button>
                <input type="file" id="surghub-tab-import" accept=".json" class="hidden" onchange="App.importSurghubJson(event)" />
              </div>`
            : '';

        tabsEl.innerHTML = `<div class="flex items-center overflow-x-auto">
            <span class="gsf-eyebrow px-5 py-3 whitespace-nowrap border-r border-slate-100 shrink-0">${contextLabel}</span>
            ${tabs}
            ${surghubLoadBtn}
        </div>`;
        if (window.lucide) lucide.createIcons();
    },

    navigate(view) {
        this.view = view;
        this.renderView();
    },

    renderFeedbackExplorer(bank, contextProvider) {
        if (!bank || bank.length === 0) return '<div class="p-6 text-center text-slate-500 italic border rounded-lg bg-slate-50 mt-4">No feedback available.</div>';

        // Run through intelligence engine
        const { scored, stats } = window.FeedbackIntel.analyzeBank(bank);
        if (scored.length === 0) return '<div class="p-6 text-center text-slate-500 italic border rounded-lg bg-slate-50 mt-4">No feedback available.</div>';

        // Collect all unique tags (flags + topics) with counts for the tag filter
        const tagCounts = {};
        scored.forEach(f => {
            f._flags.forEach(fl => { tagCounts[fl] = (tagCounts[fl] || 0) + 1; });
            f._topics.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
        });
        const tagOptions = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);

        // Date filter
        let filtered = this.feedbackFilterDate ? scored.filter(b => b.d >= this.feedbackFilterDate) : scored;

        // Tag filter
        if (this.feedbackFilterTag && this.feedbackFilterTag !== 'all') {
            filtered = filtered.filter(f => f._flags.includes(this.feedbackFilterTag) || f._topics.includes(this.feedbackFilterTag));
        }

        // Sort
        if (this.feedbackSort === 'date' || !this.feedbackSort) filtered.sort((a, b) => (b.d || '').localeCompare(a.d || ''));
        else if (this.feedbackSort === 'length') filtered.sort((a, b) => b._wordCount - a._wordCount);
        else if (this.feedbackSort === 'rating') filtered.sort((a, b) => (b.r || 0) - (a.r || 0));
        else if (this.feedbackSort === 'ai') {
            const aiM = this._aiScoreMap || {};
            if (Object.keys(aiM).length) {
                filtered.sort((a, b) => (((aiM[this._djb2Hash(String(b.t || '').trim())] || {}).s || 0)) - (((aiM[this._djb2Hash(String(a.t || '').trim())] || {}).s || 0)));
            } else {
                filtered.sort((a, b) => (b.d || '').localeCompare(a.d || ''));
            }
        }

        // Tag pill renderer
        const tagPill = (tag, clickable) => {
            const colors = {
                'testimonial': 'bg-green-50 text-green-700 border-green-200',
                'suggestion':  'bg-purple-50 text-purple-700 border-purple-200',
                'critical':    'bg-red-50 text-red-700 border-red-200',
                'question':    'bg-sky-50 text-sky-700 border-sky-200',
                'detailed':    'bg-emerald-50 text-emerald-700 border-emerald-200',
            };
            const cls = colors[tag] || 'bg-slate-100 text-slate-600 border-slate-200';
            const active = this.feedbackFilterTag === tag ? ' ring-2 ring-offset-1 ring-slate-400' : '';
            if (clickable) {
                return '<button onclick="App.feedbackFilterTag = App.feedbackFilterTag === \'' + tag + '\' ? \'all\' : \'' + tag + '\'; App.renderView()" class="px-1.5 py-0.5 rounded text-[10px] font-semibold border ' + cls + active + ' hover:opacity-80 transition-all">' + this.escapeHtml(tag) + '</button>';
            }
            return '<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold border ' + cls + '">' + this.escapeHtml(tag) + '</span>';
        };

        const hasActiveFilter = (this.feedbackFilterTag && this.feedbackFilterTag !== 'all') || this.feedbackFilterDate || this.feedbackShowSelected;

        return `
            <!-- Filters & Sort bar -->
            <div class="flex flex-wrap items-center gap-3 mb-4 text-xs">
                <div class="flex items-center gap-1.5">
                    <span class="text-slate-500 font-medium">Sort:</span>
                    <select data-viewer-allowed onchange="App.feedbackSort=this.value; App.renderView()" class="bg-white border rounded px-2 py-1 text-slate-700 outline-none text-xs">
                        <option value="date" ${this.feedbackSort === 'date' ? 'selected' : ''}>Newest First</option>
                        <option value="length" ${this.feedbackSort === 'length' ? 'selected' : ''}>Longest First</option>
                        <option value="rating" ${this.feedbackSort === 'rating' ? 'selected' : ''}>Highest Rating</option>
                        <option value="ai" ${this.feedbackSort === 'ai' ? 'selected' : ''}>AI Score</option>
                    </select>
                </div>
                <div class="flex items-center gap-1.5">
                    <span class="text-slate-500 font-medium">Tag:</span>
                    <select data-viewer-allowed onchange="App.feedbackFilterTag=this.value; App.renderView()" class="bg-white border rounded px-2 py-1 text-slate-700 outline-none text-xs">
                        <option value="all" ${!this.feedbackFilterTag || this.feedbackFilterTag === 'all' ? 'selected' : ''}>All (${scored.length})</option>
                        ${tagOptions.map(([tag, count]) => '<option value="' + this.escapeHtml(tag) + '" ' + (this.feedbackFilterTag === tag ? 'selected' : '') + '>' + this.escapeHtml(tag) + ' (' + count + ')</option>').join('')}
                    </select>
                </div>
                <div class="flex items-center gap-1.5">
                    <span class="text-slate-500 font-medium">From:</span>
                    <input type="date" data-viewer-allowed value="${this.feedbackFilterDate || ''}" onchange="App.feedbackFilterDate=this.value; App.reportFeedbackFromDate=this.value; App.renderView()" class="bg-white border rounded px-2 py-1 text-slate-700 outline-none text-xs" />
                </div>
                ${contextProvider ? '<button onclick="App.feedbackShowSelected=!App.feedbackShowSelected; App._applySelectedFilter()" class="px-2 py-1 rounded font-semibold border transition-all ' + (this.feedbackShowSelected ? 'bg-green-100 text-green-700 border-green-300' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300') + '">☑ Selected only</button>' : ''}
                ${hasActiveFilter ? '<button onclick="App.feedbackFilterTag=\'all\'; App.feedbackFilterDate=\'\'; App.reportFeedbackFromDate=\'\'; App.feedbackShowSelected=false; App.renderView()" class="text-gsf-crimson font-bold hover:underline">Clear</button>' : ''}
                <button data-edit-only data-report-ok onclick="App.scoreFeedbackWithAI()" class="px-2.5 py-1 rounded font-bold bg-gsf-prussian text-white hover:bg-slate-900 transition-colors flex items-center gap-1" title="Score all feedback with Claude — surfaces real impact stories, filters junk, feeds provider reports">✨ Score with AI</button>
                <button data-edit-only data-report-ok onclick="App.autoSelectTestimonials(${contextProvider ? "'" + this.escapeHtml(contextProvider).replace(/'/g, '&#39;') + "'" : 'null'})" class="px-2.5 py-1 rounded font-bold bg-amber-500 text-white hover:bg-amber-600 transition-colors" title="Select the top X comments per course (AI score ≥ Y) as report testimonials — then fine-tune with the checkboxes">⭐ Auto-select</button>
                <button data-edit-only data-report-ok onclick="App.summarizeFeedbackWithAI(${contextProvider ? "'" + this.escapeHtml(contextProvider).replace(/'/g, '&#39;') + "'" : 'null'})" class="px-2.5 py-1 rounded font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors" title="AI summary of what learners are saying, per course and per provider — shown in reports">📝 Summarize</button>
                <button data-edit-only data-report-ok onclick="App.setAnthropicKey()" class="px-2 py-1 rounded font-semibold border bg-white text-slate-500 border-slate-200 hover:border-slate-300" title="Set / change the Anthropic API key (stored locally on this machine)">⚙</button>
                <span class="text-slate-400 ml-auto">${filtered.length} of ${scored.length}</span>
            </div>

            <!-- Feedback Cards -->
            ${filtered.length === 0 ? '<div class="p-6 text-center text-slate-500 italic border rounded-lg bg-slate-50">No feedback matches the current filters.</div>' : `
                <div class="space-y-3 max-h-[600px] overflow-y-auto custom-scrollbar pr-2 pb-2" data-feedback-grid="${this.escapeHtml(contextProvider || '')}">
                    ${filtered.map(f => {
                        const showCb = contextProvider && f._course && f.s !== 'Critical';
                        const safeText = this.escapeHtml(f.t).replace(/'/g, '&#39;').replace(/\\/g, '\\\\');
                        const safeCourse = f._course ? this.escapeHtml(f._course).replace(/'/g, '&#39;') : '';
                        const _ai = (this._aiScoreMap || {})[this._djb2Hash(String(f.t || '').trim())];
                        // AI themes replace the legacy keyword pills once scored
                        const allTags = (_ai && Array.isArray(_ai.t) && _ai.t.length && _ai.t[0] !== 'junk')
                            ? _ai.t
                            : [...f._flags.filter(fl => fl !== 'detailed' || f._wordCount >= 30), ...f._topics];
                        const ratingStr = f.r > 0 ? '<span class="text-amber-500 font-bold text-xs">' + '★'.repeat(Math.round(f.r)) + '</span>' : '';
                        const aiChip = _ai ? (_ai.s > 0
                            ? '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full border ' + (_ai.s >= 7 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-500 border-slate-200') + '" title="AI testimonial score' + (_ai.t && _ai.t.length ? ' · ' + _ai.t.join(', ') : '') + '">AI ' + _ai.s + '/10</span>'
                            : '<span class="text-[10px] font-medium px-1.5 py-0.5 rounded-full border bg-slate-50 text-slate-400 border-slate-200" title="Filtered as junk/generic">junk</span>') : '';

                        return `
                            <div class="feedback-card bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex flex-col gap-2 hover:border-slate-300 transition-colors">
                                <div class="flex justify-between items-center">
                                    <div class="flex items-center gap-2">${ratingStr}${aiChip}${f._course ? '<span class="text-[10px] font-medium text-slate-400">' + this.escapeHtml(f._course) + '</span>' : ''}</div>
                                    <span class="text-[11px] text-slate-400">${this.formatDate(f.d)}</span>
                                </div>
                                <p class="text-sm text-slate-700 leading-relaxed">"${this.escapeHtml(this._polishQuote ? this._polishQuote(f.t) : f.t)}"</p>
                                ${allTags.length > 0 || showCb ? `
                                    <div class="flex flex-wrap items-center gap-1 mt-1 pt-2 border-t border-slate-100">
                                        ${allTags.map(tag => tagPill(tag, false)).join(' ')}
                                        ${showCb ? '<label class="ml-auto inline-flex items-center gap-1 cursor-pointer" title="Select for PDF report"><input type="checkbox" data-report-ok class="accent-green-600 testimonial-cb" data-fb-text="' + safeText + '" data-fb-course="' + safeCourse + '" onchange="App.toggleTestimonial(\'' + this.escapeHtml(contextProvider).replace(/'/g, '&#39;') + '\', \'' + safeCourse + '\', this.dataset.fbText, this.checked)"><span class="text-[10px] font-semibold text-green-700">Use in report</span></label>' : ''}
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            `}
        `;
    },

    // Hydrate testimonial checkboxes from saved selections after render.
    // If no selections exist for a course, auto-select top 3 testimonials.
    async _hydrateTestimonialCheckboxes(providerName) {
        if (!providerName) return;
        const sel = (await Storage.getItem('surghub_selected_testimonials')) || {};
        const provSel = sel[providerName] || {};

        // Group checkboxes by course
        const cbsByCourse = {};
        document.querySelectorAll('.testimonial-cb').forEach(cb => {
            const course = App._unescapeHtml(cb.dataset.fbCourse || '');
            if (!cbsByCourse[course]) cbsByCourse[course] = [];
            cbsByCourse[course].push(cb);
        });

        let changed = false;
        for (const [course, cbs] of Object.entries(cbsByCourse)) {
            const courseSel = provSel[course];
            // Saved selections are the single source of truth (the AI
            // auto-select and manual checkboxes both write here). No implicit
            // fallback — the old "pick 3 longest" heuristic used to silently
            // overwrite curated selections.
            cbs.forEach(cb => {
                const raw = App._unescapeHtml(cb.dataset.fbText);
                cb.checked = !!(courseSel && courseSel.includes(raw));
            });
        }
        if (changed) await Storage.setItem('surghub_selected_testimonials', sel);
        // Apply "selected only" filter if active
        if (App.feedbackShowSelected) App._applySelectedFilter();
    },

    // Build category selector: checkboxes for selected items + 3 dropdowns to add more
    buildCategorySelector(allCategories, selectedArray, stateKey, chartElId, dataAccessor, topN) {
        this['_allCats_' + stateKey] = allCategories;
        // Drop previously-selected categories that no longer exist in this dataset
        // (e.g. bucket names changed after a re-sync) so they don't render as
        // flat-zero lines. When re-defaulting, skip any "(legacy)" bucket so the
        // initial view shows live categories only (the user can still add it).
        const valid = (selectedArray || []).filter(c => allCategories.includes(c));
        const pool = allCategories.filter(c => !/\(legacy\)/i.test(c));
        const selected = valid.length > 0 ? valid : (pool.length ? pool : allCategories).slice(0, topN || 5);
        this[stateKey] = selected.slice();

        const available = allCategories.filter(c => !selected.includes(c));
        const esc = (s) => this.escapeHtml(s).replace(/'/g, "\\'");

        // Checkboxes for currently selected items (can uncheck to remove from chart)
        let checkboxes = selected.map(cat =>
            '<label class="inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer">' +
            '<input type="checkbox" data-viewer-allowed checked onchange="App.toggleCategory(\'' + stateKey + '\',\'' + esc(cat) + '\',\'' + chartElId + '\',\'' + dataAccessor + '\')" class="accent-[#4389C8]">' +
            '<span class="text-gsf-prussian font-semibold">' + this.escapeHtml(cat) + '</span></label>'
        ).join('');

        // 3 dropdowns to add more
        let dropdowns = '';
        for (let d = 0; d < 3; d++) {
            dropdowns += '<select data-viewer-allowed data-sk="' + stateKey + '" data-ch="' + chartElId + '" data-ac="' + dataAccessor + '" ' +
                'onchange="App.addCategory(this)" class="bg-white border rounded px-2 py-0.5 text-slate-600 text-xs outline-none">' +
                '<option value="">+ Add...</option>' +
                available.map(c => '<option value="' + this.escapeHtml(c) + '">' + this.escapeHtml(c) + '</option>').join('') +
                '</select>';
        }

        return '<div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-4 text-xs">' + checkboxes + dropdowns + '</div>';
    },

    toggleCategory(stateKey, cat, chartElId, dataAccessor) {
        let sel = this[stateKey] || [];
        const idx = sel.indexOf(cat);
        if (idx >= 0) sel.splice(idx, 1);
        else sel.push(cat);
        this[stateKey] = sel;
        // Only redraw the chart — checkbox state is already visual via the DOM
        this._redrawChartOnly(stateKey, chartElId, dataAccessor);
    },

    addCategory(selectEl) {
        const cat = selectEl.value;
        if (!cat) return;
        const stateKey = selectEl.dataset.sk;
        const chartElId = selectEl.dataset.ch;
        const dataAccessor = selectEl.dataset.ac;
        let sel = this[stateKey] || [];
        if (!sel.includes(cat)) sel.push(cat);
        this[stateKey] = sel;
        // Adding from dropdown: rebuild selector (to update dropdown options) + redraw chart
        this._redrawBreakdownAndSelector(stateKey, chartElId, dataAccessor);
    },

    // Redraw ONLY the chart — no selector rebuild, no flicker
    _redrawChartOnly(stateKey, chartElId, dataAccessor) {
        if (!window.Charts) return;
        const timelineData = this._getBreakdownTimelineData(dataAccessor);
        if (timelineData) {
            const sel = this[stateKey] || [];
            window.Charts.drawBreakdownTimeline(chartElId, timelineData, 5, sel.length > 0 ? sel : null);
        }
    },

    // Get timeline data for a breakdown chart
    _getBreakdownTimelineData(dataAccessor) {
        if (dataAccessor === 'PromoterTimeline') {
            const snap = this.ambassadorData || {};
            if (snap.PromoterTimeline && snap.TopPromoters) {
                let tl = {};
                snap.TopPromoters.forEach(name => {
                    let pTL = snap.PromoterTimeline[name] || {};
                    Object.keys(pTL).forEach(m => {
                        if (!tl[m]) tl[m] = {};
                        tl[m][name] = (tl[m][name] || 0) + pTL[m];
                    });
                });
                return tl;
            }
        } else {
            const snap = (this.userHistory || []).find(d => d.Timestamp === this.selectedDate) || (this.userHistory || [])[0] || {};
            if (snap[dataAccessor]) {
                let tl = window.Charts.safeParse(snap[dataAccessor]);
                // Cadre chart: fold to canonical cadres so the redraw path matches the
                // selector + initial render (selectedActivities holds canonical names).
                if ((dataAccessor === 'ActivityTimeline' || dataAccessor === 'ProfTimeline') && window.Charts.canonActivityTimeline) tl = window.Charts.canonActivityTimeline(tl);
                return tl;
            }
        }
        return null;
    },

    // Redraw chart + rebuild selector (only used when adding from dropdown)
    _redrawBreakdownAndSelector(stateKey, chartElId, dataAccessor) {
        this._redrawChartOnly(stateKey, chartElId, dataAccessor);

        // Rebuild just the selector container
        const container = document.getElementById('selector_' + stateKey);
        if (container) {
            const allCats = this['_allCats_' + stateKey] || [];
            container.innerHTML = this.buildCategorySelector(allCats, this[stateKey] || [], stateKey, chartElId, dataAccessor, 5);
        }
    },

    renderView() {
        this.renderSidebar();
        this.renderTabBar();
        const body = document.getElementById('view-body') || document.getElementById('main-content');
        const project = this.getCurrentProject();
        if (this._refreshSampleBanner) this._refreshSampleBanner(project);
        if (this._refreshSetupBanner) this._refreshSetupBanner();
        const viewKey = this.currentProject + '::' + this.view;
        const sameView = this._lastRenderedViewKey === viewKey;
        this._lastRenderedViewKey = viewKey;

        // Preserve scroll position across same-view re-renders (e.g. ticking an
        // include box, editing a course) so the page doesn't jump to the top.
        if (sameView) {
            const _de = document.scrollingElement || document.documentElement;
            const _bs = body ? body.scrollTop : 0;
            const _ds = _de ? _de.scrollTop : 0;
            const _restore = () => { if (body) body.scrollTop = _bs; if (_de) _de.scrollTop = _ds; };
            requestAnimationFrame(_restore);
            setTimeout(_restore, 0);
        }

        // Strip fade-in animation when re-rendering the same view
        const _stripFade = () => {
            if (sameView) body.querySelectorAll('.fade-in').forEach(el => el.classList.remove('fade-in'));
        };

        // New project creation view (works regardless of current project)
        if (this.view === 'new-project' && window.GenericViews) {
            GenericViews.renderNewProject(body);
            _stripFade();
            if (window.lucide) lucide.createIcons();
            return;
        }

        // Organisation views
        if (project.type === 'org') {
            if (window.GenericViews) {
                if      (this.view === 'org-calendar')     GenericViews.renderOrgCalendar(body);
                else if (this.view === 'org-table')        GenericViews.renderOrgTable(body);
                else if (this.view === 'org-activities')   GenericViews.renderOrgActivities(body);
                else if (this.view === 'org-settings')     GenericViews.renderOrgSettings(body);
                else if (this.view === 'org-map')          GenericViews.renderOrgMap(body);
                else if (this.view === 'org-methodology')  GenericViews.renderOrgMethodology(body);
                else if (this.view === 'pending-submissions') GenericViews.renderPendingSubmissions(body);
                else GenericViews.renderOrgDashboard(body);
            }
            _stripFade();
            if (window.lucide) lucide.createIcons();
            return;
        }

        // Generic project views
        if (project.type !== 'surghub') {
            if (window.GenericViews) {
                if      (this.view === 'project-dashboard')    GenericViews.renderDashboard(body, project);
                else if (this.view === 'project-calendar')     GenericViews.renderCalendar(body, project);
                else if (this.view === 'project-setup')        GenericViews.renderProjectSetup(body, project);
                else if (this.view === 'project-activities')   GenericViews.renderActivities(body, project);
                // legacy routes — redirect to unified activities view
                else if (this.view === 'project-entry')        GenericViews.renderActivities(body, project);
                else if (this.view === 'project-updates')      GenericViews.renderActivities(body, project);
                else if (this.view === 'project-map')          GenericViews.renderProjectMap(body, project);
                else if (this.view === 'project-reports')      GenericViews.renderReports(body, project);
                else if (this.view === 'project-settings')     GenericViews.renderProjectSettings(body, project);
                else if (this.view === 'pending-submissions')  GenericViews.renderPendingSubmissions(body);
                else GenericViews.renderDashboard(body, project);
            }
            _stripFade();
            if (window.lucide) lucide.createIcons();
            return;
        }

        // SURGhub-specific views below

        // Viewer mode with no data: show import screen
        if (!App.editUnlocked && this.data.length === 0) {
            body.innerHTML = `
                <div class="p-10 max-w-lg mx-auto">
                    <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center mb-4">
                        <div class="w-12 h-12 bg-gsf-prussian/10 rounded-full flex items-center justify-center mx-auto mb-4">
                            <i data-lucide="graduation-cap" width="22" class="text-gsf-prussian"></i>
                        </div>
                        <h2 class="text-lg font-bold text-gsf-prussian mb-2">Load SURGhub Data</h2>
                        <p class="text-sm text-slate-500 mb-5">Import the SURGhub snapshot JSON file shared with you by your administrator.</p>
                        <button onclick="document.getElementById('surghub-json-import').click()"
                            class="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors mb-3">
                            <i data-lucide="upload" width="14"></i> Load SURGhub Snapshot (.json)
                        </button>
                        <input type="file" id="surghub-json-import" accept=".json" class="hidden" onchange="App.importSurghubJson(event)" />
                        <p id="surghub-import-status" class="text-xs text-slate-400 min-h-[18px]"></p>
                    </div>
                    <div class="bg-slate-50 border border-slate-200 rounded-xl p-5 text-center">
                        <p class="text-xs text-slate-500 mb-3">Or restore a complete SURGdash backup (SURGfund + SURGhub):</p>
                        <div class="flex items-center justify-center gap-2 flex-wrap">
                            <button onclick="GenericViews._localRestore()" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-gsf-prussian border border-slate-300 bg-white hover:bg-slate-100 transition-colors">
                                <i data-lucide="hard-drive-upload" width="12"></i> Restore local backup
                            </button>
                            <button onclick="App.currentProject='org'; App.view='org-dashboard'; App.renderView()" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-slate-500 hover:text-gsf-prussian">
                                Go to Org overview →
                            </button>
                        </div>
                    </div>
                </div>`;
            if (window.lucide) lucide.createIcons();
            return;
        }

        // (The in-body "Load New Snapshot" bar was removed — the single "Load Snapshot"
        // button in the top nav is the one place to load a SURGhub snapshot.)

        const shells = this.getShells();

        if (this.view === 'sh-reports') {
            const snapData = this.getAnalyticsSnap();
            const providers = [...new Set(snapData.map(d => d.Provider).filter(Boolean))].sort();
            body.innerHTML = `
                <div class="p-6 md:p-10 fade-in w-full max-w-4xl mx-auto">
                    <header class="mb-8">
                        <h1 class="text-2xl font-bold text-gsf-prussian">Reports</h1>
                        <p class="text-sm text-slate-500 mt-1">Configure report settings and generate report packages for providers.</p>
                    </header>

                    <!-- Feedback Filter -->
                    <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
                        <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide mb-1">Feedback Date Filter</h2>
                        <p class="text-xs text-slate-400 mb-4">Only include written feedback from this date onwards in generated reports. Leave empty to include all feedback.</p>
                        <div class="flex items-center gap-3">
                            <input type="date" id="report-feedback-from" data-report-ok value="${this.reportFeedbackFromDate || ''}"
                                onchange="App.reportFeedbackFromDate=this.value"
                                class="px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            ${this.reportFeedbackFromDate ? '<button onclick="App.reportFeedbackFromDate=&quot;&quot;; App.renderView()" class="text-xs text-red-500 hover:text-red-700 font-bold">Clear</button>' : ''}
                        </div>
                    </div>

                    <!-- ── Bulk Reports & Exports ── -->
                    <div class="bg-white rounded-2xl shadow-sm border p-8 mb-8">
                        <h2 class="text-xl font-bold mb-2 text-gsf-prussian"><i data-lucide="file-text" class="inline mb-1 text-gsf-boston"></i> Bulk Reports & Exports</h2>
                        <p class="text-slate-600 text-sm mb-4">Generate reports or anonymized user data exports for all providers at once. Reports keep all-time totals; the reporting period below clips the charts and adds an activity-within-period section.</p>
                        <div class="flex items-center gap-2 flex-wrap mb-6 bg-slate-50 border rounded-lg px-3 py-2 w-fit">
                            <span class="text-[10px] font-bold uppercase tracking-wide text-slate-400">Reporting period</span>
                            <input type="month" data-report-ok value="${this.reportPeriodFrom || ''}" onchange="App.setReportPeriod('from', this.value)" class="text-xs border rounded px-2 py-1.5 outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            <span class="text-slate-400 text-xs">&ndash;</span>
                            <input type="month" data-report-ok value="${this.reportPeriodTo || ''}" onchange="App.setReportPeriod('to', this.value)" class="text-xs border rounded px-2 py-1.5 outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            ${(this.reportPeriodFrom || this.reportPeriodTo)
                                ? '<span class="text-xs text-gsf-boston font-semibold">' + this.escapeHtml(this._periodLabel()) + '</span><button onclick="App.clearReportPeriod()" class="text-xs text-red-400 hover:text-red-600 font-bold" title="Clear period (back to all-time)">✕</button>'
                                : '<span class="text-xs text-slate-400">all time</span>'}
                        </div>
                        <div class="border border-slate-200 rounded-xl p-4 mb-4 bg-slate-50/40 max-w-4xl">
                            <p class="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Provider reports &amp; exports</p>
                            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                <button onclick="App.exportAllProviderPackages()" class="flex items-center justify-center gap-2 py-3 px-4 bg-white border border-slate-200 text-gsf-prussian font-bold rounded-lg hover:border-gsf-boston hover:text-gsf-boston hover:shadow-md transition-all shadow-sm" title="One folder per provider: PDF report + anonymized users + anonymized feedback (Excel)">
                                    <i data-lucide="package" width="18" class="text-gsf-boston"></i> Full Report Packages
                                </button>
                                <button onclick="App.generateAllProviderReports()" class="flex items-center justify-center gap-2 py-3 px-4 bg-white border border-slate-200 text-gsf-prussian font-bold rounded-lg hover:border-gsf-boston hover:text-gsf-boston hover:shadow-md transition-all shadow-sm">
                                    <i data-lucide="folder-down" width="18" class="text-gsf-boston"></i> All PDF Reports
                                </button>
                                <button onclick="App.exportAllAnonymizedUserData()" class="flex items-center justify-center gap-2 py-3 px-4 bg-white border border-slate-200 text-gsf-prussian font-bold rounded-lg hover:border-gsf-boston hover:text-gsf-boston hover:shadow-md transition-all shadow-sm">
                                    <i data-lucide="users" width="18" class="text-gsf-boston"></i> All User Data Exports
                                </button>
                                <button onclick="App.exportTestimonials()" class="flex items-center justify-center gap-2 py-3 px-4 bg-white border border-slate-200 text-gsf-prussian font-bold rounded-lg hover:border-gsf-boston hover:text-gsf-boston hover:shadow-md transition-all shadow-sm">
                                    <i data-lucide="star" width="18" class="text-gsf-boston"></i> Testimonials Report
                                </button>
                            </div>
                        </div>
                        <div class="mt-4 pt-4 border-t border-slate-100">
                            <p class="text-xs font-bold text-slate-400 uppercase mb-3">AI Curation — all providers</p>
                            <div class="flex flex-wrap gap-3 mb-6">
                                <button onclick="App.scoreFeedbackWithAI()" class="px-4 py-2 bg-gsf-boston/10 text-gsf-boston border border-gsf-boston/20 font-bold rounded-lg text-sm hover:bg-gsf-boston/20 transition-colors">✨ Score all feedback</button>
                                <button onclick="App.autoSelectTestimonials(null)" class="px-4 py-2 bg-gsf-boston/10 text-gsf-boston border border-gsf-boston/20 font-bold rounded-lg text-sm hover:bg-gsf-boston/20 transition-colors" title="Pick the top X comments per course (score ≥ Y) across every provider — fine-tune with the checkboxes on any provider's Feedback tab">⭐ Auto-select for all providers…</button>
                                <button onclick="App.summarizeFeedbackWithAI(null)" class="px-4 py-2 bg-gsf-boston/10 text-gsf-boston border border-gsf-boston/20 font-bold rounded-lg text-sm hover:bg-gsf-boston/20 transition-colors" title="Per-course + per-provider summaries of what learners are saying — shown in the app and in reports">📝 Summarize all…</button>
                            </div>
                            <p class="text-xs font-bold text-slate-400 uppercase mb-3">Report Cover & Back Pages</p>
                            <div class="flex flex-wrap gap-3 text-sm">
                                <div class="flex items-center gap-2">
                                    <span class="text-slate-500">Cover:</span>
                                    ${this.reportCoverPath
                                        ? '<span class="text-gsf-boston font-medium">' + this.escapeHtml(this.reportCoverPath.split('/').pop()) + '</span><button onclick="App.clearCoverPdf()" class="text-red-400 hover:text-red-600 text-xs ml-1">✕</button>'
                                        : '<button onclick="App.pickCoverPdf()" class="text-gsf-boston underline cursor-pointer hover:text-gsf-prussian">Select PDF</button>'}
                                </div>
                                <div class="flex items-center gap-2">
                                    <span class="text-slate-500">Back:</span>
                                    ${this.reportBackPath
                                        ? '<span class="text-gsf-boston font-medium">' + this.escapeHtml(this.reportBackPath.split('/').pop()) + '</span><button onclick="App.clearBackPdf()" class="text-red-400 hover:text-red-600 text-xs ml-1">✕</button>'
                                        : '<button onclick="App.pickBackPdf()" class="text-gsf-boston underline cursor-pointer hover:text-gsf-prussian">Select PDF</button>'}
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- ── Internal: Course-Page Testimonials ── -->
                    <div class="bg-white rounded-2xl shadow-sm border border-purple-200 p-8 mb-8">
                        <h2 class="text-xl font-bold mb-2 text-purple-800 flex items-center gap-2 flex-wrap"><i data-lucide="megaphone" class="inline text-purple-600"></i> Course-Page Testimonials <span class="text-[10px] font-bold uppercase tracking-wider text-purple-500 border border-purple-300 rounded-full px-2 py-0.5">Internal · GSF only</span></h2>
                        <p class="text-slate-600 text-sm mb-4 max-w-3xl">Best testimonials for public course pages. Runs a fresh AI marketing-scoring pass (cached — re-downloads are instant), picks and edits the most compelling quotes, and exports one sheet course-by-course: AI rating · cadre · country · star rating · date. You'll choose the minimum score and the max per course. AI-edited — spot-check before publishing.</p>
                        <button onclick="App.exportCoursePageTestimonials()" class="inline-flex items-center gap-2 py-3 px-5 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-700 hover:shadow-md transition-all shadow-sm">
                            <i data-lucide="megaphone" width="18"></i> Generate Course-Page Testimonials
                        </button>
                    </div>

                    <!-- Selected Testimonials Info -->
                    <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
                        <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide mb-1">Selected Testimonials</h2>
                        <p class="text-xs text-slate-400 mb-4">Select testimonials on the <strong>Providers</strong> or <strong>Courses</strong> tab using the checkboxes. Selected testimonials are used in PDF reports instead of auto-detected ones.</p>
                        <div id="sh-selected-testimonial-summary"></div>
                    </div>
                </div>`;
            // Fill in testimonial summary
            (async () => {
                const sel = (await Storage.getItem('surghub_selected_testimonials')) || {};
                const el = document.getElementById('sh-selected-testimonial-summary');
                if (!el) return;
                let totalCount = 0;
                for (const prov of Object.values(sel)) {
                    if (typeof prov === 'object' && !Array.isArray(prov)) {
                        for (const arr of Object.values(prov)) totalCount += (arr || []).length;
                    } else if (Array.isArray(prov)) totalCount += prov.length; // legacy format
                }
                if (totalCount === 0) {
                    el.innerHTML = '<p class="text-sm text-slate-400 italic">Top 3 testimonials per course are auto-selected. Customise on the Providers tab.</p>';
                } else {
                    let html = '<div class="space-y-3">';
                    for (const [prov, courses] of Object.entries(sel)) {
                        if (typeof courses !== 'object' || Array.isArray(courses)) continue;
                        html += '<div><span class="font-bold text-gsf-prussian text-sm">' + App.escapeHtml(prov) + '</span>';
                        for (const [course, items] of Object.entries(courses)) {
                            if (!items || items.length === 0) continue;
                            html += '<div class="ml-4 flex items-center gap-2 text-xs text-slate-500"><span class="text-slate-600 font-medium">' + App.escapeHtml(course) + '</span><span>\u2014 ' + items.length + ' selected</span></div>';
                        }
                        html += '</div>';
                    }
                    html += '</div>';
                    el.innerHTML = html;
                }
            })();
            if (window.lucide) lucide.createIcons();
        }
        else if (this.view === 'manage') {
            body.innerHTML = `
                <div class="p-6 md:p-10 fade-in w-full max-w-6xl mx-auto">
                    <header class="mb-8"><h1 class="text-2xl font-bold text-gsf-prussian">Directory</h1></header>

                    ${(() => {
                        const provCounts = {};
                        this.data.forEach(d => { if (d.IsShell || !d.Provider) return; (provCounts[d.Provider] = provCounts[d.Provider] || new Set()).add(d.Course); });
                        const provs = Object.keys(provCounts).sort((a, b) => a.localeCompare(b));
                        if (!provs.length) return '';
                        const excludedN = provs.filter(p => !this.isProviderIncluded(p)).length;
                        return `<div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-8">
                            <div class="bg-slate-50 border-b p-5 flex justify-between items-center gap-3">
                                <div><h2 class="font-bold text-lg text-gsf-prussian">Providers (${provs.length})</h2><p class="text-xs text-slate-500 mt-1">Untick a provider to exclude it — and all its courses — from every analytic, dashboard total and report.</p></div>
                                <div class="flex items-center gap-2 shrink-0">
                                    <span id="prov-exclude-badge" class="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 whitespace-nowrap" style="${excludedN ? '' : 'display:none'}">${excludedN} excluded</span>
                                    <button data-edit-only onclick="App.addNewProvider()" class="px-3 py-1.5 bg-gsf-boston text-white text-xs font-bold rounded-lg hover:bg-gsf-prussian transition-colors whitespace-nowrap">+ Add Provider</button>
                                </div>
                            </div>
                            <div class="max-h-[320px] overflow-y-auto custom-scrollbar divide-y divide-slate-100">
                                ${provs.map(p => { const inc = this.isProviderIncluded(p); const n = provCounts[p].size; return '<label class="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-slate-50 cursor-pointer">' + '<span class="text-sm ' + (inc ? 'text-gsf-prussian font-medium' : 'text-slate-400 line-through') + '">' + this.escapeHtml(p) + ' <span class="text-xs text-slate-400 font-normal">(' + n + ' course' + (n !== 1 ? 's' : '') + ')</span></span>' + '<input type="checkbox" ' + (inc ? 'checked' : '') + ' data-prov="' + this.escapeHtml(p) + '" onchange="App.toggleProviderIncluded(this.getAttribute(\'data-prov\'), this.checked, this)">' + '</label>'; }).join('')}
                            </div>
                        </div>`;
                    })()}

                    <div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-8">
                        <div class="bg-slate-50 border-b p-5 flex justify-between items-center">
                            <h2 class="font-bold text-lg text-gsf-prussian">Tracked Course Directory (${shells.length})</h2>
                            <button data-edit-only onclick="App.addNewCourse()" class="px-4 py-2 bg-gsf-boston text-white text-sm font-bold rounded-lg hover:bg-gsf-prussian transition-colors">+ Add Course</button>
                        </div>
                        <div class="overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar">
                            <table class="w-full text-left border-collapse text-sm table-fixed">
                                <thead class="sticky top-0 bg-white shadow-sm z-10"><tr class="border-b text-slate-500">
                                    <th class="py-3 px-3 font-medium w-[110px] cursor-pointer hover:text-gsf-boston select-none" onclick="App._sortCourseDir('provider')">Provider ${this._shCourseSortCol==='provider' ? (this._shCourseSortAsc ? '&#9650;' : '&#9660;') : '<span class="text-slate-300">&#8597;</span>'}</th>
                                    <th class="py-3 px-3 font-medium cursor-pointer hover:text-gsf-boston select-none" onclick="App._sortCourseDir('course')">Course Title ${this._shCourseSortCol==='course' ? (this._shCourseSortAsc ? '&#9650;' : '&#9660;') : '<span class="text-slate-300">&#8597;</span>'}</th>
                                    <th class="py-3 px-3 font-medium text-right w-[80px] cursor-pointer hover:text-gsf-boston select-none" onclick="App._sortCourseDir('learners')">Learners ${this._shCourseSortCol==='learners' ? (this._shCourseSortAsc ? '&#9650;' : '&#9660;') : '<span class="text-slate-300">&#8597;</span>'}</th>
                                    <th class="py-3 px-3 font-medium text-right w-[70px] cursor-pointer hover:text-gsf-boston select-none" onclick="App._sortCourseDir('responses')">Resp. ${this._shCourseSortCol==='responses' ? (this._shCourseSortAsc ? '&#9650;' : '&#9660;') : '<span class="text-slate-300">&#8597;</span>'}</th>
                                    <th class="py-3 px-3 font-medium text-right w-[60px] cursor-pointer hover:text-gsf-boston select-none" onclick="App._sortCourseDir('rating')">Rating ${this._shCourseSortCol==='rating' ? (this._shCourseSortAsc ? '&#9650;' : '&#9660;') : '<span class="text-slate-300">&#8597;</span>'}</th>
                                    <th class="py-3 px-3 font-medium text-center w-[40px] cursor-pointer hover:text-gsf-boston select-none" onclick="App._sortCourseDir('url')">URL ${this._shCourseSortCol==='url' ? (this._shCourseSortAsc ? '&#9650;' : '&#9660;') : '<span class="text-slate-300">&#8597;</span>'}</th>
                                    <th class="py-3 px-3 font-medium text-center w-[60px]">Include</th>
                                    <th class="py-3 px-3 font-medium text-center w-[40px]"></th>
                                </tr></thead>
                                <tbody>
                                    ${(() => {
                                        // Enrich shells with latest data for sorting
                                        const enriched = shells.map((s, idx) => {
                                            // A title can now map to >1 record (e.g. a published course + its
                                            // draft clone). Pick the most-enrolled as the representative so the
                                            // badge shows the live/published status, not a 0-learner clone.
                                            const d = this.data.filter(course => course.Course === s.Course && !course.IsShell)
                                                .sort((a, b) => (Number(b.Learners) || 0) - (Number(a.Learners) || 0))[0] || {};
                                            return { ...s, idx, Learners: Number(d.Learners) || 0, Responses: Number(d.Responses) || 0, Rating: Number(d.Rating) || 0, Access: (d && d.Access) || null, isExcluded: this.data.some(course => course.Course === s.Course && course.Excluded) };
                                        });
                                        const col = this._shCourseSortCol;
                                        const asc = this._shCourseSortAsc;
                                        enriched.sort((a, b) => {
                                            let va, vb;
                                            if (col === 'provider') { va = a.Provider.toLowerCase(); vb = b.Provider.toLowerCase(); }
                                            else if (col === 'course') { va = a.Course.toLowerCase(); vb = b.Course.toLowerCase(); }
                                            else if (col === 'learners') { va = a.Learners; vb = b.Learners; }
                                            else if (col === 'responses') { va = a.Responses; vb = b.Responses; }
                                            else if (col === 'rating') { va = a.Rating; vb = b.Rating; }
                                            else if (col === 'url') { va = a.URL ? 1 : 0; vb = b.URL ? 1 : 0; }
                                            else { va = a.Learners; vb = b.Learners; }
                                            if (va < vb) return asc ? -1 : 1;
                                            if (va > vb) return asc ? 1 : -1;
                                            return 0;
                                        });
                                        return enriched.map(s => {
                                            const provEsc = this.escapeHtml(s.Provider).replace(/'/g, '&#39;');
                                            const courseEsc = this.escapeHtml(s.Course).replace(/'/g, '&#39;');
                                            const isUnknownProv = s.Provider === 'Unknown Provider';
                                            return `<tr class="border-b hover:bg-slate-50 ${s.isExcluded ? 'opacity-40' : ''}">
                                            <td class="py-2 px-3 text-xs truncate" title="${this.escapeHtml(s.Provider)} — click to view provider page">
                                                ${isUnknownProv
                                                    ? '<span class="text-red-500 italic">' + this.escapeHtml(s.Provider) + '</span>'
                                                    : '<button onclick="App.openProvider(\'' + provEsc + '\')" class="text-slate-600 hover:text-gsf-boston hover:underline text-left">' + this.escapeHtml(s.Provider) + '</button>'}
                                            </td>
                                            <td class="py-2 px-3 font-bold text-xs truncate" title="${this.escapeHtml(s.Course)} — click to view course page">
                                                <button onclick="App.openCourse(\'${courseEsc}\')" class="text-gsf-prussian hover:text-gsf-boston hover:underline text-left">${this.escapeHtml(s.Course)}</button>${this._courseStatusBadge(s.Access)}
                                            </td>
                                            <td class="py-2 px-3 text-right text-xs font-medium">${this.formatNumber(s.Learners)}</td>
                                            <td class="py-2 px-3 text-right text-gsf-boston text-xs font-medium">${this.formatNumber(s.Responses)}</td>
                                            <td class="py-2 px-3 text-right text-xs font-medium ${s.Rating >= 4 ? 'text-green-600' : s.Rating > 0 ? 'text-gsf-crimson' : 'text-slate-300'}">${s.Rating > 0 ? s.Rating.toFixed(2) : '-'}</td>
                                            <td class="py-2 px-3 text-center text-xs">${s.URL ? '<span class="text-green-600">Y</span>' : '<span class="text-red-400">N</span>'}</td>
                                            <td class="py-2 px-3 text-center"><input type="checkbox" ${s.isExcluded ? '' : 'checked'} onchange="App.toggleExcludeCourse(${s.idx})" title="${s.isExcluded ? 'Click to include in analytics' : 'Click to exclude from analytics'}"></td>
                                            <td class="py-2 px-3 text-center"><button data-edit-only onclick="App.editCourseByIndex(${s.idx})" class="text-gsf-boston hover:text-gsf-prussian text-xs underline">edit</button></td>
                                        </tr>`;
                                        }).join('');
                                    })()}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div data-edit-only class="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200 mb-8">
                        <div class="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
                            <div class="bg-gsf-polo/20 text-gsf-boston p-2 rounded-lg"><i data-lucide="file-text"></i></div>
                            <h2 class="text-lg font-bold text-gsf-prussian">Report Settings</h2>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                            <div>
                                <label class="block text-xs font-bold text-slate-500 mb-2 uppercase">Cover Page (PDF)</label>
                                <div class="flex items-center gap-2">
                                    ${this.reportCoverPath
                                        ? '<span class="text-xs text-green-700 font-mono truncate flex-1" title="' + this.escapeHtml(this.reportCoverPath) + '">Set</span><button onclick="App.clearCoverPdf()" class="text-xs text-red-500 hover:underline">Remove</button>'
                                        : '<span class="text-xs text-slate-400 flex-1">None</span>'}
                                    <button onclick="App.pickCoverPdf()" class="px-3 py-1 bg-slate-100 text-slate-700 text-xs font-bold rounded hover:bg-slate-200 transition-colors">Choose PDF</button>
                                </div>
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-500 mb-2 uppercase">Back Page (PDF)</label>
                                <div class="flex items-center gap-2">
                                    ${this.reportBackPath
                                        ? '<span class="text-xs text-green-700 font-mono truncate flex-1" title="' + this.escapeHtml(this.reportBackPath) + '">Set</span><button onclick="App.clearBackPdf()" class="text-xs text-red-500 hover:underline">Remove</button>'
                                        : '<span class="text-xs text-slate-400 flex-1">None</span>'}
                                    <button onclick="App.pickBackPdf()" class="px-3 py-1 bg-slate-100 text-slate-700 text-xs font-bold rounded hover:bg-slate-200 transition-colors">Choose PDF</button>
                                </div>
                            </div>
                        </div>
                        <p class="text-xs text-slate-400">Cover and back pages will be prepended/appended to every generated provider report.</p>
                    </div>
                </div>
            `;
        }
        else if (this.view === 'upload') {
            body.innerHTML = `
                <div class="p-6 md:p-10 max-w-6xl mx-auto w-full fade-in">
                    <header class="mb-8">
                        <h1 class="text-2xl font-bold text-gsf-prussian">Data Sync</h1>
                        <p class="text-slate-500 text-sm mt-1">Keep SURGdash in step with LearnWorlds. The numbered cards below are ordered — follow them top to bottom before a reporting round.</p>
                    </header>

                    <!-- ── What to sync, when (checklist) ── -->
                    <div class="bg-white border border-slate-200 rounded-2xl p-6 mb-4 shadow-sm">
                        <div class="flex items-center gap-2 mb-3">
                            <i data-lucide="list-checks" width="18" class="text-gsf-prussian"></i>
                            <h2 class="text-lg font-bold text-gsf-prussian">What to sync, when</h2>
                        </div>
                        <div class="grid md:grid-cols-3 gap-4 text-sm text-slate-600">
                            <div class="bg-slate-50 rounded-lg p-4 border border-slate-100">
                                <p class="font-bold text-gsf-prussian mb-1 text-xs uppercase tracking-wide">Weekly / after course changes</p>
                                <p><strong>Sync Everything</strong> (runs cards 1 + 3 back-to-back). Walk away, one summary at the end.</p>
                            </div>
                            <div class="bg-amber-50 rounded-lg p-4 border border-amber-100">
                                <p class="font-bold text-amber-800 mb-1 text-xs uppercase tracking-wide">Before every reporting round</p>
                                <p>Run cards <strong>1 → 2 → 3 → 4 in order</strong>: Sync Courses, upload User Progress, Sync Learners, Sync Surveys. Card 4 also refreshes the signup survey (gender/org) if auto-fetch is set up — otherwise upload it in card 3. Then export reports. ~30 min total, mostly waiting.</p>
                            </div>
                            <div class="bg-slate-50 rounded-lg p-4 border border-slate-100">
                                <p class="font-bold text-gsf-prussian mb-1 text-xs uppercase tracking-wide">Occasionally</p>
                                <p><strong>5 · Growth Timelines</strong> via API (refreshes learner→course maps), and the <strong>Social Activity CSV</strong> in Manual Imports — the only source for Social Engagement.</p>
                            </div>
                        </div>
                    </div>

                    <!-- ── Sync Everything: one click, runs both sequentially ── -->
                    <div class="bg-gsf-prussian rounded-2xl p-5 mb-4 shadow-md flex flex-wrap items-center justify-between gap-4">
                        <div class="min-w-0">
                            <div class="flex items-center gap-2 mb-1">
                                <i data-lucide="rocket" width="18" class="text-white"></i>
                                <h2 class="text-lg font-bold text-white">Sync Everything</h2>
                                <span class="text-[10px] font-bold uppercase text-gsf-prussian bg-white/90 px-2 py-0.5 rounded-full">~10–15 min</span>
                            </div>
                            <p class="text-sm text-white/80 max-w-3xl">One click: runs <strong>Sync Courses</strong> + <strong>Sync Learners &amp; Ambassadors</strong> back-to-back. The User Progress upload (card 2) and the survey token paste (card 4) still need you — see the checklist above. Walk away — a single summary appears when done.</p>
                        </div>
                        <button onclick="App.runFullSync()" class="shrink-0 px-8 py-4 bg-white text-gsf-prussian font-bold rounded-lg shadow-sm hover:bg-slate-100 transition-colors text-base flex items-center gap-2">
                            <i data-lucide="cloud-download" width="18"></i> Sync Everything
                        </button>
                    </div>

                    <!-- ── 1. Sync Courses: course foundation + analytics ── -->
                    <div class="bg-gradient-to-br from-sky-50 to-white border border-sky-200 rounded-2xl p-6 mb-4 shadow-sm">
                        <div class="flex flex-wrap items-center justify-between gap-4">
                            <div class="min-w-0">
                                <div class="flex items-center gap-2 mb-1">
                                    <i data-lucide="book-open" width="18" class="text-sky-600"></i>
                                    <h2 class="text-lg font-bold text-gsf-prussian">1 · Sync Courses</h2>
                                    <span class="text-[10px] font-bold uppercase text-sky-700 bg-sky-100 border border-sky-200 px-2 py-0.5 rounded-full">~5 min</span>
                                </div>
                                <p class="text-sm text-slate-600 max-w-3xl">Course-level metrics via LearnWorlds API: <strong>learners, certificates, learning time, success rate, providers</strong>. Always run this <strong>first</strong> — it also repairs counts, clamps timelines to launch dates, and re-applies exact dates from the User Progress upload.</p>
                            </div>
                            <button onclick="App.syncCourseFoundationFromApi()" class="shrink-0 px-8 py-4 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-lg shadow-md transition-colors text-base flex items-center gap-2">
                                <i data-lucide="refresh-cw" width="18"></i> Sync Courses
                            </button>
                        </div>
                        <!-- Provider Map + Course Links — persistent, decoupled from course export -->
                        <div class="mt-4 pt-4 border-t border-sky-100">
                            <div class="flex items-center gap-2 mb-1">
                                <i data-lucide="link" width="14" class="text-sky-600"></i>
                                <h3 class="text-sm font-bold text-gsf-prussian">Provider Map & Survey Links</h3>
                                <span id="mapping-status" class="text-xs text-slate-400 ml-1"></span>
                            </div>
                            <p class="text-xs text-slate-500 mb-3">The API has no provider or survey-link data — upload the SharePoint Excel files here. Stored permanently (survives wipes) and <strong>auto-applied on every course sync</strong>. Uploading also applies them to your existing courses immediately.</p>
                            <div class="flex flex-wrap items-center gap-2">
                                <a href="#" onclick="electronAPI.openExternal('https://globalsurgeryfoundationor-my.sharepoint.com/:x:/g/personal/s_hofbauer_globalsurgeryfoundation_org/IQBuYWMN5vTcQKSBpQx4f7X-Aarpg2-Lra-wBb59WiWfkh8?e=RdAykI'); return false" class="text-[11px] text-sky-700 hover:underline">Open Provider Map ↗</a>
                                <button onclick="document.getElementById('provider-map-input').click()" class="px-4 py-2 bg-white border border-sky-300 text-sky-700 text-xs font-bold rounded-lg hover:bg-sky-50">Upload Provider Map</button>
                                <input id="provider-map-input" type="file" accept=".csv,.xlsx,.xls" class="hidden" onchange="App.uploadProviderMapFile(event)" />

                                <a href="#" onclick="electronAPI.openExternal('https://globalsurgeryfoundationor-my.sharepoint.com/:x:/g/personal/s_hofbauer_globalsurgeryfoundation_org/IQDxxOtHcx5FTrAdRD-lfx4jAbaOwFz9nGD2rb7bzzj3fQY?e=dKeCfk'); return false" class="text-[11px] text-sky-700 hover:underline ml-2">Open Course Links ↗</a>
                                <button onclick="document.getElementById('course-links-input').click()" class="px-4 py-2 bg-white border border-sky-300 text-sky-700 text-xs font-bold rounded-lg hover:bg-sky-50">Upload Course Links</button>
                                <input id="course-links-input" type="file" accept=".csv,.xlsx,.xls" class="hidden" onchange="App.uploadCourseLinksFile(event)" />

                                <button onclick="App.applyProviderLinkMapping()" class="px-4 py-2 bg-sky-100 text-sky-800 text-xs font-bold rounded-lg hover:bg-sky-200">Apply to existing courses now</button>
                                <button onclick="App.clearProviderLinkMapping()" class="px-4 py-2 text-slate-400 hover:text-red-600 text-xs font-medium">Clear stored mapping</button>
                            </div>
                        </div>
                    </div>

                    <!-- ── 2. Upload User Progress (exact dates + learning time) ── -->
                    <div class="bg-gradient-to-br from-indigo-50 to-white border border-indigo-200 rounded-2xl p-6 mb-4 shadow-sm">
                        <div class="flex items-center gap-2 mb-1">
                            <i data-lucide="clipboard-list" width="18" class="text-indigo-600"></i>
                            <h2 class="text-lg font-bold text-gsf-prussian">2 · Upload User Progress</h2>
                            <span class="text-[10px] font-bold uppercase text-indigo-700 bg-indigo-100 border border-indigo-200 px-2 py-0.5 rounded-full">xlsx · before each report</span>
                            ${this._rawCompletion && this._rawCompletion.length > 0 ? '<span class="inline-flex items-center gap-1.5 text-xs text-slate-400 font-medium ml-2"><i data-lucide="check-circle-2" width="12" class="text-green-500"></i> ' + this.formatNumber(this._rawCompletion.length) + ' learner records loaded</span>' : ''}
                        </div>
                        <p class="text-sm text-slate-600 max-w-3xl mb-3">The per-user progress export is the <strong>only source of exact learner dates</strong> — it makes every growth curve precise, and fills per-learner <strong>learning time and completion</strong> for the provider report packages.</p>
                        <p class="text-xs text-slate-500 mb-3"><a href="#" onclick="electronAPI.openExternal('https://www.surghub.org/author/userprogress'); return false" class="text-indigo-700 hover:underline font-medium">Open User Progress</a> → filter <strong>Registered: before <em>tomorrow's date</em></strong> ("before" excludes the chosen day, so tomorrow captures everyone) → <strong>Export user progress</strong> (Excel) → wait for it in the <strong>Reports log</strong> (LearnWorlds admin → Reports) → download → upload here. Or use the saved <a href="#" onclick="electronAPI.openExternal('https://www.surghub.org/author/usersegments?segmentId=18'); return false" class="text-indigo-700 hover:underline font-medium">User Segment ↗</a> and export its <strong>Summary</strong> report — same data, one xlsx (not the CSV ZIP used for Social Activity).</p>
                        <div class="flex flex-wrap items-center gap-3">
                            <button onclick="document.getElementById('completion-upload-input').click()" class="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-sm transition-colors text-sm flex items-center gap-2"><i data-lucide="clipboard-list" width="16"></i> Upload User Progress xlsx</button>
                            <input id="completion-upload-input" type="file" accept=".xlsx,.xls" onchange="App.processStandaloneCompletion(event)" class="hidden" />
                            <span class="text-xs text-slate-400 italic">Also accepts the Course Insights overview export (one row per course) — used to reconcile official totals.</span>
                        </div>
                        <p class="text-xs text-slate-400 mt-2 italic">Run card 1 first — records are matched to the synced course list by name.</p>
                    </div>

                    <!-- ── 3. Sync Learners & Ambassadors ── -->
                    <div class="bg-gradient-to-br from-emerald-50 to-white border border-emerald-200 rounded-2xl p-6 mb-4 shadow-sm">
                        <div class="flex flex-wrap items-center justify-between gap-4">
                            <div class="min-w-0">
                                <div class="flex items-center gap-2 mb-1">
                                    <i data-lucide="users" width="18" class="text-emerald-600"></i>
                                    <h2 class="text-lg font-bold text-gsf-prussian">3 · Sync Learners &amp; Ambassadors</h2>
                                    <span class="text-[10px] font-bold uppercase text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full">~5 min</span>
                                </div>
                                <p class="text-sm text-slate-600 max-w-3xl">All user-side data via LearnWorlds API: <strong>demographics</strong> (country, profession — gender comes from the signup survey below), <strong>lead attribution</strong> (historical + orphan leads), and <strong>ambassador referrals &amp; timeline</strong>.</p>
                            </div>
                            <button onclick="App.runDeepSync()" class="shrink-0 px-8 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-md transition-colors text-base flex items-center gap-2">
                                <i data-lucide="cloud-download" width="18"></i> Sync Learners
                            </button>
                        </div>
                        <div class="mt-4 pt-4 border-t border-emerald-100 flex flex-wrap items-center gap-3">
                            <p class="text-xs text-slate-500 flex-1 min-w-[280px]"><strong>Signup survey</strong> (Gender + Organisation Type) — these answers never reach user tags, so they need the Assessment Submissions export: upload it here, or let <strong>Sync Surveys auto-fetch it</strong> (card 4).</p>
                            <button onclick="document.getElementById('signup-survey-upload-input').click()" class="shrink-0 px-5 py-2 bg-white border border-emerald-300 hover:border-emerald-500 text-emerald-700 font-bold rounded-lg shadow-sm transition-colors text-xs flex items-center gap-2"><i data-lucide="user-check" width="14"></i> Upload Signup Survey</button>
                            <input id="signup-survey-upload-input" type="file" accept=".csv,.xlsx,.xls" onchange="App.processSignupSurvey(event)" class="hidden" />
                        </div>
                    </div>

                    <!-- ── 4. Sync Surveys (needs a fresh pasted token) ── -->
                    <div class="bg-gradient-to-br from-amber-50 to-white border border-amber-200 rounded-2xl p-6 mb-6 shadow-sm">
                        <div class="flex items-center gap-2 mb-1">
                            <i data-lucide="message-square-text" width="18" class="text-amber-600"></i>
                            <h2 class="text-lg font-bold text-gsf-prussian">4 · Sync Surveys</h2>
                            <span class="text-[10px] font-bold uppercase text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full">paste token</span>
                        </div>
                        <p class="text-sm text-slate-600 max-w-3xl mb-3">Fetches ratings + feedback for every course that has a survey link. The API key <strong>can't</strong> authorise survey exports, so paste one fresh download URL below for its short-lived token — then it loops all courses automatically.</p>
                        <p class="text-xs text-slate-500 mb-2"><a href="#" onclick="electronAPI.openExternal('https://www.surghub.org/author/answers?assessment-id=68f7b49e2de0d89f1301ef5c&from=library'); return false" class="text-amber-700 hover:underline font-medium">Open Survey Exports</a> → export any assessment as XLS → copy the download URL (<kbd class="px-1 py-0.5 bg-slate-100 border rounded text-[10px]">Cmd+L</kbd> then <kbd class="px-1 py-0.5 bg-slate-100 border rounded text-[10px]">Cmd+C</kbd>) → paste here.</p>
                        <div class="flex flex-wrap items-center gap-3">
                            <input type="text" placeholder="https://api.us-e2.learnworlds.com/...access_token=..." oninput="App.tokenText = this.value" value="${this.tokenText || ''}" class="flex-1 min-w-[280px] px-4 py-3 border rounded-lg text-sm font-mono" />
                            <button onclick="App.runSurveyFetch()" class="shrink-0 px-8 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg shadow-sm transition-colors text-sm flex items-center gap-2">
                                <i data-lucide="message-square-text" width="16"></i> Sync Surveys
                            </button>
                        </div>
                        <p class="text-xs text-slate-400 mt-2 italic">Not part of "Sync Everything" — the token expires, so this one always needs a fresh paste.</p>
                        <div class="border-t border-amber-100 mt-4 pt-4 flex flex-wrap items-center gap-3">
                            <p class="text-xs text-slate-500 flex-1 min-w-[280px]"><strong>Signup survey</strong> (Gender + Organisation Type): save its export URL once and every Sync Surveys run re-fetches it with the fresh token — no manual uploads.</p>
                            <button onclick="App.setSignupSurveyUrl()" class="shrink-0 px-5 py-2 bg-white border border-amber-300 hover:border-amber-500 text-amber-700 font-bold rounded-lg shadow-sm transition-colors text-xs flex items-center gap-2">
                                <i data-lucide="link" width="14"></i> ${this.signupSurveyUrl ? 'Auto-Fetch: ON — change URL…' : 'Set up Signup-Survey Auto-Fetch…'}
                            </button>
                            ${this.signupSurveyUrl ? '<span class="inline-flex items-center gap-1.5 text-xs text-slate-400 font-medium"><i data-lucide="check-circle-2" width="12" class="text-green-500"></i> Fetches with every run</span>' : ''}
                        </div>
                    </div>

                    <!-- ── 5. Growth Timelines (optional — superseded by the User Progress upload for most uses) ── -->
                    <div class="bg-gradient-to-br from-violet-50 to-white border border-violet-200 rounded-2xl p-6 mb-4 shadow-sm">
                        <div class="flex items-center gap-2 mb-1">
                            <i data-lucide="trending-up" width="18" class="text-violet-600"></i>
                            <h2 class="text-lg font-bold text-gsf-prussian">5 · Growth Timelines</h2>
                            <span class="text-[10px] font-bold uppercase text-violet-700 bg-violet-100 border border-violet-200 px-2 py-0.5 rounded-full">optional</span>
                        </div>
                        <p class="text-sm text-slate-600 max-w-3xl mb-3">Usually <strong>not needed</strong> — card 2's User Progress upload already builds exact monthly history. Still useful for courses missing from that file, and the <strong>API fetch also refreshes the learner→course maps</strong> behind the anonymized User Data exports (run it every few months).</p>
                        <div class="flex flex-wrap items-center gap-3">
                            <button onclick="document.getElementById('timeline-upload-input-main').click()" class="px-6 py-3 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-lg shadow-sm transition-colors text-sm flex items-center gap-2"><i data-lucide="calendar-clock" width="15"></i> Upload Timeline Files</button>
                            <input id="timeline-upload-input-main" type="file" multiple accept=".xlsx,.xls,.csv" onchange="App.processRetroactiveHistory(event)" class="hidden" />
                            <a href="#" onclick="electronAPI.openExternal('https://www.surghub.org/author/usersegments?segmentId=9'); return false" class="text-xs text-violet-700 hover:underline">Open User Segments ↗</a>
                            <span class="text-xs text-slate-400 italic">Recommended &amp; fast — export the User Segment ZIP and drop the files here.</span>
                        </div>
                        <div class="mt-3 pt-3 border-t border-violet-100 flex flex-wrap items-center gap-2">
                            <button onclick="App.syncGrowthTimelinesFromApi()" class="px-4 py-2 bg-violet-100 text-violet-800 text-xs font-bold rounded-lg hover:bg-violet-200">Or fetch via API</button>
                            <span class="text-xs text-slate-400 italic">Slow (30–60+ min at current scale) but hands-off — and the only path that refreshes the learner→course maps behind the anonymized User Data exports.</span>
                        </div>
                    </div>


                    <!-- ── LearnWorlds API credentials (collapsible) ── -->
                    <details class="bg-white rounded-xl shadow-sm border border-slate-200 mb-6" id="lw-api-creds-panel">
                        <summary class="cursor-pointer p-5 flex items-center gap-3 select-none">
                            <i data-lucide="key-round" width="20" class="text-gsf-boston"></i>
                            <span class="font-bold text-gsf-prussian">LearnWorlds API Credentials</span>
                            <span id="lw-api-status" class="ml-auto text-xs text-slate-400 font-medium"></span>
                        </summary>
                        <div class="px-5 pb-5 pt-2 border-t border-slate-100">
                            <p class="text-sm text-slate-500 mb-4">Provision in SURGhub admin → <strong>Settings → Integrations → API & Webhooks → New App</strong>. Credentials are stored locally only — they're never uploaded to Google Sheets or shared snapshots.</p>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Client ID (Lw-Client)</label>
                                    <input type="text" id="lw-client-id" placeholder="e.g. 6534a..." class="w-full px-3 py-2 border rounded-lg text-sm font-mono" />
                                </div>
                                <div>
                                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Access Token (Bearer)</label>
                                    <input type="password" id="lw-api-token" placeholder="paste API token" class="w-full px-3 py-2 border rounded-lg text-sm font-mono" />
                                </div>
                            </div>
                            <div class="flex flex-wrap items-center gap-2">
                                <button onclick="App.saveLearnWorldsCreds()" class="px-5 py-2 bg-gsf-boston text-white text-sm font-bold rounded-lg hover:bg-gsf-prussian">Save</button>
                                <button onclick="App.testLearnWorldsCreds()" class="px-5 py-2 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200">Test connection</button>
                                <button onclick="App.probeLearnWorldsApi()" class="px-5 py-2 bg-amber-100 text-amber-800 text-sm font-bold rounded-lg hover:bg-amber-200" title="Probes ~15 API endpoints once each and reports what's available on this plan. Open DevTools console to see results.">Probe capabilities</button>
                                <span id="lw-api-result" class="text-xs ml-2"></span>
                            </div>
                        </div>
                    </details>

                    <!-- ── Manual CSV imports (fallback) — collapsed ── -->
                    <details class="mb-6">
                        <summary class="cursor-pointer select-none bg-slate-100 hover:bg-slate-200 rounded-xl px-5 py-4 flex items-center gap-2 text-slate-600 font-bold text-sm">
                            <i data-lucide="folder-up" width="16"></i> Manual CSV Imports (fallback — only if the API is unavailable)
                        </summary>
                        <div class="pt-4 space-y-1">
                        <p class="text-xs text-slate-400 italic mb-3 px-1">Legacy CSV/Excel fallbacks for the API syncs above — plus the <strong>Social Activity uploads (steps 5–6)</strong>, which remain the only source for the Social Engagement section. (Step 3 duplicates card 5's timeline upload; User Progress and Signup Survey moved to the main flow above.)</p>

                    <!-- ── STEP 1: Course Foundation ── -->
                    <div class="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200 mb-6">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="flex items-center justify-center w-8 h-8 rounded-full bg-gsf-boston text-white text-sm font-black">1</span>
                            <h2 class="text-lg font-bold text-gsf-prussian">Course Foundation</h2>
                        </div>
                        <p class="text-sm text-slate-500 mb-5 ml-11">Imports learner counts, certificates, and learning hours from the LearnWorlds Course Export. Optionally attach a Provider Map to assign providers, and a Course Links file for URLs.</p>
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6 ml-11">
                            <div><label class="block text-xs font-bold text-slate-500 mb-2 uppercase">Snapshot Date *</label><input type="date" value="${this.updateDate}" onchange="App.updateDate = this.value" class="w-full px-4 py-2 border rounded-lg text-sm" /></div>
                            <div><label class="block text-xs font-bold text-gsf-boston mb-2 uppercase">Course Export *</label><a href="#" onclick="electronAPI.openExternal('https://www.surghub.org/author/courseinsights?tab=Analytics'); return false" class="text-[10px] text-gsf-boston hover:underline ml-1">Open on LearnWorlds</a><input type="file" accept=".csv,.xlsx" onchange="App.masterFile = this.files[0]" class="w-full text-sm" /></div>
                            <div><label class="block text-xs font-bold text-slate-500 mb-2 uppercase">Provider Map</label><a href="#" onclick="electronAPI.openExternal('https://globalsurgeryfoundationor-my.sharepoint.com/:x:/g/personal/s_hofbauer_globalsurgeryfoundation_org/IQBuYWMN5vTcQKSBpQx4f7X-Aarpg2-Lra-wBb59WiWfkh8?e=RdAykI'); return false" class="text-[10px] text-gsf-boston hover:underline ml-1">Open on SharePoint</a><input type="file" accept=".csv,.xlsx" onchange="App.mappingFile = this.files[0]" class="w-full text-sm" /></div>
                            <div><label class="block text-xs font-bold text-slate-500 mb-2 uppercase">Course Links File</label><a href="#" onclick="electronAPI.openExternal('https://globalsurgeryfoundationor-my.sharepoint.com/:x:/g/personal/s_hofbauer_globalsurgeryfoundation_org/IQDxxOtHcx5FTrAdRD-lfx4jAbaOwFz9nGD2rb7bzzj3fQY?e=dKeCfk'); return false" class="text-[10px] text-gsf-boston hover:underline ml-1">Open on SharePoint</a><input type="file" accept=".csv,.xlsx" onchange="App.linksFile = this.files[0]" class="w-full text-sm" /></div>
                        </div>
                        <div class="ml-11 flex flex-wrap items-center gap-3">
                            <button onclick="App.startAutomatedUpdate()" class="px-8 py-3 bg-gsf-boston hover:bg-gsf-prussian text-white font-bold rounded-lg shadow-sm transition-colors text-sm">Sync from CSV</button>
                            <button onclick="App.syncCourseFoundationFromApi()" class="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-sm transition-colors text-sm"><i data-lucide="cloud-download" class="inline mr-1" width="14"></i> Sync from LearnWorlds API</button>
                            <span class="text-xs text-slate-400 italic">API path skips the CSV upload entirely — just runs.</span>
                        </div>
                    </div>

                    <!-- ── STEP 2: Survey Intelligence ── -->
                    <div class="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200 mb-6 ${this.data.length === 0 ? 'opacity-50 pointer-events-none' : ''}">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="flex items-center justify-center w-8 h-8 rounded-full bg-gsf-crimson text-white text-sm font-black">2</span>
                            <h2 class="text-lg font-bold text-gsf-prussian">Survey Intelligence</h2>
                            ${this.data.length === 0 ? '<span class="text-xs text-slate-400 italic">(Run card 1 — Sync Courses — or Step 1 first)</span>' : ''}
                        </div>
                        <p class="text-sm text-slate-500 mb-4 ml-11">Fetches survey ratings and feedback from LearnWorlds. Paste the download URL from the Survey Exports page &mdash; the app auto-extracts the API token and fetches all responses.</p>
                        <div class="mb-4 ml-11">
                            <label class="block text-sm font-bold text-slate-700 mb-1">Survey Export Link *</label>
                            <p class="text-xs text-slate-500 mb-2"><a href="#" onclick="electronAPI.openExternal('https://www.surghub.org/author/answers?assessment-id=68f7b49e2de0d89f1301ef5c&from=library'); return false" class="text-gsf-boston hover:underline font-medium">Open Survey Exports</a> &mdash; Export as XLS, then copy the download URL (<kbd class="px-1 py-0.5 bg-slate-100 border rounded text-[10px]">Cmd+L</kbd> then <kbd class="px-1 py-0.5 bg-slate-100 border rounded text-[10px]">Cmd+C</kbd>)</p>
                            <input type="text" placeholder="https://api.us-e2.learnworlds.com/..." oninput="App.tokenText = this.value" value="${this.tokenText || ''}" class="w-full px-4 py-3 border rounded-lg text-sm font-mono" />
                        </div>
                        <div class="ml-11">
                        ${this.isLoading ? `
                            <div class="p-5 bg-gsf-polo/10 border border-gsf-polo/30 rounded-lg">
                                <div class="flex justify-between items-center mb-2">
                                    <span id="progress-text" class="text-sm font-bold text-gsf-prussian">${this.loadingText}</span>
                                    <span id="progress-count" class="text-sm font-bold text-gsf-boston">${this.currentUpdateIndex} / ${this.totalUpdateCount}</span>
                                </div>
                                <div class="w-full bg-slate-200 rounded-full h-3 shadow-inner overflow-hidden">
                                    <div id="progress-bar" class="bg-gsf-boston h-3 rounded-full transition-all duration-300" style="width: ${(this.currentUpdateIndex / Math.max(1, this.totalUpdateCount)) * 100}%"></div>
                                </div>
                            </div>
                        ` : `
                            <button onclick="App.runSurveyFetch()" class="px-8 py-3 bg-gsf-prussian hover:bg-slate-900 text-white font-bold rounded-lg shadow-sm transition-colors text-sm">Run Survey Fetcher</button>
                        `}
                        </div>
                    </div>

                    <!-- ── STEP 3: Historical Timelines ── -->
                    <div class="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200 mb-6">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="flex items-center justify-center w-8 h-8 rounded-full bg-amber-500 text-white text-sm font-black">3</span>
                            <h2 class="text-lg font-bold text-gsf-prussian">Historical Timelines</h2>
                        </div>
                        <p class="text-sm text-slate-500 mb-4 ml-11">Upload User Segment exports to build historical learner/certificate charts over time. The app extracts timestamps from course-level Excel files to construct monthly growth data.</p>
                        <p class="text-xs text-slate-500 mb-4 ml-11"><a href="#" onclick="electronAPI.openExternal('https://www.surghub.org/author/usersegments?segmentId=9'); return false" class="text-gsf-boston hover:underline font-medium">Open User Segments</a> &mdash; Add filter: certificates &lt; 9999999, then export as ZIP with all courses selected.</p>
                        <div class="ml-11">
                            <button onclick="document.getElementById('timeline-upload-input').click()" class="px-8 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg shadow-sm transition-colors text-sm"><i data-lucide="calendar-clock" class="inline mr-2" width="16"></i> Upload Timeline Files</button>
                            <input id="timeline-upload-input" type="file" multiple accept=".xlsx,.xls,.csv" onchange="App.processRetroactiveHistory(event)" class="hidden" />
                        </div>
                    </div>

                    <!-- ── STEP 4: Learner Demographics ── -->
                    <div class="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200 mb-6">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="flex items-center justify-center w-8 h-8 rounded-full bg-[#7A9E9F] text-white text-sm font-black">4</span>
                            <h2 class="text-lg font-bold text-gsf-prussian">Learner Demographics</h2>
                            ${this._lastUpdatedBadge('audience')}
                        </div>
                        <p class="text-sm text-slate-500 mb-4 ml-11">Upload the Users export to populate the Audience tab with demographic breakdowns (country, profession) and unique user counts. This does <strong>not</strong> affect course learner numbers.</p>
                        <p class="text-xs text-slate-500 mb-4 ml-11"><a href="#" onclick="electronAPI.openExternal('https://www.surghub.org/author/users?tab=user'); return false" class="text-gsf-boston hover:underline font-medium">Export User Report</a> &mdash; Go to Users, select all, and export as CSV/Excel.</p>
                        <div class="ml-11 flex flex-wrap items-center gap-3">
                            <button onclick="document.getElementById('audience-upload-input-sync').click()" class="px-8 py-3 bg-[#7A9E9F] hover:bg-[#6a8e8f] text-white font-bold rounded-lg shadow-sm transition-colors text-sm"><i data-lucide="users" class="inline mr-2" width="16"></i> Upload Users File</button>
                            <button onclick="App.syncDemographicsFromApi()" class="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-sm transition-colors text-sm"><i data-lucide="cloud-download" class="inline mr-1" width="14"></i> Sync from API</button>
                            <input id="audience-upload-input-sync" type="file" accept=".csv,.xlsx,.xls" onchange="App.processStandaloneAudience(event)" class="hidden" />
                            <span class="text-xs text-slate-400 italic">API: ~3 min for 49k users</span>
                        </div>
                    </div>

                    <!-- ── STEP 5: Social Activity (Active Subset) ── -->
                    <div class="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200 mb-6">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="flex items-center justify-center w-8 h-8 rounded-full bg-gsf-tango text-white text-sm font-black">5</span>
                            <h2 class="text-lg font-bold text-gsf-prussian">Social Activity — Active Subset</h2>
                            ${this._rawSocial && this._rawSocial.length > 0 ? '<span class="inline-flex items-center gap-1.5 text-xs text-slate-400 font-medium ml-2"><i data-lucide="check-circle-2" width="12" class="text-green-500"></i> ' + this.formatNumber(this._rawSocial.length) + ' user records loaded</span>' : ''}
                        </div>
                        <p class="text-sm text-slate-500 mb-4 ml-11">Quick path — only includes learners who have <strong>posted or liked something</strong>. Smaller file, faster to download. Use this for a fast refresh of the Social Engagement section.</p>
                        <p class="text-xs text-slate-500 mb-4 ml-11">
                            <a href="#" onclick="electronAPI.openExternal('https://www.surghub.org/author/usersegments?segmentId=14'); return false" class="text-gsf-boston hover:underline font-medium">Open User Segments Report (segmentId=14)</a>
                            &mdash; set filters to <strong>more than 0 posts OR more than 0 comments</strong>, then download as <strong>CSV</strong>.
                        </p>
                        <div class="ml-11">
                            <button onclick="document.getElementById('social-upload-input').click()" class="px-8 py-3 bg-gsf-tango hover:bg-orange-600 text-white font-bold rounded-lg shadow-sm transition-colors text-sm"><i data-lucide="message-square-text" class="inline mr-2" width="16"></i> Upload Social Activity CSV</button>
                            <input id="social-upload-input" type="file" accept=".csv,.xlsx,.xls" onchange="App.processStandaloneSocial(event)" class="hidden" />
                        </div>
                    </div>

                    <!-- ── STEP 6: Social Activity (Full Dataset) ── -->
                    <div class="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200 mb-6">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="flex items-center justify-center w-8 h-8 rounded-full bg-gsf-tango text-white text-sm font-black">6</span>
                            <h2 class="text-lg font-bold text-gsf-prussian">Social Activity — Full Dataset</h2>
                            <span class="text-[10px] font-bold uppercase text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full">Recommended</span>
                        </div>
                        <p class="text-sm text-slate-500 mb-4 ml-11">Comprehensive — covers <strong>all registered learners</strong>, including those who never posted. Larger file but the most complete picture. Use this for the deepest analysis (every quadrant including Ghosts is accurate).</p>
                        <p class="text-xs text-slate-500 mb-4 ml-11">
                            <a href="#" onclick="electronAPI.openExternal('https://www.surghub.org/author/usersegments?segmentId=18'); return false" class="text-gsf-boston hover:underline font-medium">Open User Segments Report (segmentId=18)</a>
                            &mdash; set both filters to <strong>less than 999999 comments / posts</strong> (effectively unfiltered), then download as <strong>ZIP</strong>. Extract the ZIP and upload the CSV inside.
                        </p>
                        <div class="ml-11">
                            <button onclick="document.getElementById('social-full-upload-input').click()" class="px-8 py-3 bg-gsf-tango hover:bg-orange-600 text-white font-bold rounded-lg shadow-sm transition-colors text-sm"><i data-lucide="users-round" class="inline mr-2" width="16"></i> Upload Full Social CSV</button>
                            <input id="social-full-upload-input" type="file" accept=".csv,.xlsx,.xls" onchange="App.processStandaloneSocial(event)" class="hidden" />
                        </div>
                        <p class="text-xs text-slate-400 mt-3 ml-11 italic">ℹ Steps 5 and 6 share the same parser and storage — uploading either replaces the previous. Step 6 (full) is usually preferred; Step 5 (active) is a faster alternative when you only need contributor metrics.</p>
                    </div>

                    <!-- ── STEP 7: Ambassador Referrals ── -->
                    <div class="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200 mb-8">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="flex items-center justify-center w-8 h-8 rounded-full bg-gsf-prussian text-white text-sm font-black">7</span>
                            <h2 class="text-lg font-bold text-gsf-prussian">Ambassador Referrals</h2>
                            ${this._lastUpdatedBadge('ambassador')}
                        </div>
                        <p class="text-sm text-slate-500 mb-4 ml-11">Upload the Leads export to track ambassador referral performance. This powers the Ambassadors tab with referral counts and top-ambassador rankings.</p>
                        <p class="text-xs text-slate-500 mb-4 ml-11"><a href="#" onclick="electronAPI.openExternal('https://www.surghub.org/author/affiliates?tab=leads'); return false" class="text-gsf-boston hover:underline font-medium">Export Leads Report</a> &mdash; Go to Affiliates &rarr; Leads, and export as CSV/Excel.</p>
                        <div class="ml-11 flex flex-wrap items-center gap-3">
                            <button onclick="document.getElementById('ambassador-upload-input-sync').click()" class="px-8 py-3 bg-gsf-prussian hover:bg-[#001f33] text-white font-bold rounded-lg shadow-sm transition-colors text-sm"><i data-lucide="megaphone" class="inline mr-2" width="16"></i> Upload Leads File</button>
                            <button onclick="App.syncAmbassadorsFromApi()" class="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-sm transition-colors text-sm"><i data-lucide="cloud-download" class="inline mr-1" width="14"></i> Sync from API</button>
                            <input id="ambassador-upload-input-sync" type="file" accept=".csv,.xlsx,.xls" onchange="App.processStandaloneAmbassadors(event)" class="hidden" />
                            <span class="text-xs text-slate-400 italic">API: ~90 sec for 245 ambassadors</span>
                        </div>
                    </div>

                        </div><!-- /pt-4 -->
                    </details>

                    <!-- ── Divider ── -->
                    <div class="border-t border-slate-200 my-8"></div>

                    <!-- ── Share Snapshot (for team viewers) ── -->
                    <div class="bg-white rounded-2xl shadow-sm border p-8 mb-8">
                        <h2 class="text-xl font-bold mb-1 text-gsf-prussian"><i data-lucide="share-2" class="inline mb-1 text-gsf-boston"></i> Share with Team</h2>
                        <p class="text-slate-500 text-sm mb-5">Export a SURGhub data snapshot as a JSON file. Share it with colleagues — they can load it into their viewer app to see the latest platform analytics.</p>
                        <div class="flex flex-wrap items-center gap-3">
                            <button onclick="App.exportSurghubJson()" class="flex items-center gap-2 py-3 px-6 bg-gsf-boston text-white font-bold rounded-lg hover:bg-gsf-prussian transition-colors shadow-sm text-sm">
                                <i data-lucide="file-down" width="16"></i> Export SURGhub Snapshot (.json)
                            </button>
                            <button onclick="document.getElementById('surghub-datasync-import').click()" class="flex items-center gap-2 py-3 px-6 bg-slate-100 text-slate-700 font-bold rounded-lg hover:bg-slate-200 transition-colors shadow-sm text-sm">
                                <i data-lucide="file-up" width="16"></i> Import Snapshot (.json)
                            </button>
                            <input type="file" id="surghub-datasync-import" accept=".json" class="hidden" onchange="App.importSurghubJson(event)" />
                        </div>
                    </div>

                    <!-- ── Danger Zone ── -->
                    <div class="max-w-md mb-8" data-edit-only>
                        <div class="bg-red-50 rounded-xl border border-red-200 p-6 space-y-4">
                            <h3 class="font-bold text-red-700"><i data-lucide="alert-triangle" class="inline mr-1" width="16"></i> Danger Zone</h3>

                            <div>
                                <p class="text-amber-700/80 text-xs mb-2">Wipe only the SURGhub analytics data (courses, learners, ambassadors, social). Your SURGfund projects and LearnWorlds API credentials are kept. Repopulate via Data Sync.</p>
                                <button onclick="App.wipeSurghubData()" class="w-full py-2.5 bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold rounded-lg border border-amber-300 transition-colors text-sm">Wipe SURGhub Data Only</button>
                            </div>

                            <div class="border-t border-red-200 pt-4">
                                <p class="text-red-600/70 text-xs mb-2">Permanently delete <strong>all</strong> SURGdash data from local storage — including SURGfund projects. This cannot be undone.</p>
                                <button onclick="App.clearAllData()" class="w-full py-2.5 bg-red-100 hover:bg-red-200 text-red-700 font-bold rounded-lg border border-red-300 transition-colors text-sm">Clear All Local Database</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            // Populate LearnWorlds API credential inputs asynchronously after
            // the DOM is in place (Storage reads are async; can't be inlined).
            setTimeout(() => { if (App._populateLearnWorldsCreds) App._populateLearnWorldsCreds(); }, 0);
        }
        else if (this.view === 'platform') {
            const snapData = this.getAnalyticsSnap();
            // Platform totals INCLUDE course-level-excluded courses (active-but-private):
            // exclusion only hides a course from listings/reports, never from the platform total.
            const platSnap = this.getPlatformSnap();
            // Course & provider COUNTS reflect only included courses (and providers
            // with >=1 included course); every other KPI below sums across all
            // courses (platSnap) incl. active-but-private ones.
            const providers = [...new Set(snapData.map(d => d.Provider).filter(Boolean))].sort();

            let lrn=0, cert=0, resp=0, rSum=0, cRated=0;
            let fallbackUsers = this.platformUniqueUsers || 0;
            // userHistory is appended oldest-first (updater pushes), so fall back to the
            // NEWEST row by Timestamp — never [0] (the oldest) — to match the Ask-data pack.
            const audSnap = (this.userHistory || []).find(d => d.Timestamp === this.selectedDate) || (this.userHistory || []).slice().reduce((a, b) => (a && String(a.Timestamp) > String(b.Timestamp) ? a : b), null) || null;
            const totalAudience = audSnap && audSnap.TotalUsers ? audSnap.TotalUsers : fallbackUsers;

            let studyMin = 0;
            const courseMins = this.getCourseLearningMinutes(); // anon fallback for un-enriched courses
            platSnap.forEach(d => {
                lrn += (Number(d.Learners)||0);
                cert += (Number(d.Certificates)||0);
                resp += (Number(d.Responses)||0);
                studyMin += this.courseLearningMinutes(d, courseMins);
                let rat = Number(d.Rating)||0;
                if(rat>0){rSum+=rat; cRated++;}
            });
            const avgRat = cRated > 0 ? (rSum/cRated).toFixed(2) : '0.00';
            const studyYears = studyMin > 0 ? (studyMin / 525960).toFixed(1) + ' yrs' : '-';

            // Merged platform + learner cards (one grid, 2 rows of 5)
            const kpiCards = [
                { label: 'Providers', value: providers.length, color: '#206095', icon: 'building-2' },
                { label: 'Courses', value: snapData.length, color: '#4389C8', icon: 'book-open' },
                { label: 'Registered Users', value: this.formatNumber(totalAudience), raw: totalAudience, color: '#1a5276', icon: 'users', title: 'Distinct SURGhub accounts — people who registered on the platform' },
                { label: 'Enrolled Learners', value: this.formatNumber(lrn), raw: lrn, color: '#4389C8', icon: 'user-plus', title: 'Course enrolments — one registered user can enrol in several courses, so this exceeds Registered Users' },
                { label: 'Certificates', value: this.formatNumber(cert), raw: cert, color: '#7A9E9F', icon: 'award' },
                { label: 'Certification Rate', value: this.formatCertRate(cert, lrn), raw: (this.formatCertRate(cert, lrn, { asNumber: true }) || 0), color: '#B8860B', icon: 'badge-check', title: 'Certificates awarded ÷ total learners, all time' },
                { label: 'Learning Time', value: studyYears, raw: studyMin, color: '#5B8C5A', icon: 'clock', title: studyMin ? Math.round(studyMin).toLocaleString() + ' learner-minutes total' : 'Run Sync Courses to populate' },
                { label: 'Countries', value: (audSnap && audSnap.KnownCountry) ? this.formatNumber(audSnap.KnownCountry) : '-', raw: (audSnap && audSnap.KnownCountry) || 0, color: '#5AA9E6', icon: 'globe' },
                { label: 'Avg Rating', value: avgRat, color: '#D03734', icon: 'star' },
                { label: 'Survey Responses', value: this.formatNumber(resp), raw: resp, color: '#E28743', icon: 'message-square' },
                { label: 'Conflict Settings', value: this.formatNumber(this.getConflictLearners(audSnap)), raw: this.getConflictLearners(audSnap), color: '#e57373', icon: 'shield-alert', title: 'Learners from conflict-affected settings (' + this.CONFLICT_COUNTRIES.join(', ') + '). Extrapolated to the full user base — country is known for ' + (audSnap && audSnap.CountryKnownPct ? audSnap.CountryKnownPct : '?') + '% of learners, and that share is scaled up assuming the rest match the same country mix.' },
            ];

            const dt = this._dashTab || 'overview';
            const dashPills = [
                ['overview', 'Overview', 'layout-dashboard'],
                ['learners', 'Learners', 'users'],
                ['geography', 'Geography', 'globe'],
                ['performance', 'Performance', 'award'],
                ['feedback', 'Feedback', 'message-square'],
                ['health', 'Data Health', 'shield-check'],
            ].map(([k, l, ic]) => `<button onclick="App._dashTab='${k}'; App.renderView()" class="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${dt === k ? 'bg-gsf-prussian text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}"><i data-lucide="${ic}" width="15"></i> ${l}</button>`).join('');

            let dashContent;
            if (dt === 'learners') dashContent = this._dashLearnersHtml(audSnap);
            else if (dt === 'geography') dashContent = this._dashGeographyHtml(audSnap);
            else if (dt === 'performance') dashContent = this._dashPerformanceHtml(snapData);
            else if (dt === 'feedback') dashContent = this._dashFeedbackHtml(snapData);
            else if (dt === 'health') dashContent = this._dashHealthHtml(snapData, audSnap);
            else dashContent = this._dashOverviewHtml(snapData, audSnap, kpiCards);

            body.innerHTML = `
                <div class="p-6 md:p-10 fade-in w-full max-w-7xl mx-auto">
                    <header class="flex justify-between items-end gap-4 mb-6">
                        <div>
                            <h1 class="text-3xl font-black text-gsf-prussian mb-2">Dashboard</h1>
                            <div class="flex items-center gap-3 mt-1">
                                <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" ${this.hideLowLearners ? 'checked' : ''} onchange="App.hideLowLearners=this.checked; App.renderView()"> Exclude courses with &lt; 50 learners</label>
                                ${this._lastUpdatedBadge('course')}
                            </div>
                        </div>
                        <div class="flex items-center gap-3">
                            ${!App.editUnlocked ? `
                                <button onclick="document.getElementById('surghub-json-refresh').click()"
                                    class="flex items-center gap-2 px-4 py-2 bg-gsf-boston text-white font-bold rounded-lg text-sm shadow-sm hover:bg-gsf-prussian transition-colors">
                                    <i data-lucide="upload" width="14"></i> Load New Snapshot
                                </button>
                                <input type="file" id="surghub-json-refresh" accept=".json" class="hidden" onchange="App.importSurghubJson(event)" />
                            ` : ``}
                        </div>
                    </header>

                    <div class="inline-flex items-center gap-1 mb-8 bg-white border rounded-xl p-1 shadow-sm">${dashPills}</div>

                    <div data-edit-only class="bg-white border rounded-xl shadow-sm p-4 mb-8">
                        <div class="flex items-center gap-2 mb-2">
                            <i data-lucide="sparkles" class="text-gsf-boston" width="16"></i>
                            <h2 class="font-bold text-sm text-gsf-prussian">Ask the data</h2>
                            <span class="text-xs text-slate-400 hidden sm:inline">— plain-English questions, answered only from your verified figures</span>
                        </div>
                        <div class="flex gap-2">
                            <input id="ask-data-input" type="text" placeholder="e.g. How many learners are in LMICs?  ·  Which provider has the most certificates?  ·  Top 5 countries by learners" class="flex-1 border rounded-lg px-3 py-2 text-sm outline-none focus:border-gsf-boston" onkeydown="if(event.key==='Enter'){event.preventDefault();App.askDataSubmit();}">
                            <button onclick="App.askDataSubmit()" class="px-4 py-2 bg-gsf-boston text-white text-sm font-bold rounded-lg hover:bg-gsf-prussian transition-colors shrink-0"><i data-lucide="search" class="inline" width="13"></i> Ask</button>
                        </div>
                        <div id="ask-data-result" class="mt-3"></div>
                    </div>

                    ${dashContent}
                </div>
            `;
            if (window.Charts) {
                const _d = () => {
                    window.Charts.drawPlatform(this.getPlatformHistory(), platSnap);
                    if (audSnap && audSnap.TotalUsers) window.Charts.drawAudience(audSnap);
                };
                setTimeout(_d, 80); setTimeout(_d, 400);
            }
        }
        else if (this.view === 'audience') {
            // Audience is merged into the Dashboard tab now
            this.view = 'platform';
            this._dashTab = 'learners';
            return this.renderView();
        }
        else if (this.view === 'ambassadors') {
            const snap = this.ambassadorData || {};
            // Lazy-load the persisted referrer→learner bridge summary (once) so it
            // survives reloads; rebuild is via the button in _ambassadorReachSection.
            if (this._referrerBridge === undefined) { this._referrerBridge = null; if (window.Storage) Storage.getItem('surghub_referrer_bridge').then(v => { if (v) { this._referrerBridge = v; if (this.view === 'ambassadors') this.renderView(); } }).catch(() => {}); }
            let allAmbassadors = [];
            if (snap.TopPromoters) allAmbassadors = snap.TopPromoters;

            // Referral-link clicks (visits) — total + conversion to leads (signups).
            const ambClicks = Number(snap.TotalClicks) || 0;
            const ambLeadsForRate = (snap.HistoricalTotal != null) ? snap.HistoricalTotal : (snap.TotalReferrals || 0);
            const ambConv = ambClicks > 0 ? ((ambLeadsForRate / ambClicks) * 100).toFixed(1) + '%' : '–';
            const ambCardCount = 2 + (snap.HistoricalTotal != null ? 2 : 0) + (ambClicks ? 2 : 0);
            const ambLgCols = ambCardCount >= 6 ? 3 : (ambCardCount >= 4 ? 4 : 2);
            const ambMetric = ambClicks ? (this.ambTopMetric || 'leads') : 'leads';

            body.innerHTML = `
                <div class="p-10 fade-in w-full max-w-7xl mx-auto">
                    <header class="flex justify-between items-end mb-8">
                        <div>
                            <h1 class="text-3xl font-black text-gsf-prussian">Ambassador Analytics</h1>
                            <div class="flex items-center gap-3 mt-2">
                                <p class="text-slate-500 text-sm">Upload the "Leads" export to view ambassador referrals. <a href="#" data-edit-only onclick="electronAPI.openExternal('https://www.surghub.org/author/affiliates?tab=leads'); return false" class="text-gsf-boston hover:underline font-medium">Export Leads Report</a></p>
                                ${this._lastUpdatedBadge('ambassador')}
                            </div>
                        </div>
                        ${this.isLoading ? '<div class="text-gsf-boston font-bold">Processing Ambassadors...</div>' : `
                            <button data-edit-only onclick="document.getElementById('ambassador-upload-input').click()" class="bg-gsf-boston text-white px-6 py-3 rounded-lg font-bold shadow-sm hover:bg-gsf-prussian transition-colors">
                                <i data-lucide="upload-cloud" class="inline mr-2" width="18"></i> Upload Leads File
                            </button>
                        `}
                        <input id="ambassador-upload-input" data-edit-only type="file" accept=".csv,.xlsx,.xls" onchange="App.processStandaloneAmbassadors(event)" class="hidden" />
                    </header>

                    ${snap.TotalReferrals ? `
                        <div class="flex items-center justify-end mb-2">
                            <button data-edit-only onclick="App.openHtmlExport()" class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-gsf-boston hover:bg-slate-50 rounded-lg transition-colors ml-1"><i data-lucide="file-code-2" width="12"></i> Export HTML</button>
                        </div>
                        <div id="amb-kpi-grid" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                            ${[
                                { label: 'Attributable Referrals', value: this.formatNumber(snap.TotalReferrals), raw: snap.TotalReferrals, color: '#4389C8', icon: 'user-plus', sub: 'leads (signups via referral)' },
                                { label: 'Active Ambassadors', value: this.formatNumber(snap.TotalAmbassadors), raw: snap.TotalAmbassadors, color: '#1a5276', icon: 'megaphone' },
                                ...(ambClicks ? [
                                    { label: 'Ref. Link Clicks', value: this.formatNumber(ambClicks), raw: ambClicks, color: '#E28743', icon: 'mouse-pointer-click', sub: 'link visits (all-time)' },
                                    { label: 'Click → Lead Rate', value: ambConv, color: '#7A9E9F', icon: 'percent', sub: 'leads ÷ clicks' }
                                ] : []),
                                ...((this._referrerBridge && this._referrerBridge.hasOutcomes) ? [
                                    { label: 'Referred-Learner Certs', value: this.formatNumber(this._referrerBridge.totalCerts), raw: this._referrerBridge.totalCerts, color: '#3FB984', icon: 'award', sub: 'certificates earned by referred learners' },
                                    { label: 'Referred-Learner Courses', value: this.formatNumber(this._referrerBridge.totalCourses), raw: this._referrerBridge.totalCourses, color: '#206095', icon: 'book-open', sub: 'course-enrolments by referred learners' },
                                    { label: 'Activation Rate', value: (this._referrerBridge.totalBridged > 0 ? Math.round((this._referrerBridge.activeLearners || 0) / this._referrerBridge.totalBridged * 100) + '%' : '–'), color: '#7A9E9F', icon: 'activity', sub: 'referred learners who started a course' }
                                ] : []),
                                ...((this._referrerBridge && this._referrerBridge.totalBridged) ? [
                                    { label: 'Attribution Coverage', value: Math.round((this._referrerBridge.namedReach || 0) / this._referrerBridge.totalBridged * 100) + '%', color: '#94A3B8', icon: 'user-check', sub: this.formatNumber(this._referrerBridge.namedReach || 0) + ' of ' + this.formatNumber(this._referrerBridge.totalBridged) + ' referred learners matched to a roster ambassador' }
                                ] : [])
                            ].map(k => `<div class="group relative bg-white rounded-xl border shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow" onclick="App._copyKpiCard(this)">
                                <div class="h-1" style="background:${k.color}"></div>
                                <div class="p-6">
                                    <div class="flex items-center gap-1.5 mb-2"><i data-lucide="${k.icon}" width="14" style="color:${k.color}" class="shrink-0"></i><h3 class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">${k.label}</h3></div>
                                    <div class="text-4xl font-bold leading-none tracking-tight" style="color:${k.color};font-family:var(--num)">${k.value}</div>
                                    ${k.sub ? `<div class="text-[10px] text-slate-400 mt-1">${k.sub}</div>` : ''}
                                </div>
                                <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"><i data-lucide="copy" width="10" class="text-slate-300"></i></div>
                            </div>`).join('')}
                        </div>

                        ${this._ambassadorAwards(snap)}

                        <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
                            <h3 class="text-lg font-bold mb-4 flex items-center gap-2 text-gsf-prussian">Cumulative Referrals Over Time ${this._chartWidthBtns('chart_ambassador_total')} ${this._resetChartBtn('chart_ambassador_total')} ${this._chartBtns('chart_ambassador_total', 'Referrals_Growth')}</h3>
                            <div class="mb-3 flex flex-wrap gap-4 items-center">
                                <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" data-viewer-allowed id="toggle-amb-growth-bars" onchange="if(window.Charts && App.ambassadorData) window.Charts.drawAmbassadors(App.ambassadorData)"> Show monthly bars</label>
                                <label class="inline-flex items-center gap-2 text-sm text-slate-600">
                                    <span class="text-xs font-semibold text-slate-400 uppercase">Period</span>
                                    <select data-viewer-allowed onchange="App.ambGrowthRange=this.value; if(window.Charts && App.ambassadorData) window.Charts.drawAmbassadors(App.ambassadorData)" class="bg-white border rounded px-2 py-1 text-slate-700 outline-none text-xs">
                                        ${[{v:'3',l:'Last 3 mo'},{v:'6',l:'Last 6 mo'},{v:'12',l:'Last 12 mo'},{v:'24',l:'Last 24 mo'},{v:'all',l:'All time'}].map(r=>`<option value="${r.v}" ${String(this.ambGrowthRange)===r.v?'selected':''}>${r.l}</option>`).join('')}
                                    </select>
                                </label>
                                <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer" title="Drama mode — start y-axis near the first visible value to exaggerate slope. Use sparingly.">
                                    <input type="checkbox" data-viewer-allowed ${this.ambGrowthTrim ? 'checked' : ''} onchange="App.ambGrowthTrim=this.checked; if(window.Charts && App.ambassadorData) window.Charts.drawAmbassadors(App.ambassadorData)">
                                    <span>Trim y-axis <span class="text-[10px] text-slate-400">(drama)</span></span>
                                </label>
                                ${this._partialMonthToggle()}
                            </div>
                            ${this.ambGrowthTrim ? '<p class="text-[11px] text-amber-600 italic mb-2">⚠ Y-axis trimmed — slope exaggerated.</p>' : ''}
                            <div style="${this._chartWidthStyle('chart_ambassador_total')}">
                                <div id="chart_ambassador_total" style="width: 100%; height: 400px;"></div>
                            </div>
                            ${this._partialMonthCaption()}
                        </div>

                        <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
                            <div class="flex justify-between items-start gap-4 flex-wrap mb-4">
                                <div>
                                    <h3 class="text-lg font-bold flex items-center gap-2 text-gsf-prussian">Top Ambassadors ${this._chartBtns('chart_ambassador_bar', 'Top_Ambassadors')}</h3>
                                    ${(() => {
                                        if (ambMetric === 'clicks') {
                                            return `<p class="text-xs text-slate-500 mt-1">Ranked by <strong>referral-link clicks</strong> (all-time) · <strong>${this.formatNumber(ambClicks)}</strong> total clicks</p>`;
                                        }
                                        const f = this._filterTopAmbassadors ? this._filterTopAmbassadors() : null;
                                        if (!f) return '';
                                        const num = Object.keys(f.filtered).length;
                                        return `<p class="text-xs text-slate-500 mt-1">${this.escapeHtml(f.label)} · <strong>${this.formatNumber(num)}</strong> ambassador${num === 1 ? '' : 's'} active · <strong>${this.formatNumber(f.totalInWindow || 0)}</strong> referrals in window</p>`;
                                    })()}
                                </div>
                                <div class="flex items-center gap-3 flex-wrap">
                                    ${ambClicks ? `<div class="inline-flex rounded-lg border border-slate-200 overflow-hidden text-[11px] font-bold">
                                        <button onclick="App.ambTopMetric='leads'; App.renderView()" class="px-3 py-1 ${ambMetric==='leads' ? 'bg-gsf-boston text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}">Leads</button>
                                        <button onclick="App.ambTopMetric='clicks'; App.renderView()" class="px-3 py-1 ${ambMetric==='clicks' ? 'bg-gsf-boston text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}">Clicks</button>
                                    </div>` : ''}
                                    <label class="inline-flex items-center gap-2 text-xs text-slate-600">
                                        <span class="font-semibold text-slate-400 uppercase tracking-wide">Show</span>
                                        <input type="number" min="5" max="50" step="5" value="${this.ambTopLimit}" onchange="App._setAmbTopLimit(this.value)" class="w-16 px-2 py-1 border rounded text-slate-700 outline-none text-xs">
                                        <span class="text-slate-500">bars</span>
                                    </label>
                                </div>
                            </div>
                            ${ambMetric === 'leads' ? `
                            <!-- Window selector (leads only — clicks are an all-time counter) -->
                            <div class="flex flex-wrap items-center gap-2 mb-4">
                                <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mr-1">Time window</span>
                                ${[
                                    { v: '1',  l: 'This month' },
                                    { v: '3',  l: 'Last 3 mo' },
                                    { v: '6',  l: 'Last 6 mo' },
                                    { v: '12', l: 'Last 12 mo' },
                                    { v: 'all', l: 'All time' },
                                    { v: 'custom', l: 'Custom…' },
                                ].map(w => `<button onclick="App._setAmbTopWindow('${w.v}')" class="px-2.5 py-1 rounded text-[11px] font-bold ${this.ambTopWindow===w.v ? 'bg-gsf-boston text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">${w.l}</button>`).join('')}
                            </div>
                            ${this.ambTopWindow === 'custom' ? `
                                <div class="flex flex-wrap items-center gap-2 mb-4 p-3 bg-blue-50/40 border border-blue-100 rounded">
                                    <span class="text-xs font-semibold text-slate-600">From</span>
                                    <input type="month" value="${this.ambTopCustomStart || ''}" onchange="App._setAmbTopCustomStart(this.value)" class="bg-white border rounded px-2 py-1 text-slate-700 outline-none text-xs">
                                    <span class="text-xs font-semibold text-slate-600">to</span>
                                    <input type="month" value="${this.ambTopCustomEnd || ''}" onchange="App._setAmbTopCustomEnd(this.value)" class="bg-white border rounded px-2 py-1 text-slate-700 outline-none text-xs">
                                    <span class="text-[10px] text-slate-400 italic">Inclusive month range. Referrals are bucketed monthly.</span>
                                </div>
                            ` : ''}
                            ` : '<p class="text-[11px] text-slate-400 italic mb-4">Clicks are an all-time counter (no per-click dates) — the time window doesn\'t apply.</p>'}
                            <div id="chart_ambassador_bar" style="width: 100%; height: 400px;"></div>
                        </div>

                        ${this._ambassadorPerformanceTable(snap)}

                        ${this._ambassadorReengagement(snap)}

                        ${ambClicks ? `
                        <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
                            <h3 class="text-lg font-bold mb-1 flex items-center gap-2 text-gsf-prussian">Quality vs Volume ${this._chartBtns('chart_ambassador_scatter', 'Ambassador_Quality_Volume')}</h3>
                            <p class="text-xs text-slate-500 mb-3">Each dot is an ambassador with ≥20 referral clicks. X = leads (volume), Y = click→lead conversion (quality). Colour shows the quadrant relative to the median of each axis — the green corner is high-volume <em>and</em> high-quality.</p>
                            <div class="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-[11px] text-slate-500">
                                <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full" style="background:#3FB984"></span>High volume · High quality</span>
                                <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full" style="background:#4389C8"></span>High volume · Lower quality</span>
                                <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full" style="background:#E28743"></span>Lower volume · High quality</span>
                                <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full" style="background:#94A3B8"></span>Lower volume · Lower quality</span>
                            </div>
                            <div id="chart_ambassador_scatter" style="width: 100%; height: 380px;"></div>
                        </div>` : ''}

                        <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
                            <h3 class="text-lg font-bold mb-4 flex items-center gap-2 text-gsf-prussian">Top Ambassadors Over Time ${this._chartBtns('chart_ambassador_top5', 'Ambassador_Trends')}</h3>
                            <div class="flex flex-wrap gap-4 items-center">
                                ${this._timelineControls('amb-top', this.ambassadorsTimelineRange || 'all')}
                                ${this._partialMonthToggle()}
                            </div>
                            <div id="selector_selectedAmbassadors">${allAmbassadors.length > 0 ? this.buildCategorySelector(allAmbassadors, this.selectedAmbassadors || [], 'selectedAmbassadors', 'chart_ambassador_top5', 'PromoterTimeline', 5) : ''}</div>
                            <div id="chart_ambassador_top5" style="width: 100%; height: 450px;"></div>
                            ${this._partialMonthCaption()}
                        </div>
                    ` : '<div class="bg-white p-12 text-center text-slate-500 italic rounded-xl border">No Ambassador Data uploaded yet.</div>'}
                </div>
            `;
            if(snap.TotalReferrals && window.Charts) { const _d = () => window.Charts.drawAmbassadors(snap); setTimeout(_d, 80); setTimeout(_d, 400); }
        }
        else if (this.view === 'provider') {
            const snapData = this.getAnalyticsSnap();
            const providers = [...new Set(snapData.map(d => d.Provider).filter(Boolean))].sort();
            if (!this.selectedProvider && providers.length > 0) this.selectedProvider = providers[0];
            const pSnap = snapData.filter(d => d.Provider === this.selectedProvider);
            const courseMins = this.getCourseLearningMinutes();
            let pLrn=0, pCert=0, pResp=0, pRSum=0, pRCnt=0, pMin=0;
            pSnap.forEach(d => { pLrn += (Number(d.Learners)||0); pCert += (Number(d.Certificates)||0); pResp += (Number(d.Responses)||0); pMin += this.courseLearningMinutes(d, courseMins); let r=Number(d.Rating)||0; if(r>0){pRSum+=r;pRCnt++;} });
            const pAvg = pRCnt > 0 ? (pRSum/pRCnt).toFixed(2) : '0.00';
            const pCountries = this.aggregateCourseCountries(pSnap).countryCount;

            let provFeedbackBank = [];
            pSnap.forEach(c => { if(c.FeedbackBank) { try { let fb = JSON.parse(c.FeedbackBank); if(Array.isArray(fb)) fb.forEach(f => provFeedbackBank.push({ ...f, _course: c.Course })); } catch(e){} } });
            provFeedbackBank.sort((a,b) => (b.d||'').localeCompare(a.d||''));
            const provCourseNames = [...new Set(provFeedbackBank.map(f => f._course).filter(Boolean))].sort();
            // All of this provider's courses INCLUDING course-level-excluded ones,
            // so the table below can offer an include toggle for unpublished courses.
            const provAllCourses = (() => {
                const latest = {};
                this.data.forEach(d => { if (d.IsShell || !d.Course || d.Provider !== this.selectedProvider) return; const k = courseKey(d); if (!latest[k] || (d.Timestamp || '') > (latest[k].Timestamp || '')) latest[k] = d; });
                return Object.values(latest).sort((a, b) => (Number(b.Learners) || 0) - (Number(a.Learners) || 0));
            })();

            body.innerHTML = `
                <div class="p-6 md:p-10 fade-in w-full max-w-7xl mx-auto">
                    <header class="flex justify-between items-end gap-4 mb-8">
                        <div>
                            <h1 class="text-3xl font-black text-gsf-prussian mb-2">Provider Reports</h1>
                            <div class="flex items-center gap-2">
                                <span class="text-slate-500 text-sm">Provider:</span>
                                ${this._comboHtml('prov-combo', providers, this.selectedProvider, 'provider')}
                            </div>
                        </div>
                        <div id="prov-logo-slot" class="shrink-0" style="display:none"></div>
                    </header>

                    <div class="flex items-center justify-between gap-3 flex-wrap mb-6 bg-white border rounded-xl px-4 py-2.5 shadow-sm">
                        <div class="flex items-center gap-1.5" title="Reports keep all-time totals and add a section covering this period (new learners, certificates, responses)">
                            <span class="text-[10px] font-bold uppercase tracking-wide text-slate-400">Report period</span>
                            <input type="month" data-report-ok value="${this.reportPeriodFrom || ''}" onchange="App.setReportPeriod('from', this.value)" class="text-xs border rounded px-1.5 py-1 outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            <span class="text-slate-400 text-xs">&ndash;</span>
                            <input type="month" data-report-ok value="${this.reportPeriodTo || ''}" onchange="App.setReportPeriod('to', this.value)" class="text-xs border rounded px-1.5 py-1 outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                            ${(this.reportPeriodFrom || this.reportPeriodTo) ? '<button onclick="App.clearReportPeriod()" class="text-xs text-red-400 hover:text-red-600 font-bold ml-0.5" title="Clear period (reports go back to all-time only)">✕</button>' : ''}
                        </div>
                        <div data-edit-only data-report-ok class="flex items-center gap-1.5 flex-wrap justify-end">
                            <button onclick="App.exportProviderPackage(App.selectedProvider)" class="flex items-center gap-1.5 px-3.5 py-2 bg-amber-500 text-white font-bold rounded-lg text-xs shadow-sm hover:bg-amber-600 transition-colors" title="One folder with the PDF + web report + anonymized users + anonymized feedback (Excel)"><i data-lucide="package" width="14"></i> Report Package</button>
                            <button onclick="App.exportProviderHtmlReport(App.selectedProvider)" class="flex items-center gap-1.5 px-3 py-2 border rounded-lg text-xs font-bold text-slate-600 hover:text-gsf-boston hover:bg-slate-50 transition-colors" title="Interactive dark-themed report (single .html file)"><i data-lucide="globe" width="14"></i> Web</button>
                            <button onclick="App.generateProviderReport(App.selectedProvider)" class="flex items-center gap-1.5 px-3 py-2 border rounded-lg text-xs font-bold text-slate-600 hover:text-gsf-boston hover:bg-slate-50 transition-colors" title="Printable PDF report"><i data-lucide="download" width="14"></i> PDF</button>
                            <button onclick="App.exportAnonymizedUserData(App.selectedProvider)" class="flex items-center gap-1.5 px-3 py-2 border rounded-lg text-xs font-bold text-slate-600 hover:text-gsf-boston hover:bg-slate-50 transition-colors" title="Anonymized per-learner Excel"><i data-lucide="users" width="14"></i> User Data</button>
                        </div>
                    </div>
                    ${(this._feedbackSummaries && this._feedbackSummaries['@provider:' + this.selectedProvider] && this._feedbackSummaries['@provider:' + this.selectedProvider].s) ? '<div class="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6"><p class="text-[10px] font-bold uppercase tracking-wide text-amber-700 mb-1.5">What learners are saying</p><p class="text-sm text-slate-700 leading-relaxed">' + this.escapeHtml(this._feedbackSummaries['@provider:' + this.selectedProvider].s) + '</p><p class="text-[10px] text-amber-600 mt-2">AI summary of survey feedback · refresh via Feedback tab → Summarize</p></div>' : ''}
                    <div id="prov-kpi-grid" class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4 mb-10">
                        ${[
                            { label: 'Courses', value: pSnap.length, color: '#206095', icon: 'book-open' },
                            { label: 'Enrolled Learners', value: this.formatNumber(pLrn), raw: pLrn, color: '#4389C8', icon: 'user-plus', title: 'Course enrolments across this provider\'s courses' },
                            { label: 'Certificates', value: this.formatNumber(pCert), raw: pCert, color: '#7A9E9F', icon: 'award' },
                            { label: 'Cert. Rate', value: this.formatCertRate(pCert, pLrn), raw: (this.formatCertRate(pCert, pLrn, { asNumber: true }) || 0), color: '#B8860B', icon: 'badge-check', title: 'Certificates ÷ learners across this provider\'s courses' },
                            { label: 'Learning Time', value: this.formatLearningTime(pMin), raw: pMin, color: '#5B8C5A', icon: 'clock', title: pMin ? Math.round(pMin).toLocaleString() + ' learner-minutes total' : 'Run Sync Courses to populate' },
                            { label: 'Countries', value: pCountries || '-', raw: pCountries, color: '#206095', icon: 'globe', title: pCountries ? pCountries + ' countries reached' : 'Upload Growth Timelines to populate' },
                            { label: 'Avg Rating', value: pAvg, color: '#D03734', icon: 'star' },
                            { label: 'Survey Resp.', value: this.formatNumber(pResp), raw: pResp, color: '#E28743', icon: 'message-square' },
                        ].map(k => `<div class="group relative bg-white rounded-xl border shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow" ${k.title ? 'title="'+this.escapeHtml(k.title)+'"' : ''} onclick="App._copyKpiCard(this)">
                            <div class="h-1" style="background:${k.color}"></div>
                            <div class="p-4 pb-5">
                                <div class="flex items-center gap-1.5 mb-2"><i data-lucide="${k.icon}" width="13" style="color:${k.color}" class="shrink-0"></i><p class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">${k.label}</p></div>
                                <p class="text-[30px] font-bold leading-none tracking-tight" style="color:${k.color};font-family:var(--num)">${k.value}</p>
                            </div>
                            <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"><i data-lucide="copy" width="10" class="text-slate-300"></i></div>
                        </div>`).join('')}
                    </div>

                    ${this._providerAwardsCombined(this.selectedProvider, pSnap)}

                    ${this._surveyImpactBand(pSnap)}

                    <div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-8">
                        <div class="bg-slate-50 border-b p-5 flex items-center justify-between gap-3"><h2 class="font-bold text-lg text-gsf-prussian">Courses by ${this.escapeHtml(this.selectedProvider)}</h2><span class="text-xs text-slate-500">${pSnap.length} of ${provAllCourses.length} included &middot; untick to exclude unpublished courses</span></div>
                        <div class="overflow-x-auto max-h-[400px] overflow-y-auto custom-scrollbar">
                            <table class="w-full text-left border-collapse text-sm">
                                <thead class="sticky top-0 bg-white shadow-sm z-10"><tr class="border-b text-slate-500"><th class="py-3 px-4 font-medium">Course Title</th><th class="py-3 px-4 font-medium text-right">Learners</th><th class="py-3 px-4 font-medium text-right">Certificates</th><th class="py-3 px-4 font-medium text-right">Learning Time</th><th class="py-3 px-4 font-medium text-right">Rating</th><th class="py-3 px-4 font-medium text-right">Responses</th><th class="py-3 px-4 font-medium text-center">Include</th></tr></thead>
                                <tbody>${provAllCourses.map(d => { const inc = !d.Excluded; const courseEsc = this.escapeHtml(d.Course).replace(/'/g, "\\'"); return '<tr class="border-b hover:bg-slate-50 ' + (inc ? '' : 'opacity-40') + '"><td class="py-3 px-4 font-bold text-gsf-prussian cursor-pointer" onclick="App.selectedCourse=\'' + courseEsc + '\'; App.navigate(\'course\')">' + this.escapeHtml(d.Course) + this._courseStatusBadge(d.Access) + '</td><td class="py-3 px-4 text-right">' + this.formatNumber(d.Learners) + '</td><td class="py-3 px-4 text-right">' + this.formatNumber(d.Certificates) + '</td><td class="py-3 px-4 text-right text-slate-500">' + this.formatLearningTime(this.courseLearningMinutes(d, courseMins)) + '</td><td class="py-3 px-4 text-right text-gsf-crimson font-bold">' + (Number(d.Rating) > 0 ? Number(d.Rating).toFixed(2) : '-') + '</td><td class="py-3 px-4 text-right text-gsf-boston">' + this.formatNumber(d.Responses) + '</td><td class="py-3 px-4 text-center"><input type="checkbox" ' + (inc ? 'checked' : '') + ' onchange="App.toggleCourseIncludedByName(\'' + courseEsc + '\', this.checked, this)" title="' + (inc ? 'Included in analytics — untick to exclude' : 'Excluded — tick to include') + '"></td></tr>'; }).join('')}</tbody>
                            </table>
                        </div>
                    </div>

                    <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
                        <h3 class="text-lg font-bold mb-4 flex items-center gap-2 text-gsf-prussian"><i data-lucide="trending-up" class="text-gsf-boston"></i> Provider Growth ${this._chartWidthBtns('chart_growth')} ${this._resetChartBtn('chart_growth')} ${this._chartBtns('chart_growth', 'Provider_Growth')}</h3>
                        <div class="mb-3 flex flex-wrap gap-4">
                            <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" data-viewer-allowed checked onchange="if(window.Charts) window.Charts.redrawProviderGrowth(App.getAnalyticsHistory(), App.selectedProvider)" data-series="prov-enroll"> <span class="w-3 h-3 rounded-sm inline-block" style="background:#1a5276"></span> Learners</label>
                            <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" data-viewer-allowed checked onchange="if(window.Charts) window.Charts.redrawProviderGrowth(App.getAnalyticsHistory(), App.selectedProvider)" data-series="prov-cert"> <span class="w-3 h-3 rounded-sm inline-block" style="background:#4389C8"></span> Certificates</label>
                            <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" data-viewer-allowed id="toggle-prov-growth-bars" onchange="if(window.Charts) window.Charts.redrawProviderGrowth(App.getAnalyticsHistory(), App.selectedProvider)"> Show monthly bars</label>
                        </div>
                        <div style="${this._chartWidthStyle('chart_growth')}">
                            <div id="chart_growth" style="width: 100%; height: 500px;"></div>
                        </div>
                    </div>

                    <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
                        <h3 class="text-lg font-bold mb-4 flex items-center gap-2 text-gsf-prussian"><i data-lucide="message-square" class="text-gsf-boston"></i> Feedback Trends ${this._chartBtns('chart_feedback_growth', 'Feedback_Trends')}</h3>
                        <div class="mb-3 flex flex-wrap gap-4">
                            <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" data-viewer-allowed checked onchange="if(window.Charts) window.Charts.redrawProviderFeedback(App.getAnalyticsHistory(), App.selectedProvider, document.getElementById('toggle-prov-fb-bars').checked)" data-series="prov-rating"> <span class="w-3 h-3 rounded-sm inline-block" style="background:#D03734"></span> Avg Rating</label>
                            <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" data-viewer-allowed id="toggle-prov-fb-bars" onchange="if(window.Charts) window.Charts.redrawProviderFeedback(App.getAnalyticsHistory(), App.selectedProvider, this.checked)"> <span class="w-3 h-3 rounded-sm inline-block" style="background:#85c1e9"></span> Survey Volume</label>
                        </div>
                        <div id="chart_feedback_growth" style="width: 100%; height: 400px;"></div>
                    </div>

                    <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
                        <h3 class="text-lg font-bold mb-4 flex items-center gap-2 text-gsf-prussian"><i data-lucide="globe" class="text-gsf-boston"></i> Learner World Map</h3>
                        <div id="chart_provider_map" style="width: 100%; height: 400px;"></div>
                    </div>

                    ${this._countryTableHtml(pSnap)}


                    ${provFeedbackBank.length > 0 ? `
                        <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
                            <div class="flex items-center justify-between mb-4">
                                <h3 class="text-lg font-bold text-gsf-prussian">Learner Feedback</h3>
                                ${provCourseNames.length > 1 ? `<div class="flex items-center gap-2 text-xs">
                                    <span class="text-slate-500 font-medium">Course:</span>
                                    <select data-viewer-allowed onchange="App._provFeedbackCourse=this.value; App.renderView()" class="bg-white border rounded px-2 py-1 text-slate-700 outline-none text-xs">
                                        <option value="all" ${!this._provFeedbackCourse || this._provFeedbackCourse === 'all' ? 'selected' : ''}>All Courses</option>
                                        ${provCourseNames.map(c => '<option value="' + this.escapeHtml(c) + '" ' + (this._provFeedbackCourse === c ? 'selected' : '') + '>' + this.escapeHtml(c) + '</option>').join('')}
                                    </select>
                                </div>` : ''}
                            </div>
                            ${(() => {
                                const fbToShow = this._provFeedbackCourse && this._provFeedbackCourse !== 'all'
                                    ? provFeedbackBank.filter(f => f._course === this._provFeedbackCourse)
                                    : provFeedbackBank;
                                return this.renderFeedbackExplorer(fbToShow, this.selectedProvider);
                            })()}
                        </div>
                    ` : ''}
                </div>
            `;
            if(window.Charts) { const _d = () => window.Charts.drawProvider(this.getAnalyticsHistory(), this.selectedProvider); setTimeout(_d, 80); setTimeout(_d, 400); }
            this._hydrateTestimonialCheckboxes(this.selectedProvider);
            setTimeout(() => this._injectProviderLogo(this.selectedProvider, 'prov-logo-slot', this._providerSurghubUrl(this.selectedProvider)), 30);
        }
        else if (this.view === 'course') {
            const snapData = this.getAnalyticsSnap();
            const courses = [...new Set(snapData.map(d => d.Course).filter(Boolean))].sort();
            if (!this.selectedCourse && courses.length > 0) this.selectedCourse = courses[0];
            let cSnap = snapData.find(d => courseMatches(d, this.selectedCourse));
            if (!cSnap) {
                // EXCLUDED courses are filtered out of getAnalyticsSnap, so opening one
                // would otherwise show "Unknown" provider/blank metrics. Fall back to
                // the full data (latest non-shell record for this course).
                const _cand = (this.data || []).filter(d => d && !d.IsShell && courseMatches(d, this.selectedCourse));
                cSnap = _cand.sort((a, b) => String(b.Timestamp || '').localeCompare(String(a.Timestamp || '')))[0] || {};
            }

            let courseFeedbackBank = [];
            if(cSnap.FeedbackBank) { try { let fb = JSON.parse(cSnap.FeedbackBank); if(Array.isArray(fb)) courseFeedbackBank = fb.map(f => ({ ...f, _course: this.selectedCourse })); } catch(e){} }
            courseFeedbackBank.sort((a,b) => (b.d||'').localeCompare(a.d||''));

            body.innerHTML = `
                <div class="p-6 md:p-10 fade-in w-full max-w-7xl mx-auto">
                    <header class="flex justify-between items-start gap-4 mb-5">
                        <div>
                            <p class="gsf-eyebrow mb-2">SURGhub &middot; Course</p>
                            <h1 class="text-3xl font-black text-gsf-prussian mb-3">Course Details</h1>
                            <div class="flex items-center gap-2">
                                <span class="text-slate-500 text-sm">Course:</span>
                                ${this._comboHtml('crs-combo', courses, this.selectedCourse, 'course')}
                            </div>
                        </div>
                        <div id="crs-logo-slot" class="shrink-0" style="display:none"></div>
                    </header>

                    <div class="flex items-center justify-between gap-3 flex-wrap bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3 mb-6">
                        <p class="text-sm text-slate-500">Provider: ${(cSnap.Provider && cSnap.Provider !== 'Unknown' && cSnap.Provider !== 'Unknown Provider') ? '<button onclick="App.openProvider(\'' + this.escapeHtml(cSnap.Provider).replace(/'/g, '&#39;') + '\')" class="font-bold text-gsf-boston hover:underline cursor-pointer">' + this.escapeHtml(cSnap.Provider) + ' &rsaquo;</button>' : '<span class="font-bold text-gsf-boston">' + this.escapeHtml(cSnap.Provider || 'Unknown') + '</span>'}${this._courseStatusBadge(cSnap.Access)}</p>
                        <div class="flex items-center gap-2">
                            <label class="inline-flex items-center gap-2 text-sm font-medium ${this.isCourseIncluded(this.selectedCourse) ? 'text-slate-600' : 'text-amber-700'} cursor-pointer" title="Untick to exclude this course from all analytics, reports and totals (use for unpublished/test courses)">
                                <input type="checkbox" ${this.isCourseIncluded(this.selectedCourse) ? 'checked' : ''} onchange="App.toggleCourseIncludedByName('${this.escapeHtml(this.selectedCourse).replace(/'/g, "\\'")}', this.checked)">
                                ${this.isCourseIncluded(this.selectedCourse) ? 'Included in analytics' : 'Excluded from analytics'}
                            </label>
                        </div>
                    </div>
                    ${(this._feedbackSummaries && this._feedbackSummaries[this.selectedCourse] && this._feedbackSummaries[this.selectedCourse].s) ? '<div class="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6"><p class="text-[10px] font-bold uppercase tracking-wide text-amber-700 mb-1.5">What learners are saying</p><p class="text-sm text-slate-700 leading-relaxed">' + this.escapeHtml(this._feedbackSummaries[this.selectedCourse].s) + '</p></div>' : ''}
                    ${this._courseAwardsGrid(this.selectedCourse)}
                    <div id="crs-kpi-grid" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
                        ${[
                            { label: 'Enrolled Learners', value: this.formatNumber(cSnap.Learners), raw: cSnap.Learners, color: '#4389C8', icon: 'user-plus', title: 'Enrolments in this course' },
                            { label: 'Certificates', value: this.formatNumber(cSnap.Certificates), raw: cSnap.Certificates, color: '#7A9E9F', icon: 'award' },
                            { label: 'Cert. Rate', value: this.formatCertRate(cSnap.Certificates, cSnap.Learners), raw: (this.formatCertRate(cSnap.Certificates, cSnap.Learners, { asNumber: true }) || 0), color: '#B8860B', icon: 'badge-check', title: 'Certificates ÷ learners for this course' },
                            { label: 'Learning Time', value: this.formatLearningTime(this.courseLearningMinutes(cSnap)), color: '#E28743', icon: 'clock' },
                            { label: 'Countries', value: this.aggregateCourseCountries([cSnap]).countryCount || '-', color: '#206095', icon: 'globe', title: 'Distinct learner countries for this course' },
                            { label: 'Avg Rating', value: Number(cSnap.Rating) > 0 ? Number(cSnap.Rating).toFixed(2) : '-', color: '#D03734', icon: 'star' },
                            { label: 'Survey Resp.', value: this.formatNumber(cSnap.Responses), raw: cSnap.Responses, color: '#206095', icon: 'message-square' },
                        ].map(k => `<div class="group relative bg-white rounded-xl border shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow" ${k.title ? 'title="'+this.escapeHtml(k.title)+'"' : ''} onclick="App._copyKpiCard(this)">
                            <div class="h-1" style="background:${k.color}"></div>
                            <div class="p-4 pb-5">
                                <div class="flex items-center gap-1.5 mb-2"><i data-lucide="${k.icon}" width="13" style="color:${k.color}" class="shrink-0"></i><p class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">${k.label}</p></div>
                                <p class="text-[30px] font-bold leading-none tracking-tight" style="color:${k.color};font-family:var(--num)">${k.value}</p>
                            </div>
                            <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"><i data-lucide="copy" width="10" class="text-slate-300"></i></div>
                        </div>`).join('')}
                    </div>

                    <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
                        <h3 class="text-lg font-bold mb-4 flex items-center gap-2 text-gsf-prussian"><i data-lucide="trending-up" class="text-gsf-boston"></i> Course Growth ${this._chartWidthBtns('chart_growth')} ${this._resetChartBtn('chart_growth')} ${this._chartBtns('chart_growth', 'Course_Growth')}</h3>
                        <div class="mb-3 flex flex-wrap gap-4">
                            <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" data-viewer-allowed checked onchange="if(window.Charts) window.Charts.drawCourse(App.getAnalyticsHistory(), App.selectedCourse)" data-series="crs-enroll"> <span class="w-3 h-3 rounded-sm inline-block" style="background:#1a5276"></span> Learners</label>
                            <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" data-viewer-allowed checked onchange="if(window.Charts) window.Charts.drawCourse(App.getAnalyticsHistory(), App.selectedCourse)" data-series="crs-cert"> <span class="w-3 h-3 rounded-sm inline-block" style="background:#4389C8"></span> Certificates</label>
                            <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" data-viewer-allowed id="toggle-crs-growth-bars" onchange="if(window.Charts) window.Charts.drawCourse(App.getAnalyticsHistory(), App.selectedCourse)"> Show monthly bars</label>
                        </div>
                        <div style="${this._chartWidthStyle('chart_growth')}">
                            <div id="chart_growth" style="width: 100%; height: 500px;"></div>
                        </div>
                    </div>

                    <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
                        <h3 class="text-lg font-bold mb-4 flex items-center gap-2 text-gsf-prussian"><i data-lucide="globe" class="text-gsf-boston"></i> Learner World Map</h3>
                        <div id="chart_course_map" style="width: 100%; height: 400px;"></div>
                    </div>

                    ${this._countryTableHtml([cSnap])}

                    <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
                        <h3 class="text-lg font-bold mb-4 flex items-center gap-2 text-gsf-prussian"><i data-lucide="message-square" class="text-gsf-boston"></i> Feedback Trends ${this._chartBtns('chart_feedback_growth', 'Course_Feedback')}</h3>
                        <div class="mb-3 flex flex-wrap gap-4">
                            <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" data-viewer-allowed checked data-series="crs-rating"> <span class="w-3 h-3 rounded-sm inline-block" style="background:#D03734"></span> Avg Rating</label>
                            <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" data-viewer-allowed id="toggle-crs-fb-bars" onchange="if(window.Charts) window.Charts.drawCourse(App.getAnalyticsHistory(), App.selectedCourse)"> <span class="w-3 h-3 rounded-sm inline-block" style="background:#85c1e9"></span> Survey Volume</label>
                        </div>
                        <div id="chart_feedback_growth" style="width: 100%; height: 400px;"></div>
                    </div>

                    ${courseFeedbackBank.length > 0 ? `
                        <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
                            <h3 class="text-lg font-bold mb-4 text-gsf-prussian">Learner Feedback</h3>
                            ${this.renderFeedbackExplorer(courseFeedbackBank, (cSnap.Provider || ''))}
                        </div>
                    ` : ''}
                </div>
            `;
            if(window.Charts) { const _d = () => window.Charts.drawCourse(this.getAnalyticsHistory(), this.selectedCourse); setTimeout(_d, 80); setTimeout(_d, 400); }
            setTimeout(() => this._injectProviderLogo((cSnap.Provider || ''), 'crs-logo-slot', this._courseSurghubUrl(cSnap.CourseId)), 30);
            this._hydrateTestimonialCheckboxes(cSnap.Provider || '');
        }

        else if (this.view === 'methodology') {
            // Get live stats if available
            const histEntries = this.userHistory || [];
            const latestHist = histEntries.length > 0 ? histEntries[histEntries.length - 1] : {};
            const totalUsers = latestHist.TotalUsers || 0;
            const surveyCount = latestHist.SurveyedCount || 0;
            const surveyPct = latestHist.SurveyedPct || 0;
            const countryCount = latestHist.CountryKnownCount || surveyCount;
            const countryPct = latestHist.CountryKnownPct || surveyPct;
            const trackingOnly = latestHist.TrackingOnlyCount || 0;
            const profCount = latestHist.ProfKnownCount || surveyCount;
            const profPct = latestHist.ProfKnownPct || surveyPct;
            const snapData = this.getAnalyticsSnap();
            const totalCourses = snapData.length;
            const providers = [...new Set(snapData.map(d => d.Provider).filter(Boolean))];

            body.innerHTML = `
                <div class="p-6 md:p-10 fade-in w-full max-w-4xl mx-auto">
                    <header class="mb-8">
                        <h1 class="text-3xl font-black text-gsf-prussian mb-2">Data & Methodology</h1>
                        <p class="text-slate-500 text-sm">How this dashboard collects, processes, and presents data.</p>
                    </header>

                    <div class="space-y-6">

                    <div class="bg-white rounded-xl border shadow-sm p-6">
                        <h2 class="text-lg font-bold text-gsf-prussian mb-3 flex items-center gap-2"><i data-lucide="database" width="20" class="text-gsf-boston"></i> Data Sources</h2>
                        <p class="text-sm text-slate-600 mb-3">The dashboard combines data from five separate uploads, each from the LearnWorlds platform:</p>
                        <table class="w-full text-sm border-collapse">
                            <thead><tr class="border-b-2 border-gsf-prussian text-left"><th class="py-2 font-bold text-gsf-prussian">Step</th><th class="py-2 font-bold text-gsf-prussian">Source File</th><th class="py-2 font-bold text-gsf-prussian">Data Provided</th></tr></thead>
                            <tbody class="text-slate-600">
                                <tr class="border-b"><td class="py-2 font-bold">1. Course Export</td><td class="py-2">CSV from LearnWorlds course analytics</td><td class="py-2">Course titles, learner counts, certificate counts, survey responses, ratings</td></tr>
                                <tr class="border-b"><td class="py-2 font-bold">2. Survey Fetch</td><td class="py-2">Excel with course links + API responses</td><td class="py-2">Individual survey responses, ratings, feedback text, sentiment</td></tr>
                                <tr class="border-b"><td class="py-2 font-bold">3. Timeline Sync</td><td class="py-2">Excel learner timeline per course</td><td class="py-2">Daily learner and certificate dates for growth charts</td></tr>
                                <tr class="border-b"><td class="py-2 font-bold">4. Users / Audience</td><td class="py-2">CSV user export from LearnWorlds</td><td class="py-2">User demographics: country, profession, gender, organisation</td></tr>
                                <tr><td class="py-2 font-bold">5. Ambassadors</td><td class="py-2">Excel leads export</td><td class="py-2">Ambassador/promoter referral data for attribution</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <div class="bg-white rounded-xl border shadow-sm p-6">
                        <h2 class="text-lg font-bold text-gsf-prussian mb-3 flex items-center gap-2"><i data-lucide="shield" width="20" class="text-gsf-boston"></i> Data Ownership (Source of Truth)</h2>
                        <p class="text-sm text-slate-600 mb-3">Each upload step owns specific fields. No step overwrites another step's data:</p>
                        <ul class="text-sm text-slate-600 space-y-1 list-disc list-inside">
                            <li><strong>Step 1</strong> owns: Learners (learners), Certificates, Provider mapping</li>
                            <li><strong>Step 2</strong> owns: Rating, Responses, FeedbackBank (sentiment-tagged text)</li>
                            <li><strong>Step 3</strong> owns: CourseTimeline (daily learner/certificate dates + scale factors)</li>
                            <li><strong>Step 4</strong> owns: User demographics (country, profession, gender, organisation)</li>
                            <li><strong>Step 5</strong> owns: Ambassador referral data</li>
                        </ul>
                    </div>

                    <div class="bg-white rounded-xl border shadow-sm p-6">
                        <h2 class="text-lg font-bold text-gsf-prussian mb-3 flex items-center gap-2"><i data-lucide="globe" width="20" class="text-gsf-boston"></i> Country Data</h2>
                        <p class="text-sm text-slate-600 mb-3">Country information comes from two distinct sources with different coverage:</p>
                        <table class="w-full text-sm border-collapse mb-3">
                            <thead><tr class="border-b-2 border-gsf-prussian text-left"><th class="py-2 font-bold text-gsf-prussian">Source</th><th class="py-2 font-bold text-gsf-prussian">How Collected</th><th class="py-2 font-bold text-gsf-prussian">Coverage</th></tr></thead>
                            <tbody class="text-slate-600">
                                <tr class="border-b"><td class="py-2 font-bold">Profile Survey</td><td class="py-2">"What is your country of nationality?" — voluntary</td><td class="py-2">${surveyPct}% (${this.formatNumber(surveyCount)} users)</td></tr>
                                <tr class="border-b"><td class="py-2 font-bold">Browser Tracking</td><td class="py-2">Automatic IP/browser geolocation by LearnWorlds (fc_country, lc_country)</td><td class="py-2">${this.formatNumber(trackingOnly)} additional users</td></tr>
                                <tr><td class="py-2 font-bold">Combined</td><td class="py-2">Survey country preferred, tracking as fallback</td><td class="py-2 font-bold">${countryPct}% (${this.formatNumber(countryCount)} users)</td></tr>
                            </tbody>
                        </table>
                        <p class="text-sm text-slate-500 italic">Note: Browser tracking may reflect VPN location rather than true nationality. ISO country codes (e.g., "IN", "NG") from tracking data are automatically mapped to full country names.</p>
                    </div>

                    <div class="bg-white rounded-xl border shadow-sm p-6">
                        <h2 class="text-lg font-bold text-gsf-prussian mb-3 flex items-center gap-2"><i data-lucide="users" width="20" class="text-gsf-boston"></i> Demographic Data (Profession, Gender, Organisation)</h2>
                        <p class="text-sm text-slate-600 mb-3">Profession, gender, and organisation data comes <strong>exclusively from the profile survey</strong>. There is no tracking fallback for these fields. The survey was voluntary until late 2024, when it became mandatory for new registrations. Historical data therefore has lower coverage.</p>
                        <ul class="text-sm text-slate-600 space-y-1 list-disc list-inside">
                            <li>Survey respondents: <strong>${this.formatNumber(surveyCount)}</strong> (${surveyPct}% of ${this.formatNumber(totalUsers)} total users)</li>
                            <li>Users with profession data: <strong>${this.formatNumber(profCount)}</strong> (${profPct}%)</li>
                            <li>Survey fields are all-or-nothing: users who fill the survey typically answer all questions</li>
                        </ul>
                        <p class="text-sm text-slate-500 italic mt-2">This is why a user may have country data (from browser tracking) but no gender or profession — they simply didn't fill the survey.</p>
                    </div>

                    <div class="bg-white rounded-xl border shadow-sm p-6">
                        <h2 class="text-lg font-bold text-gsf-prussian mb-3 flex items-center gap-2"><i data-lucide="trending-up" width="20" class="text-gsf-boston"></i> Extrapolation</h2>
                        <p class="text-sm text-slate-600 mb-3">Since demographic data is only available for a subset of users, all country and profession figures shown in charts and KPI cards are <strong>extrapolated</strong> to the full user base.</p>
                        <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 mb-3">
                            <strong>Assumption:</strong> The users who completed the profile survey are representative of the entire user base. If survey respondents differ systematically (e.g., more engaged, from specific regions), the extrapolated figures may not perfectly reflect the true distribution.
                        </div>
                        <p class="text-sm text-slate-600"><strong>Method:</strong> For each category (e.g., "India: 3,000 out of 25,000 surveyed"), the count is scaled by <code>total_users / surveyed_users</code>. Country data uses the combined survey+tracking sample; profession data uses survey-only.</p>
                    </div>

                    <div class="bg-white rounded-xl border shadow-sm p-6">
                        <h2 class="text-lg font-bold text-gsf-prussian mb-3 flex items-center gap-2"><i data-lucide="shield" width="20" class="text-gsf-boston"></i> Conflict Settings</h2>
                        <p class="text-sm text-slate-600 mb-3">The <strong>"Conflict Settings"</strong> KPI on the Platform Overview shows the estimated number of learners from countries currently experiencing armed conflict or crisis. This metric supports GSF's mission to track reach in fragile and conflict-affected settings.</p>
                        <p class="text-sm text-slate-600 mb-3"><strong>Included countries:</strong> ${this.CONFLICT_COUNTRIES.join(', ')}</p>
                        <ul class="text-sm text-slate-600 space-y-1 list-disc list-inside mb-3">
                            <li>The count sums extrapolated learner figures for each listed country from the combined country dataset (survey + browser tracking)</li>
                            <li>Since country data is extrapolated (see above), the conflict-settings figure is an <strong>estimate</strong>, not an exact count</li>
                            <li>A user is counted based on their country of nationality (from the profile survey) or, if unavailable, their browser-detected location — this may not reflect where the user is physically located</li>
                        </ul>
                        <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                            <strong>Note:</strong> The list of conflict-affected countries is maintained manually and may need periodic review as geopolitical situations evolve.
                        </div>
                    </div>

                    <div class="bg-white rounded-xl border shadow-sm p-6">
                        <h2 class="text-lg font-bold text-gsf-prussian mb-3 flex items-center gap-2"><i data-lucide="bar-chart-2" width="20" class="text-gsf-boston"></i> Timeline Charts & Scale Factors</h2>
                        <p class="text-sm text-slate-600 mb-3">Timeline charts (learner/certificate growth) are built from Step 3 learner data, which records individual user registration and certificate dates.</p>
                        <ul class="text-sm text-slate-600 space-y-1 list-disc list-inside">
                            <li>The Course Export (Step 1) may show higher learner than the timeline file because it includes users who later unenrolled</li>
                            <li><strong>Scale factors</strong> are applied so chart cumulative endpoints match Course Export totals: <code>scale = CourseExport.Learners / Timeline.total</code></li>
                            <li>Scaled values are rounded to whole numbers — no fractional learners or certificates</li>
                            <li>Courses without timeline data show KPI cards but no growth chart</li>
                        </ul>
                    </div>

                    <div class="bg-white rounded-xl border shadow-sm p-6">
                        <h2 class="text-lg font-bold text-gsf-prussian mb-3 flex items-center gap-2"><i data-lucide="tag" width="20" class="text-gsf-boston"></i> Profession Grouping</h2>
                        <p class="text-sm text-slate-600 mb-3">The "profession" field is free-text from the survey question <em>"Which of the following best describes your activity?"</em>. To make this data useful, responses are grouped into canonical categories:</p>
                        <div class="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm text-slate-600 mb-3">
                            <div>• Surgeon</div><div>• Anaesthetist</div><div>• Nurse</div>
                            <div>• Medical Student</div><div>• Resident / Trainee</div><div>• General Practitioner</div>
                            <div>• Emergency Medicine</div><div>• Researcher</div><div>• Midwife</div>
                            <div>• Paramedic / Prehospital</div><div>• Clinical Officer</div><div>• Physiotherapist</div>
                            <div>• Pharmacist</div><div>• Educator / Faculty</div><div>• Administrator</div>
                        </div>
                        <p class="text-sm text-slate-500 italic">All responses that don't match a known category are grouped as <strong>"Other"</strong>. Matching is case-insensitive and searches for keywords within the response text.</p>
                    </div>

                    <div class="bg-white rounded-xl border shadow-sm p-6">
                        <h2 class="text-lg font-bold text-gsf-prussian mb-3 flex items-center gap-2"><i data-lucide="link" width="20" class="text-gsf-boston"></i> User-to-Course Matching</h2>
                        <p class="text-sm text-slate-600 mb-3">The User Export lists enrolled courses as URL slugs (e.g., <code>essential-emergency-and-critical-care</code>), not full titles. The app resolves these to course titles using multi-tier fuzzy matching:</p>
                        <ol class="text-sm text-slate-600 space-y-1 list-decimal list-inside">
                            <li>Manual overrides for known abbreviations (e.g., <code>ppe</code> → "Personal Protective Equipment")</li>
                            <li>Stemmed + spelling-normalized substring matching (handles British/American spelling, plurals)</li>
                            <li>Plain substring matching</li>
                            <li>Word-overlap scoring (≥50% shared words)</li>
                        </ol>
                        <p class="text-sm text-slate-500 italic mt-2">Accent marks are stripped for matching. A small number of courses (~2% of user records) cannot be matched due to completely different slugs and are excluded from per-user exports.</p>
                    </div>

                    <div class="bg-white rounded-xl border shadow-sm p-6">
                        <h2 class="text-lg font-bold text-gsf-prussian mb-3 flex items-center gap-2"><i data-lucide="message-square" width="20" class="text-gsf-boston"></i> Feedback Intelligence</h2>
                        <p class="text-sm text-slate-600 mb-3">Learner feedback is collected via post-course surveys (Step 2). The dashboard applies automated analysis to help surface actionable insights:</p>
                        <ul class="text-sm text-slate-600 space-y-2 list-disc list-inside mb-3">
                            <li><strong>Priority scoring:</strong> Each feedback entry receives a composite score based on length (30+ words = detailed), negative keywords (e.g., "confusing", "frustrating"), suggestion language ("should", "please add"), question detection, and rating value. Entries scoring ≥5 are flagged as High Priority.</li>
                            <li><strong>Testimonial detection:</strong> Positive feedback with 20+ words, multiple positive keywords, and no negative language is flagged as a potential testimonial — useful for reports and marketing.</li>
                            <li><strong>Topic tagging:</strong> Feedback is auto-tagged into categories (Content Quality, Assessment, Platform/UX, Certification, Teaching, Practical Skills, Duration/Pacing, Language) based on keyword matching.</li>
                            <li><strong>Theme detection:</strong> Recurring 2-word phrases across all feedback are identified to surface common themes.</li>
                            <li><strong>Platform-level filtering:</strong> On the Platform Overview, feedback referencing SURGhub or the platform experience is extracted using strong/weak keyword matching, with priority given to open-ended "additional comments" survey fields.</li>
                        </ul>
                        <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                            <strong>Limitations:</strong> Keyword-based scoring is approximate — it may miss nuanced feedback or misclassify entries that use signal words in unexpected contexts. Sentiment is derived from the numeric rating (≥4 = Positive, <3 = Critical), not from natural language analysis of the text itself. The system is designed to surface likely-important feedback for human review, not to replace it.
                        </div>
                    </div>

                    <div class="bg-white rounded-xl border shadow-sm p-6">
                        <h2 class="text-lg font-bold text-gsf-prussian mb-3 flex items-center gap-2"><i data-lucide="trophy" width="20" class="text-gsf-boston"></i> Awards &amp; Recognition</h2>
                        <p class="text-sm text-slate-600 mb-3">Provider and course pages — and the web/PDF reports — surface <strong>awards</strong>: top-three superlatives measured against <strong>all active courses on SURGhub</strong> (including private ones). They are a point-in-time standing, refreshed each quarter (currently <strong>${this._currentQuarterLabel()}</strong>).</p>
                        <div class="grid grid-cols-2 md:grid-cols-3 gap-1.5 text-sm text-slate-700 mb-3">
                            <div>📚 Most Courses</div><div>🏆 Most Learners</div><div>🎓 Most Certificates</div>
                            <div>✅ Highest Completion Rate</div><div>⏱️ Most Learning Time</div><div>⭐ Highest Rated</div>
                            <div>📈 Most Certificates This Quarter</div><div>🌐 Widest Reach</div><div>🤝 Mission Reach</div>
                            <div>💡 Highest Intent to Apply</div><div>🌍 Geographic Leadership</div>
                        </div>
                        <p class="text-sm text-slate-600"><strong>Eligibility:</strong> Most Courses / Learners / Certificates / Learning Time / Mission Reach — all providers and courses; Highest Completion Rate (certificates ÷ learners) and Widest Reach — courses with ≥ 50 learners, providers with ≥ 100; Highest Rated and Highest Intent to Apply — courses with ≥ 50 survey responses, providers with ≥ 150; Most Certificates This Quarter — certificates in the last 90 days, minimum 5; Geographic Leadership — countries with ≥ 25 learners platform-wide. <em>Mission Reach</em> counts learners in low- and lower-middle-income countries.</p>
                    </div>

                    <div class="bg-white rounded-xl border shadow-sm p-6">
                        <h2 class="text-lg font-bold text-gsf-prussian mb-3 flex items-center gap-2"><i data-lucide="alert-triangle" width="20" class="text-gsf-boston"></i> Known Limitations</h2>
                        <ul class="text-sm text-slate-600 space-y-2 list-disc list-inside">
                            <li><strong>Survey bias:</strong> Only ~${surveyPct}% of users complete the profile survey. If survey respondents are systematically different from non-respondents, extrapolated demographic data may be skewed.</li>
                            <li><strong>Browser tracking accuracy:</strong> The fc_country/lc_country fields reflect IP geolocation, which can be affected by VPNs, proxies, or shared devices.</li>
                            <li><strong>Learner vs. active users:</strong> Learner counts include all registered users, including those who never started or dropped out.</li>
                            <li><strong>Course slug matching:</strong> ~2% of user-course records cannot be matched to course titles due to URL slug changes or completely different naming. These are excluded from user-level exports.</li>
                            <li><strong>Timeline gaps:</strong> Some courses may not have learner timeline files. These courses show KPI totals but no growth charts.</li>
                            <li><strong>Rating data:</strong> Survey ratings are only available for courses with active survey links. The "Avg Rating" reflects surveyed users only, not all enrollees.</li>
                            <li><strong>"Exclude &lt; 50" filter:</strong> When enabled, courses with fewer than 50 learners are hidden from all analytics views. This affects totals and provider aggregations.</li>
                        </ul>
                    </div>

                    <div class="bg-slate-50 rounded-xl border p-4 text-center text-xs text-slate-400">
                        SURGhub Dash &copy; &mdash; Data & Methodology &mdash; Last updated: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </div>

                    </div>
                </div>
            `;
        }

        _stripFade();
        if (window.lucide) lucide.createIcons();
        // In viewer mode, set `disabled` on every form control so checkboxes,
        // radios, selects, file inputs etc. are truly inert — CSS pointer-events
        // alone misses checkbox labels (which forward clicks to the input).
        // Opt out per-element with `data-viewer-allowed`.
        if (!this.editUnlocked) {
            document.querySelectorAll('input, textarea, select').forEach(el => {
                if (el.hasAttribute('data-viewer-allowed')) return;
                // Provider-reporting mode: report controls stay live.
                if (this.reportAccess && el.hasAttribute('data-report-ok')) return;
                if (el.type === 'hidden') return;
                el.disabled = true;
            });
        }
    },

    // --- Course editing / adding / excluding ---
    editCourseByIndex(idx) {
        try {
            const shells = this.getShells();
            if (idx < 0 || idx >= shells.length) { alert('Course not found at index ' + idx); return; }
            const shell = shells[idx];
            this._showCourseModal('Edit Course', shell.Course, shell.Provider || '', shell.URL || '', (name, provider, url) => {
                const courseName = shell.Course;
                let changed = false;
                for (let i = 0; i < this.data.length; i++) {
                    if (this.data[i].Course === courseName) {
                        if (name && name.trim()) this.data[i].Course = name.trim();
                        if (provider.trim()) this.data[i].Provider = provider.trim();
                        this.data[i].URL = url.trim();
                        changed = true;
                    }
                }
                if (changed) this.handleDbSave().then(() => this.renderView());
            });
        } catch(e) { console.error('Edit course error:', e); }
    },

    toggleExcludeCourse(idx) {
        try {
            const shells = this.getShells();
            if (idx < 0 || idx >= shells.length) return;
            const courseName = shells[idx].Course;
            const newExcluded = !this.data.find(d => d.Course === courseName)?.Excluded;
            for (let i = 0; i < this.data.length; i++) {
                if (this.data[i].Course === courseName) {
                    this.data[i].Excluded = newExcluded;
                }
            }
            // Update row styling in-place instead of full re-render (avoids scroll jump)
            const checkbox = document.querySelector(`input[onchange="App.toggleExcludeCourse(${idx})"]`);
            if (checkbox) {
                const row = checkbox.closest('tr');
                if (row) {
                    row.classList.toggle('opacity-40', newExcluded);
                    checkbox.checked = !newExcluded;
                    checkbox.title = newExcluded ? 'Click to include in analytics' : 'Click to exclude from analytics';
                }
            }
            this.handleDbSave();
        } catch(e) { console.error('Toggle exclude error:', e); }
    },

    addNewCourse() {
        this._showCourseModal('Add New Course', '', '', '', (name, provider, url) => {
            if (!name || !name.trim()) return;
            this.data.push({
                Course: name.trim(),
                Provider: (provider.trim() || 'Unknown Provider'),
                URL: url.trim(),
                Learners: 0,
                Certificates: 0,
                Rating: 0,
                Responses: 0,
                Timestamp: this.updateDate,
                IsShell: false,
                Excluded: false
            });
            this.handleDbSave().then(() => this.renderView());
        });
    },

    // A provider exists via its courses, so adding one creates the provider with
    // its first course. Reuses the course modal, pre-set to "create new provider".
    addNewProvider() {
        this._showCourseModal('Add Provider', '', '', '', (name, provider, url) => {
            const prov = (provider || '').trim();
            if (!prov) { this.showMsg && this.showMsg('Enter a provider name', true); return; }
            this.data.push({
                Course: (name.trim() || prov + ' — first course'),
                Provider: prov,
                URL: url.trim(),
                Learners: 0, Certificates: 0, Rating: 0, Responses: 0,
                Timestamp: this.updateDate, IsShell: false, Excluded: false
            });
            this.handleDbSave().then(() => this.renderView());
        });
        // Open straight into the "create new provider" path and focus its input.
        setTimeout(() => {
            const sel = document.getElementById('modal-course-provider-select');
            const inp = document.getElementById('modal-course-provider-new');
            if (sel) sel.value = '__new__';
            if (inp) { inp.style.display = 'block'; inp.focus(); }
        }, 60);
    },

    _showCourseModal(title, courseName, providerName, urlVal, onSave) {
        let overlay = document.getElementById('course-modal-overlay');
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.id = 'course-modal-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,47,76,0.6);display:flex;align-items:center;justify-content:center;z-index:9999';
        overlay.innerHTML = `
            <div style="background:#fff;border-radius:16px;padding:32px;width:480px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.3)">
                <h2 style="font-size:18px;font-weight:800;color:#1a5276;margin:0 0 20px">${this.escapeHtml(title)}</h2>
                <div style="margin-bottom:14px">
                    <label style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:4px">Course Name *</label>
                    <input id="modal-course-name" type="text" value="${this.escapeHtml(courseName)}" style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;outline:none" />
                </div>
                <div style="margin-bottom:14px">
                    <label style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:4px">Provider</label>
                    ${(() => {
                        const provList = [...new Set((this.data || []).filter(d => !d.IsShell && d.Provider).map(d => d.Provider))].sort((a, b) => a.localeCompare(b));
                        if (providerName && !provList.includes(providerName)) provList.unshift(providerName);
                        const opts = provList.map(p => '<option value="' + this.escapeHtml(p) + '"' + (p === providerName ? ' selected' : '') + '>' + this.escapeHtml(p) + '</option>').join('');
                        return '<select id="modal-course-provider-select" onchange="document.getElementById(\'modal-course-provider-new\').style.display = this.value === \'__new__\' ? \'block\' : \'none\'" style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;outline:none;background:#fff">' + (providerName ? '' : '<option value="">— Select provider —</option>') + opts + '<option value="__new__">➕ Create new provider…</option></select>';
                    })()}
                    <input id="modal-course-provider-new" type="text" placeholder="New provider name" value="" style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;outline:none;display:none;margin-top:8px" />
                </div>
                <div style="margin-bottom:20px">
                    <label style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:4px">Survey Link URL</label>
                    <input id="modal-course-url" type="text" value="${this.escapeHtml(urlVal)}" style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;outline:none" />
                </div>
                <div style="display:flex;gap:10px;justify-content:flex-end">
                    <button id="modal-cancel-btn" style="padding:8px 20px;border-radius:8px;font-size:13px;font-weight:700;background:#f1f5f9;color:#64748b;border:none;cursor:pointer">Cancel</button>
                    <button id="modal-save-btn" style="padding:8px 20px;border-radius:8px;font-size:13px;font-weight:700;background:#1a5276;color:#fff;border:none;cursor:pointer">Save</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#modal-cancel-btn').onclick = () => overlay.remove();
        overlay.querySelector('#modal-save-btn').onclick = () => {
            const n = overlay.querySelector('#modal-course-name').value;
            const provSel = overlay.querySelector('#modal-course-provider-select');
            const p = (provSel && provSel.value === '__new__') ? overlay.querySelector('#modal-course-provider-new').value : (provSel ? provSel.value : '');
            const u = overlay.querySelector('#modal-course-url').value;
            overlay.remove();
            onSave(n, p, u);
        };
        overlay.querySelector('#modal-course-name').focus();
    },

    // ===== ONBOARDING TOOLTIPS =====

    _onboardingSteps: [
        { target: '#project-nav', text: 'Your projects appear here. Click to switch between them, or create a new one.', position: 'right' },
        { target: '#view-tabs', text: 'Use these tabs to switch between Dashboard, Events, KPIs, Map, Settings, and more.', position: 'bottom' },
        { target: '#view-body', text: 'This is the main content area where your data, charts, and forms are displayed.', position: 'top' },
        { target: '#status-indicator', text: 'System status is shown here. Connect Google Sheets in project Settings to sync your data to the cloud.', position: 'right' }
    ],

    _onboardingCurrentStep: 0,

    async startOnboarding(force = false) {
        if (!force) {
            const done = await Storage.getItem('surgdash_onboarding');
            if (done) return;
        }
        this._onboardingCurrentStep = 0;
        this._showOnboardingStep();
    },

    _showOnboardingStep() {
        // Remove any existing tooltip
        document.getElementById('onboarding-overlay')?.remove();

        const steps = this._onboardingSteps;
        const idx = this._onboardingCurrentStep;
        if (idx >= steps.length) {
            // Done — persist
            Storage.setItem('surgdash_onboarding', { completed: new Date().toISOString() });
            return;
        }

        const step = steps[idx];
        const el = document.querySelector(step.target);
        if (!el) { this._onboardingCurrentStep++; this._showOnboardingStep(); return; }

        const rect = el.getBoundingClientRect();

        // Overlay
        const overlay = document.createElement('div');
        overlay.id = 'onboarding-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;pointer-events:none;';

        // Highlight cutout (semi-transparent backdrop with hole)
        const backdrop = document.createElement('div');
        backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,15,30,0.55);pointer-events:auto;';
        backdrop.onclick = () => { overlay.remove(); Storage.setItem('surgdash_onboarding', { skipped: new Date().toISOString() }); };
        overlay.appendChild(backdrop);

        // Highlight ring
        const ring = document.createElement('div');
        ring.style.cssText = `position:fixed;left:${rect.left - 4}px;top:${rect.top - 4}px;width:${rect.width + 8}px;height:${rect.height + 8}px;border:2px solid #4389C8;border-radius:12px;box-shadow:0 0 0 9999px rgba(0,15,30,0.55);pointer-events:none;z-index:10001;background:transparent;`;
        overlay.appendChild(ring);

        // Tooltip
        const tip = document.createElement('div');
        tip.style.cssText = 'position:fixed;z-index:10002;background:#fff;border-radius:12px;padding:16px 20px;box-shadow:0 8px 30px rgba(0,0,0,0.2);max-width:320px;width:320px;pointer-events:auto;font-family:Inter,sans-serif;';

        // Position tooltip — compute then clamp to viewport
        const vw = window.innerWidth, vh = window.innerHeight;
        const tipW = 320, tipH = 140; // approximate
        let tipLeft, tipTop;
        if (step.position === 'right') {
            tipLeft = rect.right + 16;
            tipTop = rect.top + rect.height / 2 - tipH / 2;
            // If overflows right, flip to left
            if (tipLeft + tipW > vw - 16) tipLeft = rect.left - tipW - 16;
        } else if (step.position === 'bottom') {
            tipLeft = rect.left + rect.width / 2 - tipW / 2;
            tipTop = rect.bottom + 12;
            // If overflows bottom, flip to top
            if (tipTop + tipH > vh - 16) tipTop = rect.top - tipH - 12;
        } else {
            tipLeft = rect.left + rect.width / 2 - tipW / 2;
            tipTop = rect.top - tipH - 12;
            if (tipTop < 16) tipTop = rect.bottom + 12;
        }
        // Clamp to viewport edges
        tipLeft = Math.max(16, Math.min(tipLeft, vw - tipW - 16));
        tipTop = Math.max(16, Math.min(tipTop, vh - tipH - 16));
        tip.style.left = tipLeft + 'px';
        tip.style.top = tipTop + 'px';

        tip.innerHTML = `
            <p style="font-size:13px;color:#1e293b;line-height:1.5;margin:0 0 12px">${step.text}</p>
            <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:11px;color:#94a3b8;font-weight:600">${idx + 1} of ${steps.length}</span>
                <div style="display:flex;gap:6px">
                    <button id="onboard-skip" style="padding:5px 12px;font-size:12px;font-weight:600;border:1px solid #e2e8f0;border-radius:6px;background:#fff;color:#64748b;cursor:pointer">Skip</button>
                    <button id="onboard-next" style="padding:5px 12px;font-size:12px;font-weight:700;border:none;border-radius:6px;background:#4389C8;color:#fff;cursor:pointer">${idx === steps.length - 1 ? 'Done' : 'Next'}</button>
                </div>
            </div>`;
        overlay.appendChild(tip);
        document.body.appendChild(overlay);

        tip.querySelector('#onboard-skip').onclick = () => {
            overlay.remove();
            Storage.setItem('surgdash_onboarding', { skipped: new Date().toISOString() });
        };
        tip.querySelector('#onboard-next').onclick = () => {
            this._onboardingCurrentStep++;
            this._showOnboardingStep();
        };
    }
});

Object.assign(window.App, {
    _dashTab: 'overview',

    // Typeahead pickers (provider / course pages): native datalist filters
    // while typing; on change we resolve exact match first, then contains.
    _pickProviderInput(v) {
        const t = String(v || '').trim().toLowerCase(); if (!t) return;
        const providers = [...new Set(this.getAnalyticsSnap().map(d => d.Provider).filter(Boolean))];
        const hit = providers.find(p => p.toLowerCase() === t) || providers.find(p => p.toLowerCase().includes(t));
        if (hit) { this.selectedProvider = hit; this.renderView(); }
    },
    _pickCourseInput(v) {
        const t = String(v || '').trim().toLowerCase(); if (!t) return;
        const courses = [...new Set(this.getAnalyticsSnap().map(d => d.Course).filter(Boolean))];
        const hit = courses.find(c => c.toLowerCase() === t) || courses.find(c => c.toLowerCase().includes(t));
        if (hit) { this.selectedCourse = hit; this.renderView(); }
    },

    // ── Custom combobox picker (provider / course) — replaces native datalist:
    //    shows ALL options on focus or arrow click, filters as you type, and is
    //    reliably scrollable. Options are stashed on App keyed by id. ──
    _comboData: {},
    _comboHtml(id, options, current, kind) {
        this._comboData[id] = { options: options.slice(), kind };
        const esc = (x) => this.escapeHtml(x);
        return '<div style="position:relative;display:inline-block">'
            + '<div class="flex items-center">'
            + '<input id="' + id + '-input" data-viewer-allowed type="text" value="' + esc(current || '') + '" autocomplete="off" placeholder="Type to filter…"'
            + ' oninput="App._comboFilter(\'' + id + '\')" onfocus="App._comboFocus(\'' + id + '\')" onblur="App._comboBlur(\'' + id + '\')" onkeydown="App._comboKey(\'' + id + '\',event)"'
            + ' class="bg-white border border-r-0 rounded-l-md py-1.5 px-2 text-gsf-boston text-sm font-bold outline-none focus:ring-2 focus:ring-gsf-boston/30" style="min-width:340px" />'
            + '<button type="button" tabindex="-1" onmousedown="event.preventDefault();App._comboToggle(\'' + id + '\')" title="Show all" class="border rounded-r-md py-1.5 px-2 bg-slate-50 hover:bg-slate-100 text-slate-500 cursor-pointer">▾</button>'
            + '</div>'
            + '<div id="' + id + '-list" class="bg-white border rounded-lg shadow-xl custom-scrollbar" style="display:none;position:absolute;z-index:60;top:100%;left:0;margin-top:4px;width:max-content;min-width:100%;max-width:560px;max-height:18rem;overflow-y:auto"></div>'
            + '</div>';
    },
    _comboPopulate(id, filter) {
        const d = this._comboData[id]; if (!d) return;
        const list = document.getElementById(id + '-list'); if (!list) return;
        const f = String(filter || '').trim().toLowerCase();
        const opts = f ? d.options.filter(o => o.toLowerCase().includes(f)) : d.options;
        list.innerHTML = opts.length
            ? opts.map(o => '<div class="combo-item" onmousedown="event.preventDefault();App._comboPick(\'' + id + '\',this.getAttribute(\'data-v\'))" data-v="' + this.escapeHtml(o).replace(/"/g, '&quot;') + '" onmouseover="this.style.background=\'#f1f5f9\'" onmouseout="this.style.background=\'\'" style="padding:7px 12px;font-size:13px;cursor:pointer;white-space:nowrap">' + this.escapeHtml(o) + '</div>').join('')
            : '<div style="padding:8px 12px;font-size:12px;color:#94a3b8">No matches</div>';
        list.style.display = 'block';
    },
    _comboFilter(id) { const el = document.getElementById(id + '-input'); this._comboPopulate(id, el ? el.value : ''); },
    _comboFocus(id) { const el = document.getElementById(id + '-input'); if (el) el.select(); this._comboPopulate(id, ''); },
    _comboToggle(id) { const list = document.getElementById(id + '-list'); if (list && list.style.display === 'block') { list.style.display = 'none'; } else { this._comboPopulate(id, ''); const el = document.getElementById(id + '-input'); if (el) el.focus(); } },
    _comboBlur(id) { setTimeout(() => { const list = document.getElementById(id + '-list'); if (list) list.style.display = 'none'; }, 150); },
    _comboKey(id, e) { if (e.key === 'Enter') { const list = document.getElementById(id + '-list'); const first = list && list.querySelector('.combo-item'); if (first) this._comboPick(id, first.getAttribute('data-v')); } else if (e.key === 'Escape') { const list = document.getElementById(id + '-list'); if (list) list.style.display = 'none'; } },
    _comboPick(id, val) {
        const d = this._comboData[id]; if (!d) return;
        const list = document.getElementById(id + '-list'); if (list) list.style.display = 'none';
        if (d.kind === 'provider') this.selectedProvider = val; else this.selectedCourse = val;
        this.renderView();
    },

    // ── Partner logos in the APP (provider / course pages). Loaded once from
    //    build/provider_logos/ into a cache, then injected post-render. ──
    _provLogoCache: null,
    async _ensureProviderLogos() {
        if (this._provLogoCache) return this._provLogoCache;
        const cache = {};
        try {
            const fs = electronAPI.fs, path = electronAPI.path;
            const dir = path.join(electronAPI.appPath, 'build', 'provider_logos');
            const files = (fs.readdirSync ? fs.readdirSync(dir) : []) || [];
            const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
            for (const f of files) {
                if (!/\.(png|jpe?g)$/i.test(f)) continue;
                const mime = /\.jpe?g$/i.test(f) ? 'image/jpeg' : 'image/png';
                try { cache[norm(f.replace(/\.[^.]+$/, ''))] = 'data:' + mime + ';base64,' + fs.readFileBase64(path.join(dir, f)); } catch (e) {}
            }
        } catch (e) {}
        this._provLogoCache = cache;
        return cache;
    },
    _providerLogoFor(providerName) {
        const cache = this._provLogoCache; if (!cache) return '';
        const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const pn = norm(providerName); if (!pn) return '';
        if (cache[pn]) return cache[pn];
        for (const k of Object.keys(cache)) { if (k.length >= 3 && (pn.includes(k) || k.includes(pn))) return cache[k]; }
        return '';
    },
    async _injectProviderLogo(providerName, slotId, href) {
        await this._ensureProviderLogos();
        const el = document.getElementById(slotId); if (!el) return;
        const uri = this._providerLogoFor(providerName);
        if (!uri) { el.style.display = 'none'; return; }
        const img = '<img src="' + uri + '" alt="' + this.escapeHtml(providerName) + '" style="height:52px;width:auto;max-width:200px;object-fit:contain;display:block">';
        const chip = '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:8px 14px;display:inline-flex;align-items:center">' + img + '</div>';
        el.innerHTML = href ? ('<div onclick="electronAPI.openExternal(\'' + this.escapeHtml(href).replace(/'/g, "\\'") + '\')" style="cursor:pointer" title="View on SURGhub">' + chip + '</div>') : chip;
        el.style.display = '';
    },

    // Known SURGhub provider pages (surghub.org/{slug}); only providers with a
    // live page (checked June 2026). Matched by distinctive accent-folded token.
    _providerSurghubUrl(providerName) {
        const fold = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const pn = fold(providerName);
        const PAGES = [
            ['allsafe', 'all-safe-courses'], ['americansocietyofanaesthesiologists', 'american-society-anesthesiologists-courses'],
            ['amosmile', 'amosmile-courses'], ['aoalliance', 'ao-alliance-courses'], ['ausmed', 'ausmed-courses'],
            ['behindtheknife', 'behind-the-knife-courses'], ['canesca', 'canecsa-courses'], ['cosecsa', 'cosecsa-courses'],
            ['crashsavers', 'crashsavers-courses'], ['ecancer', 'ecancer-courses'], ['f2ar', 'federation-francophone-des-societes-danesthesie-f2ar-courses'],
            ['baylor', 'global-trauma-collaboration-baylor-courses'], ['ifrs', 'ifrs-courses'], ['interburns', 'interburns-courses'],
            ['redcross', 'international-committee-red-cross-courses'], ['kingsglobalhealth', 'kings-global-health-partnerships-courses'],
            ['lifebox', 'lifebox-courses'], ['nihr', 'nihr-courses'], ['safesurgeryinnovation', 'safe-surgery-innovation-courses'],
            ['smiletrain', 'smile-train-courses'], ['tecnologicodemonterrey', 'tecsalud-courses'],
            ['universityofminnesota', 'university-of-minnesota-courses'], ['westernaustralia', 'university-western-australia-courses']
        ];
        const hit = PAGES.find(([tok]) => pn.includes(tok));
        return hit ? 'https://www.surghub.org/' + hit[1] : '';
    },
    _courseSurghubUrl(courseId) {
        return courseId ? 'https://www.surghub.org/course/' + String(courseId) : '';
    },

    // ── Include / exclude toggles ──
    // Course-level: flip Excluded on every row of a course (used from the
    // provider page table and the course page). Unpublished courses get
    // excluded so they drop out of every analytic.
    toggleCourseIncludedByName(courseName, included, el) {
        try {
            const excluded = !included;
            let n = 0;
            for (const d of this.data) { if (courseMatches(d, courseName)) { d.Excluded = excluded; n++; } }
            if (n) this.handleDbSave();
            // In-place row fade keeps scroll position (provider table / directory);
            // full re-render only when toggled from a context without an element.
            if (el) { const tr = el.closest('tr'); if (tr) tr.classList.toggle('opacity-40', excluded); }
            else this.renderView();
        } catch (e) { console.error('toggleCourseIncludedByName', e); }
    },
    isCourseIncluded(courseName) {
        return !this.data.some(d => courseMatches(d, courseName) && d.Excluded);
    },
    // Provider-level: a persisted set of excluded provider names. Courses by an
    // excluded provider are dropped from all analytics automatically (via the
    // getAnalyticsSnap filter), so the totals only count included providers.
    async toggleProviderIncluded(name, included, el) {
        try {
            if (!(this._excludedProviders instanceof Set)) this._excludedProviders = new Set();
            if (included) this._excludedProviders.delete(name); else this._excludedProviders.add(name);
            await Storage.setItem('surghub_excluded_providers', [...this._excludedProviders]);
            // In-place update so the list keeps its scroll position (no re-render).
            // Analytics pick up the change on the next navigation.
            if (el) {
                const span = el.closest('label') && el.closest('label').querySelector('span');
                if (span) span.className = 'text-sm ' + (included ? 'text-gsf-prussian font-medium' : 'text-slate-400 line-through');
                const badge = document.getElementById('prov-exclude-badge');
                if (badge) { const n = this._excludedProviders.size; badge.textContent = n + ' excluded'; badge.style.display = n ? '' : 'none'; }
            } else {
                this.renderView();
            }
        } catch (e) { console.error('toggleProviderIncluded', e); }
    },
    isProviderIncluded(name) {
        return !(this._excludedProviders instanceof Set && this._excludedProviders.has(name));
    },

    // ── Survey Insights (app-side, mirrors the web report): per-question
    //    response counts, average, and %4-5, with multilingual variants merged. ──
    // Short, glanceable title for a survey question (keyword match so it works
    // regardless of language variant, punctuation or casing). Shown highlighted
    // before the full question text in Survey Insights (app + reports).
    _surveyQTitle(q) {
        const s = String(q || '').toLowerCase();
        if (s.includes('overall satisfaction') || s.includes('satisfaction with this course')) return 'Overall satisfaction';
        if (s.includes('learning objectives') || s.includes('objectives stated')) return 'Learning objectives';
        if (s.includes('relevant and engaging')) return 'Content quality';
        if (s.includes('new to me')) return 'New knowledge';
        if (s.includes('relevant to my job')) return 'Job relevance';
        if (s.includes('use the information acquired') || s.includes('likely that i will use')) return 'Intent to apply';
        if (s.includes('job success')) return 'Career value';
        if (s.includes('user-friendly') || s.includes('course platform') || s.includes('reliable was the course')) return 'Platform usability';
        return '';
    },
    _surveyInsightsRows(snapData) {
        const CANON = [
            [/satisfaction concernant ce cours|satisfacci.n general/i, 'how would you rate your overall satisfaction with this course?'],
            [/objectifs mentionn|objetivos mencionados|objetivos enunciados|pertinencia de los contenidos para alcanzar/i, 'how well did the course help you achieve the learning objectives stated on the course description?'],
            [/pertinent et engageant|pertinente y atractivo|interactividad de los contenidos/i, 'how relevant and engaging was the course content?'],
            [/nouvelle pour moi|nuevo para m/i, 'the information presented in this course (e.g., knowledge, concepts, awareness, skills, etc.) was new to me'],
            [/pertinent pour mon travail|relevante para mi trabajo/i, 'the content of the course is relevant to my job'],
            [/informations acquises|informaci.n adquirida/i, 'it is likely that I will use the information acquired in this course'],
            [/r.ussite professionnelle|.xito laboral/i, 'How important are the knowledge/skills acquired in the event to your job success?'],
            [/facile . utiliser|f.cil de usar|interfaz|ergonom.a y la accesibilidad|accesibilidad de la plataforma/i, 'how user-friendly and reliable was the course platform?']
        ];
        const cleanQ = (q) => String(q)
            .replace(/^on a scale from 1 to 5,?\s*/i, '')
            .replace(/^how strongly do you agree with the following statement:?\s*/i, '')
            .replace(/if you are currently unemployed.*$/i, '')
            .replace(/["“”]/g, '')
            .replace(/\s+/g, ' ').trim();
        // Questions to drop from the insights table (rogue / non-comparable items).
        const EXCLUDE = /overall quality of this module/i;
        const merged = {}; const order = [];
        (snapData || []).forEach(d => {
            if (!d.QuestionStats) return;
            let qs; try { qs = JSON.parse(d.QuestionStats); } catch (e) { return; }
            (Array.isArray(qs) ? qs : []).forEach(sv => {
                if (!sv || !sv.q || !sv.n) return;
                if (EXCLUDE.test(sv.q)) return;
                let key = sv.q;
                for (const [re, canon] of CANON) { if (re.test(sv.q)) { key = canon; break; } }
                const norm = cleanQ(key).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
                if (!merged[norm]) { const dq = cleanQ(key); merged[norm] = { sum: 0, n: 0, hi: 0, disp: dq ? dq.charAt(0).toUpperCase() + dq.slice(1) : dq }; order.push(norm); }
                merged[norm].sum += (sv.avg || 0) * sv.n;
                merged[norm].n += sv.n;
                merged[norm].hi += (sv.dist ? ((sv.dist[4] || 0) + (sv.dist[5] || 0)) : 0);
            });
        });
        return order.filter(k => merged[k].n >= 3).map(k => { const v = merged[k]; return { q: v.disp, title: this._surveyQTitle(v.disp), avg: v.sum / v.n, n: v.n, hiPct: (v.hi / v.n) * 100 }; });
    },

    _copyAiStory(btn) {
        const st = this._aiStory; if (!st) return;
        const txt = st.h + '\n\n' + st.s + '\n\n' + (st.b || []).map(x => '\u2022 ' + x).join('\n');
        navigator.clipboard.writeText(txt).then(() => { if (btn) btn.textContent = 'Copied \u2713'; });
    },

    // Shared: category lists for the audience timeline selectors
    _audCategoriesFrom(snap, field, canonCadre) {
        let tl = (snap[field] && window.Charts) ? window.Charts.safeParse(snap[field]) : {};
        // For the cadre selector, fold exact tags into canonical cadres so the checkbox
        // labels match the (now canonicalized) Growth-by-Cadre chart series.
        if (canonCadre && window.Charts && window.Charts.canonActivityTimeline) tl = window.Charts.canonActivityTimeline(tl);
        const totals = {};
        Object.values(tl).forEach(m => { if (typeof m === 'object') Object.entries(m).forEach(([k, v]) => { totals[k] = (totals[k] || 0) + v; }); });
        return Object.entries(totals).filter(([k]) => k && k !== 'Unknown' && k !== 'nan' && k !== 'undefined').sort((a, b) => b[1] - a[1]).map(([k]) => k);
    },

    _dashNoLearnerData() {
        return '<div class="bg-white p-12 text-center text-slate-500 italic rounded-xl border">No learner data yet — run <strong>Sync Learners</strong> (or upload the Users export) on the Data Sync page.</div>';
    },

    // ── Dashboard › Overview: merged cards, user growth first, then platform growth ──
    // ── Dashboard › Feedback: survey insights + AI-curated feedback ──
    _dashFeedbackHtml(snapData) {
        const st = this._aiStory;
        const surveyRows = this._surveyInsightsRows(snapData);
        const pf = window.FeedbackIntel ? window.FeedbackIntel.extractPlatformFeedback(snapData) : null;
        return `
                    <div class="bg-gradient-to-br from-gsf-prussian to-[#0a3a57] text-white rounded-xl shadow-sm p-6 mb-8">
                        <div class="flex items-start justify-between gap-4 flex-wrap">
                            <div class="min-w-0 flex-1">
                                <p class="text-[10px] font-bold uppercase tracking-widest text-amber-300 mb-2">✨ The SURGhub story</p>
                                ${st ? `
                                    <h3 class="text-xl font-black mb-2">${this.escapeHtml(st.h)}</h3>
                                    <p class="text-sm text-white/85 leading-relaxed whitespace-pre-line">${this.escapeHtml(st.s)}</p>
                                    <ul class="mt-3 space-y-1">${(st.b || []).map(b => '<li class="text-sm text-amber-200 font-medium">&bull; ' + this.escapeHtml(b) + '</li>').join('')}</ul>
                                    <p class="text-[10px] text-white/40 mt-3">AI-generated from current platform data &middot; ${this.escapeHtml(st.at || '')}</p>
                                ` : '<p class="text-sm text-white/75">One concise, number-anchored narrative of why SURGhub matters — generated from the live platform data. Great for intros, funder emails and board slides.</p>'}
                            </div>
                            <div class="flex flex-col gap-2 shrink-0">
                                <button data-edit-only onclick="App.generatePlatformStory()" class="px-4 py-2 bg-amber-400 text-gsf-prussian font-bold rounded-lg text-sm hover:bg-amber-300 transition-colors">${st ? '↻ Regenerate' : '✨ Tell the story'}</button>
                                ${st ? '<button onclick="App._copyAiStory(this)" class="px-4 py-2 bg-white/10 text-white font-bold rounded-lg text-sm hover:bg-white/20 transition-colors">Copy text</button>' : ''}
                            </div>
                        </div>
                    </div>

                    <div class="bg-white p-6 rounded-xl shadow-sm border border-slate-100 mb-8">
                        <h3 class="text-lg font-bold mb-4 flex items-center gap-2 text-gsf-prussian"><i data-lucide="message-square" class="text-gsf-boston"></i> Feedback Trends ${this._chartBtns('chart_feedback_growth', 'Feedback_Trends')}</h3>
                        <div class="mb-3 flex flex-wrap gap-4">
                            <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" checked onchange="if(window.Charts) window.Charts.drawFeedbackTimeline('chart_feedback_growth', App.getAnalyticsSnap(), document.getElementById('toggle-plat-fb-bars').checked)" data-series="plat-rating"> <span class="w-3 h-3 rounded-sm inline-block" style="background:#D03734"></span> Avg Rating</label>
                            <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" id="toggle-plat-fb-bars" onchange="if(window.Charts) window.Charts.drawFeedbackTimeline('chart_feedback_growth', App.getAnalyticsSnap(), this.checked)"> <span class="w-3 h-3 rounded-sm inline-block" style="background:#85c1e9"></span> Survey Volume</label>
                        </div>
                        <div id="chart_feedback_growth" style="width: 100%; height: 400px;"></div>
                    </div>

                    ${surveyRows.length ? `
                        <div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-8">
                            <div class="bg-slate-50 border-b p-5"><h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="clipboard-check" class="text-gsf-boston"></i> Survey Insights</h2><p class="text-xs text-slate-500 mt-1">End-of-course survey, all responses to date, aggregated across every course. Multilingual variants of each question are merged.</p></div>
                            <div class="overflow-x-auto">
                                <table class="w-full text-left text-sm">
                                    <thead class="text-slate-500 border-b"><tr>
                                        <th class="py-3 px-4 font-medium">Question</th>
                                        <th class="py-3 px-4 font-medium text-right">Responses</th>
                                        <th class="py-3 px-4 font-medium text-right">Avg (1–5)</th>
                                        <th class="py-3 px-4 font-medium text-right">% Rating 4–5</th>
                                    </tr></thead>
                                    <tbody>${surveyRows.map(r => '<tr class="border-b hover:bg-slate-50"><td class="py-2.5 px-4 text-gsf-prussian">' + (r.title ? '<span class="font-bold text-gsf-boston">' + this.escapeHtml(r.title) + ':</span> ' : '') + '<span class="text-slate-600">' + this.escapeHtml(r.q) + '</span></td><td class="py-2.5 px-4 text-right">' + this.formatNumber(r.n) + '</td><td class="py-2.5 px-4 text-right font-bold">' + r.avg.toFixed(2) + '</td><td class="py-2.5 px-4 text-right font-bold text-gsf-boston">' + Math.round(r.hiPct) + '%</td></tr>').join('')}</tbody>
                                </table>
                            </div>
                        </div>
                    ` : ''}

                    ${(() => {
                        if (!pf || pf.platformFeedback.length === 0) return '';
                        return `
                            <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
                                <h3 class="text-lg font-bold mb-2 flex items-center gap-2 text-gsf-prussian">
                                    <i data-lucide="message-circle-heart" class="text-gsf-boston"></i> Platform Feedback Intelligence
                                </h3>
                                <p class="text-xs text-slate-500 mb-4">Feedback from across all ${snapData.length} courses that references the SURGhub platform, online learning experience, or overall programme. ${pf.platformFeedback.length} platform-relevant entries found from ${pf.totalFeedbackCount} total.</p>
                                <div id="platform-feedback-section">
                                    ${pf.platformFeedback.length > 0 ? this.renderFeedbackExplorer(pf.platformFeedback.slice(0, 100)) : ''}
                                </div>
                            </div>
                        `;
                    })()}
        `;
    },

    // ── Sync Health: read-only data-integrity panel ─────────────────────────
    // Computed entirely from data already in memory (no LearnWorlds call): is the
    // last refresh fresh, internally consistent, well-covered, and what changed?
    _dashHealthHtml(snapData, audSnap) {
        const snap = audSnap || {};
        const fmt = n => this.formatNumber(Math.round(Number(n) || 0));
        const courses = (snapData || []).filter(c => !c.IsShell && !c.Excluded);
        const allCourses = (snapData || []).filter(c => !c.IsShell);

        // Freshness
        const dataDate = (this.selectedDate && /^\d{4}-\d{2}-\d{2}/.test(this.selectedDate)) ? this.selectedDate
            : (snap.Timestamp ? String(snap.Timestamp).slice(0, 10) : null);
        let ageStr = '—', ageWarn = false;
        if (dataDate) {
            const d = new Date(dataDate + 'T00:00:00'); const now = new Date(); now.setHours(0, 0, 0, 0);
            const days = Math.round((now - d) / 86400000);
            ageStr = days <= 0 ? 'today' : (days === 1 ? 'yesterday' : days + ' days ago');
            ageWarn = days > 30;
        }

        // Sums + timeline coverage (the figures _reconcileScale silently scales on charts)
        const sumLearners = courses.reduce((s, c) => s + (Number(c.Learners) || 0), 0);
        const sumCerts = courses.reduce((s, c) => s + (Number(c.Certificates) || 0), 0);
        // CourseTimeline = { scale:{enrollScale,certScale}, timeline:{month:{e,c}}, totalE, totalC }.
        // totalE/totalC are already SCALED to match the stored totals, so the real signal is
        // how much was scaled up: genuinely-dated = total ÷ scale. We surface that provenance.
        let tlScaledE = 0, tlRawE = 0, tlScaledC = 0, tlRawC = 0, tlCount = 0, highScale = 0;
        courses.forEach(c => {
            if (!c.CourseTimeline) return;
            try {
                const tl = typeof c.CourseTimeline === 'string' ? JSON.parse(c.CourseTimeline) : c.CourseTimeline;
                const es = (tl.scale && Number(tl.scale.enrollScale)) || 1;
                const cs = (tl.scale && Number(tl.scale.certScale)) || 1;
                const tE = Number(tl.totalE) || 0, tC = Number(tl.totalC) || 0;
                if (tE || tC) { tlScaledE += tE; tlRawE += tE / (es || 1); tlScaledC += tC; tlRawC += tC / (cs || 1); tlCount++; if (es > 1.3 || cs > 1.3) highScale++; }
            } catch (e) {}
        });

        const checks = [];
        const add = (label, status, detail) => checks.push({ label, status, detail });
        if (tlCount > 0 && tlScaledE > 0) {
            const cov = tlRawE / tlScaledE * 100;
            add('Enrolment growth-chart provenance', cov >= 80 ? 'ok' : 'warn',
                cov.toFixed(0) + '% of charted enrolments come from real dates; the remaining ' + (100 - cov).toFixed(0) + '% is scaled to match stored totals' + (highScale ? ' · ' + highScale + ' course(s) scaled >30%' : ''));
        }
        if (tlCount > 0 && tlScaledC > 0) {
            const cov = tlRawC / tlScaledC * 100;
            add('Certificate growth-chart provenance', cov >= 80 ? 'ok' : 'warn',
                cov.toFixed(0) + '% of charted certificates come from real dates; the remaining ' + (100 - cov).toFixed(0) + '% is scaled');
        }
        if (snap.CountryKnownPct != null) add('Country coverage', Number(snap.CountryKnownPct) >= 50 ? 'ok' : 'warn', snap.CountryKnownPct + '% of users have a known country' + (snap.CountryKnownCount ? ' (' + fmt(snap.CountryKnownCount) + ' users)' : ''));
        if (snap.SurveyedPct != null) add('Profile-survey coverage', Number(snap.SurveyedPct) >= 30 ? 'ok' : 'warn', snap.SurveyedPct + '% completed the profile survey (drives profession / gender / org type)');
        const amb = this.ambassadorData || {};
        if (amb.TotalReferrals != null && amb.Promoters && typeof amb.Promoters === 'object') {
            const sumP = Object.values(amb.Promoters).reduce((s, v) => s + (Number(v) || 0), 0);
            const tot = Number(amb.TotalReferrals) || 0;
            add('Ambassador lead attribution', 'info',
                fmt(sumP) + ' attributed across ' + Object.keys(amb.Promoters).length + ' promoters · ' + fmt(tot) + ' total referrals' + (amb.OrphanLeads ? ' · ' + fmt(amb.OrphanLeads) + ' orphaned' : ''));
        }
        const zero = courses.filter(c => (Number(c.Learners) || 0) === 0).length;
        add('Courses reporting 0 learners', zero === 0 ? 'ok' : 'info', zero === 0 ? 'none' : zero + ' of ' + courses.length + ' included courses (verify they synced)');
        const excl = Math.max(0, allCourses.length - courses.length);
        add('Course inclusion', 'info', courses.length + ' included · ' + excl + ' excluded from analytics');

        // What changed since the previous snapshot
        const hist = (this.userHistory || []).filter(h => h && h.Timestamp).slice().sort((a, b) => String(a.Timestamp).localeCompare(String(b.Timestamp)));
        const changes = [];
        if (hist.length >= 2) {
            const prev = hist[hist.length - 2], cur = hist[hist.length - 1];
            [['TotalUsers', 'Total users'], ['CountryKnownCount', 'Users with known country'], ['SurveyedCount', 'Surveyed users'], ['TotalCourseMinutes', 'Learning minutes']].forEach(([k, lab]) => {
                const a = Number(prev[k]) || 0, b = Number(cur[k]) || 0;
                if (a || b) changes.push({ lab, a, b, delta: b - a });
            });
        }

        // Rollback points (the pre-sync backups)
        let rollback = 0;
        try { const fs = electronAPI.fs, path = electronAPI.path; const bd = path.join(Storage.DATA_DIR, 'backups'); if (fs.existsSync(bd)) rollback = fs.readdirSync(bd, { withFileTypes: true }).filter(e => e.isDirectory && /^presync_/.test(e.name)).length; } catch (e) {}
        // Recent raw captures (immutable receipts) from the pull manifest
        let rawPulls = [];
        try {
            const fs = electronAPI.fs, path = electronAPI.path;
            const mf = path.join(Storage.DATA_DIR, 'surghub', 'raw', 'manifest.jsonl');
            if (fs.existsSync(mf)) rawPulls = String(fs.readFileSync(mf, 'utf8')).trim().split('\n').filter(Boolean).slice(-6).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean).reverse();
        } catch (e) {}

        const warnCount = checks.filter(c => c.status === 'warn').length;
        const icon = s => s === 'ok' ? '<span class="text-green-600">●</span>' : s === 'warn' ? '<span class="text-amber-500">▲</span>' : '<span class="text-slate-400">○</span>';
        const checkRows = checks.map(c => `<div class="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0"><span class="mt-0.5 text-xs">${icon(c.status)}</span><div class="min-w-0"><p class="text-sm font-bold text-gsf-prussian">${c.label}</p><p class="text-xs text-slate-500">${c.detail}</p></div></div>`).join('');
        const anyDrop = changes.some(c => c.delta < 0);
        const rawSection = rawPulls.length ? '<div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-8"><div class="bg-slate-50 border-b p-5"><h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="archive" class="text-gsf-boston"></i> Raw captures (receipts)</h2><p class="text-xs text-slate-500 mt-1">Verbatim copies of recent LearnWorlds pulls, kept for provenance &amp; re-derivation — never exported.</p></div><div class="px-5 py-2">' + rawPulls.map(p => '<div class="flex items-center justify-between py-2 border-b border-slate-100 last:border-0 text-sm"><span class="text-slate-600" style="font-family:var(--mono);font-size:11px">' + this.escapeHtml(p.pullId || '') + '</span><span class="text-slate-400 text-xs">' + fmt(p.pages) + ' pages · ' + (Number(p.bytes || 0) / 1e6).toFixed(1) + ' MB · ' + (p.complete ? '<span class="text-green-600">complete</span>' : '<span class="text-amber-600">incomplete</span>') + '</span></div>').join('') + '</div></div>' : '';
        const changeRows = changes.length ? changes.map(c => {
            const col = c.delta < 0 ? 'text-red-600' : 'text-slate-500';
            const arrow = c.delta > 0 ? '▲' : (c.delta < 0 ? '▼' : '•');
            return `<div class="flex items-center justify-between py-2 border-b border-slate-100 last:border-0"><span class="text-sm text-slate-600">${c.lab}</span><span class="text-sm font-medium ${col}">${arrow} ${c.delta >= 0 ? '+' : ''}${fmt(c.delta)} <span class="text-slate-400 font-normal">(${fmt(c.a)} → ${fmt(c.b)})</span></span></div>`;
        }).join('') : '<p class="text-sm text-slate-400 italic py-2">Two or more synced snapshots are needed to show changes — they accumulate as you sync over time.</p>';

        return `
                    <div class="flex items-center justify-between gap-3 flex-wrap mb-6">
                        <p class="text-sm text-slate-500">Whether the data can be trusted after the last refresh — freshness, internal consistency, coverage, and what changed.</p>
                    </div>
                    <div class="rounded-xl border ${ageWarn ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'} p-5 mb-6 flex items-center gap-3 shadow-sm">
                        <i data-lucide="${ageWarn ? 'clock-alert' : 'clock'}" class="${ageWarn ? 'text-amber-600' : 'text-gsf-boston'}" width="20"></i>
                        <div><p class="text-sm font-bold text-gsf-prussian">Data from ${dataDate || 'unknown'} · ${ageStr}</p><p class="text-xs text-slate-500">${warnCount === 0 ? 'All consistency checks passed.' : warnCount + ' check' + (warnCount === 1 ? '' : 's') + ' worth a look (▲ below).'}${rollback ? ' · ' + rollback + ' pre-sync rollback point' + (rollback === 1 ? '' : 's') + ' available.' : ''}</p></div>
                    </div>
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                        <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
                            <div class="bg-slate-50 border-b p-5"><h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="shield-check" class="text-gsf-boston"></i> Consistency &amp; coverage</h2><p class="text-xs text-slate-500 mt-1">Cross-checks computed from the stored data — no re-sync needed.</p></div>
                            <div class="px-5 py-2">${checkRows}</div>
                        </div>
                        <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
                            <div class="bg-slate-50 border-b p-5"><h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="git-compare" class="text-gsf-boston"></i> What changed since the last sync</h2><p class="text-xs text-slate-500 mt-1">${anyDrop ? '<span class="text-red-600 font-medium">A figure went down vs the previous snapshot — worth checking.</span>' : 'Movement vs the previous stored snapshot.'}</p></div>
                            <div class="px-5 py-2">${changeRows}</div>
                        </div>
                    </div>
                    ${this._deriveVerifySection()}
                    ${rawSection}
                    <div class="bg-slate-50 border rounded-xl px-5 py-4 text-[11px] text-slate-500 leading-relaxed">These checks read the data already on disk — they don't call LearnWorlds. <strong>▲</strong> flags a gap worth a look (often expected — e.g. dated-coverage below 100% because some history predates growth-timeline collection). A <strong class="text-red-600">▼</strong> under "what changed" means a total dropped versus the last snapshot, which usually signals an incomplete sync — if so, restore a pre-sync backup from <span class="font-mono">~/Documents/SURGdash/backups/</span>.</div>
        `;
    },

    _dashOverviewHtml(snapData, audSnap, kpiCards) {
        const snap = audSnap || {};
        return `
                    <div id="sh-kpi-grid" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
                        ${kpiCards.map(k => `<div class="group relative bg-white rounded-xl border shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow" ${k.title ? 'title="'+this.escapeHtml(k.title)+'"' : ''} onclick="App._copyKpiCard(this)">
                            <div class="h-1" style="background:${k.color}"></div>
                            <div class="p-4 pb-5">
                                <div class="flex items-center gap-1.5 mb-2"><i data-lucide="${k.icon}" width="13" style="color:${k.color}" class="shrink-0"></i><p class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">${k.label}</p></div>
                                <p class="text-[30px] font-bold leading-none tracking-tight" style="color:${k.color};font-family:var(--num)">${k.value}</p>
                            </div>
                            <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"><i data-lucide="copy" width="10" class="text-slate-300"></i></div>
                        </div>`).join('')}
                    </div>

                    ${snap.TotalUsers ? this._renderDailyJoinersPanel(snap) : ''}

                    ${(this.timelineMismatches && this.timelineMismatches.length > 0) ? `
                    <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-800">
                        <strong>Data Notice:</strong> ${this.timelineMismatches.length} course(s) have learner count differences between Course Export and Timeline.
                        Chart curves are scaled to match Course Export totals.
                        <details class="mt-2"><summary class="cursor-pointer font-bold">View details</summary>
                        <ul class="mt-2 space-y-1 text-xs">
                            ${this.timelineMismatches.map(m => '<li>' + this.escapeHtml(m.course) + ': Export=' + this.formatNumber(m.exportL) + ' vs Timeline=' + this.formatNumber(m.timelineL) + '</li>').join('')}
                        </ul></details>
                    </div>` : ''}

                    ${snap.TotalUsers ? `
                        <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
                            <h3 class="text-lg font-bold mb-4 flex items-center gap-2 text-gsf-prussian">User Growth ${this._chartWidthBtns('chart_audience_growth')} ${this._resetChartBtn('chart_audience_growth')} ${this._chartBtns('chart_audience_growth', 'User_Growth')}</h3>
                            <div class="mb-3 flex flex-wrap gap-4 items-center">
                                <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" data-viewer-allowed id="toggle-aud-growth-bars" onchange="const s=(App.userHistory||[]).find(d=>d.Timestamp===App.selectedDate)||(App.userHistory||[])[0]||{}; if(window.Charts && s.TotalUsers) window.Charts.drawAudience(s)"> Show monthly bars</label>
                                <label class="inline-flex items-center gap-2 text-sm text-slate-600">
                                    <span class="text-xs font-semibold text-slate-400 uppercase">Period</span>
                                    <select data-viewer-allowed onchange="App.userGrowthRange=this.value; const s=(App.userHistory||[]).find(d=>d.Timestamp===App.selectedDate)||(App.userHistory||[])[0]||{}; if(window.Charts && s.TotalUsers) window.Charts.drawAudience(s)" class="bg-white border rounded px-2 py-1 text-slate-700 outline-none text-xs">
                                        ${[{v:'3',l:'Last 3 mo'},{v:'6',l:'Last 6 mo'},{v:'12',l:'Last 12 mo'},{v:'24',l:'Last 24 mo'},{v:'all',l:'All time'}].map(r=>`<option value="${r.v}" ${String(this.userGrowthRange)===r.v?'selected':''}>${r.l}</option>`).join('')}
                                    </select>
                                </label>
                                <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer" title="Start the y-axis near the first visible value so the slope looks steeper. Use for presentations — note this can mislead by exaggerating change.">
                                    <input type="checkbox" data-viewer-allowed ${this.userGrowthTrim ? 'checked' : ''} onchange="App.userGrowthTrim=this.checked; const s=(App.userHistory||[]).find(d=>d.Timestamp===App.selectedDate)||(App.userHistory||[])[0]||{}; if(window.Charts && s.TotalUsers) window.Charts.drawAudience(s)">
                                    <span>Trim y-axis <span class="text-[10px] text-slate-400">(drama mode)</span></span>
                                </label>
                                ${this._partialMonthToggle()}
                            </div>
                            ${this.userGrowthTrim ? '<p class="text-[11px] text-amber-600 italic mb-2">⚠ Y-axis is trimmed — slope appears steeper than it actually is. Turn off for honest reporting.</p>' : ''}
                            <div style="${this._chartWidthStyle('chart_audience_growth')}">
                                <div id="chart_audience_growth" style="width: 100%; height: 400px;"></div>
                            </div>
                            ${this._partialMonthCaption()}
                        </div>
                    ` : ''}

                    <div class="bg-white p-6 rounded-xl shadow-sm border border-slate-100 mb-8">
                        <h3 class="text-lg font-bold mb-4 flex items-center gap-2 text-gsf-prussian"><i data-lucide="trending-up" class="text-gsf-boston"></i> Platform Growth ${this._chartWidthBtns('chart_growth')} ${this._resetChartBtn('chart_growth')} ${this._chartBtns('chart_growth', 'Platform_Growth')}</h3>
                        <div class="mb-3 flex flex-wrap gap-4 items-center">
                            <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" data-viewer-allowed checked onchange="if(window.Charts) window.Charts.redrawPlatformGrowth(App.getPlatformHistory())" data-series="plat-enroll"> <span class="w-3 h-3 rounded-sm inline-block" style="background:#1a5276"></span> Learners</label>
                            <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" data-viewer-allowed checked onchange="if(window.Charts) window.Charts.redrawPlatformGrowth(App.getPlatformHistory())" data-series="plat-cert"> <span class="w-3 h-3 rounded-sm inline-block" style="background:#4389C8"></span> Certificates</label>
                            <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" data-viewer-allowed id="toggle-plat-growth-bars" onchange="if(window.Charts) window.Charts.redrawPlatformGrowth(App.getPlatformHistory())"> Show monthly bars</label>
                            ${this._partialMonthToggle()}
                        </div>
                        <div style="${this._chartWidthStyle('chart_growth')}">
                            <div id="chart_growth" style="width: 100%; height: 500px;"></div>
                        </div>
                        ${this._partialMonthCaption()}
                    </div>

                    <div id="engagement-analysis" class="space-y-8 mb-8">${this._renderEngagementAnalysis(true, 'forecast')}</div>

        `;
    },

    // ── Dashboard › Learners: who they are ──
    _dashLearnersHtml(audSnap) {
        const snap = audSnap || {};
        if (!snap.TotalUsers) return this._dashNoLearnerData();
        const allActivities = this._audCategoriesFrom(snap, snap.ActivityTimeline ? 'ActivityTimeline' : 'ProfTimeline', true);
        const allCareerStages = this._audCategoriesFrom(snap, 'CareerStageTimeline');
        const allTopics = this._audCategoriesFrom(snap, 'TopicTimeline');

        let extrapolationNote = '';
        if (snap.TotalUsers) {
            const countryPct = snap.CountryKnownPct || snap.SurveyedPct || 0;
            const countryCount = snap.CountryKnownCount || snap.SurveyedCount || 0;
            const surveyPct = snap.SurveyedPct || 0;
            const surveyCount = snap.SurveyedCount || 0;
            const trackingOnly = snap.TrackingOnlyCount || 0;
            extrapolationNote = `<div class="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-sm text-blue-800 space-y-2">
                    <div><strong>Methodology Note:</strong></div>
                    <div><strong>Country data</strong> is available for ${this.formatNumber(countryCount)} users (${countryPct}% of total). This combines two sources:
                    ${this.formatNumber(surveyCount)} users (${surveyPct}%) from the profile survey, and ${this.formatNumber(trackingOnly)} additional users from browser/IP tracking.</div>
                    <div><strong>Profession, gender, and organisation data</strong> is available for ${this.formatNumber(surveyCount)} users who completed the profile survey (${surveyPct}% of total).</div>
                    <div>All figures are <strong>extrapolated</strong> to the full user base (${this.formatNumber(snap.TotalUsers)}) assuming the surveyed sample is representative of the whole.</div>
                </div>`;
        }

        return `
                    <div class="flex items-center justify-between gap-3 flex-wrap mb-6">
                        <div class="flex items-center gap-3">
                            <p class="text-sm text-slate-500">Who SURGhub's learners are — cadres, career stages, interests and demographics.</p>
                            ${this._lastUpdatedBadge('audience')}
                        </div>
                        <div class="flex items-center gap-2">
                            <a href="#" onclick="electronAPI.openExternal('https://www.surghub.org/author/users?tab=user'); return false" class="text-xs text-gsf-boston hover:underline font-medium">Export User Report</a>
                            <button onclick="document.getElementById('audience-upload-input').click()" class="flex items-center gap-1.5 px-3 py-2 border rounded-lg text-xs font-bold text-slate-600 hover:text-gsf-boston hover:bg-slate-50 transition-colors"><i data-lucide="upload-cloud" width="14"></i> Upload Users File</button>
                            <input id="audience-upload-input" type="file" accept=".csv,.xlsx,.xls" onchange="App.processStandaloneAudience(event)" class="hidden" />
                        </div>
                    </div>

                    ${this._renderEngagementAnalysis(false, 'learners')}

                    ${this._audienceBreakdownSection({ title: 'Growth by Cadre', chartId: 'chart_activity_timeline', kind: 'activity', rangeKey: 'activityTimelineRange', trimKey: 'activityGrowthTrim', list: allActivities, selProp: 'selectedActivities', field: snap.ActivityTimeline ? 'ActivityTimeline' : 'ProfTimeline', exportName: 'Cadre_Growth', note: 'Self-reported cadre (survey Q3 — "which best describes your activity"). Exact-tag classification. The "Intern/Resident (legacy)" series is a deprecated tag that stopped being applied ~Jan 2026; those learners now appear under Career Stage → "Postgraduate clinical".' })}

                    ${this._audienceBreakdownSection({ title: 'Growth by Career Stage', chartId: 'chart_career_timeline', kind: 'career', rangeKey: 'careerTimelineRange', trimKey: 'careerGrowthTrim', list: allCareerStages, selProp: 'selectedCareerStages', field: 'CareerStageTimeline', exportName: 'Career_Stage_Growth', note: 'Career stage (survey Q2) — this is where trainees/residents now appear ("Postgraduate clinical").' })}

                    ${this._audienceBreakdownSection({ title: 'Growth by Topic Interest', chartId: 'chart_topic_timeline', kind: 'topic', rangeKey: 'topicTimelineRange', trimKey: 'topicGrowthTrim', list: allTopics, selProp: 'selectedTopics', field: 'TopicTimeline', exportName: 'Topic_Interest_Growth', note: 'Topics of interest (survey Q8, multi-select — a learner can pick several, so totals exceed the user count).' })}

                    ${extrapolationNote}
        `;
    },

    // ── Dashboard › Geography: where they are ──
    _dashGeographyHtml(audSnap) {
        const snap = audSnap || {};
        if (!snap.TotalUsers) return this._dashNoLearnerData();
        const allCountries = this._audCategoriesFrom(snap, 'CountryTimeline');
        return `
                    <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
                        <h3 class="text-lg font-bold mb-6 text-gsf-prussian">Global User Distribution</h3>
                        <div id="chart_user_map" style="width: 100%; height: 500px;"></div>
                    </div>

                    ${this._renderCountryTable(snap.AllCountryStats, 10)}

                    <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
                        <div class="flex items-center justify-between gap-3 mb-3">
                            <h3 class="text-lg font-bold flex items-center gap-2 text-gsf-prussian">Growth by Country</h3>
                            ${this._chartBtns('chart_country_timeline', 'Country_Growth')}
                        </div>
                        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-3">
                            <div class="inline-flex items-center gap-1">${this._chartWidthBtns('chart_country_timeline')} ${this._resetChartBtn('chart_country_timeline')}</div>
                            <span class="w-px h-5 bg-slate-200"></span>
                            ${this._timelineControls('country', this.countryTimelineRange || 'all')}
                            <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer" title="Drama mode — start y-axis near the first visible value to exaggerate slope. Use sparingly.">
                                <input type="checkbox" ${this.countryGrowthTrim ? 'checked' : ''} onchange="App.countryGrowthTrim=this.checked; const s=(App.userHistory||[]).find(d=>d.Timestamp===App.selectedDate)||(App.userHistory||[])[0]||{}; if(window.Charts && s.TotalUsers) window.Charts.drawAudience(s)">
                                <span>Trim y-axis <span class="text-[10px] text-slate-400">(drama)</span></span>
                            </label>
                            <span class="ml-auto">${this._partialMonthToggle()}</span>
                        </div>
                        ${this.countryGrowthTrim ? '<p class="text-[11px] text-amber-600 italic mb-2">⚠ Y-axis trimmed — slopes exaggerated.</p>' : ''}
                        <div id="selector_selectedCountries">${allCountries.length > 0 ? this.buildCategorySelector(allCountries, this.selectedCountries || [], 'selectedCountries', 'chart_country_timeline', 'CountryTimeline', 5) : ''}</div>
                        <div style="${this._chartWidthStyle('chart_country_timeline')}">
                            <div id="chart_country_timeline" style="width: 100%; height: 450px;"></div>
                        </div>
                        ${this._partialMonthCaption()}
                    </div>

                    ${this._renderEngagementAnalysis(false, 'geography')}
        `;
    },

    // ── Dashboard › Performance: providers & courses ──
    // ── Awards: platform-wide superlatives (ranked top-3) for courses,
    //    providers and per-country learner leadership. Memoised per data state. ──
    AWARD_TOP_N: 3,
    COUNTRY_AWARD_MIN: 25,
    // Awards are cumulative-to-date superlatives, so we stamp them with the
    // current quarter ("Q2 2026") to read as a point-in-time standing.
    _currentQuarterLabel(d) {
        d = d || new Date();
        return 'Q' + (Math.floor(d.getMonth() / 3) + 1) + ' ' + d.getFullYear();
    },
    computeAwards() {
        const key = (this.data ? this.data.length : 0) + ':' + ((this._excludedProviders && this._excludedProviders.size) || 0) + ':' + (this.hideLowLearners ? 1 : 0);
        if (this._awardsCache && this._awardsCacheKey === key) return this._awardsCache;
        const N = this.AWARD_TOP_N;
        const snap = this.getPlatformSnap ? this.getPlatformSnap() : this.getAnalyticsSnap();
        const prov = {};
        const courseMins = this.getCourseLearningMinutes ? this.getCourseLearningMinutes() : {}; // anon fallback — match the Learning Time KPI cards on the same pages
        snap.forEach(d => {
            const p = d.Provider; if (!p) return;
            const a = prov[p] = prov[p] || { provider: p, courses: 0, enrol: 0, certs: 0, mins: 0, rSum: 0, rResp: 0 };
            a.courses++; a.enrol += Number(d.Learners) || 0; a.certs += Number(d.Certificates) || 0; a.mins += this.courseLearningMinutes(d, courseMins);
            const r = Number(d.Rating) || 0, resp = Number(d.Responses) || 0;
            if (r > 0 && resp > 0) { a.rSum += r * resp; a.rResp += resp; }
        });
        // 'Most Courses' counts only INCLUDED courses (excluded private/unpublished
        // ones still count toward every other metric, but not the course tally).
        const incCount = {};
        (this.getAnalyticsSnap ? this.getAnalyticsSnap() : snap).forEach(d => { if (d.Provider) incCount[d.Provider] = (incCount[d.Provider] || 0) + 1; });
        const provList = Object.values(prov);
        const courseList = snap.map(d => ({ course: d.Course, provider: d.Provider, enrol: Number(d.Learners) || 0, certs: Number(d.Certificates) || 0, mins: this.courseLearningMinutes(d, courseMins), rating: Number(d.Rating) || 0, resp: Number(d.Responses) || 0 }));
        const fmtNum = v => this.formatNumber(Math.round(v));

        // ── Derived metrics for the newer awards (countries reached, LMIC reach,
        //    last-90-day certificates, intent-to-apply). provCountry/countryTotal
        //    built here are also reused by the country-leadership block below. ──
        const IC = window.IncomeClassification;
        const cMeta = {}, pMeta = {}, provCountry = {}, countryTotal = {};
        snap.forEach(d => {
            if (!d.CountryStats) return;
            let cs; try { cs = JSON.parse(d.CountryStats); } catch (e) { return; }
            const cm = cMeta[d.Course] = cMeta[d.Course] || { countries: new Set(), lmic: 0 };
            const pm = d.Provider ? (pMeta[d.Provider] = pMeta[d.Provider] || { countries: new Set(), lmic: 0 }) : null;
            Object.entries(cs).forEach(([c, n]) => {
                if (!c || c === 'Unknown' || c === 'nan') return;
                const v = Number(n) || 0; if (!v) return;
                cm.countries.add(c); if (pm) pm.countries.add(c);
                const tier = IC ? IC.classify(c) : '';
                if (tier === 'LIC' || tier === 'LMIC') { cm.lmic += v; if (pm) pm.lmic += v; }
                if (d.Provider) { (provCountry[d.Provider] = provCountry[d.Provider] || {})[c] = (provCountry[d.Provider][c] || 0) + v; countryTotal[c] = (countryTotal[c] || 0) + v; }
            });
        });
        const q90c = {}, q90p = {};
        const comp = this._rawCompletion || [];
        if (comp.length) {
            const d0 = new Date(); d0.setHours(0, 0, 0, 0); d0.setDate(d0.getDate() - 90);
            const cutoff = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0');
            const cp = {}; snap.forEach(d => { if (d.Course && d.Provider) cp[d.Course] = d.Provider; });
            comp.forEach(r => { if (!r.certificate) return; const dt = String(r.certificate_date || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(dt) || dt < cutoff) return; q90c[r.course] = (q90c[r.course] || 0) + 1; const pv = cp[r.course]; if (pv) q90p[pv] = (q90p[pv] || 0) + 1; });
        }
        const snapByCourse = {}, provRows = {};
        snap.forEach(d => { snapByCourse[d.Course] = d; if (d.Provider) (provRows[d.Provider] = provRows[d.Provider] || []).push(d); });
        const impactOf = recs => { try { const si = this._surveyImpactStats ? this._surveyImpactStats(recs) : null; return (si && si.willApply) ? si.willApply : null; } catch (e) { return null; } };
        courseList.forEach(c => { const m = cMeta[c.course]; c.countries = m ? m.countries.size : 0; c.lmic = m ? m.lmic : 0; c.q90 = q90c[c.course] || 0; c._imp = impactOf([snapByCourse[c.course]]); });
        provList.forEach(p => { const m = pMeta[p.provider]; p.countries = m ? m.countries.size : 0; p.lmic = m ? m.lmic : 0; p.q90 = q90p[p.provider] || 0; p._imp = impactOf(provRows[p.provider] || []); });
        const ranked = (arr, valFn) => arr.map(x => ({ x, v: valFn(x) })).filter(o => o.v > 0).sort((a, b) => b.v - a.v);
        const CATS = [
            { key: 'courses', label: 'Most Courses', icon: '📚', providerOnly: true, p: x => incCount[x.provider] || 0, fmt: fmtNum },
            { key: 'enrol', label: 'Most Learners', icon: '🏆', c: x => x.enrol, p: x => x.enrol, fmt: fmtNum },
            { key: 'certs', label: 'Most Certificates', icon: '🎓', c: x => x.certs, p: x => x.certs, fmt: fmtNum },
            { key: 'completion', label: 'Highest Completion Rate', icon: '✅', c: x => x.enrol >= 50 ? x.certs / x.enrol * 100 : 0, p: x => x.enrol >= 100 ? x.certs / x.enrol * 100 : 0, fmt: v => v.toFixed(0) + '%' },
            { key: 'mins', label: 'Most Learning Time', icon: '⏱️', c: x => x.mins, p: x => x.mins, fmt: v => this.formatLearningTime(v) },
            { key: 'rating', label: 'Highest Rated', icon: '⭐', c: x => x.resp >= 50 ? x.rating : 0, p: x => x.rResp >= 150 ? x.rSum / x.rResp : 0, fmt: v => v.toFixed(2) + ' / 5' },
            { key: 'q90', label: 'Most Certificates This Quarter', icon: '📈', c: x => x.q90 >= 5 ? x.q90 : 0, p: x => x.q90 >= 5 ? x.q90 : 0, fmt: fmtNum },
            { key: 'reach', label: 'Widest Reach', icon: '🌐', c: x => x.enrol >= 50 ? x.countries : 0, p: x => x.enrol >= 100 ? x.countries : 0, fmt: v => fmtNum(v) + ' countries' },
            { key: 'mission', label: 'Mission Reach', icon: '🤝', c: x => x.lmic, p: x => x.lmic, fmt: v => fmtNum(v) + ' learners' },
            { key: 'impact', label: 'Highest Intent to Apply', icon: '💡', c: x => (x._imp && x._imp.n >= 50) ? x._imp.pct : 0, p: x => (x._imp && x._imp.n >= 150) ? x._imp.pct : 0, fmt: v => Math.round(v) + '%' },
        ];
        const course = {}, provider = {}, categories = [];
        CATS.forEach(cat => {
            const pr = ranked(provList, cat.p), pt = pr.length;
            pr.slice(0, N).forEach((o, i) => { (provider[o.x.provider] = provider[o.x.provider] || []).push({ key: cat.key, label: cat.label, icon: cat.icon, rank: i + 1, total: pt, valueFmt: cat.fmt(o.v) }); });
            let cr = [], ct = 0;
            if (!cat.providerOnly) {
                cr = ranked(courseList, cat.c); ct = cr.length;
                cr.slice(0, N).forEach((o, i) => { (course[o.x.course] = course[o.x.course] || []).push({ key: cat.key, label: cat.label, icon: cat.icon, rank: i + 1, total: ct, valueFmt: cat.fmt(o.v) }); });
            }
            categories.push({ key: cat.key, label: cat.label, icon: cat.icon, providerOnly: !!cat.providerOnly,
                providerTop: pr.slice(0, N).map(o => ({ name: o.x.provider, valueFmt: cat.fmt(o.v) })),
                courseTop: cr.slice(0, N).map(o => ({ name: o.x.course, valueFmt: cat.fmt(o.v) })) });
        });
        // Country learner leadership reuses provCountry/countryTotal built above
        const providerCountries = {};
        Object.keys(countryTotal).forEach(c => {
            if (countryTotal[c] < this.COUNTRY_AWARD_MIN) return;
            const rp = Object.keys(provCountry).map(p => ({ p, n: provCountry[p][c] || 0 })).filter(o => o.n > 0).sort((a, b) => b.n - a.n);
            rp.slice(0, N).forEach((o, i) => { (providerCountries[o.p] = providerCountries[o.p] || []).push({ country: c, rank: i + 1, learners: o.n, total: rp.length }); });
        });
        Object.values(providerCountries).forEach(arr => arr.sort((a, b) => (a.rank - b.rank) || (b.learners - a.learners)));
        const result = { course, provider, categories, providerCountries, providerCount: provList.length };
        this._awardsCacheKey = key; this._awardsCache = result;
        return result;
    },
    // Unified awards section — provider and course awards live in one grid (echoing
    // the dark export): equal-size clickable cards, each with a medal, a PROVIDER /
    // COURSE tag, the award label and an optional course subtitle. Rows are equal
    // height so no card is taller than another, and the grid fills the full width.
    _awardCardsGrid(cards) {
        if (!cards || !cards.length) return '';
        const medal = r => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : '🏅';
        const n = cards.length;
        const cols = n <= 1 ? 1 : (n % 4 === 0 || n > 6) ? 4 : (n === 3 || n === 6) ? 3 : 2;
        const card = c => {
            const tagColor = c.tag === 'COURSE' ? 'text-gsf-boston' : 'text-gsf-tango';
            const tip = ((c.scope || '') + (c.valueFmt ? ' · ' + c.valueFmt : '')).trim();
            return '<button type="button" ' + (c.onclick ? 'onclick="' + c.onclick + '"' : '') + ' title="' + this.escapeHtml(tip) + '" class="text-left border border-slate-200 rounded-xl p-3.5 flex items-center gap-3 transition-all ' + (c.onclick ? 'hover:border-gsf-boston hover:shadow-md cursor-pointer' : 'cursor-default') + '" style="height:100%">'
                + '<span class="text-2xl leading-none shrink-0">' + medal(c.rank) + '</span>'
                + '<span class="min-w-0">'
                + '<span class="block text-[9px] font-bold uppercase tracking-wider ' + tagColor + '">' + c.tag + '</span>'
                + '<span class="block text-sm font-bold text-gsf-prussian leading-snug">' + this.escapeHtml(c.label) + '</span>'
                + (c.sub ? '<span class="block text-[11px] text-slate-400 truncate">' + this.escapeHtml(c.sub) + '</span>' : '')
                + '</span></button>';
        };
        return '<div class="bg-white rounded-xl shadow-sm border p-5 mb-6">'
            + '<p class="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-3">Awards &amp; Recognition &middot; as of ' + this._currentQuarterLabel() + '</p>'
            + '<div class="grid gap-3" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr));grid-auto-rows:1fr">' + cards.map(card).join('') + '</div>'
            + '</div>';
    },
    // Provider page: provider awards + the provider's award-winning courses, combined.
    _providerAwardsCombined(providerName, pSnap) {
        const provList = ((this.computeAwards().provider || {})[providerName] || []).slice().sort((a, b) => (a.rank || 9) - (b.rank || 9));
        const courseMap = this.computeAwards().course || {};
        const cards = [];
        provList.forEach(a => cards.push({ rank: a.rank, tag: 'PROVIDER', label: a.label, valueFmt: a.valueFmt, scope: 'Across all SURGhub providers' }));
        (pSnap || []).forEach(d => {
            const list = courseMap[d.Course];
            if (list && list.length) list.slice().sort((a, b) => (a.rank || 9) - (b.rank || 9)).forEach(a => cards.push({
                rank: a.rank, tag: 'COURSE', label: a.label, sub: d.Course, valueFmt: a.valueFmt,
                scope: 'Across all SURGhub courses', onclick: "App.openCourse('" + this.escapeHtml(d.Course).replace(/'/g, '&#39;') + "')"
            }));
        });
        return this._awardCardsGrid(cards);
    },
    // Course page: that course's awards as the same card grid.
    _courseAwardsGrid(courseName) {
        const list = ((this.computeAwards().course || {})[courseName] || []).slice().sort((a, b) => (a.rank || 9) - (b.rank || 9));
        return this._awardCardsGrid(list.map(a => ({ rank: a.rank, tag: 'COURSE', label: a.label, valueFmt: a.valueFmt, scope: 'Across all SURGhub courses' })));
    },
    // Popup explaining which canonical cadres / org-types make up a broad summary
    // card on the Learners tab. Data is registered into App._groupBreakdowns by the
    // Profession and Organisation renderers at render time, keyed by 'prof<i>'/'org<i>'.
    _showGroupInfo(key) {
        const info = (this._groupBreakdowns || {})[key];
        if (!info) return;
        let overlay = document.getElementById('group-info-overlay');
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.id = 'group-info-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,47,76,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';
        const rows = info.members.map(m => '<div style="display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid #f1f5f9"><span style="font-size:13px;color:#0f172a;font-weight:600">' + this.escapeHtml(m.name) + '</span><span style="font-size:13px;color:#334155;white-space:nowrap">' + m.countFmt + (m.pct != null ? ' <span style="color:#94a3b8">&middot; ' + m.pct.toFixed(1) + '%</span>' : '') + '</span></div>').join('');
        overlay.innerHTML = '<div style="background:#fff;border-radius:16px;padding:26px 28px;width:440px;max-width:92vw;max-height:82vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3)">'
            + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">'
            + '<div><p style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin:0 0 3px">Who\'s included</p>'
            + '<h2 style="font-size:20px;font-weight:800;color:#1a5276;margin:0">' + this.escapeHtml(info.title) + '</h2></div>'
            + '<button id="group-info-close" style="background:none;border:none;font-size:24px;line-height:1;color:#94a3b8;cursor:pointer;padding:0">&times;</button></div>'
            + (info.subtitle ? '<p style="font-size:12px;color:#64748b;margin:8px 0 16px">' + this.escapeHtml(info.subtitle) + '</p>' : '<div style="height:12px"></div>')
            + '<div>' + rows + '</div>'
            + (info.note ? '<p style="font-size:11px;color:#94a3b8;margin:16px 0 0;line-height:1.5">' + this.escapeHtml(info.note) + '</p>' : '')
            + '</div>';
        document.body.appendChild(overlay);
        overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
        const c = overlay.querySelector('#group-info-close'); if (c) c.onclick = () => overlay.remove();
    },

    _dashPerformanceHtml(snapData) {
        // Lazy-load the completion blob (~37MB) the first time this tab opens, then
        // re-render so the daily-certs panel + completion analyses fill. Kept out of
        // cold start entirely (this tab is rarely the landing view).
        if (App._rawCompletion == null && App.ensureCompletionLoaded && !App._completionLoadPromise) {
            App.ensureCompletionLoaded().then(() => { if (App.renderView) App.renderView(); });
        }
        return `
                    <p class="text-sm text-slate-500 mb-6">How providers and courses are performing — volumes, ratings, completion behaviour.</p>

                    ${this._surveyImpactBand(snapData)}

                    ${(() => {
                        const aw = this.computeAwards();
                        if (!aw.categories || !aw.categories.length) return '';
                        const medal = i => ['🥇', '🥈', '🥉'][i] || '';
                        const cell = (arr, kind) => !arr.length ? '<span class="text-slate-300">—</span>' : arr.map((e, i) =>
                            '<div class="' + (i ? 'mt-1.5 pt-1.5 border-t border-slate-100' : '') + '">' + medal(i) + ' <button onclick="App.open' + kind + '(\'' + this.escapeHtml(e.name).replace(/'/g, '&#39;') + '\')" class="text-gsf-boston hover:underline text-left">' + this.escapeHtml(e.name) + '</button> <span class="text-slate-400 whitespace-nowrap">' + e.valueFmt + '</span></div>').join('');
                        return `<div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-8">
                            <div class="bg-slate-50 border-b p-5"><h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="trophy" class="text-amber-500"></i> Awards &amp; Leaders</h2><p class="text-xs text-slate-500 mt-1">Top three courses and providers in each category across the platform (incl. private courses). See methodology for eligibility.</p></div>
                            <div class="overflow-x-auto"><table class="w-full text-left text-sm">
                                <thead class="text-slate-500 border-b"><tr><th class="py-3 px-4 font-medium align-top">Award</th><th class="py-3 px-4 font-medium align-top">Top courses</th><th class="py-3 px-4 font-medium align-top">Top providers</th></tr></thead>
                                <tbody>${aw.categories.map(r => '<tr class="border-b hover:bg-slate-50 align-top"><td class="py-2.5 px-4 font-bold text-gsf-prussian whitespace-nowrap">' + r.icon + ' ' + this.escapeHtml(r.label) + '</td><td class="py-2.5 px-4 text-xs">' + (r.providerOnly ? '<span class="text-slate-300">—</span>' : cell(r.courseTop, 'Course')) + '</td><td class="py-2.5 px-4 text-xs">' + cell(r.providerTop, 'Provider') + '</td></tr>').join('')}</tbody>
                            </table></div>
                        </div>`;
                    })()}

                    ${this._renderDailyCertsPanel()}

                    <div class="bg-white p-6 rounded-xl border mb-8">
                        <div class="flex items-center mb-4"><h4 class="font-bold text-xs uppercase text-gsf-prussian">Learners by Provider</h4>${this._chartBtns('chart_prov_learners', 'Enrollments_by_Provider')}</div>
                        <div id="chart_prov_learners" style="width: 100%; height: 450px;"></div>
                    </div>
                    <div class="bg-white p-6 rounded-xl border mb-8">
                        <div class="flex items-center mb-4"><h4 class="font-bold text-xs uppercase text-gsf-prussian">Certificates by Provider</h4>${this._chartBtns('chart_prov_certs', 'Certificates_by_Provider')}</div>
                        <div id="chart_prov_certs" style="width: 100%; height: 450px;"></div>
                    </div>
                    <div class="bg-white p-6 rounded-xl border mb-8">
                        <div class="flex items-center mb-4"><h4 class="font-bold text-xs uppercase text-gsf-prussian">Average Rating by Provider</h4>${this._chartBtns('chart_prov_rating', 'Avg_Rating_by_Provider')}</div>
                        <div id="chart_prov_rating" style="width: 100%; height: 450px;"></div>
                        <p class="text-[11px] text-slate-400 mt-2">Mean of each provider's rated courses (1–5). Top 15 shown.</p>
                    </div>
                    <div class="bg-white p-6 rounded-xl border mb-8">
                        <div class="flex items-center mb-4"><h4 class="font-bold text-xs uppercase text-gsf-prussian">Certification Rate by Provider</h4>${this._chartBtns('chart_prov_certrate', 'Certification_Rate_by_Provider')}</div>
                        <div id="chart_prov_certrate" style="width: 100%; height: 450px;"></div>
                        <p class="text-[11px] text-slate-400 mt-2">Certificates ÷ learners (%). Providers with ≥ 50 learners. Top 15 shown.</p>
                    </div>

                    ${this._renderEngagementAnalysis(false, 'performance')}

                    ${(() => {
                        // ── All Courses table (sortable analytics view) ──
                        if (!snapData || snapData.length === 0) return '';
                        const col = this._platCourseSortCol;
                        const asc = this._platCourseSortAsc;
                        const rows = snapData.slice().map(d => {
                            const learners = Number(d.Learners) || 0, certs = Number(d.Certificates) || 0;
                            return {
                                course: d.Course || '',
                                provider: d.Provider || '',
                                learners, certs,
                                rating: Number(d.Rating) || 0,
                                responses: Number(d.Responses) || 0,
                                completion: learners > 0 ? (certs / learners) * 100 : -1,
                            };
                        });
                        rows.sort((a, b) => {
                            let va, vb;
                            if (col === 'course' || col === 'provider') { va = a[col].toLowerCase(); vb = b[col].toLowerCase(); }
                            else { va = a[col]; vb = b[col]; }
                            if (va < vb) return asc ? -1 : 1;
                            if (va > vb) return asc ? 1 : -1;
                            return 0;
                        });
                        const arrow = (c) => this._platCourseSortCol === c
                            ? (this._platCourseSortAsc ? '&#9650;' : '&#9660;')
                            : '<span class="text-slate-300">&#8597;</span>';
                        const th = (key, label, align) =>
                            `<th class="py-3 px-3 font-medium ${align||''} cursor-pointer hover:text-gsf-boston select-none" onclick="App._sortPlatCourseDir('${key}')">${label} ${arrow(key)}</th>`;
                        // Course → LearnWorlds publication status (from the latest sync)
                        const accessByCourse = {};
                        (this.getPlatformSnap ? this.getPlatformSnap() : []).forEach(d => { if (d && d.Course && d.Access != null && !(d.Course in accessByCourse)) accessByCourse[d.Course] = d.Access; });
                        // Compute completion rate per row
                        return `
                            <div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-8 mt-8">
                                <div class="bg-slate-50 border-b p-5 flex justify-between items-center">
                                    <h2 class="font-bold text-lg text-gsf-prussian">All Courses (${rows.length})</h2>
                                    <span class="text-xs text-slate-500">Click a column header to sort. Click a course to open its detail page.</span>
                                </div>
                                <div class="overflow-x-auto max-h-[600px] overflow-y-auto custom-scrollbar">
                                    <table class="w-full text-left border-collapse text-sm">
                                        <thead class="sticky top-0 bg-white shadow-sm z-10"><tr class="border-b text-slate-500">
                                            ${th('course', 'Course')}
                                            ${th('provider', 'Provider')}
                                            ${th('learners', 'Learners', 'text-right')}
                                            ${th('certs', 'Certificates', 'text-right')}
                                            ${th('rating', 'Rating', 'text-right')}
                                            ${th('responses', 'Responses', 'text-right')}
                                            ${th('completion', 'Completion', 'text-right')}
                                        </tr></thead>
                                        <tbody>
                                            ${rows.map(r => {
                                                const completion = r.completion >= 0 ? r.completion : 0;
                                                const courseEsc = this.escapeHtml(r.course).replace(/'/g, '&#39;');
                                                const provEsc = this.escapeHtml(r.provider).replace(/'/g, '&#39;');
                                                return `<tr class="border-b hover:bg-slate-50">
                                                    <td class="py-2 px-3 font-bold text-xs"><button onclick="App.openCourse('${courseEsc}')" class="text-gsf-prussian hover:text-gsf-boston hover:underline text-left">${this.escapeHtml(r.course)}</button>${this._courseStatusBadge(accessByCourse[r.course])}</td>
                                                    <td class="py-2 px-3 text-xs"><button onclick="App.openProvider('${provEsc}')" class="text-slate-600 hover:text-gsf-boston hover:underline text-left">${this.escapeHtml(r.provider)}</button></td>
                                                    <td class="py-2 px-3 text-right text-xs font-medium">${this.formatNumber(r.learners)}</td>
                                                    <td class="py-2 px-3 text-right text-xs font-bold text-gsf-boston">${this.formatNumber(r.certs)}</td>
                                                    <td class="py-2 px-3 text-right text-xs font-medium ${r.rating >= 4 ? 'text-green-600' : r.rating > 0 ? 'text-gsf-crimson' : 'text-slate-300'}">${r.rating > 0 ? r.rating.toFixed(2) : '-'}</td>
                                                    <td class="py-2 px-3 text-right text-xs text-slate-500">${this.formatNumber(r.responses)}</td>
                                                    <td class="py-2 px-3 text-right text-xs text-slate-500">${this.formatCertRate(r.certs, r.learners)}</td>
                                                </tr>`;
                                            }).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        `;
                    })()}
        `;
    },
});
