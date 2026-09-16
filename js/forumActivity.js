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
    buildForumIndex(spaces, posts, now) {
        const spaceCourse = {};
        (spaces || []).forEach(s => {
            if (!s || !s.id) return;
            const use = (s.usages || []).find(x => x && x.courseId);
            if (use) spaceCourse[s.id] = String(use.courseId);
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
                courses: Object.keys(byCourse).length,
                joined, orphan,
            },
            byCourse,
        };
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
            const index = this.buildForumIndex(spaces, posts);
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
