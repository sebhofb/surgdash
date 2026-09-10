// ── Institutions & cohorts ────────────────────────────────────────────────────
// Groups learners by the domain of their SURGhub email so an institutional
// rollout is visible as such. Motivation: in Apr–Jun 2026 one health system
// (seha.ae, ~3.9k accounts, ~3.1k nurses) produced 47% of June's certificates and
// half the year's nursing growth, and nothing in the app showed it.
//
// Source: the per-(learner, course) completion records (surghub_completion,
// lazy-loaded). "Joined" = the month of a learner's FIRST course start — the app
// holds no registration date per email. Webmail domains are pooled as
// "Personal email" and never flagged as an institution. Emails themselves are
// never rendered or exported here — only domains and counts.
//
// Also hosts the domain-hygiene detector (typo domains such as seha.e / seha.ar
// for seha.ae) — same index, same tab.
Object.assign(window.App, {

    INST_MIN_LEARNERS: 25,          // a domain counts as an "institution" from here
    INST_DOMINANCE_MIN_TOTAL: 100,  // ignore months with fewer events than this

    INST_PERSONAL_ROOTS: new Set(['gmail', 'googlemail', 'yahoo', 'ymail', 'rocketmail', 'hotmail', 'outlook', 'live', 'msn',
        'icloud', 'me', 'mac', 'aol', 'protonmail', 'proton', 'pm', 'gmx', 'yandex', 'mail', 'email', 'zoho', 'qq', '163', '126', 'foxmail',
        'naver', 'hanmail', 'daum', 'rediffmail', 'rediff', 'fastmail', 'tutanota', 'tuta', 'hey', 'inbox', 'web', 'libero', 'wanadoo',
        'orange', 'free', 'laposte', 'sfr', 'bol', 'uol', 'terra', 'globo', 'walla', 'seznam', 'mail2world', 'hushmail', 'lycos', 'excite']),
    INST_WEBMAIL_CANON: ['gmail.com', 'hotmail.com', 'yahoo.com', 'outlook.com', 'icloud.com', 'live.com', 'protonmail.com', 'aol.com'],

    _instDomain(email) {
        const m = String(email || '').toLowerCase().trim().match(/@([a-z0-9][a-z0-9.-]*)$/);
        return m ? m[1] : '';
    },
    // Email relays / aliasing services — personal by nature, never an institution.
    INST_PERSONAL_EXACT: new Set(['privaterelay.appleid.com', 'duck.com', 'mozmail.com', 'anonaddy.me', 'anonaddy.com', 'simplelogin.com', 'simplelogin.co', 'passmail.net', 'relay.firefox.com']),
    _instIsPersonal(domain) {
        if (!domain) return true;
        if (this.INST_PERSONAL_EXACT.has(domain)) return true;
        const parts = domain.split('.');
        // gmail.com, yahoo.co.uk, hotmail.fr, outlook.com.au — webmail roots at ≤ 4 labels
        return parts.length <= 4 && this.INST_PERSONAL_ROOTS.has(parts[0]);
    },
    // Registrable label: seha.ae → seha; um.edu.mt → um; nhs.net → nhs; tuks.co.za → tuks.
    _instLabel(domain) {
        const p = String(domain || '').split('.');
        if (p.length >= 3 && /^(edu|ac|co|gov|org|net|com|sch|nhs|mil)$/.test(p[p.length - 2]) && p[p.length - 1].length === 2) return p[p.length - 3];
        return p.length >= 2 ? p[p.length - 2] : p[0] || '';
    },
    _instCurrentMonth() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); },

    // ── Index (memoised on the completion blob) ─────────────────────────────
    institutionIndex() {
        const rows = this._rawCompletion;
        if (!Array.isArray(rows) || !rows.length) return null;
        if (this._instIdx && this._instIdxSrc === rows && this._instIdxDemo === !!this._emailDemoMap) return this._instIdx;
        const mk = (domain) => ({ domain, learners: new Set(), enrol: 0, certs: 0, minutes: 0, firstMonth: null, lastMonth: null, byMonth: {}, courses: {}, countries: {} });
        const domains = {}, personal = mk('Personal email'), platform = mk('Platform');
        const demo = this._emailDemoMap || null;
        const monthOf = (d) => (d && /^\d{4}-\d{2}/.test(String(d))) ? String(d).slice(0, 7) : null;
        const touch = (b, m, uid, enrol, cert, mins) => {
            if (uid) b.learners.add(uid);
            b.enrol += enrol; b.certs += cert; b.minutes += mins;
            if (m) {
                const mm = b.byMonth[m] || (b.byMonth[m] = { enrol: 0, certs: 0, learners: new Set() });
                if (enrol) { mm.enrol += enrol; if (uid) mm.learners.add(uid); }
                if (cert) mm.certs += cert;
                if (enrol) { if (!b.firstMonth || m < b.firstMonth) b.firstMonth = m; if (!b.lastMonth || m > b.lastMonth) b.lastMonth = m; }
            }
        };
        for (const r of rows) {
            const email = String(r.email || '').toLowerCase().trim();
            const dom = this._instDomain(email);
            const uid = r.uid || email || null;
            const mStart = monthOf(r.start_date);
            const mCert = (r.certificate && r.certificate_date) ? monthOf(r.certificate_date) : null;
            const mins = Number(r.time_minutes) || 0;
            const isPersonal = this._instIsPersonal(dom);
            const bucket = isPersonal ? personal : (domains[dom] || (domains[dom] = mk(dom)));
            // enrolment counted in its start month; certificate in its issue month
            if (mStart) { touch(bucket, mStart, uid, 1, 0, mins); touch(platform, mStart, uid, 1, 0, mins); }
            else if (uid) { bucket.learners.add(uid); platform.learners.add(uid); }
            if (mCert) { touch(bucket, mCert, null, 0, 1, 0); touch(platform, mCert, null, 0, 1, 0); }
            if (r.course && mStart) bucket.courses[r.course] = (bucket.courses[r.course] || 0) + 1;
            if (demo && !isPersonal) { const d = demo[email] || demo[r.email]; if (d && d.country) bucket.countries[d.country] = (bucket.countries[d.country] || 0) + 1; }
        }
        const months = Object.keys(platform.byMonth).sort();
        const cur = this._instCurrentMonth();
        const complete = months.filter(m => m < cur);
        this._instIdx = { domains, personal, platform, months, latestComplete: complete[complete.length - 1] || null, hasDemo: !!demo };
        this._instIdxSrc = rows; this._instIdxDemo = !!demo;
        return this._instIdx;
    },

    // Table rows for institutional domains (≥ INST_MIN_LEARNERS), with derived fields.
    institutionRows(idx) {
        idx = idx || this.institutionIndex(); if (!idx) return [];
        const L = idx.latestComplete;
        const last3 = idx.months.filter(m => m < this._instCurrentMonth()).slice(-3);
        const platL = L && idx.platform.byMonth[L] ? idx.platform.byMonth[L] : { enrol: 0, certs: 0 };
        return Object.values(idx.domains).filter(b => b.learners.size >= this.INST_MIN_LEARNERS).map(b => {
            const mL = L && b.byMonth[L] ? b.byMonth[L] : { enrol: 0, certs: 0 };
            const topC = Object.entries(b.countries).sort((x, y) => y[1] - x[1])[0];
            return {
                domain: b.domain, learners: b.learners.size, enrol: b.enrol, certs: b.certs,
                certRate: b.enrol ? b.certs / b.enrol * 100 : 0, hours: Math.round(b.minutes / 60),
                firstMonth: b.firstMonth, lastMonth: b.lastMonth,
                last3: last3.reduce((s, m) => s + ((b.byMonth[m] || {}).enrol || 0), 0),
                shareEnrolL: platL.enrol ? mL.enrol / platL.enrol * 100 : 0,
                shareCertsL: platL.certs ? mL.certs / platL.certs * 100 : 0,
                topCountry: topC ? topC[0] : '', topCountryN: topC ? topC[1] : 0,
                topCourse: Object.entries(b.courses).sort((x, y) => y[1] - x[1])[0] || null,
            };
        });
    },

    // Months in which one institution dominated started enrolments or certificates.
    institutionDominance(threshold, idx) {
        idx = idx || this.institutionIndex(); if (!idx) return [];
        const th = (Number(threshold) || Number(this.instThreshold) || 15) / 100;
        const cur = this._instCurrentMonth(), flags = [];
        for (const m of idx.months) {
            if (m >= cur) continue;                                    // partial month
            for (const metric of ['enrol', 'certs']) {
                const total = (idx.platform.byMonth[m] || {})[metric] || 0;
                if (total < this.INST_DOMINANCE_MIN_TOTAL) continue;
                let best = null;
                for (const b of Object.values(idx.domains)) {
                    const n = (b.byMonth[m] || {})[metric] || 0;
                    if (n && (!best || n > best.n)) best = { domain: b.domain, n };
                }
                if (best && best.n / total >= th) flags.push({ month: m, metric, domain: best.domain, n: best.n, total, share: best.n / total * 100 });
            }
        }
        return flags.sort((a, b) => b.month.localeCompare(a.month) || b.share - a.share);
    },

    // ── Domain hygiene: likely typos of an institution's or a webmail domain ──
    institutionTypos(idx) {
        idx = idx || this.institutionIndex(); if (!idx) return [];
        const all = Object.values(idx.domains);
        const big = all.filter(b => b.learners.size >= this.INST_MIN_LEARNERS);
        const out = new Map();
        const add = (suspect, suggested, learners, kind) => {
            const prev = out.get(suspect);
            if (!prev || prev.learners < learners) out.set(suspect, { suspect, suggested, learners, kind });
        };
        // Rules are deliberately conservative: a false "typo" is worse than a missed one.
        //  (1) Same registrable label, different ending (seha.e / seha.ar / seha.se for
        //      seha.ae) — only when the suspect is tiny (≤ 5 learners). Real sibling
        //      domains (nhs.scot beside nhs.net) carry more people than a typo does.
        //  (2) Near-miss of the whole domain — labels must be ≥ 4 chars and differ;
        //      one edit for short labels, two for labels of six or more. Stops
        //      um.edu.mt from "claiming" up.edu.ph, zu.edu.pk and every other
        //      two-letter university.
        //  (3) Near-miss of common webmail (gmil.com, hotmial.com) — ≤ 2 edits.
        for (const b of all) {
            const d = b.domain, lab = this._instLabel(d), n = b.learners.size;
            for (const B of big) {
                if (B.domain === d) continue;
                const LAB = this._instLabel(B.domain);
                if (n >= Math.max(5, B.learners.size * 0.1)) continue;
                if (lab === LAB) { if (n <= 5 && d !== B.domain) add(d, B.domain, n, 'institution'); continue; }
                if (lab.length < 4 || LAB.length < 4) continue;
                const maxDist = Math.min(lab.length, LAB.length) >= 6 ? 2 : 1;
                if (this._editDistance(d, B.domain) <= maxDist) add(d, B.domain, n, 'institution');
            }
            for (const w of this.INST_WEBMAIL_CANON) {
                if (d === w || this._instIsPersonal(d)) continue;
                if (this._editDistance(d, w) <= 2) add(d, w, n, 'webmail');
            }
        }
        return [...out.values()].sort((a, b) => b.learners - a.learners);
    },

    // Monthly {month: {category: startedEnrolments}} for the growth chart.
    _instTimeline(idx) {
        idx = idx || this.institutionIndex(); if (!idx) return null;
        const rows = this.institutionRows(idx).sort((a, b) => b.learners - a.learners);
        const top = rows.slice(0, 12).map(r => r.domain);
        const monthly = {};
        for (const m of idx.months) {
            const row = {};
            let other = 0;
            for (const b of Object.values(idx.domains)) {
                const n = (b.byMonth[m] || {}).enrol || 0; if (!n) continue;
                if (top.includes(b.domain)) row[b.domain] = n; else other += n;
            }
            if (other) row['Other institutions'] = other;
            if (this.instShowPersonal) { const p = (idx.personal.byMonth[m] || {}).enrol || 0; if (p) row['Personal email'] = p; }
            if (Object.keys(row).length) monthly[m] = row;
        }
        return monthly;
    },
    _instCategoryList(idx) {
        const rows = this.institutionRows(idx).sort((a, b) => b.learners - a.learners);
        const list = rows.slice(0, 12).map(r => r.domain).concat(['Other institutions']);
        if (this.instShowPersonal) list.push('Personal email');
        return list;
    },
    _drawInstitutionCharts() {
        if (!window.Charts) return;
        const monthly = this._instTimeline(); if (!monthly) return;
        const sel = this.selectedInstitutions || [];
        const mode = this.instViewMode === 'monthly' ? 'monthly' : 'cumulative';
        this._chartViewMode = this._chartViewMode || {}; this._chartViewMode['chart_inst_timeline'] = mode;
        Charts.drawBreakdownTimeline('chart_inst_timeline', monthly, 6, sel.length ? sel : null, false, this.instMonths || 'all', false, mode);
    },

    setInstOpt(k, v) {
        if (k === 'instShowPersonal') v = (v === true || v === 'true');
        this[k] = v;
        if (k === 'instShowPersonal') this.selectedInstitutions = [];   // category list changes → re-default the picker
        this.rerenderDashTab ? this.rerenderDashTab() : this.renderView();
    },
    _sortInstTable(col) {
        const cur = this._instSort || { col: 'learners', dir: 'desc' };
        this._instSort = (cur.col === col) ? { col, dir: cur.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: (col === 'domain' || col === 'firstMonth') ? 'asc' : 'desc' };
        this.rerenderDashTab ? this.rerenderDashTab() : this.renderView();
    },

    // ── Tab ────────────────────────────────────────────────────────────────
    _dashInstitutionsHtml(snapData, audSnap) {
        const esc = (t) => this.escapeHtml(t);
        const fmt = (n) => this.formatNumber(Math.round(n || 0));
        const pct = (n, d = 1) => (Number(n) || 0).toFixed(d) + '%';
        // Lazy: the ~40 MB completion blob, plus the email→demographics map for "top country".
        if (this._rawCompletion == null && this.ensureCompletionLoaded && !this._completionLoadPromise) {
            this.ensureCompletionLoaded().then(() => { if (this.view === 'platform' && this._dashTab === 'institutions') (this.rerenderDashTab || this.renderView).call(this); });
        }
        if (!this._emailDemoMap && !this._instDemoKick) {
            this._instDemoKick = true;
            Storage.getItem('surghub_email_demo').then(v => { if (v) { this._emailDemoMap = v; if (this.view === 'platform' && this._dashTab === 'institutions') (this.rerenderDashTab || this.renderView).call(this); } }).catch(() => {});
        }
        const idx = this.institutionIndex();
        if (!idx) {
            return `<div class="bg-white p-12 text-center text-slate-500 rounded-xl border"><i data-lucide="building-2" width="28" class="mx-auto mb-3 text-slate-300"></i>
                ${this._rawCompletion == null ? 'Loading per-learner records…' : 'No per-learner records yet — upload the User Progress export (Data Sync, card 2) to see institutions.'}</div>`;
        }
        const threshold = Number(this.instThreshold) || 15;
        const rows = this.institutionRows(idx);
        const flags = this.institutionDominance(threshold, idx);
        const typos = this.institutionTypos(idx);
        const L = idx.latestComplete;
        const instLearners = rows.reduce((s, r) => s + r.learners, 0);
        const platLearners = idx.platform.learners.size;
        const personalLearners = idx.personal.learners.size;
        const smallInst = Object.values(idx.domains).filter(b => b.learners.size < this.INST_MIN_LEARNERS).reduce((s, b) => s + b.learners.size, 0);
        const top = rows.slice().sort((a, b) => b.learners - a.learners)[0];
        const latestFlags = flags.filter(f => f.month === L);

        const card = (label, value, sub, colour, icon) => `
            <div class="bg-white rounded-xl border shadow-sm overflow-hidden">
                <div style="height:3px;background:${colour}"></div>
                <div class="p-4">
                    <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400 flex items-center gap-1.5"><i data-lucide="${icon}" width="11" style="color:${colour}"></i>${label}</p>
                    <p class="text-2xl font-black text-gsf-prussian mt-1 leading-tight">${value}</p>
                    ${sub ? `<p class="text-[11px] text-slate-400 mt-0.5">${sub}</p>` : ''}
                </div>
            </div>`;

        const kpis = `
            <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
                ${card('Institutional learners', fmt(instLearners), pct(platLearners ? instLearners / platLearners * 100 : 0) + ' of learners · domains with ≥' + this.INST_MIN_LEARNERS, '#206095', 'building-2')}
                ${card('Personal email', fmt(personalLearners), pct(platLearners ? personalLearners / platLearners * 100 : 0) + ' of learners · webmail', '#94a3b8', 'mail')}
                ${card('Institutions', fmt(rows.length), fmt(smallInst) + ' more learners on small domains', '#4389C8', 'landmark')}
                ${top ? card('Largest cohort', esc(top.domain), fmt(top.learners) + ' learners · ' + pct(top.shareCertsL, 0) + ' of ' + (L || '—') + ' certificates', '#E28743', 'trending-up') : ''}
                ${card('Dominance flags', fmt(flags.length), latestFlags.length ? latestFlags.length + ' in ' + L : 'none in ' + (L || 'latest month'), flags.length ? '#D03734' : '#3FB984', 'flag')}
            </div>`;

        const flagsHtml = flags.length ? `
            <div class="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
                <div class="flex items-center justify-between gap-3 flex-wrap mb-2">
                    <p class="text-[10px] font-bold uppercase tracking-wide text-amber-700 flex items-center gap-1.5"><i data-lucide="flag" width="11"></i> Months where one institution exceeded ${threshold}% of activity</p>
                    <label class="inline-flex items-center gap-2 text-xs text-amber-800">Threshold
                        <select data-viewer-allowed onchange="App.setInstOpt('instThreshold', parseInt(this.value))" class="bg-white border rounded px-1.5 py-0.5 text-xs">
                            ${[10, 15, 20, 25, 33].map(v => `<option value="${v}" ${v === threshold ? 'selected' : ''}>${v}%</option>`).join('')}
                        </select>
                    </label>
                </div>
                <div class="grid md:grid-cols-2 gap-2">
                    ${flags.slice(0, 12).map(f => `<div class="bg-white rounded-lg border border-amber-100 px-3 py-2 text-sm flex items-center justify-between gap-3">
                        <span><span class="font-mono text-xs text-slate-500">${f.month}</span> · <strong class="text-gsf-prussian">${esc(f.domain)}</strong> <span class="text-slate-500">${f.metric === 'certs' ? 'certificates' : 'courses started'}</span></span>
                        <span class="font-bold ${f.share >= 33 ? 'text-red-600' : 'text-amber-700'}">${pct(f.share, 0)} <span class="font-normal text-slate-400 text-xs">(${fmt(f.n)} of ${fmt(f.total)})</span></span></div>`).join('')}
                </div>
                ${flags.length > 12 ? `<p class="text-[11px] text-amber-700 mt-2">${flags.length - 12} more in the export.</p>` : ''}
                <p class="text-[11px] text-amber-800 mt-3">Read a flagged month as "one rollout, not platform momentum": quote growth with and without that cohort. Partial months are never flagged; months with fewer than ${this.INST_DOMINANCE_MIN_TOTAL} events are ignored.</p>
            </div>` : `<div class="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3 mb-6 text-sm text-emerald-800 flex items-center justify-between gap-3 flex-wrap">
                <span><i data-lucide="check-circle" width="14" class="inline mr-1"></i>No complete month where a single institution exceeded ${threshold}% of courses started or certificates.</span>
                <label class="inline-flex items-center gap-2 text-xs">Threshold <select data-viewer-allowed onchange="App.setInstOpt('instThreshold', parseInt(this.value))" class="bg-white border rounded px-1.5 py-0.5 text-xs">${[10, 15, 20, 25, 33].map(v => `<option value="${v}" ${v === threshold ? 'selected' : ''}>${v}%</option>`).join('')}</select></label></div>`;

        // Sortable table
        const sort = this._instSort || { col: 'learners', dir: 'desc' };
        const val = (r) => ({ domain: r.domain, learners: r.learners, enrol: r.enrol, certs: r.certs, certRate: r.certRate, hours: r.hours, firstMonth: r.firstMonth || '', last3: r.last3, shareEnrolL: r.shareEnrolL, shareCertsL: r.shareCertsL, topCountry: (r.topCountry || '').toLowerCase() })[sort.col];
        const sorted = rows.slice().sort((a, b) => { const x = val(a), y = val(b); const c = (typeof x === 'string') ? String(x).localeCompare(String(y)) : (Number(x) || 0) - (Number(y) || 0); return sort.dir === 'asc' ? c : -c; });
        const th = (col, label, right = true, hint = '') => { const on = sort.col === col; return `<th class="py-2 px-3 ${right ? 'text-right' : 'text-left'} cursor-pointer select-none hover:text-gsf-boston whitespace-nowrap" onclick="App._sortInstTable('${col}')" title="Sort by ${esc(label)}${hint ? ' — ' + esc(hint) : ''}">${label}<span class="ml-1 text-[9px] ${on ? 'text-gsf-boston' : 'text-slate-300'}">${on ? (sort.dir === 'asc' ? '&#9650;' : '&#9660;') : '&#8645;'}</span></th>`; };
        const tableHtml = `
            <div class="bg-white rounded-xl border shadow-sm overflow-hidden mb-6">
                <div class="bg-slate-50 border-b p-5 flex items-center justify-between gap-3 flex-wrap">
                    <div><h3 class="font-bold text-lg text-gsf-prussian">Institutions</h3>
                        <p class="text-xs text-slate-500">Email domains with at least ${this.INST_MIN_LEARNERS} learners · ${rows.length} institutions · top 40 shown, all in the export${idx.hasDemo ? '' : ' · top country appears once the demographics map has loaded'}</p></div>
                    <button onclick="App.exportInstitutionsXlsx()" class="flex items-center gap-1.5 px-3 py-2 border rounded-lg text-xs font-bold text-slate-600 hover:text-gsf-boston hover:bg-slate-50"><i data-lucide="download" width="14"></i> Excel</button>
                </div>
                <div class="overflow-x-auto"><table class="w-full text-sm">
                    <thead class="text-[11px] uppercase tracking-wide text-slate-500 border-b bg-white"><tr>
                        ${th('domain', 'Domain', false)}${th('learners', 'Learners')}${th('enrol', 'Courses started')}${th('certs', 'Certificates')}${th('certRate', 'Cert. rate')}${th('hours', 'Hours')}${th('firstMonth', 'Joined', false, 'month of first course start')}${th('last3', 'Last 3 mo', true, 'courses started in the last three complete months')}${th('shareCertsL', L ? 'Share ' + L : 'Share', true, 'share of the latest complete month\'s certificates')}${th('topCountry', 'Top country', false)}
                    </tr></thead>
                    <tbody>${sorted.slice(0, 40).map(r => `<tr class="border-b hover:bg-slate-50 ${r.shareCertsL >= threshold ? 'bg-amber-50/60' : ''}">
                        <td class="py-2 px-3 font-bold text-gsf-prussian font-mono text-xs">${esc(r.domain)}</td>
                        <td class="py-2 px-3 text-right">${fmt(r.learners)}</td><td class="py-2 px-3 text-right">${fmt(r.enrol)}</td><td class="py-2 px-3 text-right">${fmt(r.certs)}</td>
                        <td class="py-2 px-3 text-right ${r.certRate >= 50 ? 'text-emerald-700 font-semibold' : ''}">${pct(r.certRate, 0)}</td>
                        <td class="py-2 px-3 text-right text-slate-500">${fmt(r.hours)}</td>
                        <td class="py-2 px-3 font-mono text-xs text-slate-500">${esc(r.firstMonth || '—')}</td>
                        <td class="py-2 px-3 text-right">${fmt(r.last3)}</td>
                        <td class="py-2 px-3 text-right ${r.shareCertsL >= threshold ? 'font-bold text-amber-700' : 'text-slate-500'}">${r.shareCertsL ? pct(r.shareCertsL, 0) : '—'}</td>
                        <td class="py-2 px-3 text-xs text-slate-600">${r.topCountry ? esc(r.topCountry) + ' <span class="text-slate-400">(' + fmt(r.topCountryN) + ')</span>' : '<span class="text-slate-300">—</span>'}</td>
                    </tr>`).join('')}</tbody>
                </table></div>
            </div>`;

        // Chart view: cumulative (default) or each month's own count. Registered per
        // chart so the category picker's redraws keep the chosen view.
        const monthlyView = this.instViewMode === 'monthly';
        this._chartViewMode = this._chartViewMode || {};
        this._chartViewMode['chart_inst_timeline'] = monthlyView ? 'monthly' : 'cumulative';
        const cats = this._instCategoryList(idx);
        const selector = cats.length ? this.buildCategorySelector(cats, this.selectedInstitutions || [], 'selectedInstitutions', 'chart_inst_timeline', 'InstitutionTimeline', 6) : '';
        const chartHtml = `
            <div class="bg-white p-6 rounded-xl shadow-sm border mb-6">
                <h3 class="text-lg font-bold mb-1 flex items-center gap-2 text-gsf-prussian"><i data-lucide="trending-up" class="text-gsf-boston"></i> ${monthlyView ? 'Courses started each month, by institution' : 'Courses started to date, by institution (cumulative)'} ${this._chartBtns ? this._chartBtns('chart_inst_timeline', monthlyView ? 'Institutions_Monthly' : 'Institutions_Growth') : ''}</h3>
                <p class="text-xs text-slate-500 mb-3">${monthlyView ? 'Each point is that month\'s courses started — a rollout shows as a spike.' : 'Each point is the running total of courses started — a rollout shows as a step.'} The 12 largest institutions plus "Other institutions"; personal email is off by default because it dwarfs everything else.</p>
                <div class="mb-3 flex flex-wrap gap-4 items-center">
                    <label class="inline-flex items-center gap-2 text-sm text-slate-600"><span class="text-xs font-semibold text-slate-400 uppercase">View</span>
                        <select data-viewer-allowed onchange="App.setInstOpt('instViewMode', this.value)" class="bg-white border rounded px-2 py-1 text-slate-700 outline-none text-xs">
                            <option value="cumulative" ${!monthlyView ? 'selected' : ''}>Cumulative</option>
                            <option value="monthly" ${monthlyView ? 'selected' : ''}>Monthly</option>
                        </select></label>
                    <label class="inline-flex items-center gap-2 text-sm text-slate-600"><span class="text-xs font-semibold text-slate-400 uppercase">Period</span>
                        <select data-viewer-allowed onchange="App.setInstOpt('instMonths', this.value)" class="bg-white border rounded px-2 py-1 text-slate-700 outline-none text-xs">
                            ${[['6', 'Last 6 mo'], ['12', 'Last 12 mo'], ['24', 'Last 24 mo'], ['all', 'All time']].map(([v, l]) => `<option value="${v}" ${String(this.instMonths || 'all') === v ? 'selected' : ''}>${l}</option>`).join('')}
                        </select></label>
                    <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" data-viewer-allowed ${this.instShowPersonal ? 'checked' : ''} onchange="App.setInstOpt('instShowPersonal', this.checked)"> Include personal email</label>
                    ${this._partialMonthToggle ? this._partialMonthToggle() : ''}
                </div>
                <div id="selector_selectedInstitutions">${selector}</div>
                <div id="chart_inst_timeline" style="width:100%;height:420px;"></div>
                ${this._partialMonthCaption ? this._partialMonthCaption() : ''}
            </div>`;

        const typoHtml = `
            <div class="bg-white rounded-xl border shadow-sm overflow-hidden mb-6">
                <div class="bg-slate-50 border-b p-5"><h3 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="spell-check" width="18" class="text-gsf-boston"></i> Domain hygiene — likely typos</h3>
                    <p class="text-xs text-slate-500">Small domains within two edits of a large institution's domain (or sharing its name with a different ending), and near-misses of common webmail. These learners' emails are probably undeliverable.</p></div>
                ${typos.length ? `<table class="w-full text-sm"><thead class="text-[11px] uppercase tracking-wide text-slate-500 border-b"><tr><th class="py-2 px-4 text-left">Suspect domain</th><th class="py-2 px-4 text-left">Probably meant</th><th class="py-2 px-4 text-right">Learners</th><th class="py-2 px-4 text-left">Kind</th></tr></thead>
                    <tbody>${typos.slice(0, 30).map(t => `<tr class="border-b hover:bg-slate-50"><td class="py-2 px-4 font-mono text-xs text-red-700">${esc(t.suspect)}</td><td class="py-2 px-4 font-mono text-xs text-slate-700">${esc(t.suggested)}</td><td class="py-2 px-4 text-right">${fmt(t.learners)}</td><td class="py-2 px-4 text-xs text-slate-500">${t.kind}</td></tr>`).join('')}</tbody></table>
                    <p class="text-[11px] text-slate-500 px-5 py-3">${typos.length} suspect domains covering ${fmt(typos.reduce((s, t) => s + t.learners, 0))} learners. Full list in the export. Fixing these is a LearnWorlds admin action — SURGdash never edits learner records.</p>`
                : `<p class="text-sm text-slate-500 px-5 py-4">No suspect domains found.</p>`}
            </div>`;

        const method = `
            <div class="bg-slate-50 border rounded-xl p-5 text-xs text-slate-600 space-y-1">
                <p class="font-bold text-slate-700 text-sm">How this is counted</p>
                <p>Learners are grouped by the domain of their SURGhub email. Webmail domains (gmail, yahoo, hotmail, outlook, icloud …) are pooled as "Personal email" and never flagged. An institution is any other domain with at least ${this.INST_MIN_LEARNERS} learners.</p>
                <p>"Joined" is the month of a learner's first course start — the app holds no per-email registration date. Courses started and certificates come from the User Progress upload (Data Sync, card 2), so this tab is only as fresh as that upload${L ? ' (latest complete month: ' + L + ')' : ''}.</p>
                <p>Only domains and counts appear here and in the export; no individual email address is shown.</p>
            </div>`;

        return `<p class="text-sm text-slate-500 mb-6">Who arrives together. Institutional rollouts show up as one email domain — worth knowing when a month looks like platform momentum but is one organisation.</p>
            ${kpis}${flagsHtml}${chartHtml}${tableHtml}${typoHtml}${method}`;
    },

    // ── Export ─────────────────────────────────────────────────────────────
    async exportInstitutionsXlsx() {
        const idx = this.institutionIndex();
        if (!idx) return alert('No per-learner records loaded yet.');
        const rows = this.institutionRows(idx).sort((a, b) => b.learners - a.learners);
        const flags = this.institutionDominance(this.instThreshold || 15, idx);
        const typos = this.institutionTypos(idx);
        const wb = XLSX.utils.book_new();
        const nice = (ws, o) => (this._niceSheet ? this._niceSheet(ws, o) : ws);
        const about = [
            ['SURGhub — institutions & cohorts (by email domain)'],
            ['Generated', new Date().toISOString().slice(0, 10)],
            ['Latest complete month', idx.latestComplete || ''],
            ['Institution threshold', this.INST_MIN_LEARNERS + ' learners'],
            ['Dominance threshold', (this.instThreshold || 15) + '% of a month\'s courses started or certificates'],
            [''],
            ['Learners on institutional domains', rows.reduce((s, r) => s + r.learners, 0)],
            ['Learners on personal email', idx.personal.learners.size],
            ['All learners with a course record', idx.platform.learners.size],
            [''],
            ['NOTE', '"Joined" = month of first course start (no per-email registration date is held). Counts come from the User Progress upload. Domains only — no email addresses.'],
        ];
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.aoa_to_sheet(about), { noFilter: true, widths: [{ wch: 36 }, { wch: 110 }] }), 'Summary');
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(rows.map(r => ({
            'Domain': r.domain, 'Learners': r.learners, 'Courses started': r.enrol, 'Certificates': r.certs, 'Certification rate %': +r.certRate.toFixed(1),
            'Learning hours': r.hours, 'Joined (first course start)': r.firstMonth || '', 'Last activity month': r.lastMonth || '',
            'Courses started, last 3 complete months': r.last3, ['Share of ' + (idx.latestComplete || 'latest') + ' courses started %']: +r.shareEnrolL.toFixed(1),
            ['Share of ' + (idx.latestComplete || 'latest') + ' certificates %']: +r.shareCertsL.toFixed(1),
            'Top country': r.topCountry || '', 'Top course': r.topCourse ? r.topCourse[0] : '', 'Top course enrolments': r.topCourse ? r.topCourse[1] : '' })))), 'Institutions');
        const monthly = [];
        for (const b of Object.values(idx.domains)) { if (b.learners.size < this.INST_MIN_LEARNERS) continue;
            for (const m of Object.keys(b.byMonth).sort()) { const x = b.byMonth[m]; monthly.push({ 'Domain': b.domain, 'Month': m, 'Courses started': x.enrol, 'Certificates': x.certs, 'Learners starting': x.learners.size }); } }
        for (const m of Object.keys(idx.personal.byMonth).sort()) { const x = idx.personal.byMonth[m]; monthly.push({ 'Domain': 'Personal email', 'Month': m, 'Courses started': x.enrol, 'Certificates': x.certs, 'Learners starting': x.learners.size }); }
        for (const m of idx.months) { const x = idx.platform.byMonth[m]; monthly.push({ 'Domain': 'PLATFORM TOTAL', 'Month': m, 'Courses started': x.enrol, 'Certificates': x.certs, 'Learners starting': x.learners.size }); }
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(monthly)), 'Monthly');
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(flags.length ? flags.map(f => ({ 'Month': f.month, 'Metric': f.metric === 'certs' ? 'certificates' : 'courses started', 'Domain': f.domain, 'Count': f.n, 'Platform total': f.total, 'Share %': +f.share.toFixed(1) })) : [{ 'Month': '', 'Metric': 'no flags', 'Domain': '', 'Count': '', 'Platform total': '', 'Share %': '' }])), 'Dominance flags');
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(typos.length ? typos.map(t => ({ 'Suspect domain': t.suspect, 'Probably meant': t.suggested, 'Learners': t.learners, 'Kind': t.kind })) : [{ 'Suspect domain': 'none found', 'Probably meant': '', 'Learners': '', 'Kind': '' }])), 'Suspected typos');
        const path = await electronAPI.invoke('pick-save-path', 'surghub_institutions_' + new Date().toISOString().split('T')[0] + '.xlsx');
        if (!path) return;
        this._writeWorkbook(wb, path);
        this.showMsg('Saved ' + rows.length + ' institutions → ' + path.split('/').pop());
    },
});
