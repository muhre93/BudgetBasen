// Prøvebudget: en opdigtet familie (Anna & Jonas), så man kan se hvordan appen virker,
// før man taster sine egne tal ind. Alle datoer regnes ud fra dags dato, så eksemplet
// altid ser "levende" ud. Rene data — ingen Firebase her (så det kan testes i node).
import { indexToYm, dateToIndex, DEFAULT_FREQUENCIES, projectCashflow, requiredBalance } from './calc.js';

export const DEMO_NAME = 'Prøvebudget (eksempel)';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/**
 * uid = den indloggede bruger (bruges til den private eksempel-post).
 * Returnerer alt der skal skrives: lists, settings, items, receipts, documents, snapshot.
 */
export function buildDemo(uid, today = new Date()) {
  const now = dateToIndex(today);
  const ym = (offset) => indexToYm(now + offset);
  const ALL = ['all'];
  const mine = [uid];
  const past = ym(-6);

  // [id, felter]
  const I = (id, f) => ({ id, visibleTo: ALL, active: true, startMonth: past, payDay: 1, freq: 1, endMonth: null, note: '', supplier: '', method: 'Betalingsservice', split: null, who: '', ...f });
  const items = [
    // Indtægter
    I('d_lon_anna', { type: 'income', name: 'Løn Anna', amount: 26500, payDay: 31, category: 'Løn', who: 'Anna', account: 'Lønkonto', supplier: 'Arbejdsgiver', method: 'Overførsel' }),
    I('d_lon_jonas', { type: 'income', name: 'Løn Jonas', amount: 24800, payDay: 31, category: 'Løn', who: 'Jonas', account: 'Lønkonto', supplier: 'Arbejdsgiver', method: 'Overførsel' }),
    I('d_bornepenge', { type: 'income', name: 'Børne- og ungeydelse', amount: 4830, freq: 3, startMonth: anchor(now, 3, [0, 3, 6, 9]), payDay: 20, category: 'Offentlige ydelser', who: 'Fælles', account: 'Budgetkonto', supplier: 'Udbetaling Danmark', method: 'Overførsel', note: 'Kommer i januar, april, juli og oktober.' }),
    // Overførsler
    I('d_til_budget_anna', { type: 'transfer', name: 'Annas del til budgetkontoen', amount: 8600, category: 'Overførsler', who: 'Anna', account: 'Lønkonto', toAccount: 'Budgetkonto', method: 'Overførsel', note: 'Fast overførsel den 1. — dækker de fælles regninger.' }),
    I('d_til_budget_jonas', { type: 'transfer', name: 'Jonas’ del til budgetkontoen', amount: 8600, category: 'Overførsler', who: 'Jonas', account: 'Lønkonto', toAccount: 'Budgetkonto', method: 'Overførsel' }),
    I('d_opsparing', { type: 'transfer', name: 'Fast opsparing', amount: 3000, category: 'Opsparing', account: 'Lønkonto', toAccount: 'Opsparingskonto', method: 'Overførsel', split: { Anna: 50, Jonas: 50 }, note: 'Trækkes fra "Tilbage af lønnen" — men ikke fra budgetkontoen.' }),
    I('d_ferie', { type: 'transfer', name: 'Ferieopsparing', amount: 1000, category: 'Opsparing', who: 'Fælles', account: 'Budgetkonto', toAccount: 'Opsparingskonto', method: 'Overførsel' }),
    // Fælles udgifter (budgetkonto)
    I('d_bolig', { type: 'expense', name: 'Realkredit', amount: 11200, category: 'Bolig', who: 'Fælles', account: 'Budgetkonto', supplier: 'Realkreditinstitut' }),
    I('d_varme', { type: 'expense', name: 'Varme & vand', amount: 1100, category: 'Bolig', who: 'Fælles', account: 'Budgetkonto', supplier: 'Forsyning', payDay: 5 }),
    I('d_el', { type: 'expense', name: 'El', amount: 2700, freq: 3, startMonth: anchor(now, 3, [1, 4, 7, 10]), payDay: 5, category: 'Bolig', who: 'Fælles', account: 'Budgetkonto', supplier: 'Elselskab', note: 'Betales kvartalsvis — appen sparer 900 kr. op om måneden.' }),
    I('d_indbo', { type: 'expense', name: 'Indboforsikring', amount: 1980, freq: 12, startMonth: ym(2 - 12), category: 'Forsikringer', who: 'Fælles', account: 'Budgetkonto', supplier: 'Hjem & Bil Forsikring' }),
    I('d_bil_fors', { type: 'expense', name: 'Bilforsikring', amount: 3900, freq: 6, startMonth: ym(1 - 6), category: 'Forsikringer', who: 'Fælles', account: 'Budgetkonto', supplier: 'Hjem & Bil Forsikring' }),
    I('d_institution', { type: 'expense', name: 'Børnehave', amount: 3100, category: 'Børn', who: 'Fælles', account: 'Budgetkonto', supplier: 'Kommunen', endMonth: ym(20), note: 'Stopper når Ida starter i skole.' }),
    I('d_internet', { type: 'expense', name: 'Internet', amount: 299, payDay: 10, category: 'Abonnementer', who: 'Fælles', account: 'Budgetkonto', supplier: 'Internetudbyder' }),
    I('d_stream', { type: 'expense', name: 'Streaming', amount: 129, payDay: 15, category: 'Abonnementer', who: 'Fælles', account: 'Budgetkonto', method: 'Kort' }),
    // Personlige udgifter (lønkonto)
    I('d_mad', { type: 'expense', name: 'Dagligvarer', amount: 6000, category: 'Mad & dagligvarer', account: 'Lønkonto', method: 'Kort', split: { Anna: 50, Jonas: 50 }, note: 'Deles 50/50.' }),
    I('d_mobil_anna', { type: 'expense', name: 'Mobil Anna', amount: 199, payDay: 12, category: 'Abonnementer', who: 'Anna', account: 'Lønkonto', supplier: 'Teleselskab' }),
    I('d_mobil_jonas', { type: 'expense', name: 'Mobil Jonas', amount: 249, payDay: 12, category: 'Abonnementer', who: 'Jonas', account: 'Lønkonto', supplier: 'Teleselskab' }),
    I('d_fitness', { type: 'expense', name: 'Fitness', amount: 299, payDay: 3, category: 'Fritid', who: 'Jonas', account: 'Lønkonto', method: 'Kort' }),
    I('d_benzin', { type: 'expense', name: 'Brændstof', amount: 1400, category: 'Transport', account: 'Lønkonto', method: 'Kort', split: { Anna: 40, Jonas: 60 } }),
    I('d_gave', { type: 'expense', name: 'Hemmelig gaveopsparing', amount: 150, category: 'Andet', who: 'Anna', account: 'Lønkonto', method: 'Overførsel', visibleTo: mine, note: 'Et eksempel på en PRIVAT post — kun du kan se den.' }),
  ];

  const receipts = [
    { id: 'd_r1', date: iso(addDays(today, -2)), amount: 487.5, store: 'Netto', what: 'Ugens indkøb', category: 'Dagligvarer', who: 'Anna', note: '', warrantyUntil: null, visibleTo: ALL },
    { id: 'd_r2', date: iso(addDays(today, -40)), amount: 2499, store: 'Elgiganten', what: 'Støvsuger', category: 'Elektronik', who: 'Jonas', note: 'Husk: 2 års reklamationsret.', warrantyUntil: iso(addDays(today, 690)), visibleTo: ALL },
    { id: 'd_r3', date: iso(addDays(today, -5)), amount: 650, store: 'Guldsmed', what: 'Øreringe (gave)', category: 'Gaver', who: 'Jonas', note: 'Privat kvittering — kun du kan se den.', warrantyUntil: null, visibleTo: mine },
  ];

  const documents = [
    { id: 'd_doc1', title: 'Indboforsikring', docType: 'Forsikring', supplier: 'Hjem & Bil Forsikring', reference: 'POL-123456', yearlyPrice: 1980, startDate: iso(addDays(today, -315)), expiryDate: iso(addDays(today, 50)), noticeMonths: 1, linkedItemId: 'd_indbo', note: 'Selvrisiko 2.500 kr. Et eksempel på en opsigelsesfrist, appen holder øje med.', files: [], visibleTo: ALL },
    { id: 'd_doc2', title: 'Realkreditlån', docType: 'Lån', supplier: 'Realkreditinstitut', reference: 'LÅN-98765', yearlyPrice: 134400, startDate: iso(addDays(today, -1200)), expiryDate: null, noticeMonths: null, linkedItemId: 'd_bolig', note: '', files: [], visibleTo: ALL },
  ];

  // En "gammel" version, så Sammenlign har noget at vise
  const oldItems = items.filter((i) => !['d_fitness', 'd_gave'].includes(i.id)).map((i) => {
    if (i.id === 'd_bolig') return { ...i, amount: 10800 };
    if (i.id === 'd_institution') return { ...i, amount: 2950 };
    if (i.id === 'd_lon_jonas') return { ...i, amount: 24000 };
    return { ...i };
  }).concat([{ ...I('d_old_tv', { type: 'expense', name: 'TV-pakke', amount: 449, category: 'Abonnementer', who: 'Fælles', account: 'Budgetkonto' }) }]);

  const lists = {
    categories: ['Bolig', 'Forsikringer', 'Transport', 'Børn', 'Abonnementer', 'Mad & dagligvarer', 'Fritid', 'Opsparing', 'Overførsler', 'Lån', 'Løn', 'Offentlige ydelser', 'Andet'],
    people: ['Anna', 'Jonas', 'Fælles'],
    suppliers: ['Arbejdsgiver', 'Udbetaling Danmark', 'Realkreditinstitut', 'Forsyning', 'Elselskab', 'Hjem & Bil Forsikring', 'Kommunen', 'Internetudbyder', 'Teleselskab'],
    methods: ['Betalingsservice', 'Overførsel', 'Kort', 'MobilePay', 'Kontant'],
    accounts: ['Lønkonto', 'Budgetkonto', 'Opsparingskonto'],
    stores: ['Netto', 'Rema 1000', 'Føtex', 'Elgiganten', 'IKEA', 'Guldsmed'],
    receiptCategories: ['Dagligvarer', 'Tøj & sko', 'Elektronik', 'Gaver', 'Hus & have', 'Bil', 'Børn', 'Fritid', 'Andet'],
    docTypes: ['Forsikring', 'Lejekontrakt', 'Abonnement', 'Lån', 'Garanti', 'Andet'],
    frequencies: DEFAULT_FREQUENCIES,
  };

  const settings = {
    demo: true,
    // Saldi regnes ud fra dags dato, så eksemplet altid viser det samme billede:
    // lønkontoen holder sig grøn, budgetkontoen har én "stram" (gul) måned.
    balances: [
      { account: 'Lønkonto', amount: startFor(items, 'Lønkonto', 3000, today), date: iso(today) },
      { account: 'Budgetkonto', amount: Math.max(startFor(items, 'Budgetkonto', 600, today), Math.ceil(requiredBalance(items, 'Budgetkonto', today).required / 100) * 100 + 200), date: iso(today) },
      { account: 'Opsparingskonto', amount: 38000, date: iso(today) },
    ],
    jointAccounts: ['Budgetkonto'],
    savingsAccounts: ['Opsparingskonto'],
    jointSplit: { Anna: 50, Jonas: 50 },
    defaultVisibleTo: ALL,
    warnBelow: 1000,
  };

  return { lists, settings, items, receipts, documents, snapshot: { name: 'Budget sidste år (eksempel)', items: oldItems } };
}

/** Første månedsindeks i fortiden hvor måneden (0–11) er i `months` — bruges som anker for kvartalsbetalinger. */
function anchor(now, _freq, months) {
  for (let k = 0; k < 12; k++) {
    const mi = now - k;
    if (months.includes(((mi % 12) + 12) % 12)) return indexToYm(mi);
  }
  return indexToYm(now);
}

/** Startsaldo så det laveste punkt de næste 12 måneder bliver præcis `lowestTarget` (rundet op til 100 kr.). */
function startFor(items, account, lowestTarget, today) {
  const cf = projectCashflow(items, 0, today, 12, { account });
  const lowest = Math.min(0, ...cf.months.map((m) => m.min));
  return Math.ceil((lowestTarget - lowest) / 100) * 100;
}
