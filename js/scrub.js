// Free-text scrubbing for anything a provider receives (report quotes, the feedback
// workbook, partner dashboards). Survey rows are anonymised by column, but learners
// sometimes type their own email, phone number or name into a comment — those are
// replaced here. Names are matched against the learner names this Mac knows
// (surghub_completion), only when written capitalised, so "explain it" or
// "the next level" (real account names, alas) never mangle a comment.
Object.assign(window.App, {
    SCRUB_STOP: new Set(('a an and are as at be but by do for from go good great had has have he her his i if in is it its me '
        + 'my no not of on or our she so the their them they this to us was we were what when who will with you your '
        + 'team surghub course courses module training train surgery surgical medicine medical health hospital university '
        + 'college school account google level time like know learn explain thank thanks very much more best hard big next').split(' ')),

    _scrubNorm(w) { return String(w).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’]/g, "'"); },

    // Learner full names (2–4 words, none generic), rebuilt when the completion data changes.
    _scrubNames() {
        const rows = this._rawCompletion || [];
        if (this._scrubNameSet && this._scrubNameSrc === rows && this._scrubNameLen === rows.length) return this._scrubNameSet;
        const set = new Set();
        rows.forEach(r => {
            const words = this._scrubNorm(r && r.name || '').replace(/[^a-z' -]/g, ' ').split(/[\s-]+/).filter(Boolean);
            if (words.length < 2 || words.length > 4 || words.some(w => w.length < 2 || this.SCRUB_STOP.has(w))) return;
            set.add(words.join(' '));
        });
        this._scrubNameSet = set; this._scrubNameSrc = rows; this._scrubNameLen = rows.length;
        return set;
    },

    scrubPersonal(text) {
        let t = String(text == null ? '' : text);
        if (!t) return t;
        // personal profiles only (an organisation's page is fine)
        t = t.replace(/(?:https?:\/\/)?(?:[\w-]+\.)?\b(?:linkedin\.com\/(?:in|pub)\/|facebook\.com\/profile\.php|wa\.me\/)[^\s)\]]*/gi, '[profile link removed]');
        t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email removed]');
        t = t.replace(/\+?\d[\d\s().-]{7,}\d/g, m => (m.replace(/\D/g, '').length >= 9 ? '[phone removed]' : m));
        const names = this._scrubNames();
        if (!names.size) return t;
        // Capitalised word runs; each 2–4 word window is checked against the learner names.
        const re = /\p{Lu}[\p{L}'’]*(?:-\p{Lu}?[\p{L}'’]+)*/gu, toks = [];
        let m; while ((m = re.exec(t))) toks.push({ w: m[0], s: m.index, e: m.index + m[0].length });
        const cut = [];
        for (let i = 0; i < toks.length; i++) {
            for (let n = Math.min(4, toks.length - i); n >= 2; n--) {
                const run = toks.slice(i, i + n);
                // the words must sit next to each other (spaces only between them)
                if (run.some((k, j) => j > 0 && !/^\s+$/.test(t.slice(run[j - 1].e, k.s)))) continue;
                const key = run.map(k => this._scrubNorm(k.w).replace(/-/g, ' ')).join(' ').replace(/\s+/g, ' ');
                if (names.has(key)) { cut.push([run[0].s, run[n - 1].e]); i += n - 1; break; }
            }
        }
        for (let k = cut.length - 1; k >= 0; k--) t = t.slice(0, cut[k][0]) + '[name removed]' + t.slice(cut[k][1]);
        return t;
    },
});
