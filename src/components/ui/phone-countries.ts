// OWNER: foundation-ui.
//
// Country calling codes for PhoneInput (ITU-T E.164 assignments) and the pure helpers that turn a country plus a typed
// number into E.164 ("+14155551234"). Server and client safe. National number lengths are checked for the common
// countries; others fall back to the E.164 limits (total 8 to 15 digits).

export type PhoneCountry = { iso: string; name: string; dial: string; min?: number; max?: number };

// [iso, name, dial code, min national digits, max national digits]
type Row = [string, string, string, number?, number?];

const ROWS: Row[] = [
  ["US", "United States", "1", 10, 10],
  ["CA", "Canada", "1", 10, 10],
  ["GB", "United Kingdom", "44", 9, 10],
  ["AU", "Australia", "61", 9, 9],
  ["IN", "India", "91", 10, 10],
  ["DE", "Germany", "49", 6, 13],
  ["FR", "France", "33", 9, 9],
  ["ES", "Spain", "34", 9, 9],
  ["IT", "Italy", "39", 6, 11],
  ["NL", "Netherlands", "31", 9, 9],
  ["BR", "Brazil", "55", 10, 11],
  ["MX", "Mexico", "52", 10, 10],
  ["AF", "Afghanistan", "93"],
  ["AL", "Albania", "355"],
  ["DZ", "Algeria", "213"],
  ["AS", "American Samoa", "1684"],
  ["AD", "Andorra", "376"],
  ["AO", "Angola", "244"],
  ["AI", "Anguilla", "1264"],
  ["AG", "Antigua and Barbuda", "1268"],
  ["AR", "Argentina", "54", 10, 11],
  ["AM", "Armenia", "374"],
  ["AW", "Aruba", "297"],
  ["AT", "Austria", "43", 4, 13],
  ["AZ", "Azerbaijan", "994"],
  ["BS", "Bahamas", "1242"],
  ["BH", "Bahrain", "973"],
  ["BD", "Bangladesh", "880"],
  ["BB", "Barbados", "1246"],
  ["BY", "Belarus", "375"],
  ["BE", "Belgium", "32", 8, 9],
  ["BZ", "Belize", "501"],
  ["BJ", "Benin", "229"],
  ["BM", "Bermuda", "1441"],
  ["BT", "Bhutan", "975"],
  ["BO", "Bolivia", "591"],
  ["BA", "Bosnia and Herzegovina", "387"],
  ["BW", "Botswana", "267"],
  ["BN", "Brunei", "673"],
  ["BG", "Bulgaria", "359"],
  ["BF", "Burkina Faso", "226"],
  ["BI", "Burundi", "257"],
  ["KH", "Cambodia", "855"],
  ["CM", "Cameroon", "237"],
  ["CV", "Cape Verde", "238"],
  ["KY", "Cayman Islands", "1345"],
  ["CF", "Central African Republic", "236"],
  ["TD", "Chad", "235"],
  ["CL", "Chile", "56", 9, 9],
  ["CN", "China", "86", 11, 11],
  ["CO", "Colombia", "57", 10, 10],
  ["KM", "Comoros", "269"],
  ["CG", "Congo", "242"],
  ["CD", "Congo (DRC)", "243"],
  ["CR", "Costa Rica", "506", 8, 8],
  ["CI", "Cote d'Ivoire", "225"],
  ["HR", "Croatia", "385"],
  ["CU", "Cuba", "53"],
  ["CW", "Curacao", "599"],
  ["CY", "Cyprus", "357"],
  ["CZ", "Czechia", "420", 9, 9],
  ["DK", "Denmark", "45", 8, 8],
  ["DJ", "Djibouti", "253"],
  ["DM", "Dominica", "1767"],
  ["DO", "Dominican Republic", "1809"],
  ["EC", "Ecuador", "593"],
  ["EG", "Egypt", "20", 10, 10],
  ["SV", "El Salvador", "503"],
  ["GQ", "Equatorial Guinea", "240"],
  ["ER", "Eritrea", "291"],
  ["EE", "Estonia", "372"],
  ["SZ", "Eswatini", "268"],
  ["ET", "Ethiopia", "251"],
  ["FO", "Faroe Islands", "298"],
  ["FJ", "Fiji", "679"],
  ["FI", "Finland", "358", 5, 12],
  ["GF", "French Guiana", "594"],
  ["PF", "French Polynesia", "689"],
  ["GA", "Gabon", "241"],
  ["GM", "Gambia", "220"],
  ["GE", "Georgia", "995"],
  ["GH", "Ghana", "233"],
  ["GI", "Gibraltar", "350"],
  ["GR", "Greece", "30", 10, 10],
  ["GL", "Greenland", "299"],
  ["GD", "Grenada", "1473"],
  ["GP", "Guadeloupe", "590"],
  ["GU", "Guam", "1671"],
  ["GT", "Guatemala", "502"],
  ["GN", "Guinea", "224"],
  ["GW", "Guinea-Bissau", "245"],
  ["GY", "Guyana", "592"],
  ["HT", "Haiti", "509"],
  ["HN", "Honduras", "504"],
  ["HK", "Hong Kong", "852", 8, 8],
  ["HU", "Hungary", "36"],
  ["IS", "Iceland", "354"],
  ["ID", "Indonesia", "62"],
  ["IR", "Iran", "98"],
  ["IQ", "Iraq", "964"],
  ["IE", "Ireland", "353", 7, 9],
  ["IL", "Israel", "972", 8, 9],
  ["JM", "Jamaica", "1876"],
  ["JP", "Japan", "81", 9, 10],
  ["JO", "Jordan", "962"],
  ["KZ", "Kazakhstan", "7"],
  ["KE", "Kenya", "254"],
  ["KI", "Kiribati", "686"],
  ["XK", "Kosovo", "383"],
  ["KW", "Kuwait", "965"],
  ["KG", "Kyrgyzstan", "996"],
  ["LA", "Laos", "856"],
  ["LV", "Latvia", "371"],
  ["LB", "Lebanon", "961"],
  ["LS", "Lesotho", "266"],
  ["LR", "Liberia", "231"],
  ["LY", "Libya", "218"],
  ["LI", "Liechtenstein", "423"],
  ["LT", "Lithuania", "370"],
  ["LU", "Luxembourg", "352"],
  ["MO", "Macao", "853"],
  ["MG", "Madagascar", "261"],
  ["MW", "Malawi", "265"],
  ["MY", "Malaysia", "60"],
  ["MV", "Maldives", "960"],
  ["ML", "Mali", "223"],
  ["MT", "Malta", "356"],
  ["MH", "Marshall Islands", "692"],
  ["MQ", "Martinique", "596"],
  ["MR", "Mauritania", "222"],
  ["MU", "Mauritius", "230"],
  ["FM", "Micronesia", "691"],
  ["MD", "Moldova", "373"],
  ["MC", "Monaco", "377"],
  ["MN", "Mongolia", "976"],
  ["ME", "Montenegro", "382"],
  ["MS", "Montserrat", "1664"],
  ["MA", "Morocco", "212"],
  ["MZ", "Mozambique", "258"],
  ["MM", "Myanmar", "95"],
  ["NA", "Namibia", "264"],
  ["NR", "Nauru", "674"],
  ["NP", "Nepal", "977"],
  ["NC", "New Caledonia", "687"],
  ["NZ", "New Zealand", "64", 8, 10],
  ["NI", "Nicaragua", "505"],
  ["NE", "Niger", "227"],
  ["NG", "Nigeria", "234", 10, 10],
  ["KP", "North Korea", "850"],
  ["MK", "North Macedonia", "389"],
  ["MP", "Northern Mariana Islands", "1670"],
  ["NO", "Norway", "47", 8, 8],
  ["OM", "Oman", "968"],
  ["PK", "Pakistan", "92", 10, 10],
  ["PW", "Palau", "680"],
  ["PS", "Palestine", "970"],
  ["PA", "Panama", "507"],
  ["PG", "Papua New Guinea", "675"],
  ["PY", "Paraguay", "595"],
  ["PE", "Peru", "51", 9, 9],
  ["PH", "Philippines", "63", 10, 10],
  ["PL", "Poland", "48", 9, 9],
  ["PT", "Portugal", "351", 9, 9],
  ["PR", "Puerto Rico", "1787"],
  ["QA", "Qatar", "974"],
  ["RE", "Reunion", "262"],
  ["RO", "Romania", "40", 9, 9],
  ["RU", "Russia", "7", 10, 10],
  ["RW", "Rwanda", "250"],
  ["KN", "Saint Kitts and Nevis", "1869"],
  ["LC", "Saint Lucia", "1758"],
  ["VC", "Saint Vincent and the Grenadines", "1784"],
  ["WS", "Samoa", "685"],
  ["SM", "San Marino", "378"],
  ["ST", "Sao Tome and Principe", "239"],
  ["SA", "Saudi Arabia", "966", 9, 9],
  ["SN", "Senegal", "221"],
  ["RS", "Serbia", "381"],
  ["SC", "Seychelles", "248"],
  ["SL", "Sierra Leone", "232"],
  ["SG", "Singapore", "65", 8, 8],
  ["SX", "Sint Maarten", "1721"],
  ["SK", "Slovakia", "421", 9, 9],
  ["SI", "Slovenia", "386"],
  ["SB", "Solomon Islands", "677"],
  ["SO", "Somalia", "252"],
  ["ZA", "South Africa", "27", 9, 9],
  ["KR", "South Korea", "82", 9, 10],
  ["SS", "South Sudan", "211"],
  ["LK", "Sri Lanka", "94", 9, 9],
  ["SD", "Sudan", "249"],
  ["SR", "Suriname", "597"],
  ["SE", "Sweden", "46", 7, 9],
  ["CH", "Switzerland", "41", 9, 9],
  ["SY", "Syria", "963"],
  ["TW", "Taiwan", "886", 9, 9],
  ["TJ", "Tajikistan", "992"],
  ["TZ", "Tanzania", "255"],
  ["TH", "Thailand", "66", 9, 9],
  ["TL", "Timor-Leste", "670"],
  ["TG", "Togo", "228"],
  ["TO", "Tonga", "676"],
  ["TT", "Trinidad and Tobago", "1868"],
  ["TN", "Tunisia", "216"],
  ["TR", "Turkey", "90", 10, 10],
  ["TM", "Turkmenistan", "993"],
  ["TC", "Turks and Caicos Islands", "1649"],
  ["TV", "Tuvalu", "688"],
  ["UG", "Uganda", "256"],
  ["UA", "Ukraine", "380", 9, 9],
  ["AE", "United Arab Emirates", "971", 8, 9],
  ["UY", "Uruguay", "598"],
  ["VI", "U.S. Virgin Islands", "1340"],
  ["UZ", "Uzbekistan", "998"],
  ["VU", "Vanuatu", "678"],
  ["VA", "Vatican City", "39"],
  ["VE", "Venezuela", "58"],
  ["VN", "Vietnam", "84", 9, 10],
  ["YE", "Yemen", "967"],
  ["ZM", "Zambia", "260"],
  ["ZW", "Zimbabwe", "263"],
];

/** Every country, sorted by name (the first 12 rows above are only an authoring convenience). */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = ROWS.map(([iso, name, dial, min, max]) => ({ iso, name, dial, min, max })).sort((a, b) =>
  a.name.localeCompare(b.name),
);

const BY_ISO = new Map(PHONE_COUNTRIES.map((c) => [c.iso, c]));

export function phoneCountry(iso: string | null | undefined): PhoneCountry | null {
  return iso ? (BY_ISO.get(iso.toUpperCase()) ?? null) : null;
}

/** Regional indicator flag emoji for an ISO 3166-1 alpha-2 code ("US" -> the US flag). */
export function flagEmoji(iso: string): string {
  const up = iso.toUpperCase();
  if (!/^[A-Z]{2}$/.test(up)) return "";
  return String.fromCodePoint(...[...up].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

export const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

/** Countries whose national numbers keep a leading 0 (no trunk prefix to drop). */
const KEEPS_LEADING_ZERO = new Set(["IT", "SM", "VA", "CI", "GA", "TG", "CG"]);

/** Digits only. */
export function phoneDigits(text: string): string {
  return text.replace(/\D/g, "");
}

/**
 * Detects the country of an international number by the longest matching calling code, preferring `preferred` when it
 * shares the code (+1 is the US unless Canada was chosen; +7 Russia unless Kazakhstan).
 */
export function detectPhoneCountry(e164: string, preferred?: string | null): PhoneCountry | null {
  const digits = phoneDigits(e164);
  const pref = phoneCountry(preferred);
  if (pref && digits.startsWith(pref.dial)) return pref;
  let best: PhoneCountry | null = null;
  for (const c of PHONE_COUNTRIES) {
    if (digits.startsWith(c.dial) && (!best || c.dial.length > best.dial.length)) best = c;
  }
  if (best && (best.dial === "1" || best.dial === "7")) return phoneCountry(best.dial === "1" ? "US" : "RU");
  return best;
}

/** Whether a national number has a plausible length for the country. */
export function isValidNational(country: PhoneCountry, national: string): boolean {
  const n = phoneDigits(national);
  const total = country.dial.length + n.length;
  if (total < 8 || total > 15) return false;
  if (country.min !== undefined && n.length < country.min) return false;
  if (country.max !== undefined && n.length > country.max) return false;
  return true;
}

/**
 * E.164 from a country and what the user typed, or null when incomplete or invalid. Typed text starting with "+" (or
 * "00") is read as an international number; a single national trunk "0" is dropped ("07700 900123" in GB ->
 * "+447700900123").
 */
export function toE164(countryIso: string, typed: string): string | null {
  const trimmed = typed.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+") || trimmed.startsWith("00")) {
    const digits = phoneDigits(trimmed.startsWith("00") ? trimmed.slice(2) : trimmed);
    const country = detectPhoneCountry(`+${digits}`, countryIso);
    if (!country) return null;
    const national = digits.slice(country.dial.length);
    const e164 = `+${digits}`;
    return E164_PATTERN.test(e164) && isValidNational(country, national) ? e164 : null;
  }
  const country = phoneCountry(countryIso);
  if (!country) return null;
  let national = phoneDigits(trimmed);
  if (national.startsWith("0") && !KEEPS_LEADING_ZERO.has(country.iso)) national = national.slice(1);
  // US and Canada numbers typed with the leading 1.
  if (country.dial === "1" && national.length === 11 && national.startsWith("1")) national = national.slice(1);
  if (!isValidNational(country, national)) return null;
  const e164 = `+${country.dial}${national}`;
  return E164_PATTERN.test(e164) ? e164 : null;
}

/** Splits a stored E.164 value into its country and national part (for editing). */
export function splitE164(e164: string | null | undefined, preferred?: string | null): { country: PhoneCountry | null; national: string } {
  if (!e164 || !E164_PATTERN.test(e164)) return { country: phoneCountry(preferred), national: "" };
  const country = detectPhoneCountry(e164, preferred);
  return { country, national: country ? e164.slice(1 + country.dial.length) : e164 };
}
