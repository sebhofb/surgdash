// ── UNITAR quality-assessment form, filled per course ─────────────────────
//
// UNITAR wants their QA form for each course once a year. The form is a Word
// document holding a single two-column table: a label on the left, a value on the
// right. This fills the right-hand column and leaves everything else — styles,
// headers, the customXml parts Word cares about — exactly as it arrived.
//
// Filling their document rather than generating a lookalike matters: it is the form
// they recognise. A .docx is a zip, so the work is the same trick the UNITAR
// spreadsheet uses, with one addition: Word deflates its parts, so the one part we
// edit has to be inflated first (DecompressionStream, present in both Electron and
// Node). Everything is written back STORED, which is a perfectly legal zip and
// spares us a deflate implementation.
//
// WHAT IT CANNOT KNOW. Course summaries come from js/courseDetails.js. Learning
// objectives are only filled when the course's own description states them —
// UNITAR's own filled example leaves that row blank, and inventing objectives for a
// course we did not write would be worse than an empty row. Language and focal point
// are left for a person: the app holds neither.
Object.assign(window.App, {

    QA_TEMPLATE: 'templates/unitar_qa_form.docx',
    QA_DOC_PART: 'word/document.xml',

    // ── the answers ───────────────────────────────────────────────────────
    // Built separately from the document so the wording is checkable on its own.
    buildQaAnswers(courseName, opts) {
        opts = opts || {};
        const now = opts.now ? new Date(opts.now) : new Date();
        const year = opts.year || now.getFullYear();
        const from = year + '-01', to = year + '-12';
        const report = opts.report || this.buildUnitarReport(courseName, Object.assign({ from, to }, opts.ctx || {}));
        const detail = (opts.detail !== undefined) ? opts.detail : this.courseDetail(courseName);
        const n = (v) => this.formatNumber(Math.round(Number(v) || 0));

        const days = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365;
        const provider = report.provider && report.provider !== 'Unknown Provider' ? report.provider : '';
        const partners = provider ? provider + ', in partnership with the Global Surgery Foundation' : 'Global Surgery Foundation';

        const countries = (report.dimensions.find(d => d.key === 'country') || { rows: [] }).rows;
        const top = countries.slice(0, 5).map(r => r.value).join(', ');

        const extra = [
            n(report.totals.participants) + ' learners enrolled during ' + year + '.',
            n(report.totals.certificates) + ' certificates were earned (' + (Math.round(report.totals.certRate * 10) / 10) + '% of enrolments).',
            countries.length ? countries.length + ' countries represented' + (top ? '; most participants came from ' + top + '.' : '.') : '',
            report.launch.month ? 'The course opened to learners in ' + this._unitarMonthName(report.launch.month) + '.' : '',
            'Figures prepared with SURGdash, the Global Surgery Foundation.',
        ].filter(Boolean).join('\n');

        return {
            course: courseName, year, report, detail,
            rows: {
                'Title of event': detail.title || courseName,
                'Event type': 'E-Learning Course',
                'Is this a Learning or Non-Learning event': 'Yes',
                'Date of event': year + '/1/1 – ' + year + '/12/31',
                'Duration of event': days + ' days (self-paced, open throughout the year)',
                'Partners': partners,
                'Mode of delivery': 'Online',
                'Location': detail.url || this.coursePublicUrl(detail.courseId) || 'https://www.surghub.org',
                'Main language(s) of event': '',
                'Registration/enrollment': 'Open enrolment, free of charge, through SURGhub',
                'Deadline for registration': 'Open',
                'Fee (in USD)': '0',
                'Background': 'Almost a third of the global disease burden is surgical, yet over five billion people lack access to safe and affordable surgical care. '
                    + 'SURGhub, the United Nations global surgery learning hub, is a free platform of curated courses for the surgical, obstetric and anaesthesia workforce, '
                    + 'operated by the Global Surgery Foundation. This course is one of those offerings.',
                'Event objectives': detail.description || '',
                'Learning objectives': detail.objectives || '',
                'Content and structure': (detail.description ? 'Self-paced online course hosted on SURGhub. ' : 'Self-paced online course hosted on SURGhub. ')
                    + (report.totals.medianMinutes ? 'A typical participant spent about ' + n(report.totals.medianMinutes) + ' minutes on it.' : ''),
                'Methodology': 'Asynchronous self-paced e-learning: participants work through the course at their own pace and a certificate is issued on completion.',
                'Target audience': 'Surgical, obstetric, anaesthesia and nursing care providers, particularly in low- and middle-income settings.',
                'Activity’s focal point': '',
                'Additional Information': extra,
            },
            // Rows the app deliberately does not answer, so the caller can say so.
            blanks: ['Main language(s) of event', 'Activity’s focal point']
                .concat(detail.objectives ? [] : ['Learning objectives'])
                .concat(detail.description ? [] : ['Event objectives']),
        };
    },

    // ── the document ──────────────────────────────────────────────────────
    _qaEsc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    // A run of paragraphs for one cell, keeping the cell's own properties.
    _qaCellXml(tcPr, value) {
        const lines = String(value == null ? '' : value).split('\n');
        const body = lines.map(line =>
            '<w:p><w:r><w:t xml:space="preserve">' + this._qaEsc(line) + '</w:t></w:r></w:p>').join('');
        return '<w:tc>' + (tcPr || '') + (body || '<w:p/>') + '</w:tc>';
    },

    // Word splits a label across several runs wherever the author paused typing, so the
    // document really says "Mode of d elivery" and "Learning o bjectives". Comparing on
    // letters and digits alone is the only reliable way to recognise a row; the hint text
    // ("(Yes or No)", "(Y/M/D)") sits in the same cell, so the match is a prefix.
    _qaKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); },

    // Replace the second cell of every row whose first cell names a known label.
    fillQaDocumentXml(xml, answers) {
        const filled = [];
        const rows = Object.keys(answers);
        const out = String(xml).replace(/<w:tr[ >][\s\S]*?<\/w:tr>/g, (tr) => {
            const cells = tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g);
            if (!cells || cells.length < 2) return tr;
            const label = this._qaKey(cells[0].replace(/<[^>]+>/g, ' '));
            const key = rows.find(k => label.indexOf(this._qaKey(k)) === 0);
            if (!key) return tr;
            const tcPr = (cells[1].match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/) || [''])[0];
            filled.push(key);
            return tr.replace(cells[1], this._qaCellXml(tcPr, answers[key]));
        });
        return { xml: out, filled };
    },

    // ── zip with inflate, for Word's deflated parts ───────────────────────
    async _qaInflate(bytes) {
        const ds = new DecompressionStream('deflate-raw');
        const blobStream = new Response(bytes).body.pipeThrough(ds);
        const buf = await new Response(blobStream).arrayBuffer();
        return new Uint8Array(buf);
    },

    // Like _unitarUnzip, but inflates deflated entries instead of refusing them.
    async _qaUnzip(bytes) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const out = [];
        let off = 0;
        while (off + 30 <= bytes.length && dv.getUint32(off, true) === 0x04034b50) {
            const method = dv.getUint16(off + 8, true);
            const size = dv.getUint32(off + 18, true);
            const nameLen = dv.getUint16(off + 26, true), extraLen = dv.getUint16(off + 28, true);
            if (dv.getUint16(off + 6, true) & 0x08) return null;     // streamed sizes: not handled
            const nameStart = off + 30;
            const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen));
            const dataStart = nameStart + nameLen + extraLen;
            const raw = bytes.slice(dataStart, dataStart + size);
            if (method !== 0 && method !== 8) return null;
            out.push({ name, data: method === 8 ? await this._qaInflate(raw) : raw });
            off = dataStart + size;
        }
        return out.length ? out : null;
    },

    // ── writing ───────────────────────────────────────────────────────────
    async _qaTemplateBytes() {
        if (this._qaTemplate !== undefined) return this._qaTemplate;
        this._qaTemplate = null;
        try {
            const fs = electronAPI.fs, path = electronAPI.path;
            const p = path.join(electronAPI.appPath || '.', this.QA_TEMPLATE);
            if (fs.existsSync(p)) this._qaTemplate = new Uint8Array(fs.readFileSync(p));
        } catch (e) { __swallowed(e, 'qa.template'); }
        return this._qaTemplate;
    },

    async buildQaDocument(courseName, opts) {
        const template = await this._qaTemplateBytes();
        if (!template) throw new Error('The UNITAR QA form template is missing from this installation (' + this.QA_TEMPLATE + ').');
        const answers = this.buildQaAnswers(courseName, opts);
        const entries = await this._qaUnzip(template);
        if (!entries) throw new Error('The QA form template could not be read.');
        const doc = entries.find(e => e.name === this.QA_DOC_PART);
        if (!doc) throw new Error('The QA form template has no ' + this.QA_DOC_PART + '.');
        const res = this.fillQaDocumentXml(new TextDecoder().decode(doc.data), answers.rows);
        doc.data = new TextEncoder().encode(res.xml);
        return { bytes: this._unitarZip(entries), answers, filled: res.filled };
    },

    _qaFileName(courseName, year) {
        const safe = String(courseName).replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 60);
        return 'UNITAR_QA_' + (safe || 'course') + '_' + year + '.docx';
    },

    // Electron has no prompt() — it is one of the few browser dialogs Chromium refuses to
    // implement there, and calling it throws rather than returning null. Same small modal
    // as the reporting-period picker instead. Resolves to a year, or null if cancelled.
    _qaYear(title) {
        return new Promise(resolve => {
            const thisYear = new Date().getFullYear();
            const years = [thisYear, thisYear - 1, thisYear - 2, thisYear - 3];
            const el = document.createElement('div');
            el.id = 'qa-year-dialog';
            el.style.cssText = 'position:fixed;inset:0;background:rgba(0,47,76,0.85);display:flex;align-items:center;justify-content:center;z-index:10000';
            el.innerHTML = '<div style="background:#fff;border-radius:16px;padding:28px 32px;max-width:460px;width:92%">'
                + '<div style="font-size:18px;font-weight:800;color:#002F4C;margin-bottom:6px">' + this.escapeHtml(title || 'Quality-assessment form') + '</div>'
                + '<div style="font-size:13px;color:#64748b;margin-bottom:18px">Which year should the form cover? Participation figures count learners who <strong>enrolled</strong> in that year.</div>'
                + '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">'
                + years.map(y => '<button data-y="' + y + '" style="padding:8px 18px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;font-size:13px;font-weight:700;color:#002F4C;cursor:pointer">' + y + '</button>').join('')
                + '</div>'
                + '<label style="display:block;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:20px">Or another year'
                + '<input type="number" id="qa-year-input" min="2000" max="2100" step="1" value="' + (thisYear - 1) + '" style="display:block;width:140px;margin-top:5px;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px"></label>'
                + '<div style="display:flex;justify-content:flex-end;gap:8px">'
                + '<button id="qa-cancel" style="padding:9px 18px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;font-size:13px;font-weight:700;color:#64748b;cursor:pointer">Cancel</button>'
                + '<button id="qa-ok" style="padding:9px 22px;border-radius:8px;border:0;background:#002F4C;font-size:13px;font-weight:700;color:#fff;cursor:pointer">Create form</button>'
                + '</div></div>';
            document.body.appendChild(el);
            const input = el.querySelector('#qa-year-input');
            const done = (v) => { el.remove(); resolve(v); };
            const take = (raw) => {
                const n = parseInt(String(raw).trim(), 10);
                if (!(n >= 2000 && n <= 2100)) { input.style.borderColor = '#D03734'; input.focus(); return; }
                done(n);
            };
            el.querySelectorAll('[data-y]').forEach(b => b.onclick = () => take(b.getAttribute('data-y')));
            el.querySelector('#qa-cancel').onclick = () => done(null);
            el.querySelector('#qa-ok').onclick = () => take(input.value);
            el.onclick = (ev) => { if (ev.target === el) done(null); };
            input.onkeydown = (ev) => { if (ev.key === 'Enter') take(input.value); };
            setTimeout(() => { try { input.focus(); input.select(); } catch (e) { __swallowed(e); } }, 30);
        });
    },

    async exportQaForm(courseName) {
        const course = courseName || this.selectedCourse;
        if (!course) return alert('Open a course first.');
        try {
            await this._courseDetailsLoad();
            if (!this.courseDetail(course).description) {
                if (!confirm('No course summary has been fetched for "' + course + '" yet, so the objectives rows will be blank.\n\n'
                    + 'Data Sync → "Fetch course summaries" fills them in. Create the form anyway?')) return;
            }
            const year = await this._qaYear('QA form \u2014 ' + course);
            if (year == null) return;
            const ctx = await this._unitarContext();
            const { bytes, answers, filled } = await this.buildQaDocument(course, { year, ctx });
            const savePath = await electronAPI.invoke('pick-save-path', this._qaFileName(course, year));
            if (!savePath) return;
            electronAPI.fs.writeFileSync(savePath, bytes);
            this.showMsg('QA form saved — ' + filled.length + ' rows filled'
                + (answers.blanks.length ? ' · left for you: ' + answers.blanks.join(', ') : ''), 'success');
        } catch (e) {
            console.error('[QA]', e);
            alert('Could not build the QA form: ' + (e && e.message || e));
        }
    },

    async exportAllQaForms() {
        try {
            await this._courseDetailsLoad();
            await this._unitarPrivateSet();
            const ctx = await this._unitarContext();
            const all = [...new Set(ctx.anonUsers.map(u => u && u.course).filter(Boolean))].sort();
            const listed = this.isCourseIncluded ? all.filter(c => this.isCourseIncluded(c)) : all;
            const courses = listed.filter(c => !this.isCoursePrivate(c));
            if (!courses.length) return alert('No courses to report on.');
            const year = await this._qaYear('QA forms \u2014 ' + courses.length + ' courses');
            if (year == null) return;
            const missing = courses.filter(c => !this.courseDetail(c).description).length;
            if (!confirm('Write a UNITAR quality-assessment form for each course?\n\n'
                + courses.length + ' courses, one .docx each, for ' + year + '.'
                + (missing ? '\n\n' + missing + ' have no course summary yet — their objectives rows will be blank. '
                    + 'Data Sync → "Fetch course summaries" fills them in.' : ''))) return;
            const folder = await electronAPI.invoke('pick-folder');
            if (!folder) return;
            const path = electronAPI.path, fs = electronAPI.fs;
            this._reportCancelled = false;
            let ok = 0, skipped = 0;
            for (let i = 0; i < courses.length; i++) {
                if (this._reportCancelled) break;
                if (this._showReportProgress) this._showReportProgress('QA form ' + (i + 1) + '/' + courses.length + ': ' + courses[i], true);
                try {
                    const { bytes } = await this.buildQaDocument(courses[i], { year, ctx });
                    fs.writeFileSync(path.join(folder, this._qaFileName(courses[i], year)), bytes);
                    ok++;
                } catch (e) { console.error('[QA]', courses[i], e); skipped++; }
            }
            if (this._hideReportProgress) this._hideReportProgress();
            alert((this._reportCancelled ? 'Cancelled. ' : 'Done. ') + ok + ' form' + (ok === 1 ? '' : 's') + ' written for ' + year
                + (skipped ? ', ' + skipped + ' failed' : '') + '\n\n' + folder);
        } catch (e) {
            if (this._hideReportProgress) this._hideReportProgress();
            console.error('[QA]', e);
            alert('Could not write the forms: ' + (e && e.message || e));
        }
    },
});
