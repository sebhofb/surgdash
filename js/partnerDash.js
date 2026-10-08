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

    _pdDefaults() { return { repo: '', branch: 'main', baseUrl: '', providers: {}, lastPublish: null }; },
    async _pdLoad() {
        if (this._pd) return this._pd;
        let v = null; try { v = await Storage.getItem(this.PD_KEY); } catch (e) { __swallowed(e, 'pd.load'); }
        this._pd = Object.assign(this._pdDefaults(), (v && typeof v === 'object') ? v : {});
        if (!this._pd.providers || typeof this._pd.providers !== 'object') this._pd.providers = {};
        return this._pd;
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
    _pdNewSlug() { return this._pdRandom(22, this.PD_SLUG_ALPHABET); },
    _pdNewPassword() { const s = this._pdRandom(16, this.PD_PW_ALPHABET); return s.match(/.{4}/g).join('-'); },

    _pdB64(bytes) { let s = ''; const u = new Uint8Array(bytes); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); },
    async _pdEncrypt(text, password) {
        const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
        const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
        const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: this.PD_ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
        const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
        return { s: this._pdB64(salt), i: this._pdB64(iv), n: this.PD_ITER, d: this._pdB64(data) };
    },

    // The page a provider opens: asks for the password, decrypts in the browser and
    // replaces itself with the report. "Remember on this device" keeps the password in
    // this browser only (localStorage, per page), so the provider types it once.
    _pdPageHtml(payload) {
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            + '<meta name="robots" content="noindex,nofollow,noarchive"><title>SURGhub partner report</title>'
            + '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#001523;color:#eef4f9;font:16px/1.5 Arial,Helvetica,sans-serif}'
            + '.box{width:min(380px,90vw);padding:32px;border-radius:16px;background:#0b2233;border:1px solid #1d3a4f}h1{margin:0 0 6px;font-size:20px}p{margin:0 0 18px;color:#9fb3c8;font-size:14px}'
            + 'input[type=password]{box-sizing:border-box;width:100%;padding:11px 12px;border-radius:10px;border:1px solid #2c4a60;background:#001523;color:#eef4f9;font-size:15px}'
            + 'button{margin-top:14px;width:100%;padding:11px;border:0;border-radius:10px;background:#FFC145;color:#002F4C;font-weight:700;font-size:15px;cursor:pointer}'
            + 'label{display:flex;gap:8px;align-items:center;margin-top:12px;font-size:13px;color:#9fb3c8}.err{min-height:20px;margin-top:10px;color:#ff8a80;font-size:13px}</style></head>'
            + '<body><form class="box" id="f"><h1>SURGhub partner report</h1><p>Enter the password you received with this link.</p>'
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
            + 'open(pw).then(function(h){try{if(document.getElementById("rm").checked)localStorage.setItem(K,pw);else localStorage.removeItem(K)}catch(x){}show(h)})'
            + '.catch(function(){g.disabled=false;e.textContent="That password does not open this report."})});'
            + 'try{var s=localStorage.getItem(K);if(s){e.textContent="Opening\\u2026";open(s).then(show).catch(function(){try{localStorage.removeItem(K)}catch(x){}e.textContent=""})}}catch(x){}'
            + '})();<\/script></body></html>';
    },
    _pdLandingHtml() {
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow,noarchive"><title>SURGhub partner reports</title>'
            + '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#001523;color:#9fb3c8;font:16px/1.5 Arial,Helvetica,sans-serif}</style></head>'
            + '<body><p>SURGhub partner reports. Please use the link you were sent.</p></body></html>';
    },

    _pdUrl(slug) {
        const base = String((this._pd && this._pd.baseUrl) || '').replace(/\/+$/, '');
        return base ? base + '/p/' + slug + '/' : '';
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
        if (on && !p.slug) p.slug = this._pdNewSlug();
        if (on && !p.password) p.password = this._pdNewPassword();
        await this._pdSave(); this._pdRerender();
    },
    async pdNewLink(provider) {
        if (!confirm('Give ' + provider + ' a new link?\n\nThe old link stops working at the next publish. Send them the new one.')) return;
        const s = await this._pdLoad(); const p = s.providers[provider]; if (!p) return;
        p.slug = this._pdNewSlug(); p.published = null; await this._pdSave(); this._pdRerender();
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
            for (let i = 0; i < list.length; i++) {
                const prov = list[i], p = s.providers[prov];
                if (opts.progress) opts.progress('Partner dashboards: ' + (i + 1) + '/' + list.length + ' — ' + prov);
                try {
                    if (!p.slug) p.slug = this._pdNewSlug();
                    if (!p.password) p.password = this._pdNewPassword();
                    const html = await this._buildDarkReportHtml(prov);
                    if (!html) { failed.push(prov + ': no data'); continue; }
                    files.push({ path: 'p/' + p.slug + '/index.html', content: this._pdPageHtml(await this._pdEncrypt(html, p.password)) });
                    built.push(prov);
                } catch (e) { failed.push(prov + ': ' + String((e && e.message) || e)); }
            }
        } finally {
            this.reportPeriodFrom = keep.from; this.reportPeriodTo = keep.to; this.reportDataThrough = keep.through;
            this.reportFeedbackFromDate = keep.fb; this.hideLowLearners = keep.low; this.hidePrivateCourses = keep.priv;
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
                + '<td class="py-2 pr-3 font-mono text-[11px] break-all">' + (on && p.slug ? (s.baseUrl ? esc(this._pdUrl(p.slug)) : '<span class="text-amber-700 font-sans">set the web address first</span>') : '') + '</td>'
                + '<td class="py-2 pr-3 font-mono text-[11px] whitespace-nowrap">' + (on && p.password ? esc(p.password) : '') + '</td>'
                + '<td class="py-2 pr-3 text-[11px] whitespace-nowrap">' + (on ? (live ? '<span class="text-emerald-700">live · ' + esc(when(p.published.at)) + '</span>' : '<span class="text-amber-700">at the next publish</span>') : '') + '</td>'
                + '<td class="py-2 text-right whitespace-nowrap">' + (on && p.slug && s.baseUrl ? '<button onclick="App.pdCopy(\'' + pe + '\', this)" class="text-[11px] font-bold text-gsf-boston hover:underline mr-2">Copy</button><button onclick="App.pdEmail(\'' + pe + '\')" class="text-[11px] font-bold text-gsf-boston hover:underline mr-2">Email…</button><button onclick="App.pdNewPassword(\'' + pe + '\')" class="text-[11px] text-slate-500 hover:underline mr-2">New password</button><button onclick="App.pdNewLink(\'' + pe + '\')" class="text-[11px] text-slate-500 hover:underline">New link</button>' : '') + '</td></tr>';
        }).join('');
        const lp = s.lastPublish;
        const enabled = this._pdEnabled().length;
        return '<div data-edit-only class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">'
            + '<h2 class="text-sm font-bold text-gsf-prussian uppercase tracking-wide mb-1">Partner Dashboards</h2>'
            + '<p class="text-xs text-slate-400 mb-4 max-w-3xl">Each provider you switch on gets its full web report at a link of its own, behind a password, rebuilt every night after the background sync (Data Sync). Reports show all-time figures with charts through the last full month. They are encrypted on this Mac before upload, and the token, links and passwords stay on this Mac.</p>'
            + '<div class="flex items-center gap-2 flex-wrap mb-4 text-xs">'
            + '<span class="font-bold uppercase tracking-wide text-[10px] text-slate-400">GitHub repository</span>' + input('repo', s.repo, 'owner/repository', 'w-56')
            + '<span class="font-bold uppercase tracking-wide text-[10px] text-slate-400 ml-2">Web address</span>' + input('baseUrl', s.baseUrl, 'https://reports.globalsurgeryfoundation.org', 'w-72')
            + '<span class="font-bold uppercase tracking-wide text-[10px] text-slate-400 ml-2">Token</span><input type="password" placeholder="' + (this._pdHasToken ? 'saved on this Mac — paste to replace' : 'paste a GitHub token') + '" onchange="App.pdSetToken(this.value).then(() => App._pdTokenSet())" class="w-56 text-xs border rounded px-2 py-1.5 outline-none focus:ring-2 focus:ring-gsf-boston/30">'
            + '</div>'
            + '<div class="overflow-x-auto max-h-[420px] overflow-y-auto custom-scrollbar"><table class="w-full text-left text-xs"><thead class="text-slate-400 sticky top-0 bg-white"><tr><th class="py-2 pr-3 font-medium">Provider</th><th class="py-2 pr-3 font-medium">Link</th><th class="py-2 pr-3 font-medium">Password</th><th class="py-2 pr-3 font-medium">Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
            + '<div class="flex items-center gap-3 flex-wrap mt-4">'
            + '<button onclick="App.pdPublishNow()" ' + (enabled ? '' : 'disabled') + ' class="px-4 py-2 rounded-lg text-sm font-bold ' + (enabled ? 'bg-gsf-prussian text-white hover:bg-slate-900' : 'bg-slate-100 text-slate-400 cursor-not-allowed') + '">Publish now</button>'
            + '<span class="text-xs ' + (lp ? (lp.ok ? 'text-emerald-700' : 'text-amber-700') : 'text-slate-400') + '">' + (lp ? 'Last publish ' + esc(when(lp.at)) + ': ' + esc(lp.note) : enabled + ' switched on · not published yet') + '</span>'
            + '</div></div>';
    },
    async _pdTokenSet() { this._pdHasToken = !!(await this._pdToken()); },
});
