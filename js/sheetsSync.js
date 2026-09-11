// Google Sheets sync — the transport layer behind "Sync to Sheets" / "Pull".
//
// WHY THIS EXISTS (10–11 Sep 2026). The Sheet is a transport for ~150 MB of SURGhub
// JSON plus a dozen small SURGfund project tabs. The old push sent the blob as 36
// sequential 4.4 MB uploads of raw JSON (3,200 cells), rewrote every project tab on
// every push, had one attempt per request with a 90 s cap, and on a failed SURGhub
// part fell back to embedding all 150 MB in one request (which can never succeed).
// Pulls made the script parse 150 MB server-side and return it whole.
//
// NOW, against a script at SCRIPT_MIN_FAST or newer (see ?meta=1 → version):
//   • the SURGhub blob is gzip-compressed here (~10.7× smaller on the live data) and
//     sent as base64 text the script stores opaquely (MARK prefix) — 5 uploads, not 36;
//     the app inflates on pull, the script never parses it;
//   • every item carries a SHA-256 fingerprint; the script remembers the fingerprint of
//     what it holds, and an item whose fingerprint the server already has is skipped
//     (unchanged projects, the org summary, a SURGhub blob that no sync touched);
//   • transient failures are retried (network, timeout, HTML error pages, "failed while
//     accessing document"); SURGhub parts are written at explicit rows so a retry
//     overwrites instead of appending;
//   • a pull skips the SURGhub download entirely when the server's fingerprint equals
//     the one this device last pushed or pulled.
// Against an OLDER script everything falls back to the legacy protocol (raw JSON parts,
// no skipping, no retry on parts — a legacy retry would duplicate rows) and the summary
// says so, so the user knows to redeploy.
//
// Plain functions with injected I/O (http, storage, settings, progress) so the whole
// push/pull protocol runs in a Node harness against the real Apps Script code.
window.SheetsSync = (function () {
    'use strict';

    const MARK = 'SDGZ1:';                 // prefix of a compressed SURGhub blob (gzip → base64)
    const CELL_CHARS = 49000;              // Sheets cell limit is 50,000
    const SCRIPT_MIN_FAST = 3;             // script version that understands fingerprints, startRow, MARK, ?nosurghub
    const RETRY_WAITS_MS = [5000, 15000];  // between attempts (3 attempts total)
    const TRANSIENT_RE = /failed while accessing|service invoked too many times|too many requests|temporarily|timed? ?out|exceeded maximum|rate limit|internal error|backend error|service error|did not respond|network error|net::|ECONN|EAI_AGAIN|socket hang up/i;

    const cfg = {
        partRows: 90,                      // cell rows per upload (90 × 49,000 chars ≈ 4.4 MB of text)
        timeoutMs: 90000,                  // small requests (a project tab, the org summary, the backup)
        partTimeoutMs: 180000,             // a SURGhub part
        pullTimeoutMs: 300000,             // the whole pull
        metaTimeoutMs: 15000,
        attempts: 3,
        waitsMs: RETRY_WAITS_MS,
        sleep: (ms) => new Promise(r => setTimeout(r, ms)),
    };

    // ── bytes ─────────────────────────────────────────────────────────────────
    function bytesToBase64(u8) {
        let bin = '';
        for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + 0x8000, u8.length)));
        return btoa(bin);
    }
    function base64ToBytes(b64) {
        const bin = atob(b64), u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
    }
    async function gzip(u8) {
        const cs = new CompressionStream('gzip');
        const w = cs.writable.getWriter(); w.write(u8); w.close();
        return new Uint8Array(await new Response(cs.readable).arrayBuffer());
    }
    async function gunzip(u8) {
        const ds = new DecompressionStream('gzip');
        const w = ds.writable.getWriter(); w.write(u8); w.close();
        return new Uint8Array(await new Response(ds.readable).arrayBuffer());
    }
    async function sha256Hex(u8OrStr) {
        const u8 = typeof u8OrStr === 'string' ? new TextEncoder().encode(u8OrStr) : u8OrStr;
        const buf = await crypto.subtle.digest('SHA-256', u8);
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // JSON string → MARK + base64(gzip(utf8)). Also returns the fingerprint of the JSON.
    async function packBlob(json) {
        const u8 = new TextEncoder().encode(json);
        const [hash, gz] = await Promise.all([sha256Hex(u8), gzip(u8)]);
        return { text: MARK + bytesToBase64(gz), hash, rawBytes: u8.length, packedChars: 0 };
    }
    // MARK + base64 → JSON string (throws on anything that is not our format).
    async function unpackBlob(text) {
        if (typeof text !== 'string' || text.slice(0, MARK.length) !== MARK) throw new Error('not a packed blob');
        const u8 = await gunzip(base64ToBytes(text.slice(MARK.length)));
        return new TextDecoder('utf-8').decode(u8);
    }
    const isPacked = (v) => typeof v === 'string' && v.slice(0, MARK.length) === MARK;

    // Project payload fingerprint: the payload with its clock stamp blanked.
    async function payloadHash(obj) { return sha256Hex(JSON.stringify(Object.assign({}, obj, { syncedAt: '' }))); }

    // ── HTTP with retries ─────────────────────────────────────────────────────
    // http(req) → { statusCode, body, headers?, error? } (electronAPI.invoke('http-request', req)).
    function _classify(res) {
        if (!res) return { kind: 'transient', message: 'no response' };
        if (res.error) return { kind: TRANSIENT_RE.test(res.error) || /timed out/i.test(res.error) ? 'transient' : 'transient', message: res.error };
        let r;
        try { r = JSON.parse(res.body); } catch (_) {
            const b = String(res.body || '');
            if (/<html|<!doctype/i.test(b)) return { kind: 'transient', message: 'the script returned an HTML page (' + (res.statusCode || '?') + ')' };
            return { kind: 'transient', message: 'invalid response (' + (res.statusCode || '?') + '): ' + b.slice(0, 120).replace(/\s+/g, ' ') };
        }
        if (r && r.ok === false) return { kind: TRANSIENT_RE.test(String(r.error || '')) ? 'transient' : 'fatal', message: r.error || 'Script returned an error' };
        return { kind: 'ok', value: r };
    }
    async function request(http, req, opts) {
        opts = opts || {};
        const attempts = Math.max(1, opts.attempts != null ? opts.attempts : cfg.attempts);
        const timeoutMs = opts.timeoutMs || cfg.timeoutMs;
        let last = null;
        for (let a = 0; a < attempts; a++) {
            let res;
            try {
                res = await Promise.race([
                    http(Object.assign({}, req, { timeoutMs })),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('Google Sheets did not respond within ' + Math.round(timeoutMs / 1000) + ' s')), timeoutMs + 500)),
                ]);
            } catch (e) { res = { error: String((e && e.message) || e) }; }
            const c = _classify(res);
            if (c.kind === 'ok') return c.value;
            last = c;
            if (c.kind === 'fatal' || a === attempts - 1) break;
            const wait = (opts.waitsMs || cfg.waitsMs)[Math.min(a, (opts.waitsMs || cfg.waitsMs).length - 1)];
            if (opts.onRetry) opts.onRetry(c.message, a + 1, wait);
            await cfg.sleep(wait);
        }
        const err = new Error(last.message + (attempts > 1 && last.kind !== 'fatal' ? ' (after ' + attempts + ' attempts)' : ''));
        err.kind = last.kind;
        throw err;
    }
    const post = (http, url, body, opts) => request(http, { url, method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, opts);
    const get = (http, url, opts) => request(http, { url, method: 'GET' }, opts);

    // ── server capabilities (?meta=1) ─────────────────────────────────────────
    // → { version, hashes: { projects: {id: hash}, org, surghub }, lastModified, fast, reason? }
    async function serverInfo(http, url) {
        const info = { version: 0, hashes: { projects: {}, org: '', surghub: '' }, lastModified: '', fast: false };
        let r;
        try { r = await get(http, url + (url.indexOf('?') >= 0 ? '&' : '?') + 'meta=1', { attempts: 2, timeoutMs: cfg.metaTimeoutMs, waitsMs: [2000] }); }
        catch (e) { info.reason = 'unreachable: ' + e.message; return info; }
        if (!r || !r.meta) { info.reason = 'no ?meta endpoint (script older than 2.0.6)'; return info; }
        info.version = Number(r.version) || 2;
        info.lastModified = r.lastModified || '';
        if (r.hashes && typeof r.hashes === 'object') {
            info.hashes.projects = (r.hashes.projects && typeof r.hashes.projects === 'object') ? r.hashes.projects : {};
            info.hashes.org = r.hashes.org || ''; info.hashes.surghub = r.hashes.surghub || '';
        }
        info.fast = info.version >= SCRIPT_MIN_FAST;
        if (!info.fast) info.reason = 'script version ' + info.version + ' — redeploy for the fast sync';
        return info;
    }

    // ── push ──────────────────────────────────────────────────────────────────
    // ctx: { url, http, projects: [{ id, name, shortName }], buildPayload(p) → JSON string,
    //        collect() → { surghubStorage, rawStorage, appSettings, customQualityKpis },
    //        progress(text, pct), log(msg), force? }
    // → summary (never throws for per-item failures; errors[] lists them).
    async function push(ctx) {
        const t0 = Date.now(), http = ctx.http, url = ctx.url;
        const progress = ctx.progress || (() => {}), log = ctx.log || (() => {});
        const s = { ok: false, fast: false, serverVersion: 0, syncedAt: new Date().toISOString(), errors: [],
                    projects: { pushed: [], skipped: [], failed: [] }, org: 'pending', surghub: 'pending', backup: 'pending',
                    surghubHash: '', surghubParts: 0, surghubBytes: 0, surghubPackedChars: 0, ms: 0, retries: 0, truncated: [] };
        const onRetry = (msg, n, wait) => { s.retries++; log('[Sheets] ' + msg + ' — retrying in ' + Math.round(wait / 1000) + ' s (attempt ' + (n + 1) + ')'); progress('Retrying after: ' + msg + '…', null); };
        progress('Checking the Google Apps Script…', 1);
        const info = await serverInfo(http, url);
        s.fast = info.fast; s.serverVersion = info.version; s.serverReason = info.reason || '';
        const total = ctx.projects.length + 3;
        const allPayloads = [], hashes = [];

        // 1. projects — each tab rewritten only when its payload changed
        for (let i = 0; i < ctx.projects.length; i++) {
            const p = ctx.projects[i], label = p.shortName || p.name || p.id;
            progress('Project ' + (i + 1) + '/' + ctx.projects.length + ': ' + label, ((i + 1) / total) * 100);
            try {
                const obj = JSON.parse(await ctx.buildPayload(p));
                obj.id = p.id;
                const h = await payloadHash(obj); obj.hash = h;
                allPayloads.push(obj); hashes.push(h);
                if (obj._truncated && (obj._truncated.events || obj._truncated.kpiLog)) s.truncated.push(obj.name || obj.shortName || p.id);
                if (s.fast && !ctx.force && info.hashes.projects[p.id] === h) { s.projects.skipped.push(p.id); continue; }
                await post(http, url, JSON.stringify(obj), { onRetry });
                s.projects.pushed.push(p.id);
            } catch (e) { s.projects.failed.push(p.id); s.errors.push((p.name || p.id) + ': ' + e.message); log('[Sheets] project failed: ' + label + ' — ' + e.message); }
        }

        // 2. organisation summary — depends on every project payload
        progress('Organisation summary…', ((ctx.projects.length + 1) / total) * 100);
        try {
            const orgHash = await sha256Hex(hashes.join('|') + '|' + hashes.length);
            if (s.fast && !ctx.force && s.projects.failed.length === 0 && info.hashes.org === orgHash) s.org = 'skipped';
            else { await post(http, url, JSON.stringify({ type: 'org_summary', generatedAt: new Date().toLocaleString(), projects: allPayloads, hash: orgHash }), { onRetry }); s.org = 'pushed'; }
        } catch (e) { s.org = 'failed'; s.errors.push('Organisation summary: ' + e.message); }

        // 3. SURGhub blob + 4. slim backup
        let collected = null;
        try { collected = await ctx.collect(); } catch (e) { s.errors.push('Reading local data: ' + e.message); }
        if (collected) {
            try {
                const json = JSON.stringify(collected.surghubStorage || {});
                let text, hash;
                if (s.fast) {
                    progress('Compressing SURGhub data (' + Math.round(json.length / 1048576) + ' MB)…', ((ctx.projects.length + 1.5) / total) * 100);
                    const packed = await packBlob(json); text = packed.text; hash = packed.hash; s.surghubBytes = packed.rawBytes;
                } else { text = json; hash = await sha256Hex(json); s.surghubBytes = json.length; }
                s.surghubHash = hash; s.surghubPackedChars = text.length;
                if (s.fast && !ctx.force && info.hashes.surghub === hash) s.surghub = 'skipped';
                else {
                    const PART = CELL_CHARS * cfg.partRows, totalParts = Math.max(1, Math.ceil(text.length / PART)), totalRows = Math.max(1, Math.ceil(text.length / CELL_CHARS));
                    s.surghubParts = totalParts;
                    for (let p = 0; p < totalParts; p++) {
                        progress('SURGhub data: part ' + (p + 1) + '/' + totalParts + (s.fast ? ' (compressed)' : ''), ((ctx.projects.length + 1.5 + (p + 1) / (totalParts + 1)) / total) * 100);
                        const body = { type: 'surghub_chunk', part: p + 1, totalParts, syncedAt: s.syncedAt, data: text.slice(p * PART, (p + 1) * PART) };
                        if (s.fast) { body.startRow = 2 + p * cfg.partRows; body.totalRows = totalRows; body.format = 'gz64'; body.hash = hash; }
                        // Legacy scripts append at the last row: a retry there would duplicate rows, so one attempt only.
                        await post(http, url, JSON.stringify(body), { onRetry, timeoutMs: cfg.partTimeoutMs, attempts: s.fast ? cfg.attempts : 1 });
                    }
                    s.surghub = 'pushed';
                }
            } catch (e) { s.surghub = 'failed'; s.errors.push('SURGhub data: ' + e.message + ' — nothing was lost locally; run Sync again.'); }
            progress('Backup…', ((ctx.projects.length + 2.6) / total) * 100);
            try {
                await post(http, url, JSON.stringify({ type: 'full_backup', syncedAt: s.syncedAt, appSettings: collected.appSettings || {}, customQualityKpis: collected.customQualityKpis || [], projects: allPayloads, rawStorage: collected.rawStorage || {} }), { onRetry, timeoutMs: cfg.partTimeoutMs });
                s.backup = 'pushed';
            } catch (e) { s.backup = 'failed'; s.errors.push('Backup: ' + e.message); }
        } else { s.surghub = 'failed'; s.backup = 'failed'; }

        s.ok = s.errors.length === 0; s.ms = Date.now() - t0;
        return s;
    }

    // Human summary line for the toast.
    function describe(s) {
        const parts = [];
        const np = s.projects.pushed.length, ns = s.projects.skipped.length;
        parts.push(np ? np + ' project' + (np === 1 ? '' : 's') + ' updated' + (ns ? ' (' + ns + ' unchanged)' : '') : (ns ? ns + ' projects unchanged' : 'no projects'));
        if (s.org === 'pushed') parts.push('org summary'); else if (s.org === 'skipped') parts.push('org summary unchanged');
        if (s.surghub === 'pushed') parts.push('SURGhub data ' + (s.fast ? Math.round(s.surghubBytes / 1048576) + ' MB → ' + (s.surghubPackedChars / 1048576).toFixed(1) + ' MB in ' + s.surghubParts + ' part' + (s.surghubParts === 1 ? '' : 's') : Math.round(s.surghubBytes / 1048576) + ' MB in ' + s.surghubParts + ' parts'));
        else if (s.surghub === 'skipped') parts.push('SURGhub data unchanged');
        if (s.backup === 'pushed') parts.push('backup');
        const secs = Math.round(s.ms / 1000);
        let line = parts.join(' · ') + ' — ' + (secs >= 90 ? Math.round(secs / 60) + ' min' : secs + ' s');
        if (s.retries) line += ' · ' + s.retries + ' retr' + (s.retries === 1 ? 'y' : 'ies');
        if (s.truncated.length) line += '\nNote: events/log trimmed for the Sheets tab: ' + s.truncated.join(', ') + '. Full data is in the backup.';
        if (!s.fast) line += '\nSlow protocol: ' + (s.serverReason || 'old script') + '. Settings → Google Sheets → Copy Script → redeploy the Web App for the fast sync.';
        return line;
    }

    // ── pull helpers ──────────────────────────────────────────────────────────
    // Decide whether the SURGhub blob needs downloading at all.
    // → { skip: bool, reason: 'unchanged'|'dirty'|'', info }
    async function pullPlan(http, url, opts) {
        opts = opts || {};
        const info = await serverInfo(http, url);
        if (!info.fast) return { skip: false, reason: '', info };
        if (opts.localDirty && opts.silent) return { skip: true, reason: 'dirty', info };
        if (opts.localHash && info.hashes.surghub && info.hashes.surghub === opts.localHash) return { skip: true, reason: 'unchanged', info };
        return { skip: false, reason: '', info };
    }
    // GET the mirror; a packed SURGhub blob is inflated + parsed here so callers see an object.
    async function fetchMirror(http, url, opts) {
        opts = opts || {};
        const u = url + (url.indexOf('?') >= 0 ? '&' : '?') + (opts.nosurghub ? 'nosurghub=1' : 'full=1');
        const r = await get(http, u, { timeoutMs: opts.timeoutMs || cfg.pullTimeoutMs, attempts: opts.attempts != null ? opts.attempts : 2, waitsMs: [5000], onRetry: opts.onRetry });
        if (isPacked(r.surghubStorage)) {
            try { r.surghubStorage = JSON.parse(await unpackBlob(r.surghubStorage)); }
            catch (e) { r.surghubError = 'SURGhub data could not be unpacked (' + e.message + ') — kept the local copy'; delete r.surghubStorage; }
        } else if (typeof r.surghubStorage === 'string') { r.surghubError = 'SURGhub data in an unknown format — kept the local copy'; delete r.surghubStorage; }
        return r;
    }

    return { MARK, CELL_CHARS, SCRIPT_MIN_FAST, cfg, bytesToBase64, base64ToBytes, gzip, gunzip, sha256Hex, packBlob, unpackBlob, isPacked, payloadHash, request, post, get, serverInfo, push, describe, pullPlan, fetchMirror, _classify };
})();
