// Role passwords: built into the app, local to each machine, replaced through releases.
// app.js is loaded for real (its top level only declares App), with a Map-backed Storage.
// The passwords here are fixtures; the shipped hashes are checked only as hex strings.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 240) : '')); };
const sha256 = (s) => require('crypto').createHash('sha256').update(s).digest('hex');

function mk() {
  const store = new Map(), writes = [];
  const cls = { add() {}, remove() {}, contains() { return false; }, toggle() {} };
  const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, isFinite, isNaN, parseFloat, parseInt,
    TextEncoder, TextDecoder, crypto: globalThis.crypto, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {}, __swallowed() {},
    document: { addEventListener() {}, body: { classList: cls, appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, classList: cls, appendChild() {}, remove() {} }), documentElement: { scrollTop: 0 } },
    Storage: { async getItem(k) { return store.has(k) ? store.get(k) : null; }, async setItem(k, v, o) { store.set(k, v); writes.push({ k, v, internal: !!(o && o.internal) }); return v; }, async keys() { return [...store.keys()]; } },
    Projects: { getAppSettings: async () => ({}), saveAppSettings: async () => {} }, electronAPI: { invoke: async () => ({}) }, localStorage: { getItem: () => null, setItem() {} } };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8'), ctx, { filename: 'app.js' }); } catch (e) { check('loads app.js', false, e.message); }
  const App = ctx.App;
  App.renderView = () => {};   // ui.js is not loaded
  return { App, store, writes };
}

const OLD = 'reporting-before', NEW = 'reporting-now', EDIT = 'edit-pw', CUSTOM = 'my-own-reporting-pw';
// One "release": the edit password unchanged, the reporting password replaced, the old one retired.
const release = (App) => { App._defaultPasswordHash = sha256(EDIT); App._defaultReportPasswordHash = sha256(NEW); App._retiredPasswordHashes = [sha256(OLD)]; };

(async () => {
  // ── the shipped configuration ──
  {
    const { App } = mk();
    const hex = /^[0-9a-f]{64}$/;
    check('the built-in edit password is the one the team has always used', App._defaultPasswordHash === '6b4a1673b225e8bf5f093b91be8c864427df32ca41b17cc0b82112b8f0185e41');
    check('the built-in reporting password changed in 2.1.2 and the old one is retired',
      App._defaultReportPasswordHash === 'cfd13fc46087f743a745a7028ada377981287741ffae338cfa77a95702061014' && App._retiredPasswordHashes.includes('895a6072c8d3559373b6f55e64569145e22cd56e6c0cb49d284dbab9578a72d1'));
    check('every hash is SHA-256 hex, and no current password is also retired',
      hex.test(App._defaultPasswordHash) && hex.test(App._defaultReportPasswordHash) && App._retiredPasswordHashes.every(h => hex.test(h))
      && !App._retiredPasswordHashes.includes(App._defaultPasswordHash) && !App._retiredPasswordHashes.includes(App._defaultReportPasswordHash));
    check('the legacy hash is plain SHA-256 of the password', (await App._hashPassword('abc')) === sha256('abc'));
  }

  // ── a fresh install (a colleague's download) ──
  {
    const { App, store } = mk(); release(App);
    await App._loadPasswordRecords();
    check('with nothing set locally, both roles check against the built-in passwords', App._editPasswordHash === sha256(EDIT) && App._reportPasswordHash === sha256(NEW));
    check('the built-in edit password unlocks', (await App.unlockEdit(EDIT)) === true && App.editUnlocked === true);
    check('…and is NOT copied onto the machine, so a later release can replace it', !store.has('surgdash_edit_password'));
    check('the new built-in reporting password unlocks reporting', (await App.unlockReport(NEW)) === true && App.reportAccess === true && !store.has('surgdash_report_password'));
    check('the retired reporting password is refused', (await App.unlockReport(OLD)) === false && (await App.unlockEdit(OLD)) === false);
    check('the app can name the situation', (await App.isRetiredPassword(OLD)) === true && (await App.isRetiredPassword(NEW)) === false && (await App.isRetiredPassword(EDIT)) === false && (await App.isRetiredPassword('')) === false);
  }

  // ── the colleague's machine: it kept a salted copy of the old built-in password ──
  {
    const { App, store, writes } = mk();
    store.set('surgdash_report_password', await App._makePasswordRecord(OLD));   // what 2.1.1 saved on her first successful unlock
    release(App);
    await App._loadPasswordRecords();
    check('at start-up the salted copy still wins (it cannot be recognised without the password)', String(App._reportPasswordHash).startsWith('pbkdf2$'));
    const before = writes.length;
    check('typing the old password is refused…', (await App.unlockReport(OLD)) === false && App.reportAccess === false);
    check('…the copy is dropped, silently for the sync banner, and the built-in password takes over',
      store.get('surgdash_report_password') === null && writes.slice(before).every(w => w.internal) && App._reportPasswordHash === sha256(NEW));
    check('the new password now works on her machine', (await App.unlockReport(NEW)) === true);
    check('a second try with the old password stays refused without touching anything', (await App.unlockReport(OLD)) === false && writes.length === before + 1);
  }

  // ── a plain (unsalted) copy from an older version ──
  {
    const { App, store } = mk();
    store.set('surgdash_report_password', sha256(OLD));
    release(App);
    await App._loadPasswordRecords();
    check('a plain copy of a retired password is dropped at start-up', store.get('surgdash_report_password') === null && App._reportPasswordHash === sha256(NEW));
  }

  // ── the administrator's machine: a password set deliberately ──
  {
    const { App, store } = mk(); release(App);
    await App._loadPasswordRecords();
    await App.setReportPassword(CUSTOM);
    const rec = store.get('surgdash_report_password');
    check('a password set in Settings is a salted record on this machine', String(rec).startsWith('pbkdf2$'));
    check('it wins over the built-in one', (await App.unlockReport(CUSTOM)) === true && (await App.unlockReport(NEW)) === false);
    check('typing a retired password does not disturb it', (await App.unlockReport(OLD)) === false && store.get('surgdash_report_password') === rec);
    await App.setEditPassword(CUSTOM + '-edit');
    check('the edit password behaves the same way', (await App.unlockEdit(CUSTOM + '-edit')) === true && (await App.unlockEdit(EDIT)) === false && String(store.get('surgdash_edit_password')).startsWith('pbkdf2$'));
    await App.setReportPassword(null);
    check('going back to the built-in password works at once, not only after a restart', (await App.unlockReport(NEW)) === true && store.get('surgdash_report_password') === null && App._reportPasswordHash === sha256(NEW));
    await App.setEditPassword(null);
    check('the same for the edit password', (await App.unlockEdit(EDIT)) === true && App._editPasswordHash === sha256(EDIT));
    check('Settings offers the built-in password instead of a removal that never stuck', (gv2 => /Use built-in password/.test(gv2) && !/Remove Password/.test(gv2) && !/fully editable by anyone\.'\)/.test(gv2))(fs.readFileSync(path.join(ROOT, 'js/genericViews.js'), 'utf8')));
  }

  // ── a reinstated password is not retired ──
  {
    const { App } = mk();
    App._defaultReportPasswordHash = sha256(OLD); App._retiredPasswordHashes = [sha256(OLD)];
    check('a hash that is both current and listed as retired counts as current', App._isRetiredHash(sha256(OLD)) === false && (await App.isRetiredPassword(OLD)) === false);
  }

  // ── wiring ──
  const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  const gv = fs.readFileSync(path.join(ROOT, 'js/genericViews.js'), 'utf8');
  check('both unlocks retire first', /async unlockEdit\(pw\) \{\s*if \(await this\._retirePassword\(pw, 'edit'\)\) return false;/.test(app) && /async unlockReport\(pw\) \{\s*if \(await this\._retirePassword\(pw, 'report'\)\) return false;/.test(app));
  check('start-up loads the records through the one method', /await this\._loadPasswordRecords\(\);/.test(app) && !/Storage\.getItem\('surgdash_edit_password'\)\)\s*\|\|/.test(app));
  check('the login modal tells a colleague the password was replaced, not that it is wrong', /isRetiredPassword\(pw\)\)\s*\? 'That password was replaced in an app update/.test(app));
  check('password records still never leave the machine in a push', /SECRET_KEYS = new Set\(\[[^\]]*'surgdash_edit_password', 'surgdash_report_password'\]\)/.test(gv));
  check('Settings says where passwords live', (gv.match(/stored on this computer only/gi) || []).length === 2 && /change the built-in one in a release/.test(gv));
  check('the release notes mention it', /Passwords travel with the app, not the Sheet/.test(fs.readFileSync(path.join(ROOT, 'js/whatsnew.js'), 'utf8')));

  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})();
