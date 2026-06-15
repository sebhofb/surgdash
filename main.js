const { app, BrowserWindow, ipcMain, dialog, net, clipboard, nativeImage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow;

// ── Path safety: restrict file IPC to home + tmp directories ─────────────
function isPathSafe(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const resolved = path.resolve(filePath);
  const home = os.homedir();
  const tmp  = os.tmpdir();
  return resolved.startsWith(home + path.sep) || resolved.startsWith(tmp + path.sep)
      || resolved === home || resolved === tmp;
}

// Tracks whether the user has confirmed the close (or there's nothing to confirm).
// While false, the close handler intercepts and asks. Once true, normal quit proceeds.
let allowClose = false;
// Tracks whether a close-prompt is already in flight (avoid stacking dialogs if the
// user spams Cmd+Q while a dialog is showing).
let closeRequestInFlight = false;

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 900,
    title: "SURGdash \u00A9",
    icon: path.join(__dirname, 'build', 'gsf_logo_symbol.png'),
    show: false,
    backgroundColor: '#002F4C',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Start the splash's minimum-visible timer from the moment the window is
    // actually on screen — the renderer can't reliably detect window-show on
    // its own, and fading off a load-timer makes the splash invisible.
    mainWindow.webContents.executeJavaScript('window.__armSplash && window.__armSplash()').catch(() => {});
  });

  // \u2500\u2500 Unsynced-changes warning on close \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // Ask the renderer whether there are local changes that haven't been pushed
  // to Google Sheets. If yes, prompt the user with Sync / Quit Anyway / Cancel.
  // Triggers: red traffic-light, Cmd+W, Cmd+Q, app.quit().
  mainWindow.on('close', (e) => {
    if (allowClose) return;            // already confirmed \u2014 let close proceed
    if (closeRequestInFlight) { e.preventDefault(); return; } // dialog already showing
    e.preventDefault();
    handleCloseRequest();
  });
}

// On macOS, Cmd+Q triggers `before-quit` first. We must preventDefault on that
// too; otherwise the app starts shutting down before our async dialog finishes,
// leaving the process in a half-quit zombie state. Once the user has confirmed,
// `allowClose` is set and `app.quit()` is called explicitly.
app.on('before-quit', (e) => {
  if (allowClose) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (closeRequestInFlight) { e.preventDefault(); return; }
  e.preventDefault();
  handleCloseRequest();
});

async function handleCloseRequest() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    allowClose = true;
    app.quit();
    return;
  }
  if (closeRequestInFlight) return;
  closeRequestInFlight = true;

  try {
    let hasUnsynced = false;
    try {
      hasUnsynced = await mainWindow.webContents.executeJavaScript(
        'window.App && App._hasUnsyncedChanges ? App._hasUnsyncedChanges() : false'
      );
    } catch (_) { /* renderer may already be gone \u2014 fail-open and quit */ }

    if (!hasUnsynced) {
      allowClose = true;
      app.quit();
      return;
    }

    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Sync & Quit', 'Quit Anyway', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Unsynced changes',
      message: 'You have unsynced changes.',
      detail: 'These changes haven\'t been pushed to Google Sheets yet. Your colleagues won\'t see them until you sync.\n\nWhat would you like to do?'
    });

    if (choice === 2) return;             // Cancel \u2014 keep app open
    if (choice === 1) {                    // Quit Anyway
      allowClose = true;
      app.quit();
      return;
    }
    // Sync & Quit
    try {
      await mainWindow.webContents.executeJavaScript(
        'window.GenericViews && GenericViews._syncToSheets ? GenericViews._syncToSheets() : Promise.resolve()'
      );
    } catch (e) {
      const retry = dialog.showMessageBoxSync(mainWindow, {
        type: 'error',
        buttons: ['Quit Anyway', 'Cancel'],
        defaultId: 1, cancelId: 1,
        title: 'Sync failed',
        message: 'Couldn\'t push changes to the cloud.',
        detail: 'Error: ' + (e && e.message ? e.message : 'unknown') + '\n\nQuit anyway? Your changes are still saved locally and will be uploaded next time you Sync.'
      });
      if (retry === 1) {
        allowClose = true;
        app.quit();
      }
      return;
    }
    allowClose = true;
    app.quit();
  } finally {
    closeRequestInFlight = false;
  }
}

// ===== Auto-update (packaged builds only) =====
// Checks GitHub Releases shortly after launch (and every 6h). Downloads in the
// background; offers a restart when ready, and otherwise installs silently on the
// next quit. Never blocks the app — an offline/unreachable feed is swallowed, so
// SURGdash still works with no network. Users can also trigger a check on demand
// from the app menu → "Check for Updates…" (see buildAppMenu).
let autoUpdater = null;
let manualUpdateCheck = false;   // true while a user-initiated check is in flight (controls feedback dialogs)

function initAutoUpdate() {
  if (!app.isPackaged) return;                 // no-op in `electron .` dev
  try { ({ autoUpdater } = require('electron-updater')); }
  catch (e) { console.warn('[update] electron-updater unavailable:', e && e.message); return; }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;     // apply on next quit even if "Later" is chosen

  autoUpdater.on('error', (err) => {
    console.warn('[update] check failed (ignored):', err == null ? 'unknown' : (err.message || String(err)));
    if (manualUpdateCheck && mainWindow && !mainWindow.isDestroyed()) {
      manualUpdateCheck = false;
      dialog.showMessageBox(mainWindow, {
        type: 'warning', buttons: ['OK'], title: 'Update check failed',
        message: "Couldn't check for updates right now.",
        detail: 'Please check your internet connection and try again shortly.'
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    if (manualUpdateCheck && mainWindow && !mainWindow.isDestroyed()) {
      manualUpdateCheck = false;
      dialog.showMessageBox(mainWindow, {
        type: 'info', buttons: ['OK'], title: 'You’re up to date',
        message: 'SURGdash v' + app.getVersion() + ' is the latest version.'
      });
    }
  });

  autoUpdater.on('update-available', (info) => {
    if (manualUpdateCheck && mainWindow && !mainWindow.isDestroyed()) {
      const v = (info && info.version) ? ('v' + info.version) : 'A new version';
      dialog.showMessageBox(mainWindow, {
        type: 'info', buttons: ['OK'], title: 'Update available',
        message: v + ' is available and downloading now.',
        detail: 'You’ll be prompted to restart as soon as it’s ready — usually under a minute.'
      });
      // leave manualUpdateCheck set; the download completes into 'update-downloaded' (restart prompt)
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    manualUpdateCheck = false;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const v = (info && info.version) ? ('v' + info.version) : 'A new version';
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: v + ' of SURGdash is ready to install.',
      detail: 'Restart to apply it now, or it will install automatically the next time you quit.'
    });
    if (choice === 0) setImmediate(() => autoUpdater.quitAndInstall());
  });

  const check = () => { try { autoUpdater.checkForUpdates().catch(() => {}); } catch (e) {} };
  setTimeout(check, 8000);                       // after first paint, not before
  setInterval(check, 6 * 60 * 60 * 1000);        // every 6 hours while open
}

// User-initiated check from the app menu — gives explicit feedback, unlike the
// silent background checks.
function checkForUpdatesManually() {
  if (!app.isPackaged) {
    if (mainWindow && !mainWindow.isDestroyed()) dialog.showMessageBox(mainWindow, {
      type: 'info', buttons: ['OK'], title: 'Check for Updates',
      message: 'Auto-update only runs in the installed app.',
      detail: 'This is a development build; the packaged SURGdash app checks GitHub automatically.'
    });
    return;
  }
  if (!autoUpdater) return;
  manualUpdateCheck = true;
  try { autoUpdater.checkForUpdates().catch(() => {}); } catch (e) {}
}

// Standard macOS menu + a "Check for Updates…" item. Keeps the default
// copy/paste/quit/window shortcuts via roles.
function buildAppMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => checkForUpdatesManually() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  createWindow();
  buildAppMenu();
  initAutoUpdate();
});

app.on('window-all-closed', () => {
  // Always quit when the window closes — including macOS. SURGdash is a
  // single-window data app with no menu/tray UX to justify staying alive.
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ===== IPC: PDF Report Generation =====

ipcMain.handle('generate-pdf', async (event, { html, outputPath }) => {
  let win = null;
  let tempHtmlPath = null;
  try {
    // Write HTML to temp file (data: URLs have size limits and block CDN scripts)
    tempHtmlPath = path.join(os.tmpdir(), 'surghub_report_' + Date.now() + '.html');
    fs.writeFileSync(tempHtmlPath, html, 'utf8');

    win = new BrowserWindow({
      width: 960,
      height: 1200,
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    await win.loadFile(tempHtmlPath);

    // Wait for Google Charts to load and render (max 30 s)
    let ready = false;
    const MAX_POLLS = 60;
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise(r => setTimeout(r, 500));
      const title = await win.webContents.executeJavaScript('document.title');
      if (title === 'READY') { ready = true; break; }
    }

    if (!ready) {
      console.warn('PDF generation: page did not signal READY within timeout — proceeding anyway');
    }

    // Extra buffer for chart rendering to finish
    await new Promise(r => setTimeout(r, 2000));

    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    });

    fs.writeFileSync(outputPath, pdfBuffer);
    return { success: true, path: outputPath };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    if (win) win.destroy();
    if (tempHtmlPath) try { fs.unlinkSync(tempHtmlPath); } catch(e) {}
  }
});

ipcMain.handle('merge-pdfs', async (event, { reportPdfPath, coverPath, backPath, outputPath }) => {
  try {
    const { PDFDocument } = require('pdf-lib');
    const merged = await PDFDocument.create();

    // Add cover if provided
    if (coverPath && fs.existsSync(coverPath)) {
      const coverBytes = fs.readFileSync(coverPath);
      const coverDoc = await PDFDocument.load(coverBytes);
      const pages = await merged.copyPages(coverDoc, coverDoc.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    }

    // Add report
    const reportBytes = fs.readFileSync(reportPdfPath);
    const reportDoc = await PDFDocument.load(reportBytes);
    const reportPages = await merged.copyPages(reportDoc, reportDoc.getPageIndices());
    reportPages.forEach(p => merged.addPage(p));

    // Add back page if provided
    if (backPath && fs.existsSync(backPath)) {
      const backBytes = fs.readFileSync(backPath);
      const backDoc = await PDFDocument.load(backBytes);
      const pages = await merged.copyPages(backDoc, backDoc.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    }

    const mergedBytes = await merged.save();
    fs.writeFileSync(outputPath, mergedBytes);

    // Clean up temp report
    if (reportPdfPath !== outputPath) {
      try { fs.unlinkSync(reportPdfPath); } catch(e) {}
    }

    return { success: true, path: outputPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select folder for reports'
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('pick-pdf-file', async (event, title) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    title: title || 'Select PDF file'
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('write-file', async (event, { filePath, content }) => {
  if (!isPathSafe(filePath)) {
    return { success: false, error: 'Path is outside allowed directories' };
  }
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('read-file', async (event, filePath) => {
  if (!isPathSafe(filePath)) {
    return { success: false, error: 'Path is outside allowed directories' };
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { success: true, content };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('pick-xlsx-open-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
    title: 'Open SURGdash Intake Sheet'
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('pick-json-open-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'JSON Backup', extensions: ['json'] }],
    title: 'Open SURGdash Backup'
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('pick-geo-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Geo Files', extensions: ['kml', 'geojson', 'json'] }],
    title: 'Import KML or GeoJSON'
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('capture-page', async (event, rect) => {
  try {
    const image = await mainWindow.webContents.capturePage({
      x: rect.x, y: rect.y, width: rect.width, height: rect.height
    });
    return image.toDataURL();
  } catch (e) {
    console.error('capture-page error:', e);
    return null;
  }
});

ipcMain.handle('clipboard-write-image', async (event, dataUrl) => {
  try {
    const img = nativeImage.createFromDataURL(dataUrl);
    clipboard.writeImage(img);
    return true;
  } catch (e) {
    console.error('clipboard-write-image error:', e);
    return false;
  }
});

ipcMain.handle('pick-save-path', async (event, defaultName) => {
  // Detect file type from default name
  const ext = path.extname(defaultName).replace('.', '').toLowerCase();
  let filters;
  if (ext === 'xlsx' || ext === 'xls') {
    filters = [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }];
  } else if (ext === 'pdf') {
    filters = [{ name: 'PDF Files', extensions: ['pdf'] }];
  } else if (ext === 'html' || ext === 'htm') {
    filters = [{ name: 'HTML Files', extensions: ['html', 'htm'] }];
  } else if (ext === 'json') {
    filters = [{ name: 'JSON Files', extensions: ['json'] }];
  } else {
    filters = [{ name: 'All Files', extensions: ['*'] }];
  }
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: filters
  });
  if (result.canceled) return null;
  return result.filePath;
});

// ===== IPC: HTTP request (replaces renderer-side require('https')) =====

ipcMain.handle('http-request', async (event, { url, method, headers, body }) => {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; resolve(result); } };
    try {
      const request = net.request({ url, method: method || 'GET', redirect: 'follow' });
      if (headers) {
        Object.entries(headers).forEach(([k, v]) => request.setHeader(k, v));
      }
      request.on('response', (response) => {
        let data = '';
        response.on('data', chunk => { data += chunk.toString(); });
        response.on('end', () => {
          done({ statusCode: response.statusCode, body: data });
        });
        // Response stream errors (e.g. QUIC protocol mid-stream failures) — must
        // be caught explicitly or they propagate as uncaughtException dialogs.
        response.on('error', (err) => {
          done({ statusCode: 0, body: '', error: err.message });
        });
        response.on('aborted', () => {
          done({ statusCode: 0, body: '', error: 'Response aborted' });
        });
      });
      request.on('error', (err) => {
        done({ statusCode: 0, body: '', error: err.message });
      });
      request.on('abort', () => {
        done({ statusCode: 0, body: '', error: 'Request aborted' });
      });
      if (body) request.write(body);
      request.end();
    } catch (err) {
      done({ statusCode: 0, body: '', error: err.message });
    }
  });
});

// ── Global safety net: never let a stray network error crash the app ─────
// Electron's net module can occasionally bubble errors (e.g., QUIC protocol
// errors during flaky connectivity) outside the request/response handlers.
// Without a process-level handler, these surface as a modal "JavaScript
// error" dialog, which is jarring and useless to the user. We log them and
// swallow them — the actual network operation either retries or fails
// gracefully via its own promise resolution.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.message, err && err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason && reason.message ? reason.message : reason);
});
