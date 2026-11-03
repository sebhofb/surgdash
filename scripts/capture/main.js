// Screenshots of every main SURGdash screen, for checking a visual change before it ships.
// Runs the real index.html and preload.js on a COPY of the data (run.sh makes it, without any
// credentials), with the network closed except the chart, font and map servers, so nothing can
// sync, pull or publish. Start it through run.sh:   npm run screens [-- <output folder>]
const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.resolve(__dirname, '..', '..');
const DIR = process.env.CAPTURE_DIR || path.join(os.tmpdir(), 'surgdash-capture');
const UD = path.join(DIR, 'userdata');
app.setPath('userData', UD);
const DATA = path.join(UD, 'data');
const OUT = process.env.OUT || path.join(DIR, 'shots');
const STEPS = JSON.parse(fs.readFileSync(process.env.STEPS || path.join(__dirname, 'steps.json'), 'utf8'));
const W = Number(process.env.W || 1440), H = Number(process.env.H || 900);
if (!fs.existsSync(DATA)) { console.error('No data copy at ' + DATA + ': start this through scripts/capture/run.sh'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const ALLOW = /^(file:|devtools:|data:|blob:|chrome-extension:|https:\/\/(www\.gstatic\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|([a-z]\.)?tile\.openstreetmap\.org|[a-d]\.basemaps\.cartocdn\.com|basemaps\.cartocdn\.com)\/)/;
const blocked = new Set();
ipcMain.handle('http-request', async (e, req) => { blocked.add('ipc:' + String(req && req.url || '').replace(/\?.*$/, '').slice(0, 80)); return { statusCode: 0, body: '', error: 'offline (capture mode)' }; });
['generate-pdf', 'merge-pdfs', 'pick-folder', 'pick-pdf-file', 'write-file', 'read-file', 'pick-xlsx-open-path', 'pick-json-open-path', 'pick-geo-file', 'capture-page', 'clipboard-write-text', 'clipboard-write-image', 'pick-save-path'].forEach(c => ipcMain.handle(c, async () => null));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => { const ok = ALLOW.test(d.url); if (!ok) blocked.add(d.url.replace(/\?.*$/, '').slice(0, 100)); cb({ cancel: !ok }); });
  const win = new BrowserWindow({ width: W, height: H, show: false, backgroundColor: '#002F4C',
    webPreferences: { contextIsolation: true, sandbox: false, nodeIntegration: false, preload: path.join(ROOT, 'preload.js'), additionalArguments: ['--data-profile=', '--surgdash-datadir=' + DATA] } });
  const logs = [];
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) logs.push(message.slice(0, 300)); });
  win.webContents.on('will-prevent-unload', (e) => e.preventDefault());
  await win.loadFile(path.join(ROOT, 'index.html'));
  // native dialogs would stop the run: record them instead
  await win.webContents.executeJavaScript('window.alert = (m) => { (window.__alerts = window.__alerts || []).push(String(m)); }; window.confirm = (m) => { (window.__alerts = window.__alerts || []).push("CONFIRM: " + String(m)); return false; }; true');
  for (let i = 0; i < 120; i++) {
    const ready = await win.webContents.executeJavaScript('!!(window.App && document.getElementById("view-body") && (!document.getElementById("app-splash") || getComputedStyle(document.getElementById("app-splash")).opacity === "0" || document.getElementById("app-splash").style.display === "none"))').catch(() => false);
    if (ready) break; await sleep(500);
  }
  await sleep(Number(process.env.BOOT_WAIT || 4000));
  const report = [];
  for (const s of STEPS) {
    try {
      if (s.js) await win.webContents.executeJavaScript('(async () => { ' + s.js + ' })()').catch(e => report.push(s.name + ': js error ' + e.message));
      await sleep(s.wait || 2500);
      if (s.size) win.setContentSize(s.size[0], s.size[1]);
      if (s.full) {   // the whole page: grow the window to the content height
        const h = await win.webContents.executeJavaScript('(() => { const el = document.getElementById("view-body") || document.body; return Math.min(6000, Math.max(el.scrollHeight + 120, 900)); })()').catch(() => H);
        win.setContentSize(W, h); await sleep(1500);
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, s.name + '.png'), img.toPNG());
      if (s.full || s.size) { win.setContentSize(W, H); await sleep(500); }
      report.push(s.name + ': ok');
    } catch (e) { report.push(s.name + ': ' + e.message); }
  }
  const alerts = await win.webContents.executeJavaScript('window.__alerts || []').catch(() => []);
  fs.writeFileSync(path.join(OUT, '_report.json'), JSON.stringify({ report, alerts, consoleErrors: logs.slice(0, 80), blocked: [...blocked].slice(0, 80) }, null, 1));
  console.log(report.filter(r => !/: ok$/.test(r)).join('\n') || 'All ' + report.length + ' screens captured.');
  app.exit(0);
});
