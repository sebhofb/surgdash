// ── The Testimonials tab, reorganised around the work (Seb, 27 Oct 2026) ─────────────────
//
// Four sections over the data in testimonials.js:
//   Published    everything live on surghub.org, searchable (course, text as shown, cadre, country)
//                and filterable (language, problems, pending); swap a testimonial for one of the
//                course's best alternatives in one click, switch one off, reorder; undo; Excel export.
//   Find better  the scan (new comments since the last one), grouped: problems on the site, courses
//                below target, upgrades; accept or dismiss each, or a whole group.
//   Courses      the course table and the per-course editor.
//   Settings     target and minimum per course, upgrades, shuffling, the check's model and both
//                instructions (editable, with reset). Kept with the testimonials (synced).
Object.assign(window.App, {
    TM_SETTINGS_DEFAULT: { target: 6, min: 4, upgrade: 'clear', shuffle: 'off', judgeModel: '', judgePrompt: '', editPrompt: '' },
    TM_MODELS: [['claude-opus-5-5', 'Claude Opus 5.5 (best judgement, ~$10 for everything)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (half the cost)']],
    tmSetting(k) { const s = (this._tm && this._tm.settings) || {}; return s[k] != null && s[k] !== '' ? s[k] : this.TM_SETTINGS_DEFAULT[k]; },
    async tmSetSetting(k, v) {
        await this._tmLoad();
        const num = k === 'target' || k === 'min';
        let val = num ? Math.max(1, Math.min(12, Math.round(Number(v) || 0))) : String(v == null ? '' : v);
        if (k === 'judgePrompt' && val.trim() === this.TM_JUDGE_PROMPT.trim()) val = '';
        if (k === 'editPrompt' && val.trim() === this.TM_TIDY_PROMPT.trim()) val = '';
        this._tm.settings = Object.assign({}, this._tm.settings, { [k]: val });
        await this._tmSave();
        this.showMsg('✓ Saved.' + (k === 'judgePrompt' || k === 'judgeModel' ? ' The next scan checks every comment again with the new ' + (k === 'judgeModel' ? 'model' : 'instruction') + '.' : ''));
        this._tmRerender();
    },
    _tmRerender() { this.rerenderDashTab ? this.rerenderDashTab() : this.renderView(); },

    // ── shuffling (Settings): 'order' = a fresh order every day; 'rotate' = when more are switched on
    // than the target, a different selection each week (in a fresh daily order). Deterministic per day,
    // so the nightly publish and the app agree.
    _tmSeeded(seed) { let a = 0; for (let i = 0; i < seed.length; i++) a = (Math.imul(a ^ seed.charCodeAt(i), 2654435761) + i) | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; },
    _tmShuffled(list, seed) { const rnd = this._tmSeeded(seed), a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
    _tmArrange(courseId, items, t) {
        const mode = this.tmSetting('shuffle');
        if (mode === 'off' || items.length < 2) return items;
        const d = (t || new Date()), day = d.toISOString().slice(0, 10);
        let list = items;
        if (mode === 'rotate' && items.length > this._tmTarget()) {
            const w = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); w.setUTCDate(w.getUTCDate() - ((w.getUTCDay() + 6) % 7));
            list = this._tmShuffled(items, courseId + '|week|' + w.toISOString().slice(0, 10)).slice(0, this._tmTarget());
        }
        return this._tmShuffled(list, courseId + '|day|' + day);
    },

    // ── what is live ──
    _tmLiveMap() {
        const txt = this._tmState && this._tmState.last && this._tmState.last.content;
        if (this._tmLiveMapSrc === txt) return this._tmLiveMapCache;
        const m = {}; try { Object.values(JSON.parse(txt || '{}').courses || {}).forEach(l => l.forEach(x => { m[x.id] = x.text; })); } catch (e) { /* none */ }
        this._tmLiveMapSrc = txt; this._tmLiveMapCache = m; return m;
    },
    // Every switched-on testimonial with what the page shows and anything wrong with it.
    _tmPublishedRows() {
        const feed = this._tmCourseFeed(), live = this._tmLiveMap(), out = [];
        const dup = {}; this.tmDuplicates().forEach(d => d.where.forEach(w => { dup[w.id] = true; }));
        this._tmRel = this._tmRelational();
        feed.courses.forEach(c => {
            const resp = {}; this.tmResponses(c.id).forEach(r => { resp[r.id] = r; });
            const lang = this._tmPageLang(c.id);
            Object.entries(this._tm.byId).filter(([, e]) => e.course === c.id && e.show).sort((a, b) => (Number(a[1].order) || 9999) - (Number(b[1].order) || 9999)).forEach(([id, e], i) => {
                const r = resp[id], text = r ? String(e.text || r.text).trim() : String(e.text || '');
                const lb = r ? this._tmLabels(e, r, lang) : { cadre: '', country: '' }, q = r ? this._tmQ(c.id, r) : { label: 'not checked' };
                const flags = [];
                if (!r) flags.push('no longer in the survey');
                else {
                    const weak = this._tmWeak(e, r); if (weak) flags.push(weak);
                    if (r.lang !== lang) flags.push('not in the page language (not published)');
                    if (this._tmHeld(text)) flags.push('personal details (held back)');
                }
                if (dup[id]) flags.push('the same text on another course');
                const words = text.split(/\s+/).filter(Boolean).length;
                out.push({ id, e, r, c, pos: i + 1, text, lb, q, flags, words, lang, live: live[id] === text ? 'live' : (live[id] ? 'edited, not online yet' : 'not online yet') });
            });
        });
        return out;
    },

    // ── actions with undo ──
    _tmSnapshot(ids) { const b = {}; ids.forEach(id => { b[id] = this._tm.byId[id] ? JSON.parse(JSON.stringify(this._tm.byId[id])) : null; }); return b; },
    _tmPushUndo(label, before) { this._tmUndo = { label, before, at: Date.now() }; },
    async tmUndo() {
        const u = this._tmUndo; if (!u) return;
        await this._tmLoad();
        Object.entries(u.before).forEach(([id, e]) => { if (e) this._tm.byId[id] = e; else delete this._tm.byId[id]; });
        this._tmUndo = null; await this._tmSave(); this.showMsg('Undone.'); this._tmRerender();
    },
    async tmSwitchOff(id) {
        await this._tmLoad(); const e = this._tm.byId[id]; if (!e) return;
        this._tmPushUndo('Switched off one testimonial.', this._tmSnapshot([id]));
        e.show = false; e.at = new Date().toISOString(); e.removed = { at: e.at, why: 'switched off on the Published list' }; delete e.auto;
        await this._tmSave(); this._tmRerender();
    },
    tmOpenSwap(id) { this._tmSwapFor = this._tmSwapFor === id ? null : id; this._tmRerender(); },
    // The course's best alternatives for one testimonial, under the same rules as the scan.
    _tmAlternatives(id) {
        const e = this._tm.byId[id]; if (!e) return { good: [], rest: [] };
        const cid = e.course, resp = {}; this.tmResponses(cid).forEach(r => { resp[r.id] = r; });
        const others = Object.entries(this._tm.byId).filter(([k, x]) => x.course === cid && x.show && k !== id).map(([k, x]) => ({ e: x, r: resp[k] })).filter(x => x.r);
        const fits = (r) => !others.some(o => o.r.row === r.row) && !others.some(o => this._tmDice(this._tmTokens(r.text), this._tmTokens(o.e.text || o.r.text)) >= 0.6)
            && !(this._tmGeneric(cid, r) && others.some(o => this._tmGeneric(cid, o.r)));
        const all = this._tmCandidates(cid).map(r => ({ r, q: this._tmQ(cid, r) }));
        const good = all.filter(x => x.q.ok && fits(x.r)).sort((a, b) => b.q.rank - a.q.rank || String(b.r.date).localeCompare(String(a.r.date)));
        const rest = all.filter(x => !good.includes(x)).sort((a, b) => (b.q.rank || 0) - (a.q.rank || 0) || String(b.r.date).localeCompare(String(a.r.date)));
        return { good, rest };
    },
    async tmSwap(oldId, newId, btn) {
        await this._tmLoad();
        const old = this._tm.byId[oldId]; if (!old) return;
        const r = this.tmResponses(old.course).find(x => x.id === newId); if (!r) return;
        if (btn) { btn.disabled = true; btn.textContent = 'Swapping…'; }
        this._tmPushUndo('Swapped one testimonial.', this._tmSnapshot([oldId, newId]));
        const at = new Date().toISOString(), q = this._tmQ(old.course, r);
        const e = this._tm.byId[newId] || (this._tm.byId[newId] = { course: old.course });
        e.show = true; e.order = old.order; e.at = at; e.auto = { at, swap: true, label: q.label }; delete e.text; delete e.removed;
        old.show = false; old.at = at; old.removed = { at, why: 'swapped for another' }; old.replacedBy = newId; delete old.auto;
        const title = (this._tmCourseFeed().courses.find(c => c.id === old.course) || {}).title || '';
        const tidy = await this._tmTidy([{ r, course: title }]);
        this._tmApplyEdit(newId, r, tidy[newId]);
        this._tmSwapFor = null;
        await this._tmSave(); this.showMsg('✓ Swapped. It goes online at the next publish.'); this._tmRerender();
    },
    async tmMoveUndoable(id, dir) { this._tmPushUndo('Moved one testimonial.', this._tmSnapshot(Object.keys(this._tm.byId).filter(k => this._tm.byId[k].course === (this._tm.byId[id] || {}).course))); await this.tmMove(id, dir); },
    // Find better: dismiss a suggestion for good.
    async tmDismiss(i) {
        await this._tmLoad(); const p = (this._tmProposals || [])[i]; if (!p) return;
        const key = p.type === 'add' ? 'add>' + p.cand.r.id : p.type === 'weak' ? 'weak>' + p.old.id : 'rep>' + p.old.id + '>' + p.cand.r.id;
        this._tm.dismissed = Object.assign({}, this._tm.dismissed, { [key]: new Date().toISOString() });
        this._tmProposals.splice(i, 1); await this._tmSave(); this._tmRerender();
    },
    async tmAcceptGroup(kind, btn) {
        const idx = (this._tmProposals || []).map((p, i) => (this._tmGroupOf(p) === kind ? i : -1)).filter(i => i >= 0);
        if (!idx.length) return;
        this._tmPushUndo('Accepted ' + idx.length + ' suggestion' + (idx.length === 1 ? '' : 's') + '.', this._tmSnapshot([...new Set(idx.flatMap(i => { const p = this._tmProposals[i]; return [p.old && p.old.id, p.cand && p.cand.r.id].filter(Boolean); }))]));
        await this.tmApplyProposals(idx, btn);
    },
    async tmAcceptOne(i, btn) {
        const p = (this._tmProposals || [])[i]; if (!p) return;
        this._tmPushUndo('Accepted one suggestion.', this._tmSnapshot([p.old && p.old.id, p.cand && p.cand.r.id].filter(Boolean)));
        await this.tmApplyProposals([i], btn);
    },
    _tmGroupOf(p) { return p.type === 'weak' || (p.type === 'replace' && p.old && p.old.weak) ? 'problems' : p.type === 'add' ? 'gaps' : 'upgrades'; },

    // ── search (no re-render, so typing keeps its place) ──
    tmSearch(v) {
        this._tmQuery = String(v || '');
        const q = this._tmNorm(this._tmQuery), host = document.getElementById('tm-body'); if (!host) return;
        host.querySelectorAll('[data-tms]').forEach(el => { el.style.display = !q || el.getAttribute('data-tms').includes(q) ? '' : 'none'; });
        host.querySelectorAll('[data-tmg]').forEach(g => { const any = g.querySelector('[data-tms]:not([style*="none"])'); g.style.display = any ? '' : 'none'; });
        const n = host.querySelectorAll('[data-tms]:not([style*="none"])').length, c = document.getElementById('tm-count'); if (c) c.textContent = n + ' shown';
    },
    tmSection(name) { this._tmSection = name; this._tmSwapFor = null; this._tmRerender(); },
    tmPubFilter(k, v) { this._tmPubF = Object.assign({}, this._tmPubF || {}, { [k]: v }); this._tmRerender(); },

    // ── Excel ──
    async tmExportXlsx(btn) {
        await this._tmLoad();
        if (typeof XLSX === 'undefined') return alert('The Excel library is not loaded.');
        const rows = this._tmPublishedRows(), feed = this._tmCourseFeed();
        const sheet1 = rows.map(x => {
            const j = x.r ? this._tmVerdict(x.c.id, x.r) : null;
            return { Course: x.c.title, 'Course page': 'https://www.surghub.org/course/' + x.c.slug, Language: x.lang.toUpperCase(), Position: x.pos, 'Text on the page': x.text, 'Original comment': x.r ? x.r.text : '',
                Cadre: x.lb.cadre || '', Country: x.lb.country || '', Stars: x.r ? x.r.stars || '' : '', 'Date received': x.r ? x.r.date : '', Question: x.r ? this._tmQLabel(x.r.q) : '',
                'Check: verdict': j ? j.v : '', 'Check: reason': j ? (this.TM_REASON[j.r] || j.r) : '', 'Check: strength (1-5)': j ? j.s : '', 'Check: specific': j ? (j.sp ? 'yes' : 'no') : '',
                Problems: x.flags.join('; '), 'Edited text': x.r && x.e.text && x.e.text !== x.r.text ? 'yes' : 'no', 'Picked automatically': x.e.auto ? 'yes' : 'no', Status: x.live, 'Response id': x.id };
        });
        const sheet2 = feed.courses.map(c => {
            const shown = rows.filter(x => x.c.id === c.id).length, alt = this._tmCandidates(c.id).filter(r => this._tmQ(c.id, r).ok).length;
            return { Course: c.title, Language: this._tmPageLang(c.id).toUpperCase(), 'Shown': shown, Target: this._tmTarget(), 'Below minimum': shown < this._tmMinimum() ? 'yes' : '', 'Good comments waiting': alt, 'Written comments': this.tmResponses(c.id).length };
        });
        const wb = XLSX.utils.book_new();
        const w1 = XLSX.utils.json_to_sheet(sheet1); w1['!cols'] = [{ wch: 40 }, { wch: 30 }, { wch: 8 }, { wch: 8 }, { wch: 70 }, { wch: 70 }, { wch: 22 }, { wch: 16 }, { wch: 6 }, { wch: 12 }, { wch: 16 }, { wch: 10 }, { wch: 30 }, { wch: 10 }, { wch: 10 }, { wch: 40 }, { wch: 10 }, { wch: 10 }, { wch: 20 }, { wch: 18 }];
        XLSX.utils.book_append_sheet(wb, w1, 'Testimonials');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet2), 'Courses');
        const savePath = await electronAPI.invoke('pick-save-path', 'surghub-testimonials-' + new Date().toISOString().slice(0, 10) + '.xlsx');
        if (!savePath) return;
        electronAPI.fs.writeFileSync(savePath, new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' })));
        this.showMsg('✓ Saved ' + sheet1.length + ' testimonials to Excel.');
    },

    // ── the tab ──
    _dashTestimonialsHtml() {
        if (!this._tm || this._tmState === undefined) { if (!this._tmLoading) { this._tmLoading = true; this._tmLoad().then(() => { this._tmLoading = false; if (this._dashTab === 'testimonials') this._tmRerender(); }); } return '<div class="p-10 text-sm text-slate-400">Loading testimonials…</div>'; }
        if (this._cfMeta === undefined && this._cfLoad) { this._cfMeta = null; this._cfLoad().then(() => { if (this._dashTab === 'testimonials') this._tmRerender(); }); }
        const esc = (t) => this.escapeHtml(String(t == null ? '' : t));
        const feed = this._tmCourseFeed(), built = this.testimonialsFeedBuild(feed);
        const norm = (cs) => JSON.stringify(Object.keys(cs || {}).sort().map(k => [k, (cs[k] || []).map(x => x.id + '|' + x.text).sort()]));
        let liveCs = {}; try { liveCs = JSON.parse((this._tmState.last && this._tmState.last.content) || '{}').courses || {}; } catch (e) { liveCs = {}; }
        const pending = norm(liveCs) !== norm(built.courses);
        const sec = this._tmSection || 'published';
        const pill = (k, label, n) => '<button onclick="App.tmSection(\'' + k + '\')" class="px-4 py-2 rounded-lg text-sm font-bold ' + (sec === k ? 'bg-gsf-prussian text-white' : 'text-gsf-prussian hover:bg-slate-100') + '">' + label + (n != null ? ' <span class="text-[11px] font-semibold opacity-70">' + n + '</span>' : '') + '</button>';
        const props = this._tmProposals || null;
        const head = '<div class="flex items-end justify-between gap-4 flex-wrap mb-4"><div><h2 class="text-xl font-bold text-gsf-prussian">Testimonials on surghub.org</h2>'
            + '<p class="text-sm text-slate-500 mt-1">' + this.formatNumber(built._stats.testimonials) + ' on ' + built._stats.courses + ' course pages · target ' + this._tmTarget() + ' per course (at least ' + this._tmMinimum() + ')'
            + (this.tmSetting('shuffle') !== 'off' ? ' · ' + (this.tmSetting('shuffle') === 'rotate' ? 'weekly rotation' : 'order shuffled daily') : '') + '</p></div>'
            + '<div class="text-right text-xs">' + (pending ? '<span class="text-amber-700">changes not online yet</span> <button data-edit-only onclick="App.publishWebsiteMetrics(this)" class="ml-1 px-3 py-1.5 rounded-lg bg-gsf-boston text-white font-bold">Publish now</button>' : '<span class="text-emerald-700 font-semibold">online as shown</span>') + '</div></div>'
            + '<div class="flex items-center gap-1 flex-wrap mb-4 bg-white border rounded-xl p-1 w-fit">' + pill('published', 'Published', built._stats.testimonials) + pill('find', 'Find better', props ? props.length : null) + pill('courses', 'Courses') + pill('settings', 'Settings') + '</div>'
            + (this._tmUndo ? '<div class="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 mb-4 flex items-center gap-3 text-sm text-amber-900">' + esc(this._tmUndo.label) + '<button onclick="App.tmUndo()" class="font-bold underline">Undo</button><button onclick="App._tmUndo = null; App._tmRerender()" class="ml-auto text-xs text-amber-700">dismiss</button></div>' : '');
        const body = sec === 'find' ? this._tmFindHtml(esc, feed) : sec === 'courses' ? this._tmCoursesHtml() : sec === 'settings' ? this._tmSettingsHtml(esc) : this._tmPublishedHtml(esc, feed);
        const out = head + '<div id="tm-body">' + body + '</div>';
        if (this._tmQuery) setTimeout(() => this.tmSearch(this._tmQuery), 0);
        return out;
    },

    _tmPublishedHtml(esc, feed) {
        const f = this._tmPubF || {};
        const allRows = this._tmPublishedRows();
        let rows = allRows;
        if (f.lang) rows = rows.filter(x => x.lang === f.lang);
        if (f.show === 'problems') rows = rows.filter(x => x.flags.length);
        else if (f.show === 'pending') rows = rows.filter(x => x.live !== 'live');
        else if (f.show === 'short') rows = rows.filter(x => x.words <= 5);
        else if (f.show === 'long') rows = rows.filter(x => x.words > 60);
        else if (f.show === 'auto') rows = rows.filter(x => x.e.auto);
        else if (f.show === 'unchecked') rows = rows.filter(x => !x.q.judged);
        const counts = { problems: allRows.filter(x => x.flags.length).length };
        const sel = (k, opts) => '<select onchange="App.tmPubFilter(\'' + k + '\', this.value)" class="text-xs border rounded-lg px-2 py-1.5">' + opts.map(([v, l]) => '<option value="' + v + '"' + ((f[k] || '') === v ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>';
        const stars = (n) => n ? '<span class="text-amber-500 text-[11px]">' + '★'.repeat(n) + '</span>' : '';
        const byCourse = {}; rows.forEach(x => { (byCourse[x.c.id] = byCourse[x.c.id] || []).push(x); });
        const shownOf = {}; allRows.forEach(x => { shownOf[x.c.id] = (shownOf[x.c.id] || 0) + 1; });
        const groups = feed.courses.filter(c => byCourse[c.id]).map(c => {
            const list = byCourse[c.id], n = shownOf[c.id] || 0, tone = n < this._tmMinimum() ? 'bg-rose-50 text-rose-700 border-rose-200' : n < this._tmTarget() ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200';
            return '<div data-tmg class="bg-white rounded-xl border shadow-sm mb-3 overflow-hidden"><div class="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b"><span class="text-sm font-bold text-gsf-prussian">' + esc(c.title) + '</span>'
                + '<span class="px-2 py-0.5 rounded-full border text-[10px] font-bold ' + tone + '">' + n + ' / ' + this._tmTarget() + '</span><span class="text-[10px] uppercase font-bold text-slate-400">' + esc(this._tmPageLang(c.id)) + '</span>'
                + '<button onclick="App._tmCourse = \'' + this.escapeJsArg(c.id) + '\'; App.tmSection(\'courses\')" class="ml-auto text-[11px] text-gsf-boston hover:underline">open course</button></div>'
                + list.map(x => {
                    const idJs = this.escapeJsArg(x.id), meta = [x.lb.cadre, x.lb.country].filter(Boolean).join(', ') || 'SURGhub learner';
                    const tone = x.q.ok ? 'bg-emerald-50 text-emerald-700' : x.q.no ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-500';
                    const search = this._tmNorm([c.title, x.text, x.lb.cadre, x.lb.country].join(' '));
                    let row = '<div data-tms="' + esc(search) + '" class="px-4 py-2.5 border-b border-slate-100 last:border-0 ' + (x.flags.length ? 'bg-rose-50/30' : '') + '"><div class="flex items-start gap-3">'
                        + '<span class="text-xs font-bold text-slate-400 w-5 pt-0.5">' + x.pos + '</span><div class="flex-1 min-w-0">'
                        + '<p class="text-sm text-slate-800" title="' + esc(x.r && x.r.text !== x.text ? 'Original: ' + x.r.text : 'Shown as written') + '">“' + esc(x.text) + '”</p>'
                        + '<p class="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">' + esc(meta) + ' ' + stars(x.r && x.r.stars) + '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold ' + tone + '">' + esc(x.q.label) + '</span>'
                        + (x.live !== 'live' ? '<span class="text-amber-700">' + esc(x.live) + '</span>' : '') + x.flags.map(fl => '<span class="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-bold">' + esc(fl) + '</span>').join('') + '</p></div>'
                        + '<div class="flex items-center gap-1 shrink-0" data-edit-only><button onclick="App.tmMoveUndoable(\'' + idJs + '\', -1)" class="px-1.5 py-0.5 border rounded text-slate-500 hover:text-gsf-boston text-xs" title="Move up">▲</button><button onclick="App.tmMoveUndoable(\'' + idJs + '\', 1)" class="px-1.5 py-0.5 border rounded text-slate-500 hover:text-gsf-boston text-xs" title="Move down">▼</button>'
                        + '<button onclick="App.tmOpenSwap(\'' + idJs + '\')" class="px-2.5 py-1 rounded-lg text-xs font-bold ' + (this._tmSwapFor === x.id ? 'bg-gsf-prussian text-white' : 'bg-gsf-boston text-white hover:bg-gsf-prussian') + '">Swap</button>'
                        + '<button onclick="App.tmSwitchOff(\'' + idJs + '\')" class="px-2.5 py-1 rounded-lg text-xs font-bold border text-slate-600 hover:border-rose-400 hover:text-rose-600">Off</button></div></div>';
                    if (this._tmSwapFor === x.id) row += this._tmSwapPanelHtml(esc, x);
                    return row + '</div>';
                }).join('') + '</div>';
        }).join('');
        return '<div class="flex items-center gap-2 flex-wrap mb-3"><div class="relative"><input id="tm-search" type="search" value="' + esc(this._tmQuery || '') + '" oninput="App.tmSearch(this.value)" placeholder="Search course, text, cadre, country…" class="pl-3 pr-3 py-2 w-80 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gsf-boston/30"></div>'
            + sel('show', [['', 'All testimonials'], ['problems', 'With problems (' + counts.problems + ')'], ['pending', 'Not online yet'], ['short', '5 words or fewer'], ['long', 'Over 60 words'], ['auto', 'Picked or swapped automatically'], ['unchecked', 'Not checked yet']])
            + sel('lang', [['', 'All languages'], ['en', 'English pages'], ['fr', 'French pages'], ['es', 'Spanish pages'], ['ar', 'Arabic pages']])
            + '<span id="tm-count" class="text-xs text-slate-400">' + rows.length + ' shown</span>'
            + '<button onclick="App.tmExportXlsx(this)" class="ml-auto px-3 py-2 border border-slate-300 hover:border-gsf-boston text-gsf-prussian text-xs font-bold rounded-lg">Download Excel</button></div>'
            + (groups || '<p class="text-sm text-slate-400 p-6">Nothing matches.</p>');
    },
    _tmSwapPanelHtml(esc, x) {
        const alt = this._tmAlternatives(x.id), idJs = this.escapeJsArg(x.id), lang = x.lang;
        const item = (a) => { const lb = this._tmLabels({}, a.r, lang), meta = [lb.cadre, lb.country].filter(Boolean).join(', ') || 'SURGhub learner';
            return '<div data-tma="' + esc(this._tmNorm(a.r.text)) + '" class="flex items-start gap-3 py-2 border-b border-slate-100 last:border-0"><div class="flex-1"><p class="text-sm text-slate-700">' + esc(a.r.text) + '</p><p class="text-[10px] text-slate-400 mt-0.5">' + esc(meta) + ' · ' + esc(a.r.date) + ' · ' + esc(a.q.label) + '</p></div>'
                + '<button data-edit-only onclick="App.tmSwap(\'' + idJs + '\', \'' + this.escapeJsArg(a.r.id) + '\', this)" class="shrink-0 px-3 py-1 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white">Use this</button></div>'; };
        return '<div class="mt-3 ml-8 border border-sky-200 bg-sky-50/40 rounded-xl p-3"><p class="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Best alternatives on this course (one per learner, not near-identical, at most one generic)</p>'
            + (alt.good.length ? alt.good.slice(0, 5).map(item).join('') : '<p class="text-xs text-slate-500 py-2">' + (alt.rest.some(a => a.q.judged) ? 'No checked alternative passes the bar on this course. Search all its comments below, or switch this one off.' : 'This course\'s comments have not been checked yet (Find better → Scan now). All of them are listed below, best rated first.') + '</p>')
            + '<details class="mt-2"' + (alt.good.length ? '' : ' open') + '><summary class="text-xs text-gsf-boston cursor-pointer">Search all ' + (alt.good.length + alt.rest.length) + ' comments on this course</summary>'
            + '<input type="search" placeholder="Words in the comment…" oninput="(function(v, box){ v = App._tmNorm(v); box.querySelectorAll(\'[data-tma]\').forEach(function(el){ el.style.display = !v || el.getAttribute(\'data-tma\').includes(v) ? \'\' : \'none\'; }); })(this.value, this.parentNode)" class="w-full mt-2 mb-1 px-3 py-1.5 border rounded-lg text-sm">'
            + '<div class="max-h-80 overflow-y-auto custom-scrollbar">' + alt.good.slice(5).concat(alt.rest).slice(0, 300).map(item).join('') + '</div></details></div>';
    },

    _tmFindHtml(esc, feed) {
        const last = this._tm.lastScan || '', since = last.slice(0, 10);
        const fresh = feed.courses.reduce((n, c) => n + this.tmResponses(c.id).filter(r => !since || String(r.date) > since).length, 0);
        const head = '<div class="bg-white rounded-xl border shadow-sm p-4 mb-4 flex items-center gap-3 flex-wrap"><div class="text-sm text-slate-600">' + (last ? 'Last scan ' + esc(last.slice(0, 10)) + ' · <strong>' + this.formatNumber(fresh) + '</strong> comments received since' : 'Not scanned yet') + '</div>'
            + '<button data-edit-only onclick="App.tmReviewAll(this)" class="ml-auto px-4 py-2 bg-gsf-prussian hover:bg-slate-900 text-white text-xs font-bold rounded-lg" title="Check new comments (and any checked with an older instruction), then suggest changes">Scan now</button></div>'
            + '<p class="text-xs text-slate-500 mb-4 max-w-4xl">The scan checks comments it has not seen (it asks before calling Claude), then suggests: <strong>problems</strong> to fix (not a testimonial, the same learner twice, a second generic comment, one learner on too many courses), <strong>courses below the target</strong> of ' + this._tmTarget() + ', and <strong>upgrades</strong> (' + ({ clear: 'only clearly better: one strength point higher', problems: 'none: only problems and gaps', newer: 'better, or as good and newer' }[this.tmSetting('upgrade')]) + '; change in Settings). Dismissed suggestions do not come back.</p>';
        const list = this._tmProposals;
        if (!list) return head + '<p class="text-sm text-slate-400 p-4">Press Scan now to see suggestions.</p>';
        if (!list.length) return head + '<div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-800">Nothing to change. Every course is at its target or has no better comments waiting.</div>';
        const title = {}; feed.courses.forEach(c => { title[c.id] = c.title; });
        const lbl = (r, cid) => { const lb = this._tmLabels({}, r, this._tmPageLang(cid)); return [lb.cadre, lb.country].filter(Boolean).join(', ') || 'SURGhub learner'; };
        const card = (p, i) => {
            const oldT = p.old ? ((p.old.e && p.old.e.text) || (p.old.r && p.old.r.text) || '') : '';
            return '<div class="flex items-stretch gap-2 flex-wrap py-2 border-b border-slate-100 last:border-0"><div class="w-full text-[11px] font-bold text-gsf-prussian">' + esc(title[p.course] || p.course) + (p.why ? ' <span class="font-normal text-slate-500">· ' + esc(p.why) + '</span>' : '') + '</div>'
                + (p.old ? '<div class="flex-1 min-w-[220px] border rounded-lg p-2 bg-white"><div class="text-[10px] uppercase font-bold text-slate-400">On the page now</div><p class="text-xs text-slate-700">“' + esc(oldT) + '”</p>' + (p.old.r ? '<p class="text-[10px] text-slate-400">' + esc(lbl(p.old.r, p.course)) + ' · ' + esc(this._tmQ(p.course, p.old.r).label) + '</p>' : '') + '</div>' : '')
                + (p.cand ? (p.old ? '<div class="self-center text-slate-300">→</div>' : '') + '<div class="flex-1 min-w-[220px] border border-emerald-200 rounded-lg p-2 bg-emerald-50/40"><div class="text-[10px] uppercase font-bold text-emerald-700">' + (p.type === 'add' ? 'Add' : 'Instead') + '</div><p class="text-xs text-slate-700">“' + esc(p.cand.r.text) + '”</p><p class="text-[10px] text-slate-400">' + esc(lbl(p.cand.r, p.course)) + ' · ' + esc(p.cand.q.label) + '</p></div>' : '')
                + '<div class="flex flex-col gap-1 shrink-0" data-edit-only><button onclick="App.tmAcceptOne(' + i + ', this)" class="px-3 py-1 text-[11px] font-bold rounded ' + (p.type === 'weak' ? 'bg-rose-600' : 'bg-gsf-boston') + ' text-white">' + (p.type === 'weak' ? 'Switch off' : 'Accept') + '</button>'
                + '<button onclick="App.tmDismiss(' + i + ')" class="px-3 py-1 text-[11px] font-bold rounded border text-slate-500" title="Do not suggest this again">Dismiss</button></div></div>';
        };
        const group = (kind, titleTxt, sub) => {
            const items = list.map((p, i) => [p, i]).filter(([p]) => this._tmGroupOf(p) === kind);
            if (!items.length) return '';
            return '<div class="bg-white rounded-xl border shadow-sm p-4 mb-4"><div class="flex items-center gap-3 mb-1"><h3 class="text-sm font-bold text-gsf-prussian">' + titleTxt + ' <span class="text-slate-400 font-semibold">' + items.length + '</span></h3><span class="text-xs text-slate-500">' + sub + '</span>'
                + '<button data-edit-only onclick="App.tmAcceptGroup(\'' + kind + '\', this)" class="ml-auto px-3 py-1.5 text-xs font-bold rounded-lg bg-gsf-boston hover:bg-gsf-prussian text-white">Accept all ' + items.length + '</button></div>'
                + '<div class="max-h-[520px] overflow-y-auto custom-scrollbar pr-1">' + items.map(([p, i]) => card(p, i)).join('') + '</div></div>';
        };
        return head + group('problems', 'Problems on the site', 'replaced where something good is waiting, otherwise switched off')
            + group('gaps', 'Courses below the target', 'the best comments to add')
            + group('upgrades', 'Upgrades', 'clearly better comments for testimonials that are fine');
    },

    _tmSettingsHtml(esc) {
        const v = (k) => this.tmSetting(k);
        const row = (label, ctl, help) => '<div class="grid grid-cols-[220px_1fr] gap-4 py-3 border-b border-slate-100 items-start"><div class="text-sm font-bold text-gsf-prussian">' + label + '</div><div>' + ctl + (help ? '<p class="text-[11px] text-slate-500 mt-1">' + help + '</p>' : '') + '</div></div>';
        const num = (k) => '<input type="number" min="1" max="12" value="' + esc(v(k)) + '" onchange="App.tmSetSetting(\'' + k + '\', this.value)" class="w-20 border rounded-lg px-2 py-1 text-sm" data-edit-only>';
        const sel = (k, opts) => '<select onchange="App.tmSetSetting(\'' + k + '\', this.value)" class="border rounded-lg px-2 py-1 text-sm" data-edit-only>' + opts.map(([o, l]) => '<option value="' + o + '"' + (String(v(k) || '') === o ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>';
        const prompt = (k, def) => '<textarea id="tm-set-' + k + '" rows="10" class="w-full border rounded-lg px-3 py-2 text-xs font-mono" data-edit-only>' + esc(v(k) || def) + '</textarea>'
            + '<div class="flex gap-2 mt-1" data-edit-only><button onclick="App.tmSetSetting(\'' + k + '\', document.getElementById(\'tm-set-' + k + '\').value)" class="px-3 py-1 text-xs font-bold rounded-lg bg-gsf-boston text-white">Save</button>'
            + (v(k) ? '<button onclick="App.tmSetSetting(\'' + k + '\', \'\')" class="px-3 py-1 text-xs font-bold rounded-lg border text-slate-600">Reset to the default</button><span class="text-[11px] text-amber-700 self-center">customised</span>' : '<span class="text-[11px] text-slate-400 self-center">the default</span>') + '</div>';
        return '<div class="bg-white rounded-xl border shadow-sm p-5">'
            + row('Target per course', num('target'), 'How many testimonials a course page aims for. "Find better" fills courses up to this.')
            + row('Minimum', num('min'), 'Courses with fewer are marked red on the Published list.')
            + row('Upgrades', sel('upgrade', [['clear', 'Only clearly better (one strength point higher)'], ['problems', 'None: only problems and gaps'], ['newer', 'Better, or as good and newer']]), 'How eager "Find better" is to suggest swapping a testimonial that is fine.')
            + row('Shuffle on the site', sel('shuffle', [['off', 'Off: the order you set'], ['order', 'Shuffle the order every day'], ['rotate', 'Rotate weekly from all switched on (when more than the target)']]), 'With rotation, switch on more good testimonials than the target (say 10 for 6): each week the page shows a different 6, in a fresh order each day. Only switched-on testimonials are ever shown.')
            + row('The check\'s model', sel('judgeModel', [['', 'Default: Claude Opus 5.5']].concat(this.TM_MODELS.slice(1))), 'A different model makes earlier verdicts stale: the next scan checks every comment again (asks first, shows the cost).')
            + row('The check\'s instruction', prompt('judgePrompt', this.TM_JUDGE_PROMPT), 'What Claude is asked about each comment. Keep the list of verdicts and reasons; the app reads them.')
            + row('The editing rule', prompt('editPrompt', this.TM_TIDY_PROMPT) + '<button data-edit-only onclick="App.tmRetidy(null, this)" class="mt-2 px-3 py-1.5 border border-slate-300 hover:border-gsf-boston text-gsf-prussian text-xs font-bold rounded-lg">Re-edit every published text with this rule</button>', 'How a comment becomes the text on the page. Applies to swaps, picks and re-edits from now on.')
            + '</div>';
    },
});
