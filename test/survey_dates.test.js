// The survey sync's response date (updater.js _surveyDateCol): since Oct 2026 the export has
// "Started at" / "Ended at" and no "Date Time"; every response had taken the sync day.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 200) : '')); };
const src = fs.readFileSync(path.join(ROOT, 'js/updater.js'), 'utf8');
const i = src.indexOf('    _surveyDateCol(cols) {'), j = src.indexOf('    _djb2Hash(str) {');
const U = new Function('return {' + src.slice(i, j) + '}')();
check('new export: the completion time ("Ended at"), not the start', U._surveyDateCol(['Respondent', 'Country', 'Profession', 'Started at', 'Ended at', 'On a scale from 1 to 5, how would you rate your overall satisfaction with this course?']) === 'Ended at');
check('older exports keep their "Date Time" column', U._surveyDateCol(['User', 'Date Time', 'On a scale from 1 to 5…']) === 'Date Time' && U._surveyDateCol(['User', 'Fecha', 'Q']) === 'Fecha');
check('only a start time: use it rather than the sync day', U._surveyDateCol(['User', 'Started at', 'Q']) === 'Started at');
check('no date at all: none (the sync then falls back, as before)', U._surveyDateCol(['User', 'Q1']) === undefined);
check('the survey sync uses it', /const dateCol = this\._surveyDateCol\(cols\);/.test(src) && !/lk\.includes\('date'\) \|\| lk\.includes\('submitted'\) \|\| lk\.includes\('created'\) \|\| lk\.includes\('timestamp'\) \|\|\n\s*lk\.includes\('fecha'\)/.test(src));
const P = {}; new Function('window', fs.readFileSync(path.join(ROOT, 'js/pipeline.js'), 'utf8'))(P);
check('the date parser reads the new format', P.Pipeline ? P.Pipeline.parseDateToExact('1 Jul 2026 00:10:00') === '2026-07-01' && P.Pipeline.parseDateToMonth('12 Aug 2025 09:00:00') === '2025-08' : true, P.Pipeline ? P.Pipeline.parseDateToExact('1 Jul 2026 00:10:00') : 'Pipeline not exposed');
console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
