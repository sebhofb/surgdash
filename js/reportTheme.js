// A white design for the web report (partner dashboards: per provider, "Design: White").
// The report is built dark (reports.js _buildDarkReportHtml); this turns the finished page
// white: the palette in :root, the colours written into inline styles and chart scripts,
// the map ramp (light = few learners), and a light stylesheet on top. Colour swaps are
// exact strings, so anything not listed keeps its colour (logos are images, untouched).
Object.assign(window.App, {
    REPORT_WHITE_SWAPS: [
        // page and surfaces
        ['#001523', '#ffffff'], ['#001a2b', '#ffffff'], ['#002033', '#ffffff'], ['#002a42', '#f3f6f9'], ['#00101b', '#f3f6f9'],
        ['#04293f', '#ffffff'], ['#0b2c46', '#e9eef3'], ['#0a3a57', '#e1e7ee'],
        // text, darkest first
        ['#eef4f9', '#0b2233'], ['#eaf2f8', '#0b2233'], ['#d4dde7', '#22374a'], ['#d6dde3', '#2a4054'], ['#b9cede', '#3a5267'],
        ['#9fb3c8', '#4b6378'], ['#6d8ba3', '#647b90'], ['#b6c4d2', '#3f566b'], ['#aebccb', '#4b6378'], ['#9fc1dc', '#4b6378'],
        // pale accents that were made for the dark page
        ['#FFD27a', '#946700'], ['#74bce9', '#2f86c9'], ['#5AA9E6', '#2f86c9'], ['#3FB984', '#1f9a63'],
        // the gold: too pale for text on white, so a deeper GSF gold
        ['#FFC145', '#C28A00'], ['#f5b301', '#E0A200'],
        // lines and washes drawn in white on the dark page
        ['rgba(255,255,255,0.06)', 'rgba(11,34,51,0.08)'], ['rgba(255,255,255,.04)', 'rgba(11,34,51,.035)'],
        ['rgba(255,255,255,0.12)', 'rgba(11,34,51,0.10)'], ['rgba(255,255,255,.12)', 'rgba(11,34,51,.10)'],
        ['rgba(10,58,87,0.5)', 'rgba(11,34,51,0.08)'], ['rgba(255,193,69,0.14)', 'rgba(194,138,0,0.10)'],
        ['color-scheme:dark', 'color-scheme:light'],
        // the world map: few learners light, many dark
        ["['#123a5c','#1a5485','#2474b3','#3f97d6','#74bce9','#bce3fb']", "['#dcebf7','#b3d3ee','#7db2e0','#4389C8','#21689f','#0b4a75']"],
        ['#123a5c,#1a5485,#2474b3,#3f97d6,#74bce9,#bce3fb', '#dcebf7,#b3d3ee,#7db2e0,#4389C8,#21689f,#0b4a75'],   // its legend
    ],
    REPORT_WHITE_CSS: [
        'body{background:#f5f7fa!important;background-image:none!important;color:#0b2233}',
        '.chart-card,.ratingband,.kpi-modal-box,.gstep-card{border-color:#e3e9ef!important;box-shadow:0 1px 2px rgba(11,34,51,.05),0 6px 18px rgba(11,34,51,.06)!important;border-radius:12px!important}',
        '.kcard{border-radius:12px!important;box-shadow:0 1px 2px rgba(11,34,51,.05),0 6px 18px rgba(11,34,51,.06)!important}',
        '.kcard:hover{box-shadow:0 14px 34px rgba(11,34,51,.12)!important}',
        '.sec-eyebrow{color:#0B4F7C!important}.sec-eyebrow::after{background:#4389C8!important;opacity:.35!important}',
        '.nav-btn{background:#fff!important;box-shadow:0 1px 2px rgba(11,34,51,.06)}',
        '.dial .pc{fill:#0b2233!important}',
        '.kpi-modal{background:rgba(11,34,51,.45)!important}',
        '@media print{body{background:#fff!important}}',
    ].join(''),

    reportToWhite(html) {
        let h = String(html || '');
        if (!h) return h;
        // hex colours in any letter case; an alpha suffix stays ('#FFC14514' → '#C28A0014')
        for (const [a, b] of this.REPORT_WHITE_SWAPS) {
            if (/^#[0-9A-F]{6}$/i.test(a)) h = h.replace(new RegExp(a, 'gi'), b);
            else h = h.split(a).join(b);
        }
        const css = '<style id="white-theme">' + this.REPORT_WHITE_CSS + '</style>';
        const i = h.indexOf('</head>');
        return i >= 0 ? h.slice(0, i) + css + h.slice(i) : css + h;
    },
});
