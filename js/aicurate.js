// AI Testimonial Curation — scores written feedback with the Claude API so the
// app (and provider reports) can surface genuine impact stories instead of
// "thanks" / "nothing" noise.
//
// Pipeline: junk filter (deterministic, free) → Claude batch scoring
// (claude-haiku-4-5, structured JSON output, ~30 comments per request) →
// results cached by text hash in surghub_feedback_ai so re-runs only score
// new comments. Reports pick: manual selections > AI score > keyword heuristic.

(function () {
    const ANTHROPIC_MODEL = 'claude-haiku-4-5';
    const BATCH_SIZE = 30;

    // Strict schema for the batch response — guarantees parseable output.
    // (No min/max numeric constraints: not supported by structured outputs;
    // the prompt states the 0–10 range and we clamp client-side.)
    const SCORE_SCHEMA = {
        type: 'object',
        properties: {
            results: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        i: { type: 'integer', description: 'index of the comment in the input list' },
                        score: { type: 'integer', description: 'testimonial quality 0-10' },
                        quotable: { type: 'boolean', description: 'suitable as a stand-alone quote in a partner-facing report' },
                        themes: {
                            type: 'array',
                            items: { type: 'string', enum: ['applied-in-practice', 'patient-impact', 'career-growth', 'teaching-others', 'knowledge-gain', 'generic-praise', 'suggestion', 'complaint', 'other'] }
                        },
                        language: { type: 'string', description: 'ISO 639-1 code, e.g. en, fr, es, ar' },
                        quote: { type: 'string', description: 'cleaned pull-quote: typos fixed, filler trimmed, max ~50 words, meaning untouched; empty string if not quotable' }
                    },
                    required: ['i', 'score', 'quotable', 'themes', 'language', 'quote'],
                    additionalProperties: false
                }
            }
        },
        required: ['results'],
        additionalProperties: false
    };

    const SYSTEM_PROMPT = 'You curate learner feedback for SURGhub, the United Nations Global Surgery Learning Hub — free online surgical training, mostly for clinicians in low- and middle-income countries. You will receive a JSON array of feedback comments from end-of-course surveys. For EACH comment, return one result object.\n\nScore 0-10 for testimonial quality in a partner-facing report:\n- 9-10: specific, vivid impact story (changed clinical practice, helped patients, career milestone, teaching others)\n- 7-8: concrete and credible praise with some specificity (what they learned, how they will use it)\n- 4-6: genuine but generic praise ("excellent course, well structured")\n- 1-3: bare thanks, single words, vague\n- 0: junk, complaints, off-topic, gibberish, requests for certificates\n\nquotable: true only if the comment (possibly cleaned) could stand alone as a quote a partner would be proud to share. Complaints and suggestions are never quotable, but score suggestions with theme "suggestion" so they can be triaged.\n\nquote: produce a cleaned version whenever quotable=true AND ALSO whenever themes include \"suggestion\" or \"complaint\" (those appear in report sections even though quotable=false). ALWAYS fix: standalone \"i\" to \"I\", sentence-initial capitals, obvious misspellings (e.g. \"its prefect\" becomes \"It\'s perfect\"), doubled words/spaces, missing terminal punctuation. Trim filler and repetition. NEVER change wording, meaning, or language (do not translate). Max ~50 words, no quotation marks added. If the comment is garbled or its meaning unclear, set quotable=false and leave quote empty instead of guessing. Empty string otherwise.';

    Object.assign(window.App, {

        // Electron does not support window.prompt() — this is a minimal
        // promise-based replacement. data-viewer-allowed keeps the input
        // usable in viewer mode (the MutationObserver disables inputs).
        _textPrompt(title, message, initial) {
            return new Promise((resolve) => {
                const old = document.getElementById('app-text-prompt');
                if (old) old.remove();
                const wrap = document.createElement('div');
                wrap.id = 'app-text-prompt';
                wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,47,76,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;padding:24px';
                wrap.innerHTML = '<div style="background:#fff;border-radius:14px;padding:26px 28px;max-width:540px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.35)">'
                    + '<div style="font-size:16px;font-weight:800;color:#002F4C;margin-bottom:8px"></div>'
                    + '<div style="font-size:13px;color:#475569;line-height:1.55;white-space:pre-wrap;margin-bottom:14px"></div>'
                    + '<input data-viewer-allowed type="text" style="width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;font-size:13px;font-family:monospace;outline:none" />'
                    + '<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px">'
                    + '<button data-act="cancel" style="padding:8px 18px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#475569;font-weight:700;font-size:13px;cursor:pointer">Cancel</button>'
                    + '<button data-act="ok" style="padding:8px 18px;border-radius:8px;border:none;background:#002F4C;color:#fff;font-weight:700;font-size:13px;cursor:pointer">OK</button>'
                    + '</div></div>';
                wrap.children[0].children[0].textContent = title;
                wrap.children[0].children[1].textContent = message;
                const input = wrap.querySelector('input');
                input.value = initial || '';
                const close = (val) => { wrap.remove(); resolve(val); };
                wrap.querySelector('[data-act="ok"]').onclick = () => close(input.value);
                wrap.querySelector('[data-act="cancel"]').onclick = () => close(null);
                wrap.addEventListener('click', (e) => { if (e.target === wrap) close(null); });
                input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(input.value); if (e.key === 'Escape') close(null); });
                document.body.appendChild(wrap);
                setTimeout(() => input.focus(), 50);
            });
        },

        // Deterministic last-mile quote polish (applies even to cached quotes):
        // standalone i → I, first-letter capital, whitespace, terminal period.
        _polishQuote(text) {
            let t = String(text || '').trim().replace(/\s+/g, ' ');
            if (!t) return t;
            t = t.replace(/(^|[\s(\["'])i([\s,.!?;:')\]"']|$)/g, '$1I$2');
            t = t.replace(/(^|[.!?]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());
            if (!/[.!?…"')\]]$/.test(t)) t += '.';
            return t;
        },

        async _getAnthropicKey() {
            try { return (await Storage.getItem('anthropic_api_key')) || ''; } catch (e) { return ''; }
        },

        async setAnthropicKey() {
            const cur = await this._getAnthropicKey();
            const v = await this._textPrompt(
                'Anthropic API key',
                'For AI testimonial curation. Create one at console.anthropic.com → API keys. Stored locally only — never uploaded to Google Sheets or shared snapshots.\n\nScoring uses ' + ANTHROPIC_MODEL + ' (~$1 per million input tokens): the full backlog costs a few dollars once; re-runs only score new comments.\n\nClear the field and press OK to remove the key.',
                cur ? cur.slice(0, 14) + '…' : ''
            );
            if (v === null) return;
            const key = v.trim();
            if (!key) { await Storage.setItem('anthropic_api_key', ''); alert('Anthropic API key removed.'); this.renderView(); return; }
            if (key.includes('…')) return;   // unchanged masked value
            if (!/^sk-ant-/.test(key)) return alert('That does not look like an Anthropic API key (should start with sk-ant-).');
            await Storage.setItem('anthropic_api_key', key);
            alert('Anthropic API key saved ✓\n\nUse "Score with AI" on the Feedback tab to curate testimonials.');
            this.renderView();
        },

        // Deterministic junk filter — kills obvious noise before any ranking.
        _isJunkFeedback(text) {
            const t = String(text || '').trim();
            if (t.length < 25) return true;
            if (!/[a-zà-ÿ؀-ۿ一-鿿]/i.test(t)) return true;   // no letters at all
            const lower = t.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
            const GENERIC = ['thanks', 'thank you', 'thank you so much', 'thanks a lot', 'nothing', 'none', 'no', 'na', 'nil', 'good', 'very good', 'great', 'nice', 'excellent', 'ok', 'okay', 'all good', 'no comment', 'no comments', 'nothing to add', 'great course', 'good course', 'nice course', 'excellent course', 'very good course', 'merci', 'gracias', 'rien', 'nada', 'aucun', 'ninguno', 'bien', 'muy bien', 'tres bien'];
            if (GENERIC.includes(lower)) return true;
            // "thank you" padded with emphasis but nothing substantive
            if (lower.length < 45 && /^(thank|thanks|merci|gracias)/.test(lower) && !/\b(use|learn|apply|patient|practice|work|skill|knowledge)\w*/.test(lower)) return true;
            return false;
        },

        _aiScoreMap: null,   // in-memory cache of surghub_feedback_ai

        async _getAiScores() {
            if (this._aiScoreMap) return this._aiScoreMap;
            try { this._aiScoreMap = (await Storage.getItem('surghub_feedback_ai')) || {}; } catch (e) { this._aiScoreMap = {}; }
            return this._aiScoreMap;
        },

        // Generic structured-output Claude call with retry handling.
        // opts.model overrides the default (e.g. opus-4-8 for analytical Q&A vs
        // the cheap haiku used for bulk testimonial scoring).
        async _claudeJSON(apiKey, system, userContent, schema, maxTokens, opts) {
            opts = opts || {};
            const body = {
                model: opts.model || ANTHROPIC_MODEL,
                max_tokens: maxTokens || 4000,
                system,
                output_config: { format: { type: 'json_schema', schema } },
                messages: [{ role: 'user', content: userContent }]
            };
            let attempt = 0;
            while (true) {
                const res = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01',
                        'content-type': 'application/json',
                        'anthropic-dangerous-direct-browser-access': 'true'
                    },
                    body: JSON.stringify(body)
                });
                if (res.status === 429 || res.status === 529 || res.status >= 500) {
                    attempt++;
                    if (attempt > 4) throw new Error('Claude API kept failing (HTTP ' + res.status + ') — try again later.');
                    const retryAfter = Number(res.headers.get('retry-after')) || (2 * attempt);
                    await new Promise(r => setTimeout(r, retryAfter * 1000));
                    continue;
                }
                const json = await res.json();
                if (!res.ok) {
                    const msg = (json && json.error && json.error.message) || ('HTTP ' + res.status);
                    if (res.status === 401) throw new Error('Invalid Anthropic API key. Update it via "Set API key".');
                    throw new Error('Claude API error: ' + msg);
                }
                const textBlock = (json.content || []).find(b => b.type === 'text');
                let parsed;
                try { parsed = JSON.parse(textBlock ? textBlock.text : ''); } catch (e) { throw new Error('Claude returned unparseable output.'); }
                this._aiUsage.in += (json.usage && json.usage.input_tokens) || 0;
                this._aiUsage.out += (json.usage && json.usage.output_tokens) || 0;
                return parsed;
            }
        },

        // ── Ask-the-data: natural-language Q&A grounded in the VERIFIED aggregates ──
        // Builds a compact pack of source-of-truth figures (the same ones the
        // firewall checks), hands it to Claude, and requires answers to come ONLY
        // from those figures (cite-or-decline — no hallucinated numbers).
        // Monthly bucket + scale of one course's CourseTimeline (mirrors Charts.getScaledTimeline, isMonthly).
        _scaledMonthlyTL(ctStr) {
            const num = v => Number(v) || 0;
            let parsed; try { parsed = (ctStr && typeof ctStr === 'object') ? ctStr : JSON.parse(ctStr || '{}'); } catch (e) { return {}; }
            const tl = parsed.timeline || parsed;
            const sc = parsed.scale || { enrollScale: 1, certScale: 1 };
            const r = {};
            Object.keys(tl).forEach(date => {
                const k = String(date).substring(0, 7);
                if (!r[k]) r[k] = { e: 0, c: 0 };
                const v = tl[date];
                if (v && typeof v === 'object') { r[k].e += num(v.e) * (sc.enrollScale || 1); r[k].c += num(v.c) * (sc.certScale || 1); }
                else { r[k].e += num(v) * (sc.enrollScale || 1); }
            });
            Object.keys(r).forEach(k => { r[k].e = Math.round(r[k].e); r[k].c = Math.round(r[k].c); });
            return r;
        },

        // Compact time-series for the AI pack so it can answer growth/trend questions:
        //  • platformByMonth   — cumulative learners + certificates (from per-course CourseTimeline)
        //  • byCountryByMonth  — cumulative learners per top-25 country (from CountryTimeline)
        // Mirrors the dashboard charts: platform launch filter (< 2023-05) and the
        // current partial month excluded by default.
        _buildTimeSeries(plat, aud) {
            const num = v => Number(v) || 0;
            const parseStat = s => { if (s && typeof s === 'object') return s; try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } };
            const isPartial = m => (window.Charts && window.Charts._isPartialMonth) ? window.Charts._isPartialMonth(m) : false;

            // Platform cumulative learners + certificates from per-course CourseTimeline.
            const platTL = {};
            (plat || []).forEach(d => {
                if (!d.CourseTimeline) return;
                const s = this._scaledMonthlyTL(d.CourseTimeline);
                Object.keys(s).forEach(m => {
                    if (m < '2023-05') return;                 // platform launch (matches drawPlatform)
                    if (!platTL[m]) platTL[m] = { e: 0, c: 0 };
                    platTL[m].e += s[m].e; platTL[m].c += s[m].c;
                });
            });
            let pMonths = Object.keys(platTL).sort();
            if (pMonths.length && isPartial(pMonths[pMonths.length - 1])) pMonths = pMonths.slice(0, -1);
            let cl = 0, cc = 0;
            const platformByMonth = pMonths.map(m => { cl += platTL[m].e; cc += platTL[m].c; return [m, cl, cc]; });

            // Per-country cumulative learners from CountryTimeline (monthly increments), top 25.
            const CT = parseStat(aud.CountryTimeline);
            let cMonths = Object.keys(CT).filter(m => m >= '2023-05').sort();   // platform launch filter
            if (cMonths.length && isPartial(cMonths[cMonths.length - 1])) cMonths = cMonths.slice(0, -1);
            const totals = {};
            cMonths.forEach(m => Object.entries(CT[m] || {}).forEach(([c, n]) => { totals[c] = (totals[c] || 0) + num(n); }));
            const topCountries = Object.entries(totals)
                .filter(([c]) => c && c !== 'Unknown' && c !== 'nan')
                .sort((a, b) => b[1] - a[1]).slice(0, 25).map(([c]) => c);
            const byCountryByMonth = {};
            topCountries.forEach(c => { let run = 0; byCountryByMonth[c] = cMonths.map(m => { run += num((CT[m] || {})[c]); return [m, run]; }); });

            // Demographic breakdowns over time (monthly INCREMENTS → cumulative per
            // category), so the model can answer "growth in nurse learners", "growth by
            // career stage", etc. — the same dimensions as the dashboard's Growth-by-X
            // charts. Cadre is canonicalized (Nurse→Nursing, anaesthesia roles folded)
            // so it matches the Profession/Cadre table + Growth-by-Cadre chart.
            const buildCumByCat = (tlStr, canon) => {
                let tl = parseStat(tlStr);
                if (canon && window.Charts && window.Charts.canonActivityTimeline) tl = window.Charts.canonActivityTimeline(tl);
                let ms = Object.keys(tl).filter(m => m >= '2023-05').sort();
                if (ms.length && isPartial(ms[ms.length - 1])) ms = ms.slice(0, -1);
                const cats = {};
                ms.forEach(m => Object.keys(tl[m] || {}).forEach(c => { if (c && c !== 'Unknown' && c !== 'nan') cats[c] = true; }));
                const out = {};
                Object.keys(cats).forEach(c => { let run = 0; out[c] = ms.map(m => { run += num((tl[m] || {})[c]); return [m, run]; }); });
                return out;
            };
            const byCadreByMonth = buildCumByCat(aud.ActivityTimeline || aud.ProfTimeline, true);
            const byCareerStageByMonth = buildCumByCat(aud.CareerStageTimeline, false);
            const byTopicByMonth = buildCumByCat(aud.TopicTimeline, false);

            // Cumulative REGISTERED USERS (platform sign-ups) by month — from the monthly
            // signup counts. This is the REGISTERED-USER population (one row per account),
            // DISTINCT from platformByMonth which counts course LEARNERS/enrolments. Use
            // this (NOT platformByMonth) for "registered user growth" / "sign-up growth".
            const SU = parseStat(aud.Signups);
            let suMonths = Object.keys(SU).filter(m => /^\d{4}-\d{2}$/.test(m)).sort();
            if (suMonths.length && isPartial(suMonths[suMonths.length - 1])) suMonths = suMonths.slice(0, -1);
            let cu = 0;
            const registeredUsersByMonth = suMonths.map(m => { cu += num(SU[m]); return [m, cu]; });

            return {
                note: "Monthly CUMULATIVE totals (current partial month excluded, matching the dashboard charts). Rows are [month, cumulativeValue...]. TWO DISTINCT POPULATIONS: registeredUsersByMonth=[month,cumRegisteredUsers] is platform ACCOUNTS/sign-ups (use for 'registered user growth' / 'sign-up growth'); platformByMonth=[month,cumLearners,cumCertificates] is course ENROLMENTS/learners (one user can enrol in many courses, so cumLearners far exceeds registered users) — do NOT use platformByMonth for registered-user questions. byCountryByMonth[country]=[month,cumLearners] (top 25 countries); byCadreByMonth[cadre]=[month,cumLearners] (profession/cadre, e.g. Nursing/Surgeon/Medical Student); byCareerStageByMonth[stage] and byTopicByMonth[topic]=[month,cumLearners]. Months are YYYY-MM. Monthly growth = difference between consecutive cumulative values; 'recent growth' = change over the last 1-3 complete months. Cadre/career/topic timelines are the SAME survey-tag breakdowns as the dashboard Growth-by-X charts (a learner may pick several topics, so topic totals exceed the learner count).",
                registeredUsersByMonth,
                platformByMonth,
                byCountryByMonth,
                byCadreByMonth,
                byCareerStageByMonth,
                byTopicByMonth
            };
        },

        _buildAskDataPack() {
            const num = v => Number(v) || 0;
            const snap = (this.getAnalyticsSnap ? this.getAnalyticsSnap() : []);          // included courses, slug-deduped
            const plat = (this.getPlatformSnap ? this.getPlatformSnap() : snap);          // incl. course-level "Excluded"
            const courseMins = (this.getCourseLearningMinutes ? this.getCourseLearningMinutes() : {}); // anon fallback for un-enriched courses — matches dashboard
            const cMin = (d) => (this.courseLearningMinutes ? this.courseLearningMinutes(d, courseMins) : num(d.LearningMinutes)); // LearningMinutes ?? anon
            let L = 0, C = 0, M = 0; plat.forEach(d => { L += num(d.Learners); C += num(d.Certificates); M += cMin(d); });
            const providers = [...new Set(snap.map(d => d.Provider).filter(Boolean))]; // included-only — matches courseCount + the dashboard provider count
            const courses = snap.map(d => ({
                course: d.Course, provider: d.Provider || 'Unknown', status: d.Access || 'unknown',
                learners: num(d.Learners), certificates: num(d.Certificates),
                learningHours: Math.round(cMin(d) / 60),
                certRatePct: this.formatCertRate ? this.formatCertRate(d.Certificates, d.Learners, { asNumber: true }) : (num(d.Learners) > 0 ? Math.round(num(d.Certificates) / num(d.Learners) * 100) : null),
                rating: num(d.Rating) || null, surveyResponses: num(d.Responses)
            })).sort((a, b) => b.learners - a.learners);
            // Latest demographics snapshot (by Timestamp — history is newest-first, so max-by-date).
            const hist = (this.userHistory || []).filter(h => h && h.Timestamp);
            const aud = hist.length ? hist.reduce((a, b) => String(b.Timestamp || '') > String(a.Timestamp || '') ? b : a) : {};
            // Snapshot stat fields are stored as JSON STRINGS (like CourseTimeline) — parse them.
            const parseStat = s => { if (s && typeof s === 'object') return s; try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } };
            const byCountry = parseStat(aud.AllCountryStats);
            // Income-group rollup of learners-by-country (for LMIC questions).
            const IC = window.IncomeClassification; const income = { LIC: 0, LMIC: 0, UMIC: 0, HIC: 0, Unknown: 0 };
            Object.entries(byCountry).forEach(([ctry, cnt]) => { const t = (IC && IC.classify) ? IC.classify(ctry) : 'Unknown'; if (income[t] != null) income[t] += num(cnt); else income.Unknown += num(cnt); });
            // Gender / organisation-type distributions (from the anonymized user records).
            const gender = {}, org = {}; (this._rawAnonymizedUsers || []).forEach(u => { if (u && u.gender) gender[u.gender] = (gender[u.gender] || 0) + 1; if (u && u.organisation_type) org[u.organisation_type] = (org[u.organisation_type] || 0) + 1; });
            const amb = this.ambassadorData || {};
            const topN = (obj, n) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k, count: v }));
            // Per-ambassador REFERRALS: complete bridge reach when built (the source the
            // dashboard table + the "Attributable Referrals" card use), else synced promoter
            // leads. '@'-form names withheld — never send learner/ambassador emails to the API.
            const _br = this._referrerBridge;
            const _referralSrc = (_br && Array.isArray(_br.byName) && _br.byName.length)
                ? Object.fromEntries(_br.byName.filter(x => x.name && x.name !== '(unnamed referrer)' && x.name.indexOf('@') < 0).map(x => [x.name, Number(x.reach) || 0]))
                : Object.fromEntries(Object.entries(amb.Promoters || {}).filter(([k]) => String(k).indexOf('@') < 0));
            return {
                asOf: aud.Timestamp || null,
                platform: { totalLearners: L, totalCertificates: C, certRatePct: (this.formatCertRate ? this.formatCertRate(C, L, { asNumber: true }) : (L > 0 ? Math.round(C / L * 100) : 0)), learningHours: Math.round(M / 60), learningYears: +(M / 525960).toFixed(1), courseCount: snap.length, providerCount: providers.length,
                    note: 'totalLearners/totalCertificates/learningHours sum ALL active courses (incl. course-level-excluded/private ones); courseCount, providerCount and the courses[] list are included-only — so per-course figures will not sum exactly to these platform totals.' },
                demographics: {
                    registeredUsers: num(aud.TotalUsers), countriesReached: num(aud.KnownCountry), usersWithKnownCountry: num(aud.CountryKnownCount), professionKnown: num(aud.ProfKnownCount), surveyed: num(aud.SurveyedCount),
                    byCountry: byCountry, byIncomeGroup: income, byProfession: parseStat(aud.ProfStats),
                    byCareerStage: parseStat(aud.CareerStageStats), byActivity: parseStat(aud.ActivityStats), byTopic: parseStat(aud.TopicStats),
                    byGender: gender, byOrganisationType: org, signupsByMonth: parseStat(aud.Signups)
                },
                ambassadors: { activeAmbassadors: num(amb.TotalAmbassadors), totalReferrals: num(amb.TotalReferrals), totalClicks: num(amb.TotalClicks), topReferrers: topN(_referralSrc, 10),
                    // Downstream LEARNER OUTCOMES per ambassador (the learners they referred,
                    // and those learners' courses/certs) — present only once the referrer
                    // bridge has been built from raw. Lets us answer "which ambassador drove
                    // the most certificates / courses", not just lead counts.
                    ...((this._referrerBridge && this._referrerBridge.hasOutcomes) ? (() => {
                        const br = this._referrerBridge;
                        return { referredLearnerOutcomes: {
                            totalReferredLearners: num(br.totalBridged), totalCourses: num(br.totalCourses), totalCertificates: num(br.totalCerts), activeReferredLearners: num(br.activeLearners),
                            note: 'Per ambassador: learners THEY referred and those learners course-enrolments/certs (impact, as of the last User-Progress upload). referredLearners may exceed leads if a referral signed up earlier. Totals span ALL referrers (named + unnamed); topByCertificates lists only named ambassadors.',
                            topByCertificates: (br.byName || []).slice().filter(x => x.name && x.name.indexOf('@') < 0).sort((a, b) => (b.certs || 0) - (a.certs || 0)).slice(0, 10)
                                .map(x => ({ ambassador: x.name, referredLearners: num(x.reach), courses: num(x.courses), certificates: num(x.certs) }))
                        } };
                    })() : {})
                },
                courses,
                timeSeries: this._buildTimeSeries(plat, aud)
            };
        },

        async askData(question) {
            const apiKey = await this._getAnthropicKey();
            if (!apiKey) { this.setAnthropicKey(); return null; }
            if (this.ensureAnonLoaded) await this.ensureAnonLoaded();   // gender/org come from the lazy anon blob
            const pack = this._buildAskDataPack();
            const system = "You are a precise data analyst for the Global Surgery Foundation (GSF) SURGhub learning platform. Answer the user's question using ONLY the figures in the DATA payload — these are GSF's verified source-of-truth aggregates. RULES: (1) NEVER invent, estimate, or extrapolate a number that isn't directly in or summable from DATA. (2) If DATA cannot answer it — e.g. the question needs a per-learner cross-tab that isn't in these aggregates (such as 'nurses who completed a SPECIFIC course', which would need profession×course×completion at the individual level) — say so plainly in `answer` and state exactly what data would be needed. Do NOT guess. (3) List every figure you used in `figures`. (4) Set `chart` to a bar/line spec when a comparison or trend makes the answer clearer (labels & values must come from DATA); otherwise chart.type='none'. (5) Keep `answer` concise, in short markdown. DEFINITIONS: 'LMIC reach' / 'LMICs' = learners in low- and lower-middle-income countries = byIncomeGroup.LIC + byIncomeGroup.LMIC. Course `status`: free=Published, private=Private (unlisted), draft=Draft/unpublished. certRatePct = certificates ÷ learners. REGISTERED USERS vs LEARNERS (critical — different populations): 'registered users' / 'users' / 'sign-ups' = platform ACCOUNTS (demographics.registeredUsers total; timeSeries.registeredUsersByMonth cumulative; demographics.signupsByMonth monthly-new) — DISTINCT from 'learners' / 'enrolments' (platform.totalLearners; timeSeries.platformByMonth), because one user enrols in many courses so learners ≫ registered users. Ambassador REFERRALS are registered users who signed up via an ambassador, so 'ambassador share of registered-user growth' = ambassadors.totalReferrals ÷ registered-user growth (from registeredUsersByMonth) — NEVER ÷ learner/platformByMonth growth. TRENDS/GROWTH: use `timeSeries`. All its rows are CUMULATIVE [month, value...]: registeredUsersByMonth=[month,cumRegisteredUsers] (use this for user/sign-up growth); platformByMonth=[month,cumLearners,cumCertificates] (course ENROLMENTS, NOT users); byCountryByMonth[country], byCadreByMonth[cadre] (profession/cadre — e.g. Nursing, Surgeon, Medical Student), byCareerStageByMonth[stage], byTopicByMonth[topic] are each [month,cumLearners]. Growth in any month = that month's value minus the previous month's; 'recent growth' = change over the last 1-3 complete months; the current partial month is already excluded. So 'growth in nurse learners' = byCadreByMonth.Nursing (consecutive differences); 'which country grew most recently' = compare last-period increments across byCountryByMonth. Do NOT use the cumulative byCountry/byProfession point-in-time totals for growth — use these time series. AMBASSADOR IMPACT: ambassadors.topReferrers ranks ambassadors by REFERRALS (distinct learners they referred — complete attribution when built, else synced lead counts). For downstream learner OUTCOMES per ambassador (which ambassador's referred learners earned the most certificates / took the most courses) use ambassadors.referredLearnerOutcomes.topByCertificates — if that field is ABSENT, the per-ambassador outcome breakdown hasn't been built yet (tell the user to click 'Complete from raw' on the Ambassadors tab); do not guess it from lead counts.";
            const userContent = "QUESTION:\n" + question + "\n\nDATA (verified aggregates" + (pack.asOf ? ", as of " + pack.asOf : "") + "):\n" + JSON.stringify(pack);
            const SCHEMA = {
                type: 'object', additionalProperties: false,
                required: ['answer', 'figures', 'chart', 'caveat'],
                properties: {
                    answer: { type: 'string', description: 'Concise markdown answer grounded only in DATA.' },
                    figures: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'value'], properties: { label: { type: 'string' }, value: { type: 'string' } } } },
                    chart: {
                        type: 'object', additionalProperties: false, required: ['type', 'title', 'labels', 'values'],
                        properties: { type: { type: 'string', enum: ['bar', 'line', 'none'] }, title: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } }, values: { type: 'array', items: { type: 'number' } } }
                    },
                    caveat: { type: 'string', description: 'Any limitation/assumption, or empty string.' }
                }
            };
            return await this._claudeJSON(apiKey, system, userContent, SCHEMA, 4000, { model: 'claude-opus-4-8' });
        },

        async askDataSubmit() {
            if (this._askDataBusy) return;
            const input = document.getElementById('ask-data-input');
            const out = document.getElementById('ask-data-result');
            const q = input ? String(input.value || '').trim() : '';
            if (!q) return;
            this._askDataBusy = true;
            if (out) out.innerHTML = '<div class="flex items-center gap-2 text-sm text-slate-500 py-2"><span style="width:14px;height:14px;border:2px solid #4389C8;border-top-color:transparent;border-radius:50%;display:inline-block;animation:spin 0.8s linear infinite"></span> Analysing the verified data…</div>';
            try {
                const r = await this.askData(q);
                if (out) out.innerHTML = r ? this._askDataCardHtml(q, r) : '';
                if (window.lucide) lucide.createIcons();
            } catch (e) {
                if (out) out.innerHTML = '<div class="text-sm text-red-600 py-2">⚠ ' + this.escapeHtml(e && e.message ? e.message : 'Query failed') + '</div>';
            } finally { this._askDataBusy = false; }
        },

        _askDataCardHtml(q, r) {
            const esc = s => this.escapeHtml(String(s == null ? '' : s));
            // minimal markdown: **bold**, line breaks
            const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
            const figs = (r.figures || []).filter(f => f && f.label);
            const figHtml = figs.length ? '<div class="flex flex-wrap gap-2 mt-3">' + figs.map(f => '<span class="inline-flex items-baseline gap-1 bg-slate-50 border rounded-lg px-2.5 py-1 text-xs"><span class="text-slate-500">' + esc(f.label) + ':</span> <span class="font-bold text-gsf-prussian" style="font-family:var(--num)">' + esc(f.value) + '</span></span>').join('') + '</div>' : '';
            let chartHtml = '';
            const ch = r.chart;
            if (ch && ch.type && ch.type !== 'none' && Array.isArray(ch.values) && ch.values.length && Array.isArray(ch.labels)) {
                const max = Math.max.apply(null, ch.values.map(v => Number(v) || 0).concat([1]));
                const rows = ch.labels.map((lab, i) => {
                    const v = Number(ch.values[i]) || 0; const pct = Math.max(2, Math.round(v / max * 100));
                    return '<div class="flex items-center gap-2 text-xs"><span class="w-40 shrink-0 truncate text-slate-600" title="' + esc(lab) + '">' + esc(lab) + '</span><span class="flex-1 bg-slate-100 rounded h-4 relative"><span style="width:' + pct + '%;background:#4389C8" class="absolute inset-y-0 left-0 rounded"></span></span><span class="w-16 text-right font-medium text-gsf-prussian" style="font-family:var(--num)">' + (Number(v).toLocaleString()) + '</span></div>';
                }).join('');
                chartHtml = '<div class="mt-4 border-t pt-3">' + (ch.title ? '<p class="text-xs font-bold text-slate-500 mb-2">' + esc(ch.title) + '</p>' : '') + '<div class="space-y-1.5">' + rows + '</div></div>';
            }
            const caveat = (r.caveat && String(r.caveat).trim()) ? '<p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">⚠ ' + esc(r.caveat) + '</p>' : '';
            return '<div class="bg-white border rounded-xl shadow-sm p-5">'
                + '<div class="flex items-start justify-between gap-2 mb-2">'
                +   '<p class="text-xs text-slate-400 flex-1 min-w-0">You asked: <span class="text-slate-600">' + esc(q) + '</span></p>'
                +   '<div class="flex items-center gap-1 shrink-0">'
                +     '<button id="ask-data-toggle" onclick="App.askDataToggle()" title="Collapse / expand" class="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"><i data-lucide="chevron-up" width="15"></i></button>'
                +     '<button onclick="App.askDataClear()" title="Clear result" class="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"><i data-lucide="x" width="15"></i></button>'
                +   '</div>'
                + '</div>'
                + '<div id="ask-data-body">'
                +   '<div class="text-sm text-slate-700 leading-relaxed">' + md(r.answer || '') + '</div>'
                +   figHtml + chartHtml + caveat
                +   '<p class="text-[10px] text-slate-400 mt-3">AI-generated from your verified SURGhub aggregates. Check the figures above against the dashboard before quoting externally.</p>'
                + '</div>'
                + '</div>';
        },

        askDataClear() {
            const out = document.getElementById('ask-data-result');
            if (out) out.innerHTML = '';
            const input = document.getElementById('ask-data-input');
            if (input) input.focus();
        },

        askDataToggle() {
            const body = document.getElementById('ask-data-body');
            const btn = document.getElementById('ask-data-toggle');
            if (!body) return;
            const hidden = body.style.display === 'none';
            body.style.display = hidden ? '' : 'none';
            if (btn) {
                btn.innerHTML = '<i data-lucide="' + (hidden ? 'chevron-up' : 'chevron-down') + '" width="15"></i>';
                if (window.lucide) lucide.createIcons();
            }
        },

        async _claudeScoreBatch(apiKey, comments) {
            const parsed = await this._claudeJSON(apiKey, SYSTEM_PROMPT, JSON.stringify(comments.map((t, i) => ({ i, text: t }))), SCORE_SCHEMA, 8000);
            return Array.isArray(parsed.results) ? parsed.results : [];
        },

        _aiUsage: { in: 0, out: 0 },
        _aiCancelled: false,
        // ── Platform story: concise number-anchored narrative for the dashboard ──
        async generatePlatformStory() {
            const apiKey = await this._getAnthropicKey();
            if (!apiKey) return this.setAnthropicKey();
            const snap = this.getAnalyticsSnap();
            if (!snap.length) return alert('No platform data yet — run Sync Courses first.');
            if (this.ensureAnonLoaded) await this.ensureAnonLoaded();   // LMIC mission share reads the lazy anon blob
            const aud = (this.userHistory || []).find(d => d.Timestamp === this.selectedDate) || (this.userHistory || []).slice().reduce((a, b) => (a && String(a.Timestamp) > String(b.Timestamp) ? a : b), null) || {};
            // Platform TOTALS sum across ALL active courses (incl. course-level-excluded/private),
            // matching the dashboard platform card + the Ask-data pack. Counts/listings (providers,
            // top courses, courseCount) stay included-only via `snap`.
            const plat = this.getPlatformSnap ? this.getPlatformSnap() : snap;
            const storyMins = this.getCourseLearningMinutes ? this.getCourseLearningMinutes() : {}; // anon fallback — matches the dashboard card
            let lrn = 0, cert = 0, resp = 0, rSum = 0, rCnt = 0, min = 0;
            plat.forEach(d => {
                lrn += Number(d.Learners) || 0; cert += Number(d.Certificates) || 0;
                resp += Number(d.Responses) || 0; min += (this.courseLearningMinutes ? this.courseLearningMinutes(d, storyMins) : (Number(d.LearningMinutes) || 0));
                const r = Number(d.Rating) || 0; if (r > 0) { rSum += r; rCnt++; }
            });
            const providers = [...new Set(snap.map(d => d.Provider).filter(Boolean))];
            const top = snap.slice().sort((a, b) => (Number(b.Learners) || 0) - (Number(a.Learners) || 0)).slice(0, 3)
                .map(d => d.Course + ' (' + this.formatNumber(d.Learners) + ' enrolments)');
            const impact = (typeof this._surveyImpactStats === 'function') ? this._surveyImpactStats(snap) : null;
            let missionShare = null;
            try {
                const eng = this._computeEngagement && this._computeEngagement();
                if (eng && eng.byIncome) {
                    const tot = Object.values(eng.byIncome).reduce((s, v) => s + (v.enrolls || 0), 0);
                    const m = (((eng.byIncome.LIC || {}).enrolls) || 0) + (((eng.byIncome.LMIC || {}).enrolls) || 0);
                    if (tot > 0) missionShare = +((m / tot) * 100).toFixed(0);
                }
            } catch (e) {}
            const facts = {
                totalRegisteredUsers: aud.TotalUsers || 0,
                countriesReached: aud.KnownCountry || 0,
                contentProviders: providers.length,
                courses: snap.length,
                enrolments: lrn,
                certificatesAwarded: cert,
                certificationRatePct: lrn > 0 ? +((cert / lrn) * 100).toFixed(1) : 0,
                totalLearningYears: min > 0 ? +(min / 525960).toFixed(1) : 0,
                avgCourseRating: rCnt > 0 ? +(rSum / rCnt).toFixed(2) : 0,
                surveyResponses: resp,
                topCoursesByEnrolment: top,
                lowAndLowerMiddleIncomeEnrolmentSharePct: missionShare,
                saidContentWasNewPct: (impact && impact.contentNew) ? impact.contentNew.pct : null,
                intendToApplyAtWorkPct: (impact && impact.willApply) ? impact.willApply.pct : null
            };
            const SCHEMA = { type: 'object', properties: { headline: { type: 'string' }, story: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } } }, required: ['headline', 'story', 'bullets'], additionalProperties: false };
            this._showReportProgress('Writing the SURGhub story…', true);
            try {
                const parsed = await this._claudeJSON(apiKey,
                    'You write for the Global Surgery Foundation team about SURGhub, the United Nations Global Surgery Learning Hub — free online surgical training with a focus on clinicians in low- and middle-income countries. Using ONLY the verified platform metrics provided (never invent numbers), tell the story of the platform and make the case for why it is powerful. headline: one punchy line, max 12 words. story: 2 short paragraphs, ~120 words total — concise, specific, credible; weave the numbers in naturally; no hype words (revolutionary, game-changing, unparalleled). bullets: 3-4 crisp takeaways, each max 15 words and anchored on a number. British English.',
                    JSON.stringify(facts), SCHEMA, 1500);
                const story = {
                    h: String(parsed.headline || '').trim(),
                    s: String(parsed.story || '').trim(),
                    b: (parsed.bullets || []).slice(0, 4).map(x => String(x).trim()),
                    at: new Date().toISOString().slice(0, 10)
                };
                await Storage.setItem('surghub_ai_story', story);
                this._aiStory = story;
                this._hideReportProgress();
                this.renderView();
            } catch (e) {
                this._hideReportProgress();
                alert('Story generation failed: ' + e.message);
            }
        },

        cancelAiScoring() { this._aiCancelled = true; },

        // Main entry: score every unscored, non-junk feedback comment.
        async scoreFeedbackWithAI() {
            const apiKey = await this._getAnthropicKey();
            if (!apiKey) return this.setAnthropicKey();

            // Collect unique comments across every course's FeedbackBank
            const texts = new Set();
            (this.data || []).forEach(c => {
                if (c.IsShell || !c.FeedbackBank) return;
                try {
                    (JSON.parse(c.FeedbackBank) || []).forEach(f => {
                        if (f && f.t && String(f.t).trim().length > 0) texts.add(String(f.t).trim());
                    });
                } catch (e) {}
            });

            const scores = await this._getAiScores();
            const junk = [];
            const todo = [];
            texts.forEach(t => {
                const h = this._djb2Hash(t);
                if (scores[h]) return;                       // already scored
                if (this._isJunkFeedback(t)) { junk.push(h); return; }
                todo.push({ h, t });
            });
            // Junk gets a synthetic zero score so it is never re-sent
            junk.forEach(h => { scores[h] = { s: 0, q: false, t: ['junk'], l: '', c: '' }; });

            if (!todo.length) {
                await Storage.setItem('surghub_feedback_ai', scores);
                if (!confirm('All ' + texts.size.toLocaleString() + ' comments are already scored.\n\nRe-score EVERYTHING with the current rules (improved quote cleaning, unclear-comment skipping, theme tags)?\n\nThis re-sends all non-junk comments — roughly the same cost as the first run.')) {
                    this.renderView();
                    return;
                }
                // full re-score: drop every cached non-junk entry and rebuild the worklist
                texts.forEach(t => {
                    const h = this._djb2Hash(t);
                    if (this._isJunkFeedback(t)) { scores[h] = { s: 0, q: false, t: ['junk'], l: '', c: '' }; return; }
                    delete scores[h];
                    todo.push({ h, t });
                });
            }

            if (!confirm('Score ' + todo.length.toLocaleString() + ' new comments with Claude (' + ANTHROPIC_MODEL + ')?\n\n' +
                Math.ceil(todo.length / BATCH_SIZE) + ' API calls · rough cost well under $' + Math.max(1, Math.ceil(todo.length / 1500)) + '.\n' +
                (junk.length ? junk.length.toLocaleString() + ' junk comments filtered for free.\n' : '') +
                '\nAlready-scored comments are skipped automatically.')) return;

            this._aiCancelled = false;
            this._aiUsage = { in: 0, out: 0 };
            this._showReportProgress('Scoring feedback with Claude…', true);
            // reuse the report progress overlay; its Cancel calls cancelReportGeneration —
            // mirror the flag so either cancel stops us
            this._reportCancelled = false;

            let done = 0, failedBatches = 0;
            try {
                for (let i = 0; i < todo.length; i += BATCH_SIZE) {
                    if (this._aiCancelled || this._reportCancelled) break;
                    const batch = todo.slice(i, i + BATCH_SIZE);
                    this._showReportProgress('Scoring feedback with Claude… ' + done + ' / ' + todo.length + ' comments', true);
                    try {
                        const results = await this._claudeScoreBatch(apiKey, batch.map(b => b.t));
                        results.forEach(r => {
                            const item = batch[r.i];
                            if (!item) return;
                            const s = Math.max(0, Math.min(10, Number(r.score) || 0));
                            scores[item.h] = { s, q: !!r.quotable && s > 0, t: Array.isArray(r.themes) ? r.themes.slice(0, 4) : [], l: String(r.language || ''), c: r.quotable ? String(r.quote || '').trim() : '' };
                        });
                        done += batch.length;
                        // persist incrementally so a crash/cancel keeps progress
                        await Storage.setItem('surghub_feedback_ai', scores);
                    } catch (e) {
                        console.error('[AICurate] batch failed:', e.message);
                        failedBatches++;
                        if (/Invalid Anthropic API key/.test(e.message)) throw e;
                        if (failedBatches >= 3) throw new Error('Three batches failed in a row — stopping. Last error: ' + e.message);
                    }
                }
                await Storage.setItem('surghub_feedback_ai', scores);
                this._aiScoreMap = scores;
                this._hideReportProgress();
                this.renderView();
                const cost = (this._aiUsage.in * 1 + this._aiUsage.out * 5) / 1e6;
                alert('AI scoring complete ✓\n\n' +
                    done.toLocaleString() + ' comments scored' + (junk.length ? ' · ' + junk.length.toLocaleString() + ' junk-filtered free' : '') + (failedBatches ? ' · ' + failedBatches + ' batches failed (re-run to retry)' : '') + '\n' +
                    'Tokens: ' + this._aiUsage.in.toLocaleString() + ' in / ' + this._aiUsage.out.toLocaleString() + ' out ≈ $' + cost.toFixed(2) + '\n\n' +
                    'Sort the Feedback tab by "AI Score" to review; high-scoring quotable comments now feed provider reports automatically (your manual selections always win).');
            } catch (e) {
                await Storage.setItem('surghub_feedback_ai', scores);
                this._aiScoreMap = scores;
                this._hideReportProgress();
                this.renderView();
                alert('AI scoring stopped: ' + e.message + '\n\nProgress was saved — run again to continue.');
            }
        },

        // Collect per-course feedback entries for a provider (latest rows).
        _feedbackByCourse(providerName) {
            const out = {};
            const latest = {};
            (this.data || []).forEach(d => {
                if (d.IsShell || !d.Course) return;
                const p = latest[d.Course];
                if (!p || (d.Timestamp || '') > (p.Timestamp || '')) latest[d.Course] = d;
            });
            Object.values(latest).forEach(d => {
                if (providerName && d.Provider !== providerName) return;
                if (!d.FeedbackBank) return;
                try {
                    const list = (JSON.parse(d.FeedbackBank) || []).filter(f => f && f.t && String(f.t).trim().length > 0);
                    if (list.length) out[d.Course] = { provider: d.Provider, items: list };
                } catch (e) {}
            });
            return out;
        },

        // ── Auto-select: top X quotable comments per course with AI score >= Y.
        // Writes into the same surghub_selected_testimonials map the manual
        // checkboxes use, so selections stay reviewable and hand-tunable.
        async autoSelectTestimonials(providerName) {
            const scores = await this._getAiScores();
            if (!Object.keys(scores).length) return alert('Run "Score with AI" first — auto-select uses the AI scores.');
            const xRaw = await this._textPrompt('Auto-select testimonials', 'Maximum number of testimonials to select per course:', '3');
            if (xRaw === null) return;
            const yRaw = await this._textPrompt('Auto-select testimonials', 'Minimum AI score (0–10) a comment needs to be selected:', '7');
            if (yRaw === null) return;
            const maxX = Math.max(1, Math.min(20, parseInt(xRaw, 10) || 3));
            const minY = Math.max(0, Math.min(10, parseInt(yRaw, 10) || 7));
            // Remember the bar — report Suggestions/Improvement sections use the same one
            try { await Storage.setItem('surghub_ai_prefs', { maxPerCourse: maxX, minScore: minY }); } catch (e) {}
            const byCourse = this._feedbackByCourse(providerName || null);
            const sel = (await Storage.getItem('surghub_selected_testimonials')) || {};
            let courses = 0, picked = 0;
            const touchedProviders = new Set();
            Object.entries(byCourse).forEach(([course, info]) => {
                const ranked = info.items
                    .map(f => ({ f, a: scores[this._djb2Hash(String(f.t).trim())] }))
                    .filter(x => x.a && x.a.q && x.a.s >= minY)
                    .sort((p, q) => q.a.s - p.a.s)
                    .slice(0, maxX);
                if (!sel[info.provider]) sel[info.provider] = {};
                sel[info.provider][course] = ranked.map(x => x.f.t);
                touchedProviders.add(info.provider);
                if (ranked.length) { courses++; picked += ranked.length; }
            });
            await Storage.setItem('surghub_selected_testimonials', sel);
            this.renderView();
            alert('Auto-select complete ✓\n\n' + picked + ' testimonials selected across ' + courses + ' courses (max ' + maxX + ' per course, score ≥ ' + minY + ')' +
                (providerName ? ' for ' + providerName : ' across ' + touchedProviders.size + ' providers') + '.\n\n' +
                'Selections replaced any previous picks for these courses — review them with the checkboxes ("Selected only" filter) and adjust freely. Reports use these per course, and pick the best 6 across courses at provider level.');
        },

        // ── Summaries: one short "what learners are saying" paragraph per
        // course (cached; only re-summarized when its feedback changes) and a
        // provider-level synthesis built from the course summaries.
        async summarizeFeedbackWithAI(providerName) {
            const apiKey = await this._getAnthropicKey();
            if (!apiKey) return this.setAnthropicKey();
            const scores = await this._getAiScores();
            const byCourse = this._feedbackByCourse(providerName || null);
            const cache = (await Storage.getItem('surghub_feedback_summaries')) || {};
            const SUM_SCHEMA = { type: 'object', properties: { summary: { type: 'string' }, themes: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'themes'], additionalProperties: false };
            const courseTodo = [];
            Object.entries(byCourse).forEach(([course, info]) => {
                const usable = info.items.filter(f => { const a = scores[this._djb2Hash(String(f.t).trim())]; return !a || a.s > 0; });
                if (usable.length < 5) return;
                // 'v2' prompt-version prefix: bumping it invalidates cached summaries when the wording rules change
                const sig = 'v3:' + usable.length + ':' + this._djb2Hash(usable.map(f => f.t).join('|').slice(0, 4000));
                if (cache[course] && cache[course].sig === sig) return;
                courseTodo.push({ course, provider: info.provider, usable, sig });
            });
            const provs = providerName ? [providerName] : [...new Set(Object.values(byCourse).map(i => i.provider))];
            if (!courseTodo.length && provs.every(p => cache['@provider:' + p])) {
                return alert('Summaries are up to date ✓\n\nNothing changed since the last run.');
            }
            if (!confirm('Summarize learner feedback with Claude?\n\n' + courseTodo.length + ' courses to (re)summarize' + (providerName ? ' for ' + providerName : '') + ' + provider rollups.\nRough cost: well under $1.')) return;
            this._aiUsage = { in: 0, out: 0 };
            this._showReportProgress('Summarizing feedback with Claude…', true);
            this._reportCancelled = false; this._aiCancelled = false;
            try {
                let done = 0;
                for (const job of courseTodo) {
                    if (this._reportCancelled || this._aiCancelled) break;
                    this._showReportProgress('Summarizing: ' + job.course.slice(0, 40) + '… (' + (++done) + '/' + courseTodo.length + ')', true);
                    // best + most recent comments, capped to keep tokens low
                    const sample = job.usable
                        .map(f => ({ f, a: scores[this._djb2Hash(String(f.t).trim())] }))
                        .sort((p, q) => ((q.a && q.a.s) || 3) - ((p.a && p.a.s) || 3))
                        .slice(0, 80)
                        .map(x => x.f.t.slice(0, 300));
                    const parsed = await this._claudeJSON(apiKey,
                        'You summarize end-of-course survey feedback for a course hosted on SURGhub (UN Global Surgery Learning Hub). The course is PUBLISHED BY the named content provider — attribute it to the provider or just say \'the course\'; NEVER say \'SURGhub\'s course\' (SURGhub is the hosting platform, not the author). Write 2-3 sentences, third person ("Learners say..."), specific and honest: what learners value, how they use it, plus any recurring requests framed constructively (e.g. \'Learners would welcome...\') — never use \'However\', \'but\' or other negative pivots; requests are opportunities, not complaints. No marketing fluff. Keep the language English even if comments are not. themes: 3-5 short noun phrases.',
                        'Course: ' + job.course + (job.provider ? ' — published by ' + job.provider : '') + '\nComments (sample of ' + job.usable.length + '):\n' + JSON.stringify(sample),
                        SUM_SCHEMA, 1000);
                    cache[job.course] = { sig: job.sig, s: String(parsed.summary || '').trim(), t: (parsed.themes || []).slice(0, 5), n: job.usable.length };
                    await Storage.setItem('surghub_feedback_summaries', cache);
                }
                // provider rollups from course summaries
                for (const p of provs) {
                    if (this._reportCancelled || this._aiCancelled) break;
                    const parts = Object.entries(byCourse).filter(([, i]) => i.provider === p).map(([c]) => cache[c] ? (c + ': ' + cache[c].s) : null).filter(Boolean);
                    if (!parts.length) continue;
                    this._showReportProgress('Provider summary: ' + p, true);
                    const parsed = await this._claudeJSON(apiKey,
                        'You synthesize per-course feedback summaries into one provider-level paragraph (3-4 sentences) about what learners say about this provider\'s courses on SURGhub. Refer to the courses as the provider\'s courses (by name); NEVER as \'SURGhub\'s courses\' — SURGhub only hosts them. Third person, specific, honest, English. Frame recurring requests constructively (\'Learners would welcome...\') — never use \'However\' or negative pivots. themes: 3-5 short noun phrases.',
                        'Provider: ' + p + '\nCourse summaries:\n' + parts.join('\n'),
                        SUM_SCHEMA, 1200);
                    cache['@provider:' + p] = { s: String(parsed.summary || '').trim(), t: (parsed.themes || []).slice(0, 5), n: parts.length };
                    await Storage.setItem('surghub_feedback_summaries', cache);
                }
                this._feedbackSummaries = cache;
                this._hideReportProgress();
                this.renderView();
                const cost = (this._aiUsage.in * 1 + this._aiUsage.out * 5) / 1e6;
                alert('Summaries complete ✓\n\nTokens: ' + this._aiUsage.in.toLocaleString() + ' in / ' + this._aiUsage.out.toLocaleString() + ' out ≈ $' + cost.toFixed(2) + '\n\nSummaries now appear on course sections in provider reports and in the app.');
            } catch (e) {
                await Storage.setItem('surghub_feedback_summaries', cache);
                this._feedbackSummaries = cache;
                this._hideReportProgress();
                alert('Summarizing stopped: ' + e.message + '\n\nProgress was saved — run again to continue.');
            }
        }
    });
})();
