// ── Course trend sparklines ───────────────────────────────────────────────────
// A tiny inline-SVG line per course — the trading-app glance — of COURSES STARTED
// PER MONTH over the last 12 complete months; when "Include current month" is on,
// the partial month is appended as a hollow point on a dashed segment. The colour
// and the % compare the last 3 complete months with the 3 before (≥ ±15% = green /
// red, otherwise grey). Data: the completion records already in memory (one
// start_month per learner-course) — nothing is fetched and only counts are shown,
// no learner is identifiable. The per-course index is rebuilt only when the
// records array is replaced (identity check), so rendering a table is cheap.
// Standalone renderer — no App, no `this` — so the HTML snapshot can embed its source
// verbatim (export.js splices __sparkSvg.toString() into the exported page).
// values13: courses started per month, 12 complete months then the current one.
// opts: {width, height, partial (draw the 13th as a hollow point), esc (HTML escaper)}.
function __sparkSvg(values13, opts) {
    opts = opts || {};
    const w = opts.width || 84, h = opts.height || 24, partial = !!opts.partial;
    const esc = opts.esc || ((t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    if (!Array.isArray(values13) || values13.length < 2) return '<span class="text-slate-300 text-xs" title="No learner records for this course">–</span>';
    const complete = values13.slice(0, Math.max(1, values13.length - 1)).map((v) => Number(v) || 0);
    const current = Number(values13[values13.length - 1]) || 0;
    const vals = partial ? complete.concat([current]) : complete;
    const n = vals.length, max = Math.max(1, ...vals);
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const recent = sum(complete.slice(-3)), prior = sum(complete.slice(-6, -3));
    const delta = prior > 0 ? (recent - prior) / prior : (recent > 0 ? Infinity : 0);
    const th = 0.15;
    const color = delta >= th ? '#059669' : delta <= -th ? '#e11d48' : '#64748b';
    const pct = !isFinite(delta) ? 'new' : Math.abs(delta) >= 10 ? '×' + Math.round(recent / Math.max(1, prior)) : (delta > 0 ? '+' : delta < 0 ? '−' : '') + Math.round(Math.abs(delta) * 100) + '%';
    const arrow = delta >= th ? '▲ ' : delta <= -th ? '▼ ' : '';
    const padX = 2, padY = 2.5, innerW = w - padX * 2, innerH = h - padY * 2;
    const x = (i) => (padX + (n > 1 ? i / (n - 1) : 0) * innerW).toFixed(1);
    const y = (v) => (h - padY - (v / max) * innerH).toFixed(1);
    const solidN = partial ? n - 1 : n;
    const pts = vals.slice(0, solidN).map((v, i) => x(i) + ',' + y(v)).join(' ');
    const base = (h - padY).toFixed(1);
    const area = x(0) + ',' + base + ' ' + pts + ' ' + x(solidN - 1) + ',' + base;
    const tip = 'Courses started per month, last ' + complete.length + ' complete months (oldest → newest): ' + complete.join(', ')
        + (partial ? ' · current month so far: ' + current : '')
        + ' · last 3 months ' + recent + ' vs previous 3 months ' + prior + (isFinite(delta) ? ' (' + pct + ')' : '');
    const partialMark = partial
        ? '<line x1="' + x(solidN - 1) + '" y1="' + y(vals[solidN - 1]) + '" x2="' + x(n - 1) + '" y2="' + y(vals[n - 1]) + '" stroke="' + color + '" stroke-width="1.2" stroke-dasharray="2 2"/>'
          + '<circle cx="' + x(n - 1) + '" cy="' + y(vals[n - 1]) + '" r="2.2" fill="#fff" stroke="' + color + '" stroke-width="1.2"/>'
        : '';
    return '<span class="inline-flex items-center gap-1.5 align-middle" title="' + esc(tip) + '">'
        + '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc('Courses started per month, trend ' + pct) + '" style="display:block;overflow:visible">'
        + '<polygon points="' + area + '" fill="' + color + '" fill-opacity="0.12"/>'
        + '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>'
        + '<circle cx="' + x(solidN - 1) + '" cy="' + y(vals[solidN - 1]) + '" r="2.2" fill="' + color + '"/>' + partialMark + '</svg>'
        + '<span class="text-[10px] font-semibold tabular-nums whitespace-nowrap" style="color:' + color + ';min-width:38px">' + arrow + pct + '</span></span>';
}

Object.assign(window.App, {
    SPARK_MONTHS: 12,

    _sparkNorm(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]/g, ''); },

    _sparkIndex() {
        const rows = this._rawCompletion;
        if (!Array.isArray(rows)) return null;
        if (this._sparkIdx && this._sparkIdx.src === rows) return this._sparkIdx.map;
        const map = new Map();
        for (const r of rows) {
            if (!r || !r.course || !r.start_month) continue;
            const k = this._sparkNorm(r.course);
            let m = map.get(k); if (!m) { m = new Map(); map.set(k, m); }
            m.set(r.start_month, (m.get(r.start_month) || 0) + 1);
        }
        this._sparkIdx = { src: rows, map };
        return map;
    },

    // 'YYYY-MM' labels for the last n complete months, plus the current month when asked.
    _sparkMonths(n, includePartial, now) {
        const out = [], d = now ? new Date(now) : new Date(); d.setDate(1);
        if (!includePartial) d.setMonth(d.getMonth() - 1);
        for (let i = 0; i < n + (includePartial ? 1 : 0); i++) { out.unshift(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); d.setMonth(d.getMonth() - 1); }
        return out;
    },

    // Records not loaded yet (e.g. the provider page opened first): load them once and re-render.
    _sparkEnsureLoaded() {
        if (this._rawCompletion != null || typeof this.ensureCompletionLoaded !== 'function' || this._completionLoadPromise) return;
        try { this.ensureCompletionLoaded().then(() => { if (this.renderView) this.renderView(); }); } catch (e) { __swallowed(e, 'spark.load'); }
    },

    // {months, values, partial, recent, prior, delta, total, known} or null while loading —
    // the app view's shape (values follow the "Include current month" toggle).
    courseTrendData(courseTitle, now) {
        const s = this.courseTrendSeries(courseTitle, now);
        if (!s) return null;
        const partial = !!this.includePartialMonth;
        const months = partial ? s.months : s.months.slice(0, -1), values = partial ? s.values : s.values.slice(0, -1);
        const complete = s.values.slice(0, -1);
        const sum = (a) => a.reduce((x, y) => x + y, 0);
        const recent = sum(complete.slice(-3)), prior = sum(complete.slice(-6, -3));
        const delta = prior > 0 ? (recent - prior) / prior : (recent > 0 ? Infinity : 0);
        return { months, values, complete, partial, recent, prior, delta, total: sum(complete), known: s.known };
    },

    // 12 complete months + the current month, for the HTML snapshot (it decides at view
    // time whether to draw the partial month). null while records load; known=false when
    // the course has no learner records.
    courseTrendSeries(courseTitle, now) {
        const idx = this._sparkIndex();
        if (!idx) { this._sparkEnsureLoaded(); return null; }
        const m = idx.get(this._sparkNorm(courseTitle));
        const months = this._sparkMonths(this.SPARK_MONTHS, true, now);
        return { months, values: months.map(k => (m && m.get(k)) || 0), known: !!m };
    },

    // Inline SVG + % label for the app's tables. opts: {width, height}. Empty span while
    // records load; a dash when the course has no learner records at all.
    courseTrendSpark(courseTitle, opts) {
        opts = opts || {};
        const w = opts.width || 84, h = opts.height || 24;
        const s = this.courseTrendSeries(courseTitle);
        if (!s) return `<span class="inline-block align-middle" style="width:${w + 40}px;height:${h}px" title="Loading learner records…"></span>`;
        if (!s.known) return `<span class="text-slate-300 text-xs" title="No learner records for this course yet — run card 2 (Sync from API) or upload the User Progress xlsx">–</span>`;
        return __sparkSvg(s.values, { width: w, height: h, partial: !!this.includePartialMonth, esc: (t) => this.escapeHtml(t) });
    },
    _sparkSvg: __sparkSvg,
});
