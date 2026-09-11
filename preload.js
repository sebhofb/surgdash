// Preload script — exposes a controlled API to the renderer via contextBridge.
// With contextIsolation: true and nodeIntegration: false, the renderer cannot
// access Node.js directly. Only the methods below are available.

const { contextBridge, ipcRenderer, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Path guard ───────────────────────────────────────────────────────────────
// The fs bridge below is the renderer's only route to the disk, so it is the
// place to bound it. main.js already refuses dialog-less writes outside $HOME
// (isPathSafe); this applies the same rule here so a renderer bug or XSS
// cannot become an arbitrary delete. Reads may additionally touch the app
// bundle (vendored assets, the canonical Apps Script) and any file the user
// picked through a native dialog; writes may additionally target a folder or
// save path the user picked. Grants are per-session and per-path.
const HOME = os.homedir();
const TMP  = os.tmpdir();
const APP  = path.resolve(__dirname);
const DATA = (() => { const a = process.argv.find(x => x.startsWith('--surgdash-datadir=')); return a ? path.resolve(a.substring('--surgdash-datadir='.length)) : ''; })();
const grantedRead  = new Set();   // exact files picked via open dialogs
const grantedWrite = new Set();   // folders / save paths picked via dialogs
const openFds      = new Set();   // fds opened via fs.openSync below — read-only, chunked reads of files past V8's string limit
const within = (p, root) => { if (!root) return false; const r = path.resolve(p); return r === root || r.startsWith(root + path.sep); };
const readOK = (p) => typeof p === 'string' && p.length > 0 && (
    within(p, HOME) || within(p, TMP) || within(p, DATA) || within(p, APP)
    || grantedRead.has(path.resolve(p)) || [...grantedWrite].some(r => within(p, r)));
const writeOK = (p) => typeof p === 'string' && p.length > 0 && (
    within(p, HOME) || within(p, TMP) || within(p, DATA) || [...grantedWrite].some(r => within(p, r)));
// Never let a recursive delete land on a root we allow writes under.
const ROOTS = new Set([HOME, TMP, DATA, path.join(HOME, 'Library'), path.join(HOME, 'Documents'), path.join(HOME, 'Desktop')].filter(Boolean).map(p => path.resolve(p)));
const denyR = (p) => { throw new Error('Read blocked outside allowed directories: ' + p); };
const denyW = (p) => { throw new Error('Write blocked outside allowed directories: ' + p); };
const PICK_FILE   = new Set(['pick-pdf-file', 'pick-xlsx-open-path', 'pick-json-open-path', 'pick-geo-file']);
const PICK_TARGET = new Set(['pick-folder', 'pick-save-path']);

contextBridge.exposeInMainWorld('electronAPI', {

    // ── IPC (channel-allowlisted) ────────────────────────────────────────────
    invoke(channel, ...args) {
        const ALLOWED = [
            'generate-pdf', 'merge-pdfs', 'pick-folder', 'pick-pdf-file',
            'write-file', 'read-file', 'pick-xlsx-open-path', 'pick-json-open-path',
            'pick-geo-file', 'capture-page', 'clipboard-write-image', 'clipboard-write-text',
            'pick-save-path', 'http-request'
        ];
        if (!ALLOWED.includes(channel)) {
            return Promise.reject(new Error(`IPC channel "${channel}" is not allowed`));
        }
        // A path the user just chose in a native dialog is, by that act, granted:
        // read for opened files, write for chosen folders / save targets.
        return ipcRenderer.invoke(channel, ...args).then((res) => {
            if (typeof res === 'string' && res) {
                if (PICK_FILE.has(channel))   grantedRead.add(path.resolve(res));
                if (PICK_TARGET.has(channel)) grantedWrite.add(path.resolve(res));
            }
            return res;
        });
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
        // existsSync is used as a probe everywhere, so a blocked path reads as
        // "absent" rather than throwing.
        existsSync(p)          { return readOK(p) ? fs.existsSync(p) : false; },
        readFileSync(p, enc)   {
            if (!readOK(p)) denyR(p);
            if (enc) return fs.readFileSync(p, enc);
            // Binary: return ArrayBuffer (survives structured-clone)
            const buf = fs.readFileSync(p);
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        },
        writeFileSync(p, data, enc) {
            if (!writeOK(p)) denyW(p);
            if (typeof data === 'string') {
                fs.writeFileSync(p, data, enc || 'utf8');
            } else {
                // Binary data (Uint8Array / ArrayBuffer from renderer)
                fs.writeFileSync(p, Buffer.from(data));
            }
        },
        unlinkSync(p)          { if (!writeOK(p)) denyW(p); fs.unlinkSync(p); },
        mkdirSync(p, opts)     { if (!writeOK(p)) denyW(p); fs.mkdirSync(p, opts); },
        // Same-volume hard link (used by the pre-sync backup so an unchanged
        // 40 MB dataset costs no disk); callers fall back to copy on failure.
        linkSync(src, dest)    { if (!readOK(src)) denyR(src); if (!writeOK(dest)) denyW(dest); fs.linkSync(src, dest); },
        copyFileSync(src, dest){ if (!readOK(src)) denyR(src); if (!writeOK(dest)) denyW(dest); fs.copyFileSync(src, dest); },
        readdirSync(dir, opts) {
            if (!readOK(dir)) denyR(dir);
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
        rmSync(p, opts) {
            if (!writeOK(p)) denyW(p);
            if (ROOTS.has(path.resolve(p))) throw new Error('Refusing to remove a root directory: ' + p);
            fs.rmSync(p, opts);
        },
        renameSync(oldP, newP)     { if (!writeOK(oldP)) denyW(oldP); if (!writeOK(newP)) denyW(newP); fs.renameSync(oldP, newP); },
        readFileBase64(p)          { if (!readOK(p)) denyR(p); return fs.readFileSync(p).toString('base64'); },
        appendFileSync(p, data, enc) { if (!writeOK(p)) denyW(p); fs.appendFileSync(p, data, enc || 'utf8'); },
        statSync(p) {
            if (!readOK(p)) denyR(p);
            const s = fs.statSync(p);
            return { mtimeMs: s.mtimeMs, size: s.size };
        },
        // Chunked, read-only access for files that outgrow V8's ~512 MB string
        // limit (a raw API receipt reaches ~1 GB per sync session). readSync
        // returns an exact-length Uint8Array (structured-clone copy); only fds
        // opened here can be read or closed.
        openSync(p) {
            if (!readOK(p)) denyR(p);
            const fd = fs.openSync(p, 'r'); openFds.add(fd); return fd;
        },
        readSync(fd, length, position) {
            if (!openFds.has(fd)) throw new Error('readSync: fd was not opened through openSync');
            const len = Math.max(0, Math.min(Number(length) || 0, 64 * 1024 * 1024));
            const buf = Buffer.allocUnsafe(len);
            const n = fs.readSync(fd, buf, 0, len, position == null ? null : Number(position));
            return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + n));
        },
        closeSync(fd) { if (!openFds.has(fd)) return; openFds.delete(fd); fs.closeSync(fd); }
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
