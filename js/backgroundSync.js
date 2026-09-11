// ── Background sync: cards 2 and 3 refresh themselves while the app is open ────
// Once a day, at the first quiet moment after a chosen hour (default 02:00), the
// app runs the Learners & Ambassadors sync (card 3: demographics + lead
// attribution, then ambassadors) and the incremental Enrolments & progress sync
// (card 2: accounts active since the last completed run) — silently. No dialogs,
// no modal overlay: progress shows in a small pill in the corner (with a Stop
// link), and the Data Sync page carries the panel with the switch, the hour,
// the last run's summary and a Run-now button.
//
// Rules that keep it safe:
//   • Runs only where the LearnWorlds credentials are (device-local), so viewer
//     machines never sync; they keep pulling from Sheets as before.
//   • Never while another sync is running, never while the user is active
//     (3 minutes without input), once per calendar day.
//   • Card 2 only runs incrementally: if no full pass has ever completed, the
//     step is skipped with a note — a 30-hour first pass is never started
//     unattended. An interrupted (paused) run is resumed, checkpoint by
//     checkpoint, exactly as the button would.
//   • Uses the same sync functions as the buttons ({silent: true}), so what it
//     writes is identical; it writes nothing of its own but its settings and
//     run log (settings/bg_sync.json — device-local, never pushed or exported).
Object.assign(window.App, {
    BG_KEY: 'surgdash_bg_sync',
    BG_TICK_MS: 5 * 60 * 1000,      // scheduler heartbeat
    BG_IDLE_MS: 3 * 60 * 1000,      // no mouse / keyboard for this long = quiet moment
    BG_DEFAULT_HOUR: 2,             // earliest hour (local) a day's run may start

    _bgDefaults() { return { enabled: false, hour: this.BG_DEFAULT_HOUR, cards: { learners: true, enrolments: true }, lastRun: null, lastError: null, history: [] }; },
    async _bgLoad() {
        if (this._bgSettings) return this._bgSettings;
        let v = null; try { v = await Storage.getItem(this.BG_KEY); } catch (e) { __swallowed(e, 'bg.load'); }
        const d = this._bgDefaults();
        this._bgSettings = Object.assign(d, (v && typeof v === 'object') ? v : {}, { cards: Object.assign(d.cards, (v && v.cards) || {}) });
        return this._bgSettings;
    },
    async _bgSave() { try { await Storage.setItem(this.BG_KEY, this._bgSettings, { internal: true }); } catch (e) { __swallowed(e, 'bg.save'); } },
    async _bgSet(patch) {
        const s = await this._bgLoad();
        if (patch && patch.cards) { Object.assign(s.cards, patch.cards); delete patch.cards; }
        Object.assign(s, patch || {});
        if (typeof s.hour !== 'number' || s.hour < 0 || s.hour > 23) s.hour = this.BG_DEFAULT_HOUR;
        await this._bgSave();
        if (this.view === 'upload' && this.renderView) this.renderView();
    },

    // ── Scheduler ──
    _bgSyncStart() {
        if (this._bgStarted) return; this._bgStarted = true;
        this._bgLastInput = Date.now();
        try { ['pointermove', 'pointerdown', 'keydown', 'wheel'].forEach(ev => document.addEventListener(ev, () => { this._bgLastInput = Date.now(); }, { capture: true, passive: true })); } catch (e) { __swallowed(e, 'bg.idle'); }
        this._bgLoad().then(() => this._bgRefreshCreds()).catch(e => __swallowed(e, 'bg.start'));
        setTimeout(() => this._bgTick().catch(e => __swallowed(e, 'bg.tick')), 60 * 1000);
        this._bgInterval = setInterval(() => this._bgTick().catch(e => __swallowed(e, 'bg.tick')), this.BG_TICK_MS);
    },
    async _bgRefreshCreds() {
        try { const LW = window.LearnWorlds; const c = LW && LW.getCredentials ? await LW.getCredentials() : null; this._bgHasCreds = !!(c && c.clientId && c.apiToken); }
        catch (e) { this._bgHasCreds = false; }
        return this._bgHasCreds;
    },
    _bgDayKey(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
    _bgIdle(now) { return ((now || Date.now()) - (this._bgLastInput || 0)) >= this.BG_IDLE_MS; },
    // Due = not yet run today and the chosen hour has passed (so an app opened at 09:00 runs at its first quiet moment).
    _bgDue(s, now) {
        now = now || new Date();
        if (!s || !s.enabled) return false;
        if (now.getHours() < (typeof s.hour === 'number' ? s.hour : this.BG_DEFAULT_HOUR)) return false;
        if (s.lastRun && s.lastRun.day === this._bgDayKey(now)) return false;
        // A sync run by hand today (Sync Everything, or the cards' own buttons) counts as
        // today's run: every enabled card's stamp (surgdash_sync_log, UTC dates) is today's.
        const log = (this._syncLog && typeof this._syncLog === 'object') ? this._syncLog : {}, today = now.toISOString().slice(0, 10), cards = s.cards || {};
        const wanted = [cards.learners && 'learners', cards.enrolments && 'enrolments'].filter(Boolean);
        if (wanted.length && wanted.every(k => log[k] === today)) return false;
        return true;
    },
    async _bgTick() {
        const s = await this._bgLoad();
        if (!s.enabled || this._bgRunning || this._apiSyncInFlight) return false;
        if (!this._syncLog) { try { const v = await Storage.getItem('surgdash_sync_log'); this._syncLog = (v && typeof v === 'object') ? v : {}; } catch (e) { this._syncLog = {}; } }   // stamps of today's hand-run syncs
        if (!this._bgDue(s)) return false;
        if (!this._bgIdle()) return false;
        if (!(await this._bgRefreshCreds())) return false;
        await this._bgRun('scheduled');
        return true;
    },
    async _bgRunNow() {
        if (this._bgRunning || this._apiSyncInFlight) { this.showMsg('⚠ A sync is already running — let it finish or Cancel it first.'); return; }
        if (!(await this._bgRefreshCreds())) { this.showMsg('⚠ Add LearnWorlds API credentials first (Settings).'); return; }
        await this._bgRun('manual');
    },

    // ── The run ──
    async _bgRun(trigger) {
        const s = await this._bgLoad();
        const t0 = Date.now(), steps = [];
        this._bgRunning = true; this._bgSyncRunning = true; this._bgStep = '';
        this._bgProgress('Starting…', 0);
        const step = async (label, fn) => {
            this._bgStep = label; this._bgProgress('Starting…', null);
            const st = Date.now();
            try { const r = await fn(); steps.push({ label, ok: true, note: r || '', ms: Date.now() - st }); }
            catch (e) { const msg = String((e && e.message) || e || ''); steps.push({ label, ok: false, note: msg, ms: Date.now() - st }); console.warn('[bg-sync] ' + label + ' failed:', msg); if (/cancelled/i.test(msg)) throw e; }
        };
        try {
            if (s.cards.learners) {
                // Card 3, the same two stages the button runs, one after the other.
                this._apiSyncInFlight = true;
                try {
                    await step('Learners & demographics', async () => { const r = await this.syncDemographicsFromApi({ silent: true }); return r && r.totalUsers ? Number(r.totalUsers).toLocaleString() + ' accounts' : 'done'; });
                    await step('Ambassadors', async () => { const r = await this.syncAmbassadorsFromApi({ silent: true }); return r && r.totalReferrals != null ? Number(r.totalReferrals).toLocaleString() + ' referrals' : 'done'; });
                } finally { this._apiSyncInFlight = false; }
            }
            if (s.cards.enrolments) {
                await step('Enrolments & progress', async () => {
                    const meta = this._enrLoadMeta ? await this._enrLoadMeta() : {};
                    const open = meta.run && !meta.run.done;
                    if (!open && !meta.lastRunEpoch) return 'skipped — no full pass has completed yet; run card 2 once by hand';
                    const r = await this.syncEnrolmentsFromApi({ silent: true });
                    if (!r) return 'nothing to do';
                    const parts = [];
                    if (r.done) parts.push(Number(r.done).toLocaleString() + ' accounts refreshed');
                    if (r.ingestedOffline) parts.push(Number(r.ingestedOffline).toLocaleString() + ' from receipt');
                    if (r.certsNew) parts.push(Number(r.certsNew).toLocaleString() + ' new certificates');
                    if (r.mode) parts.unshift(r.mode + (r.resumed ? ', resumed' : ''));
                    return parts.join(' · ') || 'done';
                });
            }
        } catch (e) {
            steps.push({ label: 'Run', ok: false, note: 'stopped: ' + String((e && e.message) || e), ms: 0 });
        } finally {
            this._bgRunning = false; this._bgSyncRunning = false; this._apiSyncInFlight = false;
            this._bgHidePill();
        }
        const now = new Date();
        const okAll = steps.every(x => x.ok);
        s.lastRun = { at: now.toISOString(), day: this._bgDayKey(now), trigger, ok: okAll, ms: Date.now() - t0, steps };
        s.lastError = okAll ? null : steps.filter(x => !x.ok).map(x => x.label + ': ' + x.note).join(' · ');
        s.history = [s.lastRun].concat(s.history || []).slice(0, 7);
        await this._bgSave();
        // Numbers changed: refresh whatever is on screen (nothing is typed into at a quiet moment).
        if (this.renderView && (trigger === 'manual' || this._bgIdle())) { try { this.renderView(); } catch (e) { __swallowed(e, 'bg.render'); } }
        if (trigger === 'manual' && this.showMsg) this.showMsg(okAll ? '✓ Background sync finished — ' + steps.map(x => x.label + ': ' + x.note).join(' · ') : '⚠ Background sync finished with problems — ' + s.lastError, !okAll);
        return s.lastRun;
    },

    // ── Progress pill (replaces the modal overlay while a background run is on) ──
    _bgProgress(text, pct) {
        if (!document || !document.body) return;
        let el = document.getElementById('bg-sync-pill');
        if (!el) {
            el = document.createElement('div'); el.id = 'bg-sync-pill';
            el.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:9998;background:#0f172a;color:#e2e8f0;border-radius:999px;padding:8px 14px 8px 12px;font-size:12px;box-shadow:0 6px 24px rgba(0,0,0,.25);display:flex;align-items:center;gap:10px;max-width:520px;';
            el.innerHTML = '<span style="width:12px;height:12px;border:2px solid #4389C8;border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;flex:none"></span><span id="bg-sync-pill-text" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></span><button onclick="App.navigate(\'upload\')" style="background:transparent;border:none;color:#91B5D9;cursor:pointer;font-size:11px;font-weight:700">Details</button><button onclick="App.cancelLearnWorldsSync()" style="background:transparent;border:none;color:#fca5a5;cursor:pointer;font-size:11px;font-weight:700">Stop</button>';
            document.body.appendChild(el);
        }
        const t = document.getElementById('bg-sync-pill-text');
        if (t) t.textContent = 'Background sync · ' + (this._bgStep ? this._bgStep + ' — ' : '') + String(text || '') + (typeof pct === 'number' && pct > 0 ? ' (' + Math.round(pct) + '%)' : '');
    },
    _bgHidePill() { try { const el = document.getElementById('bg-sync-pill'); if (el) el.remove(); } catch (e) { __swallowed(e, 'bg.pill'); } },

    // ── Data Sync page panel ──
    _bgFmtWhen(iso) { const d = iso ? new Date(iso) : null; if (!d || isNaN(d)) return ''; return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); },
    _bgNextText(s) {
        const now = new Date(), hh = String(s.hour).padStart(2, '0') + ':00';
        if (this._bgRunning) return 'running now';
        if (this._bgDue(s, now)) return 'due — starts at the next quiet moment (3 min without input) while the app is open';
        const ranToday = s.lastRun && s.lastRun.day === this._bgDayKey(now);
        return (ranToday || now.getHours() >= s.hour ? 'tomorrow' : 'today') + ' from ' + hh + ', at the first quiet moment while the app is open';
    },
    _bgSyncPanelHtml() {
        const esc = (t) => this.escapeHtml(t);
        if (!this._bgSettings) { this._bgLoad().then(() => { if (this.view === 'upload' && this.renderView) this.renderView(); }); return ''; }
        const s = this._bgSettings, lr = s.lastRun;
        const hours = Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${s.hour === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('');
        const creds = this._bgHasCreds;
        const status = this._bgRunning
            ? `<span class="text-emerald-700 font-medium">Running — ${esc(this._bgStep || 'starting')}…</span>`
            : lr ? `<span class="${lr.ok ? 'text-slate-600' : 'text-amber-700'}">Last run ${esc(this._bgFmtWhen(lr.at))} (${lr.trigger === 'manual' ? 'Run now' : 'scheduled'}, ${Math.max(1, Math.round(lr.ms / 60000))} min): ${lr.steps.map(x => `${x.ok ? '✓' : '✗'} ${esc(x.label)}${x.note ? ' — ' + esc(x.note) : ''}`).join(' · ')}</span>`
            : '<span class="text-slate-400">Not run yet on this device.</span>';
        return `
                    <!-- ── Background sync: cards 2 + 3, nightly, silent ── -->
                    <div class="bg-white border ${s.enabled ? 'border-emerald-200' : 'border-slate-200'} rounded-2xl p-5 mb-4 shadow-sm">
                        <div class="flex flex-wrap items-center justify-between gap-4">
                            <div class="min-w-0">
                                <div class="flex flex-wrap items-center gap-2 mb-1">
                                    <i data-lucide="moon" width="18" class="${s.enabled ? 'text-emerald-600' : 'text-slate-400'}"></i>
                                    <h2 class="text-lg font-bold text-gsf-prussian">Background sync</h2>
                                    <span class="text-[10px] font-bold uppercase ${s.enabled ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-slate-500 bg-slate-100 border-slate-200'} border px-2 py-0.5 rounded-full">${s.enabled ? 'on · ' + (creds === false ? 'needs API credentials' : 'next: ' + esc(this._bgNextText(s))) : 'off'}</span>
                                </div>
                                <p class="text-sm text-slate-600 max-w-3xl">Once a day, at the first quiet moment after the chosen hour while the app is open, cards 3 and 2 run by themselves: Learners &amp; Ambassadors, then Enrolments &amp; progress incrementally (accounts active since the last completed pass). No dialogs; a small pill in the corner shows progress and can stop it. Only on the device that holds the API credentials.</p>
                                <p class="text-xs mt-2">${status}</p>
                                ${s.lastError && !this._bgRunning ? `<p class="text-xs text-amber-700 mt-1">Last problem: ${esc(s.lastError)}</p>` : ''}
                            </div>
                            <div class="flex flex-col items-end gap-2 shrink-0 text-xs">
                                <label class="inline-flex items-center gap-2 font-bold text-slate-700 cursor-pointer"><input type="checkbox" data-edit-only ${s.enabled ? 'checked' : ''} onchange="App._bgSet({ enabled: this.checked })"> Enabled</label>
                                <label class="inline-flex items-center gap-2 text-slate-600">From <select data-edit-only onchange="App._bgSet({ hour: Number(this.value) })" class="border rounded px-1.5 py-1">${hours}</select></label>
                                <div class="flex items-center gap-3 text-slate-600">
                                    <label class="inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" data-edit-only ${s.cards.learners ? 'checked' : ''} onchange="App._bgSet({ cards: { learners: this.checked } })"> Card 3</label>
                                    <label class="inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" data-edit-only ${s.cards.enrolments ? 'checked' : ''} onchange="App._bgSet({ cards: { enrolments: this.checked } })"> Card 2</label>
                                </div>
                                <button data-edit-only onclick="App._bgRunNow()" ${this._bgRunning ? 'disabled' : ''} class="px-3 py-1.5 border rounded-lg font-bold text-slate-600 hover:text-gsf-boston hover:bg-slate-50 disabled:opacity-40" title="Run both cards now, silently, the way the schedule would">Run now</button>
                            </div>
                        </div>
                    </div>
`;
    },
});
