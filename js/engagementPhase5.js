// Phase 5 — Social Engagement.
// Cross-tabs the social activity dataset (uploaded via Data Sync Step 5) with
// the rest of the engagement aggregates. Joined on user_uid (djb2 hash of email).
//
// What this enables:
//   1. Top contributors leaderboard (anonymous — by uid)
//   2. Social distribution (% of users with N posts / likes / comments)
//   3. Learning × Social 4-quadrant — "evangelists", "lurkers", "social-only", "ghosts"
//   4. Social activity by country
//   5. Correlation: do power users (≥3 certs) also post?

Object.assign(window.App, {

    _socialCountrySortCol: 'totalSocial',
    _socialCountrySortAsc: false,
    _sortSocialCountry(col) {
        if (this._socialCountrySortCol === col) this._socialCountrySortAsc = !this._socialCountrySortAsc;
        else { this._socialCountrySortCol = col; this._socialCountrySortAsc = (col === 'country'); }
        this._refreshEngagementSection();
    },

    // Contributor table — filter chips + sortable columns
    _socialFilter: 'top20',  // 'top20' | 'all' | 'evangelists' | 'lurkers' | 'sociallyOnly' | 'ghosts'
    _socialContribSortCol: 'postsPlusComments',
    _socialContribSortAsc: false,
    _setSocialFilter(v) {
        this._socialFilter = v;
        this._refreshEngagementSection();
    },
    _sortSocialContrib(col) {
        if (this._socialContribSortCol === col) this._socialContribSortAsc = !this._socialContribSortAsc;
        else {
            this._socialContribSortCol = col;
            // Default direction: asc for name/email/country, desc for numbers
            this._socialContribSortAsc = ['name', 'email', 'country', 'role'].includes(col);
        }
        this._refreshEngagementSection();
    },

    _computeSocialEngagement(engData) {
        const social = this._rawSocial || [];
        if (social.length === 0) return null;

        // Index social by uid for the join
        const socialByUid = {};
        social.forEach(s => { if (s.uid) socialByUid[s.uid] = s; });

        // Pull the per-user enrichment from the engagement data (already keyed by uid)
        const perUser = engData && engData.perUser ? engData.perUser : {};

        // Total platform-side aggregates (over all uploaded social rows — that's the source of truth here)
        const totals = social.reduce((acc, s) => {
            acc.posts += s.posts; acc.likes += s.likes; acc.comments += s.comments;
            if (s.posts > 0) acc.usersWithPosts++;
            if (s.posts > 0 || s.comments > 0) acc.usersActive++;
            return acc;
        }, { posts: 0, likes: 0, comments: 0, usersWithPosts: 0, usersActive: 0 });

        // Top contributors — rank by (posts + comments) since likes are easy to inflate
        const ranked = social
            .filter(s => (s.posts + s.comments) > 0)
            .sort((a, b) => (b.posts + b.comments) - (a.posts + a.comments))
            .slice(0, 20);

        // Distribution buckets by post count
        const postBuckets = { '0': 0, '1': 0, '2-4': 0, '5-9': 0, '10-24': 0, '25+': 0 };
        social.forEach(s => {
            const p = s.posts;
            if      (p === 0)  postBuckets['0']++;
            else if (p === 1)  postBuckets['1']++;
            else if (p <= 4)   postBuckets['2-4']++;
            else if (p <= 9)   postBuckets['5-9']++;
            else if (p <= 24)  postBuckets['10-24']++;
            else               postBuckets['25+']++;
        });

        // ── 4-quadrant: Learning vs Social ────────────────────────────────
        // Definitions:
        //   Learning "high"  = certificates >= 1   (used the platform productively)
        //   Social   "high"  = posts + comments >= 1
        // We need to count users in each quadrant. Use social as the universe
        // (it's per-user). For each social user, look up their certs in their
        // own row (already on the social CSV: row.certificates).
        const quads = {
            ghosts:    { count: 0, label: 'Ghosts',       desc: '0 certs · 0 social' },
            lurkers:   { count: 0, label: 'Silent learners', desc: 'Learning only' },
            sociallyOnly: { count: 0, label: 'Social-only', desc: 'Active socially but never completed a course' },
            evangelists: { count: 0, label: 'Evangelists',   desc: 'Both — high learning + high social' },
        };
        social.forEach(s => {
            const lh = (s.certificates || 0) >= 1;
            const sh = (s.posts + s.comments) >= 1;
            if (!lh && !sh) quads.ghosts.count++;
            else if (lh && !sh) quads.lurkers.count++;
            else if (!lh && sh) quads.sociallyOnly.count++;
            else                quads.evangelists.count++;
        });

        // ── Social activity by country (using last_login_country in the CSV) ──
        const byCountry = {};
        social.forEach(s => {
            const c = (s.last_login_country || '').trim();
            if (!c) return;
            const a = byCountry[c] = byCountry[c] || { users: 0, posts: 0, likes: 0, comments: 0, active: 0 };
            a.users++;
            a.posts += s.posts; a.likes += s.likes; a.comments += s.comments;
            if (s.posts > 0 || s.comments > 0) a.active++;
        });

        // ── Correlation: power-user-by-cert vs social ─────────────────────
        // We have per-user cert counts on both anon (user_cert_count via perUser)
        // and on social (s.certificates). Use the social copy since it covers more users.
        let powerUserSocialActive = 0, powerUserTotal = 0;
        let normalUserSocialActive = 0, normalUserTotal = 0;
        social.forEach(s => {
            const certs = s.certificates || 0;
            const socActive = (s.posts + s.comments) >= 1;
            if (certs >= 3) {
                powerUserTotal++;
                if (socActive) powerUserSocialActive++;
            } else if (certs >= 1) {
                normalUserTotal++;
                if (socActive) normalUserSocialActive++;
            }
        });
        const powerSocialRate  = powerUserTotal  > 0 ? (powerUserSocialActive  / powerUserTotal)  * 100 : 0;
        const normalSocialRate = normalUserTotal > 0 ? (normalUserSocialActive / normalUserTotal) * 100 : 0;

        return { social, socialByUid, totals, ranked, postBuckets, quads, byCountry,
                 powerSocialRate, normalSocialRate, powerUserTotal, normalUserTotal };
    },

    _renderSocialEngagement(engData) {
        const data = this._computeSocialEngagement(engData);
        if (!data) {
            return `
                <div id="eng-section-social" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                    <div class="bg-slate-50 border-b p-5">
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="message-square-text" class="text-gsf-boston"></i> Social Engagement</h2>
                    </div>
                    <div class="p-8 text-center">
                        <p class="text-sm text-slate-600 mb-2">No social activity data uploaded yet.</p>
                        <p class="text-xs text-slate-400">Run <strong>Step 5 (Social Activity)</strong> on the Data Sync page to upload the SURGhub User-Segment export.</p>
                    </div>
                </div>
            `;
        }

        const { totals, ranked, postBuckets, quads, byCountry, powerSocialRate, normalSocialRate, powerUserTotal, normalUserTotal, social } = data;
        const totalUsers = social.length;

        // Bucket colours
        const bucketColours = { '0': '#e5e7eb', '1': '#cbd5e1', '2-4': '#7A9E9F', '5-9': '#4389C8', '10-24': '#1a5276', '25+': '#D03734' };

        // Sortable country table
        const col = this._socialCountrySortCol;
        const asc = this._socialCountrySortAsc;
        const countryRows = Object.entries(byCountry)
            .map(([country, v]) => ({
                country,
                users: v.users,
                posts: v.posts,
                likes: v.likes,
                comments: v.comments,
                totalSocial: v.posts + v.comments,
                activeRate: v.users > 0 ? (v.active / v.users) * 100 : 0,
            }))
            .filter(r => r.users >= 25)
            .sort((a, b) => {
                let va, vb;
                if (col === 'country') { va = a.country.toLowerCase(); vb = b.country.toLowerCase(); }
                else { va = a[col]; vb = b[col]; }
                if (va < vb) return asc ? -1 : 1;
                if (va > vb) return asc ? 1 : -1;
                return 0;
            })
            .slice(0, 25);

        const arrow = (c) => col === c
            ? (asc ? '&#9650;' : '&#9660;')
            : '<span class="text-slate-300">&#8597;</span>';
        const th = (key, label, align) =>
            `<th class="py-2 px-3 font-medium ${align||''} cursor-pointer hover:text-gsf-boston select-none" onclick="App._sortSocialCountry('${key}')">${label} ${arrow(key)}</th>`;

        const quadColors = { ghosts: '#e5e7eb', lurkers: '#4389C8', sociallyOnly: '#E28743', evangelists: '#1a5276' };
        const quadKeys = ['evangelists', 'lurkers', 'sociallyOnly', 'ghosts'];

        return `
            <div id="eng-section-social" class="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div class="bg-slate-50 border-b p-5 flex justify-between items-start gap-4 flex-wrap">
                    <div>
                        <h2 class="font-bold text-lg text-gsf-prussian flex items-center gap-2"><i data-lucide="message-square-text" class="text-gsf-boston"></i> Social Engagement</h2>
                        <p class="text-xs text-slate-500 mt-1">Forum posts, comments, and likes per user — joined with course engagement to see whether learners also contribute socially. Based on ${this.formatNumber(totalUsers)} user records from the Social Activity upload.</p>
                    </div>
                    ${this._engActionBtns('eng-section-social', 'social', 'Social_Engagement')}
                </div>
                <div class="p-5">
                    <!-- Platform totals -->
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        ${[
                            { label: 'Total posts', val: this.formatNumber(totals.posts), color: '#1a5276' },
                            { label: 'Total comments', val: this.formatNumber(totals.comments), color: '#4389C8' },
                            { label: 'Total likes', val: this.formatNumber(totals.likes), color: '#7A9E9F' },
                            { label: 'Users with social activity', val: this.formatNumber(totals.usersActive) + ' <span class="text-sm text-slate-400">(' + ((totals.usersActive / totalUsers) * 100).toFixed(1) + '%)</span>', color: '#D03734' },
                        ].map(k => `<div class="border rounded-lg p-4 bg-slate-50/50">
                            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">${k.label}</div>
                            <div class="text-2xl font-black" style="color:${k.color}">${k.val}</div>
                        </div>`).join('')}
                    </div>

                    <!-- 4-quadrant — clickable to filter the contributor table -->
                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Learning × Social — 4 quadrants <span class="font-normal text-slate-400">(click a quadrant to drill in)</span></h4>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                        ${quadKeys.map(k => {
                            const q = quads[k]; const pct = totalUsers > 0 ? (q.count / totalUsers) * 100 : 0;
                            const active = this._socialFilter === k;
                            return `<button onclick="App._setSocialFilter('${k}')" class="text-left border rounded-lg p-4 relative overflow-hidden hover:shadow transition-shadow ${active ? 'ring-2 ring-offset-2 ring-gsf-boston shadow-md' : ''}">
                                <div class="absolute top-0 left-0 w-1.5 h-full" style="background:${quadColors[k]}"></div>
                                <div class="ml-2">
                                    <div class="text-xs font-bold text-gsf-prussian">${q.label}</div>
                                    <div class="text-[10px] text-slate-500 mb-2">${q.desc}</div>
                                    <div class="flex items-baseline gap-2">
                                        <span class="text-2xl font-black" style="color:${quadColors[k]}">${this.formatNumber(q.count)}</span>
                                        <span class="text-xs text-slate-400">${pct.toFixed(1)}%</span>
                                    </div>
                                </div>
                            </button>`;
                        }).join('')}
                    </div>

                    <!-- Distribution: posts per user -->
                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Distribution: posts per user</h4>
                    <div class="mb-2">
                        <div class="flex w-full h-8 rounded-md overflow-hidden border border-slate-200">
                            ${Object.entries(postBuckets).map(([k, n]) => {
                                const pct = totalUsers > 0 ? (n / totalUsers) * 100 : 0;
                                if (pct < 0.3) return '';
                                return `<div title="${k} posts: ${n.toLocaleString()} users (${pct.toFixed(1)}%)" style="width:${pct}%; background:${bucketColours[k]};" class="flex items-center justify-center text-[10px] font-bold ${k==='0'||k==='1'?'text-slate-600':'text-white'}">${pct >= 6 ? k + ' · ' + pct.toFixed(0) + '%' : ''}</div>`;
                            }).join('')}
                        </div>
                    </div>
                    <div class="flex flex-wrap gap-3 mb-6 text-[10px] text-slate-500">
                        ${Object.entries(postBuckets).map(([k, n]) => `<span class="inline-flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:${bucketColours[k]}"></span><strong>${k}</strong> posts · ${this.formatNumber(n)}</span>`).join('')}
                    </div>

                    <!-- Power-user correlation -->
                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Do power learners also post?</h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        <div class="border rounded-lg p-4 bg-blue-50/40 border-blue-100">
                            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Power learners (≥ 3 certs)</div>
                            <div class="text-2xl font-black text-gsf-boston">${powerSocialRate.toFixed(0)}% <span class="text-sm text-slate-400 font-normal">socially active</span></div>
                            <div class="text-[10px] text-slate-500 mt-1">${this.formatNumber(powerUserTotal)} power learners total</div>
                        </div>
                        <div class="border rounded-lg p-4 bg-slate-50/50">
                            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Casual learners (1–2 certs)</div>
                            <div class="text-2xl font-black text-slate-600">${normalSocialRate.toFixed(0)}% <span class="text-sm text-slate-400 font-normal">socially active</span></div>
                            <div class="text-[10px] text-slate-500 mt-1">${this.formatNumber(normalUserTotal)} casual learners</div>
                        </div>
                    </div>
                    <p class="text-[11px] text-slate-500 mb-6">
                        ${powerSocialRate > normalSocialRate * 1.2
                            ? '<strong class="text-green-700">Power learners are noticeably more social</strong> — completing courses correlates with contributing to the community.'
                            : powerSocialRate * 1.2 < normalSocialRate
                            ? '<strong class="text-amber-700">Power learners are quieter</strong> than casual learners — your most engaged learners participate less in the forum.'
                            : '<strong class="text-slate-600">Power and casual learners contribute at similar rates</strong>.'
                        }
                    </p>

                    ${this._renderSocialContribTable(data)}

                    <!-- Country breakdown -->
                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Social activity by country <span class="font-normal text-slate-400">(top 25 by total)</span></h4>
                    <div class="border rounded-lg overflow-hidden">
                        <table class="w-full text-xs">
                            <thead class="text-slate-500 border-b bg-slate-50"><tr>
                                ${th('country', 'Country')}
                                ${th('users', 'Users', 'text-right')}
                                ${th('activeRate', 'Active %', 'text-right')}
                                ${th('posts', 'Posts', 'text-right')}
                                ${th('comments', 'Comments', 'text-right')}
                                ${th('likes', 'Likes', 'text-right')}
                                ${th('totalSocial', 'P + C', 'text-right')}
                            </tr></thead>
                            <tbody>
                                ${countryRows.length === 0 ? '<tr><td colspan="7" class="py-4 text-center text-slate-400 italic">No countries with ≥ 25 users.</td></tr>' :
                                  countryRows.map(r => `<tr class="border-b">
                                    <td class="py-1.5 px-3 font-bold text-gsf-prussian">${this.escapeHtml(r.country)}</td>
                                    <td class="py-1.5 px-3 text-right text-slate-500">${this.formatNumber(r.users)}</td>
                                    <td class="py-1.5 px-3 text-right ${r.activeRate >= 10 ? 'text-green-700 font-bold' : 'text-slate-600'}">${r.activeRate.toFixed(1)}%</td>
                                    <td class="py-1.5 px-3 text-right font-bold text-gsf-boston">${this.formatNumber(r.posts)}</td>
                                    <td class="py-1.5 px-3 text-right">${this.formatNumber(r.comments)}</td>
                                    <td class="py-1.5 px-3 text-right text-slate-500">${this.formatNumber(r.likes)}</td>
                                    <td class="py-1.5 px-3 text-right font-medium">${this.formatNumber(r.totalSocial)}</td>
                                  </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    },

    _renderSocialContribTable(data) {
        const { social } = data;
        const filter = this._socialFilter || 'top20';
        const col = this._socialContribSortCol;
        const asc = this._socialContribSortAsc;

        // Detect stale records from before name/email were added to the parser.
        // Show a banner so it's obvious why those columns are blank.
        const hasNameOrEmail = social.some(s => (s.name && s.name.length > 0) || (s.email && s.email.length > 0));
        const staleBanner = !hasNameOrEmail
            ? `<div class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 flex items-start gap-3">
                   <i data-lucide="alert-triangle" width="18" class="text-amber-600 shrink-0 mt-0.5"></i>
                   <div class="text-sm">
                       <p class="font-bold text-amber-800 mb-1">Name and email columns are blank</p>
                       <p class="text-xs text-amber-700">The social activity records on disk were saved before name/email storage was added. Go to <strong>Data Sync → Step 5</strong> and upload the social CSV again to refresh — your existing analysis won't change, but the contributor list will populate.</p>
                   </div>
               </div>`
            : '';

        // Apply filter
        let users;
        if (filter === 'evangelists') {
            users = social.filter(s => (s.certificates || 0) >= 1 && (s.posts + s.comments) >= 1);
        } else if (filter === 'lurkers') {
            users = social.filter(s => (s.certificates || 0) >= 1 && (s.posts + s.comments) === 0);
        } else if (filter === 'sociallyOnly') {
            users = social.filter(s => (s.certificates || 0) === 0 && (s.posts + s.comments) >= 1);
        } else if (filter === 'ghosts') {
            users = social.filter(s => (s.certificates || 0) === 0 && (s.posts + s.comments) === 0);
        } else {
            users = social.slice();
        }

        // Enrich with composite sort fields
        users = users.map(u => ({ ...u, country: u.last_login_country || '', postsPlusComments: (u.posts || 0) + (u.comments || 0) }));

        // Sort
        users.sort((a, b) => {
            let va = a[col], vb = b[col];
            if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb || '').toLowerCase(); }
            else { va = Number(va) || 0; vb = Number(vb) || 0; }
            if (va < vb) return asc ? -1 : 1;
            if (va > vb) return asc ? 1 : -1;
            return 0;
        });

        // Row cap
        const cap = filter === 'top20' ? 20 : 100;
        const totalForFilter = users.length;
        users = users.slice(0, cap);

        const arrow = (c) => col === c ? (asc ? '&#9650;' : '&#9660;') : '<span class="text-slate-300">&#8597;</span>';
        const th = (key, label, align, width) =>
            `<th class="py-2 px-3 font-medium ${align||''} cursor-pointer hover:text-gsf-boston select-none" ${width ? `style="width:${width}"` : ''} onclick="App._sortSocialContrib('${key}')">${label} ${arrow(key)}</th>`;

        const filterChips = [
            { v: 'top20', l: 'Top 20', count: Math.min(20, social.filter(s => (s.posts + s.comments) > 0).length) },
            { v: 'all', l: 'All users', count: social.length },
            { v: 'evangelists', l: 'Evangelists', count: data.quads.evangelists.count },
            { v: 'lurkers', l: 'Silent learners', count: data.quads.lurkers.count },
            { v: 'sociallyOnly', l: 'Social-only', count: data.quads.sociallyOnly.count },
            { v: 'ghosts', l: 'Ghosts', count: data.quads.ghosts.count },
        ];

        const filterLabel = filterChips.find(c => c.v === filter)?.l || 'Users';

        return `
            ${staleBanner}
            <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Contributors — <span class="text-gsf-prussian">${filterLabel}</span> <span class="font-normal text-slate-400">(${this.formatNumber(totalForFilter)} match${totalForFilter === 1 ? '' : 'es'}${totalForFilter > cap ? `, showing first ${cap}` : ''})</span></h4>
            <div class="flex flex-wrap gap-1.5 mb-3">
                ${filterChips.map(c => `<button onclick="App._setSocialFilter('${c.v}')" class="px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors ${filter === c.v ? 'bg-gsf-boston text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">${c.l} <span class="ml-1 opacity-70">${this.formatNumber(c.count)}</span></button>`).join('')}
            </div>
            <div class="border rounded-lg overflow-x-auto max-h-[600px] overflow-y-auto custom-scrollbar mb-6">
                <table class="w-full text-xs">
                    <thead class="sticky top-0 bg-white shadow-sm z-10 text-slate-500 border-b">
                        <tr>
                            ${th('name', 'Name', 'text-left')}
                            ${th('email', 'Email', 'text-left')}
                            ${th('country', 'Country', 'text-left')}
                            ${th('role', 'Role', 'text-left')}
                            ${th('posts', 'Posts', 'text-right')}
                            ${th('comments', 'Comments', 'text-right')}
                            ${th('likes', 'Likes', 'text-right')}
                            ${th('postsPlusComments', 'P + C', 'text-right')}
                            ${th('courses', 'Courses', 'text-right')}
                            ${th('completed', 'Completed', 'text-right')}
                            ${th('certificates', 'Certs', 'text-right')}
                            ${th('study_minutes', 'Study min', 'text-right')}
                        </tr>
                    </thead>
                    <tbody>
                        ${users.length === 0
                            ? '<tr><td colspan="12" class="py-6 text-center text-slate-400 italic">No users match this filter.</td></tr>'
                            : users.map(u => `<tr class="border-b hover:bg-slate-50">
                                <td class="py-1.5 px-3 font-medium text-gsf-prussian truncate" title="${this.escapeHtml(u.name)}" style="max-width:180px">${this.escapeHtml(u.name || '—')}</td>
                                <td class="py-1.5 px-3 text-slate-600 truncate" title="${this.escapeHtml(u.email)}" style="max-width:220px">${this.escapeHtml(u.email || '—')}</td>
                                <td class="py-1.5 px-3 text-slate-700">${this.escapeHtml(u.country || '—')}</td>
                                <td class="py-1.5 px-3 text-slate-500 text-[10px]">${this.escapeHtml(u.role || '—')}</td>
                                <td class="py-1.5 px-3 text-right font-bold text-gsf-boston">${this.formatNumber(u.posts || 0)}</td>
                                <td class="py-1.5 px-3 text-right">${this.formatNumber(u.comments || 0)}</td>
                                <td class="py-1.5 px-3 text-right text-slate-500">${this.formatNumber(u.likes || 0)}</td>
                                <td class="py-1.5 px-3 text-right font-medium">${this.formatNumber(u.postsPlusComments || 0)}</td>
                                <td class="py-1.5 px-3 text-right text-slate-500">${this.formatNumber(u.courses || 0)}</td>
                                <td class="py-1.5 px-3 text-right text-slate-500">${this.formatNumber(u.completed || 0)}</td>
                                <td class="py-1.5 px-3 text-right ${(u.certificates || 0) >= 3 ? 'text-green-700 font-bold' : 'text-slate-500'}">${this.formatNumber(u.certificates || 0)}</td>
                                <td class="py-1.5 px-3 text-right text-slate-500">${this.formatNumber(Math.round(u.study_minutes || 0))}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },
});
