// === SURGhub Milestones ===
// Hand-recorded platform milestones: reach thresholds, course launches, partnerships,
// grants, recognition, media. The synced LearnWorlds data says WHAT the numbers are;
// this says WHAT HAPPENED — the narrative spine for grant reports and showcases.
//
// Storage: 'surghub_milestones' → surghub/milestones.json
//   · named surghub_* on purpose, so it rides the Sheets push AND comes back on a pull
//     (genericViews._pullFromSheets only restores keys starting with 'surghub_'),
//     and so it sits in a directory the cross-restart dirty scan actually walks
//     (app.js _hasUnsyncedChanges checks surghub/, projects/, settings/ — never other/).
//   · every write sets surghub_unsynced_local + surghub_local_mtime, exactly as
//     handleDbSave does, so a background auto-pull can't clobber typed-in text with
//     an older cloud copy.
//   · deliberately NOT in App.wipeSurghubData's key list: that wipe exists to force a
//     clean re-sync of DERIVED data. Milestones are typed by hand and unrecoverable,
//     so they survive it. They ARE in the snapshot export/import lists, so viewers
//     who load a shared snapshot see them.

Object.assign(window.App, {

    MILESTONE_KEY: 'surghub_milestones',

    // Category vocabulary. Keys are stored; labels/icons/colours are presentation.
    MILESTONE_CATEGORIES: {
        reach:       { label: 'Reach',          icon: 'trending-up',   color: '#206095' },
        course:      { label: 'Course launch',  icon: 'book-open',     color: '#5B8C5A' },
        partnership: { label: 'Partnership',    icon: 'handshake',     color: '#7B4FA0' },
        funding:     { label: 'Funding',        icon: 'banknote',      color: '#B87333' },
        recognition: { label: 'Recognition',    icon: 'award',         color: '#E0A93F' },
        media:       { label: 'Media',          icon: 'newspaper',     color: '#0F7B8A' },
        event:       { label: 'Event',          icon: 'calendar-days', color: '#C4534F' },
        platform:    { label: 'Platform',       icon: 'settings-2',    color: '#475569' },
        other:       { label: 'Other',          icon: 'flag',          color: '#94A3B8' },
    },

    // ── Data access ────────────────────────────────────────────────────────────

    // True when milestones.json exists on disk but could not be read (bad JSON, bad
    // permissions). Storage.getItem swallows that and returns null, which would read as
    // "no milestones yet" — and the next save would then overwrite the file with a single
    // record, destroying the rest. So detect it, surface it, and refuse to write.
    _milestoneFileUnreadable(rawValue) {
        if (rawValue != null) return false;
        try {
            const fs = electronAPI.fs, path = electronAPI.path;
            return !!fs.existsSync(path.join(Storage.DATA_DIR, 'surghub', 'milestones.json'));
        } catch (e) { return false; }
    },

    async getMilestones() {
        const raw = await Storage.getItem(this.MILESTONE_KEY);
        this._milestonesUnreadable = this._milestoneFileUnreadable(raw);
        const list = raw || [];
        if (!Array.isArray(list)) { this._milestones = []; return []; }
        // Backfill ids on anything hand-edited in the JSON file.
        let mutated = false;
        list.forEach((m, i) => {
            if (!m.id) { m.id = 'ms-' + Date.now().toString(36) + '-' + i + '-' + Math.random().toString(36).slice(2, 6); mutated = true; }
        });
        if (mutated) await this._writeMilestones(list);
        list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
        this._milestones = list;
        return list;
    },

    async _writeMilestones(list) {
        if (this._milestonesUnreadable) {
            this.showMsg('milestones.json could not be read — refusing to write, so the existing file is not overwritten. Fix or move ' + (Storage.DATA_DIR || '') + '/surghub/milestones.json, then reload.', true);
            throw new Error('milestones store unreadable');
        }
        await Storage.setItem(this.MILESTONE_KEY, list);
        // Same guard handleDbSave uses: local SURGhub data is now ahead of the cloud.
        try {
            await Storage.setItem('surghub_unsynced_local', true);
            await Storage.setItem('surghub_local_mtime', new Date().toISOString());
        } catch (e) { console.warn('[Milestones] dirty-flag write failed:', e); }
        this._milestones = list;
        return list;
    },

    async saveMilestone(rec) {
        const list = await this.getMilestones();
        const id = rec.id || 'ms-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
        const clean = {
            id,
            date:     String(rec.date || '').slice(0, 10),
            title:    String(rec.title || '').trim(),
            body:     String(rec.body || '').trim(),
            category: this.MILESTONE_CATEGORIES[rec.category] ? rec.category : 'other',
            value:    String(rec.value || '').trim(),
            link:     String(rec.link || '').trim(),
            featured: !!rec.featured,
        };
        if (rec.auto) clean.auto = String(rec.auto);   // marks a suggestion as taken
        const idx = list.findIndex(m => m.id === id);
        if (idx >= 0) clean.auto = clean.auto || list[idx].auto;
        if (idx >= 0) list[idx] = clean; else list.push(clean);
        list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
        await this._writeMilestones(list);
        return list;
    },

    async deleteMilestone(id) {
        const list = await this.getMilestones();
        const idx = list.findIndex(m => m.id === id);
        if (idx === -1) return list;
        const removed = list.splice(idx, 1)[0];
        await this._writeMilestones(list);
        if (this._editingMilestoneId === id) this._editingMilestoneId = null;
        this.renderView();
        this.showUndo('Milestone deleted', async () => {
            const cur = await this.getMilestones();
            cur.splice(idx, 0, removed);
            await this._writeMilestones(cur);
            this.renderView();
        });
        return list;
    },

    // Synchronous read for surfaces that can't await (dashboard strip, workbook).
    // Kicks a one-time load and re-renders when it lands — same pattern as the
    // lazy blobs elsewhere. Returns [] until then.
    milestonesCached() {
        if (Array.isArray(this._milestones)) return this._milestones;
        if (this._milestones === undefined) {
            this._milestones = null;
            try {
                Storage.getItem(this.MILESTONE_KEY).then(v => {
                    this._milestonesUnreadable = this._milestoneFileUnreadable(v);
                    this._milestones = Array.isArray(v) ? v.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))) : [];
                    // Don't yank the DOM out from under someone mid-sentence: skip the
                    // catch-up render while a milestone field has focus.
                    const inForm = document.activeElement && String(document.activeElement.id || '').startsWith('ms-');
                    if ((this._milestones.length || this._milestonesUnreadable) && !inForm) this.renderView();
                }).catch(() => {
                    // Reset rather than latch an empty array: a failed read must not look
                    // like "no milestones" for the rest of the session. The next render
                    // retries (nothing here re-renders, so this cannot loop).
                    this._milestones = undefined;
                });
            } catch (e) {
                this._milestones = undefined;   // synchronous throw: let the next render retry
            }
        }
        return [];
    },

    // ── Suggestions derived from the synced data ───────────────────────────────
    // Thresholds the platform has actually crossed, with the month it happened.
    // Purely a data-entry aid: nothing is recorded until the user clicks Record.
    _milestoneSuggestions() {
        const out = [];
        try {
            // Bypass the dashboard's "exclude courses with < 50 learners" toggle —
            // a milestone date must not depend on a checkbox (same idiom as the
            // master workbook builder). Two bases, matching what the app itself shows:
            //   platform snap (incl. active-but-private) → certificates + enrolments,
            //   analytics snap (included courses only)    → the course count,
            // so neither suggestion contradicts the dashboard it sits next to.
            const wasHide = this.hideLowLearners; this.hideLowLearners = false;
            const snap    = (this.getPlatformSnap  ? this.getPlatformSnap()  : []) || [];
            const snapInc = (this.getAnalyticsSnap ? this.getAnalyticsSnap() : []) || [];
            this.hideLowLearners = wasHide;
            const parse = (window.Charts && window.Charts.safeParse)
                ? (s) => window.Charts.safeParse(s)
                : (s) => { try { return JSON.parse(s) || {}; } catch (e) { return {}; } };
            const scale = (window.Charts && window.Charts.getScaledTimeline)
                ? (t) => window.Charts.getScaledTimeline(t, true)
                : (t) => parse(t);

            // Monthly new-signup counts live on the newest audience row.
            const aud = (this.userHistory || []).slice()
                .sort((a, b) => String(b.Timestamp || '').localeCompare(String(a.Timestamp || '')))[0] || null;
            const signups = (aud && aud.Signups) ? parse(aud.Signups) : {};

            // Certificates + enrolments by month, summed over every course timeline.
            const certMonth = {}, enrolMonth = {};
            snap.forEach(d => {
                if (!d.CourseTimeline) return;
                const sc = scale(d.CourseTimeline) || {};
                Object.keys(sc).forEach(m => {
                    certMonth[m]  = (certMonth[m]  || 0) + ((sc[m] && sc[m].c) || 0);
                    enrolMonth[m] = (enrolMonth[m] || 0) + ((sc[m] && sc[m].e) || 0);
                });
            });

            // Courses going live, by month (CourseCreated on the course record).
            const courseMonth = {};
            snapInc.forEach(d => {
                const cc = d.CourseCreated ? String(d.CourseCreated).slice(0, 7) : '';
                if (/^\d{4}-\d{2}$/.test(cc)) courseMonth[cc] = (courseMonth[cc] || 0) + 1;
            });

            // First month at which the running total reaches each threshold.
            const crossings = (monthly, thresholds) => {
                const months = Object.keys(monthly).filter(m => /^\d{4}-\d{2}$/.test(m)).sort();
                const hits = [];
                let run = 0;
                months.forEach(m => {
                    const prev = run;
                    run += Number(monthly[m]) || 0;
                    thresholds.forEach(t => { if (prev < t && run >= t) hits.push({ t, m }); });
                });
                return hits;
            };
            const monthName = (m) => {
                const d = new Date(m + '-02T12:00:00');
                return isNaN(d) ? m : d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
            };
            const fmt = (n) => this.formatNumber(n);

            // note: enrolment/certificate months come from the SCALED course timelines —
            // the totals are reconciled to the official figures but the month a
            // threshold falls in is approximate, so the wording says so.
            const specs = [
                { monthly: signups,     thr: [1000, 5000, 10000, 25000, 50000, 75000, 100000, 150000, 200000], cat: 'reach',
                  key: 'registered-learners', word: (t) => 'passed ' + fmt(t) + ' registered learners',
                  src: 'monthly signup dates', exact: true },
                { monthly: enrolMonth,  thr: [10000, 25000, 50000, 100000, 250000, 500000], cat: 'reach',
                  key: 'course-enrolments', word: (t) => 'passed ' + fmt(t) + ' course enrolments',
                  src: 'the course growth timelines' },
                { monthly: certMonth,   thr: [1000, 5000, 10000, 25000, 50000, 100000], cat: 'reach',
                  key: 'certificates', word: (t) => 'passed ' + fmt(t) + ' certificates awarded',
                  src: 'the course growth timelines' },
                { monthly: courseMonth, thr: [25, 50, 100, 150, 200, 250], cat: 'course',
                  key: 'courses', word: (t) => 'reached ' + t + ' courses in the catalogue',
                  src: 'course creation dates in LearnWorlds (the date a course was created, which may pre-date its launch)', raw: true },
            ];
            specs.forEach(sp => {
                crossings(sp.monthly, sp.thr).forEach(h => {
                    out.push({
                        auto: sp.cat + ':' + sp.key + ':' + h.t,
                        date: h.m + '-01',
                        month: h.m,
                        category: sp.cat,
                        title: 'SURGhub ' + sp.word(h.t),
                        value: sp.raw ? String(h.t) : fmt(h.t),
                        body: monthName(h.m) + ', from ' + sp.src + '.'
                            + (sp.exact ? ' Dated to the 1st — edit if you know the exact day.'
                                        : ' Month is approximate (the totals are exact, the monthly split is reconciled) — edit if you know the exact day.'),
                    });
                });
            });
        } catch (e) { console.warn('[Milestones] suggestion build failed:', e); }
        out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
        return out;
    },

    // ── The Milestones view ───────────────────────────────────────────────────
    // Synchronous on purpose: renderView() falls through to a shared tail that
    // strips the fade class, builds the lucide icons, and disables every form
    // control in viewer mode. An async paint would land after that tail had run.
    renderSurghubMilestones(body) {
        const list = this.milestonesCached();
        const CATS = this.MILESTONE_CATEGORIES;
        const today = new Date().toISOString().slice(0, 10);
        const esc = (s) => this.escapeHtml(String(s == null ? '' : s));

        const editing = this._editingMilestoneId ? list.find(m => m.id === this._editingMilestoneId) : null;
        const pf = (f, fb = '') => editing ? (editing[f] !== undefined && editing[f] !== null ? editing[f] : fb) : fb;

        // Suggestions not already recorded (matched on the auto key, so a recorded
        // one never comes back — even after the title is edited).
        const taken = new Set(list.map(m => m.auto).filter(Boolean));
        const suggestions = this._milestoneSuggestions().filter(s => !taken.has(s.auto)).slice(0, 8);
        this._milestoneSuggestCache = suggestions;

        const catOptions = Object.entries(CATS)
            .map(([k, v]) => `<option value="${k}" ${pf('category', 'reach') === k ? 'selected' : ''}>${v.label}</option>`).join('');

        const editBanner = editing ? `
            <div class="flex items-center gap-3 mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
                <i data-lucide="pencil" width="14" class="text-amber-600 shrink-0"></i>
                <p class="text-sm text-amber-800 font-medium flex-1">Editing: <strong>${esc(editing.title)}</strong></p>
                <button onclick="App._editingMilestoneId=null; App.renderView()" class="text-xs text-amber-600 hover:text-amber-800 font-bold">Cancel</button>
            </div>` : '';

        const form = `
            ${editBanner}
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div class="sm:col-span-2">
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Title *</label>
                    <input type="text" id="ms-title" value="${esc(pf('title'))}" placeholder="e.g. SURGhub passed 50,000 registered learners" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Date *</label>
                    <input type="date" id="ms-date" value="${esc(pf('date', today))}" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Category</label>
                    <select id="ms-category" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30">${catOptions}</select>
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Headline figure <span class="font-normal text-slate-400 normal-case">(optional)</span></label>
                    <input type="text" id="ms-value" value="${esc(pf('value'))}" placeholder="e.g. 50,000 · 22 countries · $1.2M" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Link <span class="font-normal text-slate-400 normal-case">(optional)</span></label>
                    <input type="url" id="ms-link" value="${esc(pf('link'))}" placeholder="https://…" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30" />
                </div>
                <div class="sm:col-span-2">
                    <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Details</label>
                    <textarea id="ms-body" rows="3" placeholder="What happened, who was involved, why it matters…" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30 resize-y">${esc(pf('body'))}</textarea>
                </div>
                <div class="sm:col-span-2">
                    <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                        <input type="checkbox" id="ms-featured" ${pf('featured') ? 'checked' : ''} class="rounded border-slate-300 text-gsf-boston focus:ring-gsf-boston/30" />
                        <i data-lucide="star" width="13" class="text-amber-500"></i> Highlight — pin to the top of the dashboard strip and flag it in exports
                    </label>
                </div>
            </div>
            <div class="flex items-center gap-3">
                <button onclick="App._saveMilestoneForm()" class="px-6 py-2.5 bg-gsf-boston text-white rounded-lg text-sm font-bold hover:bg-gsf-prussian transition-colors">${editing ? 'Save Changes' : 'Record Milestone'}</button>
                ${editing ? '<button onclick="App._editingMilestoneId=null; App.renderView()" class="text-xs text-slate-400 hover:text-slate-600 font-bold">Cancel</button>' : ''}
            </div>`;

        const suggestBlock = suggestions.length === 0 ? '' : `
            <div class="bg-sky-50/60 border border-sky-200 rounded-xl p-5 mb-8" data-edit-only>
                <div class="flex items-center gap-2 mb-1">
                    <i data-lucide="sparkles" width="15" class="text-sky-600"></i>
                    <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide">Suggested from your data</h2>
                    <span class="text-[10px] font-bold uppercase text-sky-700 bg-sky-100 border border-sky-200 px-2 py-0.5 rounded-full">${suggestions.length}</span>
                </div>
                <p class="text-xs text-slate-500 mb-4">Thresholds the platform has already crossed, with the month it happened. Nothing is saved until you click Record — then it disappears from this list.</p>
                <div class="space-y-2">
                    ${suggestions.map((s, i) => `
                        <div class="flex items-center gap-3 bg-white border border-sky-100 rounded-lg px-3 py-2">
                            <i data-lucide="${CATS[s.category].icon}" width="14" style="color:${CATS[s.category].color}" class="shrink-0"></i>
                            <div class="min-w-0 flex-1">
                                <p class="text-sm font-semibold text-gsf-prussian truncate">${esc(s.title)}</p>
                                <p class="text-[11px] text-slate-400">${esc(s.body.replace(/,.*$/, ''))}</p>
                            </div>
                            <button onclick="App._recordMilestoneSuggestion(${i})" class="shrink-0 px-3 py-1.5 bg-white border border-sky-300 text-sky-700 text-xs font-bold rounded-lg hover:bg-sky-50">Record</button>
                        </div>`).join('')}
                </div>
            </div>`;

        // Timeline, newest first, grouped by year.
        const years = [...new Set(list.map(m => String(m.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
        const card = (m) => {
            const c = CATS[m.category] || CATS.other;
            return `
            <div class="relative pl-7 pb-6 ml-[6px] border-l-2 border-slate-100 last:border-transparent last:pb-0">
                <span class="absolute -left-[7px] top-1 w-3 h-3 rounded-full border-2 border-white shadow" style="background:${c.color}"></span>
                <div class="flex items-start gap-3 flex-wrap">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2 flex-wrap mb-0.5">
                            <span class="text-[11px] font-bold uppercase tracking-wide text-slate-400">${esc(this.formatDate(m.date))}</span>
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase" style="background:${c.color}15;color:${c.color}"><i data-lucide="${c.icon}" width="9"></i> ${c.label}</span>
                            ${m.featured ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-amber-50 text-amber-700 border border-amber-200"><i data-lucide="star" width="9"></i> Highlight</span>' : ''}
                        </div>
                        <p class="text-sm font-bold text-gsf-prussian">${esc(m.title)}${m.value ? ` <span class="ml-1 text-xs font-black" style="color:${c.color}">${esc(m.value)}</span>` : ''}</p>
                        ${m.body ? `<p class="text-sm text-slate-600 mt-1 leading-relaxed whitespace-pre-line">${esc(m.body)}</p>` : ''}
                        ${m.link ? `<a href="#" onclick="electronAPI.openExternal('${this.escapeJsArg(m.link)}'); return false" class="inline-flex items-center gap-1 text-xs text-gsf-boston hover:underline mt-1"><i data-lucide="link-2" width="11"></i> Open link</a>` : ''}
                    </div>
                    <div class="shrink-0 flex items-center gap-2" data-edit-only>
                        <button onclick="App._editMilestone('${m.id}')" class="text-gsf-boston hover:text-gsf-prussian text-xs font-bold">Edit</button>
                        <button onclick="App._confirmDeleteMilestone('${m.id}')" class="text-red-400 hover:text-red-600 text-xs font-bold">Delete</button>
                    </div>
                </div>
            </div>`;
        };

        const timeline = list.length === 0 ? `
            <div class="bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center">
                <i data-lucide="milestone" width="26" class="text-slate-300 mx-auto mb-3"></i>
                <p class="text-sm font-bold text-gsf-prussian mb-1">No milestones recorded yet</p>
                <p class="text-xs text-slate-500 max-w-md mx-auto">Record the moments the numbers alone don't show — a partnership signed, a course series launched, a grant awarded, a reach threshold crossed. ${(this.editUnlocked && suggestions.length) ? 'The suggestions above are the quickest way to start.' : ''}</p>
            </div>` : years.map(y => `
            <div class="mb-8">
                <div class="flex items-center gap-3 mb-4">
                    <h2 class="text-lg font-black text-gsf-prussian">${y}</h2>
                    <span class="text-[10px] font-bold uppercase text-slate-400">${list.filter(m => String(m.date || '').startsWith(y)).length} milestone${list.filter(m => String(m.date || '').startsWith(y)).length === 1 ? '' : 's'}</span>
                    <span class="flex-1 h-px bg-slate-200"></span>
                </div>
                ${list.filter(m => String(m.date || '').startsWith(y)).map(card).join('')}
            </div>`).join('');

        // Loud, honest banner if the store is on disk but unreadable — recording is
        // blocked in that state rather than silently starting a fresh (empty) list.
        const unreadable = this._milestonesUnreadable ? `
            <div class="bg-red-50 border border-red-200 rounded-xl p-5 mb-6">
                <div class="flex items-start gap-3">
                    <i data-lucide="alert-octagon" width="18" class="text-red-600 mt-0.5 shrink-0"></i>
                    <div>
                        <p class="text-sm font-bold text-red-800">milestones.json exists but could not be read</p>
                        <p class="text-xs text-red-700 mt-1">Recording is disabled so the file is not overwritten and its contents lost. The file is at <code class="bg-white/70 px-1 rounded">${esc(Storage.DATA_DIR || '')}/surghub/milestones.json</code> — fix or move it, then reload the app. A snapshot export or Sheets backup can also restore it.</p>
                    </div>
                </div>
            </div>` : '';

        body.innerHTML = `
            <div class="p-6 md:p-10 fade-in w-full max-w-4xl mx-auto">
                ${window.GenericViews ? window.GenericViews._viewerNotice('Milestones are read-only in view mode. Unlock editing to record or change them.') : ''}
                ${unreadable}
                <header class="mb-6">
                    <h1 class="text-2xl font-bold text-gsf-prussian">Milestones</h1>
                    <p class="text-sm text-slate-500 mt-1">The SURGhub story alongside the numbers — reach thresholds, launches, partnerships, grants, recognition. Recorded by hand, kept with the platform data, and included in the snapshot you share with viewers.</p>
                </header>

                <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-8" data-edit-only>
                    <h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide mb-4">${editing ? 'Edit milestone' : 'Record a milestone'}</h2>
                    ${form}
                </div>

                ${suggestBlock}
                ${timeline}
            </div>`;
    },

    // ── Form handlers ─────────────────────────────────────────────────────────

    async _saveMilestoneForm() {
        const g = (id) => document.getElementById(id);
        const date  = g('ms-date')?.value || '';
        const title = (g('ms-title')?.value || '').trim();
        if (!date || !title) { this.showMsg('Date and title are required.', true); return; }
        await this.saveMilestone({
            id:       this._editingMilestoneId || null,
            date, title,
            category: g('ms-category')?.value || 'other',
            value:    g('ms-value')?.value || '',
            link:     g('ms-link')?.value || '',
            body:     g('ms-body')?.value || '',
            featured: !!g('ms-featured')?.checked,
        });
        this._editingMilestoneId = null;
        this.showMsg('Milestone saved ✓');
        this.renderView();
    },

    _editMilestone(id) {
        this._editingMilestoneId = id;
        this.view = 'sh-milestones';
        this.renderView();
        setTimeout(() => { const el = document.getElementById('ms-title'); if (el) { el.focus(); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, 60);
    },

    _confirmDeleteMilestone(id) {
        const m = (this._milestones || []).find(x => x.id === id);
        if (!confirm('Delete this milestone?\n\n' + (m ? m.title : '') + '\n\nYou can undo straight after.')) return;
        this.deleteMilestone(id);
    },

    // Record a suggestion as-is (the user can edit it afterwards like any other).
    async _recordMilestoneSuggestion(i) {
        const s = (this._milestoneSuggestCache || [])[i];
        if (!s) return;
        await this.saveMilestone({
            date: s.date, title: s.title, category: s.category,
            value: s.value, body: s.body, auto: s.auto, featured: false,
        });
        this.showMsg('Milestone recorded ✓ — edit the date or wording any time');
        this.renderView();
    },

    // ── Dashboard strip ───────────────────────────────────────────────────────
    // Renders nothing at all until at least one milestone exists, so the
    // dashboard is unchanged for anyone who never uses the feature.
    _milestoneStripHtml() {
        const all = this.milestonesCached();
        if (!all.length) return '';
        const CATS = this.MILESTONE_CATEGORIES;
        const esc = (s) => this.escapeHtml(String(s == null ? '' : s));
        // Highlights first, then most recent; at most 4.
        const picked = all.slice().sort((a, b) => (Number(!!b.featured) - Number(!!a.featured))
            || String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 4);
        return `
            <div class="bg-white border rounded-xl shadow-sm p-5 mb-8">
                <div class="flex items-center gap-2 mb-4">
                    <i data-lucide="milestone" width="15" class="text-gsf-boston"></i>
                    <h2 class="font-bold text-sm text-gsf-prussian uppercase tracking-wide">Milestones</h2>
                    <span class="text-xs text-slate-400">${all.length} recorded</span>
                    <button onclick="App.navigate('sh-milestones')" class="ml-auto text-xs font-bold text-gsf-boston hover:underline">View all →</button>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    ${picked.map(m => {
                        const c = CATS[m.category] || CATS.other;
                        return `<button onclick="App.navigate('sh-milestones')" class="text-left border border-slate-200 rounded-lg p-3 hover:border-slate-300 hover:bg-slate-50 transition-colors">
                            <div class="flex items-center gap-1.5 mb-1.5">
                                <i data-lucide="${c.icon}" width="11" style="color:${c.color}"></i>
                                <span class="text-[9px] font-bold uppercase tracking-wide" style="color:${c.color}">${c.label}</span>
                                ${m.featured ? '<i data-lucide="star" width="9" class="text-amber-500"></i>' : ''}
                            </div>
                            <p class="text-xs font-bold text-gsf-prussian leading-snug line-clamp-2">${esc(m.title)}</p>
                            <p class="text-[10px] text-slate-400 mt-1">${esc(this.formatDate(m.date))}</p>
                        </button>`;
                    }).join('')}
                </div>
            </div>`;
    },

    // ── Export rows (Master workbook "Milestones" tab) ─────────────────────────
    _milestoneExportRows() {
        const all = this.milestonesCached();
        const CATS = this.MILESTONE_CATEGORIES;
        return all.slice()
            .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
            .map(m => ({
                Date: m.date || '',
                Category: (CATS[m.category] || CATS.other).label,
                Milestone: m.title || '',
                'Headline Figure': m.value || '',
                Details: m.body || '',
                Link: m.link || '',
                Highlight: m.featured ? 'Yes' : '',
            }));
    },
});
