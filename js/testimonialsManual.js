// ── Testimonials added by hand (Seb, 2 Nov 2026) ─────────────────────────────────────────
//
// What learners tell the team by email, on a call or at an event, put on a course page next to
// the survey comments. Stored with the testimonial choices (`surghub_testimonials`, synced):
//   _tm.manual[id] = { course, text, role, affiliation, country, note, date, lang, stars?, added, edited? }
//   _tm.byId[id]   = the usual choice (show, order), with keep: true so Find better never replaces it.
// tmResponses() lists them first, as responses with manual: true, so the Published list, the course
// editor, on/off, ordering and publishing treat them like any other testimonial. The testimonial
// check never runs on them (no cost); the label is published as typed: "role, affiliation" and the
// country. The note (where it came from) is internal: it is never published. Stars only when the
// learner gave a rating themselves (Seb, 2 Nov 2026): none by default, never one made up.
Object.assign(window.App, {
    TM_MANUAL_Q: 'Added by hand',

    _tmManualFor(courseId) {
        const m = (this._tm && this._tm.manual) || {};
        const out = [];
        Object.keys(m).forEach(id => {
            const x = m[id]; if (!x || x.course !== courseId) return;
            const text = String(x.text || '').trim();
            out.push({ id, courseId, text, q: this.TM_MANUAL_Q, date: x.date || '', stars: this._tmManualStars(x.stars), cadre: x.role || '', country: x.country || '', affiliation: x.affiliation || '', note: x.note || '',
                lang: x.lang || this._tmPageLang(courseId), words: text.split(/\s+/).filter(Boolean).length, row: 'm:' + id, manual: true });
        });
        return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    },
    _tmManualStars(v) { const n = Math.round(Number(v) || 0); return n >= 1 && n <= 5 ? n : 0; },
    tmManualCount() { return Object.keys((this._tm && this._tm.manual) || {}).length; },

    // Add (id empty) or edit one. vals: { course (id), text, role, affiliation, country, note, date, stars, show, lang }.
    async tmSaveManual(vals, id) {
        await this._tmLoad();
        const t = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
        const text = String(vals.text == null ? '' : vals.text).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
        if (!text || !vals.course) return null;
        const now = new Date().toISOString(), m = this._tm.manual = this._tm.manual || {};
        const nid = id && m[id] ? id : 'm' + this._tmHash(vals.course + '|' + now + '|' + this._tmNorm(text));
        const prev = m[nid] || {};
        m[nid] = { course: vals.course, text, role: t(vals.role), affiliation: t(vals.affiliation), country: t(vals.country), note: String(vals.note == null ? '' : vals.note).trim(),
            date: t(vals.date) || now.slice(0, 10), lang: vals.lang || this._tmPageLang(vals.course), added: prev.added || now };
        const stars = this._tmManualStars(vals.stars); if (stars) m[nid].stars = stars;
        if (prev.added) m[nid].edited = now;
        const order = Object.values(this._tm.byId).filter(e => e.course === vals.course && e.show).reduce((a, e) => Math.max(a, Number(e.order) || 0), 0) + 1;
        const e = this._tm.byId[nid] || (this._tm.byId[nid] = { course: vals.course, order });
        if (e.course !== vals.course) { e.course = vals.course; e.order = order; }
        delete e.text; delete e.cadre; delete e.country; delete e.stars; delete e.auto;   // the entry itself holds the words and labels
        e.keep = true; e.show = vals.show !== false; e.at = now;
        await this._tmSave();
        return nid;
    },
    async tmDeleteManual(id) {
        await this._tmLoad();
        const x = this._tm.manual && this._tm.manual[id]; if (!x) return false;
        if (!confirm('Delete this testimonial?\n\n"' + x.text.slice(0, 200) + (x.text.length > 200 ? '…' : '') + '"\n\nIt leaves the course page at the next publish.')) return false;
        delete this._tm.manual[id]; delete this._tm.byId[id];
        await this._tmSave(); this.showMsg('Testimonial deleted.'); this._tmRerender();
        return true;
    },

    // What the form warns about before saving: the page language and the privacy hold-back.
    tmManualWarnings(courseId, text) {
        const out = [], lang = this._tmPageLang(courseId), got = this._tmLang(text, lang);
        const name = { en: 'English', fr: 'French', es: 'Spanish', ar: 'Arabic' };
        if (text && got !== lang) out.push({ k: 'lang', msg: 'This course\'s page is in ' + (name[lang] || lang) + ' and this reads as ' + (name[got] || got) + '. Only testimonials in the page\'s language are published.' });
        if (text && this._tmHeld(text)) out.push({ k: 'held', msg: 'It contains what looks like a name, email address or phone number, so it is held back from the site until that is removed.' });
        return out;
    },

    // ── the form ──
    async tmOpenManual(courseId, id) {
        await this._tmLoad();
        if (this._cfMeta === undefined && this._cfLoad) { try { await this._cfLoad(); } catch (e) { __swallowed(e, 'tm.manual.feed'); } }
        const feed = this._tmCourseFeed(), courses = feed.courses.slice().sort((a, b) => String(a.title).localeCompare(String(b.title)));
        const x = id && this._tm.manual && this._tm.manual[id] ? this._tm.manual[id] : null, e = x ? this._tm.byId[id] || {} : null;
        const cid = x ? x.course : courseId || '', titleOf = {}; courses.forEach(c => { titleOf[c.id] = c.title; });
        const esc = (v) => this.escapeHtml(String(v == null ? '' : v));
        const old = document.getElementById('tm-manual'); if (old) old.remove();
        const wrap = document.createElement('div');
        wrap.id = 'tm-manual';
        wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,47,76,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;padding:24px';
        const label = (t, hint) => '<label style="display:block;font-size:12px;font-weight:700;color:#002F4C;margin:12px 0 4px">' + t + (hint ? ' <span style="font-weight:500;color:#94a3b8">' + hint + '</span>' : '') + '</label>';
        const box = 'width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font-size:13px;outline:none;box-sizing:border-box';
        wrap.innerHTML = '<div style="background:#fff;border-radius:14px;padding:24px 26px;max-width:620px;width:100%;max-height:92vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,.35)">'
            + '<div style="font-size:16px;font-weight:800;color:#002F4C">' + (x ? 'Edit testimonial' : 'Add a testimonial') + '</div>'
            + '<div style="font-size:12px;color:#64748b;margin-top:4px">For what a learner told you by email, on a call or anywhere else. It goes on the course page like a survey comment.</div>'
            + label('Course') + '<input data-f="course" list="tm-manual-courses" placeholder="Start typing a course name…" style="' + box + '"><datalist id="tm-manual-courses">' + courses.map(c => '<option value="' + esc(c.title) + '"></option>').join('') + '</datalist>'
            + label('Testimonial', 'exactly as it should appear, without quote marks') + '<textarea data-f="text" rows="5" style="' + box + ';resize:vertical"></textarea>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px">'
            + '<div>' + label('Profession or role', 'optional') + '<input data-f="role" placeholder="e.g. General surgeon" style="' + box + '"></div>'
            + '<div>' + label('Country', 'optional') + '<input data-f="country" placeholder="e.g. Kenya" style="' + box + '"></div></div>'
            + label('Affiliation', 'optional, shown after the role') + '<input data-f="affiliation" placeholder="e.g. Kenyatta National Hospital" style="' + box + '">'
            + '<div data-preview style="font-size:11px;color:#64748b;margin-top:6px"></div>'
            + label('Where it came from', 'internal, never published') + '<textarea data-f="note" rows="2" placeholder="e.g. Email to the SURGhub inbox, 12 Oct 2026; permission to quote given" style="' + box + ';resize:vertical"></textarea>'
            + '<div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">'
            + '<div>' + label('Received') + '<input data-f="date" type="date" style="' + box + ';width:170px"></div>'
            + '<div>' + label('Rating they gave', 'only if they gave one') + '<select data-f="stars" style="' + box + ';width:190px"><option value="0">None (no stars shown)</option>'
            + [5, 4, 3, 2, 1].map(n => '<option value="' + n + '">' + '★'.repeat(n) + ' ' + n + ' out of 5</option>').join('') + '</select></div>'
            + '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#334155;padding-bottom:9px"><input data-f="show" type="checkbox"> Show it on the course page</label></div>'
            + '<div data-warn style="margin-top:12px"></div>'
            + '<div style="display:flex;justify-content:space-between;gap:10px;margin-top:18px">'
            + (x ? '<button data-act="delete" style="padding:8px 14px;border-radius:8px;border:1px solid #fecaca;background:#fff;color:#e11d48;font-weight:700;font-size:13px;cursor:pointer">Delete</button>' : '<span></span>')
            + '<div style="display:flex;gap:10px"><button data-act="cancel" style="padding:8px 18px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#475569;font-weight:700;font-size:13px;cursor:pointer">Cancel</button>'
            + '<button data-act="ok" style="padding:8px 18px;border-radius:8px;border:none;background:#002F4C;color:#fff;font-weight:700;font-size:13px;cursor:pointer">' + (x ? 'Save' : 'Add') + '</button></div></div></div>';
        const f = (k) => wrap.querySelector('[data-f="' + k + '"]');
        f('course').value = titleOf[cid] || '';
        f('text').value = x ? x.text : '';
        f('role').value = x ? (e.cadre != null ? e.cadre : x.role) || '' : '';
        f('country').value = x ? x.country || '' : '';
        f('affiliation').value = x ? x.affiliation || '' : '';
        f('note').value = x ? x.note || '' : '';
        f('date').value = x ? x.date || '' : new Date().toISOString().slice(0, 10);
        f('stars').value = String(x ? this._tmManualStars(x.stars) : 0);
        f('show').checked = x ? e.show !== false : true;
        const idOf = (title) => { const c = courses.find(k => k.title === String(title).trim()); return c ? c.id : ''; };
        const refresh = () => {
            const c = idOf(f('course').value), text = f('text').value.trim();
            const who = [[f('role').value.trim(), f('affiliation').value.trim()].filter(Boolean).join(', '), f('country').value.trim()].filter(Boolean).join(' · ');
            wrap.querySelector('[data-preview]').textContent = 'Shown under the quote as: ' + (who || 'SURGhub learner');
            const w = c ? this.tmManualWarnings(c, text) : [];
            const shown = c ? Object.entries(this._tm.byId).filter(([k, v]) => v.course === c && v.show && k !== id).length : 0;
            wrap.querySelector('[data-warn]').innerHTML = (c ? '<div style="font-size:12px;color:#64748b;margin-bottom:6px">This course shows ' + shown + ' testimonial' + (shown === 1 ? '' : 's') + ' now.</div>' : '')
                + w.map(m => '<div style="font-size:12px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px;margin-bottom:6px">' + esc(m.msg) + '</div>').join('');
        };
        ['course', 'text', 'role', 'country', 'affiliation'].forEach(k => f(k).addEventListener('input', refresh));
        refresh();
        const close = () => wrap.remove();
        wrap.querySelector('[data-act="cancel"]').onclick = close;
        const del = wrap.querySelector('[data-act="delete"]'); if (del) del.onclick = async () => { if (await this.tmDeleteManual(id)) close(); };
        wrap.querySelector('[data-act="ok"]').onclick = async () => {
            const course = idOf(f('course').value), text = f('text').value.trim();
            if (!course) { alert('Pick the course from the list (start typing its name).'); f('course').focus(); return; }
            if (!text) { alert('Write the testimonial.'); f('text').focus(); return; }
            let lang = this._tmPageLang(course);
            if (this.tmManualWarnings(course, text).some(m => m.k === 'lang') && !confirm('This course\'s page is in another language than this testimonial.\n\nOK: show it on the page anyway.\nCancel: keep it, but leave it off the page.')) lang = this._tmLang(text, lang);
            const nid = await this.tmSaveManual({ course, text, role: f('role').value, affiliation: f('affiliation').value, country: f('country').value, note: f('note').value, date: f('date').value, stars: f('stars').value, show: f('show').checked, lang }, id);
            if (!nid) return;
            close();
            this.showMsg((x ? 'Testimonial saved' : 'Testimonial added to ' + (titleOf[course] || 'the course')) + (f('show').checked ? '. It goes online with the next publish.' : ', switched off.'));
            this._tmRerender();
        };
        document.body.appendChild(wrap);
        setTimeout(() => (cid ? f('text') : f('course')).focus(), 50);
    },
});
