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
//  • Samme dag: penge ind før penge ud (faste overførsler lander før Betalingsservice).
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

/** Betalingsdag i en bestemt måned (31 bliver til 30/29/28 i korte måneder). */
export function payDayIn(item, mi) {
  const d = Math.round(Number(item.payDay)) || 1;
  return Math.min(Math.max(d, 1), daysInMonthIdx(mi));
}

/** Er posten aktiv i måned mi (mellem startMonth og endMonth, og ikke slået fra)? */
export function isRunning(item, mi) {
  if (item.active === false) return false;
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

/** Tæller posten med i det normaliserede månedsbudget? (aktiv og ikke udløbet) */
export function countsInBudget(item, nowIdx) {
  if (item.active === false) return false;
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

// ---------- Overblik ----------
/**
 * Normaliseret budget: summer månedlige ækvivalenter.
 * Returnerer tal i kr. (ikke afrundet — afrund ved visning).
 */
export function summarize(items, today = new Date()) {
  const now = dateToIndex(today);
  const res = {
    income: 0, expense: 0, net: 0,
    yearIncome: 0, yearExpense: 0, yearNet: 0,
    byCategory: {}, // key "type|kategori" -> kr/md
    byAccount: {},  // konto -> { income, expense } kr/md
    byPerson: {},   // person -> { income, expense } kr/md
    count: 0,
  };
  for (const it of items) {
    if (!countsInBudget(it, now)) continue;
    const m = monthly(it);
    const isInc = it.type === 'income';
    res.count++;
    if (isInc) res.income += m; else res.expense += m;
    const cKey = `${isInc ? 'income' : 'expense'}|${it.category || 'Uden kategori'}`;
    res.byCategory[cKey] = (res.byCategory[cKey] || 0) + m;
    const acc = it.account || 'Ingen konto';
    res.byAccount[acc] ??= { income: 0, expense: 0 };
    res.byAccount[acc][isInc ? 'income' : 'expense'] += m;
    const who = it.who || 'Ikke angivet';
    res.byPerson[who] ??= { income: 0, expense: 0 };
    res.byPerson[who][isInc ? 'income' : 'expense'] += m;
  }
  res.net = res.income - res.expense;
  res.yearIncome = res.income * 12;
  res.yearExpense = res.expense * 12;
  res.yearNet = res.net * 12;
  return res;
}

/** Faktiske betalinger i et kalenderår (jan–dec), uanset normalisering. */
export function calendarYear(items, year) {
  let inc = 0, exp = 0;
  for (let mi = year * 12; mi < year * 12 + 12; mi++) {
    for (const it of items) {
      if (!paysIn(it, mi)) continue;
      if (it.type === 'income') inc += toOre(it.amount); else exp += toOre(it.amount);
    }
  }
  return { income: fromOre(inc), expense: fromOre(exp), net: fromOre(inc - exp) };
}

/**
 * Budgetkonto: hvor meget BØR der stå på kontoen i dag?
 * Model: der overføres beløb/freq den 1. i hver måned, og regningen betales på betalingsdagen.
 * Opsparet andel = beløb × (freq − måneder til næste betaling) / freq   (min. 0)
 *   • Betaling senere i denne måned  -> hele beløbet skal stå klar
 *   • Lige betalt                     -> 0
 * account = null betyder alle udgiftsposter.
 */
export function requiredBalance(items, account = null, today = new Date()) {
  const now = dateToIndex(today);
  let req = 0, transfer = 0;
  const rows = [];
  for (const it of items) {
    if (it.type === 'income' || !countsInBudget(it, now)) continue;
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
 * Samme dag: penge ind før penge ud (sådan behandler bankerne faste overførsler og Betalingsservice).
 */
export function projectCashflow(items, startBalance, today = new Date(), horizon = 12) {
  const now = dateToIndex(today);
  const day = today.getDate();
  let bal = toOre(startBalance);
  let lowest = { ore: bal, mi: now, day };
  const months = [];

  for (let k = 0; k < horizon; k++) {
    const mi = now + k;
    const evs = [];
    for (const it of items) {
      if (!paysIn(it, mi)) continue;
      const d = payDayIn(it, mi);
      if (k === 0 && d <= day) continue;
      const ore = toOre(it.amount);
      evs.push({ day: d, ore: it.type === 'income' ? ore : -ore, name: it.name, id: it.id, type: it.type, account: it.account || '' });
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
const COMPARE_FIELDS = ['amount', 'freq', 'category', 'who', 'supplier', 'account', 'method', 'startMonth', 'payDay', 'endMonth', 'active'];

export function compareItems(oldItems, newItems, today = new Date()) {
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

  const a = summarize(oldItems, today);
  const b = summarize(newItems, today);
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
      before: { income: a.income, expense: a.expense, net: a.net },
      after: { income: b.income, expense: b.expense, net: b.net },
      delta: { income: b.income - a.income, expense: b.expense - a.expense, net: b.net - a.net },
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
export function personSummary(items, { jointAccounts = [], jointSplit = null, people = [], today = new Date() } = {}) {
  const now = dateToIndex(today);
  const persons = {};
  const ensure = (n) => (persons[n] ??= { name: n, ownExpense: 0, income: 0, jointContribution: 0, items: [] });
  const joint = { expense: 0, income: 0, items: [] };
  for (const n of people) if (n !== JOINT) ensure(n);

  for (const it of items) {
    if (!countsInBudget(it, now)) continue;
    const { parts } = shareOf(it, jointAccounts);
    for (const [name, amt] of Object.entries(parts)) {
      if (name === JOINT) {
        if (it.type === 'income') joint.income += amt; else joint.expense += amt;
        joint.items.push({ item: it, amount: amt });
      } else {
        const p = ensure(name);
        if (it.type === 'income') p.income += amt; else p.ownExpense += amt;
        p.items.push({ item: it, amount: amt });
      }
    }
  }

  // Hvor meget skal der overføres til fælles? (fælles udgifter minus det, der kommer direkte ind på fælleskonti)
  const jointNeed = Math.max(0, joint.expense - joint.income);
  const names = Object.keys(persons);
  let split = jointSplit && Object.values(jointSplit).some((p) => Number(p) > 0) ? jointSplit : null;
  if (!split) split = Object.fromEntries(names.map((n) => [n, 100 / (names.length || 1)]));
  const total = Object.entries(split).filter(([n]) => persons[n]).reduce((s, [, p]) => s + Number(p || 0), 0);
  for (const n of names) {
    persons[n].jointContribution = total > 0 ? (jointNeed * Number(split[n] || 0)) / total : 0;
    persons[n].totalOut = persons[n].ownExpense + persons[n].jointContribution;
    persons[n].left = persons[n].income - persons[n].totalOut;
  }
  return { persons: Object.values(persons), joint: { ...joint, need: jointNeed }, split };
}
