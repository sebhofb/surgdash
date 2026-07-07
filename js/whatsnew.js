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
                try { seen = await Storage.getItem('last_seen_version'); } catch (e) {}
                if (seen === cur) return;
                try { await Storage.setItem('last_seen_version', cur); } catch (e) {}
                const isFreshInstall = !seen && !((this.data && this.data.length) || (window.Projects && Projects.registry && Projects.registry.some(p => !p.isSample)));
                if (isFreshInstall) return;
                this.showWhatsNew(true);
            } catch (e) {}
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
