// The dashboard tab bar: extracted verbatim from ui.js and evaluated for one active tab.
const fs = require('fs'); const src = fs.readFileSync(require('path').resolve(__dirname, '..', 'js', 'ui.js'), 'utf8');
let ok = 0, bad = 0; const check = (n, c, d) => { (c ? ok++ : bad++); console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d !== undefined ? '  →  ' + String(d).slice(0, 240) : '')); };
const END = "secPills.map(dashPill).join('') + '</div>' : '');";
const a = src.indexOf('            const dashSections = ['); const b = src.indexOf(END, a) + END.length;
const block = src.slice(a, b);
const build = new Function('dt', block + '\nreturn dashPills;');
const ctx = { escapeHtml: (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') };
const html = build.call(ctx, 'institutions');
const container = src.match(/<div class="([^"]*)">\$\{dashPills\}<\/div>/);
const SECTIONS = { overview: ['overview', 'quarterly'], reach: ['learners', 'geography', 'conflict', 'physicians', 'nurses', 'institutions'], quality: ['performance', 'feedback', 'forum'], trends: ['compare', 'journeys'], website: ['testimonials'] };
check('five sections, then the views of the open one (Reach: six), one section and one view active (3 Nov 2026)',
  (html.match(/aria-pressed=/g) || []).length === 5 && (html.match(/aria-pressed="true"/g) || []).length === 1 && /aria-pressed="true"[^>]*>[^<]*<i data-lucide="users"/.test(html)
  && (html.match(/aria-current=/g) || []).length === 6 && (html.match(/aria-current="page"/g) || []).length === 1 && /App\._dashTab='institutions'; App\.renderView\(\)" aria-current="page"/.test(html), html.slice(0, 200));
check('every one of the 14 views sits in exactly one section, reachable from it', Object.entries(SECTIONS).every(([sec, keys]) => { const h = build.call(ctx, keys[0]); return keys.length === 1 ? h.includes(`_dashSecTab('${sec}')`) && new RegExp(sec + ": '" + keys[0] + "'").test(src) : keys.every(k => h.includes(`App._dashTab='${k}'`)); }) && Object.values(SECTIONS).flat().length === 14);
check('a one-view section (Website) shows no second row', !/border-t/.test(build.call(ctx, 'testimonials')) && /border-t/.test(html));
check('a section opens on the view last used in it, else its first', /_dashSecTab\(sec\) \{[\s\S]*?reach: 'learners'[\s\S]*?this\._dashSecLast && this\._dashSecLast\[sec\]/.test(src) && /this\._dashSecLast = Object\.assign\(\{\}, this\._dashSecLast, \{ \[curSec\]: dt \}\)/.test(src));
check('every pill nowrap + tooltip', (html.match(/<button /g) || []).length === 11 && (html.match(/whitespace-nowrap/g) || []).length === 11 && (html.match(/ title="/g) || []).length === 6);
const trends = build.call(ctx, 'compare');
check('short labels on the long names; full names live in the tooltips', /> Physicians</.test(html) && /> Nurses</.test(html) && /> Compare</.test(trends) && /> Journeys</.test(trends) && /> Conflict</.test(html) && /title="Physician Reach"/.test(html) && /title="Compare periods"/.test(trends) && /title="Learner journeys"/.test(trends) && /title="Conflict-affected countries/.test(html));
check('no tools group in the bar any more; Data Health and Lookup are not tabs', !/ml-auto/.test(html) && !/Data Health/.test(html) && !/Lookup/.test(html) && !/data-edit-only/.test(html));
check('Learner lookup lives on the Directory page: edit-only, never exported', /<!-- ── Learner lookup[\s\S]*?<div data-edit-only data-no-export id="learner-lookup"[\s\S]*?_dashLookupHtml\(\)/.test(src) && src.indexOf('id="learner-lookup"') < src.indexOf("else if (this.view === 'upload')"));
check('Data health lives on the Data Sync page, above the Danger Zone', /<div id="data-health"[\s\S]*?_dashHealthHtml\(this\.getAnalyticsSnap\(\)[\s\S]*?<!-- ── Danger Zone ── -->/.test(src));
check('retired tab keys fall back to the overview everywhere', /_dashTabKey\(\) \{[\s\S]*?k === 'health' \|\| k === 'lookup'/.test(src) && !/if \(dt === 'lookup'\)/.test(src) && !/if \(dt === 'health'\)/.test(src) && /_DASH_HTML_TABS: \['institutions', 'compare', 'journeys'\]/.test(src));
check('tab keys unchanged (saved dashboard tab keeps working)', ['overview','quarterly','learners','geography','performance','feedback','conflict','physicians','nurses','institutions','compare','journeys','forum','testimonials'].every(k => new RegExp("\\['" + k + "', ").test(block)));
check('bar is a wrapping full-width flex container', !!container && /\bflex\b/.test(container[1]) && /flex-wrap/.test(container[1]) && !/inline-flex/.test(container[1]), container && container[1]);
console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
