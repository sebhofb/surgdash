// The survey sync reads each course's 1–5 questions by their wording, in every language a course is
// taught in. An Arabic course showed 0 rated responses (Oct 2026): no Arabic wording was known, so it
// had no Rating and no QuestionStats. This runs the sync's own column detection (updater.js, the block
// from the rating column to the user column) on real headings in each language.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 200) : '')); };
const src = fs.readFileSync(path.join(ROOT, 'js/updater.js'), 'utf8');
const a = src.indexOf('const rCol = cols.find('), b = src.indexOf('const userCol = cols.find(');
const i = src.indexOf('    _surveyDateCol(cols) {'), j = src.indexOf('    _djb2Hash(str) {');
const U = new Function('return {' + src.slice(i, j) + '}')();
const detect = new Function('cols', src.slice(a, b) + '\nreturn { rCol, rColFinal, scaleCols, dateCol };');
check('the detection block is found', a > 0 && b > a);

const AR = ['Respondent', 'Country', 'Profession', 'Started at', 'Ended at',
  'على مقياس من 1 إلى 5، ما مدى رضاك عن هذه الدورة؟',
  'على مقياس من 1 إلى 5، إلى أي مدى ساعدتك هذه الدورة على تحقيق أهداف التعلّم المذكورة في وصف الدورة؟',
  'على مقياس من 1 إلى 5، إلى أي مدى بدا لك محتوى الدورة ذا صلة وجذاباً؟',
  'إلى أي مدى توافق على العبارة التالية: "كانت المعلومات المقدمة في هذه الدورة (المعارف، المفاهيم، المهارات، إلخ) جديدة بالنسبة لي"؟',
  'إلى أي مدى توافق على العبارة التالية: "محتوى الدورة ذو صلة بعملي". إذا كنت حاليًا بلا عمل، يُرجى اختيار 0',
  'إلى أي مدى توافق على العبارة التالية: «من المرجّح أن أستخدم المعلومات التي اكتسبتها في هذه الدورة»؟',
  'ما هي أهمية المعارف والمهارات التي اكتسبتها في هذه الدورة لنجاحك المهني؟ إذا كنت حالياً بلا وظيفة، يرجى اختيار 0.',
  'ما الجوانب التي وجدتها الأكثر إثارة للاهتمام في هذه الدورة؟',
  'ما الجوانب التي وجدتها الأقل إثارة للاهتمام في هذه الدورة؟ وكيف يمكن تحسينها؟',
  'على مقياس من 1 إلى 5، إلى أي مدى كان استخدام المنصة سهلًا وموثوقًا؟',
  'هل واجهت أي مشكلات تقنية أثناء حضور الدورة؟ إذا كانت الإجابة نعم، يُرجى وصفها أدناه.',
  'هل لديك أي تعليقات أخرى؟'];
const ar = detect.call(U, AR);
check('Arabic: the satisfaction question is the rating column', ar.rCol === AR[5] && ar.rColFinal === AR[5], ar.rColFinal);
check('Arabic: all eight 1–5 questions are scored, none of the open ones', ar.scaleCols.length === 8 && [5, 6, 7, 8, 9, 10, 11, 14].every(k => ar.scaleCols.includes(AR[k])), ar.scaleCols.length);
check('Arabic: dated by "Ended at"', ar.dateCol === 'Ended at');

const EN = ['Respondent', 'Ended at', 'On a scale from 1 to 5, how would you rate your overall satisfaction with this course?', 'How strongly do you agree with the following statement: "The information presented in this course was new to me"?', 'How important are the knowledge/skills acquired in the event to your job success?', 'Do you have any other comments?'];
const en = detect.call(U, EN);
check('English unchanged', en.rColFinal === EN[2] && en.scaleCols.length === 3);
const ES = ['Usuario', 'Ended at', 'En una escala del 1 al 5 ¿cuál describe mejor su satisfacción general con el curso?', '¿Qué tan de acuerdo está con la siguiente afirmación?: La información fue nueva para mí'];
const es = detect.call(U, ES);
check('Spanish unchanged', es.rColFinal === ES[2] && es.scaleCols.length === 2);
const FR = ['Utilisateur', 'Ended at', 'Sur une échelle de 1 à 5, quel est votre niveau de satisfaction concernant ce cours ?', 'Dans quelle mesure êtes-vous d\'accord : les informations étaient nouvelles pour moi'];
const fr = detect.call(U, FR);
check('French unchanged', fr.rColFinal === FR[2] && fr.scaleCols.length === 2);

// Everything downstream that matches a question by its wording knows the Arabic too.
const has = (file, word) => fs.readFileSync(path.join(ROOT, file), 'utf8').includes(word);
check('downstream matchers know the Arabic wording (feed, compare, insights, reports, rating backfill)',
  has('js/coursesFeed.js', 'رضاك') && has('js/coursesFeed.js', 'أهداف التعل') && has('js/compare.js', 'رضاك') && has('js/ui.js', 'أستخدم المعلومات') && has('js/reports.js', 'نجاحك المهني') && /niveau de satisfaction\|رضاك/.test(src));
console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
