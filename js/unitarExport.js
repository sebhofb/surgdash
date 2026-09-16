// ── UNITAR course reports: one Excel file per course ───────────────────────
//
// UNITAR uploads each course to its reporting system as an "event" with its
// participants attached, so the unit of export is one course, one file.
//
// The report IS UNITAR's own upload workbook: their "Participants" sheet filled in,
// their "Default Values" sheet untouched, and our "SURGhub summary" added in front.
// The summary is the totals and the breakdown of participants by country, career stage,
// gender, organisation type and profession — one count column and one percentage column,
// nothing else. The workings live on the app's Methodology page
// (_unitarMethodologyHtml) rather than in the file, so what UNITAR receives stays short
// enough to read.
//
// IT CARRIES PERSONAL DATA. Their template marks Surname, Firstname and Email required,
// so this is the one SURGdash export that is not anonymous. Both entry points warn
// before writing, and the summary says so on its face.
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
    // Courses run as in-country workshops rather than open enrolment. Kept as a list of
    // course names (they survive re-syncs; course ids do not) and travels with the data,
    // so the classification is the team's, not one laptop's.
    UNITAR_PRIVATE_KEY: 'surghub_private_courses',
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
    _unitarNiceDate(iso) {
        if (!/^\d{4}-\d{2}-\d{2}/.test(String(iso || ''))) return 'an unknown date';
        const p = String(iso).slice(0, 10).split('-');
        return Number(p[2]) + ' ' + this._unitarMonthName(p[0] + '-' + p[1]);
    },

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

    // LearnWorlds already knows: it marks each course free / private / draft. That is the
    // default, so 75 in-country and 37 unreleased courses classify themselves. The stored
    // value is an OVERRIDE map ({course: true|false}) for the cases where the platform's
    // answer is not the reporting answer — it only ever holds the exceptions.
    async _unitarPrivateSet() {
        if (this._privateCourses) return this._privateCourses;
        let v = null;
        try { v = await Storage.getItem(this.UNITAR_PRIVATE_KEY); } catch (e) { __swallowed(e, 'unitar.private'); }
        this._privateCourses = (v && typeof v === 'object' && !Array.isArray(v)) ? v
            : (Array.isArray(v) ? v.reduce((m, k) => { m[k] = true; return m; }, {}) : {});   // migrate the old list
        return this._privateCourses;
    },
    // What the platform says, before any override.
    _unitarPlatformPrivate(courseName) {
        const rows = (this.data || []).filter(d => d && d.Course === courseName && d.Access);
        if (!rows.length) return false;
        const newest = rows.sort((a, b) => String(a.Timestamp || '').localeCompare(String(b.Timestamp || ''))).pop();
        const access = String(newest.Access || '').toLowerCase();
        return access === 'private' || access === 'draft';
    },
    isCoursePrivate(courseName) {
        const name = String(courseName);
        const over = this._privateCourses;
        if (over && Object.prototype.hasOwnProperty.call(over, name)) return !!over[name];
        return this._unitarPlatformPrivate(name);
    },
    async toggleCoursePrivate(courseName, priv) {
        const over = await this._unitarPrivateSet();
        const name = String(courseName);
        const on = (priv === undefined) ? !this.isCoursePrivate(name) : !!priv;
        // Only remember it when it disagrees with the platform, so the override map stays
        // small and a course that changes on LearnWorlds follows it.
        if (on === this._unitarPlatformPrivate(name)) delete over[name]; else over[name] = on;
        try { await Storage.setItem(this.UNITAR_PRIVATE_KEY, over); } catch (e) { __swallowed(e, 'unitar.private.save'); }
        this.showMsg(on ? '"' + name + '" is private — left out of UNITAR batch reports unless you tick to include them.'
                        : '"' + name + '" is no longer private.', 'success');
        if (this.renderView) this.renderView();
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
                // Identity, for UNITAR's own upload template only — it demands surname,
                // first name and email. Never used by the Summary sheet.
                name: (c && c.name) ? String(c.name).trim() : '',
                email: (c && c.email) ? String(c.email).trim() : '',
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
        a.push(['SURGhub course report for UNITAR']);   // bolded by _unitarHeaderRows
        a.push(['Course', r.course]);
        a.push(['Provider', r.provider || 'Not recorded']);
        a.push(['Course launched', r.launch.month
            ? this._unitarMonthName(r.launch.month) + (r.launch.basis === 'ramp' ? '' : ' (first enrolment; too few enrolments to identify a launch)')
            : 'Unknown']);
        // One line about time, not two. "Data through <today>" next to a 2025 period read
        // as a contradiction; the through-date only belongs on an open-ended report.
        a.push(['Enrolments counted', r.period.set
            ? r.period.label + (r.period.to ? '' : ' onwards, up to ' + this._unitarNiceDate(r.dataThrough))
            : 'All time, up to ' + this._unitarNiceDate(r.dataThrough)]);
        a.push(['Report generated', this._unitarNiceDate(String(r.generatedAt).slice(0, 10))]);
        a.push([]);
        a.push(['TOTALS']);
        a.push(['Participants', n(r.totals.participants)]);
        a.push(['Certificates earned', n(r.totals.certificates)]);
        a.push(['Certificate rate (%)', pct(r.totals.certRate)]);
        a.push(['Total learning time (hours)', Math.round(r.totals.learningMinutes / 60)]);
        a.push(['Median learning time per participant (minutes)', n(r.totals.medianMinutes)]);
        a.push([]);
        a.push(['Where a participant did not state their country, career stage, gender, organisation type or profession, they are spread across the stated categories in the same proportions, so every block below adds up to the participant total. Each block says how many people stated it. Full workings are on the Methodology page of SURGdash.']);
        a.push(['The "Participants" sheet is UNITAR\'s own upload template and carries names and email addresses, because UNITAR requires them. Treat this file as personal data.']);
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
        a.push([]);
        a.push(['Prepared with SURGdash \u00a9 the Global Surgery Foundation']);
        S.push({ name: 'Summary', aoa: a, cols: [50, 16, 16, 10], headerRows: this._unitarHeaderRows(a) });

        // There is no participant sheet of ours any more: UNITAR's own template sheet is
        // the participant list, filled in _unitarEmsWorkbook.
        // Leave the top rows clear so the logo has somewhere to sit, and shift the
        // header rows with them. Done last so every index above stays readable.
        return S.map(s => this._unitarWithLogoSpace(s));
    },

    // Blank rows at the top for the logo, with the header indices moved to match.
    _unitarWithLogoSpace(sheet) {
        const pad = this.UNITAR_LOGO_ROWS;
        const aoa = [];
        for (let i = 0; i < pad; i++) aoa.push([]);
        sheet.aoa.forEach(r => aoa.push(r));
        return Object.assign({}, sheet, {
            aoa,
            headerRows: (sheet.headerRows || []).map(i => i + pad),
            freezeRow: sheet.freeze ? pad + 1 : 0,
            logoRows: pad,
        });
    },

    // Rows that are section headings (a single non-empty first cell) or column headers.
    _unitarHeaderRows(aoa) {
        const out = [];
        aoa.forEach((row, i) => {
            const first = String(row[0] == null ? '' : row[0]);
            if (!first) return;
            if (first === first.toUpperCase() && /[A-Z]/.test(first) && row.filter(c => c !== '' && c != null).length <= 2) out.push(i);
            else if (row.length > 2 && String(row[1] || '') === '# participants') out.push(i);
            else if (first === 'SURGhub course report for UNITAR') out.push(i);
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

    // ── UNITAR's own upload template (EMS) ────────────────────────────────
    // UNITAR uploads participants through a fixed workbook of theirs, so the report IS
    // that workbook: their "Participants" sheet filled in, their "Default Values" sheet
    // untouched, and our Summary added alongside.
    //
    // THIS FILE CARRIES PERSONAL DATA. Their template marks Surname, Firstname and Email
    // as required, so the anonymised participant list cannot satisfy it. The Summary sheet
    // says so at the top, and the export warns before it writes. It is the one UNITAR
    // output that is not safe to circulate.
    //
    // The code lists (gender 1-5, nationality ISO2, organisational affiliation ACM/GOVN/…)
    // are read from the template's own "Default Values" sheet at export time rather than
    // copied into this file, so a template update carries its own codes with it.
    UNITAR_TEMPLATE: 'templates/unitar_ems_template.xls',
    UNITAR_EMS_SHEET: 'Participants',
    UNITAR_EMS_DEFAULTS: 'Default Values',

    // Column pairs on the Default Values sheet: [code, label] side by side.
    _unitarCodeMap(X, ws, col) {
        const rows = X.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: '' });
        const out = {};
        rows.slice(1).forEach(r => {
            const code = String(r[col] == null ? '' : r[col]).trim();
            const label = String(r[col + 1] == null ? '' : r[col + 1]).trim();
            if (code && label) out[label.toLowerCase()] = code;
        });
        return out;
    },

    // "Mary Jane Watson" -> { firstname: 'Mary Jane', surname: 'Watson' }; "Watson, Mary" too.
    // Roughly a sixth of learners register a single word. Surname AND Firstname are both
    // required by UNITAR, so that word goes in both: it is the only name we hold, and
    // repeating it is honest where inventing a surname would not be.
    _unitarSplitName(full) {
        const s = String(full || '').replace(/\s+/g, ' ').trim();
        if (!s) return { firstname: '', surname: '' };
        if (s.indexOf(',') > 0) {
            const bits = s.split(',');
            const sur = bits[0].trim(), first = bits.slice(1).join(' ').trim();
            return { surname: sur || first, firstname: first || sur };
        }
        const parts = s.split(' ');
        if (parts.length === 1) return { firstname: parts[0], surname: parts[0] };
        return { firstname: parts.slice(0, -1).join(' '), surname: parts[parts.length - 1] };
    },

    // One EMS row per participant, as an array in the template's column order.
    _unitarEmsRows(report, maps) {
        const gender = maps.gender || {}, nat = maps.nationality || {}, org = maps.org || {};
        const code = (map, value, fallback) => {
            const k = String(value || '').trim().toLowerCase();
            return (k && map[k]) || fallback;
        };
        return report.participants.map(p => {
            const nm = this._unitarSplitName(p.name);
            const row = new Array(this.UNITAR_EMS_COLS).fill('');
            row[0] = nm.surname;                                            // A  Surname*
            row[1] = nm.firstname;                                          // B  Firstname*
            row[5] = code(gender, p.gender, gender['unreported'] || '5');   // F  Gender*
            row[6] = p.email;                                               // G  Email*
            row[7] = (p.iso && nat[String(p.iso).toLowerCase()]) ? nat[String(p.iso).toLowerCase()]
                : (p.iso || code(nat, p.country, nat['unreported'] || 'UN'));  // H  Nationality*
            row[9] = code(org, p.organisation_type, org['unreported'] || 'UNR'); // J Organizational Affiliation*
            row[15] = p.started ? '1' : '0';                                // P  Certification of participation
            row[16] = p.certificate ? '1' : '0';                            // Q  Certification of completion
            return row;
        });
    },
    UNITAR_EMS_COLS: 49,

    // The finished workbook: their template, filled, with our Summary added.
    _unitarEmsWorkbook(report, templateBytes) {
        const X = window.XLSXStyle || window.XLSX;
        const wb = X.read(templateBytes, { type: 'array' });
        const ws = wb.Sheets[this.UNITAR_EMS_SHEET];
        if (!ws) throw new Error('The UNITAR template has no "' + this.UNITAR_EMS_SHEET + '" sheet.');
        const dv = wb.Sheets[this.UNITAR_EMS_DEFAULTS];
        const maps = dv ? {
            gender: this._unitarCodeMap(X, dv, 3),
            nationality: this._unitarCodeMap(X, dv, 6),
            org: this._unitarCodeMap(X, dv, 9),
        } : {};
        // Nationality is keyed by ISO code in their list, so index it that way too.
        if (maps.nationality) Object.keys(maps.nationality).forEach(label => { maps.nationality[maps.nationality[label].toLowerCase()] = maps.nationality[label]; });

        const rows = this._unitarEmsRows(report, maps);
        X.utils.sheet_add_aoa(ws, rows, { origin: 'A2' });
        const end = X.utils.decode_range(ws['!ref'] || 'A1');
        ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(end.e.r, rows.length), c: Math.max(end.e.c, this.UNITAR_EMS_COLS - 1) } });

        // Our summary, added as a sheet rather than replacing anything of theirs.
        const summary = this._unitarSheets(report)[0];
        const sws = X.utils.aoa_to_sheet(summary.aoa);
        sws['!cols'] = summary.cols.map(w => ({ wch: w }));
        if (summary.logoRows) sws['!rows'] = new Array(summary.logoRows).fill({ hpx: this.UNITAR_ROW_PX });
        if (window.XLSXStyle) (summary.headerRows || []).forEach(ri => {
            (summary.aoa[ri] || []).forEach((_, ci) => {
                const cell = sws[X.utils.encode_cell({ r: ri, c: ci })];
                if (cell) cell.s = { font: { bold: true, sz: ri === summary.logoRows ? 13 : 11, color: { rgb: '002F4C' } } };
            });
        });
        X.utils.book_append_sheet(wb, sws, 'SURGhub summary');
        // Put the summary first: it is what a person reads; their sheet is what the system eats.
        wb.SheetNames = ['SURGhub summary'].concat(wb.SheetNames.filter(n => n !== 'SURGhub summary'));
        return { X, wb, rows: rows.length };
    },

    async _unitarTemplateBytes() {
        if (this._emsTemplate !== undefined) return this._emsTemplate;
        this._emsTemplate = null;
        try {
            const fs = electronAPI.fs, path = electronAPI.path;
            const p = path.join(electronAPI.appPath || '.', 'templates', 'unitar_ems_template.xls');
            if (fs.existsSync(p)) this._emsTemplate = new Uint8Array(fs.readFileSync(p));
        } catch (e) { __swallowed(e, 'unitar.template'); }
        return this._emsTemplate;
    },

    // ── the GSF logo, added to the finished workbook ──────────────────────
    // SheetJS's community build cannot place an image, so the picture parts are added to
    // the .xlsx afterwards. That is safe here because SheetJS writes every entry STORED
    // (compression method 0), so the container can be read and rewritten without needing
    // an inflate/deflate step at all. Anything unexpected — a deflated entry, a worksheet
    // that already owns relationships — and the original bytes are returned untouched:
    // a report without a logo beats a report Excel refuses to open.
    UNITAR_LOGO_W: 150,          // drawn size of the full lock-up, in pixels
    UNITAR_LOGO_H: 70,
    UNITAR_LOGO_ROWS: 3,         // spacer rows the sheets leave for it
    UNITAR_ROW_PX: 26,

    _unitarCrc32(bytes) {
        let table = this._crcTable;
        if (!table) {
            table = this._crcTable = new Int32Array(256);
            for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); table[i] = c; }
        }
        let crc = -1;
        for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
        return (crc ^ -1) >>> 0;
    },

    // Read a STORED-only zip into [{ name, data }]. Returns null if anything is compressed.
    _unitarUnzip(bytes) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const out = [];
        let off = 0;
        while (off + 30 <= bytes.length && dv.getUint32(off, true) === 0x04034b50) {
            const method = dv.getUint16(off + 8, true);
            const size = dv.getUint32(off + 18, true);
            const nameLen = dv.getUint16(off + 26, true), extraLen = dv.getUint16(off + 28, true);
            if (method !== 0) return null;                       // compressed: leave the file alone
            if (dv.getUint16(off + 6, true) & 0x08) return null;  // streamed sizes: not handled
            const nameStart = off + 30;
            const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen));
            const dataStart = nameStart + nameLen + extraLen;
            out.push({ name, data: bytes.slice(dataStart, dataStart + size) });
            off = dataStart + size;
        }
        return out.length ? out : null;
    },

    _unitarZip(entries) {
        const enc = new TextEncoder();
        const parts = [], central = [];
        let offset = 0;
        entries.forEach(e => {
            const name = enc.encode(e.name);
            const crc = this._unitarCrc32(e.data);
            const local = new Uint8Array(30 + name.length);
            const ldv = new DataView(local.buffer);
            ldv.setUint32(0, 0x04034b50, true); ldv.setUint16(4, 20, true); ldv.setUint16(6, 0, true);
            ldv.setUint16(8, 0, true);                                   // stored
            ldv.setUint16(10, 0, true); ldv.setUint16(12, 0x21, true);   // fixed date, as SheetJS does
            ldv.setUint32(14, crc, true); ldv.setUint32(18, e.data.length, true); ldv.setUint32(22, e.data.length, true);
            ldv.setUint16(26, name.length, true); ldv.setUint16(28, 0, true);
            local.set(name, 30);
            parts.push(local, e.data);

            const cen = new Uint8Array(46 + name.length);
            const cdv = new DataView(cen.buffer);
            cdv.setUint32(0, 0x02014b50, true); cdv.setUint16(4, 20, true); cdv.setUint16(6, 20, true);
            cdv.setUint16(8, 0, true); cdv.setUint16(10, 0, true);
            cdv.setUint16(12, 0, true); cdv.setUint16(14, 0x21, true);
            cdv.setUint32(16, crc, true); cdv.setUint32(20, e.data.length, true); cdv.setUint32(24, e.data.length, true);
            cdv.setUint16(28, name.length, true);
            cdv.setUint32(42, offset, true);
            cen.set(name, 46);
            central.push(cen);
            offset += local.length + e.data.length;
        });
        const cenSize = central.reduce((s, c) => s + c.length, 0);
        const end = new Uint8Array(22);
        const edv = new DataView(end.buffer);
        edv.setUint32(0, 0x06054b50, true);
        edv.setUint16(8, entries.length, true); edv.setUint16(10, entries.length, true);
        edv.setUint32(12, cenSize, true); edv.setUint32(16, offset, true);
        const all = parts.concat(central, [end]);
        const total = all.reduce((s, p) => s + p.length, 0);
        const outBytes = new Uint8Array(total);
        let at = 0;
        all.forEach(p => { outBytes.set(p, at); at += p.length; });
        return outBytes;
    },

    // Put `png` at the top-left of every worksheet in the workbook `bytes`.
    // opts.firstOnly limits the logo to sheet1 — the UNITAR workbook must keep their own
    // sheets exactly as they shipped them, headers and row heights included.
    _unitarAddLogo(bytes, png, opts) {
        opts = opts || {};
        try {
            if (!png || !png.length) return bytes;
            const entries = this._unitarUnzip(bytes);
            if (!entries) return bytes;
            const enc = new TextEncoder(), dec = new TextDecoder();
            const find = (name) => entries.find(e => e.name === name);
            let sheets = entries.filter(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name));
            if (opts.firstOnly) sheets = sheets.filter(e => /sheet1\.xml$/.test(e.name));
            if (!sheets.length) return bytes;
            if (!sheets.length) return bytes;
            if (entries.some(e => /^xl\/worksheets\/_rels\//.test(e.name))) return bytes;   // already has relationships

            const cx = Math.round(this.UNITAR_LOGO_W * 9525), cy = Math.round(this.UNITAR_LOGO_H * 9525);   // pixels → EMU
            entries.push({ name: 'xl/media/gsf-logo.png', data: png });

            sheets.forEach((sheet, i) => {
                const num = sheet.name.match(/sheet(\d+)\.xml$/)[1];
                const drawing = 'xl/drawings/drawing' + num + '.xml';
                entries.push({ name: drawing, data: enc.encode(
                    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
                    + '<xdr:oneCellAnchor>'
                    + '<xdr:from><xdr:col>0</xdr:col><xdr:colOff>57150</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>57150</xdr:rowOff></xdr:from>'
                    + '<xdr:ext cx="' + cx + '" cy="' + cy + '"/>'
                    + '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + (i + 2) + '" name="Global Surgery Foundation" descr="Global Surgery Foundation"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>'
                    + '<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>'
                    + '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>'
                    + '</xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>') });
                entries.push({ name: 'xl/drawings/_rels/drawing' + num + '.xml.rels', data: enc.encode(
                    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/gsf-logo.png"/>'
                    + '</Relationships>') });
                entries.push({ name: 'xl/worksheets/_rels/sheet' + num + '.xml.rels', data: enc.encode(
                    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    + '<Relationship Id="rIdDr1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing' + num + '.xml"/>'
                    + '</Relationships>') });

                let xml = dec.decode(sheet.data);
                if (!/xmlns:r=/.test(xml)) xml = xml.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
                // SheetJS's community build writes no row heights, and omits blank rows
                // entirely, so the spacer rows would collapse to the default and the logo
                // would sit on top of the first line of text. Give them a height here.
                if (!/<row r="1"/.test(xml)) {
                    let rows = '';
                    for (let k = 1; k <= this.UNITAR_LOGO_ROWS; k++) rows += '<row r="' + k + '" ht="' + (this.UNITAR_ROW_PX * 0.75) + '" customHeight="1"/>';
                    xml = xml.replace('<sheetData>', '<sheetData>' + rows);
                }
                if (!/<drawing /.test(xml)) xml = xml.replace('</worksheet>', '<drawing r:id="rIdDr1"/></worksheet>');
                sheet.data = enc.encode(xml);
            });

            const ct = find('[Content_Types].xml');
            if (!ct) return bytes;
            let ctXml = dec.decode(ct.data);
            if (!/Extension="png"/.test(ctXml)) ctXml = ctXml.replace('<Types ', '<Types ').replace(/(<Types[^>]*>)/, '$1<Default Extension="png" ContentType="image/png"/>');
            sheets.forEach(sheet => {
                const num = sheet.name.match(/sheet(\d+)\.xml$/)[1];
                const part = '/xl/drawings/drawing' + num + '.xml';
                if (ctXml.indexOf(part) < 0) ctXml = ctXml.replace('</Types>', '<Override PartName="' + part + '" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
            });
            ct.data = enc.encode(ctXml);

            return this._unitarZip(entries);
        } catch (e) {
            __swallowed(e, 'unitar.logo');
            return bytes;     // never let branding cost us the report
        }
    },

    async _unitarLogoBytes() {
        if (this._unitarLogo !== undefined) return this._unitarLogo;
        this._unitarLogo = null;
        try {
            const fs = electronAPI.fs, path = electronAPI.path;
            // The transparent-background mark: the dark-square version disappears into a
            // white sheet. preload's readFileSync hands back an ArrayBuffer for binaries.
            for (const name of ['gsf_logo_full.png', 'Global Surgery Foundation_logo_symbol.png']) {
                const p = path.join(electronAPI.appPath || '.', 'build', name);
                if (fs.existsSync(p)) { this._unitarLogo = new Uint8Array(fs.readFileSync(p)); break; }
            }
        } catch (e) { __swallowed(e, 'unitar.logo.read'); }
        return this._unitarLogo;
    },

    // ── writing ───────────────────────────────────────────────────────────
    _unitarWorkbook(report) {
        const X = window.XLSXStyle || window.XLSX;
        const styled = !!window.XLSXStyle;
        const wb = X.utils.book_new();
        this._unitarSheets(report).forEach(sheet => {
            const ws = X.utils.aoa_to_sheet(sheet.aoa);
            ws['!cols'] = sheet.cols.map(w => ({ wch: w }));
            if (sheet.logoRows) ws['!rows'] = new Array(sheet.logoRows).fill({ hpx: this.UNITAR_ROW_PX });
            if (sheet.freezeRow) ws['!freeze'] = { xSplit: 0, ySplit: sheet.freezeRow };
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
    _unitarAskPeriod(title, opts) {
        opts = opts || {};
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
                + (opts.privateToggle
                    ? '<label style="display:flex;gap:9px;align-items:flex-start;margin-bottom:18px;cursor:pointer">'
                        + '<input type="checkbox" id="unitar-private" style="margin-top:2px">'
                        + '<span style="font-size:12px;color:#64748b;line-height:1.5">Include private courses'
                        + (opts.privateCount ? ' <strong>(' + opts.privateCount + ')</strong>' : '')
                        + ' — in-country workshops and other closed cohorts. Left out by default.</span></label>'
                    : '')
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
            el.querySelector('#unitar-ok').onclick = () => {
                const pv = el.querySelector('#unitar-private');
                done({ from: f.value || '', to: t.value || '', includePrivate: !!(pv && pv.checked) });
            };
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
            const period = await this._unitarAskPeriod('UNITAR report — ' + course);   // no private toggle: this course was opened on purpose
            if (!period) return;
            const report = this.buildUnitarReport(course, Object.assign({}, ctx, period));
            if (!report.totals.participants) return alert('No participants for "' + course + '"' + (report.period.set ? ' in ' + report.period.label : '') + '.');
            const named = report.participants.filter(p => p.email).length;
            if (!confirm('This report uses UNITAR\'s upload template, which requires each participant\'s surname, first name and email address.\n\n'
                + 'The file will therefore contain PERSONAL DATA for ' + this.formatNumber(named) + ' of ' + this.formatNumber(report.totals.participants) + ' participants.\n'
                + 'Send it to UNITAR only. Continue?')) return;
            const template = await this._unitarTemplateBytes();
            if (!template) return alert('The UNITAR template is missing from this installation (templates/unitar_ems_template.xls).');
            const savePath = await electronAPI.invoke('pick-save-path', this._unitarFileName(course, report.period));
            if (!savePath) return;
            const { X, wb } = this._unitarEmsWorkbook(report, template);
            const out = this._unitarAddLogo(new Uint8Array(X.write(wb, { bookType: 'xlsx', type: 'array' })), await this._unitarLogoBytes(), { firstOnly: true });
            electronAPI.fs.writeFileSync(savePath, out);
            this.showMsg('UNITAR report saved — ' + this.formatNumber(report.totals.participants) + ' participants · ' + report.period.label
                + ' · contains personal data.', 'success');
        } catch (e) {
            console.error('[UNITAR]', e);
            alert('Could not build the report: ' + (e && e.message || e));
        }
    },

    // Every course, one file each, into a folder UNITAR can work through.
    async exportAllUnitarCourseReports() {
        try {
            const ctx = await this._unitarContext();
            await this._unitarPrivateSet();
            const all = [...new Set(ctx.anonUsers.map(u => u && u.course).filter(Boolean))].sort();
            // A course switched off in the Directory is off everywhere, test courses included.
            const listed = this.isCourseIncluded ? all.filter(c => this.isCourseIncluded(c)) : all;
            const excluded = all.length - listed.length;
            const privateCount = listed.filter(c => this.isCoursePrivate(c)).length;
            if (!listed.length) return alert('No participant data. Run Sync Learners first.');
            const period = await this._unitarAskPeriod('UNITAR reports — ' + listed.length + ' courses', { privateToggle: true, privateCount });
            if (!period) return;
            const courses = period.includePrivate ? listed : listed.filter(c => !this.isCoursePrivate(c));
            if (!courses.length) return alert('Every course is marked private. Tick "Include private courses" to report them.');
            const label = this._unitarPeriodLabel(this._unitarMonth(period.from), this._unitarMonth(period.to));
            if (!confirm('Write one UNITAR report per course?\n\nPeriod: ' + label + '\n' + courses.length + ' courses, one .xlsx each, into a folder you choose.'
                + (excluded ? '\n\n' + excluded + ' course' + (excluded === 1 ? '' : 's') + ' excluded from analytics will be skipped.' : '')
                + (privateCount ? '\n' + privateCount + ' private course' + (privateCount === 1 ? '' : 's') + (period.includePrivate ? ' included.' : ' skipped.') : ''))) return;
            const template = await this._unitarTemplateBytes();
            if (!template) return alert('The UNITAR template is missing from this installation (templates/unitar_ems_template.xls).');
            if (!confirm('These reports use UNITAR\'s upload template, which requires each participant\'s surname, first name and email address.\n\n'
                + 'Every file will therefore contain PERSONAL DATA. Send them to UNITAR only. Continue?')) return;
            const folder = await electronAPI.invoke('pick-folder');
            if (!folder) return;
            const logo = await this._unitarLogoBytes();
            const path = electronAPI.path, fs = electronAPI.fs;
            this._reportCancelled = false;
            let ok = 0, skipped = 0;
            for (let i = 0; i < courses.length; i++) {
                if (this._reportCancelled) break;
                if (this._showReportProgress) this._showReportProgress('UNITAR report ' + (i + 1) + '/' + courses.length + ': ' + courses[i], true);
                try {
                    const report = this.buildUnitarReport(courses[i], Object.assign({}, ctx, period));
                    if (!report.totals.participants) { skipped++; continue; }   // nobody enrolled in the period
                    const { X, wb } = this._unitarEmsWorkbook(report, template);
                    const out = this._unitarAddLogo(new Uint8Array(X.write(wb, { bookType: 'xlsx', type: 'array' })), logo, { firstOnly: true });
                    fs.writeFileSync(path.join(folder, this._unitarFileName(courses[i], report.period)), out);
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
