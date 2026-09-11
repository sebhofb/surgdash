// SURGdash Google Sheets Sync — script version 4 (11 September 2026)
// Paste into Google Apps Script → Save → Deploy as Web App
// Execute as: Me  |  Access: Anyone
//
// v4: a SYNC KEY. "Access: Anyone" means anyone holding the URL could read every learner
// record and overwrite the Sheet. Once the app has set a key (Script Property `syncKey`,
// via type:'set_key' — only possible while none is set, or with the current key), every
// read and write must carry it (GET ?k=…, POST body field k); ?meta=1 stays open because
// it carries no data, and reports secured:true/false so the app can nudge the admin.
// v3: fingerprints per item (the app skips what the Sheet already holds), SURGhub blob
// stored compressed as opaque text the app inflates (SDGZ1: prefix), parts written at
// explicit rows (a retry overwrites, never appends), ?nosurghub=1 pulls, batched tab
// writes (a project tab is ~12 Sheets calls instead of ~100). Reads legacy data as before.
var SCRIPT_VERSION = 4;
var SURGHUB_MARK = 'SDGZ1:';

function _syncKey() { try { return PropertiesService.getScriptProperties().getProperty('syncKey') || ''; } catch (_e) { return ''; } }
function _keyOk(k) { var want = _syncKey(); return !want || String(k || '') === want; }
function _unauthorised() { return _json({ ok: false, code: 'unauthorised', error: 'unauthorised — this Sheet requires the sync key; paste the share link from your SURGdash administrator (Settings → Google Sheets → Copy share link)' }); }

// ── doGet: read live data from each project sheet so manual edits are picked up
function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var p = (e && e.parameter) || {};
    // Cheap freshness check (?meta=1): return ONLY the last-change time (+ what this
    // deployment can do and the fingerprints of what it holds) so the app can decide
    // without downloading everything. lastModified reflects REAL changes only: lastSync
    // (a push from the app) or lastEdit (a manual cell edit, via onEdit). We deliberately
    // do NOT fold in DriveApp.getLastUpdated() — Google advances a Spreadsheet's Drive
    // modified-time on its own (overnight re-index / background re-save), which produced
    // false "new data available" nudges on a quiet morning.
    if (e && e.parameter && e.parameter.meta) {
      var _lm = '';
      try { _lm = PropertiesService.getScriptProperties().getProperty('lastSync') || ''; } catch (_p) {}
      try { var _le = PropertiesService.getScriptProperties().getProperty('lastEdit') || ''; if (_le > _lm) _lm = _le; } catch (_q) {}
      return _json({ ok: true, meta: true, version: SCRIPT_VERSION, lastModified: _lm, hashes: _readHashes(), secured: !!_syncKey() });
    }
    if (!_keyOk(p.k)) return _unauthorised();
    var SKIP = {'📊 Organisation':1, '__SURGdash__':1, '📋 SURGdash Backup':1, '📋 SURGhub':1};
    var projects = [];
    ss.getSheets().forEach(function(sheet) {
      if (SKIP[sheet.getName()]) return;
      var pr = _readProjectSheet(sheet);
      if (pr) projects.push(pr);
    });

    var response = { ok: true, version: SCRIPT_VERSION, projects: projects };
    // SURGhub data unless the app already holds this very blob (?nosurghub=1).
    if (!p.nosurghub) {
      var surghubStorage = _readSurghubSheet(ss);
      if (surghubStorage) response.surghubStorage = surghubStorage;
      var h = _readHashes();
      if (h.surghub) response.surghubHash = h.surghub;
    }
    return _json(response);
  } catch(err) { return _json({ ok: false, error: err.message }); }
}

// Fingerprints of what the Sheet holds, stamped by the app's pushes (hash:p:<id>,
// hash:org, hash:surghub). The app skips an item whose fingerprint is already here.
function _readHashes() {
  var out = { projects: {}, org: '', surghub: '' };
  try {
    var all = PropertiesService.getScriptProperties().getProperties();
    Object.keys(all).forEach(function(k) {
      if (k.indexOf('hash:p:') === 0) out.projects[k.substring(7)] = all[k];
      else if (k === 'hash:org') out.org = all[k];
      else if (k === 'hash:surghub') out.surghub = all[k];
    });
  } catch (_e) {}
  return out;
}
function _setHash(key, value) {
  try {
    var props = PropertiesService.getScriptProperties();
    if (value) props.setProperty('hash:' + key, String(value)); else props.deleteProperty('hash:' + key);
  } catch (_e) {}
}

// ── Read SURGhub data from dedicated sheet (chunks stored as rows) ────────────
// Rows 2+: [part row no, syncedAt (row 2 only), text chunk]. Since v3 the header row's
// columns D–F hold [expected rows, format, fingerprint]; a blob with fewer rows than
// expected is a half-finished upload and is not served. A chunk text starting with
// SURGHUB_MARK is compressed by the app and returned AS IS (the app inflates it);
// anything else is legacy plain JSON and is parsed here as before.
function _readSurghubSheet(ss) {
  var sheet = ss.getSheetByName('📋 SURGhub');
  if (!sheet) return null;
  var vals = sheet.getDataRange().getValues();
  if (vals.length < 2) return null;
  var expected = Number(vals[0][3]) || 0;
  var dataRows = 0, json = '';
  for (var r = 1; r < vals.length; r++) {
    var c = String(vals[r][2] || '');
    if (c) { dataRows++; json += c; }
  }
  if (!json) return null;
  if (expected && dataRows < expected) { Logger.log('SURGhub blob incomplete: ' + dataRows + '/' + expected + ' rows'); return null; }
  if (json.substring(0, SURGHUB_MARK.length) === SURGHUB_MARK) return json;
  try {
    return JSON.parse(json);
  } catch(e) {
    Logger.log('Failed to parse SURGhub JSON: ' + e.message);
    return null;
  }
}

function _readProjectSheet(sheet) {
  var vals = sheet.getDataRange().getValues();
  if (!vals.length) return null;

  var project = { name: sheet.getName(), shortName: '', years: [], events: [], updates: [], kpiLog: [], linksExtra: [], qualityData: [], facilities: [], locations: [] };
  var section = null;
  var kpiHeaderSeen = false;
  var evHeaderSeen  = false;
  var updHeaderSeen = false;
  var logHeaderSeen = false;
  var qHdrSeen      = false;
  var qtrHeaderSeen = false;
  var facHdrSeen    = false;

  for (var i = 0; i < vals.length; i++) {
    var row   = vals[i];
    var first = String(row[0] || '').trim();

    // Detect section headers (merged cells with dark background — value in col A)
    if (first === 'PROJECT INFO')        { section = 'info';     continue; }
    if (first === 'LINKS')              { section = 'links';    continue; }
    if (first === 'KPIs BY YEAR')        { section = 'kpis';     kpiHeaderSeen = false; continue; }
    if (first.indexOf('KPIs BY QUARTER') === 0) { section = 'quarters'; qtrHeaderSeen = false; continue; }
    if (first === 'KPI COMMENTS')        { section = 'comments'; continue; }
    if (first === 'KPI CHANGE LOG')      { section = 'kpilog';   logHeaderSeen = false; continue; }
    if (first === 'QUALITY INDICATORS')  { section = 'quality';  qHdrSeen = false; continue; }
    if (first.indexOf('ACTIVITIES') === 0 || first.indexOf('EVENTS') === 0) { section = 'events'; evHeaderSeen = false; continue; }
    if (first === 'UPDATES')             { section = 'updates';  updHeaderSeen = false; continue; }
    if (first === 'FACILITIES')          { section = 'facilities'; facHdrSeen = false; continue; }
    if (first === '')                    { continue; }

    if (section === 'info') {
      if (first === '⚠ SAMPLE')          project.isSample           = true;
      if (first === 'Name')              project.name               = String(row[1] || '');
      if (first === 'Short Name')        project.shortName          = String(row[1] || '');
      if (first === 'Description')       project.description        = String(row[1] || '');
      if (first === 'Color')             project.color              = String(row[1] || '');
      if (first === 'Icon')              project.icon               = String(row[1] || '');
      if (first === 'Start Date')        project.startDate          = _date(row[1]);
      if (first === 'End Date')          project.endDate            = _date(row[1]);
      if (first === 'HCW Multiplier')    project.hcwMultiplierEnabled = String(row[1] || '').toLowerCase() === 'yes';
      if (first === 'HCW Multiplier Rate') {
        var v = Number(row[1]);
        if (!isNaN(v)) project.hcwMultiplierRate = v;
      }
      if (first === 'Quality KPIs') {
        var qstr = String(row[1] || '').trim();
        project.enabledQualityKpis = qstr ? qstr.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
      }
      if (first === 'Latitude')       { var v = Number(row[1]); if (!isNaN(v)) project.lat = v; }
      if (first === 'Longitude')      { var v = Number(row[1]); if (!isNaN(v)) project.lng = v; }
      if (first === 'Sheets Tab URL') project.sheetsTabUrl = String(row[1] || '').trim();
      if (first === 'Locations') {
        try { project.locations = JSON.parse(String(row[1] || '[]')); } catch(e) { project.locations = []; }
      }
    }

    if (section === 'links') {
      if (first === 'GSF Page')      project.linkGsf    = String(row[1] || '').trim();
      if (first === 'Working Folder') project.linkFolder = String(row[1] || '').trim();
      if (first.startsWith('Extra Link')) {
        var lurl = String(row[1] || '').trim();
        var llabel = String(row[2] || '').trim();
        if (lurl) project.linksExtra.push({ url: lurl, label: llabel });
      }
    }

    if (section === 'kpis') {
      if (!kpiHeaderSeen) { kpiHeaderSeen = true; continue; } // skip column header row
      var year = Number(row[0]);
      if (!year) continue;
      project.years.push({
        year: year,
        targets: {
          hcw_strengthened:        _num(row[1]),
          patients_reached:         _num(row[3]),
          facilities_strengthened:  _num(row[5]),
          population_access:        _num(row[7])
        },
        actuals: {
          hcw_strengthened:        _num(row[2]),
          patients_reached:         _num(row[4]),
          facilities_strengthened:  _num(row[6]),
          population_access:        _num(row[8])
        },
        targetComments: {},
        actualComments: {}
      });
    }

    if (section === 'comments') {
      var cyear = Number(row[0]);
      if (!cyear) continue;
      var label = String(row[1] || '').trim();
      var labelMap = {
        'HCW Strengthened': 'hcw_strengthened',
        'Patients Reached': 'patients_reached',
        'Facilities Strengthened': 'facilities_strengthened',
        'Population Access': 'population_access'
      };
      var key = labelMap[label];
      if (!key) continue;
      var yr = project.years.find(function(y) { return y.year === cyear; });
      if (!yr) continue;
      if (row[2]) yr.targetComments[key] = String(row[2]);
      if (row[3]) yr.actualComments[key] = String(row[3]);
    }

    if (section === 'quality') {
      if (!qHdrSeen) { qHdrSeen = true; continue; }
      var qKpiId = String(row[0] || '').trim();
      if (!qKpiId) continue;
      var qYear = Number(row[1]);
      var qQuarter = Number(row[2]);
      var qTarget = _num(row[3]);
      var qActual = _num(row[4]);
      if (qKpiId && qYear && qQuarter) {
        if (!project.qualityData) project.qualityData = [];
        project.qualityData.push({ kpiId: qKpiId, year: qYear, quarter: qQuarter, target: qTarget !== undefined ? qTarget : null, actual: qActual !== undefined ? qActual : null });
      }
    }

    if (section === 'kpilog') {
      if (!logHeaderSeen) { logHeaderSeen = true; continue; }
      var ts = String(row[0] || '').trim();
      if (!ts) continue;
      project.kpiLog.push({
        id: 'log-' + i,
        timestamp: ts,
        year: Number(row[1]) || 0,
        note: String(row[2] || ''),
        targets: {
          hcw_strengthened: _num(row[3]), patients_reached: _num(row[5]),
          facilities_strengthened: _num(row[7]), population_access: 0
        },
        actuals: {
          hcw_strengthened: _num(row[4]), patients_reached: _num(row[6]),
          facilities_strengthened: _num(row[8]), population_access: 0
        }
      });
    }

    if (section === 'quarters') {
      if (!qtrHeaderSeen) { qtrHeaderSeen = true; continue; }
      // Rows: [Year, "Q1", hcw, patients, facilities, population]
      var qyr = Number(row[0]);
      var qlabel = String(row[1] || '').trim();
      if (!qyr || qlabel.charAt(0) !== 'Q') continue;
      var qn = Number(qlabel.substring(1));
      if (!qn) continue;
      var yEntry = null;
      for (var yi = 0; yi < project.years.length; yi++) { if (project.years[yi].year === qyr) { yEntry = project.years[yi]; break; } }
      if (!yEntry) { yEntry = { year: qyr, targets: {}, actuals: {} }; project.years.push(yEntry); }
      if (!yEntry.quarters) yEntry.quarters = {};
      var qobj = {};
      var hv = _num(row[2]), pv = _num(row[3]), fv = _num(row[4]), popv = _num(row[5]);
      if (hv   !== undefined) qobj.hcw_strengthened       = hv;
      if (pv   !== undefined) qobj.patients_reached        = pv;
      if (fv   !== undefined) qobj.facilities_strengthened = fv;
      if (popv !== undefined) qobj.population_access        = popv;
      yEntry.quarters[qn] = qobj;
    }

    if (section === 'events') {
      // The grouped layout interleaves: year-band rows (col A contains '·'),
      // per-year column headers (col A === 'Start' or 'Date'), activity rows,
      // and subtotal rows (col D === 'Year total'). Only parse genuine activity rows.
      var c0 = String(row[0] || '').trim();
      if (!c0) continue;
      if (c0 === 'Start' || c0 === 'Date') continue;   // per-year column header
      if (c0.indexOf('·') >= 0) continue;              // year-band row
      if (String(row[3] || '').trim() === 'Year total') continue; // subtotal
      // Activity row: col A = start date, col B = optional end date.
      var endD = String(row[1] || '').trim();
      project.events.push({
        id:             'ev-' + c0 + '-' + i,
        date:           c0,
        endDate:        endD || undefined,
        type:           String(row[2] || ''),
        title:          String(row[3] || ''),
        hcw_count:      _num(row[4]) || undefined,
        hcw_new_count:  _num(row[5]) || undefined,
        facilities_count: _num(row[6]) || undefined,
        notes:          String(row[7] || '') || undefined
      });
    }

    if (section === 'updates') {
      if (!updHeaderSeen) { updHeaderSeen = true; continue; }
      var updDate = String(row[0] || '').trim();
      if (!updDate) continue;
      var tag = String(row[1] || '').trim();
      project.updates.push({
        id:    'upd-' + updDate + '-' + i,
        date:  updDate,
        tags:  tag ? [tag] : [],
        title: String(row[2] || ''),
        body:  String(row[3] || '')
      });
    }

    if (section === 'facilities') {
      if (!facHdrSeen) { facHdrSeen = true; continue; }
      var fname = String(row[0] || '').trim();
      if (!fname) continue;
      var fLat = _num(row[2]), fLng = _num(row[3]);
      project.facilities.push({
        id: 'fac-' + i,
        name: fname,
        isHub: String(row[1] || '').toLowerCase() === 'yes',
        lat: fLat !== undefined ? fLat : null,
        lng: fLng !== undefined ? fLng : null,
        catchmentPop: _num(row[4]) || null,
        annualPatients: _num(row[5]) || null,
        notes: String(row[6] || '') || ''
      });
    }
  }

  return project.name ? project : null;
}

function _num(v) {
  var n = Number(v);
  return isNaN(n) || v === '' ? undefined : n;
}

function _date(v) {
  if (!v && v !== 0) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
  var s = String(v).trim();
  if (!s) return '';
  if (/^d{4}-d{2}-d{2}$/.test(s)) return s;
  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
  return s;
}

// ── doPost: write project data or org summary ─────────────────────────────────
function doPost(e) {
  try {
    var d  = JSON.parse(e.postData.contents);
    if (d.type === 'set_key') {
      // First key: allowed while none is set (the admin does this right after deploying).
      // Rotation: only with the current key.
      var nk = String(d.newKey || '');
      if (nk.length < 16) return _json({ ok: false, error: 'the sync key must be at least 16 characters' });
      if (!_keyOk(d.k)) return _unauthorised();
      PropertiesService.getScriptProperties().setProperty('syncKey', nk);
      return _json({ ok: true, version: SCRIPT_VERSION, secured: true });
    }
    if (!_keyOk(d.k)) return _unauthorised();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (d.type === 'org_summary') {
      _writeOrgSummary(ss, d);
      _setHash('org', d.hash);
    } else if (d.type === 'full_backup') {
      _storeFullBackup(ss, d);
    } else if (d.type === 'surghub_chunk') {
      _storeSurghubChunk(ss, d);
    } else {
      _writeProject(ss, d);
      _storeRaw(ss, d);       // save JSON snapshot for doGet
      if (d.id) _setHash('p:' + d.id, d.hash);
    }
    // Stamp the last-change time so the app's ?meta=1 freshness check works.
    try { PropertiesService.getScriptProperties().setProperty('lastSync', new Date().toISOString()); } catch(_e) {}
    return _json({ ok: true, version: SCRIPT_VERSION });
  } catch(err) { return _json({ ok: false, error: err.message }); }
}

// Simple trigger: fires on a manual cell edit. Stamps lastEdit so the ?meta check
// also flags hand edits (not just app pushes). No install / no extra scope needed.
function onEdit(e) {
  try { PropertiesService.getScriptProperties().setProperty('lastEdit', new Date().toISOString()); } catch(_e) {}
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Raw JSON store (hidden sheet) ─────────────────────────────────────────────
function _storeRaw(ss, d) {
  var sheet = ss.getSheetByName('__SURGdash__');
  if (!sheet) {
    sheet = ss.insertSheet('__SURGdash__');
    sheet.getRange(1,1,1,3).setValues([['Project','JSON','Updated']]);
    sheet.hideSheet();
  }
  var vals = sheet.getDataRange().getValues();
  var rowIdx = -1;
  for (var i = 1; i < vals.length; i++) {
    if (vals[i][0] === d.name) { rowIdx = i + 1; break; }
  }
  var newRow = [d.name, JSON.stringify(d), d.syncedAt || new Date().toISOString()];
  if (rowIdx > 0) sheet.getRange(rowIdx, 1, 1, 3).setValues([newRow]);
  else sheet.appendRow(newRow);
}

// ── Full JSON backup sheet ────────────────────────────────────────────────────
function _storeFullBackup(ss, d) {
  var SHEET_NAME = '📋 SURGdash Backup';
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (sheet) { sheet.clearContents(); sheet.clearFormats(); }
  else { sheet = ss.insertSheet(SHEET_NAME); }

  // Store SURGhub data separately if present (before stripping it from backup)
  if (d.surghubStorage && Object.keys(d.surghubStorage).length > 0) {
    _storeSurghubSheet(ss, d.surghubStorage, d.syncedAt);
  }

  // Split JSON into 49000-char chunks across columns (Sheets cell limit is 50000)
  var json = JSON.stringify(d);
  var CHUNK = 49000;
  var chunks = [];
  for (var i = 0; i < json.length; i += CHUNK) { chunks.push(json.substring(i, i + CHUNK)); }

  var syncedAt = d.syncedAt || new Date().toISOString();
  var projectCount = (d.projects || []).length;

  // Header row
  var hdr = ['Backed Up At', 'Projects', 'Chunks'];
  for (var c = 0; c < chunks.length; c++) hdr.push('JSON Part ' + (c + 1));
  sheet.getRange(1, 1, 1, hdr.length).setValues([hdr])
    .setFontWeight('bold').setBackground('#002F4C').setFontColor('#FFFFFF');

  // Data row
  var dataRow = [syncedAt, projectCount, chunks.length];
  for (var c = 0; c < chunks.length; c++) dataRow.push(chunks[c]);
  sheet.getRange(2, 1, 1, dataRow.length).setValues([dataRow]);

  // Formatting (batched — a per-column loop here used to make thousands of
  // sequential Sheets calls and blow the client timeout on big backups)
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 70);
  sheet.setColumnWidth(3, 60);
  if (dataRow.length >= 4) {
    sheet.setColumnWidths(4, dataRow.length - 3, 400);
    sheet.getRange(2, 4, 1, dataRow.length - 3).setWrap(false);
  }
  SpreadsheetApp.flush();
}

// ── SURGhub chunked upload (client streams the big payload in parts; part 1 resets
//    the sheet; final layout is what _readSurghubSheet reads) ───────────────────
// v3 clients send startRow (where this part's rows go — a retried part overwrites the
// same rows instead of appending), totalRows (so a half-finished upload is detectable),
// format ('gz64' = compressed text the app inflates) and hash (the blob's fingerprint,
// advertised via ?meta only once the LAST part has landed). Older clients send none of
// these and get the old behaviour: rows appended after the last one.
function _storeSurghubChunk(ss, d) {
  var SHEET_NAME = '📋 SURGhub';
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  var part = Number(d.part) || 1, totalParts = Number(d.totalParts) || 1;
  if (part === 1) {
    sheet.clearContents(); sheet.clearFormats();
    sheet.getRange(1, 1, 1, 6).setValues([['Part', 'Synced At', 'JSON Chunk', Number(d.totalRows) || '', d.format || 'json', d.hash || '']]);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#002F4C').setFontColor('#FFFFFF');
    sheet.setColumnWidth(1, 50);
    sheet.setColumnWidth(2, 180);
    sheet.setColumnWidth(3, 400);
    _setHash('surghub', '');   // the previous blob is gone; the new fingerprint is stamped when the last part lands
  }
  var json = String(d.data || '');
  var CHUNK = 49000;
  var start = d.startRow ? Math.max(Number(d.startRow) - 2, 0) : Math.max(sheet.getLastRow() - 1, 0); // chunk rows before this part
  var rows = [];
  for (var i = 0; i < json.length; i += CHUNK) {
    var n = start + rows.length + 1;
    rows.push([n, n === 1 ? (d.syncedAt || new Date().toISOString()) : '', json.substring(i, i + CHUNK)]);
  }
  if (rows.length > 0) {
    sheet.getRange(start + 2, 1, rows.length, 3).setValues(rows);
    sheet.getRange(start + 2, 3, rows.length, 1).setWrap(false);
  }
  if (part === totalParts && d.hash) _setHash('surghub', d.hash);
  SpreadsheetApp.flush();
}

// ── SURGhub dedicated sheet (chunks stored as rows) — legacy single-POST path ──
function _storeSurghubSheet(ss, surghubStorage, syncedAt) {
  var SHEET_NAME = '📋 SURGhub';
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (sheet) { sheet.clearContents(); sheet.clearFormats(); }
  else { sheet = ss.insertSheet(SHEET_NAME); }

  var json = JSON.stringify(surghubStorage);
  var CHUNK = 49000;
  var chunks = [];
  for (var i = 0; i < json.length; i += CHUNK) { chunks.push(json.substring(i, i + CHUNK)); }

  syncedAt = syncedAt || new Date().toISOString();

  // Header row
  sheet.getRange(1, 1, 1, 3).setValues([['Part', 'Synced At', 'JSON Chunk']])
    .setFontWeight('bold').setBackground('#002F4C').setFontColor('#FFFFFF');

  // Write chunks as rows (batch write for speed)
  var rows = [];
  for (var c = 0; c < chunks.length; c++) {
    rows.push([c + 1, c === 0 ? syncedAt : '', chunks[c]]);
  }
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  }

  // Formatting
  sheet.setColumnWidth(1, 50);
  sheet.setColumnWidth(2, 180);
  sheet.setColumnWidth(3, 400);
  sheet.getRange(2, 3, rows.length, 1).setWrap(false);
  _setHash('surghub', '');
  SpreadsheetApp.flush();
}

// ── Buffered tab writer ───────────────────────────────────────────────────────
// Rows and formats are collected first, then written with a handful of range calls
// (one setValues for the whole block, one call per format grid, one merge per header)
// instead of one or two Sheets calls PER ROW — a project tab went from ~100 calls to
// about a dozen, the organisation summary from ~150. Cell contents and positions are
// exactly what the per-row writer produced, so _readProjectSheet is unchanged.
function _block(sheet, cols) {
  var rows = [], ops = [], W = cols || 9;
  var b = {
    next: function() { return rows.length + 1; },                       // 1-based row the next wr() lands on
    wr:   function(vals) { rows.push(vals.slice()); return rows.length; }, // → its row number
    skip: function(n) { for (var i = 0; i < (n || 1); i++) rows.push([]); },
    // fmt(row, col, nRows, nCols, { bold, bg, fc, fs, italic, merge, num })
    fmt:  function(r1, c1, nr, nc, f) { ops.push({ r: r1, c: c1, nr: nr, nc: nc, f: f || {} }); },
    hdr:  function(label, bg, fc, fs) { var r = b.wr([label]); b.fmt(r, 1, 1, W, { merge: true, bold: true, bg: bg || '#002F4C', fc: fc || '#FFFFFF', fs: fs || 10 }); return r; },
    flush: function() {
      var n = rows.length; if (!n) return;
      var maxC = W; rows.forEach(function(r) { if (r.length > maxC) maxC = r.length; });
      var grid = [], weights = [], bgs = [], fcs = [], styles = [], sizes = [], any = { bold: false, bg: false, fc: false, italic: false, fs: false };
      for (var i = 0; i < n; i++) {
        var r = rows[i].slice(); while (r.length < maxC) r.push('');
        grid.push(r); weights.push(_fill(maxC, 'normal')); bgs.push(_fill(maxC, null)); fcs.push(_fill(maxC, null)); styles.push(_fill(maxC, 'normal')); sizes.push(_fill(maxC, 10));
      }
      // Text format BEFORE the values so date-like strings stay text.
      ops.forEach(function(o) { if (o.f.num === '@') sheet.getRange(o.r, o.c, o.nr, o.nc).setNumberFormat('@'); });
      sheet.getRange(1, 1, n, maxC).setValues(grid);
      ops.forEach(function(o) {
        for (var i = o.r - 1; i < o.r - 1 + o.nr; i++) for (var j = o.c - 1; j < o.c - 1 + o.nc; j++) {
          if (i < 0 || j < 0 || i >= n || j >= maxC) continue;
          if (o.f.bold)   { weights[i][j] = 'bold';  any.bold = true; }
          if (o.f.bg)     { bgs[i][j] = o.f.bg;      any.bg = true; }
          if (o.f.fc)     { fcs[i][j] = o.f.fc;      any.fc = true; }
          if (o.f.italic) { styles[i][j] = 'italic'; any.italic = true; }
          if (o.f.fs)     { sizes[i][j] = o.f.fs;    any.fs = true; }
        }
      });
      var all = sheet.getRange(1, 1, n, maxC);
      try {
        if (any.bold)   all.setFontWeights(weights);
        if (any.bg)     all.setBackgrounds(bgs);
        if (any.fc)     all.setFontColors(fcs);
        if (any.italic) all.setFontStyles(styles);
        if (any.fs)     all.setFontSizes(sizes);
      } catch (gridErr) {
        // Grid setters refused (should not happen) — fall back to per-op formatting.
        ops.forEach(function(o) {
          var rg = sheet.getRange(o.r, o.c, o.nr, o.nc);
          if (o.f.bold) rg.setFontWeight('bold'); if (o.f.bg) rg.setBackground(o.f.bg); if (o.f.fc) rg.setFontColor(o.f.fc);
          if (o.f.italic) rg.setFontStyle('italic'); if (o.f.fs) rg.setFontSize(o.f.fs);
        });
      }
      ops.forEach(function(o) {
        if (o.f.merge) sheet.getRange(o.r, o.c, o.nr, o.nc).merge();
        if (o.f.num && o.f.num !== '@') sheet.getRange(o.r, o.c, o.nr, o.nc).setNumberFormat(o.f.num);
      });
    }
  };
  return b;
}
function _fill(n, v) { var a = []; for (var i = 0; i < n; i++) a.push(v); return a; }

// ── Organisation summary sheet (first tab) ────────────────────────────────────
function _writeOrgSummary(ss, data) {
  var NAME = '📊 Organisation';

  // Delete sheets for projects no longer in SURGdash (match by shortName or name)
  var PROTECTED = {};
  [NAME, '__SURGdash__', '📋 SURGdash Backup', '📋 SURGhub'].forEach(function(n) { PROTECTED[n] = 1; });
  var currentNames = {};
  (data.projects || []).forEach(function(p) { currentNames[(p.shortName || p.name || '').substring(0, 95)] = 1; });
  ss.getSheets().forEach(function(s) {
    var n = s.getName();
    if (!PROTECTED[n] && !currentNames[n]) {
      if (ss.getSheets().length > 1) ss.deleteSheet(s);
    }
  });

  var sheet = ss.getSheetByName(NAME);
  if (!sheet) { sheet = ss.insertSheet(NAME); ss.setActiveSheet(sheet); ss.moveActiveSheet(1); }
  sheet.clearContents();
  sheet.clearFormats();

  var cols = 9;
  var b = _block(sheet, cols);
  function hdr(label, bg) { b.hdr(label, bg || '#002F4C', bg ? '#002F4C' : '#FFFFFF', 10); }
  function wr(vals, bold, bg) {
    var r = b.wr(vals);
    if (bold || bg) b.fmt(r, 1, 1, vals.length, { bold: !!bold, bg: bg || null });
    return r;
  }

  // Title
  var r = b.wr(['Organisation KPI Summary']); b.fmt(r, 1, 1, cols, { merge: true, fs: 16, bold: true, fc: '#002F4C' });
  r = b.wr(['Generated: ' + data.generatedAt]); b.fmt(r, 1, 1, cols, { merge: true, fc: '#64748b', fs: 9 });
  b.skip();

  var kpiKeys = ['hcw_strengthened','patients_reached','facilities_strengthened','population_access'];

  // Split real projects from sample(s). Sample projects are shown for reference
  // but EXCLUDED from organisation totals.
  var realProjects   = (data.projects||[]).filter(function(p){ return !p.isSample; });
  var sampleProjects = (data.projects||[]).filter(function(p){ return p.isSample; });
  var orderedProjects = realProjects.concat(sampleProjects);

  // Per-year tables
  var years = [];
  var yearSet = {};
  (data.projects||[]).forEach(function(p) { (p.years||[]).forEach(function(y) { yearSet[y.year] = true; }); });
  years = Object.keys(yearSet).sort();
  years.forEach(function(yr) {
    yr = Number(yr);
    hdr(yr + ' — KPI Results (Plan vs Actual)');
    // Row 1: KPI group names merged over Plan + Actual
    r = b.wr(['Project','HCW','','Patients','','Facilities','','Population','']); b.fmt(r, 1, 1, 9, { bold: true, bg: '#E8F0F8' });
    [[2,3],[4,5],[6,7],[8,9]].forEach(function(p) { b.fmt(r, p[0], 1, 2, { merge: true }); });
    // Row 2: Plan / Actual sub-headers
    r = b.wr(['','Plan','Actual','Plan','Actual','Plan','Actual','Plan','Actual']); b.fmt(r, 1, 1, 9, { bold: true });
    [2,4,6,8].forEach(function(c) { b.fmt(r, c, 1, 1, { bg: '#FEF3C7' }); });
    [3,5,7,9].forEach(function(c) { b.fmt(r, c, 1, 1, { bg: '#DCFCE7' }); });
    var totT = {}, totA = {};
    kpiKeys.forEach(function(k) { totT[k] = 0; totA[k] = 0; });
    var dataStart = b.next();
    orderedProjects.forEach(function(p) {
      var y = (p.years||[]).find(function(y) { return y.year === yr; }) || { targets:{}, actuals:{} };
      var label = p.isSample ? (p.name + ' (sample)') : p.name;
      var pr = wr([label].concat(kpiKeys.reduce(function(a, k) { a.push(y.targets[k]||'', y.actuals[k]||''); return a; }, [])));
      if (p.isSample) {
        b.fmt(pr, 1, 1, 9, { fc: '#94a3b8', italic: true });
      } else {
        kpiKeys.forEach(function(k) { totT[k] += Number(y.targets[k])||0; totA[k] += Number(y.actuals[k])||0; });
      }
    });
    wr(['TOTAL (excl. sample)'].concat(kpiKeys.reduce(function(a, k) { a.push(totT[k]||'', totA[k]||''); return a; }, [])), true, '#FEF3C7');
    // Number format for data rows + total
    var numRows = orderedProjects.length + 1;
    b.fmt(dataStart, 2, numRows, 8, { num: '#,##0' });
    b.skip();
  });

  // ── Per-quarter org rollup (cumulative actuals, real projects only) ──
  // For each year, sum the cumulative quarterly actuals across all real projects.
  var hasAnyQuarterly = realProjects.some(function(p){ return (p.years||[]).some(function(y){ return y.quarters && Object.keys(y.quarters).length; }); });
  if (hasAnyQuarterly) {
    years.forEach(function(yr) {
      yr = Number(yr);
      // Skip years with no quarterly data anywhere
      var anyQ = realProjects.some(function(p){
        var y = (p.years||[]).find(function(y){ return y.year === yr; });
        return y && y.quarters && Object.keys(y.quarters).length;
      });
      if (!anyQ) return;
      hdr(yr + ' — Quarterly Actuals (cumulative, all projects)');
      r = b.wr(['Quarter','HCW','Patients','Facilities','Population']); b.fmt(r, 1, 1, 5, { bold: true, bg: '#DCFCE7' });
      var qStart = b.next();
      [1,2,3,4].forEach(function(q) {
        var sums = { hcw_strengthened:0, patients_reached:0, facilities_strengthened:0, population_access:0 };
        var any = false;
        realProjects.forEach(function(p) {
          var y = (p.years||[]).find(function(y){ return y.year === yr; });
          if (!y || !y.quarters || !y.quarters[q]) return;
          var qd = y.quarters[q];
          kpiKeys.forEach(function(k){ if (qd[k] != null) { sums[k] += Number(qd[k])||0; any = true; } });
        });
        if (!any) return;
        wr(['Q' + q, sums.hcw_strengthened||'', sums.patients_reached||'', sums.facilities_strengthened||'', sums.population_access||'']);
      });
      if (b.next() > qStart) b.fmt(qStart, 2, b.next() - qStart, 4, { num: '#,##0' });
      b.skip();
    });
  }

  b.flush();
  // Formatting: even column widths
  sheet.setColumnWidth(1, 200);
  [2,3,4,5,6,7,8,9].forEach(function(c) { sheet.setColumnWidth(c, 100); });
  SpreadsheetApp.flush();
}

// ── Per-project sheet ─────────────────────────────────────────────────────────
function _writeProject(ss, d) {
  var sheetName = (d.shortName || d.name || 'Project').substring(0, 95);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.clearContents();
  sheet.clearFormats();

  var b = _block(sheet, 9);
  function hdr(label) { b.hdr(label); }
  function wr(vals, bold) {
    var r = b.wr(vals);
    if (bold) b.fmt(r, 1, 1, vals.length, { bold: true, bg: '#E8F0F8' });
    return r;
  }

  hdr('PROJECT INFO');
  if (d.isSample) wr(['⚠ SAMPLE', 'Demonstration project — excluded from organisation totals'], true);
  wr(['Name', d.name||''], true);
  wr(['Short Name', d.shortName||'']);
  wr(['Description', d.description||'']);
  wr(['Color', d.color||'']);
  wr(['Icon', d.icon||'']);
  // Dates as text (the cell is formatted '@' before the value lands) to prevent Google Sheets auto-conversion
  var r = b.wr(['Start Date', d.startDate||'']); b.fmt(r, 2, 1, 1, { num: '@' });
  r = b.wr(['End Date', d.endDate||'']); b.fmt(r, 2, 1, 1, { num: '@' });
  wr(['HCW Multiplier', d.hcwMultiplierEnabled ? 'Yes' : 'No']);
  wr(['HCW Multiplier Rate', d.hcwMultiplierRate !== undefined ? d.hcwMultiplierRate : '']);
  wr(['Quality KPIs', (d.enabledQualityKpis||[]).join(', ')]);
  if (d.lat != null) wr(['Latitude', d.lat]);
  if (d.lng != null) wr(['Longitude', d.lng]);
  if (d.sheetsTabUrl) wr(['Sheets Tab URL', d.sheetsTabUrl]);
  if ((d.locations||[]).length > 0) wr(['Locations', JSON.stringify(d.locations)]);
  wr(['Synced At', d.syncedAt||'']);
  b.skip();

  hdr('LINKS');
  wr(['GSF Page', d.linkGsf||'']);
  wr(['Working Folder', d.linkFolder||'']);
  (d.linksExtra||[]).forEach(function(l, i) {
    wr(['Extra Link ' + (i + 1), l.url||'', l.label||'']);
  });
  b.skip();

  hdr('KPIs BY YEAR');
  // Row 1: KPI names merged over Plan + Actual columns
  r = b.wr(['Year','HCW','','Patients','','Facilities','','Population','']); b.fmt(r, 1, 1, 9, { bold: true, bg: '#E8F0F8' });
  [[2,3],[4,5],[6,7],[8,9]].forEach(function(p) { b.fmt(r, p[0], 1, 2, { merge: true }); });
  // Row 2: Plan / Actual sub-headers with amber (plan) and green (actual) highlights
  r = b.wr(['','Plan','Actual','Plan','Actual','Plan','Actual','Plan','Actual']); b.fmt(r, 1, 1, 9, { bold: true });
  [2,4,6,8].forEach(function(c) { b.fmt(r, c, 1, 1, { bg: '#FEF3C7' }); });
  [3,5,7,9].forEach(function(c) { b.fmt(r, c, 1, 1, { bg: '#DCFCE7' }); });
  var kpiDataStart = b.next();
  (d.years||[]).forEach(function(yr) {
    wr([yr.year,
        yr.targets.hcw_strengthened||'',       yr.actuals.hcw_strengthened||'',
        yr.targets.patients_reached||'',        yr.actuals.patients_reached||'',
        yr.targets.facilities_strengthened||'', yr.actuals.facilities_strengthened||'',
        yr.targets.population_access||'',       yr.actuals.population_access||'']);
  });
  // Apply thousands number format to KPI data area
  if ((d.years||[]).length > 0) b.fmt(kpiDataStart, 2, (d.years||[]).length, 8, { num: '#,##0' });
  b.skip();

  // ── KPIs BY QUARTER (cumulative actuals) ──
  // Quarterly figures are cumulative: Q1 = Jan–Mar running total, Q4 = full-year total.
  var hasQuarterly = (d.years||[]).some(function(yr) { return yr.quarters && Object.keys(yr.quarters).length; });
  if (hasQuarterly) {
    hdr('KPIs BY QUARTER (cumulative actuals)');
    r = b.wr(['Year','Quarter','HCW','Patients','Facilities','Population']); b.fmt(r, 1, 1, 6, { bold: true, bg: '#DCFCE7' });
    var qStart = b.next();
    var qCount = 0;
    (d.years||[]).forEach(function(yr) {
      if (!yr.quarters) return;
      [1,2,3,4].forEach(function(q) {
        var qd = yr.quarters[q];
        if (!qd) return;
        var hasAny = ['hcw_strengthened','patients_reached','facilities_strengthened','population_access'].some(function(k){ return qd[k] != null; });
        if (!hasAny) return;
        wr([yr.year, 'Q' + q,
            qd.hcw_strengthened != null ? qd.hcw_strengthened : '',
            qd.patients_reached != null ? qd.patients_reached : '',
            qd.facilities_strengthened != null ? qd.facilities_strengthened : '',
            qd.population_access != null ? qd.population_access : '']);
        qCount++;
      });
    });
    if (qCount > 0) b.fmt(qStart, 3, qCount, 4, { num: '#,##0' });
    b.skip();
  }

  var hasComments = (d.years||[]).some(function(yr) {
    return Object.keys(yr.targetComments||{}).length || Object.keys(yr.actualComments||{}).length;
  });
  if (hasComments) {
    hdr('KPI COMMENTS');
    wr(['Year','KPI','Target Note','Actual Note'], true);
    var kpis   = ['hcw_strengthened','patients_reached','facilities_strengthened','population_access'];
    var labels = ['HCW Strengthened','Patients Reached','Facilities Strengthened','Population Access'];
    (d.years||[]).forEach(function(yr) {
      kpis.forEach(function(k, i) {
        var tc = (yr.targetComments||{})[k], ac = (yr.actualComments||{})[k];
        if (tc || ac) wr([yr.year, labels[i], tc||'', ac||'']);
      });
    });
    b.skip();
  }

  // KPI Change Log
  if ((d.kpiLog||[]).length > 0) {
    hdr('KPI CHANGE LOG');
    wr(['Timestamp','Year','Note','HCW Plan','HCW Actual','Patients Plan','Patients Actual','Facilities Plan','Facilities Actual'], true);
    var logStart = b.next();
    var logRows = (d.kpiLog||[]).slice(0, 100);
    logRows.forEach(function(entry) {
      var ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '';
      var t = entry.targets || {};
      var a = entry.actuals || {};
      wr([ts, entry.year||'', entry.note||'',
          t.hcw_strengthened||'', a.hcw_strengthened||'',
          t.patients_reached||'', a.patients_reached||'',
          t.facilities_strengthened||'', a.facilities_strengthened||'']);
    });
    b.fmt(logStart, 4, logRows.length, 6, { num: '#,##0' });
    b.skip();
  }

  if ((d.qualityData||[]).length > 0) {
    hdr('QUALITY INDICATORS');
    wr(['KPI ID','Year','Quarter','Target','Actual'], true);
    (d.qualityData||[]).forEach(function(q) {
      var act = q.actual !== undefined && q.actual !== null ? q.actual : (q.value !== null ? q.value : '');
      var tgt = q.target !== undefined && q.target !== null ? q.target : '';
      wr([q.kpiId||'', q.year||'', q.quarter||'', tgt, act]);
    });
    b.skip();
  }

  // ── ACTIVITIES (grouped by year, with HCW contribution tracking) ──
  // Each activity shows total + new HCWs; a subtotal row per year sums the contribution.
  var TYPE_LABELS = {
    training_mentoring: 'Training / Mentoring',
    site_visit: 'Site Visit',
    other_update: 'Other Update',
    workshop: 'Training / Mentoring',
    mentoring: 'Training / Mentoring',
    other: 'Other Update'
  };
  var events = (d.events||[]).slice().sort(function(a, b){ return String(b.date||'').localeCompare(String(a.date||'')); });
  // Group by year (descending)
  var byYear = {};
  events.forEach(function(ev) {
    var y = String(ev.date||'').substring(0,4) || 'Undated';
    (byYear[y] = byYear[y] || []).push(ev);
  });
  var evYears = Object.keys(byYear).sort().reverse();

  hdr('ACTIVITIES — HCW TRACKING (by year)');
  if (events.length === 0) {
    wr(['No activities logged yet.']);
    b.skip();
  } else {
    evYears.forEach(function(y) {
      var list = byYear[y];
      var yTotal = 0, yNew = 0;
      list.forEach(function(ev){ yTotal += Number(ev.hcw_count)||0; yNew += Number(ev.hcw_new_count)||0; });
      // Year sub-header band
      var br = b.wr([y + '  ·  ' + list.length + ' activit' + (list.length===1?'y':'ies') + '  ·  ' + yTotal.toLocaleString() + ' HCWs (' + yNew.toLocaleString() + ' new)']);
      b.fmt(br, 1, 1, 8, { merge: true, bold: true, bg: '#E8F0F8', fc: '#002F4C' });
      // Column headers (Start + End date range)
      var hr = b.wr(['Start','End','Type','Title','HCWs','New HCWs','Facilities','Notes']);
      b.fmt(hr, 1, 1, 8, { bold: true, fc: '#64748b', fs: 9 });
      var blockStart = b.next();
      list.forEach(function(ev) {
        b.wr([ev.date||'', ev.endDate||'', TYPE_LABELS[ev.type] || ev.type || '',
            ev.title||'', ev.hcw_count||'', ev.hcw_new_count||'',
            (ev.facilities_count != null ? ev.facilities_count : ((ev.facilities||[]).length || '')),
            ev.notes||'']);
      });
      // Subtotal row
      var sr = b.wr(['', '', '', 'Year total', yTotal, yNew, '', '']);
      b.fmt(sr, 1, 1, 8, { bold: true, bg: '#FEF9C3' });
      // Number format for the HCW columns in this block (incl subtotal)
      b.fmt(blockStart, 5, sr - blockStart + 1, 2, { num: '#,##0' });
      b.skip(); // spacer between years
    });
  }
  b.skip();

  hdr('UPDATES');
  wr(['Date','Tag','Title','Body'], true);
  (d.updates||[]).forEach(function(u) { wr([u.date||'', (u.tags||[]).join(', '), u.title||'', u.body||'']); });
  b.skip();

  if ((d.facilities||[]).length > 0) {
    hdr('FACILITIES');
    wr(['Name','Hub','Latitude','Longitude','Catchment Pop','Annual Patients','Notes'], true);
    (d.facilities||[]).forEach(function(f) {
      wr([f.name||'', f.isHub ? 'Yes' : '', f.lat!=null?f.lat:'', f.lng!=null?f.lng:'',
          f.catchmentPop||'', f.annualPatients||'', f.notes||'']);
    });
  }

  b.flush();
  // Formatting: set column widths. Cols 3 & 4 carry titles/notes so make them wide.
  sheet.setColumnWidth(1, 120);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 200);
  sheet.setColumnWidth(4, 260);
  [5,6,7,8,9].forEach(function(c) { sheet.setColumnWidth(c, 100); });
  sheet.setFrozenRows(0);
  SpreadsheetApp.flush();
}
