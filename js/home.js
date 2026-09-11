// ── Home: the screen the app opens on ──────────────────────────────────────
//
// One page that answers "what is the state of things?" before anyone picks a tab:
// the platform totals, what moved in the last seven days against the seven before,
// the courses behind that movement, anything that needs attention, and where the
// SURGfund portfolio stands. Every figure comes from data already on disk — Home
// never calls LearnWorlds and never triggers a sync.
//
// Two-stage paint. The hero, the actions and the attention list come from what is
// already in memory (the learner snapshots, the project registry, the app settings),
// so the page appears instantly. The seven-day figures need the completion rows
// (~60 MB), so they are built after first paint and cached device-locally
// (surgdash_home → settings/home.json, forward-only: never pushed, exported or
// restored). The cache is reused until the day turns or a sync writes new rows.
//
// The window is the digest's window — last 7 full days, yesterday back — so Home and
// the weekly digest never disagree about what "this week" means.
//
// Nothing here is personal data: course names, provider names and counts only. No
// learner names, no emails, no ambassador names. The page is marked data-no-export.
Object.assign(window.App, {

    HOME_KEY: 'surgdash_home',
    HOME_TOP: 5,
    HOME_SYNC_STALE_DAYS: 3,  // a background sync older than this is called out

    // ── the heavy figures ──────────────────────────────────────────────────
    // Stamp of the data the figures were built from: when it changes, the cache is
    // stale even on the same day (a sync during the day must show up on Home).
    async _homeSrcStamp() {
        let enrol = '';
        try { const m = this._enrLoadMeta ? await this._enrLoadMeta() : null; if (m) enrol = String(m.lastRun || ''); } catch (e) { __swallowed(e, 'home.stamp'); }
        const dates = this.getAvailableDates ? this.getAvailableDates() : [];
        return (dates[dates.length - 1] || '') + '|' + enrol;
    },

    async _homeLoad() { try { const d = await Storage.getItem(this.HOME_KEY); return (d && d.builtFor) ? d : null; } catch (e) { return null; } },
    async _homeStore(d) { this._homeStats = d; try { await Storage.setItem(this.HOME_KEY, d, { internal: true }); } catch (e) { __swallowed(e, 'home.store'); } },

    // Rolling seven-day figures, the courses behind them, and the SURGfund summary.
    // Cached per day + per data stamp; pass { force: true } to rebuild regardless.
    async buildHomeStats(opts) {
        opts = opts || {};
        const now = opts.now ? new Date(opts.now) : new Date();
        const today = this._digestIso(now);
        const stamp = await this._homeSrcStamp();
        if (!opts.force) {
            const c = this._homeStats || await this._homeLoad();
            if (c && c.builtFor === today && c.srcStamp === stamp) { this._homeStats = c; return c; }
        }
        const t0 = Date.now();
        const w = this._digestWindow(now);
        const rows = (this.ensureCompletionLoaded ? await this.ensureCompletionLoaded() : null) || this._rawCompletion || [];
        const inW = (d) => this._digestIn(d, w.from, w.to), inP = (d) => this._digestIn(d, w.prevFrom, w.prevTo);

        // Provider per course from that course's newest row (the same rule the digest uses).
        const provOf = {}, provAt = {};
        (this.data || []).forEach(r => {
            if (!r || r.IsShell || !r.Course || !r.Provider) return;
            const ts = String(r.Timestamp || '');
            if (!provAt[r.Course] || ts >= provAt[r.Course]) { provOf[r.Course] = r.Provider; provAt[r.Course] = ts; }
        });

        const counts = { enrol: 0, enrolPrev: 0, started: 0, startedPrev: 0, certs: 0, certsPrev: 0 };
        const byCourse = {};
        const bump = (course, k) => { const o = byCourse[course] || (byCourse[course] = { course, provider: provOf[course] || '', started: 0, certs: 0, enrol: 0 }); o[k]++; };
        for (const r of rows) {
            if (!r) continue;
            const e = r.enrolled_date || '', s = r.start_date || '', c = r.certificate ? (r.certificate_date || '') : '';
            if (inW(e)) { counts.enrol++; bump(r.course, 'enrol'); } else if (inP(e)) counts.enrolPrev++;
            if (inW(s)) { counts.started++; bump(r.course, 'started'); } else if (inP(s)) counts.startedPrev++;
            if (inW(c)) { counts.certs++; bump(r.course, 'certs'); } else if (inP(c)) counts.certsPrev++;
        }
        const courses = Object.values(byCourse)
            .sort((a, b) => (b.started - a.started) || (b.certs - a.certs) || a.course.localeCompare(b.course))
            .slice(0, this.HOME_TOP);

        // Sign-ups and logins from the hashed account index (no identities, only day stamps).
        const accounts = { newAcc: null, newAccPrev: null, active: null, activePrev: null };
        try {
            const idx = this._accountsLoad ? await this._accountsLoad() : null;
            if (idx && idx.byUid) {
                accounts.newAcc = 0; accounts.newAccPrev = 0; accounts.active = 0; accounts.activePrev = 0;
                for (const k of Object.keys(idx.byUid)) {
                    const a = idx.byUid[k]; if (!a) continue;
                    if (inW(a.c)) accounts.newAcc++; else if (inP(a.c)) accounts.newAccPrev++;
                    if (inW(a.l)) accounts.active++; else if (inP(a.l)) accounts.activePrev++;
                }
            }
        } catch (e) { __swallowed(e, 'home.accounts'); }

        const surgfund = await this._homeFundStats(w, now);

        const stats = {
            v: 1, builtFor: today, builtAt: now.toISOString(), srcStamp: stamp,
            from: w.from, to: w.to, prevFrom: w.prevFrom, prevTo: w.prevTo,
            counts, accounts, courses, surgfund, ms: Date.now() - t0,
        };
        await this._homeStore(stats);
        return stats;
    },

    // SURGfund: how many projects, what was edited this week, and how far this year's
    // KPI reporting has got. Reporting progress is the signal that exists for every
    // project — the activity log is optional and most projects never use it, so an
    // "untouched for N days" line would sit on Home permanently with no way to clear it.
    async _homeFundStats(w, now) {
        const year = now.getFullYear();
        const out = { projects: 0, kpiEdits: 0, activities: 0, lastTouched: '', year, reported: 0, missing: [] };
        try {
            if (!window.Projects || !Projects.registry) return out;
            const list = Projects.registry.filter(p => p.type === 'generic' && (this.includeSample || !p.isSample));
            out.projects = list.length;
            for (const p of list) {
                let last = '';
                try {
                    (await Projects.getKpiLog(p.id) || []).forEach(l => {
                        const d = this._digestDayOf(l.timestamp);   // KPI logs are not all ISO — see _digestDayOf
                        if (this._digestIn(d, w.from, w.to)) out.kpiEdits++;
                        if (d > last) last = d;
                    });
                } catch (e) { __swallowed(e, 'home.kpilog'); }
                try {
                    (await Projects.getEvents(p.id) || []).forEach(ev => {
                        const d = this._digestDayOf(ev.date);
                        if (this._digestIn(d, w.from, w.to)) out.activities++;
                        if (d > last) last = d;
                    });
                } catch (e) { __swallowed(e, 'home.events'); }
                if (last > out.lastTouched) out.lastTouched = last;
                // Reported for this year = an actuals row for `year` carrying at least one figure.
                let reported = false;
                try {
                    const row = (await Projects.getActuals(p.id) || []).find(a => a && Number(a.year) === year);
                    reported = !!(row && row.kpis && Object.values(row.kpis).some(v => v !== '' && v != null && !isNaN(Number(v))));
                } catch (e) { __swallowed(e, 'home.actuals'); }
                if (reported) out.reported++; else if (out.missing.length < 3) out.missing.push(p.shortName || p.name);
            }
        } catch (e) { __swallowed(e, 'home.fund'); }
        return out;
    },

    // ── what needs attention ───────────────────────────────────────────────
    // Cheap by design: everything here is already in memory or one small settings
    // read. Ordered most urgent first; an empty list is itself the good news.
    _homeAttention(ctx) {
        ctx = ctx || {};
        const items = [];
        const add = (tone, icon, text, label, fn) => items.push({ tone, icon, text, label: label || '', fn: fn || '' });

        // Nothing on this device yet — say so instead of reporting all-clear
        if (!ctx.dataThrough && !(this.data && this.data.length)) {
            add('warn', 'download-cloud', 'No SURGhub data on this device yet. Load it from the cloud or from a snapshot.', 'Get data', "App.homeGo('org','org-dashboard')");
            return items;
        }

        // Course data age
        const dataDate = ctx.dataThrough || '';
        if (dataDate) {
            const days = Math.round((this._digestDay(new Date()) - this._digestDay(new Date(dataDate + 'T00:00:00'))) / 86400000);
            if (days > 7) add('warn', 'clock-alert', 'Course data is ' + days + ' days old. Run the syncs on Data Sync.', 'Data Sync', "App.homeGo('surghub','upload')");
        }

        // Numbers that no longer reproduce from the raw captures
        const dv = this._deriveVerify;
        const failing = (dv && Array.isArray(dv.checks)) ? dv.checks.filter(c => c && !c.match && !c.noReceipt).length : 0;
        if (failing > 0) add('warn', 'alert-triangle', failing + ' number' + (failing === 1 ? '' : 's') + ' no longer reproduce' + (failing === 1 ? 's' : '') + ' from the raw captures. Re-derive on Data Sync.', 'Data health', "App.homeGo('surghub','upload','#data-health')");

        // Background sync health
        const bg = this._bgSettings || {};
        const lastRun = bg.lastRun || null;
        if (lastRun && lastRun.at) {
            const days = Math.round((this._digestDay(new Date()) - this._digestDay(new Date(lastRun.at))) / 86400000);
            if (!lastRun.ok) add('warn', 'refresh-cw-off', 'The last background sync did not finish. Open Data Sync to see which step failed.', 'Data Sync', "App.homeGo('surghub','upload')");
            else if (days > this.HOME_SYNC_STALE_DAYS) add('warn', 'refresh-cw-off', 'The background sync last completed ' + days + ' days ago.', 'Data Sync', "App.homeGo('surghub','upload')");
        }

        // Local changes not yet published
        if (ctx.unsynced) add('info', 'cloud-upload', 'Local changes have not been published to Google Sheets.', 'Sync to Sheets', 'App.syncNow()');

        // This year's KPI figures still missing across the portfolio
        const f = ctx.fund;
        if (f && f.projects && f.reported < f.projects) {
            const n = f.projects - f.reported;
            add('info', 'clipboard-list', f.year + ' KPI figures are still missing for ' + n + ' of ' + f.projects + ' project' + (f.projects === 1 ? '' : 's') + '.', 'Portfolio', "App.homeGo('org','org-dashboard')");
        }

        // A digest for the current week is waiting
        const d = this._digest;
        if (d && d.week && d.week === this._digestWeekKey(new Date())) add('info', 'newspaper', 'The weekly digest for ' + d.week + ' is ready to copy or email.', 'Open digest', "App.homeGo('surghub','upload','#weekly-digest')");

        return items;
    },

    // ── navigation ─────────────────────────────────────────────────────────
    homeGo(project, view, anchor) {
        this.currentProject = project;
        this.view = view;
        try { Storage.setItem('surgdash_last_project', project); } catch (e) { __swallowed(e, 'home.go'); }
        if (this.renderView) this.renderView();
        if (anchor) setTimeout(() => { const el = document.querySelector(anchor); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 120);
    },

    // "Continue where you left off" — the screen uiState remembered, if it still exists.
    _homeLastScreen() {
        const s = this._uiState && this._uiState._lastScreen;
        if (!s || !s.view || s.view === 'home') return null;
        const LABELS = {
            platform: 'SURGhub dashboard', provider: 'Providers', course: 'Courses', ambassadors: 'Ambassadors',
            'sh-milestones': 'Milestones', 'sh-reports': 'Reports', manage: 'Directory', upload: 'Data Sync', methodology: 'Methodology',
            'org-dashboard': 'Organisation overview', 'org-breakdown': 'Breakdown', 'org-calendar': 'Calendar', 'org-activities': 'Activities',
            'org-map': 'Map', 'org-methodology': 'Methodology', 'org-settings': 'Settings',
            'project-dashboard': 'Dashboard', 'project-calendar': 'Calendar', 'project-activities': 'Activities',
            'project-map': 'Map', 'project-reports': 'Reports', 'project-settings': 'Settings',
        };
        let where = LABELS[s.view] || s.view;
        if (s.project && s.project !== 'org' && s.project !== 'surghub' && window.Projects) {
            const p = Projects.getProject(s.project); if (!p) return null;
            where = (p.shortName || p.name) + ' · ' + where;
        }
        if (s.view === 'course' && s.course) where = 'Courses · ' + s.course;
        if (s.view === 'provider' && s.provider) where = 'Providers · ' + s.provider;
        return where;
    },
    homeContinue() {
        if (this._restoreLastScreen && this._restoreLastScreen()) { if (this.renderView) this.renderView(); return true; }
        this.homeGo('surghub', 'platform');
        return false;
    },

    // ── open on launch (device-local view preference) ──────────────────────
    _homeOnLaunch() { const s = this._uiState || {}; return s.homeOnLaunch !== false; },
    homeSetOnLaunch(on) {
        if (!this._uiState) return;
        this._uiState.homeOnLaunch = !!on;
        if (this._saveUiState) this._saveUiState();
        this.showMsg(on ? 'SURGdash will open on Home.' : 'SURGdash will open where you left off.', 'success');
    },

    async homeRefresh() {
        this.showMsg('Recalculating this week…', 'info');
        try {
            await this.buildHomeStats({ force: true });
            if (this.view === 'home' && this.renderView) this.renderView();
            this.showMsg('Home is up to date.', 'success');
        } catch (e) { this.showMsg('Could not recalculate: ' + (e && e.message || e), 'error'); }
    },

    // ── render ─────────────────────────────────────────────────────────────
    renderHome(main) {
        main.innerHTML = this._homeHtml(this._homeStats || null);
        if (window.lucide) lucide.createIcons();

        // First visit in this session: load the cache, then build if it is stale.
        if (!this._homeBuilding) {
            this._homeBuilding = true;
            (async () => {
                try {
                    if (this._homeStats === undefined || this._homeStats === null) {
                        const c = await this._homeLoad();
                        if (c) { this._homeStats = c; if (this.view === 'home') { main.innerHTML = this._homeHtml(c); if (window.lucide) lucide.createIcons(); } }
                    }
                    if (this._digest === undefined) { this._digest = await this._digestLoad(); }
                    try { this._homeApp = (window.Projects && Projects.getAppSettings) ? await Projects.getAppSettings() : {}; } catch (e) { __swallowed(e, 'home.settings'); }
                    const s = await this.buildHomeStats();
                    if (this.view === 'home') { const host = document.getElementById('view-body'); if (host) { host.innerHTML = this._homeHtml(s); if (window.lucide) lucide.createIcons(); } }
                } catch (e) { __swallowed(e, 'home.build'); }
                this._homeBuilding = false;
            })();
        }
    },

    _homeHtml(stats) {
        const esc = (t) => this.escapeHtml(String(t == null ? '' : t));
        const n = (v) => this.formatNumber(Math.round(Number(v) || 0));
        const hist = (this.userHistory || []).filter(h => h && h.Timestamp).slice().sort((a, b) => String(a.Timestamp).localeCompare(String(b.Timestamp)));
        const snap = hist[hist.length - 1] || {};
        const dates = this.getAvailableDates ? this.getAvailableDates() : [];
        const dataThrough = dates[dates.length - 1] || String(snap.Timestamp || '').slice(0, 10);
        const app = this._homeApp || {};
        const now = new Date();
        const fundCount = (window.Projects && Projects.registry)
            ? Projects.registry.filter(p => p.type === 'generic' && (this.includeSample || !p.isSample)).length : 0;

        // ── hero ──
        const bigStat = (value, label, muted) => `
            <div class="min-w-[120px]">
                <p class="gsf-stat text-[42px] ${muted ? 'text-slate-300' : 'text-gsf-prussian'}">${value}</p>
                <p class="text-[11px] font-bold uppercase tracking-wider text-slate-400 mt-1">${esc(label)}</p>
            </div>`;
        const hero = `
            <p class="gsf-eyebrow mb-3">Home · ${esc(now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</p>
            <div class="flex flex-wrap items-end gap-x-12 gap-y-5 mb-4">
                ${bigStat(snap.TotalUsers ? n(snap.TotalUsers) : '—', 'learners on SURGhub', !snap.TotalUsers)}
                ${bigStat(snap.TotalCertificates ? n(snap.TotalCertificates) : '—', 'certificates earned', !snap.TotalCertificates)}
                ${bigStat(n(fundCount), 'SURGfund project' + (fundCount === 1 ? '' : 's'), !fundCount)}
            </div>
            <p class="text-sm text-slate-500 mb-8">${esc(this._homeFreshnessLine(dataThrough, app))}</p>`;

        // ── this week ──
        const tile = (label, cur, prev, hint) => {
            if (cur == null) return `<div class="bg-white rounded-xl border shadow-sm p-4"><p class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">${esc(label)}</p><p class="text-[26px] font-bold leading-none tracking-tight text-slate-300 mt-2" style="font-family:var(--num)">…</p><p class="text-[11px] text-slate-300 mt-1.5">calculating</p></div>`;
            const pct = this._digestPct(cur, prev);
            const up = prev != null && cur > prev, down = prev != null && cur < prev;
            const tone = down ? 'text-amber-600' : (up ? 'text-green-600' : 'text-slate-400');
            const arrow = down ? '▼' : (up ? '▲' : '•');
            return `<div class="bg-white rounded-xl border shadow-sm p-4">
                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">${esc(label)}</p>
                <p class="text-[26px] font-bold leading-none tracking-tight text-gsf-prussian mt-2" style="font-family:var(--num)">${n(cur)}</p>
                <p class="text-[11px] mt-1.5 ${tone} font-semibold">${prev == null ? '<span class="text-slate-400">' + esc(hint || '') + '</span>' : arrow + ' ' + esc(pct) + ' <span class="text-slate-400 font-normal">· ' + n(prev) + ' before</span>'}</p>
            </div>`;
        };
        const c = (stats && stats.counts) || {}, a = (stats && stats.accounts) || {};
        const windowLabel = stats
            ? 'This week · ' + this._digestFmtDay(stats.from) + ' to ' + this._digestFmtDay(stats.to) + ', against the seven days before'
            : 'This week, against the seven days before';
        const week = `
            <div class="flex items-baseline justify-between gap-3 flex-wrap mb-3">
                <h2 class="text-sm font-bold text-gsf-prussian">${esc(windowLabel)}</h2>
                <button data-viewer-allowed onclick="App.homeRefresh()" class="text-[11px] font-semibold text-slate-400 hover:text-gsf-boston transition-colors">↻ Recalculate</button>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-10">
                ${tile('Courses opened', stats ? c.started : null, stats ? c.startedPrev : null)}
                ${tile('Enrolments', stats ? c.enrol : null, stats ? c.enrolPrev : null)}
                ${tile('Certificates', stats ? c.certs : null, stats ? c.certsPrev : null)}
                ${tile('New accounts', stats ? (a.newAcc == null ? 0 : a.newAcc) : null, stats ? a.newAccPrev : null, 'no account index yet')}
                ${tile('Logged in', stats ? (a.active == null ? 0 : a.active) : null, stats ? a.activePrev : null, 'no account index yet')}
            </div>`;

        // ── top courses ──
        const rows = (stats && stats.courses) || [];
        const topCourses = `
            <div class="bg-white rounded-xl border shadow-sm overflow-hidden">
                <div class="bg-slate-50 border-b px-5 py-3"><h2 class="text-sm font-bold text-gsf-prussian flex items-center gap-2"><i data-lucide="flame" width="15" class="text-gsf-boston"></i> Most opened this week</h2></div>
                ${!stats ? '<p class="px-5 py-4 text-sm text-slate-300 italic">Calculating…</p>'
                    : rows.length ? `<table class="w-full text-sm"><tbody>${rows.map(r => `
                        <tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer" onclick="App.openCourse('${this.escapeJsArg(r.course)}')">
                            <td class="px-5 py-2.5"><p class="font-medium text-gsf-prussian truncate">${esc(r.course)}</p><p class="text-[11px] text-slate-400 truncate">${esc(r.provider || 'Unknown provider')}</p></td>
                            <td class="px-5 py-2.5 text-right whitespace-nowrap"><span class="font-bold text-gsf-prussian">${n(r.started)}</span> <span class="text-[11px] text-slate-400">opened</span><br><span class="text-[11px] text-slate-400">${n(r.certs)} certificates</span></td>
                        </tr>`).join('')}</tbody></table>`
                    : '<p class="px-5 py-4 text-sm text-slate-400 italic">No course was opened in this window.</p>'}
            </div>`;

        // ── attention ──
        const items = this._homeAttention({ dataThrough, unsynced: !!(this.editUnlocked && this._unsyncedDirty), fund: (stats && stats.surgfund) || null });
        const toneCls = { warn: 'text-amber-600', info: 'text-gsf-boston' };
        const attention = `
            <div class="bg-white rounded-xl border shadow-sm overflow-hidden">
                <div class="bg-slate-50 border-b px-5 py-3"><h2 class="text-sm font-bold text-gsf-prussian flex items-center gap-2"><i data-lucide="bell" width="15" class="text-gsf-boston"></i> Needs attention</h2></div>
                ${items.length ? items.map(it => `
                    <div class="flex items-start gap-3 px-5 py-3 border-b border-slate-100 last:border-0">
                        <i data-lucide="${it.icon}" width="15" class="${toneCls[it.tone] || 'text-slate-400'} shrink-0 mt-0.5"></i>
                        <p class="text-[13px] text-slate-600 leading-relaxed flex-1">${esc(it.text)}</p>
                        ${it.fn ? `<button data-viewer-allowed onclick="${it.fn}" class="shrink-0 text-[11px] font-bold text-gsf-boston hover:text-gsf-prussian whitespace-nowrap">${esc(it.label)} →</button>` : ''}
                    </div>`).join('')
                    : `<div class="flex items-center gap-3 px-5 py-4"><i data-lucide="check-circle-2" width="16" class="text-green-600"></i><p class="text-[13px] text-slate-500">Nothing to flag. The data is fresh and consistent.</p></div>`}
            </div>`;

        // ── SURGfund ──
        const f = (stats && stats.surgfund) || null;
        const fund = `
            <div class="bg-white rounded-xl border shadow-sm overflow-hidden">
                <div class="bg-slate-50 border-b px-5 py-3 flex items-center justify-between gap-2">
                    <h2 class="text-sm font-bold text-gsf-prussian flex items-center gap-2"><i data-lucide="building-2" width="15" class="text-gsf-boston"></i> SURGfund</h2>
                    <button data-viewer-allowed onclick="App.homeGo('org','org-dashboard')" class="text-[11px] font-bold text-gsf-boston hover:text-gsf-prussian whitespace-nowrap">Portfolio →</button>
                </div>
                <div class="px-5 py-3.5 text-[13px] text-slate-600 leading-relaxed">
                    ${!f ? '<span class="text-slate-300 italic">Calculating…</span>' : `
                        ${n(f.projects)} project${f.projects === 1 ? '' : 's'} ·
                        ${f.kpiEdits || f.activities
                            ? n(f.kpiEdits) + ' KPI edit' + (f.kpiEdits === 1 ? '' : 's') + ' and ' + n(f.activities) + ' activit' + (f.activities === 1 ? 'y' : 'ies') + ' logged this week'
                            : 'nothing logged this week'}
                        ${f.lastTouched ? '<br><span class="text-slate-400">Last dated entry ' + esc(this._digestFmtDay(f.lastTouched)) + '</span>' : ''}
                        <br><span class="${f.reported < f.projects ? 'text-amber-600' : 'text-slate-400'}">${f.year} figures entered for ${n(f.reported)} of ${n(f.projects)}${(f.reported < f.projects && f.missing.length) ? ' · still to come: ' + esc(f.missing.join(', ')) + (f.projects - f.reported > f.missing.length ? ' and ' + n(f.projects - f.reported - f.missing.length) + ' more' : '') : ''}</span>
                    `}
                </div>
            </div>`;

        // ── actions ──
        const last = this._homeLastScreen();
        const btn = (fn, icon, label, primary, editOnly) => `<button ${editOnly ? 'data-edit-only' : 'data-viewer-allowed'} onclick="${fn}" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-bold transition-colors ${primary ? 'bg-gsf-prussian text-white hover:bg-gsf-boston' : 'bg-white border border-slate-200 text-slate-600 hover:border-gsf-boston hover:text-gsf-prussian'}"><i data-lucide="${icon}" width="14"></i> ${esc(label)}</button>`;
        const actions = `
            <div class="flex flex-wrap items-center gap-2 mt-10 pt-6 border-t border-slate-200">
                ${last ? btn('App.homeContinue()', 'arrow-right', 'Continue · ' + last, true) : btn("App.homeGo('surghub','platform')", 'arrow-right', 'Open the SURGhub dashboard', true)}
                ${btn('App.runFullSync()', 'refresh-cw', 'Sync everything', false, true)}
                ${btn("App.homeGo('surghub','upload')", 'database', 'Data Sync', false)}
                ${btn("App.homeGo('surghub','manage')", 'list', 'Directory', false)}
                <label class="ml-auto flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer select-none" title="Device-local — it changes nothing for anyone else">
                    <input type="checkbox" data-viewer-allowed ${this._homeOnLaunch() ? 'checked' : ''} onchange="App.homeSetOnLaunch(this.checked)" class="rounded border-slate-300 text-gsf-boston focus:ring-gsf-boston/30" />
                    Open Home on launch
                </label>
            </div>`;

        return `<div class="p-8 max-w-6xl mx-auto fade-in" data-no-export id="home-screen">
            ${hero}
            ${week}
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
                ${topCourses}
                <div class="flex flex-col gap-5">${attention}${fund}</div>
            </div>
            ${actions}
        </div>`;
    },

    // "Course data through 11 Sep · enrolments synced 09:52 · published to Sheets 11:35"
    _homeFreshnessLine(dataThrough, app) {
        const t = (iso) => { const d = iso ? new Date(iso) : null; return (d && !isNaN(d)) ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''; };
        const parts = [];
        parts.push('Course data through ' + (dataThrough ? this._digestFmtDay(dataThrough) : 'unknown'));
        const bg = this._bgSettings || {};
        const at = bg.lastRun && bg.lastRun.at ? new Date(bg.lastRun.at) : null;
        if (at && !isNaN(at)) {
            const days = Math.round((this._digestDay(new Date()) - this._digestDay(at)) / 86400000);
            parts.push('last sync ' + (days <= 0 ? t(bg.lastRun.at) : days === 1 ? 'yesterday' : days + ' days ago'));
        }
        const sh = app && app.googleSheetsLastSync;
        if (sh) {
            const d = new Date(sh);
            const days = Math.round((this._digestDay(new Date()) - this._digestDay(d)) / 86400000);
            parts.push('published to Sheets ' + (days <= 0 ? t(sh) : days === 1 ? 'yesterday' : days + ' days ago'));
        }
        return parts.join(' · ');
    },
});
