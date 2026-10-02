// =====================================================================
//  calc.js — ALLE budgetberegninger samlet ét sted.
//  Rene funktioner uden Firebase/DOM, så de kan testes (se tests/calc.test.mjs).
//
//  Vigtige principper:
//  • Beløb på en post = beløb PR. BETALING. freq = antal måneder mellem betalinger.
//  • Månedlig ækvivalent = beløb / freq.   Årlig = månedlig × 12.
//  • Likviditet regnes i hele øre (heltal) for at undgå afrundingsfejl (0,1 + 0,2 ≠ 0,3).
//  • Betalinger med betalingsdag på eller før dags dato i indeværende måned
//    regnes som allerede trukket (saldoen du indtaster i dag er efter dem).
//  • Samme dag: indtægter før udgifter (faste overførsler lander før Betalingsservice).
// =====================================================================

export const DEFAULT_FREQUENCIES = [
  { months: 1, label: 'Hver måned' },
  { months: 2, label: 'Hver 2. måned' },
  { months: 3, label: 'Hver 3. måned (kvartal)' },
  { months: 4, label: 'Hver 4. måned' },
  { months: 6, label: 'Hver 6. måned (halvår)' },
  { months: 12, label: 'Årligt' },
];

// ---------- Hjælpere ----------
export const toOre = (kr) => Math.round((Number(kr) || 0) * 100);
export const fromOre = (ore) => ore / 100;
export const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

/** "2026-09" -> månedsindeks (år*12 + måned-1). null hvis tom/ugyldig. */
export function ymToIndex(ym) {
  if (!ym) return null;
  const [y, m] = String(ym).split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  return y * 12 + (m - 1);
}
export function indexToYm(i) {
  const y = Math.floor(i / 12);
  const m = (i % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}
export const dateToIndex = (d) => d.getFullYear() * 12 + d.getMonth();
export const daysInMonthIdx = (i) => new Date(Math.floor(i / 12), (i % 12) + 1, 0).getDate();
export const indexToDate = (i, day = 1) => new Date(Math.floor(i / 12), i % 12, day);

export function freqOf(item) {
  const f = Math.round(Number(item.freq));
  return f >= 1 ? f : 1;
}

/** Tekst for en frekvens, med fallback hvis admin har slettet den fra listen. */
export function freqLabel(months, frequencies = DEFAULT_FREQUENCIES) {
  const f = frequencies.find((x) => Number(x.months) === Number(months));
  if (f) return f.label;
  return Number(months) === 1 ? 'Hver måned' : `Hver ${months}. måned`;
}

/** Månedlig ækvivalent i kr. */
export const monthly = (item) => (Number(item.amount) || 0) / freqOf(item);
/** Årlig ækvivalent i kr. */
export const yearly = (item) => monthly(item) * 12;

// ---------- Bankdage ----------
// Falder en betaling på en weekend eller helligdag, trækker banken først næste bankdag,
// og løn kommer bankdagen før. Slås til med setBankDays(true) (appen gør det; tests kan vælge).
let BANKDAYS = false;
export const setBankDays = (on) => { BANKDAYS = !!on; };
export const bankDaysOn = () => BANKDAYS;
const holidayCache = new Map();
function easter(y) { // Gauss/Meeus
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
/** Danske bankfridage (helligdage + grundlovsdag, juleaften og nytårsaften). */
export function bankHolidays(y) {
  if (holidayCache.has(y)) return holidayCache.get(y);
  const e = easter(y);
  const rel = (n) => { const d = new Date(e); d.setDate(d.getDate() + n); return `${d.getMonth() + 1}-${d.getDate()}`; };
  const set = new Set(['1-1', '6-5', '12-24', '12-25', '12-26', '12-31', rel(-3), rel(-2), rel(1), rel(39), rel(50)]);
  holidayCache.set(y, set);
  return set;
}
export function isBankDay(d) {
  const wd = d.getDay();
  return wd !== 0 && wd !== 6 && !bankHolidays(d.getFullYear()).has(`${d.getMonth() + 1}-${d.getDate()}`);
}

/** Betalingsdag i en bestemt måned. 31 = sidste dag i måneden. Med bankdage flyttes dagen
 *  til næste bankdag (udgifter/overførsler) eller forrige bankdag (indtægter) — inden for måneden. */
export function payDayIn(item, mi) {
  const dim = daysInMonthIdx(mi);
  let d = Math.min(Math.max(Math.round(Number(item.payDay)) || 1, 1), dim);
  if (!BANKDAYS) return d;
  const y = Math.floor(mi / 12), m = mi % 12;
  const ok = (x) => isBankDay(new Date(y, m, x));
  if (ok(d)) return d;
  const back = item.type === 'income';
  for (let k = 1; k < 8; k++) {
    const x = back ? d - k : d + k;
    if (x >= 1 && x <= dim && ok(x)) return x;
  }
  for (let k = 1; k < 8; k++) { // ved månedens kant: den anden vej
    const x = back ? d + k : d - k;
    if (x >= 1 && x <= dim && ok(x)) return x;
  }
  return d;
}

/** Er posten sat på pause i måned mi?  pause: { from: 'ÅÅÅÅ-MM', to: 'ÅÅÅÅ-MM' | null (indtil videre) } */
export function isPaused(item, mi) {
  const p = item.pause;
  if (!p || !p.from) return false;
  const f = ymToIndex(p.from), t = ymToIndex(p.to);
  return mi >= f && (t === null || mi <= t);
}

/** Er posten aktiv i måned mi (mellem startMonth og endMonth, ikke slået fra og ikke på pause)? */
export function isRunning(item, mi) {
  if (item.active === false) return false;
  if (isPaused(item, mi)) return false;
  const s = ymToIndex(item.startMonth);
  const e = ymToIndex(item.endMonth);
  if (s !== null && mi < s) return false;
  if (e !== null && mi > e) return false;
  return true;
}

/** Falder der en betaling i måned mi?  startMonth = første betalingsmåned (ankeret). */
export function paysIn(item, mi) {
  if (!isRunning(item, mi)) return false;
  const f = freqOf(item);
  if (f === 1) return true;
  const anchor = ymToIndex(item.startMonth) ?? 0; // uden anker: januar-justeret
  return (((mi - anchor) % f) + f) % f === 0;
}

/** Tæller posten med i det normaliserede månedsbudget? (aktiv, ikke udløbet, ikke på pause nu) */
export function countsInBudget(item, nowIdx) {
  if (item.active === false) return false;
  if (isPaused(item, nowIdx)) return false;
  const e = ymToIndex(item.endMonth);
  return e === null || e >= nowIdx;
}

/** Næste betaling efter dags dato. Returnerer {mi, ym, day, date} eller null. */
export function nextPayment(item, today = new Date()) {
  const now = dateToIndex(today);
  const day = today.getDate();
  const s = ymToIndex(item.startMonth);
  const from = Math.max(now, s ?? now);
  const f = freqOf(item);
  for (let mi = from; mi <= from + f + 1; mi++) {
    if (!paysIn(item, mi)) continue;
    const d = payDayIn(item, mi);
    if (mi === now && d <= day) continue; // allerede betalt i denne måned
    return { mi, ym: indexToYm(mi), day: d, date: indexToDate(mi, d) };
  }
  return null;
}

// ---------- Pengestrømme pr. konto / samlet ----------
// Tre typer poster:
//   income   — indtægt, går ind på item.account
//   expense  — udgift, trækkes fra item.account
//   transfer — overførsel mellem egne konti: fra item.account til item.toAccount
//
// SAMLET budget (account = null): overførsler til en OPSPARINGSKONTO tæller som "opsparing"
// og trækkes fra det, der er tilbage af lønnen. Hævninger fra opsparing tæller som plus.
// Overførsler mellem brugskonti (fx lønkonto → budgetkonto) tæller ikke — pengene bliver i familien.
//
// ÉN konto (account = 'Budgetkonto'): alt der går ind på kontoen er plus, alt der går ud er minus —
// også overførsler. Opsparing der går fra en anden konto, rører ikke denne konto.

export const isTransfer = (it) => it.type === 'transfer';

/**
 * Hvordan påvirker én betaling af posten den valgte visning?
 * Returnerer { bucket: 'income'|'expense'|'saving'|null, sign: +1|-1|0 }.
 */
export function flowOf(item, { account = null, savingsAccounts = [] } = {}) {
  const from = item.account || '', to = item.toAccount || '';
  if (account) {
    if (item.type === 'income') return from === account ? { bucket: 'income', sign: 1 } : { bucket: null, sign: 0 };
    if (item.type === 'expense') return from === account ? { bucket: 'expense', sign: -1 } : { bucket: null, sign: 0 };
    if (from === to) return { bucket: null, sign: 0 };
    if (to === account) return { bucket: 'income', sign: 1 };
    if (from === account) return { bucket: 'expense', sign: -1 };
    return { bucket: null, sign: 0 };
  }
  if (item.type === 'income') return { bucket: 'income', sign: 1 };
  if (item.type === 'expense') return { bucket: 'expense', sign: -1 };
  const toS = savingsAccounts.includes(to), fromS = savingsAccounts.includes(from);
  if (toS && !fromS) return { bucket: 'saving', sign: -1 };
  if (fromS && !toS) return { bucket: 'saving', sign: 1 };   // hævning fra opsparing
  return { bucket: null, sign: 0 };
}

/** Poster der overhovedet vedrører en konto (til lister/filtre). */
export const touchesAccount = (it, account) => (it.account || '') === account || (isTransfer(it) && (it.toAccount || '') === account);

// ---------- Overblik ----------
/**
 * Normaliseret budget: summer månedlige ækvivalenter.
 * opts.account = null → hele budgettet; ellers kun den konto.
 * net = indtægter − udgifter − opsparing  ("tilbage af lønnen" / "tilbage på kontoen").
 */
export function summarize(items, today = new Date(), opts = {}) {
  const now = dateToIndex(today);
  const res = {
    income: 0, expense: 0, saving: 0, net: 0,
    yearIncome: 0, yearExpense: 0, yearSaving: 0, yearNet: 0,
    byCategory: {}, // key "type|kategori" -> kr/md (type: income|expense|transfer)
    count: 0,
  };
  for (const it of items) {
    if (!countsInBudget(it, now)) continue;
    const { bucket, sign } = flowOf(it, opts);
    if (!bucket) continue;
    const m = monthly(it);
    res.count++;
    if (bucket === 'income') res.income += m;
    else if (bucket === 'expense') res.expense += m;
    else res.saving += -sign * m; // opsparing er positiv, hævning negativ
    const t = isTransfer(it) ? 'transfer' : it.type;
    const cKey = `${t}|${it.category || (t === 'transfer' ? 'Opsparing' : 'Uden kategori')}`;
    res.byCategory[cKey] = (res.byCategory[cKey] || 0) + m;
  }
  res.net = res.income - res.expense - res.saving;
  // left     = "Reelt til forbrug": det der er tilbage, når alle regninger og opsparing er dækket,
  //            og når det, der overføres FOR MEGET til fx budgetkontoen, er trukket fra (det står dér).
  // onSalary = det der faktisk står tilbage på lønkontoen. Overføres der for LIDT til en konto,
  //            er onSalary større end left — forskellen (shortage) mangler på den konto.
  res.funding = opts.account ? [] : accountFunding(items, { savingsAccounts: opts.savingsAccounts || [], today });
  res.excess = res.funding.reduce((a, f) => a + f.excess, 0);
  res.shortage = res.funding.reduce((a, f) => a + Math.max(0, -f.diff), 0);
  res.left = res.net - res.excess;
  res.onSalary = res.left + res.shortage;
  res.yearLeft = res.left * 12;
  res.yearIncome = res.income * 12;
  res.yearExpense = res.expense * 12;
  res.yearSaving = res.saving * 12;
  res.yearNet = res.net * 12;
  return res;
}

/** Faktiske betalinger i et kalenderår (jan–dec), uanset normalisering. */
export function calendarYear(items, year, opts = {}) {
  let inc = 0, exp = 0, sav = 0;
  for (let mi = year * 12; mi < year * 12 + 12; mi++) {
    for (const it of items) {
      if (!paysIn(it, mi)) continue;
      const { bucket, sign } = flowOf(it, opts);
      const o = toOre(it.amount);
      if (bucket === 'income') inc += o;
      else if (bucket === 'expense') exp += o;
      else if (bucket === 'saving') sav += -sign * o;
    }
  }
  return { income: fromOre(inc), expense: fromOre(exp), saving: fromOre(sav), net: fromOre(inc - exp - sav) };
}

/**
 * Budgetkonto: hvor meget BØR der stå på kontoen i dag?
 * Model: der overføres beløb/freq den 1. i hver måned, og regningen betales på betalingsdagen.
 * Opsparet andel = beløb × (freq − måneder til næste betaling) / freq   (min. 0)
 *   • Betaling senere i denne måned  -> hele beløbet skal stå klar
 *   • Lige betalt                     -> 0
 * Overførsler VÆK fra kontoen tæller som regninger, der skal dækkes.
 * account = null betyder alle udgiftsposter.
 */
export function requiredBalance(items, account = null, today = new Date()) {
  const now = dateToIndex(today);
  let req = 0, transfer = 0;
  const rows = [];
  for (const it of items) {
    if (it.type === 'income' || !countsInBudget(it, now)) continue;
    if (isTransfer(it) && (account === null || it.toAccount === it.account)) continue;
    if (account !== null && (it.account || '') !== account) continue;
    const f = freqOf(it);
    transfer += monthly(it);
    const np = nextPayment(it, today);
    if (!np) continue;
    const k = Math.max(0, f - (np.mi - now));
    const r = (toOre(it.amount) * k) / f;
    req += r;
    rows.push({ item: it, required: fromOre(Math.round(r)), next: np, saved: k, of: f });
  }
  return { required: fromOre(Math.round(req)), monthlyTransfer: transfer, rows };
}

// ---------- Likviditet ----------
/**
 * Simulér saldoen dag for dag (pr. hændelse) de næste `horizon` måneder.
 * opts.account: kun den konto (overførsler ind = plus, ud = minus).
 * Uden account: alle konti lagt sammen — overførsler mellem egne konti tæller ikke.
 * Samme dag: indtægter før udgifter (sådan behandler bankerne faste overførsler og Betalingsservice).
 */
export function projectCashflow(items, startBalance, today = new Date(), horizon = 12, opts = {}) {
  const now = dateToIndex(today);
  const day = today.getDate();
  const account = opts.account || null;
  let bal = toOre(startBalance);
  let lowest = { ore: bal, mi: now, day };
  const months = [];

  for (let k = 0; k < horizon; k++) {
    const mi = now + k;
    const evs = [];
    for (const it of items) {
      if (!paysIn(it, mi)) continue;
      let sign;
      if (account) sign = flowOf(it, { account }).sign;
      else sign = it.type === 'income' ? 1 : it.type === 'expense' ? -1 : 0;
      if (!sign) continue;
      const d = payDayIn(it, mi);
      if (k === 0 && d <= day) continue;
      const ore = toOre(it.amount);
      const label = isTransfer(it) ? `${it.name} (${sign > 0 ? `fra ${it.account}` : `til ${it.toAccount}`})` : it.name;
      evs.push({ day: d, ore: sign * ore, name: label, id: it.id, type: it.type, account: it.account || '' });
    }
    evs.sort((a, b) => a.day - b.day || b.ore - a.ore);

    const m = { mi, ym: indexToYm(mi), start: bal, income: 0, expense: 0, min: bal, minDay: null, events: [] };
    for (const e of evs) {
      bal += e.ore;
      if (e.ore > 0) m.income += e.ore; else m.expense -= e.ore;
      e.balance = bal;
      if (bal < m.min) { m.min = bal; m.minDay = e.day; }
      if (bal < lowest.ore) lowest = { ore: bal, mi, day: e.day };
      m.events.push(e);
    }
    m.end = bal;
    months.push(m);
  }

  const kr = (o) => fromOre(o);
  const out = months.map((m) => ({
    mi: m.mi, ym: m.ym,
    start: kr(m.start), income: kr(m.income), expense: kr(m.expense),
    net: kr(m.income - m.expense), end: kr(m.end),
    min: kr(m.min), minDay: m.minDay,
    events: m.events.map((e) => ({ ...e, amount: kr(e.ore), balance: kr(e.balance) })),
  }));
  return {
    months: out,
    lowest: { amount: kr(lowest.ore), ym: indexToYm(lowest.mi), day: lowest.day, date: indexToDate(lowest.mi, lowest.day) },
    firstNegative: out.find((m) => m.min < 0) || null,
    end: out.length ? out[out.length - 1].end : kr(bal),
  };
}

// ---------- Sammenligning ----------
const COMPARE_FIELDS = ['amount', 'freq', 'category', 'who', 'supplier', 'account', 'toAccount', 'method', 'startMonth', 'payDay', 'endMonth', 'active'];

export function compareItems(oldItems, newItems, today = new Date(), opts = {}) {
  const now = dateToIndex(today);
  const eff = (it) => (it && countsInBudget(it, now) ? monthly(it) : 0);
  const nameKey = (it) => `${it.type}|${String(it.name || '').trim().toLowerCase()}`;

  const oldLeft = new Map(oldItems.map((o) => [o.id, o]));
  const pairs = [];
  const added = [];
  for (const n of newItems) {
    let o = n.id && oldLeft.get(n.id);
    if (!o) o = [...oldLeft.values()].find((x) => nameKey(x) === nameKey(n));
    if (o) { oldLeft.delete(o.id); pairs.push([o, n]); } else added.push(n);
  }
  const removed = [...oldLeft.values()];

  const changed = [];
  const same = [];
  for (const [o, n] of pairs) {
    const fields = COMPARE_FIELDS.filter((f) => String(o[f] ?? '') !== String(n[f] ?? ''));
    if (fields.length) changed.push({ old: o, new: n, fields, deltaMonthly: eff(n) - eff(o) });
    else same.push({ old: o, new: n, deltaMonthly: 0 });
  }
  const unchanged = same.length;

  const a = summarize(oldItems, today, opts);
  const b = summarize(newItems, today, opts);
  const cats = new Set([...Object.keys(a.byCategory), ...Object.keys(b.byCategory)]);
  const categories = [...cats].map((key) => {
    const [type, cat] = key.split('|');
    const before = a.byCategory[key] || 0;
    const after = b.byCategory[key] || 0;
    return { type, category: cat, before, after, delta: after - before };
  }).filter((c) => Math.abs(c.delta) > 0.004 || c.before || c.after)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  // Alle poster side om side (før | nu), til en fuld sammenligning
  const rows = [
    ...same.map((p) => ({ status: 'same', item: p.new, before: eff(p.old), after: eff(p.new), fields: [] })),
    ...changed.map((c) => ({ status: 'changed', item: c.new, old: c.old, before: eff(c.old), after: eff(c.new), fields: c.fields })),
    ...added.map((n) => ({ status: 'added', item: n, before: 0, after: eff(n), fields: [] })),
    ...removed.map((o) => ({ status: 'removed', item: o, before: eff(o), after: 0, fields: [] })),
  ].map((r) => ({ ...r, delta: r.after - r.before }));

  return {
    rows,
    added: added.map((n) => ({ item: n, deltaMonthly: eff(n) })),
    removed: removed.map((o) => ({ item: o, deltaMonthly: -eff(o) })),
    changed, unchanged, same, categories,
    totals: {
      before: { income: a.income, expense: a.expense, saving: a.saving, net: a.left ?? a.net },
      after: { income: b.income, expense: b.expense, saving: b.saving, net: b.left ?? b.net },
      delta: { income: b.income - a.income, expense: b.expense - a.expense, saving: b.saving - a.saving, net: (b.left ?? b.net) - (a.left ?? a.net) },
    },
  };
}

// ---------- Fordeling pr. person ----------
export const JOINT = 'Fælles';

/**
 * Hvordan fordeles én posts månedlige beløb?
 *  • Trækkes posten fra / går den ind på en FÆLLESKONTO → hele beløbet er "Fælles".
 *  • Ellers bruges item.split { navn: procent } (normaliseres til 100 %).
 *  • Uden split: 100 % til item.who ("Fælles"/tom → fælles).
 * Returnerer { joint: bool, parts: { navn: kr pr. md. } }
 */
export function shareOf(item, jointAccounts = []) {
  const m = monthly(item);
  if (item.account && jointAccounts.includes(item.account)) return { joint: true, parts: { [JOINT]: m } };
  const split = item.split && typeof item.split === 'object' ? Object.entries(item.split).filter(([, p]) => Number(p) > 0) : [];
  const total = split.reduce((s, [, p]) => s + Number(p), 0);
  if (total > 0) {
    const parts = {};
    for (const [name, p] of split) parts[name] = (parts[name] || 0) + (m * Number(p)) / total;
    return { joint: false, parts };
  }
  const who = item.who && item.who !== JOINT ? item.who : JOINT;
  return { joint: who === JOINT, parts: { [who]: m } };
}

/**
 * Samlet overblik: hvad skal hver person af med, og hvad kommer ind?
 * jointSplit { navn: procent } = hvordan I deler det, fælleskontoen mangler (standard: lige over).
 */
export function personSummary(items, { jointAccounts = [], jointSplit = null, people = [], savingsAccounts = [], today = new Date() } = {}) {
  const now = dateToIndex(today);
  const persons = {};
  const ensure = (n) => (persons[n] ??= { name: n, ownExpense: 0, income: 0, saving: 0, jointContribution: 0, items: [] });
  const joint = { expense: 0, income: 0, saving: 0, items: [] };
  for (const n of people) if (n !== JOINT) ensure(n);

  for (const it of items) {
    if (!countsInBudget(it, now)) continue;
    // Overførsler: kun opsparing tæller (overførsler mellem brugskonti er bare flytning af penge)
    let kind = it.type;
    if (isTransfer(it)) {
      const { bucket, sign } = flowOf(it, { savingsAccounts });
      if (bucket !== 'saving') continue;
      kind = sign < 0 ? 'saving' : 'withdraw';
    }
    const { parts } = shareOf(it, jointAccounts);
    for (const [name, amt] of Object.entries(parts)) {
      const tgt = name === JOINT ? joint : ensure(name);
      if (kind === 'income') tgt.income += amt;
      else if (kind === 'expense') { if (tgt === joint) joint.expense += amt; else tgt.ownExpense += amt; }
      else if (kind === 'saving') tgt.saving += amt;
      else if (kind === 'withdraw') tgt.saving -= amt;
      tgt.items.push({ item: it, amount: amt });
    }
  }

  // Hvor meget skal der overføres til fælles? (fælles udgifter + fælles opsparing minus det, der kommer direkte ind)
  const jointNeed = Math.max(0, joint.expense + joint.saving - joint.income);
  const names = Object.keys(persons);
  let split = jointSplit && Object.values(jointSplit).some((p) => Number(p) > 0) ? jointSplit : null;
  if (!split) split = Object.fromEntries(names.map((n) => [n, 100 / (names.length || 1)]));
  const total = Object.entries(split).filter(([n]) => persons[n]).reduce((s, [, p]) => s + Number(p || 0), 0);
  // Overført for meget til en konto → den del er "parkeret" dér og ikke til forbrug (+).
  // Overført for lidt → pengene er ikke taget fra lønnen endnu (−), men kontoen mangler dem.
  const funding = accountFunding(items, { savingsAccounts, today });
  const parked = {};
  for (const f of funding) {
    const diff = f.excess || (f.diff < 0 ? f.diff : 0);
    if (!diff) continue;
    const shares = {};
    let tot = 0;
    for (const it of items) {
      if (!isTransfer(it) || it.toAccount !== f.account || !countsInBudget(it, now)) continue;
      for (const [name, amt] of Object.entries(shareOf(it, []).parts)) {
        if (name === JOINT) continue;
        shares[name] = (shares[name] || 0) + amt; tot += amt;
      }
    }
    for (const [name, amt] of Object.entries(shares)) parked[name] = (parked[name] || 0) + (tot ? (diff * amt) / tot : 0);
  }
  for (const n of names) {
    const p = persons[n];
    p.jointContribution = total > 0 ? (jointNeed * Number(split[n] || 0)) / total : 0;
    p.totalOut = p.ownExpense + p.jointContribution;
    p.parked = parked[n] || 0;
    p.left = p.income - p.totalOut - p.saving - Math.max(0, p.parked); // reelt til forbrug
    p.onSalary = p.left + Math.max(0, -p.parked);
  }
  return { persons: Object.values(persons), joint: { ...joint, need: jointNeed }, split };
}

// ---------- Konti: overføres der nok? Hvad kan vi bruge? ----------
/**
 * Pr. konto (ikke opsparing): hvad kommer ind via overførsler, hvad skal kontoen bruge,
 * og overføres der for meget eller for lidt?
 *  needs     = regninger + overførsler væk fra kontoen − indtægter direkte på kontoen (kr./md.)
 *  diff      = overført ind − needs   (> 0: for meget, < 0: mangler)
 *  excess    = den del af overførslerne, der hober sig op på kontoen (bruges til "Tilbage af lønnen")
 * Kun konti der modtager overførsler tages med (fx Budgetkonto — ikke Lønkonto).
 */
export function accountFunding(items, { savingsAccounts = [], today = new Date(), tolerance = 200 } = {}) {
  const now = dateToIndex(today);
  const acc = {};
  const get = (a) => (acc[a] ??= { account: a, transferIn: 0, income: 0, expense: 0, transferOut: 0 });
  for (const it of items) {
    if (!countsInBudget(it, now)) continue;
    const m = monthly(it);
    if (it.type === 'income' && it.account) get(it.account).income += m;
    else if (it.type === 'expense' && it.account) get(it.account).expense += m;
    else if (isTransfer(it) && it.account !== it.toAccount) {
      if (it.toAccount) get(it.toAccount).transferIn += m;
      if (it.account) get(it.account).transferOut += m;
    }
  }
  return Object.values(acc)
    .filter((a) => a.transferIn > 0 && !savingsAccounts.includes(a.account))
    .map((a) => {
      const needs = Math.max(0, a.expense + a.transferOut - a.income);
      const diff = a.transferIn - needs;
      const status = Math.abs(diff) <= tolerance ? 'ok' : diff > 0 ? 'over' : 'under';
      return { ...a, needs, diff, status, excess: diff > 0 ? Math.min(diff, a.transferIn) : 0 };
    });
}

/**
 * "Hvor meget kan vi bruge af kontoen?" — gennemgår alle betalinger 12 mdr. frem.
 * Det laveste saldoen kommer ned på, er det man kan tage ud i dag (minus en evt. buffer).
 * Returnerer { canSpend, missing, missingDate, nextBig: {name, amount, date} | null }.
 */
export function spendable(items, account, balance, today = new Date(), { buffer = 0, bigWithinDays = 120 } = {}) {
  const cf = projectCashflow(items, balance, today, 12, { account });
  const low = cf.lowest.amount;
  let nextBig = null;
  const limit = new Date(today.getFullYear(), today.getMonth(), today.getDate() + bigWithinDays);
  for (const m of cf.months) {
    for (const e of m.events) {
      if (e.amount >= 0) continue;
      const [y, mo] = m.ym.split('-').map(Number);
      const date = new Date(y, mo - 1, e.day);
      if (date > limit) continue;
      if (!nextBig || -e.amount > nextBig.amount) nextBig = { name: e.name, amount: -e.amount, date };
    }
  }
  return {
    canSpend: Math.max(0, Math.round((low - buffer) * 100) / 100),
    missing: low < 0 ? -low : 0,
    missingDate: low < 0 ? cf.lowest.date : null,
    lowest: low,
    nextBig,
  };
}

/** De næste n betalinger af en post fra i dag (bruges i formularen: "Næste betaling: …"). */
export function upcomingPayments(item, today = new Date(), n = 3) {
  const out = [];
  const now = dateToIndex(today);
  const day = today.getDate();
  for (let mi = now; mi < now + 60 && out.length < n; mi++) {
    if (!paysIn(item, mi)) continue;
    const d = payDayIn(item, mi);
    if (mi === now && d <= day) continue;
    out.push(indexToDate(mi, d));
  }
  return out;
}
