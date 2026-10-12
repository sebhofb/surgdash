// White design for the web report (js/reportTheme.js): pure white page, text in ink
// (never an accent colour), labels in brand blue, marks keep colour, map light→dark.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 260) : '')); };
const ctx = { console }; ctx.window = ctx; ctx.App = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/reportTheme.js'), 'utf8'), ctx);
const W = (h) => ctx.App.reportToWhite(h);

const page = '<html><head><style>:root{--bg:#001523;--accent:#FFC145}</style></head><body style="background:#001523;color:#eef4f9">'
  + '<p style="font-size:10px;text-transform:uppercase;color:#4389C8">Enrolled learners</p>'
  + '<span style="font-size:40px;color:var(--accent);line-height:1">10.2 mo</span>'
  + '<b style="color:#E28743">4.76</b> avg rating'
  + '<div style="border-left:3px solid #4389C8;background:#002a42">quote<span style="color:var(--accent);font-size:11px;margin-left:8px;letter-spacing:.1em">★★★★★</span></div>'
  + '<div style="border:1px solid #FFC14538;background:linear-gradient(135deg,#FFC14512,#001a2b 70%)">impact</div>'
  + '<div class="kcard" style="background:linear-gradient(160deg,#A78BFA14,#001a2b 72%)"><div style="position:absolute;height:3px;background:#A78BFA"></div></div>'
  + '<script>var GRID=\'rgba(255,255,255,0.06)\',TICK=\'#6d8ba3\';var ramp=[\'#123a5c\',\'#1a5485\',\'#2474b3\',\'#3f97d6\',\'#74bce9\',\'#bce3fb\'];var ds={borderColor:\'#FFC145\',backgroundColor:\'#4389C81c\'};</script>'
  + '<div style="background:linear-gradient(90deg,#123a5c,#1a5485,#2474b3,#3f97d6,#74bce9,#bce3fb)"></div></body></html>';
const w = W(page);

check('the page is pure white with ink text', /body style="background:#ffffff;color:#0B2233"/.test(w) && /html,body\{background:#ffffff!important/.test(w));
check('a small-caps label keeps its own colour, deepened to read on white', /text-transform:uppercase;color:#(\w{6})">Enrolled learners/.test(w) && RegExp.$1 !== '4389C8' && ctx.App._wDeep('#4389C8') === '#' + RegExp.$1);
check('figures are never gold or orange: ink', /font-size:40px;color:#2B3F52;line-height:1">10\.2 mo/.test(w) && /<b style="color:#2B3F52">4\.76/.test(w));
check('star ratings keep the gold', /color:#E3A008;font-size:11px;margin-left:8px;letter-spacing:\.1em">★/.test(w));
check('a coloured rule (a mark) keeps its colour; dark panels become the light wash', /border-left:3px solid #4389C8;background:#F7F9FB/.test(w));
check('coloured boxes: a dark card\'s tinted gradient becomes a flat light tint of its colour, its border a stronger tint',
  /class="kcard" style="background:#F3F0FE"/.test(w) && /border:1px solid #(\w{6});background:#(\w{6})">impact/.test(w) && RegExp.$2 === ctx.App._wTint('#FFC145', 0x12 / 255 * 1.7).slice(1) && RegExp.$1 === ctx.App._wTint('#FFC145', 0.32).slice(1), w.match(/class="kcard" style="[^"]*"/)[0]);
check('testimonials are a warm box with the gold rule', /\[style\*="border-left:3px solid var\(--accent\)"\]\{background:#FFF8E7/.test(w));
check('the coloured bar on top of a stat tile is hidden', /\.kcard>div\[style\*="height:3px"\]\{display:none!important\}/.test(w));
check('chart marks: deeper gold line, the blue fill keeps its alpha; recessive grid and ticks', /borderColor:'#E3A008'/.test(w) && /backgroundColor:'#4389C81c'/.test(w) && /GRID='rgba\(11,34,51,0\.06\)',TICK='#6B7C8F'/.test(w));
check('the map ramp runs light to dark (few learners light), and its legend too', /ramp=\['#D6E6F4','#AECDEA','#7FAFDC','#4F8FCB','#2A6DAA','#0E4C80'\]/.test(w) && /linear-gradient\(90deg,#D6E6F4,#AECDEA,#7FAFDC,#4F8FCB,#2A6DAA,#0E4C80\)/.test(w));
check('no dark colour survives', !/#001523|#001a2b|#002a42|#eef4f9/i.test(w));
check('the light stylesheet goes last in <head>', w.indexOf('id="white-theme"') > w.indexOf(':root{--bg:#ffffff') - 9999 && w.indexOf('id="white-theme"') < w.indexOf('</head>'));
check('empty input stays empty', W('') === '' && W(null) === '');

console.log(`\n${ok}/${ok + bad} passed`);
process.exit(bad ? 1 : 0);
