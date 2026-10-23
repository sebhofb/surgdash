// Survey comments are never timestamps (23 Oct 2026): the export added "Started at" beside
// "Ended at" and the sync captured it as a free-text answer — 40,804 of 115,651 stored comments
// read like "15 Oct 2026 11:45:49." This runs the sync's own column detection (updater.js, from
// the rating column to the text columns) on a real export's headings and answers.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 200) : '')); };
const src = fs.readFileSync(path.join(ROOT, 'js/updater.js'), 'utf8');
const piece = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
const U = new Function('return {' + piece('    _surveyDateCol(cols) {', '    _djb2Hash(str) {') + piece('    _isTimestampText(v) {', '    _ratingFromQuestionStats(qs) {') + '}')();
const a = src.indexOf('const rCol = cols.find('), b = src.indexOf('if (rColFinal) {', a);
const detect = new Function('cols', 'json', src.slice(a, b) + '\nreturn { rColFinal, scaleCols, textCols, dateCol };');
const cols = ['Respondent', 'Country', 'Profession', 'Started at', 'Ended at',
  'On a scale from 1 to 5, how would you rate your overall satisfaction with this course?',
  'What aspects of this course did you find most interesting?',
  'Did you encounter any technical issues while taking the course? If yes, please describe.',
  'Do you have additional comments?'];
const json = [1, 2, 3, 4, 5].map(i => ({ Respondent: String(i), Country: 'Kenya', Profession: 'Surgeon', 'Started at': '1' + i + ' Oct 2026 11:45:49', 'Ended at': '1' + i + ' Oct 2026 11:52:10',
  [cols[5]]: '5', [cols[6]]: 'The case discussions on pelvic fixation were very practical', [cols[7]]: 'No', [cols[8]]: i % 2 ? 'Thank you for this excellent course' : '' }));
const r = detect.call(U, cols, json);
check('"Started at" and "Ended at" are never comment columns', !r.textCols.includes('Started at') && !r.textCols.includes('Ended at'), JSON.stringify(r.textCols));
check('the real comment questions still are', [cols[6], cols[7], cols[8]].every(c => r.textCols.includes(c)) && r.dateCol === 'Ended at');
check('nor Respondent, Country or Profession', !['Respondent', 'Country', 'Profession'].some(c => r.textCols.includes(c)));
// a date column under some other heading still is not prose
const r2 = detect.call(U, ['User', 'Ended at', 'Submitted on (local)', 'Comments'], json.map(x => ({ User: x.Respondent, 'Ended at': x['Ended at'], 'Submitted on (local)': x['Started at'], Comments: 'A long and useful comment about the course' })));
check('any column of timestamps, whatever its heading, is not read as comments', !r2.textCols.includes('Submitted on (local)') && r2.textCols.includes('Comments'), JSON.stringify(r2.textCols));
// the timestamp test itself
const T = (t) => U._isTimestampText(t);
check('timestamps in the forms seen', ['15 Oct 2026 11:45:49.', '15 Oct 2026 11:45:49', '2026-10-15 11:45', '2026-10-15T11:45:49Z', '15/10/2026', '5 oct. 2026 9:05'].every(T));
check('real comments are not', !['Very good, thank you', 'Oct 2026 was busy', '5 stars', 'Module 3 at 11:45 froze', 'Great!'].some(T));
// stored comments are cleaned by the course sync
const App = Object.assign({}, U, new Function('return {' + piece('    _stripTimestampFeedback() {', '    _ratingFromQuestionStats(qs) {') + '}')());
App.data = [{ Course: 'A', FeedbackBank: JSON.stringify([{ t: '15 Oct 2026 11:45:49.' }, { t: 'Excellent course' }]) }, { Course: 'B', FeedbackBank: JSON.stringify([{ t: '12 Oct 2026 20:22:32' }]) }, { Course: 'C' }];
const n = App._stripTimestampFeedback();
check('stored timestamp comments are removed (and an emptied list dropped)', n === 2 && JSON.parse(App.data[0].FeedbackBank).length === 1 && App.data[1].FeedbackBank === undefined, n);
check('the course sync runs the clean-up', /const strippedTimes = this\._stripTimestampFeedback\(\);/.test(src));
console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
