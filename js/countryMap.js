// ISO 3166-1 alpha-2 codes to full country names
window.COUNTRY_CODE_MAP = {
    "AF":"Afghanistan","AL":"Albania","DZ":"Algeria","AO":"Angola",
    "AR":"Argentina","AM":"Armenia","AU":"Australia","AT":"Austria",
    "AZ":"Azerbaijan","BD":"Bangladesh","BE":"Belgium","BJ":"Benin",
    "BO":"Bolivia","BA":"Bosnia and Herzegovina","BW":"Botswana",
    "BR":"Brazil","BN":"Brunei","BG":"Bulgaria","BF":"Burkina Faso",
    "BI":"Burundi","KH":"Cambodia","CM":"Cameroon","CA":"Canada",
    "CF":"Central African Republic","TD":"Chad","CL":"Chile","CN":"China",
    "CO":"Colombia","CG":"Congo","CD":"DR Congo","CR":"Costa Rica",
    "CI":"Ivory Coast","HR":"Croatia","CU":"Cuba","CY":"Cyprus",
    "CZ":"Czech Republic","DK":"Denmark","DO":"Dominican Republic",
    "EC":"Ecuador","EG":"Egypt","SV":"El Salvador","GQ":"Equatorial Guinea",
    "ER":"Eritrea","EE":"Estonia","ET":"Ethiopia","FJ":"Fiji",
    "FI":"Finland","FR":"France","GA":"Gabon","GM":"Gambia",
    "GE":"Georgia","DE":"Germany","GH":"Ghana","GR":"Greece",
    "GT":"Guatemala","GN":"Guinea","GY":"Guyana","HT":"Haiti",
    "HN":"Honduras","HU":"Hungary","IN":"India","ID":"Indonesia",
    "IR":"Iran","IQ":"Iraq","IE":"Ireland","IT":"Italy",
    "JM":"Jamaica","JP":"Japan","JO":"Jordan","KZ":"Kazakhstan",
    "KE":"Kenya","KW":"Kuwait","KG":"Kyrgyzstan","LA":"Laos",
    "LB":"Lebanon","LS":"Lesotho","LR":"Liberia","LY":"Libya",
    "LT":"Lithuania","LU":"Luxembourg","MG":"Madagascar","MW":"Malawi",
    "MY":"Malaysia","ML":"Mali","MX":"Mexico","MN":"Mongolia",
    "MA":"Morocco","MZ":"Mozambique","MM":"Myanmar","NA":"Namibia",
    "NP":"Nepal","NL":"Netherlands","NZ":"New Zealand","NI":"Nicaragua",
    "NE":"Niger","NG":"Nigeria","NO":"Norway","OM":"Oman",
    "PK":"Pakistan","PA":"Panama","PG":"Papua New Guinea","PY":"Paraguay",
    "PE":"Peru","PH":"Philippines","PL":"Poland","PT":"Portugal",
    "QA":"Qatar","RO":"Romania","RU":"Russia","RW":"Rwanda",
    "SA":"Saudi Arabia","SN":"Senegal","RS":"Serbia","SL":"Sierra Leone",
    "SG":"Singapore","SK":"Slovakia","SI":"Slovenia","SO":"Somalia",
    "ZA":"South Africa","KR":"South Korea","SS":"South Sudan",
    "ES":"Spain","LK":"Sri Lanka","SD":"Sudan","SE":"Sweden",
    "CH":"Switzerland","SY":"Syria","TW":"Taiwan","TJ":"Tajikistan",
    "TZ":"Tanzania","TH":"Thailand","TG":"Togo","TN":"Tunisia",
    "TR":"Turkey","UG":"Uganda","UA":"Ukraine","AE":"United Arab Emirates",
    "GB":"United Kingdom","US":"United States","UY":"Uruguay",
    "UZ":"Uzbekistan","VE":"Venezuela","VN":"Vietnam","YE":"Yemen",
    "ZM":"Zambia","ZW":"Zimbabwe"
};

// Verbose survey names → short display names
window.COUNTRY_NAME_ALIASES = {
    "tanzania, united republic of": "Tanzania",
    "palestinian territory, occupied": "Palestine",
    "congo, the democratic republic of the": "DR Congo",
    "iran, islamic republic of": "Iran",
    "korea, republic of": "South Korea",
    "korea, democratic people's republic of": "North Korea",
    "lao people's democratic republic": "Laos",
    "russian federation": "Russia",
    "syrian arab republic": "Syria",
    "viet nam": "Vietnam",
    "taiwan, province of china": "Taiwan",
    "venezuela, bolivarian republic of": "Venezuela",
    "bolivia, plurinational state of": "Bolivia",
    "micronesia, federated states of": "Micronesia",
    "moldova, republic of": "Moldova",
    "macedonia, the former yugoslav republic of": "North Macedonia"
};

// Resolve a country value: if it's a 2-letter code, map it; normalize verbose names
window.resolveCountryName = function(val) {
    if (!val) return null;
    let s = String(val).trim();
    if (!s || s.length < 2) return null;
    // Skip URLs, paths, numbers
    if (s.startsWith('/') || s.startsWith('http') || s.match(/^\d+$/)) return null;
    if (['unknown','nan','','0','null','undefined'].includes(s.toLowerCase())) return null;
    // If it's a 2-letter uppercase code, look it up
    if (s.length === 2 && s === s.toUpperCase() && window.COUNTRY_CODE_MAP[s]) {
        return window.COUNTRY_CODE_MAP[s];
    }
    // If it's a short string that doesn't look like a country, skip
    if (s.length <= 3 && !window.COUNTRY_CODE_MAP[s.toUpperCase()]) return null;
    // Check for verbose survey names
    let alias = window.COUNTRY_NAME_ALIASES[s.toLowerCase()];
    if (alias) return alias;
    // Already a full name
    return s;
};

// ── Country name → ISO 3166-1 alpha-2 code ──────────────────────────────
// Google GeoChart resolves ISO codes natively WITHOUT geocoding (no Maps API
// key needed). Feeding codes instead of names prevents the geocoding flood.
window.COUNTRY_NAME_TO_ISO = (function () {
    const m = {};
    if (window.COUNTRY_CODE_MAP) {
        for (const [code, name] of Object.entries(window.COUNTRY_CODE_MAP)) {
            m[String(name).toLowerCase()] = code;
        }
    }
    // Common aliases / colloquial names → code
    Object.assign(m, {
        'usa': 'US', 'u.s.': 'US', 'u.s.a.': 'US', 'united states of america': 'US', 'us': 'US',
        'uk': 'GB', 'great britain': 'GB', 'britain': 'GB', 'united kingdom of great britain': 'GB',
        'uae': 'AE', 'emirates': 'AE',
        'drc': 'CD', 'dr congo': 'CD', 'democratic republic of congo': 'CD', 'democratic republic of the congo': 'CD',
        'republic of congo': 'CG', 'congo-brazzaville': 'CG', 'congo-kinshasa': 'CD',
        'ivory coast': 'CI', "cote d'ivoire": 'CI', "côte d'ivoire": 'CI', 'côte d’ivoire': 'CI',
        'south korea': 'KR', 'republic of korea': 'KR', 'north korea': 'KP',
        'russia': 'RU', 'syria': 'SY', 'iran': 'IR', 'vietnam': 'VN', 'viet nam': 'VN',
        'laos': 'LA', 'tanzania': 'TZ', 'moldova': 'MD', 'bolivia': 'BO', 'venezuela': 'VE',
        'czechia': 'CZ', 'czech republic': 'CZ', 'turkey': 'TR', 'turkiye': 'TR', 'türkiye': 'TR',
        'palestine': 'PS', 'palestinian territories': 'PS',
        'cape verde': 'CV', 'cabo verde': 'CV', 'east timor': 'TL', 'timor-leste': 'TL', 'timor leste': 'TL',
        'eswatini': 'SZ', 'swaziland': 'SZ', 'myanmar': 'MM', 'burma': 'MM',
        'brunei darussalam': 'BN', 'brunei': 'BN', 'kyrgyzstan': 'KG', 'kyrgystan': 'KG',
        'hong kong': 'HK', 'macau': 'MO', 'macao': 'MO', 'taiwan': 'TW',
        'north macedonia': 'MK', 'macedonia': 'MK', 'kosovo': 'XK',
        'sao tome and principe': 'ST', 'south sudan': 'SS',
    });
    return m;
})();

// Return ISO alpha-2 code for a country name, or null if unknown.
window.countryToISO = function (name) {
    if (!name) return null;
    const n = String(name).trim().toLowerCase();
    if (!n) return null;
    // already a 2-letter code?
    if (n.length === 2 && window.COUNTRY_CODE_MAP && window.COUNTRY_CODE_MAP[n.toUpperCase()]) return n.toUpperCase();
    return window.COUNTRY_NAME_TO_ISO[n] || null;
};
