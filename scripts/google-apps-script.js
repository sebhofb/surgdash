// SURGdash Google Sheets Sync
// Paste into Google Apps Script → Save → Deploy as Web App
// Execute as: Me  |  Access: Anyone

// ── doGet: read live data from each project sheet so manual edits are picked up
function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    // Cheap freshness check (?meta=1): return ONLY the last-change time so the app can
    // detect new cloud data without downloading everything. lastModified reflects REAL
    // changes only: lastSync (a push from the app) or lastEdit (a manual cell edit, via
    // onEdit). We deliberately do NOT fold in DriveApp.getLastUpdated() — Google advances
    // a Spreadsheet's Drive modified-time on its own (overnight re-index / background
    // re-save), which produced false "new data available" nudges on a quiet morning.
    if (e && e.parameter && e.parameter.meta) {
      var _lm = '';
      try { _lm = PropertiesService.getScriptProperties().getProperty('lastSync') || ''; } catch (_p) {}
      try { var _le = PropertiesService.getScriptProperties().getProperty('lastEdit') || ''; if (_le > _lm) _lm = _le; } catch (_q) {}
      return _json({ ok: true, meta: true, lastModified: _lm });
    }
    var SKIP = {'📊 Organisation':1, '__SURGdash__':1, '📋 SURGdash Backup':1, '📋 SURGhub':1};
    var projects = [];
    ss.getSheets().forEach(function(sheet) {
      if (SKIP[sheet.getName()]) return;
      var p = _readProjectSheet(sheet);
      if (p) projects.push(p);
    });

    // Include SURGhub data if available
    var surghubStorage = _readSurghubSheet(ss);

    var response = { ok: true, projects: projects };
    if (surghubStorage) response.surghubStorage = surghubStorage;
    return _json(response);
  } catch(err) { return _json({ ok: false, error: err.message }); }
}

// ── Read SURGhub data from dedicated sheet (chunks stored as rows) ────────────
function _readSurghubSheet(ss) {
  var sheet = ss.getSheetByName('📋 SURGhub');
  if (!sheet) return null;
  var vals = sheet.getDataRange().getValues();
  if (vals.length < 2) return null;

  // Row 1 is header, rows 2+ have: [partNum, syncedAt, jsonChunk]
  var json = '';
  for (var r = 1; r < vals.length; r++) {
    json += String(vals[r][2] || '');
  }
  if (!json) return null;

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
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (d.type === 'org_summary') {
      _writeOrgSummary(ss, d);
    } else if (d.type === 'full_backup') {
      _storeFullBackup(ss, d);
    } else if (d.type === 'surghub_chunk') {
      _storeSurghubChunk(ss, d);
    } else {
      _writeProject(ss, d);
      _storeRaw(ss, d);       // save JSON snapshot for doGet
    }
    // Stamp the last-change time so the app's ?meta=1 freshness check works.
    try { PropertiesService.getScriptProperties().setProperty('lastSync', new Date().toISOString()); } catch(_e) {}
    return _json({ ok: true });
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

// ── SURGhub chunked upload (client streams the big payload in ~4.4MB parts;
//    part 1 resets the sheet, later parts append — final layout is identical
//    to _storeSurghubSheet so doGet/_readSurghubSheet keep working) ──────────
function _storeSurghubChunk(ss, d) {
  var SHEET_NAME = '📋 SURGhub';
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (Number(d.part) === 1) {
    sheet.clearContents(); sheet.clearFormats();
    sheet.getRange(1, 1, 1, 3).setValues([['Part', 'Synced At', 'JSON Chunk']])
      .setFontWeight('bold').setBackground('#002F4C').setFontColor('#FFFFFF');
    sheet.setColumnWidth(1, 50);
    sheet.setColumnWidth(2, 180);
    sheet.setColumnWidth(3, 400);
  }
  var json = String(d.data || '');
  var CHUNK = 49000;
  var start = Math.max(sheet.getLastRow() - 1, 0); // chunk rows already stored
  var rows = [];
  for (var i = 0; i < json.length; i += CHUNK) {
    var n = start + rows.length + 1;
    rows.push([n, n === 1 ? (d.syncedAt || new Date().toISOString()) : '', json.substring(i, i + CHUNK)]);
  }
  if (rows.length > 0) {
    sheet.getRange(start + 2, 1, rows.length, 3).setValues(rows);
    sheet.getRange(start + 2, 3, rows.length, 1).setWrap(false);
  }
  SpreadsheetApp.flush();
}

// ── SURGhub dedicated sheet (chunks stored as rows) ──────────────────────────
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
  SpreadsheetApp.flush();
}

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

  var row = 1;
  var cols = 9;

  function hdr(label, bg) {
    sheet.getRange(row, 1, 1, cols).merge()
      .setValue(label).setFontWeight('bold')
      .setBackground(bg || '#002F4C').setFontColor(bg ? '#002F4C' : '#FFFFFF').setFontSize(10);
    row++;
  }
  function wr(vals, bold, bg) {
    var r = sheet.getRange(row, 1, 1, vals.length);
    r.setValues([vals]);
    if (bold) r.setFontWeight('bold');
    if (bg)   r.setBackground(bg);
    row++;
  }

  // Title
  sheet.getRange(row, 1, 1, cols).merge()
    .setValue('Organisation KPI Summary').setFontSize(16).setFontWeight('bold').setFontColor('#002F4C');
  row++;
  sheet.getRange(row, 1, 1, cols).merge()
    .setValue('Generated: ' + data.generatedAt).setFontColor('#64748b').setFontSize(9);
  row += 2;

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
    sheet.getRange(row, 1, 1, 9).setValues([['Project','HCW','','Patients','','Facilities','','Population','']]).setFontWeight('bold').setBackground('#E8F0F8');
    [[2,3],[4,5],[6,7],[8,9]].forEach(function(p) { sheet.getRange(row, p[0], 1, 2).merge(); });
    row++;
    // Row 2: Plan / Actual sub-headers
    sheet.getRange(row, 1, 1, 9).setValues([['','Plan','Actual','Plan','Actual','Plan','Actual','Plan','Actual']]).setFontWeight('bold');
    [2,4,6,8].forEach(function(c) { sheet.getRange(row, c).setBackground('#FEF3C7'); });
    [3,5,7,9].forEach(function(c) { sheet.getRange(row, c).setBackground('#DCFCE7'); });
    row++;
    var totT = {}, totA = {};
    kpiKeys.forEach(function(k) { totT[k] = 0; totA[k] = 0; });
    var dataStart = row;
    orderedProjects.forEach(function(p) {
      var y = (p.years||[]).find(function(y) { return y.year === yr; }) || { targets:{}, actuals:{} };
      var label = p.isSample ? (p.name + ' (sample)') : p.name;
      wr([label].concat(kpiKeys.reduce(function(a, k) { a.push(y.targets[k]||'', y.actuals[k]||''); return a; }, [])));
      if (p.isSample) {
        sheet.getRange(row - 1, 1, 1, 9).setFontColor('#94a3b8').setFontStyle('italic');
      } else {
        kpiKeys.forEach(function(k) { totT[k] += Number(y.targets[k])||0; totA[k] += Number(y.actuals[k])||0; });
      }
    });
    wr(['TOTAL (excl. sample)'].concat(kpiKeys.reduce(function(a, k) { a.push(totT[k]||'', totA[k]||''); return a; }, [])), true, '#FEF3C7');
    // Number format for data rows + total
    var numRows = orderedProjects.length + 1;
    sheet.getRange(dataStart, 2, numRows, 8).setNumberFormat('#,##0');
    row++;
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
      sheet.getRange(row, 1, 1, 5).setValues([['Quarter','HCW','Patients','Facilities','Population']])
        .setFontWeight('bold').setBackground('#DCFCE7');
      row++;
      var qStart = row;
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
      sheet.getRange(qStart, 2, row - qStart, 4).setNumberFormat('#,##0');
      row++;
    });
  }

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

  var row = 1;
  function hdr(label) {
    sheet.getRange(row, 1, 1, 9).merge()
      .setValue(label).setFontWeight('bold').setBackground('#002F4C').setFontColor('#FFFFFF').setFontSize(10);
    row++;
  }
  function wr(vals, bold) {
    var r = sheet.getRange(row, 1, 1, vals.length);
    r.setValues([vals]);
    if (bold) r.setFontWeight('bold').setBackground('#E8F0F8');
    row++;
  }

  hdr('PROJECT INFO');
  if (d.isSample) wr(['⚠ SAMPLE', 'Demonstration project — excluded from organisation totals'], true);
  wr(['Name', d.name||''], true);
  wr(['Short Name', d.shortName||'']);
  wr(['Description', d.description||'']);
  wr(['Color', d.color||'']);
  wr(['Icon', d.icon||'']);
  // Write dates as text to prevent Google Sheets auto-conversion
  var dateRange;
  sheet.getRange(row, 1, 1, 2).setValues([['Start Date', d.startDate||'']]);
  sheet.getRange(row, 2).setNumberFormat('@');
  row++;
  sheet.getRange(row, 1, 1, 2).setValues([['End Date', d.endDate||'']]);
  sheet.getRange(row, 2).setNumberFormat('@');
  row++;
  wr(['HCW Multiplier', d.hcwMultiplierEnabled ? 'Yes' : 'No']);
  wr(['HCW Multiplier Rate', d.hcwMultiplierRate !== undefined ? d.hcwMultiplierRate : '']);
  wr(['Quality KPIs', (d.enabledQualityKpis||[]).join(', ')]);
  if (d.lat != null) wr(['Latitude', d.lat]);
  if (d.lng != null) wr(['Longitude', d.lng]);
  if (d.sheetsTabUrl) wr(['Sheets Tab URL', d.sheetsTabUrl]);
  if ((d.locations||[]).length > 0) wr(['Locations', JSON.stringify(d.locations)]);
  wr(['Synced At', d.syncedAt||'']);
  row++;

  hdr('LINKS');
  wr(['GSF Page', d.linkGsf||'']);
  wr(['Working Folder', d.linkFolder||'']);
  (d.linksExtra||[]).forEach(function(l, i) {
    wr(['Extra Link ' + (i + 1), l.url||'', l.label||'']);
  });
  row++;

  hdr('KPIs BY YEAR');
  // Row 1: KPI names merged over Plan + Actual columns
  sheet.getRange(row, 1, 1, 9).setValues([['Year','HCW','','Patients','','Facilities','','Population','']]).setFontWeight('bold').setBackground('#E8F0F8');
  [[2,3],[4,5],[6,7],[8,9]].forEach(function(p) { sheet.getRange(row, p[0], 1, 2).merge(); });
  row++;
  // Row 2: Plan / Actual sub-headers with amber (plan) and green (actual) highlights
  sheet.getRange(row, 1, 1, 9).setValues([['','Plan','Actual','Plan','Actual','Plan','Actual','Plan','Actual']]).setFontWeight('bold');
  [2,4,6,8].forEach(function(c) { sheet.getRange(row, c).setBackground('#FEF3C7'); });
  [3,5,7,9].forEach(function(c) { sheet.getRange(row, c).setBackground('#DCFCE7'); });
  row++;
  (d.years||[]).forEach(function(yr) {
    wr([yr.year,
        yr.targets.hcw_strengthened||'',       yr.actuals.hcw_strengthened||'',
        yr.targets.patients_reached||'',        yr.actuals.patients_reached||'',
        yr.targets.facilities_strengthened||'', yr.actuals.facilities_strengthened||'',
        yr.targets.population_access||'',       yr.actuals.population_access||'']);
  });
  // Apply thousands number format to KPI data area
  if ((d.years||[]).length > 0) {
    var kpiDataStart = row - (d.years||[]).length;
    sheet.getRange(kpiDataStart, 2, (d.years||[]).length, 8).setNumberFormat('#,##0');
  }
  row++;

  // ── KPIs BY QUARTER (cumulative actuals) ──
  // Quarterly figures are cumulative: Q1 = Jan–Mar running total, Q4 = full-year total.
  var hasQuarterly = (d.years||[]).some(function(yr) { return yr.quarters && Object.keys(yr.quarters).length; });
  if (hasQuarterly) {
    hdr('KPIs BY QUARTER (cumulative actuals)');
    sheet.getRange(row, 1, 1, 6).setValues([['Year','Quarter','HCW','Patients','Facilities','Population']])
      .setFontWeight('bold').setBackground('#DCFCE7');
    row++;
    var qStart = row;
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
    if (qCount > 0) sheet.getRange(qStart, 3, qCount, 4).setNumberFormat('#,##0');
    row++;
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
    row++;
  }

  // KPI Change Log
  if ((d.kpiLog||[]).length > 0) {
    hdr('KPI CHANGE LOG');
    wr(['Timestamp','Year','Note','HCW Plan','HCW Actual','Patients Plan','Patients Actual','Facilities Plan','Facilities Actual'], true);
    var logStart = row;
    (d.kpiLog||[]).slice(0, 100).forEach(function(entry) {
      var ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '';
      var t = entry.targets || {};
      var a = entry.actuals || {};
      wr([ts, entry.year||'', entry.note||'',
          t.hcw_strengthened||'', a.hcw_strengthened||'',
          t.patients_reached||'', a.patients_reached||'',
          t.facilities_strengthened||'', a.facilities_strengthened||'']);
    });
    sheet.getRange(logStart, 4, (d.kpiLog||[]).length, 6).setNumberFormat('#,##0');
    row++;
  }

  if ((d.qualityData||[]).length > 0) {
    hdr('QUALITY INDICATORS');
    wr(['KPI ID','Year','Quarter','Target','Actual'], true);
    (d.qualityData||[]).forEach(function(q) {
      var act = q.actual !== undefined && q.actual !== null ? q.actual : (q.value !== null ? q.value : '');
      var tgt = q.target !== undefined && q.target !== null ? q.target : '';
      wr([q.kpiId||'', q.year||'', q.quarter||'', tgt, act]);
    });
    row++;
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
    row++;
  } else {
    evYears.forEach(function(y) {
      var list = byYear[y];
      var yTotal = 0, yNew = 0;
      list.forEach(function(ev){ yTotal += Number(ev.hcw_count)||0; yNew += Number(ev.hcw_new_count)||0; });
      // Year sub-header band
      sheet.getRange(row, 1, 1, 8).merge()
        .setValue(y + '  ·  ' + list.length + ' activit' + (list.length===1?'y':'ies') + '  ·  ' + yTotal.toLocaleString() + ' HCWs (' + yNew.toLocaleString() + ' new)')
        .setFontWeight('bold').setBackground('#E8F0F8').setFontColor('#002F4C');
      row++;
      // Column headers (Start + End date range)
      sheet.getRange(row, 1, 1, 8).setValues([['Start','End','Type','Title','HCWs','New HCWs','Facilities','Notes']])
        .setFontWeight('bold').setFontColor('#64748b').setFontSize(9);
      row++;
      var blockStart = row;
      list.forEach(function(ev) {
        wr([ev.date||'', ev.endDate||'', TYPE_LABELS[ev.type] || ev.type || '',
            ev.title||'', ev.hcw_count||'', ev.hcw_new_count||'',
            (ev.facilities_count != null ? ev.facilities_count : ((ev.facilities||[]).length || '')),
            ev.notes||'']);
      });
      // Subtotal row
      sheet.getRange(row, 1, 1, 8).setValues([['', '', '', 'Year total', yTotal, yNew, '', '']])
        .setFontWeight('bold').setBackground('#FEF9C3');
      row++;
      // Number format for the HCW columns in this block (incl subtotal)
      sheet.getRange(blockStart, 5, (row - blockStart), 2).setNumberFormat('#,##0');
      row++; // spacer between years
    });
  }
  row++;

  hdr('UPDATES');
  wr(['Date','Tag','Title','Body'], true);
  (d.updates||[]).forEach(function(u) { wr([u.date||'', (u.tags||[]).join(', '), u.title||'', u.body||'']); });
  row++;

  if ((d.facilities||[]).length > 0) {
    hdr('FACILITIES');
    wr(['Name','Hub','Latitude','Longitude','Catchment Pop','Annual Patients','Notes'], true);
    (d.facilities||[]).forEach(function(f) {
      wr([f.name||'', f.isHub ? 'Yes' : '', f.lat!=null?f.lat:'', f.lng!=null?f.lng:'',
          f.catchmentPop||'', f.annualPatients||'', f.notes||'']);
    });
  }

  // Formatting: set column widths. Cols 3 & 4 carry titles/notes so make them wide.
  sheet.setColumnWidth(1, 120);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 200);
  sheet.setColumnWidth(4, 260);
  [5,6,7,8,9].forEach(function(c) { sheet.setColumnWidth(c, 100); });
  sheet.setFrozenRows(0);
  SpreadsheetApp.flush();
}
