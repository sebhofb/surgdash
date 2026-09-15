// SURGdash "What's New" — a small, unobtrusive popup anchored above the sidebar
// footer (bottom-left) listing what changed in the current version. It appears
// automatically ONCE when the app first runs a new version (tracked via the
// last_seen_version setting; fresh installs are not greeted with a changelog),
// and can be reopened any time from the "What's new" button in the sidebar footer.

(function () {
    // Newest release first. Keep items short, user-facing, and benefit-oriented —
    // this is shown to the team, not to developers. Update this list per release.
    const RELEASES = [
        {
            v: '2.1.2',
            date: 'September 2026',
            items: [
                { t: 'UNITAR course reports', d: 'One Excel file per course, for uploading a course to UNITAR as an event. Two sheets: the totals with the breakdown by country, career stage, gender, organisation type and profession \u2014 a count and a percentage, nothing more \u2014 and the anonymised participant list. Pick a reporting period (a year, or any range of months) and the file holds only the learners who enrolled in it. The summary also gives the month the course went live, read from the enrolment curve rather than the creation date. How it all works lives on the Methodology page rather than in the file.' },
                { t: 'SURGfund KPI edits were being counted as zero', d: 'KPI-log entries written before this release carry a plain date stamp rather than a standard one, which the weekly digest could not read \u2014 so \u201cedits this week\u201d always said zero. Both Home and the digest now read either form. Last week\u2019s two edits on Nakuru OSS were real.' },
                { t: 'Deleting a project removes all of it', d: 'A deleted project used to leave its KPI actuals and quarter comments behind.' },
            ]
        },
        {
            v: '2.1.1',
            date: 'September 2026',
            items: [
                { t: 'Fixes after 2.1.0', d: 'A pull can no longer import the Sheet\u2019s own tabs as projects or layout rows as activities, and the app removes any such leftovers at start-up. A sync-key change is never retried blindly; Settings says when this device\u2019s key is not the current one and how to recover. The Apps Script is now plain ASCII so a copy through an editor cannot damage it \u2014 redeploy it once via Settings \u2192 Copy Script.' },
            ]
        },
        {
            v: '2.1.0',
            date: 'September 2026',
            items: [
                { t: 'Learner dates straight from LearnWorlds', d: 'Card 2 now syncs every learner\u2019s enrolments, progress and certificates from the API, with exact dates. It saves as it goes, resumes where it stopped, and after the first full pass a daily refresh takes minutes. The User Progress spreadsheet is a fallback, not the routine.' },
                { t: 'The app refreshes itself overnight', d: 'Background sync on the Data Sync page: once a day at a quiet moment, cards 3 and 2 run by themselves and, if you tick it, the result is published to Google Sheets so colleagues open a fresh dashboard.' },
                { t: 'Google Sheets sync: many times faster, and secured', d: 'SURGhub data travels compressed (about a tenth of the size), unchanged parts are skipped, and failures are retried. A sync key now protects the Sheet \u2014 colleagues paste one share link, once. Needs the Apps Script redeployed (Settings \u2192 Copy Script).' },
                { t: 'Weekly digest', d: 'What moved in the last seven days against the seven before: courses opened, enrolments, certificates, new accounts, top courses and providers, and the data health behind it. Copy it or open it in Mail. Optional AI narrative written from those figures only.' },
                { t: 'Learner journeys tab', d: 'The funnel from enrolment to certificate per course and provider, courses per learner, where learners go next, the most travelled learning paths, time to certificate, and activation after sign-up.' },
                { t: 'Institutions and Compare periods', d: 'Who arrives together (email domains, institutional rollouts, dominance flags) and any two periods side by side.' },
                { t: 'Trend sparklines', d: 'A tiny 13-month enrolment trend next to every course and provider, in the app and in the HTML snapshot.' },
                { t: 'Learner lookup', d: 'An internal support tool at the foot of the Directory page (edit mode only, never exported): a learner\u2019s courses, dates and certificates in one place.' },
                { t: 'Data health, on the Data Sync page', d: 'Freshness, consistency checks, what changed since the last snapshot and the provenance re-derive now live with the syncs that produce them. Ambassador attribution rebuilds itself after every sync.' },
                { t: 'Smaller things you will notice', d: 'The app opens on the screen you had last; the dashboard tab bar fits; toasts sit bottom-right, away from the navigation; targeted redraws instead of full re-renders; Sync Everything includes card 2.' },
            ]
        },
        {
            v: '2.0.13',
            date: 'July 2026',
            items: [
                { t: 'Fixed: sync could hang on \u201cFinalising\u2026\u201d', d: 'A last bookkeeping call had no timeout, so a server that went quiet left the app stuck behind the sync box with no way out. Every network call is now time-limited, and the box offers a way to close it if something takes too long. Your local data was never at risk.' },
                { t: 'Much lower CPU and battery use', d: 'Two things animated continuously whether or not anything was happening \u2014 the sidebar status dot and, when a sync stalled, a full-screen blurred overlay. Both kept the graphics chip busy and the laptop warm. They are now static.' },
                { t: 'Better behaviour when LearnWorlds rate-limits', d: 'The app can now read the server\u2019s own \u201cwait this long\u201d instruction instead of guessing, which should make Sync Learners far less likely to give up.' }
            ]
        },
        {
            v: '2.0.12',
            date: 'July 2026',
            items: [
                { t: 'Physician Reach tab', d: 'A new Dashboard tab: what share of each country\u2019s physicians SURGhub has reached, against the World Bank workforce. Three headline bases \u2014 certified, has an account, estimated \u2014 so you can quote the one whose assumption you are willing to defend. Includes a \u201cwhere SURGhub is not yet\u201d target list. The old version counted nurse anaesthetists and anaesthesia technicians as doctors; it no longer does.' },
                { t: 'Conflict Settings tab', d: 'Reach into conflict-affected settings, now on the World Bank FY2027 FCV list instead of six hardcoded countries \u2014 8,570 learners rather than 2,586. Growth over time, momentum by country, an income comparison that separates conflict from poverty, gender, learner voices, a map and an Excel export. The country list is editable on the tab itself.' },
                { t: 'What learners ask us to fix \u2014 AI summaries', d: 'Press Summarise on the Feedback tab for an overall read, a summary per topic, and what LIC/LMIC learners ask for that higher-income learners do not. The Excel download from that card works again \u2014 it had been silently failing on every click.' },
                { t: 'SURGhub Milestones', d: 'A new tab to record the moments the numbers do not show \u2014 partnerships, launches, grants, recognition \u2014 with suggestions drawn from thresholds your data has already crossed. They travel with the shared snapshot.' },
                { t: 'Data Sync cards show when they last ran', d: 'Each card now says \u201clast run 3 days ago\u201d and turns amber when it is overdue, so a stale course sync stops quietly distorting the certificate count.' },
                { t: 'Fixes', d: 'Tags on project milestones are no longer deleted when a project loads. Two buttons that did nothing \u2014 \u201cAdd a country\u201d and the bulk quality-target setter \u2014 now work.' }
            ]
        },
        {
            v: '2.0.11',
            date: 'July 2026',
            items: [
                { t: 'Ambassador Performance downloads', d: 'The performance table now downloads as PNG (a clean screenful) or Excel — the Excel covers every ambassador with emails, referrals, clicks, conversion and learner outcomes, in your current sort order.' },
                { t: 'Ambassador exports in view mode', d: 'The download buttons on Ambassador Performance and Needs Re-engagement now also work when the app is locked in view mode — no need to unlock just to pull an outreach list.' }
            ]
        },
        {
            v: '2.0.10',
            date: 'July 2026',
            items: [
                { t: 'Master Data Export', d: 'One Excel with everything: Learners (one row per person — including name and email for internal analysis; delete those columns before wider sharing), Courses, Providers, Countries, and a Monthly timeline — every tab formatted with filters and sensible column widths. Reports tab → Bulk Reports & Exports.' },
                { t: 'Raw feedback in report packages', d: 'The feedback Excel in provider and course packages is now the original survey export — every question, every answer — anonymised. It fills in as courses are re-synced (card 4 · Sync Surveys).' },
                { t: 'Ambassador outreach tools', d: '“Needs Re-engagement” now shows contact emails and downloads as PNG or Excel. Awards are split into All-time and Selected-period sections with a timeframe picker, and every award card opens an explainer with the winners’ emails. The performance table gained an email column too.' },
                { t: 'New-course triage', d: 'Courses arriving from a sync without a provider or survey link now surface at the top of Data Sync — fill them in inline, or silence the ones you don’t care about. Saves also update the stored Provider Map / Course Links so syncs keep your fix.' },
                { t: 'Directory search', d: 'Find any course or provider instantly with the new search box at the top of the Directory.' }
            ]
        },
        {
            v: '2.0.9',
            date: 'July 2026',
            items: [
                { t: 'Per-course report packages', d: 'Export a full package (PDF, web report, learner + feedback Excel) for any course — from its course page, from a provider page, or everything at once on the Reports tab. Files are organised provider → course, with the consolidated provider reports included.' },
                { t: '“Who the Learners Are” on course pages', d: 'Every course now shows its own cadre, career-stage and organisation-type breakdowns from the anonymised learner data. The User Progress upload (card 2) powers the course lists — no slow API sync needed.' },
                { t: 'Career stage (seniority)', d: 'New Career Stage table on the Learners tab and a career-stage column on course pages. The retired Intern/Resident tag now counts as “Postgraduate clinical”.' },
                { t: 'Whole-platform web report', d: 'One dark, interactive report for all of SURGhub: sortable provider and course tables, clickable awards, testimonials with ratings, the learner-story globe, and a “data through” cutoff so partial months never skew charts.' },
                { t: 'External snapshot, showcase edition', d: 'The org “External” export’s SURGhub page got learning-impact dials, enrolled-learners growth with a certification-rate spotlight, learner voices with attribution and click-to-expand, the story globe — plus a testimonial picker with type / AI-rating filters. And it now works well on phones.' },
                { t: 'Physician workforce reach', d: 'New analysis of SURGhub’s doctor-cadre learners as a share of each LIC/LMIC country’s physician workforce — downloadable as PNG and CSV.' },
                { t: 'Ambassador milestones', d: 'See who has reached the Bronze / Silver / Gold / Platinum referral tiers — including ambassadors who earned a tier but aren’t tagged yet.' },
                { t: 'Fixes', d: 'Country-brief crash fixed · names with apostrophes no longer break buttons · the User Progress badge on Data Sync now reflects what’s actually on disk.' }
            ]
        }
    ];

    Object.assign(window.App, {
        _whatsNewReleases: RELEASES,

        // Auto-show once per version change. Fresh installs (no stored version AND no
        // data yet) skip the popup — a changelog is meaningless on a first run.
        async initWhatsNew() {
            try {
                const cur = (window.electronAPI && electronAPI.appVersion) || '';
                if (!cur) return;
                let seen = null;
                try { seen = await Storage.getItem('last_seen_version'); } catch (e) { __swallowed(e); }
                if (seen === cur) return;
                try { await Storage.setItem('last_seen_version', cur); } catch (e) { __swallowed(e); }
                const isFreshInstall = !seen && !((this.data && this.data.length) || (window.Projects && Projects.registry && Projects.registry.some(p => !p.isSample)));
                if (isFreshInstall) return;
                this.showWhatsNew(true);
            } catch (e) { __swallowed(e); }
        },

        showWhatsNew() {
            this.hideWhatsNew();
            const rel = (this._whatsNewReleases || [])[0];
            if (!rel) return;
            const cur = (window.electronAPI && electronAPI.appVersion) || rel.v;
            const esc = (s) => this.escapeHtml(s);
            const items = rel.items.map(it =>
                '<div class="px-4 py-2.5 border-b border-slate-100 last:border-0">'
                + '<p class="text-[13px] font-bold text-gsf-prussian leading-snug">' + esc(it.t) + '</p>'
                + '<p class="text-xs text-slate-500 leading-relaxed mt-0.5">' + esc(it.d) + '</p>'
                + '</div>').join('');
            const el = document.createElement('div');
            el.id = 'whatsnew-pop';
            el.className = 'fixed left-4 z-50 fade-in';
            el.style.cssText = 'bottom:64px;width:400px;max-width:calc(100vw - 2rem)';
            el.innerHTML =
                '<div class="bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">'
                + '<div class="flex items-center justify-between gap-3 px-4 py-3 bg-gsf-prussian">'
                +   '<div class="flex items-center gap-2 min-w-0">'
                +     '<i data-lucide="sparkles" width="15" class="text-gsf-polo shrink-0"></i>'
                +     '<p class="text-sm font-bold text-white truncate">What’s new in v' + esc(cur) + '</p>'
                +     (rel.date ? '<span class="text-[10px] text-gsf-polo/60 font-semibold uppercase tracking-wide shrink-0">' + esc(rel.date) + '</span>' : '')
                +   '</div>'
                +   '<button onclick="App.hideWhatsNew()" class="text-gsf-polo/60 hover:text-white text-lg leading-none shrink-0" aria-label="Close">&times;</button>'
                + '</div>'
                + '<div class="overflow-y-auto custom-scrollbar" style="max-height:min(55vh, 480px)">' + items + '</div>'
                + '<div class="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between">'
                +   '<p class="text-[10px] text-slate-400">Updates install automatically · reopen this any time from “What’s new” below</p>'
                + '</div>'
                + '</div>';
            document.body.appendChild(el);
            if (window.lucide) lucide.createIcons();
            // Click-away dismiss — unobtrusive: no backdrop, nothing is blocked.
            setTimeout(() => {
                this._whatsNewAway = (ev) => { const p = document.getElementById('whatsnew-pop'); if (p && !p.contains(ev.target)) this.hideWhatsNew(); };
                document.addEventListener('mousedown', this._whatsNewAway);
            }, 0);
        },

        hideWhatsNew() {
            const el = document.getElementById('whatsnew-pop');
            if (el) el.remove();
            if (this._whatsNewAway) { document.removeEventListener('mousedown', this._whatsNewAway); this._whatsNewAway = null; }
        }
    });
})();
