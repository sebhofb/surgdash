// Preload script — exposes a controlled API to the renderer via contextBridge.
// With contextIsolation: true and nodeIntegration: false, the renderer cannot
// access Node.js directly. Only the methods below are available.

const { contextBridge, ipcRenderer, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

contextBridge.exposeInMainWorld('electronAPI', {

    // ── IPC (channel-allowlisted) ────────────────────────────────────────────
    invoke(channel, ...args) {
        const ALLOWED = [
            'generate-pdf', 'merge-pdfs', 'pick-folder', 'pick-pdf-file',
            'write-file', 'read-file', 'pick-xlsx-open-path', 'pick-json-open-path',
            'pick-geo-file', 'capture-page', 'clipboard-write-image',
            'pick-save-path', 'http-request'
        ];
        if (!ALLOWED.includes(channel)) {
            return Promise.reject(new Error(`IPC channel "${channel}" is not allowed`));
        }
        return ipcRenderer.invoke(channel, ...args);
    },

    // ── Shell — only http/https/mailto URLs ──────────────────────────────────
    openExternal(url) {
        try {
            const parsed = new URL(url);
            if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
                shell.openExternal(url);
            }
        } catch (_) { /* invalid URL — ignore */ }
    },

    // ── App paths ────────────────────────────────────────────────────────────
    appPath: path.resolve(__dirname),

    // ── Data profile ─────────────────────────────────────────────────────────
    // Data now lives under the per-app userData dir (see electronAPI.dataDir below
    // and main.js appDataDir()) — NOT ~/Documents. dataDirName is retained only for
    // the legacy fallback path in storage.js. A test profile (--data-profile=test)
    // isolates data into a separate 'data-test' folder for the fresh-install test.
    dataDirName: (() => {
        const p = (process.argv.find(a => a.startsWith('--data-profile=')) || '').split('=')[1] || '';
        return p ? ('SURGdash-' + p) : 'SURGdash';
    })(),
    isTestProfile: /--data-profile=.+/.test(process.argv.join(' ')),

    // Absolute data directory, resolved by main (now under userData, not ~/Documents).
    // Storage uses this verbatim; main owns the single source of truth + migration.
    dataDir: (() => {
        const PREFIX = '--surgdash-datadir=';
        const a = process.argv.find(x => x.startsWith(PREFIX));
        return a ? a.substring(PREFIX.length) : '';
    })(),

    // ── App version (single source of truth: package.json) ───────────────────
    appVersion: (() => { try { return require('./package.json').version; } catch (_) { return ''; } })(),

    // ── File-system (synchronous, matching the existing Storage API) ─────────
    fs: {
        existsSync(p)          { return fs.existsSync(p); },
        readFileSync(p, enc)   {
            if (enc) return fs.readFileSync(p, enc);
            // Binary: return ArrayBuffer (survives structured-clone)
            const buf = fs.readFileSync(p);
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        },
        writeFileSync(p, data, enc) {
            if (typeof data === 'string') {
                fs.writeFileSync(p, data, enc || 'utf8');
            } else {
                // Binary data (Uint8Array / ArrayBuffer from renderer)
                fs.writeFileSync(p, Buffer.from(data));
            }
        },
        unlinkSync(p)          { fs.unlinkSync(p); },
        mkdirSync(p, opts)     { fs.mkdirSync(p, opts); },
        readdirSync(dir, opts) {
            const entries = fs.readdirSync(dir, opts);
            if (opts && opts.withFileTypes) {
                // Dirent objects lose methods across contextBridge — flatten
                return entries.map(e => ({
                    name:        e.name,
                    isDirectory: e.isDirectory(),
                    isFile:      e.isFile()
                }));
            }
            return entries;
        },
        rmSync(p, opts)            { fs.rmSync(p, opts); },
        renameSync(oldP, newP)     { fs.renameSync(oldP, newP); },
        readFileBase64(p)          { return fs.readFileSync(p).toString('base64'); },
        appendFileSync(p, data, enc) { fs.appendFileSync(p, data, enc || 'utf8'); },
        statSync(p) {
            const s = fs.statSync(p);
            return { mtimeMs: s.mtimeMs, size: s.size };
        }
    },

    // ── Path utilities ───────────────────────────────────────────────────────
    path: {
        join(...args)    { return path.join(...args); },
        dirname(p)       { return path.dirname(p); },
        basename(p)      { return path.basename(p); },
        extname(p)       { return path.extname(p); },
        resolve(...args) { return path.resolve(...args); }
    },

    // ── OS utilities ─────────────────────────────────────────────────────────
    os: {
        homedir() { return os.homedir(); },
        tmpdir()  { return os.tmpdir(); }
    }
});
