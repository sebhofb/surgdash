// Light design for the web report (js/reportTheme.js): soft GSF dashboard — pale canvas,
// white rounded cards, brand banner, ink text, marks keep colour, map light→dark.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };
const ctx = { console }; ctx.window = ctx; ctx.App = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/reportTheme.js'), 'utf8'), ctx);
const W = (h) => ctx.App.reportToWhite(h);

const page = '<html><head><style>:root{--bg:#001523;--accent:#FFC145}</style><script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script></head><body style="background:#001523;color:#eef4f9">'
  + '<div style="border:1px solid var(--border);border-radius:5px;padding:22px 24px;margin-bottom:24px;background:linear-gradient(135deg,#4389C80D,#002033 62%)"><h1>GSF</h1></div>'
  + '<div class="kcard" style="background:linear-gradient(160deg,#A78BFA14,#001a2b 72%);border:1px solid var(--border);border-radius:5px"><div style="position:absolute;top:0;left:0;right:0;height:3px;background:#A78BFA"></div>'
  + '<p style="font-size:10px;text-transform:uppercase;color:#A78BFA">Courses</p></div>'
  + '<span style="font-size:40px;color:var(--accent);line-height:1">10.2 mo</span>'
  + '<b style="color:#E28743">4.76</b> avg rating'
  + '<div style="border-left:3px solid #4389C8;background:#002a42">quote<span style="color:var(--accent);font-size:11px;margin-left:8px;letter-spacing:.1em">★★★★★</span></div>'
  + '<div style="border:1px solid #FFC14538;background:linear-gradient(135deg,#FFC14512,#001a2b 70%)">impact</div>'
  + '<script>var GRID=\'rgba(255,255,255,0.06)\',TICK=\'#6d8ba3\';var ramp=[\'#123a5c\',\'#1a5485\',\'#2474b3\',\'#3f97d6\',\'#74bce9\',\'#bce3fb\'];var ds={type:\'line\',tension:0.32,borderColor:\'#FFC145\',backgroundColor:\'#4389C81c\'},bars={borderRadius:2,data:[]};</script>'
  + '<div style="background:linear-gradient(90deg,#123a5c,#1a5485,#2474b3,#3f97d6,#74bce9,#bce3fb)"></div></body></html>';
const w = W(page);

check('a pale GSF-blue canvas with ink text; cards white, rounded, softly shadowed', /html,body\{background:#EEF4FA!important/.test(w) && /body style="background:#ffffff;color:#0B2233"/.test(w) && /\.chart-card,\.ratingband,\.gstep-card\{background:#fff!important;border:1px solid transparent!important;border-radius:18px!important;box-shadow:var\(--shadow\)/.test(w));
check('bordered boxes become soft cards', /class="kcard" style="background:#F3F0FE;border:1px solid transparent;border-radius:18px;box-shadow:var\(--shadow\)"/.test(w), (w.match(/class="kcard" style="[^"]*"/) || [''])[0]);
check('the header becomes a Prussian-to-Boston banner with white text and gold accents', /border-radius:18px;box-shadow:var\(--shadow\);padding:22px 24px;margin-bottom:24px;background:var\(--hero\)"/.test(w) && /--hero:linear-gradient\(120deg,#002F4C 0%,#0B4F7C 55%,#4389C8 100%\)/.test(w) && /\[style\*="background:var\(--hero\)"\] h1,\[style\*="background:var\(--hero\)"\] strong\{color:#fff!important\}/.test(w));
check('each stat tile\'s colour bar becomes a ring in that colour', /<div class="kdot" style="--c:#A78BFA"><\/div>/.test(w) && /\.kdot::after\{[^}]*border:3\.5px solid var\(--c\)/.test(w));
check('a small-caps label keeps its own colour, deepened to read on white', /text-transform:uppercase;color:#(\w{6})">Courses/.test(w) && ctx.App._wDeep('#A78BFA') === '#' + RegExp.$1);
check('figures are never gold or orange: ink', /font-size:40px;color:#2B3F52;line-height:1">10\.2 mo/.test(w) && /<b style="color:#2B3F52">4\.76/.test(w));
check('star ratings keep the gold', /color:#F2B01E;font-size:11px;margin-left:8px;letter-spacing:\.1em">★/.test(w));
check('a gold-tinted box becomes a flat light gold, its border a stronger tint', /border:1px solid #(\w{6});background:#(\w{6})">impact/.test(w) && RegExp.$2 === ctx.App._wTint('#FFC145', 0x12 / 255 * 1.7).slice(1) && RegExp.$1 === ctx.App._wTint('#FFC145', 0.32).slice(1));
check('testimonials: a pale blue box with the gold rule', /\[style\*="border-left:3px solid var\(--accent\)"\]\{background:#F3F7FB/.test(w));
check('charts: smoother lines, rounded bars, GSF gold, recessive grid and ticks', /tension:0\.42/.test(w) && /borderRadius:8,/.test(w) && /borderColor:'#F2B01E'/.test(w) && /backgroundColor:'#4389C81c'/.test(w) && /GRID='rgba\(0,47,76,0\.06\)',TICK='#7A8B9C'/.test(w));
check('Chart.js defaults (Nunito, round legend keys, rounded bars) load right after the library', /chart\.umd\.min\.js"><\/script><script>if\(window\.Chart\)\{var D=Chart\.defaults;D\.font\.family=[^<]*usePointStyle=true[^<]*D\.elements\.bar\.borderRadius=8/.test(w));
check('Nunito is loaded, and used for headings and numbers too', /fonts\.googleapis\.com\/css2\?family=Nunito/.test(w) && /--serif:var\(--sans\);--mono:var\(--sans\)/.test(w));
check('the map runs Polo to Prussian (few learners light), and its legend too', /ramp=\['#E4EEF8','#C3D8EC','#91B5D9','#4F8FCB','#1F5F95','#002F4C'\]/.test(w) && /linear-gradient\(90deg,#E4EEF8,#C3D8EC,#91B5D9,#4F8FCB,#1F5F95,#002F4C\)/.test(w));
check('no dark colour survives', !/#001523|#001a2b|#002a42|#eef4f9/i.test(w));
check('the font and stylesheet go last in <head>', w.indexOf('id="white-theme"') < w.indexOf('</head>') && w.indexOf('family=Nunito') < w.indexOf('</head>'));
check('empty input stays empty', W('') === '' && W(null) === '');

console.log(`\n${ok}/${ok + bad} passed`);
process.exit(bad ? 1 : 0);
