// ── Courses that started enrolling without a provider or survey link ────────────
//
// A course usually reaches SURGdash as a draft: no provider in the map, no survey link,
// often silenced in the triage list or unticked (excluded). When it is published,
// learners start enrolling — and that is the moment its provider and survey link are
// needed. This watches for it: any course missing either, silenced and excluded ones
// INCLUDED, with WAKE_MIN or more enrolments in the last WAKE_DAYS days (a few reviewer
// enrolments on a draft do not trip it). Shown at the top of the Data Sync page; the
// nightly run announces a course the first time it wakes. "Dismiss" hides one until its
// enrolments double. Counts only, from the learner records already on this Mac.
Object.assign(window.App, {
    WAKE_KEY: 'surgdash_course_wakeups',   // device-local: {dismissed: {course: learnersThen}, notified: [course]}
    WAKE_DAYS: 14,
    WAKE_MIN: 5,

    async _wakeLoad() {
        if (this._wake) return this._wake;
        let v = null; try { v = await Storage.getItem(this.WAKE_KEY); } catch (e) { __swallowed(e, 'wake.load'); }
        this._wake = Object.assign({ dismissed: {}, notified: [] }, (v && typeof v === 'object') ? v : {});
        return this._wake;
    },
    async _wakeSave() { try { await Storage.setItem(this.WAKE_KEY, this._wake, { internal: true }); } catch (e) { __swallowed(e, 'wake.save'); } },

    _wakeNoProvider(d) { return !d.Provider || d.Provider === 'Unknown Provider' || d.Provider === 'Unknown'; },

    // The courses to flag now, most recent enrolments first.
    courseWakeups(now) {
        const t = (now || new Date()).getTime(), since = new Date(t - this.WAKE_DAYS * 86400000).toISOString().slice(0, 10);
        const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const recent = {};
        (Array.isArray(this._rawCompletion) ? this._rawCompletion : []).forEach(r => {
            if (!r) return;
            const d = String(r.enrolled_date || r.start_date || '').slice(0, 10);
            if (!(d >= since)) return;
            const keys = new Set([norm(r.course), norm(r.course_resolved)].filter(Boolean));
            keys.forEach(k => { recent[k] = (recent[k] || 0) + 1; });
        });
        const latest = {};
        (this.data || []).forEach(d => { if (!d || d.IsShell || !d.Course) return; const p = latest[d.Course]; if (!p || String(d.Timestamp || '') > String(p.Timestamp || '')) latest[d.Course] = d; });
        const silenced = this._triageSilenced || [], dismissed = (this._wake && this._wake.dismissed) || {};
        return Object.values(latest).map(d => {
            const noProv = this._wakeNoProvider(d), noUrl = !d.URL;
            if (!noProv && !noUrl) return null;
            const n = recent[norm(d.Course)] || 0;
            if (n < this.WAKE_MIN) return null;
            const learners = Number(d.Learners) || 0, was = dismissed[d.Course];
            if (was != null && learners < Math.max(was * 2, was + this.WAKE_MIN)) return null;
            return { course: d.Course, key: d.CourseId || d.Course, access: String(d.Access || ''), excluded: !!d.Excluded, silenced: silenced.indexOf(d.Course) >= 0,
                recent: n, learners, missing: [noProv && 'provider', noUrl && 'survey link'].filter(Boolean) };
        }).filter(Boolean).sort((a, b) => b.recent - a.recent);
    },

    // Bring a course back for its details: off the silenced list, included again, into the triage list.
    async wakeAddDetails(course) {
        const list = (this._triageSilenced || []).filter(c => c !== course);
        this._triageSilenced = list;
        try { await Storage.setItem('surgdash_triage_silenced', list); } catch (e) { __swallowed(e, 'wake.unsilence'); }
        const rec = (this.data || []).find(d => d && d.Course === course && !d.IsShell);
        if (rec && rec.Excluded && this.toggleCourseIncluded) this.toggleCourseIncluded(rec.CourseId || course, true);
        this.showMsg('"' + course + '" is in the list below: add its provider and survey link.');
        if (this.renderView) this.renderView();
    },
    async wakeDismiss(course) {
        const w = await this._wakeLoad();
        const rec = (this.data || []).filter(d => d && d.Course === course && !d.IsShell).sort((a, b) => String(b.Timestamp || '').localeCompare(String(a.Timestamp || '')))[0];
        w.dismissed[course] = Number(rec && rec.Learners) || 0;
        await this._wakeSave();
        if (this.renderView) this.renderView();
    },

    // Nightly: say so the first time a course wakes. Returns the step note.
    async courseWakeupsCheck() {
        const w = await this._wakeLoad();
        if (this._triageSilenced == null) { try { const v = await Storage.getItem('surgdash_triage_silenced'); this._triageSilenced = Array.isArray(v) ? v : []; } catch (e) { this._triageSilenced = []; } }
        if (this._rawCompletion == null && this.ensureCompletionLoaded) await this.ensureCompletionLoaded();
        const list = this.courseWakeups();
        const fresh = list.filter(x => w.notified.indexOf(x.course) < 0);
        if (fresh.length) {
            w.notified = w.notified.concat(fresh.map(x => x.course));
            await this._wakeSave();
            this.showMsg('🔔 ' + (fresh.length === 1 ? '"' + fresh[0].course + '" has' : fresh.length + ' courses have') + ' started enrolling without a provider or survey link — see Data Sync.', 'warn');
        }
        return list.length ? list.length + ' enrolling without provider/survey link' + (fresh.length ? ' (' + fresh.length + ' new)' : '') : 'none';
    },

    _courseWakeupsHtml() {
        if (this._wake === undefined) { this._wake = null; this._wakeLoad().then(() => { if (this.view === 'upload' && this.renderView) this.renderView(); }); return ''; }
        if (this._rawCompletion == null) { if (this.ensureCompletionLoaded && !this._completionLoadPromise) this.ensureCompletionLoaded().then(() => { if (this.view === 'upload' && this.renderView) this.renderView(); }); return ''; }
        const list = this.courseWakeups();
        if (!list.length) return '';
        const esc = (t) => this.escapeHtml(String(t == null ? '' : t));
        const badge = (t, cls) => '<span class="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ' + cls + '">' + t + '</span>';
        const rows = list.map(x => '<div class="flex items-center gap-3 flex-wrap py-2.5 border-b border-amber-100 last:border-0">'
            + '<div class="min-w-[240px] flex-1"><p class="text-sm font-bold text-gsf-prussian">' + esc(x.course) + '</p>'
            + '<p class="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap mt-0.5"><strong class="text-amber-700">' + this.formatNumber(x.recent) + ' enrolments in ' + this.WAKE_DAYS + ' days</strong> · ' + this.formatNumber(x.learners) + ' in all · missing ' + esc(x.missing.join(' + '))
            + (x.access ? ' ' + badge(esc(x.access), x.access === 'free' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500') : '')
            + (x.silenced ? ' ' + badge('silenced', 'bg-slate-100 text-slate-500') : '') + (x.excluded ? ' ' + badge('excluded', 'bg-rose-50 text-rose-600') : '') + '</p></div>'
            + '<button onclick="App.wakeAddDetails(\'' + this.escapeJsArg(x.course) + '\')" class="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg">Add details</button>'
            + '<button onclick="App.wakeDismiss(\'' + this.escapeJsArg(x.course) + '\')" class="px-2.5 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-600" title="Hide until its enrolments double">Dismiss</button></div>').join('');
        return '<div data-edit-only class="bg-gradient-to-br from-amber-50 to-white border border-amber-200 rounded-2xl p-6 mb-4 shadow-sm">'
            + '<div class="flex items-center gap-2 mb-1"><i data-lucide="bell-ring" width="18" class="text-amber-600"></i><h2 class="text-lg font-bold text-gsf-prussian">Courses that started enrolling</h2>'
            + '<span class="text-[10px] font-bold uppercase text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full">' + list.length + '</span></div>'
            + '<p class="text-sm text-slate-600 max-w-3xl mb-3">These courses have no provider and/or survey link but ' + this.WAKE_MIN + ' or more enrolments in the last ' + this.WAKE_DAYS + ' days — usually a draft that has just been published. Silenced and excluded courses are included. <strong>Add details</strong> brings one back into the list below (and includes it again if it was excluded).</p>'
            + rows + '</div>';
    },
});
