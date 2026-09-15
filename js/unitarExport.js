// ── UNITAR course reports: one Excel file per course ───────────────────────
//
// UNITAR uploads each course to its reporting system as an "event" with its
// participants attached, so the unit of export is one course, one file.
//
// Three sheets. "Summary" carries the totals and the breakdown of participants by
// country, career stage, gender, organisation type and profession — each in numbers
// and in percentages. "Participants" is the anonymised participant list: no name, no
// email, no identifier that follows anyone between courses. "Method and assumptions"
// states, in plain words, where every figure comes from, exactly how large the gaps
// are, and what is assumed when a gap is filled.
//
// TWO GAPS, and they are different things. (1) Some enrolled learners have no
// demographic record at all — the participant file is a little short of the platform's
// own enrolment count on most courses. (2) Among the participants who do have a
// record, some fields are blank: gender and organisation type come only from the
// sign-up survey, never from the API, so they are blank for roughly a third.
// Both are reported per course, and the estimated columns are labelled as estimates.
//
// The estimate assumes the learners who did not answer are distributed like those who
// did. That is an assumption, not a measurement, and the method sheet says so. Shares
// are allocated by largest remainder, so the estimated column sums exactly to the
// enrolment total rather than drifting by a unit or two through rounding.
Object.assign(window.App, {

    UNITAR_DIMENSIONS: [
        { key: 'country', label: 'Country', source: 'Learner profile (LearnWorlds account country)' },
        { key: 'career_stage', label: 'Career stage', source: 'Sign-up survey' },
        { key: 'gender', label: 'Gender', source: 'Sign-up survey' },
        { key: 'organisation_type', label: 'Organisation type', source: 'Sign-up survey' },
        { key: 'profession', label: 'Profession', source: 'Learner profile, supplemented by the sign-up survey' },
    ],
    UNITAR_UNKNOWN: 'Not recorded',
    UNITAR_SMALL_CELL: 5,     // categories below this are counted and flagged on the method sheet

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
        (opts.completion || []).forEach(r => { if (r && r.uid && r.course === courseName) comp[r.uid] = r; });

        const participants = people.map((u, i) => {
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
                completed: c ? !!c.completed : String(u.has_certificate || '').toLowerCase() === 'yes',
                certificate: c ? !!c.certificate : String(u.has_certificate || '').toLowerCase() === 'yes',
            };
        });

        const records = participants.length;
        const platform = snap ? this._unitarNum(snap.Learners) : 0;
        // The reporting base: the platform's enrolment count when it has one, because that
        // is the figure every other SURGhub report shows. Never below the records we hold.
        const enrolled = Math.max(platform, records);

        const minutes = participants.map(p => p.minutes).filter(m => m > 0).sort((a, b) => a - b);
        const totals = {
            enrolled, records, platform,
            missingRecords: Math.max(0, enrolled - records),
            started: participants.filter(p => p.started).length,
            completed: participants.filter(p => p.completed).length,
            certificates: participants.filter(p => p.certificate).length,
            platformCertificates: snap ? this._unitarNum(snap.Certificates) : 0,
            learningMinutes: participants.reduce((s, p) => s + p.minutes, 0),
            medianMinutes: minutes.length ? minutes[Math.floor(minutes.length / 2)] : 0,
            withEnrolDate: participants.filter(p => p.enrolled).length,
        };
        totals.certRate = this._unitarPct(totals.certificates, records);

        const dimensions = this.UNITAR_DIMENSIONS.map(d => {
            const tally = {};
            participants.forEach(p => { if (this._unitarKnown(p[d.key])) { const v = String(p[d.key]).trim(); tally[v] = (tally[v] || 0) + 1; } });
            const names = Object.keys(tally).sort((a, b) => tally[b] - tally[a] || a.localeCompare(b));
            const counts = names.map(v => tally[v]);
            const known = counts.reduce((s, n) => s + n, 0);
            const est = this._unitarAllocate(counts, known ? enrolled : 0);
            return {
                key: d.key, label: d.label, source: d.source,
                known, notRecorded: records - known, records, enrolled,
                categories: names.length,
                smallCategories: counts.filter(n => n > 0 && n < this.UNITAR_SMALL_CELL).length,
                rows: names.map((v, i) => ({
                    value: v, n: counts[i],
                    pctKnown: this._unitarPct(counts[i], known),
                    pctRecords: this._unitarPct(counts[i], records),
                    estimate: est[i],
                    estimatePct: this._unitarPct(est[i], enrolled),
                })),
            };
        });

        return {
            course: courseName,
            provider: (snap && snap.Provider) || '',
            generatedAt: now.toISOString(),
            dataThrough: snap ? String(snap.Timestamp || '').slice(0, 10) : '',
            totals, dimensions, participants,
        };
    },

    // ── the workbook, as plain arrays (one entry per sheet) ────────────────
    _unitarSheets(r) {
        const n = (v) => Math.round(Number(v) || 0);
        // Percentages go in as plain numbers to one decimal under a column headed "%".
        // A real percentage cell would need a number format per cell; this reads the same
        // in Excel, survives a CSV round-trip, and cannot be mis-formatted.
        const pct = (v) => Math.round((Number(v) || 0) * 10) / 10;
        const S = [];

        // ── Summary ──
        const a = [];
        a.push(['SURGhub course report for UNITAR']);
        a.push(['Course', r.course]);
        a.push(['Provider', r.provider || 'Not recorded']);
        a.push(['Course data through', r.dataThrough || 'unknown']);
        a.push(['Report generated', String(r.generatedAt).slice(0, 10)]);
        a.push([]);
        a.push(['TOTALS']);
        a.push(['Enrolled learners', n(r.totals.enrolled)]);
        a.push(['Participant records in this file', n(r.totals.records)]);
        a.push(['Enrolled learners with no participant record', n(r.totals.missingRecords), r.totals.missingRecords ? 'See "Method and assumptions", gap 1' : '']);
        a.push(['Started the course', n(r.totals.started)]);
        a.push(['Completed the course', n(r.totals.completed)]);
        a.push(['Certificates earned', n(r.totals.certificates)]);
        a.push(['Certificate rate (of participant records)', pct(r.totals.certRate)]);
        a.push(['Total learning time (hours)', Math.round(r.totals.learningMinutes / 60)]);
        a.push(['Median learning time per participant (minutes)', n(r.totals.medianMinutes)]);
        a.push([]);

        r.dimensions.forEach(d => {
            a.push([d.label.toUpperCase()]);
            a.push(['Recorded for ' + n(d.known) + ' of ' + n(d.records) + ' participants'
                + (d.notRecorded ? ' — ' + n(d.notRecorded) + ' not recorded' : '')]);
            const iso = d.key === 'country';
            a.push([d.label, 'Participants', '% of those recorded', '% of all participant records', 'Estimated, all enrolled', '% of all enrolled'].concat(iso ? ['ISO code'] : []));
            d.rows.forEach(row => a.push([row.value, n(row.n), pct(row.pctKnown), pct(row.pctRecords), n(row.estimate), pct(row.estimatePct)].concat(iso ? [this._unitarISO(row.value)] : [])));
            if (d.notRecorded) a.push([this.UNITAR_UNKNOWN, n(d.notRecorded), '', pct(this._unitarPct(d.notRecorded, d.records)), '', '']);
            a.push(['Total', n(d.records), d.known ? pct(100) : '', pct(100), d.known ? n(d.enrolled) : '', d.known ? pct(100) : '']);
            a.push([]);
        });
        S.push({ name: 'Summary', aoa: a, cols: [46, 14, 20, 26, 22, 16, 10], bold: [0, 6], headerRows: this._unitarHeaderRows(a) });

        // ── Participants ──
        const head = ['Participant', 'Sign-up month', 'Country', 'ISO code', 'Career stage', 'Gender', 'Organisation type', 'Profession',
            'Enrolled', 'Started', 'Completed', 'Certificate earned', 'Learning time (minutes)', 'Completed', 'Certificate'];
        const p = [head];
        const shown = (v) => this._unitarKnown(v) ? String(v).trim() : this.UNITAR_UNKNOWN;
        r.participants.forEach(x => p.push([
            x.n, x.signupMonth || this.UNITAR_UNKNOWN, shown(x.country), x.iso || '', shown(x.career_stage), shown(x.gender),
            shown(x.organisation_type), shown(x.profession),
            x.enrolled || '', x.started || '', x.completedOn || '', x.certificateOn || '',
            x.minutes || 0, x.completed ? 'Yes' : 'No', x.certificate ? 'Yes' : 'No',
        ]));
        S.push({ name: 'Participants', aoa: p, cols: [11, 14, 24, 10, 22, 14, 24, 30, 12, 12, 12, 16, 20, 11, 12], bold: [0], headerRows: [0], freeze: true });

        // ── Method and assumptions ──
        const m = [];
        const say = (k, v) => m.push([k, v == null ? '' : String(v)]);
        say('METHOD AND ASSUMPTIONS', '');
        say('Course', r.course);
        say('', '');
        say('WHAT THIS FILE IS', 'One SURGhub course, its enrolment totals, and its participants with no name, no email address and no identifier that follows a person from one course to another. The participant numbers restart at 1 in every file, so participant 7 here is not participant 7 in any other file.');
        say('', '');
        say('GAP 1 — ENROLLED LEARNERS WITH NO PARTICIPANT RECORD', '');
        say('Enrolled learners', Math.round(r.totals.enrolled) + (r.totals.platform ? ' (the platform enrolment count for this course)' : ' (counted from the participant records; the platform had no total for this course)'));
        say('Participant records held', Math.round(r.totals.records));
        say('Difference', Math.round(r.totals.missingRecords) + (r.totals.missingRecords ? ' learners, ' + this._unitarPct(r.totals.missingRecords, r.totals.enrolled) + '% of enrolments, appear in the platform total but have no demographic record. They are counted in the enrolment total and in the estimated columns, and they are absent from the participant list.' : ' — every enrolled learner has a record.'));
        say('', '');
        say('GAP 2 — FIELDS NOT RECORDED FOR A PARTICIPANT WE DO HOLD', '');
        say('Why', 'Gender and organisation type are never supplied by the learning platform. They come only from the sign-up survey, which is voluntary, so they are blank for every learner who did not answer it. Country comes from the learner account and is more complete.');
        m.push(['Field', 'Recorded', 'Not recorded', 'Recorded %', 'Source']);
        r.dimensions.forEach(d => m.push([d.label, Math.round(d.known), Math.round(d.notRecorded), this._unitarPct(d.known, d.records) + '%', d.source]));
        say('', '');
        say('HOW VALUES ARE TIDIED', '');
        say('Profession', 'The platform stores a raw tag, so one cadre arrives under several spellings ("nurse" and "nursing", "anesthesiology" and "anaesthesiologist"). Tags are folded into the cadres SURGhub reports everywhere else; anything unrecognised becomes "Other".');
        say('Country', 'Reported as the learner wrote it, with the ISO 3166-1 alpha-2 code alongside where the country is recognised. A blank code means the spelling could not be matched, not that the country is missing.');
        say('', '');
        say('THE ASSUMPTION BEHIND THE ESTIMATED COLUMNS', '');
        say('What is assumed', 'The learners who did not answer are assumed to be spread across the categories in the same proportions as the learners who did. The recorded share of each category is applied to the full enrolment total.');
        say('What that means', 'The estimated column is a projection, not a count. Treat the "Participants" column as the measured figure and the estimated column as an indication of scale.');
        say('Why it may be wrong', 'The learners who answer a voluntary survey are not necessarily like those who do not. This assumption has not been tested against an independent source, and it will be least reliable where the recorded share is lowest.');
        say('Rounding', 'Estimates are allocated by largest remainder, so each estimated column sums exactly to the enrolment total.');
        say('', '');
        say('SMALL CATEGORIES', '');
        const small = r.dimensions.reduce((s, d) => s + d.smallCategories, 0);
        say('Categories with fewer than ' + this.UNITAR_SMALL_CELL + ' participants', String(small) + (small ? ' — in a small course, a single-person category combined with other columns can point to an individual. Consider grouping or withholding those rows before sharing outside the reporting system.' : ''));
        say('', '');
        say('HOW THE TOTALS ARE DEFINED', '');
        say('Enrolled', 'A learner registered on the course.');
        say('Started', 'A learner with a recorded start date. Recorded for ' + Math.round(r.totals.started) + ' of ' + Math.round(r.totals.records) + ' participants; a blank start date means the platform holds none, not that the learner did nothing.');
        say('Completed', 'The platform marks the course as completed for that learner.');
        say('Certificate earned', 'A certificate was issued. The platform total for this course is ' + Math.round(r.totals.platformCertificates) + '.');
        say('Learning time', 'Minutes recorded by the platform. Time spent outside the platform is not captured.');
        S.push({ name: 'Method and assumptions', aoa: m, cols: [46, 78, 16, 16, 46], bold: [0], headerRows: this._unitarHeaderRows(m), wrap: true });

        return S;
    },

    // Rows that are section headings (a single non-empty first cell) or column headers.
    _unitarHeaderRows(aoa) {
        const out = [];
        aoa.forEach((row, i) => {
            const first = String(row[0] == null ? '' : row[0]);
            if (!first) return;
            if (first === first.toUpperCase() && /[A-Z]/.test(first) && row.filter(c => c !== '' && c != null).length <= 2) out.push(i);
            else if (row.length > 3 && /^(Country|Career stage|Gender|Organisation type|Profession|Participant|Field)$/.test(first)) out.push(i);
        });
        return out;
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

    _unitarFileName(courseName) {
        const safe = String(courseName).replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 60);
        return 'UNITAR_' + (safe || 'course') + '_' + new Date().toISOString().slice(0, 10) + '.xlsx';
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
            const report = this.buildUnitarReport(course, ctx);
            if (!report.totals.records) return alert('No participant records for "' + course + '".\n\nRun Sync Learners (and upload the sign-up survey) first.');
            const savePath = await electronAPI.invoke('pick-save-path', this._unitarFileName(course));
            if (!savePath) return;
            const { X, wb } = this._unitarWorkbook(report);
            const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
            electronAPI.fs.writeFileSync(savePath, new Uint8Array(out));
            this.showMsg('UNITAR report saved — ' + this.formatNumber(report.totals.records) + ' participants, '
                + this.formatNumber(report.totals.missingRecords) + ' enrolments without a record.', 'success');
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
            if (!confirm('Write one UNITAR report per course?\n\n' + courses.length + ' courses, one .xlsx each, into a folder you choose.'
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
                    const report = this.buildUnitarReport(courses[i], ctx);
                    if (!report.totals.records) { skipped++; continue; }
                    const { X, wb } = this._unitarWorkbook(report);
                    const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
                    fs.writeFileSync(path.join(folder, this._unitarFileName(courses[i])), new Uint8Array(out));
                    ok++;
                } catch (e) { console.error('[UNITAR]', courses[i], e); skipped++; }
            }
            if (this._hideReportProgress) this._hideReportProgress();
            alert((this._reportCancelled ? 'Cancelled. ' : 'Done. ') + ok + ' report' + (ok === 1 ? '' : 's') + ' written'
                + (skipped ? ', ' + skipped + ' course' + (skipped === 1 ? '' : 's') + ' skipped for want of participant data' : '') + '\n\n' + folder);
        } catch (e) {
            if (this._hideReportProgress) this._hideReportProgress();
            console.error('[UNITAR]', e);
            alert('Could not write the reports: ' + (e && e.message || e));
        }
    },
});
