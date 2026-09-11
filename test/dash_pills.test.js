// The dashboard tab bar: extracted verbatim from ui.js and evaluated for one active tab.
const fs = require('fs'); const src = fs.readFileSync(require('path').resolve(__dirname, '..', 'js', 'ui.js'), 'utf8');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 240) : '')); };
const a = src.indexOf('            const dashPillDefs = ['); const b = src.indexOf("const dashPills = dashPillDefs.map(dashPill).join('');", a) + "const dashPills = dashPillDefs.map(dashPill).join('');".length;
const block = src.slice(a, b);
const build = new Function('dt', block + '\nreturn dashPills;');
const html = build.call({ escapeHtml: (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') }, 'institutions');
const container = src.match(/<div class="([^"]*)">\$\{dashPills\}<\/div>/);
check('11 pills, one active (Institutions), every pill nowrap + tooltip', (html.match(/<button /g) || []).length === 11 && (html.match(/bg-gsf-prussian/g) || []).length === 1 && (html.match(/whitespace-nowrap/g) || []).length === 11 && (html.match(/ title="/g) || []).length === 11);
check('short labels on the long names; full names live in the tooltips', /> Physicians</.test(html) && /> Nurses</.test(html) && /> Compare</.test(html) && /> Journeys</.test(html) && /> Conflict</.test(html) && /title="Physician Reach"/.test(html) && /title="Compare periods"/.test(html) && /title="Learner journeys"/.test(html) && /title="Conflict Settings/.test(html));
check('no tools group in the bar any more; Data Health and Lookup are not tabs', !/ml-auto/.test(html) && !/Data Health/.test(html) && !/Lookup/.test(html) && !/data-edit-only/.test(html));
check('Learner lookup lives on the Directory page: edit-only, never exported', /<!-- ── Learner lookup[\s\S]*?<div data-edit-only data-no-export id="learner-lookup"[\s\S]*?_dashLookupHtml\(\)/.test(src) && src.indexOf('id="learner-lookup"') < src.indexOf("else if (this.view === 'upload')"));
check('Data health lives on the Data Sync page, above the Danger Zone', /<div id="data-health"[\s\S]*?_dashHealthHtml\(this\.getAnalyticsSnap\(\)[\s\S]*?<!-- ── Danger Zone ── -->/.test(src));
check('retired tab keys fall back to the overview everywhere', /_dashTabKey\(\) \{[\s\S]*?k === 'health' \|\| k === 'lookup'/.test(src) && !/if \(dt === 'lookup'\)/.test(src) && !/if \(dt === 'health'\)/.test(src) && /_DASH_HTML_TABS: \['institutions', 'compare', 'journeys'\]/.test(src));
check('tab keys unchanged (saved dashboard tab keeps working)', ['overview','learners','geography','performance','feedback','conflict','physicians','nurses','institutions','compare','journeys'].every(k => html.includes(`App._dashTab='${k}'`)));
check('bar is a wrapping full-width flex container', !!container && /\bflex\b/.test(container[1]) && /flex-wrap/.test(container[1]) && !/inline-flex/.test(container[1]), container && container[1]);
console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
