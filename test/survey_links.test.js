// Survey links and the responses stored for them (23 Oct 2026). A course linked to another
// course's survey kept those 85 responses after its link was corrected, and a survey with no
// responses yet was only counted as "none/failed". This runs the real survey loop (updater.js
// executeSurveyLoop) against stubbed exports.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 300) : '')); };
const store = new Map(), alerts = [];
const SAT = 'On a scale from 1 to 5, how would you rate your overall satisfaction with this course?';
const exportsBy = {   // assessment id → rows the export returns (null = HTTP error)
  aaa: [{ 'Started at': '20 Oct 2026 10:00:00', 'Ended at': '20 Oct 2026 10:05:00', [SAT]: '5', 'Do you have additional comments?': 'Very clear and practical course' }, { 'Started at': '21 Oct 2026 10:00:00', 'Ended at': '21 Oct 2026 10:05:00', [SAT]: '4', 'Do you have additional comments?': '' }],
  empty: [], broken: null,
};
const ctx = { console: { log() {}, warn() {}, error() {} }, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, Date, Uint8Array, TextDecoder, isNaN, parseFloat, parseInt, setTimeout: (f) => f(), __swallowed() {},
  alert: (m) => alerts.push(m), document: { getElementById: () => null },
  fetch: async (u) => { const id = (String(u).match(/assessment\/([a-z]+)/) || [])[1]; const rows = exportsBy[id]; if (rows === null || rows === undefined) return { ok: false, status: 500 }; return { ok: true, arrayBuffer: async () => new Uint8Array([0x50, 0x4b, id.length]).buffer, _rows: rows }; },
  XLSX: { read: (bytes) => ({ SheetNames: ['s'], Sheets: { s: bytes } }), utils: { sheet_to_json: (sh) => JSON.parse(JSON.stringify(exportsBy[{ 3: 'aaa', 5: 'empty' }[sh[2]]] || [])) } },
  Storage: { async getItem(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; }, async setItem(k, v) { store.set(k, JSON.parse(JSON.stringify(v))); } } };
ctx.window = ctx;
ctx.window.Pipeline = { cleanNum: (v) => Number(String(v).replace(/[^\d.]/g, '')) || 0, parseDateToMonth: (t) => { const m = String(t).match(/(\d{4})/); return m ? m[1] + '-10' : null; }, parseDateToExact: () => '2026-10-21' };
ctx.App = { data: [], updateDate: '2026-10-23', renderView() {}, formatNumber: (n) => String(n), showMsg() {}, _updateApiSyncOverlay() {}, _hideApiSyncOverlay() {}, _stampSync: async () => {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/updater.js'), 'utf8'), ctx, { filename: 'updater.js' });
const App = ctx.App;
Object.assign(App, { _updateApiSyncOverlay() {}, _showApiSyncOverlay() {}, _hideApiSyncOverlay() {}, _stampSync: async () => {}, renderView() {} });
const url = (id) => 'https://api.example/assessment/' + id + '/submissions/export?access_token=old&type=csv';
(async () => {
  // the arm course still carries another course's responses from its old (wrong) link
  store.set('surghub_survey_raw', { 'Arm': { cols: ['Respondent'], data: [[1], [2]], fetchedAt: '2026-10-21' }, 'Good': { cols: ['Respondent'], data: [[1]], fetchedAt: '2026-10-21' } });
  const arm = { Course: 'Arm', Timestamp: '2026-10-23', URL: url('empty'), Responses: 85, Rating: '4.6', FeedbackBank: '[{"t":"Electrical burn management"}]', QuestionStats: '[]' };
  const good = { Course: 'Good', Timestamp: '2026-10-23', URL: url('aaa') };
  const down = { Course: 'Down', Timestamp: '2026-10-23', URL: url('broken'), Responses: 9, Rating: '4.1' };
  App.data = [arm, good, down]; App.updateQueue = [arm, good, down]; App.extractedToken = 'fresh'; App._rawSurveyResponses = null;
  await App.executeSurveyLoop();
  const raw = store.get('surghub_survey_raw');
  check('a survey with responses is read as before', good.Responses === 2 && Number(good.Rating) === 4.5 && JSON.parse(good.FeedbackBank).length === 1 && raw.Good.data.length === 2);
  check('an empty export: 0 responses, and everything stored from the old link is gone', arm.Responses === 0 && arm.Rating === undefined && arm.FeedbackBank === undefined && arm.QuestionStats === undefined && !raw.Arm && arm.URL === url('empty'), JSON.stringify(arm));
  check('a survey that could not be fetched keeps what it had', down.Responses === 9 && down.Rating === '4.1');
  const msg = alerts[alerts.length - 1] || '';
  check('the closing message names them: no responses yet / could not be fetched', /No responses yet[^]*• Arm/.test(msg) && /Could not be fetched[^]*• Down/.test(msg), msg);
  // changing a link drops the old survey's stored responses too
  store.set('surghub_survey_raw', { 'Arm': { cols: ['Respondent'], data: [[1]] } });
  App._rawSurveyResponses = null; App._surveyRawMap = { 'Arm': {} };
  const c = { Course: 'Arm', URL: url('aaa'), Responses: 3, Rating: '5', FeedbackBank: '[]' };
  App._clearSurveyStats(c);
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  check('_clearSurveyStats (link changed or shared) also removes the stored raw responses', c.URL === '' && c.Responses === undefined && !store.get('surghub_survey_raw').Arm && !App._surveyRawMap.Arm);
  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})().catch(e => { check('runs', false, e.stack); console.log(`\n${ok}/${ok + bad} passed`); process.exit(1); });
