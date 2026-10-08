// Free-text scrubbing (js/scrub.js): what a learner typed about themselves in a comment
// (email, phone, profile link, their name) never reaches a provider; everything else stays.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };
const ctx = { console, Set, String, RegExp, Math, Object, Array };
ctx.window = ctx; ctx.App = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/scrub.js'), 'utf8'), ctx);
const App = ctx.App;
App._rawCompletion = [{ name: 'Amara Okonkwo-Bello' }, { name: 'José  Ramírez' }, { name: 'Explain It' }, { name: 'The Next Level' }, { name: 'Sierra Leone' }, { name: 'Li' }, { name: 'Ngozi Adeyemi' }];
const S = (t) => App.scrubPersonal(t);

check('an email is removed', S('Please contact me at amara.ok+1@gmail.com thanks') === 'Please contact me at [email removed] thanks');
check('a phone number is removed', S('Call +234 803 123 4567 anytime') === 'Call [phone removed] anytime');
check('dates, years and counts are not phone numbers', S('Done on 12.05.2025, 2024-2025, 1,000 learners, module 3 of 12') === 'Done on 12.05.2025, 2024-2025, 1,000 learners, module 3 of 12');
check('a personal LinkedIn link is removed, an organisation page is not', S('My profile https://www.linkedin.com/in/amara-ok and https://www.facebook.com/surgfoundation') === 'My profile [profile link removed] and https://www.facebook.com/surgfoundation');
check('a learner name, as written, is removed (hyphens and accents too)', S('Best regards, Dr Amara Okonkwo-Bello and jose: Thanks José Ramírez.') === 'Best regards, Dr [name removed] and jose: Thanks [name removed].');
check('a name only counts written capitalised', S('the course helped amara okonkwo-bello') === 'the course helped amara okonkwo-bello');
check('account names made of ordinary words never mangle a comment', S('Please Explain It better, it took me to The Next Level') === 'Please Explain It better, it took me to The Next Level');
check('words split across a line or punctuation are not joined into a name', S('Ngozi. Adeyemi was here') === 'Ngozi. Adeyemi was here');
check('single-word names are never matched', S('Li said thanks') === 'Li said thanks');
check('empty and non-text values pass through', S('') === '' && S(null) === '' && S(42) === '42');
check('without learner data, emails and phones are still removed', (() => { App._rawCompletion = []; return S('a@b.org Ngozi Adeyemi') === '[email removed] Ngozi Adeyemi'; })());

// wiring: the provider-facing outputs go through it
const rep = fs.readFileSync(path.join(ROOT, 'js/reports.js'), 'utf8'), idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
check('report quotes (light and web report) are scrubbed', /esc\(scrub\(f\.t \|\| f\.text/.test(rep) && /const qt = this\.scrubPersonal/.test(rep) && /esc\(qt\)/.test(rep));
check('the feedback workbook scrubs every free-text column, raw and summarised', /return scrubRow\(o\)/.test(rep) && /'Feedback': this\.scrubPersonal/.test(rep));
check('learner names are loaded before a report or workbook is built', (rep.match(/ensureCompletionLoaded\(\);\s+\/\/ learner names for scrubPersonal/g) || []).length === 2);
check('scrub.js is loaded before reports.js', idx.indexOf('js/scrub.js') > 0 && idx.indexOf('js/scrub.js') < idx.indexOf('js/reports.js'));

console.log(`\n${ok}/${ok + bad} passed`);
process.exit(bad ? 1 : 0);
