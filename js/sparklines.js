// ── Course trend sparklines ───────────────────────────────────────────────────
// A tiny inline-SVG line per course — the trading-app glance — of COURSES STARTED
// PER MONTH over the last 12 complete months; when "Include current month" is on,
// the partial month is appended as a hollow point on a dashed segment. The colour
// and the % compare the last 3 complete months with the 3 before (≥ ±15% = green /
// red, otherwise grey). Data: the completion records already in memory (one
// start_month per learner-course) — nothing is fetched and only counts are shown,
// no learner is identifiable. The per-course index is rebuilt only when the
// records array is replaced (identity check), so rendering a table is cheap.
Object.assign(window.App, {
    SPARK_MONTHS: 12,
    SPARK_TREND_THRESHOLD: 0.15,

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

    // {months, values, partial, recent, prior, delta, total, known} or null while loading.
    courseTrendData(courseTitle, now) {
        const idx = this._sparkIndex();
        if (!idx) { this._sparkEnsureLoaded(); return null; }
        const m = idx.get(this._sparkNorm(courseTitle));
        const partial = !!this.includePartialMonth;
        const months = this._sparkMonths(this.SPARK_MONTHS, partial, now);
        const values = months.map(k => (m && m.get(k)) || 0);
        const complete = partial ? values.slice(0, -1) : values;
        const sum = (a) => a.reduce((x, y) => x + y, 0);
        const recent = sum(complete.slice(-3)), prior = sum(complete.slice(-6, -3));
        const delta = prior > 0 ? (recent - prior) / prior : (recent > 0 ? Infinity : 0);
        return { months, values, complete, partial, recent, prior, delta, total: sum(complete), known: !!m };
    },

    // Inline SVG + % label. opts: {width, height}. Empty span while records load; a dash when the
    // course has no learner records at all.
    courseTrendSpark(courseTitle, opts) {
        opts = opts || {};
        const w = opts.width || 84, h = opts.height || 24;
        const t = this.courseTrendData(courseTitle);
        if (!t) return `<span class="inline-block align-middle" style="width:${w + 40}px;height:${h}px" title="Loading learner records…"></span>`;
        if (!t.known) return `<span class="text-slate-300 text-xs" title="No learner records for this course yet — run card 2 (Sync from API) or upload the User Progress xlsx">–</span>`;
        const vals = t.values, n = vals.length, max = Math.max(1, ...vals);
        const padX = 2, padY = 2.5, innerW = w - padX * 2, innerH = h - padY * 2;
        const x = (i) => (padX + (n > 1 ? i / (n - 1) : 0) * innerW).toFixed(1);
        const y = (v) => (h - padY - (v / max) * innerH).toFixed(1);
        const solidN = t.partial ? n - 1 : n;
        const pts = vals.slice(0, solidN).map((v, i) => `${x(i)},${y(v)}`).join(' ');
        const base = (h - padY).toFixed(1);
        const area = `${x(0)},${base} ${pts} ${x(solidN - 1)},${base}`;
        const th = this.SPARK_TREND_THRESHOLD;
        const color = t.delta >= th ? '#059669' : t.delta <= -th ? '#e11d48' : '#64748b';
        const pct = !isFinite(t.delta) ? 'new' : Math.abs(t.delta) >= 10 ? '×' + Math.round(t.recent / Math.max(1, t.prior)) : (t.delta > 0 ? '+' : t.delta < 0 ? '−' : '') + Math.round(Math.abs(t.delta) * 100) + '%';   // ×32 reads better than +3129%
        const arrow = t.delta >= th ? '▲ ' : t.delta <= -th ? '▼ ' : '';
        const tip = `Courses started per month, last ${this.SPARK_MONTHS} complete months (oldest → newest): ${t.complete.join(', ')}`
            + (t.partial ? ` · current month so far: ${vals[n - 1]}` : '')
            + ` · last 3 months ${t.recent} vs previous 3 months ${t.prior}` + (isFinite(t.delta) ? ` (${pct})` : '');
        const partialMark = t.partial
            ? `<line x1="${x(solidN - 1)}" y1="${y(vals[solidN - 1])}" x2="${x(n - 1)}" y2="${y(vals[n - 1])}" stroke="${color}" stroke-width="1.2" stroke-dasharray="2 2"/><circle cx="${x(n - 1)}" cy="${y(vals[n - 1])}" r="2.2" fill="#fff" stroke="${color}" stroke-width="1.2"/>`
            : '';
        return `<span class="inline-flex items-center gap-1.5 align-middle" title="${this.escapeHtml(tip)}">`
            + `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${this.escapeHtml('Courses started per month, trend ' + pct)}" style="display:block;overflow:visible">`
            + `<polygon points="${area}" fill="${color}" fill-opacity="0.12"/>`
            + `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`
            + `<circle cx="${x(solidN - 1)}" cy="${y(vals[solidN - 1])}" r="2.2" fill="${color}"/>${partialMark}</svg>`
            + `<span class="text-[10px] font-semibold tabular-nums whitespace-nowrap" style="color:${color};min-width:38px">${arrow}${pct}</span></span>`;
    },
});
