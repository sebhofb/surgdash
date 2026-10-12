// A light design for the web report (partner dashboards: per provider, "Design: White").
// The report is built dark (reports.js _buildDarkReportHtml); this turns the finished page
// into a soft dashboard in GSF colours: a pale Polo-blue canvas with white, rounded,
// softly shadowed cards; a Prussian-to-Boston header banner; Nunito throughout; smooth
// lines, rounded bars and round legend keys in the charts; pill buttons; the map from Polo
// to Prussian (few learners light). Text stays in ink tones; small-caps labels take a deep
// shade of their own colour; colour otherwise belongs to marks (charts, stars, tile discs).
// Swaps are exact strings, so anything not listed keeps its colour (logos are images).
Object.assign(window.App, {
    // GSF palette (index.html Tailwind config) and the report's gold
    GSF: { prussian: '#002F4C', boston: '#4389C8', polo: '#91B5D9', tango: '#E28743', crimson: '#D03734', gold: '#FFC145' },
    REPORT_WHITE_INK: { ink: '#0B2233', ink2: '#2B3F52', muted: '#5F7286' },

    // Text set in an accent colour on the dark page becomes ink here.
    REPORT_WHITE_TEXT_ACCENTS: ['#4389C8', '#E28743', '#FFC145', '#5AA9E6', '#3FB984', '#74BCE9', '#A78BFA', '#FFD27A', '#91B5D9', '#2F86C9', 'var(--accent)'],

    REPORT_WHITE_SWAPS: [
        // the world map, Polo to Prussian (first: the single-colour swaps below would break these strings)
        ["['#123a5c','#1a5485','#2474b3','#3f97d6','#74bce9','#bce3fb']", "['#E4EEF8','#C3D8EC','#91B5D9','#4F8FCB','#1F5F95','#002F4C']"],
        ['#123a5c,#1a5485,#2474b3,#3f97d6,#74bce9,#bce3fb', '#E4EEF8,#C3D8EC,#91B5D9,#4F8FCB,#1F5F95,#002F4C'],
        // the header: marked here, painted as a brand banner by the stylesheet
        ['background:linear-gradient(135deg,#4389C80D,#002033 62%)', 'background:var(--hero)'],
        // boxes that were tinted on the dark page: a flat light tint of the same colour
        [/linear-gradient\(\d+deg,(#[0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?,#(?:001a2b|002033|001523) \d+%\)/g, (m, c, a) => App._wTint(c, a ? Math.min(0.2, parseInt(a, 16) / 255 * 1.7) : 0.08)],
        [/(border(?:-top|-bottom|-left|-right)?:\s*\d+px solid )(#[0-9A-Fa-f]{6})[0-9A-Fa-f]{2}(?![0-9A-Fa-f])/g, (m, pre, c) => pre + App._wTint(c, 0.32)],
        [/radial-gradient\([^()]*(?:\([^()]*\)[^()]*)*\),var\(--surface\)/g, 'var(--surface)'],
        // bordered boxes become soft cards
        [/border:1px solid var\(--border\);border-radius:5px/g, 'border:1px solid transparent;border-radius:18px;box-shadow:var(--shadow)'],
        // the coloured bar on top of each stat tile becomes a ring in that colour (see .kdot)
        [/<div style="position:absolute;top:0;left:0;right:0;height:3px;background:(#[0-9A-Fa-f]{6})"><\/div>/g, '<div class="kdot" style="--c:$1"></div>'],
        // chart shapes: smoother lines, rounder bars
        [/tension:0\.3\d?(?=[,}])/g, 'tension:0.42'], [/borderRadius:2(?=[,}])/g, 'borderRadius:8'],
        // page and surfaces
        ['#001523', '#ffffff'], ['#001a2b', '#ffffff'], ['#002033', '#ffffff'], ['#002a42', '#F3F7FB'], ['#00101b', '#F3F7FB'],
        ['#04293f', '#ffffff'], ['#0b2c46', '#ECF1F6'], ['#0a3a57', '#E8EEF4'],
        // text tones
        ['#eef4f9', '#0B2233'], ['#eaf2f8', '#0B2233'], ['#d4dde7', '#2B3F52'], ['#d6dde3', '#2B3F52'], ['#b9cede', '#3D5164'],
        ['#b6c4d2', '#3D5164'], ['#aebccb', '#5F7286'], ['#9fc1dc', '#5F7286'], ['#9fb3c8', '#5F7286'], ['#6d8ba3', '#7A8B9C'],
        // marks in GSF colours, with enough weight on white
        ['#FFC145', '#F2B01E'], ['#f5b301', '#F2B01E'], ['#FFD27a', '#B7800A'], ['#74bce9', '#4389C8'], ['#5AA9E6', '#4389C8'], ['#3FB984', '#2E9E6E'],
        // lines and washes drawn in white on the dark page
        ['rgba(255,255,255,0.06)', 'rgba(0,47,76,0.06)'], ['rgba(255,255,255,.04)', 'rgba(0,47,76,.03)'],
        ['rgba(255,255,255,0.12)', 'rgba(0,47,76,0.08)'], ['rgba(255,255,255,.12)', 'rgba(0,47,76,.08)'],
        ['rgba(10,58,87,0.5)', '#EEF3F8'], ['rgba(255,193,69,0.14)', 'rgba(242,176,30,0.12)'],
        ['color-scheme:dark', 'color-scheme:light'],
    ],

    REPORT_WHITE_CSS: [
        ':root{--bg:#EEF4FA;--surface:#ffffff;--surface2:#F3F7FB;--border:#E8EEF4;--ink:#0B2233;--muted:#7A8B9C;--accent:#F2B01E;--accent-soft:rgba(242,176,30,.12);'
            + '--hero:linear-gradient(120deg,#002F4C 0%,#0B4F7C 55%,#4389C8 100%);--shadow:0 1px 2px rgba(0,47,76,.04),0 8px 24px rgba(0,47,76,.07);'
            + '--sans:"Nunito",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;--serif:var(--sans);--mono:var(--sans)}',
        'html,body{background:#EEF4FA!important;background-image:none!important;color:#0B2233;-webkit-font-smoothing:antialiased}',
        'body,h1,h2,h3{font-family:var(--sans)!important}h1,h2,h3{font-weight:800!important;letter-spacing:-.01em}',
        // cards: white, rounded, soft shadow, no border
        '.chart-card,.ratingband,.gstep-card{background:#fff!important;border:1px solid transparent!important;border-radius:18px!important;box-shadow:var(--shadow)!important}',
        '.kcard{background:#fff!important;border:1px solid transparent!important;border-radius:18px!important;box-shadow:var(--shadow)!important}',
        '.kcard:hover{transform:translateY(-2px)!important;box-shadow:0 2px 4px rgba(0,47,76,.05),0 14px 30px rgba(0,47,76,.11)!important}',
        // the coloured bar on top of a stat tile becomes a soft disc in its colour, top right
        '.kdot{position:absolute;top:18px;right:18px;width:42px;height:42px;border-radius:50%;background:color-mix(in srgb,var(--c) 16%,#fff)}',
        '.kdot::after{content:"";position:absolute;inset:11px;border-radius:50%;border:3.5px solid var(--c)}',
        // the header: a brand banner
        '[style*="background:var(--hero)"]{background:var(--hero)!important;border:0!important;border-radius:22px!important;box-shadow:0 10px 30px rgba(0,47,76,.18)!important;padding:30px 32px!important}',
        '[style*="background:var(--hero)"] h1,[style*="background:var(--hero)"] strong{color:#fff!important}',
        '[style*="background:var(--hero)"] p{color:rgba(255,255,255,.82)!important}',
        '[style*="background:var(--hero)"] div>p:first-child,[style*="background:var(--hero)"] div>p:last-child{color:#FFC145!important}',
        // testimonials: a pale blue box with the gold rule
        '[style*="border-left:3px solid var(--accent)"]{background:#F3F7FB!important;border-color:transparent!important;border-left-color:#F2B01E!important;border-radius:14px!important}',
        '.kpi-modal{background:rgba(0,47,76,.35)!important}.kpi-modal-box{border-radius:18px!important;box-shadow:0 20px 50px rgba(0,47,76,.2)!important;border-color:transparent!important}',
        // section labels: Prussian
        '.sec-eyebrow{color:#002F4C!important;font-size:11px!important;letter-spacing:.14em!important}.sec-eyebrow::after{display:none!important}',
        // controls: pills
        '.nav-btn{background:#fff!important;border-color:transparent!important;color:#002F4C!important;border-radius:999px!important;box-shadow:var(--shadow)}.nav-btn:hover{border-color:#4389C8!important}',
        '.dlb{border-color:#E1E9F1!important;color:#5F7286!important;border-radius:999px!important;padding:4px 10px!important;background:#fff!important}.dlb:hover{color:#002F4C!important;border-color:#4389C8!important}',
        '.pm-in{border-radius:999px!important;background:#F3F7FB!important;border-color:#E1E9F1!important}',
        'a.shl:hover{color:#4389C8!important;border-bottom-color:#4389C8!important}',
        'th{color:#7A8B9C!important}',
        '.dial .pc{fill:#002F4C!important}',
        '.rb-pct{color:#002F4C!important}.rb-stars{color:#F2B01E!important}',
        '@media print{html,body{background:#fff!important}}',
    ].join(''),

    // Chart.js defaults for this design, set after the library loads and before any chart is drawn
    REPORT_WHITE_CHART_JS: '<script>if(window.Chart){var D=Chart.defaults;D.font.family=\'"Nunito",-apple-system,"Segoe UI",sans-serif\';'
        + 'D.plugins.legend.labels.usePointStyle=true;D.plugins.legend.labels.pointStyle="circle";D.plugins.legend.labels.boxWidth=7;D.plugins.legend.labels.boxHeight=7;'
        + 'D.elements.bar.borderRadius=8;D.elements.line.borderWidth=2.5;D.elements.point.hoverRadius=5;}<\/script>',

    // a colour mixed with white (light box fills) or towards the ink (labels that must read on them)
    _wMix(hex, to, k) {
        const p = (x) => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16));
        const a = p(hex), b = p(to);
        return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, '0')).join('').toUpperCase();
    },
    _wTint(hex, alpha) { return this._wMix(hex, '#FFFFFF', 1 - alpha); },
    _wDeep(hex) { return this._wMix(hex, '#0B2233', 0.42); },

    reportToWhite(html) {
        let h = String(html || '');
        if (!h) return h;
        const I = this.REPORT_WHITE_INK;
        // 0. star ratings are marks, not text: they keep the gold
        h = h.replace(/color:var\(--accent\)(;font-size:11px;margin-left:8px;letter-spacing:\.1em)/g, 'color:#F2B01E$1');
        // 1. text in an accent colour (the CSS property `color`, never border-/background-color):
        //    small-caps labels a deep shade of their own colour (the tile's identity), everything else ink
        for (const a of this.REPORT_WHITE_TEXT_ACCENTS) {
            const esc = a.replace(/[()\-]/g, '\\$&');
            const deep = a === 'var(--accent)' ? '#8F6400' : this._wDeep(a);
            h = h.replace(new RegExp('(text-transform:uppercase;\\s*)color:\\s*' + esc + '(?![0-9A-Fa-f])', 'gi'), '$1color:' + deep);
            h = h.replace(new RegExp('(^|[^\\w-])color:\\s*' + esc + '(?![0-9A-Fa-f])', 'gi'), '$1color:' + I.ink2);
        }
        // 2. everything else, colour for colour (hex in any letter case; an alpha suffix stays)
        for (const [a, b] of this.REPORT_WHITE_SWAPS) {
            if (a instanceof RegExp) h = h.replace(a, b);
            else if (/^#[0-9A-F]{6}$/i.test(a)) h = h.replace(new RegExp(a, 'gi'), b);
            else h = h.split(a).join(b);
        }
        // 3. chart defaults right after Chart.js; the font and the stylesheet last in <head>
        h = h.replace(/(<script src="[^"]*chart\.umd(?:\.min)?\.js"><\/script>)/, '$1' + this.REPORT_WHITE_CHART_JS.replace('<\\/script>', '</script>'));
        const head = '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap">'
            + '<style id="white-theme">' + this.REPORT_WHITE_CSS + '</style>';
        const i = h.indexOf('</head>');
        return i >= 0 ? h.slice(0, i) + head + h.slice(i) : head + h;
    },
});
