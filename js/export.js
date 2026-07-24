Object.assign(window.App, {
    async exportExcel() {
        const wb = XLSX.utils.book_new();
        
        let coursesExport = []; 
        let feedbackExport = []; 
        const snapData = this.getAnalyticsSnap();
        
        const exportProvider = this.view === 'provider' ? this.selectedProvider : null;
        const targetData = exportProvider ? snapData.filter(d => d.Provider === exportProvider) : snapData;

        if (targetData.length === 0) {
            this.showMsg("No data to export for this selection.", true);
            return;
        }

        targetData.forEach(c => {
            coursesExport.push({
                "Provider": c.Provider, 
                "Course": c.Course, 
                "Total Learners": c.Learners || 0, 
                "Certificates Issued": c.Certificates || 0, 
                "Survey Responses": c.Responses || 0, 
                "Overall Rating (out of 5)": c.Rating || 0
            });

            // Safe parsing for feedback bank
            if (c.FeedbackBank) {
                try {
                    const bank = JSON.parse(c.FeedbackBank);
                    if (Array.isArray(bank)) {
                        bank.forEach(fb => { 
                            feedbackExport.push({ 
                                "Provider": c.Provider, 
                                "Course": c.Course, 
                                "Date": this.formatDate(fb.d), 
                                "Sentiment": fb.s, 
                                "Feedback Text": fb.t 
                            }); 
                        });
                    }
                } catch(e) {
                    console.warn(`Could not parse feedback for ${c.Course}`);
                }
            }
        });

        const wsCourses = XLSX.utils.json_to_sheet(coursesExport);
        XLSX.utils.book_append_sheet(wb, wsCourses, "Course Performance");

        if (feedbackExport.length > 0) {
            const wsFeedback = XLSX.utils.json_to_sheet(feedbackExport);
            XLSX.utils.book_append_sheet(wb, wsFeedback, "Survey Feedback");
        }

        const fileName = exportProvider ? `${exportProvider.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_analytics.xlsx` : `surghub_platform_analytics.xlsx`;
        const ipcRenderer = electronAPI;
        const savePath = await ipcRenderer.invoke('pick-save-path', fileName);
        if (!savePath) return;
        const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        electronAPI.fs.writeFileSync(savePath, new Uint8Array(wbOut));
        this.showMsg('Export saved!');
    },

    async exportTestimonials() {
        try {
            const snapData = this.getAnalyticsSnap();
            if (snapData.length === 0) return alert('No course data available.');

            // Load email-to-demographics map for direct per-user lookup
            let emailDemo = this._emailDemoMap;
            if (!emailDemo) {
                try { emailDemo = await Storage.getItem('surghub_email_demo'); } catch(e) {}
            }

            const wb = XLSX.utils.book_new();
            let allTestimonials = [];

            // Group by provider then course
            const providers = [...new Set(snapData.map(d => d.Provider).filter(Boolean))].sort();

            providers.forEach(providerName => {
                const provCourses = snapData.filter(d => d.Provider === providerName);

                provCourses.forEach(course => {
                    if (!course.FeedbackBank) return;
                    let bank;
                    try { bank = JSON.parse(course.FeedbackBank); } catch(e) { return; }
                    if (!Array.isArray(bank)) return;

                    // Score feedback and filter testimonials
                    if (!window.FeedbackIntel) return;
                    const scored = bank
                        .filter(b => b.t && b.t.trim().length > 5)
                        .map(b => window.FeedbackIntel.scoreFeedback(b));
                    const testimonials = scored
                        .filter(s => s._flags.includes('testimonial'))
                        .sort((a, b) => b._testimonialScore - a._testimonialScore);

                    testimonials.forEach(t => {
                        // Look up country/profession directly via email
                        let country = '', profession = '';
                        if (t.e && emailDemo && emailDemo[t.e]) {
                            country = emailDemo[t.e].country || '';
                            profession = emailDemo[t.e].profession || '';
                        }

                        allTestimonials.push({
                            'Provider': providerName,
                            'Course': course.Course,
                            'Testimonial': t.t,
                            'Rating': t.r || '',
                            'User Initials': t.u || '',
                            'Country': country,
                            'Profession': profession,
                            'Date': t.d || '',
                            'Testimonial Score': t._testimonialScore
                        });
                    });
                });
            });

            if (allTestimonials.length === 0) return alert('No testimonials found. Run Step 2 (Survey Fetch) first.');

            // Sort by provider, course, then score
            allTestimonials.sort((a, b) => a.Provider.localeCompare(b.Provider) || a.Course.localeCompare(b.Course) || b['Testimonial Score'] - a['Testimonial Score']);

            // Sheet 1: All testimonials in one sheet for easy browsing
            const wsAll = XLSX.utils.json_to_sheet(allTestimonials.map(t => ({
                'Provider': t.Provider,
                'Course': t.Course,
                'Testimonial': t.Testimonial,
                'Rating': t.Rating,
                'User Initials': t['User Initials'],
                'Country': t.Country,
                'Profession': t.Profession,
                'Date': t.Date
            })));
            // Set column widths for readability
            wsAll['!cols'] = [
                { wch: 25 }, { wch: 40 }, { wch: 80 }, { wch: 8 }, { wch: 12 }, { wch: 25 }, { wch: 25 }, { wch: 12 }
            ];
            XLSX.utils.book_append_sheet(wb, wsAll, 'All Testimonials');

            // Per-course sheets for easy copy-paste
            const courseGroups = {};
            allTestimonials.forEach(t => {
                const key = t.Course;
                if (!courseGroups[key]) courseGroups[key] = [];
                courseGroups[key].push(t);
            });

            Object.entries(courseGroups).forEach(([courseName, testimonials]) => {
                const rows = testimonials.map((t, i) => ({
                    '#': i + 1,
                    'Testimonial': t.Testimonial,
                    'Rating': t.Rating,
                    'User Initials': t['User Initials'],
                    'Country': t.Country,
                    'Profession': t.Profession,
                    'Date': t.Date
                }));

                let sheetName = courseName.substring(0, 28);
                if (sheetName.length < courseName.length) sheetName += '...';
                sheetName = sheetName.replace(/[:\\/?*\[\]]/g, '-');
                let baseName = sheetName;
                let counter = 1;
                while (wb.SheetNames && wb.SheetNames.includes(sheetName)) {
                    sheetName = baseName.substring(0, 25) + '_' + counter++;
                }

                const ws = XLSX.utils.json_to_sheet(rows);
                ws['!cols'] = [{ wch: 4 }, { wch: 80 }, { wch: 8 }, { wch: 12 }, { wch: 25 }, { wch: 25 }, { wch: 12 }];
                XLSX.utils.book_append_sheet(wb, ws, sheetName);
            });

            const ipcRenderer = electronAPI;
            const savePath = await ipcRenderer.invoke('pick-save-path', 'surghub_testimonials.xlsx');
            if (!savePath) return;
            const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            electronAPI.fs.writeFileSync(savePath, new Uint8Array(wbOut));
            this.showMsg('Testimonials export saved!');
        } catch (err) {
            console.error('Testimonials export error:', err);
            alert('Export failed: ' + err.message);
        }
    },

    exportBackup() {
        const backupData = {
            data: this.data,
            history: this.userHistory,
            ambassadors: this.ambassadorData,
            uniqueUsers: this.platformUniqueUsers
        };
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData));
        const link = document.createElement("a");
        link.setAttribute("href", dataStr);
        link.setAttribute("download", `surghub_backup_${new Date().toISOString().split('T')[0]}.json`);
        document.body.appendChild(link);
        link.click();
        link.remove();
    },

    async exportAnonymizedUserData(providerName) {
        try {
            let anonUsers = this._rawAnonymizedUsers;
            if (!anonUsers) {
                try { anonUsers = await Storage.getItem('surghub_anon_users'); } catch(e) {}
            }
            if (!anonUsers || anonUsers.length === 0) {
                return alert('No anonymized user data available.\n\nRun "Sync Growth Timelines" once, then "Sync Learners & Ambassadors" (Data Sync) \u2014 or upload the Step 4 Users CSV.');
            }

            const snapData = this.getAnalyticsSnap();
            const provCourses = snapData.filter(d => d.Provider === providerName).map(d => d.Course);
            if (provCourses.length === 0) return alert('No courses found for ' + providerName);

            const ipcRenderer = electronAPI;
            const safeName = providerName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const defaultName = safeName + '_anonymized_users.xlsx';
            const savePath = await ipcRenderer.invoke('pick-save-path', defaultName);
            if (!savePath) return;

            const wb = XLSX.utils.book_new();
            let sheetsAdded = 0;

            provCourses.forEach(courseName => {
                // Primary: exact title match (slugs resolved to titles during Step 4)
                let courseUsers = anonUsers.filter(u => u.course === courseName);

                // Fallback: normalized substring match for legacy data
                if (courseUsers.length === 0) {
                    const normCourse = courseName.toLowerCase().replace(/[^a-z0-9]/g, '');
                    courseUsers = anonUsers.filter(u => {
                        const normU = (u.course || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        return normU.length > 3 && normCourse.length > 3 &&
                            (normU.includes(normCourse) || normCourse.includes(normU));
                    });
                }

                if (courseUsers.length === 0) return;

                const rows = courseUsers.map((u, i) => ({
                    'User #': i + 1,
                    'Signup Month': u.signup_month || '',
                    'Country': u.country || '',
                    'Profession': u.profession || '',
                    'Gender': u.gender || '',
                    'Organisation Type': u.organisation_type || '',
                    'Certificate': u.has_certificate || ''
                }));

                // Sheet name max 31 chars, remove invalid chars
                let sheetName = courseName.substring(0, 28);
                if (sheetName.length < courseName.length) sheetName += '...';
                sheetName = sheetName.replace(/[:\\/?*\[\]]/g, '-');
                // Ensure unique sheet names
                let baseName = sheetName;
                let counter = 1;
                while (wb.SheetNames && wb.SheetNames.includes(sheetName)) {
                    sheetName = baseName.substring(0, 25) + '_' + counter++;
                }

                const ws = XLSX.utils.json_to_sheet(rows);
                XLSX.utils.book_append_sheet(wb, ws, sheetName);
                sheetsAdded++;
            });

            if (sheetsAdded === 0) {
                return alert('No user data matched any courses for ' + providerName + '. Make sure Step 4 (Users) was uploaded.');
            }

            const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            electronAPI.fs.writeFileSync(savePath, new Uint8Array(wbOut));
            alert('User data export saved: ' + savePath);
        } catch (err) {
            console.error('Export error:', err);
            alert('Export failed: ' + err.message);
        }
    },

    async exportAllAnonymizedUserData() {
        try {
            const ipcRenderer = electronAPI;
            const fs = electronAPI.fs;
            const path = electronAPI.path;

            let anonUsers = this._rawAnonymizedUsers;
            if (!anonUsers) {
                try { anonUsers = await Storage.getItem('surghub_anon_users'); } catch(e) {}
            }
            if (!anonUsers || anonUsers.length === 0) {
                return alert('No anonymized user data available.\n\nRun "Sync Growth Timelines" once, then "Sync Learners & Ambassadors" (Data Sync) \u2014 or upload the Step 4 Users CSV.');
            }

            const snapData = this.getAnalyticsSnap();
            const providers = [...new Set(snapData.map(d => d.Provider).filter(Boolean))].sort();
            if (providers.length === 0) return alert('No provider data available.');

            const folder = await ipcRenderer.invoke('pick-folder');
            if (!folder) return;

            let success = 0, empty = 0;
            providers.forEach(providerName => {
                const provCourses = snapData.filter(d => d.Provider === providerName).map(d => d.Course);
                if (provCourses.length === 0) return;

                const wb = XLSX.utils.book_new();
                let sheetsAdded = 0;

                provCourses.forEach(courseName => {
                    // Primary: exact title match (slugs resolved during Step 4)
                    let courseUsers = anonUsers.filter(u => u.course === courseName);
                    // Fallback: normalized substring for legacy data
                    if (courseUsers.length === 0) {
                        const normCourse = courseName.toLowerCase().replace(/[^a-z0-9]/g, '');
                        courseUsers = anonUsers.filter(u => {
                            const normU = (u.course || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                            return normU.length > 3 && normCourse.length > 3 &&
                                (normU.includes(normCourse) || normCourse.includes(normU));
                        });
                    }
                    if (courseUsers.length === 0) return;

                    const rows = courseUsers.map((u, i) => ({
                        'User #': i + 1,
                        'Signup Month': u.signup_month || '',
                        'Country': u.country || '',
                        'Profession': u.profession || '',
                        'Gender': u.gender || '',
                        'Organisation Type': u.organisation_type || '',
                        'Certificate': u.has_certificate || ''
                    }));

                    let sheetName = courseName.substring(0, 28);
                    if (sheetName.length < courseName.length) sheetName += '...';
                    sheetName = sheetName.replace(/[:\\/?*\[\]]/g, '-');
                    let baseName = sheetName;
                    let counter = 1;
                    while (wb.SheetNames && wb.SheetNames.includes(sheetName)) {
                        sheetName = baseName.substring(0, 25) + '_' + counter++;
                    }

                    const ws = XLSX.utils.json_to_sheet(rows);
                    XLSX.utils.book_append_sheet(wb, ws, sheetName);
                    sheetsAdded++;
                });

                if (sheetsAdded === 0) { empty++; return; }

                const safeName = providerName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                const filePath = path.join(folder, safeName + '_anonymized_users.xlsx');
                const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
                fs.writeFileSync(filePath, new Uint8Array(wbOut));
                success++;
            });

            alert('Done! ' + success + ' user data exports saved to:\n' + folder +
                (empty > 0 ? '\n(' + empty + ' providers had no matching user data)' : ''));
        } catch (err) {
            console.error('Bulk export error:', err);
            alert('Export failed: ' + err.message);
        }
    },

    async handleBackupUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        try {
            const text = await file.text();
            const backupData = JSON.parse(text);
            
            if (backupData.data) this.data = backupData.data;
            if (backupData.history) this.userHistory = backupData.history;
            if (backupData.ambassadors) this.ambassadorData = backupData.ambassadors;
            if (backupData.uniqueUsers) this.platformUniqueUsers = backupData.uniqueUsers;
            
            await this.handleDbSave();
            this.navigate('manage');
            this.showMsg("Backup restored successfully!");
        } catch (err) {
            this.showMsg("Error restoring backup. Ensure the file is a valid JSON.", true);
            console.error(err);
        }
        event.target.value = '';
    },

    async exportSurghubSnapshot() {
        try {
            // Per-course learning minutes come from the lazy anon blob — make sure it's
            // loaded before the snapshot is built (no Storage fallback in this path).
            if (App.ensureAnonLoaded) await App.ensureAnonLoaded();
            const ipcRenderer = electronAPI;
            const fs = electronAPI.fs;
            const path = electronAPI.path;

            // Embed logo as base64
            let logoDataUrl = '';
            try {
                const logoPath = path.join(electronAPI.appPath, 'build', 'Global Surgery Foundation_logo_symbol.png');
                logoDataUrl = 'data:image/png;base64,' + electronAPI.fs.readFileBase64(logoPath);
            } catch(e) {}

            const snapData = this.getAnalyticsSnap();
            if (!snapData || snapData.length === 0) return alert('No course data available. Run an update first.');

            const historyData = this.getAnalyticsHistory();
            const providers = [...new Set(snapData.map(d => d.Provider).filter(Boolean))].sort();
            const courses = [...new Set(snapData.map(d => d.Course).filter(Boolean))].sort();
            const audienceSnap = (this.userHistory || []).find(d => d.Timestamp === this.selectedDate) || (this.userHistory || [])[0] || {};
            const ambassadorSnap = this.ambassadorData || {};

            // Build CourseTimeline lookup from history (timeline may be on an older entry than the latest snap)
            const timelineByCourse = {};
            historyData.forEach(d => {
                if (d.CourseTimeline && !timelineByCourse[d.Course]) timelineByCourse[d.Course] = d.CourseTimeline;
            });

            // Compute per-course learning minutes from anonymized users
            const courseMins = this.getCourseLearningMinutes ? this.getCourseLearningMinutes() : {};

            // Build lightweight course data for embedding
            const courseBlob = snapData.map(d => ({
                Course: d.Course, Provider: d.Provider, Learners: Number(d.Learners)||0,
                Certificates: Number(d.Certificates)||0, Rating: Number(d.Rating)||0,
                Responses: Number(d.Responses)||0, URL: d.URL||'',
                LearningMinutes: Number(d.LearningMinutes) || courseMins[d.Course] || 0,
                CountryStats: d.CountryStats || null,
                RatingHistory: d.RatingHistory || null, FeedbackBank: d.FeedbackBank || null,
                CourseTimeline: d.CourseTimeline || timelineByCourse[d.Course] || null
            }));

            // Build platform totals
            let totalLearners=0, totalCerts=0, totalResponses=0, rSum=0, rCount=0, totalCourseMinutes=0;
            const fallbackUsers = this.platformUniqueUsers || 0;
            const totalUsers = audienceSnap.TotalUsers || fallbackUsers;
            snapData.forEach(d => {
                totalLearners += Number(d.Learners)||0;
                totalCerts += Number(d.Certificates)||0;
                totalResponses += Number(d.Responses)||0;
                totalCourseMinutes += Number(d.LearningMinutes)||0;
                const r = Number(d.Rating)||0;
                if (r > 0) { rSum += r; rCount++; }
            });

            // Build feedback data (top 200 items across all courses, for platform-level display)
            let allFeedback = [];
            snapData.forEach(c => {
                if (!c.FeedbackBank) return;
                try {
                    const fb = JSON.parse(c.FeedbackBank);
                    if (Array.isArray(fb)) fb.forEach(f => allFeedback.push({ ...f, course: c.Course, provider: c.Provider }));
                } catch(e) {}
            });
            allFeedback.sort((a,b) => (b.d||'').localeCompare(a.d||''));
            const topFeedback = allFeedback.slice(0, 300);

            // Compute conflict-settings learners from country stats
            const conflictCountries = ['Palestine', 'Sudan', 'Ukraine', 'Yemen', 'Israel', 'Somalia'];
            let conflictLearners = 0;
            try {
                const cStats = typeof audienceSnap.AllCountryStats === 'string' ? JSON.parse(audienceSnap.AllCountryStats || '{}') : (audienceSnap.AllCountryStats || {});
                conflictLearners = conflictCountries.reduce((s, c) => s + (cStats[c] || 0), 0);
            } catch(e) {}

            const data = {
                providers, courses, courseBlob, topFeedback,
                totalLearners, totalCerts, totalResponses, totalUsers, conflictLearners,
                totalCourseMinutes, conflictCountries,
                avgRating: rCount > 0 ? (rSum/rCount).toFixed(2) : '0.00',
                providerCount: providers.length, courseCount: snapData.length,
                audience: {
                    TotalUsers: audienceSnap.TotalUsers||0, TotalCertificates: audienceSnap.TotalCertificates||totalCerts||0,
                    TotalCourseMinutes: audienceSnap.TotalCourseMinutes||totalCourseMinutes||0, KnownCountry: audienceSnap.KnownCountry||0,
                    AllCountryStats: audienceSnap.AllCountryStats||null, Signups: audienceSnap.Signups||null,
                    CountryTimeline: audienceSnap.CountryTimeline||null, ProfTimeline: audienceSnap.ProfTimeline||null
                },
                ambassadors: {
                    TotalReferrals: ambassadorSnap.TotalReferrals||0, TotalAmbassadors: ambassadorSnap.TotalAmbassadors||0,
                    Timeline: ambassadorSnap.Timeline||null, Promoters: ambassadorSnap.Promoters||null,
                    PromoterTimeline: ambassadorSnap.PromoterTimeline||null, TopPromoters: ambassadorSnap.TopPromoters||null
                },
                methodology: {
                    surveyPct: audienceSnap.SurveyedPct||0, surveyCount: audienceSnap.SurveyedCount||0,
                    countryPct: audienceSnap.CountryKnownPct||audienceSnap.SurveyedPct||0,
                    countryCount: audienceSnap.CountryKnownCount||audienceSnap.SurveyedCount||0,
                    trackingOnly: audienceSnap.TrackingOnlyCount||0,
                    profCount: audienceSnap.ProfKnownCount||audienceSnap.SurveyedCount||0,
                    profPct: audienceSnap.ProfKnownPct||audienceSnap.SurveyedPct||0
                },
                generatedAt: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
                generatedAtISO: new Date().toISOString(),
                logoDataUrl
            };

            const json = JSON.stringify(data).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');

            const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SURGhub Analytics — SURGdash</title>
<script src="https://cdn.tailwindcss.com"><\/script>
<script>
tailwind.config = {
    theme: { extend: { colors: {
        'gsf-prussian': '#002F4C', 'gsf-boston': '#4389C8',
        'gsf-crimson': '#D03734', 'gsf-polo': '#91B5D9', 'gsf-tango': '#E28743'
    }}}
};
<\/script>
<script src="https://www.gstatic.com/charts/loader.js"><\/script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
body { font-family: 'Inter', sans-serif; background: #f8fafc; }
.fade-in { animation: fadeIn .3s ease; }
@keyframes fadeIn { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }
.tab-btn { transition: all .15s; }
.tab-btn.active { background: #4389C8; color: white; }
.custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
.custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
</style>
</head>
<body class="text-slate-800 min-h-screen">
<div class="max-w-7xl mx-auto p-6 md:p-10 fade-in">

    <!-- Header -->
    <div class="flex items-center justify-between flex-wrap gap-4 mb-4 pb-4 border-b-2 border-gsf-prussian">
        <div class="flex items-center gap-4">
            ${data.logoDataUrl ? `<img src="${data.logoDataUrl}" alt="GSF" class="w-12 h-12 rounded-xl shadow-md flex-shrink-0">` : ''}
            <div>
                <div class="flex items-center gap-2">
                    <h1 class="text-2xl font-black tracking-tight" style="color:#002F4C">SURG<span style="color:#91B5D9">hub</span> <span class="font-light text-slate-400 text-lg">Analytics</span></h1>
                    <span class="bg-amber-100 text-amber-700 text-xs font-bold px-1.5 py-0.5 rounded self-start mt-1">BETA</span>
                </div>
                <p class="text-xs font-bold uppercase tracking-wider mt-0.5" style="color:#91B5D9">SURGdash &mdash; Project Analytics &copy;</p>
                <p class="text-xs text-slate-400 mt-0.5">Generated ${data.generatedAt} &nbsp;&middot;&nbsp; <span id="data-age-note"></span></p>
            </div>
        </div>
        <!-- Tab navigation -->
        <div class="flex items-center gap-1 bg-slate-100 rounded-lg p-1 flex-wrap">
            <button onclick="switchTab('platform')" class="tab-btn px-3 py-1.5 rounded-lg text-sm font-semibold active" data-tab="platform">Platform</button>
            <button onclick="switchTab('provider')" class="tab-btn px-3 py-1.5 rounded-lg text-sm font-semibold text-slate-500 hover:bg-slate-200" data-tab="provider">Providers</button>
            <button onclick="switchTab('course')" class="tab-btn px-3 py-1.5 rounded-lg text-sm font-semibold text-slate-500 hover:bg-slate-200" data-tab="course">Courses</button>
            <button onclick="switchTab('audience')" class="tab-btn px-3 py-1.5 rounded-lg text-sm font-semibold text-slate-500 hover:bg-slate-200" data-tab="audience">Learners</button>
            <button onclick="switchTab('ambassadors')" class="tab-btn px-3 py-1.5 rounded-lg text-sm font-semibold text-slate-500 hover:bg-slate-200" data-tab="ambassadors">Ambassadors</button>
            <button onclick="switchTab('methodology')" class="tab-btn px-3 py-1.5 rounded-lg text-sm font-semibold text-slate-500 hover:bg-slate-200" data-tab="methodology">Methodology</button>
        </div>
    </div>

    <!-- Beta disclaimer -->
    <div class="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-6 text-sm text-amber-800 flex items-start gap-2">
        <span class="font-bold shrink-0">&#9888; Beta:</span>
        <span>SURGdash is currently in beta. This is a read-only data snapshot &mdash; figures may be incomplete. See the <button onclick="switchTab('methodology')" class="underline font-semibold hover:text-amber-900">Methodology</button> tab for more.</span>
    </div>

    <!-- Tab content containers -->
    <div id="tab-platform"></div>
    <div id="tab-provider" style="display:none"></div>
    <div id="tab-course" style="display:none"></div>
    <div id="tab-audience" style="display:none"></div>
    <div id="tab-ambassadors" style="display:none"></div>
    <div id="tab-methodology" style="display:none"></div>

    <footer class="mt-10 pt-6 border-t border-slate-200 text-xs text-slate-500 leading-relaxed max-w-4xl mx-auto">
        <p class="mb-2">SURGhub is a joint initiative of the <strong>Global Surgery Foundation (GSF)</strong> and <strong>UNITAR</strong> (United Nations Institute for Training and Research), supported by the <strong>Royal College of Surgeons in Ireland (RCSI)</strong>, and implemented in association with the <strong>Johnson &amp; Johnson Foundation</strong>.</p>
        <p class="text-slate-400">Read-only snapshot exported from SURGdash &copy; Global Surgery Foundation (beta). See the Methodology tab for data sources and limitations.</p>
    </footer>
</div>

<script>
const D = ${json};
// Data age note
(function() {
    var el = document.getElementById('data-age-note');
    if (!el || !D.generatedAtISO) return;
    var days = Math.floor((Date.now() - new Date(D.generatedAtISO).getTime()) / 86400000);
    el.textContent = days === 0 ? 'exported today' : days === 1 ? '1 day old' : days + ' days old';
})();

const GSF = ['#002F4C','#4389C8','#D03734','#91B5D9','#E28743','#206095','#7A9E9F','#C25953'];
const fmt = n => n != null ? new Intl.NumberFormat('en-US').format(n) : '\\u2014';
const esc = s => s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';
const fmtTime = m => { if(!m||m<=0) return '\\u2014'; const yr=m/525960; if(yr>=1) return yr.toFixed(1)+' yrs'; const mo=m/43830; if(mo>=1) return mo.toFixed(1)+' mo'; const d=m/1440; if(d>=1) return d.toFixed(1)+' d'; return (m/60).toFixed(1)+' h'; };

let currentTab = 'platform';
let selectedProvider = D.providers[0] || '';
let selectedCourse = D.courses[0] || '';
let chartsReady = false;

// Chart state management
const chartStates = {};
const chartDrawFns = {};
function initChartState(id, defaults) { if (!chartStates[id]) chartStates[id] = Object.assign({}, defaults); }
function registerDraw(id, fn) { chartDrawFns[id] = fn; }
function redrawChart(id) { if (chartDrawFns[id]) chartDrawFns[id](); }
function toggleChartOpt(id, key) { if (chartStates[id]) { chartStates[id][key] = !chartStates[id][key]; redrawChart(id); } }
function setChartOpt(id, key, val) { if (!chartStates[id]) chartStates[id] = {}; chartStates[id][key] = val; redrawChart(id); }

google.charts.load('current', {packages:['corechart','geochart']});
google.charts.setOnLoadCallback(() => { chartsReady = true; renderCurrentTab(); });

function switchTab(tab) {
    document.querySelectorAll('[id^="tab-"]').forEach(el => el.style.display = 'none');
    document.getElementById('tab-' + tab).style.display = '';
    document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.classList.add('text-slate-500'); });
    document.querySelector('[data-tab="'+tab+'"]').classList.add('active');
    document.querySelector('[data-tab="'+tab+'"]').classList.remove('text-slate-500');
    currentTab = tab;
    renderCurrentTab();
}

function renderCurrentTab() {
    if (currentTab === 'platform') renderPlatform();
    else if (currentTab === 'provider') renderProvider();
    else if (currentTab === 'course') renderCourse();
    else if (currentTab === 'audience') renderAudience();
    else if (currentTab === 'ambassadors') renderAmbassadors();
    else if (currentTab === 'methodology') renderMethodology();
}

function safeParse(s) { if (!s) return {}; if (typeof s === 'object') return s; try { const p = JSON.parse(s); return typeof p === 'object' && p !== null ? p : {}; } catch(e) { return {}; } }

function formatDate(ds) {
    if (!ds) return '';
    const [y,m,d] = ds.split('-');
    return new Date(y, m-1, d||1).toLocaleDateString('en-US', {month:'short', year:'numeric'});
}

// ── Partial-month handling ────────────────────────────────────────────
// Mirror of the in-app behaviour: by default, monthly timelines drop the
// current incomplete month so the chart doesn't appear to flatline at the end.
// A toggle on each chart lets the viewer include the partial month.
let includePartialMonth = false;
function _currentMonth() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function _monthProgress() {
    const d = new Date();
    const day = d.getDate();
    const total = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return { day: day, total: total };
}
function _isPartialMonth(monthStr) {
    if (!monthStr || monthStr !== _currentMonth()) return false;
    const p = _monthProgress();
    return p.day < p.total;
}
function _filterMonths(sortedMonths) {
    if (sortedMonths.length === 0 || includePartialMonth) return sortedMonths;
    if (_isPartialMonth(sortedMonths[sortedMonths.length - 1])) {
        return sortedMonths.slice(0, -1);
    }
    return sortedMonths;
}
function _partialMonthCaption() {
    const p = _monthProgress();
    const m = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    return 'Latest point is ' + m + ' (partial — ' + p.day + '/' + p.total + ' days). Cumulative growth may appear to slow until the month completes.';
}
function _partialMonthControls(captionId) {
    const cm = _currentMonth();
    const monthLabel = new Date(cm + '-01').toLocaleDateString('en-US', { month: 'short' });
    return '<label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer ml-auto" title="When off, only complete months are shown.">' +
        '<input type="checkbox" ' + (includePartialMonth ? 'checked' : '') + ' onchange="includePartialMonth=this.checked; renderCurrentTab();">' +
        '<span>Include ' + monthLabel + ' (partial)</span>' +
        '</label>';
}

function shortenProvider(name) {
    if (!name) return 'Unknown';
    const abbr = {'Global Surgical Foundation':'GSF','World Federation of Societies of Anaesthesiologists':'WFSA','Royal College of Surgeons in Ireland':'RCSI'};
    if (abbr[name]) return abbr[name];
    return name.length > 20 ? name.substring(0,18)+'...' : name;
}

function hAxisDefaults() {
    return { textStyle:{color:'#64748b',fontSize:10}, gridlines:{color:'transparent'}, slantedText:true, slantedTextAngle:45 };
}

function getScaledTimeline(courseTimelineStr, isMonthly) {
    const parsed = safeParse(courseTimelineStr);
    const tl = parsed.timeline || parsed;
    const scale = parsed.scale || {enrollScale:1,certScale:1};
    const result = {};
    Object.keys(tl).forEach(date => {
        const key = isMonthly ? date.substring(0,7) : date;
        if (!result[key]) result[key] = {e:0,c:0};
        if (typeof tl[date] === 'object') {
            result[key].e += (tl[date].e||0) * (scale.enrollScale||1);
            result[key].c += (tl[date].c||0) * (scale.certScale||1);
        } else {
            result[key].e += tl[date] * (scale.enrollScale||1);
        }
    });
    Object.keys(result).forEach(k => { result[k].e = Math.round(result[k].e); result[k].c = Math.round(result[k].c); });
    return result;
}

// ===== CHART DRAWING =====

function drawGrowthChart(elementId, courses, opts) {
    if (!chartsReady) return;
    const el = document.getElementById(elementId);
    if (!el) return;
    const s = opts || {};
    const showEnroll = s.showEnroll !== false;
    const showCert = s.showCert !== false;
    const showBars = !!s.showBars;

    let tl = {};
    courses.forEach(c => {
        if (!c.CourseTimeline) return;
        const scaled = getScaledTimeline(c.CourseTimeline, true);
        Object.keys(scaled).forEach(m => {
            if (!tl[m]) tl[m] = {e:0,c:0};
            tl[m].e += scaled[m].e;
            tl[m].c += scaled[m].c;
        });
    });
    const allMonths = Object.keys(tl).sort();
    const months = _filterMonths(allMonths);
    if (months.length === 0) { el.innerHTML = '<div class="flex items-center justify-center h-full bg-slate-50 rounded-lg text-slate-400 italic text-sm p-8">No complete months yet.</div>'; return; }

    const dt = new google.visualization.DataTable();
    dt.addColumn('string', 'Month');
    if (showEnroll) dt.addColumn('number', 'Learners');
    if (showCert) dt.addColumn('number', 'Certificates');
    if (showBars && showEnroll) dt.addColumn('number', 'Monthly Learners');
    if (showBars && showCert) dt.addColumn('number', 'Monthly Certificates');

    let cumE=0, cumC=0;
    months.forEach(m => {
        const mE = tl[m].e||0, mC = tl[m].c||0;
        cumE += mE; cumC += mC;
        const row = [formatDate(m+'-01')];
        if (showEnroll) row.push(Math.round(cumE));
        if (showCert) row.push(Math.round(cumC));
        if (showBars && showEnroll) row.push(Math.round(mE));
        if (showBars && showCert) row.push(Math.round(mC));
        dt.addRow(row);
    });

    const lineColors = [...(showEnroll?[GSF[0]]:[]), ...(showCert?[GSF[1]]:[])];
    const numLines = lineColors.length;
    const seriesConf = {};
    for (let i=0; i<numLines; i++) seriesConf[i] = {type:'line', lineWidth:3, targetAxisIndex:0};
    if (showBars) {
        let bi = numLines;
        if (showEnroll) seriesConf[bi++] = {type:'bars', targetAxisIndex:1, opacity:0.25};
        if (showCert) seriesConf[bi++] = {type:'bars', targetAxisIndex:1, opacity:0.25};
    }
    const chartOpts = {
        colors: showBars ? [...lineColors, ...lineColors] : lineColors,
        seriesType: showBars ? 'line' : undefined,
        series: showBars ? seriesConf : undefined,
        chartArea:{width:'82%',height:'65%',top:40,bottom:80},
        legend:{position:'top',textStyle:{fontSize:11}}, hAxis:hAxisDefaults(),
        vAxis:{textStyle:{color:'#64748b'},gridlines:{color:'#f1f5f9'},viewWindow:{min:0},format:'#,###'},
        animation:{startup:false,duration:0}, focusTarget:'datum'
    };
    if (showBars) chartOpts.vAxes = {
        0:{textStyle:{color:'#64748b'},gridlines:{color:'#f1f5f9'},viewWindow:{min:0},format:'#,###'},
        1:{textStyle:{color:'#94a3b8'},gridlines:{color:'transparent'},viewWindow:{min:0}}
    };
    new google.visualization[showBars ? 'ComboChart' : 'LineChart'](el).draw(dt, chartOpts);
}

function drawFeedbackChart(elementId, courses) {
    if (!chartsReady) return;
    const el = document.getElementById(elementId);
    if (!el) return;
    const deduped = {};
    courses.forEach(d => { const k = (window.courseKey ? courseKey(d) : d.Course); if (!deduped[k] || (d.Timestamp||'') > (deduped[k].Timestamp||'')) deduped[k] = d; });
    const unique = Object.values(deduped);
    let allDates = new Set(), agg = {};
    unique.forEach(c => {
        if (!c.RatingHistory) return;
        const hist = safeParse(c.RatingHistory);
        Object.keys(hist).forEach(month => {
            allDates.add(month);
            if (!agg[month]) agg[month] = {vol:0,rSum:0,rCnt:0};
            if (typeof hist[month]==='object' && hist[month].sum !== undefined) {
                agg[month].rSum += hist[month].sum; agg[month].rCnt += hist[month].count;
                agg[month].vol += hist[month].volume || hist[month].count;
            }
        });
    });
    if (allDates.size === 0) {
        unique.forEach(c => {
            if (!c.FeedbackBank) return;
            try { const fb = JSON.parse(c.FeedbackBank); if (!Array.isArray(fb)) return;
                fb.forEach(f => { if (!f.d) return; const m = f.d.substring(0,7); allDates.add(m);
                    if (!agg[m]) agg[m]={vol:0,rSum:0,rCnt:0}; agg[m].vol++;
                    if (f.r) { agg[m].rSum += Number(f.r); agg[m].rCnt++; } });
            } catch(e) {}
        });
    }
    const sorted = Array.from(allDates).sort();
    if (sorted.length === 0) { el.innerHTML = '<div class="flex items-center justify-center h-full bg-slate-50 rounded-lg text-slate-400 italic text-sm p-8">No feedback data.</div>'; return; }
    const dt = new google.visualization.DataTable();
    dt.addColumn('string','Month'); dt.addColumn('number','Survey Responses'); dt.addColumn('number','Average Rating');
    sorted.forEach(m => { const d = agg[m]; dt.addRow([formatDate(m+'-01'), d.vol, d.rCnt>0 ? d.rSum/d.rCnt : null]); });
    new google.visualization.ComboChart(el).draw(dt, {
        colors:[GSF[3],GSF[2]], seriesType:'bars',
        series:{0:{type:'bars',targetAxisIndex:1},1:{type:'line',targetAxisIndex:0,lineWidth:4,pointSize:6}},
        chartArea:{width:'82%',height:'65%',top:40,bottom:80}, legend:{position:'top',textStyle:{fontSize:11}}, hAxis:hAxisDefaults(),
        vAxes:{0:{title:'Avg Rating',textStyle:{color:'#64748b'},viewWindow:{min:0,max:5.5},gridlines:{color:'#f1f5f9'}},
               1:{title:'Volume',textStyle:{color:'#94a3b8'},viewWindow:{min:0},gridlines:{color:'transparent'}}},
        animation:{startup:false,duration:0}
    });
}

function drawColumnChart(elementId, dataObj, title, color, sortMode) {
    if (!chartsReady) return;
    const el = document.getElementById(elementId);
    if (!el || !dataObj || Object.keys(dataObj).length === 0) return;
    const dt = new google.visualization.DataTable();
    dt.addColumn('string',title); dt.addColumn('number','Count'); dt.addColumn({type:'string',role:'tooltip'});
    const entries = Object.entries(dataObj);
    if (!sortMode || sortMode === 'value') entries.sort((a,b) => b[1]-a[1]);
    else entries.sort((a,b) => a[0].localeCompare(b[0]));
    entries.slice(0,15).forEach(([k,v]) => dt.addRow([shortenProvider(k),v,k+': '+v.toLocaleString()]));
    new google.visualization.ColumnChart(el).draw(dt, {
        colors:[color||GSF[0]], chartArea:{width:'85%',height:'72%',bottom:100}, legend:{position:'none'},
        vAxis:{textStyle:{color:'#64748b'},gridlines:{color:'#f1f5f9'},viewWindow:{min:0},format:'#,###'},
        hAxis:{textStyle:{color:'#475569',fontSize:10},slantedText:true,slantedTextAngle:45},
        animation:{startup:false,duration:0}, bar:{groupWidth:'70%'}, tooltip:{trigger:'focus'}
    });
}

function drawBarChart(elementId, dataObj, title, color) {
    if (!chartsReady) return;
    const el = document.getElementById(elementId);
    if (!el || !dataObj || Object.keys(dataObj).length === 0) return;
    const arr = [[title,'Count']];
    Object.entries(dataObj).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([k,v]) => arr.push([k.length>30?k.substring(0,30)+'...':k, v]));
    if (arr.length <= 1) return;
    new google.visualization.BarChart(el).draw(google.visualization.arrayToDataTable(arr), {
        colors:[color||GSF[0]], chartArea:{width:'60%',height:'80%',left:180}, legend:{position:'none'},
        hAxis:{textStyle:{color:'#64748b'},gridlines:{color:'#f1f5f9'},viewWindow:{min:0},format:'#,###'},
        vAxis:{textStyle:{color:'#475569',fontSize:11}}, animation:{startup:false,duration:0}, bar:{groupWidth:'70%'}
    });
}

function drawCumulativeTimeline(elementId, monthlyData, label, color) {
    if (!chartsReady) return;
    const el = document.getElementById(elementId);
    if (!el) return;
    const data = safeParse(monthlyData);
    const allMonths = Object.keys(data).sort();
    // Cumulative must include data from filtered-out months — only the trailing partial month is dropped from display
    const months = _filterMonths(allMonths);
    if (months.length === 0) { el.innerHTML = '<div class="flex items-center justify-center h-full bg-slate-50 rounded-lg text-slate-400 italic text-sm p-8">No complete months yet.</div>'; return; }
    const dt = new google.visualization.DataTable();
    dt.addColumn('string','Month'); dt.addColumn('number','Cumulative '+label);
    let cum = 0;
    months.forEach(m => { cum += data[m]; dt.addRow([formatDate(m+'-01'), Math.round(cum)]); });
    new google.visualization.LineChart(el).draw(dt, {
        colors:[color||GSF[0]], chartArea:{width:'82%',height:'68%',top:40,bottom:80},
        legend:{position:'top',textStyle:{fontSize:11}}, hAxis:hAxisDefaults(),
        vAxis:{textStyle:{color:'#64748b'},gridlines:{color:'#f1f5f9'},viewWindow:{min:0},format:'#,###'},
        lineWidth:3, animation:{startup:false,duration:0}, focusTarget:'datum'
    });
}

function drawBreakdownTimeline(elementId, monthlyBreakdown, topN) {
    if (!chartsReady) return;
    const el = document.getElementById(elementId);
    if (!el) return;
    const bd = safeParse(monthlyBreakdown);
    const allMonths = Object.keys(bd).sort();
    if (allMonths.length === 0) { el.innerHTML = '<div class="flex items-center justify-center h-full bg-slate-50 rounded-lg text-slate-400 italic text-sm p-8">No data.</div>'; return; }
    let totals = {};
    allMonths.forEach(m => { if (typeof bd[m]==='object') Object.entries(bd[m]).forEach(([k,v]) => { totals[k]=(totals[k]||0)+v; }); });
    const cats = Object.entries(totals).filter(([k])=>k&&k!=='Unknown'&&k!=='nan').sort((a,b)=>b[1]-a[1]).slice(0,topN||5).map(([k])=>k);
    if (cats.length === 0) return;
    // Filter the trailing partial month from the displayed series only
    const months = _filterMonths(allMonths);
    if (months.length === 0) { el.innerHTML = '<div class="flex items-center justify-center h-full bg-slate-50 rounded-lg text-slate-400 italic text-sm p-8">No complete months yet.</div>'; return; }
    const dt = new google.visualization.DataTable();
    dt.addColumn('string','Month');
    cats.forEach(c => dt.addColumn('number',c));
    let cum = {}; cats.forEach(c => cum[c]=0);
    months.forEach(m => {
        cats.forEach(c => { cum[c] += ((bd[m]||{})[c]||0); });
        const row = [formatDate(m+'-01')];
        cats.forEach(c => row.push(Math.round(cum[c])));
        dt.addRow(row);
    });
    new google.visualization.LineChart(el).draw(dt, {
        colors:GSF.slice(0,cats.length), chartArea:{width:'78%',height:'62%',top:50,bottom:80},
        legend:{position:'top',maxLines:3,textStyle:{fontSize:10}}, hAxis:hAxisDefaults(),
        vAxis:{textStyle:{color:'#64748b'},gridlines:{color:'#f1f5f9'},viewWindow:{min:0},format:'#,###'},
        lineWidth:2, pointSize:0, focusTarget:'datum', animation:{startup:false,duration:0}
    });
}

function drawGeoChart(elementId, countryStatsStr) {
    if (!chartsReady) return;
    const el = document.getElementById(elementId);
    if (!el) return;
    try {
        const stats = typeof countryStatsStr === 'string' ? JSON.parse(countryStatsStr) : countryStatsStr;
        const mapData = [['Country','Users']];
        Object.entries(stats).forEach(([c,v]) => { if (c!=='Unknown'&&c!=='nan') mapData.push([(window.countryToISO && window.countryToISO(c)) || c, v]); });
        if (mapData.length <= 1) { el.innerHTML = '<div class="flex items-center justify-center h-full bg-slate-50 rounded-lg text-slate-400 italic text-sm p-8">No country data.</div>'; return; }
        new google.visualization.GeoChart(el).draw(google.visualization.arrayToDataTable(mapData),
            {colorAxis:{colors:['#e2e8f0',GSF[0]]}, backgroundColor:'#f8fafc', datalessRegionColor:'#f1f5f9', legend:{textStyle:{fontSize:11}}}
        );
    } catch(e) { el.innerHTML = '<div class="p-4 text-slate-400 italic text-sm">Map unavailable.</div>'; }
}

// ===== TAB RENDERERS =====

function renderCourseTable(sortKey) {
    const tbody = document.getElementById('all-courses-tbody');
    if (!tbody) return;
    const sorted = D.courseBlob.slice().sort((a, b) => {
        if (sortKey === 'certs') return b.Certificates - a.Certificates;
        if (sortKey === 'rating') return (b.Rating || 0) - (a.Rating || 0);
        if (sortKey === 'alpha') return (a.Course || '').localeCompare(b.Course || '');
        return b.Learners - a.Learners;
    });
    tbody.innerHTML = sorted.map((c, i) =>
        '<tr class="border-b hover:bg-slate-50 cursor-pointer" onclick="selectedCourse=\\''+esc(c.Course).replace(/'/g,"\\\\'")+'\\''+'; switchTab(\\'course\\')">' +
        '<td class="py-3 px-4 text-slate-400 text-xs">' + (i+1) + '</td>' +
        '<td class="py-3 px-4 font-bold text-gsf-prussian max-w-xs truncate" title="' + esc(c.Course) + '">' + esc(c.Course) + '</td>' +
        '<td class="py-3 px-4 text-slate-500 text-xs">' + esc(c.Provider || '') + '</td>' +
        '<td class="py-3 px-4 text-right">' + fmt(c.Learners) + '</td>' +
        '<td class="py-3 px-4 text-right">' + fmt(c.Certificates) + '</td>' +
        '<td class="py-3 px-4 text-right text-gsf-crimson font-bold">' + (c.Rating > 0 ? c.Rating.toFixed(2) : '\u2014') + '</td>' +
        '<td class="py-3 px-4 text-right text-gsf-boston">' + fmt(c.Responses) + '</td>' +
        '</tr>'
    ).join('');
}

function sortCourseTable(key) { renderCourseTable(key); }

function renderPlatform() {
    const el = document.getElementById('tab-platform');
    el.innerHTML = \`
        <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 mb-8">
            <div class="bg-white p-5 rounded-xl border shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Providers</p><p class="text-2xl font-black text-gsf-prussian">\${D.providerCount}</p></div>
            <div class="bg-white p-5 rounded-xl border shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Courses</p><p class="text-2xl font-black text-gsf-prussian">\${D.courseCount}</p></div>
            <div class="bg-white p-5 rounded-xl border shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Total Users</p><p class="text-2xl font-black text-gsf-boston">\${fmt(D.totalUsers)}</p></div>
            <div class="bg-white p-5 rounded-xl border shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Learners</p><p class="text-2xl font-black text-gsf-prussian">\${fmt(D.totalLearners)}</p></div>
            <div class="bg-white p-5 rounded-xl border shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Certs</p><p class="text-2xl font-black text-gsf-prussian">\${fmt(D.totalCerts)}</p></div>
            <div class="bg-white p-5 rounded-xl border shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Learning Time</p><p class="text-2xl font-black" style="color:#5B8C5A">\${fmtTime(D.totalCourseMinutes)}</p></div>
            <div class="bg-white p-5 rounded-xl border shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Avg Rating</p><p class="text-2xl font-black text-gsf-crimson">\${D.avgRating}</p></div>
            <div class="bg-white p-5 rounded-xl border shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Survey Resp.</p><p class="text-2xl font-black text-gsf-prussian">\${fmt(D.totalResponses)}</p></div>
            <div class="bg-white p-5 rounded-xl border shadow-sm" title="\${D.conflictCountries.join(', ')}"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Conflict Settings</p><p class="text-2xl font-black text-gsf-tango">\${fmt(D.conflictLearners)}</p></div>
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
            <h3 class="text-lg font-bold mb-3 text-gsf-prussian">Platform Growth</h3>
            <div class="mb-3 flex flex-wrap gap-4 items-center">
                <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" checked onchange="toggleChartOpt('chart_plat_growth','showEnroll')"> <span class="w-3 h-3 rounded-sm inline-block" style="background:#002F4C"></span> Learners</label>
                <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" checked onchange="toggleChartOpt('chart_plat_growth','showCert')"> <span class="w-3 h-3 rounded-sm inline-block" style="background:#4389C8"></span> Certificates</label>
                <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" onchange="toggleChartOpt('chart_plat_growth','showBars')"> Show monthly bars</label>
                \${_partialMonthControls()}
            </div>
            <div id="chart_plat_growth" style="width:100%;height:450px;"></div>
            \${includePartialMonth ? '<p class="text-[11px] text-slate-400 italic mt-2 text-right">⚠ ' + _partialMonthCaption() + '</p>' : ''}
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
            <h3 class="text-lg font-bold mb-4 text-gsf-prussian">Feedback Trends</h3>
            <div id="chart_plat_feedback" style="width:100%;height:350px;"></div>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div class="bg-white p-6 rounded-xl border">
                <div class="flex items-center justify-between mb-4">
                    <h4 class="font-bold text-xs uppercase text-gsf-prussian">Learners by Provider</h4>
                    <select onchange="setChartOpt('chart_plat_prov_lrn','sort',this.value)" class="text-xs border rounded px-1.5 py-0.5 text-slate-600">
                        <option value="value">By value &#8595;</option><option value="alpha">A&#8211;Z</option>
                    </select>
                </div>
                <div id="chart_plat_prov_lrn" style="width:100%;height:400px;"></div>
            </div>
            <div class="bg-white p-6 rounded-xl border">
                <div class="flex items-center justify-between mb-4">
                    <h4 class="font-bold text-xs uppercase text-gsf-prussian">Certificates by Provider</h4>
                    <select onchange="setChartOpt('chart_plat_prov_cert','sort',this.value)" class="text-xs border rounded px-1.5 py-0.5 text-slate-600">
                        <option value="value">By value &#8595;</option><option value="alpha">A&#8211;Z</option>
                    </select>
                </div>
                <div id="chart_plat_prov_cert" style="width:100%;height:400px;"></div>
            </div>
        </div>
        <div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-8">
            <div class="bg-slate-50 border-b p-5 flex items-center justify-between">
                <h2 class="font-bold text-lg text-gsf-prussian">All Courses (\${D.courseBlob.length})</h2>
                <select onchange="sortCourseTable(this.value)" class="text-xs border rounded px-1.5 py-0.5 text-slate-600">
                    <option value="learners">By Learners &#8595;</option>
                    <option value="certs">By Certificates &#8595;</option>
                    <option value="rating">By Rating &#8595;</option>
                    <option value="alpha">A&#8211;Z</option>
                </select>
            </div>
            <div class="overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar">
                <table class="w-full text-left border-collapse whitespace-nowrap text-sm" id="all-courses-table">
                    <thead class="sticky top-0 bg-white shadow-sm z-10"><tr class="border-b text-slate-500">
                        <th class="py-3 px-4 font-medium">#</th>
                        <th class="py-3 px-4 font-medium">Course</th>
                        <th class="py-3 px-4 font-medium">Provider</th>
                        <th class="py-3 px-4 font-medium text-right">Learners</th>
                        <th class="py-3 px-4 font-medium text-right">Certificates</th>
                        <th class="py-3 px-4 font-medium text-right">Rating</th>
                        <th class="py-3 px-4 font-medium text-right">Responses</th>
                    </tr></thead>
                    <tbody id="all-courses-tbody"></tbody>
                </table>
            </div>
        </div>
    \`;
    renderCourseTable('learners');
    if (chartsReady) {
        initChartState('chart_plat_growth', {showEnroll:true, showCert:true, showBars:false});
        registerDraw('chart_plat_growth', () => drawGrowthChart('chart_plat_growth', D.courseBlob, chartStates['chart_plat_growth']));
        redrawChart('chart_plat_growth');
        drawFeedbackChart('chart_plat_feedback', D.courseBlob);
        const pL={}, pC={};
        D.courseBlob.forEach(c => { if(!c.Provider) return; pL[c.Provider]=(pL[c.Provider]||0)+c.Learners; pC[c.Provider]=(pC[c.Provider]||0)+c.Certificates; });
        initChartState('chart_plat_prov_lrn', {sort:'value'});
        initChartState('chart_plat_prov_cert', {sort:'value'});
        registerDraw('chart_plat_prov_lrn', () => drawColumnChart('chart_plat_prov_lrn', pL, 'Provider', GSF[0], chartStates['chart_plat_prov_lrn'].sort));
        registerDraw('chart_plat_prov_cert', () => drawColumnChart('chart_plat_prov_cert', pC, 'Provider', GSF[1], chartStates['chart_plat_prov_cert'].sort));
        redrawChart('chart_plat_prov_lrn');
        redrawChart('chart_plat_prov_cert');
    }
}

function renderProvider() {
    const pCourses = D.courseBlob.filter(c => c.Provider === selectedProvider);
    let pLrn=0,pCert=0,pResp=0,pRSum=0,pRCnt=0;
    pCourses.forEach(c => { pLrn+=c.Learners; pCert+=c.Certificates; pResp+=c.Responses; if(c.Rating>0){pRSum+=c.Rating;pRCnt++;} });
    const pAvg = pRCnt>0 ? (pRSum/pRCnt).toFixed(2) : '0.00';
    let provFB = [];
    pCourses.forEach(c => { if(!c.FeedbackBank) return; try { const fb=JSON.parse(c.FeedbackBank); if(Array.isArray(fb)) fb.forEach(f=>provFB.push({...f,course:c.Course})); } catch(e){} });
    provFB.sort((a,b)=>(b.d||'').localeCompare(a.d||''));

    const el = document.getElementById('tab-provider');
    el.innerHTML = \`
        <div class="flex items-center gap-3 mb-6">
            <span class="text-sm text-slate-500">Provider:</span>
            <select onchange="selectedProvider=this.value; renderProvider()" class="bg-white border rounded-md py-1 px-2 text-gsf-boston text-sm font-bold outline-none cursor-pointer">
                \${D.providers.map(p => '<option value="'+esc(p)+'" '+(p===selectedProvider?'selected':'')+'>'+esc(p)+'</option>').join('')}
            </select>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
            <div class="bg-white p-5 rounded-xl border shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Courses</p><p class="text-2xl font-black text-gsf-prussian">\${pCourses.length}</p></div>
            <div class="bg-white p-5 rounded-xl border shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Learners</p><p class="text-2xl font-black text-gsf-boston">\${fmt(pLrn)}</p></div>
            <div class="bg-white p-5 rounded-xl border shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Certificates</p><p class="text-2xl font-black text-gsf-prussian">\${fmt(pCert)}</p></div>
            <div class="bg-white p-5 rounded-xl border shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Avg Rating</p><p class="text-2xl font-black text-gsf-crimson">\${pAvg}</p></div>
            <div class="bg-white p-5 rounded-xl border shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Survey Resp.</p><p class="text-2xl font-black text-gsf-prussian">\${fmt(pResp)}</p></div>
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
            <h3 class="text-lg font-bold mb-3 text-gsf-prussian">Provider Growth</h3>
            <div class="mb-3 flex flex-wrap gap-4 items-center">
                <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" checked onchange="toggleChartOpt('chart_prov_growth','showEnroll')"> <span class="w-3 h-3 rounded-sm inline-block" style="background:#002F4C"></span> Learners</label>
                <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" checked onchange="toggleChartOpt('chart_prov_growth','showCert')"> <span class="w-3 h-3 rounded-sm inline-block" style="background:#4389C8"></span> Certificates</label>
                <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" onchange="toggleChartOpt('chart_prov_growth','showBars')"> Show monthly bars</label>
                \${_partialMonthControls()}
            </div>
            <div id="chart_prov_growth" style="width:100%;height:450px;"></div>
            \${includePartialMonth ? '<p class="text-[11px] text-slate-400 italic mt-2 text-right">⚠ ' + _partialMonthCaption() + '</p>' : ''}
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
            <h3 class="text-lg font-bold mb-4 text-gsf-prussian">Feedback Trends</h3>
            <div id="chart_prov_feedback" style="width:100%;height:350px;"></div>
        </div>
        <div class="bg-white rounded-xl shadow-sm border overflow-hidden mb-8">
            <div class="bg-slate-50 border-b p-5"><h2 class="font-bold text-lg text-gsf-prussian">Courses by \${esc(selectedProvider)} (\${pCourses.length})</h2></div>
            <div class="overflow-x-auto max-h-[400px] overflow-y-auto custom-scrollbar">
                <table class="w-full text-left border-collapse whitespace-nowrap text-sm">
                    <thead class="sticky top-0 bg-white shadow-sm z-10"><tr class="border-b text-slate-500"><th class="py-3 px-4 font-medium">Course Title</th><th class="py-3 px-4 font-medium text-right">Learners</th><th class="py-3 px-4 font-medium text-right">Certificates</th><th class="py-3 px-4 font-medium text-right">Learning Time</th><th class="py-3 px-4 font-medium text-right">Rating</th><th class="py-3 px-4 font-medium text-right">Responses</th></tr></thead>
                    <tbody>\${pCourses.sort((a,b)=>b.Learners-a.Learners).map(c => '<tr class="border-b hover:bg-slate-50 cursor-pointer" onclick="selectedCourse=\\''+esc(c.Course).replace(/'/g,"\\\\'")+'\\''+'; switchTab(\\'course\\')"><td class="py-3 px-4 font-bold text-gsf-prussian">'+esc(c.Course)+'</td><td class="py-3 px-4 text-right">'+fmt(c.Learners)+'</td><td class="py-3 px-4 text-right">'+fmt(c.Certificates)+'</td><td class="py-3 px-4 text-right text-slate-500">'+fmtTime(c.LearningMinutes)+'</td><td class="py-3 px-4 text-right text-gsf-crimson font-bold">'+(c.Rating>0?c.Rating.toFixed(2):'-')+'</td><td class="py-3 px-4 text-right text-gsf-boston">'+fmt(c.Responses)+'</td></tr>').join('')}</tbody>
                </table>
            </div>
        </div>
        \${renderFeedbackSection(provFB.slice(0,50), 'Learner Feedback')}
    \`;
    if (chartsReady) {
        initChartState('chart_prov_growth', {showEnroll:true, showCert:true, showBars:false});
        registerDraw('chart_prov_growth', () => drawGrowthChart('chart_prov_growth', pCourses, chartStates['chart_prov_growth']));
        redrawChart('chart_prov_growth');
        drawFeedbackChart('chart_prov_feedback', pCourses);
    }
}

function renderCourse() {
    const c = D.courseBlob.find(x => x.Course === selectedCourse) || {};
    let courseFB = [];
    if (c.FeedbackBank) { try { const fb=JSON.parse(c.FeedbackBank); if(Array.isArray(fb)) courseFB=fb; } catch(e){} }
    courseFB.sort((a,b)=>(b.d||'').localeCompare(a.d||''));

    const el = document.getElementById('tab-course');
    el.innerHTML = \`
        <div class="flex items-center gap-3 mb-6">
            <span class="text-sm text-slate-500">Course:</span>
            <select onchange="selectedCourse=this.value; renderCourse()" class="bg-white border rounded-md py-1 px-2 text-gsf-boston text-sm font-bold outline-none cursor-pointer max-w-md">
                \${D.courses.map(co => '<option value="'+esc(co)+'" '+(co===selectedCourse?'selected':'')+'>'+esc(co)+'</option>').join('')}
            </select>
        </div>
        <p class="text-sm text-slate-500 mb-6">Provider: <span class="font-bold text-gsf-boston">\${esc(c.Provider||'Unknown')}</span></p>
        <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
            <div class="bg-white p-5 rounded-xl border shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Learners</p><p class="text-2xl font-black text-gsf-boston">\${fmt(c.Learners)}</p></div>
            <div class="bg-white p-5 rounded-xl border shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Certificates</p><p class="text-2xl font-black text-gsf-prussian">\${fmt(c.Certificates)}</p></div>
            <div class="bg-white p-5 rounded-xl border shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Learning Time</p><p class="text-2xl font-black text-gsf-tango">\${fmtTime(c.LearningMinutes)}</p></div>
            <div class="bg-white p-5 rounded-xl border shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Avg Rating</p><p class="text-2xl font-black text-gsf-crimson">\${c.Rating>0?c.Rating.toFixed(2):'-'}</p></div>
            <div class="bg-white p-5 rounded-xl border shadow-sm"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Survey Resp.</p><p class="text-2xl font-black text-gsf-prussian">\${fmt(c.Responses)}</p></div>
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
            <h3 class="text-lg font-bold mb-3 text-gsf-prussian">Course Growth</h3>
            <div class="mb-3 flex flex-wrap gap-4 items-center">
                <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" checked onchange="toggleChartOpt('chart_crs_growth','showEnroll')"> <span class="w-3 h-3 rounded-sm inline-block" style="background:#002F4C"></span> Learners</label>
                <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" checked onchange="toggleChartOpt('chart_crs_growth','showCert')"> <span class="w-3 h-3 rounded-sm inline-block" style="background:#4389C8"></span> Certificates</label>
                <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" onchange="toggleChartOpt('chart_crs_growth','showBars')"> Show monthly bars</label>
                \${_partialMonthControls()}
            </div>
            <div id="chart_crs_growth" style="width:100%;height:450px;"></div>
            \${includePartialMonth ? '<p class="text-[11px] text-slate-400 italic mt-2 text-right">⚠ ' + _partialMonthCaption() + '</p>' : ''}
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border mb-8">
            <h3 class="text-lg font-bold mb-4 text-gsf-prussian">Feedback Trends</h3>
            <div id="chart_crs_feedback" style="width:100%;height:350px;"></div>
        </div>
        \${renderFeedbackSection(courseFB.slice(0,50), 'Learner Feedback')}
    \`;
    if (chartsReady) {
        initChartState('chart_crs_growth', {showEnroll:true, showCert:true, showBars:false});
        registerDraw('chart_crs_growth', () => drawGrowthChart('chart_crs_growth', [c], chartStates['chart_crs_growth']));
        redrawChart('chart_crs_growth');
        drawFeedbackChart('chart_crs_feedback', [c]);
    }
}

function renderAudience() {
    const a = D.audience;
    const el = document.getElementById('tab-audience');
    if (!a.TotalUsers) { el.innerHTML = '<div class="bg-white p-12 text-center text-slate-500 italic rounded-xl border">No learner analytics data in this snapshot.</div>'; return; }
    el.innerHTML = \`
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div class="bg-white p-6 rounded-xl border shadow-sm"><h3 class="text-slate-500 text-sm font-bold uppercase mb-2">Total Users</h3><div class="text-3xl font-black text-gsf-boston">\${fmt(a.TotalUsers)}</div></div>
            <div class="bg-white p-6 rounded-xl border shadow-sm"><h3 class="text-slate-500 text-sm font-bold uppercase mb-2">Certificates</h3><div class="text-3xl font-black text-gsf-prussian">\${fmt(a.TotalCertificates)}</div></div>
            <div class="bg-white p-6 rounded-xl border shadow-sm"><h3 class="text-slate-500 text-sm font-bold uppercase mb-2">Learning Time</h3><div class="text-3xl font-black text-gsf-prussian">\${a.TotalCourseMinutes ? (a.TotalCourseMinutes/525960).toFixed(1)+'<span class="text-lg font-bold text-slate-400 ml-1">years</span>' : '-'}</div></div>
            <div class="bg-white p-6 rounded-xl border shadow-sm"><h3 class="text-slate-500 text-sm font-bold uppercase mb-2">Countries</h3><div class="text-3xl font-black text-gsf-prussian">\${a.KnownCountry||'-'}</div></div>
        </div>
        \${a.AllCountryStats ? '<div class="bg-white p-6 rounded-xl shadow-sm border mb-8"><h3 class="text-lg font-bold mb-4 text-gsf-prussian">Global Distribution</h3><div id="chart_aud_map" style="width:100%;height:450px;"></div></div>' : ''}
        \${a.Signups ? '<div class="bg-white p-6 rounded-xl shadow-sm border mb-8"><div class="flex items-center justify-between mb-3 gap-4 flex-wrap"><h3 class="text-lg font-bold text-gsf-prussian">User Growth</h3>' + _partialMonthControls() + '</div><div id="chart_aud_growth" style="width:100%;height:350px;"></div>' + (includePartialMonth ? '<p class="text-[11px] text-slate-400 italic mt-2 text-right">⚠ ' + _partialMonthCaption() + '</p>' : '') + '</div>' : ''}
        \${a.CountryTimeline ? '<div class="bg-white p-6 rounded-xl shadow-sm border mb-8"><div class="flex items-center justify-between mb-3 gap-4 flex-wrap"><h3 class="text-lg font-bold text-gsf-prussian">Growth by Country</h3><div class="flex items-center gap-3 flex-wrap"><select onchange="setChartOpt(\\'chart_aud_country\\',\\'topN\\',parseInt(this.value))" class="text-xs border rounded px-1.5 py-0.5 text-slate-600"><option value="5">Top 5</option><option value="10">Top 10</option><option value="15">Top 15</option></select>' + _partialMonthControls() + '</div></div><div class="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 text-xs text-amber-800">&#9888; This data is extrapolated from a sample and has not been thoroughly verified. See the <button onclick="switchTab(\\'methodology\\')" class="underline font-semibold">Methodology</button> tab for details.</div><div id="chart_aud_country" style="width:100%;height:420px;"></div>' + (includePartialMonth ? '<p class="text-[11px] text-slate-400 italic mt-2 text-right">⚠ ' + _partialMonthCaption() + '</p>' : '') + '</div>' : ''}
        \${a.ProfTimeline ? '<div class="bg-white p-6 rounded-xl shadow-sm border mb-8"><div class="flex items-center justify-between mb-3 gap-4 flex-wrap"><h3 class="text-lg font-bold text-gsf-prussian">Growth by Profession</h3><div class="flex items-center gap-3 flex-wrap"><select onchange="setChartOpt(\\'chart_aud_prof\\',\\'topN\\',parseInt(this.value))" class="text-xs border rounded px-1.5 py-0.5 text-slate-600"><option value="5">Top 5</option><option value="10">Top 10</option><option value="15">Top 15</option></select>' + _partialMonthControls() + '</div></div><div class="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 text-xs text-amber-800">&#9888; This data is extrapolated from a sample and has not been thoroughly verified. See the <button onclick="switchTab(\\'methodology\\')" class="underline font-semibold">Methodology</button> tab for details.</div><div id="chart_aud_prof" style="width:100%;height:420px;"></div>' + (includePartialMonth ? '<p class="text-[11px] text-slate-400 italic mt-2 text-right">⚠ ' + _partialMonthCaption() + '</p>' : '') + '</div>' : ''}
    \`;
    if (chartsReady) {
        if (a.AllCountryStats) drawGeoChart('chart_aud_map', a.AllCountryStats);
        if (a.Signups) drawCumulativeTimeline('chart_aud_growth', a.Signups, 'Users', GSF[0]);
        if (a.CountryTimeline) {
            initChartState('chart_aud_country', {topN: 5});
            registerDraw('chart_aud_country', () => drawBreakdownTimeline('chart_aud_country', a.CountryTimeline, chartStates['chart_aud_country'].topN));
            redrawChart('chart_aud_country');
        }
        if (a.ProfTimeline) {
            initChartState('chart_aud_prof', {topN: 5});
            registerDraw('chart_aud_prof', () => drawBreakdownTimeline('chart_aud_prof', a.ProfTimeline, chartStates['chart_aud_prof'].topN));
            redrawChart('chart_aud_prof');
        }
    }
}

function renderAmbassadors() {
    const a = D.ambassadors;
    const el = document.getElementById('tab-ambassadors');
    if (!a.TotalReferrals) { el.innerHTML = '<div class="bg-white p-12 text-center text-slate-500 italic rounded-xl border">No ambassador data in this snapshot.</div>'; return; }
    el.innerHTML = \`
        <div class="grid grid-cols-2 gap-4 mb-8">
            <div class="bg-white p-6 rounded-xl border shadow-sm"><h3 class="text-slate-500 text-sm font-bold uppercase mb-2">Total Referrals</h3><div class="text-4xl font-black text-gsf-boston">\${fmt(a.TotalReferrals)}</div></div>
            <div class="bg-white p-6 rounded-xl border shadow-sm"><h3 class="text-slate-500 text-sm font-bold uppercase mb-2">Active Ambassadors</h3><div class="text-4xl font-black text-gsf-prussian">\${fmt(a.TotalAmbassadors)}</div></div>
        </div>
        \${a.Timeline ? '<div class="bg-white p-6 rounded-xl shadow-sm border mb-8"><div class="flex items-center justify-between mb-3 gap-4 flex-wrap"><h3 class="text-lg font-bold text-gsf-prussian">Cumulative Referrals</h3>' + _partialMonthControls() + '</div><div id="chart_amb_total" style="width:100%;height:350px;"></div>' + (includePartialMonth ? '<p class="text-[11px] text-slate-400 italic mt-2 text-right">⚠ ' + _partialMonthCaption() + '</p>' : '') + '</div>' : ''}
        \${a.Promoters ? '<div class="bg-white p-6 rounded-xl shadow-sm border mb-8"><h3 class="text-lg font-bold mb-4 text-gsf-prussian">Top Ambassadors</h3><div id="chart_amb_bar" style="width:100%;height:350px;"></div></div>' : ''}
        \${a.PromoterTimeline && a.TopPromoters ? '<div class="bg-white p-6 rounded-xl shadow-sm border mb-8"><div class="flex items-center justify-between mb-3 gap-4 flex-wrap"><h3 class="text-lg font-bold text-gsf-prussian">Top Ambassadors Over Time</h3>' + _partialMonthControls() + '</div><div id="chart_amb_timeline" style="width:100%;height:400px;"></div>' + (includePartialMonth ? '<p class="text-[11px] text-slate-400 italic mt-2 text-right">⚠ ' + _partialMonthCaption() + '</p>' : '') + '</div>' : ''}
    \`;
    if (chartsReady) {
        if (a.Timeline) drawCumulativeTimeline('chart_amb_total', a.Timeline, 'Referrals', GSF[1]);
        if (a.Promoters) drawBarChart('chart_amb_bar', a.Promoters, 'Ambassador', GSF[0]);
        if (a.PromoterTimeline && a.TopPromoters) {
            const allTL = {};
            a.TopPromoters.forEach(name => {
                const pTL = a.PromoterTimeline[name] || {};
                Object.keys(pTL).forEach(m => { if(!allTL[m]) allTL[m]={}; allTL[m][name]=(allTL[m][name]||0)+pTL[m]; });
            });
            drawBreakdownTimeline('chart_amb_timeline', allTL, 5);
        }
    }
}

function renderMethodology() {
    const m = D.methodology;
    const el = document.getElementById('tab-methodology');
    el.innerHTML = \`
        <div class="max-w-4xl mx-auto space-y-6">
            <header class="mb-4">
                <h2 class="text-2xl font-black text-gsf-prussian mb-1">Data & Methodology</h2>
                <p class="text-slate-500 text-sm">How this dashboard collects, processes, and presents data.</p>
            </header>

            <div class="bg-white rounded-xl border shadow-sm p-6">
                <h3 class="text-lg font-bold text-gsf-prussian mb-3">Data Sources</h3>
                <p class="text-sm text-slate-600 mb-3">The dashboard combines data from five separate uploads, each from the LearnWorlds platform:</p>
                <table class="w-full text-sm border-collapse">
                    <thead><tr class="border-b-2 border-gsf-prussian text-left"><th class="py-2 font-bold text-gsf-prussian">Step</th><th class="py-2 font-bold text-gsf-prussian">Source File</th><th class="py-2 font-bold text-gsf-prussian">Data Provided</th></tr></thead>
                    <tbody class="text-slate-600">
                        <tr class="border-b"><td class="py-2 font-bold">1. Course Export</td><td class="py-2">CSV from LearnWorlds course analytics</td><td class="py-2">Course titles, learner counts, certificate counts, survey responses, ratings</td></tr>
                        <tr class="border-b"><td class="py-2 font-bold">2. Survey Fetch</td><td class="py-2">Excel with course links + API responses</td><td class="py-2">Individual survey responses, ratings, feedback text, sentiment</td></tr>
                        <tr class="border-b"><td class="py-2 font-bold">3. Timeline Sync</td><td class="py-2">Excel learner timeline per course</td><td class="py-2">Daily learner and certificate dates for growth charts</td></tr>
                        <tr class="border-b"><td class="py-2 font-bold">4. Users / Audience</td><td class="py-2">CSV user export from LearnWorlds</td><td class="py-2">User demographics: country, profession, gender, organisation</td></tr>
                        <tr><td class="py-2 font-bold">5. Ambassadors</td><td class="py-2">Excel leads export</td><td class="py-2">Ambassador/promoter referral data for attribution</td></tr>
                    </tbody>
                </table>
            </div>

            <div class="bg-white rounded-xl border shadow-sm p-6">
                <h3 class="text-lg font-bold text-gsf-prussian mb-3">Data Ownership (Source of Truth)</h3>
                <p class="text-sm text-slate-600 mb-3">Each upload step owns specific fields. No step overwrites another step's data:</p>
                <ul class="text-sm text-slate-600 space-y-1 list-disc list-inside">
                    <li><strong>Step 1</strong> owns: Learners (learners), Certificates, Provider mapping</li>
                    <li><strong>Step 2</strong> owns: Rating, Responses, FeedbackBank (sentiment-tagged text)</li>
                    <li><strong>Step 3</strong> owns: CourseTimeline (daily learner/certificate dates + scale factors)</li>
                    <li><strong>Step 4</strong> owns: User demographics (country, profession, gender, organisation)</li>
                    <li><strong>Step 5</strong> owns: Ambassador referral data</li>
                </ul>
            </div>

            <div class="bg-white rounded-xl border shadow-sm p-6">
                <h3 class="text-lg font-bold text-gsf-prussian mb-3">Country Data</h3>
                <p class="text-sm text-slate-600 mb-3">Country information comes from two distinct sources with different coverage:</p>
                <table class="w-full text-sm border-collapse mb-3">
                    <thead><tr class="border-b-2 border-gsf-prussian text-left"><th class="py-2 font-bold text-gsf-prussian">Source</th><th class="py-2 font-bold text-gsf-prussian">How Collected</th><th class="py-2 font-bold text-gsf-prussian">Coverage</th></tr></thead>
                    <tbody class="text-slate-600">
                        <tr class="border-b"><td class="py-2 font-bold">Profile Survey</td><td class="py-2">"What is your country of nationality?" &mdash; voluntary</td><td class="py-2">\${m.surveyPct}% (\${fmt(m.surveyCount)} users)</td></tr>
                        <tr class="border-b"><td class="py-2 font-bold">Browser Tracking</td><td class="py-2">Automatic IP/browser geolocation by LearnWorlds</td><td class="py-2">\${fmt(m.trackingOnly)} additional users</td></tr>
                        <tr><td class="py-2 font-bold">Combined</td><td class="py-2">Survey country preferred, tracking as fallback</td><td class="py-2 font-bold">\${m.countryPct}% (\${fmt(m.countryCount)} users)</td></tr>
                    </tbody>
                </table>
                <p class="text-sm text-slate-500 italic">Note: Browser tracking may reflect VPN location rather than true nationality.</p>
            </div>

            <div class="bg-white rounded-xl border shadow-sm p-6">
                <h3 class="text-lg font-bold text-gsf-prussian mb-3">Demographic Data (Profession, Gender, Organisation)</h3>
                <p class="text-sm text-slate-600 mb-3">Profession, gender, and organisation data comes <strong>exclusively from the profile survey</strong>. There is no tracking fallback for these fields. The survey was voluntary until late 2024, when it became mandatory for new registrations.</p>
                <ul class="text-sm text-slate-600 space-y-1 list-disc list-inside">
                    <li>Survey respondents: <strong>\${fmt(m.surveyCount)}</strong> (\${m.surveyPct}% of \${fmt(D.totalUsers)} total users)</li>
                    <li>Users with profession data: <strong>\${fmt(m.profCount)}</strong> (\${m.profPct}%)</li>
                </ul>
                <p class="text-sm text-slate-500 italic mt-2">This is why a user may have country data (from browser tracking) but no gender or profession &mdash; they simply didn&rsquo;t fill the survey.</p>
            </div>

            <div class="bg-white rounded-xl border shadow-sm p-6">
                <h3 class="text-lg font-bold text-gsf-prussian mb-3">Extrapolation</h3>
                <p class="text-sm text-slate-600 mb-3">Since demographic data is only available for a subset of users, all country and profession figures shown in charts are <strong>extrapolated</strong> to the full user base.</p>
                <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 mb-3">
                    <strong>Assumption:</strong> The users who completed the profile survey are representative of the entire user base. If survey respondents differ systematically, the extrapolated figures may not perfectly reflect the true distribution.
                </div>
                <p class="text-sm text-slate-600"><strong>Method:</strong> For each category, the count is scaled by <code class="bg-slate-100 px-1 rounded">total_users / surveyed_users</code>. Country data uses the combined survey+tracking sample; profession data uses survey-only.</p>
            </div>

            <div class="bg-white rounded-xl border shadow-sm p-6">
                <h3 class="text-lg font-bold text-gsf-prussian mb-3">Conflict Settings</h3>
                <p class="text-sm text-slate-600 mb-3">The <strong>&ldquo;Conflict Settings&rdquo;</strong> KPI on the Platform tab shows the estimated number of learners from countries currently experiencing armed conflict or crisis. This metric supports GSF&rsquo;s mission to track reach in fragile and conflict-affected settings.</p>
                <p class="text-sm text-slate-600 mb-3"><strong>Included countries:</strong> \${D.conflictCountries.join(', ')}</p>
                <ul class="text-sm text-slate-600 space-y-1 list-disc list-inside mb-3">
                    <li>The count sums extrapolated learner figures for each listed country from the combined country dataset (survey + browser tracking)</li>
                    <li>Since country data is extrapolated (see above), the conflict-settings figure is an <strong>estimate</strong>, not an exact count</li>
                    <li>A user is counted based on their country of nationality (from the profile survey) or, if unavailable, their browser-detected location &mdash; this may not reflect where the user is physically located</li>
                </ul>
                <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                    <strong>Note:</strong> The list of conflict-affected countries is maintained manually and may need periodic review as geopolitical situations evolve.
                </div>
            </div>

            <div class="bg-white rounded-xl border shadow-sm p-6">
                <h3 class="text-lg font-bold text-gsf-prussian mb-3">Timeline Charts & Scale Factors</h3>
                <p class="text-sm text-slate-600 mb-3">Timeline charts (learner/certificate growth) are built from Step 3 learner data, which records individual user registration and certificate dates.</p>
                <ul class="text-sm text-slate-600 space-y-1 list-disc list-inside">
                    <li>The Course Export (Step 1) may show higher learner than the timeline file because it includes users who later unenrolled</li>
                    <li><strong>Scale factors</strong> are applied so chart cumulative endpoints match Course Export totals</li>
                    <li>Scaled values are rounded to whole numbers</li>
                    <li>Courses without timeline data show KPI cards but no growth chart</li>
                </ul>
            </div>

            <div class="bg-white rounded-xl border shadow-sm p-6">
                <h3 class="text-lg font-bold text-gsf-prussian mb-3">Feedback Intelligence</h3>
                <p class="text-sm text-slate-600 mb-3">Learner feedback is collected via post-course surveys. The dashboard applies automated analysis:</p>
                <ul class="text-sm text-slate-600 space-y-2 list-disc list-inside mb-3">
                    <li><strong>Priority scoring:</strong> Each entry receives a composite score based on length, negative keywords, suggestion language, question detection, and rating value. Entries scoring &ge;5 are flagged as High Priority.</li>
                    <li><strong>Testimonial detection:</strong> Positive feedback with 20+ words and multiple positive keywords is flagged as a potential testimonial.</li>
                    <li><strong>Topic tagging:</strong> Feedback is auto-tagged into categories (Content Quality, Assessment, Platform/UX, Certification, Teaching, etc.) based on keyword matching.</li>
                </ul>
                <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                    <strong>Limitations:</strong> Keyword-based scoring is approximate. Sentiment is derived from the numeric rating (&ge;4 = Positive, &lt;3 = Critical), not from natural language analysis.
                </div>
            </div>

            <div class="bg-white rounded-xl border shadow-sm p-6">
                <h3 class="text-lg font-bold text-gsf-prussian mb-3">Known Limitations</h3>
                <ul class="text-sm text-slate-600 space-y-2 list-disc list-inside">
                    <li><strong>Survey bias:</strong> Only ~\${m.surveyPct}% of users complete the profile survey. If respondents are systematically different, extrapolated data may be skewed.</li>
                    <li><strong>Browser tracking accuracy:</strong> IP geolocation can be affected by VPNs, proxies, or shared devices.</li>
                    <li><strong>Learner vs. active users:</strong> Learner counts include all registered users, including those who never started or dropped out.</li>
                    <li><strong>Timeline gaps:</strong> Some courses may not have learner timeline files. These courses show KPI totals but no growth charts.</li>
                    <li><strong>Rating data:</strong> Survey ratings are only available for courses with active survey links.</li>
                </ul>
            </div>

            <div class="bg-slate-50 rounded-xl border p-4 text-center text-xs text-slate-400">
                SURGdash &copy; &mdash; Data & Methodology &mdash; Snapshot: \${D.generatedAt}
            </div>
        </div>
    \`;
}

function renderFeedbackSection(items, title) {
    if (!items || items.length === 0) return '';
    return '<div class="bg-white p-6 rounded-xl shadow-sm border mb-8">'
        + '<h3 class="text-lg font-bold mb-4 text-gsf-prussian">' + title + '</h3>'
        + '<div class="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar pr-2">'
        + items.map(f => {
            const rating = f.r ? '<span class="text-gsf-crimson font-bold text-xs">' + Number(f.r).toFixed(1) + '/5</span>' : '';
            const date = f.d ? '<span class="text-xs text-slate-400">' + f.d + '</span>' : '';
            const course = f.course ? '<span class="text-xs text-gsf-boston">' + esc(f.course) + '</span>' : '';
            return '<div class="border border-slate-100 rounded-lg p-3">'
                + '<div class="flex items-center gap-2 flex-wrap mb-1">' + rating + course + date + '</div>'
                + '<p class="text-sm text-slate-700">' + esc(f.t) + '</p>'
                + '</div>';
        }).join('')
        + '</div></div>';
}

// Initial render
renderPlatform();
<\/script>
</body>
</html>`;

            const savePath = await ipcRenderer.invoke('pick-save-path', 'SURGhub_Snapshot.html');
            if (!savePath) return;
            fs.writeFileSync(savePath, html, 'utf8');
            alert('Snapshot exported to:\\n' + savePath);
        } catch (err) {
            console.error(err);
            alert('Export failed: ' + err.message);
        }
    },

    // ── Master data export ────────────────────────────────────────────────
    // One comprehensive, ANONYMISED workbook: About · Learners (one row per user) ·
    // Courses · Providers · Countries · Monthly. Learner identity is the one-way
    // uid hash only — no names or emails anywhere (standing export rule).
    // _buildMasterWorkbookData is pure (no dialogs) so it can be unit-tested.
    _buildMasterWorkbookData() {
        const parse = s => { try { return JSON.parse(s) || {}; } catch (e) { return {}; } };
        const safeTl = d => { const p = (window.Charts && Charts.safeParse) ? Charts.safeParse(d.CourseTimeline) : parse(d.CourseTimeline); return p.timeline || p; };
        const seg = m => (!m || m <= 0) ? 'Ghost (0 min)' : m < 30 ? 'Explorer (<30 min)' : m < 300 ? 'Engaged (30-300 min)' : 'Power (300+ min)';
        const income = c => (window.IncomeClassification && c) ? IncomeClassification.classify(c) : '';
        const incomeLabel = t => (window.IncomeClassification && t && t !== 'Unknown') ? IncomeClassification.label(t) : '';

        // Comprehensive: bypass the "hide <50-learner courses" UI toggle for the export.
        const wasHide = this.hideLowLearners; this.hideLowLearners = false;
        const snap = this.getAnalyticsSnap(); this.hideLowLearners = wasHide;
        const snapCourses = new Set(snap.map(d => d.Course));
        const anon = (this._rawAnonymizedUsers || []).filter(r => r && r.course && snapCourses.has(r.course));

        // ── Learner identity (Name + Email) — joined from the User Progress records
        // and the email→demographics map at the user's explicit request ("we can
        // always delete that"). The About tab flags the workbook as containing
        // personal data; the columns are adjacent so they're easy to delete before
        // wider sharing. uid = one-way hash of the email, so the join is exact.
        const idMap = {};
        (this._rawCompletion || []).forEach(r => {
            if (!r || !r.email || !this._djb2Hash) return;
            const u = this._djb2Hash(String(r.email).trim().toLowerCase());
            const e = idMap[u] || (idMap[u] = { email: '', name: '' });
            if (!e.email) e.email = String(r.email).trim().toLowerCase();
            if (!e.name && r.name) e.name = String(r.name).trim();
        });
        Object.keys(this._emailDemoMap || {}).forEach(em => {
            if (!this._djb2Hash) return;
            const u = this._djb2Hash(String(em).trim().toLowerCase());
            if (!idMap[u]) idMap[u] = { email: String(em).trim().toLowerCase(), name: '' };
        });

        // ── Learners: one row per distinct user ──
        const byUid = {};
        let anonRowN = 0;
        anon.forEach(r => {
            const k = r.user_uid || ('anon_' + (anonRowN++));   // uid-less rows stay separate
            const u = byUid[k] || (byUid[k] = { uid: r.user_uid || '', signup: '', country: '', profession: '', gender: '', org: '', stage: '', courses: [], certs: 0, minutes: 0, declaredMinutes: 0 });
            u.courses.push(r.course);
            if (String(r.has_certificate) === 'Yes') u.certs++;
            u.minutes += Number(r.course_minutes) || 0;
            if (!u.signup && r.signup_month) u.signup = r.signup_month;
            if (!u.country && r.country) u.country = r.country;
            if (!u.profession && r.profession) u.profession = r.profession;
            if (!u.gender && r.gender) u.gender = r.gender;
            if (!u.org && r.organisation_type) u.org = r.organisation_type;
            if (!u.stage && r.career_stage) u.stage = r.career_stage;
            if (!u.declaredMinutes && r.user_total_minutes) u.declaredMinutes = Number(r.user_total_minutes) || 0;
        });
        const userRows = Object.values(byUid).map(u => {
            const mins = u.declaredMinutes || u.minutes;
            const id = idMap[u.uid] || { email: '', name: '' };
            return {
                'User ID': u.uid, 'Name': id.name, 'Email': id.email,
                'Signup month': u.signup, 'Country': u.country,
                'Income level': incomeLabel(income(u.country)),
                'Cadre': this._canonProf ? (this._canonProf(u.profession) || '') : '',
                'Profession (as declared)': u.profession, 'Career stage': u.stage,
                'Gender': u.gender, 'Organisation type': u.org,
                'Courses enrolled': u.courses.length, 'Certificates': u.certs,
                'Completion rate': u.courses.length ? Math.round(u.certs / u.courses.length * 100) + '%' : '',
                'Learning minutes': Math.round(mins), 'Engagement segment': seg(mins),
                'Courses': u.courses.join(' | ').slice(0, 8000)
            };
        });

        // ── Courses ──
        let awards = null; try { awards = this.computeAwards ? this.computeAwards() : null; } catch (e) {}
        const courseMins = this.getCourseLearningMinutes ? this.getCourseLearningMinutes() : {};
        const anonByCourse = {};
        anon.forEach(r => (anonByCourse[r.course] = anonByCourse[r.course] || []).push(r));
        const courseRows = snap.slice().sort((a, b) => (Number(b.Learners) || 0) - (Number(a.Learners) || 0)).map(d => {
            const tl = d.CourseTimeline ? safeTl(d) : {};
            const months = Object.keys(tl).filter(m => /^\d{4}-\d{2}/.test(m)).sort();
            const csE = Object.entries(d.CountryStats ? parse(d.CountryStats) : {}).filter(([k]) => k && k !== 'Unknown' && k !== 'nan').sort((a, b) => b[1] - a[1]);
            const rowsA = anonByCourse[d.Course] || [];
            let lmicN = 0, incKnown = 0; const cadreCount = {};
            rowsA.forEach(r => {
                const t = income(r.country);
                if (t && t !== 'Unknown') { incKnown++; if (t === 'LIC' || t === 'LMIC') lmicN++; }
                const c = this._canonProf ? this._canonProf(r.profession) : null;
                if (c) cadreCount[c] = (cadreCount[c] || 0) + 1;
            });
            const topCadre = Object.entries(cadreCount).sort((a, b) => b[1] - a[1])[0];
            let si = null; try { si = (typeof this._surveyImpactStats === 'function') ? this._surveyImpactStats([d]) : null; } catch (e) {}
            const fb = d.FeedbackBank ? parse(d.FeedbackBank) : [];
            const lrn = Number(d.Learners) || 0, cert = Number(d.Certificates) || 0, resp = Number(d.Responses) || 0;
            return {
                'Course': d.Course, 'Provider': d.Provider || '', 'Status': d.Access || '',
                'SURGhub link': (d.CourseId && this._courseSurghubUrl) ? (this._courseSurghubUrl(d.CourseId) || '') : '',
                'Launch month': months[0] ? months[0].slice(0, 7) : '',
                'Learners': lrn, 'Certificates': cert,
                'Cert rate': lrn > 0 ? (Math.round(cert / lrn * 1000) / 10) + '%' : '',
                'Learning minutes': Math.round(this.courseLearningMinutes ? this.courseLearningMinutes(d, courseMins) : (Number(d.LearningMinutes) || 0)),
                'Avg rating': Number(d.Rating) > 0 ? Number(d.Rating) : '',
                'Survey responses': resp,
                'Response rate': lrn > 0 && resp > 0 ? Math.round(resp / lrn * 100) + '%' : '',
                'Feedback comments': Array.isArray(fb) ? fb.length : 0,
                'Countries reached': csE.length,
                'Top country': csE[0] ? csE[0][0] : '',
                '% learners LIC/LMIC': incKnown ? Math.round(lmicN / incKnown * 100) + '%' : '',
                'Top cadre': topCadre ? topCadre[0] : '',
                '% content new': si && si.contentNew ? si.contentNew.pct + '%' : '',
                '% intend to apply': si && si.willApply ? si.willApply.pct + '%' : '',
                '% career value': si && si.careerValue ? si.careerValue.pct + '%' : '',
                'Awards': (awards && awards.course && awards.course[d.Course]) ? awards.course[d.Course].map(a => a.label).join(' | ') : ''
            };
        });

        // ── Providers: roll-up of the snap ──
        const pm = {};
        snap.forEach(d => {
            const p = String(d.Provider || 'Unknown').trim() || 'Unknown';
            const m = pm[p] || (pm[p] = { courses: 0, lrn: 0, cert: 0, resp: 0, rSum: 0, rCnt: 0, mins: 0, countries: new Set() });
            m.courses++; m.lrn += Number(d.Learners) || 0; m.cert += Number(d.Certificates) || 0; m.resp += Number(d.Responses) || 0;
            const r = Number(d.Rating) || 0; if (r > 0) { m.rSum += r; m.rCnt++; }
            m.mins += this.courseLearningMinutes ? this.courseLearningMinutes(d, courseMins) : (Number(d.LearningMinutes) || 0);
            Object.keys(d.CountryStats ? parse(d.CountryStats) : {}).forEach(c => { if (c && c !== 'Unknown' && c !== 'nan') m.countries.add(c); });
        });
        const providerRows = Object.entries(pm).sort((a, b) => b[1].lrn - a[1].lrn).map(([p, m]) => ({
            'Provider': p, 'Courses': m.courses, 'Learners': m.lrn, 'Certificates': m.cert,
            'Cert rate': m.lrn > 0 ? (Math.round(m.cert / m.lrn * 1000) / 10) + '%' : '',
            'Avg rating': m.rCnt ? +(m.rSum / m.rCnt).toFixed(2) : '',
            'Survey responses': m.resp, 'Learning minutes': Math.round(m.mins), 'Countries reached': m.countries.size
        }));

        // ── Countries (from the anonymised learner rows) ──
        const cm = {};
        anon.forEach(r => {
            const c = (r.country || '').trim(); if (!c || c === 'Unknown' || c === 'nan') return;
            const m = cm[c] || (cm[c] = { users: new Set(), rowN: 0, enrol: 0, certs: 0, mins: 0 });
            if (r.user_uid) m.users.add(r.user_uid); else m.rowN++;
            m.enrol++;
            if (String(r.has_certificate) === 'Yes') m.certs++;
            m.mins += Number(r.course_minutes) || 0;
        });
        const cSize = m => m.users.size + m.rowN;
        const totalCUsers = Object.values(cm).reduce((s, m) => s + cSize(m), 0);
        const countryRows = Object.entries(cm).sort((a, b) => cSize(b[1]) - cSize(a[1])).map(([c, m]) => ({
            'Country': c, 'Income level': incomeLabel(income(c)),
            'Learners': cSize(m), '% of learners': totalCUsers ? (cSize(m) / totalCUsers * 100).toFixed(1) + '%' : '',
            'Enrolments': m.enrol, 'Certificates': m.certs,
            'Completion rate': m.enrol ? Math.round(m.certs / m.enrol * 100) + '%' : '',
            'Learning minutes': Math.round(m.mins)
        }));

        // ── Monthly (registrations from signup dates; enrol/certs from timelines
        // reconciled to official totals) ──
        const aud = (this.userHistory || []).slice().sort((a, b) => String(b.Timestamp || '').localeCompare(String(a.Timestamp || '')))[0] || null;
        const signups = (aud && aud.Signups) ? parse(aud.Signups) : {};
        const em = {}, cmn = {};
        snap.forEach(d => {
            if (!d.CourseTimeline) return;
            const tl = safeTl(d);
            let sE = 0, sC = 0;
            Object.values(tl).forEach(v => { if (v && typeof v === 'object') { sE += (+v.e || 0); sC += (+v.c || 0); } });
            const scE = sE > 0 ? (Number(d.Learners) || 0) / sE : 0, scC = sC > 0 ? (Number(d.Certificates) || 0) / sC : 0;
            Object.keys(tl).forEach(date => { const m = date.slice(0, 7); const v = tl[date]; if (v && typeof v === 'object') { em[m] = (em[m] || 0) + (+v.e || 0) * scE; cmn[m] = (cmn[m] || 0) + (+v.c || 0) * scC; } });
        });
        const allMonths = [...new Set([...Object.keys(signups), ...Object.keys(em), ...Object.keys(cmn)])].filter(m => /^\d{4}-\d{2}$/.test(m)).sort();
        let cumS = 0, cumC = 0;
        const monthlyRows = allMonths.map(m => {
            cumS += Number(signups[m]) || 0; cumC += (cmn[m] || 0);
            return { 'Month': m, 'New registrations': Number(signups[m]) || 0, 'Cumulative registrations': cumS, 'New enrolments': Math.round(em[m] || 0), 'New certificates': Math.round(cmn[m] || 0), 'Cumulative certificates': Math.round(cumC) };
        });

        const about = [
            ['SURGhub master data export'],
            ['Generated', new Date().toISOString().slice(0, 10)],
            ['Data synced through', aud && aud.Timestamp ? String(aud.Timestamp).slice(0, 10) : ''],
            ['Learners', userRows.length], ['Courses', courseRows.length], ['Providers', providerRows.length], ['Countries', countryRows.length],
            [''],
            ['PERSONAL DATA', 'The Learners tab contains learner NAMES and E-MAIL addresses (joined from the User Progress data for internal analysis). Handle accordingly — delete the Name and Email columns before sharing this file outside the team. All other tabs are aggregates.'],
            ['Learners tab', 'One row per registered learner present in the anonymised demographics data (requires a course list from the User Progress upload or the Growth-Timelines sync). Demographics from the signup survey and profile tags; income level per World Bank classification; engagement segment from learning minutes (0 = Ghost, <30 Explorer, <300 Engaged, 300+ Power).'],
            ['Courses tab', 'Latest synced record per included course. Cert rate = certificates / learners. Survey % columns = share answering 4-5 on the 1-5 scale. Launch month = first month in the course timeline. % LIC/LMIC is of learners with a known country income level.'],
            ['Providers tab', 'Roll-up of the Courses tab by provider.'],
            ['Countries tab', 'From the anonymised learner rows (learners with a known country). Enrolments count learner-course pairs.'],
            ['Monthly tab', 'Registrations from signup dates; enrolments/certificates from course timelines reconciled to official totals - monthly timing is approximate, totals are exact. The current month is partial.'],
            ['Exclusions', 'Courses and providers excluded in the app are not included anywhere in this workbook.']
        ];
        return { about, userRows, courseRows, providerRows, countryRows, monthlyRows };
    },

    // Format a sheet: content-based column widths (capped), an Excel autofilter on
    // the header row, and thousands separators on large integer cells. (Freeze panes
    // and header styling need SheetJS Pro — not available in the community build.)
    _niceSheet(ws, opts) {
        opts = opts || {};
        if (!ws || !ws['!ref']) return ws;
        const range = XLSX.utils.decode_range(ws['!ref']);
        const sampleLast = Math.min(range.e.r, range.s.r + 400);   // width from first 400 rows
        const widths = [];
        for (let C = range.s.c; C <= range.e.c; C++) {
            let w = 8;
            for (let R = range.s.r; R <= range.e.r; R++) {
                const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
                if (!cell || cell.v == null) continue;
                if (cell.t === 'n' && Number.isInteger(cell.v) && Math.abs(cell.v) >= 1000) cell.z = '#,##0';
                if (R <= sampleLast) {
                    const len = String(cell.v).length + (R === range.s.r ? 2 : 0);
                    if (len > w) w = len;
                }
            }
            widths.push({ wch: Math.min(w + 1, opts.maxWidth || 46) });
        }
        ws['!cols'] = opts.widths || widths;
        if (!opts.noFilter && range.e.r > range.s.r) ws['!autofilter'] = { ref: ws['!ref'] };
        return ws;
    },

    async exportMasterWorkbook() {
        try {
            this._showReportProgress && this._showReportProgress('Building master workbook…');
            if (this.ensureAnonLoaded) await this.ensureAnonLoaded();
            if (this.ensureCompletionLoaded) await this.ensureCompletionLoaded();   // Name + Email join source
            if (!this._emailDemoMap) { try { this._emailDemoMap = (await Storage.getItem('surghub_email_demo')) || {}; } catch (e) {} }
            const D = this._buildMasterWorkbookData();
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, this._niceSheet(XLSX.utils.aoa_to_sheet(D.about), { noFilter: true, widths: [{ wch: 26 }, { wch: 110 }] }), 'About');
            XLSX.utils.book_append_sheet(wb, this._niceSheet(XLSX.utils.json_to_sheet(D.userRows.length ? D.userRows : [{ 'Note': 'No anonymised learner data — upload User Progress (card 2) then run Sync Learners (card 3).' }])), 'Learners');
            XLSX.utils.book_append_sheet(wb, this._niceSheet(XLSX.utils.json_to_sheet(D.courseRows)), 'Courses');
            XLSX.utils.book_append_sheet(wb, this._niceSheet(XLSX.utils.json_to_sheet(D.providerRows)), 'Providers');
            XLSX.utils.book_append_sheet(wb, this._niceSheet(XLSX.utils.json_to_sheet(D.countryRows)), 'Countries');
            XLSX.utils.book_append_sheet(wb, this._niceSheet(XLSX.utils.json_to_sheet(D.monthlyRows)), 'Monthly');
            this._hideReportProgress && this._hideReportProgress();
            const savePath = await electronAPI.invoke('pick-save-path', 'surghub_master_export_' + new Date().toISOString().split('T')[0] + '.xlsx');
            if (!savePath) return;
            this._writeWorkbook(wb, savePath);
            alert('Master export saved:\n' + savePath + '\n\n' +
                D.userRows.length.toLocaleString() + ' learners · ' + D.courseRows.length + ' courses · ' +
                D.providerRows.length + ' providers · ' + D.countryRows.length + ' countries · ' + D.monthlyRows.length + ' months.');
        } catch (e) {
            this._hideReportProgress && this._hideReportProgress();
            alert('Master export failed: ' + e.message);
        }
    }
});