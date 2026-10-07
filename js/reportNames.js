// ── Names for report folders and files ──────────────────────────────────────
//
// Bulk exports write one folder per provider. The folders carry the names the
// team files provider reports under (the "SURGdash Reports" folder, October
// 2026): mostly a provider's short or familiar name, not the full author string
// from LearnWorlds ("WFSA", not "WFSA - World Federation of Societies of
// Anesthesiologists"). A provider missing from the list keeps its own name, made
// safe for macOS, Windows and SharePoint.
//
// Files lead with what they are, then whose they are, then the period they cover:
//     Feedback_WFSA_Jul-Sept 2026.xlsx
// With no report period set, the period is the export date: Report_WFSA_5 Oct 2026.pdf
Object.assign(window.App, {

    // [names a provider goes by, folder name]. Matched through _nameKey, so case,
    // accents, punctuation and spacing in the LearnWorlds name don't matter, and a
    // corrected spelling ("Stanford") still finds its folder.
    _REPORT_FOLDERS: [
        [['ALL SAFE'], 'ALL SAFE'],
        [['ASA - American Society of Anaesthesiologists', 'American Society of Anesthesiologists'], 'American Society of Anaesthesiologists'],
        [['Amosmile'], 'Amosmile'],
        [['AO Alliance'], 'AO Alliance'],
        [['Ausmed'], 'Ausmed'],
        [['Behind the Knife'], 'Behind the Knife'],
        [['CANESCA'], 'CANECSA'],
        [['COSECSA - College of Surgeons of East, Central and Southern Africa'], 'COSECSA'],
        [['CrashSavers Team'], 'CrashSavers'],
        [['ecancer'], 'ecancer'],
        [['ECSACONM - East, Central and Southern African College of Nursing and Midwifery'], 'ECSACONM'],
        [['F2AR - Fédération Francophone des Sociétés d\'Anesthésie-Réanimation', 'F2AR'], 'F2AR and Adrale'],
        [['Global Surgery Lab'], 'Global Surgery Lab'],
        [['Global Trauma Collaboration, Baylor College of Medicine'], 'Global Trauma Collaboration - Baylor College of Medicine'],
        [['GSF - Global Surgery Foundation', 'Global Surgery Foundation'], 'GSF'],
        [['Harvard Global Orthopaedics Collaborative'], 'Harvard Global Orthopaedics Collaborative and SONA Global'],
        [['Health Professional Academy'], 'Health Professional Academy'],
        [['ICRC- International Committee of the Red Cross', 'International Committee of the Red Cross'], 'ICRC'],
        [['IFRS / VRiMS'], 'IFRS'],
        [['Interburns'], 'Interburns'],
        [['King’s Global Health Partnerships'], 'Kings Global Health Partnerships'],
        [['Lifebox'], 'Lifebox'],
        [['McGill'], 'McGill'],
        [['NIHR Global Health Research Unit on Global Surgery'], 'NIHR Global Health Research Unit on Global Surgery'],
        [['PerioperativeCPD'], 'PerioperativeCPD'],
        [['RCSI - Royal College of Surgeons in Ireland'], 'RCSI'],
        [['ReSurge International'], 'Resurge International'],
        [['Safe Surgery Innovation'], 'Safe Surgery Innovation'],
        [['Smile Train'], 'Smile Train'],
        [['Standford LRC'], 'Stanford LRC'],
        [['Tecnológico de Monterrey', 'TecSalud'], 'TecSalud - Tecnologico de Monterrey'],
        [['Universities of Western Australia and Oxford'], 'Universities of Western Australia and Oxford'],
        [['Center for Global Health & Social Responsibility, University of Minnesota'], 'University of Minnesota Center for Global Health and Social Responsibility'],
        [['WFSA - World Federation of Societies of Anesthesiologists', 'World Federation of Societies of Anaesthesiologists'], 'WFSA'],
    ],

    // Letters and digits only, accents folded: "ICRC- International…" and
    // "ICRC - International…" are the same provider.
    _nameKey(s) {
        return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, '');
    },

    // The folder a provider's reports go into.
    providerFolderName(provider) {
        if (!this._reportFolderIndex) {
            const idx = {};
            (this._REPORT_FOLDERS || []).forEach(([names, folder]) => {
                names.concat([folder]).forEach(n => { idx[this._nameKey(n)] = folder; });
            });
            this._reportFolderIndex = idx;
        }
        return this._reportFolderIndex[this._nameKey(provider)] || this.fsSafeName(provider);
    },

    // A readable name every file system accepts: no / \ : * ? " < > |, no control
    // characters, no leading dot (hidden on a Mac), no trailing dot or space
    // (refused by Windows), at most 100 characters.
    fsSafeName(s) {
        let t = String(s == null ? '' : s).normalize('NFC')
            .replace(/[\u0000-\u001f\u007f]/g, '')
            .replace(/\s*[\/\\:*?"<>|]+\s*/g, ' - ')
            .replace(/\s+/g, ' ')
            .replace(/( - )+/g, ' - ')
            .trim()
            .replace(/^[.\s-]+/, '')
            .replace(/[.\s-]+$/, '');
        if (t.length > 100) t = t.slice(0, 100).replace(/[.\s-]+$/, '');
        return t || 'Untitled';
    },

    // September is "Sept", as the team writes it.
    _FILE_MONTHS: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'],

    // The report period, short: "Jul-Sept 2026", "Sept 2026", "Nov 2025-Jan 2026",
    // "Launch-Sept 2026" (no start), "Jul-Oct 2026" (no end: up to this month), or
    // the export date when no period is set. `today` is 'YYYY-MM-DD', so one batch
    // names every file alike even if it runs past midnight.
    reportPeriodFileLabel(today) {
        const now = /^\d{4}-\d{2}-\d{2}/.test(String(today || '')) ? String(today) : new Date().toISOString().slice(0, 10);
        const M = this._FILE_MONTHS;
        const parse = (v) => {
            const m = /^(\d{4})-(\d{2})/.exec(String(v || ''));
            if (!m) return null;
            const mo = Number(m[2]);
            return (mo >= 1 && mo <= 12) ? { y: m[1], m: mo } : null;
        };
        const from = parse(this.reportPeriodFrom), cur = parse(now), cut = parse(this.reportDataThrough);
        let to = parse(this.reportPeriodTo);
        // "Data through" caps the period, as in the report itself: "Launch-Sept 2026" with no period set.
        const earlier = (a, b) => Number(a.y) < Number(b.y) || (Number(a.y) === Number(b.y) && a.m < b.m);
        if (cut && (!to || earlier(cut, to))) to = cut;
        if (!from && !to) return Number(now.slice(8, 10)) + ' ' + M[cur.m - 1] + ' ' + cur.y;
        if (!from) return 'Launch-' + M[to.m - 1] + ' ' + to.y;
        const end = to || cur;
        if (from.y === end.y && from.m === end.m) return M[from.m - 1] + ' ' + from.y;
        if (from.y === end.y) return M[from.m - 1] + '-' + M[end.m - 1] + ' ' + from.y;
        return M[from.m - 1] + ' ' + from.y + '-' + M[end.m - 1] + ' ' + end.y;
    },

    // "Feedback_WFSA_Jul-Sept 2026.xlsx". kind: Report, Web report, Users, Feedback.
    reportFileName(kind, name, ext, today) {
        return kind + '_' + this.fsSafeName(name) + '_' + this.reportPeriodFileLabel(today) + '.' + ext;
    },
});
