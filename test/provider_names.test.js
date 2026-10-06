// Provider-name corrections (js/providerNames.js): the rename of what is stored, and the
// provider-map lookup in the real js/updater.js, which must never hand back a misspelling.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };
const clone = (v) => JSON.parse(JSON.stringify(v));

function mk(seed) {
  const store = new Map(Object.entries(clone(seed || {}))), writes = [];
  const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, isNaN, isFinite, parseInt, parseFloat, setTimeout, __swallowed() {},
    document: { addEventListener() {}, getElementById: () => null },
    Storage: { async getItem(k) { return store.has(k) ? clone(store.get(k)) : null; }, async setItem(k, v, o) { store.set(k, clone(v)); writes.push({ k, internal: !!(o && o.internal) }); return v; } },
    Pipeline: { normalizeString: (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() } };
  ctx.window = ctx;
  ctx.App = {};
  vm.createContext(ctx);
  for (const f of ['js/providerNames.js', 'js/updater.js']) { try { vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }); } catch (e) { check('loads ' + f, false, e.message); } }
  return { App: ctx.App, store, writes };
}

// What this Mac held on 6 Oct 2026, reduced to the parts that carry the name.
const SEED = {
  surghub_data: [
    { Course: 'Research Methodology Course (RMC)', Provider: 'CANESCA', Timestamp: '2026-10-01' },
    { Course: 'Basic Surgical Skills', Provider: 'COSECSA - College of Surgeons of East, Central and Southern Africa', Timestamp: '2026-10-01' },
  ],
  surgdash_provider_map: [
    { 'All Courses': 'Research Methodology Course (RMC)', 'Providers': 'CANESCA' },
    { 'All Courses': 'Basic Surgical Skills', 'Providers': 'COSECSA - College of Surgeons of East, Central and Southern Africa' },
    { 'Course title': 'An older map', 'Provider name': 'canesca' },          // other headers: the second column is the provider
  ],
  surghub_selected_testimonials: { CANESCA: { a1: true }, COSECSA: { b1: true } },
  surghub_feedback_summaries: {
    '@provider:CANESCA': { s: "Learners commend CANESCA's Research Methodology course.", t: '2026-09-01', n: 12 },
    'Research Methodology Course (RMC)': { s: "Learners commend CANESCA's teaching; COSECSA alumni too.", t: '2026-09-01', n: 12 },
  },
  surghub_excluded_providers: ['CANESCA', 'Some Test Provider'],
  surgdash_digest: { courses: [{ course: 'RMC', provider: 'CANESCA' }], providers: [{ provider: 'COSECSA' }, { provider: 'CANESCA' }] },
};

(async () => {
  // ── one name ──
  const { App } = mk();
  check('the misspelling is corrected, whatever its case or spacing',
    App.fixProviderName('CANESCA') === 'CANECSA' && App.fixProviderName('canesca') === 'CANECSA' && App.fixProviderName(' Canesca ') === 'CANECSA');
  check('the correct name, and every other provider, are left alone',
    App.fixProviderName('CANECSA') === 'CANECSA' && App.fixProviderName('COSECSA') === 'COSECSA' && App.fixProviderName('Unknown Provider') === 'Unknown Provider');
  check('only the WHOLE name counts: a name that merely contains it is not touched',
    App.fixProviderName('CANESCA Students Network') === 'CANESCA Students Network');
  check('empty values pass through', App.fixProviderName('') === '' && App.fixProviderName(null) === null && App.fixProviderName(undefined) === undefined);
  check('in free text, the misspelling is corrected as a word and nothing else',
    App._fixProviderText("Learners commend CANESCA's course; COSECSA too.") === "Learners commend CANECSA's course; COSECSA too."
    && App._fixProviderText('XCANESCAX') === 'XCANESCAX');

  // ── the provider map, as the syncs read it (real updater.js) ──
  const map = clone(SEED.surgdash_provider_map);
  check('a sync applying an old copy of the map gets the corrected name',
    App._matchProvider('research methodology course rmc', map) === 'CANECSA', App._matchProvider('research methodology course rmc', map));
  check('…and every other provider exactly as written',
    App._matchProvider('basic surgical skills', map) === 'COSECSA - College of Surgeons of East, Central and Southern Africa');
  check('a course the map does not know still matches nothing', App._matchProvider('no such course', map) === null);

  // ── renaming what is stored ──
  const m = mk(SEED);
  m.App.data = clone(SEED.surghub_data);
  const out = await m.App.applyProviderNameFixes();
  const got = (k) => m.store.get(k);
  check('the course record is renamed, in memory and on disk',
    m.App.data[0].Provider === 'CANECSA' && got('surghub_data')[0].Provider === 'CANECSA' && out.records === 1, JSON.stringify(out));
  check('other providers keep their names', got('surghub_data')[1].Provider.indexOf('COSECSA') === 0);
  check('the provider map is renamed, whatever its column headers',
    got('surgdash_provider_map')[0].Providers === 'CANECSA' && got('surgdash_provider_map')[2]['Provider name'] === 'CANECSA' && out.map === 2);
  check('testimonial picks move to the corrected name', JSON.stringify(got('surghub_selected_testimonials')) === JSON.stringify({ COSECSA: { b1: true }, CANECSA: { a1: true } }), JSON.stringify(got('surghub_selected_testimonials')));
  check('the provider summary moves to the corrected key, its text corrected too',
    !got('surghub_feedback_summaries')['@provider:CANESCA'] && /CANECSA's Research/.test(got('surghub_feedback_summaries')['@provider:CANECSA'].s)
    && got('surghub_feedback_summaries')['@provider:CANECSA'].n === 12);
  check('a course summary that names the provider is corrected, other names untouched',
    got('surghub_feedback_summaries')['Research Methodology Course (RMC)'].s === "Learners commend CANECSA's teaching; COSECSA alumni too.");
  check('the excluded-providers list follows', JSON.stringify(got('surghub_excluded_providers')) === JSON.stringify(['CANECSA', 'Some Test Provider']));
  check('this device\'s last digest follows', got('surgdash_digest').courses[0].provider === 'CANECSA' && got('surgdash_digest').providers[1].provider === 'CANECSA' && got('surgdash_digest').providers[0].provider === 'COSECSA');
  check('every write is internal: no "unsynced changes" banner, no held-back auto-pull on a viewer\'s screen',
    m.writes.length === 6 && m.writes.every(w => w.internal), JSON.stringify(m.writes));
  const before = m.writes.length;
  const again = await m.App.applyProviderNameFixes();
  check('running it again changes nothing and writes nothing', m.writes.length === before && Object.values(again).every(v => v === 0), JSON.stringify(again));

  // both spellings already present: nothing is lost
  const both = mk({ surghub_selected_testimonials: { CANESCA: { a1: true }, CANECSA: { c1: true } },
                    surghub_feedback_summaries: { '@provider:CANESCA': { s: 'old' }, '@provider:CANECSA': { s: 'new' } } });
  both.App.data = [];
  await both.App.applyProviderNameFixes();
  check('picks under both spellings are merged, none lost', JSON.stringify(both.store.get('surghub_selected_testimonials')) === JSON.stringify({ CANECSA: { a1: true, c1: true } }), JSON.stringify(both.store.get('surghub_selected_testimonials')));
  check('a summary already under the correct name is kept', both.store.get('surghub_feedback_summaries')['@provider:CANECSA'].s === 'new' && !both.store.get('surghub_feedback_summaries')['@provider:CANESCA']);

  // a machine with nothing to fix
  const clean = mk({ surghub_data: [{ Course: 'X', Provider: 'COSECSA' }], surgdash_provider_map: [{ 'All Courses': 'X', Providers: 'COSECSA' }] });
  clean.App.data = clean.store.get('surghub_data');
  await clean.App.applyProviderNameFixes();
  check('a machine with nothing to fix sees no writes at all', clean.writes.length === 0);
  const empty = mk({}); empty.App.data = undefined;
  check('nothing stored yet: no error', (await empty.App.applyProviderNameFixes()).records === 0 && empty.writes.length === 0);

  // ── wiring ──
  const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  const upd = fs.readFileSync(path.join(ROOT, 'js/updater.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
  const reports = fs.readFileSync(path.join(ROOT, 'js/reports.js'), 'utf8');
  const iFix = app.indexOf('await this.applyProviderNameFixes()');
  check('start-up renames right after loading the course data, before the summaries are read',
    iFix > app.indexOf("const stored = await Storage.getItem('surghub_data');") && iFix < app.indexOf("const storedSummaries = await Storage.getItem('surghub_feedback_summaries');"));
  check('an uploaded provider map is corrected before it is stored', /this\._fixProviderMapRows\(rows\);[^\n]*\n\s*await Storage\.setItem\('surgdash_provider_map', rows\)/.test(upd));
  check('the provider pages are found under the corrected name',
    /\['canecsa', 'canecsa-courses'\]/.test(ui) && /\['canecsa', 'canecsa-courses'\]/.test(reports));
  check('the module loads before uiState.js', html.indexOf('js/providerNames.js') > 0 && html.indexOf('js/providerNames.js') < html.indexOf('js/uiState.js'));

  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})();
