window.Projects = {
    registry: [],

    STANDARD_KPIS: [
        { id: 'hcw_strengthened',        name: 'Healthcare Workers Strengthened',                  nameBig: 'Healthcare Workers',  nameSub: 'Strengthened',                              unit: 'HCWs',       icon: 'stethoscope', color: '#4389C8' },
        { id: 'patients_reached',        name: 'Patients Reached with Improved Surgical Care',     nameBig: 'Patients',            nameSub: 'Reached with Improved Surgical Care',       unit: 'patients',   icon: 'heart',       color: '#D03734' },
        // stock:true = a point-in-time state (the same catchment/facility persists
        // year to year), so an all-time roll-up takes the MAX across years per
        // project — never the sum, which would multiply the same reach by #years.
        // Flow KPIs (HCW, patients) accumulate, so they sum. This mirrors the
        // web export's _isStock rule so the app and exports report identical totals.
        { id: 'population_access',       name: 'Population with Improved Access to Surgical Care', nameBig: 'Population',          nameSub: 'with Improved Access to Surgical Care',     unit: 'people',     icon: 'globe',       color: '#10B981', stock: true },
        { id: 'facilities_strengthened', name: 'Facilities Strengthened',                          nameBig: 'Facilities',          nameSub: 'Strengthened',                              unit: 'facilities', icon: 'building-2',  color: '#E28743', stock: true }
    ],

    // GSF programme areas — projects are categorised into one. `lucide` drives the
    // in-app picker icon; `svg` is the inner SVG markup used in the self-contained
    // web export (no icon library available there). Drawn at 0 0 24 24 viewBox.
    PROGRAMMES: [
        // GSF brand-book colours only (Boston blue, Tango, Sage, Crimson — no purple in the brand).
        { id: 'maternal_health',  name: 'Maternal Health',   color: '#4389C8', lucide: 'heart',    svg: '<path d="M19 14c1.5-1.5 3-3.7 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.74 0-3 .5-4.5 2-1.5-1.5-2.76-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 1.8 1.5 4 3 5.5l7 7Z"/>' },
        { id: 'trauma_care',      name: 'Trauma Care',       color: '#E28743', lucide: 'activity', svg: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>' },
        { id: 'childrens_surgery', name: "Children's Surgery", color: '#7A9E9F', lucide: 'person-standing', svg: '<circle cx="12" cy="5" r="1"/><path d="m9 20 3-6 3 6"/><path d="m6 8 6 2 6-2"/><path d="M12 10v4"/>' },
        { id: 'cancer_care',      name: 'Cancer Care',       color: '#D03734', lucide: 'ribbon',   svg: '<path d="M12 13C9 9.5 7.5 7.7 7.5 5.5a4.5 4.5 0 0 1 9 0c0 2.2-1.5 4-4.5 7.5Z"/><path d="M10.2 11.6 6.5 20l3-1 1.6 2.6"/><path d="M13.8 11.6 17.5 20l-3-1-1.6 2.6"/>' }
    ],
    programmeById(id){ return this.PROGRAMMES.find(p => p.id === id) || null; },

    // Quarterly quality/outcome KPIs — presets + user-defined
    QUALITY_KPIS: [
        { id: 'ssi_rate', name: 'Surgical Site Infection Rate', shortName: 'SSI', unit: '%',               icon: 'shield-alert',    color: '#8B5CF6', preset: true, lowerIsBetter: true  },
        { id: 'mmr',      name: 'Maternal Mortality Rate',      shortName: 'MMR', unit: 'per 100k',        icon: 'heart-pulse',     color: '#EC4899', preset: true, lowerIsBetter: true  },
        { id: 'nmr',      name: 'Neonatal Mortality Rate',      shortName: 'NMR', unit: 'per 1k live births', icon: 'thermometer', color: '#F59E0B', preset: true, lowerIsBetter: true  },
        { id: 'ssc_util', name: 'Surgical Safety Checklist Utilisation Rate', shortName: 'SSC', unit: '%', icon: 'clipboard-check', color: '#059669', preset: true, lowerIsBetter: false }
    ],

    // Activity categories. The "current" set is:
    //   training_mentoring · site_visit · other_update
    // The older keys (workshop, mentoring, other) are kept for backward compat —
    // existing data renders correctly and gets migrated at edit time.
    EVENT_TYPES: {
        training_mentoring: { label: 'Training / Mentoring', icon: 'users',          color: '#4389C8', kpis: [] },
        site_visit:         { label: 'Site Visit',           icon: 'map-pin',        color: '#10B981', kpis: [] },
        other_update:       { label: 'Other Update',         icon: 'newspaper',      color: '#64748b', kpis: [] },
        // ── Legacy keys (kept so old events still render with the right colour/label) ──
        workshop:           { label: 'Training / Mentoring', icon: 'users',          color: '#4389C8', kpis: [], _legacy: 'training_mentoring' },
        mentoring:          { label: 'Training / Mentoring', icon: 'graduation-cap', color: '#4389C8', kpis: [], _legacy: 'training_mentoring' },
        other:              { label: 'Other Update',         icon: 'newspaper',      color: '#64748b', kpis: [], _legacy: 'other_update' },
    },

    // Normalize a stored event type to the canonical (current) key.
    canonicalEventType(t) {
        const et = this.EVENT_TYPES[t];
        if (!et) return 'other_update';
        return et._legacy || t;
    },

    ORG_PROJECT: {
        id: 'org',
        name: 'Organisation',
        type: 'org',
        description: 'All projects overview',
        color: '#002F4C',
        icon: 'building-2'
    },

    SURGHUB_DEFAULT: {
        id: 'surghub',
        name: 'SURGhub',
        type: 'surghub',
        description: 'SURGhub Learning Platform Analytics',
        color: '#4389C8',
        icon: 'graduation-cap',
        createdAt: '2024-01-01',
        kpiDefinitions: []
    },

    async loadRegistry() {
        const stored = await Storage.getItem('surgdash_projects');
        if (stored && stored.length > 0) {
            this.registry = stored;
        } else {
            this.registry = [{ ...this.SURGHUB_DEFAULT }];
            await this.saveRegistry();
        }
        // Ensure SURGhub entry always exists
        if (!this.registry.find(p => p.id === 'surghub')) {
            this.registry.unshift({ ...this.SURGHUB_DEFAULT });
            await this.saveRegistry();
        }
        // ── Migration: `locations` must be an array of {name,lat,lng} (not a free-text string).
        // Early sample-project builds saved it as a string, which breaks the Map and
        // Settings views (calls `.forEach`/`.map` on a string). Strip the bad value.
        let migrated = false;
        this.registry.forEach(p => {
            if (p.locations !== undefined && p.locations !== null && !Array.isArray(p.locations)) {
                delete p.locations;
                migrated = true;
            }
            // Ensure the demo sample always has quality baselines AND targets so the
            // Quality Improvement vs Baseline section + per-KPI goals render.
            if (p.isSample) {
                if (!p.qualityBaselines || Object.keys(p.qualityBaselines).length === 0) {
                    p.qualityBaselines = { ssi_rate: 12, ssc_util: 45, mmr: 400, nmr: 30 };
                    migrated = true;
                }
                if (!p.qualityTargets || Object.keys(p.qualityTargets).length === 0) {
                    p.qualityTargets = { ssi_rate: 5, ssc_util: 90, mmr: 200, nmr: 15 };
                    migrated = true;
                }
            }
        });
        if (migrated) await this.saveRegistry();
        return this.registry;
    },

    async saveRegistry() {
        await Storage.setItem('surgdash_projects', this.registry);
    },

    // --- App-wide settings ---
    async getAppSettings() {
        return (await Storage.getItem('surgdash_app_settings')) || {};
    },

    async saveAppSettings(patch, options) {
        const current = await this.getAppSettings();
        const updated = { ...current, ...patch };
        await Storage.setItem('surgdash_app_settings', updated, options);
        return updated;
    },

    getProject(projectId) {
        return this.registry.find(p => p.id === projectId) || null;
    },

    async createProject(opts = {}) {
        const { name, description, color, icon, kpiDefinitions, ...extras } = opts;
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now().toString(36);
        const project = Object.assign({
            id,
            name,
            type: 'generic',
            description: description || '',
            color: color || '#4389C8',
            icon: icon || 'briefcase',
            createdAt: new Date().toISOString().split('T')[0],
            kpiDefinitions: kpiDefinitions || []
        }, extras);
        this.registry.push(project);
        await this.saveRegistry();
        return project;
    },

    // Create a fully-populated sample project — KPIs, quality indicators,
    // facilities (on map), events, narrative updates. Flagged isSample:true so
    // org-level aggregations exclude it; sidebar gives it a visual badge.
    async createSampleProject() {
        // If one already exists, just return it (back-filling quality baselines/
        // targets on older samples so the Quality Improvement vs Baseline section
        // and the per-KPI baselines render).
        const existing = this.registry.find(p => p.isSample);
        if (existing) {
            // Back-fill baselines and targets independently — older samples may have
            // one but not the other.
            let changed = false;
            if (!existing.qualityBaselines || Object.keys(existing.qualityBaselines).length === 0) {
                existing.qualityBaselines = { ssi_rate: 12, ssc_util: 45, mmr: 400, nmr: 30 };
                changed = true;
            }
            if (!existing.qualityTargets || Object.keys(existing.qualityTargets).length === 0) {
                existing.qualityTargets = { ssi_rate: 5, ssc_util: 90, mmr: 200, nmr: 15 };
                changed = true;
            }
            if (changed) await this.saveRegistry();
            return existing;
        }

        const id = 'sample-' + Date.now().toString(36);
        const today = new Date();
        const yearNow = today.getFullYear();
        const project = {
            id,
            name: 'Sample SURGfund Project',
            shortName: 'Sample Project',
            isSample: true,
            programme: 'maternal_health',
            type: 'generic',
            description: 'A demonstration project with fully populated sample data — showcase what a complete SURGfund dashboard looks like. Excluded from organisation-wide totals.',
            color: '#8B5CF6',           // purple — visually distinct from real projects
            icon: 'flask-conical',
            createdAt: new Date(yearNow - 2, 0, 15).toISOString().split('T')[0],
            startDate: `${yearNow - 2}-01-15`,
            endDate:   `${yearNow + 2}-12-31`,
            // Note: `locations` is the project-level pin (array of {name,lat,lng}),
            // not a free-text country list. Facilities already span the three countries.
            currency: 'USD',
            kpiDefinitions: [],
            enabledQualityKpis: ['ssi_rate', 'mmr', 'nmr', 'ssc_util'],
            // Impact assumptions — drives the Economic Impact section.
            // Baselines roughly match the sample's earliest quarterly actuals so
            // the dashboard shows realistic deltas vs. published regional figures.
            impactAssumptions: {
                baselineSSI: 12,           // % — typical pre-intervention rate in LMIC surgical wards
                baselineSSC: 45,           // % — pre-intervention checklist adoption
                baselineMMR: 400,          // per 100k — sub-Saharan Africa average
                baselineNMR: 30,           // per 1k live births — sub-Saharan Africa average
                annualSurgicalVolume: 5000,  // across 5 hub-and-spoke facilities
                annualLiveBirths: 3500,
                gdpPerCapita: 1500,        // weighted avg of Kenya/Sierra Leone/Rwanda
            },
            // Per-KPI quality baselines (pre-intervention) + project goals, so the
            // "Quality Improvement vs Baseline" section has something to measure against.
            qualityBaselines: { ssi_rate: 12, ssc_util: 45, mmr: 400, nmr: 30 },
            qualityTargets:   { ssi_rate: 5,  ssc_util: 90, mmr: 200, nmr: 15 },
        };
        this.registry.push(project);
        await this.saveRegistry();

        // ── Standard KPIs: 5 years (2 past, current, 2 future) ──────────
        const yPast2 = yearNow - 2, yPast1 = yearNow - 1, yCur = yearNow, yFut1 = yearNow + 1, yFut2 = yearNow + 2;
        const targets = [
            { year: yPast2, kpis: { hcw_strengthened: 200, patients_reached: 8000,  population_access: 250000, facilities_strengthened: 4 } },
            { year: yPast1, kpis: { hcw_strengthened: 300, patients_reached: 15000, population_access: 320000, facilities_strengthened: 5 } },
            { year: yCur,   kpis: { hcw_strengthened: 400, patients_reached: 20000, population_access: 380000, facilities_strengthened: 6 } },
            { year: yFut1,  kpis: { hcw_strengthened: 500, patients_reached: 25000, population_access: 450000, facilities_strengthened: 7 } },
            { year: yFut2,  kpis: { hcw_strengthened: 600, patients_reached: 30000, population_access: 500000, facilities_strengthened: 8 } },
        ];
        const actuals = [
            { year: yPast2, kpis: { hcw_strengthened: 215, patients_reached: 7800,  population_access: 250000, facilities_strengthened: 4 } },
            { year: yPast1, kpis: { hcw_strengthened: 340, patients_reached: 16200, population_access: 320000, facilities_strengthened: 5 } },
            { year: yCur,   kpis: { hcw_strengthened: 285, patients_reached: 13500, population_access: 380000, facilities_strengthened: 5 } },
            // yFut1 and yFut2 deliberately empty — future targets only
        ];
        await Storage.setItem(`surgdash_targets_${id}`, targets);
        await Storage.setItem(`surgdash_actuals_${id}`, actuals);

        // ── Budget (per-year allocated) ──────────────────────────────────
        // Realistic 5-year project budget. (Spent tracking removed — economic
        // impact metrics live on the dashboard derived from allocated.)
        const budget = [
            { year: yPast2, allocated: 280000, notes: 'Year 1 — setup costs + initial training cohort' },
            { year: yPast1, allocated: 420000, notes: 'Year 2 — full programme scale-up' },
            { year: yCur,   allocated: 520000, notes: 'Year 3 — expansion to Kigali UTH' },
            { year: yFut1,  allocated: 600000, notes: 'Year 4 — sustainability handoff begins' },
            { year: yFut2,  allocated: 480000, notes: 'Year 5 — final year, knowledge transfer' },
        ];
        await Storage.setItem(`surgdash_budget_${id}`, budget);

        // ── Quality KPIs (quarterly) ─────────────────────────────────────
        // Targets are STATIC per indicator — they represent the optimal/aspirational
        // value the project is striving toward (not a per-quarter ramp).
        // Actuals show real-world progress toward those targets.
        const quality = [];
        const push = (kpiId, year, quarter, target, actual) => quality.push({ kpiId, year, quarter, target, actual });
        const QUALITY_TARGETS = {
            ssi_rate: 5,    // ≤ 5% — achievable best-practice target in resource-limited settings
            mmr:      200,  // ≤ 200 per 100k — project goal (national target en route to SDG 3.1 = 70)
            nmr:      15,   // ≤ 15 per 1k live births — project goal (en route to SDG 3.2 = 12)
            ssc_util: 90,   // ≥ 90% — surgical safety checklist utilisation
        };
        // SSI Rate (lower is better) — gradual reduction in actuals
        [[yPast2,3,11.8],[yPast2,4,10.5],[yPast1,1,8.7],[yPast1,2,7.9],[yPast1,3,7.5],[yPast1,4,5.8],[yCur,1,5.2],[yCur,2,null]]
            .forEach(([y,q,a]) => push('ssi_rate', y, q, QUALITY_TARGETS.ssi_rate, a));
        // MMR per 100k (lower is better)
        [[yPast2,3,395],[yPast2,4,370],[yPast1,1,355],[yPast1,2,320],[yPast1,3,305],[yPast1,4,285],[yCur,1,290],[yCur,2,null]]
            .forEach(([y,q,a]) => push('mmr', y, q, QUALITY_TARGETS.mmr, a));
        // NMR per 1k live births
        [[yPast2,3,29.5],[yPast2,4,27.2],[yPast1,1,25.1],[yPast1,2,22.4],[yPast1,3,20.8],[yPast1,4,18.5],[yCur,1,18.2],[yCur,2,null]]
            .forEach(([y,q,a]) => push('nmr', y, q, QUALITY_TARGETS.nmr, a));
        // SSC Utilisation Rate (higher is better)
        [[yPast2,3,45],[yPast2,4,58],[yPast1,1,72],[yPast1,2,78],[yPast1,3,86],[yPast1,4,89],[yCur,1,91],[yCur,2,null]]
            .forEach(([y,q,a]) => push('ssc_util', y, q, QUALITY_TARGETS.ssc_util, a));
        await Storage.setItem(`surgdash_quality_data_${id}`, quality);

        // ── Facilities (with coords for the map) ─────────────────────────
        const facilities = [
            { id: 'sf-1', name: 'Kenyatta National Hospital',                 isHub: true,  catchmentPop: 500000, annualPatients: 80000, lat: -1.3013, lng: 36.8073, notes: 'Hub — Nairobi, Kenya' },
            { id: 'sf-2', name: 'Mbagathi District Hospital',                  isHub: false, catchmentPop: 200000, annualPatients: 35000, lat: -1.2986, lng: 36.8087, notes: 'Spoke — Nairobi, Kenya' },
            { id: 'sf-3', name: 'Bo Government Hospital',                      isHub: false, catchmentPop: 180000, annualPatients: 22000, lat: 7.9544,  lng: -11.7384, notes: 'Spoke — Bo, Sierra Leone' },
            { id: 'sf-4', name: 'Princess Christian Maternity Hospital',       isHub: false, catchmentPop: 150000, annualPatients: 18000, lat: 8.4848,  lng: -13.2299, notes: 'Spoke — Freetown, Sierra Leone' },
            { id: 'sf-5', name: 'Kigali University Teaching Hospital',         isHub: false, catchmentPop: 250000, annualPatients: 45000, lat: -1.9540, lng: 30.0606,  notes: 'Spoke — Kigali, Rwanda' },
        ];
        await Storage.setItem(`surgdash_facilities_${id}`, facilities);

        // ── Events (training, mentoring, milestones) ─────────────────────
        const ev = (date, title, type, hcw_count, hcw_new_count, facIds, notes, patient_count = 0) => ({
            id: 'sev-' + date.replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 6),
            date, title, type,
            hcw_count, hcw_new_count,
            patient_count,
            facilities_count: facIds.length,
            facility_ids: facIds,
            notes
        });
        const events = [
            ev(`${yPast2}-04-15`, 'Surgical Foundations Training — Nairobi',           'training_mentoring', 35, 35, ['sf-1'],         'Inaugural training cohort — 35 HCWs across 4 cadres.'),
            ev(`${yPast2}-07-22`, 'Anaesthesia Skills Workshop — Freetown',            'training_mentoring', 28, 28, ['sf-4'],         'Hands-on simulation training with WFSA.'),
            ev(`${yPast2}-10-10`, 'Mentorship Visit — Kigali',                          'site_visit',         18, 18, ['sf-5'],         '2-week mentorship by visiting surgeon.'),
            ev(`${yPast2}-11-05`, 'Quality Improvement Symposium',                      'training_mentoring', 65, 65, ['sf-1','sf-2'],  'Cross-site exchange on QI methods.'),
            ev(`${yPast1}-02-18`, 'Surgical Site Infection Reduction Workshop',         'training_mentoring', 42, 30, ['sf-1','sf-2'],  'Bundled-care training; SSI rate dropped 35% post-intervention.'),
            ev(`${yPast1}-04-08`, 'Mentorship Visit — Bo',                              'site_visit',         12, 12, ['sf-3'],         'Anaesthesia supervision and skills coaching.'),
            ev(`${yPast1}-06-14`, 'Maternal Care Skills Training',                      'training_mentoring', 55, 40, ['sf-4'],         'Focus on safe caesarean section pathways.'),
            ev(`${yPast1}-09-25`, 'Annual Programme Review Meeting',                    'other_update',       80,  0, ['sf-1','sf-2','sf-3','sf-4','sf-5'], 'Cross-country results review and Year 2 planning.'),
            ev(`${yPast1}-11-12`, 'Advanced Surgical Skills — Kigali',                  'training_mentoring', 40, 40, ['sf-5'],         'Laparoscopy and trauma surgery modules.'),
            ev(`${yCur}-02-20`,   'Quarterly Mentorship Day',                            'site_visit',         25, 25, ['sf-3','sf-4'],  'Joint Sierra Leone session.'),
            ev(`${yCur}-04-10`,   'Train-the-Trainer Workshop',                          'training_mentoring', 32, 32, ['sf-1'],         'Building local faculty for Year 3 expansion.'),
        ];
        await Storage.setItem(`surgdash_events_${id}`, events);

        // ── Narrative Updates ────────────────────────────────────────────
        const up = (date, title, body, tags) => ({
            id: 'sup-' + date.replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 6),
            date, title, body,
            tags: tags || [], link: ''
        });
        const updates = [
            up(`${yPast2}-01-20`, 'Project Launch — Year 1 begins',
                'Sample SURGfund Project formally launched following partnership agreements with three Ministries of Health. Initial focus: foundational surgical workforce strengthening across five hub-and-spoke facilities in Kenya, Sierra Leone, and Rwanda.',
                ['launch', 'milestone']),
            up(`${yPast2}-09-30`, 'First 100 HCWs trained',
                'By end of Q3, 102 healthcare workers have completed at least one structured training across the three country sites — exceeding the Year 1 mid-point target. Feedback surveys score curriculum relevance at 4.6/5.',
                ['milestone', 'training']),
            up(`${yPast1}-03-15`, 'SSI rate halved in pilot hospitals',
                'Post-intervention surveillance shows a 52% reduction in 30-day surgical site infection rates at Kenyatta and Mbagathi following the SSI Reduction Workshop and bundle implementation. Submitted abstract to the World Congress of Surgery.',
                ['quality', 'outcomes']),
            up(`${yPast1}-08-12`, 'Expansion to Kigali University Teaching Hospital',
                'Kigali UTH formally onboarded as the third hub. Memorandum signed with the Ministry of Health Rwanda. Year 2 cohort intake increased by 30%.',
                ['expansion', 'partnership']),
            up(`${yPast1}-12-20`, 'Year 2 results published',
                'Independent evaluation confirms 340 HCWs strengthened (target: 300) and 16,200 patients reached (target: 15,000). Sustainability plan drafted with country leads for Years 3-5.',
                ['report', 'evaluation']),
            up(`${yCur}-03-05`,   'Mid-project external review completed',
                'External review team commended cross-country learning exchanges and recommended scaling the mentorship model. Three key recommendations under implementation: digital learning supplement, peer-mentor accreditation, and outcome registry.',
                ['review', 'milestone']),
            up(`${yCur}-04-22`,   'Year 3 underway — strong start',
                'Q1 ${yCur} closed with 285 HCWs strengthened (71% of annual target) and steady reduction in monitored quality indicators. Train-the-trainer workshop in April marks the start of the sustainability phase.',
                ['progress']),
        ];
        await Storage.setItem(`surgdash_updates_${id}`, updates);

        return project;
    },

    async updateProject(projectId, updates) {
        const project = this.getProject(projectId);
        if (!project) return null;
        Object.assign(project, updates);
        // Stamp a local-edit time so the safe auto-pull can detect metadata-only edits
        // (registry fields live in projects.json, not the per-project data files).
        project.lastModified = new Date().toISOString();
        await this.saveRegistry();
        return project;
    },

    async deleteProject(projectId) {
        if (projectId === 'surghub') return false;
        this.registry = this.registry.filter(p => p.id !== projectId);
        await this.saveRegistry();
        await Storage.removeItem(`surgdash_kpi_${projectId}`);
        await Storage.removeItem(`surgdash_updates_${projectId}`);
        await Storage.removeItem(`surgdash_events_${projectId}`);
        await Storage.removeItem(`surgdash_targets_${projectId}`);
        await Storage.removeItem(`surgdash_kpi_comments_${projectId}`);
        await Storage.removeItem(`surgdash_kpi_log_${projectId}`);
        await Storage.removeItem(`surgdash_quality_data_${projectId}`);
        await Storage.removeItem(`surgdash_budget_${projectId}`);
        await Storage.removeItem(`surgdash_facilities_${projectId}`);
        return true;
    },

    // --- KPI Data ---

    async getKpiData(projectId) {
        return (await Storage.getItem(`surgdash_kpi_${projectId}`)) || [];
    },

    async saveKpiEntry(projectId, date, values) {
        const data = await this.getKpiData(projectId);
        const existing = data.find(d => d.date === date);
        if (existing) {
            existing.values = { ...existing.values, ...values };
        } else {
            data.push({ date, values });
        }
        data.sort((a, b) => a.date.localeCompare(b.date));
        await Storage.setItem(`surgdash_kpi_${projectId}`, data);
        return data;
    },

    async deleteKpiEntry(projectId, date) {
        let data = await this.getKpiData(projectId);
        data = data.filter(d => d.date !== date);
        await Storage.setItem(`surgdash_kpi_${projectId}`, data);
        return data;
    },

    // --- Narrative Updates ---

    async getUpdates(projectId) {
        const updates = (await Storage.getItem(`surgdash_updates_${projectId}`)) || [];
        // Backfill missing IDs + remove legacy free-text tags (we use categories now).
        let mutated = false;
        updates.forEach((u, i) => {
            if (!u.id) {
                u.id = 'u-' + Date.now().toString(36) + '-' + i + '-' + Math.random().toString(36).slice(2, 6);
                mutated = true;
            }
            // Strip legacy tags — categories live on the unified event records now.
            if (u.tags !== undefined) { delete u.tags; mutated = true; }
        });
        if (mutated) {
            await Storage.setItem(`surgdash_updates_${projectId}`, updates);
        }
        return updates;
    },

    async saveUpdate(projectId, { id, date, title, body, tags, link }) {
        const updates = await this.getUpdates(projectId);
        const updateId = id || 'u-' + Date.now().toString(36);
        const existing = updates.find(u => u.id === updateId);
        if (existing) {
            Object.assign(existing, { date, title, body, tags, link: link || '' });
        } else {
            updates.push({ id: updateId, date, title, body, tags: tags || [], link: link || '' });
        }
        updates.sort((a, b) => b.date.localeCompare(a.date));
        await Storage.setItem(`surgdash_updates_${projectId}`, updates);
        return updates;
    },

    async deleteUpdate(projectId, updateId) {
        let updates = await this.getUpdates(projectId);
        updates = updates.filter(u => u.id !== updateId);
        await Storage.setItem(`surgdash_updates_${projectId}`, updates);
        return updates;
    },

    async replaceUpdates(projectId, updates) {
        await Storage.setItem(`surgdash_updates_${projectId}`, updates);
        return updates;
    },

    // --- Events (event-based KPI data entry) ---

    async getEvents(projectId) {
        const events = (await Storage.getItem(`surgdash_events_${projectId}`)) || [];
        // Backfill missing IDs (legacy data or entries without IDs)
        // ALSO migrate legacy event types (workshop/mentoring → training_mentoring, other → other_update)
        let mutated = false;
        const legacyTypeMap = {
            workshop:  'training_mentoring',
            mentoring: 'training_mentoring',
            other:     'other_update',
            // Older "facility/patients/estimate" subtypes from very early data — fold into other_update
            facility:  'other_update',
            patients:  'other_update',
            estimate:  'other_update',
        };
        events.forEach((e, i) => {
            if (!e.id) {
                e.id = 'ev-' + Date.now().toString(36) + '-' + i + '-' + Math.random().toString(36).slice(2, 6);
                mutated = true;
            }
            // Migrate legacy event types to the new canonical set
            if (e.type && legacyTypeMap[e.type]) {
                e.type = legacyTypeMap[e.type];
                mutated = true;
            }
        });
        if (mutated) {
            await Storage.setItem(`surgdash_events_${projectId}`, events);
        }
        return events;
    },

    async saveEvent(projectId, eventData) {
        const events = await this.getEvents(projectId);
        const eventId = eventData.id || 'ev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
        const idx = events.findIndex(e => e.id === eventId);
        const record = { ...eventData, id: eventId };
        if (idx >= 0) { events[idx] = record; } else { events.push(record); }
        events.sort((a, b) => b.date.localeCompare(a.date));
        await Storage.setItem(`surgdash_events_${projectId}`, events);
        return events;
    },

    async deleteEvent(projectId, eventId) {
        let events = await this.getEvents(projectId);
        events = events.filter(e => e.id !== eventId);
        await Storage.setItem(`surgdash_events_${projectId}`, events);
        return events;
    },

    async replaceEvents(projectId, events) {
        await Storage.setItem(`surgdash_events_${projectId}`, events);
        return events;
    },

    // --- Yearly Targets ---

    async getTargets(projectId) {
        return (await Storage.getItem(`surgdash_targets_${projectId}`)) || [];
    },

    async saveTargets(projectId, year, kpiTargets) {
        const targets = await this.getTargets(projectId);
        const existing = targets.find(t => t.year === year);
        if (existing) { existing.kpis = { ...kpiTargets }; }
        else { targets.push({ year, kpis: { ...kpiTargets } }); }
        await Storage.setItem(`surgdash_targets_${projectId}`, targets);
        return targets;
    },

    getTargetsForYear(allTargets, year) {
        return (allTargets.find(t => t.year === year) || {}).kpis || {};
    },

    // --- Yearly Actuals (manually entered) ---

    async getActuals(projectId) {
        return (await Storage.getItem(`surgdash_actuals_${projectId}`)) || [];
    },

    async saveActuals(projectId, year, kpiActuals) {
        const actuals = await this.getActuals(projectId);
        const existing = actuals.find(a => a.year === year);
        if (existing) { existing.kpis = { ...kpiActuals }; }
        else { actuals.push({ year, kpis: { ...kpiActuals } }); }
        await Storage.setItem(`surgdash_actuals_${projectId}`, actuals);
        return actuals;
    },

    getActualsForYear(allActuals, year) {
        return (allActuals.find(a => a.year === year) || {}).kpis || {};
    },

    // All-time roll-up across years for ONE project's actuals (or targets) rows
    // — an array of { year, kpis }. Stock KPIs (kpi.stock) take the MAX across
    // years (the same catchment/facilities persist, so summing would multiply the
    // same reach by the number of years); flow KPIs (HCW, patients) sum. Pass a
    // Set of years to exclude (e.g. App._chartHiddenYears). This mirrors the web
    // export's _isStock rule so the in-app Org Overview and the exports agree.
    rollupAllYears(rows, hiddenYears) {
        const out = {};
        this.STANDARD_KPIS.forEach(kpi => { out[kpi.id] = 0; });
        (rows || []).forEach(yr => {
            if (hiddenYears && hiddenYears.has(yr.year)) return;
            const k = yr.kpis || {};
            this.STANDARD_KPIS.forEach(kpi => {
                const v = k[kpi.id] || 0;
                if (kpi.stock) { if (v > out[kpi.id]) out[kpi.id] = v; }
                else { out[kpi.id] += v; }
            });
        });
        return out;
    },

    // ── Budget (per-year allocated + spent) ──────────────────────────
    async getBudget(projectId) {
        return (await Storage.getItem(`surgdash_budget_${projectId}`)) || [];
    },

    // Replace the full year row
    async saveBudgetYear(projectId, year, { allocated, spent, notes }) {
        const all = await this.getBudget(projectId);
        let entry = all.find(b => b.year === year);
        if (!entry) { entry = { year }; all.push(entry); }
        if (allocated !== undefined) entry.allocated = (allocated === null || allocated === '') ? null : Number(allocated);
        if (spent !== undefined)     entry.spent     = (spent === null || spent === '') ? null : Number(spent);
        if (notes !== undefined)     entry.notes     = notes || '';
        all.sort((a, b) => a.year - b.year);
        await Storage.setItem(`surgdash_budget_${projectId}`, all);
        return all;
    },

    // Atomic single-cell save for the budget matrix view.
    // Currently only 'allocated' is exposed in the UI; 'spent' is kept on the
    // method signature for backward-compat with older stored data but not edited.
    async saveOneBudgetField(projectId, year, kind, rawValue) {
        if (kind !== 'allocated' && kind !== 'spent') return false;
        const all = await this.getBudget(projectId);
        let entry = all.find(b => b.year === year);
        if (!entry) { entry = { year, allocated: null }; all.push(entry); }
        const v = (rawValue === '' || rawValue === null || rawValue === undefined) ? null : parseFloat(rawValue);
        if (v !== null && (isNaN(v) || v < 0)) return false;
        entry[kind] = v;
        all.sort((a, b) => a.year - b.year);
        await Storage.setItem(`surgdash_budget_${projectId}`, all);
        return true;
    },

    // ── Pending submissions (colleague-submitted changes awaiting admin review) ──
    async getPendingSubmissions() {
        return (await Storage.getItem('surgdash_pending_submissions')) || [];
    },

    async addPendingSubmission(submission) {
        const list = await this.getPendingSubmissions();
        const id = submission.id || 'sub-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
        const record = {
            id,
            status: 'pending',
            receivedAt: new Date().toISOString(),
            ...submission,
        };
        list.unshift(record);
        await Storage.setItem('surgdash_pending_submissions', list);
        return record;
    },

    async updateSubmission(submissionId, patch) {
        const list = await this.getPendingSubmissions();
        const idx = list.findIndex(s => s.id === submissionId);
        if (idx < 0) return null;
        list[idx] = { ...list[idx], ...patch };
        await Storage.setItem('surgdash_pending_submissions', list);
        return list[idx];
    },

    async deleteSubmission(submissionId) {
        const list = await this.getPendingSubmissions();
        const filtered = list.filter(s => s.id !== submissionId);
        await Storage.setItem('surgdash_pending_submissions', filtered);
        return filtered;
    },

    // Apply a single change from a submission. Used by the review UI when admin clicks Approve.
    // Returns { ok: boolean, error?: string }
    async applySubmissionChange(projectId, change) {
        try {
            if (change.type === 'kpi') {
                // Core-KPI actuals are now cumulative per quarter; targets stay annual.
                if (change.field === 'actual' && change.quarter) {
                    const ok = await this.saveOneKpiQuarter(projectId, change.year, change.quarter, change.kpiId, change.new);
                    return { ok };
                }
                const ok = await this.saveOneKpi(projectId, change.year, change.kpiId, change.field, change.new);
                return { ok };
            }
            if (change.type === 'kpiComment') {
                // Per-quarter comment on a core-KPI actual cell.
                await this.saveKpiQuarterComment(projectId, change.kpiId, change.year, change.quarter, change.new);
                return { ok: true };
            }
            if (change.type === 'baseline') {
                const ok = await this.saveQualityBaseline(projectId, change.kpiId, change.new);
                return { ok };
            }
            if (change.type === 'quality') {
                const ok = await this.saveOneQualityField(projectId, change.kpiId, change.year, change.quarter, change.field, change.new);
                return { ok };
            }
            if (change.type === 'budget') {
                const ok = await this.saveOneBudgetField(projectId, change.year, change.field, change.new);
                return { ok };
            }
            if (change.type === 'event') {
                if (!change.event || !change.event.title || !change.event.date) {
                    return { ok: false, error: 'Event missing title or date' };
                }
                await this.saveEvent(projectId, change.event);
                return { ok: true };
            }
            return { ok: false, error: 'Unknown change type: ' + change.type };
        } catch (e) {
            return { ok: false, error: e.message || String(e) };
        }
    },

    // ── Per-metric calculation breakdown (for the click-through verification modal) ──
    // Returns a fully-traced object: title, definition, formula in text, inputs with sources,
    // year-by-year worked example with full arithmetic, constants, caveats, and citations.
    // Designed so a funder or evaluator can reproduce every number by hand.
    computeMetricBreakdown(project, allBudget, allActuals, qualityData, year, metricKey) {
        // Resolve baselines: prefer project.qualityBaselines (per-KPI, single source of truth),
        // fall back to legacy project.impactAssumptions.baseline* for older data.
        const _ia = project.impactAssumptions || {};
        const qb  = project.qualityBaselines  || {};
        const pick = (kpiId, legacy) => (qb[kpiId] !== undefined && qb[kpiId] !== null) ? qb[kpiId] : _ia[legacy];
        const ia = Object.assign({}, _ia, {
            baselineMMR: pick('mmr',      'baselineMMR'),
            baselineNMR: pick('nmr',      'baselineNMR'),
            baselineSSI: pick('ssi_rate', 'baselineSSI'),
            baselineSSC: pick('ssc_util', 'baselineSSC'),
        });
        const C = this.ECONOMIC_CONSTANTS;
        const currency = project.currency || 'USD';

        // Collect all years that have any data, sorted ascending
        const allYearsSet = new Set();
        (allActuals || []).forEach(a => allYearsSet.add(a.year));
        (qualityData || []).forEach(q => allYearsSet.add(q.year));
        const targetYears = (year && year !== 'all')
            ? [year].filter(y => allYearsSet.has(y) || true)
            : Array.from(allYearsSet).sort();

        // Average actual rate for a quality KPI in a year (across reported quarters)
        const yearAvg = (kpiId, y) => {
            const entries = (qualityData || []).filter(d =>
                d.kpiId === kpiId && d.year === y && d.actual !== null && d.actual !== undefined);
            if (entries.length === 0) return { value: null, quarters: [] };
            const total = entries.reduce((s, e) => s + Number(e.actual), 0);
            return {
                value: total / entries.length,
                quarters: entries.map(e => ({ q: e.quarter, actual: Number(e.actual) }))
            };
        };

        const fmt = (n, d) => n === null || n === undefined ? '—' : Number(n).toFixed(d !== undefined ? d : 2);
        const fmtN = (n) => n === null || n === undefined || !isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US');
        const fmtM = (n) => {
            if (n === null || n === undefined || !isFinite(n)) return '—';
            const r = Math.round(n);
            if (r >= 1000000) return (r / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
            if (r >= 10000)   return (r / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
            return r.toLocaleString('en-US');
        };

        // ── Helpers for the four "death" calculations (used by aggregates too) ──
        const maternalStep = (y) => {
            const cur = yearAvg('mmr', y);
            if (cur.value === null || !ia.baselineMMR || !ia.annualLiveBirths) return null;
            const delta = Math.max(0, Number(ia.baselineMMR) - cur.value);
            const result = delta / 100000 * Number(ia.annualLiveBirths);
            return {
                year: y, sources: cur.quarters, current: cur.value, delta,
                calc: `(${ia.baselineMMR} − ${fmt(cur.value, 1)}) ÷ 100,000 × ${ia.annualLiveBirths}`,
                result, unit: 'deaths'
            };
        };
        const neonatalStep = (y) => {
            const cur = yearAvg('nmr', y);
            if (cur.value === null || !ia.baselineNMR || !ia.annualLiveBirths) return null;
            const delta = Math.max(0, Number(ia.baselineNMR) - cur.value);
            const result = delta / 1000 * Number(ia.annualLiveBirths);
            return {
                year: y, sources: cur.quarters, current: cur.value, delta,
                calc: `(${ia.baselineNMR} − ${fmt(cur.value, 2)}) ÷ 1,000 × ${ia.annualLiveBirths}`,
                result, unit: 'deaths'
            };
        };
        const ssiStep = (y) => {
            const cur = yearAvg('ssi_rate', y);
            if (cur.value === null || !ia.baselineSSI || !ia.annualSurgicalVolume) return null;
            const delta = Math.max(0, (Number(ia.baselineSSI) - cur.value) / 100);
            const ssis = delta * Number(ia.annualSurgicalVolume);
            return {
                year: y, sources: cur.quarters, current: cur.value, deltaPct: Math.max(0, Number(ia.baselineSSI) - cur.value),
                calc: `(${ia.baselineSSI}% − ${fmt(cur.value, 1)}%) × ${ia.annualSurgicalVolume}`,
                result: ssis, unit: 'SSIs'
            };
        };
        const sscStep = (y) => {
            const cur = yearAvg('ssc_util', y);
            if (cur.value === null || ia.baselineSSC === null || ia.baselineSSC === undefined || !ia.annualSurgicalVolume) return null;
            const adopt = Math.max(0, (cur.value - Number(ia.baselineSSC)) / 100);
            const result = Number(ia.annualSurgicalVolume) * C.SURGICAL_BASELINE_MORTALITY * C.SSC_EFFECT_SIZE * adopt;
            return {
                year: y, sources: cur.quarters, current: cur.value, deltaPct: Math.max(0, cur.value - Number(ia.baselineSSC)),
                calc: `${ia.annualSurgicalVolume} × 1.5% × 47% × ${(adopt * 100).toFixed(0)}%`,
                result, unit: 'deaths'
            };
        };

        // ──────── METRIC-SPECIFIC BREAKDOWNS ────────
        switch (metricKey) {

            case 'maternal': {
                const steps = targetYears.map(maternalStep).filter(Boolean);
                const total = steps.reduce((s, x) => s + x.result, 0);
                return {
                    key: metricKey,
                    title: 'Maternal Deaths Averted',
                    definition: 'Estimated number of maternal deaths prevented by reducing maternal mortality (MMR) at supported facilities, computed year by year.',
                    formulaText: 'deaths_y = (baseline_MMR − MMR_actual_y) ÷ 100,000 × annual_live_births',
                    totalFormula: 'Total = Σ deaths_y across project years',
                    inputs: [
                        { name: 'baseline_MMR', value: ia.baselineMMR, unit: 'per 100,000 live births', source: 'Data Entry → Quality Indicators (Baseline)' },
                        { name: 'annual_live_births', value: ia.annualLiveBirths, unit: 'births / year', source: 'Project Settings → Impact Assumptions' },
                        { name: 'MMR_actual_y', value: 'per-year average of quarterly actuals', unit: 'per 100,000', source: 'Quality Indicators (Data Entry)' },
                    ],
                    steps, total, totalUnit: 'maternal deaths averted',
                    constants: [],
                    caveats: [
                        'Assumes 100% of MMR improvement is attributable to the project — secular trends and parallel interventions also contribute in reality.',
                        'Excludes severe maternal morbidity (the iceberg below mortality).',
                        'Excludes downstream effects on dependents (orphan effect, household income loss).',
                    ],
                    citations: [
                        'WHO Global Burden of Disease — disability weights and DALY methodology',
                        'Lancet Commission on Global Surgery (Meara et al., 2015)',
                    ],
                    methodologyAnchor: 'econ-mmr',
                };
            }

            case 'neonatal': {
                const steps = targetYears.map(neonatalStep).filter(Boolean);
                const total = steps.reduce((s, x) => s + x.result, 0);
                return {
                    key: metricKey,
                    title: 'Neonatal Deaths Averted',
                    definition: 'Estimated neonatal deaths prevented by reducing neonatal mortality (NMR). This is typically the highest-leverage indicator because each neonatal death loses nearly a full life expectancy.',
                    formulaText: 'deaths_y = (baseline_NMR − NMR_actual_y) ÷ 1,000 × annual_live_births',
                    totalFormula: 'Total = Σ deaths_y across project years',
                    inputs: [
                        { name: 'baseline_NMR', value: ia.baselineNMR, unit: 'per 1,000 live births', source: 'Data Entry → Quality Indicators (Baseline)' },
                        { name: 'annual_live_births', value: ia.annualLiveBirths, unit: 'births / year', source: 'Project Settings → Impact Assumptions' },
                        { name: 'NMR_actual_y', value: 'per-year average of quarterly actuals', unit: 'per 1,000', source: 'Quality Indicators (Data Entry)' },
                    ],
                    steps, total, totalUnit: 'neonatal deaths averted',
                    constants: [],
                    caveats: [
                        'Assumes 100% attribution to the project.',
                        'Excludes long-term morbidity in survivors (e.g. cerebral palsy from birth asphyxia).',
                    ],
                    citations: [
                        'WHO Global Burden of Disease (latest update)',
                        'Lancet Commission on Global Surgery',
                    ],
                    methodologyAnchor: 'econ-nmr',
                };
            }

            case 'ssis_averted': {
                const steps = targetYears.map(ssiStep).filter(Boolean);
                const total = steps.reduce((s, x) => s + x.result, 0);
                return {
                    key: metricKey,
                    title: 'SSIs Averted',
                    definition: 'Estimated surgical site infections prevented by reducing the SSI rate at supported facilities.',
                    formulaText: 'SSIs_y = (baseline_SSI% − SSI_actual_y%) × surgical_volume',
                    totalFormula: 'Total SSIs averted = Σ SSIs_y',
                    inputs: [
                        { name: 'baseline_SSI', value: ia.baselineSSI, unit: '% of surgeries', source: 'Data Entry → Quality Indicators (Baseline)' },
                        { name: 'annual_surgical_volume', value: ia.annualSurgicalVolume, unit: 'surgeries / year', source: 'Project Settings → Impact Assumptions' },
                        { name: 'SSI_actual_y', value: 'per-year average of quarterly actuals', unit: '%', source: 'Quality Indicators (Data Entry)' },
                    ],
                    steps, total, totalUnit: 'SSIs averted',
                    constants: [],
                    caveats: [
                        'Assumes 100% of the SSI reduction is attributable to the project.',
                        'Surgical volume is treated as flat across years; in practice it may grow with project scale-up.',
                    ],
                    citations: [
                        'Allegranzi B, et al. (2011). <em>Burden of endemic health-care-associated infection in developing countries.</em> Lancet 377:228-41.',
                        'CDC / ECDC — SSI surveillance methodology.',
                    ],
                    methodologyAnchor: 'econ-ssi',
                };
            }

            case 'ssi_deaths': {
                const steps = targetYears.map(ssiStep).filter(Boolean).map(s => ({
                    ...s,
                    calc: `${fmt(s.result, 1)} SSIs × ${(C.SSI_CASE_FATALITY * 100).toFixed(0)}% case-fatality`,
                    result: s.result * C.SSI_CASE_FATALITY,
                    unit: 'deaths',
                }));
                const total = steps.reduce((s, x) => s + x.result, 0);
                return {
                    key: metricKey,
                    title: 'SSI Deaths Averted',
                    definition: 'Estimated deaths prevented from reducing surgical site infections, applying a published case-fatality rate to the SSIs averted.',
                    formulaText: 'SSI_deaths_y = SSIs_averted_y × case_fatality_rate',
                    totalFormula: 'Total = Σ SSI_deaths_y',
                    inputs: [
                        { name: 'SSIs_averted_y', value: 'computed per year — see "SSIs Averted" card', unit: 'SSIs', source: 'Derived' },
                    ],
                    steps, total, totalUnit: 'deaths averted from SSI reduction',
                    constants: [
                        { name: 'case_fatality_rate', value: (C.SSI_CASE_FATALITY * 100).toFixed(0) + '%', source: 'Midpoint of 3–11% range reported in LMIC SSI studies (Allegranzi et al., 2011)' },
                    ],
                    caveats: [
                        'Case-fatality rate is the midpoint of a wide published range; sensitivity at the 3% / 11% bounds yields ~40% / ~120% of the central estimate.',
                    ],
                    citations: [
                        'Allegranzi B, et al. (2011). Lancet 377:228-41.',
                    ],
                    methodologyAnchor: 'econ-ssi',
                };
            }

            case 'ssc_deaths': {
                const steps = targetYears.map(sscStep).filter(Boolean);
                const total = steps.reduce((s, x) => s + x.result, 0);
                return {
                    key: metricKey,
                    title: 'SSC-Attributable Deaths Averted',
                    definition: 'Deaths prevented by adoption of the WHO Surgical Safety Checklist, attributed proportionally to the percentage-point increase in adoption.',
                    formulaText: 'SSC_deaths_y = surgical_volume × baseline_mortality × Haynes_effect × adoption_delta_y',
                    totalFormula: 'Total = Σ SSC_deaths_y',
                    inputs: [
                        { name: 'baseline_SSC', value: ia.baselineSSC, unit: '% adoption', source: 'Data Entry → Quality Indicators (Baseline)' },
                        { name: 'annual_surgical_volume', value: ia.annualSurgicalVolume, unit: 'surgeries / year', source: 'Project Settings → Impact Assumptions' },
                        { name: 'SSC_actual_y', value: 'per-year average of quarterly actuals', unit: '%', source: 'Quality Indicators (Data Entry)' },
                    ],
                    steps, total, totalUnit: 'deaths averted from SSC adoption',
                    constants: [
                        { name: 'baseline_surgical_mortality', value: (C.SURGICAL_BASELINE_MORTALITY * 100) + '%', source: 'Haynes 2009 control-arm baseline (1.5% in-hospital surgical mortality)' },
                        { name: 'Haynes_effect_size', value: (C.SSC_EFFECT_SIZE * 100) + '%', source: 'Haynes AB et al. (2009), N Engl J Med 360:491-9 — 47% relative reduction at full adoption' },
                    ],
                    caveats: [
                        'Effect attribution is linear with adoption — at 50% adoption increase, we credit 50% of the Haynes effect. The original trial measured full adoption only.',
                        'Real-world effect sizes vary by setting and SSC implementation quality.',
                    ],
                    citations: [
                        'Haynes AB, et al. (2009). <em>A surgical safety checklist to reduce morbidity and mortality in a global population.</em> N Engl J Med 360:491-9.',
                    ],
                    methodologyAnchor: 'econ-ssc',
                };
            }

            case 'care_cost_avoided': {
                const steps = targetYears.map(ssiStep).filter(Boolean).map(s => ({
                    ...s,
                    calc: `${fmt(s.result, 1)} SSIs × ${currency} ${C.SSI_COST_PER_CASE.toLocaleString()}`,
                    result: s.result * C.SSI_COST_PER_CASE,
                    unit: currency,
                }));
                const total = steps.reduce((s, x) => s + x.result, 0);
                return {
                    key: metricKey,
                    title: 'Care Cost Avoided',
                    definition: 'Estimated hospital treatment costs avoided by preventing SSIs, applying a per-case cost coefficient from the Lancet meta-analysis.',
                    formulaText: 'cost_avoided_y = SSIs_averted_y × cost_per_SSI',
                    totalFormula: 'Total = Σ cost_avoided_y',
                    inputs: [
                        { name: 'SSIs_averted_y', value: 'computed per year — see "SSIs Averted" card', unit: 'SSIs', source: 'Derived' },
                    ],
                    steps, total, totalUnit: currency + ' avoided',
                    constants: [
                        { name: 'cost_per_SSI', value: currency + ' ' + C.SSI_COST_PER_CASE.toLocaleString(), source: 'LMIC midpoint of $800-$3,000 range (Allegranzi et al., 2011, Lancet)' },
                    ],
                    caveats: [
                        'Per-case cost is the midpoint of a wide range. Tertiary settings cost more; primary settings less.',
                        'Excludes patient out-of-pocket costs and lost productivity from extended stay.',
                    ],
                    citations: [
                        'Allegranzi B, et al. (2011). Lancet 377:228-41.',
                    ],
                    methodologyAnchor: 'econ-ssi',
                };
            }

            case 'bed_days_saved': {
                const steps = targetYears.map(ssiStep).filter(Boolean).map(s => ({
                    ...s,
                    calc: `${fmt(s.result, 1)} SSIs × ${C.SSI_EXTRA_LOS_DAYS} days extra LOS`,
                    result: s.result * C.SSI_EXTRA_LOS_DAYS,
                    unit: 'bed-days',
                }));
                const total = steps.reduce((s, x) => s + x.result, 0);
                return {
                    key: metricKey,
                    title: 'Bed-Days Saved',
                    definition: 'Hospital bed-days freed up by preventing the extended length-of-stay associated with each SSI.',
                    formulaText: 'bed_days_y = SSIs_averted_y × extra_LOS_per_SSI',
                    totalFormula: 'Total = Σ bed_days_y',
                    inputs: [
                        { name: 'SSIs_averted_y', value: 'computed per year — see "SSIs Averted" card', unit: 'SSIs', source: 'Derived' },
                    ],
                    steps, total, totalUnit: 'bed-days',
                    constants: [
                        { name: 'extra_LOS_per_SSI', value: C.SSI_EXTRA_LOS_DAYS + ' days', source: 'CDC NHSN / ECDC HAI surveillance — typical extra LOS for SSI' },
                    ],
                    caveats: [
                        'Length-of-stay varies by SSI type (superficial vs deep / organ-space). 8 days is a midpoint estimate.',
                    ],
                    citations: [
                        'CDC National Healthcare Safety Network — SSI surveillance.',
                        'ECDC HAI point-prevalence survey.',
                    ],
                    methodologyAnchor: 'econ-ssi',
                };
            }

            case 'dalys': {
                // Aggregate of all four death types × DALY weight
                const mat = targetYears.map(maternalStep).filter(Boolean).reduce((s, x) => s + x.result, 0);
                const neo = targetYears.map(neonatalStep).filter(Boolean).reduce((s, x) => s + x.result, 0);
                const ssi = targetYears.map(ssiStep).filter(Boolean).reduce((s, x) => s + x.result, 0) * C.SSI_CASE_FATALITY;
                const ssc = targetYears.map(sscStep).filter(Boolean).reduce((s, x) => s + x.result, 0);
                const components = [
                    { label: 'Maternal deaths', count: mat, weight: C.MATERNAL_DALY_PER_DEATH, contrib: mat * C.MATERNAL_DALY_PER_DEATH },
                    { label: 'Neonatal deaths', count: neo, weight: C.NEONATAL_DALY_PER_DEATH, contrib: neo * C.NEONATAL_DALY_PER_DEATH },
                    { label: 'SSI deaths',      count: ssi, weight: C.SURGICAL_DALY_PER_DEATH, contrib: ssi * C.SURGICAL_DALY_PER_DEATH },
                    { label: 'SSC deaths',      count: ssc, weight: C.SURGICAL_DALY_PER_DEATH, contrib: ssc * C.SURGICAL_DALY_PER_DEATH },
                ];
                const total = components.reduce((s, c) => s + c.contrib, 0);
                return {
                    key: metricKey,
                    title: 'DALYs Averted',
                    definition: 'Disability-Adjusted Life-Years saved — one year of healthy life preserved per DALY. Each death-type carries a different DALY weight reflecting the typical years of life lost.',
                    formulaText: 'DALYs = Σ (deaths_of_type × DALY_weight_for_type)',
                    inputs: [
                        { name: 'deaths_averted per type', value: 'computed per type — see individual cards', unit: 'deaths', source: 'Derived' },
                    ],
                    components, total, totalUnit: 'DALYs',
                    constants: [
                        { name: 'maternal_DALY_weight', value: C.MATERNAL_DALY_PER_DEATH + ' YLL', source: 'WHO Global Burden of Disease — peri-natal-age women' },
                        { name: 'neonatal_DALY_weight', value: C.NEONATAL_DALY_PER_DEATH + ' YLL', source: 'WHO GBD — newborns lose nearly full life expectancy' },
                        { name: 'surgical_DALY_weight', value: C.SURGICAL_DALY_PER_DEATH + ' YLL', source: 'WHO GBD — average surgical patient' },
                    ],
                    caveats: [
                        'YLL (Years of Life Lost) only — Years Lived with Disability (YLD) for severe morbidity is excluded.',
                        'Uses WHO standard life expectancy table, not country-specific life tables.',
                    ],
                    citations: [
                        'WHO Global Burden of Disease — DALY methodology.',
                    ],
                    methodologyAnchor: 'econ-aggregation',
                };
            }

            case 'economic_value': {
                // Compute total DALYs first
                const mat = targetYears.map(maternalStep).filter(Boolean).reduce((s, x) => s + x.result, 0);
                const neo = targetYears.map(neonatalStep).filter(Boolean).reduce((s, x) => s + x.result, 0);
                const ssi = targetYears.map(ssiStep).filter(Boolean).reduce((s, x) => s + x.result, 0) * C.SSI_CASE_FATALITY;
                const ssc = targetYears.map(sscStep).filter(Boolean).reduce((s, x) => s + x.result, 0);
                const totalDalys = mat * C.MATERNAL_DALY_PER_DEATH + neo * C.NEONATAL_DALY_PER_DEATH + ssi * C.SURGICAL_DALY_PER_DEATH + ssc * C.SURGICAL_DALY_PER_DEATH;
                const gdp = Number(ia.gdpPerCapita) || 0;
                const total = totalDalys * gdp;
                return {
                    key: metricKey,
                    title: 'Economic Value',
                    definition: 'Monetised health gain — each DALY averted valued at the country\'s GDP per capita (WHO-CHOICE methodology).',
                    formulaText: 'Economic_value = DALYs_averted × GDP_per_capita',
                    inputs: [
                        { name: 'DALYs_averted', value: fmt(totalDalys, 0), unit: 'DALYs', source: 'Derived — see DALYs Averted card' },
                        { name: 'GDP_per_capita', value: ia.gdpPerCapita ? currency + ' ' + Number(ia.gdpPerCapita).toLocaleString() : 'not set', unit: '/ year / person', source: 'Project Settings → Impact Assumptions (World Bank)' },
                    ],
                    singleStep: { calc: `${fmt(totalDalys, 0)} DALYs × ${currency} ${Number(gdp).toLocaleString()}`, result: total },
                    total, totalUnit: currency,
                    constants: [],
                    caveats: [
                        'WHO-CHOICE uses GDP per capita as the human-capital reference value for monetising health gain. Alternatives (statistical value of life, friction-cost) give different totals.',
                        'GDP-based valuation systematically undercounts impact in LICs.',
                    ],
                    citations: [
                        'WHO-CHOICE: cost-effectiveness threshold methodology.',
                        'Disease Control Priorities, 3rd ed. (DCP3), 2015.',
                    ],
                    methodologyAnchor: 'econ-aggregation',
                };
            }

            case 'cost_per_daly': {
                const budgetRows = (year && year !== 'all') ? (allBudget || []).filter(b => b.year === year) : (allBudget || []);
                const totalBudget = budgetRows.reduce((s, b) => s + (Number(b.allocated) || 0), 0);
                const mat = targetYears.map(maternalStep).filter(Boolean).reduce((s, x) => s + x.result, 0);
                const neo = targetYears.map(neonatalStep).filter(Boolean).reduce((s, x) => s + x.result, 0);
                const ssi = targetYears.map(ssiStep).filter(Boolean).reduce((s, x) => s + x.result, 0) * C.SSI_CASE_FATALITY;
                const ssc = targetYears.map(sscStep).filter(Boolean).reduce((s, x) => s + x.result, 0);
                const totalDalys = mat * C.MATERNAL_DALY_PER_DEATH + neo * C.NEONATAL_DALY_PER_DEATH + ssi * C.SURGICAL_DALY_PER_DEATH + ssc * C.SURGICAL_DALY_PER_DEATH;
                const gdp = Number(ia.gdpPerCapita) || 0;
                const threshold = gdp * C.WHO_THRESHOLD_MULTIPLIER;
                const total = totalDalys > 0 ? totalBudget / totalDalys : null;
                return {
                    key: metricKey,
                    title: 'Cost per DALY Averted',
                    definition: 'How many dollars of budget the project spends per Disability-Adjusted Life-Year saved. The WHO threshold for "highly cost-effective" is below 3× GDP per capita.',
                    formulaText: 'Cost_per_DALY = total_allocated_budget ÷ DALYs_averted',
                    inputs: [
                        { name: 'total_allocated_budget', value: currency + ' ' + Math.round(totalBudget).toLocaleString(), unit: '', source: 'Sum of yearly allocations — Data Entry → Budget' },
                        { name: 'DALYs_averted', value: fmt(totalDalys, 0), unit: 'DALYs', source: 'Derived — see DALYs Averted card' },
                    ],
                    singleStep: { calc: `${currency} ${Math.round(totalBudget).toLocaleString()} ÷ ${fmt(totalDalys, 0)} DALYs`, result: total },
                    total, totalUnit: currency + ' / DALY',
                    benchmark: {
                        label: 'WHO highly cost-effective threshold',
                        value: gdp > 0 ? currency + ' ' + Math.round(threshold).toLocaleString() + ' (= 3× ' + currency + ' ' + Number(gdp).toLocaleString() + ' GDP/cap)' : 'GDP per capita not set',
                        belowThreshold: total !== null && threshold > 0 && total < threshold
                    },
                    constants: [
                        { name: 'WHO_threshold_multiplier', value: '3× GDP per capita', source: 'WHO-CHOICE: highly cost-effective if < 1× GDP/cap, cost-effective if < 3× GDP/cap per DALY.' },
                    ],
                    caveats: [
                        'Cost-per-DALY is sensitive to all the upstream estimates (baselines, volumes, DALY weights). Treat as an order-of-magnitude estimate, not a precise number.',
                        'Allocated budget is used (not actual spend) — a project under-spending will look more cost-effective than it actually is.',
                    ],
                    citations: [
                        'WHO-CHOICE — cost-effectiveness thresholds.',
                        'DCP3 — Disease Control Priorities (3rd ed.), World Bank.',
                    ],
                    methodologyAnchor: 'econ-aggregation',
                };
            }

            case 'roi': {
                const budgetRows = (year && year !== 'all') ? (allBudget || []).filter(b => b.year === year) : (allBudget || []);
                const totalBudget = budgetRows.reduce((s, b) => s + (Number(b.allocated) || 0), 0);
                const mat = targetYears.map(maternalStep).filter(Boolean).reduce((s, x) => s + x.result, 0);
                const neo = targetYears.map(neonatalStep).filter(Boolean).reduce((s, x) => s + x.result, 0);
                const ssi = targetYears.map(ssiStep).filter(Boolean).reduce((s, x) => s + x.result, 0) * C.SSI_CASE_FATALITY;
                const ssc = targetYears.map(sscStep).filter(Boolean).reduce((s, x) => s + x.result, 0);
                const totalDalys = mat * C.MATERNAL_DALY_PER_DEATH + neo * C.NEONATAL_DALY_PER_DEATH + ssi * C.SURGICAL_DALY_PER_DEATH + ssc * C.SURGICAL_DALY_PER_DEATH;
                const gdp = Number(ia.gdpPerCapita) || 0;
                const economicValue = totalDalys * gdp;
                const total = totalBudget > 0 ? economicValue / totalBudget : null;
                return {
                    key: metricKey,
                    title: 'Estimated Return (×)',
                    definition: 'Economic value of the health gain divided by the allocated budget — answers "for every $1 of funding, how many dollars of human-capital value are generated?"',
                    formulaText: 'Return_× = Economic_value ÷ total_allocated_budget',
                    inputs: [
                        { name: 'Economic_value', value: currency + ' ' + Math.round(economicValue).toLocaleString(), unit: '', source: 'Derived — see Economic Value card' },
                        { name: 'total_allocated_budget', value: currency + ' ' + Math.round(totalBudget).toLocaleString(), unit: '', source: 'Data Entry → Budget' },
                    ],
                    singleStep: { calc: `${currency} ${Math.round(economicValue).toLocaleString()} ÷ ${currency} ${Math.round(totalBudget).toLocaleString()}`, result: total },
                    total, totalUnit: '× return',
                    constants: [],
                    caveats: [
                        'Same caveats as Economic Value and Cost per DALY apply.',
                        'This is a health-economic return, not a financial return — the value is realised as years of healthy life, not as cash flow.',
                    ],
                    citations: ['WHO-CHOICE methodology.'],
                    methodologyAnchor: 'econ-aggregation',
                };
            }

            case 'budget': {
                const budgetRows = (year && year !== 'all') ? (allBudget || []).filter(b => b.year === year) : (allBudget || []);
                const steps = budgetRows.filter(b => b.allocated).map(b => ({
                    year: b.year, calc: currency + ' ' + Number(b.allocated).toLocaleString(),
                    result: Number(b.allocated), unit: currency
                }));
                const total = steps.reduce((s, x) => s + x.result, 0);
                return {
                    key: metricKey,
                    title: 'Allocated Budget',
                    definition: 'Total budget allocated to the project across the displayed period. Used as the denominator for cost-per-DALY and ROI.',
                    formulaText: 'Total_budget = Σ allocated_y',
                    inputs: [
                        { name: 'allocated_y', value: 'per-year amount from Budget matrix', unit: currency, source: 'Data Entry → Budget' },
                    ],
                    steps, total, totalUnit: currency,
                    constants: [],
                    caveats: [
                        'This is *allocated* budget — not actual spend. Under-spend means cost-effectiveness ratios are flattering.',
                    ],
                    citations: [],
                    methodologyAnchor: 'econ-aggregation',
                };
            }

            case 'hcw_lifetime': {
                let totalHcw = 0;
                const steps = [];
                targetYears.forEach(y => {
                    const ac = (allActuals || []).find(a => a.year === y);
                    if (ac && ac.kpis && ac.kpis.hcw_strengthened) {
                        const hcw = Number(ac.kpis.hcw_strengthened);
                        totalHcw += hcw;
                        steps.push({
                            year: y,
                            calc: `${hcw.toLocaleString()} HCWs × ${C.HCW_LIFETIME_ENCOUNTERS.toLocaleString()} lifetime encounters`,
                            result: hcw * C.HCW_LIFETIME_ENCOUNTERS,
                            unit: 'encounters'
                        });
                    }
                });
                const total = totalHcw * C.HCW_LIFETIME_ENCOUNTERS;
                return {
                    key: metricKey,
                    title: 'HCW Lifetime Patient Reach',
                    definition: 'Estimated future patient encounters from healthcare workers strengthened by the project, applied across their remaining careers.',
                    formulaText: 'Lifetime_reach = HCWs_strengthened × lifetime_patient_encounters_per_HCW',
                    inputs: [
                        { name: 'HCWs_strengthened', value: totalHcw.toLocaleString(), unit: 'HCWs', source: 'KPI Actuals (Data Entry → KPIs)' },
                    ],
                    steps, total, totalUnit: 'patient encounters',
                    constants: [
                        { name: 'lifetime_encounters_per_HCW', value: C.HCW_LIFETIME_ENCOUNTERS.toLocaleString(), source: '≈ 1,000 patients/year × 25-year career × 0.7 discount factor for network effects and attrition (WHO HRH methodology)' },
                    ],
                    caveats: [
                        'Conservative coefficient — varies by cadre (surgeons see fewer patients/year than nurses), career length, and attrition.',
                        'Does not credit "trainer multiplier" effects from HCWs training others (often cited as an additional 1.2× per year).',
                    ],
                    citations: [
                        'WHO Human Resources for Health — workforce-impact methodology.',
                    ],
                    methodologyAnchor: 'econ-hcw',
                };
            }

            case 'deaths_total': {
                const mat = targetYears.map(maternalStep).filter(Boolean).reduce((s, x) => s + x.result, 0);
                const neo = targetYears.map(neonatalStep).filter(Boolean).reduce((s, x) => s + x.result, 0);
                const ssi = targetYears.map(ssiStep).filter(Boolean).reduce((s, x) => s + x.result, 0) * C.SSI_CASE_FATALITY;
                const ssc = targetYears.map(sscStep).filter(Boolean).reduce((s, x) => s + x.result, 0);
                const components = [
                    { label: 'Maternal deaths averted', metricKey: 'maternal',   result: mat },
                    { label: 'Neonatal deaths averted', metricKey: 'neonatal',   result: neo },
                    { label: 'SSI deaths averted',      metricKey: 'ssi_deaths', result: ssi },
                    { label: 'SSC deaths averted',      metricKey: 'ssc_deaths', result: ssc },
                ];
                const total = components.reduce((s, c) => s + c.result, 0);
                return {
                    key: metricKey,
                    title: 'Total Deaths Averted',
                    definition: 'Sum of estimated deaths prevented across four pathways: maternal mortality, neonatal mortality, surgical site infection mortality, and surgical checklist adoption.',
                    formulaText: 'Total_deaths = maternal + neonatal + SSI_deaths + SSC_deaths',
                    inputs: [
                        { name: 'Each component', value: 'click "Open detail →" by each row below', unit: 'deaths', source: 'Derived from quality indicators' },
                    ],
                    components, total, totalUnit: 'deaths averted',
                    constants: [],
                    caveats: ['Each component has its own caveats and uncertainty — see individual cards.'],
                    citations: [],
                    methodologyAnchor: 'econ-aggregation',
                };
            }

            default: return null;
        }
    },

    // ── Economic Impact constants (DCP3, Lancet Commission on Global Surgery, Haynes 2009) ──
    ECONOMIC_CONSTANTS: {
        SSI_COST_PER_CASE: 1500,           // USD — LMIC midpoint (Allegranzi 2011, Lancet)
        SSI_EXTRA_LOS_DAYS: 8,             // Bed-days lost per SSI (CDC / ECDC)
        SSI_CASE_FATALITY: 0.05,           // 5% — midpoint of 3-11% range
        SURGICAL_DALY_PER_DEATH: 30,       // YLL for an average surgical patient
        MATERNAL_DALY_PER_DEATH: 32,       // YLL — WHO standard (peri-natal women)
        NEONATAL_DALY_PER_DEATH: 70,       // YLL — full life lost
        SSC_EFFECT_SIZE: 0.47,             // 47% relative mortality reduction at full SSC adoption (Haynes 2009, NEJM)
        SURGICAL_BASELINE_MORTALITY: 0.015,// 1.5% baseline in-hospital surgical mortality (Haynes baseline)
        HCW_LIFETIME_ENCOUNTERS: 17500,    // Patients seen by one HCW over 25-yr career (conservative)
        WHO_THRESHOLD_MULTIPLIER: 3,       // WHO highly cost-effective = below 3× GDP/cap per DALY
    },

    // Compute estimated economic impact from quality indicators + KPI actuals + budget.
    // All numbers are conservative point estimates; full method is in the Methodology view.
    // Returns null when essential inputs (baselines, volumes) are missing.
    computeEconomicImpact(project, allBudget, allActuals, qualityData, year) {
        const ia = project.impactAssumptions || {};
        const qb = project.qualityBaselines  || {};
        // Prefer per-KPI quality baselines; fall back to legacy impactAssumptions.baseline*
        const pick = (kpiId, legacy) => (qb[kpiId] !== undefined && qb[kpiId] !== null) ? qb[kpiId] : ia[legacy];
        const bSSI = Number(pick('ssi_rate', 'baselineSSI'));
        const bMMR = Number(pick('mmr',      'baselineMMR'));
        const bNMR = Number(pick('nmr',      'baselineNMR'));
        const bSSC = Number(pick('ssc_util', 'baselineSSC'));
        const surgicalVol = Number(ia.annualSurgicalVolume) || 0;
        const liveBirths  = Number(ia.annualLiveBirths) || 0;
        const gdp         = Number(ia.gdpPerCapita) || 0;

        const hasAnyInput = (bSSI > 0 || bMMR > 0 || bNMR > 0 || bSSC >= 0)
                          && (surgicalVol > 0 || liveBirths > 0);
        if (!hasAnyInput) return null;

        const C = this.ECONOMIC_CONSTANTS;

        // Which years count toward the total
        const allYearsSet = new Set();
        (allActuals || []).forEach(a => allYearsSet.add(a.year));
        (qualityData || []).forEach(q => allYearsSet.add(q.year));
        const targetYears = (year && year !== 'all')
            ? [year]
            : Array.from(allYearsSet).sort();

        // Average actual rate for an indicator in a given year (across reported quarters)
        const yearAvg = (kpiId, y) => {
            const entries = (qualityData || []).filter(d => d.kpiId === kpiId && d.year === y && d.actual !== null && d.actual !== undefined);
            if (entries.length === 0) return null;
            return entries.reduce((s, e) => s + Number(e.actual), 0) / entries.length;
        };

        let maternalDeathsAverted = 0;
        let neonatalDeathsAverted = 0;
        let ssisAverted = 0;
        let ssiDeathsAverted = 0;
        let sscDeathsAverted = 0;
        let bedDaysSaved = 0;
        let ssiCostSaved = 0;
        let hcwTrained = 0;

        targetYears.forEach(y => {
            // Maternal
            if (bMMR > 0 && liveBirths > 0) {
                const cur = yearAvg('mmr', y);
                if (cur !== null) maternalDeathsAverted += Math.max(0, bMMR - cur) / 100000 * liveBirths;
            }
            // Neonatal
            if (bNMR > 0 && liveBirths > 0) {
                const cur = yearAvg('nmr', y);
                if (cur !== null) neonatalDeathsAverted += Math.max(0, bNMR - cur) / 1000 * liveBirths;
            }
            // SSI
            if (bSSI > 0 && surgicalVol > 0) {
                const cur = yearAvg('ssi_rate', y);
                if (cur !== null) {
                    const ssisThisYear = Math.max(0, (bSSI - cur) / 100) * surgicalVol;
                    ssisAverted     += ssisThisYear;
                    ssiDeathsAverted += ssisThisYear * C.SSI_CASE_FATALITY;
                    bedDaysSaved     += ssisThisYear * C.SSI_EXTRA_LOS_DAYS;
                    ssiCostSaved     += ssisThisYear * C.SSI_COST_PER_CASE;
                }
            }
            // SSC (higher is better)
            if (bSSC >= 0 && surgicalVol > 0) {
                const cur = yearAvg('ssc_util', y);
                if (cur !== null) {
                    const deltaAdoption = Math.max(0, (cur - bSSC) / 100);
                    sscDeathsAverted += surgicalVol * C.SURGICAL_BASELINE_MORTALITY * C.SSC_EFFECT_SIZE * deltaAdoption;
                }
            }
            // HCWs trained this year (for lifetime-impact multiplier)
            const acRow = (allActuals || []).find(a => a.year === y);
            if (acRow && acRow.kpis) hcwTrained += Number(acRow.kpis.hcw_strengthened || 0);
        });

        const dalysAverted =
              maternalDeathsAverted * C.MATERNAL_DALY_PER_DEATH
            + neonatalDeathsAverted * C.NEONATAL_DALY_PER_DEATH
            + ssiDeathsAverted      * C.SURGICAL_DALY_PER_DEATH
            + sscDeathsAverted      * C.SURGICAL_DALY_PER_DEATH;

        const economicValue = dalysAverted * gdp;
        const hcwLifetimeEncounters = hcwTrained * C.HCW_LIFETIME_ENCOUNTERS;

        const budgetRows = (year && year !== 'all')
            ? (allBudget || []).filter(b => b.year === year)
            : (allBudget || []);
        const totalAllocated = budgetRows.reduce((s, b) => s + (Number(b.allocated) || 0), 0);

        const costPerDaly = dalysAverted > 0 ? totalAllocated / dalysAverted : null;
        const whoThreshold = gdp * C.WHO_THRESHOLD_MULTIPLIER;
        const belowWhoThreshold = costPerDaly !== null && whoThreshold > 0 && costPerDaly < whoThreshold;
        const roi = totalAllocated > 0 ? economicValue / totalAllocated : null;

        const totalDeathsAverted = maternalDeathsAverted + neonatalDeathsAverted + ssiDeathsAverted + sscDeathsAverted;

        return {
            maternalDeathsAverted, neonatalDeathsAverted,
            ssisAverted, ssiDeathsAverted, sscDeathsAverted,
            totalDeathsAverted,
            bedDaysSaved, ssiCostSaved,
            dalysAverted, economicValue,
            hcwTrained, hcwLifetimeEncounters,
            totalAllocated, costPerDaly, whoThreshold, belowWhoThreshold, roi,
            gdp, hasInputs: hasAnyInput
        };
    },

    // Cost-per-result aggregates based on ALLOCATED budget. Returns both:
    //   - actual cost-per-result (budget ÷ actuals achieved so far)
    //   - planned cost-per-result (budget ÷ target — what the project plans to spend per unit)
    // If year=null/'all', use full-period totals.
    computeCostEffectiveness(allBudget, allActuals, allTargets, year) {
        // Backward-compat: if caller passed (allBudget, allActuals, year) — old 3-arg signature.
        if (typeof allTargets === 'string' || typeof allTargets === 'number') {
            year = allTargets;
            allTargets = [];
        }
        const sumBy = (arr, field) => arr.reduce((s, r) => s + (Number(r[field]) || 0), 0);
        let budgetRows, actualsRows, targetsRows;
        if (year && year !== 'all') {
            budgetRows  = allBudget.filter(b => b.year === year);
            actualsRows = allActuals.filter(a => a.year === year);
            targetsRows = (allTargets || []).filter(t => t.year === year);
        } else {
            budgetRows = allBudget; actualsRows = allActuals; targetsRows = allTargets || [];
        }
        const totalAllocated = sumBy(budgetRows, 'allocated');

        const actualKpiTotals = {}, targetKpiTotals = {};
        this.STANDARD_KPIS.forEach(k => {
            actualKpiTotals[k.id] = actualsRows.reduce((s, r) => s + ((r.kpis || {})[k.id] || 0), 0);
            targetKpiTotals[k.id] = targetsRows.reduce((s, r) => s + ((r.kpis || {})[k.id] || 0), 0);
        });
        const actualCostPer = {}, targetCostPer = {};
        this.STANDARD_KPIS.forEach(k => {
            actualCostPer[k.id] = actualKpiTotals[k.id] > 0 ? totalAllocated / actualKpiTotals[k.id] : null;
            targetCostPer[k.id] = targetKpiTotals[k.id] > 0 ? totalAllocated / targetKpiTotals[k.id] : null;
        });
        return {
            totalAllocated,
            // Backward-compat fields (used to be actual-only)
            costPer:  actualCostPer,
            kpiTotals: actualKpiTotals,
            // New: explicit actual vs target split
            actualCostPer, actualKpiTotals,
            targetCostPer, targetKpiTotals,
        };
    },

    // Save a single KPI cell (one year × one indicator × target|actual).
    // Used by the matrix data-entry view so each blur is an atomic save.
    // Returns true on success, false on validation failure (caller should flag the cell).
    async saveOneKpi(projectId, year, kpiId, kind, rawValue) {
        const isTarget = kind === 'target';
        const key = isTarget ? `surgdash_targets_${projectId}` : `surgdash_actuals_${projectId}`;
        const all = isTarget ? await this.getTargets(projectId) : await this.getActuals(projectId);
        let entry = all.find(t => t.year === year);
        if (!entry) { entry = { year, kpis: {} }; all.push(entry); }
        const v = (rawValue === '' || rawValue === null || rawValue === undefined) ? null : parseFloat(rawValue);
        if (v !== null && (isNaN(v) || v < 0)) return false; // reject negatives/garbage
        if (v === null) { delete entry.kpis[kpiId]; }
        else            { entry.kpis[kpiId] = v; }
        await Storage.setItem(key, all);
        return true;
    },

    // Save a single quarterly actual (year × quarter × indicator).
    // Values are CUMULATIVE — Q2 includes Q1, Q4 = year total. The year total
    // (kpis[kpiId]) is set to the highest-numbered quarter with a non-null value.
    async saveOneKpiQuarter(projectId, year, quarter, kpiId, rawValue) {
        if (![1, 2, 3, 4].includes(Number(quarter))) return false;
        const key = `surgdash_actuals_${projectId}`;
        const all = await this.getActuals(projectId);
        let entry = all.find(t => t.year === year);
        if (!entry) { entry = { year, kpis: {} }; all.push(entry); }
        if (!entry.quarters) entry.quarters = {};
        if (!entry.quarters[quarter]) entry.quarters[quarter] = {};
        const v = (rawValue === '' || rawValue === null || rawValue === undefined) ? null : parseFloat(rawValue);
        if (v !== null && (isNaN(v) || v < 0)) return false;
        if (v === null) { delete entry.quarters[quarter][kpiId]; }
        else            { entry.quarters[quarter][kpiId] = v; }
        // Year total = latest-quarter cumulative value (cumulative semantics)
        let latest = null;
        [1, 2, 3, 4].forEach(q => {
            const qv = entry.quarters[q] && entry.quarters[q][kpiId];
            if (qv !== undefined && qv !== null && !isNaN(qv)) latest = Number(qv);
        });
        if (latest !== null) entry.kpis[kpiId] = latest;
        else                 delete entry.kpis[kpiId];
        await Storage.setItem(key, all);
        return true;
    },

    // Get the cumulative quarterly breakdown for a KPI in a given year, or null if no quarter data.
    // Returns {1, 2, 3, 4} with the stored cumulative value or null per quarter.
    getQuarterlyActuals(allActuals, year, kpiId) {
        const entry = allActuals.find(a => a.year === year);
        if (!entry || !entry.quarters) return null;
        const out = {};
        let any = false;
        [1, 2, 3, 4].forEach(q => {
            const v = entry.quarters[q] && entry.quarters[q][kpiId];
            if (v !== undefined && v !== null) { out[q] = v; any = true; }
            else                                { out[q] = null; }
        });
        return any ? out : null;
    },

    // --- Per-quarter KPI comments (one note per core-KPI actual cell) ---
    // Stored as a flat array: [{ kpiId, year, quarter, comment }]
    async getKpiQuarterComments(projectId) {
        return (await Storage.getItem(`surgdash_kpi_quarter_comments_${projectId}`)) || [];
    },

    kpiQuarterComment(arr, kpiId, year, quarter) {
        const e = (arr || []).find(c => c.kpiId === kpiId && c.year === year && c.quarter === quarter);
        return e ? (e.comment || '') : '';
    },

    async saveKpiQuarterComment(projectId, kpiId, year, quarter, comment) {
        const arr = await this.getKpiQuarterComments(projectId);
        const idx = arr.findIndex(c => c.kpiId === kpiId && c.year === year && c.quarter === quarter);
        const text = (comment === null || comment === undefined) ? '' : String(comment).trim();
        if (text === '') {
            if (idx >= 0) arr.splice(idx, 1);
        } else if (idx >= 0) {
            arr[idx].comment = text;
        } else {
            arr.push({ kpiId, year, quarter, comment: text });
        }
        await Storage.setItem(`surgdash_kpi_quarter_comments_${projectId}`, arr);
        return arr;
    },

    // --- KPI Comments (per year) ---

    async getKpiComments(projectId) {
        return (await Storage.getItem(`surgdash_kpi_comments_${projectId}`)) || [];
    },

    async saveKpiComments(projectId, year, targetComments, actualComments) {
        const data = await this.getKpiComments(projectId);
        const existing = data.find(d => d.year === year);
        if (existing) {
            existing.targetComments = { ...targetComments };
            existing.actualComments = { ...actualComments };
        } else {
            data.push({ year, targetComments: { ...targetComments }, actualComments: { ...actualComments } });
        }
        await Storage.setItem(`surgdash_kpi_comments_${projectId}`, data);
        return data;
    },

    getKpiCommentsForYear(allComments, year) {
        return allComments.find(d => d.year === year) || { targetComments: {}, actualComments: {} };
    },

    // --- Facilities (project setup list) ---

    async getFacilities(projectId) {
        return (await Storage.getItem(`surgdash_facilities_${projectId}`)) || [];
    },

    async saveFacility(projectId, facilityData) {
        const facilities = await this.getFacilities(projectId);
        const facId = facilityData.id || 'fac-' + Date.now().toString(36);
        const idx = facilities.findIndex(f => f.id === facId);
        const record = { ...facilityData, id: facId };
        if (idx >= 0) { facilities[idx] = record; } else { facilities.push(record); }
        await Storage.setItem(`surgdash_facilities_${projectId}`, facilities);
        return facilities;
    },

    async deleteFacility(projectId, facilityId) {
        let facilities = await this.getFacilities(projectId);
        facilities = facilities.filter(f => f.id !== facilityId);
        await Storage.setItem(`surgdash_facilities_${projectId}`, facilities);
        return facilities;
    },

    // Derive KPI targets from the facilities list + stored HCW target
    computeFacilityTargets(facilities, hcwTarget = 0) {
        return {
            hcw_strengthened:        hcwTarget,
            facilities_strengthened: facilities.length,
            population_access:       facilities.reduce((s, f) => s + (Number(f.catchmentPop)    || 0), 0),
            patients_reached:        facilities.reduce((s, f) => s + (Number(f.annualPatients)  || 0), 0)
        };
    },

    // --- KPI Entry Log ---

    async getKpiLog(projectId) {
        return (await Storage.getItem(`surgdash_kpi_log_${projectId}`)) || [];
    },

    async addKpiLogEntry(projectId, entry) {
        const log = await this.getKpiLog(projectId);
        log.unshift(entry); // newest first
        await Storage.setItem(`surgdash_kpi_log_${projectId}`, log);
        return log;
    },

    // --- Quality KPIs (quarterly) ---

    async getAllQualityKpis() {
        const custom = (await Storage.getItem('surgdash_custom_quality_kpis')) || [];
        return [...this.QUALITY_KPIS, ...custom];
    },

    async saveCustomQualityKpis(kpis) {
        await Storage.setItem('surgdash_custom_quality_kpis', kpis);
    },

    async getQualityData(projectId) {
        return (await Storage.getItem(`surgdash_quality_data_${projectId}`)) || [];
    },

    async saveQualityEntry(projectId, kpiId, year, quarter, target, actual) {
        const data = await this.getQualityData(projectId);
        const idx = data.findIndex(d => d.kpiId === kpiId && d.year === year && d.quarter === quarter);
        const entry = {
            kpiId, year, quarter,
            target: target !== null && target !== '' && target !== undefined ? Number(target) : null,
            actual: actual !== null && actual !== '' && actual !== undefined ? Number(actual) : null
        };
        if (idx >= 0) data[idx] = entry; else data.push(entry);
        await Storage.setItem(`surgdash_quality_data_${projectId}`, data);
        return data;
    },

    // ── Per-project Quality KPI baselines ────────────────────────────
    // One value per KPI (independent of year/quarter). Drives the dotted reference
    // line on the dashboard quality chart.
    async saveQualityBaseline(projectId, kpiId, value) {
        const project = this.getProject(projectId);
        if (!project) return false;
        if (!project.qualityBaselines) project.qualityBaselines = {};
        if (value === null || value === undefined || value === '') {
            delete project.qualityBaselines[kpiId];
        } else {
            const v = parseFloat(value);
            if (isNaN(v) || v < 0) return false;
            project.qualityBaselines[kpiId] = v;
        }
        await this.saveRegistry();
        return true;
    },

    // Project-level target for a quality KPI (one value per KPI per project, applies for the whole project lifetime).
    async saveQualityTarget(projectId, kpiId, value) {
        const project = this.getProject(projectId);
        if (!project) return false;
        if (!project.qualityTargets) project.qualityTargets = {};
        if (value === null || value === undefined || value === '') {
            delete project.qualityTargets[kpiId];
        } else {
            const v = parseFloat(value);
            if (isNaN(v) || v < 0) return false;
            project.qualityTargets[kpiId] = v;
        }
        await this.saveRegistry();
        return true;
    },

    // Resolve the effective target for a quality KPI: prefer the project-level value;
    // fall back to the latest per-quarter target on any legacy quality_data entry.
    qualityTargetFor(project, kpiId, qualityData) {
        if (project && project.qualityTargets && project.qualityTargets[kpiId] !== undefined && project.qualityTargets[kpiId] !== null) {
            return project.qualityTargets[kpiId];
        }
        if (Array.isArray(qualityData)) {
            const withT = qualityData
                .filter(d => d.kpiId === kpiId && d.target !== null && d.target !== undefined)
                .sort((a, b) => (a.year * 10 + a.quarter) - (b.year * 10 + b.quarter));
            if (withT.length) return withT[withT.length - 1].target;
        }
        return null;
    },

    // Apply the same target value to every year × quarter cell for one KPI.
    // Honours the project's active period (skips cells outside startDate..endDate).
    async applyQualityTargetToAllYears(projectId, kpiId, value, range) {
        const project = this.getProject(projectId);
        if (!project) return false;
        const v = (value === null || value === undefined || value === '') ? null : parseFloat(value);
        if (v !== null && (isNaN(v) || v < 0)) return false;
        // Build year list — default 2022 → current+1, or use a passed range
        const years = [];
        const start = range && range.startYear ? range.startYear : 2022;
        const end   = range && range.endYear   ? range.endYear   : (new Date().getFullYear() + 1);
        for (let y = start; y <= end; y++) years.push(y);
        // Honour project active period
        const within = (y, q) => {
            if (project.startDate) {
                const d = new Date(project.startDate);
                if (y < d.getFullYear()) return false;
                if (y === d.getFullYear() && q < Math.ceil((d.getMonth() + 1) / 3)) return false;
            }
            if (project.endDate) {
                const d = new Date(project.endDate);
                if (y > d.getFullYear()) return false;
                if (y === d.getFullYear() && q > Math.ceil((d.getMonth() + 1) / 3)) return false;
            }
            return true;
        };
        for (const y of years) {
            for (const q of [1, 2, 3, 4]) {
                if (!within(y, q)) continue;
                await this.saveOneQualityField(projectId, kpiId, y, q, 'target', v);
            }
        }
        return true;
    },

    // Save a single Quality cell (one kpi × year × quarter × target|actual).
    // Used by the quality matrix view for atomic per-cell auto-save.
    async saveOneQualityField(projectId, kpiId, year, quarter, kind, rawValue) {
        const data = await this.getQualityData(projectId);
        const idx = data.findIndex(d => d.kpiId === kpiId && d.year === year && d.quarter === quarter);
        const v = (rawValue === '' || rawValue === null || rawValue === undefined) ? null : parseFloat(rawValue);
        if (v !== null && isNaN(v)) return false;
        const existing = idx >= 0 ? data[idx] : { kpiId, year, quarter, target: null, actual: null };
        if (kind === 'target') existing.target = v;
        else                   existing.actual = v;
        // Tidy legacy "value" key if present
        if ('value' in existing) delete existing.value;
        if (idx >= 0) data[idx] = existing; else data.push(existing);
        await Storage.setItem(`surgdash_quality_data_${projectId}`, data);
        return true;
    },

    async saveQualityBatch(projectId, entries) {
        const data = await this.getQualityData(projectId);
        entries.forEach(({ kpiId, year, quarter, target, actual }) => {
            const idx = data.findIndex(d => d.kpiId === kpiId && d.year === year && d.quarter === quarter);
            const entry = {
                kpiId, year, quarter,
                target: target !== null && target !== '' && target !== undefined ? Number(target) : null,
                actual: actual !== null && actual !== '' && actual !== undefined ? Number(actual) : null
            };
            if (idx >= 0) data[idx] = entry; else data.push(entry);
        });
        await Storage.setItem(`surgdash_quality_data_${projectId}`, data);
        return data;
    },

    // Helper: get actual value from quality entry (supports legacy 'value' field)
    qualityActual(entry) {
        return entry.actual !== undefined && entry.actual !== null ? entry.actual : (entry.value !== undefined ? entry.value : null);
    },

    // Compute KPI totals from events (optionally filtered to a year)
    computeKpiTotals(events, year = null) {
        const filtered = year ? events.filter(e => e.date && e.date.startsWith(String(year))) : events;
        const totals = { hcw_strengthened: 0, patients_reached: 0, facilities_strengthened: 0, population_access: 0 };
        filtered.forEach(e => {
            if (e.hcw_count)          totals.hcw_strengthened      += Number(e.hcw_count) || 0;
            if (e.patient_count)      totals.patients_reached       += Number(e.patient_count) || 0;
            if (e.facilities_count)   totals.facilities_strengthened += Number(e.facilities_count) || 0;
            if (e.population)         totals.population_access       += Number(e.population) || 0;
        });
        return totals;
    }
};
