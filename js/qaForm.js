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
// WHERE THE WORDS COME FROM. js/courseDetails.js: the summary from the LearnWorlds
// API, and the learning objectives and the language from the public course page, which
// publishes both. "Event objectives" carries the summary and the objectives together,
// because UNITAR asked for both there. Nothing is invented: a course whose page states
// no objectives leaves that row empty, and the export says which rows it left.
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
        // Partners is the SURGhub partnership itself, the same on every form. The body that
        // actually wrote the course is named under Additional Information — including when
        // that body is GSF, which authors courses as well as running the platform.
        const provider = report.provider && report.provider !== 'Unknown Provider' ? report.provider : '';

        // "Event objectives" is the course's own summary and nothing else. It briefly
        // carried the learning objectives too, which only printed them twice on the same
        // page — they have their own row directly below.
        const objectives = String(detail.objectives || '').trim();

        return {
            course: courseName, year, report, detail,
            rows: {
                'Title of event': detail.title || courseName,
                'Event type': 'E-Learning Course',
                'Is this a Learning or Non-Learning event': 'Yes',
                'Date of event': year + '/1/1 – ' + year + '/12/31',
                'Duration of event': days + ' days (self-paced, open throughout the year)',
                'Partners': 'The Global Surgery Foundation',
                'Mode of delivery': 'Online',
                'Location': detail.url || this.coursePublicUrl(detail.courseId) || 'https://www.surghub.org',
                'Main language(s) of event': detail.language || '',
                'Registration/enrollment': 'Open enrolment, free of charge, through SURGhub',
                'Deadline for registration': 'Open',
                'Fee (in USD)': '0',
                'Background': 'Almost a third of the global disease burden is surgical, yet over five billion people lack access to safe and affordable surgical care. '
                    + 'SURGhub, the United Nations global surgery learning hub, is a free platform of curated courses for the surgical, obstetric and anaesthesia workforce, '
                    + 'operated by the Global Surgery Foundation. This course is one of those offerings.',
                'Event objectives': String(detail.description || '').trim(),
                'Learning objectives': objectives,
                'Content and structure': 'Self-paced online course hosted on SURGhub.',
                'Methodology': 'Asynchronous self-paced e-learning: participants work through the course at their own pace and a certificate is issued on completion.',
                // The course page states its own audience; ours is the fallback.
                'Target audience': detail.targetAudience
                    || 'Surgical, obstetric, anaesthesia and nursing care providers, particularly in low- and middle-income settings.',
                'Activity’s focal point': 'Michaela DORCIKOVA <Michaela.DORCIKOVA@unitar.org>',
                'Additional Information': provider ? 'Course provider: ' + provider : '',
            },
            // Rows the app cannot answer from what it holds, so the caller can say so.
            // "Additional Information" is empty by choice and is not a gap.
            blanks: []
                .concat(detail.language ? [] : ['Main language(s) of event'])
                .concat(objectives ? [] : ['Learning objectives'])
                .concat(detail.description ? [] : ['Event objectives']),
        };
    },

    // ── the document ──────────────────────────────────────────────────────
    _qaEsc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    // How each row is rendered beyond plain text. Declared here rather than buried in the
    // builder so the shape of the form is readable in one place.
    QA_ROW_FORMAT: {
        'Location': { hyperlink: true },
        'Learning objectives': { bulletAll: true },
        'Partners': { logo: true },
    },

    _qaRun(text, rPr) {
        return '<w:r>' + (rPr || '') + '<w:t xml:space="preserve">' + this._qaEsc(text) + '</w:t></w:r>';
    },

    // A run of paragraphs for one cell, keeping the cell's own properties.
    // `ctx` carries what the document can offer: a bullet numId, and relationship ids for
    // a hyperlink and the logo. Anything missing degrades to plain text.
    _qaCellXml(tcPr, value, fmt, ctx) {
        fmt = fmt || {}; ctx = ctx || {};
        const lines = String(value == null ? '' : value).split('\n');
        const bulletPr = ctx.bulletNumId
            ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="' + ctx.bulletNumId + '"/></w:numPr></w:pPr>'
            : '';
        // Without a bullet definition to point at, a literal bullet still reads as a list.
        const bulletText = (t) => ctx.bulletNumId ? t : '\u2022 ' + t;

        let seenColon = false;
        const body = lines.map(line => {
            const bullet = fmt.bulletAll
                ? !!line.trim()
                : (fmt.bulletAfterColon && seenColon && !!line.trim());
            if (fmt.bulletAfterColon && /:\s*$/.test(line)) seenColon = true;
            if (fmt.hyperlink && ctx.linkRelId && /^https?:\/\//i.test(line.trim())) {
                return '<w:p><w:hyperlink r:id="' + ctx.linkRelId + '">'
                    + this._qaRun(line.trim(), '<w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr>')
                    + '</w:hyperlink></w:p>';
            }
            if (bullet) return '<w:p>' + bulletPr + this._qaRun(bulletText(line.trim())) + '</w:p>';
            return '<w:p>' + this._qaRun(line) + '</w:p>';
        }).join('');

        // The logo, then an empty paragraph, so the name sits clear of the picture
        // rather than tight under it.
        const logo = (fmt.logo && ctx.logoRelId)
            ? '<w:p>' + this._qaImageRun(ctx.logoRelId, ctx.logoW, ctx.logoH) + '</w:p><w:p/>'
            : '';
        return '<w:tc>' + (tcPr || '') + logo + (body || '<w:p/>') + '</w:tc>';
    },

    // An inline picture. `a` and `pic` are declared on the elements that use them: the
    // document root declares w, r and wp but not those two.
    _qaImageRun(relId, wPx, hPx) {
        const cx = Math.round((wPx || 120) * 9525), cy = Math.round((hPx || 56) * 9525);
        return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
            + '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/>'
            + '<wp:docPr id="1001" name="Global Surgery Foundation" descr="Global Surgery Foundation"/>'
            + '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>'
            + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
            + '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            + '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            + '<pic:nvPicPr><pic:cNvPr id="0" name="gsf-logo.png"/><pic:cNvPicPr/></pic:nvPicPr>'
            + '<pic:blipFill><a:blip r:embed="' + relId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            + '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>'
            + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
            + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    },

    // The bullet list the template already defines: use its own numbering rather than
    // inventing one, so the bullets look like the rest of the document.
    _qaBulletNumId(numberingXml) {
        const xml = String(numberingXml || '');
        const bulletAbstracts = {};
        (xml.match(/<w:abstractNum w:abstractNumId="\d+"[\s\S]*?<\/w:abstractNum>/g) || []).forEach(block => {
            const id = (block.match(/w:abstractNumId="(\d+)"/) || [])[1];
            const lvl0 = (block.match(/<w:lvl w:ilvl="0"[\s\S]*?<\/w:lvl>/) || [''])[0];
            if (id && /<w:numFmt w:val="bullet"/.test(lvl0)) bulletAbstracts[id] = (lvl0.match(/<w:lvlText w:val="([^"]*)"/) || [])[1] || '';
        });
        let fallback = '';
        const maps = xml.match(/<w:num w:numId="\d+"[^>]*>[\s\S]*?<\/w:num>/g) || [];
        for (const m of maps) {
            const numId = (m.match(/w:numId="(\d+)"/) || [])[1];
            const abs = (m.match(/<w:abstractNumId w:val="(\d+)"/) || [])[1];
            if (!numId || !(abs in bulletAbstracts)) continue;
            if (bulletAbstracts[abs] === '\uF0B7') return numId;      // the standard Word bullet
            if (!fallback) fallback = numId;
        }
        return fallback;
    },

    // Word splits a label across several runs wherever the author paused typing, so the
    // document really says "Mode of d elivery" and "Learning o bjectives". Comparing on
    // letters and digits alone is the only reliable way to recognise a row; the hint text
    // ("(Yes or No)", "(Y/M/D)") sits in the same cell, so the match is a prefix.
    _qaKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); },

    // Replace the second cell of every row whose first cell names a known label.
    fillQaDocumentXml(xml, answers, ctx) {
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
            return tr.replace(cells[1], this._qaCellXml(tcPr, answers[key], this.QA_ROW_FORMAT[key], ctx));
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

    QA_RELS_PART: 'word/_rels/document.xml.rels',
    QA_LOGO_PART: 'word/media/gsf-logo.png',
    QA_LOGO_W: 120,
    QA_LOGO_H: 56,

    // Add a relationship and hand back its id, continuing the document's own numbering.
    _qaAddRel(rels, type, target, external) {
        let max = 0;
        (rels.match(/Id="rId(\d+)"/g) || []).forEach(m => { const n = Number(m.match(/\d+/)[0]); if (n > max) max = n; });
        const id = 'rId' + (max + 1);
        const rel = '<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + type + '"'
            + ' Target="' + String(target).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"'
            + (external ? ' TargetMode="External"' : '') + '/>';
        return { id, rels: rels.replace('</Relationships>', rel + '</Relationships>') };
    },

    async buildQaDocument(courseName, opts) {
        opts = opts || {};
        const template = await this._qaTemplateBytes();
        if (!template) throw new Error('The UNITAR QA form template is missing from this installation (' + this.QA_TEMPLATE + ').');
        const answers = this.buildQaAnswers(courseName, opts);
        const entries = await this._qaUnzip(template);
        if (!entries) throw new Error('The QA form template could not be read.');
        const enc = new TextEncoder(), dec = new TextDecoder();
        const part = (name) => entries.find(e => e.name === name);
        const doc = part(this.QA_DOC_PART);
        if (!doc) throw new Error('The QA form template has no ' + this.QA_DOC_PART + '.');

        const ctx = { logoW: this.QA_LOGO_W, logoH: this.QA_LOGO_H };

        // The bullet list the template already defines.
        const numbering = part('word/numbering.xml');
        if (numbering) ctx.bulletNumId = this._qaBulletNumId(dec.decode(numbering.data));

        // Relationships: the location link, and the logo — each optional, so a template
        // without a rels part still produces a form, just a plainer one.
        const relsPart = part(this.QA_RELS_PART);
        const logo = (opts.logo !== undefined) ? opts.logo : await this._qaLogoBytes();
        if (relsPart) {
            let rels = dec.decode(relsPart.data);
            const url = answers.rows['Location'];
            if (url && /^https?:\/\//i.test(url)) {
                const added = this._qaAddRel(rels, 'hyperlink', url, true);
                ctx.linkRelId = added.id; rels = added.rels;
            }
            if (logo && logo.length) {
                const added = this._qaAddRel(rels, 'image', 'media/gsf-logo.png', false);
                ctx.logoRelId = added.id; rels = added.rels;
                entries.push({ name: this.QA_LOGO_PART, data: logo });
                const ct = part('[Content_Types].xml');
                if (ct) {
                    let ctXml = dec.decode(ct.data);
                    if (!/Extension="png"/.test(ctXml)) {
                        ctXml = ctXml.replace(/(<Types[^>]*>)/, '$1<Default Extension="png" ContentType="image/png"/>');
                        ct.data = enc.encode(ctXml);
                    }
                }
            }
            relsPart.data = enc.encode(rels);
        }

        const res = this.fillQaDocumentXml(dec.decode(doc.data), answers.rows, ctx);
        doc.data = enc.encode(res.xml);
        return { bytes: this._unitarZip(entries), answers, filled: res.filled, ctx };
    },

    async _qaLogoBytes() {
        if (this._qaLogo !== undefined) return this._qaLogo;
        this._qaLogo = null;
        try {
            const fs = electronAPI.fs, path = electronAPI.path;
            const p = path.join(electronAPI.appPath || '.', 'build', 'gsf_logo_full.png');
            if (fs.existsSync(p)) this._qaLogo = new Uint8Array(fs.readFileSync(p));
        } catch (e) { __swallowed(e, 'qa.logo'); }
        return this._qaLogo;
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
