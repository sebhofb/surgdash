// Partner dashboards (js/partnerDash.js): passwords and links, the encryption round trip through
// the real page script, and a publish against a fake GitHub API — nothing readable, no password
// and no token may ever reach an uploaded file.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };

const store = new Map(), calls = [];
let ghRefExists = true, ghEmpty = false, blobN = 0; const blobBySha = {};
const gh = async (req) => {
  calls.push(req);
  const p = req.url.replace(/^https:\/\/api\.github\.com\/repos\/gsf\/reports/, ''); const body = req.body ? JSON.parse(req.body) : null;
  const ok = (status, json) => ({ statusCode: status, body: JSON.stringify(json) });
  if (req.method === 'POST' && p === '/git/blobs') { if (ghEmpty) return ok(409, { message: 'Git Repository is empty.' }); const sha = 'blob' + (++blobN); blobBySha[sha] = body.content; return ok(201, { sha }); }
  if (req.method === 'PUT' && p === '/contents/README.md') { ghEmpty = false; return ok(201, {}); }
  if (req.method === 'POST' && p === '/git/trees') return ok(201, { sha: 'tree1' });
  if (req.method === 'POST' && p === '/git/commits') return ok(201, { sha: 'commit1' });
  if (req.method === 'PATCH' && p === '/git/refs/heads/main') return ghRefExists ? ok(200, {}) : ok(422, { message: 'Reference does not exist' });
  if (req.method === 'POST' && p === '/git/refs') return ok(201, {});
  return ok(404, { message: 'Not Found' });
};
const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, isNaN, isFinite, parseInt, parseFloat, Uint8Array,
  TextEncoder, TextDecoder, crypto: globalThis.crypto, btoa, atob, setTimeout, __swallowed() {}, alert() {}, confirm: () => true,
  navigator: { clipboard: { writeText: async (t) => { ctx.__clip = t; } } },
  electronAPI: { invoke: async (ch, req) => (ch === 'http-request' ? gh(req) : null), openExternal: (u) => { ctx.__mail = u; } },
  Storage: { async getItem(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; }, async setItem(k, v, o) { store.set(k, JSON.parse(JSON.stringify(v))); ctx.__internal = (ctx.__internal || []).concat([!!(o && o.internal)]); } } };
ctx.window = ctx;
ctx.App = { reportPeriodFrom: '2026-07', reportPeriodTo: '2026-09', reportDataThrough: '', reportFeedbackFromDate: '2026-01-01', hideLowLearners: true, hidePrivateCourses: true,
  view: 'sh-reports', renderView() {}, showMsg() {}, escapeHtml: (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), escapeJsArg: (t) => String(t).replace(/'/g, "\\'"),
  _lastFullMonth: () => '2026-09', providerFolderName: (p) => p.split(' - ')[0],
  getAnalyticsSnap() { return [{ Provider: 'GSF - Global Surgery Foundation' }, { Provider: 'WFSA - World Federation' }, { Provider: 'Lifebox' }, { Provider: 'Unknown Provider' }]; },
  _withAllCourses(fn) { return fn(); } };
vm.createContext(ctx);
for (const f of ['js/reportNames.js', 'js/partnerDash.js']) { try { vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }); } catch (e) { check('loads ' + f, false, e.message); } }
const App = ctx.App;
const seen = [];
App._buildDarkReportHtml = async (prov) => { seen.push({ prov, from: App.reportPeriodFrom, through: App.reportDataThrough, fb: App.reportFeedbackFromDate, low: App.hideLowLearners, priv: App.hidePrivateCourses }); return '<html><body>SECRET REPORT FOR ' + prov + '</body></html>'; };
// The three downloads, as the package export builds them (stubbed: no Electron, no XLSX here).
const FILEBYTES = { pdf: (prov) => new TextEncoder().encode('%PDF secret for ' + prov), users: (prov) => new TextEncoder().encode('PK users of ' + prov), fb: (prov) => new TextEncoder().encode('PK feedback of ' + prov) };
App._pdPdfBytes = async (prov) => FILEBYTES.pdf(prov);
App._buildUsersWorkbook = (prov, anon) => ({ kind: 'users', prov });
App._buildFeedbackWorkbook = async (prov) => (prov === 'Lifebox' ? null : { kind: 'fb', prov });   // Lifebox has no survey feedback
App._pdWorkbookBytes = (wb) => (wb.kind === 'users' ? FILEBYTES.users(wb.prov) : FILEBYTES.fb(wb.prov));
async function decryptJson(json, pw) {
  const P = JSON.parse(json), b = (x) => Uint8Array.from(Buffer.from(x, 'base64'));
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b(P.s), iterations: P.n, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b(P.i) }, key, b(P.d)));
}

// Run the page's own script on a payload: the real decrypt path a provider's browser takes.
async function openPage(html, pw) {
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  let written = null, saved = {};
  const el = (id) => ({ value: pw, checked: true, disabled: false, textContent: '', addEventListener(ev, fn) { this._submit = fn; } });
  const els = { f: el('f'), err: el('err'), go: el('go'), pw: el('pw'), rm: el('rm') };
  const pctx = { crypto: globalThis.crypto, TextEncoder, TextDecoder, Uint8Array, atob, location: { pathname: '/p/x/' },
    localStorage: { getItem: (k) => saved[k] || null, setItem: (k, v) => { saved[k] = v; }, removeItem: (k) => { delete saved[k]; } },
    document: { getElementById: (id) => els[id], open() {}, write(h) { written = h; }, close() {} } };
  pctx.window = pctx;   // a browser's global object
  vm.createContext(pctx); vm.runInContext(script, pctx);
  els.f._submit({ preventDefault() {} });
  for (let i = 0; i < 200 && written === null && !/does not open/.test(els.err.textContent); i++) await new Promise(r => setTimeout(r, 10));
  return { written, error: els.err.textContent, saved };
}

(async () => {
  // ── links and passwords ──
  const pw = App._pdNewPassword();
  check('passwords: 16 random characters in four groups, nothing easily misread', /^[a-km-zA-HJ-NP-Z2-9]{4}(-[a-km-zA-HJ-NP-Z2-9]{4}){3}$/.test(pw) && !/[0O1lI]/.test(pw), pw);
  check('addresses: the acronym before " - ", else the folder name, lowercase and web-safe',
    App._pdNiceSlug('WFSA - World Federation') === 'wfsa' && App._pdNiceSlug('Lifebox') === 'lifebox' && App._pdNiceSlug('ALL SAFE') === 'all-safe' && App._pdSlugify(' Médecins / Sans Frontières ') === 'medecins-sans-frontieres'
    && App._pdNiceSlug('Harvard Medical School - Program in Global Surgery and Social Change') === 'harvard-medical-school-program');

  // ── encryption, opened by the page itself ──
  const payload = await App._pdEncrypt('<html>hello report</html>', 'Abcd-Efgh-Jkmn-Pqrs');
  const page = App._pdPageHtml(payload);
  check('the page carries no readable report and tells search engines to stay away', !/hello report/.test(page) && /noindex,nofollow/.test(page));
  const good = await openPage(page, 'Abcd-Efgh-Jkmn-Pqrs');
  check('the right password opens the report in the browser', good.written === '<html>hello report</html>', good.error);
  check('…and is remembered on that device only if ticked', good.saved['surghub-report:/p/x/'] === 'Abcd-Efgh-Jkmn-Pqrs');
  const wrong = await openPage(page, 'Abcd-Efgh-Jkmn-Pqrt');
  check('a wrong password does not open it', wrong.written === null && /does not open this report/.test(wrong.error));
  const again = await App._pdEncrypt('<html>hello report</html>', 'Abcd-Efgh-Jkmn-Pqrs');
  check('each publish encrypts afresh (new salt and IV)', again.s !== payload.s && again.i !== payload.i && again.d !== payload.d);

  // ── not ready until set up ──
  check('nothing publishes before it is set up', (await App.publishPartnerDashboards({ silent: true })).ok === false && calls.length === 0);
  await App.pdSetSetting('repo', 'https://github.com/gsf/reports.git');
  await App.pdSetSetting('baseUrl', 'reports.globalsurgeryfoundation.org/');
  await App.pdSetEnabled('GSF - Global Surgery Foundation', true);
  await App.pdSetEnabled('Lifebox', true);
  check('settings are tidied: repository and address', App._pd.repo === 'gsf/reports' && App._pd.baseUrl === 'https://reports.globalsurgeryfoundation.org');
  check('switching a provider on gives it a readable link and a password', App._pd.providers.Lifebox.slug === 'lifebox' && App._pd.providers['GSF - Global Surgery Foundation'].slug === 'gsf' && /-/.test(App._pd.providers.Lifebox.password));
  check('…at the site root: https://reports.globalsurgeryfoundation.org/gsf/', App._pdUrl('gsf') === 'https://reports.globalsurgeryfoundation.org/gsf/');
  check('still not ready without the token', (await App._pdReady()).why === 'no GitHub token on this Mac');
  await App.pdSetToken('ghp_TESTTOKEN123');
  check('the token and the settings are written as internal (device) writes', store.get('surgdash_partner_dash_token') === 'ghp_TESTTOKEN123' && ctx.__internal.every(Boolean));

  // ── publish ──
  calls.length = 0; ghEmpty = true;
  const r = await App.publishPartnerDashboards({ silent: true });
  check('publishes the two switched-on providers only', r.ok && /2 reports published/.test(r.note) && seen.map(s => s.prov).join() === 'GSF - Global Surgery Foundation,Lifebox', r.note);
  check('reports are built all-time, through the last full month, every course, no feedback filter', seen.every(s => s.from === '' && s.through === '2026-09' && s.fb === '' && !s.low && !s.priv));
  check('…and the user\'s report settings are put back', App.reportPeriodFrom === '2026-07' && App.reportDataThrough === '' && App.reportFeedbackFromDate === '2026-01-01' && App.hideLowLearners && App.hidePrivateCourses);
  const blobs = calls.filter(c => c.url.endsWith('/git/blobs')).map(c => JSON.parse(c.body).content);
  const all = blobs.join('\n');
  check('no readable report, no password, no token in anything uploaded', !/SECRET REPORT|%PDF secret|PK users|PK feedback/.test(all) && !all.includes(App._pd.providers.Lifebox.password) && !all.includes(App._pd.providers['GSF - Global Surgery Foundation'].password) && !/ghp_TESTTOKEN123/.test(all));
  check('the token travels only in the Authorization header', calls.every(c => !String(c.body || '').includes('ghp_TESTTOKEN123')) && calls.every(c => c.headers.Authorization === 'Bearer ghp_TESTTOKEN123'));
  const treeEntries = JSON.parse(calls.find(c => c.url.endsWith('/git/trees')).body).tree;
  const tree = treeEntries.map(t => t.path).sort();
  const gsfP = App._pd.providers['GSF - Global Surgery Foundation'], lbP = App._pd.providers.Lifebox;
  const under = (slug) => tree.filter(t => t.startsWith(slug + '/'));
  check('the site: a page per provider at its link, plus landing, 404, robots.txt, .nojekyll and the custom domain',
    ['.nojekyll', '404.html', 'CNAME', 'index.html', 'robots.txt', 'gsf/index.html', 'lifebox/index.html'].every(f => tree.includes(f)) && tree.every(t => !t.includes('/') || t.startsWith('gsf/') || t.startsWith('lifebox/') || t === 'team/index.html'), tree.join(', '));
  check('downloads sit beside each page under random names: three for GSF, two where there is no feedback',
    under(gsfP.slug).filter(t => /\/[a-z0-9]{16}\.bin$/.test(t)).length === 3 && under(lbP.slug).filter(t => /\.bin$/.test(t)).length === 2, under(gsfP.slug).join(', '));
  const contentOf = (path_) => blobBySha[treeEntries.find(t => t.path === path_).sha];
  const gsfPage = contentOf(gsfP.slug + '/index.html');
  const gsfReport = new TextDecoder().decode(await decryptJson(JSON.stringify(JSON.parse(gsfPage.match(/var P=(\{[^;]*\});/)[1])), gsfP.password));
  check('the decrypted report carries a Downloads bar naming each file as in the package', /id="sh-dl"/.test(gsfReport) && /Report_GSF_Launch-Sept 2026\.pdf/.test(gsfReport) && /Users_GSF_Launch-Sept 2026\.xlsx/.test(gsfReport) && /Feedback_GSF_Launch-Sept 2026\.xlsx/.test(gsfReport), (gsfReport.match(/"name":"[^"]+"/g) || []).join(' '));
  const bins = under(gsfP.slug).filter(t => t.endsWith('.bin'));
  const opened = await Promise.all(bins.map(async t => new TextDecoder().decode(await decryptJson(contentOf(t), gsfP.password))));
  check('each download decrypts, with the provider\'s password, to exactly the file built', opened.sort().join('|') === ['%PDF secret for GSF - Global Surgery Foundation', 'PK feedback of GSF - Global Surgery Foundation', 'PK users of GSF - Global Surgery Foundation'].sort().join('|'));
  let wrongOk = true; try { await decryptJson(contentOf(bins[0]), lbP.password); } catch (e) { wrongOk = false; }
  check('another provider\'s password does not open them', wrongOk === false);
  // Run the bar's own script, as a provider's browser would, and click the PDF button.
  const barScript = gsfReport.match(/<div id="sh-dl"[\s\S]*?<script>([\s\S]*?)<\/script>/)[1];
  let handler = null, saved = null;
  const msg = { textContent: '' }, anchors = [];
  const bctx = { crypto: globalThis.crypto, TextEncoder, Uint8Array, atob, location: { pathname: '/' + gsfP.slug + '/' }, localStorage: { getItem: () => null },
    window: { __shPw: gsfP.password, prompt: () => null }, setTimeout: () => 0,
    URL: { createObjectURL: (blob) => { saved = blob; return 'blob:x'; }, revokeObjectURL() {} }, Blob: class { constructor(parts, o) { this.parts = parts; this.type = o.type; } },
    fetch: async (file) => ({ ok: true, text: async () => contentOf(gsfP.slug + '/' + file) }),
    document: { getElementById: (id) => (id === 'sh-dl' ? { addEventListener: (ev, fn) => { handler = fn; } } : msg), createElement: () => { const a = { click() { a.clicked = true; }, remove() {} }; anchors.push(a); return a; }, body: { appendChild() {} } } };
  vm.createContext(bctx); vm.runInContext(barScript, bctx);
  handler({ target: { closest: () => ({ getAttribute: () => '0' }) } });
  for (let i = 0; i < 200 && !(anchors[0] && anchors[0].clicked) && msg.textContent !== 'Could not open the file.'; i++) await new Promise(r => setTimeout(r, 10));
  check('clicking a download saves the decrypted file under its name', anchors[0] && anchors[0].clicked && anchors[0].download === 'Report_GSF_Launch-Sept 2026.pdf' && new TextDecoder().decode(new Uint8Array(saved.parts[0])) === '%PDF secret for GSF - Global Surgery Foundation', msg.textContent);
  check('only switched-on providers have a folder (WFSA is off)', !tree.some(p => /wfsa/i.test(p)));
  check('an empty repository gets a first commit, then the publish carries on', calls.some(c => c.method === 'PUT' && c.url.endsWith('/contents/README.md')));
  const commit = JSON.parse(calls.find(c => c.url.endsWith('/git/commits')).body);
  const ref = calls.find(c => c.method === 'PATCH');
  check('each publish is ONE commit with no history, force-replacing the branch', Array.isArray(commit.parents) && commit.parents.length === 0 && JSON.parse(ref.body).force === true);
  check('the custom domain file names the subdomain', blobs.includes('reports.globalsurgeryfoundation.org\n'));

  // ── the team page ──
  const teamPw = App._pd.teamPassword;
  check('the team page gets its own password, kept on this Mac', /^[a-km-zA-HJ-NP-Z2-9]{4}(-[a-km-zA-HJ-NP-Z2-9]{4}){3}$/.test(teamPw || '') && !all.includes(teamPw) && tree.includes('team/index.html'));
  const teamWrapped = contentOf('team/index.html');
  check('…uploaded encrypted: no provider name, link or password readable', !/Lifebox|\/gsf\/|Global Surgery Foundation/.test(teamWrapped) && !teamWrapped.includes(lbP.password));
  const teamOpen = await openPage(teamWrapped, teamPw);
  check('…a provider password does not open it', (await openPage(teamWrapped, lbP.password)).written === null);
  check('…the team password opens a list of every published provider with its link', /href="\/gsf\/"/.test(teamOpen.written || '') && /href="\/lifebox\/"/.test(teamOpen.written || '') && /SURGhub partner reports/.test(teamOpen.written || ''));
  const ls = {};
  const tctx = { localStorage: { setItem: (k, v) => { ls[k] = v; } }, document: { getElementById: () => ({ addEventListener() {} }), querySelectorAll: () => [] } };
  vm.createContext(tctx); vm.runInContext(teamOpen.written.match(/<script>([\s\S]*?)<\/script>/)[1], tctx);
  check('…and remembers each provider password in that browser, under the key the provider pages read', ls['surghub-report:/gsf/'] === gsfP.password && ls['surghub-report:/lifebox/'] === lbP.password);
  check('"team" is never given to a provider', App._pdNiceSlug('TEAM - Trauma Education') === 'team-2');
  check('the panel shows the team page, its password and Open', /Your team page/.test(App._partnerDashHtml()) && App._partnerDashHtml().includes(teamPw) && /App\.pdOpenTeam\(\)/.test(App._partnerDashHtml()));
  check('a live provider gets a Partner dashboard button for its provider and course pages; others none', /App\.pdOpen\('GSF - Global Surgery Foundation'\)/.test(App._pdButtonHtml('GSF - Global Surgery Foundation')) && App._pdButtonHtml('WFSA - World Federation') === '' && App._pdButtonHtml('') === '');
  check('the published state is recorded per provider', App._pd.providers.Lifebox.published && App._pd.providers.Lifebox.published.slug === App._pd.providers.Lifebox.slug && App._pd.lastPublish.ok);

  calls.length = 0; ghRefExists = false;
  await App.publishPartnerDashboards({ silent: true });
  check('a branch that does not exist yet is created', calls.some(c => c.method === 'POST' && c.url.endsWith('/git/refs')));

  // ── changing a link or password ──
  await App.pdSetSlug('Lifebox', 'gsf');
  check('an address another provider uses is refused', App._pd.providers.Lifebox.slug === 'lifebox' && App._pd.providers.Lifebox.published !== null);
  await App.pdSetSlug('Lifebox', 'Team');
  check('the team page address is refused', App._pd.providers.Lifebox.slug === 'lifebox');
  await App.pdSetSlug('Lifebox', '  ');
  check('an empty address is refused', App._pd.providers.Lifebox.slug === 'lifebox');
  await App.pdSetSlug('Lifebox', ' LifeBox Global ');
  check('an edited address is tidied, and the old one drops from the next publish', App._pd.providers.Lifebox.slug === 'lifebox-global' && App._pd.providers.Lifebox.published === null);
  await App.pdNewPassword('Lifebox');
  await App.pdCopy('Lifebox');
  check('the message to the provider carries the link and the password', ctx.__clip.includes(App._pdUrl(App._pd.providers.Lifebox.slug)) && ctx.__clip.includes(App._pd.providers.Lifebox.password));

  // ── the select-all tick ──
  await App.pdSetAllEnabled(true);
  check('the header tick switches every provider on (never "Unknown Provider"), each with a link and password',
    App._pdEnabled().length === 3 && App._pd.providers['WFSA - World Federation'].slug === 'wfsa' && !!App._pd.providers['WFSA - World Federation'].password && !App._pd.providers['Unknown Provider'], App._pdEnabled().join());
  check('…and shows ticked when all are on', /<input type="checkbox" checked onchange="App\.pdSetAllEnabled/.test(App._partnerDashHtml()));
  const keepPw = App._pd.providers.Lifebox.password;
  await App.pdSetAllEnabled(false);
  check('…and off again, keeping links and passwords for next time', App._pdEnabled().length === 0 && App._pd.providers.Lifebox.password === keepPw && App._pd.providers.Lifebox.slug === 'lifebox-global');
  await App.pdSetEnabled('Lifebox', true);

  // ── the first random links move to readable ones ──
  store.set(App.PD_KEY, { repo: 'gsf/reports', providers: { 'GSF - Global Surgery Foundation': { enabled: true, slug: 'abcdefghijkmnopqrstuvw', password: 'x', published: { slug: 'abcdefghijkmnopqrstuvw' } }, 'ALL SAFE': { enabled: true, slug: '0123456789abcdefghijkl', password: 'y' } } });
  const keepPd = App._pd; App._pd = null;
  await App._pdLoad();
  check('random links from the first version become readable, to be republished', App._pd.providers['GSF - Global Surgery Foundation'].slug === 'gsf' && App._pd.providers['ALL SAFE'].slug === 'all-safe' && App._pd.providers['GSF - Global Surgery Foundation'].published === null && store.get(App.PD_KEY).providers['ALL SAFE'].slug === 'all-safe');
  App._pd = keepPd; store.set(App.PD_KEY, keepPd);

  // ── failure is reported, not thrown, when run by hand ──
  ghEmpty = false; const real = ctx.electronAPI.invoke; ctx.electronAPI.invoke = async () => ({ statusCode: 401, body: '{"message":"Bad credentials"}' });
  const fail = await App.publishPartnerDashboards({ silent: false });
  check('a GitHub refusal is reported plainly', fail.ok === false && /401 Bad credentials/.test(fail.note) && /401/.test(App._pd.lastPublish.note));
  ctx.electronAPI.invoke = real;

  // ── the panel ──
  const html = App._partnerDashHtml();
  check('the panel lists every provider with courses, never "Unknown Provider"', /GSF/.test(html) && /WFSA/.test(html) && !/Unknown Provider/.test(html));
  check('it is shown in edit mode only', /^<div data-edit-only/.test(html));

  // ── wiring ──
  const storage = fs.readFileSync(path.join(ROOT, 'js/storage.js'), 'utf8'), gv = fs.readFileSync(path.join(ROOT, 'js/genericViews.js'), 'utf8'), bg = fs.readFileSync(path.join(ROOT, 'js/backgroundSync.js'), 'utf8');
  check('links, passwords and token live in settings/ and are never mapped back (so never pushed or exported)',
    /'surgdash_partner_dash'\)\s+return path\.join\('settings', 'partner_dash\.json'\)/.test(storage) && /'surgdash_partner_dash_token'\) return path\.join\('settings', 'partner_dash_token\.json'\)/.test(storage) && !/'partner_dash'\s*:/.test(storage));
  check('…and the Sheets push skips them even if listed', /'surgdash_partner_dash', 'surgdash_partner_dash_token'/.test(gv));
  check('the nightly sync republishes, only where the dashboards are set up', /if \(this\._pdReady && \(await this\._pdReady\(\)\)\.ok\) \{\s*await step\('Partner dashboards'/.test(bg));

  const page_ = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
  check('the module loads before uiState.js', page_.indexOf('js/partnerDash.js') > 0 && page_.indexOf('js/partnerDash.js') < page_.indexOf('js/uiState.js'));
  check('the panel sits on the Reports tab', /\$\{this\._partnerDashHtml \? this\._partnerDashHtml\(\) : ''\}\s*<!-- Courses in reports -->/.test(ui));

  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})();
