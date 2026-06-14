// === Generic per-page HTML export ===
// Clones the currently-rendered page DOM (KPI cards, charts-as-SVG, tables),
// lets the user tick which sections to include via a modal, and writes a
// self-contained, app-styled standalone HTML file for easy sharing.
//
// Works on any analytics page (Platform, Providers, Course, Audience,
// Ambassadors) with no per-page code — it reads the live DOM.

Object.assign(window.App, {

    // Find the main content wrapper + its top-level "blocks" (sections).
    _htmlExportBlocks() {
        const body = document.getElementById('view-body') || document.getElementById('main-content');
        if (!body) return { wrapper: null, blocks: [] };
        // The render wraps content in a single padded <div> (e.g. .p-6 .fade-in)
        const wrapper = body.querySelector(':scope > div') || body;
        const blocks = Array.from(wrapper.children).filter(el => el.nodeType === 1 && el.offsetParent !== null);
        const sections = blocks.map((el, i) => {
            let label = '';
            const h = el.querySelector('h1, h2, h3');
            if (h && h.textContent.trim()) label = h.textContent.trim().replace(/\s+/g, ' ').slice(0, 70);
            if (!label) {
                if (el.querySelector('[id$="kpi-grid"], [data-copy-all-kpis]') || /grid-cols/.test(el.className)) label = 'KPI cards';
                else if (el.querySelector('svg, canvas')) label = 'Chart';
                else label = 'Section ' + (i + 1);
            }
            return { idx: i, label };
        });
        return { wrapper, blocks, sections };
    },

    // Open the section-picker modal for the current page.
    openHtmlExport() {
        const { wrapper, sections } = this._htmlExportBlocks();
        if (!wrapper || sections.length === 0) {
            return alert('Nothing on this page to export yet.');
        }
        // Default export title from the page's heading + the selected entity
        const pageHeading = ((wrapper.querySelector('h1') || {}).textContent || 'SURGhub Export').trim();
        let entity = '';
        if (this.view === 'provider' && this.selectedProvider) entity = this.selectedProvider;
        else if (this.view === 'course' && this.selectedCourse) entity = this.selectedCourse;
        const pageTitle = entity ? `${pageHeading} — ${entity}` : pageHeading;

        const rows = sections.map(s => `
            <label style="display:flex;align-items:center;gap:8px;padding:6px 4px;font-size:13px;color:#334155;cursor:pointer;">
                <input type="checkbox" data-export-idx="${s.idx}" checked style="width:15px;height:15px;">
                ${this.escapeHtml(s.label)}
            </label>`).join('');

        const overlay = document.createElement('div');
        overlay.id = 'html-export-modal';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.5);z-index:10001;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#fff;border-radius:16px;width:460px;max-width:92vw;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 12px 48px rgba(0,0,0,0.25);">
                <div style="padding:20px 24px 12px;border-bottom:1px solid #f1f5f9;">
                    <h3 style="font-size:16px;font-weight:800;color:#002F4C;margin:0 0 4px;">Export page as HTML</h3>
                    <p style="font-size:12px;color:#64748b;margin:0;">Pick the sections to include. Charts are kept as crisp vector graphics.</p>
                </div>
                <div style="padding:12px 24px;">
                    <label style="display:block;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:4px;">Title</label>
                    <input id="html-export-title" type="text" value="${this.escapeHtml(pageTitle.trim())}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;margin-bottom:8px;">
                </div>
                <div style="padding:0 20px;overflow-y:auto;flex:1;">
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:0 4px 4px;">
                        <span style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Sections</span>
                        <button onclick="App._htmlExportToggleAll(this)" style="font-size:11px;color:#4389C8;background:none;border:none;cursor:pointer;font-weight:600;">Toggle all</button>
                    </div>
                    ${rows}
                </div>
                <div style="padding:16px 24px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:10px;">
                    <button onclick="document.getElementById('html-export-modal').remove()" style="padding:9px 18px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;">Cancel</button>
                    <button onclick="App._runHtmlExport()" style="padding:9px 18px;background:#4389C8;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;">Generate HTML</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
    },

    // Country data (ISO-coded) for any learner world map on the current page,
    // keyed by the map container's element id. Lets the exported HTML re-render
    // a LIVE, hoverable GeoChart (a cloned SVG would be static/non-interactive).
    _htmlExportMapData() {
        const out = {};
        const toIso = (counts) => {
            const iso = {};
            Object.entries(counts).forEach(([c, v]) => {
                const k = (window.countryToISO && window.countryToISO(c)) || c;
                iso[k] = (iso[k] || 0) + v;
            });
            return iso;
        };
        try {
            if (this.view === 'provider' && this.selectedProvider) {
                const recs = this.getAnalyticsSnap().filter(d => d.Provider === this.selectedProvider);
                const counts = this.aggregateCourseCountries(recs).counts;
                if (Object.keys(counts).length) out['chart_provider_map'] = toIso(counts);
            } else if (this.view === 'course' && this.selectedCourse) {
                const rec = this.getAnalyticsSnap().find(d => window.courseMatches ? courseMatches(d, this.selectedCourse) : d.Course === this.selectedCourse);
                const counts = this.aggregateCourseCountries([rec || {}]).counts;
                if (Object.keys(counts).length) out['chart_course_map'] = toIso(counts);
            }
        } catch (e) {}
        return out;
    },

    // Monthly series for the growth + feedback charts on the current page, so the
    // exported file can re-render them LIVE (interactive toggles) instead of
    // freezing a static SVG. Mirrors the in-app aggregation (scaled timelines,
    // partial-month trim, RatingHistory).
    _htmlExportChartData() {
        const out = {};
        const C = window.Charts;
        if (!C || !C.getScaledTimeline) return out;
        const fmt = (m) => this.formatDate(m + '-01');
        let recs = [], title = '';
        if (this.view === 'provider' && this.selectedProvider) {
            recs = this.getAnalyticsHistory().filter(d => d.Provider === this.selectedProvider); title = this.selectedProvider;
        } else if (this.view === 'course' && this.selectedCourse) {
            recs = this.getAnalyticsHistory().filter(d => window.courseMatches ? courseMatches(d, this.selectedCourse) : d.Course === this.selectedCourse); title = this.selectedCourse;
        } else if (this.view === 'platform') {
            recs = this.getAnalyticsHistory(); title = 'Platform Total';
        } else { return out; }

        // Growth: aggregate scaled per-month learner + cert increments
        const monthly = {};
        recs.forEach(d => {
            if (!d.CourseTimeline) return;
            const scaled = C.getScaledTimeline(d.CourseTimeline, true);
            Object.keys(scaled).forEach(m => { if (!monthly[m]) monthly[m] = { e: 0, c: 0 }; monthly[m].e += scaled[m].e; monthly[m].c += scaled[m].c; });
        });
        let gMonths = Object.keys(monthly).sort();
        if (gMonths.length && C._isPartialMonth && C._isPartialMonth(gMonths[gMonths.length - 1]) && !(C._shouldIncludePartial && C._shouldIncludePartial())) {
            gMonths = gMonths.slice(0, -1);
        }
        if (gMonths.length) out.growth = { elId: 'chart_growth', title: title || '', months: gMonths.map(m => ({ m: fmt(m), e: monthly[m].e, c: monthly[m].c })) };

        // Feedback: aggregate RatingHistory per month (dedup to latest per course)
        const deduped = {};
        recs.forEach(d => { const k = (window.courseKey ? courseKey(d) : d.Course); if (!deduped[k] || d.Timestamp > deduped[k].Timestamp) deduped[k] = d; });
        const fb = {};
        Object.values(deduped).forEach(d => {
            if (!d.RatingHistory) return;
            const hist = C.safeParse(d.RatingHistory);
            Object.keys(hist).forEach(month => {
                const h = hist[month];
                if (h && typeof h === 'object' && h.sum !== undefined) {
                    if (!fb[month]) fb[month] = { vol: 0, sum: 0, cnt: 0 };
                    fb[month].sum += h.sum; fb[month].cnt += h.count; fb[month].vol += (h.volume || h.count);
                }
            });
        });
        const fMonths = Object.keys(fb).sort();
        if (fMonths.length) out.feedback = { elId: 'chart_feedback_growth', months: fMonths.map(m => ({ m: fmt(m), vol: fb[m].vol, sum: fb[m].sum, cnt: fb[m].cnt })) };
        return out;
    },

    _htmlExportToggleAll(btn) {
        const boxes = document.querySelectorAll('#html-export-modal input[data-export-idx]');
        const anyUnchecked = Array.from(boxes).some(b => !b.checked);
        boxes.forEach(b => { b.checked = anyUnchecked; });
    },

    async _runHtmlExport() {
        const modal = document.getElementById('html-export-modal');
        const title = (document.getElementById('html-export-title') || {}).value || 'SURGhub Export';
        const checked = new Set(
            Array.from(document.querySelectorAll('#html-export-modal input[data-export-idx]:checked'))
                .map(b => parseInt(b.getAttribute('data-export-idx'), 10))
        );
        if (modal) modal.remove();
        if (checked.size === 0) return alert('Select at least one section.');

        try {
            const html = this._buildPageHtml(title, checked);
            if (!html) return;
            const safeName = title.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'surghub_export';
            const date = new Date().toISOString().split('T')[0];
            const savePath = await electronAPI.invoke('pick-save-path', `${safeName}_${date}.html`);
            if (!savePath) return;
            electronAPI.fs.writeFileSync(savePath, html, 'utf8');
            this.showMsg('Page exported as HTML ✓');
        } catch (e) {
            console.error('HTML export error:', e);
            alert('HTML export failed: ' + e.message);
        }
    },

    // Build a standalone, app-styled HTML document from the selected blocks.
    _buildPageHtml(title, checkedIdxSet) {
        const { wrapper, blocks } = this._htmlExportBlocks();
        if (!wrapper) return null;

        const clone = wrapper.cloneNode(true);
        // Snapshot the clone's children BEFORE any removal so positions stay
        // aligned with the original wrapper's children (removing live shifts indices).
        const origChildren = Array.from(wrapper.children);
        const cloneChildren = Array.from(clone.children);   // 1:1 with origChildren
        // Walk originals; track the index among *visible* blocks (matches the
        // checkbox data-export-idx) and drop unchecked ones from the clone.
        let visIdx = -1;
        origChildren.forEach((origEl, pos) => {
            const isVisible = origEl.nodeType === 1 && origEl.offsetParent !== null;
            if (!isVisible) return;
            visIdx++;
            if (!checkedIdxSet.has(visIdx) && cloneChildren[pos]) cloneChildren[pos].remove();
        });

        // Remove the page's own title/selector header — our branded header
        // replaces it (avoids the duplicate "Provider Reports" + orphan "Provider:").
        clone.querySelectorAll('header').forEach(el => el.remove());
        clone.querySelectorAll('h1').forEach(el => el.remove());
        // Remove toggle/legend rows whose checkbox controls would be dead in a
        // static export (e.g. "Show monthly bars", "Survey Volume", series
        // toggles). The charts keep their own built-in legends, so these become
        // redundant — and confusing — once non-interactive.
        // Keep the chart-toggle controls (series on/off, monthly bars, survey
        // volume) so the exported charts stay interactive; drop every other form
        // control (search boxes, "exclude < 50", partial-month, etc.).
        const isChartToggle = (inp) => !!inp && (inp.hasAttribute('data-series') || /-(growth|fb)-bars$/.test(inp.id || ''));
        clone.querySelectorAll('label').forEach(l => { const inp = l.querySelector('input'); if (inp && !isChartToggle(inp)) l.remove(); });
        // Course / provider names in tables are rendered as <button> links. Unwrap
        // in-table text buttons to spans so their labels survive — otherwise the
        // blanket button strip below leaves those columns blank.
        clone.querySelectorAll('td button, th button').forEach(btn => {
            const span = document.createElement('span');
            span.textContent = btn.textContent.trim();
            if (btn.className) span.className = btn.className.replace(/cursor-pointer/g, '');
            btn.replaceWith(span);
        });
        // Strip remaining interactive / app-only controls — but keep the chart
        // toggles (the export's live-chart script rewires them). Their app-side
        // onchange handler is dropped so it can't error in the standalone file.
        clone.querySelectorAll('button, select, textarea').forEach(el => el.remove());
        clone.querySelectorAll('input').forEach(inp => {
            if (isChartToggle(inp)) { inp.removeAttribute('onchange'); inp.removeAttribute('onclick'); }
            else inp.remove();
        });
        clone.querySelectorAll('[data-edit-only], [data-copy-all-kpis], [data-no-export]').forEach(el => el.remove());
        // Drop now-empty wrappers (e.g. selector rows whose controls were removed)
        clone.querySelectorAll('label, .flex').forEach(el => { if (!el.textContent.trim() && !el.querySelector('svg, img')) el.remove(); });
        // Neutralise remaining onclick handlers + href="#"
        clone.querySelectorAll('[onclick]').forEach(el => el.removeAttribute('onclick'));
        clone.querySelectorAll('a[href="#"]').forEach(el => el.removeAttribute('href'));

        // Logo (best-effort)
        let logoDataUrl = '';
        try {
            const p = electronAPI.path.join(electronAPI.appPath, 'build', 'Global Surgery Foundation_logo_symbol.png');
            logoDataUrl = 'data:image/png;base64,' + electronAPI.fs.readFileBase64(p);
        } catch (e) {}

        const generatedAt = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        const safeTitle = this.escapeHtml(title.trim());
        const inner = clone.innerHTML;

        // Live interactivity in the exported file: re-render the learner world
        // map(s) AND the growth / feedback charts with Google Charts so the toggle
        // boxes actually work (a cloned SVG would be frozen). ISO codes → no
        // geocoding / Maps API key needed. No-ops for any section not included.
        const mapDataAll = this._htmlExportMapData();
        const mapData = {};
        Object.keys(mapDataAll).forEach(id => { if (inner.includes('id="' + id + '"')) mapData[id] = mapDataAll[id]; });
        const chartDataAll = this._htmlExportChartData();
        const chartData = {};
        Object.keys(chartDataAll).forEach(k => { const c = chartDataAll[k]; if (c && inner.includes('id="' + c.elId + '"')) chartData[k] = c; });

        const liveScript = (Object.keys(mapData).length === 0 && Object.keys(chartData).length === 0) ? '' : `
  <script src="https://www.gstatic.com/charts/loader.js"><\/script>
  <script>
    (function(){
      var MAP_DATA = ${JSON.stringify(mapData)};
      var CHART_DATA = ${JSON.stringify(chartData)};
      if (!window.google || !google.charts) return;
      google.charts.load('current', { packages: ['geochart','corechart'] });
      google.charts.setOnLoadCallback(function(){
        var chk = function(sel, def){ var e = document.querySelector(sel); return e ? e.checked : def; };
        // ── Learner world map(s) ──
        Object.keys(MAP_DATA).forEach(function(id){
          var el = document.getElementById(id); if (!el) return;
          el.innerHTML = '';
          var d = MAP_DATA[id];
          var dt = new google.visualization.DataTable();
          dt.addColumn('string','Country'); dt.addColumn('number','Learners');
          Object.keys(d).forEach(function(c){ dt.addRow([c, d[c]]); });
          var draw = function(){ new google.visualization.GeoChart(el).draw(dt, {
            colorAxis: { colors: ['#ebf5fb','#3498db','#1a5276'], minValue: 0 },
            backgroundColor: 'transparent', datalessRegionColor: '#f1f5f9',
            defaultColor: '#f1f5f9', legend: { textStyle: { fontSize: 11, color: '#64748b' } }
          }); };
          draw(); window.addEventListener('resize', draw);
        });
        // ── Growth chart (cumulative enrol/cert lines + optional monthly bars) ──
        function drawGrowth(){
          var G = CHART_DATA.growth; if (!G) return;
          var el = document.getElementById(G.elId); if (!el) return;
          var showE = chk('[data-series$="-enroll"]', true), showC = chk('[data-series$="-cert"]', true), bars = chk('[id$="-growth-bars"]', false);
          if (!showE && !showC) { el.innerHTML = '<div style="padding:48px;text-align:center;color:#94a3b8;font-style:italic">Enable at least one data series.</div>'; return; }
          var dt = new google.visualization.DataTable(); dt.addColumn('string','Date');
          if (showE) dt.addColumn('number', G.title + ' Learners');
          if (showC) dt.addColumn('number', G.title + ' Certificates');
          if (bars && showE) dt.addColumn('number','Monthly Learners');
          if (bars && showC) dt.addColumn('number','Monthly Certificates');
          var ce = 0, cc = 0;
          G.months.forEach(function(p){ var row = [p.m]; ce += p.e; cc += p.c; if (showE) row.push(Math.round(ce)); if (showC) row.push(Math.round(cc)); if (bars && showE) row.push(Math.round(p.e)); if (bars && showC) row.push(Math.round(p.c)); dt.addRow(row); });
          var colors = []; if (showE) colors.push('#1a5276'); if (showC) colors.push('#4389C8');
          var nLines = colors.length, series = {}, i;
          for (i = 0; i < nLines; i++) series[i] = { type:'line', lineWidth:2.5, pointSize:4, targetAxisIndex:0, curveType:'function' };
          var bi = nLines;
          if (bars && showE) { colors.push('#1a5276'); series[bi] = { type:'bars', targetAxisIndex:1, opacity:0.35 }; bi++; }
          if (bars && showC) { colors.push('#4389C8'); series[bi] = { type:'bars', targetAxisIndex:1, opacity:0.35 }; bi++; }
          var opts = { colors:colors, legend:{position:'top',maxLines:2,textStyle:{fontSize:11,color:'#64748b'}}, backgroundColor:'transparent',
            chartArea:{left:60,right:bars?55:20,top:35,bottom:80},
            hAxis:{slantedText:true,slantedTextAngle:45,textStyle:{color:'#94a3b8',fontSize:11}},
            vAxes:{0:{textStyle:{color:'#94a3b8',fontSize:11},gridlines:{color:'#f1f5f9'},viewWindow:{min:0},format:'short'},1:{textStyle:{color:'#cbd5e1',fontSize:10},gridlines:{color:'transparent'},viewWindow:{min:0},format:'short'}},
            bar:{groupWidth:'55%'}, tooltip:{textStyle:{fontSize:12}} };
          if (bars) { opts.seriesType = 'line'; opts.series = series; new google.visualization.ComboChart(el).draw(dt, opts); }
          else { opts.curveType = 'function'; opts.lineWidth = 2.5; opts.pointSize = 4; new google.visualization.LineChart(el).draw(dt, opts); }
        }
        // ── Feedback chart (avg rating line + optional survey-volume bars) ──
        function drawFeedback(){
          var F = CHART_DATA.feedback; if (!F) return;
          var el = document.getElementById(F.elId); if (!el) return;
          var bars = chk('[id$="-fb-bars"]', false);
          var dt = new google.visualization.DataTable(); dt.addColumn('string','Month');
          if (bars) dt.addColumn('number','Survey Responses');
          dt.addColumn('number','Average Rating');
          F.months.forEach(function(p){ var row = [p.m]; if (bars) row.push(p.vol); row.push(p.cnt > 0 ? (p.sum / p.cnt) : null); dt.addRow(row); });
          var opts = { colors: bars ? ['#85c1e9','#D03734'] : ['#D03734'], backgroundColor:'transparent', seriesType: bars ? 'bars' : 'line',
            series: bars ? {0:{type:'bars',targetAxisIndex:1,opacity:0.4},1:{type:'line',targetAxisIndex:0,lineWidth:3,pointSize:5,curveType:'function'}} : {0:{type:'line',lineWidth:3,pointSize:5,curveType:'function'}},
            chartArea:{left:55,right:55,top:35,bottom:80}, legend:{position:'top',textStyle:{fontSize:11,color:'#64748b'}},
            hAxis:{slantedText:true,slantedTextAngle:45,textStyle:{color:'#94a3b8',fontSize:11}},
            vAxes:{0:{title:'Avg Rating',textStyle:{color:'#94a3b8',fontSize:11},viewWindow:{min:0,max:5.5},gridlines:{color:'#f1f5f9',count:6}},1:{title:'Volume',textStyle:{color:'#cbd5e1',fontSize:10},viewWindow:{min:0},gridlines:{color:'transparent'}}},
            bar:{groupWidth:'55%'}, tooltip:{textStyle:{fontSize:12}} };
          new google.visualization.ComboChart(el).draw(dt, opts);
        }
        if (CHART_DATA.growth) { drawGrowth(); ['[data-series$="-enroll"]','[data-series$="-cert"]','[id$="-growth-bars"]'].forEach(function(s){ var e = document.querySelector(s); if (e) e.addEventListener('change', drawGrowth); }); window.addEventListener('resize', drawGrowth); }
        if (CHART_DATA.feedback) { drawFeedback(); var fbT = document.querySelector('[id$="-fb-bars"]'); if (fbT) fbT.addEventListener('change', drawFeedback); window.addEventListener('resize', drawFeedback); }
      });
    })();
  <\/script>`;

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle} — SURGhub</title>
<script src="https://cdn.tailwindcss.com"><\/script>
<script>
tailwind.config = { theme: { extend: { colors: {
  'gsf-prussian':'#002F4C','gsf-boston':'#4389C8','gsf-crimson':'#D03734','gsf-polo':'#91B5D9','gsf-tango':'#E28743'
}}}}
<\/script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  body { font-family:'Inter',system-ui,sans-serif; background:#f8fafc; color:#0f172a; margin:0; }
  .export-wrap { max-width:1200px; margin:0 auto; padding:36px 24px 48px; }
  svg { max-width:100%; }
  /* hide any stray interactive affordances */
  [class*="cursor-pointer"] { cursor:default !important; }
</style>
</head>
<body>
  <header style="background:#002F4C;color:#fff;padding:22px 24px;">
    <div style="max-width:1200px;margin:0 auto;display:flex;align-items:center;gap:14px;">
      ${logoDataUrl ? `<img src="${logoDataUrl}" alt="GSF" style="height:40px;width:auto;">` : ''}
      <div>
        <div style="font-size:20px;font-weight:800;line-height:1.2;">${safeTitle}</div>
        <div style="font-size:12px;opacity:0.75;">SURGhub Analytics · Generated ${generatedAt}</div>
      </div>
    </div>
  </header>
  <main class="export-wrap">
    ${inner}
  </main>
  <footer style="max-width:1200px;margin:0 auto;padding:28px 24px 40px;border-top:1px solid #e2e8f0;color:#64748b;font-size:11px;line-height:1.6;">
    <p style="margin:0 0 8px;">SURGhub is a joint initiative of the <strong>Global Surgery Foundation (GSF)</strong> and <strong>UNITAR</strong> (United Nations Institute for Training and Research), supported by the <strong>Royal College of Surgeons in Ireland (RCSI)</strong>, and implemented in association with the <strong>Johnson &amp; Johnson Foundation</strong>.</p>
    <p style="margin:0;color:#94a3b8;">Generated by SURGdash from SURGhub data · ${generatedAt} · SURGdash &copy; Global Surgery Foundation</p>
  </footer>${liveScript}
</body>
</html>`;
    }
});
