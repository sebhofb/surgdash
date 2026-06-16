// ── Course identity ────────────────────────────────────────────────────────
// Courses are identified by their LearnWorlds slug (CourseId) when present,
// falling back to the title for legacy CSV / manually-added records that never
// got a slug. courseKey() is the canonical dedup/group key; courseMatches() is
// the lookup/selection test (accepts a key that is EITHER a slug or a title, so
// it works for both new slug-based selection and any legacy title-based state).
window.courseKey = function (d) { return String((d && (d.CourseId || d.Course)) || ''); };
window.courseMatches = function (d, key) { if (!d || key == null) return false; const k = String(key); return (d.CourseId != null && String(d.CourseId) === k) || String(d.Course || '') === k; };

window.App = {
    data: [],
    userHistory: [],
    ambassadorData: null,
    platformUniqueUsers: 0,
    currentProject: 'surghub',
    view: 'manage',
    updateDate: new Date().toISOString().split('T')[0],
    selectedDate: '',
    selectedProvider: '',
    selectedCourse: '',
    feedbackFilterDate: '',
    feedbackSort: 'ai',            // 'date' | 'length' | 'rating' | 'ai'
    feedbackFilterTag: 'all',        // 'all' | tag name (flag or topic)
    feedbackShowSelected: false,     // true = show only checked testimonials
    _provFeedbackCourse: 'all',      // course filter on provider feedback page
    hideLowLearners: false,
    includeSample: false,            // blend the demo/sample SURGfund project into org totals & charts
    selectedCountries: [],
    selectedProfessions: [],
    selectedAmbassadors: [],
    joinersPeriodDays: 30,           // period for the Daily Joiners panel (7/30/90/180/365 or 'custom')
    joinersCustomStart: '',          // YYYY-MM-DD — Period A start when joinersPeriodDays === 'custom'
    joinersCustomEnd: '',            // YYYY-MM-DD — Period A end
    joinersCustomStartB: '',         // YYYY-MM-DD — Period B start (optional second custom range)
    joinersCustomEndB: '',           // YYYY-MM-DD — Period B end (defaults to immediately-prior window)
    includePartialMonth: false,      // include current incomplete month in monthly timeline charts
    countryTimelineRange: 'all',     // months to show in Country growth chart ('all' or '3','6','12','24')
    profTimelineRange: 'all',        // months to show in Profession growth chart
    ambassadorsTimelineRange: 'all', // months to show in Top Ambassadors chart
    timelineMismatches: [],
    tokenText: '',
    eventTab: 'event',
    editingEventId: null,
    kpiYear: null,
    // Activities tab year filter — independent from the dashboards' kpiYear so
    // toggling here doesn't shift other views. Values: 'all' | <number> | 'range'.
    activityYear: 'all',
    activityRangeFrom: null,
    activityRangeTo: null,
    kpiViewMode: 'matrix',       // 'matrix' (all years in one table, auto-save) | 'cards' (one year detail view w/ comments)
    qualityViewMode: 'matrix',   // matrix (all year-quarters) | cards (one quarter cards)
    calYear: null,
    calMonth: null,
    isLoading: false,
    loadingText: '',
    currentUpdateIndex: 0,
    totalUpdateCount: 0,

    demoMode: false,
    editUnlocked: false,        // true = full edit mode; false = read-only
    _editPasswordHash: null,    // SHA-256 hex string stored on disk (null = no password set)
    _defaultPasswordHash: '6b4a1673b225e8bf5f093b91be8c864427df32ca41b17cc0b82112b8f0185e41',       // bundled EDIT password (SHA-256) — ships with the app so every install starts locked
    _defaultReportPasswordHash: '895a6072c8d3559373b6f55e64569145e22cd56e6c0cb49d284dbab9578a72d1',  // bundled PROVIDER-REPORTING password (SHA-256)
    reportAccess: false,        // true = provider-reporting role (SURGhub report workflow only; SURGfund + data writes stay locked)
    _reportPasswordHash: null,  // SHA-256 hex for the reporting-role password (separate from edit)
    _autoPullInterval: null,

    async init() {
        try {
            // Migrate from IndexedDB to JSON files (one-time, on first run)
            await Storage.migrateFromLocalforage();

            // Check demo mode state
            this.demoMode = !!(await Storage.getItem('surgdash_demo_active'));

            // Access gate. The edit + reporting passwords are stored locally per
            // machine AND bundled with the build (the default hashes below), so a
            // FRESH install — e.g. a colleague's download, which has no local
            // password file — is locked by default. The app ALWAYS opens read-only;
            // editing or provider-reporting requires the matching password. A
            // locally-set password (Settings) takes precedence over the bundled one.
            this._editPasswordHash   = (await Storage.getItem('surgdash_edit_password'))   || this._defaultPasswordHash       || null;
            this._reportPasswordHash = (await Storage.getItem('surgdash_report_password')) || this._defaultReportPasswordHash || null;
            this.editUnlocked = false;
            this.reportAccess = false;
            document.body.classList.add('viewer-mode');

            // Catch async-rendered forms in viewer mode: any time a node is added,
            // disable form controls inside it. Stops checkbox-label forwarding too.
            this._viewerInputObserver = new MutationObserver((mutations) => {
                if (this.editUnlocked) return;
                for (const m of mutations) {
                    m.addedNodes.forEach(node => {
                        if (node.nodeType !== 1) return; // element nodes only
                        const apply = (el) => {
                            if (el.hasAttribute('data-viewer-allowed')) return;
                            // In provider-reporting mode, report controls stay live.
                            if (this.reportAccess && el.hasAttribute('data-report-ok')) return;
                            if (el.type === 'hidden') return;
                            if (!el.disabled) el.disabled = true;
                        };
                        if (node.matches && node.matches('input, textarea, select')) apply(node);
                        if (node.querySelectorAll) node.querySelectorAll('input, textarea, select').forEach(apply);
                    });
                }
            });
            this._viewerInputObserver.observe(document.body, { childList: true, subtree: true });

            this._startAutoPull();
            this._startCloudFreshnessCheck();

            // Stamp the real app version into the sidebar (single source of truth:
            // package.json, exposed via preload). Falls back to the hardcoded label.
            try {
                const _v = document.getElementById('app-version');
                if (_v && window.electronAPI && window.electronAPI.appVersion) _v.textContent = 'v' + window.electronAPI.appVersion;
            } catch (_) {}

            // Restore the "blend the sample project in/out" preference (viewer-toggleable).
            this.includeSample = !!(await Storage.getItem('surgdash_include_sample'));

            // Load project registry
            await Projects.loadRegistry();
            const lastProject = await Storage.getItem('surgdash_last_project');
            if (lastProject && (lastProject === 'org' || Projects.getProject(lastProject))) {
                this.currentProject = lastProject;
            } else {
                // Fresh install or post-wipe: land on the Org overview by default so
                // the user immediately sees the Backup / Restore / Pull buttons in
                // the action bar (rather than getting stuck on the SURGhub
                // "Load Snapshot" page with no obvious path to restore).
                this.currentProject = 'org';
                this.view = 'org-dashboard';
            }

            // Load from unlimited IndexedDB
            const stored = await Storage.getItem('surghub_data');
            if (stored) {
                this.data = stored;
                // Migration: ensure CourseTimeline only exists on the latest entry per course
                const latestTs = {};
                this.data.forEach(d => {
                    if (d.CourseTimeline && (!latestTs[d.Course] || d.Timestamp > latestTs[d.Course])) {
                        latestTs[d.Course] = d.Timestamp;
                    }
                });
                let migrated = false;
                this.data.forEach(d => {
                    if (d.CourseTimeline && latestTs[d.Course] && d.Timestamp !== latestTs[d.Course]) {
                        delete d.CourseTimeline;
                        migrated = true;
                    }
                });
                if (migrated) await Storage.setItem('surghub_data', this.data);
            }
            
            const storedHistory = await Storage.getItem('surghub_history');
            if (storedHistory) this.userHistory = storedHistory;
            
            const storedAmb = await Storage.getItem('surghub_ambassadors');
            if (storedAmb) this.ambassadorData = storedAmb;

            // Last provenance re-derive result (so Data Health + any regression
            // banner survive a reload, and the next sync can detect regressions).
            const storedVerify = await Storage.getItem('surghub_derive_verify');
            if (storedVerify) this._deriveVerify = storedVerify;

            const storedUsers = await Storage.getItem('surghub_unique_users');
            if (storedUsers) this.platformUniqueUsers = parseInt(storedUsers);

            // NOTE: surghub_anon_users (~31MB) is LAZY-loaded — see ensureAnonLoaded(),
            // kicked just after first paint — so the cold start isn't blocked parsing it.
            // Restore the persisted reporting period for provider reports
            try {
                const storedPeriod = await Storage.getItem('report_period');
                if (storedPeriod && typeof storedPeriod === 'object') {
                    this.reportPeriodFrom = storedPeriod.from || '';
                    this.reportPeriodTo = storedPeriod.to || '';
                }
            } catch (e) { /* ignore */ }

            const storedEmailDemo = await Storage.getItem('surghub_email_demo');
            if (storedEmailDemo) this._emailDemoMap = storedEmailDemo;

            // Signup-survey export URL → Sync Surveys auto-fetches gender/org type
            const storedSignupUrl = await Storage.getItem('surghub_signup_survey_url');
            if (storedSignupUrl) this.signupSurveyUrl = storedSignupUrl;

            const storedSocial = await Storage.getItem('surghub_social');
            if (storedSocial) this._rawSocial = storedSocial;

            // NOTE: surghub_completion (~37MB) is LAZY-loaded — see ensureCompletionLoaded(),
            // triggered only when the Performance tab / a completion export needs it.
            const storedAiScores = await Storage.getItem('surghub_feedback_ai');
            if (storedAiScores) this._aiScoreMap = storedAiScores;

            const storedSummaries = await Storage.getItem('surghub_feedback_summaries');
            if (storedSummaries) this._feedbackSummaries = storedSummaries;

            const storedStory = await Storage.getItem('surghub_ai_story');
            if (storedStory) this._aiStory = storedStory;

            const storedExPro = await Storage.getItem('surghub_excluded_providers');
            this._excludedProviders = new Set(Array.isArray(storedExPro) ? storedExPro : []);
        } catch (e) { 
            console.error("Database Load error", e); 
        }
        
        const dates = this.getAvailableDates();
        if (dates.length > 0) this.selectedDate = dates[dates.length - 1];
        else this.selectedDate = this.updateDate;

        // Viewer mode: always start on the org dashboard so colleagues
        // land on the "Welcome to Live View" setup screen immediately
        if (!this.editUnlocked) {
            this.currentProject = 'org';
            this.view = 'org-dashboard';
        } else {
            // Set initial view based on current project
            const proj = this.getCurrentProject();
            if (proj && proj.type === 'surghub') {
                if (this.data && this.data.length > 0) {
                    this.view = 'platform';
                }
            } else if (proj && proj.type === 'org') {
                this.view = 'org-dashboard';
            } else if (proj) {
                this.view = 'project-dashboard';
            }
        }

        if (this.renderView) this.renderView();
        // Splash fade is owned by the controller in index.html, which anchors its
        // minimum-visible timer to actual window-show (main.js 'ready-to-show')
        // so the splash is reliably seen — don't fade it from here.

        // Lazy-load the big anon_users blob (~31MB) JUST AFTER first paint — not
        // blocking it — then re-render once so any engagement panels fill with real
        // data. (completion ~37MB stays fully deferred until the Performance tab / an
        // export needs it.) This is what makes the cold start fast.
        setTimeout(() => { this.ensureAnonLoaded().then(() => { if (this.renderView) this.renderView(); }); }, 50);

        // Start the unsynced-changes watcher (banner updates every 10 s)
        this._startUnsyncedWatcher();

        // Start onboarding tips on first launch (after UI settles)
        setTimeout(() => { if (this.startOnboarding) this.startOnboarding(); }, 800);
    },

    getCurrentProject() {
        if (this.currentProject === 'org') return Projects.ORG_PROJECT;
        return Projects.getProject(this.currentProject) || Projects.getProject('surghub');
    },

    // Blend the demonstration (sample) project in/out of the org dashboard totals
    // and charts. Pure view-state — touches no project data — so it's available
    // to viewers as well as editors. Persists across sessions.
    async toggleSampleInclude(on) {
        this.includeSample = (on === undefined) ? !this.includeSample : !!on;
        try { await Storage.setItem('surgdash_include_sample', this.includeSample ? '1' : ''); } catch (_) {}
        // If we just hid the sample while viewing it, step back to the Org overview
        // so the user isn't left on a project that's no longer in the sidebar.
        if (!this.includeSample) {
            const cur = this.getCurrentProject();
            if (cur && cur.isSample) { this.currentProject = 'org'; this.view = 'org-dashboard'; }
        }
        if (this.renderView) this.renderView();
    },

    // Add the demonstration sample project on demand. Works in view mode too — it's
    // a purely local demo: excluded from Google Sheets sync, from organisation
    // totals by default, and from every generated report. Blends it straight in so
    // the user immediately sees a fully-populated org view they can toggle off again.
    async addSampleProject() {
        try {
            await Projects.createSampleProject();
            this.includeSample = true;
            try { await Storage.setItem('surgdash_include_sample', '1'); } catch (_) {}
            if (this.showMsg) this.showMsg('Sample project added — blended into the dashboard ✓');
        } catch (e) {
            console.error('addSampleProject failed:', e);
            if (this.showMsg) this.showMsg('Could not add the sample project.', true);
        }
        if (this.renderView) this.renderView();
    },

    async switchProject(projectId) {
        this.currentProject = projectId;
        await Storage.setItem('surgdash_last_project', projectId);
        if (projectId === 'org') {
            this.view = 'org-dashboard';
        } else {
            const project = this.getCurrentProject();
            this.view = project.type === 'surghub' ? 'platform' : 'project-dashboard';
        }
        if (this.renderView) this.renderView();
    },

    navigate(view) {
        this.view = view;
        if (this.renderView) this.renderView();
    },

    // Open a specific provider page from anywhere (e.g. directory click)
    openProvider(name) {
        if (!name) return;
        this.selectedProvider = name;
        this.currentProject = 'surghub';
        this.view = 'provider';
        if (this.renderView) this.renderView();
    },

    // Open a specific course page from anywhere (e.g. directory click)
    openCourse(name) {
        if (!name) return;
        this.selectedCourse = name;
        this.currentProject = 'surghub';
        this.view = 'course';
        if (this.renderView) this.renderView();
    },

    getAvailableDates() {
        let dates = new Set();
        this.data.forEach(d => dates.add(d.Timestamp));
        this.userHistory.forEach(d => dates.add(d.Timestamp));
        let arr = Array.from(dates).sort();
        return arr.length > 0 ? arr : [this.updateDate];
    },

    getShells() {
        const names = new Set();
        return this.data.reduce((acc, curr) => {
            if (!names.has(curr.Course) && !curr.IsShell) {
                names.add(curr.Course);
                acc.push({ Provider: curr.Provider, Course: curr.Course, URL: curr.URL });
            }
            return acc;
        }, []).sort((a,b) => a.Course.localeCompare(b.Course));
    },

    // Drop pre-migration ORPHAN records: a course with NO CourseId whose title is
    // also held by a record that HAS a CourseId (the slugged record supersedes the
    // stray, e.g. the leftover CourseId-less "PeN Programme" copy). Removes the
    // orphan from every view/total/firewall without touching genuinely-unique legacy
    // (CourseId-less) courses, whose titles have no slugged twin.
    _dropOrphanDupes(snap) {
        const slugged = new Set(snap.filter(d => d.CourseId).map(d => String(d.Course || '').trim().toLowerCase()));
        return snap.filter(d => d.CourseId || !slugged.has(String(d.Course || '').trim().toLowerCase()));
    },

    getAnalyticsSnap() {
        // Always deduplicate to latest entry per course (ignore date filtering)
        // This prevents uploads with different timestamps from hiding course data
        const exP = this._excludedProviders instanceof Set ? this._excludedProviders : null;
        const all = this.data.filter(d => !d.IsShell && !d.Excluded && !(exP && exP.has(d.Provider)));
        const latest = {};
        all.forEach(d => {
            const k = courseKey(d);
            if (!latest[k] || d.Timestamp > latest[k].Timestamp) {
                latest[k] = d;
            }
        });
        let snap = this._dropOrphanDupes(Object.values(latest));
        if (this.hideLowLearners) snap = snap.filter(d => (Number(d.Learners) || 0) >= 50);
        return snap;
    },

    getAnalyticsHistory() {
        const exP = this._excludedProviders instanceof Set ? this._excludedProviders : null;
        let hist = this.data.filter(d => !d.IsShell && !d.Excluded && !(exP && exP.has(d.Provider)));
        if (this.hideLowLearners) hist = hist.filter(d => (Number(d.Learners) || 0) >= 50);
        return hist;
    },

    // Platform-total variants: course-level "Excluded" courses are hidden from
    // listings/reports but are often active-but-private, so their metrics MUST
    // still count toward the platform totals and growth. (Provider-level
    // exclusion still removes the provider entirely.)
    getPlatformSnap() {
        const exP = this._excludedProviders instanceof Set ? this._excludedProviders : null;
        const all = this.data.filter(d => !d.IsShell && !(exP && exP.has(d.Provider)));
        const latest = {};
        all.forEach(d => { const k = courseKey(d); if (!latest[k] || d.Timestamp > latest[k].Timestamp) latest[k] = d; });
        let snap = this._dropOrphanDupes(Object.values(latest));
        if (this.hideLowLearners) snap = snap.filter(d => (Number(d.Learners) || 0) >= 50);
        return snap;
    },
    getPlatformHistory() {
        const exP = this._excludedProviders instanceof Set ? this._excludedProviders : null;
        let hist = this.data.filter(d => !d.IsShell && !(exP && exP.has(d.Provider)));
        if (this.hideLowLearners) hist = hist.filter(d => (Number(d.Learners) || 0) >= 50);
        return hist;
    },

    showMsg(msg, isError = false) {
        // Non-blocking toast notification
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:420px;';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.style.cssText = `pointer-events:auto;padding:12px 18px;border-radius:10px;font-size:13px;font-weight:500;line-height:1.4;color:#fff;box-shadow:0 4px 20px rgba(0,0,0,0.18);opacity:0;transform:translateX(20px);transition:opacity 0.3s,transform 0.3s;font-family:'Inter',sans-serif;`
            + (isError
                ? 'background:linear-gradient(135deg,#dc2626,#b91c1c);'
                : 'background:linear-gradient(135deg,#059669,#047857);');
        toast.textContent = msg;
        container.appendChild(toast);
        // Animate in
        requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(0)'; });
        // Auto-dismiss after 4s
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    },

    showUndo(msg, undoCallback, timeout = 8000) {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:420px;';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.style.cssText = 'pointer-events:auto;padding:12px 18px;border-radius:10px;font-size:13px;font-weight:500;line-height:1.4;color:#fff;box-shadow:0 4px 20px rgba(0,0,0,0.18);opacity:0;transform:translateX(20px);transition:opacity 0.3s,transform 0.3s;font-family:\'Inter\',sans-serif;background:linear-gradient(135deg,#334155,#1e293b);display:flex;align-items:center;gap:12px;';
        const textSpan = document.createElement('span');
        textSpan.textContent = msg;
        textSpan.style.flex = '1';
        const undoBtn = document.createElement('button');
        undoBtn.textContent = 'Undo';
        undoBtn.style.cssText = 'background:rgba(255,255,255,0.2);color:#fff;border:none;padding:4px 12px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background 0.15s;';
        undoBtn.onmouseenter = () => undoBtn.style.background = 'rgba(255,255,255,0.35)';
        undoBtn.onmouseleave = () => undoBtn.style.background = 'rgba(255,255,255,0.2)';

        let dismissed = false;
        const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            setTimeout(() => toast.remove(), 300);
        };

        undoBtn.onclick = () => {
            clearTimeout(timer);
            dismiss();
            if (undoCallback) undoCallback();
        };

        toast.appendChild(textSpan);
        toast.appendChild(undoBtn);
        container.appendChild(toast);
        requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(0)'; });

        const timer = setTimeout(dismiss, timeout);
        return () => { clearTimeout(timer); dismiss(); };
    },

    escapeHtml(unsafe) {
        if (!unsafe) return '';
        return String(unsafe).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    },

    async _hashPassword(pw) {
        const data = new TextEncoder().encode(pw);
        const buf = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    async setEditPassword(pw) {
        if (!pw) {
            this._editPasswordHash = null;
            await Storage.setItem('surgdash_edit_password', null);
        } else {
            this._editPasswordHash = await this._hashPassword(pw);
            await Storage.setItem('surgdash_edit_password', this._editPasswordHash);
        }
    },

    async unlockEdit(pw) {
        const hash = await this._hashPassword(pw);
        if (hash !== this._editPasswordHash) return false;
        this.editUnlocked = true;
        this.reportAccess = false;                       // full edit supersedes reporting
        document.body.classList.remove('viewer-mode');
        document.body.classList.remove('report-mode');
        if (this._autoPullInterval) { clearInterval(this._autoPullInterval); this._autoPullInterval = null; }
        this.renderView();
        return true;
    },

    lockEdit() {
        this.editUnlocked = false;
        document.body.classList.add('viewer-mode');
        document.body.classList.remove('report-mode');
        this._startAutoPull();
        this.renderView();
    },

    // ── Provider-reporting role (separate password) ───────────────────────────
    // Unlocks ONLY the SURGhub provider-report workflow (export reports, select /
    // auto-select testimonials, feedback time filter). SURGfund, Data Sync,
    // Settings, the API key, and all data writes stay locked.
    async setReportPassword(pw) {
        if (!pw) {
            this._reportPasswordHash = null;
            await Storage.setItem('surgdash_report_password', null);
        } else {
            this._reportPasswordHash = await this._hashPassword(pw);
            await Storage.setItem('surgdash_report_password', this._reportPasswordHash);
        }
    },

    async unlockReport(pw) {
        const hash = await this._hashPassword(pw);
        if (!this._reportPasswordHash || hash !== this._reportPasswordHash) return false;
        this.reportAccess = true;
        this.editUnlocked = false;
        document.body.classList.remove('viewer-mode');
        document.body.classList.add('report-mode');
        if (this._autoPullInterval) { clearInterval(this._autoPullInterval); this._autoPullInterval = null; }
        this.renderView();
        setTimeout(() => { try { this._showReporterSetupModal(); } catch (e) {} }, 350);
        return true;
    },

    // First-time setup popup shown when entering reporting mode, if the Google Sheets
    // link or Claude API key isn't configured yet. (The persistent setup banner also
    // covers this; this is the more prominent on-login prompt.)
    async _showReporterSetupModal() {
        if (document.getElementById('reporter-setup-modal')) return;
        let url = '', key = '';
        try { url = ((await Projects.getAppSettings()) || {}).googleSheetsUrl || ''; } catch (e) {}
        try { key = (await this._getAnthropicKey()) || ''; } catch (e) {}
        if (url && key) return;   // all set — no popup
        const esc = (s) => this.escapeHtml(s);
        const row = (title, desc, label, fn, done) => done
            ? '<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:10px;margin-bottom:10px"><span style="color:#16a34a;font-weight:800">✓</span><div><div style="font-weight:700;color:#065f46;font-size:13px">' + esc(title) + '</div><div style="font-size:12px;color:#15803d">Already set up.</div></div></div>'
            : '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:10px"><div style="min-width:0"><div style="font-weight:700;color:#002F4C;font-size:13px">' + esc(title) + '</div><div style="font-size:12px;color:#64748b">' + esc(desc) + '</div></div><button onclick="document.getElementById(\'reporter-setup-modal\').remove(); App.' + fn + '" style="flex-shrink:0;padding:8px 16px;background:#002F4C;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">' + esc(label) + '</button></div>';
        const overlay = document.createElement('div');
        overlay.id = 'reporter-setup-modal';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;padding:24px';
        overlay.innerHTML = '<div style="background:#fff;border-radius:16px;padding:28px;max-width:480px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.3)">'
            + '<h3 style="font-size:18px;font-weight:800;color:#002F4C;margin:0 0 6px">Welcome — quick setup</h3>'
            + '<p style="font-size:13px;color:#64748b;margin:0 0 18px">Set these up once to build provider reports. Both are stored locally on this machine.</p>'
            + row('Google Sheets link', 'Connects your live SURGhub data so it stays current.', 'Add link', 'setupDataLink()', !!url)
            + row('Claude API key', 'Needed for AI testimonial scoring and the course-page export.', 'Add key', 'setAnthropicKey()', !!key)
            + '<div style="display:flex;justify-content:flex-end;margin-top:8px"><button onclick="document.getElementById(\'reporter-setup-modal\').remove()" style="padding:8px 16px;border:1px solid #e2e8f0;background:#fff;color:#64748b;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Later</button></div>'
            + '</div>';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    },

    lockReport() {
        this.reportAccess = false;
        document.body.classList.remove('report-mode');
        if (!this.editUnlocked) document.body.classList.add('viewer-mode');
        this._startAutoPull();
        this.renderView();
    },

    // Relock whichever elevated mode is active (used by the sidebar lock button).
    relock() {
        if (this.editUnlocked) this.lockEdit();
        else if (this.reportAccess) this.lockReport();
    },

    showUnlockPrompt() {
        if (document.getElementById('unlock-modal')) return;
        const overlay = document.createElement('div');
        overlay.id = 'unlock-modal';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;';
        overlay.innerHTML = `
            <div style="background:#fff;border-radius:16px;padding:32px;width:340px;box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center;">
                <div style="width:48px;height:48px;border-radius:50%;background:#002F4C10;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#002F4C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                </div>
                <h3 style="font-size:16px;font-weight:700;color:#002F4C;margin-bottom:6px;">Enter Password</h3>
                <p style="font-size:12px;color:#94a3b8;margin-bottom:20px;">Unlocks editing (or provider-reporting access) for this session.</p>
                <input type="password" id="unlock-pw-input" placeholder="Password" data-viewer-allowed
                    style="width:100%;box-sizing:border-box;padding:10px 14px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;outline:none;margin-bottom:8px;" />
                <p id="unlock-error" style="font-size:11px;color:#dc2626;min-height:18px;margin-bottom:12px;"></p>
                <div style="display:flex;gap:8px;">
                    <button id="unlock-cancel-btn" style="flex:1;padding:10px;border-radius:10px;border:1px solid #e2e8f0;background:#fff;font-size:13px;font-weight:600;color:#64748b;cursor:pointer;">Cancel</button>
                    <button id="unlock-submit-btn" style="flex:1;padding:10px;border-radius:10px;border:none;background:#002F4C;font-size:13px;font-weight:700;color:#fff;cursor:pointer;">Unlock</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const input = document.getElementById('unlock-pw-input');
        const errEl = document.getElementById('unlock-error');
        input.focus();
        const tryUnlock = async () => {
            const pw = input.value;
            if (!pw) { errEl.textContent = 'Please enter a password.'; return; }
            if (await App.unlockEdit(pw)) {
                overlay.remove();
                App.showMsg('Edit mode unlocked.');
            } else if (await App.unlockReport(pw)) {
                overlay.remove();
                App.showMsg('Provider-reporting mode unlocked.');
            } else {
                errEl.textContent = 'Incorrect password.';
                input.value = '';
                input.focus();
            }
        };
        document.getElementById('unlock-submit-btn').onclick = tryUnlock;
        input.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
        document.getElementById('unlock-cancel-btn').onclick = () => overlay.remove();
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    },

    // Toggle a testimonial as selected/deselected for PDF reports
    _unescapeHtml(s) {
        const el = document.createElement('textarea');
        el.innerHTML = s;
        return el.value;
    },
    async toggleTestimonial(providerName, courseName, feedbackText, checked) {
        const raw = this._unescapeHtml(feedbackText);
        const sel = (await Storage.getItem('surghub_selected_testimonials')) || {};
        if (!sel[providerName]) sel[providerName] = {};
        if (!sel[providerName][courseName]) sel[providerName][courseName] = [];
        const arr = sel[providerName][courseName];
        const idx = arr.indexOf(raw);
        if (checked && idx === -1) arr.push(raw);
        else if (!checked && idx !== -1) arr.splice(idx, 1);
        // Clean up empty arrays
        if (arr.length === 0) delete sel[providerName][courseName];
        if (Object.keys(sel[providerName]).length === 0) delete sel[providerName];
        await Storage.setItem('surghub_selected_testimonials', sel);
    },

    _applySelectedFilter() {
        const cards = document.querySelectorAll('.feedback-card');
        cards.forEach(card => {
            if (this.feedbackShowSelected) {
                const cb = card.querySelector('.testimonial-cb');
                card.style.display = (cb && cb.checked) ? '' : 'none';
            } else {
                card.style.display = '';
            }
        });
    },

    // ── Lazy loaders for the big SURGhub blobs (kept out of cold-start parse) ──
    // anon_users (~31MB) and completion (~37MB) are NOT loaded in init(); they load
    // once, on demand, the first time a view/feature needs them. Idempotent + in-flight
    // safe; a no-op once the array is present (e.g. freshly set by a sync/restore).
    async ensureAnonLoaded() {
        if (this._rawAnonymizedUsers != null) return this._rawAnonymizedUsers;   // already loaded or synced
        if (this._anonLoadPromise) return this._anonLoadPromise;
        this._anonLoadPromise = (async () => {
            let v = null; try { v = await Storage.getItem('surghub_anon_users'); } catch (e) {}
            this._rawAnonymizedUsers = Array.isArray(v) ? v : [];
            this._anonLoadPromise = null;
            return this._rawAnonymizedUsers;
        })();
        return this._anonLoadPromise;
    },
    async ensureCompletionLoaded() {
        if (this._rawCompletion != null) return this._rawCompletion;
        if (this._completionLoadPromise) return this._completionLoadPromise;
        this._completionLoadPromise = (async () => {
            let v = null; try { v = await Storage.getItem('surghub_completion'); } catch (e) {}
            this._rawCompletion = Array.isArray(v) ? v : [];
            this._completionLoadPromise = null;
            return this._rawCompletion;
        })();
        return this._completionLoadPromise;
    },

    async _startAutoPull() {
        if (this._autoPullInterval) { clearInterval(this._autoPullInterval); this._autoPullInterval = null; }
        // Per-device safety: auto-pull is OPT-IN, OFF by default. A cloud pull
        // OVERWRITES local project data, so on an editor's machine a silent launch
        // pull can wipe unsynced edits (the bonesetter data-loss incident). Only
        // devices explicitly opted in — e.g. a read-only viewer screen — auto-pull;
        // everyone else uses the manual Pull / Push buttons. The flag is stored
        // device-locally (settings/autopull_enabled.json) and never pushed to Sheets.
        const autoOn = await Storage.getItem('surgdash_autopull_enabled');
        if (!autoOn) return;
        const pull = async () => {
            const settings = await Projects.getAppSettings();
            if (settings.googleSheetsUrl && window.GenericViews) {
                await GenericViews._pullFromSheets(true);
            }
        };
        // Delay the first pull slightly so the UI has rendered (banner needs DOM)
        setTimeout(() => pull(), 600);
        this._autoPullInterval = setInterval(pull, 5 * 60 * 1000);
    },

    // ── Cloud freshness check ("new data available" banner) ─────────────────
    // For MANUAL devices (auto-pull OFF), periodically ask the Apps Script only for
    // the Sheet's last-modified time (?meta=1 — cheap, no full download). If the
    // cloud is newer than this device last pulled/pushed, show a dismissible banner
    // offering a one-click Pull. Auto-pull devices already stay current, so they
    // skip this. Fully silent + best-effort: any error, or an old script without the
    // meta endpoint (no lastModified field), simply shows nothing.
    _startCloudFreshnessCheck() {
        if (this._cloudCheckInterval) { clearInterval(this._cloudCheckInterval); this._cloudCheckInterval = null; }
        const run = () => { try { this._checkCloudFreshness(); } catch (_) {} };
        setTimeout(run, 4000);                          // after launch settles
        this._cloudCheckInterval = setInterval(run, 10 * 60 * 1000);   // every 10 min
    },

    // Hit the Apps Script ?meta=1 endpoint and compare the cloud's last-modified
    // time to what this device last pulled/pushed. Returns a result object instead
    // of acting, so both the silent check and the manual button can reuse it.
    //   { ok:true, cloudMs, seenMs, lastModified } | { ok:false, reason, error? }
    //   reason: 'nourl' | 'neterr' | 'badresp' | 'unsupported'
    async _fetchCloudMeta() {
        const appSettings = await Projects.getAppSettings();
        const url = appSettings && appSettings.googleSheetsUrl;
        if (!url) return { ok: false, reason: 'nourl' };
        const metaUrl = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'meta=1';
        let res;
        try { res = await electronAPI.invoke('http-request', { url: metaUrl, method: 'GET' }); }
        catch (e) { return { ok: false, reason: 'neterr', error: String((e && e.message) || e) }; }
        if (!res || res.error || !res.body) return { ok: false, reason: 'neterr', error: (res && res.error) || 'no response' };
        let r; try { r = JSON.parse(res.body); } catch (_) { return { ok: false, reason: 'badresp' }; }
        if (!r || !r.lastModified) return { ok: false, reason: 'unsupported' };   // pre-meta Apps Script
        const cloudMs = new Date(r.lastModified).getTime();
        if (!cloudMs) return { ok: false, reason: 'unsupported' };
        const lastSyncMs = appSettings.googleSheetsLastSync ? new Date(appSettings.googleSheetsLastSync).getTime() : 0;
        const lastPullMs = appSettings.googleSheetsLastPull ? new Date(appSettings.googleSheetsLastPull).getTime() : 0;
        return { ok: true, cloudMs, seenMs: Math.max(lastSyncMs, lastPullMs), lastModified: r.lastModified };
    },

    async _checkCloudFreshness() {
        try {
            // Auto-pull devices refresh themselves — never nag them.
            if (await Storage.getItem('surgdash_autopull_enabled')) return;
            const m = await this._fetchCloudMeta();
            if (!m.ok) return;                          // silent: errors / pre-meta script show nothing
            // 30s grace so this device's own just-finished push/pull doesn't self-trigger.
            if (m.cloudMs > Math.max(m.seenMs, this._cloudBannerDismissedMs || 0) + 30000) this._showCloudUpdateBanner(m.cloudMs);
        } catch (_) { /* best-effort, never throws into the UI */ }
    },

    // Manual "Check for cloud updates" button — same check, but always gives
    // feedback (incl. when up to date or when the script needs redeploying), so it
    // doubles as a way to test the freshness endpoint without waiting for the timer.
    async checkCloudUpdatesManually() {
        this.showMsg('Checking the cloud for new data…');
        const m = await this._fetchCloudMeta();
        if (!m.ok) {
            if (m.reason === 'nourl') return this.showMsg('Add your Google Sheets link first.', true);
            if (m.reason === 'unsupported') return this.showMsg('Your Apps Script doesn’t support the quick check yet — open Settings → Copy Script, paste it into your Apps Script editor, and redeploy the Web App.', true);
            return this.showMsg('Couldn’t reach the cloud' + (m.error ? (': ' + m.error) : '') + '.', true);
        }
        if (m.cloudMs > m.seenMs + 30000) {
            this._showCloudUpdateBanner(m.cloudMs);
            this.showMsg('New data is available in the cloud — use the banner to Pull. ☁');
        } else {
            this._dismissCloudBanner();
            this.showMsg('You’re up to date — no new cloud data since your last pull. ✓');
        }
    },

    _showCloudUpdateBanner(cloudMs) {
        this._cloudBannerSeenMs = cloudMs || 0;
        const el = document.getElementById('cloud-update-banner');
        if (!el) return;
        el.style.display = 'flex';
        if (window.lucide) lucide.createIcons();
    },

    _dismissCloudBanner() {
        // Remember the dismissed cloud state so the same data doesn't re-nag.
        this._cloudBannerDismissedMs = Math.max(this._cloudBannerDismissedMs || 0, this._cloudBannerSeenMs || 0);
        const el = document.getElementById('cloud-update-banner');
        if (el) el.style.display = 'none';
    },

    async pullFromCloudNow() {
        this._dismissCloudBanner();
        // Manual (non-silent) pull — keeps its overwrite-confirm + per-project
        // dirty-skip, so it never silently clobbers unsynced local edits.
        if (window.GenericViews && GenericViews._pullFromSheets) {
            await GenericViews._pullFromSheets(false);
        }
    },

    // ── Unsynced-changes detection ──────────────────────────────────────────
    // Two-tier check:
    //   1. In-memory dirty flag — set immediately on any data write, cleared
    //      on successful sync. This is the authoritative signal for the
    //      current session and is race-free with auto-sync timing.
    //   2. File mtime check (fallback) — catches state across app restarts:
    //      if you closed the app with unsynced changes, mtimes vs lastSync
    //      will tell us on next launch.
    _unsyncedDirty: false,

    // Mark the in-memory state as dirty — called from Storage.setItem after
    // every real data write. Triggers an immediate banner refresh.
    markDirty() {
        this._unsyncedDirty = true;
        if (this._refreshUnsyncedBanner) this._refreshUnsyncedBanner();
    },
    // Clear the dirty flag — called by sync flows after a successful push.
    markClean() {
        this._unsyncedDirty = false;
        if (this._refreshUnsyncedBanner) this._refreshUnsyncedBanner();
    },

    async _hasUnsyncedChanges() {
        try {
            if (!this.editUnlocked) return false;        // viewers can't push, never warn them
            const settings = await Projects.getAppSettings();
            if (!settings.googleSheetsUrl) return false; // no remote configured → nothing to warn about

            // Tier 1: in-memory dirty flag — definitive for the current session
            if (this._unsyncedDirty) return true;

            // Tier 2: file-mtime check (catches state across app restarts only)
            const fs = electronAPI.fs, path = electronAPI.path;
            const lastSyncMs = settings.googleSheetsLastSync ? new Date(settings.googleSheetsLastSync).getTime() : 0;
            const lastPullMs = settings.googleSheetsLastPull ? new Date(settings.googleSheetsLastPull).getTime() : 0;
            // If the user has never pushed AND never pulled, we can't tell what's
            // "fresh from cloud" vs "local edit" — be conservative and don't nag.
            if (lastSyncMs === 0 && lastPullMs === 0) return false;
            const baselineMs = Math.max(lastSyncMs, lastPullMs);

            const dirsToCheck = [
                path.join(Storage.DATA_DIR, 'surghub'),
                path.join(Storage.DATA_DIR, 'projects'),
                path.join(Storage.DATA_DIR, 'settings')
            ];
            // Also check root-level files (registry.json etc.)
            const rootFiles = ['projects.json'];

            // Files that are pure UI/navigation state — writes happen on every click,
            // not actual data changes. Don't trip the banner over these.
            const NAV_STATE_FILES = new Set([
                'last_project.json',     // which project tab is open
                'onboarding.json',       // onboarding tooltip dismissal
                'demo_active.json',      // demo mode toggle
                'report_cover_path.json',// PDF cover path (just a file path string)
                'report_back_path.json', // PDF back path
                // Sync-state bookkeeping — written DURING a Sheets push itself, so
                // their fresh mtimes would falsely re-trip this very check on long
                // syncs. They're meta, never pushed to Sheets, so always skip.
                'surghub_unsynced_local.json',
                'surghub_last_synced.json',
                'surghub_local_mtime.json',
                // Local-only config / credentials — never pushed to Sheets, so a
                // change here shouldn't flag "unsynced to cloud".
                'learnworlds_client_id.json',
                'learnworlds_api_token.json',
                'learnworlds_school_domain.json',
                'provider_map.json',
                'course_links.json',
                'edit_password.json'
            ]);

            // 15-second slack: changes within 15 s of the baseline are considered
            // "synced". Pulls write many files in sequence and the timestamp is
            // saved last, so file mtimes can be a few seconds AFTER the timestamp.
            const threshold = baselineMs + 15000;

            for (const dir of dirsToCheck) {
                if (!fs.existsSync(dir)) continue;
                const stack = [dir];
                while (stack.length > 0) {
                    const d = stack.pop();
                    let entries;
                    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { continue; }
                    for (const e of entries) {
                        const full = path.join(d, e.name);
                        if (e.isDirectory) { stack.push(full); continue; }
                        if (!e.isFile || !e.name.endsWith('.json')) continue;
                        if (NAV_STATE_FILES.has(e.name)) continue; // skip nav/UI state
                        try {
                            const stat = fs.statSync(full);
                            if (stat.mtimeMs > threshold) return true;
                        } catch (_) {}
                    }
                }
            }
            for (const f of rootFiles) {
                const full = path.join(Storage.DATA_DIR, f);
                if (!fs.existsSync(full)) continue;
                try {
                    const stat = fs.statSync(full);
                    if (stat.mtimeMs > threshold) return true;
                } catch (_) {}
            }
            return false;
        } catch (e) {
            console.warn('Unsynced check failed:', e);
            return false;
        }
    },

    // Refresh the unsynced-changes banner. Called periodically and after sync events.
    async _refreshUnsyncedBanner() {
        const banner = document.getElementById('unsynced-banner');
        if (!banner) return;
        const dirty = await this._hasUnsyncedChanges();
        banner.style.display = dirty ? 'flex' : 'none';
    },

    // Show the "demo data is blended in" flag on every SURGfund tab (not SURGhub)
    // whenever the sample project is both present and toggled on. Called from
    // renderView so it tracks the current tab. Pure UI — no data side effects.
    _refreshSampleBanner(project) {
        const banner = document.getElementById('sample-active-banner');
        if (!banner) return;
        const proj = project || this.getCurrentProject();
        const onSurghub = !!(proj && proj.type === 'surghub');
        const sampleExists = !!(window.Projects && Projects.registry && Projects.registry.some(p => p.isSample));
        banner.style.display = (this.includeSample && sampleExists && !onSurghub) ? 'flex' : 'none';
    },

    // First-time setup banner: prompts for the Google Sheets link (everyone, so data
    // can sync) and — for edit/reporting users — the Claude API key. Auto-hides once
    // those are configured. Called fire-and-forget from renderView (async is fine).
    async _refreshSetupBanner() {
        const banner = document.getElementById('setup-banner');
        if (!banner) return;
        let url = '', key = '';
        try { url = ((await Projects.getAppSettings()) || {}).googleSheetsUrl || ''; } catch (e) {}
        try { key = (await this._getAnthropicKey()) || ''; } catch (e) {}
        const canUseAI = this.editUnlocked || this.reportAccess;   // only these need the API key
        const needsSheets = !url;
        const needsKey = canUseAI && !key;
        if (!needsSheets && !needsKey) { banner.style.display = 'none'; banner.innerHTML = ''; return; }
        const btn = (label, fn) => '<button onclick="' + fn + '" class="px-3 py-1 rounded bg-white/15 hover:bg-white/30 transition-colors text-white text-[11px] font-bold whitespace-nowrap">' + label + '</button>';
        const msg = needsSheets
            ? 'Connect your data — add the Google Sheets link to start syncing automatically.'
            : 'One more step — add your Claude API key to use the AI testimonial features.';
        let actions = '';
        if (needsSheets) actions += btn('Add Google Sheets link', 'App.setupDataLink()');
        if (needsKey) actions += btn('Add Claude API key', 'App.setAnthropicKey()');
        banner.innerHTML = '<div class="flex items-center gap-2"><i data-lucide="plug-zap" width="13"></i><span>' + msg + '</span></div>'
            + '<div class="flex items-center gap-2">' + actions + '</div>';
        banner.style.display = 'flex';
        if (window.lucide) lucide.createIcons();
    },

    // Prompt for + save the Google Sheets sync link, then pull. Works in any mode
    // (it only sets a local config value, like the empty-state loader).
    async setupDataLink() {
        const cur = ((await Projects.getAppSettings()) || {}).googleSheetsUrl || '';
        const v = await this._textPrompt('Connect your data',
            'Paste the Google Sheets sync link (the Apps Script Web App URL your SURGdash administrator shared). Data then syncs automatically each time you open the app.',
            cur);
        if (v === null) return;
        const url = String(v).trim();
        if (url && !/^https?:\/\//i.test(url)) { alert('That does not look like a URL — it should start with https://'); return; }
        await Projects.saveAppSettings({ googleSheetsUrl: url });
        if (this._refreshSetupBanner) this._refreshSetupBanner();
        if (url && window.GenericViews && GenericViews._pullFromSheets) {
            App.showMsg && App.showMsg('Data link saved — pulling latest data…');
            try { await GenericViews._pullFromSheets(); } catch (e) {}
        }
        this.renderView();
    },

    _startUnsyncedWatcher() {
        if (this._unsyncedInterval) clearInterval(this._unsyncedInterval);
        // Initial check shortly after init
        setTimeout(() => this._refreshUnsyncedBanner(), 1500);
        // Re-check every 10 s
        this._unsyncedInterval = setInterval(() => this._refreshUnsyncedBanner(), 10000);
    },

    async syncNow() {
        if (!window.GenericViews) return;
        await GenericViews._syncToSheets();
        // sync updates googleSheetsLastSync; refresh the banner immediately
        this._refreshUnsyncedBanner();
    },

    async exportSurghubJson() {
        const keys = ['surghub_data','surghub_history','surghub_ambassadors','surghub_unique_users','surghub_anon_users','surghub_user_courses','surghub_user_certs','surghub_signup_demo','surghub_signup_survey_url','surghub_email_demo','surghub_social','surghub_completion','surghub_selected_testimonials'];
        const snapshot = { _type: 'surghub_snapshot', _version: 2, _exported: new Date().toISOString() };
        const included = [];
        for (const k of keys) {
            const val = await Storage.getItem(k);
            if (val != null) {
                snapshot[k] = val;
                const label = k.replace('surghub_', '');
                const size = Array.isArray(val) ? val.length + ' records' : (typeof val === 'object' ? Object.keys(val).length + ' entries' : 'set');
                included.push(label + ' (' + size + ')');
            }
        }
        if (!snapshot.surghub_data) { this.showMsg('No SURGhub data to export yet.', true); return; }
        const json = JSON.stringify(snapshot);
        const date = new Date().toISOString().split('T')[0];
        const savePath = await electronAPI.invoke('pick-save-path', `SURGhub_Snapshot_${date}.json`);
        if (!savePath) return;
        electronAPI.fs.writeFileSync(savePath, json, 'utf8');
        console.log('Export includes:', included.join(', '));
        this.showMsg('Snapshot exported ✓ — includes ' + included.length + ' of ' + keys.length + ' data sets');
    },

    // ── LearnWorlds API: credentials handlers (used by Data Sync panel) ──
    async saveLearnWorldsCreds() {
        const clientId = (document.getElementById('lw-client-id')?.value || '').trim();
        const apiToken = (document.getElementById('lw-api-token')?.value || '').trim();
        const resultEl = document.getElementById('lw-api-result');
        const statusEl = document.getElementById('lw-api-status');
        if (!clientId || !apiToken) {
            if (resultEl) resultEl.innerHTML = '<span class="text-red-600">⚠ Fill in both fields</span>';
            return;
        }
        await window.LearnWorlds.setCredentials({ clientId, apiToken });
        if (resultEl) resultEl.innerHTML = '<span class="text-emerald-600">✓ Saved locally</span>';
        if (statusEl) statusEl.innerHTML = '<span class="text-emerald-600">● Credentials set</span>';
    },

    async probeLearnWorldsApi() {
        const resultEl = document.getElementById('lw-api-result');
        if (!window.LearnWorlds) return;
        const c = await window.LearnWorlds.getCredentials();
        if (!c.clientId || !c.apiToken) {
            if (resultEl) resultEl.innerHTML = '<span class="text-red-600">⚠ Save credentials first</span>';
            return;
        }
        if (resultEl) resultEl.innerHTML = '<span class="text-slate-500">Probing… (see console)</span>';
        try {
            const { results, summary } = await window.LearnWorlds.probeCapabilities(name => {
                if (resultEl) resultEl.innerHTML = `<span class="text-slate-500">Probing ${name}…</span>`;
            });
            const ok = results.filter(r => !r.error).length;
            const fail = results.filter(r => r.error).length;
            if (resultEl) resultEl.innerHTML = `<span class="text-emerald-600">✓ Probe complete — ${ok} endpoints available, ${fail} not. See DevTools console for details.</span>`;
            // Stash on App for follow-up inspection
            this._lastProbeResults = results;
            console.log('Tip: run App._lastProbeResults to inspect the probe results object again.');
        } catch (e) {
            if (resultEl) resultEl.innerHTML = `<span class="text-red-600">✗ Probe failed: ${e.message}</span>`;
            console.error('[LearnWorlds Probe] error:', e);
        }
    },

    async testLearnWorldsCreds() {
        const resultEl = document.getElementById('lw-api-result');
        if (resultEl) resultEl.innerHTML = '<span class="text-slate-500">Testing…</span>';
        // Always test the values currently in the inputs (not just the saved
        // ones) so the user can verify before clicking Save.
        const clientId = (document.getElementById('lw-client-id')?.value || '').trim();
        const apiToken = (document.getElementById('lw-api-token')?.value || '').trim();
        if (clientId && apiToken) {
            await window.LearnWorlds.setCredentials({ clientId, apiToken });
        }
        const r = await window.LearnWorlds.testConnection();
        if (resultEl) {
            resultEl.innerHTML = r.ok
                ? `<span class="text-emerald-600">✓ Connected — ${r.totalCourses} courses visible</span>`
                : `<span class="text-red-600">✗ ${r.error}</span>`;
        }
        const statusEl = document.getElementById('lw-api-status');
        if (statusEl && r.ok) statusEl.innerHTML = '<span class="text-emerald-600">● Connected</span>';
    },

    // Populate credential inputs when the Data Sync view opens. Called from
    // renderView() so values appear without leaking through HTML attributes
    // (avoids escaping issues for token characters).
    async _populateLearnWorldsCreds() {
        if (!window.LearnWorlds) return;
        const c = await window.LearnWorlds.getCredentials();
        const idEl = document.getElementById('lw-client-id');
        const tokEl = document.getElementById('lw-api-token');
        const statusEl = document.getElementById('lw-api-status');
        if (idEl && c.clientId) idEl.value = c.clientId;
        if (tokEl && c.apiToken) tokEl.value = c.apiToken;
        if (statusEl) {
            statusEl.innerHTML = (c.clientId && c.apiToken)
                ? '<span class="text-emerald-600">● Credentials set</span>'
                : '<span class="text-slate-400">● Not configured</span>';
        }
        // Provider/links mapping status
        const mapEl = document.getElementById('mapping-status');
        if (mapEl) {
            const pm = (await Storage.getItem('surgdash_provider_map')) || [];
            const cl = (await Storage.getItem('surgdash_course_links')) || [];
            const bits = [];
            if (pm.length) bits.push(`${pm.length}-row provider map stored`);
            if (cl.length) bits.push(`${cl.length}-row links stored`);
            mapEl.innerHTML = bits.length
                ? '<span class="text-emerald-600">● ' + bits.join(' · ') + '</span>'
                : '<span class="text-slate-400">● none stored yet</span>';
        }
    },

    async importSurghubJson(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        const statusEl = document.getElementById('surghub-import-status');
        if (statusEl) statusEl.innerHTML = '<span style="color:#059669">Loading…</span>';
        try {
            const text = await file.text();
            const snapshot = JSON.parse(text);

            // Support both new format (_type: 'surghub_snapshot') and old format (data/history/ambassadors/uniqueUsers)
            const keys = ['surghub_data','surghub_history','surghub_ambassadors','surghub_unique_users','surghub_anon_users','surghub_user_courses','surghub_user_certs','surghub_signup_demo','surghub_signup_survey_url','surghub_email_demo','surghub_social','surghub_completion','surghub_selected_testimonials'];
            if (snapshot._type === 'surghub_snapshot') {
                for (const k of keys) {
                    if (snapshot[k] != null) await Storage.setItem(k, snapshot[k]);
                }
            } else if (snapshot.data || snapshot.history) {
                // Old format: map old keys to new storage keys
                const oldToNew = {
                    data: 'surghub_data', history: 'surghub_history',
                    ambassadors: 'surghub_ambassadors', uniqueUsers: 'surghub_unique_users',
                    anon_users: 'surghub_anon_users', email_demo: 'surghub_email_demo',
                    social: 'surghub_social',
                    completion: 'surghub_completion',
                    selected_testimonials: 'surghub_selected_testimonials'
                };
                for (const [oldKey, newKey] of Object.entries(oldToNew)) {
                    if (snapshot[oldKey] != null) await Storage.setItem(newKey, snapshot[oldKey]);
                }
            } else {
                throw new Error('Not a recognised SURGhub snapshot file.');
            }
            // Mark SURGhub local state as newer than the cloud so the auto-pull
            // on the next launch doesn't silently overwrite this import with a
            // stale Sheets copy. Cleared on the next successful _syncToSheets push.
            const localImportAt = new Date().toISOString();
            await Storage.setItem('surghub_local_mtime', localImportAt);
            await Storage.setItem('surghub_unsynced_local', true);
            console.log('[SURGhub] Local import recorded at', localImportAt, '— will block pull overwrite until next Sync to Sheets.');
            // Reload ALL data into memory
            const stored = await Storage.getItem('surghub_data');
            if (stored) this.data = stored;
            const hist = await Storage.getItem('surghub_history');
            if (hist) this.userHistory = hist;
            const amb = await Storage.getItem('surghub_ambassadors');
            if (amb) this.ambassadorData = amb;
            const users = await Storage.getItem('surghub_unique_users');
            if (users) this.platformUniqueUsers = parseInt(users);
            const anon = await Storage.getItem('surghub_anon_users');
            if (anon) this._rawAnonymizedUsers = anon;
            this._anonLoadPromise = null;
            // Completion isn't reloaded here — invalidate the lazy cache so the next
            // reader (Performance tab / report) re-reads the freshly-imported value
            // instead of serving a stale empty array loaded earlier this session.
            this._rawCompletion = null; this._completionLoadPromise = null;
            const emailDemo = await Storage.getItem('surghub_email_demo');
            if (emailDemo) this._emailDemoMap = emailDemo;

            // Build summary of what was loaded
            const parts = [];
            if (stored) parts.push(stored.length + ' courses');
            if (anon) parts.push(anon.length + ' users with demographics');
            if (hist) parts.push('history');
            if (amb) parts.push('ambassadors');

            this.view = 'platform';
            this.renderView();
            this.showMsg('SURGhub data loaded ✓' + (parts.length ? ' — ' + parts.join(', ') : '') + ' · Click Sync to push to Google Sheets so the cloud copy is updated too');
            // Mark app dirty so the user sees the unsaved-changes indicator
            if (this.markDirty) this.markDirty();
        } catch(e) {
            if (statusEl) statusEl.innerHTML = `<span style="color:#dc2626">⚠ ${e.message}</span>`;
            console.error('SURGhub import error:', e);
        }
    },

    async clearAllData() {
        if(confirm("Are you sure you want to clear all local data? This will wipe the database.")) {
            await Storage.clear();
            localStorage.clear();
            this.data = [];
            this.userHistory = [];
            this.ambassadorData = null;
            this.platformUniqueUsers = 0;
            this.navigate('manage');
        }
    },

    // Wipe ONLY SURGhub analytics data. Leaves SURGfund project data and the
    // LearnWorlds API credentials intact, so everything can be repopulated via
    // Data Sync (Quick Sync + Refresh Courses) without re-entering credentials.
    async wipeSurghubData() {
        const msg =
            "Wipe ALL SURGhub analytics data only?\n\n" +
            "DELETES locally:\n" +
            "  • Courses, learners, certificates\n" +
            "  • Learner demographics & audience history\n" +
            "  • Ambassador / referral data\n" +
            "  • Social activity & course-completion detail\n" +
            "  • Testimonial selections\n\n" +
            "PRESERVED:\n" +
            "  • All SURGfund project data (KPIs, activities, facilities, budgets)\n" +
            "  • Your LearnWorlds API credentials\n\n" +
            "You can repopulate everything from Data Sync → Sync Courses + Sync Learners.\n\n" +
            "Continue?";
        if (!confirm(msg)) return;

        // Optional safety: offer to export a snapshot first.
        if (confirm("Export a SURGhub snapshot (.json) backup first? (Recommended)\n\nOK = export then wipe · Cancel = wipe without backup")) {
            try { await this.exportSurghubJson(); } catch (e) { console.warn('Pre-wipe export skipped:', e); }
        }

        const keys = [
            'surghub_data', 'surghub_history', 'surghub_ambassadors', 'surghub_unique_users',
            'surghub_anon_users', 'surghub_user_courses', 'surghub_user_certs', 'surghub_signup_demo',
            'surghub_email_demo', 'surghub_social', 'surghub_completion',
            'surghub_selected_testimonials',
            // Internal sync-state flags (so a fresh sync starts clean)
            'surghub_local_mtime', 'surghub_unsynced_local', 'surghub_last_synced'
        ];
        try {
            for (const k of keys) {
                await Storage.removeItem(k);
                // Belt-and-braces: clear any legacy localStorage remnant too
                try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
            }
            // Reset in-memory SURGhub state
            this.data = [];
            this.userHistory = [];
            this.ambassadorData = null;
            this.platformUniqueUsers = 0;
            this._rawAnonymizedUsers = null;
            this._emailDemoMap = null;
            this._rawSocial = null;
            this._rawCompletion = null;

            this.showMsg('SURGhub data wiped ✓ — projects & API credentials preserved. Run Sync Courses + Sync Learners to repopulate.');
            this.view = 'platform';
            this.renderView();
        } catch (e) {
            console.error('wipeSurghubData error:', e);
            alert('Wipe error: ' + e.message);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => window.App.init());