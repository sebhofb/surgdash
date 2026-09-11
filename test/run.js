#!/usr/bin/env node
// SURGdash test runner.
//   npm test            every test/*.test.js — fixture-based, no network, no app data (Node 20+)
//   npm run test:live   also test/live/*.test.js, which read this Mac's SURGdash data folder
//                       (SURGDASH_DATA or the default) and are skipped when it is absent, e.g. in CI
//   node test/run.js sheets   only suites whose file name contains "sheets"
// Each suite prints PASS/FAIL lines and ends with "N/M passed"; the runner sums them up and
// exits non-zero on any failure, so a red mark on GitHub means exactly one thing.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const args = process.argv.slice(2);
const live = args.includes('--live') || args.includes('--all');
const only = args.filter(a => !a.startsWith('--'));
const list = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort().map(f => path.join(dir, f)) : [];
const dataDir = process.env.SURGDASH_DATA || path.join(os.homedir(), 'Library', 'Application Support', 'surgdash', 'data');
let files = list(__dirname);
if (live) {
  if (fs.existsSync(path.join(dataDir, 'surghub', 'completion.json'))) files = files.concat(list(path.join(__dirname, 'live')));
  else console.log('live suites skipped — no SURGdash data folder at ' + dataDir + '\n');
}
if (only.length) files = files.filter(f => only.some(o => path.basename(f).includes(o)));
let passed = 0, failed = 0, broken = 0; const t0 = Date.now();
for (const f of files) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [f], { encoding: 'utf8', env: Object.assign({}, process.env, { SURGDASH_DATA: dataDir }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+)\/(\d+) passed/);
  const fails = out.split('\n').filter(l => l.startsWith('FAIL'));
  const name = path.relative(__dirname, f);
  if (!m) { broken++; console.log('✗ ' + name + ' — did not finish\n' + out.split('\n').filter(Boolean).slice(-10).map(l => '    ' + l).join('\n')); continue; }
  passed += Number(m[1]); failed += Number(m[2]) - Number(m[1]);
  console.log((fails.length ? '✗ ' : '✓ ') + name.padEnd(34) + m[0].padStart(14) + '  ' + Math.round((Date.now() - t) / 1000) + ' s');
  fails.forEach(l => console.log('    ' + l.slice(0, 220)));
}
const bad = failed || broken;
console.log('\n' + (bad ? 'FAILED' : 'OK') + ' — ' + passed + ' checks passed' + (failed ? ', ' + failed + ' failed' : '') + (broken ? ', ' + broken + ' suite(s) did not finish' : '') + ' in ' + Math.round((Date.now() - t0) / 1000) + ' s');
process.exit(bad ? 1 : 0);
