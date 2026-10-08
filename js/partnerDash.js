// ── Partner dashboards: each provider's web report, online, behind a password ─────────
//
// Providers you switch on get their full web report (_buildDarkReportHtml) at a link of
// their own, rebuilt every night after the background sync, so it is never more than a
// day old. Built to cost nothing and need no server:
//
//   • HOSTING: a GitHub repository served by GitHub Pages, under a GSF subdomain (one
//     CNAME record). Every publish replaces the branch with ONE fresh commit (no parent,
//     force-updated), so the repository stays the size of a single snapshot instead of
//     growing by every night's 34 reports.
//   • PROTECTION: each report is encrypted in the app (AES-GCM, key from the provider's
//     password via PBKDF2-SHA256) and published as a small page that asks for the
//     password and decrypts itself in the browser. The repository can therefore be
//     public: it holds only ciphertext under random paths. Passwords are long and random
//     (16 characters, ~79 bits), so the public ciphertext cannot be guessed open.
//   • NOTHING LEAVES THIS MAC but the encrypted pages. The GitHub token and the list of
//     links and passwords are device-local (settings/partner_dash*.json are not in the
//     storage reverse map, so they are never enumerated, pushed to Sheets, exported or
//     restored).
//
// What a report shows: all-time figures with monthly charts through the last full month,
// every course of the provider, no feedback date filter — whatever the Reports tab is set
// to at the time, the dashboards are built with these and the settings are put back.
Object.assign(window.App, {

    PD_KEY: 'surgdash_partner_dash',
    PD_TOKEN_KEY: 'surgdash_partner_dash_token',
    PD_ITER: 250000,
    PD_PW_ALPHABET: 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789',   // no 0/O, 1/l/I
    PD_SLUG_ALPHABET: 'abcdefghijklmnopqrstuvwxyz0123456789',
    PD_TEAM_SLUG: 'team',   // GSF's own page: every provider, one password

    _pdDefaults() { return { repo: '', branch: 'main', baseUrl: '', providers: {}, lastPublish: null }; },
    async _pdLoad() {
        if (this._pd) return this._pd;
        let v = null; try { v = await Storage.getItem(this.PD_KEY); } catch (e) { __swallowed(e, 'pd.load'); }
        this._pd = Object.assign(this._pdDefaults(), (v && typeof v === 'object') ? v : {});
        if (!this._pd.providers || typeof this._pd.providers !== 'object') this._pd.providers = {};
        // Links were random (/p/<22 characters>/) at first; they are readable now (/wfsa/).
        let moved = false;
        Object.keys(this._pd.providers).forEach(prov => {
            const p = this._pd.providers[prov];
            if (p && p.slug && /^[a-z0-9]{22}$/.test(p.slug)) { p.slug = this._pdNiceSlug(prov, prov); p.published = null; moved = true; }
        });
        if (moved) await this._pdSave();
        return this._pd;
    },

    // A readable address: the acronym a LearnWorlds name starts with ("WFSA - World …" → wfsa),
    // else the report folder name ("ALL SAFE" → all-safe). Unique among the providers.
    _pdSlugify(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, ''); },
    _pdNiceSlug(prov, self) {
        const acro = (String(prov).match(/^\s*([A-Z0-9]{2,10})\s*-\s*\S/) || [])[1];
        let base = this._pdSlugify(acro || (this.providerFolderName ? this.providerFolderName(prov) : prov)) || 'provider';
        if (base.length > 32) base = base.slice(0, 33).replace(/-[^-]*$/, '');   // whole words, ~32 characters
        const taken = new Set(Object.keys((this._pd && this._pd.providers) || {}).filter(k => k !== self).map(k => this._pd.providers[k].slug).filter(Boolean));
        taken.add(this.PD_TEAM_SLUG);
        let slug = base;
        for (let n = 2; taken.has(slug); n++) slug = base + '-' + n;
        return slug;
    },
    async _pdSave() { try { await Storage.setItem(this.PD_KEY, this._pd, { internal: true }); } catch (e) { __swallowed(e, 'pd.save'); } },
    async _pdToken() { try { return String((await Storage.getItem(this.PD_TOKEN_KEY)) || '').trim(); } catch (e) { return ''; } },

    _pdRandom(n, alphabet) {
        const out = [], max = 256 - (256 % alphabet.length);
        while (out.length < n) {
            const buf = crypto.getRandomValues(new Uint8Array(n * 2));
            for (const b of buf) { if (b < max && out.length < n) out.push(alphabet[b % alphabet.length]); }   // no modulo bias
        }
        return out.join('');
    },
    _pdNewPassword() { const s = this._pdRandom(16, this.PD_PW_ALPHABET); return s.match(/.{4}/g).join('-'); },

    _pdB64(bytes) { let s = ''; const u = new Uint8Array(bytes); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); },
    // Text (the report page) or bytes (the PDF and workbooks), same scheme.
    async _pdEncrypt(input, password) {
        const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
        const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
        const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: this.PD_ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
        const plain = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
        const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
        return { s: this._pdB64(salt), i: this._pdB64(iv), n: this.PD_ITER, d: this._pdB64(data) };
    },

    // ── the files a provider can download from its page ──
    // The same three the report package holds: the PDF report (with the cover and back
    // pages, if set) and the anonymised learner and feedback workbooks.
    async _pdPdfBytes(provider) {
        const html = await this._buildReportHtml(provider);
        if (!html) return null;
        const tmp = electronAPI.path.join(electronAPI.os.tmpdir(), 'surghub_pd_' + Date.now() + '_' + this._pdRandom(6, this.PD_SLUG_ALPHABET) + '.pdf');
        const r = await electronAPI.invoke('generate-pdf', { html, outputPath: tmp });
        if (!r || !r.success) throw new Error('PDF: ' + ((r && r.error) || 'not generated'));
        let file = tmp;
        if (this.reportCoverPath || this.reportBackPath) {
            const merged = tmp.replace(/\.pdf$/, '_full.pdf');
            const m = await electronAPI.invoke('merge-pdfs', { reportPdfPath: tmp, coverPath: this.reportCoverPath || null, backPath: this.reportBackPath || null, outputPath: merged });
            if (m && m.success) file = merged;
        }
        try { return new Uint8Array(electronAPI.fs.readFileSync(file)); }
        finally { [tmp, file].forEach(f => { try { if (electronAPI.fs.existsSync(f)) electronAPI.fs.unlinkSync(f); } catch (e) { __swallowed(e, 'pd.tmp'); } }); }
    },
    _pdWorkbookBytes(wb) { return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' })); },
    async _pdAttachments(provider, anonUsers, notes) {
        const folder = this.providerFolderName ? this.providerFolderName(provider) : provider;
        const name = (kind, ext) => this.reportFileName ? this.reportFileName(kind, folder, ext) : kind + '.' + ext;
        const XL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        const out = [];
        const add = async (label, kind, ext, mime, make) => {
            try { const bytes = await make(); if (bytes && bytes.length) out.push({ label, name: name(kind, ext), mime, bytes }); }
            catch (e) { if (notes) notes.push(provider + ' ' + label + ': ' + String((e && e.message) || e)); }
        };
        await add('Report (PDF)', 'Report', 'pdf', 'application/pdf', () => this._pdPdfBytes(provider));
        await add('Learners (Excel)', 'Users', 'xlsx', XL, () => { const wb = this._buildUsersWorkbook(provider, anonUsers); return wb ? this._pdWorkbookBytes(wb) : null; });
        await add('Feedback (Excel)', 'Feedback', 'xlsx', XL, async () => { const wb = await this._buildFeedbackWorkbook(provider); return wb ? this._pdWorkbookBytes(wb) : null; });
        return out;
    },
    // A small bar in the corner of the report: each button fetches its encrypted file,
    // decrypts it with the password the page was opened with, and saves it under its name.
    _pdDownloadsHtml(manifest) {
        if (!manifest || !manifest.length) return '';
        const esc = (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        return '<div id="sh-dl" style="position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 12px;border-radius:12px;background:#0b2233;border:1px solid #1d3a4f;box-shadow:0 6px 24px rgba(0,0,0,.35);font:13px Arial,Helvetica,sans-serif;color:#9fb3c8">'
            + '<span style="font-weight:700;color:#eef4f9;margin-right:4px">Downloads</span>'
            + manifest.map((f, i) => '<button data-i="' + i + '" title="' + esc(f.name) + '" style="padding:7px 10px;border:0;border-radius:8px;background:#FFC145;color:#002F4C;font-weight:700;font-size:12px;cursor:pointer">' + esc(f.label) + '</button>').join('')
            + '<span id="sh-dl-msg" style="min-width:0"></span></div>'
            + '<script>(function(){var F=' + JSON.stringify(manifest.map(f => ({ name: f.name, file: f.file, mime: f.mime }))).replace(/</g, '\\u003c') + ';var K="surghub-report:"+location.pathname;'
            + 'function b(s){var x=atob(s),u=new Uint8Array(x.length);for(var i=0;i<x.length;i++)u[i]=x.charCodeAt(i);return u}'
            + 'function dec(P,pw){return crypto.subtle.importKey("raw",new TextEncoder().encode(pw),"PBKDF2",false,["deriveKey"]).then(function(k){'
            + 'return crypto.subtle.deriveKey({name:"PBKDF2",salt:b(P.s),iterations:P.n,hash:"SHA-256"},k,{name:"AES-GCM",length:256},false,["decrypt"])}).then(function(key){'
            + 'return crypto.subtle.decrypt({name:"AES-GCM",iv:b(P.i)},key,b(P.d))})}'
            + 'function pw(){var p=window.__shPw;if(!p){try{p=localStorage.getItem(K)}catch(x){}}if(!p)p=window.prompt("Password for this report");if(p)window.__shPw=p;return p}'
            + 'var bar=document.getElementById("sh-dl"),m=document.getElementById("sh-dl-msg");'
            + 'bar.addEventListener("click",function(ev){var t=ev.target&&ev.target.closest?ev.target.closest("button[data-i]"):null;if(!t)return;var f=F[+t.getAttribute("data-i")],p=pw();if(!f||!p)return;'
            + 'm.textContent="Preparing\\u2026";fetch(f.file,{cache:"no-store"}).then(function(r){if(!r.ok)throw new Error(r.status);return r.text()}).then(function(txt){return dec(JSON.parse(txt),p)})'
            + '.then(function(buf){var a=document.createElement("a");a.href=URL.createObjectURL(new Blob([buf],{type:f.mime}));a.download=f.name;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},2000);m.textContent=""})'
            + '.catch(function(){m.textContent="Could not open the file."})});'
            + '})();<\/script>';
    },
    _pdInject(html, extra) {
        if (!extra) return html;
        const i = html.lastIndexOf('</body>');
        return i >= 0 ? html.slice(0, i) + extra + html.slice(i) : html + extra;
    },

    // The page a provider opens: asks for the password, decrypts in the browser and
    // replaces itself with the report. "Remember on this device" keeps the password in
    // this browser only (localStorage, per page), so the provider types it once.
    _pdPageHtml(payload, heading, prompt) {
        heading = heading || 'SURGhub partner report'; prompt = prompt || 'Enter the password you received with this link.';
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            + '<meta name="robots" content="noindex,nofollow,noarchive"><title>' + heading + '</title>'
            + '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#001523;color:#eef4f9;font:16px/1.5 Arial,Helvetica,sans-serif}'
            + '.box{width:min(380px,90vw);padding:32px;border-radius:16px;background:#0b2233;border:1px solid #1d3a4f}h1{margin:0 0 6px;font-size:20px}p{margin:0 0 18px;color:#9fb3c8;font-size:14px}'
            + 'input[type=password]{box-sizing:border-box;width:100%;padding:11px 12px;border-radius:10px;border:1px solid #2c4a60;background:#001523;color:#eef4f9;font-size:15px}'
            + 'button{margin-top:14px;width:100%;padding:11px;border:0;border-radius:10px;background:#FFC145;color:#002F4C;font-weight:700;font-size:15px;cursor:pointer}'
            + 'label{display:flex;gap:8px;align-items:center;margin-top:12px;font-size:13px;color:#9fb3c8}.err{min-height:20px;margin-top:10px;color:#ff8a80;font-size:13px}</style></head>'
            + '<body><form class="box" id="f"><h1>' + heading + '</h1><p>' + prompt + '</p>'
            + '<input type="password" id="pw" autocomplete="current-password" autofocus placeholder="Password">'
            + '<label><input type="checkbox" id="rm" checked> Remember on this device</label>'
            + '<button type="submit" id="go">Open report</button><div class="err" id="err"></div></form>'
            + '<script>(function(){var P=' + JSON.stringify(payload) + ';var K="surghub-report:"+location.pathname;'
            + 'function b(s){var x=atob(s),u=new Uint8Array(x.length);for(var i=0;i<x.length;i++)u[i]=x.charCodeAt(i);return u}'
            + 'function open(pw){return crypto.subtle.importKey("raw",new TextEncoder().encode(pw),"PBKDF2",false,["deriveKey"]).then(function(k){'
            + 'return crypto.subtle.deriveKey({name:"PBKDF2",salt:b(P.s),iterations:P.n,hash:"SHA-256"},k,{name:"AES-GCM",length:256},false,["decrypt"])}).then(function(key){'
            + 'return crypto.subtle.decrypt({name:"AES-GCM",iv:b(P.i)},key,b(P.d))}).then(function(buf){return new TextDecoder().decode(buf)})}'
            + 'function show(h){document.open();document.write(h);document.close()}'
            + 'var f=document.getElementById("f"),e=document.getElementById("err"),g=document.getElementById("go");'
            + 'f.addEventListener("submit",function(ev){ev.preventDefault();var pw=document.getElementById("pw").value.trim();if(!pw)return;g.disabled=true;e.textContent="Opening\\u2026";'
            + 'open(pw).then(function(h){try{if(document.getElementById("rm").checked)localStorage.setItem(K,pw);else localStorage.removeItem(K)}catch(x){}window.__shPw=pw;show(h)})'
            + '.catch(function(){g.disabled=false;e.textContent="That password does not open this report."})});'
            + 'try{var s=localStorage.getItem(K);if(s){e.textContent="Opening\\u2026";open(s).then(function(h){window.__shPw=s;show(h)}).catch(function(){try{localStorage.removeItem(K)}catch(x){}e.textContent=""})}}catch(x){}'
            + '})();<\/script></body></html>';
    },
    // The team page, once decrypted: every published provider with its link. It also
    // remembers each provider's password in this browser (the same localStorage key the
    // provider pages use), so from here every report opens without a password prompt.
    _pdTeamHtml(list) {
        const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const at = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
        const rows = list.map(x => '<a class="row" href="/' + esc(x.slug) + '/" data-k="' + esc((x.name + ' ' + x.slug).toLowerCase()) + '"><span class="n">' + esc(x.name) + '</span><span class="s">/' + esc(x.slug) + '/</span></a>').join('');
        const pw = {}; list.forEach(x => { pw[x.slug] = x.password; });
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>SURGhub reports · GSF team</title>'
            + '<style>body{margin:0;background:#001523;color:#eef4f9;font:15px/1.5 Arial,Helvetica,sans-serif}.w{max-width:760px;margin:0 auto;padding:40px 20px}'
            + 'h1{margin:0 0 4px;font-size:24px}p{margin:0 0 18px;color:#9fb3c8;font-size:13px}input{box-sizing:border-box;width:100%;padding:11px 12px;margin-bottom:14px;border-radius:10px;border:1px solid #2c4a60;background:#0b2233;color:#eef4f9;font-size:15px}'
            + '.row{display:flex;justify-content:space-between;gap:12px;padding:12px 14px;margin-bottom:6px;border-radius:10px;background:#0b2233;border:1px solid #1d3a4f;color:#eef4f9;text-decoration:none}.row:hover{border-color:#FFC145}'
            + '.n{font-weight:700}.s{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#9fb3c8;white-space:nowrap}</style></head>'
            + '<body><div class="w"><h1>SURGhub partner reports</h1><p>' + list.length + ' provider' + (list.length === 1 ? '' : 's') + ' · published ' + esc(at) + '. Reports open from here without their passwords, in this browser.</p>'
            + '<input id="q" type="search" placeholder="Find a provider" autofocus>' + rows + '</div>'
            + '<script>(function(){var P=' + JSON.stringify(pw).replace(/</g, '\\u003c') + ';try{Object.keys(P).forEach(function(s){localStorage.setItem("surghub-report:/"+s+"/",P[s]);localStorage.setItem("surghub-report:/"+s+"/index.html",P[s])})}catch(x){}'
            + 'var q=document.getElementById("q");q.addEventListener("input",function(){var v=q.value.toLowerCase().trim();[].forEach.call(document.querySelectorAll(".row"),function(r){r.style.display=!v||r.getAttribute("data-k").indexOf(v)>=0?"":"none"})})})();<\/script></body></html>';
    },
    _pdLandingHtml() {
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow,noarchive"><title>SURGhub partner reports</title>'
            + '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#001523;color:#9fb3c8;font:16px/1.5 Arial,Helvetica,sans-serif}</style></head>'
            + '<body><p>SURGhub partner reports. Please use the link you were sent.</p></body></html>';
    },

    _pdUrl(slug) {
        const base = String((this._pd && this._pd.baseUrl) || '').replace(/\/+$/, '');
        return base ? base + '/' + slug + '/' : '';
    },

    // Providers that can have a dashboard: everyone with an included course.
    _pdProviders() {
        const snap = this._withAllCourses ? this._withAllCourses(() => this.getAnalyticsSnap()) : this.getAnalyticsSnap();
        return [...new Set(snap.map(d => d.Provider).filter(p => p && !/^Unknown/i.test(p)))].sort((a, b) => a.localeCompare(b));
    },
    _pdEnabled() { return Object.keys((this._pd && this._pd.providers) || {}).filter(p => this._pd.providers[p] && this._pd.providers[p].enabled); },
    async _pdReady() {
        const s = await this._pdLoad();
        if (!this._pdEnabled().length) return { ok: false, why: 'no provider switched on' };
        if (!/^[\w.-]+\/[\w.-]+$/.test(s.repo || '')) return { ok: false, why: 'no GitHub repository set' };
        if (!/^https:\/\/[^/]+/.test(s.baseUrl || '')) return { ok: false, why: 'no web address set' };
        if (!(await this._pdToken())) return { ok: false, why: 'no GitHub token on this Mac' };
        return { ok: true };
    },

    // ── changes from the panel ──
    async pdSetEnabled(provider, on) {
        const s = await this._pdLoad();
        const p = s.providers[provider] || (s.providers[provider] = {});
        p.enabled = !!on;
        if (on && !p.slug) p.slug = this._pdNiceSlug(provider, provider);
        if (on && !p.password) p.password = this._pdNewPassword();
        await this._pdSave(); this._pdRerender();
    },
    // The tick in the table header: every provider on, or every provider off.
    async pdSetAllEnabled(on) {
        const s = await this._pdLoad();
        this._pdProviders().forEach(prov => {
            const p = s.providers[prov] || (s.providers[prov] = {});
            p.enabled = !!on;
            if (on && !p.slug) p.slug = this._pdNiceSlug(prov, prov);
            if (on && !p.password) p.password = this._pdNewPassword();
        });
        await this._pdSave(); this._pdRerender();
    },
    // Shorten or change an address. The old one stops working at the next publish.
    async pdSetSlug(provider, value) {
        const s = await this._pdLoad(); const p = s.providers[provider]; if (!p) return;
        const slug = this._pdSlugify(value);
        if (!slug) { alert('An address needs at least one letter or digit.'); this._pdRerender(); return; }
        if (slug === this.PD_TEAM_SLUG) { alert('"' + slug + '" is the address of your own team page.'); this._pdRerender(); return; }
        if (Object.keys(s.providers).some(k => k !== provider && s.providers[k].slug === slug)) { alert('"' + slug + '" is already used by another provider.'); this._pdRerender(); return; }
        if (slug === p.slug) return;
        p.slug = slug; p.published = null; await this._pdSave(); this._pdRerender();
    },
    async pdNewPassword(provider) {
        if (!confirm('Give ' + provider + ' a new password?\n\nThe old password stops working at the next publish. Send them the new one.')) return;
        const s = await this._pdLoad(); const p = s.providers[provider]; if (!p) return;
        p.password = this._pdNewPassword(); p.published = null; await this._pdSave(); this._pdRerender();
    },
    async pdSetSetting(field, value) {
        const s = await this._pdLoad();
        if (field === 'repo') s.repo = String(value || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
        else if (field === 'baseUrl') { let v = String(value || '').trim().replace(/\/+$/, ''); if (v && !/^https?:\/\//.test(v)) v = 'https://' + v; s.baseUrl = v; }
        else if (field === 'branch') s.branch = String(value || '').trim() || 'main';
        else return;
        await this._pdSave(); this._pdRerender();
    },
    async pdSetToken(value) {
        const v = String(value || '').trim();
        if (!v) return;
        await Storage.setItem(this.PD_TOKEN_KEY, v, { internal: true });
        this.showMsg('GitHub token saved on this Mac only.'); this._pdRerender();
    },
    _pdRerender() { if (this.view === 'sh-reports' && this.renderView) this.renderView(); },
    _pdMessage(provider) {
        const s = this._pd, p = s.providers[provider];
        return 'Dear colleagues,\n\nYour SURGhub course report is now online and updates itself every night:\n\n'
            + this._pdUrl(p.slug) + '\n\nPassword: ' + p.password + '\n\n'
            + 'The page asks for the password once per browser. It shows all your courses on SURGhub, with charts through the last full month. Please keep the link and password within your team.\n\nBest regards,\n';
    },
    async pdCopy(provider, btn) {
        await this._pdLoad();
        const t = this._pdMessage(provider);
        try { await navigator.clipboard.writeText(t); if (btn) { const l = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = l; }, 1800); } }
        catch (e) { alert(t); }
    },
    _pdOpenUrl(url) { if (!url) return; try { if (window.electronAPI && electronAPI.openExternal) electronAPI.openExternal(url); else window.open(url); } catch (e) { __swallowed(e, 'pd.open'); } },
    async pdOpen(provider) { const s = await this._pdLoad(); const p = s.providers[provider]; if (p && p.slug) this._pdOpenUrl(this._pdUrl(p.slug)); },
    async pdOpenTeam() { await this._pdLoad(); this._pdOpenUrl(this._pdUrl(this.PD_TEAM_SLUG)); },
    async pdCopyTeam(btn) {
        const s = await this._pdLoad(); if (!s.teamPassword) return;
        try { await navigator.clipboard.writeText(s.teamPassword); if (btn) { const l = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = l; }, 1800); } } catch (e) { alert(s.teamPassword); }
    },
    async pdNewTeamPassword() {
        if (!confirm('Give the team page a new password?\n\nThe old one stops working at the next publish.')) return;
        const s = await this._pdLoad(); s.teamPassword = this._pdNewPassword(); s.teamPublished = null; await this._pdSave(); this._pdRerender();
    },
    // A "Partner dashboard" button for the provider and course pages, once that provider's page is live.
    _pdButtonHtml(provider) {
        if (this._pd === undefined) { this._pd = null; this._pdLoad().then(() => this._pdTokenSet()).then(() => { if (this._pdEnabled().length && this.renderView) this.renderView(); }); return ''; }
        const s = this._pd, p = s && provider && s.providers[provider];
        if (!p || !p.enabled || !p.slug || !s.baseUrl || !(p.published && p.published.slug === p.slug)) return '';
        const pe = this.escapeJsArg(provider);
        return '<span data-edit-only class="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-bold overflow-hidden">'
            + '<button onclick="App.pdOpen(\'' + pe + '\')" class="flex items-center gap-1.5 px-3 py-2 hover:bg-emerald-100" title="Open ' + this.escapeHtml(this._pdUrl(p.slug)) + ' in your browser"><i data-lucide="globe" width="14"></i> Partner dashboard</button>'
            + '<button onclick="App.pdCopy(\'' + pe + '\', this)" class="px-2.5 py-2 border-l border-emerald-200 hover:bg-emerald-100 font-medium" title="Copy the link and password, ready to send">Copy</button></span>';
    },
    async pdEmail(provider) {
        await this._pdLoad();
        const href = 'mailto:?subject=' + encodeURIComponent('Your SURGhub course report, online') + '&body=' + encodeURIComponent(this._pdMessage(provider));
        try { if (window.electronAPI && electronAPI.openExternal) electronAPI.openExternal(href); else window.open(href); } catch (e) { __swallowed(e, 'pd.mail'); }
    },

    // ── building and publishing ──
    // Build every switched-on provider's page with the dashboard settings, putting the
    // user's report settings back afterwards whatever happens.
    async _pdBuildFiles(opts) {
        opts = opts || {};
        const s = await this._pdLoad();
        const keep = { from: this.reportPeriodFrom, to: this.reportPeriodTo, through: this.reportDataThrough, fb: this.reportFeedbackFromDate, low: this.hideLowLearners, priv: this.hidePrivateCourses };
        const files = [], built = [], failed = [];
        try {
            this.reportPeriodFrom = ''; this.reportPeriodTo = ''; this.reportFeedbackFromDate = '';
            this.reportDataThrough = this._lastFullMonth ? this._lastFullMonth() : '';
            this.hideLowLearners = false; this.hidePrivateCourses = false;
            const list = this._pdEnabled();
            let anonUsers = [];
            try { anonUsers = (this._getAnonUsers ? await this._getAnonUsers() : []) || []; } catch (e) { __swallowed(e, 'pd.anon'); }
            for (let i = 0; i < list.length; i++) {
                const prov = list[i], p = s.providers[prov];
                if (opts.progress) opts.progress('Partner dashboards: ' + (i + 1) + '/' + list.length + ' — ' + prov);
                try {
                    if (!p.slug) p.slug = this._pdNiceSlug(prov, prov);
                    if (!p.password) p.password = this._pdNewPassword();
                    let html = await this._buildDarkReportHtml(prov);
                    if (!html) { failed.push(prov + ': no data'); continue; }
                    // The downloads: each encrypted with the provider's password under a random name.
                    const manifest = [];
                    for (const a of await this._pdAttachments(prov, anonUsers, failed)) {
                        const file = this._pdRandom(16, this.PD_SLUG_ALPHABET) + '.bin';
                        files.push({ path: p.slug + '/' + file, content: JSON.stringify(await this._pdEncrypt(a.bytes, p.password)) });
                        manifest.push({ label: a.label, name: a.name, mime: a.mime, file });
                    }
                    html = this._pdInject(html, this._pdDownloadsHtml(manifest));
                    files.push({ path: p.slug + '/index.html', content: this._pdPageHtml(await this._pdEncrypt(html, p.password)) });
                    built.push(prov);
                } catch (e) { failed.push(prov + ': ' + String((e && e.message) || e)); }
            }
        } finally {
            this.reportPeriodFrom = keep.from; this.reportPeriodTo = keep.to; this.reportDataThrough = keep.through;
            this.reportFeedbackFromDate = keep.fb; this.hideLowLearners = keep.low; this.hidePrivateCourses = keep.priv;
        }
        if (built.length) {
            if (!s.teamPassword) s.teamPassword = this._pdNewPassword();
            const list = built.map(prov => ({ name: this.providerFolderName ? this.providerFolderName(prov) : prov, slug: s.providers[prov].slug, password: s.providers[prov].password }))
                .sort((a, b) => a.name.localeCompare(b.name));
            files.push({ path: this.PD_TEAM_SLUG + '/index.html', content: this._pdPageHtml(await this._pdEncrypt(this._pdTeamHtml(list), s.teamPassword), 'SURGhub reports · GSF team', 'Enter the team password.') });
        }
        const host = (String(s.baseUrl || '').match(/^https?:\/\/([^/]+)/) || [])[1] || '';
        files.push({ path: 'index.html', content: this._pdLandingHtml() });
        files.push({ path: '404.html', content: this._pdLandingHtml() });
        files.push({ path: 'robots.txt', content: 'User-agent: *\nDisallow: /\n' });
        files.push({ path: '.nojekyll', content: '' });
        if (host && !/\.github\.io$/i.test(host)) files.push({ path: 'CNAME', content: host + '\n' });
        return { files, built, failed };
    },

    async _pdGh(method, path, body, token) {
        const s = this._pd;
        const res = await electronAPI.invoke('http-request', {
            url: 'https://api.github.com/repos/' + s.repo + path, method,
            headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'SURGdash', 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined, timeoutMs: 120000,
        });
        let json = null; try { json = res && res.body ? JSON.parse(res.body) : null; } catch (e) { json = null; }
        const status = res ? res.statusCode : 0;
        if (!res || res.error || status < 200 || status >= 300) {
            const err = new Error('GitHub ' + method + ' ' + path.split('?')[0] + ': ' + (status || '') + ' ' + ((json && json.message) || (res && res.error) || 'no response'));
            err.status = status; throw err;
        }
        return json;
    },

    async publishPartnerDashboards(opts) {
        opts = opts || {};
        const ready = await this._pdReady();
        if (!ready.ok) { if (!opts.silent) alert('Partner dashboards are not ready: ' + ready.why + '.'); return { ok: false, note: 'skipped — ' + ready.why }; }
        const s = this._pd, token = await this._pdToken(), branch = s.branch || 'main';
        try {
            const { files, built, failed } = await this._pdBuildFiles(opts);
            if (!built.length) throw new Error('no report could be built' + (failed.length ? ' (' + failed.join('; ') + ')' : ''));
            if (opts.progress) opts.progress('Partner dashboards: uploading ' + built.length + ' report' + (built.length === 1 ? '' : 's') + '…');
            const blob = (content) => this._pdGh('POST', '/git/blobs', { content, encoding: 'utf-8' }, token);
            let first;
            try { first = await blob(files[0].content); }
            catch (e) {
                if (e.status !== 409) throw e;   // an empty repository has no git database yet: give it a first commit
                await this._pdGh('PUT', '/contents/README.md', { message: 'Start', content: btoa('SURGhub partner reports, published by SURGdash.\n'), branch }, token);
                first = await blob(files[0].content);
            }
            const tree = [{ path: files[0].path, mode: '100644', type: 'blob', sha: first.sha }];
            for (const f of files.slice(1)) tree.push({ path: f.path, mode: '100644', type: 'blob', sha: (await blob(f.content)).sha });
            const t = await this._pdGh('POST', '/git/trees', { tree }, token);
            const now = new Date().toISOString();
            const c = await this._pdGh('POST', '/git/commits', { message: 'Partner reports ' + now.slice(0, 10), tree: t.sha, parents: [] }, token);
            try { await this._pdGh('PATCH', '/git/refs/heads/' + branch, { sha: c.sha, force: true }, token); }
            catch (e) { if (e.status !== 404 && e.status !== 422) throw e; await this._pdGh('POST', '/git/refs', { ref: 'refs/heads/' + branch, sha: c.sha }, token); }
            built.forEach(p => { s.providers[p].published = { at: now, slug: s.providers[p].slug }; });
            s.teamPublished = { at: now };
            const note = built.length + ' report' + (built.length === 1 ? '' : 's') + ' published' + (failed.length ? ', ' + failed.length + ' failed: ' + failed.join('; ') : '');
            s.lastPublish = { at: now, ok: !failed.length, note };
            await this._pdSave();
            if (!opts.silent) this.showMsg((failed.length ? '⚠ ' : '✓ ') + 'Partner dashboards: ' + note + '. GitHub takes a minute or two to put them live.', !!failed.length);
            this._pdRerender();
            return { ok: !failed.length, note };
        } catch (e) {
            const msg = String((e && e.message) || e);
            s.lastPublish = { at: new Date().toISOString(), ok: false, note: msg };
            await this._pdSave();
            if (!opts.silent) alert('Could not publish the partner dashboards:\n\n' + msg);
            this._pdRerender();
            if (opts.silent) throw e;
            return { ok: false, note: msg };
        }
    },
    async pdPublishNow() {
        this._showReportProgress && this._showReportProgress('Publishing partner dashboards…');
        try { await this.publishPartnerDashboards({ progress: (t) => this._showReportProgress && this._showReportProgress(t) }); }
        finally { this._hideReportProgress && this._hideReportProgress(); }
    },

    // ── the panel on the Reports tab (edit mode only) ──
    _partnerDashHtml() {
        if (this._pd === undefined) { this._pd = null; this._pdLoad().then(() => this._pdTokenSet()).then(() => this._pdRerender()); return ''; }
        const s = this._pd || this._pdDefaults();
        const esc = (t) => this.escapeHtml(String(t == null ? '' : t));
        const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
        const input = (field, value, ph, w) => '<input type="text" value="' + esc(value) + '" placeholder="' + esc(ph) + '" onchange="App.pdSetSetting(\'' + field + '\', this.value)" class="' + w + ' text-xs border rounded px-2 py-1.5 outline-none focus:ring-2 focus:ring-gsf-boston/30">';
        const rows = this._pdProviders().map(prov => {
            const p = s.providers[prov] || {}, on = !!p.enabled, pe = this.escapeJsArg(prov);
            const live = p.published && p.published.slug === p.slug;
            return '<tr class="border-b last:border-0 ' + (on ? '' : 'text-slate-400') + '">'
                + '<td class="py-2 pr-3"><label class="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="App.pdSetEnabled(\'' + pe + '\', this.checked)"> <span class="' + (on ? 'font-semibold text-gsf-prussian' : '') + '">' + esc(this.providerFolderName ? this.providerFolderName(prov) : prov) + '</span></label></td>'
                + '<td class="py-2 pr-3 font-mono text-[11px] whitespace-nowrap">' + (on && p.slug ? (s.baseUrl ? esc(String(s.baseUrl).replace(/^https?:\/\//, '') + '/') + '<input type="text" value="' + esc(p.slug) + '" title="Edit to change the address; the old one stops working at the next publish" onchange="App.pdSetSlug(\'' + pe + '\', this.value)" class="w-40 font-mono text-[11px] border rounded px-1.5 py-0.5 outline-none focus:ring-2 focus:ring-gsf-boston/30">' : '<span class="text-amber-700 font-sans">set the web address first</span>') : '') + '</td>'
                + '<td class="py-2 pr-3 font-mono text-[11px] whitespace-nowrap">' + (on && p.password ? esc(p.password) : '') + '</td>'
                + '<td class="py-2 pr-3 text-[11px] whitespace-nowrap">' + (on ? (live ? '<span class="text-emerald-700">live · ' + esc(when(p.published.at)) + '</span>' : '<span class="text-amber-700">at the next publish</span>') : '') + '</td>'
                + '<td class="py-2 text-right whitespace-nowrap">' + (on && p.slug && s.baseUrl ? (live ? '<button onclick="App.pdOpen(\'' + pe + '\')" class="text-[11px] font-bold text-gsf-boston hover:underline mr-2">Open</button>' : '') + '<button onclick="App.pdCopy(\'' + pe + '\', this)" class="text-[11px] font-bold text-gsf-boston hover:underline mr-2">Copy</button><button onclick="App.pdEmail(\'' + pe + '\')" class="text-[11px] font-bold text-gsf-boston hover:underline mr-2">Email…</button><button onclick="App.pdNewPassword(\'' + pe + '\')" class="text-[11px] text-slate-500 hover:underline" title="If a link and password have gone further than they should: the old password stops working at the next publish">New password</button>' : '') + '</td></tr>';
        }).join('');
        const lp = s.lastPublish;
        const enabled = this._pdEnabled().length;
        const all = this._pdProviders(), allOn = all.length > 0 && all.every(prov => s.providers[prov] && s.providers[prov].enabled);
        return '<div data-edit-only class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">'
            + '<h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide mb-1">Partner Dashboards</h2>'
            + '<p class="text-xs text-slate-400 mb-4 max-w-3xl">Each provider you switch on gets its full web report at a link of its own, behind a password, rebuilt every night after the background sync (Data Sync). Reports show all-time figures with charts through the last full month, with the PDF report and the anonymised learner and feedback workbooks to download. Everything is encrypted on this Mac before upload, so the password is what protects each report; the token and the passwords stay on this Mac. If a link and password go further than they should, give that provider a new password.</p>'
            + '<div class="flex items-center gap-2 flex-wrap mb-4 text-xs">'
            + '<span class="font-bold uppercase tracking-wide text-[10px] text-slate-400">GitHub repository</span>' + input('repo', s.repo, 'owner/repository', 'w-56')
            + '<span class="font-bold uppercase tracking-wide text-[10px] text-slate-400 ml-2">Web address</span>' + input('baseUrl', s.baseUrl, 'https://reports.globalsurgeryfoundation.org', 'w-72')
            + '<span class="font-bold uppercase tracking-wide text-[10px] text-slate-400 ml-2">Token</span><input type="password" placeholder="' + (this._pdHasToken ? 'saved on this Mac — paste to replace' : 'paste a GitHub token') + '" onchange="App.pdSetToken(this.value).then(() => App._pdTokenSet())" class="w-56 text-xs border rounded px-2 py-1.5 outline-none focus:ring-2 focus:ring-gsf-boston/30">'
            + '</div>'
            + (s.teamPassword && s.baseUrl ? '<div class="flex items-center gap-3 flex-wrap mb-4 px-3 py-2.5 rounded-lg bg-slate-50 border text-xs">'
                + '<span class="font-bold text-gsf-prussian">Your team page</span><span class="font-mono text-[11px]">' + esc(this._pdUrl(this.PD_TEAM_SLUG).replace(/^https?:\/\//, '')) + '</span>'
                + '<span class="text-slate-400">password</span><span class="font-mono text-[11px]">' + esc(s.teamPassword) + '</span>'
                + (s.teamPublished ? '<button onclick="App.pdOpenTeam()" class="font-bold text-gsf-boston hover:underline">Open</button>' : '<span class="text-amber-700">at the next publish</span>')
                + '<button onclick="App.pdCopyTeam(this)" class="font-bold text-gsf-boston hover:underline">Copy password</button>'
                + '<button onclick="App.pdNewTeamPassword()" class="text-slate-500 hover:underline">New password</button>'
                + '<span class="text-slate-400">Every provider in one list, for GSF only. Unlocking it once lets that browser open every report without its password.</span></div>' : '')
            + '<div class="overflow-x-auto max-h-[420px] overflow-y-auto custom-scrollbar"><table class="w-full text-left text-xs"><thead class="text-slate-400 sticky top-0 bg-white"><tr><th class="py-2 pr-3 font-medium"><label class="inline-flex items-center gap-2 cursor-pointer" title="Switch every provider on or off"><input type="checkbox" ' + (allOn ? 'checked' : '') + ' onchange="App.pdSetAllEnabled(this.checked)"> Provider</label></th><th class="py-2 pr-3 font-medium">Link</th><th class="py-2 pr-3 font-medium">Password</th><th class="py-2 pr-3 font-medium">Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
            + '<div class="flex items-center gap-3 flex-wrap mt-4">'
            + '<button onclick="App.pdPublishNow()" ' + (enabled ? '' : 'disabled') + ' class="px-4 py-2 rounded-lg text-sm font-bold ' + (enabled ? 'bg-gsf-prussian text-white hover:bg-slate-900' : 'bg-slate-100 text-slate-400 cursor-not-allowed') + '">Publish now</button>'
            + '<span class="text-xs ' + (lp ? (lp.ok ? 'text-emerald-700' : 'text-amber-700') : 'text-slate-400') + '">' + (lp ? 'Last publish ' + esc(when(lp.at)) + ': ' + esc(lp.note) : enabled + ' switched on · not published yet') + '</span>'
            + '</div></div>';
    },
    async _pdTokenSet() { this._pdHasToken = !!(await this._pdToken()); },
});
