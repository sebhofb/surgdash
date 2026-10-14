// LearnWorlds token renewal (js/learnworlds.js): with the Client ID + Client Secret the app
// gets its own token (client-credentials grant), reuses it while valid, renews it before it
// runs out or when LearnWorlds refuses it, and says plainly what to do when it cannot.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };

const store = new Map(), internal = {}, calls = [];
let issued = 0, valid = new Set(['OLD']), tokenStatus = 200, expiresIn = 8000;
const lw = async (req) => {
  calls.push(req);
  if (req.method === 'POST' && req.url === 'https://www.surghub.org/admin/api/oauth2/access_token') {
    if (tokenStatus !== 200) return { statusCode: tokenStatus, body: JSON.stringify({ errors: [{ code: tokenStatus, context: 'invalid_client', message: 'Client authentication failed' }], success: false }) };
    const t = 'TOK' + (++issued); valid.add(t);
    return { statusCode: 200, body: JSON.stringify({ tokenData: { access_token: t, token_type: 'Bearer', expires_in: expiresIn }, errors: [], success: true }) };
  }
  const tok = String(req.headers.Authorization || '').replace(/^Bearer /, '');
  if (!valid.has(tok)) return { statusCode: 400, body: JSON.stringify({ errors: [{ code: 400, context: 'access_denied', message: 'The resource owner or authorization server denied the request.' }], success: false }) };
  return { statusCode: 200, body: JSON.stringify({ data: [{ id: 'c1' }], meta: { totalItems: 151 } }) };
};
let now = Date.UTC(2026, 9, 14, 12, 0, 0);
class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
const ctx = { console: { log() {}, warn() {}, error() {} }, Date: FakeDate, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, URLSearchParams, setTimeout, encodeURIComponent, isNaN,
  electronAPI: { invoke: async (ch, req) => (ch === 'http-request' ? lw(req) : null) },
  Storage: { async getItem(k) { return store.has(k) ? store.get(k) : null; }, async setItem(k, v, o) { store.set(k, v); internal[k] = !!(o && o.internal); } } };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/learnworlds.js'), 'utf8'), ctx);
const LW = ctx.LearnWorlds;
const posts = () => calls.filter(c => c.method === 'POST');

(async () => {
  // ── without a secret: the pasted token, as before ──
  await LW.setCredentials({ clientId: 'CID', apiToken: 'OLD' });
  const r0 = await LW.testConnection();
  check('a pasted token works as before, and nothing is renewed', r0.ok && r0.totalCourses === 151 && posts().length === 0);
  valid.delete('OLD');
  const r1 = await LW.testConnection();
  check('when it expires, the message says so and how to fix it for good', !r1.ok && /^Auth failed: LearnWorlds refused the access token \(400\)/.test(r1.error) && /probably expired/.test(r1.error) && /Client Secret/.test(r1.error), r1.error);

  // ── with the secret ──
  calls.length = 0;
  await LW.setCredentials({ clientId: 'CID', apiToken: 'OLD', clientSecret: 'S3CRET' });
  check('the secret is stored on this device as an internal write', store.get('learnworlds_client_secret') === 'S3CRET' && internal.learnworlds_client_secret === true);
  const r2 = await LW.testConnection();
  const p = posts()[0];
  check('a refused token is renewed once and the request asked again', r2.ok && posts().length === 1 && calls.length === 3, calls.map(c => c.method + ' ' + c.url.split('/admin/api')[1]).join(' | '));
  check('renewal is the documented client-credentials request', p && p.headers['Lw-Client'] === 'CID' && /^data=/.test(p.body) && JSON.stringify(JSON.parse(decodeURIComponent(p.body.slice(5)))) === JSON.stringify({ client_id: 'CID', client_secret: 'S3CRET', grant_type: 'client_credentials' }) && p.headers['Content-Type'] === 'application/x-www-form-urlencoded');
  check('the new token and its expiry are kept', store.get('learnworlds_api_token') === 'TOK1' && store.get('learnworlds_api_token_exp') === now + 8000 * 1000 && internal.learnworlds_api_token_exp === true);
  check('the secret never travels in a header or a URL', calls.every(c => !/S3CRET/.test(JSON.stringify(c.headers) + c.url)));

  calls.length = 0;
  await LW.apiGet('/courses', { page: 1 }); await LW.apiGet('/users', { page: 1 });
  check('a valid token is reused: no renewal per request', posts().length === 0 && calls.every(c => c.headers.Authorization === 'Bearer TOK1'));

  calls.length = 0; now += 8000 * 1000 - 4 * 60 * 1000;   // 4 minutes before it runs out
  await LW.apiGet('/courses', { page: 1 });
  check('it is renewed shortly before it runs out, before the request', posts().length === 1 && calls[1].headers.Authorization === 'Bearer TOK2');

  calls.length = 0; now += 8000 * 1000;
  await Promise.all([1, 2, 3, 4, 5].map(i => LW.apiGet('/users', { page: i })));
  check('requests running together share one renewal', posts().length === 1 && calls.filter(c => c.method === 'GET').every(c => c.headers.Authorization === 'Bearer TOK3'));

  // ── a secret that LearnWorlds rejects ──
  calls.length = 0; valid.clear(); tokenStatus = 401;
  const r3 = await LW.testConnection();
  check('a rejected secret says so, naming what to check ("Auth failed": the syncs stop rather than retry)', !r3.ok && /^Auth failed: could not renew the LearnWorlds token \(401\): Client authentication failed/.test(r3.error) && /Client ID and Client Secret/.test(r3.error), r3.error);

  // ── a secret alone is enough to start ──
  tokenStatus = 200; store.clear(); calls.length = 0;
  await LW.setCredentials({ clientId: 'CID', apiToken: '', clientSecret: 'S3CRET' });
  const r4 = await LW.testConnection();
  check('Client ID + secret alone are enough: the first request fetches a token', r4.ok && posts().length === 1 && await LW.hasCredentials());
  await LW.setCredentials({ clientId: 'CID', apiToken: store.get('learnworlds_api_token') });
  check('saving without touching the secret keeps it', (await LW.getCredentials()).clientSecret === 'S3CRET');

  // ── never leaves this Mac ──
  const storage = fs.readFileSync(path.join(ROOT, 'js/storage.js'), 'utf8'), gv = fs.readFileSync(path.join(ROOT, 'js/genericViews.js'), 'utf8'), app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  check('the secret and expiry live in settings/ and are never mapped back (so never enumerated, pushed or exported)',
    /'learnworlds_client_secret'\) return path\.join\('settings', 'learnworlds_client_secret\.json'\)/.test(storage) && !/'learnworlds_client_secret': 'learnworlds_client_secret'/.test(storage) && !/'learnworlds_api_token_exp':/.test(storage));
  check('and are on the Sheets-push secret list and the local-only mtime list', /SECRET_KEYS = new Set\(\[[^\]]*'learnworlds_client_secret'/.test(gv) && /'learnworlds_client_secret\.json'/.test(app) && /'learnworlds_api_token_exp\.json'/.test(app));

  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})();
