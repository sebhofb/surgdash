// Single source of truth for cadre / profession canonicalisation.
//
// Both the data sync (updater.js `normalizeProf`) and the dashboard
// (engagementAnalysis.js `_canonProf`) route through THIS module, so cadre
// buckets can never silently diverge between the sync and the views again
// (previously two near-identical maps drifted apart — see project memory).
//
// Rules: keyword list ordered SPECIFIC → GENERAL (e.g. "nursing student" and
// "anaesthesia" before "nurse"); kebab/underscore tags are normalised to spaces;
// an "Other (x)" value extracts x for matching. Returns a canonical cadre, the
// string 'Other' for an unrecognised non-empty tag, or null for an
// undeclared / empty value.
(function () {
    const PROF_MAP = [
        [['specialist surgeon', 'surgeon', 'surgery'], 'Surgeon'],
        [['anaesth', 'anesth'], 'Anaesthesia'],
        [['obstetric', 'gynaecolog', 'gynecolog', 'ob gyn', 'obgyn', 'ob/gyn'], 'Obstetrics & Gynaecology'],
        [['emergency'], 'Emergency Medicine'],
        [['midwif'], 'Midwife'],
        [['medical student'], 'Medical Student'],
        [['nursing student'], 'Nursing Student'],
        [['nurse', 'nursing'], 'Nursing'],
        [['intern', 'resident', 'trainee', 'registrar'], 'Trainee / Resident'],
        [['general medical officer', 'medical officer'], 'Medical Officer'],
        [['clinical officer', 'non-physician clinician', 'non physician clinician'], 'Clinical Officer'],
        [['paramedic', 'prehospital', 'pre hospital'], 'Paramedic'],
        [['pharmac'], 'Pharmacist'],
        [['dentist', 'dental'], 'Dentist'],
        [['physiotherap', 'physical therap'], 'Physiotherapist'],
        [['radiograph', 'radiolog'], 'Radiography'],
        [['technician', 'technologist'], 'Technician'],
        [['research'], 'Researcher'],
        [['public health', 'epidemiolog'], 'Public Health'],
        [['educator', 'teacher', 'lecturer', 'professor', 'faculty'], 'Educator / Faculty'],
        [['engineer', 'biomedical'], 'Engineer'],
        [['administrat', 'manager', 'management'], 'Administrator'],
        [['non-clinical', 'non clinical'], 'Non-Clinical'],
        [['physician', 'doctor', 'practitioner'], 'Physician'],
        [['student'], 'Student'],
    ];

    function canonProf(raw) {
        if (!raw) return null;
        const s = String(raw).trim(); if (!s) return null;
        const low = s.toLowerCase();
        if (['nan', 'not specified', 'n/a', '-', 'unknown', 'none', 'other'].includes(low)) return low === 'other' ? 'Other' : null;
        const pm = s.match(/^other\s*\((.+)\)\s*$/i);
        const search = (pm ? pm[1].trim().toLowerCase() : low).replace(/[-_]+/g, ' ');
        for (const [kws, canon] of PROF_MAP) { for (const kw of kws) { if (search.includes(kw) || low.includes(kw)) return canon; } }
        return 'Other';
    }

    window.Taxonomy = { PROF_MAP, canonProf };
})();
