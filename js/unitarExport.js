// ── UNITAR course reports: one Excel file per course ───────────────────────
//
// UNITAR uploads each course to its reporting system as an "event" with its
// participants attached, so the unit of export is one course, one file.
//
// Two sheets, and deliberately no third. "Summary" is the totals and the breakdown
// of participants by country, career stage, gender, organisation type and profession
// — one count column and one percentage column, nothing else. "Participants" is the
// anonymised list: no name, no email, no identifier that follows anyone between
// courses. The workings live on the app's Methodology page (ui.js,
// _unitarMethodologyHtml) rather than in the file, so what UNITAR receives stays
// short enough to read.
//
// ONE ENROLMENT NUMBER. The platform's own course total and the number of
// participant records differ slightly on most courses; the file reports the
// participants it actually lists, so every figure in it ties back to the
// participant sheet. The difference is explained on the Methodology page.
//
// WHERE A FIELD IS BLANK the participants who did not state it are spread across the
// stated categories in the same proportions, so each block sums to the participant
// total. Every block says how many people stated it, so the reader can see how much
// of the block is measured. Allocation is by largest remainder, so the column sums
// exactly rather than drifting a unit or two through rounding.
//
// PERIOD. Reports can be limited to enrolments inside a window (a calendar year, or
// any range of months), for both the single and the batch run.
//
// COURSE LAUNCH. LearnWorlds gives a creation date, but courses sit private for
// reviewers for months before going live, so creation is not launch. The launch month
// is read from the enrolment curve instead: the first month that rises decisively out
// of the quiet pre-release tail and stays up. Validated against the whole catalogue
// (15 Sep 2026): it fires on 140 of 215 courses, and falls back to the first enrolment
// month on the small ones, which is stated rather than dressed up as a launch.
Object.assign(window.App, {

    UNITAR_DIMENSIONS: [
        { key: 'country', label: 'Country', source: 'Learner profile (LearnWorlds account country)' },
        { key: 'career_stage', label: 'Career stage', source: 'Sign-up survey' },
        { key: 'gender', label: 'Gender', source: 'Sign-up survey' },
        { key: 'organisation_type', label: 'Organisation type', source: 'Sign-up survey' },
        { key: 'profession', label: 'Profession', source: 'Learner profile, supplemented by the sign-up survey' },
    ],
    UNITAR_UNKNOWN: 'Not recorded',
    UNITAR_SMALL_CELL: 5,     // categories below this are flagged on the Methodology page
    // Launch detection, tuned on the real catalogue: a launch month must carry at least
    // LAUNCH_MIN enrolments, be at least LAUNCH_JUMP times the average of the months
    // before it, and be at least LAUNCH_FWD of the months that follow (so a single
    // pre-release trickle month is not mistaken for the launch).
    UNITAR_LAUNCH_MIN: 10,
    UNITAR_LAUNCH_JUMP: 4,
    UNITAR_LAUNCH_FWD: 0.25,

    _unitarMonth(v) { const s = String(v == null ? '' : v); return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : ''; },
    _unitarAddMonths(m, k) {
        let [y, mo] = String(m).split('-').map(Number);
        mo += k; y += Math.floor((mo - 1) / 12); mo = ((mo - 1) % 12 + 12) % 12 + 1;
        return y + '-' + String(mo).padStart(2, '0');
    },
    _unitarMonthName(m) {
        if (!/^\d{4}-\d{2}$/.test(String(m || ''))) return '';
        const M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const p = String(m).split('-');
        return M[Number(p[1]) - 1] + ' ' + p[0];
    },
    _unitarMedian(a) { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; },

    // When the course actually went live, read from the enrolment curve.
    // Returns { month, basis: 'ramp' | 'first' | 'none', before } — `before` is how many
    // enrolments happened in the quiet months ahead of it (reviewer access, typically).
    _unitarLaunch(monthCounts) {
        const keys = Object.keys(monthCounts).filter(k => /^\d{4}-\d{2}$/.test(k)).sort();
        if (!keys.length) return { month: '', basis: 'none', before: 0 };
        const grid = [];
        for (let m = keys[0]; m <= keys[keys.length - 1]; m = this._unitarAddMonths(m, 1)) grid.push({ m, n: monthCounts[m] || 0 });
        for (let i = 0; i < grid.length; i++) {
            const n = grid[i].n;
            if (n < this.UNITAR_LAUNCH_MIN) continue;
            const before = grid.slice(0, i).map(g => g.n);
            const mean = before.length ? before.reduce((s, x) => s + x, 0) / before.length : 0;
            if (i && n < this.UNITAR_LAUNCH_JUMP * mean) continue;
            if (n < this.UNITAR_LAUNCH_FWD * this._unitarMedian(grid.slice(i, i + 3).map(g => g.n))) continue;
            return { month: grid[i].m, basis: 'ramp', before: before.reduce((s, x) => s + x, 0) };
        }
        return { month: keys[0], basis: 'first', before: 0 };
    },

    // 'YYYY-MM'..'YYYY-MM', either end open. A period label for the sheet and the file name.
    _unitarPeriodLabel(from, to) {
        if (!from && !to) return 'All time';
        if (from && to && from.slice(0, 4) === to.slice(0, 4) && from.slice(5) === '01' && to.slice(5) === '12') return from.slice(0, 4);
        return (from ? this._unitarMonthName(from) : 'the start') + ' to ' + (to ? this._unitarMonthName(to) : 'now');
    },

    _unitarKnown(v) {
        const s = String(v == null ? '' : v).trim();
        return !!s && !/^(unknown|n\/?a|none|null|not specified|not recorded|-|--)$/i.test(s);
    },

    // Allocate `total` across `counts` in proportion, without rounding drift: every
    // share is floored, then the units left over go to the largest remainders.
    _unitarAllocate(counts, total) {
        const sum = counts.reduce((s, n) => s + n, 0);
        if (!sum || !total) return counts.map(() => 0);
        const exact = counts.map(n => n / sum * total);
        const out = exact.map(x => Math.floor(x));
        let left = total - out.reduce((s, n) => s + n, 0);
        const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
        for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i]++;
        return out;
    },

    _unitarDay(v) { const s = String(v == null ? '' : v); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ''; },
    // The stored profession is a raw platform tag ("nurse", "nursing", "medical-technician"),
    // so the same cadre arrives under several spellings. Taxonomy.canonProf folds them into
    // the cadres every other SURGhub surface reports, which is what a partner should receive.
    _unitarProf(v) {
        if (!this._unitarKnown(v)) return '';
        const c = (window.Taxonomy && Taxonomy.canonProf) ? Taxonomy.canonProf(v) : null;
        return c || String(v).trim();
    },
    // ISO 3166-1 alpha-2, because a reporting system matches on the code, not the spelling.
    _unitarISO(name) {
        if (!this._unitarKnown(name)) return '';
        return (window.countryToISO && countryToISO(String(name).trim())) || '';
    },
    _unitarNum(v) { const n = Number(v); return isFinite(n) ? n : 0; },
    _unitarPct(n, d) { return d ? Math.round(n / d * 1000) / 10 : 0; },

    // Everything the workbook needs, computed and checkable on its own.
    buildUnitarReport(courseName, opts) {
        opts = opts || {};
        const now = opts.now ? new Date(opts.now) : new Date();
        const anon = opts.anonUsers || [];
        const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const nCourse = norm(courseName);

        let people = anon.filter(u => u && u.course === courseName);
        if (!people.length) people = anon.filter(u => u && norm(u.course).length > 3 && nCourse.length > 3 && (norm(u.course) === nCourse));

        // The course snapshot: the platform's own enrolment and certificate totals.
        const snap = (opts.snap || []).filter(d => d && !d.IsShell && d.Course === courseName)
            .sort((a, b) => String(a.Timestamp || '').localeCompare(String(b.Timestamp || ''))).pop() || null;

        // Enrolment records carry the exact dates; joined on the same anonymous id.
        const comp = {};
        const monthCounts = {};
        (opts.completion || []).forEach(r => {
            if (!r || r.course !== courseName) return;
            if (r.uid) comp[r.uid] = r;
            const m = this._unitarMonth(r.enrolled_date);
            if (m) monthCounts[m] = (monthCounts[m] || 0) + 1;
        });
        // Read before any period filter: the launch is a property of the course, not of
        // the window someone happens to be reporting on.
        const launch = this._unitarLaunch(monthCounts);

        const from = this._unitarMonth(opts.from), to = this._unitarMonth(opts.to);
        const period = { from, to, label: this._unitarPeriodLabel(from, to), set: !!(from || to) };

        const all = people.map((u, i) => {
            const c = u.user_uid ? comp[u.user_uid] : null;
            return {
                n: i + 1,
                signupMonth: String(u.signup_month || ''),
                country: u.country || '', career_stage: u.career_stage || '', gender: u.gender || '',
                organisation_type: u.organisation_type || '', profession: this._unitarProf(u.profession),
                iso: this._unitarISO(u.country),
                enrolled: this._unitarDay(c && c.enrolled_date),
                started: this._unitarDay(c && c.start_date),
                completedOn: this._unitarDay(c && c.completion_date),
                certificateOn: this._unitarDay(c && c.certificate_date),
                minutes: Math.round(this._unitarNum(c && c.time_minutes != null ? c.time_minutes : u.course_minutes)),
                certificate: c ? !!c.certificate : String(u.has_certificate || '').toLowerCase() === 'yes',
            };
        });

        // A period selects on the enrolment date. A participant whose enrolment date the
        // platform never recorded cannot be placed in a window, so a period excludes them
        // rather than guessing; the count is reported so the omission is visible.
        const inPeriod = (p) => {
            if (!period.set) return true;
            const m = this._unitarMonth(p.enrolled);
            if (!m) return false;
            return (!from || m >= from) && (!to || m <= to);
        };
        const undated = period.set ? all.filter(p => !this._unitarMonth(p.enrolled)).length : 0;
        const participants = all.filter(inPeriod).map((p, i) => Object.assign({}, p, { n: i + 1 }));

        const records = participants.length;
        const minutes = participants.map(p => p.minutes).filter(m => m > 0).sort((a, b) => a - b);
        // ONE enrolment number: the participants this file actually lists. The platform's
        // own course total differs a little on most courses (see the Methodology page);
        // reporting both invited a question nobody needed to answer.
        const totals = {
            participants: records,
            started: participants.filter(p => p.started).length,
            certificates: participants.filter(p => p.certificate).length,
            learningMinutes: participants.reduce((s, p) => s + p.minutes, 0),
            medianMinutes: minutes.length ? minutes[Math.floor(minutes.length / 2)] : 0,
            withEnrolDate: participants.filter(p => p.enrolled).length,
            excludedUndated: undated,
            platform: snap ? this._unitarNum(snap.Learners) : 0,     // kept for the Methodology page, never printed in the file
        };
        totals.certRate = this._unitarPct(totals.certificates, records);

        const dimensions = this.UNITAR_DIMENSIONS.map(d => {
            const tally = {};
            participants.forEach(p => { if (this._unitarKnown(p[d.key])) { const v = String(p[d.key]).trim(); tally[v] = (tally[v] || 0) + 1; } });
            const names = Object.keys(tally).sort((a, b) => tally[b] - tally[a] || a.localeCompare(b));
            const counts = names.map(v => tally[v]);
            const known = counts.reduce((s, n) => s + n, 0);
            // The single reported figure per category: the stated counts spread over every
            // participant, so the block sums to the participant total.
            const spread = this._unitarAllocate(counts, known ? records : 0);
            return {
                key: d.key, label: d.label, source: d.source,
                known, notRecorded: records - known, records,
                statedPct: this._unitarPct(known, records),
                categories: names.length,
                smallCategories: counts.filter(n => n > 0 && n < this.UNITAR_SMALL_CELL).length,
                rows: names.map((v, i) => ({
                    value: v,
                    stated: counts[i],                                   // measured, kept for the app
                    n: spread[i],                                        // reported
                    pct: this._unitarPct(spread[i], records),
                })),
            };
        });

        return {
            course: courseName,
            provider: (snap && snap.Provider) || '',
            generatedAt: now.toISOString(),
            dataThrough: snap ? String(snap.Timestamp || '').slice(0, 10) : '',
            launch, period, totals, dimensions, participants,
        };
    },

    // ── the workbook, as plain arrays (one entry per sheet) ────────────────
    _unitarSheets(r) {
        const n = (v) => Math.round(Number(v) || 0);
        // Percentages go in as plain numbers to one decimal under a column headed "%".
        const pct = (v) => Math.round((Number(v) || 0) * 10) / 10;
        const S = [];

        // ── Summary ──
        const a = [];
        a.push(['SURGhub course report for UNITAR']);
        a.push(['Course', r.course]);
        a.push(['Provider', r.provider || 'Not recorded']);
        a.push(['Course launched', r.launch.month
            ? this._unitarMonthName(r.launch.month) + (r.launch.basis === 'ramp' ? '' : ' (first enrolment; too few enrolments to identify a launch)')
            : 'Unknown']);
        a.push(['Reporting period', r.period.label]);
        a.push(['Data through', r.dataThrough || 'unknown']);
        a.push(['Report generated', String(r.generatedAt).slice(0, 10)]);
        a.push([]);
        a.push(['TOTALS']);
        a.push(['Participants', n(r.totals.participants)]);
        a.push(['Started the course', n(r.totals.started)]);
        a.push(['Certificates earned', n(r.totals.certificates)]);
        a.push(['Certificate rate (%)', pct(r.totals.certRate)]);
        a.push(['Total learning time (hours)', Math.round(r.totals.learningMinutes / 60)]);
        a.push(['Median learning time per participant (minutes)', n(r.totals.medianMinutes)]);
        a.push([]);
        a.push(['Where a participant did not state their country, career stage, gender, organisation type or profession, they are spread across the stated categories in the same proportions, so every block below adds up to the participant total. Each block says how many people stated it. Full workings are on the Methodology page of SURGdash.']);
        a.push([]);

        r.dimensions.forEach(d => {
            const iso = d.key === 'country';
            a.push([d.label.toUpperCase()]);
            a.push(['Stated by ' + n(d.known) + ' of ' + n(d.records) + ' participants (' + pct(d.statedPct) + '%)']);
            a.push([d.label, '# participants', '% participants'].concat(iso ? ['ISO code'] : []));
            d.rows.forEach(row => a.push([row.value, n(row.n), pct(row.pct)].concat(iso ? [this._unitarISO(row.value)] : [])));
            a.push(['Total', n(d.known ? d.records : 0), d.known ? 100 : 0]);
            a.push([]);
        });
        S.push({ name: 'Summary', aoa: a, cols: [50, 16, 16, 10], headerRows: this._unitarHeaderRows(a) });

        // ── Participants ──
        const head = ['Participant', 'Sign-up month', 'Country', 'ISO code', 'Career stage', 'Gender', 'Organisation type', 'Profession',
            'Enrolled', 'Started', 'Certificate earned', 'Learning time (minutes)', 'Certificate'];
        const p = [head];
        const shown = (v) => this._unitarKnown(v) ? String(v).trim() : this.UNITAR_UNKNOWN;
        r.participants.forEach(x => p.push([
            x.n, x.signupMonth || this.UNITAR_UNKNOWN, shown(x.country), x.iso || '', shown(x.career_stage), shown(x.gender),
            shown(x.organisation_type), shown(x.profession),
            x.enrolled || '', x.started || '', x.certificateOn || '',
            x.minutes || 0, x.certificate ? 'Yes' : 'No',
        ]));
        S.push({ name: 'Participants', aoa: p, cols: [11, 14, 24, 10, 22, 14, 24, 30, 12, 12, 16, 20, 12], headerRows: [0], freeze: true });

        return S;
    },

    // Rows that are section headings (a single non-empty first cell) or column headers.
    _unitarHeaderRows(aoa) {
        const out = [];
        aoa.forEach((row, i) => {
            const first = String(row[0] == null ? '' : row[0]);
            if (!first) return;
            if (first === first.toUpperCase() && /[A-Z]/.test(first) && row.filter(c => c !== '' && c != null).length <= 2) out.push(i);
            else if (row.length > 2 && String(row[1] || '') === '# participants') out.push(i);
        });
        return out;
    },

    // ── the workings, on the app's Methodology page ───────────────────────
    // These deliberately do NOT travel inside the workbook: UNITAR asked for a file
    // short enough to read. This section lives in the same module as the code it
    // describes so the two cannot drift apart. Rendered by ui.js's methodology view.
    _unitarMethodologyHtml() {
        const row = (k, v) => '<tr class="border-b last:border-0 align-top"><td class="py-2 pr-4 font-bold text-gsf-prussian whitespace-nowrap">' + k + '</td><td class="py-2 text-slate-600">' + v + '</td></tr>';
        return '<div class="bg-white rounded-xl border shadow-sm p-6" id="unitar-methodology">'
            + '<h2 class="text-lg font-bold text-gsf-prussian mb-3 flex items-center gap-2"><i data-lucide="file-spreadsheet" width="20" class="text-gsf-boston"></i> UNITAR course reports</h2>'
            + '<p class="text-sm text-slate-600 mb-4">One Excel file per course, for uploading a course to UNITAR as an event. The file carries a summary and the participant list only; everything about how those figures are produced lives here.</p>'
            + '<table class="w-full text-sm border-collapse mb-4"><tbody>'
            + row('Participants', 'The one enrolment figure the report uses, and the number of rows on the participant sheet. SURGhub also holds a course-level total from the platform, which runs a little higher on most courses because it counts registrations for which no learner record came back. The report does not print both: every figure in it rests on the participants it lists, so the sheets always reconcile with each other. The difference is typically under two per cent.')
            + row('Reporting period', 'A period selects learners by <strong>enrolment date</strong>, not by activity. A learner who enrolled in 2024 and earned a certificate in 2025 belongs to 2024. Learners whose enrolment date the platform never recorded cannot be placed in a window, so a period excludes them; with no period set they are all included.')
            + row('Course launched', 'LearnWorlds records when a course was created, but courses sit private for reviewers for months before going live, so creation is not launch. The month is read from the enrolment curve instead: the first month carrying at least ' + this.UNITAR_LAUNCH_MIN + ' enrolments, at least ' + this.UNITAR_LAUNCH_JUMP + ' times the average of the months before it, and not dwarfed by the months that follow. Where a course is too small for that test the report shows the first enrolment month and says so on the sheet.')
            + row('Certificates', 'Certificates issued. The platform also marks courses "completed", which matches the certificate count to within a handful on most courses and answers the same question, so the report carries certificates only.')
            + row('Started', 'Learners with a recorded start date. A blank start date means the platform holds none, not that the learner did nothing.')
            + row('Country, career stage, gender, organisation type, profession', 'Country and profession come from the learner account. Career stage, gender and organisation type come only from the voluntary sign-up survey, never from the API, so they are blank for everyone who did not answer it. Each block on the summary states how many participants stated it.')
            + row('Filling the gap', 'Participants who did not state a field are spread across the stated categories in the same proportions, so every block adds up to the participant total. This assumes the people who did not answer resemble those who did. It is a projection, not a count, and it is least reliable where the stated share is lowest. Shares are allocated by largest remainder, so each column sums exactly rather than drifting through rounding.')
            + row('Professions', 'The platform stores a free tag, so one cadre arrives under several spellings ("nurse" and "nursing", "anesthesiology" and "anaesthesiologist"). Tags are folded into the cadres used everywhere else in SURGdash; anything unrecognised becomes "Other".')
            + row('Countries', 'Reported as the learner wrote them, with the ISO 3166-1 alpha-2 code alongside where the spelling is recognised. A blank code means the spelling could not be matched, not that the country is missing.')
            + row('Anonymity', 'No name, no email address, and no identifier that follows a person between courses: participant numbers restart at 1 in every file. Courses switched off in the Directory are skipped by the batch run.')
            + row('Small categories', 'On a small course a category holding one or two people, read with the other columns, can point to an individual. Consider grouping or withholding those rows before the file leaves the reporting system.')
            + '</tbody></table>'
            + '<p class="text-xs text-slate-400">Produced by the "UNITAR report" button on a course page, or "All UNITAR Reports" on Data Sync.</p>'
            + '</div>';
    },

    // ── writing ───────────────────────────────────────────────────────────
    _unitarWorkbook(report) {
        const X = window.XLSXStyle || window.XLSX;
        const styled = !!window.XLSXStyle;
        const wb = X.utils.book_new();
        this._unitarSheets(report).forEach(sheet => {
            const ws = X.utils.aoa_to_sheet(sheet.aoa);
            ws['!cols'] = sheet.cols.map(w => ({ wch: w }));
            if (sheet.freeze) ws['!freeze'] = { xSplit: 0, ySplit: 1 };
            if (styled) {
                const heads = new Set(sheet.headerRows || []);
                sheet.aoa.forEach((row, ri) => {
                    if (ri !== 0 && !heads.has(ri)) return;
                    row.forEach((_, ci) => {
                        const cell = ws[X.utils.encode_cell({ r: ri, c: ci })];
                        if (cell) cell.s = { font: { bold: true, sz: ri === 0 ? 13 : 11, color: { rgb: '002F4C' } } };
                    });
                });
            }
            X.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
        });
        return { X, wb };
    },

    _unitarFileName(courseName, period) {
        const safe = String(courseName).replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 60);
        const p = (period && (period.from || period.to))
            ? '_' + String(period.label).replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')
            : '';
        return 'UNITAR_' + (safe || 'course') + p + '_' + new Date().toISOString().slice(0, 10) + '.xlsx';
    },

    // ── the period dialog ─────────────────────────────────────────────────
    // Resolves to { from, to } ('YYYY-MM', either end may be empty) or null if cancelled.
    _unitarAskPeriod(title) {
        return new Promise(resolve => {
            const years = [...new Set((this._rawCompletion || []).map(r => String((r && r.enrolled_date) || '').slice(0, 4)).filter(y => /^\d{4}$/.test(y)))].sort().reverse().slice(0, 6);
            const el = document.createElement('div');
            el.id = 'unitar-period-dialog';
            el.style.cssText = 'position:fixed;inset:0;background:rgba(0,47,76,0.85);display:flex;align-items:center;justify-content:center;z-index:10000';
            el.innerHTML = '<div style="background:#fff;border-radius:16px;padding:28px 32px;max-width:520px;width:92%">'
                + '<div style="font-size:18px;font-weight:800;color:#002F4C;margin-bottom:6px">' + this.escapeHtml(title || 'Reporting period') + '</div>'
                + '<div style="font-size:13px;color:#64748b;margin-bottom:18px">Include only learners who <strong>enrolled</strong> inside the period. Leave either end empty for an open range.</div>'
                + '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">'
                + '<button data-y="" style="padding:6px 14px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;font-size:12px;font-weight:700;color:#002F4C;cursor:pointer">All time</button>'
                + years.map(y => '<button data-y="' + y + '" style="padding:6px 14px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;font-size:12px;font-weight:700;color:#002F4C;cursor:pointer">' + y + '</button>').join('')
                + '</div>'
                + '<div style="display:flex;gap:12px;align-items:flex-end;margin-bottom:20px">'
                + '<label style="flex:1;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em">From<input type="month" id="unitar-from" style="display:block;width:100%;margin-top:5px;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px"></label>'
                + '<label style="flex:1;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em">To<input type="month" id="unitar-to" style="display:block;width:100%;margin-top:5px;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px"></label>'
                + '</div>'
                + '<div style="display:flex;justify-content:flex-end;gap:8px">'
                + '<button id="unitar-cancel" style="padding:9px 18px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;font-size:13px;font-weight:700;color:#64748b;cursor:pointer">Cancel</button>'
                + '<button id="unitar-ok" style="padding:9px 22px;border-radius:8px;border:0;background:#002F4C;font-size:13px;font-weight:700;color:#fff;cursor:pointer">Create report</button>'
                + '</div></div>';
            document.body.appendChild(el);
            const f = el.querySelector('#unitar-from'), t = el.querySelector('#unitar-to');
            el.querySelectorAll('[data-y]').forEach(b => b.onclick = () => {
                const y = b.getAttribute('data-y');
                f.value = y ? y + '-01' : ''; t.value = y ? y + '-12' : '';
            });
            const done = (v) => { el.remove(); resolve(v); };
            el.querySelector('#unitar-cancel').onclick = () => done(null);
            el.querySelector('#unitar-ok').onclick = () => done({ from: f.value || '', to: t.value || '' });
            el.onclick = (ev) => { if (ev.target === el) done(null); };
            setTimeout(() => { try { f.focus(); } catch (e) { __swallowed(e); } }, 30);
        });
    },

    async _unitarContext() {
        const anonUsers = this._getAnonUsers ? await this._getAnonUsers() : (this._rawAnonymizedUsers || []);
        const completion = this.ensureCompletionLoaded ? await this.ensureCompletionLoaded() : (this._rawCompletion || []);
        return { anonUsers, completion, snap: this.getAnalyticsSnap ? this.getAnalyticsSnap() : (this.data || []) };
    },

    // One course, one file.
    async exportUnitarCourseReport(courseName) {
        const course = courseName || this.selectedCourse;
        if (!course) return alert('Open a course first.');
        try {
            const ctx = await this._unitarContext();
            const period = await this._unitarAskPeriod('UNITAR report — ' + course);
            if (!period) return;
            const report = this.buildUnitarReport(course, Object.assign({}, ctx, period));
            if (!report.totals.participants) return alert('No participants for "' + course + '"' + (report.period.set ? ' in ' + report.period.label : '') + '.');
            const savePath = await electronAPI.invoke('pick-save-path', this._unitarFileName(course, report.period));
            if (!savePath) return;
            const { X, wb } = this._unitarWorkbook(report);
            const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
            electronAPI.fs.writeFileSync(savePath, new Uint8Array(out));
            this.showMsg('UNITAR report saved — ' + this.formatNumber(report.totals.participants) + ' participants · ' + report.period.label + '.', 'success');
        } catch (e) {
            console.error('[UNITAR]', e);
            alert('Could not build the report: ' + (e && e.message || e));
        }
    },

    // Every course, one file each, into a folder UNITAR can work through.
    async exportAllUnitarCourseReports() {
        try {
            const ctx = await this._unitarContext();
            const all = [...new Set(ctx.anonUsers.map(u => u && u.course).filter(Boolean))].sort();
            // A course switched off in the Directory is off everywhere, test courses included.
            const courses = this.isCourseIncluded ? all.filter(c => this.isCourseIncluded(c)) : all;
            const excluded = all.length - courses.length;
            if (!courses.length) return alert('No participant data. Run Sync Learners first.');
            const period = await this._unitarAskPeriod('UNITAR reports — ' + courses.length + ' courses');
            if (!period) return;
            const label = this._unitarPeriodLabel(this._unitarMonth(period.from), this._unitarMonth(period.to));
            if (!confirm('Write one UNITAR report per course?\n\nPeriod: ' + label + '\n' + courses.length + ' courses, one .xlsx each, into a folder you choose.'
                + (excluded ? '\n\n' + excluded + ' course' + (excluded === 1 ? '' : 's') + ' excluded from analytics will be skipped.' : ''))) return;
            const folder = await electronAPI.invoke('pick-folder');
            if (!folder) return;
            const path = electronAPI.path, fs = electronAPI.fs;
            this._reportCancelled = false;
            let ok = 0, skipped = 0;
            for (let i = 0; i < courses.length; i++) {
                if (this._reportCancelled) break;
                if (this._showReportProgress) this._showReportProgress('UNITAR report ' + (i + 1) + '/' + courses.length + ': ' + courses[i], true);
                try {
                    const report = this.buildUnitarReport(courses[i], Object.assign({}, ctx, period));
                    if (!report.totals.participants) { skipped++; continue; }   // nobody enrolled in the period
                    const { X, wb } = this._unitarWorkbook(report);
                    const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
                    fs.writeFileSync(path.join(folder, this._unitarFileName(courses[i], report.period)), new Uint8Array(out));
                    ok++;
                } catch (e) { console.error('[UNITAR]', courses[i], e); skipped++; }
            }
            if (this._hideReportProgress) this._hideReportProgress();
            alert((this._reportCancelled ? 'Cancelled. ' : 'Done. ') + ok + ' report' + (ok === 1 ? '' : 's') + ' written for ' + label
                + (skipped ? ', ' + skipped + ' course' + (skipped === 1 ? '' : 's') + ' skipped — no participants in the period' : '') + '\n\n' + folder);
        } catch (e) {
            if (this._hideReportProgress) this._hideReportProgress();
            console.error('[UNITAR]', e);
            alert('Could not write the reports: ' + (e && e.message || e));
        }
    },
});
