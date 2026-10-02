// Kategorier for bankposteringer, faste træk/abonnementer og månedsopsummering.
// Rene funktioner (ingen Firebase) — testes i tests/categorize.test.mjs.
import { normText } from './bankmatch.js';

export const CATEGORIES = [
  { id: 'groceries', name: 'Dagligvarer', icon: '🛒' },
  { id: 'eatout', name: 'Restaurant & café', icon: '🍽️' },
  { id: 'transport', name: 'Transport & bil', icon: '🚗' },
  { id: 'housing', name: 'Bolig', icon: '🏠' },
  { id: 'utilities', name: 'El, vand & varme', icon: '💡' },
  { id: 'insurance', name: 'Forsikring', icon: '🛡️' },
  { id: 'subscriptions', name: 'Abonnementer & streaming', icon: '📺' },
  { id: 'phone', name: 'Mobil & internet', icon: '📱' },
  { id: 'shopping', name: 'Tøj & shopping', icon: '🛍️' },
  { id: 'electronics', name: 'Elektronik', icon: '💻' },
  { id: 'health', name: 'Sundhed & personlig pleje', icon: '💊' },
  { id: 'kids', name: 'Børn', icon: '🧸' },
  { id: 'leisure', name: 'Fritid & oplevelser', icon: '🎟️' },
  { id: 'home', name: 'Hus & have', icon: '🪴' },
  { id: 'travel', name: 'Rejser', icon: '✈️' },
  { id: 'loans', name: 'Lån & gebyrer', icon: '🏦' },
  { id: 'mobilepay', name: 'MobilePay til personer', icon: '📲' },
  { id: 'cash', name: 'Kontanter', icon: '💵' },
  { id: 'other', name: 'Andet', icon: '❔' },
  { id: 'income', name: 'Løn & indtægter', icon: '💰' },
  { id: 'moneyin', name: 'Penge ind (andet)', icon: '➕' },
  { id: 'internal', name: 'Mellem egne konti', icon: '↔️' },
];
export const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

// Søgeord (små bogstaver, uden tal). Første match vinder, så de mest specifikke står først.
const RULES = [
  ['subscriptions', ['netflix', 'spotify', 'hbo', 'max.com', 'viaplay', 'disney', 'tv2 play', 'tv 2 play', 'youtube', 'apple.com', 'itunes', 'google play', 'storytel', 'mofibo', 'podimo', 'audible', 'skyshowtime', 'prime video', 'amazon prime', 'adobe', 'microsoft', 'chatgpt', 'openai', 'dropbox', 'icloud', 'playstation', 'xbox', 'nintendo', 'patreon']],
  ['phone', ['telenor', 'telia', 'yousee', 'norlys tele', 'oister', 'call me', 'cbb', 'lebara', 'lycamobile', 'hiper', 'fastspeed', 'waoo', 'stofa', 'eesy', 'greentel', 'faroese telecom', 'føroya tele']],
  ['groceries', ['netto', 'rema', 'føtex', 'fotex', 'bilka', 'lidl', 'aldi', 'meny', 'spar ', 'superbrugsen', 'dagli brugsen', 'brugsen', 'kvickly', 'coop', 'irma', 'løvbjerg', 'lovbjerg', 'discount', 'min købmand', 'abc lavpris', 'salling', 'nemlig', 'bónus', 'bonus food', 'miklagarður', 'lagkagehuset', 'bager']],
  ['eatout', ['mcdonald', 'burger king', 'sunset', 'max burgers', 'pizza', 'sushi', 'kebab', 'cafe', 'café', 'restaurant', 'just eat', 'wolt', 'hungry', 'starbucks', 'joe & the juice', 'baresso', 'espresso house', 'kfc', 'subway', 'grill', 'bistro', 'bar ', 'pub']],
  ['transport', ['circle k', 'q8', 'shell', 'uno-x', 'ingo', 'f24', 'okq8', 'ok benzin', 'ok plus', 'dsb', 'rejsekort', 'movia', 'midttrafik', 'metro', 'parkering', 'easypark', 'apcoa', 'parkman', 'europark', 'brobizz', 'storebælt', 'oresund', 'øresund', 'clever', 'spirii', 'e.on drive', 'tesla', 'bilforsikring', 'autohjem', 'mekonomen', 'thansen', 'smyril line', 'atlantic airways', 'strandfaraskip']],
  ['housing', ['realkredit', 'totalkredit', 'nykredit', 'brf kredit', 'dlr', 'husleje', 'boligforening', 'ejerforening', 'grundejer', 'andelsbolig', 'boligselskab']],
  ['utilities', ['energi', 'andel ', 'ørsted', 'orsted', 'norlys', 'ewii', 'vandværk', 'vand a/s', 'forsyning', 'fjernvarme', 'varme', 'el-selskab', 'radius', 'cerius', 'sev ', 'renovation']],
  ['insurance', ['tryg', 'topdanmark', 'alm. brand', 'alm brand', 'codan', 'gf forsikring', 'if forsikring', 'if skadeforsikring', 'lb forsikring', 'bauta', 'tjm', 'købstædernes', 'privatsikring', 'trygghedsgruppen', 'tryghedsgruppen', 'forsikring', 'sygeforsikring danmark', 'lív', 'trygd']],
  ['electronics', ['elgiganten', 'power', 'proshop', 'komplett', 'batteribyen', 'computersalg', 'apple store', 'fona', 'expert', 'av-cables']],
  ['shopping', ['h&m', 'zalando', 'boozt', 'only', 'jack & jones', 'vero moda', 'zara', 'normal', 'søstrene grene', 'flying tiger', 'magasin', 'salling stormagasin', 'amazon', 'temu', 'shein', 'wish', 'sport24', 'intersport', 'skoringen', 'deichmann', 'ikea', 'jysk', 'bauhaus', 'silvan', 'stark', 'harald nyborg']],
  ['health', ['apotek', 'matas', 'normal', 'tandlæge', 'tandlaege', 'læge', 'fysioterapi', 'optiker', 'synoptik', 'louis nielsen', 'frisør', 'frisor', 'fitness', 'sats', 'fitness world', 'puregym']],
  ['kids', ['br ', 'legekæden', 'fætter br', 'institution', 'børnehave', 'vuggestue', 'sfo', 'pladsanvisning', 'babysam', 'bilka baby', 'lego']],
  ['leisure', ['biograf', 'nordisk film', 'kino', 'tivoli', 'billetlugen', 'ticketmaster', 'zoo', 'legoland', 'lalandia', 'bowling', 'steam', 'gamestop', 'pokemon', 'tcg']],
  ['travel', ['sas ', 'norwegian', 'ryanair', 'easyjet', 'hotel', 'booking.com', 'airbnb', 'expedia', 'momondo', 'apollo', 'spies', 'tui']],
  ['loans', ['rente', 'gebyr', 'ydelse', 'afdrag', 'lån', 'laan', 'kreditkort', 'santander', 'resurs', 'ikano', 'nordea finans']],
  ['cash', ['hæveautomat', 'haeveautomat', 'kontanthævning', 'atm', 'udbetaling kasse']],
];

/** Nøgle der genkender "samme modtager" (bruges til egne regler og abonnementer). */
// Betalingsformidlere (MobilePay, Vipps, Nets …) er ikke den egentlige modtager — så bruges teksten.
const PROCESSOR = /mobile ?pay|vipps|nets|bambora|stripe|paypal|klarna|viva wallet|sumup|zettle|izettle/i;
export const partyKeyOf = (t) => {
  const src = t.party && !PROCESSOR.test(t.party) ? t.party : t.text || t.party;
  return normText(String(src).replace(PROCESSOR, ' ')).split(' ').slice(0, 2).join(' ');
};

/**
 * Hvilken kategori hører posteringen til?
 * rules: egne regler { nøgle: kategori-id } — de vinder altid.
 * knownKeys: jeres egne konti (overførsler mellem dem)
 */
export function categorize(t, rules = {}, knownKeys = []) {
  if (t.partyKey && knownKeys.includes(t.partyKey)) return 'internal';
  const key = partyKeyOf(t);
  if (key && rules[key] && CAT[rules[key]]) return rules[key];
  const hay = ` ${String(`${t.party || ''} ${t.text || ''}`).toLowerCase()} `;
  if (t.amount > 0) {
    if (/\b(løn|lon|salary|feriepenge|pension|su\b|børneydelse|boligstøtte|udbetaling danmark|skat)/.test(hay)) return 'income';
    return 'moneyin';
  }
  if (/mobile ?pay|mob\.pay|vipps/.test(hay)) {
    // MobilePay til en butik genkendes på butikkens navn, ellers er det til en person
    for (const [cat, words] of RULES) if (words.some((w) => hay.includes(w))) return cat;
    return 'mobilepay';
  }
  for (const [cat, words] of RULES) if (words.some((w) => hay.includes(w))) return cat;
  return 'other';
}

/** Forbrug pr. kategori for en liste posteringer (kun udgifter, ikke overførsler mellem egne konti). */
export function spendByCategory(txs, rules = {}, knownKeys = []) {
  const out = {};
  for (const t of txs) {
    if (t.amount >= 0) continue;
    const c = categorize(t, rules, knownKeys);
    if (c === 'internal') continue;
    out[c] = (out[c] || 0) + Math.abs(t.amount);
  }
  return Object.entries(out).map(([id, amount]) => ({ id, amount: Math.round(amount * 100) / 100 })).sort((a, b) => b.amount - a.amount);
}

/** "I september brugte I …" — sammenligner to perioder. */
export function monthSummary(cur, prev) {
  const total = (l) => l.reduce((s, x) => s + x.amount, 0);
  const pm = Object.fromEntries(prev.map((x) => [x.id, x.amount]));
  const changes = cur.map((x) => ({ id: x.id, diff: x.amount - (pm[x.id] || 0) }))
    .concat(prev.filter((p) => !cur.some((c) => c.id === p.id)).map((p) => ({ id: p.id, diff: -p.amount })))
    .filter((x) => Math.abs(x.diff) >= 100)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 3);
  return { total: total(cur), prevTotal: total(prev), top: cur[0] || null, changes };
}

/**
 * Faste træk (abonnementer m.m.): samme modtager mindst 3 gange — eller 2 gange med ca. 1, 3, 6 eller 12 mdr. imellem —
 * med nogenlunde samme beløb. Finder også prisstigninger.
 */
export function recurring(txs, knownKeys = [], { today = new Date() } = {}) {
  const groups = new Map();
  for (const t of txs) {
    if (t.amount >= 0 || (t.partyKey && knownKeys.includes(t.partyKey))) continue;
    const k = partyKeyOf(t);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const DAY = 864e5;
  const toD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const out = [];
  for (const [key, raw] of groups) {
    const list = raw.slice().sort((a, b) => a.date.localeCompare(b.date));
    // højst én pr. måned (flere køb i samme måned = ikke et abonnement)
    const perMonth = new Map();
    for (const t of list) { const ym = t.date.slice(0, 7); if (perMonth.has(ym)) perMonth.set(ym, null); else perMonth.set(ym, t); }
    if ([...perMonth.values()].some((x) => x === null)) continue;
    const pts = [...perMonth.values()];
    if (pts.length < 2) continue;
    const gaps = pts.slice(1).map((t, i) => Math.round((toD(t.date) - toD(pts[i].date)) / DAY));
    const med = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    const freq = med >= 25 && med <= 35 ? 1 : med >= 80 && med <= 100 ? 3 : med >= 170 && med <= 200 ? 6 : med >= 350 && med <= 380 ? 12 : 0;
    if (!freq) continue;
    if (pts.length < 3 && freq === 1) continue; // to månedlige træk kan være tilfældigt
    if (gaps.some((g) => Math.abs(g - med) > Math.max(12, med * 0.25))) continue;
    const amts = pts.map((t) => Math.abs(t.amount));
    const base = amts.slice(0, -1);
    const avg = base.reduce((s, a) => s + a, 0) / base.length;
    if (base.some((a) => Math.abs(a - avg) / avg > 0.3)) continue;
    const last = pts[pts.length - 1];
    const lastAmt = Math.abs(last.amount);
    const prevAmt = amts[amts.length - 2];
    if (Math.abs(lastAmt - avg) / avg > 0.6) continue;
    const change = prevAmt > 0 && Math.abs(lastAmt - prevAmt) / prevAmt >= 0.02 ? lastAmt - prevAmt : 0;
    const stale = (today - toD(last.date)) / DAY > freq * 31 + 20; // ser ud til at være stoppet
    const raw0 = (last.party || last.text || key).trim();
    out.push({
      key, name: raw0.length > 40 ? raw0.slice(0, 40) : raw0, amount: lastAmt, prevAmount: prevAmt, change,
      freq, monthly: Math.round((lastAmt / freq) * 100) / 100, last: last.date, count: pts.length, stale,
    });
  }
  return out.sort((a, b) => Number(a.stale) - Number(b.stale) || b.monthly - a.monthly);
}
