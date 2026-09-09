// ── Learner lookup: internal support tool ─────────────────────────────────────
// Search a learner by email, name or hashed id and see their course history, so a
// support question ("did X finish the course? when was the certificate issued?")
// is answered here instead of in LearnWorlds admin. Sources: the completion
// records (name, email, per-course dates, learning time, score, certificate), the
// account index (sign-up day, last login) and the per-email demographics
// (country, profession) — all already in the app.
//
// PERSONAL DATA. The tab exists only while editing is unlocked (the pill is
// data-edit-only and the content checks App.editUnlocked); nothing here is
// exported, snapshotted or persisted — the query and the selected learner live in
// memory only and are not part of the saved UI state. Typing re-renders just the
// result list, so the search box keeps focus.
Object.assign(window.App, {
    LOOKUP_MIN_CHARS: 3,
    LOOKUP_MAX_RESULTS: 30,

    _lkIndex() {
        const rows = this._rawCompletion;
        if (!Array.isArray(rows)) { if (this._sparkEnsureLoaded) this._sparkEnsureLoaded(); return null; }
        if (this._lkIdx && this._lkIdx.src === rows) return this._lkIdx;
        const byUid = new Map();
        for (const r of rows) {
            if (!r || !r.uid) continue;
            let u = byUid.get(r.uid);
            if (!u) { u = { uid: String(r.uid), email: String(r.email || '').toLowerCase().trim(), names: new Map(), rows: [] }; byUid.set(r.uid, u); }
            u.rows.push(r);
            const nm = String(r.name || '').trim(); if (nm) u.names.set(nm, (u.names.get(nm) || 0) + 1);
        }
        const list = [];
        for (const u of byUid.values()) {
            u.name = [...u.names.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0])[0] || '';
            u.domain = this._instDomain ? this._instDomain(u.email) : (u.email.split('@')[1] || '');
            u.key = (u.email + ' ' + u.name + ' ' + u.uid).toLowerCase();
            u.opened = u.rows.filter(r => r.start_date).length; u.certs = u.rows.filter(r => r.certificate).length;
            u.minutes = u.rows.reduce((s, r) => s + (Number(r.time_minutes) || 0), 0);
            list.push(u);
        }
        this._lkIdx = { src: rows, byUid, list };
        return this._lkIdx;
    },
    _lkSearch(q) {
        const idx = this._lkIndex(); if (!idx) return [];
        q = String(q || '').toLowerCase().trim();
        if (q.length < this.LOOKUP_MIN_CHARS) return [];
        const out = [];
        for (const u of idx.list) {
            if (!u.key.includes(q)) continue;
            const rank = u.email === q ? 0 : u.email.startsWith(q) ? 1 : u.name.toLowerCase().startsWith(q) ? 2 : u.email.includes(q) ? 3 : 4;
            out.push([rank, u]);
            if (out.length > 2000) break;
        }
        out.sort((a, b) => a[0] - b[0] || b[1].rows.length - a[1].rows.length || a[1].email.localeCompare(b[1].email));
        return out.slice(0, this.LOOKUP_MAX_RESULTS).map(x => x[1]);
    },

    // ── events (re-render only the parts that change, so the input keeps focus) ──
    _lkOnInput(v) {
        this._lkQuery = v;
        clearTimeout(this._lkTimer);
        this._lkTimer = setTimeout(() => { const el = document.getElementById('lk-results'); if (el) el.innerHTML = this._lkResultsHtml(); if (window.lucide) lucide.createIcons(); }, 150);
    },
    _lkSelect(uid) {
        this._lkUid = uid;
        const el = document.getElementById('lk-detail'); if (el) el.innerHTML = this._lkDetailHtml();
        const res = document.getElementById('lk-results'); if (res) res.innerHTML = this._lkResultsHtml();
        if (window.lucide) lucide.createIcons();
    },
    _lkClear() { this._lkQuery = ''; this._lkUid = null; this.renderView(); },
    async _lkCopy() {
        const idx = this._lkIndex(), u = idx && this._lkUid ? idx.byUid.get(this._lkUid) : null; if (!u) return;
        const lines = [`${u.name || '(no name)'} <${u.email}>`, `${u.rows.length} enrolment${u.rows.length === 1 ? '' : 's'}, ${u.opened} opened, ${u.certs} certificate${u.certs === 1 ? '' : 's'}, ${this.formatLearningTime ? this.formatLearningTime(u.minutes) : u.minutes + ' min'} of learning time`, ''];
        for (const r of this._lkSorted(u)) lines.push(`${r.course}: ${r.certificate ? 'certificate ' + (r.certificate_date || '') : r.start_date ? 'opened ' + r.start_date + ', no certificate' : 'enrolled ' + (r.enrolled_date || '') + ', never opened'}${(Number(r.time_minutes) || 0) ? ' · ' + Math.round(Number(r.time_minutes)) + ' min' : ''}`);
        try { await navigator.clipboard.writeText(lines.join('\n')); this.showMsg('Course history copied as text.'); } catch (e) { this.showMsg('Could not copy: ' + (e && e.message || e), true); }
    },
    _lkSorted(u) {
        const k = (r) => r.certificate_date || r.completion_date || r.start_date || r.enrolled_date || '';
        return u.rows.slice().sort((a, b) => (k(b) > k(a) ? 1 : k(b) < k(a) ? -1 : 0) || String(a.course).localeCompare(String(b.course)));
    },

    // ── rendering ──
    _lkResultsHtml() {
        const esc = (t) => this.escapeHtml(t), q = String(this._lkQuery || '').trim();
        if (!this._lkIndex()) return '<p class="text-sm text-slate-400 p-4">Loading learner records…</p>';
        if (q.length < this.LOOKUP_MIN_CHARS) return `<p class="text-xs text-slate-400 p-4">Type at least ${this.LOOKUP_MIN_CHARS} characters of an email address or a name.</p>`;
        const res = this._lkSearch(q);
        if (!res.length) return `<p class="text-sm text-slate-500 p-4">No learner matches "${esc(q)}".</p>`;
        return `<p class="text-[10px] uppercase tracking-wide font-bold text-slate-400 px-4 pt-3 pb-1">${res.length >= this.LOOKUP_MAX_RESULTS ? 'First ' + res.length + ' matches — refine the search' : res.length + ' match' + (res.length === 1 ? '' : 'es')}</p>`
            + res.map(u => `<button onclick="App._lkSelect('${this.escapeJsArg(u.uid)}')" class="w-full text-left px-4 py-2.5 border-t border-slate-100 hover:bg-slate-50 ${this._lkUid === u.uid ? 'bg-blue-50/60' : ''}">
                <div class="flex items-center justify-between gap-3"><span class="text-sm font-bold text-gsf-prussian truncate">${esc(u.name || '(no name)')}</span><span class="text-xs text-slate-400 shrink-0 tabular-nums">${u.certs} cert · ${u.rows.length} course${u.rows.length === 1 ? '' : 's'}</span></div>
                <div class="text-xs text-slate-500 truncate">${esc(u.email)}</div>
            </button>`).join('');
    },
    _lkDetailHtml() {
        const esc = (t) => this.escapeHtml(t), fmt = (n) => this.formatNumber(n);
        const idx = this._lkIndex(), u = idx && this._lkUid ? idx.byUid.get(this._lkUid) : null;
        if (!u) return `<div class="p-10 text-center text-slate-400"><i data-lucide="user-search" width="30" class="mx-auto mb-3 text-slate-300"></i><p class="text-sm">Search on the left and pick a learner to see their course history.</p></div>`;
        const acc = this._accounts && this._accounts.byUid ? this._accounts.byUid[u.uid] : null;
        const demo = this._emailDemoMap ? (this._emailDemoMap[u.email] || null) : null;
        const provOf = this._jrnProviderOf ? this._jrnProviderOf() : {};
        const fastMin = this.JRN_FAST_MIN || 10;
        const badge = (r) => r.certificate
            ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold"><i data-lucide="award" width="10"></i> Certified</span>`
            : r.start_date ? `<span class="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold">Opened, no certificate</span>`
            : `<span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold">Never opened</span>`;
        const fact = (label, value) => value ? `<div><p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">${label}</p><p class="text-sm text-slate-700">${value}</p></div>` : '';
        return `<div class="p-5 border-b flex items-start justify-between gap-4 flex-wrap">
                <div class="min-w-0"><h3 class="text-lg font-bold text-gsf-prussian truncate">${esc(u.name || '(no name)')}</h3><p class="text-sm text-slate-500 truncate">${esc(u.email)}</p></div>
                <div class="flex items-center gap-2 shrink-0"><button onclick="App._lkCopy()" class="px-3 py-1.5 border rounded-lg text-xs font-bold text-slate-600 hover:text-gsf-boston hover:bg-slate-50" title="Copy the course history as plain text, for a support reply"><i data-lucide="copy" width="12" class="inline mr-1"></i>Copy history</button></div>
            </div>
            <div class="p-5 border-b grid grid-cols-2 md:grid-cols-4 gap-4">
                ${fact('Signed up', acc && acc.c ? esc(acc.c) : (this._accounts === null ? '<span class="text-slate-400">no account index</span>' : ''))}
                ${fact('Last login', acc && acc.l ? esc(acc.l) + (this._accounts && this._accounts.listedAt ? ` <span class="text-slate-400 text-xs">(as of ${esc(String(this._accounts.listedAt).slice(0, 10))})</span>` : '') : '')}
                ${fact('Country', demo && demo.country ? esc(demo.country) : '')}
                ${fact('Profession', demo && demo.profession ? esc(demo.profession) : '')}
                ${fact('Institution', u.domain && !(this._instIsPersonal && this._instIsPersonal(u.domain)) ? esc(u.domain) : '')}
                ${fact('Courses', `${fmt(u.rows.length)} enrolled · ${fmt(u.opened)} opened · <strong>${fmt(u.certs)}</strong> certified`)}
                ${fact('Learning time', this.formatLearningTime ? this.formatLearningTime(u.minutes) : fmt(Math.round(u.minutes)) + ' min')}
                ${fact('Learner id', `<span class="font-mono text-xs">${esc(u.uid)}</span>`)}
            </div>
            <div class="overflow-x-auto"><table class="w-full text-left border-collapse text-sm">
                <thead><tr class="border-b text-slate-500 text-xs"><th class="py-2.5 px-5 font-medium">Course</th><th class="py-2.5 px-3 font-medium">Provider</th><th class="py-2.5 px-3 font-medium">Enrolled</th><th class="py-2.5 px-3 font-medium">Opened</th><th class="py-2.5 px-3 font-medium">Certificate</th><th class="py-2.5 px-3 font-medium text-right">Learning time</th><th class="py-2.5 px-3 font-medium text-right">Score</th><th class="py-2.5 px-3 font-medium">Status</th></tr></thead>
                <tbody>${this._lkSorted(u).map(r => { const mins = Number(r.time_minutes) || 0, fast = r.certificate && mins < fastMin; return `<tr class="border-b hover:bg-slate-50 text-xs">
                    <td class="py-2 px-5 font-bold text-gsf-prussian"><button onclick="App.openCourse('${this.escapeJsArg(r.course)}')" class="text-left hover:text-gsf-boston hover:underline">${esc(r.course)}</button></td>
                    <td class="py-2 px-3 text-slate-500 truncate max-w-[160px]" title="${esc(provOf[r.course] || '')}">${esc(provOf[r.course] || '')}</td>
                    <td class="py-2 px-3 tabular-nums text-slate-600">${esc(r.enrolled_date || r.start_date || '')}</td>
                    <td class="py-2 px-3 tabular-nums text-slate-600">${esc(r.start_date || '–')}</td>
                    <td class="py-2 px-3 tabular-nums text-slate-600">${r.certificate ? esc(r.certificate_date || r.completion_date || 'yes') : '–'}</td>
                    <td class="py-2 px-3 text-right tabular-nums ${fast ? 'text-red-600 font-bold' : 'text-slate-600'}" title="${fast ? 'Certificate with under ' + fastMin + ' recorded minutes' : ''}">${mins ? Math.round(mins).toLocaleString() + ' min' : '–'}</td>
                    <td class="py-2 px-3 text-right tabular-nums text-slate-600">${Number(r.score) > 0 ? Math.round(Number(r.score)) + '%' : '–'}</td>
                    <td class="py-2 px-3">${badge(r)}</td></tr>`; }).join('')}</tbody>
            </table></div>
            <p class="px-5 py-3 text-[10px] text-slate-400">Dates come from LearnWorlds via the enrolment sync (opened = the course's start date; in API records it equals the enrolment date). Learning time is LearnWorlds' recorded time on course.</p>`;
    },
    _dashLookupHtml() {
        if (!this.editUnlocked) {
            return `<div class="bg-white rounded-xl border shadow-sm p-10 text-center"><i data-lucide="lock" width="30" class="mx-auto mb-3 text-slate-300"></i><h2 class="font-bold text-lg text-gsf-prussian mb-2">Learner lookup is for editors</h2><p class="text-sm text-slate-500 mb-4 max-w-md mx-auto">It shows names, email addresses and individual course histories, so it is only available while editing is unlocked.</p><button onclick="App.showUnlockPrompt()" class="px-4 py-2 bg-gsf-boston text-white text-sm font-bold rounded-lg hover:bg-gsf-prussian">Unlock editing</button></div>`;
        }
        this._lkIndex();
        if (this._accounts === undefined && this._accountsLoad) { this._accountsLoad().then(() => { const el = document.getElementById('lk-detail'); if (el && this._lkUid) el.innerHTML = this._lkDetailHtml(); }); }
        if (!this._emailDemoMap && !this._lkDemoKick) { this._lkDemoKick = true; Storage.getItem('surghub_email_demo').then(v => { if (v) { this._emailDemoMap = v; const el = document.getElementById('lk-detail'); if (el && this._lkUid) el.innerHTML = this._lkDetailHtml(); } }).catch(() => {}); }
        const esc = (t) => this.escapeHtml(t), q = String(this._lkQuery || '');
        return `<div class="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-6 text-xs text-amber-800 flex items-center gap-2"><i data-lucide="shield-alert" width="14" class="shrink-0"></i> Internal support tool. Personal data: nothing on this tab is exported, included in snapshots or saved with your view settings. Please don't share screenshots of it.</div>
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div class="bg-white rounded-xl border shadow-sm overflow-hidden lg:col-span-1">
                    <div class="p-4 border-b bg-slate-50"><div class="relative"><i data-lucide="search" width="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i><input id="lk-query" type="search" value="${esc(q)}" placeholder="Email, name or learner id…" autocomplete="off" oninput="App._lkOnInput(this.value)" class="w-full border rounded-lg pl-8 pr-8 py-2 text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30">${q ? `<button onclick="App._lkClear()" class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" title="Clear">✕</button>` : ''}</div></div>
                    <div id="lk-results" class="max-h-[640px] overflow-y-auto custom-scrollbar">${this._lkResultsHtml()}</div>
                </div>
                <div id="lk-detail" class="bg-white rounded-xl border shadow-sm overflow-hidden lg:col-span-2">${this._lkDetailHtml()}</div>
            </div>`;
    },
});
