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
    "ZM":"Zambia","ZW":"Zimbabwe",
    // ── Added Aug 2026: the base map lacked 100 territories (Malta, Israel, Bahrain, Latvia …),
    // so countryToISO() returned null for real learners and GeoCharts / per-100k tabs dropped them.
    "AD":"Andorra","AG":"Antigua and Barbuda","AI":"Anguilla","AQ":"Antarctica","AS":"American Samoa",
    "AW":"Aruba","AX":"Aland Islands","BB":"Barbados","BH":"Bahrain","BM":"Bermuda",
    "BQ":"Bonaire","BS":"Bahamas","BT":"Bhutan","BY":"Belarus","BZ":"Belize",
    "CC":"Cocos Islands","CK":"Cook Islands","CV":"Cape Verde","CW":"Curacao","DJ":"Djibouti",
    "DM":"Dominica","EH":"Western Sahara","FK":"Falkland Islands","FM":"Micronesia","FO":"Faroe Islands",
    "GD":"Grenada","GG":"Guernsey","GI":"Gibraltar","GL":"Greenland","GU":"Guam",
    "GW":"Guinea-Bissau","HK":"Hong Kong","IL":"Israel","IM":"Isle of Man","IS":"Iceland",
    "JE":"Jersey","KI":"Kiribati","KM":"Comoros","KN":"Saint Kitts and Nevis","KP":"North Korea",
    "KY":"Cayman Islands","LC":"Saint Lucia","LI":"Liechtenstein","LV":"Latvia","MC":"Monaco",
    "MD":"Moldova","ME":"Montenegro","MH":"Marshall Islands","MK":"North Macedonia","MO":"Macao",
    "MP":"Northern Mariana Islands","MQ":"Martinique","MR":"Mauritania","MS":"Montserrat","MT":"Malta",
    "MU":"Mauritius","MV":"Maldives","NC":"New Caledonia","NR":"Nauru","NU":"Niue",
    "PF":"French Polynesia","PR":"Puerto Rico","PS":"Palestine","PW":"Palau","RE":"Reunion",
    "SB":"Solomon Islands","SC":"Seychelles","SM":"San Marino","SR":"Suriname","ST":"Sao Tome and Principe",
    "SX":"Sint Maarten","SZ":"Eswatini","TC":"Turks and Caicos Islands","TL":"Timor-Leste","TM":"Turkmenistan",
    "TO":"Tonga","TT":"Trinidad and Tobago","TV":"Tuvalu","VC":"Saint Vincent and the Grenadines","VG":"British Virgin Islands",
    "VI":"U.S. Virgin Islands","VU":"Vanuatu","WF":"Wallis and Futuna","WS":"Samoa","XK":"Kosovo",
    "IO":"British Indian Ocean Territory","PM":"Saint Pierre and Miquelon","SH":"Saint Helena","GS":"South Georgia","TK":"Tokelau",
    "PN":"Pitcairn","NF":"Norfolk Island","CX":"Christmas Island","SJ":"Svalbard and Jan Mayen","BL":"Saint Barthelemy",
    "MF":"Saint Martin","YT":"Mayotte","GF":"French Guiana","GP":"Guadeloupe","VA":"Vatican City"
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
        // ── Added Aug 2026: World-Bank-style and verbose spellings used by the income
        // classification table, the conflict (FCV) list and the signup survey data.
        "congo, dem. rep.": 'CD',
        "congo, the democratic republic of the": 'CD',
        "congo (kinshasa)": 'CD',
        "congo, rep.": 'CG',
        "republic of the congo": 'CG',
        "congo (brazzaville)": 'CG',
        "iran, islamic rep.": 'IR',
        "iran, islamic republic of": 'IR',
        "syrian arab republic": 'SY',
        "yemen, rep.": 'YE',
        "korea, dem. people's rep.": 'KP',
        "korea, dem. people’s rep.": 'KP',
        "democratic people's republic of korea": 'KP',
        "korea, rep.": 'KR',
        "west bank and gaza": 'PS',
        "palestinian territory, occupied": 'PS',
        "state of palestine": 'PS',
        "occupied palestinian territory": 'PS',
        "gaza": 'PS',
        "palestinian territory": 'PS',
        "lao pdr": 'LA',
        "lao people's democratic republic": 'LA',
        "kyrgyz republic": 'KG',
        "micronesia, fed. sts.": 'FM',
        "federated states of micronesia": 'FM',
        "hong kong sar, china": 'HK',
        "macao sar, china": 'MO',
        "macau sar, china": 'MO',
        "taiwan, china": 'TW',
        "russian federation": 'RU',
        "republic of moldova": 'MD',
        "moldova, republic of": 'MD',
        "azerbaidjan": 'AZ',
        "guinea bissau": 'GW',
        "central african rep.": 'CF',
        "curaçao": 'CW',
        "réunion": 'RE',
        "cote d’ivoire": 'CI',
        "côte d’ivoire": 'CI',
        "virgin islands us": 'VI',
        "virgin islands (u.s.)": 'VI',
        "u.s. virgin islands": 'VI',
        "virgin islands british": 'VG',
        "virgin islands (british)": 'VG',
        "british virgin islands": 'VG',
        "saint vincent and grenadines": 'VC',
        "st. vincent and the grenadines": 'VC',
        "st. lucia": 'LC',
        "st. kitts and nevis": 'KN',
        "são tomé and príncipe": 'ST',
        "sao tome & principe": 'ST',
        "sint maarten (dutch part)": 'SX',
        "st. martin (french part)": 'MF',
        "saint martin (french part)": 'MF',
        "bahamas, the": 'BS',
        "gambia, the": 'GM',
        "egypt, arab rep.": 'EG',
        "venezuela, rb": 'VE',
        "slovak republic": 'SK',
        "türkiye": 'TR',
        "turkiye": 'TR',
        "channel islands": 'JE',
        "cocos (keeling) islands": 'CC',
        "holy see": 'VA',
        "vatican": 'VA',
        "united states virgin islands": 'VI',
        "cabo verde": 'CV',
        "east timor": 'TL',
        "antarctica": 'AQ',
        "british indian ocean territory": 'IO',
        "aland islands": 'AX',
        "åland islands": 'AX',
        "wallis and futuna": 'WF',
        "north macedonia": 'MK',
        "kosovo": 'XK',
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
