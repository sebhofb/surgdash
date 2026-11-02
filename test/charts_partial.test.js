// Ticking "Include <month> (partial)" on a running-total chart (charts.js drawCumulativeTimeline) only adds or
// removes the month in progress: the scales do not move, so the other months' points stay put (Seb, 2 Nov 2026:
// October's point moved when November was ticked), and the running total is drawn straight, never smoothed.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 300) : '')); };

const drawn = [];
class DataTable { constructor() { this.cols = []; this.rows = []; } addColumn(t, l) { this.cols.push(l); } addRow(r) { this.rows.push(r); } }
class Chart { constructor(el) { this.el = el; } draw(dt, opts) { drawn.push({ dt, opts }); } }
const NOW = Date.UTC(2026, 10, 2, 9);   // 2 Nov 2026: November is in progress
const ctx = { console: { log() {}, warn() {}, error() {} }, Math, JSON, Object, Array, Number, String, Map, Set, RegExp, Error, Promise, isNaN, parseInt, parseFloat, setTimeout, Intl,
  Date: class extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } },
  document: { getElementById: (id) => ({ id }) },
  google: { visualization: { DataTable, ComboChart: Chart, LineChart: Chart } } };
ctx.window = ctx; ctx.App = { includePartialMonth: false };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8'), ctx, { filename: 'charts.js' });
const C = ctx.Charts; C.isReady = true; C._registerChart = () => {};

const monthly = { '2026-07': 2900, '2026-08': 4400, '2026-09': 3350, '2026-10': 3945, '2026-11': 150 };
const draw = (partial, bars, opts) => { ctx.App.includePartialMonth = partial; drawn.length = 0; C.drawCumulativeTimeline('c', monthly, 'Users', '#123', bars, opts || {}); return drawn[0]; };

const off = draw(false, true), on = draw(true, true);
check('without the month in progress it is left out; with it, it is added', off.dt.rows.length === 4 && on.dt.rows.length === 5);
const oct = (d) => d.dt.rows.find(r => /Oct/.test(r[0]));
check('October\'s numbers are the same either way', JSON.stringify(oct(off).slice(1)) === JSON.stringify(oct(on).slice(1)) && oct(on)[2] === 3945, JSON.stringify([oct(off), oct(on)]));
const ax = (d, i) => d.opts.vAxes[i].viewWindow;
check('the running-total scale does not move when the month is ticked', JSON.stringify(ax(off, 0)) === JSON.stringify(ax(on, 0)) && ax(on, 0).max >= 14745, JSON.stringify([ax(off, 0), ax(on, 0)]));
check('nor does the monthly scale', JSON.stringify(ax(off, 1)) === JSON.stringify(ax(on, 1)) && ax(on, 1).max >= 4400, JSON.stringify([ax(off, 1), ax(on, 1)]));
check('the scales end on a round number', ax(on, 0).max === 15000 && ax(on, 1).max === 5000, JSON.stringify([ax(on, 0), ax(on, 1)]));
check('the running total is drawn with straight segments, not a smoothed curve that bulges above the points', !on.opts.series[0].curveType && !on.opts.curveType);
const lineOff = draw(false, false), lineOn = draw(true, false);
check('the same holds with the monthly bars switched off', JSON.stringify(lineOff.opts.vAxis.viewWindow) === JSON.stringify(lineOn.opts.vAxis.viewWindow) && !lineOn.opts.curveType, JSON.stringify([lineOff.opts.vAxis.viewWindow, lineOn.opts.vAxis.viewWindow]));
const last3 = draw(true, true, { monthLimit: '3' });
check('a shorter window scales the bars to the months it shows', last3.dt.rows.length === 3 && last3.opts.vAxes[1].viewWindow.max === 4000, JSON.stringify(last3.opts.vAxes[1].viewWindow));
const trim = draw(false, true, { trimYAxis: true }), trimOn = draw(true, true, { trimYAxis: true });
check('the trimmed (zoomed) view keeps its floor, and still does not move', trim.opts.vAxes[0].viewWindow.min > 0 && JSON.stringify(trim.opts.vAxes[0].viewWindow) === JSON.stringify(trimOn.opts.vAxes[0].viewWindow));
check('round axis tops', C._niceMax(3945) === 4000 && C._niceMax(5640) === 6000 && C._niceMax(14745) === 15000 && C._niceMax(101) === 120 && C._niceMax(0) === 0);

console.log('\n' + ok + '/' + (ok + bad) + ' passed');
process.exit(bad ? 1 : 0);
