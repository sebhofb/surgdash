// ── Learner stories (Seb, 3 Nov 2026) ─────────────────────────────────────────────────────
//
// The impact stories on the SURGhub blog, each tied to the courses it mentions, so a provider's
// dashboard can show the stories about its courses. Stored in `surghub_learner_stories`
// (surghub/learner_stories.json, travels with the data):
//   { v: 1, stories: { id: { title, url, image, name, role, country, city, summary, quote,
//                            courses: [courseId], show, note, added, edited? } } }
// The tie to a provider runs through the courses (course → provider from the course list), so a
// story follows a course that changes provider. The stories are public (published on the blog
// with the learner's consent), so names stay; the note is internal.
//
// The nine stories below were read from surghub.org/blog on 3 Nov 2026. Each article ends with a
// "Top Course" box linking to the course; other courses the text names are added where the
// article names them (Dr Shima Alsheikh: handover and trauma-and-disaster courses; Dr Sourov Das:
// Essential Burn Care). The committee-member story (Dr Andrea Parker) is not a learner story.
// They are written in on first use when the store is empty; once it exists the seed is never
// applied again, so a story deleted stays deleted.
Object.assign(window.App, {
    LS_KEY: 'surghub_learner_stories',
    LS_SEED: [
        { title: 'Training between shifts in Somaliland', url: 'https://www.surghub.org/blog/impact-stories-abdihakim-mohamoud-ahmed-somaliland',
          image: 'https://lwfiles.mycourse.app/globalsurgery-public/875dad29ed03ca3a8f2a1ddff9822823.png',
          name: 'Dr Abdihakim Mohamoud Ahmed', role: 'Junior doctor', country: 'Somaliland', city: 'Burao',
          summary: 'A junior doctor at a district hospital in Somaliland, on fitting surgical training into his free time.',
          quote: 'I made a deliberate decision to redirect the time I previously spent on social media toward SURGhub instead.', courses: ['obstetric-trauma'] },
        { title: 'Learning through Sudan\'s war', url: 'https://www.surghub.org/blog/impact-stories-shima-alsheikh-sudan',
          image: 'https://lwfiles.mycourse.app/globalsurgery-public/f9716e07c83a79819c5701b0f1cade15.png',
          name: 'Dr Shima Alsheikh', role: 'Doctor in plastic surgery', country: 'Sudan', city: 'Khartoum',
          summary: 'Working in plastic surgery in Khartoum when the war began, she has since completed nine SURGhub courses alongside her work.',
          quote: 'Sometimes the impact of a course is not one memorable patient or one particular case, but a change in the way you think and work with patients afterwards.',
          courses: ['canecsa-research-methodology-course', 'handover', 'trauma-disaster-team-response-mcgill'] },
        { title: 'Care continues when resources fall short', url: 'https://www.surghub.org/blog/impact-stories-oshanda-dinethra-sri-lanka',
          image: 'https://lwfiles.mycourse.app/globalsurgery-public/4e86c7d8063e0c3749d523c78a5476f6.png',
          name: 'Oshanda Dinethra', role: 'Nursing graduate', country: 'Sri Lanka', city: 'Galle',
          summary: 'A nursing graduate in Sri Lanka, on how online learning helped him through a critical ICU case.', quote: '', courses: ['pen-programme'] },
        { title: 'From the roadside to the trauma bay in Kenya', url: 'https://www.surghub.org/blog/impact-stories-dennis-nyangau-kenya',
          image: 'https://lwfiles.mycourse.app/globalsurgery-public/e8ec75ddced4d332f133aae56cab6c5c.png',
          name: 'Dennis Ntabo Nyang\'au', role: 'Emergency care provider', country: 'Kenya', city: 'Nakuru',
          summary: 'An emergency care provider with the Kenya Red Cross in Nakuru, on how structured training helps him save lives.', quote: '', courses: ['essential-emergency-and-critical-care'] },
        { title: 'Resilient surgical care in Sierra Leone', url: 'https://www.surghub.org/blog/impact-stories-dr-sheku-dennis-massaquoi-resilient-care',
          image: 'https://lwfiles.mycourse.app/globalsurgery-public/2c455e1bbf586dbf235aed0014d53a76.png',
          name: 'Dr Sheku Dennis Massaquoi', role: 'General surgeon', country: 'Sierra Leone', city: 'Freetown',
          summary: 'A general surgeon with Sierra Leone\'s armed forces, on resource shortages and using online learning to improve care.', quote: '', courses: ['fundamentals-war-surgery'] },
        { title: 'Safer surgery in conflict areas of the DRC', url: 'https://www.surghub.org/blog/impact-stories-william-baraka-congo',
          image: 'https://lwfiles.mycourse.app/globalsurgery-public/cba96310c64045a6a853b14597f262b3.png',
          name: 'William Baraka', role: 'Anaesthesiology and critical care specialist', country: 'Democratic Republic of the Congo', city: 'Bukavu',
          summary: 'An anaesthesiology and critical care specialist in the Democratic Republic of the Congo, on turning a personal loss into a mission.', quote: '', courses: ['anaesthesia-in-war'] },
        { title: 'Surgery as a work of art', url: 'https://www.surghub.org/blog/impact-stories-dr-shubhangi-patil-surgical-art-belagavi',
          image: 'https://lwfiles.mycourse.app/globalsurgery-public/b9a80dd453cb04045740bb8d41765904.png',
          name: 'Dr Shubhangi Patil', role: 'Clinician and peer reviewer', country: 'India', city: 'Belagavi',
          summary: 'A clinician and peer reviewer in Belagavi, India, on surgery as an art and keeping skills sharp through online learning.', quote: '', courses: ['essential-emergency-and-critical-care'] },
        { title: 'Reconstructive surgery in Egypt', url: 'https://www.surghub.org/blog/impact-stories-dr-sanderene-abdelnor-reconstructive-surgery-egypt',
          image: 'https://lwfiles.mycourse.app/globalsurgery-public/7553fc0356907fb5c04093a75d8fed2d.png',
          name: 'Dr Sanderene Abdelnor', role: 'Plastic surgery consultant', country: 'Egypt', city: 'Giza',
          summary: 'A plastic surgery consultant in Egypt, on technical precision, artistic judgement, and treating the person, not the pathology.', quote: '', courses: ['burn-reconstruction'] },
        { title: 'Approaching cases with confidence in Bangladesh', url: 'https://www.surghub.org/blog/impact-stories-dr-sourov-das-surgical-training-bangladesh',
          image: 'https://lwfiles.mycourse.app/globalsurgery-public/133c0c57043cd551669e7b61c010247a.png',
          name: 'Dr Sourov Das', role: 'Surgical trainee', country: 'Bangladesh', city: 'Comilla',
          summary: 'A surgical trainee in Bangladesh, on how online courses on his phone help him approach complex cases with confidence.',
          quote: 'Following this course, I was able to approach a case of a young girl suffering from hot water burns confidently.', courses: ['acute-burn-care', 'essential-burn-care'] },
    ],

    _lsId(url) { return 's' + (this._tmHash ? this._tmHash(String(url || '').trim().toLowerCase()) : String(url).replace(/[^a-z0-9]+/gi, '').slice(-24)); },
    async _lsLoad() {
        if (this._ls) return this._ls;
        let v = null; try { v = await Storage.getItem(this.LS_KEY); } catch (e) { __swallowed(e, 'ls.load'); }
        if (v && typeof v === 'object' && v.stories) { this._ls = v; return v; }
        // first use: the stories already on the blog
        const now = new Date().toISOString(), stories = {};
        this.LS_SEED.forEach(s => { stories[this._lsId(s.url)] = Object.assign({ show: true, note: 'From surghub.org/blog, read on 3 Nov 2026', added: now }, s, { courses: s.courses.slice() }); });
        this._ls = { v: 1, stories };
        await this._lsSave();
        return this._ls;
    },
    async _lsSave() { try { await Storage.setItem(this.LS_KEY, this._ls); } catch (e) { __swallowed(e, 'ls.save'); } },

    // Every course the app knows: [{ id, title, provider }], A–Z.
    _lsCourses() {
        const seen = {};
        (this.getAnalyticsSnap ? this.getAnalyticsSnap() : []).forEach(d => { if (d && d.CourseId && !seen[d.CourseId]) seen[d.CourseId] = { id: d.CourseId, title: String(d.Course || d.CourseId), provider: d.Provider || '' }; });
        return Object.values(seen).sort((a, b) => a.title.localeCompare(b.title));
    },
    // Stories, newest first; with courseIds, only those that mention one of them; shown ones only unless all.
    lsList(courseIds, all) {
        const st = (this._ls && this._ls.stories) || {}, want = courseIds ? new Set(courseIds) : null;
        return Object.keys(st).map(id => Object.assign({ id }, st[id]))
            .filter(s => (all || s.show !== false) && (!want || (s.courses || []).some(c => want.has(c))))
            .sort((a, b) => String(b.added || '').localeCompare(String(a.added || '')));
    },

    async lsSaveStory(vals, id) {
        await this._lsLoad();
        const t = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
        const url = /^https?:\/\//i.test(t(vals.url)) ? t(vals.url) : '', courses = (vals.courses || []).filter(Boolean);
        if (!t(vals.title) || !courses.length) return null;
        const now = new Date().toISOString(), st = this._ls.stories;
        const nid = id && st[id] ? id : this._lsId(url || (vals.title + now));
        const prev = st[nid] || {};
        st[nid] = { title: t(vals.title), url, image: /^https?:\/\//i.test(t(vals.image)) ? t(vals.image) : '', name: t(vals.name), role: t(vals.role), country: t(vals.country), city: t(vals.city),
            summary: t(vals.summary), quote: t(vals.quote).replace(/^["“”]+|["“”]+$/g, ''), courses: Array.from(new Set(courses)),
            show: vals.show !== false, note: String(vals.note == null ? '' : vals.note).trim(), added: prev.added || now };
        if (prev.added) st[nid].edited = now;
        await this._lsSave();
        return nid;
    },
    async lsDeleteStory(id) {
        await this._lsLoad();
        const s = this._ls.stories[id]; if (!s) return false;
        if (!confirm('Delete this story?\n\n' + s.title + (s.name ? ' (' + s.name + ')' : '') + '\n\nIt leaves the partner dashboards at the next publish.')) return false;
        delete this._ls.stories[id]; await this._lsSave();
        return true;
    },

    // What a blog link gives without a browser: the title, summary and photo from the page's
    // social tags. The article itself is drawn by script, so the courses are chosen by hand;
    // courses whose names appear in the title or summary are suggested.
    async lsReadLink(url) {
        if (!/^https?:\/\//i.test(String(url || ''))) return null;
        let h = '';
        try {
            const r = await Promise.race([electronAPI.invoke('http-request', { url, method: 'GET' }), new Promise(res => setTimeout(() => res(null), 10000))]);
            h = (r && r.body) || '';
        } catch (e) { __swallowed(e, 'ls.read'); return null; }
        if (!h) return null;
        const dec = (s) => { const d = document.createElement('textarea'); d.innerHTML = String(s || ''); return d.value.trim(); };
        const meta = (p) => { const m = h.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + p + '["\'][^>]*content=["\']([^"\']*)["\']', 'i')) || h.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + p + '["\']', 'i')); return m ? dec(m[1]) : ''; };
        const title = meta('og:title').replace(/\s*\|\s*SURGhub\s*$/i, ''), summary = meta('og:description'), image = meta('og:image');
        return { title, summary, image, courses: this._lsSuggest(title + ' ' + summary) };
    },
    _lsSuggest(text) {
        const norm = (s) => ' ' + String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
        const t = norm(text);
        return this._lsCourses().filter(c => { const n = norm(c.title.replace(/\s*\([^)]*\)\s*$/, '')); return n.trim().split(' ').length >= 2 && t.includes(n); }).map(c => c.id);
    },

    // ── the list ──
    async lsOpenManager() {
        await this._lsLoad();
        const esc = (v) => this.escapeHtml(String(v == null ? '' : v));
        const courses = {}; this._lsCourses().forEach(c => { courses[c.id] = c; });
        const old = document.getElementById('ls-manager'); if (old) old.remove();
        const wrap = document.createElement('div');
        wrap.id = 'ls-manager';
        wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,47,76,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;padding:24px';
        const draw = () => {
            const list = this.lsList(null, true);
            wrap.innerHTML = '<div style="background:#fff;border-radius:14px;padding:24px 26px;max-width:760px;width:100%;max-height:92vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,.35)">'
                + '<div style="display:flex;justify-content:space-between;align-items:start;gap:12px"><div><div style="font-size:16px;font-weight:800;color:#002F4C">Learner stories</div>'
                + '<div style="font-size:12px;color:#64748b;margin-top:4px;max-width:520px">Stories from the SURGhub blog, each tied to the courses it mentions. A provider\'s partner dashboard shows the stories about its courses.</div></div>'
                + '<button data-act="add" style="padding:8px 14px;border-radius:8px;border:none;background:#0468B1;color:#fff;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap">+ Add a story</button></div>'
                + '<div style="margin-top:16px">' + (list.length ? list.map(s => {
                    const cs = (s.courses || []).map(c => courses[c] ? esc(courses[c].title) + ' <span style="color:#94a3b8">(' + esc(courses[c].provider) + ')</span>' : '<span style="color:#cf2525">' + esc(c) + ' (not in the course list)</span>').join('<br>');
                    return '<div style="display:flex;gap:14px;padding:14px 0;border-top:1px solid #e2e8f0' + (s.show === false ? ';opacity:.55' : '') + '">'
                        + (s.image ? '<img src="' + esc(s.image) + '" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility=\'hidden\'" style="width:72px;height:72px;object-fit:cover;border-radius:9px;flex:none;background:#e6f0f8">' : '<div style="width:72px;height:72px;border-radius:9px;background:#e6f0f8;flex:none"></div>')
                        + '<div style="flex:1;min-width:0"><div style="font-weight:700;color:#002F4C;font-size:14px">' + esc(s.title) + '</div>'
                        + '<div style="font-size:12px;color:#475569;margin-top:2px">' + esc([s.name, s.role, [s.city, s.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ')) + '</div>'
                        + '<div style="font-size:12px;color:#334155;margin-top:6px;line-height:1.5">' + cs + '</div></div>'
                        + '<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex:none">'
                        + '<button data-edit="' + esc(s.id) + '" style="font-size:12px;font-weight:700;color:#0468B1;background:none;border:none;cursor:pointer">Edit</button>'
                        + (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener" style="font-size:12px;color:#64748b">Open</a>' : '')
                        + (s.show === false ? '<span style="font-size:11px;color:#94a3b8">Hidden</span>' : '') + '</div></div>';
                }).join('') : '<p style="font-size:13px;color:#64748b">No stories yet.</p>') + '</div>'
                + '<div style="display:flex;justify-content:flex-end;margin-top:16px"><button data-act="close" style="padding:8px 18px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#475569;font-weight:700;font-size:13px;cursor:pointer">Close</button></div></div>';
            wrap.querySelector('[data-act="close"]').onclick = () => wrap.remove();
            wrap.querySelector('[data-act="add"]').onclick = () => this.lsOpenForm(null, draw);
            wrap.querySelectorAll('[data-edit]').forEach(b => { b.onclick = () => this.lsOpenForm(b.getAttribute('data-edit'), draw); });
        };
        draw();
        document.body.appendChild(wrap);
    },

    // ── the form ──
    async lsOpenForm(id, done) {
        await this._lsLoad();
        const all = this._lsCourses(), byId = {}, byTitle = {};
        all.forEach(c => { byId[c.id] = c; byTitle[c.title.toLowerCase()] = c; });
        const x = id ? this._ls.stories[id] : null;
        const esc = (v) => this.escapeHtml(String(v == null ? '' : v));
        const old = document.getElementById('ls-form'); if (old) old.remove();
        const wrap = document.createElement('div');
        wrap.id = 'ls-form';
        wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,47,76,0.7);display:flex;align-items:center;justify-content:center;z-index:10001;padding:24px';
        const label = (t, hint) => '<label style="display:block;font-size:12px;font-weight:700;color:#002F4C;margin:12px 0 4px">' + t + (hint ? ' <span style="font-weight:500;color:#94a3b8">' + hint + '</span>' : '') + '</label>';
        const box = 'width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font-size:13px;outline:none;box-sizing:border-box';
        let chosen = x ? (x.courses || []).slice() : [];
        wrap.innerHTML = '<div style="background:#fff;border-radius:14px;padding:24px 26px;max-width:640px;width:100%;max-height:92vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,.35)">'
            + '<div style="font-size:16px;font-weight:800;color:#002F4C">' + (x ? 'Edit story' : 'Add a story') + '</div>'
            + '<div style="font-size:12px;color:#64748b;margin-top:4px">Paste the blog link and choose Read to fill in the title, summary and photo. Then add the courses the story mentions: they decide which partner dashboards show it.</div>'
            + label('Link to the story') + '<div style="display:flex;gap:8px"><input data-f="url" placeholder="https://www.surghub.org/blog/…" style="' + box + '"><button data-act="read" style="padding:8px 14px;border-radius:8px;border:1px solid #0468B1;background:#fff;color:#0468B1;font-weight:700;font-size:13px;cursor:pointer">Read</button></div>'
            + '<div data-read style="font-size:12px;color:#64748b;margin-top:4px"></div>'
            + label('Title') + '<input data-f="title" style="' + box + '">'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px">'
            + '<div>' + label('Learner\'s name') + '<input data-f="name" placeholder="e.g. Dr Sourov Das" style="' + box + '"></div>'
            + '<div>' + label('Profession or role') + '<input data-f="role" placeholder="e.g. Surgical trainee" style="' + box + '"></div>'
            + '<div>' + label('Country') + '<input data-f="country" style="' + box + '"></div>'
            + '<div>' + label('City', 'optional') + '<input data-f="city" style="' + box + '"></div></div>'
            + label('Summary', 'one or two sentences') + '<textarea data-f="summary" rows="2" style="' + box + ';resize:vertical"></textarea>'
            + label('A quote from the story', 'optional, without quote marks') + '<textarea data-f="quote" rows="2" style="' + box + ';resize:vertical"></textarea>'
            + label('Photo link', 'filled in by Read') + '<input data-f="image" style="' + box + '">'
            + label('Courses the story mentions') + '<div data-chips style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px"></div>'
            + '<input data-f="course" list="ls-courses" placeholder="Start typing a course name, then pick it…" style="' + box + '"><datalist id="ls-courses">' + all.map(c => '<option value="' + esc(c.title) + '">' + esc(c.provider) + '</option>').join('') + '</datalist>'
            + label('Notes', 'internal') + '<input data-f="note" placeholder="e.g. Consent to share on file" style="' + box + '">'
            + '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#334155;margin-top:12px"><input data-f="show" type="checkbox"> Show it on the partner dashboards</label>'
            + '<div style="display:flex;justify-content:space-between;gap:10px;margin-top:18px">'
            + (x ? '<button data-act="delete" style="padding:8px 14px;border-radius:8px;border:1px solid #fecaca;background:#fff;color:#cf2525;font-weight:700;font-size:13px;cursor:pointer">Delete</button>' : '<span></span>')
            + '<div style="display:flex;gap:10px"><button data-act="cancel" style="padding:8px 18px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#475569;font-weight:700;font-size:13px;cursor:pointer">Cancel</button>'
            + '<button data-act="ok" style="padding:8px 18px;border-radius:8px;border:none;background:#002F4C;color:#fff;font-weight:700;font-size:13px;cursor:pointer">' + (x ? 'Save' : 'Add') + '</button></div></div></div>';
        const f = (k) => wrap.querySelector('[data-f="' + k + '"]');
        ['url', 'title', 'name', 'role', 'country', 'city', 'summary', 'quote', 'image', 'note'].forEach(k => { f(k).value = x ? x[k] || '' : ''; });
        f('show').checked = x ? x.show !== false : true;
        const chips = () => {
            wrap.querySelector('[data-chips]').innerHTML = chosen.length ? chosen.map(c => '<span style="display:inline-flex;align-items:center;gap:6px;background:#e6f0f8;color:#002F4C;border-radius:8px;padding:4px 8px;font-size:12px">'
                + esc(byId[c] ? byId[c].title : c) + (byId[c] ? ' <span style="color:#4a6b82">· ' + esc(byId[c].provider) + '</span>' : '') + '<button data-rm="' + esc(c) + '" aria-label="Remove" style="border:none;background:none;cursor:pointer;color:#4a6b82;font-size:14px;line-height:1">&times;</button></span>').join('')
                : '<span style="font-size:12px;color:#94a3b8">None yet</span>';
            wrap.querySelectorAll('[data-rm]').forEach(b => { b.onclick = () => { chosen = chosen.filter(c => c !== b.getAttribute('data-rm')); chips(); }; });
        };
        chips();
        f('course').addEventListener('input', () => {
            const c = byTitle[f('course').value.trim().toLowerCase()];
            if (c) { if (!chosen.includes(c.id)) chosen.push(c.id); f('course').value = ''; chips(); }
        });
        wrap.querySelector('[data-act="read"]').onclick = async () => {
            const msg = wrap.querySelector('[data-read]'); msg.textContent = 'Reading…';
            const r = await this.lsReadLink(f('url').value.trim());
            if (!r || !r.title) { msg.textContent = 'Could not read that page. Fill in the fields by hand.'; return; }
            if (!f('title').value) f('title').value = r.title;
            if (!f('summary').value) f('summary').value = r.summary;
            if (r.image) f('image').value = r.image;
            const added = r.courses.filter(c => !chosen.includes(c)); chosen = chosen.concat(added); chips();
            msg.textContent = 'Filled in from the page' + (added.length ? '; ' + added.length + ' course' + (added.length === 1 ? '' : 's') + ' suggested from the title and summary. Check them.' : '. Add the courses the story mentions.');
        };
        const close = () => wrap.remove();
        wrap.querySelector('[data-act="cancel"]').onclick = close;
        const del = wrap.querySelector('[data-act="delete"]'); if (del) del.onclick = async () => { if (await this.lsDeleteStory(id)) { close(); if (done) done(); } };
        wrap.querySelector('[data-act="ok"]').onclick = async () => {
            if (!f('title').value.trim()) { alert('Give the story a title.'); f('title').focus(); return; }
            if (!chosen.length) { alert('Add at least one course the story mentions.'); f('course').focus(); return; }
            const vals = { courses: chosen, show: f('show').checked };
            ['url', 'title', 'name', 'role', 'country', 'city', 'summary', 'quote', 'image', 'note'].forEach(k => { vals[k] = f(k).value; });
            const nid = await this.lsSaveStory(vals, id); if (!nid) return;
            close(); this.showMsg((x ? 'Story saved' : 'Story added') + '. It goes onto the partner dashboards with the next publish.');
            if (done) done();
        };
        document.body.appendChild(wrap);
        setTimeout(() => f(x ? 'title' : 'url').focus(), 50);
    },
});
