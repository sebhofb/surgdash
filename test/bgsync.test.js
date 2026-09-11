// Unit test of js/backgroundSync.js with stubbed syncs, storage, DOM and clock.
const vm = require('vm'), fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 220) : '')); };
const mk = (opts) => {
  opts = opts || {};
  const store = new Map(); if (opts.stored) store.set('surgdash_bg_sync', opts.stored);
  const dom = { nodes: {}, body: { appendChild(n) { dom.nodes[n.id] = n; } } };
  const mkEl = () => ({ id: '', style: {}, innerHTML: '', textContent: '', remove() { delete dom.nodes[this.id]; } });
  const calls = [], timers = [];
  const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, isNaN, isFinite, parseInt, parseFloat,
    setTimeout: (fn, ms) => { timers.push(['timeout', ms, fn]); return 1; }, setInterval: (fn, ms) => { timers.push(['interval', ms, fn]); return 2; }, clearInterval() {},
    __swallowed: () => {},
    Storage: { async getItem(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; }, async setItem(k, v) { store.set(k, JSON.parse(JSON.stringify(v))); } },
    document: { body: dom.body, getElementById: (id) => dom.nodes[id] || (id === 'bg-sync-pill-text' && dom.nodes['bg-sync-pill'] ? dom.nodes['bg-sync-pill'].textEl : null), createElement: () => { const e = mkEl(); Object.defineProperty(e, 'innerHTML', { set(v) { this._html = v; this.textEl = { textContent: '' }; }, get() { return this._html; } }); return e; }, addEventListener() {} },
    LearnWorlds: { async getCredentials() { return opts.creds === false ? { clientId: '', apiToken: '' } : { clientId: 'c', apiToken: 't' }; } },
  };
  ctx.window = ctx; Object.assign(ctx, opts.globals || {});
  const meta = opts.meta === undefined ? { lastRunEpoch: 1757000000 } : opts.meta;
  ctx.App = { view: 'upload', _apiSyncInFlight: false, msgs: [], renders: 0,
    escapeHtml: (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    showMsg(m) { this.msgs.push(m); }, renderView() { this.renders++; }, navigate() {}, cancelLearnWorldsSync() { calls.push('cancel'); },
    async syncDemographicsFromApi(o) { calls.push('demo' + (o && o.silent ? ':silent' : '')); if (opts.demoFail) throw new Error(opts.demoFail); return { totalUsers: 63256 }; },
    async syncAmbassadorsFromApi(o) { calls.push('amb' + (o && o.silent ? ':silent' : '')); return { totalReferrals: 3286 }; },
    async syncEnrolmentsFromApi(o) { calls.push('enr' + (o && o.silent ? ':silent' : '')); if (opts.enrCancel) throw new Error('Sync cancelled by user.'); return { mode: 'incremental', done: 412, certsNew: 37 }; },
    async _enrLoadMeta() { return meta || {}; },
  };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(ROOT + '/js/backgroundSync.js', 'utf8'), ctx, { filename: 'backgroundSync.js' });
  return { App: ctx.App, store, calls, timers, dom };
};
(async () => {
  // defaults + persistence
  let h = mk(); let s = await h.App._bgLoad();
  check('defaults: off, 02:00, both cards', s.enabled === false && s.hour === 2 && s.cards.learners && s.cards.enrolments);
  await h.App._bgSet({ enabled: true, hour: 3, cards: { enrolments: false } });
  check('settings saved as an internal device setting', JSON.stringify(h.store.get('surgdash_bg_sync')).includes('"hour":3') && h.store.get('surgdash_bg_sync').cards.enrolments === false && h.store.get('surgdash_bg_sync').cards.learners === true);
  await h.App._bgSet({ hour: 99 }); check('invalid hour falls back to the default', (await h.App._bgLoad()).hour === 2);
  // due logic
  h = mk(); s = await h.App._bgLoad(); s.enabled = true; s.hour = 2;
  const at = (hh, day) => new Date(2026, 8, day || 10, hh, 30);
  check('not due before the hour', h.App._bgDue(s, at(1)) === false);
  check('due after the hour when not yet run today', h.App._bgDue(s, at(9)) === true);
  s.lastRun = { day: '2026-09-10' }; check('not due again the same day', h.App._bgDue(s, at(23)) === false);
  check('due the next day after the hour', h.App._bgDue(s, at(2, 11)) === true);
  s.enabled = false; check('never due when disabled', h.App._bgDue(s, at(9, 11)) === false);
  // a sync run by hand today counts as today's run
  s.enabled = true; s.lastRun = null; s.cards = { learners: true, enrolments: true };
  h.App._syncLog = { learners: '2026-09-11', enrolments: '2026-09-11' }; check('not due when both enabled cards were synced by hand today', h.App._bgDue(s, at(9, 11)) === false);
  h.App._syncLog = { learners: '2026-09-11', enrolments: '2026-09-10' }; check('still due when only one enabled card was synced today', h.App._bgDue(s, at(9, 11)) === true);
  s.cards = { learners: true, enrolments: false }; check('cards not enabled are ignored by that rule', h.App._bgDue(s, at(9, 11)) === false);
  h.App._syncLog = undefined; s.cards = { learners: true, enrolments: true };
  // tick gating
  h = mk({ stored: { enabled: true, hour: 0 } }); h.App._bgLastInput = Date.now();
  check('tick skips while the user is active', (await h.App._bgTick()) === false && h.calls.length === 0);
  h.App._bgLastInput = Date.now() - 10 * 60 * 1000; h.App._apiSyncInFlight = true;
  check('tick skips while another sync runs', (await h.App._bgTick()) === false && h.calls.length === 0);
  h.App._apiSyncInFlight = false;
  const hc = mk({ stored: { enabled: true, hour: 0 }, creds: false }); hc.App._bgLastInput = Date.now() - 10 * 60 * 1000;
  check('tick skips without API credentials (viewer machine)', (await hc.App._bgTick()) === false && hc.calls.length === 0);
  check('tick runs when due, idle and credentialed', (await h.App._bgTick()) === true && h.calls.join(',') === 'demo:silent,amb:silent,enr:silent', h.calls.join(','));
  s = await h.App._bgLoad();
  check('run logged: ok, today, scheduled, three steps with notes', s.lastRun && s.lastRun.ok && s.lastRun.trigger === 'scheduled' && s.lastRun.day === h.App._bgDayKey() && s.lastRun.steps.length === 3 && /412 accounts refreshed/.test(s.lastRun.steps[2].note) && /37 new certificates/.test(s.lastRun.steps[2].note), JSON.stringify(s.lastRun.steps.map(x => x.note)));
  check('view re-rendered after the run; flags cleared; pill removed', h.App.renders >= 1 && !h.App._bgRunning && !h.App._bgSyncRunning && !h.App._apiSyncInFlight && !h.dom.nodes['bg-sync-pill']);
  check('a second tick the same day does nothing', (await h.App._bgTick()) === false && h.calls.length === 3);
  // card 2 guard: no completed full pass and no open run → skipped with a note
  h = mk({ stored: { enabled: true, hour: 0 }, meta: {} }); h.App._bgLastInput = 0;
  await h.App._bgTick(); s = await h.App._bgLoad();
  check('card 2 skipped when no full pass has completed (never starts a 30-hour run unattended)', h.calls.join(',') === 'demo:silent,amb:silent' && /skipped/.test(s.lastRun.steps[2].note), s.lastRun.steps[2].note);
  h = mk({ stored: { enabled: true, hour: 0 }, meta: { run: { done: false, processed: {} } } }); h.App._bgLastInput = 0;
  await h.App._bgTick(); check('an open (paused) run is resumed in the background', h.calls.includes('enr:silent'));
  // a failing step is recorded and the others still run
  h = mk({ stored: { enabled: true, hour: 0 }, demoFail: 'API error 502' }); h.App._bgLastInput = 0;
  await h.App._bgTick(); s = await h.App._bgLoad();
  check('a failed step is logged and the rest continues', h.calls.join(',') === 'demo:silent,amb:silent,enr:silent' && s.lastRun.ok === false && /Learners & demographics: API error 502/.test(s.lastError), s.lastError);
  // cancel stops the run
  h = mk({ stored: { enabled: true, hour: 0, cards: { learners: false, enrolments: true } }, enrCancel: true }); h.App._bgLastInput = 0;
  await h.App._bgTick(); s = await h.App._bgLoad();
  check('Stop (cancel) ends the run cleanly and is logged', s.lastRun.steps.some(x => /cancelled/i.test(x.note)) && !h.App._bgRunning);
  // manual run: allowed while active, reports a toast
  h = mk({ stored: { enabled: false } }); h.App._bgLastInput = Date.now();
  await h.App._bgRunNow(); check('Run now works even when disabled and active, and reports', h.calls.length === 3 && h.App.msgs.some(m => /Background sync finished/.test(m)), h.App.msgs[0]);
  // pill routing
  h = mk(); h.App._bgSyncRunning = true; h.App._bgStep = 'Enrolments & progress'; h.App._bgProgress('Listing accounts… page 12/317', 7);
  const pill = h.dom.nodes['bg-sync-pill'];
  check('progress pill created with step, text and Stop/Details', !!pill && /Background sync · Enrolments & progress — Listing accounts… page 12\/317 \(7%\)/.test(pill.textEl.textContent) && /Stop/.test(pill.innerHTML) && /Details/.test(pill.innerHTML), pill && pill.textEl.textContent);
  // panel html
  h = mk({ stored: { enabled: true, hour: 2, lastRun: { at: '2026-09-10T02:14:00Z', day: '2026-09-10', trigger: 'scheduled', ok: true, ms: 660000, steps: [{ label: 'Learners & demographics', ok: true, note: '63,256 accounts' }, { label: 'Ambassadors', ok: true, note: '3,286 referrals' }, { label: 'Enrolments & progress', ok: true, note: 'incremental · 412 accounts refreshed' }] } } });
  await h.App._bgLoad(); h.App._bgHasCreds = true;
  const html = h.App._bgSyncPanelHtml();
  check('panel renders: on, hour select, last run summary, Run now', /Background sync/.test(html) && /checked onchange="App\._bgSet\(\{ enabled: this\.checked \}\)"/.test(html) && /<option value="2" selected>02:00/.test(html) && /63,256 accounts/.test(html) && /412 accounts refreshed/.test(html) && /Run now/.test(html) && !/\$\{/.test(html), html.length);
  h.App._bgHasCreds = false; check('panel flags missing credentials', /needs API credentials/.test(h.App._bgSyncPanelHtml()));
  // wiring
  const upd = fs.readFileSync(ROOT + '/js/updater.js', 'utf8'), app = fs.readFileSync(ROOT + '/js/app.js', 'utf8'), ui = fs.readFileSync(ROOT + '/js/ui.js', 'utf8'), st = fs.readFileSync(ROOT + '/js/storage.js', 'utf8'), idx = fs.readFileSync(ROOT + '/index.html', 'utf8');
  check('overlay updates route to the pill during a background run', /_updateApiSyncOverlay\(text, pct\) \{\n\s+\/\/ A background run[^\n]*\n\s+if \(this\._bgSyncRunning\) \{ if \(this\._bgProgress\) this\._bgProgress\(text, pct\); return; \}/.test(upd));
  check('scheduler starts in init after the other timers', /_startCloudFreshnessCheck\(\);\n\s+if \(this\._bgSyncStart\) this\._bgSyncStart\(\);/.test(app));
  check('panel sits above card 1 on Data Sync; script loaded; key mapped + nav-key', /_bgSyncPanelHtml\(\) : ''\}\n(\s+\$\{this\._digestPanelHtml[^\n]*\n)?\s+<!-- ── 1\. Sync Courses/.test(ui) && /backgroundSync\.js/.test(idx) && /surgdash_bg_sync'\)\s+return path\.join\('settings', 'bg_sync\.json'\)/.test(st) && /'surgdash_bg_sync',\s+\/\/ background-sync/.test(st));
  // silent paths of the real syncs must not navigate or alert: every such call must sit inside an `if (!opts.silent) {` block
  const gated = (fnName) => {
    const lines = upd.split('\n'); const start = lines.findIndex(l => l.includes('async ' + fnName + '(opts)'));
    let end = start + 1; while (end < lines.length && !/^    async [a-zA-Z_]+\(/.test(lines[end])) end++;
    const bad = [];
    for (let k = start; k < end; k++) {
      const l = lines[k]; if (!/\b(navigate|alert|confirm)\(/.test(l) || /if \(!opts\.silent\)/.test(l)) continue;
      const ind = l.match(/^\s*/)[0].length; let p = k - 1, okk = false;
      while (p > start) { const pl = lines[p]; const pind = pl.match(/^\s*/)[0].length; if (pl.trim() && pind < ind) { okk = /if \(!opts\.silent\) \{/.test(pl); break; } p--; }
      if (!okk) bad.push(k + 1 + ': ' + l.trim().slice(0, 60));
    }
    return bad;
  };
  const badDemo = gated('syncDemographicsFromApi'), badAmb = gated('syncAmbassadorsFromApi');
  check('card-3 syncs: every navigate/alert/confirm is inside a non-silent block', badDemo.length === 0 && badAmb.length === 0, JSON.stringify(badDemo.concat(badAmb)));
  // ── publish to Sheets after the cards ──
  {
    const pub = []; const globals = (url) => { const o = {};
      o.Projects = { async getAppSettings() { return { googleSheetsUrl: url }; } };
      o.GenericViews = { async _sheetsPushRun(x) { pub.push(typeof x.progress); return o.result || { ok: true, errors: [], projects: { pushed: ['a'], skipped: [], failed: [] }, org: 'pushed', surghub: 'skipped', backup: 'pushed', ms: 1200 }; } };
      o.SheetsSync = { describe: (r) => (r.ok ? '1 project updated · org summary · SURGhub data unchanged · backup — 1 s' : 'failed') + '\nSlow protocol note' };
      return o; };
    check('publish is OFF by default', mk().App._bgDefaults().cards.publish === false);
    let g = globals('https://script.google.com/macros/s/x/exec');
    let h = mk({ stored: { enabled: true, hour: 0, cards: { learners: true, enrolments: true, publish: true } }, globals: g }); h.App._bgLastInput = Date.now() - 10 * 60 * 1000;
    await h.App._bgTick(); let s2 = await h.App._bgLoad();
    const pstep = s2.lastRun.steps.find(x => x.label === 'Publish to Sheets');
    check('editor device: a 4th step publishes after the cards, note = first line of the summary, progress wired', pstep && pstep.ok && pstep.note === '1 project updated · org summary · SURGhub data unchanged · backup — 1 s' && pub.length === 1 && pub[0] === 'function' && s2.lastRun.steps.length === 4 && s2.lastRun.ok, JSON.stringify(s2.lastRun.steps));
    pub.length = 0;
    h = mk({ stored: { enabled: true, hour: 0, cards: { learners: true, enrolments: true, publish: true } }, globals: g }); h.store.set('surgdash_autopull_enabled', true); h.App._bgLastInput = Date.now() - 10 * 60 * 1000;
    await h.App._bgTick(); s2 = await h.App._bgLoad();
    check('viewer device (auto-pull on): publish skipped with a note, push never called', /skipped — this device auto-pulls/.test(s2.lastRun.steps[3].note) && s2.lastRun.steps[3].ok && pub.length === 0);
    h = mk({ stored: { enabled: true, hour: 0, cards: { learners: true, enrolments: true, publish: true } }, globals: globals('') }); h.App._bgLastInput = Date.now() - 10 * 60 * 1000;
    await h.App._bgTick(); s2 = await h.App._bgLoad();
    check('no Apps Script URL: publish skipped with a note', /skipped — no Apps Script URL/.test(s2.lastRun.steps[3].note) && pub.length === 0);
    h = mk({ stored: { enabled: true, hour: 0, cards: { learners: true, enrolments: true } }, globals: g }); h.App._bgLastInput = Date.now() - 10 * 60 * 1000;
    await h.App._bgTick(); s2 = await h.App._bgLoad();
    check('publish off: three steps as before', s2.lastRun.steps.length === 3 && pub.length === 0);
    g = globals('https://script.google.com/macros/s/x/exec'); g.result = { ok: false, errors: ['SURGhub data: unauthorised — this Sheet requires the sync key'], projects: { pushed: [], skipped: [], failed: [] }, org: 'failed', surghub: 'failed', backup: 'failed', ms: 300 };
    h = mk({ stored: { enabled: true, hour: 0, cards: { learners: true, enrolments: true, publish: true } }, globals: g }); h.App._bgLastInput = Date.now() - 10 * 60 * 1000;
    await h.App._bgTick(); s2 = await h.App._bgLoad();
    check('a failed publish is recorded as a failed step with the reason; the cards still count as done', !s2.lastRun.ok && /Publish to Sheets: .*sync key/.test(s2.lastError) && s2.lastRun.steps.slice(0, 3).every(x => x.ok));
    const src = fs.readFileSync(ROOT + '/js/backgroundSync.js', 'utf8');
    check('panel offers the Publish checkbox (edit-only) next to the cards', /cards: \{ publish: this\.checked \}[^\n]*Publish to Sheets<\/label>/.test(src) && /data-edit-only \$\{s\.cards\.publish/.test(src));
  }
  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); process.exit(2); });
