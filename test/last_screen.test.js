// Unit test of remember/restore of the last screen (uiState.js loaded for real, fake App).
const vm = require('vm'), fs = require('fs');
const store = new Map();
const mk = (opts) => {
  const ctx = { console, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, setTimeout, clearTimeout, __swallowed: () => {},
    Storage: { async getItem(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; }, async setItem(k, v) { store.set(k, JSON.parse(JSON.stringify(v))); } },
    Projects: { getProject: (id) => opts.projects[id] || null } };
  ctx.window = ctx;
  ctx.App = { view: null, currentProject: opts.current, selectedCourse: null, selectedProvider: null, data: opts.data || [], editUnlocked: opts.unlocked !== false, renderView() {},
    getCurrentProject() { return this.currentProject === 'org' ? { id: 'org', type: 'org' } : this.currentProject === 'surghub' ? { id: 'surghub', type: 'surghub' } : opts.projects[this.currentProject] || null; } };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(require('path').resolve(__dirname, '..', 'js', 'uiState.js'), 'utf8'), ctx); return ctx.App;
};
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + d : '')); };
const projects = { p1: { id: 'p1', type: 'field' } };
const data = [{ Course: 'Course A', Provider: 'Prov X' }];
const tick = () => new Promise(r => setTimeout(r, 500));
(async () => {
  let A = mk({ current: 'surghub', projects, data }); await A._loadUiState();
  A.view = 'course'; A.selectedCourse = 'Course A'; A._rememberScreen();
  check('remembers project, view and course while unlocked', JSON.stringify(A._uiState._lastScreen) === JSON.stringify({ project: 'surghub', view: 'course', course: 'Course A', provider: null }), JSON.stringify(A._uiState._lastScreen));
  A.view = 'new-project'; A._rememberScreen();
  check('creation flow is not remembered', A._uiState._lastScreen.view === 'course');
  A.editUnlocked = false; A.currentProject = 'org'; A.view = 'org-dashboard'; A._rememberScreen(); A.editUnlocked = true; A.currentProject = 'surghub';
  check('read-only renders (the startup screen) do not overwrite the memory', A._uiState._lastScreen.view === 'course' && A._uiState._lastScreen.project === 'surghub');
  await tick();
  check('saved to the device-local UI state', !!(store.get('surgdash_ui_state') || {})._lastScreen);
  // unlock-time restore: still on the startup screen
  let B = mk({ current: 'org', projects, data, unlocked: false }); await B._loadUiState(); B.view = 'org-dashboard'; B._startupViewKey = 'org::org-dashboard'; B._lastRenderedViewKey = 'org::org-dashboard'; B.editUnlocked = true;
  check('unlock while still on the startup screen → back to the course page on the surghub project', B._restoreLastScreenOnUnlock() === true && B.view === 'course' && B.selectedCourse === 'Course A' && B.currentProject === 'surghub');
  await new Promise(r => setTimeout(r, 20));
  check('switching project on restore also records it as the last project', store.get('surgdash_last_project') === 'surghub');
  // unlock after navigating elsewhere: leave the editor where they are
  let B2 = mk({ current: 'org', projects, data, unlocked: false }); await B2._loadUiState(); B2.view = 'org-map'; B2._startupViewKey = 'org::org-dashboard'; B2._lastRenderedViewKey = 'org::org-map'; B2.editUnlocked = true;
  check('unlock after navigating → no jump', B2._restoreLastScreenOnUnlock() === false && B2.view === 'org-map' && B2.currentProject === 'org');
  let C = mk({ current: 'surghub', projects, data: [] }); await C._loadUiState(); C.view = 'platform'; C.selectedCourse = null;
  check('missing course falls back to the platform view', C._restoreLastScreen() === true && C.view === 'platform' && C.selectedCourse === null);
  A.view = 'provider'; A.selectedProvider = 'Prov X'; A._rememberScreen(); await tick();
  let D = mk({ current: 'surghub', projects, data }); await D._loadUiState(); D.view = 'platform';
  check('restores the provider page', D._restoreLastScreen() === true && D.view === 'provider' && D.selectedProvider === 'Prov X');
  A.currentProject = 'org'; A.view = 'org-map'; A._rememberScreen(); await tick();
  let E = mk({ current: 'p1', projects, data }); await E._loadUiState(); E.view = 'project-dashboard';
  check('restores an org view (switching to the org project)', E._restoreLastScreen() === true && E.view === 'org-map' && E.currentProject === 'org');
  A.currentProject = 'p9'; A.view = 'project-activities'; A._rememberScreen(); await tick();
  let F = mk({ current: 'org', projects, data }); await F._loadUiState(); F.view = 'org-dashboard';
  check('unknown project → keeps the default view', F._restoreLastScreen() === false && F.view === 'org-dashboard' && F.currentProject === 'org');
  A.currentProject = 'surghub'; A.view = 'upload'; A._rememberScreen(); await tick();
  let G = mk({ current: 'org', projects, data }); await G._loadUiState(); G.view = 'org-dashboard';
  check('restores Data Sync (upload) on the surghub project', G._restoreLastScreen() === true && G.view === 'upload' && G.currentProject === 'surghub');
  await G.resetUiState(); await new Promise(r => setTimeout(r, 50));
  check('reset view preferences forgets the last screen', !G._uiState._lastScreen && !((store.get('surgdash_ui_state') || {})._lastScreen));
  // wiring
  const app = fs.readFileSync(require('path').resolve(__dirname, '..', 'js', 'app.js'), 'utf8'), ui = fs.readFileSync(require('path').resolve(__dirname, '..', 'js', 'ui.js'), 'utf8');
  const u = app.indexOf('async unlockEdit(pw)'); const body = app.slice(u, app.indexOf('return true;', u));
  check('unlockEdit restores after setting editUnlocked and before rendering', /this\.editUnlocked = true;[\s\S]*_restoreLastScreenOnUnlock\(\)[\s\S]*this\.renderView\(\);/.test(body));
  check('init records the startup view key right after the first render', /if \(this\.renderView\) this\.renderView\(\);\n\s+this\._startupViewKey = this\.currentProject \+ '::' \+ this\.view;/.test(app));
  check('renderView records the screen', /this\._lastRenderedViewKey = viewKey;\n\s+if \(this\._rememberScreen\) this\._rememberScreen\(\);/.test(ui));
  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})();
