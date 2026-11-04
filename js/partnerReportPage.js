// ── The partner dashboard's own script (Nov 2026) ─────────────────────────────────────────
//
// Runs inside the published page, never in SURGdash: _buildPartnerReportHtml (partnerReport.js)
// writes this function's source into the page after `var DATA=…` (Function.prototype.toString),
// so it is ordinary code here, tested like the rest. It may use only DATA and the page's own
// elements, and stays plain ES5 so it runs in any browser a partner uses.
//
// What it draws: the header globe, the period bar (all time, presets or custom dates, compared
// with the previous period or the same period a year earlier), the overview figures with their
// explanations, the growth chart (running totals for all time; new enrolments and certificates
// per day, week or month for a period, with the comparison dashed), the map, the ratings by month,
// the survey, learner voices and stories, the sortable course table with each course's labels,
// a page per course (#course-<n>), the awards with medals and the methodology page (#methodology).
//
// A period counts the enrolment and certificate records that carry a date (DATA.recs: course,
// enrolment day, certificate day, country), so its figures can differ slightly from the all-time
// course totals, which come from SURGhub's own course counts. Ratings by period are by month.
// The survey questions, learning impact and learning time are all time only (no dates per answer).
Object.assign(window.App, {
    _prPageScript: function () {
        var D = DATA, DAY = 86400000;
        function fmt(n) { return Math.round(+n || 0).toLocaleString('en-GB'); }
        function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
        function $(id) { return document.getElementById(id); }
        function mName(m, long) { var p = String(m).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, 15)).toLocaleDateString('en-GB', { month: long ? 'long' : 'short', year: 'numeric', timeZone: 'UTC' }); }
        function dnum(s) { var p = String(s).split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / DAY); }
        function dstr(n) { return new Date(n * DAY).toISOString().slice(0, 10); }
        function dName(n, noYear) { var o = { day: 'numeric', month: 'short', timeZone: 'UTC' }; if (!noYear) o.year = 'numeric'; return new Date(n * DAY).toLocaleDateString('en-GB', o); }
        function dLong(n) { return new Date(n * DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }
        function span(a, b) { var sameY = dstr(a).slice(0, 4) === dstr(b).slice(0, 4); return a === b ? dName(a) : dName(a, sameY) + ' to ' + dName(b); }
        function list(a) { return a.length < 2 ? a.join('') : a.length === 2 ? a.join(' and ') : a.slice(0, -1).join(', ') + ', and ' + a[a.length - 1]; }
        function nice(max, parts) { var raw = Math.max(1, max) / parts, p = Math.pow(10, Math.floor(Math.log10(raw))), st = [1, 2, 2.5, 5, 10].map(function (x) { return x * p; }).filter(function (x) { return x >= raw; })[0]; return { step: st, top: st * Math.ceil(Math.max(1, max) / st) }; }
        var tip = $('tip');
        function showTip(html, x, y) { tip.innerHTML = html; tip.hidden = false; var w = tip.offsetWidth, h = tip.offsetHeight, X = x + 16, Y = y + 16; if (X + w > innerWidth - 8) X = x - w - 16; if (Y + h > innerHeight - 8) Y = y - h - 16; tip.style.left = Math.max(8, X) + 'px'; tip.style.top = Math.max(8, Y) + 'px'; }
        function hideTip() { tip.hidden = true; }
        function evXY(ev) { return ev.touches ? [ev.touches[0].clientX, ev.touches[0].clientY] : [ev.clientX, ev.clientY]; }

        // ── the period ──
        var END = D.dataTo ? dnum(D.dataTo) : dnum(D.updated);
        var PRESETS = [['all', 'All time'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['lastq', 'Last full quarter'], ['ytd', 'This year so far'], ['12m', 'Last 12 months'], ['lasty', 'Last year'], ['custom', 'Choose dates']];
        var P = { k: 'all', a: null, b: null, cmp: 'none' };
        function presetRange(k) {
            var d = new Date(END * DAY), y = d.getUTCFullYear(), m = d.getUTCMonth();
            if (k === '30d') return [END - 29, END];
            if (k === '90d') return [END - 89, END];
            if (k === '12m') return [END - 364, END];
            if (k === 'ytd') return [dnum(y + '-01-01'), END];
            if (k === 'lasty') return [dnum((y - 1) + '-01-01'), dnum((y - 1) + '-12-31')];
            if (k === 'lastq') { var q = Math.floor(m / 3) - 1, yy = y; if (q < 0) { q = 3; yy--; } return [Math.round(Date.UTC(yy, q * 3, 1) / DAY), Math.round(Date.UTC(yy, q * 3 + 3, 1) / DAY) - 1]; }
            return null;
        }
        function yearBack(n) { var x = new Date(n * DAY); return Math.round(Date.UTC(x.getUTCFullYear() - 1, x.getUTCMonth(), x.getUTCDate()) / DAY); }
        function cmpRange() { if (!P.a || P.cmp === 'none') return null; if (P.cmp === 'prev') { var len = P.b - P.a + 1; return [P.a - len, P.a - 1]; } return [yearBack(P.a), yearBack(P.b)]; }
        function cmpName() { return P.cmp === 'prev' ? 'the previous ' + (P.b - P.a + 1) + ' days' : 'the same dates a year earlier'; }
        // enrolments and certificates dated in [a, b], for one course or all, with countries
        function agg(ci, a, b) {
            var o = { e: 0, c: 0, ct: {}, known: 0, by: {} };
            D.recs.forEach(function (r) {
                if (ci != null && r[0] !== ci) return;
                var pc = o.by[r[0]] || (o.by[r[0]] = { e: 0, c: 0 });
                if (r[1] >= a && r[1] <= b) { o.e++; pc.e++; if (r[3] >= 0) { var n = D.rc[r[3]]; o.ct[n] = (o.ct[n] || 0) + 1; o.known++; } }
                if (r[2] >= a && r[2] <= b) { o.c++; pc.c++; }
            });
            return o;
        }
        // the average rating over the months a period touches: [[month, average, ratings]]
        function rateIn(rows, a, b) { var am = dstr(a).slice(0, 7), bm = dstr(b).slice(0, 7), s = 0, n = 0; (rows || []).forEach(function (r) { if (r[0] >= am && r[0] <= bm) { s += r[1] * r[2]; n += r[2]; } }); return n ? { avg: s / n, n: n } : null; }
        function delta(cur, prev, pts) {
            if (prev == null) return '';
            if (pts) { var dd = cur - prev; return '<span class="' + (dd >= 0 ? 'up' : 'down') + '">' + (dd >= 0 ? '+' : '−') + Math.abs(dd).toFixed(2) + '</span> on ' + prev.toFixed(2); }
            if (!prev) return cur ? '<span class="up">New</span> (none before)' : 'None either time';
            var p = (cur - prev) / prev * 100; return '<span class="' + (p >= 0 ? 'up' : 'down') + '">' + (p >= 0 ? '+' : '−') + Math.abs(p).toFixed(0) + '%</span> on ' + fmt(prev);
        }

        // ── dialogs ──
        var INFO = [], dlg = $('info'), lastFocus = null;
        function info(x) { INFO.push(x); return INFO.length - 1; }
        function stat(v, l, s, inf, d) {
            var body = '<span class="stat-v">' + v + '</span><span class="stat-l">' + l + '</span>' + (s ? '<span class="stat-s">' + s + '</span>' : '') + (d ? '<span class="stat-d">' + d + '</span>' : '');
            if (!inf) return '<div class="stat" style="cursor:default">' + body + '</div>';
            inf.v = v; inf.l = l;
            return '<button type="button" class="stat" data-info="' + info(inf) + '" aria-haspopup="dialog" title="More about this figure">' + body + '</button>';
        }
        function fact(l, v) { return '<div class="fact"><span>' + l + '</span><b>' + v + '</b></div>'; }
        function openInfo(i) {
            var x = INFO[i]; if (!x) return; lastFocus = document.activeElement;
            dlg.classList.toggle('wide', !!x.wide);
            $('info-e').textContent = x.e || 'About this figure'; $('info-t').textContent = x.t || x.l || ''; $('info-v').innerHTML = x.v || ''; $('info-b').innerHTML = x.b;
            if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', ''); $('info-x').focus();
        }
        function closeInfo() { if (dlg.close && dlg.open) dlg.close(); else dlg.removeAttribute('open'); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
        $('info-x').addEventListener('click', closeInfo);
        dlg.addEventListener('click', function (ev) { if (ev.target === dlg) { closeInfo(); return; } var a = ev.target.closest ? ev.target.closest("a[href^='#']") : null; if (a) { lastFocus = null; closeInfo(); } });
        document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && dlg.hasAttribute('open')) closeInfo(); });
        document.addEventListener('click', function (ev) { var b = ev.target.closest ? ev.target.closest('[data-reset]') : null; if (!b) return; var k = $('p-k'); if (k) { k.value = 'all'; k.dispatchEvent(new Event('change')); } });
        document.addEventListener('click', function (ev) { var b = ev.target.closest ? ev.target.closest('[data-info]') : null; if (b) { ev.preventDefault(); openInfo(+b.getAttribute('data-info')); } });

        // ── awards: medals and what each one means ──
        var MEDAL = { 1: ['#FFC145', '#B9850D', 'Gold'], 2: ['#DCE3EA', '#8796A5', 'Silver'], 3: ['#E8AE7E', '#A5622F', 'Bronze'] };
        function medal(r, size) {
            var m = MEDAL[r]; size = size || 30;
            if (!m) return '<svg class="medal" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true"><circle cx="12" cy="14" r="7.5" fill="none" stroke="#cde1f0" stroke-width="1.5" stroke-dasharray="2 2"/></svg>';
            return '<svg class="medal" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" role="img" aria-label="' + m[2] + '"><path d="M7.5 1h3.6l2.2 7h-3.6z" fill="#0468b1"/><path d="M16.5 1h-3.6l-2.2 7h3.6z" fill="#91b5d9"/><circle cx="12" cy="14.5" r="7.5" fill="' + m[0] + '" stroke="' + m[1] + '" stroke-width="1.4"/><circle cx="12" cy="14.5" r="5" fill="none" stroke="' + m[1] + '" stroke-opacity=".5"/><text x="12" y="17.6" text-anchor="middle" font-size="8.5" font-weight="700" font-family="Arial,sans-serif" fill="#002f4c">' + r + '</text></svg>';
        }
        var AW = {
            courses: ['Most courses', 'The number of courses a provider has on SURGhub.'],
            enrol: ['Most course enrolments', 'Every enrolment in the courses, whether or not the learner has started.'],
            certs: ['Most certificates', 'Course certificates learners have earned.'],
            completion: ['Highest certification rate', 'Certificates divided by enrolments. Providers need at least 100 enrolments, courses at least 50.'],
            mins: ['Most learning time', 'The time learners have spent in the courses, as SURGhub records it.'],
            rating: ['Highest rated', 'The average overall rating in the end-of-course survey, weighted by responses. Providers need at least 150 responses, courses at least 50.'],
            q90: ['Most certificates in the last 90 days', 'Certificates earned in the 90 days before the update; at least 5.'],
            reach: ['Widest reach', 'The number of countries learners come from. Providers need at least 100 enrolments, courses at least 50.'],
            mission: ['Mission reach', 'Learners from low-income and lower-middle-income countries (World Bank income groups).'],
            impact: ['Highest intent to apply', 'The share of survey answers saying the learner is likely to apply what they learnt (4 or 5 out of 5). Providers need at least 150 answers, courses at least 50.']
        };
        function ord(r) { return r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : r + 'th'; }
        function awardsFor(list, who) { return (list || []).slice().sort(function (a, b) { return a.r - b.r; }); }
        function awardLines(list, who) {
            return awardsFor(list).map(function (a) { var d = AW[a.k] || [a.k, '']; return '<li>' + medal(a.r, 30) + '<span><b>' + esc(d[0]) + '</b><small>' + ord(a.r) + ' of ' + fmt(a.n) + ' ' + who + (a.v ? ' · ' + esc(a.v) : '') + '</small></span></li>'; }).join('');
        }
        var AWG = [['Reach', ['enrol', 'reach', 'mission', 'courses']], ['Completion', ['certs', 'completion', 'q90']], ['Quality and engagement', ['rating', 'impact', 'mins']]];
        function awardsDialog(list, who, course) {
            var won = {}, have = [], grouped = {}; (list || []).forEach(function (a) { won[a.k] = a; });
            D.cats.forEach(function (c) { if (!(course && c.p)) have.push(c.k); });
            AWG.forEach(function (g) { g[1].forEach(function (k) { grouped[k] = 1; }); });
            var groups = AWG.map(function (g) { return [g[0], g[1].filter(function (k) { return have.indexOf(k) >= 0; })]; }).concat([['Other', have.filter(function (k) { return !grouped[k]; })]]).filter(function (g) { return g[1].length; });
            var body = groups.map(function (g) {
                return '<h4>' + esc(g[0]) + '</h4><div class="aw-grid">' + g[1].map(function (k) {
                    var a = won[k], d = AW[k] || [k, ''];
                    return '<div class="aw-cell' + (a ? ' won' : '') + '">' + medal(a ? a.r : 0, 34) + '<div><b>' + esc(d[0]) + '</b>' + (a ? '<span class="aw-won">' + MEDAL[a.r][2] + ': ' + ord(a.r) + ' of ' + fmt(a.n) + ' ' + who + (a.v ? ' (' + esc(a.v) + ')' : '') + '</span>' : '') + '<p>' + esc(d[1]) + '</p></div></div>';
                }).join('') + '</div>';
            }).join('');
            return { e: 'Awards', t: 'SURGhub awards', wide: true, b: '<p>SURGhub recognises the top three ' + who + ' in each category: gold for first, silver for second, bronze for third. Standings are for all time and are worked out again at every update' + (D.awAsOf ? ' (' + esc(D.awAsOf) + ')' : '') + '.</p>' + body + '<p class="note"><a href="#methodology">How awards are decided</a></p>' };
        }

        // ── course labels (Popular, Trending, …) and Featured ──
        var BADGE = {
            Featured: ['megaphone', 'Featured', 'Chosen by the SURGhub team to promote on surghub.org, for example as the course in the site menu\'s spotlight. The label stays to show when it was featured.'],
            Popular: ['flame', 'Popular', 'Among the 15% of SURGhub courses with the most enrolments in the last 90 days.'],
            Trending: ['trend', 'Trending', 'A course on SURGhub for at least 90 days with 40 or more enrolments in the last 30 days, at least one and a half times its usual pace.'],
            'Top rated': ['star', 'Top rated', 'Among the top 10% of SURGhub courses by average survey rating, of the courses rated by 50 or more learners.'],
            New: ['spark', 'New', 'Published on SURGhub in the last 90 days.'],
            'CME/CPD': ['cap', 'CME/CPD', 'Offers continuing medical education or continuing professional development credit.']
        };
        var BI = {
            megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
            flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
            trend: '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
            star: '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z"/>',
            spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
            cap: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>'
        };
        function featuredText(ranges) {
            var months = []; (ranges || []).forEach(function (r) { var a = dnum(r[0]), b = r[1] ? dnum(r[1]) : END; for (var x = new Date(a * DAY); Math.round(x.getTime() / DAY) <= b; x = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 1))) { var m = x.toISOString().slice(0, 7); if (months.indexOf(m) < 0) months.push(m); } });
            months.sort(); if (!months.length) return '';
            var y = function (m) { return m.slice(0, 4); }, mo = function (m) { return mName(m, true).replace(/ \d{4}$/, ''); };
            if (months.length === 1) return 'Featured in ' + mName(months[0], true);
            if (months.length === 2 && y(months[0]) === y(months[1])) return 'Featured in ' + mo(months[0]) + ' and ' + mName(months[1], true);
            return 'Featured ' + mName(months[0], true) + ' to ' + mName(months[months.length - 1], true);
        }
        function badges(c) {
            var out = [], ft = featuredText(c.featured);
            if (ft) out.push(['Featured', ft]);
            (c.tags || []).forEach(function (t) { if (BADGE[t] && t !== 'Featured') out.push([t, BADGE[t][1]]); });
            if (!out.length) return '';
            return '<span class="badges">' + out.map(function (b) { var d = BADGE[b[0]]; return '<button type="button" class="badge b-' + d[0] + '" data-info="' + info(labelsInfo(b[0], b[1])) + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + BI[d[0]] + '</svg>' + esc(b[1]) + '</button>'; }).join('') + '</span>';
        }
        // every label there is and what it means; `focus` (the one chosen) comes first and is marked
        function labelsInfo(focus, text) {
            var order = ['Featured', 'Popular', 'Trending', 'Top rated', 'New', 'CME/CPD'];
            if (focus) order = [focus].concat(order.filter(function (k) { return k !== focus; }));
            return { e: 'Course labels', t: focus ? text : 'Course labels', b: '<p>Courses carry the same labels as on surghub.org. They are worked out again at every update, except Featured, which the SURGhub team sets.</p>'
                + order.map(function (k) { var d = BADGE[k]; return '<div class="lb-row' + (k === focus ? ' on' : '') + '"><span class="badge static b-' + d[0] + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + BI[d[0]] + '</svg>' + esc(k === focus && text ? text : d[1]) + '</span><p>' + esc(d[2]) + '</p></div>'; }).join('')
                + '<p class="note"><a href="#methodology">More in the methodology</a></p>' };
        }

        // ── charts ──
        // all time: running totals by month, with the monthly numbers as bars on their own scale
        function growth(el, monthly) {
            if (!monthly || monthly.length < 2) { el.innerHTML = '<p class="note">Not enough months yet to draw a chart.</p>'; return; }
            var st = { e: true, c: true, bars: false }, cum = [], e = 0, c = 0;
            monthly.forEach(function (r) { e += r[1]; c += r[2]; cum.push({ m: r[0], e: e, c: c, de: r[1], dc: r[2] }); });
            el.innerHTML = '<div class="toggles" role="group" aria-label="Show in the chart"><button class="tg" data-k="e" aria-pressed="true"><i style="background:#0468b1"></i>Course enrolments</button><button class="tg" data-k="c" aria-pressed="true"><i style="background:#f08a24"></i>Certificates</button><button class="tg" data-k="bars" aria-pressed="false"><i style="background:#91b5d9;height:10px;width:10px"></i><i style="background:#ffd29c;height:10px;width:10px;margin-left:-6px"></i>Numbers each month</button></div><div class="chart"></div>';
            var box = el.querySelector('.chart');
            el.querySelectorAll('.tg').forEach(function (b) { b.addEventListener('click', function () { var k = b.getAttribute('data-k'); st[k] = !st[k]; if (!st.e && !st.c && !st.bars) st[k] = true; b.setAttribute('aria-pressed', String(st[k])); draw(); }); });
            function draw() {
                var W = 1000, H = 330, L = 64, R = st.bars ? 64 : 16, T = 16, B = 40, w = W - L - R, h = H - T - B, n = cum.length, last = cum[n - 1];
                var lmax = Math.max(st.e ? last.e : 0, st.c ? last.c : 0, 1), bmax = 1; cum.forEach(function (r) { if (st.e) bmax = Math.max(bmax, r.de); if (st.c) bmax = Math.max(bmax, r.dc); });
                var A = nice(lmax, 4), Bs = nice(bmax, 4);
                var x = function (i) { return L + (n === 1 ? 0 : i * w / (n - 1)); }, y = function (v) { return T + h - v / A.top * h; }, yb = function (v) { return T + h - v / Bs.top * h; };
                var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Course enrolments and certificates by month">';
                for (var i = 0; i * A.step <= A.top + 1e-9; i++) { var v = i * A.step, yy = y(v).toFixed(1); s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" stroke="#dee7ef"/><text x="' + (L - 10) + '" y="' + yy + '" dy="4" text-anchor="end" font-size="13" fill="#4a6b82">' + fmt(v) + '</text>'; }
                if (st.bars) {
                    for (var j = 0; j * Bs.step <= Bs.top + 1e-9; j++) { var vb = j * Bs.step; s += '<text x="' + (W - R + 10) + '" y="' + yb(vb).toFixed(1) + '" dy="4" font-size="13" fill="#4a6b82">' + fmt(vb) + '</text>'; }
                    var bw = Math.max(2, w / n * 0.7), half = (st.e && st.c) ? bw / 2 : bw;
                    cum.forEach(function (r, i) { var x0 = x(i) - bw / 2; if (st.e) s += '<rect x="' + x0.toFixed(1) + '" y="' + yb(r.de).toFixed(1) + '" width="' + half.toFixed(1) + '" height="' + (T + h - yb(r.de)).toFixed(1) + '" fill="#91b5d9"/>'; if (st.c) s += '<rect x="' + (x0 + (st.e ? half : 0)).toFixed(1) + '" y="' + yb(r.dc).toFixed(1) + '" width="' + half.toFixed(1) + '" height="' + (T + h - yb(r.dc)).toFixed(1) + '" fill="#ffd29c"/>'; });
                }
                cum.forEach(function (r, i) { if (r.m.slice(5) === '01' || i === 0) s += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="' + (i === 0 ? 'start' : 'middle') + '" font-size="13" fill="#4a6b82">' + (i === 0 ? mName(r.m) : r.m.slice(0, 4)) + '</text>'; });
                function path(k) { return cum.map(function (r, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(r[k]).toFixed(1); }).join(' '); }
                if (st.e) s += '<path d="' + path('e') + ' L' + x(n - 1).toFixed(1) + ' ' + (T + h) + ' L' + L + ' ' + (T + h) + ' Z" fill="#e6f0f8" fill-opacity="' + (st.bars ? 0.5 : 1) + '"/><path d="' + path('e') + '" fill="none" stroke="#0468b1" stroke-width="3" stroke-linejoin="round"/>';
                if (st.c) s += '<path d="' + path('c') + '" fill="none" stroke="#f08a24" stroke-width="3" stroke-linejoin="round"/>';
                s += '<line class="guide" x1="0" x2="0" y1="' + T + '" y2="' + (T + h) + '" stroke="#002f4c" stroke-dasharray="3 3" visibility="hidden"/><g class="dots"></g><rect x="' + L + '" y="' + T + '" width="' + w + '" height="' + h + '" fill="transparent" class="hit"/></svg>';
                box.innerHTML = s;
                hover(box, n, x, W, L, w, function (i) { var r = cum[i]; return { pts: (st.e ? [[y(r.e), '#0468b1']] : []).concat(st.c ? [[y(r.c), '#f08a24']] : []), html: '<b>' + mName(r.m, true) + '</b>' + (st.e ? 'Course enrolments: ' + fmt(r.e) + ' in total, ' + fmt(r.de) + ' this month<br>' : '') + (st.c ? 'Certificates: ' + fmt(r.c) + ' in total, ' + fmt(r.dc) + ' this month' : '') }; });
            }
            draw();
        }
        // the hover read-out shared by the line charts
        function hover(box, n, x, W, L, w, at) {
            var svg = box.querySelector('svg'), guide = svg.querySelector('.guide'), dots = svg.querySelector('.dots'), hit = svg.querySelector('.hit');
            function idx(ev) { var r = svg.getBoundingClientRect(), px = (evXY(ev)[0] - r.left) / r.width * W; return Math.max(0, Math.min(n - 1, Math.round((px - L) / (w / (n - 1 || 1))))); }
            function move(ev) { var i = idx(ev), X = x(i).toFixed(1), o = at(i); guide.setAttribute('x1', X); guide.setAttribute('x2', X); guide.setAttribute('visibility', 'visible'); dots.innerHTML = o.pts.map(function (p) { return '<circle cx="' + X + '" cy="' + p[0].toFixed(1) + '" r="5" fill="' + p[1] + '" stroke="#fff" stroke-width="2"/>'; }).join(''); var xy = evXY(ev); showTip(o.html, xy[0], xy[1]); }
            function out() { guide.setAttribute('visibility', 'hidden'); dots.innerHTML = ''; hideTip(); }
            hit.addEventListener('mousemove', move); hit.addEventListener('mouseleave', out); hit.addEventListener('touchstart', move, { passive: true }); hit.addEventListener('touchmove', move, { passive: true }); hit.addEventListener('touchend', out);
        }
        // a period: new enrolments and certificates per day, week or month, the comparison dashed
        function buckets(a, b) {
            var len = b - a + 1, g = len <= 62 ? 'day' : len <= 210 ? 'week' : 'month', out = [];
            if (g === 'month') { var x = new Date(a * DAY); while (Math.round(x.getTime() / DAY) <= b) { var s0 = Math.max(a, Math.round(x.getTime() / DAY)), nx = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 1)); out.push([s0, Math.min(b, Math.round(nx.getTime() / DAY) - 1)]); x = nx; } }
            else { var step = g === 'day' ? 1 : 7; for (var d = a; d <= b; d += step) out.push([d, Math.min(b, d + step - 1)]); }
            return { g: g, list: out };
        }
        function series(ci, bk) { return bk.list.map(function (r) { var o = agg(ci, r[0], r[1]); return [o.e, o.c]; }); }
        function periodChart(el, ci) {
            var bk = buckets(P.a, P.b), cur = series(ci, bk), cr = cmpRange(), prev = null, st = { e: true, c: true };
            if (cr) { var shift = cr[0] - P.a; prev = series(ci, { list: bk.list.map(function (r) { return [r[0] + shift, r[1] + shift]; }) }); }
            var unit = bk.g === 'day' ? 'day' : bk.g === 'week' ? 'week' : 'month';
            el.innerHTML = '<div class="toggles" role="group" aria-label="Show in the chart"><button class="tg" data-k="e" aria-pressed="true"><i style="background:#0468b1"></i>Course enrolments</button><button class="tg" data-k="c" aria-pressed="true"><i style="background:#f08a24"></i>Certificates</button>' + (prev ? '<span class="legend-cmp"><i></i>Dashed: ' + esc(cmpName()) + '</span>' : '') + '</div><div class="chart"></div><p class="note">New each ' + unit + ', ' + esc(span(P.a, P.b)) + '.</p>';
            var box = el.querySelector('.chart');
            el.querySelectorAll('.tg').forEach(function (b) { b.addEventListener('click', function () { var k = b.getAttribute('data-k'); st[k] = !st[k]; if (!st.e && !st.c) st[k] = true; b.setAttribute('aria-pressed', String(st[k])); draw(); }); });
            function lbl(r) { return bk.g === 'month' ? mName(dstr(r[0]).slice(0, 7), true) : bk.g === 'week' ? 'Week of ' + dName(r[0]) : dName(r[0]); }
            function draw() {
                var W = 1000, H = 300, L = 56, R = 16, T = 16, B = 40, w = W - L - R, h = H - T - B, n = cur.length, mx = 1;
                [cur].concat(prev ? [prev] : []).forEach(function (sr) { sr.forEach(function (v) { if (st.e) mx = Math.max(mx, v[0]); if (st.c) mx = Math.max(mx, v[1]); }); });
                var A = nice(mx, 4), x = function (i) { return L + (n === 1 ? w / 2 : i * w / (n - 1)); }, y = function (v) { return T + h - v / A.top * h; };
                var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="New enrolments and certificates in the period">';
                for (var i = 0; i * A.step <= A.top + 1e-9; i++) { var v = i * A.step, yy = y(v).toFixed(1); s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" stroke="#dee7ef"/><text x="' + (L - 10) + '" y="' + yy + '" dy="4" text-anchor="end" font-size="13" fill="#4a6b82">' + fmt(v) + '</text>'; }
                var every = Math.max(1, Math.ceil(n / 8));
                bk.list.forEach(function (r, i) { if (i % every === 0) s += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="' + (i === 0 ? 'start' : i > n - 3 ? 'end' : 'middle') + '" font-size="13" fill="#4a6b82">' + (bk.g === 'month' ? mName(dstr(r[0]).slice(0, 7)) : dName(r[0], true)) + '</text>'; });
                function path(sr, k) { return sr.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v[k]).toFixed(1); }).join(' '); }
                // the fill first, then the comparison (dashed) so it shows through, then this period's lines
                if (st.e) s += '<path d="' + path(cur, 0) + ' L' + x(n - 1).toFixed(1) + ' ' + (T + h) + ' L' + x(0).toFixed(1) + ' ' + (T + h) + ' Z" fill="#e6f0f8" fill-opacity=".8"/>';
                if (prev) { if (st.e) s += '<path d="' + path(prev, 0) + '" fill="none" stroke="#0468b1" stroke-opacity=".6" stroke-width="2" stroke-dasharray="6 5"/>'; if (st.c) s += '<path d="' + path(prev, 1) + '" fill="none" stroke="#f08a24" stroke-opacity=".7" stroke-width="2" stroke-dasharray="6 5"/>'; }
                if (st.e) s += '<path d="' + path(cur, 0) + '" fill="none" stroke="#0468b1" stroke-width="3" stroke-linejoin="round"/>';
                if (st.c) s += '<path d="' + path(cur, 1) + '" fill="none" stroke="#f08a24" stroke-width="3" stroke-linejoin="round"/>';
                s += '<line class="guide" x1="0" x2="0" y1="' + T + '" y2="' + (T + h) + '" stroke="#002f4c" stroke-dasharray="3 3" visibility="hidden"/><g class="dots"></g><rect x="' + L + '" y="' + T + '" width="' + w + '" height="' + h + '" fill="transparent" class="hit"/></svg>';
                box.innerHTML = s;
                hover(box, n, x, W, L, w, function (i) { var v = cur[i], p = prev ? prev[i] : null; return { pts: (st.e ? [[y(v[0]), '#0468b1']] : []).concat(st.c ? [[y(v[1]), '#f08a24']] : []), html: '<b>' + lbl(bk.list[i]) + '</b>' + (st.e ? 'Course enrolments: ' + fmt(v[0]) + (p ? ' (' + fmt(p[0]) + ' before)' : '') + '<br>' : '') + (st.c ? 'Certificates: ' + fmt(v[1]) + (p ? ' (' + fmt(p[1]) + ' before)' : '') : '') }; });
            }
            draw();
        }
        // the average rating by month; months outside the period are faded
        function ratingChart(el, rc) {
            var W = 1000, H = 240, L = 48, R = 16, Tp = 16, B = 36, w = W - L - R, hh = H - Tp - B, n = rc.length, mx = 1; rc.forEach(function (r) { mx = Math.max(mx, r[2]); });
            var bw = Math.max(3, w / n * 0.7), am = P.a ? dstr(P.a).slice(0, 7) : null, bm = P.b ? dstr(P.b).slice(0, 7) : null;
            var inP = function (m) { return !am || (m >= am && m <= bm); };
            var x = function (i) { return L + (n === 1 ? w / 2 : i * w / (n - 1)); }, y = function (v) { return Tp + hh - v / 5 * hh; };
            var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Average rating by month">';
            [1, 2, 3, 4, 5].forEach(function (v) { var yy = y(v).toFixed(1); s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" stroke="#dee7ef"/><text x="' + (L - 10) + '" y="' + yy + '" dy="4" text-anchor="end" font-size="13" fill="#4a6b82">' + v + '</text>'; });
            rc.forEach(function (r, i) { var hb = Math.max(2, r[2] / mx * hh * 0.5); s += '<rect x="' + (x(i) - bw / 2).toFixed(1) + '" y="' + (Tp + hh - hb).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hb.toFixed(1) + '" fill="' + (inP(r[0]) ? '#cde1f0' : '#eef3f8') + '"/>'; if (r[0].slice(5) === '01' || i === 0) s += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="' + (i === 0 ? 'start' : 'middle') + '" font-size="13" fill="#4a6b82">' + (i === 0 ? mName(r[0]) : r[0].slice(0, 4)) + '</text>'; });
            s += '<path d="' + rc.map(function (r, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(r[1]).toFixed(1); }).join(' ') + '" fill="none" stroke="#f08a24" stroke-width="3" stroke-opacity="' + (am ? 0.35 : 1) + '"/>';
            if (am) { var seg = []; rc.forEach(function (r, i) { if (inP(r[0])) seg.push((seg.length ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(r[1]).toFixed(1)); }); if (seg.length) s += '<path d="' + seg.join(' ') + '" fill="none" stroke="#f08a24" stroke-width="3"/>'; }
            s += '<line class="guide" x1="0" x2="0" y1="' + Tp + '" y2="' + (Tp + hh) + '" stroke="#002f4c" stroke-dasharray="3 3" visibility="hidden"/><g class="dots"></g><rect x="' + (L - bw / 2) + '" y="' + Tp + '" width="' + (w + bw) + '" height="' + hh + '" fill="transparent" class="hit"/></svg>';
            el.innerHTML = s;
            hover(el, n, x, W, L, w, function (i) { var r = rc[i]; return { pts: [[y(r[1]), '#f08a24']], html: '<b>' + mName(r[0], true) + '</b>Average ' + r[1].toFixed(2) + ' out of 5<br>' + fmt(r[2]) + ' ratings' }; });
        }
        // the last twelve months of new enrolments as small bars: the same months for every course
        var WIN = (function () { var end = D.through || (D.monthly.length ? D.monthly[D.monthly.length - 1][0] : ''); if (!end) return []; var p = end.split('-').map(Number), y = p[0], m = p[1], out = []; for (var i = 0; i < 12; i++) { out.unshift(y + '-' + (m < 10 ? '0' : '') + m); m--; if (!m) { m = 12; y--; } } return out; })();
        function spark(monthly) {
            if (!WIN.length) return '';
            var by = {}; (monthly || []).forEach(function (r) { by[r[0]] = r[1]; });
            var max = 1; WIN.forEach(function (m) { max = Math.max(max, by[m] || 0); }); var bw = 132 / 12;
            return '<svg class="spark" viewBox="0 0 132 30" role="img" aria-label="New enrolments each month, ' + mName(WIN[0]) + ' to ' + mName(WIN[11]) + '">' + WIN.map(function (m, i) { var v = by[m], hgt = v > 0 ? Math.max(2, v / max * 28) : 1; return '<rect x="' + (i * bw + 1).toFixed(1) + '" y="' + (30 - hgt).toFixed(1) + '" width="' + (bw - 2).toFixed(1) + '" height="' + hgt.toFixed(1) + '" fill="' + (v > 0 ? '#0468b1' : '#cde1f0') + '"><title>' + mName(m) + ': ' + fmt(v || 0) + ' new enrolments</title></rect>'; }).join('') + '</svg>';
        }
        function last12(monthly, k) { var by = {}; (monthly || []).forEach(function (r) { by[r[0]] = r[k]; }); return WIN.reduce(function (t, m) { return t + (by[m] || 0); }, 0); }
        function busiest(monthly, k) { var b = null; (monthly || []).forEach(function (r) { if (r[k] > 0 && (!b || r[k] > b[k])) b = r; }); return b; }
        function perHead(min, n) { if (!min || !n) return ''; var m = min / n; return m >= 90 ? (m / 60).toFixed(1) + ' hours' : Math.round(m) + ' minutes'; }
        // the world map: land as light-blue dots, a bubble per country at its centre
        function worldMap(el, countries) {
            var land = []; try { land = JSON.parse(D.land); } catch (e) { land = []; }
            var W = 1000, H = 470, X = function (lon) { return (lon + 170) / 360 * W; }, Y = function (lat) { return (78 - lat) / 138 * H; };
            var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Map of where learners come from" style="width:100%;height:auto;display:block">';
            for (var i = 0; i + 1 < land.length; i += 2) { if (land[i + 1] < -58) continue; s += '<circle cx="' + X(land[i]).toFixed(1) + '" cy="' + Y(land[i + 1]).toFixed(1) + '" r="3.4" fill="#cde1f0"/>'; }
            var placed = countries.filter(function (c) { return c.length >= 4; }), max = placed.length ? placed[0][1] : 1;
            placed.slice().reverse().forEach(function (c) { var r = 4 + 24 * Math.sqrt(c[1] / max); s += '<circle class="pin" data-c="' + esc(c[0]) + '" data-n="' + c[1] + '" cx="' + X(c[2]).toFixed(1) + '" cy="' + Y(c[3]).toFixed(1) + '" r="' + r.toFixed(1) + '" fill="#0468b1" fill-opacity=".55" stroke="#0468b1" stroke-width="1.5"/>'; });
            el.innerHTML = s + '</svg>';
            el.querySelectorAll('.pin').forEach(function (p) { p.addEventListener('mousemove', function (ev) { showTip('<b>' + p.getAttribute('data-c') + '</b>' + fmt(p.getAttribute('data-n')) + ' enrolments', ev.clientX, ev.clientY); }); p.addEventListener('mouseleave', hideTip); });
        }
        function bars(rows, known) {
            var top = rows.slice(0, 10), max = top.length ? top[0][1] : 1;
            return top.map(function (c) { return '<div class="bar-row"><div class="bar-l">' + esc(c[0]) + '<span><i style="width:' + Math.max(2, c[1] / max * 100).toFixed(1) + '%"></i></span></div><div class="bar-n">' + fmt(c[1]) + '</div><div class="bar-p">' + (known ? (c[1] / known * 100).toFixed(1) + '%' : '') + '</div></div>'; }).join('');
        }
        // countries in a period, with map positions, largest first
        function ctryList(ct) { return Object.keys(ct).map(function (n) { var p = D.cpos[n]; return p ? [n, ct[n], p[0], p[1]] : [n, ct[n]]; }).sort(function (a, b) { return b[1] - a[1]; }); }

        // ── survey ──
        function questions(rows) {
            if (!rows || !rows.length) return '';
            return '<div class="q-row head"><span>Question</span><span>Average out of 5</span><span class="num">Average</span><span class="num">4 or 5</span></div>' + rows.map(function (q) { return '<div class="q-row"><div class="q-t">' + esc(q.t) + (q.t !== q.q ? '<small>' + esc(q.q) + '</small>' : '') + '</div><div class="q-bar"><i style="width:' + (q.avg / 5 * 100).toFixed(1) + '%"></i></div><div class="num">' + q.avg.toFixed(2) + '</div><div class="num">' + q.hi + '%</div></div>'; }).join('');
        }
        var STARN = 0;
        function star(f) { var id = 'st' + (STARN++); return '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="' + id + '"><stop offset="' + f + '" stop-color="#ffc145"/><stop offset="' + f + '" stop-color="#cde1f0"/></linearGradient></defs><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z" fill="url(#' + id + ')" stroke="#e0a520" stroke-width=".8"/></svg>'; }
        function bigSurvey(rating, resp, qs, period) {
            var o = (qs || []).filter(function (q) { return /overall satisfaction/i.test(q.t + ' ' + q.q); })[0], h = '';
            if (rating) { var r = +rating, st = ''; for (var i = 0; i < 5; i++) st += star(Math.max(0, Math.min(1, r - i)).toFixed(2)); h += '<div class="big"><div class="big-v">' + r.toFixed(2) + '<small>/ 5</small></div><div><div class="big-l">Overall rating' + (period ? ' in ' + esc(period) : '') + '</div><div class="big-s">' + (period ? 'Average of ' + fmt(resp) + ' ratings given in those months' : 'Average of ' + fmt(resp) + ' survey responses') + '</div><div class="stars" role="img" aria-label="' + r.toFixed(2) + ' out of 5 stars">' + st + '</div></div></div>'; }
            if (o) h += '<div class="big"><div class="big-v">' + o.hi + '%</div><div><div class="big-l">Rated it 4 or 5 out of 5</div><div class="big-s">For overall satisfaction, of ' + fmt(o.n) + ' who answered' + (period ? '; all time' : '') + '</div><div class="share"><i style="width:' + o.hi + '%"></i></div></div></div>';
            return h;
        }
        function surveyInfo(x, what) { return { e: 'Learning impact', b: '<p>From the survey learners fill in at the end of each course. They were asked ' + what + ', on a scale of 1 to 5; this is the share who answered 4 or 5.</p>' + fact('Learners who answered this question', fmt(x.n)) + fact('Answered 4 or 5', fmt(Math.round(x.n * x.pct / 100)) + ' (' + x.pct + '%)') + '<p class="note">Only learners who finish the survey are counted, so the share describes those who answered, not every learner. All time.</p>' }; }
        function timeInfo(min, time, enrol) { return { e: 'Learning impact', t: 'Learning time', b: '<p>The time learners spent in the course pages, as SURGhub records it, added up across every learner. It counts time with a course open, not time spent studying away from SURGhub.</p>' + fact('In total', esc(time)) + (perHead(min, enrol) ? fact('On average per enrolment', perHead(min, enrol)) : '') + '<p class="note">All time.</p>' }; }
        function impactStats(I) { return [I.time ? stat(esc(I.time), 'Learning time', 'Recorded across all learners', timeInfo(T.min, I.time, T.enrol)) : '', I.contentNew ? stat(I.contentNew.pct + '%', 'Found the content new', 'Of ' + fmt(I.contentNew.n) + ' who answered', surveyInfo(I.contentNew, 'how much of the content was new to them')) : '', I.willApply ? stat(I.willApply.pct + '%', 'Are likely to apply it at work', 'Of ' + fmt(I.willApply.n) + ' who answered', surveyInfo(I.willApply, 'how likely they are to apply what they learnt in their work')) : '', I.careerValue ? stat(I.careerValue.pct + '%', 'Rate it important for their work', 'Of ' + fmt(I.careerValue.n) + ' who answered', surveyInfo(I.careerValue, 'how important the course is for their work')) : ''].join(''); }

        // ── voices and stories ──
        function quotes(rows) { return (rows || []).map(function (q) { return '<figure class="quote"><blockquote>' + esc(q.t) + '</blockquote><figcaption><b>' + esc(q.w) + '</b>' + (q.c ? '<span>' + esc(q.c) + '</span>' : '') + '</figcaption></figure>'; }).join(''); }
        function voices(summary, rows, note) {
            var h = '';
            if (summary) { var ss = String(summary).match(/[^.!?]+[.!?]+["')\]]*(\s+|$)/g) || [summary], head = ss.slice(0, 1).join(''), rest = ss.slice(1).join(''); h += '<div class="summary"><span>' + esc(head) + '</span>' + (rest ? '<span hidden>' + esc(rest) + '</span><button type="button" class="more" data-more="summary">Read the full summary</button>' : '') + '<small>' + note + '</small></div>'; }
            var q = rows || []; if (q.length) h += '<div class="quotes">' + quotes(q.slice(0, 3)) + (q.length > 3 ? '<div hidden style="display:contents">' + quotes(q.slice(3)) + '</div>' : '') + '</div>' + (q.length > 3 ? '<p class="quotes-more"><button type="button" class="more" data-more="quotes">Show ' + (q.length - 3) + ' more ' + (q.length - 3 === 1 ? 'quote' : 'quotes') + '</button></p>' : '');
            return h;
        }
        document.addEventListener('click', function (ev) {
            var b = ev.target.closest ? ev.target.closest('[data-more]') : null; if (!b) return;
            if (b.getAttribute('data-more') === 'summary') { b.previousElementSibling.hidden = false; b.remove(); }
            else { var hid = b.parentNode.previousElementSibling.querySelector('div[hidden]'); if (hid) hid.hidden = false; b.parentNode.remove(); }
        });
        function storyCards(rows, showCourses) {
            return '<div class="story-grid">' + rows.map(function (s) {
                var who = [s.n, s.r, s.w].filter(Boolean).join(', '), cs = showCourses && s.c.length ? '<div class="story-c">About <b>' + s.c.map(function (i) { return esc(D.courses[i].name); }).join('</b>, <b>') + '</b></div>' : '';
                var inner = (s.i ? '<div class="story-img" style="background-image:url(\'' + esc(s.i) + '\')"></div>' : '') + '<div class="story-in"><div class="story-t">' + esc(s.t) + '</div>' + (who ? '<div class="story-who">' + esc(who) + '</div>' : '') + (s.s ? '<p class="story-s">' + esc(s.s) + '</p>' : '') + (s.q ? '<p class="story-q">' + esc(s.q) + '</p>' : '') + cs + (s.u ? '<span class="story-go">Read the story &rarr;</span>' : '') + '</div>';
                return s.u ? '<a class="story" href="' + esc(s.u) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>' : '<div class="story">' + inner + '</div>';
            }).join('') + '</div>';
        }
        function storiesBlock(rows, showCourses, lead) { return rows && rows.length ? '<div class="stories"><h3>Learner stories</h3><p>' + lead + '</p>' + storyCards(rows, showCourses) + '</div>' : ''; }

        // ── the header: a faint globe, with arcs between the countries learners come from ──
        function globe() {
            var svg = $('globe'); if (!svg) return; var land = []; try { land = JSON.parse(D.land); } catch (e) { land = []; }
            var W = 1400, H = 560, cx = 1080, cy = 300, R = 290, rad = Math.PI / 180, lon0 = 22 * rad, lat0 = 12 * rad, sl0 = Math.sin(lat0), cl0 = Math.cos(lat0);
            function vec(lon, lat) { var a = lon * rad, b = lat * rad; return [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)]; }
            function pv(v, k) { var lon = Math.atan2(v[1], v[0]), lat = Math.asin(Math.max(-1, Math.min(1, v[2]))), l = lon - lon0, z = sl0 * Math.sin(lat) + cl0 * Math.cos(lat) * Math.cos(l); k = k || 1; return { x: cx + k * R * Math.cos(lat) * Math.sin(l), y: cy - k * R * (cl0 * Math.sin(lat) - sl0 * Math.cos(lat) * Math.cos(l)), z: z }; }
            function pr(lon, lat) { return pv(vec(lon, lat)); }
            function line(pts) { var d = '', pen = false; pts.forEach(function (q) { if (q.z > 0) { d += (pen ? 'L' : 'M') + q.x.toFixed(1) + ' ' + q.y.toFixed(1); pen = true; } else pen = false; }); return d; }
            svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('preserveAspectRatio', 'xMaxYMid slice');
            var s = '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="#ffffff" fill-opacity=".03" stroke="#ffffff" stroke-opacity=".16" stroke-width="1.2"/>';
            for (var lo = -180; lo < 180; lo += 30) { var m = []; for (var la = -90; la <= 90; la += 4) m.push(pr(lo, la)); s += '<path d="' + line(m) + '" fill="none" stroke="#ffffff" stroke-opacity=".08"/>'; }
            for (var la2 = -60; la2 <= 60; la2 += 30) { var p2 = []; for (var lo2 = -180; lo2 <= 180; lo2 += 4) p2.push(pr(lo2, la2)); s += '<path d="' + line(p2) + '" fill="none" stroke="#ffffff" stroke-opacity=".08"/>'; }
            for (var k = 0; k + 1 < land.length; k += 2) { if (land[k + 1] > 68) continue; var q = pr(land[k], land[k + 1]); if (q.z > 0.02) s += '<circle cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) + '" r="' + (1.3 + 1.4 * q.z).toFixed(1) + '" fill="#91b5d9" fill-opacity="' + (0.18 + 0.3 * q.z).toFixed(2) + '"/>'; }
            // the countries learners come from that face the viewer, joined to each other: no centre
            var pts = D.countries.filter(function (c) { return c.length >= 4; }).map(function (c) { return { v: vec(c[2], c[3]) }; }).filter(function (o) { o.p = pv(o.v); return o.p.z > 0.2; }).slice(0, 14);
            var cols = ['#ffc145', '#ff9734', '#91b5d9', '#f27bb7'], n = 0, pairs = [];
            pts.forEach(function (o, i) { [1, 3, 6].forEach(function (j) { if (i + j < pts.length) pairs.push([o, pts[i + j]]); }); });
            pairs.slice(0, 18).forEach(function (pp) {
                var a = pp[0].v, b = pp[1].v, om = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))); if (om < 0.12) return;
                var arc = []; for (var t = 0; t <= 1.0001; t += 1 / 32) { var a1 = Math.sin((1 - t) * om) / Math.sin(om), a2 = Math.sin(t * om) / Math.sin(om); arc.push(pv([a1 * a[0] + a2 * b[0], a1 * a[1] + a2 * b[1], a1 * a[2] + a2 * b[2]], 1 + 0.2 * om / Math.PI * Math.sin(Math.PI * t))); }
                var col = cols[n % cols.length], d = arc.map(function (q, i) { return (i ? 'L' : 'M') + q.x.toFixed(1) + ' ' + q.y.toFixed(1); }).join('');
                s += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.2" stroke-opacity=".4" stroke-linecap="round"/><path class="arc" d="' + d + '" pathLength="100" fill="none" stroke="' + col + '" stroke-width="2" stroke-opacity=".8" stroke-linecap="round" stroke-dasharray="6 94" style="animation-delay:-' + (n * 0.8).toFixed(1) + 's"/>';
                n++;
            });
            pts.forEach(function (o, i) { s += '<circle cx="' + o.p.x.toFixed(1) + '" cy="' + o.p.y.toFixed(1) + '" r="3.2" fill="' + cols[i % cols.length] + '" fill-opacity=".85"/>'; });
            svg.innerHTML = s;
        }
        globe();

        // ── a reminder in each section that follows the period, with a way back to all time ──
        function pwarn() {
            if (!P.a) return '';
            var cr = cmpRange();
            return '<div class="pwarn" role="note"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg><span>Showing <b>' + esc(span(P.a, P.b)) + '</b>' + (cr ? ', compared with ' + esc(span(cr[0], cr[1])) : '') + ', not all time</span><button type="button" data-reset>Show all time</button></div>';
        }
        function fillPw() { var h = pwarn(); [].forEach.call(document.querySelectorAll('[data-pw]'), function (e) { e.innerHTML = h; }); }

        // ── the period bar ──
        function periodBar() {
            var el = $('period'); if (!el) return;
            el.innerHTML = '<div class="wrap pb"><label>Period <select id="p-k">' + PRESETS.map(function (p) { return '<option value="' + p[0] + '">' + p[1] + '</option>'; }).join('') + '</select></label>'
                + '<span id="p-dates" hidden><label>From <input type="date" id="p-a"></label><label>to <input type="date" id="p-b"></label></span>'
                + '<label id="p-cmpw">Compare with <select id="p-cmp"><option value="none">Nothing</option><option value="prev">The previous period</option><option value="year">The same dates a year earlier</option></select></label>'
                + '<span class="p-now" id="p-now"></span></div>';
            var k = $('p-k'), a = $('p-a'), b = $('p-b'), c = $('p-cmp');
            a.min = b.min = D.dataFrom || ''; a.max = b.max = dstr(END);
            function apply() {
                P.k = k.value; P.cmp = c.value;
                if (P.k === 'all') { P.a = P.b = null; }
                else if (P.k === 'custom') { if (!a.value || !b.value) { var r0 = presetRange('90d'); a.value = dstr(r0[0]); b.value = dstr(r0[1]); } var x = dnum(a.value), y = dnum(b.value); if (y < x) { var t = x; x = y; y = t; } P.a = x; P.b = Math.min(y, END); }
                else { var r = presetRange(P.k); P.a = r[0]; P.b = r[1]; }
                $('p-dates').hidden = P.k !== 'custom'; $('p-cmpw').hidden = P.k === 'all';
                var cr = cmpRange();
                $('p-now').innerHTML = P.a ? 'Showing <b>' + esc(span(P.a, P.b)) + '</b>' + (cr ? ', compared with ' + esc(span(cr[0], cr[1])) : '') : 'Showing <b>all time</b>, to ' + esc(dLong(END));
                render();
            }
            k.addEventListener('change', apply); c.addEventListener('change', apply); a.addEventListener('change', apply); b.addEventListener('change', apply);
            apply();
        }

        // ── the main page ──
        D.courses.forEach(function (c, i) { c.i = i; c.rate = c.enrol ? c.cert / c.enrol * 100 : 0; });
        var T = D.totals, RANGE = WIN.length ? mName(WIN[0]) + ' to ' + mName(WIN[11]) : 'the last 12 months';
        function enrolInfo(x, share) { var b = busiest(x.monthly, 1); return { t: 'Course enrolments', b: '<p>Every enrolment in ' + (share != null ? 'this course' : 'your courses') + ', whether or not the learner has started. One person who takes two courses counts twice, so this is more than the number of people.</p>' + fact('New in ' + RANGE, fmt(last12(x.monthly, 1))) + (b ? fact('Busiest month', mName(b[0], true) + ', ' + fmt(b[1])) : '') + (share != null ? fact('Share of all ' + esc(D.name) + ' enrolments', share) : '') }; }
        function certInfo(x, avg) { var rate = x.enrol ? (x.cert / x.enrol * 100).toFixed(1) + '%' : '–'; return { t: 'Certificates', b: '<p>Course certificates learners earned by completing the course. The certification rate is certificates divided by enrolments; recent enrolments lower it for a while, as those learners are still working through the course.</p>' + fact('Certification rate', rate) + (avg ? fact('Across all your courses', avg) : '') + fact('Earned in ' + RANGE, fmt(last12(x.monthly, 2))) }; }
        function ratingInfo(n, best) { return { t: 'Average rating', b: '<p>The average of the overall rating learners give in the survey at the end of the course, on a scale of 1 to 5.</p>' + fact('Survey responses', fmt(n)) + (best ? fact('Highest rated course (20 or more responses)', esc(best.name) + ', ' + best.rating.toFixed(2)) : '') + '<p class="note">Only learners who finish the survey are counted.</p>' }; }
        function periodInfo(t, what, cur, prev, cr) { return { e: 'In this period', t: t, b: '<p>' + what + '</p>' + fact(esc(span(P.a, P.b)), cur) + (cr ? fact(esc(span(cr[0], cr[1])), prev) : '') + '<p class="note">Counted from the dated enrolment and certificate records, so a period can differ slightly from the all-time totals, which are SURGhub\'s own course counts. <a href="#methodology">More on how periods are counted</a></p>' }; }
        var byEnrol = D.courses.slice().sort(function (a, b) { return b.enrol - a.enrol; });
        var best = D.courses.filter(function (c) { return c.resp >= 20 && c.rating; }).sort(function (a, b) { return b.rating - a.rating; })[0];
        var firsts = D.caw.filter(function (c) { return c.r === 1; }).map(function (c) { return c.c; });

        // the figures for all time, or for a period (with its comparison)
        function figures(ci) {
            var c = ci == null ? null : D.courses[ci], cr = cmpRange(), out = [];
            if (!P.a) {
                if (!c) {
                    out.push(stat(fmt(T.enrol), 'Course enrolments', 'One learner can enrol in several courses', enrolInfo({ monthly: D.monthly })));
                    out.push(stat(fmt(T.cert), 'Certificates', T.rate ? T.rate + '% of enrolments' : '', certInfo({ enrol: T.enrol, cert: T.cert, monthly: D.monthly })));
                    if (T.countries) out.push(stat(fmt(T.countries), 'Countries', 'Where learners gave their country', { t: 'Countries', b: '<p>The countries learners give in their SURGhub profile. Not every learner gives one, so this counts the countries we know of.</p>' + fact('Enrolments with a known country', fmt(T.known) + ' of ' + fmt(T.enrol)) + D.countries.slice(0, 5).map(function (x, i) { return fact((i + 1) + '. ' + esc(x[0]), fmt(x[1])); }).join('') + (firsts.length ? '<p class="note">You have more learners than any other SURGhub provider from ' + esc(list(firsts.slice(0, 8))) + (firsts.length > 8 ? ' and ' + (firsts.length - 8) + ' more' : '') + '.</p>' : '') + '<p><a href="#sec-map">See the map</a></p>' }));
                    if (T.rating) out.push(stat(T.rating, 'Average rating', 'Out of 5, from ' + fmt(T.resp) + ' survey responses', ratingInfo(T.resp, best)));
                    out.push(stat(fmt(T.courses), T.courses === 1 ? 'Course' : 'Courses', 'On SURGhub', { t: 'Your courses', b: '<p>Your courses on SURGhub that these figures include. The five with the most enrolments:</p>' + byEnrol.slice(0, 5).map(function (x) { return fact('<a href="#course-' + x.i + '">' + esc(x.name) + '</a>', fmt(x.enrol)); }).join('') + '<p><a href="#sec-courses">See every course</a></p>' }));
                } else {
                    var rate = c.enrol ? (c.cert / c.enrol * 100).toFixed(1) + '%' : '–';
                    out.push(stat(fmt(c.enrol), 'Course enrolments', fmt(last12(c.monthly, 1)) + ' in the last 12 months', enrolInfo(c, T.enrol ? (c.enrol / T.enrol * 100).toFixed(1) + '%' : '–')));
                    out.push(stat(fmt(c.cert), 'Certificates', rate + ' of enrolments', certInfo(c, T.rate ? T.rate + '%' : '')));
                    if (c.rating) out.push(stat(c.rating.toFixed(2), 'Average rating', 'Out of 5, from ' + fmt(c.resp) + ' responses', ratingInfo(c.resp, null)));
                    if (c.time) out.push(stat(esc(c.time), 'Learning time', 'Recorded across all learners', timeInfo(c.min, c.time, c.enrol)));
                }
                return out.join('');
            }
            var cur = agg(ci, P.a, P.b), prev = cr ? agg(ci, cr[0], cr[1]) : null, rr = rateIn(c ? c.ratings : D.ratings, P.a, P.b), rp = cr ? rateIn(c ? c.ratings : D.ratings, cr[0], cr[1]) : null;
            var nc = Object.keys(cur.ct).length, np = prev ? Object.keys(prev.ct).length : null;
            out.push(stat(fmt(cur.e), 'Course enrolments', 'New in this period', periodInfo('Course enrolments', 'Enrolments made in the period, whether or not the learner has started.', fmt(cur.e), prev ? fmt(prev.e) : '', cr), prev ? delta(cur.e, prev.e) : ''));
            out.push(stat(fmt(cur.c), 'Certificates', 'Earned in this period', periodInfo('Certificates', 'Certificates earned in the period, whichever month the learner enrolled.', fmt(cur.c), prev ? fmt(prev.c) : '', cr), prev ? delta(cur.c, prev.c) : ''));
            out.push(stat(fmt(nc), 'Countries', 'Of the new learners', periodInfo('Countries', 'The countries of learners who enrolled in the period, as given in their SURGhub profile.', fmt(nc), prev ? fmt(np) : '', cr), prev ? delta(nc, np) : ''));
            if (rr) out.push(stat(rr.avg.toFixed(2), 'Average rating', 'From ' + fmt(rr.n) + ' ratings in these months', periodInfo('Average rating', 'The average overall rating in the end-of-course survey, from the ratings given in the months this period touches. Ratings are counted by month.', rr.avg.toFixed(2) + ' (' + fmt(rr.n) + ')', rp ? rp.avg.toFixed(2) + ' (' + fmt(rp.n) + ')' : 'none', cr), rp ? delta(rr.avg, rp.avg, true) : ''));
            if (!c) { var active = Object.keys(cur.by).filter(function (k) { return cur.by[k].e > 0; }).length; out.push(stat(fmt(active), active === 1 ? 'Course' : 'Courses', 'With new enrolments in this period', { t: 'Courses with new enrolments', b: '<p>Your courses that had at least one new enrolment in the period, out of ' + fmt(T.courses) + '.</p>' })); }
            return out.join('');
        }
        function renderMain() {
            $('stats').innerHTML = figures(null);
            $('awards').innerHTML = awardLines(D.awards, 'providers') + (firsts.length ? '<li><svg class="medal" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="#e6f0f8" stroke="#0468b1" stroke-width="1.4"/><path d="M12 2.5a14 14 0 0 0 0 19M12 2.5a14 14 0 0 1 0 19M2.5 12h19" fill="none" stroke="#0468b1" stroke-width="1.2"/></svg><span><b>More learners than any other provider</b><small>from ' + esc(list(firsts.slice(0, 6))) + (firsts.length > 6 ? ', and ' + (firsts.length - 6) + ' more countries' : '') + '</small></span></li>' : '');
            $('awards-all').innerHTML = (D.awards.length || D.caw.length) ? '<button type="button" class="more" data-info="' + info(awardsDialog(D.awards, 'providers', false)) + '">All awards and how they are decided</button>' : '';
            $('numbers-note').textContent = P.a ? 'New enrolments, certificates and ratings in the chosen period. Choose a figure to see what it counts.' : 'All of your courses on SURGhub, since each one opened. Choose a figure to see what it counts.';
            // growth
            if (P.a) { $('growth-intro').textContent = 'New enrolments and certificates in the chosen period. Point at the chart to read the numbers.'; periodChart($('growth'), null); }
            else { $('growth-intro').textContent = 'Running totals by month. Point at the chart to read a month; switch the lines on and off, or add the numbers for each month.'; growth($('growth'), D.monthly); }
            // reach
            var cs = D.countries, known = T.known, tot = T.enrol;
            if (P.a) { var g = agg(null, P.a, P.b); cs = ctryList(g.ct); known = g.known; tot = g.e; }
            if (cs.length) {
                $('sec-map').hidden = false;
                $('map-intro').textContent = (P.a ? 'Learners who enrolled in this period came from ' : 'Learners from ') + fmt(cs.length) + ' ' + (cs.length === 1 ? 'country' : 'countries') + (P.a ? '.' : ' took your courses.') + ' Point at a circle to see the number; the ten largest are listed.';
                worldMap($('map'), cs);
                $('toplist').innerHTML = '<h3>The ten largest</h3>' + bars(cs, known) + '<p class="note">Country is known for ' + fmt(known) + ' of ' + fmt(tot) + ' enrolments; shares are of those.</p>';
            } else if (!P.a) $('sec-map').hidden = true;
            else { $('map-intro').textContent = 'No enrolments with a known country in this period.'; $('map').innerHTML = ''; $('toplist').innerHTML = ''; }
            // survey
            if (D.questions.length || D.ratings.length) {
                var rr = P.a ? rateIn(D.ratings, P.a, P.b) : null;
                $('survey-big').innerHTML = P.a ? bigSurvey(rr ? rr.avg : 0, rr ? rr.n : 0, D.questions, span(P.a, P.b)) : bigSurvey(T.rating, T.resp, D.questions);
                $('survey-intro').textContent = 'Every question with at least three answers, across ' + fmt(T.resp) + ' survey responses. The bar shows the average out of 5; the last column the share answering 4 or 5.' + (P.a ? ' The questions cover all time; the rating above and the chart below follow the period.' : '');
                $('questions').innerHTML = questions(D.questions);
                if (D.ratings.length > 1) { $('ratings-box').hidden = false; ratingChart($('ratings'), D.ratings); } else $('ratings-box').hidden = true;
            } else $('sec-survey').hidden = true;
            $('impact-note').hidden = !P.a;
            if ($('labels-all')) $('labels-all').innerHTML = D.courses.some(function (c) { return (c.tags || []).length || (c.featured || []).length; }) ? '<button type="button" class="more" data-info="' + info(labelsInfo()) + '">What the course labels mean</button>' : '';
            table();
            fillPw();
        }

        // ── the course table: sortable, each row opens the course page ──
        var sortK = 'enrol', sortDir = -1;
        function table() {
            var cr = cmpRange(), g = P.a ? agg(null, P.a, P.b) : null, gp = cr ? agg(null, cr[0], cr[1]) : null;
            var rows = D.courses.map(function (c) {
                if (!P.a) return { c: c, enrol: c.enrol, cert: c.cert, rate: c.rate, rating: c.rating, resp: c.resp, name: c.name };
                var o = g.by[c.i] || { e: 0, c: 0 }, p = gp ? gp.by[c.i] || { e: 0, c: 0 } : null, r = rateIn(c.ratings, P.a, P.b);
                return { c: c, name: c.name, enrol: o.e, cert: o.c, rating: r ? r.avg : 0, resp: r ? r.n : 0, chg: p ? (p.e ? (o.e - p.e) / p.e * 100 : (o.e ? Infinity : 0)) : null, pe: p ? p.e : null };
            });
            var cols = P.a ? [['name', 'Course'], ['enrol', 'Enrolments']].concat(cr ? [['chg', 'Change']] : []).concat([['cert', 'Certificates'], ['rating', 'Rating'], ['resp', 'Ratings'], ['spark', 'Last 12 months']])
                : [['name', 'Course'], ['enrol', 'Enrolments'], ['cert', 'Certificates'], ['rate', 'Cert. rate'], ['rating', 'Rating'], ['resp', 'Responses'], ['spark', 'Last 12 months']];
            if (!cols.some(function (x) { return x[0] === sortK; })) { sortK = 'enrol'; sortDir = -1; }
            rows.sort(function (a, b) { var x = a[sortK], y = b[sortK]; if (sortK === 'name') return sortDir * String(x).localeCompare(String(y)); return sortDir * (((x == null ? -Infinity : x) - (y == null ? -Infinity : y)) || 0); });
            var chg = function (r) { if (r.chg == null) return ''; if (r.chg === Infinity) return '<span class="up">New</span>'; if (!r.pe && !r.enrol) return '–'; return '<span class="' + (r.chg >= 0 ? 'up' : 'down') + '">' + (r.chg >= 0 ? '+' : '−') + Math.abs(r.chg).toFixed(0) + '%</span>'; };
            $('ctable').innerHTML = '<thead><tr>' + cols.map(function (x) { return x[0] === 'spark' ? '<th title="New enrolments in each month">' + x[1] + (WIN.length ? '<br><span style="font-weight:400;letter-spacing:0;text-transform:none">' + mName(WIN[0]) + ' to ' + mName(WIN[11]) + '</span>' : '') + '</th>' : '<th' + (x[0] === sortK ? ' aria-sort="' + (sortDir > 0 ? 'ascending' : 'descending') + '"' : '') + '><button data-k="' + x[0] + '">' + x[1] + '</button></th>'; }).join('') + '</tr></thead><tbody>'
                + rows.map(function (r) {
                    var c = r.c, cells = { name: '<td class="cn"><span class="cn-t">' + esc(c.name) + '</span>' + badges(c) + '</td>', enrol: '<td>' + fmt(r.enrol) + '</td>', chg: '<td>' + chg(r) + '</td>', cert: '<td>' + fmt(r.cert) + '</td>', rate: '<td>' + (c.enrol ? c.rate.toFixed(1) + '%' : '–') + '</td>', rating: '<td>' + (r.rating ? r.rating.toFixed(2) : '–') + '</td>', resp: '<td>' + fmt(r.resp) + '</td>', spark: '<td class="sp">' + spark(c.monthly) + '</td>' };
                    return '<tr tabindex="0" data-i="' + c.i + '">' + cols.map(function (x) { return cells[x[0]]; }).join('') + '</tr>';
                }).join('') + '</tbody>';
            $('ctable').querySelectorAll('th button').forEach(function (b) { b.addEventListener('click', function (ev) { ev.stopPropagation(); var k = b.getAttribute('data-k'); if (k === sortK) sortDir = -sortDir; else { sortK = k; sortDir = k === 'name' ? 1 : -1; } table(); }); });
            $('ctable').querySelectorAll('tbody tr').forEach(function (r) { var go = function (ev) { if (ev && ev.target.closest && ev.target.closest('[data-info]')) return; location.hash = 'course-' + r.getAttribute('data-i'); }; r.addEventListener('click', go); r.addEventListener('keydown', function (ev) { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === r) { ev.preventDefault(); go(); } }); });
        }

        // ── a course's own page ──
        function coursePage(c) {
            var rc = c.ratings || [], aw = awardsFor(c.awards);
            var cs = c.countries, known = c.known, tot = c.enrol;
            if (P.a) { var g = agg(c.i, P.a, P.b); cs = ctryList(g.ct).map(function (x) { return [x[0], x[1]]; }); known = g.known; tot = g.e; }
            var h = '<section style="padding:32px 0 0"><div class="wrap"><a class="back" href="#sec-courses">&larr; All courses</a>' + (badges(c) ? '<div class="c-badges">' + badges(c) + '</div>' : '') + '</div></section>'
                + '<section style="padding-top:28px"><div class="wrap"><p class="eyebrow">At a glance</p><h2>This course in numbers</h2><div data-pw></div><p class="intro">Choose a figure to see what it counts.</p><div class="stats">' + figures(c.i) + '</div>'
                + (aw.length ? '<ul class="tags">' + awardLines(aw, 'courses') + '</ul><p class="aw-all"><button type="button" class="more" data-info="' + info(awardsDialog(aw, 'courses', true)) + '">All course awards and how they are decided</button></p>' : '') + '</div></section>'
                + '<section><div class="wrap"><p class="eyebrow">Growth</p><h2>Enrolments and certificates over time</h2><div data-pw></div><div class="card"><div id="cgrowth"></div></div></div></section>'
                + (rc.length ? '<section><div class="wrap"><p class="eyebrow">Ratings</p><h2>Average rating by month</h2><div data-pw></div><p class="intro">From the end-of-course survey; the bar height is the number of ratings that month. Point at the chart to read a month.' + (P.a ? ' Months outside the period are faded.' : '') + '</p><div class="card"><div id="cratings" class="chart"></div></div></div></section>' : '')
                + (cs.length ? '<section><div class="wrap"><p class="eyebrow">Reach</p><h2>Where this course\'s learners are</h2><div data-pw></div>' + (P.a ? '<p class="intro">Learners who enrolled in the period.</p>' : '') + '<div class="card"><div class="two"><div>' + bars(cs.slice(0, 5), known) + '</div><div>' + bars(cs.slice(5, 10), known) + '</div></div><p class="note">Country is known for ' + fmt(known) + ' of ' + fmt(tot) + ' enrolments; shares are of those.</p></div></div></section>' : '')
                + (c.questions.length ? '<section><div class="wrap"><p class="eyebrow">Survey insights</p><h2>How learners rate this course</h2>' + (P.a ? '<p class="intro">All time: the survey questions are not broken down by period.</p>' : '') + '<div class="big2">' + bigSurvey(c.rating, c.resp, c.questions) + '</div><div class="card">' + questions(c.questions) + '</div></div></section>' : '')
                + ((c.summary || c.quotes.length || (c.stories || []).length) ? '<section><div class="wrap"><p class="eyebrow">Learner voices</p><h2>What learners say</h2>' + storiesBlock((c.stories || []).map(function (id) { return D.stories.filter(function (s) { return s.id === id; })[0]; }).filter(Boolean), false, 'Stories published on the SURGhub blog by learners who took this course.') + voices(c.summary, c.quotes, 'A summary of the written answers in this course\'s survey.') + '</div></section>' : '')
                + '<section style="padding-top:0"><div class="wrap"><a class="back" href="#sec-courses">&larr; All courses</a></div></section>';
            $('page').innerHTML = h;
            fillPw();
            if (P.a) periodChart($('cgrowth'), c.i); else growth($('cgrowth'), c.monthly);
            if (rc.length) ratingChart($('cratings'), rc);
        }

        // ── the methodology page ──
        function methodology() {
            var sec = function (id, t, body) { return '<section id="m-' + id + '" class="m-sec"><div class="wrap"><h2>' + t + '</h2>' + body + '</div></section>'; };
            var qList = D.questions.map(function (q) { return '<li><b>' + esc(q.t) + ':</b> ' + esc(q.q) + '</li>'; }).join('');
            var awards = D.cats.map(function (c) { var d = AW[c.k] || [c.k, '']; return '<li><b>' + esc(d[0]) + (c.p ? ' (providers only)' : '') + ':</b> ' + esc(d[1]) + '</li>'; }).join('');
            var labels = ['Featured', 'Popular', 'Trending', 'Top rated', 'New', 'CME/CPD'].map(function (k) { return '<li><b>' + BADGE[k][1] + ':</b> ' + esc(BADGE[k][2]) + '</li>'; }).join('');
            $('page').innerHTML = '<section style="padding:32px 0 0"><div class="wrap"><a class="back" href="#sec-notes">&larr; Back to the dashboard</a></div></section>'
                + '<section class="m-intro" style="padding-top:24px"><div class="wrap"><p class="intro">Where every figure on this dashboard comes from, how it is counted, and what it leaves out. Questions are welcome at <a href="mailto:info@globalsurgeryfoundation.org">info@globalsurgeryfoundation.org</a>.</p>'
                + '<nav class="m-toc" aria-label="On this page"><a href="#m-source">Sources</a><a href="#m-updates">Updates</a><a href="#m-periods">Periods</a><a href="#m-enrol">Enrolments and certificates</a><a href="#m-countries">Countries</a><a href="#m-survey">Survey</a><a href="#m-voices">Learner voices</a><a href="#m-labels">Course labels</a><a href="#m-awards">Awards</a><a href="#m-privacy">Privacy</a></nav></div></section>'
                + sec('source', 'Where the figures come from', '<p>SURGhub runs on the LearnWorlds learning platform. The Global Surgery Foundation reads the course, enrolment, certificate and survey records from LearnWorlds into SURGdash, its reporting tool, which prepares this dashboard. Countries and professions come from what learners give in their SURGhub profile.</p><p>The figures cover every course of ' + esc(D.name) + ' that SURGdash includes, public and private.</p>')
                + sec('updates', 'How often it is updated', '<p>This dashboard is updated about once a week, when the Global Surgery Foundation refreshes the data from SURGhub. It was last updated on <b>' + esc(dLong(dnum(D.updated))) + '</b>, with records to ' + esc(dLong(END)) + '.</p><p>The monthly charts run to the end of the last full month (' + esc(D.asOf) + '), so a month is never shown half counted. Figures for a chosen period run to the latest record.</p>')
                + sec('periods', 'Periods and comparisons', '<p>The period bar shows the dashboard for all time or for a period: the last 30 or 90 days, the last full calendar quarter, this year so far, the last 12 months, last year, or dates you choose. Periods end on the latest record.</p><p>For a period, enrolments are counted on the day the learner enrolled and certificates on the day they were earned, from the dated records. A few records carry no date, and the all-time totals are SURGhub\'s own course counts, so a period that covers everything can differ slightly from the totals.</p><p>Ratings for a period come from the months the period touches, because ratings are kept by month. The survey questions, learning impact and learning time are for all time: their answers carry no date we can count by.</p><p>A comparison sets the period beside the one just before it (of the same length) or the same dates a year earlier. Changes are shown as a percentage; for ratings, as the difference in points.</p>')
                + sec('enrol', 'Enrolments and certificates', '<p><b>Course enrolments</b> count every enrolment in a course, whether or not the learner has started. One person who takes two courses counts twice.</p><p><b>Certificates</b> are the course certificates learners have earned. The <b>certification rate</b> is certificates divided by enrolments; it is lower for a while after many new enrolments, as those learners are still working through the course.</p><p><b>Learning time</b> is the time learners have spent in the course pages, as SURGhub records it.</p>')
                + sec('countries', 'Countries', '<p>Countries come from learners\' SURGhub profiles; not every learner gives one, so shares are of the enrolments with a known country. The map places each country at its centre; a few territories have no position and appear only in the list.</p>')
                + sec('survey', 'Ratings and the end-of-course survey', '<p>Learners are asked to fill in a short survey when they finish a course, in English, French, Spanish or Arabic. Answers are on a scale of 1 to 5. A question is shown once it has at least three answers. Only learners who complete the survey are counted.</p>' + (qList ? '<ul>' + qList + '</ul>' : '') + '<p>The <b>average rating</b> for all your courses is the average of each course\'s rating. <b>4 or 5</b> is the share of answers that gave 4 or 5. The <b>learning impact</b> figures are the shares answering 4 or 5 to the questions on new knowledge, intent to apply and importance for work.</p>')
                + sec('voices', 'Learner voices', '<p>The <b>summary</b> of what learners say is written with the help of AI from the written answers in the survey. The <b>quotes</b> are answers chosen by the Global Surgery Foundation, shown as learners wrote them, with names, emails and phone numbers removed; each says only the learner\'s profession and country.</p><p><b>Learner stories</b> are published on the SURGhub blog, with the learner\'s consent, and are shown for the courses they mention.</p>')
                + sec('labels', 'Course labels', '<p>Courses carry the same labels as on surghub.org. They are worked out again at every update, except Featured, which the SURGhub team sets.</p><ul>' + labels + '</ul>')
                + sec('awards', 'Awards', '<p>SURGhub recognises the top three providers and courses in each category, among all providers and courses on SURGhub: gold for first, silver for second and bronze for third. Standings are for all time and are worked out again at every update' + (D.awAsOf ? '; they are stamped with the quarter (' + esc(D.awAsOf) + ')' : '') + '.</p><ul>' + awards + '</ul><p><b>Most learners from a country:</b> among providers, the top three for each country with at least 25 learners on SURGhub.</p>')
                + sec('privacy', 'Privacy', '<p>This page is private to ' + esc(D.name) + ' and protected by a password. It shows no learner\'s name or contact details, except in learner stories the learner chose to publish. The downloads hold anonymised records: a number instead of a name, and no email address.</p>')
                + '<section style="padding-top:0"><div class="wrap"><a class="back" href="#sec-notes">&larr; Back to the dashboard</a></div></section>';
        }

        function render() {
            var hs = String(location.hash), m = hs.match(/^#course-(\d+)$/), c = m ? D.courses[+m[1]] : null;
            if (c) coursePage(c); else if (hs === '#methodology') methodology(); else renderMain();
        }
        function route() {
            var hs = String(location.hash), m = hs.match(/^#course-(\d+)$/), c = m ? D.courses[+m[1]] : null, meth = hs === '#methodology' || /^#m-/.test(hs);
            hideTip();
            var was = !$('page').hidden;
            if (c || meth) {
                if (meth && hs !== '#methodology' && was && $(hs.slice(1))) { $(hs.slice(1)).scrollIntoView(); return; }
                if (c) coursePage(c); else methodology();
                $('main').hidden = true; $('page').hidden = false; $('period').hidden = !!meth;
                $('hero-title').textContent = c ? c.name : 'How this dashboard is made';
                $('hero-lead').textContent = c ? 'A course by ' + D.name + ' on SURGhub, the UN Global Surgery Learning Hub.' : 'The methodology behind ' + D.name + '\'s SURGhub partner dashboard.';
                $('hero-actions').hidden = true; window.scrollTo(0, 0);
            } else {
                $('page').hidden = true; $('main').hidden = false; $('period').hidden = false;
                $('hero-title').textContent = D.name; $('hero-lead').textContent = LEAD; $('hero-actions').hidden = false;
                if (was) renderMain();
                var t = hs.length > 1 ? document.getElementById(hs.slice(1)) : null; if (was || t) (t || $('sec-courses')).scrollIntoView();
            }
        }
        var LEAD = $('hero-lead').textContent;
        // the parts that never change with the period
        var I = impactStats(D.impact); if (I) $('impact').innerHTML = I; else $('sec-impact').hidden = true;
        if (D.summary || D.quotes.length) $('voices').innerHTML = voices(D.summary, D.quotes, 'A summary of the written answers in the end-of-course surveys, written with the help of AI.');
        $('stories').innerHTML = storiesBlock(D.stories, true, 'Stories published on the SURGhub blog by learners who took your courses.');
        if (!D.summary && !D.quotes.length && !D.stories.length) $('sec-voices').hidden = true;
        periodBar();
        // the navigation: hide links to empty sections, mark the section in view
        var navLinks = [].slice.call(document.querySelectorAll('#nav a'));
        navLinks.forEach(function (a) { var t = document.getElementById(a.getAttribute('href').slice(1)); if (!t || t.hidden) a.hidden = true; });
        function markNav() {
            var on = null, atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4, vis = navLinks.filter(function (a) { var t = document.getElementById(a.getAttribute('href').slice(1)); return !a.hidden && t && t.offsetParent !== null; });
            if (!$('main').hidden) { if (atEnd && vis.length) on = vis[vis.length - 1]; else vis.forEach(function (a) { var t = document.getElementById(a.getAttribute('href').slice(1)); if (t.getBoundingClientRect().top <= Math.max(220, window.innerHeight * 0.35)) on = a; }); }
            navLinks.forEach(function (a) { a.classList.toggle('on', a === on); });
        }
        var navTick = false;
        window.addEventListener('scroll', function () { if (navTick) return; navTick = true; setTimeout(function () { navTick = false; markNav(); }, 60); }, { passive: true });
        window.addEventListener('resize', markNav);
        window.addEventListener('hashchange', function () { route(); markNav(); }); route(); markNav();
    },
});
