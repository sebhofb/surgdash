// Course card thumbnails (coursesFeed.js, 22 Oct 2026): LearnWorlds card images are full-size
// uploads (up to 1.5 MB); each publish points courses.json's image at a small WebP made on this Mac,
// cached between publishes, and publishes those files beside it. image_full keeps the original.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };
const files = new Map();   // an in-memory disk
const mfs = {
  existsSync: (p) => files.has(p) || [...files.keys()].some(k => k.startsWith(p + '/')),
  mkdirSync() {}, writeFileSync: (p, d) => files.set(p, typeof d === 'string' ? d : Buffer.from(d)),
  readFileSync: (p, enc) => { if (!files.has(p)) throw new Error('ENOENT ' + p); const v = files.get(p); return enc ? String(v) : (Buffer.isBuffer(v) ? v.buffer.slice(v.byteOffset, v.byteOffset + v.length) : v); },
  unlinkSync: (p) => { if (!files.delete(p)) throw new Error('ENOENT'); },
};
const ctx = { console: { log() {}, warn() {}, error() {} }, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, Date, Uint8Array, __swallowed() {},
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'), OffscreenCanvas: function () {},
  Storage: { DATA_DIR: '/data', async getItem() { return null; }, async setItem() {} }, electronAPI: { fs: mfs, path } };
ctx.window = ctx; ctx.App = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/coursesFeed.js'), 'utf8'), ctx, { filename: 'coursesFeed.js' });
const App = ctx.App;
const made = [];
App._cfMakeThumb = async (src) => { made.push(src); if (/broken/.test(src)) throw new Error('HTTP 404'); return { bytes: new Uint8Array([1, 2, 3, src.length % 250]), ext: 'webp', w: 640, h: 360 }; };
const LW = 'https://lwfiles.mycourse.app/globalsurgery-public/';
const feedOf = () => ({ courses: [{ slug: 'burns', image: LW + 'a.png' }, { slug: 'c-arm', image: LW + 'b.png' }, { slug: 'odd', image: LW + 'broken.png' }, { slug: 'none', image: null }] });

(async () => {
  // no reports site set up: nothing changes
  let f = feedOf(); await App._cfApplyThumbs(f);
  check('without a reports site the originals stay, image_full alongside', f.courses[0].image === LW + 'a.png' && f.courses[0].image_full === LW + 'a.png' && made.length === 0);

  App._pd = { baseUrl: 'https://reports.example.org/' };
  f = feedOf(); await App._cfApplyThumbs(f);
  const [b, c, odd, none] = f.courses;
  check('image → the thumbnail on the reports site; image_full → the LearnWorlds original', /^https:\/\/reports\.example\.org\/thumbs\/burns-[a-z0-9]+\.webp$/.test(b.image) && b.image_full === LW + 'a.png', b.image);
  check('an image that cannot be fetched keeps its original; a course with none stays null', odd.image === LW + 'broken.png' && none.image === null && none.image_full === null);
  check('made once each and cached on disk with an index', made.length === 3 && files.has('/data/cache/course_thumbs/index.json') && [...files.keys()].filter(k => /\.webp$/.test(k)).length === 2);

  made.length = 0; App._cfThumbIdx = null;   // a new session reads the index back
  f = feedOf(); await App._cfApplyThumbs(f);
  check('next publish: nothing fetched again except the one that failed', made.length === 1 && made[0] === LW + 'broken.png' && f.courses[0].image === b.image);

  // what is published beside courses.json
  const content = JSON.stringify(f);
  const t = App._cfThumbFiles(content);
  check('the files to publish: exactly the thumbnails courses.json points at, as base64', t.length === 2 && t.every(x => /^thumbs\/[a-z0-9-]+\.webp$/.test(x.path) && Buffer.from(x.base64, 'base64').length === 4), JSON.stringify(t.map(x => x.path)));

  // the original changes on LearnWorlds: a new name, so caches never serve the old picture
  made.length = 0; const f2 = feedOf(); f2.courses[0].image = LW + 'a2.png'; await App._cfApplyThumbs(f2);
  check('a changed original gets a new thumbnail under a new name', made.includes(LW + 'a2.png') && f2.courses[0].image !== b.image && /\/thumbs\/burns-/.test(f2.courses[0].image));
  check('…the old one stays until a publish no longer needs it', [...files.keys()].filter(k => /\/burns-.*\.webp$/.test(k)).length === 2);
  App._cfState = {};
  await App._cfMarkPublished({ fresh: true, content: JSON.stringify(f2), count: 4, thumbs: App._cfThumbFiles(JSON.stringify(f2)) });
  check('after publishing, unused thumbnails are deleted', [...files.keys()].filter(k => /\/burns-.*\.webp$/.test(k)).length === 1 && files.has('/data/cache/course_thumbs/' + f2.courses[0].image.split('/thumbs/')[1]));
  const before = [...files.keys()].length;
  await App._cfMarkPublished({ fresh: true, content: '{"courses":[]}', count: 0, thumbs: [] });
  check('a publish that carried no thumbnails never empties the cache', [...files.keys()].length === before);
  check('only safe file names from the reports site are read', App._cfThumbFiles(JSON.stringify({ courses: [{ image: 'https://reports.example.org/thumbs/../../etc.webp' }, { image: 'https://elsewhere.org/thumbs/x.webp' }] })).length === 0);

  // both publish routes carry them
  const wm = fs.readFileSync(path.join(ROOT, 'js/websiteMetrics.js'), 'utf8'), pd = fs.readFileSync(path.join(ROOT, 'js/partnerDash.js'), 'utf8');
  check('quick publish uploads only the thumbnails the site does not have, as base64 blobs', /const add = cf\.thumbs\.filter\(t => !have\.has\(t\.path\)\)/.test(wm) && /up\(add\[i\]\.path, add\[i\]\.base64, 'base64'\)/.test(wm));
  check('full publish puts every thumbnail into the new site, blobs keep their encoding', /files\.push\(\{ path: t\.path, content: t\.base64, encoding: 'base64' \}\)/.test(pd) && /encoding: f\.encoding \|\| 'utf-8'/.test(pd));
  console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
})();
