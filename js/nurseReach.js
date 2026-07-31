// === Nursing-workforce reach ===
// The same question as the physician tab, for the platform's LARGEST cadre. Nursing is
// the biggest group on SURGhub and certifies at the highest rate of any cadre, and until
// now it had no denominator at all — so its reach could not be stated.
//
// Denominator: WHO GHO HWF_0008 "Nursing personnel (number)", the published headcount.
// No World Bank fallback here: unlike physicians, the app carries no nurse density, so a
// country either has a WHO figure or is reported as missing.
//
// Everything else mirrors js/physicianReach.js on purpose — same three bases (certified /
// has an account / estimated), same per-country declaration rate, same career-stage gate
// defaulting to practising, same provenance on every row. The two tabs are read side by
// side, so they must not use different rules.

Object.assign(window.App, {

    // Raw signup-survey tags. 'nurse-anaesthetist' belongs HERE, not with the physicians —
    // the survey asks it separately from 'anaesthesiologist' and it is a nursing role.
    NURSE_TAGS: {
        nurse: ['nurse', 'nursing', 'nurse-anaesthetist'],
        midwife: ['midwife', 'midwifery'],
        excluded: ['doctor', 'surgeon', 'anesthesiology', 'anaesthesiologist', 'emergency-doctor',
                   'obstetrician', 'gynaecologist', 'medical-officer', 'clinical-officer',
                   'anaesthesia-technician', 'medical-technician', 'non-clinical', 'resident'],
    },

    NURSE_SOURCE: {
        label: 'WHO Global Health Observatory — Nursing personnel (number), HWF_0008',
        url: 'https://www.who.int/data/gho/data/indicators/indicator-details/GHO/nursing-personnel-(number)',
        portalUrl: 'https://apps.who.int/nhwaportal/',
        note: 'Headcount as reported by countries through the WHO NHWA portal (December 2025 update).',
        densityNote: 'Density shown here is derived from that headcount and the country population, not from WHO’s own density indicator — that one covers nursing AND midwifery, a wider group, so mixing the two would be inconsistent.',
    },

    _nurseOpts() {
        return Object.assign({ scope: 'liclmic', basis: 'declared', stage: 'practising', midwives: false },
            this._nurseReachOpts || {});
    },
    setNurseOpt(k, v) {
        const o = this._nurseOpts();
        o[k] = (v === 'true') ? true : (v === 'false') ? false : v;
        this._nurseReachOpts = o;
        this.renderView();
    },

    _nurseIsCounted(rawTag, opts) {
        const t = String(rawTag || '').trim().toLowerCase();
        if (!t) return false;
        const N = this.NURSE_TAGS;
        if (N.excluded.includes(t)) return false;
        if (N.nurse.includes(t)) return true;
        if (opts.midwives && N.midwife.includes(t)) return true;
        return false;
    },

    nurseReach() {
        const anon = this._rawAnonymizedUsers;
        const WF = window.HEALTH_WORKFORCE, WHO = window.WHO_WORKFORCE, toISO = window.countryToISO;
        if (!Array.isArray(anon) || !anon.length || !WHO || !toISO) return null;
        const opts = this._nurseOpts();

        const per = {};
        anon.forEach(r => {
            if (!r || !r.country || !r.user_uid) return;
            const p = per[r.country] || (per[r.country] = { all: new Set(), declared: new Set(), n: new Set(), certN: new Set() });
            p.all.add(r.user_uid);
            if (r.profession) p.declared.add(r.user_uid);
            if (this._nurseIsCounted(r.profession, opts) && this._physStageOk(r.career_stage, opts)) {
                p.n.add(r.user_uid);
                if (String(r.has_certificate) === 'Yes') p.certN.add(r.user_uid);
            }
        });

        const rows = [], noDenominator = [], unresolved = [];
        Object.entries(per).forEach(([country, p]) => {
            const declared = p.n.size;
            if (!declared) return;
            const iso = toISO(country);
            if (!iso) { unresolved.push({ country, n: declared }); return; }
            const w = WHO[iso], wf = WF && WF[iso];
            if (!w || !w.nurses) { noDenominator.push({ country, n: declared }); return; }
            const rate = p.all.size ? p.declared.size / p.all.size : 1;
            const estimated = rate > 0 ? Math.round(declared / rate) : declared;
            const certified = p.certN.size;
            const count = opts.basis === 'certified' ? certified : (opts.basis === 'estimated' ? estimated : declared);
            const pop = wf && wf.population ? wf.population : null;
            rows.push({
                country, iso, income: wf ? wf.income : 'Unknown', region: w.region, regionName: w.regionName,
                nurses: w.nurses, year: w.nursesYear, population: pop,
                per1000: pop ? +(w.nurses / pop * 1000).toFixed(3) : null,
                declared, estimated, certified, count, declRate: rate * 100,
                stale: (2026 - w.nursesYear) >= 5,
                reach: w.nurses ? (count / w.nurses) * 100 : 0,
                certRate: declared ? (certified / declared) * 100 : 0,
                per100k: pop ? (declared / pop) * 100000 : 0,
            });
        });

        const inScope = (r) => opts.scope === 'all' || r.income === 'LIC' || r.income === 'LMIC';
        const scoped = rows.filter(inScope).sort((a, b) => b.reach - a.reach);
        const tot = (f) => scoped.reduce((s, r) => s + f(r), 0);
        const totN = tot(r => r.nurses), totCount = tot(r => r.count);
        const band = (list) => {
            const d = list.reduce((s, r) => s + r.count, 0), p = list.reduce((s, r) => s + r.nurses, 0);
            return { n: list.length, count: d, physicians: p, reach: p ? d / p * 100 : 0, oneIn: d ? Math.round(p / d) : null };
        };
        const byIncome = {};
        ['LIC', 'LMIC', 'UMIC', 'HIC'].forEach(k => { byIncome[k] = band(rows.filter(r => r.income === k)); });
        const REG = window.WHO_REGIONS || {};
        const byRegion = Object.keys(REG)
            .map(code => Object.assign({ code, name: REG[code] }, band(scoped.filter(r => r.region === code))))
            .filter(b => b.n).sort((a, b) => b.count - a.count);

        return {
            rows: scoped, allRows: rows, opts, byIncome, byRegion,
            unresolved: unresolved.sort((a, b) => b.n - a.n), noDenominator,
            totals: {
                countries: scoped.length, nurses: totN, count: totCount,
                declared: tot(r => r.declared), estimated: tot(r => r.estimated), certified: tot(r => r.certified),
                reach: totN ? totCount / totN * 100 : 0,
                oneIn: totCount ? Math.round(totN / totCount) : null,
                oneInCertified: tot(r => r.certified) ? Math.round(totN / tot(r => r.certified)) : null,
                oneInDeclared: tot(r => r.declared) ? Math.round(totN / tot(r => r.declared)) : null,
                stale: scoped.filter(r => r.stale).length,
                lostDeclared: unresolved.reduce((s, r) => s + r.n, 0) + noDenominator.reduce((s, r) => s + r.n, 0),
            },
        };
    },
});

// ── Dashboard › Nursing reach ─────────────────────────────────────────────────
Object.assign(window.App, {
    _sortNurseTable(col) {
        const cur = this._nurseSort || { col: 'reach', dir: 'desc' };
        this._nurseSort = (cur.col === col) ? { col, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
            : { col, dir: col === 'country' ? 'asc' : 'desc' };
        this.renderView();
    },

    _dashNurseHtml(snapData, audSnap) {
        if (this._rawAnonymizedUsers == null && this.ensureAnonLoaded) {
            this.ensureAnonLoaded().then(() => { if (this.view === 'platform' && this._dashTab === 'nurses') this.renderView(); });
            return '<div class="bg-white p-12 text-center text-slate-400 italic rounded-xl border">Loading learner records…</div>';
        }
        const R = this.nurseReach();
        this._lastNurseReach = R;
        if (!R) return '<div class="bg-white p-12 text-center text-slate-500 italic rounded-xl border">No learner data yet — run <strong>Sync Learners</strong> on the Data Sync page.</div>';
        const o = R.opts, T = R.totals, S = this.NURSE_SOURCE;
        const esc = (t) => this.escapeHtml(t);
        const fmt = (n) => this.formatNumber(Math.round(n || 0));
        const seg = (key, val, label, title) => `<button onclick="App.setNurseOpt('${key}','${val}')" title="${esc(title || '')}"
            class="px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${String(o[key]) === String(val) ? 'bg-gsf-boston text-white' : 'text-slate-500 hover:bg-slate-100'}">${label}</button>`;

        const basisWord = o.basis === 'certified' ? 'have completed and certified a SURGhub course'
            : o.basis === 'estimated' ? 'are estimated to have a SURGhub account' : 'have a SURGhub account';

        const headline = `
            <div class="bg-white rounded-xl border shadow-sm border-l-4 border-l-emerald-500 p-5 mb-6">
                <h2 class="text-xl font-black text-gsf-prussian mb-1">1 in ${T.oneIn || '—'} nurses ${basisWord}</h2>
                <p class="text-sm text-slate-600">Across ${T.countries} ${o.scope === 'all' ? 'countries' : 'low- and lower-middle-income countries'} with a published nursing workforce — ${fmt(T.count)} of ${fmt(T.nurses)} nurses. Nursing is the largest cadre on SURGhub and certifies at the highest rate of any group.</p>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                    ${[['Certified', T.certified, T.oneInCertified], ['Has an account', T.declared, T.oneInDeclared],
                       ['Estimated', T.estimated, T.estimated ? Math.round(T.nurses / T.estimated) : null]]
                      .map(([l, v, one]) => `<div class="border rounded-lg p-3 ${(o.basis === 'certified' && l === 'Certified') || (o.basis === 'declared' && l === 'Has an account') || (o.basis === 'estimated' && l === 'Estimated') ? 'border-emerald-500 bg-emerald-50/40' : 'border-slate-200'}">
                        <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">${l}</p>
                        <p class="text-lg font-black text-gsf-prussian leading-tight">${fmt(v)}</p>
                        <p class="text-[11px] text-slate-500">1 in ${one || '—'} nurses</p>
                      </div>`).join('')}
                </div>
            </div>`;

        const controls = `
            <div class="flex flex-wrap items-center gap-3 mb-6">
                <div class="flex items-center gap-1 bg-white border rounded-lg p-0.5">${seg('scope', 'liclmic', 'LIC / LMIC')}${seg('scope', 'all', 'All incomes')}</div>
                <div class="flex items-center gap-1 bg-white border rounded-lg p-0.5">${seg('basis', 'certified', 'Certified')}${seg('basis', 'declared', 'Has an account')}${seg('basis', 'estimated', 'Estimated')}</div>
                <div class="flex items-center gap-1 bg-white border rounded-lg p-0.5" title="The WHO nursing headcount counts practising nurses.">
                    ${Object.entries(this.PHYS_STAGES).map(([k, v]) => seg('stage', k, v.label, v.note)).join('')}
                </div>
                <label class="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer bg-white border rounded-lg px-3 py-1.5" title="The denominator is nursing personnel only, so midwives are off by default.">
                    <input type="checkbox" data-viewer-allowed ${o.midwives ? 'checked' : ''} onchange="App.setNurseOpt('midwives', this.checked ? 'true' : 'false')"> Include midwives
                </label>
            </div>`;

        const bandCard = (title, sub, list, keyFn) => `
            <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="p-4 border-b bg-slate-50"><h3 class="font-bold text-gsf-prussian">${title}</h3><p class="text-[11px] text-slate-500 mt-0.5">${sub}</p></div>
                <table class="w-full text-sm"><tbody>${list.map(b => `<tr class="border-b border-slate-100 last:border-0">
                    <td class="py-2 px-4 font-semibold text-gsf-prussian">${esc(keyFn(b))}</td>
                    <td class="py-2 px-4 text-right text-slate-400 text-xs">${b.n} ${b.n === 1 ? 'country' : 'countries'}</td>
                    <td class="py-2 px-4 text-right text-slate-500">${fmt(b.count)}</td>
                    <td class="py-2 px-4 text-right font-bold text-gsf-prussian whitespace-nowrap">1 in ${b.oneIn || '—'}</td>
                </tr>`).join('')}</tbody></table>
            </div>`;

        const bands = `<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            ${bandCard('By income group', 'Is nursing reach concentrated where it is needed?',
                ['LIC', 'LMIC', 'UMIC', 'HIC'].map(k => Object.assign({ k }, R.byIncome[k])).filter(b => b.n),
                (b) => ({ LIC: 'Low income', LMIC: 'Lower-middle', UMIC: 'Upper-middle', HIC: 'High income' })[b.k])}
            ${R.byRegion.length ? bandCard('By WHO region', 'The unit WHO and most funders report in', R.byRegion, (b) => b.name.replace(' Region', '')) : ''}
        </div>`;

        const chart = `
            <div class="bg-white p-6 rounded-xl shadow-sm border mb-6">
                <h3 class="text-lg font-bold text-gsf-prussian">Top 10 countries by nursing reach</h3>
                <p class="text-xs text-slate-500 mt-1 mb-3">Share of each country&rsquo;s nursing workforce with a SURGhub account, on the basis selected above.</p>
                <div id="chart_nurse_top10" style="width:100%;height:400px"></div>
            </div>`;

        const sort = this._nurseSort || { col: 'reach', dir: 'desc' };
        const sv = (r, c) => c === 'country' ? r.country.toLowerCase() : (c === 'income' ? r.income : (r[c] != null ? r[c] : -1));
        const sorted = R.rows.slice().sort((a, b) => {
            const x = sv(a, sort.col), y = sv(b, sort.col);
            const c = (typeof x === 'string') ? x.localeCompare(y) : (x - y);
            return sort.dir === 'asc' ? c : -c;
        });
        const th = (col, label, align, hint) => {
            const on = sort.col === col;
            return `<th class="py-2.5 px-3 text-${align} font-medium cursor-pointer select-none hover:text-gsf-prussian whitespace-nowrap ${on ? 'text-gsf-prussian' : ''}" onclick="App._sortNurseTable('${col}')" title="${esc(hint || label)}">${label}<span class="ml-1 text-[9px] ${on ? 'text-gsf-boston' : 'text-slate-300'}">${on ? (sort.dir === 'asc' ? '&#9650;' : '&#9660;') : '&#8645;'}</span></th>`;
        };
        const table = `
            <div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-6">
                <div class="p-5 border-b bg-slate-50 flex items-start justify-between gap-3 flex-wrap">
                    <div><h3 class="text-lg font-bold text-gsf-prussian">Country by country</h3>
                    <p class="text-xs text-slate-500 mt-1">${T.countries} countries with a WHO nursing headcount.</p></div>
                    <div class="flex items-center gap-1.5 shrink-0">
                        <button onclick="App.exportNurseXlsx()" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-600 hover:text-gsf-prussian hover:bg-slate-50 inline-flex items-center gap-1.5"><i data-lucide="file-spreadsheet" width="13"></i> Excel</button>
                        <button onclick="App._copyEngagementSection('nurse-tab', this, true)" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-600 hover:text-gsf-prussian hover:bg-slate-50 inline-flex items-center gap-1.5"><i data-lucide="copy" width="13"></i> PNG</button>
                    </div>
                </div>
                <div class="overflow-x-auto max-h-[560px] overflow-y-auto custom-scrollbar">
                    <table class="w-full text-sm">
                        <thead class="text-slate-500 border-b bg-white sticky top-0 z-10"><tr>
                            ${th('country', 'Country', 'left')}${th('income', 'Income', 'left')}
                            ${th('count', 'On SURGhub', 'right')}${th('nurses', 'Nurses', 'right', 'WHO published nursing headcount')}
                            ${th('reach', 'Reach', 'right')}${th('certRate', 'Cert rate', 'right')}
                            ${th('per1000', 'Per 1,000 pop', 'right', 'Nurses per 1,000 people, derived from the headcount and population')}
                            ${th('per100k', 'Per 100k pop', 'right', 'SURGhub nurses per 100,000 people — independent of the workforce denominator')}
                            ${th('year', 'Data year', 'right')}
                        </tr></thead>
                        <tbody>${sorted.map(r => `<tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                            <td class="py-2 px-3 font-medium text-gsf-prussian whitespace-nowrap">${esc(r.country)}</td>
                            <td class="py-2 px-3"><span class="text-[10px] font-bold text-slate-500">${r.income}</span></td>
                            <td class="py-2 px-3 text-right tabular-nums">${fmt(r.count)}</td>
                            <td class="py-2 px-3 text-right tabular-nums text-slate-500">${fmt(r.nurses)}</td>
                            <td class="py-2 px-3 text-right font-bold tabular-nums" style="color:${r.reach >= 1 ? '#3FB984' : '#4389C8'}">${r.reach >= 10 ? r.reach.toFixed(0) : r.reach.toFixed(2)}%</td>
                            <td class="py-2 px-3 text-right tabular-nums text-slate-500">${r.declared ? r.certRate.toFixed(0) + '%' : '–'}</td>
                            <td class="py-2 px-3 text-right tabular-nums text-slate-400">${r.per1000 != null ? r.per1000 : '–'}</td>
                            <td class="py-2 px-3 text-right tabular-nums text-slate-400">${r.per100k.toFixed(2)}</td>
                            <td class="py-2 px-3 text-right tabular-nums ${r.stale ? 'text-amber-600 font-bold' : 'text-slate-400'}">${r.year}${r.stale ? ' ⚠' : ''}</td>
                        </tr>`).join('')}</tbody>
                    </table>
                </div>
            </div>`;

        const reliability = `
            <div class="bg-slate-50 rounded-xl border border-slate-200 p-5 mb-6">
                <h3 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide mb-3">What this number does and does not include</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600 leading-relaxed">
                    <div>
                        <p class="font-bold text-gsf-prussian mb-1">Counted as nurses</p>
                        <p>Nurses and nursing staff, including <strong>nurse anaesthetists</strong> — the signup survey asks that separately from anaesthesiologists, and it is a nursing role, so it belongs here and not in the physician count${o.midwives ? '. Midwives are included on this setting' : '. Midwives are excluded, because the denominator is nursing personnel only'}.</p>
                        <p class="font-bold text-gsf-prussian mt-2 mb-1">Career stage</p>
                        <p>Set to <strong>${esc((this.PHYS_STAGES[o.stage] || {}).label || '')}</strong> — ${esc((this.PHYS_STAGES[o.stage] || {}).note || '')}</p>
                    </div>
                    <div>
                        <p class="font-bold text-gsf-prussian mb-1">Known limits</p>
                        <ul class="list-disc list-inside space-y-1">
                            <li>Country is where a learner says they are <strong>based</strong>, not their nationality.</li>
                            <li><strong>${T.stale} of ${T.countries}</strong> rows use a headcount 5+ years old, marked ⚠.</li>
                            ${T.lostDeclared ? `<li><strong>${fmt(T.lostDeclared)}</strong> nurses are in countries with no WHO nursing figure and are excluded rather than absorbed.</li>` : ''}
                            <li>There is no World Bank fallback for nursing, so a country either has a WHO headcount or is left out.</li>
                        </ul>
                    </div>
                </div>
                <div class="mt-4 pt-3 border-t border-slate-200">
                    <p class="text-xs text-slate-600"><span class="font-bold text-emerald-700">Denominator</span> — ${esc(S.label)}. ${esc(S.note)}
                        <a href="#" onclick="electronAPI.openExternal('${this.escapeJsArg(S.url)}'); return false" class="text-gsf-boston hover:underline ml-1">Indicator &rarr;</a>
                        <a href="#" onclick="electronAPI.openExternal('${this.escapeJsArg(S.portalUrl)}'); return false" class="text-gsf-boston hover:underline ml-1">NHWA portal &rarr;</a></p>
                    <p class="text-[11px] text-slate-400 mt-2">${esc(S.densityNote)}</p>
                </div>
            </div>`;

        return `<div id="nurse-tab">${headline}${controls}${bands}${chart}${table}${reliability}</div>`;
    },

    _drawNurseCharts() {
        if (!window.google || !google.visualization || !window.Charts) return;
        const el = document.getElementById('chart_nurse_top10');
        if (!el) return;
        const R = this._lastNurseReach || this.nurseReach();
        const rows = R ? R.rows.slice(0, 10) : [];
        if (!rows.length) { Charts.clearChart('chart_nurse_top10', 'No countries with a nursing workforce yet.'); return; }
        const dt = new google.visualization.DataTable();
        dt.addColumn('string', 'Country');
        dt.addColumn('number', 'Reach %');
        dt.addColumn({ type: 'string', role: 'tooltip', p: { html: true } });
        rows.forEach(r => dt.addRow([r.country, +r.reach.toFixed(3),
            '<div style="padding:8px 12px;font-size:12px;line-height:1.5"><strong>' + this.escapeHtml(r.country) + '</strong><br>'
            + this.formatNumber(r.count) + ' of ' + this.formatNumber(r.nurses) + ' nurses = <strong>' + r.reach.toFixed(2) + '%</strong><br>'
            + '<span style="color:#94a3b8">1 in ' + (r.count ? Math.round(r.nurses / r.count) : '—') + ' &middot; WHO ' + r.year + '</span></div>']));
        new google.visualization.ColumnChart(el).draw(dt, {
            colors: ['#3FB984'], bar: { groupWidth: '66%' },
            hAxis: { textStyle: { color: '#475569', fontSize: 11 }, slantedText: true, slantedTextAngle: 45,
                     gridlines: { color: 'transparent' }, baselineColor: '#e2e8f0' },
            vAxis: { title: '% of the country’s nurses', minValue: 0, textStyle: { color: '#94a3b8', fontSize: 11 },
                     titleTextStyle: { color: '#94a3b8', fontSize: 11, italic: false }, gridlines: { color: '#f1f5f9' } },
            legend: { position: 'none' }, tooltip: { isHtml: true },
            chartArea: { left: 70, right: 20, top: 20, bottom: 110 }, backgroundColor: 'transparent',
        });
    },

    async exportNurseXlsx() {
        if (this.ensureAnonLoaded) await this.ensureAnonLoaded();
        const R = this.nurseReach();
        if (!R) return alert('No learner data yet.');
        const T = R.totals, o = R.opts, S = this.NURSE_SOURCE;
        const wb = XLSX.utils.book_new();
        const nice = (ws, x) => (this._niceSheet ? this._niceSheet(ws, x) : ws);
        const about = [
            ['SURGhub — nursing-workforce reach'],
            ['Generated', new Date().toISOString().slice(0, 10)],
            ['Scope', o.scope === 'all' ? 'All incomes' : 'LIC / LMIC'], ['Basis', o.basis],
            ['Career stage counted', (this.PHYS_STAGES[o.stage] || {}).label + ' — ' + (this.PHYS_STAGES[o.stage] || {}).note],
            ['Midwives included', o.midwives ? 'yes' : 'no'],
            [''],
            ['Nurses on SURGhub (selected basis)', T.count], ['Nursing workforce in scope', T.nurses],
            ['Reach', (T.reach || 0).toFixed(3) + '%'], ['One in', T.oneIn],
            ['Certified only', T.certified], ['Registered and declared', T.declared], ['Estimated', T.estimated],
            [''],
            ['Denominator', S.label + '. ' + S.note], ['Source', S.url],
            ['Density note', S.densityNote],
            ['Numerator', 'Nurse anaesthetists count HERE, not as physicians — the survey asks the two separately.'],
            ['Excluded', T.lostDeclared + ' nurses are in countries with no WHO nursing headcount and are left out rather than absorbed.'],
        ];
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.aoa_to_sheet(about), { noFilter: true, widths: [{ wch: 36 }, { wch: 110 }] }), 'Summary');
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(R.rows.map(r => ({
            Country: r.country, 'Income group': r.income, 'WHO region': r.regionName || '',
            'Nurses on SURGhub (selected basis)': r.count, Certified: r.certified, Registered: r.declared, Estimated: r.estimated,
            'Nursing workforce': r.nurses, 'Workforce data year': r.year, 'Workforce 5+ years old': r.stale ? 'yes' : '',
            'Reach %': +r.reach.toFixed(3), 'Certification rate %': +r.certRate.toFixed(1),
            'Nurses per 1,000 population': r.per1000, 'SURGhub nurses per 100k population': +r.per100k.toFixed(3),
            'Profession declaration rate %': +r.declRate.toFixed(1),
        })))), 'By country');
        XLSX.utils.book_append_sheet(wb, nice(XLSX.utils.json_to_sheet(
            ['LIC', 'LMIC', 'UMIC', 'HIC'].map(k => ({ Group: k, Countries: R.byIncome[k].n, 'On SURGhub': R.byIncome[k].count,
                'Nursing workforce': R.byIncome[k].physicians, 'Reach %': +R.byIncome[k].reach.toFixed(3), 'One in': R.byIncome[k].oneIn }))
            .concat(R.byRegion.map(b => ({ Group: b.name, Countries: b.n, 'On SURGhub': b.count,
                'Nursing workforce': b.physicians, 'Reach %': +b.reach.toFixed(3), 'One in': b.oneIn })))
        )), 'Bands');
        const p = await electronAPI.invoke('pick-save-path', 'surghub_nursing_reach_' + new Date().toISOString().split('T')[0] + '.xlsx');
        if (!p) return;
        this._writeWorkbook(wb, p);
        this.showMsg('Saved ' + R.rows.length + ' countries → ' + p.split('/').pop());
    },
});
