// Global error capture. Loaded FIRST (before storage.js) so nothing can throw
// unobserved. Two jobs:
//   1. window.__swallowed(e, where) — the sink for former empty catch blocks.
//      Throttled per distinct error so a per-row parse failure can't flood the
//      console: the first occurrence logs, then every 100th.
//   2. Uncaught errors / unhandled rejections → console.error, one toast per 5 s,
//      and a rolling on-disk log (settings/error_log.json, last 200 entries) so a
//      "stuck" screen can be diagnosed after the fact instead of by guesswork.
//      settings/error_log.json has no storage key, so it is never enumerated,
//      backed up to Sheets, or exported.
(function () {
    const counts = new Map();
    const sig = (e) => { try { return String((e && (e.stack || e.message)) || e).slice(0, 240); } catch (_) { return 'unknown'; } };

    window.__swallowed = function (e, where) {
        const k = (where || '') + '|' + sig(e);
        const n = (counts.get(k) || 0) + 1;
        counts.set(k, n);
        if (n === 1 || n % 100 === 0) {
            console.warn('[swallowed' + (where ? ' ' + where : '') + (n > 1 ? ' ×' + n : '') + ']', e);
        }
    };

    let lastToast = 0;

    const persist = (kind, e) => {
        try {
            const api = window.electronAPI;
            if (!api || !api.fs || !api.path || !api.dataDir) return;
            const p = api.path.join(api.dataDir, 'settings', 'error_log.json');
            let arr = [];
            try { if (api.fs.existsSync(p)) arr = JSON.parse(api.fs.readFileSync(p, 'utf8')) || []; } catch (_) { arr = []; }
            arr.push({
                t: new Date().toISOString(),
                kind,
                msg: String((e && e.message) || e).slice(0, 500),
                stack: String((e && e.stack) || '').slice(0, 2000),
                view: (window.App && window.App.view) || '',
            });
            if (arr.length > 200) arr = arr.slice(-200);
            const dir = api.path.dirname(p);
            if (!api.fs.existsSync(dir)) api.fs.mkdirSync(dir, { recursive: true });
            api.fs.writeFileSync(p, JSON.stringify(arr), 'utf8');
        } catch (_) { /* logging must never throw */ }
    };

    const report = (kind, e) => {
        console.error('[' + kind + ']', e);
        persist(kind, e);
        try {
            const App = window.App;
            if (App && typeof App.showMsg === 'function' && Date.now() - lastToast > 5000) {
                lastToast = Date.now();
                App.showMsg('Something went wrong: ' + String((e && e.message) || e).slice(0, 160)
                    + ' — details are in the console (View → Toggle Developer Tools) and in settings/error_log.json.', true);
            }
        } catch (_) { /* never let the reporter itself throw */ }
    };

    window.addEventListener('error', (ev) => report('error', ev.error || ev.message));
    window.addEventListener('unhandledrejection', (ev) => report('unhandledrejection', ev.reason));
})();
