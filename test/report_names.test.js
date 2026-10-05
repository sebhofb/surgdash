// Report folder and file names: js/reportNames.js in a VM, then the real package writers in
// js/reports.js with the builders stubbed, so the paths they write are checked end to end.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };

// The provider names as LearnWorlds spells them (Oct 2026), and the folder each one's reports go into
// (the team's "SURGdash Reports" folder; "Smile TRain" there is a typo, written correctly here).
const FOLDERS = {
  'ALL SAFE': 'ALL SAFE',
  'Amosmile': 'Amosmile',
  'AO Alliance': 'AO Alliance',
  'ASA - American Society of Anaesthesiologists': 'American Society of Anaesthesiologists',
  'Ausmed': 'Ausmed',
  'Behind the Knife': 'Behind the Knife',
  'CANESCA': 'CANESCA',
  'Center for Global Health & Social Responsibility, University of Minnesota': 'University of Minnesota Center for Global Health and Social Responsibility',
  'COSECSA - College of Surgeons of East, Central and Southern Africa': 'COSECSA',
  'CrashSavers Team': 'CrashSavers',
  'ecancer': 'ecancer',
  'ECSACONM - East, Central and Southern African College of Nursing and Midwifery': 'ECSACONM',
  'F2AR - Fédération Francophone des Sociétés d\'Anesthésie-Réanimation': 'F2AR and Adrale',
  'Global Surgery Lab': 'Global Surgery Lab',
  'Global Trauma Collaboration, Baylor College of Medicine': 'Global Trauma Collaboration - Baylor College of Medicine',
  'GSF - Global Surgery Foundation': 'GSF',
  'Harvard Global Orthopaedics Collaborative': 'Harvard Global Orthopaedics Collaborative and SONA Global',
  'Health Professional Academy': 'Health Professional Academy',
  'ICRC- International Committee of the Red Cross': 'ICRC',
  'IFRS / VRiMS': 'IFRS',
  'Interburns': 'Interburns',
  'King’s Global Health Partnerships': 'Kings Global Health Partnerships',
  'Lifebox': 'Lifebox',
  'McGill': 'McGill',
  'NIHR Global Health Research Unit on Global Surgery': 'NIHR Global Health Research Unit on Global Surgery',
  'PerioperativeCPD': 'PerioperativeCPD',
  'RCSI - Royal College of Surgeons in Ireland': 'RCSI',
  'ReSurge International': 'Resurge International',
  'Safe Surgery Innovation': 'Safe Surgery Innovation',
  'Smile Train': 'Smile Train',
  'Standford LRC': 'Stanford LRC',
  'Tecnológico de Monterrey': 'TecSalud - Tecnologico de Monterrey',
  'Universities of Western Australia and Oxford': 'Universities of Western Australia and Oxford',
  'WFSA - World Federation of Societies of Anesthesiologists': 'WFSA',
};

const writes = [];
const rec = (op) => (p) => writes.push({ op, p: String(p) });
const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, isNaN, isFinite, parseInt, parseFloat, setTimeout, __swallowed() {},
  document: { addEventListener() {}, getElementById: () => null, body: { appendChild() {} }, createElement: () => ({ style: {} }) },
  electronAPI: { path, os: { tmpdir: () => '/tmp' },
    fs: { mkdirSync: rec('mkdir'), writeFileSync: rec('write'), renameSync: (a, b) => writes.push({ op: 'rename', p: String(b) }), existsSync: () => false },
    invoke: async (ch) => (ch === 'generate-pdf' ? { success: true } : null) },
  alert() {} };
ctx.window = ctx;
ctx.App = { reportPeriodFrom: '2026-07', reportPeriodTo: '2026-09', reportCoverPath: '', reportBackPath: '' };
vm.createContext(ctx);
for (const f of ['js/reportNames.js', 'js/reports.js']) { try { vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }); } catch (e) { check('loads ' + f, false, e.message); } }
const App = ctx.App;
const setPeriod = (from, to) => { App.reportPeriodFrom = from; App.reportPeriodTo = to; };

(async () => {
  // ── provider folders ──
  const got = Object.keys(FOLDERS).map(p => [p, App.providerFolderName(p), FOLDERS[p]]);
  const wrong = got.filter(([, g, w]) => g !== w);
  check('every provider with courses gets the folder the team files it under', wrong.length === 0, wrong.map(([p, g, w]) => p + ' → ' + g + ' (want ' + w + ')').join(' | '));
  check('34 providers, 34 different folders', new Set(Object.values(FOLDERS)).size === 34 && new Set(got.map(x => x[1])).size === 34);
  check('the folder list is the screenshot, apart from the Smile Train typo',
    JSON.stringify(Object.values(FOLDERS).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))) === JSON.stringify(['ALL SAFE', 'American Society of Anaesthesiologists', 'Amosmile', 'AO Alliance', 'Ausmed', 'Behind the Knife', 'CANESCA', 'COSECSA', 'CrashSavers', 'ecancer', 'ECSACONM', 'F2AR and Adrale', 'Global Surgery Lab', 'Global Trauma Collaboration - Baylor College of Medicine', 'GSF', 'Harvard Global Orthopaedics Collaborative and SONA Global', 'Health Professional Academy', 'ICRC', 'IFRS', 'Interburns', 'Kings Global Health Partnerships', 'Lifebox', 'McGill', 'NIHR Global Health Research Unit on Global Surgery', 'PerioperativeCPD', 'RCSI', 'Resurge International', 'Safe Surgery Innovation', 'Smile Train', 'Stanford LRC', 'TecSalud - Tecnologico de Monterrey', 'Universities of Western Australia and Oxford', 'University of Minnesota Center for Global Health and Social Responsibility', 'WFSA']));
  check('punctuation, spacing, case and accents in the LearnWorlds name do not matter',
    App.providerFolderName('ICRC - International Committee of the Red Cross') === 'ICRC'
    && App.providerFolderName("King's Global Health Partnerships") === 'Kings Global Health Partnerships'
    && App.providerFolderName('Tecnologico de Monterrey') === 'TecSalud - Tecnologico de Monterrey'
    && App.providerFolderName('Tecnológico de Monterrey') === 'TecSalud - Tecnologico de Monterrey'   // decomposed accent
    && App.providerFolderName('wfsa - world federation of societies of anesthesiologists') === 'WFSA');
  check('a corrected spelling, or the folder name itself, still finds the folder',
    App.providerFolderName('Stanford LRC') === 'Stanford LRC' && App.providerFolderName('GSF') === 'GSF' && App.providerFolderName('Smile TRain') === 'Smile Train');
  check('a provider not on the list keeps its own name', App.providerFolderName('Unknown Provider') === 'Unknown Provider'
    && App.providerFolderName('Harvard Medical School - Program in Global Surgery and Social Change') === 'Harvard Medical School - Program in Global Surgery and Social Change');

  // ── names every file system accepts ──
  check('characters macOS, Windows or SharePoint refuse become a dash',
    App.fsSafeName('HelloSurg / Ohana One') === 'HelloSurg - Ohana One' && App.fsSafeName('Trauma: the basics?') === 'Trauma - the basics'
    && App.fsSafeName('a\\b*c"d<e>f|g') === 'a - b - c - d - e - f - g', App.fsSafeName('Trauma: the basics?'));
  check('no hidden files, no trailing dot or space, no control characters',
    App.fsSafeName('.hidden') === 'hidden' && App.fsSafeName('Course. ') === 'Course' && App.fsSafeName('a\u0007b') === 'ab');
  check('accents and curly quotes are kept, they are legal everywhere', App.fsSafeName('Técnica de Suturas y Puntos') === 'Técnica de Suturas y Puntos' && App.fsSafeName('King’s') === 'King’s');
  check('long names are cut at 100 characters, never mid-separator', App.fsSafeName('x'.repeat(99) + ' - more').length <= 100 && !/[ -]$/.test(App.fsSafeName('x'.repeat(99) + ' - more')));
  check('nothing at all still names something', App.fsSafeName('') === 'Untitled' && App.fsSafeName(null) === 'Untitled' && App.fsSafeName('///') === 'Untitled');

  // ── the period, short ──
  setPeriod('2026-07', '2026-09'); check('a quarter reads as the team writes it', App.reportPeriodFileLabel('2026-10-05') === 'Jul-Sept 2026', App.reportPeriodFileLabel('2026-10-05'));
  setPeriod('2026-09', '2026-09'); check('one month is one month', App.reportPeriodFileLabel('2026-10-05') === 'Sept 2026');
  setPeriod('2025-11', '2026-01'); check('a period across New Year names both years', App.reportPeriodFileLabel('2026-10-05') === 'Nov 2025-Jan 2026');
  setPeriod('2026-01', '2026-12'); check('a whole year', App.reportPeriodFileLabel('2026-10-05') === 'Jan-Dec 2026');
  setPeriod('2026-07', ''); check('no end runs to the export month', App.reportPeriodFileLabel('2026-10-05') === 'Jul-Oct 2026');
  setPeriod('', '2026-09'); check('no start runs from launch', App.reportPeriodFileLabel('2026-10-05') === 'Launch-Sept 2026');
  setPeriod('', ''); check('no period: the export date', App.reportPeriodFileLabel('2026-10-05') === '5 Oct 2026');
  setPeriod('2026-13', 'junk'); check('a nonsense period counts as none', App.reportPeriodFileLabel('2026-10-05') === '5 Oct 2026');
  setPeriod('', ''); check('without a date it uses today', /^\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept|Oct|Nov|Dec) \d{4}$/.test(App.reportPeriodFileLabel()));

  // ── file names ──
  setPeriod('2026-07', '2026-09');
  check('files lead with what they are', App.reportFileName('Feedback', 'WFSA', 'xlsx', '2026-10-05') === 'Feedback_WFSA_Jul-Sept 2026.xlsx', App.reportFileName('Feedback', 'WFSA', 'xlsx', '2026-10-05'));
  check('a file name never carries an illegal character from its name', App.reportFileName('Report', 'IFRS / VRiMS', 'pdf', '2026-10-05') === 'Report_IFRS - VRiMS_Jul-Sept 2026.pdf');

  // ── the real package writers ──
  App._buildDarkReportHtml = async () => '<html>web</html>';
  App._buildReportHtml = async () => '<html>pdf</html>';
  App._buildUsersWorkbook = () => ({});
  App._buildFeedbackWorkbook = async () => ({});
  App._writeWorkbook = (wb, p) => writes.push({ op: 'xlsx', p: String(p) });
  writes.length = 0;
  const s = await App._writeProviderPackage('WFSA - World Federation of Societies of Anesthesiologists', '/out', '2026-10-05', []);
  const files = writes.filter(w => w.op !== 'mkdir').map(w => w.p).sort();
  check('a provider package lands in the provider\'s folder with four short names',
    JSON.stringify(files) === JSON.stringify(['/out/WFSA/Feedback_WFSA_Jul-Sept 2026.xlsx', '/out/WFSA/Report_WFSA_Jul-Sept 2026.pdf', '/out/WFSA/Users_WFSA_Jul-Sept 2026.xlsx', '/out/WFSA/Web report_WFSA_Jul-Sept 2026.html'])
    && writes.some(w => w.op === 'mkdir' && w.p === '/out/WFSA') && s.pdf && s.html && s.users && s.feedback, files.join(' | '));
  writes.length = 0;
  await App._writeCoursePackage('Tecnológico de Monterrey', 'Técnica de Suturas y Puntos', '/out', '2026-10-05', []);
  const cfiles = writes.filter(w => w.op !== 'mkdir').map(w => w.p).sort();
  check('a course package sits inside its provider\'s folder, named after the course',
    cfiles.length === 4 && cfiles.every(p => p.startsWith('/out/TecSalud - Tecnologico de Monterrey/Técnica de Suturas y Puntos/'))
    && cfiles.includes('/out/TecSalud - Tecnologico de Monterrey/Técnica de Suturas y Puntos/Feedback_Técnica de Suturas y Puntos_Jul-Sept 2026.xlsx'), cfiles.join(' | '));
  writes.length = 0;
  await App._writeCoursePackage('IFRS / VRiMS', 'Wound care: basics / advanced', '/out', '2026-10-05', []);
  check('a course name with a slash cannot open a folder of its own',
    writes.filter(w => w.op !== 'mkdir').every(w => w.p.startsWith('/out/IFRS/Wound care - basics - advanced/') && w.p.split('/').length === 5), writes.map(w => w.p).join(' | '));

  // ── wiring ──
  const reports = fs.readFileSync(path.join(ROOT, 'js/reports.js'), 'utf8');
  const exp = fs.readFileSync(path.join(ROOT, 'js/export.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('no report folder or file is named the old snake_case way', !/replace\(\/\[\^a-z0-9\]\/gi, '_'\)/.test(reports));
  check('single PDF, web report and the PDF batch use the same names',
    /pick-save-path', this\.reportFileName\('Report', this\.providerFolderName\(providerName\), 'pdf'\)/.test(reports)
    && /pick-save-path', this\.reportFileName\('Web report', this\.providerFolderName\(providerName\), 'html'\)/.test(reports)
    && /path\.join\(folder, this\.reportFileName\('Report', this\.providerFolderName\(prov\), 'pdf'\)\)/.test(reports));
  check('User Data suggests the same kind of name', /this\.reportFileName\('Users', this\.providerFolderName\(providerName\), 'xlsx'\)/.test(exp));
  check('the module loads before the exports that use it, and before uiState.js',
    html.indexOf('js/reportNames.js') > 0 && html.indexOf('js/reportNames.js') < html.indexOf('js/export.js') && html.indexOf('js/reportNames.js') < html.indexOf('js/uiState.js'));

  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})();
