// ── Learner journeys: funnel, pathways, time to completion, activation ───────
// Built on the per-(learner, course) completion records, which since the API sync
// carry an enrolment date for every enrolment — so "enrolled but never opened" is
// a real number, each learner's courses can be put in order, and time from
// enrolment to completion is measurable. Definitions shared with the other tabs:
// "opened" = start_date present (the learner opened the course); "completed" =
// a certificate was issued — the certificate IS the completion test (LearnWorlds'
// own completed flag marks many certified learners as not completed and is
// ignored here). Durations are enrolment → certificate day. In API records the start date equals the
// enrolment date (the API has no first-activity timestamp), so durations here are
// enrolment → completion. Pathways order each learner's opened courses by date
// (one entry per course; a re-enrolment keeps the first) and count consecutive
// pairs, triples and quadruples — the "top learning paths" list. "Returned after a
// certificate" = opened another course after the day of the learner's first
// certificate. Activation uses the account index
// (surghub_accounts: sign-up day, last-login day and email domain per hashed
// learner id, written by every enrolment sync's account listing — hashed ids
// and domains only, never exported).
Object.assign(window.App, {
    JRN_FAST_MIN: 10,          // a certificate with fewer recorded minutes than this is flagged
    JRN_ACTIVATION_DAYS: 30,   // sign-up → first course opened within this many days = activated
    JRN_MIN_DEFAULT: 100,      // funnel table: minimum enrolments per course, by default
    JRN_MONTHS: 24,            // activation: sign-up months shown
    JRN_PATH_MIN_DEFAULT: 10,  // learning paths: minimum learners per chain shown
    JRN_PATH_ROWS: 15,         // learning paths: chains listed

    _jrnDay(s) { s = String(s || ''); return s.length >= 10 ? s.slice(0, 10) : ''; },
    _jrnDays(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); },
    _jrnMedian(arr) { if (!arr || !arr.length) return null; const s = arr.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; },
    _jrnPct(n, d) { return d ? Math.round(1000 * n / d) / 10 : 0; },
    _jrnTop(map, k) { return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, k); },
    _jrnNorm(t) { return this._sparkNorm ? this._sparkNorm(t) : String(t || '').toLowerCase().replace(/[^a-z0-9]/g, ''); },
    _jrnFind(idx, title) {
        if (!idx || !title) return null;
        if (idx.courses.has(title)) return title;
        const n = this._jrnNorm(title);
        for (const k of idx.courses.keys()) if (this._jrnNorm(k) === n) return k;
        return null;
    },
    _jrnProviderOf() {
        if (this._jrnProvMap && this._jrnProvMap.src === this.data) return this._jrnProvMap.map;
        const map = {}; (this.data || []).forEach(d => { if (d && d.Course && d.Provider && !map[d.Course]) map[d.Course] = d.Provider; });
        this._jrnProvMap = { src: this.data, map }; return map;
    },

    // ── Index over the records (rebuilt only when the records array changes) ──
    _jrnIndex() {
        const rows = this._rawCompletion;
        if (!Array.isArray(rows)) { if (this._sparkEnsureLoaded) this._sparkEnsureLoaded(); return null; }
        if (this._jrnIdx && this._jrnIdx.src === rows) return this._jrnIdx;
        const courses = new Map(), byUid = new Map();
        const cstat = (t) => { let c = courses.get(t); if (!c) { c = { course: t, enrolled: 0, opened: 0, completed: 0, certified: 0, fast: 0, durations: [], next: new Map(), prev: new Map(), certLearners: 0, returned: 0 }; courses.set(t, c); } return c; };
        for (const r of rows) {
            if (!r || !r.course || !r.uid) continue;
            const c = cstat(r.course), sd = this._jrnDay(r.start_date);
            c.enrolled++;
            if (sd) c.opened++;
            if (r.certificate) {
                c.certified++; c.completed++;
                if ((Number(r.time_minutes) || 0) < this.JRN_FAST_MIN) c.fast++;
                const cd = this._jrnDay(r.certificate_date) || this._jrnDay(r.completion_date);
                if (sd && cd && cd >= sd) c.durations.push(this._jrnDays(sd, cd));
            }
            let u = byUid.get(r.uid); if (!u) { u = { starts: [], firstCert: '', firstCertCourse: '' }; byUid.set(r.uid, u); }
            if (sd) u.starts.push({ course: r.course, date: sd });
            if (r.certificate) { const d = this._jrnDay(r.certificate_date); if (d && (!u.firstCert || d < u.firstCert)) { u.firstCert = d; u.firstCertCourse = r.course; } }
        }
        const transitions = new Map(), gaps = [], perLearner = [0, 0, 0, 0];   // 1, 2, 3–4, 5+ courses opened
        const chains3 = new Map(), chains4 = new Map();                          // consecutive 3- and 4-course chains
        let learners = 0, multi = 0, never = 0, certLearners = 0, returned = 0, four = 0;
        for (const u of byUid.values()) {
            learners++;
            if (!u.starts.length) { never++; continue; }
            u.starts.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.course.localeCompare(b.course));
            const seen = new Set(), seq = [];
            for (const s of u.starts) { if (seen.has(s.course)) continue; seen.add(s.course); seq.push(s); }
            u.seq = seq; u.first = seq[0].date;
            const n = seq.length; perLearner[n >= 5 ? 3 : n >= 3 ? 2 : n - 1]++; if (n >= 2) multi++; if (n === 4) four++;
            for (let i = 1; i < n; i++) {
                const a = seq[i - 1], b = seq[i], k = a.course + ' > ' + b.course, g = this._jrnDays(a.date, b.date);
                const t = transitions.get(k) || { from: a.course, to: b.course, n: 0, gaps: [] }; t.n++; t.gaps.push(g); transitions.set(k, t);
                const ca = cstat(a.course), cb = cstat(b.course);
                ca.next.set(b.course, (ca.next.get(b.course) || 0) + 1); cb.prev.set(a.course, (cb.prev.get(a.course) || 0) + 1);
                gaps.push(g);
            }
            for (let i = 0; i + 2 < n; i++) { const k = seq[i].course + ' › ' + seq[i + 1].course + ' › ' + seq[i + 2].course; chains3.set(k, (chains3.get(k) || 0) + 1); }
            for (let i = 0; i + 3 < n; i++) { const k = seq[i].course + ' › ' + seq[i + 1].course + ' › ' + seq[i + 2].course + ' › ' + seq[i + 3].course; chains4.set(k, (chains4.get(k) || 0) + 1); }
            if (u.firstCert) { certLearners++; const c = cstat(u.firstCertCourse); c.certLearners++; if (seq.some(s => s.date > u.firstCert)) { returned++; c.returned++; } }
        }
        const totals = { enrolled: 0, opened: 0, completed: 0, certified: 0, fast: 0, durations: [] };
        for (const c of courses.values()) {
            c.median = this._jrnMedian(c.durations); c.within1 = c.durations.filter(d => d <= 1).length; c.over30 = c.durations.filter(d => d > 30).length;
            totals.enrolled += c.enrolled; totals.opened += c.opened; totals.completed += c.completed; totals.certified += c.certified; totals.fast += c.fast;
            for (const d of c.durations) totals.durations.push(d);
        }
        totals.median = this._jrnMedian(totals.durations);
        const tr = [...transitions.values()].sort((a, b) => b.n - a.n); tr.forEach(t => { t.medianGap = this._jrnMedian(t.gaps); });
        const topChains = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => ({ courses: k.split(' › '), n }));
        const idx = { src: rows, courses, byUid, transitions: tr, gapMedian: this._jrnMedian(gaps), perLearner, learners, multi, never, certLearners, returned, totals, chains3: topChains(chains3), chains4: topChains(chains4), chains3Total: [...chains3.values()].reduce((a, b) => a + b, 0), chains4Learners4: four };
        this._jrnIdx = idx; return idx;
    },
    _jrnProviderStats(provider) {
        const idx = this._jrnIndex(); if (!idx) return null;
        const titles = this._providerCourseTitles ? this._providerCourseTitles(provider) : [];
        const agg = { course: provider, enrolled: 0, opened: 0, completed: 0, certified: 0, fast: 0, durations: [], courses: 0 };
        for (const t of titles) { const k = this._jrnFind(idx, t); if (!k) continue; const c = idx.courses.get(k); agg.courses++; agg.enrolled += c.enrolled; agg.opened += c.opened; agg.completed += c.completed; agg.certified += c.certified; agg.fast += c.fast; for (const d of c.durations) agg.durations.push(d); }
        agg.median = this._jrnMedian(agg.durations); agg.within1 = agg.durations.filter(d => d <= 1).length; agg.over30 = agg.durations.filter(d => d > 30).length;
        return agg.enrolled ? agg : null;
    },

    // ── Funnel strip: three steps with conversion ──
    _jrnFunnelHtml(c, opts) {
        opts = opts || {};
        const esc = (t) => this.escapeHtml(t), pct = this._jrnPct.bind(this);
        const steps = [
            ['Enrolled', c.enrolled, '', 'Enrolments (learner-course records)'],
            ['Opened', c.opened, pct(c.opened, c.enrolled) + '% of enrolled', 'Records with a start date: the learner opened the course'],
            ['Completed', c.certified, pct(c.certified, c.opened) + '% of opened', 'Certificate issued: the completion test'],
        ];
        const w = opts.compact ? 'min-w-[92px]' : 'min-w-[120px]';
        return `<div class="flex items-stretch gap-1.5 flex-wrap">${steps.map(([l, v, sub, tip]) => `<div class="${w} rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2" title="${esc(tip)}">
            <div class="text-[10px] font-bold uppercase tracking-wide text-slate-400">${l}</div>
            <div class="text-lg font-bold leading-tight text-gsf-prussian" style="font-family:var(--num)">${this.formatNumber(v)}</div>
            ${sub ? `<div class="text-[10px] text-slate-500">${esc(sub)}</div>` : `<div class="text-[10px] text-slate-400">${c.enrolled ? Math.round(100 * (c.enrolled - c.opened) / c.enrolled) + '% never opened' : ''}</div>`}
            <div class="h-1 mt-1.5 rounded bg-slate-200 overflow-hidden"><div class="h-full bg-gsf-boston" style="width:${c.enrolled ? Math.max(2, Math.round(100 * v / c.enrolled)) : 0}%"></div></div>
        </div>`).join('')}</div>`;
    },
    _jrnTimeHtml(c) {
        const n = c.durations.length; if (!n) return '<span class="text-slate-400 text-xs">no completions</span>';
        return `<span title="Days from enrolment to the certificate, ${this.formatNumber(n)} certificates with both dates">median <strong>${c.median} d</strong> to complete · ${this._jrnPct(c.within1, n)}% within a day · ${this._jrnPct(c.over30, n)}% over 30 d</span>`;
    },
    _jrnFastHtml(c) {
        if (!c.certified) return '';
        const p = this._jrnPct(c.fast, c.certified), cls = p >= 15 ? 'text-red-600' : p >= 5 ? 'text-amber-600' : 'text-slate-500';
        return `<span class="${cls}" title="Certificates with under ${this.JRN_FAST_MIN} recorded minutes of learning time: worth a look, or an undercount in the LearnWorlds timer">${this.formatNumber(c.fast)} fast certificates (${p}%)</span>`;
    },

    // ── Course and provider page strips ──
    _jrnCourseStripHtml(course) {
        const idx = this._jrnIndex(); if (!idx) return '';
        const k = this._jrnFind(idx, course); if (!k) return '';
        const c = idx.courses.get(k), esc = (t) => this.escapeHtml(t), link = (t) => `<button onclick="App.openCourse('${this.escapeJsArg(t)}')" class="text-gsf-boston hover:underline text-left">${esc(t)}</button>`;
        const nextTop = this._jrnTop(c.next, 3), prevTop = this._jrnTop(c.prev, 3);
        const list = (arr, denom) => arr.length ? arr.map(([t, n]) => `${link(t)} <span class="text-slate-400 text-xs">${this._jrnPct(n, denom)}%</span>`).join('<span class="text-slate-300 mx-1.5">·</span>') : '<span class="text-slate-400">none yet</span>';
        return `<div class="bg-white border border-slate-200 rounded-xl shadow-sm px-5 py-4 mb-6">
            <div class="flex items-center justify-between gap-3 flex-wrap mb-3"><h3 class="text-sm font-bold text-gsf-prussian flex items-center gap-2"><i data-lucide="route" width="14" class="text-gsf-boston"></i> Learner journey</h3><button onclick="App._dashTab='journeys'; App._jrnCourse='${this.escapeJsArg(k)}'; App.navigate('platform')" class="text-xs text-gsf-boston hover:underline">Open the Learner journeys tab →</button></div>
            <div class="flex flex-wrap gap-x-10 gap-y-4 items-start">
                ${this._jrnFunnelHtml(c, { compact: true })}
                <div class="text-sm max-w-xl"><div class="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Learners go on to</div>${list(nextTop, c.opened)}
                    <div class="text-[10px] font-bold uppercase tracking-wide text-slate-400 mt-2 mb-1">Came from</div>${list(prevTop, c.opened)}</div>
                <div class="text-xs text-slate-600 space-y-1"><div>${this._jrnTimeHtml(c)}</div><div>${this._jrnFastHtml(c)}</div>${c.certLearners ? `<div title="Learners whose first certificate was for this course, and how many opened another course afterwards">${this._jrnPct(c.returned, c.certLearners)}% of ${this.formatNumber(c.certLearners)} learners certified here first went on to another course</div>` : ''}</div>
            </div></div>`;
    },
    _jrnProviderStripHtml(provider) {
        const agg = this._jrnProviderStats(provider); if (!agg) return '';
        return `<div class="bg-white border border-slate-200 rounded-xl shadow-sm px-5 py-4 mb-6">
            <div class="flex items-center justify-between gap-3 flex-wrap mb-3"><h3 class="text-sm font-bold text-gsf-prussian flex items-center gap-2"><i data-lucide="route" width="14" class="text-gsf-boston"></i> Learner journey · ${agg.courses} included course${agg.courses === 1 ? '' : 's'}</h3><button onclick="App._dashTab='journeys'; App._jrnBy='provider'; App.navigate('platform')" class="text-xs text-gsf-boston hover:underline">Compare providers →</button></div>
            <div class="flex flex-wrap gap-x-10 gap-y-3 items-center">${this._jrnFunnelHtml(agg, { compact: true })}<div class="text-xs text-slate-600 space-y-1"><div>${this._jrnTimeHtml(agg)}</div><div>${this._jrnFastHtml(agg)}</div></div></div></div>`;
    },

    // ── Activation: account index ──
    async _accountsLoad() {
        if (this._accounts !== undefined) return this._accounts;
        this._accounts = null;
        try { const v = await Storage.getItem('surghub_accounts'); this._accounts = (v && v.byUid) ? v : null; } catch (e) { this._accounts = null; }
        return this._accounts;
    },
    _accountsFromUsers(users, listedAt) {
        const byUid = {}, day = (s) => { const n = Number(s); return n ? new Date(n * 1000).toISOString().slice(0, 10) : ''; };
        for (const u of users.values()) {
            if (!u || !u.email) continue;
            const email = String(u.email).toLowerCase().trim();
            byUid[this._djb2Hash(email)] = { c: day(u.created), l: day(u.lastLogin), d: this._instDomain ? this._instDomain(email) : (email.split('@')[1] || '') };
        }
        return { v: 1, at: new Date().toISOString(), listedAt: listedAt || new Date().toISOString(), n: Object.keys(byUid).length, byUid };
    },
    async _accountsPersist(acc) { await Storage.setItem('surghub_accounts', acc); this._accounts = acc; this._jrnAct = null; },
    // One-off: build the index from the newest receipt that holds a full account listing.
    async _accountsBuildFromReceipt(silent) {
        const dirs = this._enrReceiptDirs ? this._enrReceiptDirs() : [];
        if (!dirs.length) { if (!silent) this.showMsg('No LearnWorlds receipt on disk yet: run card 2 (Sync from API) once.'); return null; }
        const meta = await this._enrLoadMeta(); const skip = (meta.run && meta.run.processed) || {};
        let best = null;
        for (let i = dirs.length - 1; i >= 0 && !best; i--) { const p = this._enrParseReceipt(dirs[i], skip); if (p.users.size >= 1000) best = { users: p.users, dir: dirs[i] }; }
        if (!best) { if (!silent) this.showMsg('No account listing found in the receipts.'); return null; }
        const m = String(best.dir).match(/__(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
        const listedAt = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString() : new Date().toISOString();
        const acc = this._accountsFromUsers(best.users, listedAt);
        await this._accountsPersist(acc);
        if (!silent) { this.showMsg(`Account index built: ${acc.n.toLocaleString()} accounts (listing of ${listedAt.slice(0, 10)})`); if (this.renderView) this.renderView(); }
        return acc;
    },
    _jrnActivation() {
        const acc = this._accounts, idx = this._jrnIndex();
        if (!acc || !idx) return null;
        if (this._jrnAct && this._jrnAct.acc === acc && this._jrnAct.rows === idx.src) return this._jrnAct;
        const asOf = this._jrnDay(acc.listedAt) || new Date().toISOString().slice(0, 10);
        const asOfMs = Date.parse(asOf), d30 = new Date(asOfMs - 30 * 86400000).toISOString().slice(0, 10), d90 = new Date(asOfMs - 90 * 86400000).toISOString().slice(0, 10);
        const months = this._sparkMonths ? this._sparkMonths(this.JRN_MONTHS, true, asOf) : [];
        const byMonth = {}; months.forEach(m => { byMonth[m] = { month: m, signups: 0, activated: 0, ever: 0 }; });
        const byDomain = {}; const since12 = months.length > 12 ? months[months.length - 13] : '';
        let total = 0, active30 = 0, active90 = 0, dormant = 0, activated = 0, ever = 0;
        for (const uid of Object.keys(acc.byUid)) {
            const a = acc.byUid[uid]; total++;
            const u = idx.byUid.get(uid), first = u && u.first ? u.first : '';
            if (a.l && a.l >= d30) active30++; if (a.l && a.l >= d90) active90++;
            if (!first) dormant++;
            const cm = a.c ? a.c.slice(0, 7) : '';
            const isAct = !!(first && a.c && this._jrnDays(a.c, first) <= this.JRN_ACTIVATION_DAYS);
            if (isAct) activated++; if (first) ever++;
            if (cm && byMonth[cm]) { byMonth[cm].signups++; if (isAct) byMonth[cm].activated++; if (first) byMonth[cm].ever++; }
            if (a.d && cm && since12 && cm >= since12 && !(this._instIsPersonal && this._instIsPersonal(a.d))) {
                const b = byDomain[a.d] || (byDomain[a.d] = { domain: a.d, signups: 0, activated: 0, active90: 0 });
                b.signups++; if (isAct) b.activated++; if (a.l && a.l >= d90) b.active90++;
            }
        }
        const domains = Object.values(byDomain).filter(b => b.signups >= 20).sort((a, b) => b.signups - a.signups).slice(0, 25);
        const out = { acc, rows: idx.src, asOf, total, active30, active90, dormant, activated, ever, months: months.map(m => byMonth[m]), domains };
        this._jrnAct = out; return out;
    },

    // ── The tab ──
    _dashJourneysHtml() {
        const esc = (t) => this.escapeHtml(t), fmt = (n) => this.formatNumber(n), pct = this._jrnPct.bind(this);
        const idx = this._jrnIndex();
        if (!idx) return `<div class="bg-white rounded-xl border shadow-sm p-8 text-center text-slate-500">Loading learner records…</div>`;
        if (this._accounts === undefined) { this._accountsLoad().then(() => { if (this.view === 'platform' && (this._dashTab || '') === 'journeys') this.renderView(); }); }
        const t = idx.totals, provOf = this._jrnProviderOf();
        const by = this._jrnBy || 'course', minN = Number(this._jrnMin) || this.JRN_MIN_DEFAULT, sortKey = this._jrnSort || 'enrolled', asc = !!this._jrnAsc;
        let rows;
        if (by === 'provider') {
            const provs = [...new Set(Object.values(provOf))].filter(Boolean);
            rows = provs.map(p => this._jrnProviderStats(p)).filter(Boolean).map(a => Object.assign(a, { provider: '' }));
        } else {
            rows = [...idx.courses.values()].map(c => Object.assign({}, c, { provider: provOf[c.course] || '' }));
        }
        rows = rows.filter(r => r.enrolled >= minN);
        const val = (r) => sortKey === 'course' ? r.course.toLowerCase() : sortKey === 'opened' ? pct(r.opened, r.enrolled) : sortKey === 'certified' || sortKey === 'completed' ? pct(r.certified, r.opened) : sortKey === 'median' ? (r.median == null ? -1 : r.median) : sortKey === 'fast' ? pct(r.fast, r.certified) : r.enrolled;
        rows.sort((a, b) => { const va = val(a), vb = val(b); return (va < vb ? -1 : va > vb ? 1 : 0) * (asc ? 1 : -1); });
        const th = (key, label, cls, tip) => `<th class="py-2.5 px-3 font-medium cursor-pointer select-none hover:text-gsf-boston ${cls || ''}" title="${esc(tip || '')}" onclick="App._jrnAsc = App._jrnSort === '${key}' ? !App._jrnAsc : ${key === 'course'}; App._jrnSort='${key}'; App.renderView()">${label} ${sortKey === key ? (asc ? '&#9650;' : '&#9660;') : '<span class="text-slate-300">&#8597;</span>'}</th>`;
        const bar = (p, color) => `<div class="flex items-center gap-2 justify-end"><div class="w-16 h-1.5 rounded bg-slate-100 overflow-hidden"><div class="h-full ${color}" style="width:${Math.min(100, p)}%"></div></div><span class="tabular-nums w-12 text-right">${p}%</span></div>`;
        const pl = idx.perLearner, plTotal = pl.reduce((a, b) => a + b, 0);
        const explorerKey = this._jrnFind(idx, this._jrnCourse) || [...idx.courses.values()].sort((a, b) => b.enrolled - a.enrolled)[0].course;
        const ex = idx.courses.get(explorerKey);
        // top learning paths: chains of 2, 3 or 4 courses, by learners or by share of the first course's openers
        const pathMin = Math.max(1, Number(this._jrnPathMin) || this.JRN_PATH_MIN_DEFAULT), chainLen = [2, 3, 4].includes(Number(this._jrnChainLen)) ? Number(this._jrnChainLen) : 2, chainSort = this._jrnChainSort === 'share' ? 'share' : 'learners';
        const chainSource = chainLen === 2 ? idx.transitions.map(tr => ({ courses: [tr.from, tr.to], n: tr.n, gap: tr.medianGap })) : chainLen === 3 ? idx.chains3 : idx.chains4;
        const chains = chainSource.filter(ch => ch.n >= pathMin).map(ch => Object.assign({}, ch, { share: pct(ch.n, (idx.courses.get(ch.courses[0]) || {}).opened) }));
        chains.sort((x, y) => (chainSort === 'share' ? y.share - x.share : y.n - x.n) || y.n - x.n);
        chains.splice(this.JRN_PATH_ROWS);
        const chainsWithLen = chainLen === 2 ? idx.multi : chainLen === 3 ? idx.perLearner[2] + idx.perLearner[3] : idx.perLearner[3] + idx.chains4Learners4;
        const act = this._jrnActivation();
        const kpi = (label, value, sub, color, tip) => `<div class="bg-white rounded-xl border shadow-sm overflow-hidden" title="${esc(tip || '')}"><div class="h-1" style="background:${color}"></div><div class="p-4"><p class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">${label}</p><p class="text-[26px] font-bold leading-none tracking-tight" style="color:${color};font-family:var(--num)">${value}</p>${sub ? `<p class="text-[10px] text-slate-400 mt-1.5 leading-tight">${sub}</p>` : ''}</div></div>`;
        const openedP = pct(t.opened, t.enrolled), certP = pct(t.certified, t.opened);
        const dur = t.durations, durN = dur.length || 1;
        const bins = [['same day', dur.filter(x => x <= 0).length], ['1–7 days', dur.filter(x => x >= 1 && x <= 7).length], ['8–30 days', dur.filter(x => x > 7 && x <= 30).length], ['31–90 days', dur.filter(x => x > 30 && x <= 90).length], ['over 90 days', dur.filter(x => x > 90).length]];
        const hbar = (l, v, total, color) => `<div class="flex items-center gap-3 text-sm mb-2"><span class="w-24 text-slate-600">${l}</span><div class="flex-1 h-4 bg-slate-100 rounded overflow-hidden"><div class="h-full ${color}" style="width:${total ? Math.max(1, 100 * v / total) : 0}%"></div></div><span class="w-28 text-right tabular-nums text-slate-700">${fmt(v)} <span class="text-slate-400 text-xs">${pct(v, total)}%</span></span></div>`;
        const pathList = (map, denom) => this._jrnTop(map, 6).map(([c, n]) => `<div class="flex justify-between gap-2 py-1 border-b border-slate-100"><button onclick="App._jrnCourse='${this.escapeJsArg(c)}'; App.renderView()" class="text-left text-gsf-prussian hover:text-gsf-boston hover:underline truncate" title="${esc(c)}">${esc(c)}</button><span class="tabular-nums text-slate-500 shrink-0">${fmt(n)} · ${pct(n, denom)}%</span></div>`).join('') || '<div class="text-slate-400">none yet</div>';
        let actHtml;
        if (act) {
            const mx = Math.max(1, ...act.months.map(m => m.signups));
            actHtml = `<div class="grid grid-cols-2 md:grid-cols-4 gap-4 p-5 border-b">
                    <div><p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">Accounts</p><p class="text-xl font-bold text-gsf-prussian" style="font-family:var(--num)">${fmt(act.total)}</p></div>
                    <div title="Opened a first course within ${this.JRN_ACTIVATION_DAYS} days of signing up"><p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">Activated within ${this.JRN_ACTIVATION_DAYS} d</p><p class="text-xl font-bold text-emerald-600" style="font-family:var(--num)">${pct(act.activated, act.total)}%</p><p class="text-[10px] text-slate-400">${pct(act.ever, act.total)}% ever opened a course</p></div>
                    <div><p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">Active in last 30 / 90 d</p><p class="text-xl font-bold text-gsf-boston" style="font-family:var(--num)">${fmt(act.active30)} <span class="text-slate-400 text-sm">/ ${fmt(act.active90)}</span></p><p class="text-[10px] text-slate-400">logged in before ${act.asOf}</p></div>
                    <div title="Accounts that never opened any course"><p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">Dormant</p><p class="text-xl font-bold text-slate-500" style="font-family:var(--num)">${pct(act.dormant, act.total)}%</p><p class="text-[10px] text-slate-400">${fmt(act.dormant)} never opened a course</p></div>
                </div>
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-0">
                    <div class="p-5 border-b lg:border-b-0 lg:border-r"><h4 class="font-bold text-sm text-gsf-prussian mb-3">Sign-ups per month and activation</h4>
                        ${act.months.map((m, i) => { const partial = i === act.months.length - 1; return `<div class="flex items-center gap-2 text-xs mb-1" title="${m.month}: ${fmt(m.signups)} sign-ups, ${pct(m.activated, m.signups)}% activated within ${this.JRN_ACTIVATION_DAYS} d, ${pct(m.ever, m.signups)}% ever opened a course"><span class="w-14 text-slate-500 tabular-nums">${m.month}</span><div class="flex-1 h-3 bg-slate-100 rounded overflow-hidden relative"><div class="h-full ${partial ? 'bg-slate-300' : 'bg-gsf-boston/30'}" style="width:${100 * m.signups / mx}%"></div><div class="h-full ${partial ? 'bg-slate-400' : 'bg-gsf-boston'} absolute top-0 left-0" style="width:${100 * m.activated / mx}%"></div></div><span class="w-28 text-right tabular-nums text-slate-600">${fmt(m.signups)} <span class="text-slate-400">· ${pct(m.activated, m.signups)}%</span></span></div>`; }).join('')}
                        <p class="text-[10px] text-slate-400 mt-2">Bar = sign-ups; darker part = activated within ${this.JRN_ACTIVATION_DAYS} days. The last month is partial and recent months can still activate.</p></div>
                    <div class="p-5"><h4 class="font-bold text-sm text-gsf-prussian mb-3">Institutions, last 12 months of sign-ups</h4>
                        <table class="w-full text-xs"><thead><tr class="text-slate-500 border-b"><th class="py-1.5 text-left font-medium">Domain</th><th class="py-1.5 text-right font-medium">Sign-ups</th><th class="py-1.5 text-right font-medium">Activated</th><th class="py-1.5 text-right font-medium">Active 90 d</th></tr></thead><tbody>${act.domains.map(d => `<tr class="border-b border-slate-100"><td class="py-1.5 font-medium text-gsf-prussian">${esc(d.domain)}</td><td class="py-1.5 text-right tabular-nums">${fmt(d.signups)}</td><td class="py-1.5 text-right tabular-nums">${pct(d.activated, d.signups)}%</td><td class="py-1.5 text-right tabular-nums">${pct(d.active90, d.signups)}%</td></tr>`).join('') || '<tr><td colspan="4" class="py-4 text-center text-slate-400">No institutional domain with 20+ sign-ups in the last 12 months.</td></tr>'}</tbody></table>
                        <p class="text-[10px] text-slate-400 mt-2">Personal email providers are pooled out; institutions with at least 20 sign-ups.</p></div>
                </div>`;
        } else {
            actHtml = `<div class="p-6 text-sm text-slate-500">${this._accounts === undefined ? 'Loading the account index…' : 'No account index yet. Every "Sync from API" run on card 2 writes it; click <strong>Build from the last sync</strong> to create it now from the last listing on disk.'}</div>`;
        }
        return `
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                ${kpi('Enrolments opened', openedP + '%', fmt(t.enrolled - t.opened) + ' of ' + fmt(t.enrolled) + ' never opened', '#206095', 'Records with a start date ÷ all learner-course records')}
                ${kpi('Openers who complete', certP + '%', fmt(t.certified) + ' certificates · a certificate is the completion test', '#4389C8', 'Certificates ÷ opened')}
                ${kpi('Learners with 2+ courses', pct(idx.multi, idx.learners - idx.never) + '%', fmt(idx.multi) + ' of ' + fmt(idx.learners - idx.never) + ' learners who opened a course', '#5B8C5A', 'Learners who opened at least two different courses')}
                ${kpi('Return after a certificate', pct(idx.returned, idx.certLearners) + '%', fmt(idx.returned) + ' of ' + fmt(idx.certLearners) + ' certified learners opened another course later', '#B8860B', 'Opened another course after the day of their first certificate')}
                ${kpi('Enrolment → certificate', t.median == null ? '–' : t.median + ' d', 'median · ' + pct(dur.filter(d => d <= 1).length, dur.length) + '% within a day · ' + pct(dur.filter(d => d > 30).length, dur.length) + '% over 30 d', '#7A9E9F', 'Days from enrolment to the certificate (API start dates equal the enrolment date)')}
                ${kpi('Fast certificates', pct(t.fast, t.certified) + '%', fmt(t.fast) + ' certificates with under ' + this.JRN_FAST_MIN + ' recorded minutes', t.fast / Math.max(1, t.certified) >= 0.05 ? '#D03734' : '#64748b', 'A certificate with almost no recorded learning time: worth a look, or an undercount in the LearnWorlds timer')}
                ${kpi('Between courses', idx.gapMedian == null ? '–' : idx.gapMedian + ' d', 'median gap from one course opened to the next', '#E28743', 'Days between consecutive courses a learner opened')}
                ${act ? kpi('Active learners', fmt(act.active30), fmt(act.active90) + ' logged in within 90 d · as of ' + act.asOf, '#002F4C', 'Accounts with a LearnWorlds login in the last 30 / 90 days before the listing') : kpi('Active learners', '–', 'needs the account index (below)', '#94a3b8', '')}
            </div>

            <div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-8">
                <div class="bg-slate-50 border-b p-5 flex items-center justify-between gap-3 flex-wrap">
                    <div><h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="filter" class="text-gsf-boston" width="18"></i> Funnel by ${by === 'provider' ? 'provider' : 'course'}</h2><p class="text-xs text-slate-500 mt-1">Enrolled → opened → completed, where completed means a certificate was issued. The completion percentage is of <em>opened</em>. "Never opened" is where marketing brings people a course does not hold.</p></div>
                    <div class="flex items-center gap-3 text-xs">
                        <label class="inline-flex items-center gap-1.5">By <select data-viewer-allowed onchange="App._jrnBy=this.value; App.renderView()" class="border rounded px-1.5 py-1"><option value="course" ${by === 'course' ? 'selected' : ''}>course</option><option value="provider" ${by === 'provider' ? 'selected' : ''}>provider</option></select></label>
                        <label class="inline-flex items-center gap-1.5">Min. enrolments <input data-viewer-allowed type="number" min="0" step="50" value="${minN}" onchange="App._jrnMin=Number(this.value)||0; App.renderView()" class="border rounded px-1.5 py-1 w-20"></label>
                        <button onclick="App.exportJourneysXlsx()" class="px-3 py-1.5 border rounded-lg font-bold text-slate-600 hover:text-gsf-boston hover:bg-slate-50" title="Funnel, pathways, time to completion and activation as an Excel workbook (counts only)"><i data-lucide="download" width="12" class="inline mr-1"></i>Excel</button>
                    </div>
                </div>
                <div class="overflow-x-auto max-h-[520px] overflow-y-auto custom-scrollbar"><table class="w-full text-left border-collapse text-sm">
                    <thead class="sticky top-0 bg-white shadow-sm z-10"><tr class="border-b text-slate-500 text-xs">${th('course', by === 'provider' ? 'Provider' : 'Course')}${by === 'provider' ? '' : '<th class="py-2.5 px-3 font-medium">Provider</th>'}${th('enrolled', 'Enrolled', 'text-right')}${th('opened', 'Opened', 'text-right', 'Share of enrolments with a start date')}${th('certified', 'Completed', 'text-right', 'Share of opened with a certificate')}${th('median', 'Median days', 'text-right', 'Enrolment to certificate')}${th('fast', 'Fast certs', 'text-right', 'Certificates with under ' + this.JRN_FAST_MIN + ' recorded minutes')}<th class="py-2.5 px-3 font-medium">Most common next course</th></tr></thead>
                    <tbody>${rows.map(r => {
                        const nx = r.next ? this._jrnTop(r.next, 1)[0] : null;
                        const name = by === 'provider' ? `<button onclick="App.openProvider('${this.escapeJsArg(r.course)}')" class="font-bold text-gsf-prussian hover:text-gsf-boston hover:underline text-left">${esc(r.course)}</button>` : `<button onclick="App.openCourse('${this.escapeJsArg(r.course)}')" class="font-bold text-gsf-prussian hover:text-gsf-boston hover:underline text-left">${esc(r.course)}</button>`;
                        const fastP = pct(r.fast, r.certified);
                        return `<tr class="border-b hover:bg-slate-50 text-xs"><td class="py-2 px-3">${name}</td>${by === 'provider' ? '' : `<td class="py-2 px-3 text-slate-500 truncate max-w-[160px]" title="${esc(r.provider)}">${esc(r.provider)}</td>`}<td class="py-2 px-3 text-right tabular-nums">${fmt(r.enrolled)}</td><td class="py-2 px-3">${bar(pct(r.opened, r.enrolled), 'bg-gsf-boston')}</td><td class="py-2 px-3">${bar(pct(r.certified, r.opened), 'bg-emerald-500')}</td><td class="py-2 px-3 text-right tabular-nums">${r.median == null ? '–' : r.median}</td><td class="py-2 px-3 text-right tabular-nums ${fastP >= 15 ? 'text-red-600 font-bold' : fastP >= 5 ? 'text-amber-600' : 'text-slate-500'}">${r.certified ? fastP + '%' : '–'}</td><td class="py-2 px-3 text-slate-600 truncate max-w-[220px]">${nx ? `<button onclick="App.openCourse('${this.escapeJsArg(nx[0])}')" class="hover:text-gsf-boston hover:underline text-left" title="${esc(nx[0])}">${esc(nx[0])}</button> <span class="text-slate-400">${pct(nx[1], r.opened)}%</span>` : '<span class="text-slate-300">–</span>'}</td></tr>`;
                    }).join('') || '<tr><td colspan="8" class="py-6 text-center text-slate-400">No rows above the minimum.</td></tr>'}</tbody>
                </table></div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <div class="bg-white rounded-xl shadow-sm border p-6">
                    <h3 class="font-bold text-lg text-gsf-prussian flex items-center gap-2 mb-1"><i data-lucide="route" class="text-gsf-boston" width="18"></i> Courses per learner</h3>
                    <p class="text-xs text-slate-500 mb-4">${fmt(idx.learners - idx.never)} learners who opened at least one course; ${fmt(idx.never)} more enrolled but never opened anything.</p>
                    ${[['1 course', pl[0]], ['2 courses', pl[1]], ['3–4 courses', pl[2]], ['5 or more', pl[3]]].map(([l, n]) => hbar(l, n, plTotal, 'bg-gsf-boston')).join('')}
                    <h4 class="font-bold text-sm text-gsf-prussian mt-6 mb-2">Time from enrolment to certificate</h4>
                    ${bins.map(([l, v]) => hbar(l, v, durN, 'bg-emerald-500')).join('')}
                    <p class="text-[11px] text-slate-400 mt-3">API start dates equal the enrolment date, so this is enrolment → certificate. Most SURGhub courses are short, hence the same-day bar.</p>
                </div>
                <div class="bg-white rounded-xl shadow-sm border p-6">
                    <h3 class="font-bold text-lg text-gsf-prussian flex items-center gap-2 mb-1"><i data-lucide="git-branch" class="text-gsf-boston" width="18"></i> Where learners go next</h3>
                    <p class="text-xs text-slate-500 mb-3">Pick a course: the courses its learners opened next, and the ones they came from. Shares are of learners who opened the course.</p>
                    <select data-viewer-allowed onchange="App._jrnCourse=this.value; App.renderView()" class="w-full border rounded-lg px-2 py-1.5 text-sm mb-4">${[...idx.courses.values()].sort((a, b) => b.enrolled - a.enrolled).map(c => `<option value="${esc(c.course)}" ${c.course === explorerKey ? 'selected' : ''}>${esc(c.course)} (${fmt(c.opened)} opened)</option>`).join('')}</select>
                    <div class="grid grid-cols-2 gap-4 text-sm">
                        <div><div class="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Go on to</div>${pathList(ex.next, ex.opened)}</div>
                        <div><div class="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Came from</div>${pathList(ex.prev, ex.opened)}</div>
                    </div>
                    ${ex.certLearners ? `<p class="text-xs text-slate-500 mt-4">${pct(ex.returned, ex.certLearners)}% of the ${fmt(ex.certLearners)} learners whose first certificate was this course opened another course afterwards.</p>` : ''}
                </div>
            </div>

            <div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-8">
                <div class="bg-slate-50 border-b p-5 flex items-center justify-between gap-3 flex-wrap">
                    <div><h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="arrow-right-left" class="text-gsf-boston" width="18"></i> Top learning paths</h2><p class="text-xs text-slate-500 mt-1">The sequences learners follow most often: courses opened one after the other by the same learner. Share = learners on this path ÷ learners who opened its first course.</p></div>
                    <div class="flex items-center gap-3 text-xs flex-wrap">
                        <div class="inline-flex rounded-lg border overflow-hidden">${[2, 3, 4].map(k => `<button data-viewer-allowed onclick="App._jrnChainLen=${k}; App.renderView()" class="px-3 py-1.5 font-bold ${chainLen === k ? 'bg-gsf-boston text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}">${k} courses</button>`).join('')}</div>
                        <label class="inline-flex items-center gap-1.5">Sort by <select data-viewer-allowed onchange="App._jrnChainSort=this.value; App.renderView()" class="border rounded px-1.5 py-1"><option value="learners" ${chainSort === 'learners' ? 'selected' : ''}>learners</option><option value="share" ${chainSort === 'share' ? 'selected' : ''}>share</option></select></label>
                        <label class="inline-flex items-center gap-1.5">Min. learners <input data-viewer-allowed type="number" min="1" step="5" value="${pathMin}" onchange="App._jrnPathMin=Math.max(1, Number(this.value)||1); App.renderView()" class="border rounded px-1.5 py-1 w-16"></label>
                    </div>
                </div>
                <div class="px-5 py-3">
                    <p class="text-xs text-slate-500 mb-2">${fmt(chainsWithLen)} learners opened ${chainLen === 2 ? 'two or more' : chainLen === 3 ? 'three or more' : 'four or more'} courses · showing the ${chains.length} most common ${chainLen}-course paths with at least ${pathMin} learners</p>
                    ${chains.map((ch, i) => `<div class="flex items-center justify-between gap-4 py-2.5 ${i ? 'border-t border-slate-100' : ''}">
                        <div class="flex items-center flex-wrap gap-y-1.5 text-xs min-w-0"><span class="w-6 text-slate-300 tabular-nums shrink-0">${i + 1}</span>${ch.courses.map((c, j) => `${j ? '<i data-lucide="chevron-right" width="14" class="text-gsf-boston shrink-0 mx-1"></i>' : ''}<button onclick="App.openCourse('${this.escapeJsArg(c)}')" class="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-gsf-prussian font-medium text-left max-w-[260px] truncate" title="${esc(c)}">${esc(c)}</button>`).join('')}</div>
                        <div class="text-right shrink-0 tabular-nums"><div class="text-sm font-bold text-gsf-prussian">${fmt(ch.n)}</div><div class="text-[10px] text-slate-400">${ch.share}% of first course's openers${ch.gap != null ? ' · ' + ch.gap + ' d apart' : ''}</div></div>
                    </div>`).join('') || `<div class="py-6 text-center text-slate-400 text-sm">No ${chainLen}-course path with ${pathMin} or more learners. Lower the minimum.</div>`}
                </div>
            </div>

            <div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-8">
                <div class="bg-slate-50 border-b p-5 flex items-center justify-between gap-3 flex-wrap"><div><h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="user-plus" class="text-gsf-boston" width="18"></i> Sign-ups, activation and activity</h2><p class="text-xs text-slate-500 mt-1">From the account listing every enrolment sync makes (sign-up day, last login, email domain; hashed ids only, never exported). Activated = opened a first course within ${this.JRN_ACTIVATION_DAYS} days of signing up.</p></div>
                    ${act ? `<span class="text-xs text-slate-400">Listing of ${act.asOf} · ${fmt(act.total)} accounts</span>` : `<button onclick="App._accountsBuildFromReceipt()" class="px-3 py-1.5 bg-gsf-boston text-white text-xs font-bold rounded-lg hover:bg-gsf-prussian">Build from the last sync</button>`}</div>
                ${actHtml}
            </div>`;
    },

    // ── Excel ──
    async exportJourneysXlsx() {
        const idx = this._jrnIndex(); if (!idx) return alert('No per-learner records loaded yet.');
        const provOf = this._jrnProviderOf(), pct = this._jrnPct.bind(this), wb = XLSX.utils.book_new(), nice = (ws, o) => (this._niceSheet ? this._niceSheet(ws, o) : ws);
        const t = idx.totals, act = this._jrnActivation();
        const about = [
            ['SURGhub — learner journeys (funnel, pathways, time to completion, activation)'], ['Generated', new Date().toISOString().slice(0, 10)], [''],
            ['Enrolments', t.enrolled], ['Opened', t.opened], ['Completed (certificate issued)', t.certified],
            ['Learners who opened a course', idx.learners - idx.never], ['Learners who never opened a course', idx.never], ['Learners with 2+ courses', idx.multi],
            ['Certified learners', idx.certLearners], ['... who opened another course after their first certificate', idx.returned],
            ['Median days enrolment to certificate', t.median == null ? '' : t.median], ['Median days between courses', idx.gapMedian == null ? '' : idx.gapMedian],
            ['Fast certificates (< ' + this.JRN_FAST_MIN + ' recorded minutes)', t.fast], [''],
            ['NOTE', 'Counts only; no learner is identifiable. "Opened" = record with a start date; "completed" = certificate issued. API start dates equal the enrolment date. Paths = consecutive courses opened by the same learner, one entry per course.'],
        ];
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.aoa_to_sheet(about), { noFilter: true, widths: [{ wch: 44 }, { wch: 100 }] }), 'Summary');
        const courseRows = [...idx.courses.values()].sort((a, b) => b.enrolled - a.enrolled).map(c => { const nx = this._jrnTop(c.next, 1)[0]; return { 'Course': c.course, 'Provider': provOf[c.course] || '', 'Enrolled': c.enrolled, 'Opened': c.opened, 'Opened %': pct(c.opened, c.enrolled), 'Completed (certificate)': c.certified, 'Completed % of opened': pct(c.certified, c.opened), 'Median days to certificate': c.median == null ? '' : c.median, 'Within a day %': pct(c.within1, c.durations.length), 'Over 30 days %': pct(c.over30, c.durations.length), 'Fast certificates': c.fast, 'Fast %': pct(c.fast, c.certified), 'Certified here first': c.certLearners, 'Returned after certificate %': pct(c.returned, c.certLearners), 'Most common next course': nx ? nx[0] : '', 'Next course share %': nx ? pct(nx[1], c.opened) : '' }; });
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(courseRows)), 'Funnel by course');
        const provs = [...new Set(Object.values(provOf))].filter(Boolean).map(p => this._jrnProviderStats(p)).filter(Boolean).sort((a, b) => b.enrolled - a.enrolled);
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(provs.map(a => ({ 'Provider': a.course, 'Included courses': a.courses, 'Enrolled': a.enrolled, 'Opened': a.opened, 'Opened %': pct(a.opened, a.enrolled), 'Completed (certificate)': a.certified, 'Completed % of opened': pct(a.certified, a.opened), 'Median days to certificate': a.median == null ? '' : a.median, 'Fast certificates': a.fast, 'Fast %': pct(a.fast, a.certified) })))), 'Funnel by provider');
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(idx.transitions.slice(0, 500).map(tr => ({ 'From': tr.from, 'To': tr.to, 'Learners': tr.n, 'Share of first course openers %': pct(tr.n, (idx.courses.get(tr.from) || {}).opened), 'Median gap (days)': tr.medianGap })))), 'Steps');
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(idx.chains3.map(ch => ({ 'First': ch.courses[0], 'Second': ch.courses[1], 'Third': ch.courses[2], 'Learners': ch.n })).concat(idx.chains4.map(ch => ({ 'First': ch.courses[0], 'Second': ch.courses[1], 'Third': ch.courses[2], 'Fourth': ch.courses[3], 'Learners': ch.n }))))), 'Chains');
        const d = t.durations;
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.aoa_to_sheet([['Courses opened', 'Learners'], ['1', idx.perLearner[0]], ['2', idx.perLearner[1]], ['3-4', idx.perLearner[2]], ['5+', idx.perLearner[3]], [], ['Enrolment to certificate', 'Certificates'], ['same day', d.filter(x => x <= 0).length], ['1-7 days', d.filter(x => x >= 1 && x <= 7).length], ['8-30 days', d.filter(x => x > 7 && x <= 30).length], ['31-90 days', d.filter(x => x > 30 && x <= 90).length], ['over 90 days', d.filter(x => x > 90).length]]), { noFilter: true }), 'Distributions');
        if (act) {
            XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(act.months.map(m => ({ 'Sign-up month': m.month, 'Sign-ups': m.signups, ['Activated within ' + this.JRN_ACTIVATION_DAYS + ' d']: m.activated, 'Activated %': pct(m.activated, m.signups), 'Ever opened a course': m.ever, 'Ever %': pct(m.ever, m.signups) })))), 'Activation by month');
            XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(act.domains.map(x => ({ 'Domain': x.domain, 'Sign-ups (12 mo)': x.signups, 'Activated %': pct(x.activated, x.signups), 'Active in last 90 d %': pct(x.active90, x.signups) })))), 'Activation by institution');
        }
        const path = await electronAPI.invoke('pick-save-path', 'surghub_learner_journeys_' + new Date().toISOString().split('T')[0] + '.xlsx');
        if (!path) return;
        this._writeWorkbook(wb, path);
        this.showMsg('Saved learner journeys → ' + path.split('/').pop());
    },
});
