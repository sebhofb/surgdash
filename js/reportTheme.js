// A white design for the web report (partner dashboards: per provider, "Design: White").
// The report is built dark (reports.js _buildDarkReportHtml); this turns the finished page
// white. Principles: pure white page; structure from whitespace and hairlines, not shadows
// or tinted panels; text in ink tones only (colour belongs to chart marks, so a figure is
// never gold or orange); recessive grid and axes; a one-hue map ramp, light = few learners.
// Swaps are exact strings, so anything not listed keeps its colour (logos are images).
Object.assign(window.App, {
    REPORT_WHITE_INK: { ink: '#0B2233', ink2: '#2B3F52', label: '#0B4F7C', muted: '#5F7286', faint: '#8A9AAB', line: '#E6EAEF', wash: '#F7F9FB' },

    // Text set in an accent colour on the dark page becomes ink here.
    REPORT_WHITE_TEXT_ACCENTS: ['#4389C8', '#E28743', '#FFC145', '#5AA9E6', '#3FB984', '#74BCE9', '#A78BFA', '#FFD27A', '#91B5D9', '#2F86C9', 'var(--accent)'],

    REPORT_WHITE_SWAPS: [
        // the world map: one hue, few learners light, many dark; no data a neutral grey
        // (first: the single-colour swaps below would break these strings)
        ["['#123a5c','#1a5485','#2474b3','#3f97d6','#74bce9','#bce3fb']", "['#D6E6F4','#AECDEA','#7FAFDC','#4F8FCB','#2A6DAA','#0E4C80']"],
        ['#123a5c,#1a5485,#2474b3,#3f97d6,#74bce9,#bce3fb', '#D6E6F4,#AECDEA,#7FAFDC,#4F8FCB,#2A6DAA,#0E4C80'],
        // borders tinted with an accent: a plain hairline
        [/(border(?:-top|-bottom|-left|-right)?:\s*\d+px solid )#[0-9A-Fa-f]{6}[0-9A-Fa-f]{2}(?![0-9A-Fa-f])/g, '$1#E6EAEF'],
        // the tinted gradients of the dark cards: plain white
        [/linear-gradient\(\d+deg,#[0-9A-Fa-f]{6,8},#(?:001a2b|002033|001523) \d+%\)/g, '#ffffff'],
        [/radial-gradient\([^()]*(?:\([^()]*\)[^()]*)*\),var\(--surface\)/g, 'var(--surface)'],
        // page and surfaces
        ['#001523', '#ffffff'], ['#001a2b', '#ffffff'], ['#002033', '#ffffff'], ['#002a42', '#F7F9FB'], ['#00101b', '#F7F9FB'],
        ['#04293f', '#ffffff'], ['#0b2c46', '#EEF1F4'], ['#0a3a57', '#E6EAEF'],
        // text tones
        ['#eef4f9', '#0B2233'], ['#eaf2f8', '#0B2233'], ['#d4dde7', '#2B3F52'], ['#d6dde3', '#2B3F52'], ['#b9cede', '#3D5164'],
        ['#b6c4d2', '#3D5164'], ['#aebccb', '#5F7286'], ['#9fc1dc', '#5F7286'], ['#9fb3c8', '#5F7286'], ['#6d8ba3', '#6B7C8F'],
        // marks: the gold and the pale blues need more weight on white
        ['#FFC145', '#E3A008'], ['#f5b301', '#E3A008'], ['#FFD27a', '#B7800A'], ['#74bce9', '#4389C8'], ['#5AA9E6', '#3A7FBF'], ['#3FB984', '#2E9E6E'],
        // lines and washes drawn in white on the dark page
        ['rgba(255,255,255,0.06)', 'rgba(11,34,51,0.06)'], ['rgba(255,255,255,.04)', 'rgba(11,34,51,.03)'],
        ['rgba(255,255,255,0.12)', 'rgba(11,34,51,0.09)'], ['rgba(255,255,255,.12)', 'rgba(11,34,51,.09)'],
        ['rgba(10,58,87,0.5)', '#EEF1F4'], ['rgba(255,193,69,0.14)', 'rgba(227,160,8,0.10)'],
        ['color-scheme:dark', 'color-scheme:light'],
    ],

    REPORT_WHITE_CSS: [
        ':root{--bg:#ffffff;--surface:#ffffff;--surface2:#F7F9FB;--border:#E6EAEF;--ink:#0B2233;--muted:#6B7C8F;--accent:#E3A008;--accent-soft:rgba(227,160,8,.10);'
            + '--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}',
        'html,body{background:#ffffff!important;background-image:none!important;color:#0B2233;-webkit-font-smoothing:antialiased}',
        'body{font-family:var(--sans)!important}',
        // structure: hairlines, no shadows, no lift
        '.chart-card,.ratingband,.gstep-card{background:#fff!important;border:1px solid #E6EAEF!important;border-radius:10px!important;box-shadow:none!important}',
        '.kcard{background:#fff!important;border:1px solid #E6EAEF!important;border-top:1px solid #E6EAEF!important;border-radius:10px!important;box-shadow:none!important}',
        '.kcard>div[style*="height:3px"]{display:none!important}',
        '.kcard:hover{transform:none!important;box-shadow:none!important;border-color:#C9D3DD!important}',
        '.kpi-modal{background:rgba(11,34,51,.35)!important}.kpi-modal-box{box-shadow:0 20px 50px rgba(11,34,51,.18)!important;border-color:#E6EAEF!important}',
        // section labels: brand blue, quiet rule
        '.sec-eyebrow{color:#0B4F7C!important;letter-spacing:.16em!important}.sec-eyebrow::after{background:#E6EAEF!important;opacity:1!important;max-width:none!important}',
        // controls
        '.nav-btn{background:#fff!important;border-color:#E6EAEF!important;color:#2B3F52!important}.nav-btn:hover{border-color:#0B4F7C!important}',
        '.dlb{border-color:#E6EAEF!important;color:#6B7C8F!important}.dlb:hover{color:#0B4F7C!important;border-color:#0B4F7C!important}',
        'a.shl:hover{color:#0B4F7C!important;border-bottom-color:#0B4F7C!important}',
        'th{color:#6B7C8F!important}',
        '.dial .pc{fill:#0B2233!important}',
        '.rb-pct{color:#0B2233!important}.rb-stars{color:#E3A008!important}',
        '@media print{html,body{background:#fff!important}}',
    ].join(''),

    reportToWhite(html) {
        let h = String(html || '');
        if (!h) return h;
        const I = this.REPORT_WHITE_INK;
        // 0. star ratings are marks, not text: they keep the gold
        h = h.replace(/color:var\(--accent\)(;font-size:11px;margin-left:8px;letter-spacing:\.1em)/g, 'color:#E3A008$1');
        // 1. text in an accent colour (the CSS property `color`, never border-/background-color):
        //    small-caps labels take the brand blue of the section labels, everything else ink
        for (const a of this.REPORT_WHITE_TEXT_ACCENTS) {
            const esc = a.replace(/[()\-]/g, '\\$&');
            h = h.replace(new RegExp('(text-transform:uppercase;\\s*)color:\\s*' + esc + '(?![0-9A-Fa-f])', 'gi'), '$1color:' + I.label);
            h = h.replace(new RegExp('(^|[^\\w-])color:\\s*' + esc + '(?![0-9A-Fa-f])', 'gi'), '$1color:' + I.ink2);
        }
        // 2. everything else, colour for colour (hex in any letter case; an alpha suffix stays)
        for (const [a, b] of this.REPORT_WHITE_SWAPS) {
            if (a instanceof RegExp) h = h.replace(a, b);
            else if (/^#[0-9A-F]{6}$/i.test(a)) h = h.replace(new RegExp(a, 'gi'), b);
            else h = h.split(a).join(b);
        }
        // 3. the light stylesheet, last in <head> so it wins
        const css = '<style id="white-theme">' + this.REPORT_WHITE_CSS + '</style>';
        const i = h.indexOf('</head>');
        return i >= 0 ? h.slice(0, i) + css + h.slice(i) : css + h;
    },
});
