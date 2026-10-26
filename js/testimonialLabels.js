// ── Cadre and country labels on surghub.org testimonials, in the course page's language ──────
//
// Seb, 26 Oct 2026: pages mixed "Nurse, Chad" and "Infirmière, Tchad", used long official names
// ("Tanzania, United Republic of") and showed labels that are not cadres ("Undergraduate Specialist
// Surgeon", "Odontología"). Every cadre and country on a page is now shown in that page's language
// (French on French courses, Spanish on Spanish, Arabic on Arabic, English elsewhere):
//   cadres    TM_CADRE_TABLE: one row per cadre — English, French, Spanish, Arabic — then the other
//             spellings seen in the data (any language). A label not in the table is kept on an English
//             page and left out elsewhere (the site then shows "SURGhub learner").
//   countries read to an ISO code (countryToISO, then any language's name), then named by the
//             browser's own country names (Intl.DisplayNames) in the page language, with TM_COUNTRY_SHORT
//             for the short common names the site uses.
Object.assign(window.App, {
    TM_CADRE_TABLE: [
        // [English, French, Spanish, Arabic, ...other spellings]
        ['Nurse', 'Infirmier(ère)', 'Enfermero(a)', 'ممرض(ة)', 'nurse', 'nursing', 'infirmière', 'infirmier', 'enfermera', 'enfermero', 'registered nurse', 'postgraduate nurse'],
        ['Nursing Student', 'Étudiant(e) en soins infirmiers', 'Estudiante de enfermería', 'طالب(ة) تمريض', 'student nurse', 'undergraduate nurse', 'undergraduate nurse trainee', 'senior nursing student', 'estudiante de enfermeria'],
        ['Nurse Anaesthetist', 'Infirmier(ère) anesthésiste', 'Enfermero(a) anestesista', 'ممرض(ة) تخدير', 'nurse anesthetist', 'nurse-anaesthetist', 'infirmière anesthésiste', 'infirmier anesthésiste'],
        ['Nursing Assistant', 'Aide-soignant(e)', 'Auxiliar de enfermería', 'مساعد(ة) تمريض', 'aide-soignant(e)', 'aide soignant', 'aide-soignante', 'aide-soignant'],
        ['Anaesthesiologist', 'Anesthésiste', 'Anestesiólogo(a)', 'طبيب(ة) تخدير', 'anesthesiologist', 'anesthesiology', 'anaesthetist', 'anesthetist', 'anesthésiste', 'anestesiólogo', 'anestesiologo', 'anestesióloga'],
        ['Anaesthesia Technician', 'Technicien(ne) en anesthésie', 'Técnico(a) en anestesia', 'فني(ة) تخدير', 'anesthesia technician', 'technicien en anesthésie', 'technicien en anesthesie'],
        ['Specialist Surgeon', 'Chirurgien(ne) spécialiste', 'Cirujano(a) especialista', 'جرّاح(ة) أخصائي', 'surgeon', 'chirurgien', 'cirujano', 'cirujana'],
        ['General Surgeon', 'Chirurgien(ne) généraliste', 'Cirujano(a) general', 'جرّاح(ة) عام', 'practicing general surgeon', 'practising general surgeon'],
        ['General Medical Officer', 'Médecin généraliste', 'Médico(a) general', 'طبيب(ة) عام', 'medical officer', 'medical-officer', 'médecin généraliste', 'medecin generaliste', 'médico general', 'gp', 'general practitioner'],
        ['Chief Medical Officer', 'Médecin-chef', 'Médico(a) jefe', 'رئيس(ة) الأطباء', 'médecin-chef', 'médecin chef', 'médico jefe', 'medico jefe'],
        ['Physician', 'Médecin', 'Médico(a)', 'طبيب(ة)', 'doctor', 'médecin', 'médico', 'medico', 'medical doctor'],
        ['Emergency Medicine Doctor', 'Médecin urgentiste', 'Médico(a) de urgencias', 'طبيب(ة) طوارئ', 'emergency-doctor', 'emergency doctor', 'emergency physician', 'urgentiste'],
        ['Resident', 'Interne', 'Médico(a) residente', 'طبيب(ة) مقيم', 'resident', 'postgraduate medical trainee', 'postgraduate clinical trainee', 'postgraduate specialist surgeon', 'postgraduate anaesthesiologist', 'postgraduate anaesthesiologist trainee', 'residente', 'interne', 'estudiante de posgrado en medicina de urgencias'],
        ['Medical Student', 'Étudiant(e) en médecine', 'Estudiante de medicina', 'طالب(ة) طب', 'medicine student', 'undergraduate medical student', 'undergraduate specialist surgeon', 'undergraduate gynaecologist', 'étudiant en médecine', 'estudiante de medicina'],
        ['Student', 'Étudiant(e)', 'Estudiante', 'طالب(ة)', 'undergraduate student', 'postgraduate student', 'étudiant', 'étudiante', 'estudiante'],
        ['Dentist', 'Dentiste', 'Odontólogo(a)', 'طبيب(ة) أسنان', 'odontología', 'odontologia', 'odontólogo', 'dentista', 'dentiste'],
        ['Dentistry Student', 'Étudiant(e) en dentisterie', 'Estudiante de odontología', 'طالب(ة) طب أسنان', 'dental student'],
        ['Gynaecologist', 'Gynécologue', 'Ginecólogo(a)', 'طبيب(ة) نسائي', 'gynecologist', 'gynécologue', 'ginecólogo', 'ginecologo'],
        ['Obstetrician', 'Obstétricien(ne)', 'Obstetra', 'طبيب(ة) توليد', 'obstetrician', 'obstetra', 'postgraduate obstetrician'],
        ['Medical Technician', 'Technicien(ne) médical(e)', 'Técnico(a) médico', 'فني(ة) طبي', 'medical-technician', 'undergraduate medical technician'],
        ['Clinical Officer', 'Clinicien(ne) non médecin', 'Clínico(a) no médico', 'مسؤول(ة) سريري', 'clinical-officer', 'non-physician clinician'],
        ['Non-Clinical Professional', 'Professionnel(le) non clinique', 'Profesional no clínico', 'مهني(ة) غير سريري', 'non-clinical', 'non clinical professional'],
        ['Physiotherapist', 'Kinésithérapeute', 'Fisioterapeuta', 'أخصائي(ة) علاج طبيعي', 'physical therapist', 'kinésithérapeute', 'fisioterapeuta'],
        ['Paramedic', 'Ambulancier(ère)', 'Paramédico(a)', 'مسعف(ة)', 'paramédico'],
        ['Educator', 'Enseignant(e)', 'Docente', 'مدرّس(ة)', 'teaching faculty', 'educator & researcher', 'educator and researcher', 'enseignant', 'docente'],
    ],
    // Short common names (ISO code → per language); anything else is the browser's own name.
    TM_COUNTRY_SHORT: {
        CD: { en: 'DR Congo', fr: 'RD Congo', es: 'RD del Congo', ar: 'الكونغو الديمقراطية' },
        CG: { en: 'Congo', fr: 'Congo', es: 'Congo', ar: 'الكونغو' },
        CI: { en: "Côte d'Ivoire", fr: "Côte d'Ivoire", es: "Côte d'Ivoire", ar: 'ساحل العاج' },
        PS: { en: 'Palestine', fr: 'Palestine', es: 'Palestina', ar: 'فلسطين' },
        HK: { en: 'Hong Kong', fr: 'Hong Kong', es: 'Hong Kong', ar: 'هونغ كونغ' },
        MO: { en: 'Macau', fr: 'Macao', es: 'Macao', ar: 'ماكاو' },
        VN: { fr: 'Vietnam' },
        US: { en: 'United States' },
        GB: { en: 'United Kingdom' },
    },
    _tmCadreIndex() {
        if (this._tmCadreIdx) return this._tmCadreIdx;
        const idx = {};
        this.TM_CADRE_TABLE.forEach(row => row.forEach(l => { const k = this._tmNorm(l); if (k && !idx[k]) idx[k] = row; }));
        return (this._tmCadreIdx = idx);
    },
    // A cadre label as the page in `lang` shows it ('' = none).
    tmCadreLabel(label, lang) {
        const t = String(label == null ? '' : label).trim();
        if (!t || /^surghub learner$/i.test(t)) return '';
        const row = this._tmCadreIndex()[this._tmNorm(t)];
        if (row) return row[{ en: 0, fr: 1, es: 2, ar: 3 }[lang] || 0];
        return lang === 'en' && !/[^\x00-\x7f]/.test(t) ? t : '';
    },
    _tmCountryIndex() {
        if (this._tmCtryIdx) return this._tmCtryIdx;
        const idx = {}, codes = [];
        for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) codes.push(String.fromCharCode(a, b));
        let names = {};
        try { names = { en: new Intl.DisplayNames(['en'], { type: 'region' }), fr: new Intl.DisplayNames(['fr'], { type: 'region' }), es: new Intl.DisplayNames(['es'], { type: 'region' }), ar: new Intl.DisplayNames(['ar'], { type: 'region' }) }; } catch (e) { names = {}; }
        codes.forEach(c => Object.values(names).forEach(n => { let v; try { v = n.of(c); } catch (e) { v = null; } if (v && v !== c) { const k = this._tmNorm(v); if (k && !idx[k]) idx[k] = c; } }));
        Object.entries(this.TM_COUNTRY_SHORT).forEach(([c, m]) => Object.values(m).forEach(v => { idx[this._tmNorm(v)] = c; }));
        Object.assign(idx, { 'ivory coast': 'CI', 'phillippines': 'PH', 'usa': 'US', 'uk': 'GB', 'drc': 'CD', 'rdc': 'CD', 'dr congo': 'CD', 'turkey': 'TR',
            'republique democratique du congo': 'CD', 'democratic republic of the congo': 'CD', 'congo the democratic republic of the': 'CD', 'congo kinshasa': 'CD', 'congo brazzaville': 'CG',
            'republique du congo': 'CG', 'republic of the congo': 'CG', 'tanzania united republic of': 'TZ', 'korea republic of': 'KR', 'iran islamic republic of': 'IR', 'bolivia plurinational state of': 'BO', 'venezuela bolivarian republic of': 'VE' });
        return (this._tmCtryIdx = idx);
    },
    tmCountryISO(name) {
        const t = String(name == null ? '' : name).trim();
        if (!t) return '';
        const iso = window.countryToISO ? window.countryToISO(t) : null;
        if (iso && /^[A-Z]{2}$/.test(iso)) return iso;
        const idx = this._tmCountryIndex(), n = this._tmNorm(t);
        return idx[n] || idx[this._tmNorm(t.replace(/\s*\(.*\)\s*$/, '').replace(/,.*$/, ''))] || '';
    },
    // A country as the page in `lang` shows it: a short common name ('' when it cannot be read).
    tmCountryLabel(name, lang) {
        const t = String(name == null ? '' : name).trim(); if (!t) return '';
        const iso = this.tmCountryISO(t);
        if (!iso) return lang === 'en' && !/[^\x00-\x7f]/.test(t) ? t : '';
        const s = this.TM_COUNTRY_SHORT[iso]; if (s && s[lang]) return s[lang];
        try {
            let v = new Intl.DisplayNames([lang], { type: 'region' }).of(iso);
            if (v && v !== iso) {
                v = v.replace(/’/g, "'").replace(/\s*\([^)]*\)\s*$/, '');          // "Myanmar (Burma)" → "Myanmar"
                if (lang === 'en') v = v.replace(/ & /g, ' and ').replace(/^St\. /, 'Saint ');   // "Trinidad & Tobago"
                return v;
            }
        } catch (e) { /* no Intl names */ }
        return t;
    },
});
