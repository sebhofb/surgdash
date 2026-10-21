// ── Forum activity: what learners write in a course's discussion space ────
//
// SURGhub runs a discussion space beside most courses — a reflection forum, an
// introduce-yourself thread — and until now none of that reached the dashboard.
// This reads it and keeps a monthly series per course.
//
// POSTS, NOT COMMENTS. The API exposes `/community/posts` and nothing for the
// replies underneath them: there is no comments endpoint, and the field that might
// have carried them is empty on every post. The learner segment export the app
// already imports does count comments, but per learner, with no date and no course,
// so it cannot make a series. Everything here is therefore labelled "posts", which
// is what the data actually supports.
//
// THE JOIN IS EXACT. Each space carries `usages[].courseId`, so a post reaches its
// course through its space without any guessing from titles. 475 of 478 spaces have
// one; the rest are general community areas and are simply not course activity.
//
// WHAT IS STORED. Counts only — posts per month, and how many different people wrote
// them. No user ids, no text. `surghub_forum` (surghub/forum.json), mapped both ways
// so it travels with the rest of the SURGhub data.
Object.assign(window.App, {

    FORUM_KEY: 'surghub_forum',
    FORUM_PAGE: 100,          // the largest page the API accepts
    FORUM_GAP_MS: 1200,       // ~50 requests a minute, the pace this API tolerates
    FORUM_MAX_PAGES: 400,     // a stop, in case the API ever disagrees with itself about totals

    async _forumLoad() {
        if (this._forum) return this._forum;
        let v = null;
        try { v = await Storage.getItem(this.FORUM_KEY); } catch (e) { __swallowed(e, 'forum.load'); }
        this._forum = (v && typeof v === 'object' && v.byCourse) ? v : null;
        return this._forum;
    },

    // What we hold for one course, by course NAME (the store is keyed by course id, which
    // survives a rename). Always an object, so callers can read `.months` without guarding.
    forumActivity(courseName) {
        const all = this._forum;
        if (!all || !all.byCourse) return null;
        const row = (this.data || []).filter(d => d && d.Course === courseName && d.CourseId)
            .sort((a, b) => String(a.Timestamp || '').localeCompare(String(b.Timestamp || ''))).pop();
        if (!row) return null;
        return all.byCourse[row.CourseId] || null;
    },

    _forumMonth(unixSeconds) {
        const n = Number(unixSeconds);
        if (!isFinite(n) || n <= 0) return '';
        const d = new Date(n * 1000);
        if (isNaN(d)) return '';
        return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
    },

    // Fold posts and spaces into a per-course monthly series. Pure, so the counting is
    // checkable without touching the network.
    // SHARED SPACES (fixed 21 Oct 2026). A space can be linked to several courses: a course
    // copied from a template or an earlier version keeps the forum links, so the Navigating the
    // Global Surgery Ecosystem forums are also linked to the draft "Live Series Template", and
    // Surgical Foundations' to its draft copy. Taking the first link filed ~1,300 Navigating posts
    // under the template. `pick` chooses among the linked courses (the app prefers the real one:
    // see _forumPickCourse); without it, the first link, as before. A post has no course of its
    // own, so a space genuinely shared by live courses goes wholly to the one picked.
    buildForumIndex(spaces, posts, now, pick) {
        const spaceCourse = {};
        let shared = 0;
        (spaces || []).forEach(s => {
            if (!s || !s.id) return;
            const ids = [...new Set((s.usages || []).filter(x => x && x.courseId).map(x => String(x.courseId)))];
            if (!ids.length) return;
            if (ids.length > 1) shared++;
            spaceCourse[s.id] = (ids.length > 1 && pick) ? (pick(ids) || ids[0]) : ids[0];
        });

        const byCourse = {};
        const people = {};          // courseId -> Set, and courseId|month -> Set; counted, then dropped
        let joined = 0, orphan = 0;
        (posts || []).forEach(p => {
            if (!p) return;
            const spaceId = p.posted_in && p.posted_in.id;
            const courseId = spaceCourse[spaceId];
            if (!courseId) { orphan++; return; }
            const month = this._forumMonth(p.created);
            if (!month) { orphan++; return; }
            joined++;
            const c = byCourse[courseId] || (byCourse[courseId] = { posts: 0, people: 0, first: month, last: month, months: {} });
            c.posts++;
            if (month < c.first) c.first = month;
            if (month > c.last) c.last = month;
            const m = c.months[month] || (c.months[month] = { posts: 0, people: 0 });
            m.posts++;
            const uid = (p.user && (p.user.id || p.user.username)) || '';
            if (uid) {
                (people[courseId] || (people[courseId] = new Set())).add(uid);
                const key = courseId + '|' + month;
                (people[key] || (people[key] = new Set())).add(uid);
            }
        });

        // Counts only: the sets never leave this function.
        Object.keys(byCourse).forEach(courseId => {
            const c = byCourse[courseId];
            c.people = (people[courseId] || { size: 0 }).size;
            Object.keys(c.months).forEach(month => {
                c.months[month].people = (people[courseId + '|' + month] || { size: 0 }).size;
            });
        });

        return {
            v: 1,
            fetchedAt: (now ? new Date(now) : new Date()).toISOString(),
            totals: {
                posts: (posts || []).length,
                spaces: (spaces || []).length,
                spacesWithCourse: Object.keys(spaceCourse).length,
                sharedSpaces: shared,
                courses: Object.keys(byCourse).length,
                joined, orphan,
            },
            byCourse,
        };
    },

    // The real course behind a shared space: included before excluded, then free before private
    // before draft, then the most learners. A template or a draft copy loses to the live course.
    _forumPickCourse(ids) {
        const rec = {};
        (this.data || []).forEach(d => { if (d && !d.IsShell && d.CourseId && (!rec[d.CourseId] || String(d.Timestamp || '') > String(rec[d.CourseId].Timestamp || ''))) rec[d.CourseId] = d; });
        const access = { free: 2, paid: 2, private: 1 };
        const rank = (id) => { const d = rec[id]; if (!d) return [-1, -1, -1]; return [d.Excluded ? 0 : 1, access[String(d.Access || '').toLowerCase()] || 0, Number(d.Learners) || 0]; };
        return ids.slice().sort((a, b) => { const x = rank(a), y = rank(b); return (y[0] - x[0]) || (y[1] - x[1]) || (y[2] - x[2]); })[0];
    },

    // Walk a paginated community endpoint to the end, politely.
    async _forumFetchAll(path, opts) {
        opts = opts || {};
        const out = [];
        let page = 1, totalPages = 1;
        while (page <= totalPages && page <= this.FORUM_MAX_PAGES) {
            if (this._reportCancelled) break;
            const r = await LearnWorlds.apiGet(path, { items_per_page: this.FORUM_PAGE, page });
            const rows = (r && r.data) || [];
            out.push.apply(out, rows);
            const meta = (r && r.meta) || {};
            totalPages = Number(meta.totalPages) || 1;
            if (opts.progress) opts.progress(opts.label + ' ' + page + '/' + totalPages + ' — ' + this.formatNumber(out.length) + ' so far');
            if (!rows.length) break;
            page++;
            if (page <= totalPages) await new Promise(res => setTimeout(res, this.FORUM_GAP_MS));
        }
        return out;
    },

    async syncForumActivity(opts) {
        opts = opts || {};
        if (!window.LearnWorlds || !LearnWorlds.apiGet) { if (!opts.silent) alert('LearnWorlds module not loaded.'); return null; }
        const creds = await LearnWorlds.getCredentials();
        if (!creds.clientId || !creds.apiToken) { if (!opts.silent) alert('Add LearnWorlds API credentials first (Data Sync).'); return null; }
        try {
            const spaces = await this._forumFetchAll('/community/spaces', { progress: opts.progress, label: 'Discussion spaces, page' });
            await new Promise(res => setTimeout(res, this.FORUM_GAP_MS));
            const posts = await this._forumFetchAll('/community/posts', { progress: opts.progress, label: 'Forum posts, page' });
            const index = this.buildForumIndex(spaces, posts, null, (ids) => this._forumPickCourse(ids));
            this._forum = index;
            try { await Storage.setItem(this.FORUM_KEY, index); } catch (e) { __swallowed(e, 'forum.store'); }
            if (!opts.silent) {
                this.showMsg('Forum activity updated — ' + this.formatNumber(index.totals.joined) + ' posts across '
                    + this.formatNumber(index.totals.courses) + ' courses.', 'success');
            }
            return index;
        } catch (e) {
            __swallowed(e, 'forum.sync');
            if (!opts.silent) alert('Could not read the forums: ' + (e && e.message || e));
            return null;
        }
    },

    async syncForumActivityWithProgress() {
        if (!confirm('Read the course discussion forums from LearnWorlds?\n\n'
            + 'About 135 requests, three to four minutes. Adds a forum-activity chart to each course page.')) return;
        this._reportCancelled = false;
        if (this._showReportProgress) this._showReportProgress('Reading the forums…', true);
        try {
            await this.syncForumActivity({ progress: (t) => { if (this._showReportProgress) this._showReportProgress(t, true); } });
        } finally {
            if (this._hideReportProgress) this._hideReportProgress();
            if (this.renderView) this.renderView();
        }
    },

    // ── the panel on a course page ────────────────────────────────────────
    _forumPanelHtml(courseName) {
        // Read once, then redraw: the store is on disk, not in memory at first paint.
        if (this._forum === undefined) {
            this._forum = null;
            this._forumLoad().then(() => { if (this.view === 'course' && this.renderView) this.renderView(); });
        }
        const a = this.forumActivity(courseName);
        const head = '<h3 class="text-lg font-bold mb-1 flex items-center gap-2 text-gsf-prussian">'
            + '<i data-lucide="messages-square" class="text-gsf-boston"></i> Forum Activity</h3>';
        if (!this._forum) {
            return `<div class="bg-white p-6 rounded-xl shadow-sm border mb-8">${head}
                <p class="text-sm text-slate-400">No forum data yet. Data Sync &rarr; <strong>Forum activity</strong> reads the discussion spaces.</p></div>`;
        }
        if (!a || !a.posts) {
            return `<div class="bg-white p-6 rounded-xl shadow-sm border mb-8">${head}
                <p class="text-sm text-slate-400">No posts in this course's discussion space${this._forum.totals ? ' (read ' + this._forumWhen() + ')' : ''}.</p></div>`;
        }
        return `<div class="bg-white p-6 rounded-xl shadow-sm border mb-8">${head}
            <p class="text-sm text-slate-500 mb-4">${this.formatNumber(a.posts)} post${a.posts === 1 ? '' : 's'} from ${this.formatNumber(a.people)} learner${a.people === 1 ? '' : 's'},
                ${this._forumMonthName(a.first)} to ${this._forumMonthName(a.last)}. Replies to a post are not counted: the platform does not report them.</p>
            <div id="chart_forum_activity" style="width: 100%; height: 340px;"></div>
            <p class="text-[11px] text-slate-400 mt-2">Read from the course discussion spaces ${this._forumWhen()}.</p>
        </div>`;
    },
    _forumWhen() {
        const t = this._forum && this._forum.fetchedAt;
        if (!t) return '';
        const d = new Date(t);
        return isNaN(d) ? '' : 'on ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    },
    _forumMonthName(m) {
        if (!/^\d{4}-\d{2}$/.test(String(m || ''))) return '';
        const M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const p = String(m).split('-');
        return M[Number(p[1]) - 1] + ' ' + p[0];
    },

    // ── The Forum tab on the dashboard (21 Oct 2026) ─────────────────────────────
    // Platform-wide view of the same store: headline counts, posts per month, and every
    // course with posts. "People" is per course: someone posting in two courses counts in
    // both, so it is never summed across courses (the platform chart shows posts only).
    _forumQuarter(m) { return m.slice(0, 4) + ' Q' + Math.ceil(Number(m.slice(5, 7)) / 3); },
    _forumQuarterMonths(q) { const y = q.slice(0, 4), n = Number(q.slice(-1)); return [1, 2, 3].map(i => y + '-' + String((n - 1) * 3 + i).padStart(2, '0')); },
    _forumPrevQuarter(q) { let y = Number(q.slice(0, 4)), n = Number(q.slice(-1)) - 1; if (n < 1) { n = 4; y--; } return y + ' Q' + n; },
    forumOverview(now) {
        const f = this._forum;
        if (!f || !f.byCourse) return null;
        const today = (now || new Date()).toISOString().slice(0, 7);
        const curQ = this._forumQuarter(today), lastQ = this._forumPrevQuarter(curQ), prevQ = this._forumPrevQuarter(lastQ);
        // course record per id (newest), for the name, provider, access and enrolments
        const rec = {};
        (this.data || []).forEach(d => { if (d && !d.IsShell && d.CourseId && (!rec[d.CourseId] || String(d.Timestamp || '') > String(rec[d.CourseId].Timestamp || ''))) rec[d.CourseId] = d; });
        const months = {}, qPosts = (a, q) => this._forumQuarterMonths(q).reduce((t, m) => t + (((a.months || {})[m] || {}).posts || 0), 0);
        // Safety net: posts still filed under a course nobody is enrolled in (a template that owns
        // a space alone, or data read before shared spaces were attributed properly) count as
        // general areas, outside the course figures.
        const noLearners = (id) => !!rec[id] && !(Number(rec[id].Learners) > 0);
        const generalIds = Object.keys(f.byCourse).filter(noLearners);
        const generalPosts = generalIds.reduce((t, id) => t + (f.byCourse[id].posts || 0), 0);
        const courses = Object.keys(f.byCourse).filter(id => !noLearners(id)).map(id => {
            const a = f.byCourse[id], d = rec[id] || {};
            Object.entries(a.months || {}).forEach(([m, v]) => { months[m] = (months[m] || 0) + (v.posts || 0); });
            const lrn = Number(d.Learners) || 0;
            return { id, name: d.Course || id, provider: d.Provider || '', access: d.Access, learners: lrn, posts: a.posts || 0, people: a.people || 0,
                last: a.last || '', lastQ: qPosts(a, lastQ), curQ: qPosts(a, curQ), per100: lrn ? (a.posts || 0) / lrn * 100 : null };
        }).filter(c => c.posts > 0);
        const series = [];
        const ms = Object.keys(months).sort();
        if (ms.length) { let m = ms[0]; for (let g = 0; m <= ms[ms.length - 1] && g < 600; g++) { series.push({ month: m, posts: months[m] || 0, people: null }); let [y, mo] = m.split('-').map(Number); mo++; if (mo > 12) { mo = 1; y++; } m = y + '-' + String(mo).padStart(2, '0'); } }
        const qSum = (q) => this._forumQuarterMonths(q).reduce((t, m) => t + (months[m] || 0), 0);
        const busiest = series.reduce((b, p) => (p.posts > (b ? b.posts : -1) ? p : b), null);
        const prov = {};
        courses.forEach(c => { const p = c.provider || 'No provider'; const o = prov[p] || (prov[p] = { provider: p, posts: 0, lastQ: 0, courses: 0 }); o.posts += c.posts; o.lastQ += c.lastQ; o.courses++; });
        const t0 = f.totals || {};
        const totals = Object.assign({}, t0, { joined: (t0.joined || 0) - generalPosts, orphan: (t0.orphan || 0) + generalPosts });
        return { fetchedAt: f.fetchedAt, totals, generalIds, courses, series, curQ, lastQ, prevQ,
            curQPosts: qSum(curQ), lastQPosts: qSum(lastQ), prevQPosts: qSum(prevQ), busiest,
            providers: Object.values(prov).sort((a, b) => b.posts - a.posts) };
    },
    setForumSort(k) { this._forumSort = k; if (this.rerenderDashTab) this.rerenderDashTab(); },
    toggleForumAll() { this._forumShowAll = !this._forumShowAll; if (this.rerenderDashTab) this.rerenderDashTab(); },
    _dashForumHtml() {
        if (this._forum === undefined) { this._forum = null; this._forumLoad().then(() => { if (this.view === 'platform' && this.rerenderDashTab) this.rerenderDashTab(); }); }
        const esc = (t) => this.escapeHtml(String(t == null ? '' : t)), fmt = (n) => this.formatNumber(n);
        const refresh = '<button data-edit-only onclick="App.syncForumActivityWithProgress()" class="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-bold text-slate-600 hover:text-gsf-boston hover:bg-slate-50"><i data-lucide="refresh-cw" width="13"></i> Refresh forum data</button>';
        const o = this.forumOverview();
        if (!o) return '<div class="bg-white p-6 rounded-xl shadow-sm border"><h3 class="text-lg font-bold text-gsf-prussian mb-1">Forum activity</h3><p class="text-sm text-slate-400 mb-3">No forum data yet. It is read from the course discussion spaces (Data Sync &rarr; 7 &middot; Forum activity).</p>' + refresh + '</div>';
        const chg = o.prevQPosts ? Math.round((o.lastQPosts / o.prevQPosts - 1) * 100) : null;
        const card = (label, value, sub, color) => '<div class="bg-white rounded-xl border shadow-sm p-4"><div class="text-[10px] font-bold uppercase tracking-wide" style="color:' + color + '">' + label + '</div><div class="text-2xl font-black text-gsf-prussian mt-1 tabular-nums">' + value + '</div><div class="text-[11px] text-slate-400 mt-0.5">' + sub + '</div></div>';
        const t = o.totals;
        const cards = '<div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">'
            + card('Posts', fmt(t.posts || 0), fmt(t.joined || 0) + ' in course spaces · ' + fmt(t.orphan || 0) + ' in general areas', '#4389C8')
            + card('Courses with discussion', fmt(o.courses.length), 'at least one post', '#206095')
            + card('Posts ' + o.lastQ, fmt(o.lastQPosts), chg == null ? '&nbsp;' : (chg >= 0 ? '+' : '') + chg + '% on ' + o.prevQ, '#3FB984')
            + card('Posts ' + o.curQ + ' so far', fmt(o.curQPosts), 'to ' + esc(this._forumWhen().replace(/^on /, '')), '#E28743')
            + card('Busiest month', o.busiest ? fmt(o.busiest.posts) : '–', o.busiest ? esc(this._forumMonthName(o.busiest.month)) : '&nbsp;', '#D03734')
            + '</div>';
        const sorts = { posts: 'All time', lastQ: o.lastQ, per100: 'Per 100 enrolled', people: 'People' };
        const sk = sorts[this._forumSort] ? this._forumSort : 'posts';
        const rows = o.courses.slice().sort((a, b) => ((b[sk] == null ? -1 : b[sk]) - (a[sk] == null ? -1 : a[sk])) || b.posts - a.posts);
        const shown = this._forumShowAll ? rows : rows.slice(0, 25);
        const th = (k, l) => '<th class="py-2 px-3 text-right font-medium"><button onclick="App.setForumSort(\'' + k + '\')" class="' + (sk === k ? 'text-gsf-prussian font-bold underline' : 'hover:text-gsf-boston') + '">' + l + '</button></th>';
        const table = '<div class="bg-white rounded-xl border shadow-sm p-5 mb-6"><div class="flex items-center justify-between gap-3 flex-wrap mb-3"><h3 class="font-bold text-gsf-prussian">Courses with posts <span class="text-slate-400 font-medium text-sm">(' + rows.length + ')</span></h3><span class="text-[11px] text-slate-400">Click a column to sort · click a course to open it</span></div>'
            + '<div class="overflow-x-auto"><table class="w-full text-xs"><thead class="text-slate-400 border-b"><tr><th class="py-2 px-3 text-left font-medium">Course</th><th class="py-2 px-3 text-left font-medium">Provider</th>'
            + th('posts', 'Posts') + th('lastQ', o.lastQ) + th('people', 'People') + th('per100', 'Per 100 enrolled') + '<th class="py-2 px-3 text-right font-medium">Last post</th></tr></thead><tbody>'
            + shown.map(c => '<tr class="border-b last:border-0 hover:bg-slate-50"><td class="py-2 px-3 font-bold"><button onclick="App.openCourse(\'' + this.escapeJsArg(c.name) + '\')" class="text-gsf-prussian hover:text-gsf-boston hover:underline text-left">' + esc(c.name) + '</button>' + (this._courseStatusBadge ? this._courseStatusBadge(c.access) : '') + '</td>'
                + '<td class="py-2 px-3 text-slate-500">' + esc(this.providerFolderName ? this.providerFolderName(c.provider) : c.provider) + '</td>'
                + '<td class="py-2 px-3 text-right tabular-nums font-bold">' + fmt(c.posts) + '</td><td class="py-2 px-3 text-right tabular-nums">' + fmt(c.lastQ) + '</td><td class="py-2 px-3 text-right tabular-nums">' + fmt(c.people) + '</td>'
                + '<td class="py-2 px-3 text-right tabular-nums">' + (c.per100 == null ? '–' : c.per100.toFixed(1)) + '</td><td class="py-2 px-3 text-right text-slate-400 whitespace-nowrap">' + esc(this._forumMonthName(c.last).replace(/^(\w{3})\w*/, '$1')) + '</td></tr>').join('')
            + '</tbody></table></div>' + (rows.length > 25 ? '<button onclick="App.toggleForumAll()" class="mt-3 text-xs font-bold text-gsf-boston hover:underline">' + (this._forumShowAll ? 'Show the top 25' : 'Show all ' + rows.length) + '</button>' : '') + '</div>';
        const provs = '<div class="bg-white rounded-xl border shadow-sm p-5 mb-6"><h3 class="font-bold text-gsf-prussian mb-3">By provider</h3><div class="overflow-x-auto"><table class="w-full text-xs"><thead class="text-slate-400 border-b"><tr><th class="py-2 px-3 text-left font-medium">Provider</th><th class="py-2 px-3 text-right font-medium">Courses with posts</th><th class="py-2 px-3 text-right font-medium">Posts</th><th class="py-2 px-3 text-right font-medium">' + o.lastQ + '</th></tr></thead><tbody>'
            + o.providers.map(p => '<tr class="border-b last:border-0"><td class="py-2 px-3 font-bold text-gsf-prussian">' + esc(this.providerFolderName ? this.providerFolderName(p.provider) : p.provider) + '</td><td class="py-2 px-3 text-right tabular-nums">' + fmt(p.courses) + '</td><td class="py-2 px-3 text-right tabular-nums font-bold">' + fmt(p.posts) + '</td><td class="py-2 px-3 text-right tabular-nums">' + fmt(p.lastQ) + '</td></tr>').join('')
            + '</tbody></table></div></div>';
        return '<div class="flex items-center justify-between gap-3 flex-wrap mb-4"><p class="text-sm text-slate-500 max-w-3xl">Posts in the discussion spaces beside each course, read ' + esc(this._forumWhen()) + '. Replies under a post are not counted: the platform does not report them. "People" is per course, so it is not added up across courses. Spaces beside courses with no enrolled learners count as general areas; a space linked to several courses (a course and its template) counts once, for the live course.</p>' + refresh + '</div>'
            + cards
            + '<div class="bg-white rounded-xl border shadow-sm p-5 mb-6"><h3 class="font-bold text-gsf-prussian mb-1">Posts per month</h3><p class="text-[11px] text-slate-400 mb-2">All discussion spaces linked to a course. The current month is partial.</p><div id="chart_forum_platform" style="width:100%;height:320px"></div></div>'
            + table + provs;
    },
    _drawForumCharts() {
        const o = this.forumOverview();
        if (o && window.Charts && Charts.drawForumActivity) Charts.drawForumActivity('chart_forum_platform', o.series);
    },

    // Every month between the first and the last, so a quiet month reads as a gap in the
    // conversation rather than being skipped over.
    forumSeries(activity) {
        if (!activity || !activity.months) return [];
        const months = Object.keys(activity.months).filter(m => /^\d{4}-\d{2}$/.test(m)).sort();
        if (!months.length) return [];
        const out = [];
        let m = months[0];
        const last = months[months.length - 1];
        for (let guard = 0; m <= last && guard < 600; guard++) {
            const v = activity.months[m] || { posts: 0, people: 0 };
            out.push({ month: m, posts: v.posts || 0, people: v.people || 0 });
            let [y, mo] = m.split('-').map(Number);
            mo += 1; if (mo > 12) { mo = 1; y += 1; }
            m = y + '-' + String(mo).padStart(2, '0');
        }
        return out;
    },
});
