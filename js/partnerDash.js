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
    PD_PLATFORM_SLUG: 'surghub',   // all of SURGhub, opened with the team password

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
        taken.add(this.PD_TEAM_SLUG); taken.add(this.PD_PLATFORM_SLUG);
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
    _pdDownloadsHtml(manifest, white) {
        if (!manifest || !manifest.length) return '';
        const gsf = white === 'gsf';
        const bar = white ? 'background:#ffffff;border:1px solid #e1e7ee;box-shadow:0 6px 24px rgba(11,34,51,.14)' : 'background:#0b2233;border:1px solid #1d3a4f;box-shadow:0 6px 24px rgba(0,0,0,.35)';
        const esc = (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const head = gsf
            ? '<section id="sec-downloads"><div class="wrap"><p class="eyebrow">Downloads</p><h2>Take the data with you</h2><p class="intro">The full report and the anonymised data behind it. Each file opens with the same password as this page.</p>'
                + '<div id="sh-dl" class="dl">' + manifest.map((f, i) => '<button data-i="' + i + '" title="' + esc(f.name) + '" class="btn' + (i ? ' sec' : '') + '">' + esc(f.label) + '</button>').join('') + '<span id="sh-dl-msg" class="note" style="margin:0"></span></div></div></section>'
            : '<div id="sh-dl" style="position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 12px;border-radius:12px;' + bar + ';font:13px Arial,Helvetica,sans-serif;color:#9fb3c8">'
            + '<span style="font-weight:700;color:' + (white ? '#0b2233' : '#eef4f9') + ';margin-right:4px">Downloads</span>'
            + manifest.map((f, i) => '<button data-i="' + i + '" title="' + esc(f.name) + '" style="padding:7px 10px;border:0;border-radius:8px;background:#FFC145;color:#002F4C;font-weight:700;font-size:12px;cursor:pointer">' + esc(f.label) + '</button>').join('')
            + '<span id="sh-dl-msg" style="min-width:0"></span></div>';
        return head
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
        heading = heading || 'Your partner dashboard'; prompt = prompt || 'Enter the password you received with this link.';
        const logo = this._prImage ? this._prImage('gsf_logo_white_web.png') : '';
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            + '<meta name="robots" content="noindex,nofollow,noarchive"><title>' + heading + '</title>'
            // GSF design: a navy band with the white logo, then a white form (Arial, strong-blue button, GSF focus ring)
            + '<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#ffffff;color:#002f4c;font:16px/1.5 Arial,"Helvetica Neue",Helvetica,sans-serif}'
            + '.band{background:#002f4c;padding:28px 24px 64px;border-bottom-left-radius:50% 24px;border-bottom-right-radius:50% 24px}.band div{max-width:420px;margin:0 auto}.band img{height:48px;width:auto;display:block}'
            + '.box{width:min(420px,calc(100vw - 32px));margin:-36px auto 40px;padding:32px;border-radius:12px;background:#ffffff;border:1px solid #dee7ef;box-shadow:0 12px 28px rgba(0,47,76,.14)}'
            + '.eb{margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0468b1}'
            + 'h1{margin:0 0 6px;font-family:"Arial Black",Arial,sans-serif;font-weight:900;font-size:26px;line-height:1.15;color:#0468b1}p{margin:0 0 20px;color:#4a6b82;font-size:15px}'
            + 'input[type=password]{width:100%;padding:12px 14px;border-radius:9px;border:1px solid #cde1f0;background:#ffffff;color:#002f4c;font:16px Arial,sans-serif}'
            + 'input[type=password]:focus{outline:none;border-color:#0468b1;box-shadow:0 0 0 3px rgba(255,193,69,.75)}'
            + 'button{margin-top:16px;width:100%;padding:13px;border:0;border-radius:9px;background:#0468b1;color:#ffffff;font:700 16px Arial,sans-serif;cursor:pointer}button:hover{background:#035c9d}'
            + 'button:focus-visible{outline:none;box-shadow:0 0 0 2px #002f4c,0 0 0 5px #ffc145}button:disabled{opacity:.6}'
            + 'label{display:flex;gap:8px;align-items:center;margin-top:14px;font-size:14px;color:#002f4c}input[type=checkbox]{accent-color:#0468b1;width:16px;height:16px}'
            + '.err{min-height:20px;margin-top:12px;color:#cf2525;font-size:14px;font-weight:700}.foot{text-align:center;font-size:13px;color:#4a6b82;margin:0 16px 32px}</style></head>'
            + '<body><div class="band"><div>' + (logo ? '<img src="' + logo + '" alt="Global Surgery Foundation">' : '<b style="color:#fff">Global Surgery Foundation</b>') + '</div></div>'
            + '<form class="box" id="f"><p class="eb">SURGhub</p><h1>' + heading + '</h1><p>' + prompt + '</p>'
            + '<input type="password" id="pw" autocomplete="current-password" autofocus placeholder="Password" aria-label="Password">'
            + '<label><input type="checkbox" id="rm" checked> Remember on this device</label>'
            + '<button type="submit" id="go">Open report</button><div class="err" id="err" role="alert"></div></form>'
            + '<p class="foot">SURGhub, the UN Global Surgery Learning Hub, is the Global Surgery Foundation\'s online learning platform.</p>'
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
    // The team page (/team/) in the GSF design, like the provider dashboards (Seb, 4 Nov 2026): a navy bar and
    // header, a search box, all of SURGhub first, then a white logo tile per provider. Opening it once stores
    // every provider's password in this browser, so their dashboards open without asking.
    _pdTeamHtml(list, overall, teamPassword) {
        const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const now = new Date(), at = now.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) + ', ' + now.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
        const initials = (n) => String(n).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(w => w && !/^(of|and|the|for|de|des|in)$/i.test(w)).slice(0, 3).map(w => w[0].toUpperCase()).join('');
        const gsfLogo = this._pdBuildImage('gsf_logo_white_web.png');
        const cards = list.map(x => '<a class="card" href="/' + esc(x.slug) + '/" data-k="' + esc((x.name + ' ' + x.slug).toLowerCase()) + '" title="Open the ' + esc(x.name) + ' dashboard">'
            + '<span class="logo">' + (x.logo ? '<img src="' + esc(x.logo) + '" alt="" loading="lazy">' : '<span class="ini">' + esc(initials(x.name)) + '</span>') + '</span>'
            + '<span class="n">' + esc(x.name) + '</span></a>').join('');
        const pw = {}; list.forEach(x => { pw[x.slug] = x.password; });
        const num = (v, d) => (v == null || v === '' || isNaN(v)) ? '' : Number(v).toLocaleString('en-GB', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
        let hub = '';
        if (overall) {
            pw[this.PD_PLATFORM_SLUG] = teamPassword;
            const stat = (v, l) => v ? '<span class="st"><b>' + v + '</b><i>' + l + '</i></span>' : '';
            hub = '<a class="hub" href="/' + this.PD_PLATFORM_SLUG + '/" data-k="surghub all overall platform" title="Open the report for all of SURGhub">'
                + '<span class="hub-top">' + (overall.logo ? '<span class="hub-logo"><img src="' + esc(overall.logo) + '" alt="SURGhub"></span>' : '') + '<span class="hub-t"><span class="eye">Every provider</span><span class="ht">All of SURGhub</span></span><span class="go">Open the report &rarr;</span></span>'
                + '<span class="stats">' + stat(num(overall.learners), 'Course enrolments') + stat(num(overall.certificates), 'Certificates') + stat(num(overall.courses), 'Courses') + stat(num(overall.providers), 'Providers') + stat(num(overall.countries), 'Countries') + (Number(overall.rating) > 0 ? stat(num(overall.rating, 2), 'Average rating, weighted') : '') + '</span></a>';
        }
        const css = ':root{--blue:#0468b1;--navy:#002f4c;--deep:#0d233a;--gold:#ffc145;--line:#dee7ef;--line2:#cde1f0;--paper:#f3f7fb;--muted:#4a6b82}'
            + '*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:#fff;color:var(--navy);font:16px/1.55 Arial,"Helvetica Neue",Helvetica,sans-serif}'
            + '.wrap{max-width:1200px;margin:0 auto;padding:0 24px}a{color:var(--blue)}'
            + '.top{background:var(--deep)}.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;height:72px}.top img{height:42px;display:block}.top span{color:var(--gold);font-size:14px;letter-spacing:.03em;text-transform:uppercase}'
            + '.hero{background:radial-gradient(ellipse 50% 90% at 82% 50%,#1e4a73 0,#0d233a 75%);color:#fff;clip-path:polygon(0 0,100% 0,100% 100%,0 calc(100% - 22px))}.hero .wrap{padding-top:56px;padding-bottom:78px}'
            + '.eye{font-size:15px;color:var(--gold);margin:0 0 8px}h1{font-size:46px;line-height:1.1;margin:0}.lead{font-size:18px;color:rgba(255,255,255,.88);margin:14px 0 0;max-width:640px}.sub{display:block;margin-top:8px;font-size:15px;color:rgba(255,255,255,.62)}'
            + '.bar{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line);box-shadow:0 6px 16px rgba(0,47,76,.06)}.bar .wrap{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding-top:12px;padding-bottom:12px}'
            + '.bar label{font-weight:700;font-size:14px}.search{position:relative}.search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:16px;height:16px;fill:none;stroke:var(--muted);stroke-width:2}'
            + 'input{width:min(360px,80vw);font:15px Arial,sans-serif;color:var(--navy);border:1px solid var(--line2);border-radius:9px;padding:9px 12px 9px 36px;outline:none}input:focus-visible{box-shadow:0 0 0 2px #002f4c,0 0 0 5px #ffc145}.count{color:var(--muted);font-size:14px;margin-left:auto}'
            + 'main{padding:40px 0 72px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:22px}'
            + '.hub{grid-column:1/-1;display:flex;flex-direction:column;gap:22px;padding:26px 28px;border-radius:12px;text-decoration:none;color:var(--navy);background:var(--paper);border:1px solid var(--line2);transition:transform .15s,box-shadow .15s,border-color .15s}'
            + '.hub:hover,.hub:focus-visible{transform:translateY(-2px);border-color:var(--blue);box-shadow:0 12px 28px rgba(0,47,76,.12);outline:none}.hub:focus-visible{box-shadow:0 0 0 2px #002f4c,0 0 0 5px #ffc145}'
            + '.hub-top{display:flex;align-items:center;gap:18px}.hub-logo{background:#fff;border-radius:9px;padding:8px 12px;border:1px solid var(--line)}.hub-logo img{height:44px;display:block}.hub-t .eye{display:block;margin:0;color:var(--blue);font-size:14px}.ht{display:block;font-size:24px;font-weight:700}'
            + '.go{margin-left:auto;font-weight:700;color:var(--blue);white-space:nowrap;text-decoration:underline;text-underline-offset:4px}'
            + '.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}.st{background:#fff;border:1px solid var(--line2);border-radius:9px;padding:14px 16px}.st b{display:block;font-size:28px;line-height:1.1;color:var(--blue)}.st i{display:block;font-style:normal;font-size:13px;color:var(--muted);margin-top:4px}'
            + 'h2{font-size:24px;margin:44px 0 16px;grid-column:1/-1}'
            + '.card{display:flex;flex-direction:column;gap:10px;text-decoration:none;color:var(--navy)}'
            + '.logo{display:flex;align-items:center;justify-content:center;height:120px;padding:16px 18px;border-radius:12px;background:#fff;border:1px solid var(--line2);transition:transform .15s,border-color .15s,box-shadow .15s}'
            + '.logo img{max-width:100%;max-height:100%;object-fit:contain;display:block}.ini{font-size:30px;font-weight:700;letter-spacing:.04em;color:var(--blue)}'
            + '.card:hover .logo,.card:focus-visible .logo{transform:translateY(-2px);border-color:var(--blue);box-shadow:0 12px 28px rgba(0,47,76,.12)}.card:focus-visible{outline:none}.card:focus-visible .logo{box-shadow:0 0 0 2px #002f4c,0 0 0 5px #ffc145}'
            + '.n{font-size:14px;font-weight:700;line-height:1.35;text-align:center;padding:0 4px}.card:hover .n{color:var(--blue)}'
            + '.none{color:var(--muted);margin-top:12px}'
            + 'footer{background:var(--deep);color:rgba(255,255,255,.8);font-size:14px}footer .wrap{padding-top:36px;padding-bottom:36px;max-width:1200px}footer b{display:block;color:#fff;font-size:16px;margin-bottom:8px}footer p{margin:0;max-width:720px;line-height:1.6}'
            + '@media (max-width:640px){h1{font-size:32px}.grid{grid-template-columns:repeat(2,1fr);gap:14px}.logo{height:96px;padding:12px}.hub{padding:18px}.go{display:none}.count{margin-left:0;width:100%}}';
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>SURGhub partner dashboards · GSF team</title>'
            + '<style>' + css + '</style></head><body>'
            + '<header class="top"><div class="wrap">' + (gsfLogo ? '<img src="' + gsfLogo + '" alt="Global Surgery Foundation">' : '<b style="color:#fff">Global Surgery Foundation</b>') + '<span>GSF team</span></div></header>'
            + '<div class="hero"><div class="wrap"><p class="eye">SURGhub partner dashboards</p><h1>Every provider\'s dashboard</h1>'
            + '<p class="lead">Choose a provider to open its dashboard; this page opens them all without their passwords.<span class="sub">Published ' + esc(at) + '<span id="age"></span>. Updated about once a week.</span></p></div></div>'
            + '<div class="bar"><div class="wrap"><label for="q">Find a provider</label><span class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" type="search" placeholder="Name or address" autofocus></span><span class="count" id="count">' + list.length + ' provider' + (list.length === 1 ? '' : 's') + '</span></div></div>'
            + '<main><div class="wrap"><div class="grid">' + hub + '<h2>Providers</h2>' + cards + '</div><p class="none" id="none" hidden>No provider matches.</p></div></main>'
            + '<footer><div class="wrap"><b>SURGhub, the UN Global Surgery Learning Hub</b><p>SURGhub is a joint initiative of the Global Surgery Foundation (GSF) and UNITAR (United Nations Institute for Training and Research), supported by the Royal College of Surgeons in Ireland (RCSI), and implemented in association with the Johnson &amp; Johnson Foundation. This page is for the GSF team; please do not share its link or password.</p></div></footer>'
            + '<script>(function(){var P=' + JSON.stringify(pw).replace(/</g, '\\u003c') + ';try{Object.keys(P).forEach(function(s){localStorage.setItem("surghub-report:/"+s+"/",P[s]);localStorage.setItem("surghub-report:/"+s+"/index.html",P[s])})}catch(x){}'
            + 'var D=' + JSON.stringify(now.toISOString().slice(0, 10)) + ',t=new Date(),n=Math.round((Date.UTC(t.getFullYear(),t.getMonth(),t.getDate())-Date.parse(D))/864e5);document.getElementById("age").textContent=" ("+(n<=0?"today":n===1?"yesterday":n+" days ago")+")";'
            + 'var q=document.getElementById("q"),no=document.getElementById("none"),ct=document.getElementById("count"),tot=' + list.length + ';q.addEventListener("input",function(){var v=q.value.toLowerCase().trim(),n=0;[].forEach.call(document.querySelectorAll(".card,.hub"),function(r){var on=!v||r.getAttribute("data-k").indexOf(v)>=0;r.style.display=on?"":"none";if(on&&r.className==="card")n++});no.hidden=!!n||!v;ct.textContent=v?n+" of "+tot+" providers":tot+" providers"})})();<\/script></body></html>';
    },
    _pdBuildImage(f) {
        try { const p = electronAPI.path.join(electronAPI.appPath, 'build', f); return electronAPI.fs.existsSync(p) ? 'data:image/png;base64,' + electronAPI.fs.readFileBase64(p) : ''; }
        catch (e) { return ''; }
    },
    // A logo as a small PNG (tiles are ~140 px high; the originals are up to a few hundred KB each).
    async _pdThumb(uri) {
        if (!uri || typeof Image === 'undefined' || typeof document === 'undefined') return uri || '';
        try {
            const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = uri; });
            const k = Math.min(1, 480 / img.naturalWidth, 240 / img.naturalHeight);
            if (k >= 1) return uri;
            const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
            const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
            return c.toDataURL('image/png');
        } catch (e) { __swallowed(e, 'pd.thumb'); return uri; }
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
        if (slug === this.PD_TEAM_SLUG || slug === this.PD_PLATFORM_SLUG) { alert('"' + slug + '" is kept for the team pages.'); this._pdRerender(); return; }
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
        let overall = null;
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
                    // Every provider's page is in the GSF design (partnerReport.js; Seb, 4 Nov 2026: the Dark / White
                    // choice is gone). The dark report is only a fallback if that builder is missing.
                    const gsf = !!this._buildPartnerReportHtml;
                    let html = gsf ? await this._buildPartnerReportHtml(prov) : await this._buildDarkReportHtml(prov);
                    if (!html) { failed.push(prov + ': no data'); continue; }
                    const white = false;
                    // The downloads: each encrypted with the provider's password under a random name.
                    const manifest = [];
                    for (const a of await this._pdAttachments(prov, anonUsers, failed)) {
                        const file = this._pdRandom(16, this.PD_SLUG_ALPHABET) + '.bin';
                        files.push({ path: p.slug + '/' + file, content: JSON.stringify(await this._pdEncrypt(a.bytes, p.password)) });
                        manifest.push({ label: a.label, name: a.name, mime: a.mime, file });
                    }
                    html = gsf ? html.replace('<!--SH-DOWNLOADS-->', this._pdDownloadsHtml(manifest, 'gsf')) : this._pdInject(html, this._pdDownloadsHtml(manifest, white));
                    files.push({ path: p.slug + '/index.html', content: this._pdPageHtml(await this._pdEncrypt(html, p.password)) });
                    built.push(prov);
                } catch (e) { failed.push(prov + ': ' + String((e && e.message) || e)); }
            }
            // All of SURGhub, for the team page: its report, and the headline numbers for its card.
            if (built.length) {
                try {
                    if (opts.progress) opts.progress('Partner dashboards: all of SURGhub…');
                    const D = this._assembleReportData ? await this._assembleReportData('SURGhub', { platform: true }) : null;
                    // in the GSF design like the provider pages (Seb, 4 Nov 2026); its providers table opens their dashboards
                    const links = {}; built.forEach(prov => { if (s.providers[prov] && s.providers[prov].slug) links[prov] = s.providers[prov].slug; });
                    let html = this._buildPartnerReportHtml ? await this._buildPartnerReportHtml('SURGhub', { platform: true, links }) : await this._buildDarkReportHtml('SURGhub', true);
                    if (html) html = html.replace('<!--SH-DOWNLOADS-->', '');
                    if (html) {
                        if (!s.teamPassword) s.teamPassword = this._pdNewPassword();
                        files.push({ path: this.PD_PLATFORM_SLUG + '/index.html', content: this._pdPageHtml(await this._pdEncrypt(html, s.teamPassword), 'SURGhub · all providers', 'Enter the team password.') });
                        const cc = D && D.providerCountryData;
                        overall = D ? { learners: D.totalLrn, certificates: D.totalCert, courses: (D.coursesSorted || []).length, providers: D.providerCount,
                            countries: Array.isArray(cc) ? cc.length : (cc && typeof cc === 'object' ? Object.keys(cc).length : 0), rating: D.avgRating } : {};
                    }
                } catch (e) { failed.push('All of SURGhub: ' + String((e && e.message) || e)); }
            }
        } finally {
            this.reportPeriodFrom = keep.from; this.reportPeriodTo = keep.to; this.reportDataThrough = keep.through;
            this.reportFeedbackFromDate = keep.fb; this.hideLowLearners = keep.low; this.hidePrivateCourses = keep.priv;
        }
        if (built.length) {
            if (!s.teamPassword) s.teamPassword = this._pdNewPassword();
            if (this._ensureProviderLogos) { try { await this._ensureProviderLogos(); } catch (e) { __swallowed(e, 'pd.logos'); } }
            const list = [];
            for (const prov of built) list.push({ name: this.providerFolderName ? this.providerFolderName(prov) : prov, slug: s.providers[prov].slug, password: s.providers[prov].password,
                logo: this._providerLogoFor ? await this._pdThumb(this._providerLogoFor(prov)) : '' });
            list.sort((a, b) => a.name.localeCompare(b.name));
            if (overall) overall.logo = await this._pdThumb(this._pdBuildImage('surghub_logo_color.png') || this._pdBuildImage('SURGhub_app_square_white.png'));
            files.push({ path: this.PD_TEAM_SLUG + '/index.html', content: this._pdPageHtml(await this._pdEncrypt(this._pdTeamHtml(list, overall, s.teamPassword), s.teamPassword), 'SURGhub partner dashboards · GSF team', 'Enter the team password.') });
        }
        // The GSF website's six headline figures (websiteMetrics.js), published with the site.
        let wm = null;
        if (this.websiteMetricsFile) {
            try { wm = await this.websiteMetricsFile({ syncOk: opts.syncOk }); if (wm.content) files.push({ path: 'metrics.json', content: wm.content }); }
            catch (e) { failed.push('Website figures: ' + String((e && e.message) || e)); }
        }
        // The per-course feed surghub.org course pages read (coursesFeed.js).
        let cf = null;
        if (this.coursesFeedFile) {
            try { cf = await this.coursesFeedFile({ syncOk: opts.syncOk, progress: opts.progress }); if (cf.content) { files.push({ path: 'courses.json', content: cf.content }); (cf.thumbs || []).forEach(t => files.push({ path: t.path, content: t.base64, encoding: 'base64' })); } }
            catch (e) { failed.push('Course feed: ' + String((e && e.message) || e)); }
        }
        // The testimonials surghub.org course pages show (testimonials.js).
        let tf = null;
        if (this.testimonialsFeedFile) {
            try { tf = await this.testimonialsFeedFile({ feed: cf && cf.feed }); if (tf.content) { files.push({ path: 'testimonials.json', content: tf.content }); (tf.perCourse || []).forEach(x => files.push(x)); } }
            catch (e) { failed.push('Testimonials: ' + String((e && e.message) || e)); }
        }
        const host = (String(s.baseUrl || '').match(/^https?:\/\/([^/]+)/) || [])[1] || '';
        files.push({ path: 'index.html', content: this._pdLandingHtml() });
        files.push({ path: '404.html', content: this._pdLandingHtml() });
        files.push({ path: 'robots.txt', content: 'User-agent: *\nDisallow: /\n' });
        files.push({ path: '.nojekyll', content: '' });
        if (host && !/\.github\.io$/i.test(host)) files.push({ path: 'CNAME', content: host + '\n' });
        return { files, built, failed, wm, cf, tf };
    },

    // GitHub API call; a dropped connection, a 5xx or GitHub's own "timed out" is tried
    // again (3 attempts in all) before it counts as a failure.
    async _pdGh(method, path, body, token) {
        for (let attempt = 1; ; attempt++) {
            try { return await this._pdGhOnce(method, path, body, token); }
            catch (e) {
                const transient = !e.status || e.status >= 500 || (e.status === 422 && /timed out/i.test(e.message));
                if (!transient || attempt >= 3) throw e;
                await new Promise(r => setTimeout(r, (this.PD_RETRY_MS || 4000) * attempt));
            }
        }
    },
    async _pdGhOnce(method, path, body, token) {
        const s = this._pd;
        const headers = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'SURGdash', 'Content-Type': 'application/json' };
        // GitHub lets a GET be cached for 60 s (max-age=60) and Electron's network stack honours it, so
        // re-reading the branch tip after "not a fast forward" got the old tip back, three times over
        // (Seb, 2 Nov 2026). Always ask GitHub itself.
        if (method === 'GET') { headers['Cache-Control'] = 'no-cache'; headers['Pragma'] = 'no-cache'; }
        const res = await electronAPI.invoke('http-request', {
            url: 'https://api.github.com/repos/' + s.repo + path, method, headers,
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
            const { files, built, failed, wm, cf, tf } = await this._pdBuildFiles(opts);
            if (!built.length) throw new Error('no report could be built' + (failed.length ? ' (' + failed.join('; ') + ')' : ''));
            if (opts.progress) opts.progress('Partner dashboards: uploading ' + built.length + ' report' + (built.length === 1 ? '' : 's') + '…');
            const blob = (f) => this._pdGh('POST', '/git/blobs', { content: f.content, encoding: f.encoding || 'utf-8' }, token);
            let first;
            try { first = await blob(files[0]); }
            catch (e) {
                if (e.status !== 409) throw e;   // an empty repository has no git database yet: give it a first commit
                await this._pdGh('PUT', '/contents/README.md', { message: 'Start', content: btoa('SURGhub partner reports, published by SURGdash.\n'), branch }, token);
                first = await blob(files[0]);
            }
            // Three uploads at a time, with a count and the megabytes sent, so a long publish never
            // looks stuck (Seb, 3 Nov 2026: "uploading 35 reports…" sat unchanged for minutes).
            const shas = [first.sha], total = files.length, mb = (n) => (n / 1048576).toFixed(0);
            const allBytes = files.reduce((a, f) => a + String(f.content || '').length, 0);
            let done = 1, sent = String(files[0].content || '').length, next = 1;
            const tell = () => { if (opts.progress) opts.progress('Partner dashboards: uploading file ' + done + ' of ' + total + ' (' + mb(sent) + ' of ' + mb(allBytes) + ' MB)…'); };
            tell();
            const worker = async () => {
                while (next < total) {
                    const i = next++;
                    shas[i] = (await blob(files[i])).sha;
                    done++; sent += String(files[i].content || '').length; tell();
                }
            };
            await Promise.all([worker(), worker(), worker()]);
            // One small tree per folder, then the root: a single tree of every file is
            // too much for GitHub to build in one request (it times out).
            if (opts.progress) opts.progress('Partner dashboards: arranging the site…');
            const root = [], dirs = {};
            files.forEach((f, i) => {
                const cut = f.path.indexOf('/'), entry = { mode: '100644', type: 'blob', sha: shas[i] };
                if (cut < 0) root.push(Object.assign({ path: f.path }, entry));
                else (dirs[f.path.slice(0, cut)] = dirs[f.path.slice(0, cut)] || []).push(Object.assign({ path: f.path.slice(cut + 1) }, entry));
            });
            for (const d of Object.keys(dirs)) root.push({ path: d, mode: '040000', type: 'tree', sha: (await this._pdGh('POST', '/git/trees', { tree: dirs[d] }, token)).sha });
            const t = await this._pdGh('POST', '/git/trees', { tree: root }, token);
            const now = new Date().toISOString();
            const c = await this._pdGh('POST', '/git/commits', { message: 'Partner reports ' + now.slice(0, 10), tree: t.sha, parents: [] }, token);
            try { await this._pdGh('PATCH', '/git/refs/heads/' + branch, { sha: c.sha, force: true }, token); }
            catch (e) { if (e.status !== 404 && e.status !== 422) throw e; await this._pdGh('POST', '/git/refs', { ref: 'refs/heads/' + branch, sha: c.sha }, token); }
            built.forEach(p => { s.providers[p].published = { at: now, slug: s.providers[p].slug }; });
            if (wm && wm.content && this._wmPublished) await this._wmPublished(wm);
            if (cf && cf.content && this._cfMarkPublished) await this._cfMarkPublished(cf);
            if (tf && tf.content && this._tmMarkPublished) await this._tmMarkPublished(tf);
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
            + '</div>' + (this._websiteMetricsHtml ? this._websiteMetricsHtml() : '') + '</div>';
    },
    async _pdTokenSet() { this._pdHasToken = !!(await this._pdToken()); },
});
