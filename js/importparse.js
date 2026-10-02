// Import fra Excel/CSV: oversætter rækker fra skabelonen til budgetposter.
// Ren funktion (ingen Firebase) — testes i tests/import.test.mjs.
export const IMPORT_COLUMNS = ['Type', 'Navn', 'Beløb', 'Hvor ofte', 'Dag', 'Første måned', 'Konto', 'Til konto', 'Hvem', 'Kategori', 'Note'];
export const IMPORT_EXAMPLES = [
  ['Indtægt', 'Løn Mike', 29400, 'Hver måned', 'Sidste', '', 'Lønkonto', '', 'Mike', 'Løn', ''],
  ['Udgift', 'Realkredit', 21963, 'Hvert kvartal', 31, '2026-12', 'Budgetkonto', '', 'Mike', 'Bolig', 'Totalkredit'],
  ['Udgift', 'Mad', 6000, 'Hver måned', 1, '', 'Budgetkonto', '', 'Mike', 'Mad & dagligvarer', ''],
  ['Udgift', 'Bilforsikring', 3900, 'Hvert halve år', 1, '2027-01', 'Budgetkonto', '', 'Maria', 'Forsikringer', ''],
  ['Overførsel', 'Til budgetkontoen', 8000, 'Hver måned', 1, '', 'Lønkonto', 'Budgetkonto', 'Mike', '', ''],
  ['Overførsel', 'Fast opsparing', 1000, 'Hver måned', 1, '', 'Lønkonto', 'Opsparingskonto', 'Maria', '', ''],
];
export const IMPORT_HELP = [
  ['Kolonne', 'Hvad skal der stå?'],
  ['Type', 'Indtægt, Udgift eller Overførsel'],
  ['Navn', 'Hvad posten hedder, fx Husleje'],
  ['Beløb', 'Beløbet HVER GANG det betales (ikke pr. måned). Fx 21963 eller 21.963,00'],
  ['Hvor ofte', 'Hver måned, Hvert kvartal, Hvert halve år, Hvert år — eller et tal: antal måneder mellem betalinger (1, 2, 3, 6, 12)'],
  ['Dag', 'Dagen i måneden (1–31). Skriv "Sidste" for sidste dag i måneden'],
  ['Første måned', 'Kun nødvendig, når det ikke er hver måned: den næste måned den betales, fx 2026-12. Tom = denne måned'],
  ['Konto', 'Kontoen pengene går ind på / trækkes fra. Ved overførsel: kontoen pengene kommer FRA'],
  ['Til konto', 'Kun ved overførsel: kontoen pengene går TIL'],
  ['Hvem', 'Hvem der betaler eller får pengene, fx Mike. Må gerne være tom'],
  ['Kategori', 'Fx Bolig, Forsikringer. Må gerne være tom (bliver til "Andet")'],
  ['Note', 'Valgfri kommentar'],
  ['', ''],
  ['Sådan gør du', '1) Udfyld arket "Poster" — slet eksemplerne først. 2) Gem filen. 3) Upload den i BudgetBasen under Mere → Importér. Du ser en liste, før noget bliver gemt.'],
];

const norm = (v) => String(v ?? '').trim();
const low = (v) => norm(v).toLowerCase();
const TYPES = { indtægt: 'income', indtaegt: 'income', indkomst: 'income', ind: 'income', income: 'income', udgift: 'expense', regning: 'expense', ud: 'expense', expense: 'expense', overførsel: 'transfer', overfoersel: 'transfer', opsparing: 'transfer', transfer: 'transfer' };
const FREQ_WORDS = [[/halv/, 6], [/kvartal|3\.? ?m/, 3], [/hver ?anden|2\.? ?m/, 2], [/år|aar|årlig/, 12], [/måned|maaned|mdr|md/, 1]];

export function parseAmountDa(v) {
  if (typeof v === 'number') return v;
  let s = norm(v).replace(/kr\.?|\s/gi, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return Number(s);
}
function parseFreq(v) {
  if (typeof v === 'number') return Math.round(v);
  const s = low(v);
  if (!s) return 1;
  if (/^\d+$/.test(s)) return Number(s);
  for (const [re, n] of FREQ_WORDS) if (re.test(s)) return n;
  return NaN;
}
function parseDay(v) {
  if (typeof v === 'number') return Math.round(v);
  const s = low(v);
  if (!s) return 1;
  if (/sidst|ultimo|last/.test(s)) return 31;
  return parseInt(s, 10);
}
function parseMonth(v) {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}`;
  const s = norm(v);
  if (!s) return '';
  let m = s.match(/^(\d{4})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  return null;
}
/** Find en eksisterende værdi uanset store/små bogstaver. */
const match = (list, v) => list.find((x) => x.toLowerCase() === low(v)) || null;

/**
 * rows: array af objekter med kolonnenavne som nøgler (som XLSX.utils.sheet_to_json giver).
 * ctx: { accounts, people, categories, existing: [{type,name,amount}], currentYm }
 * Returnerer { rows: [{ line, ok, errors[], warnings[], dup, item }], newValues: { accounts, people, categories } }
 */
export function parseImportRows(rows, ctx) {
  const out = [];
  const nv = { accounts: [], people: [], categories: [] };
  const want = (key, val) => {
    if (!val) return '';
    const hit = match([...ctx[key], ...nv[key]], val);
    if (hit) return hit;
    nv[key].push(norm(val));
    return norm(val);
  };
  rows.forEach((raw, idx) => {
    // kolonnenavne uanset store/små bogstaver og mellemrum
    const r = {};
    for (const [k, v] of Object.entries(raw)) r[low(k)] = v;
    const get = (name) => r[low(name)];
    if (!norm(get('Navn')) && !norm(get('Beløb')) && !norm(get('Type'))) return; // tom række
    const errors = [], warnings = [];
    const type = TYPES[low(get('Type'))];
    if (!type) errors.push(`Type skal være Indtægt, Udgift eller Overførsel (der står "${norm(get('Type')) || 'tomt'}")`);
    const name = norm(get('Navn')).slice(0, 120);
    if (!name) errors.push('Navn mangler');
    const amount = Math.round(parseAmountDa(get('Beløb')) * 100) / 100;
    if (!(amount >= 0) || Number.isNaN(amount)) errors.push(`Beløb kan ikke læses ("${norm(get('Beløb'))}")`);
    const freq = parseFreq(get('Hvor ofte'));
    if (!(freq >= 1 && freq <= 120)) errors.push(`"Hvor ofte" kan ikke læses ("${norm(get('Hvor ofte'))}")`);
    let payDay = parseDay(get('Dag'));
    if (!(payDay >= 1 && payDay <= 31)) { warnings.push('Dag kunne ikke læses — sat til den 1.'); payDay = 1; }
    let startMonth = parseMonth(get('Første måned'));
    if (startMonth === null) { warnings.push('Første måned kunne ikke læses — sat til denne måned'); startMonth = ''; }
    if (!startMonth) { startMonth = ctx.currentYm; if (freq > 1) warnings.push('Første måned mangler — sat til denne måned'); }
    const accRaw = norm(get('Konto')), toRaw = norm(get('Til konto'));
    if (type === 'transfer') {
      if (!accRaw || !toRaw) errors.push('Overførsel kræver både Konto (fra) og Til konto');
      else if (low(accRaw) === low(toRaw)) errors.push('Konto og Til konto er den samme');
    }
    if (errors.length) { out.push({ line: idx + 2, ok: false, errors, warnings, item: { type, name, amount } }); return; }
    const account = want('accounts', accRaw);
    const toAccount = type === 'transfer' ? want('accounts', toRaw) : null;
    const who = want('people', get('Hvem'));
    const category = type === 'transfer' ? '' : want('categories', get('Kategori')) || (type === 'income' ? 'Løn' : 'Andet');
    if (!account) warnings.push('Konto mangler');
    const dup = ctx.existing.some((e) => e.type === type && low(e.name) === low(name) && Math.abs(Number(e.amount) - amount) < 0.005);
    out.push({
      line: idx + 2, ok: true, errors, warnings, dup,
      item: { type, name, amount, freq, payDay, startMonth, endMonth: null, account, toAccount, who, category, supplier: '', method: type === 'expense' ? 'Betalingsservice' : type === 'transfer' ? 'Overførsel' : '', note: norm(get('Note')).slice(0, 1000), active: true, split: null },
    });
  });
  return { rows: out, newValues: nv };
}
