// Forum quotes: js/forumQuotes.js in a VM, with a fake receipt on disk, a fake forum API and a
// fake Claude. Checks who a post is attributed to, what is sent and kept, that a post is never
// paid for twice, and what the Forum tab shows.
const vm = require('vm'), fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };

// A receipt that lists the accounts, as enrolmentSync writes it.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fq-'));
const rec = path.join(tmp, 'surghub', 'raw', 'enrolments__20261029-091152'); fs.mkdirSync(rec, { recursive: true });
const accounts = [{ id: 'u1', email: 'Amina@Example.org', first_name: 'Amina', last_name: 'Okafor' }, { id: 'u2', email: 'staff@globalsurgeryfoundation.org', first_name: 'Gsf', last_name: 'Team' },
  { id: 'u3', email: 'b@example.org', first_name: 'Bilal', last_name: 'Haddad' }];
for (let i = 0; i < 1000; i++) accounts.push({ id: 'x' + i, email: 'x' + i + '@example.org' });
fs.writeFileSync(path.join(rec, 'pull.jsonl'), [JSON.stringify({ t: 1, path: '/users', params: {}, body: JSON.stringify({ data: accounts }) }),
  JSON.stringify({ t: 2, path: '/users/u1/courses', body: '{"data":[]}' })].join('\n'));

const long = (s) => s + ' ' + 'And this is the rest of a long post that says a good deal more about the work. '.repeat(3);
const spaces = [{ id: 's1', title: 'Reflection Forum - Burns', usages: [{ courseId: 'burns' }] }, { id: 's2', title: 'Introduce Yourself - Burns', usages: [{ courseId: 'burns' }] }, { id: 's3', title: 'General chat', usages: [] }];
const posts = [
  { id: 'p1', posted_in: { id: 's1' }, user: { id: 'u1' }, created: 1790000000, text: '<p>' + long('Since the course we excise &amp; graft early.') + '</p>' },
  { id: 'p2', posted_in: { id: 's2' }, user: { id: 'u3' }, created: 1790000000, text: long('Hello, I am Bilal Haddad, a surgeon in Aden.') },
  { id: 'p3', posted_in: { id: 's3' }, user: { id: 'u2' }, created: 1790000000, text: long('Join our webinar tomorrow.') },     // staff
  { id: 'p4', posted_in: { id: 's1' }, user: { id: 'u1' }, created: 1790000000, text: 'Thank you!' },                            // short
  { id: 'p5', posted_in: { id: 's3' }, user: { id: 'nobody' }, created: 1790000000, text: long('Where do I find my certificate?') },
];
const uidOf = (e) => { let h = 5381; e = e.toLowerCase().trim(); for (let i = 0; i < e.length; i++) h = ((h << 5) + h + e.charCodeAt(i)) >>> 0; return h.toString(36); };

function mk() {
  const store = new Map(), calls = [];
  const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, Intl, TextDecoder, isNaN, isFinite, parseInt, parseFloat, setTimeout: (f) => f(),
    __swallowed() {}, alert(m) { ctx.App.alerts.push(m); }, confirm(m) { ctx.App.asked.push(m); return ctx.App.answer; },
    navigator: { clipboard: { async writeText(t) { ctx.App.copied = t; } } }, document: { getElementById: () => null },
    electronAPI: { path, fs: { openSync: (f) => fs.openSync(f, 'r'), readSync: (fd, n, pos) => { const b = Buffer.alloc(n); return b.subarray(0, fs.readSync(fd, b, 0, n, pos)); }, closeSync: (fd) => fs.closeSync(fd),
      readdirSync: (d, o) => fs.readdirSync(d, o).map(e => ({ name: e.name, isDirectory: e.isDirectory() })), existsSync: fs.existsSync, readFileSync: fs.readFileSync } },
    LearnWorlds: { async apiGet(p) { return { data: p === '/community/spaces' ? spaces : ctx.App.posts, meta: { totalPages: 1 } }; } },
    Storage: { DATA_DIR: tmp, async getItem(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; }, async setItem(k, v) { store.set(k, JSON.parse(JSON.stringify(v))); } } };
  ctx.window = ctx;
  ctx.App = { alerts: [], asked: [], msgs: [], answer: true, posts: posts.slice(), view: 'platform', _dashTab: 'forum', _aiUsage: { in: 0, out: 0 },
    data: [{ Course: 'Burns 101', CourseId: 'burns', Learners: 10 }],
    _rawAnonymizedUsers: [{ user_uid: uidOf('amina@example.org'), profession: 'nurse-anaesthetist', country: 'Nigeria' }],
    _emailDemoMap: { 'b@example.org': { profession: 'surgeon', country: 'Yemen' } },
    escapeHtml: (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), escapeJsArg: (t) => String(t).replace(/'/g, "\\'"),
    formatNumber: (v) => String(v), showMsg(m) { this.msgs.push(m); }, renderView() {}, rerenderDashTab() { this.redrawn = (this.redrawn || 0) + 1; },
    _getAnthropicKey: async () => 'k', _djb2Hash: uidOf,
    async _claudeJSON(key, system, user, schema, max, opts) {
      const items = JSON.parse(user); calls.push({ system, items, opts });
      return { results: items.map(x => /excise/.test(x.post) ? { i: x.i, text: 'Since the course we excise and graft early.', en: '', verdict: 'use', reason: 'good', strength: 5, theme: 'practice', self_role: '', self_country: '' }
        : /Bilal/.test(x.post) ? { i: x.i, text: 'I am Bilal Haddad, a surgeon in Aden.', en: '', verdict: 'use', reason: 'good', strength: 4, theme: 'context', self_role: 'surgeon', self_country: 'Yemen' }
        : { i: x.i, text: '', en: '', verdict: 'no', reason: 'question', strength: 1, theme: 'course', self_role: '', self_country: '' }) };
    } };
  vm.createContext(ctx);
  for (const f of ['countryMap.js', 'conflict.js', 'enrolmentSync.js', 'forumActivity.js', 'forumQuotes.js']) vm.runInContext(fs.readFileSync(ROOT + '/js/' + f, 'utf8'), ctx, { filename: f });
  Object.assign(ctx.App, { _enrReceiptDirs: () => [rec], _forumPickCourse: (ids) => ids[0], FORUM_GAP_MS: 0, calls, store });
  return ctx.App;
}

(async () => {
  // ── reading a post ──
  const A = mk();
  check('post HTML becomes plain text, entities decoded', A._fqText('<p>Burns &amp; grafts</p><p>early&nbsp;excision</p>') === 'Burns & grafts early excision', A._fqText('<p>Burns &amp; grafts</p><p>early&nbsp;excision</p>'));
  check('the space says what kind of post it is', A._fqKind('Reflection Forum - X', 'c') === 'reflection' && A._fqKind('Introduce Yourself - X', 'c') === 'introduction' && A._fqKind('Présentez-vous', 'c') === 'introduction'
    && A._fqKind('Discussion Forum - X', 'c') === 'discussion' && A._fqKind('General chat', '') === 'general');
  check('the poster index comes from the account listing in the receipt, emails lower-cased', A._fqPosterIndex().get('u1').email === 'amina@example.org' && A._fqPosterIndex().size === 1003);
  check('profession tags read as job titles', A._fqRole('nurse-anaesthetist') === 'Nurse anaesthetist' && A._fqRole('anesthesiology') === 'Anaesthesiologist' && A._fqRole('non-clinical') === '' && A._fqRole('surgeon') === 'Surgeon');

  // ── declining costs nothing ──
  A.answer = false;
  check('declining the question checks nothing and stores nothing', (await A.findForumQuotes(null)) === null && A.calls.length === 0 && !A.store.has('surghub_forum_quotes'));
  check('the question gives the count, what was left out and the cost, and says nothing is published',
    /Check 3 forum posts/.test(A.asked[0]) && /1 shorter than 250 characters and 1 by GSF staff/.test(A.asked[0]) && /roughly \$1/.test(A.asked[0]) && /nothing is published/.test(A.asked[0]), A.asked[0]);

  // ── a run ──
  A.answer = true;
  const r = await A.findForumQuotes(null);
  const sent = A.calls[0] && A.calls[0].items;
  check('only long posts by learners are sent: no staff post, no short post', sent && sent.length === 3 && !sent.some(x => /webinar|Thank you!/.test(x.post)), sent && sent.map(x => x.post.slice(0, 20)).join(' | '));
  check('each post goes with its course and the profession and country on record', sent && sent[0].course === 'Burns 101' && sent[0].space === 'reflection forum' && sent[0].profession === 'nurse-anaesthetist' && sent[0].country === 'Nigeria', JSON.stringify(sent && sent[0]).slice(0, 200));
  check('the email demographics fill in where the anonymised rows have nothing', sent && sent[1].profession === 'surgeon' && sent[1].country === 'Yemen');
  check('a post outside any course is sent as the general community', sent && sent[2].course === 'general community' && sent[2].profession === '');
  check('no email or name is sent to Claude', !JSON.stringify(A.calls).match(/example\.org|Okafor/));
  check('the check runs on Opus 5.5 at low effort', A.calls[0].opts.model === 'claude-opus-5-5' && A.calls[0].opts.effort === 'low');
  const fq = A.store.get('surghub_forum_quotes');
  check('a good quote is kept with its labels, date, theme and strength', fq.quotes.p1 && fq.quotes.p1.t === 'Since the course we excise and graft early.' && fq.quotes.p1.role === 'nurse-anaesthetist' && fq.quotes.p1.country === 'Nigeria'
    && fq.quotes.p1.c === 'burns' && fq.quotes.p1.k === 'reflection' && fq.quotes.p1.s === 5 && fq.quotes.p1.th === 'practice' && /^\d{4}-\d{2}-\d{2}$/.test(fq.quotes.p1.d), JSON.stringify(fq.quotes.p1));
  check('the poster is kept as a hash, never an email or name', fq.quotes.p1.u === uidOf('amina@example.org') && !JSON.stringify(fq).match(/example\.org|Amina|Okafor/));
  check('a quote that still names its poster is never kept', !fq.quotes.p2 && fq.no.p2 === 1, JSON.stringify(fq.quotes.p2));
  check('a rejected post is remembered by id only', fq.no.p5 === 1 && !JSON.stringify(fq.no).includes('certificate'));
  check('the run reports what it did', r && r.checked === 3 && r.use === 1 && /1 quotes worth using/.test(A.msgs.join(' ')), JSON.stringify(r));

  // ── never twice ──
  A.posts.push({ id: 'p6', posted_in: { id: 's1' }, user: { id: 'u1' }, created: 1791000000, text: long('Since then we excise burns early on our ward.') });
  A.asked.length = 0;
  await A.findForumQuotes(null);
  check('a second run sends only the new post', A.calls.length === 2 && A.calls[1].items.length === 1 && /ward/.test(A.calls[1].items[0].post), A.calls[1] && A.calls[1].items.length);
  check('and says the earlier ones are not paid for again', /3 were checked before and are not paid for again/.test(A.asked[0]), A.asked[0]);
  A.asked.length = 0;
  await A.findForumQuotes(null);
  check('with nothing new it asks nothing and calls nothing', A.calls.length === 2 && !A.asked.length && /No new forum posts/.test(A.alerts.join(' ')));

  // ── the list ──
  A._fq = A.store.get('surghub_forum_quotes');
  A._fq.quotes.p7 = { c: 'burns', course: 'Burns 101', k: 'introduction', d: '2026-10-01', t: 'I work in <Aden> where the war closed two hospitals.', en: '', v: 'use', s: 4, th: 'context', role: 'surgeon', country: 'Yemen', u: 'zz' };
  A._fq.quotes.p8 = { c: '', course: '', k: 'general', d: '2026-10-02', t: 'Generic.', en: '', v: 'weak', s: 2, th: 'course', role: '', country: '', u: 'yy' };
  A._fq.quotes.p9 = { c: 'burns', course: 'Burns 101', k: 'reflection', d: '2026-09-01', t: 'Bon cours.', en: 'Good course.', v: 'use', s: 3, th: 'course', role: 'nurse', country: 'France', u: 'xx' };
  let l = A.fqList();
  check('the list shows quotes worth using at 4/5 and up, strongest first, then newest', l.map(q => q.id).join(',') === 'p6,p1,p7', l.map(q => q.id + ':' + q.s).join(','));
  check('several quotes from one learner are flagged as one voice', l.find(q => q.id === 'p1').same === 2 && l.find(q => q.id === 'p7').same === 1);
  A.setFqFilter('conflict', true); l = A.fqList();
  check('the conflict filter keeps learners from conflict-affected countries (Nigeria and Yemen, not France)', l.map(q => q.id).join(',') === 'p6,p1,p7', l.map(q => q.id).join(','));
  A.setFqFilter('conflict', false); A.setFqFilter('min', '3'); A.setFqFilter('kind', 'reflection'); l = A.fqList();
  check('the space and strength filters narrow the list', l.map(q => q.id).sort().join(',') === 'p1,p6,p9', l.map(q => q.id).join(','));
  A.setFqFilter('kind', ''); A.setFqFilter('q', 'good course'); l = A.fqList();
  check('search finds words in the English translation too', l.map(q => q.id).join(',') === 'p9');
  A.setFqFilter('q', ''); A.setFqFilter('min', '4');
  check('the label reads as a job title and a country', A._fqLabel(A._fq.quotes.p1) === 'Nurse anaesthetist, Nigeria' && A._fqLabel({ role: '', country: '' }) === 'Learner');

  // ── the screen ──
  const html = A._fqSectionHtml();
  check('the section says it is internal and how to quote', /For internal use/.test(html) && /profession and country only/.test(html));
  check('quotes are escaped on screen', html.includes('&lt;Aden&gt;') && !html.includes('<Aden>'));
  check('a learner from a conflict-affected country is marked', /Surgeon, Yemen <span[^>]*>conflict-affected/.test(html));
  check('several quotes from one learner say so on the card', /2 quotes from this learner/.test(html));
  await A.hideForumQuote('p7');
  check('a hidden quote leaves the list and stays hidden', !A.fqList().some(q => q.id === 'p7') && A.store.get('surghub_forum_quotes').hidden.p7 === 1);
  await A.copyForumQuote('p9');
  check('copy gives the quote, who said it, the course and the translation', A.copied === '"Bon cours."\n— Nurse, France, Burns 101\n(English: Good course.)', A.copied);
  const B = mk(); B._fq = { quotes: {}, no: {}, hidden: {}, at: '' };
  check('before the first run the section explains what the button does', /Not run yet/.test(B._fqSectionHtml()) && /Find quotes/.test(B._fqSectionHtml()));

  // ── wiring ──
  const st = fs.readFileSync(ROOT + '/js/storage.js', 'utf8'), html2 = fs.readFileSync(ROOT + '/index.html', 'utf8'), fa = fs.readFileSync(ROOT + '/js/forumActivity.js', 'utf8');
  check('the quotes are stored in surghub/forum_quotes.json and mapped back, so they travel', /'surghub_forum_quotes':\s*path\.join\('surghub', 'forum_quotes\.json'\)/.test(st) && /'forum_quotes': 'surghub_forum_quotes'/.test(st));
  check('the module loads after forumActivity.js', html2.indexOf('js/forumQuotes.js') > html2.indexOf('js/forumActivity.js') && html2.indexOf('js/forumQuotes.js') > 0);
  check('the Forum tab shows the section, with or without forum counts', (fa.match(/\+ quotes/g) || []).length === 2 && /refresh \+ '<\/div>' \+ quotes/.test(fa));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n' + ok + '/' + (ok + bad) + ' passed');
  process.exit(bad ? 1 : 0);
})();
