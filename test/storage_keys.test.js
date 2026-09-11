// Storage.keys() must list every file the forward map writes (survey_raw was invisible).
const vm = require('vm'), fs = require('fs'), path = require('path'), os = require('os');
const ROOT = require('path').resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 300) : '')); };
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stor-'));
for (const rel of ['surghub/survey_raw.json', 'surghub/data.json', 'surghub/completion.json', 'surghub/raw/enrolments__x/pull.jsonl', 'other/surghub_feedback_ai.json', 'settings/enrolment_sync.json', 'settings/course_links.json', 'projects/abc/targets.json', 'pending/submissions.json']) {
  fs.mkdirSync(path.dirname(path.join(dataDir, rel)), { recursive: true }); fs.writeFileSync(path.join(dataDir, rel), rel.endsWith('.json') ? '{"value":1}' : 'x');
}
const flatFs = Object.assign({}, fs, { readdirSync(dir, opts) { return fs.readdirSync(dir, { withFileTypes: true }).map(e => ({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile() })); } });
const ctx = { console, JSON, Object, Array, String, Number, Boolean, Date, Math, RegExp, Error, Promise, setTimeout, electronAPI: { fs: flatFs, path, os, dataDir } };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/storage.js'), 'utf8'), ctx, { filename: 'storage.js' });
(async () => {
  const keys = (await ctx.Storage.keys()).sort();
  check('survey_raw is now enumerated (as surghub_survey_raw)', keys.includes('surghub_survey_raw'), keys.join(','));
  check('other surghub keys, other/ keys and project keys still enumerated', keys.includes('surghub_data') && keys.includes('surghub_completion') && keys.includes('surghub_feedback_ai') && keys.includes('surgdash_targets_abc') && keys.includes('surgdash_course_links') && keys.includes('surgdash_pending_submissions'));
  check('device-local and raw files stay invisible (enrolment_sync bookkeeping, surghub/raw)', !keys.some(k => /enrolment_sync|enrolments__|pull/.test(k)) && !keys.includes('surghub_raw'));
  check('round trip: the key maps back to the same file', JSON.stringify(await ctx.Storage.getItem('surghub_survey_raw')) === '{"value":1}');
  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); process.exit(2); });
