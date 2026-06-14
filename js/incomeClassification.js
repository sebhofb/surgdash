// World Bank country income classification (FY2024 → FY2025 lists, calendar year 2024-2025).
// Source: https://datahelpdesk.worldbank.org/knowledgebase/articles/906519
// Keep country names aligned with `resolveCountryName()` outputs (see countryMap.js).
// We classify countries into four tiers + a fallback "Unknown" used for non-matches.

(function() {
    const HIC = new Set([
        'United States','United Kingdom','Germany','France','Canada','Australia','Japan',
        'South Korea','Italy','Spain','Netherlands','Belgium','Sweden','Norway','Denmark',
        'Finland','Switzerland','Austria','Ireland','Portugal','Greece','Israel','New Zealand',
        'Singapore','Hong Kong SAR, China','Taiwan, China','Czech Republic','Czechia',
        'Estonia','Latvia','Lithuania','Poland','Slovenia','Slovakia','Hungary','Croatia',
        'Cyprus','Malta','Luxembourg','Iceland','United Arab Emirates','Saudi Arabia',
        'Qatar','Kuwait','Bahrain','Oman','Bahamas','Barbados','Trinidad and Tobago',
        'Uruguay','Chile','Panama','Antigua and Barbuda','Saint Kitts and Nevis','Brunei',
        'Brunei Darussalam','Aruba','Bermuda','Cayman Islands','Channel Islands',
        'Faroe Islands','French Polynesia','Greenland','Guam','Isle of Man',
        'Liechtenstein','Macao SAR, China','Macao','Monaco','Nauru','New Caledonia',
        'Northern Mariana Islands','Palau','Puerto Rico','San Marino','Seychelles',
        'Sint Maarten (Dutch part)','St. Martin (French part)','Turks and Caicos Islands',
        'British Virgin Islands','U.S. Virgin Islands','Virgin Islands Us','Romania','Bulgaria','Andorra',
        'Guyana',
        // SURGhub data-spelling aliases (short / colloquial display names from the user export)
        'Hong Kong','Taiwan','Aland Islands','Anguilla',
        // Long-tail HIC territories seen in the data (France/UK/NL/NZ/AU dependencies)
        'Curacao','Curaçao','Gibraltar','Martinique','Reunion','Réunion','Bonaire',
        'Niue','Guernsey','Jersey','Falkland Islands','Cocos Islands','Montserrat',
        'Virgin Islands British',
    ]);

    const UMIC = new Set([
        'China','Brazil','Mexico','Russia','Russian Federation','Turkey','Argentina',
        'Colombia','Thailand','Malaysia','South Africa','Peru','Iraq','Kazakhstan',
        'Costa Rica','Dominican Republic','Ecuador','Jamaica','Paraguay','Serbia',
        'Bosnia and Herzegovina','Albania','North Macedonia','Montenegro','Belarus',
        'Azerbaijan','Georgia','Armenia','Botswana','Gabon','Mauritius','Namibia',
        'Libya','Iran','Iran, Islamic Rep.','Lebanon','Jordan','Indonesia',
        'Maldives','Fiji','Tonga','Tuvalu','Marshall Islands','Suriname','Belize',
        'Guatemala','El Salvador','Cuba','Equatorial Guinea','Turkmenistan',
        'Dominica','Grenada','Saint Lucia','Saint Vincent and the Grenadines',
        'American Samoa','Moldova','Republic of Moldova','Tuvalu',
        // SURGhub data-spelling aliases (misspelling / short form from the user export)
        'Azerbaidjan','Macedonia','Venezuela','Saint Vincent and Grenadines',
    ]);

    const LMIC = new Set([
        'India','Nigeria','Egypt','Pakistan','Bangladesh','Vietnam','Philippines',
        'Kenya','Ghana','Tanzania','Uganda','Zambia','Zimbabwe','Cameroon',
        'Ivory Coast', "Cote d'Ivoire","Côte d'Ivoire", "Cote d’Ivoire",
        'Senegal','Mauritania','Morocco','Tunisia','Algeria','Bolivia','Honduras',
        'Nicaragua','Haiti','Cape Verde','Cabo Verde','Comoros',
        'Sao Tome and Principe','Solomon Islands','Vanuatu','Samoa','Kiribati',
        'Papua New Guinea','Timor-Leste','East Timor','Timor Leste','Mongolia','Bhutan',
        'Sri Lanka','Nepal','Cambodia','Laos','Lao PDR','Myanmar','Burma',
        'Lesotho','Eswatini','Swaziland','Djibouti','Kyrgyzstan','Kyrgyz Republic',
        'Tajikistan','Uzbekistan','Ukraine','Kosovo','West Bank and Gaza','Palestine',
        'Angola','Benin','Congo','Republic of the Congo','Congo, Rep.','São Tomé and Príncipe',
        'Micronesia','Micronesia, Fed. Sts.',
    ]);

    const LIC = new Set([
        'Afghanistan','Burkina Faso','Burundi','Central African Republic',
        'Chad','Democratic Republic of the Congo','Congo, Dem. Rep.','DR Congo','DRC',
        'Eritrea','Ethiopia','Gambia','Guinea','Guinea-Bissau','Liberia',
        'Guinea Bissau','Madagascar','Malawi','Mali','Mozambique','Niger','North Korea',
        "Korea, Dem. People's Rep.",'Rwanda','Sierra Leone','Somalia',
        'South Sudan','Sudan','Syria','Syrian Arab Republic','Togo','Yemen',
        'Yemen, Rep.',
    ]);

    function classify(country) {
        if (!country) return 'Unknown';
        const c = country.trim();
        if (HIC.has(c))  return 'HIC';
        if (UMIC.has(c)) return 'UMIC';
        if (LMIC.has(c)) return 'LMIC';
        if (LIC.has(c))  return 'LIC';
        return 'Unknown';
    }

    function label(tier) {
        return ({
            HIC:  'High income',
            UMIC: 'Upper-middle income',
            LMIC: 'Lower-middle income',
            LIC:  'Low income',
            Unknown: 'Unclassified'
        })[tier] || tier;
    }

    function color(tier) {
        return ({
            HIC:  '#1a5276',  // dark blue
            UMIC: '#4389C8',  // mid blue
            LMIC: '#7A9E9F',  // teal
            LIC:  '#E28743',  // orange (priority signal)
            Unknown: '#cbd5e1'
        })[tier] || '#94a3b8';
    }

    // ── Lancet Commission on Global Surgery — countries with surgical-care gaps ──
    // Working list: low and lower-middle-income countries plus selected upper-middle
    // where 5 billion lack access (Lancet Commission 2015, Meara et al.).
    // GSF should swap this list with its own priority country list if available.
    const LANCET_PRIORITY = new Set([
        ...LIC, ...LMIC,
        // Selected UMIC with documented surgical-care gaps
        'Iraq','Iran','Iran, Islamic Rep.','Indonesia','South Africa','Brazil',
        'Mexico','Colombia','Peru','Guatemala','Ecuador','Belarus','Russia',
        'Russian Federation','Turkey','Kazakhstan','Bosnia and Herzegovina','Albania',
        'Libya','Lebanon','Jordan','Maldives',
    ]);

    function isLancetPriority(country) {
        return country ? LANCET_PRIORITY.has(country.trim()) : false;
    }

    window.IncomeClassification = { classify, label, color, isLancetPriority,
                                    tiers: ['HIC', 'UMIC', 'LMIC', 'LIC', 'Unknown'],
                                    priorityCountries: () => Array.from(LANCET_PRIORITY).sort() };
})();
