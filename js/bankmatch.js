// Plan og virkelighed: sammenligner budgetposterne med de rigtige posteringer fra banken.
// Rene funktioner uden Firebase — testes i tests/bankmatch.test.mjs.
import { ymToIndex, indexToYm, paysIn, payDayIn, flowOf } from './calc.js';

const STOP = new Set(['betalingsservice', 'overfoersel', 'overførsel', 'dankort', 'visa', 'mastercard', 'nota', 'kortnr', 'kort', 'mobilepay', 'fra', 'til', 'den', 'det', 'and', 'the', 'aps', 'a/s', 'dkk', 'betaling', 'køb', 'koeb', 'fast', 'faste', 'termin']);

export function normText(s) {
  return String(s || '').toLowerCase()
    .replace(/[0-9]+/g, ' ').replace(/[^a-zæøåäöü ]+/g, ' ')
    .split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)).join(' ');
}
export const tokens = (s) => new Set(normText(s).split(' ').filter(Boolean));
const overlap = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const toDate = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const days = (a, b) => Math.round((toDate(a) - toDate(b)) / 864e5);

/** Hvad budgettet forventer går ind (+) og ud (−) af en konto i en given måned. */
export function expectedFor(items, account, ym) {
  const mi = ymToIndex(ym);
  const out = [];
  for (const it of items) {
    const f = flowOf(it, { account });
    if (!f.sign || !paysIn(it, mi)) continue;
    const day = payDayIn(it, mi);
    out.push({ item: it, amount: f.sign * (Number(it.amount) || 0), day, date: `${ym}-${String(day).padStart(2, '0')}` });
  }
  return out.sort((a, b) => a.day - b.day);
}

/**
 * Parrer forventede betalinger med posteringer.
 * txs: [{id, date:'YYYY-MM-DD', amount (±), text, party, partyKey}] — gerne for måneden ± lidt.
 * knownKeys: nøgler for jeres egne konti (så interne overførsler genkendes).
 */
export function matchMonth(items, txs, { account, ym, today = new Date(), knownKeys = [] } = {}) {
  const exp = expectedFor(items, account, ym);
  const tx = txs.map((t) => ({ ...t, internal: !!(t.partyKey && knownKeys.includes(t.partyKey)) }));
  const pairs = [];
  exp.forEach((e, ei) => {
    const want = tokens(`${e.item.name} ${e.item.supplier || ''}`);
    tx.forEach((t, ti) => {
      if (Math.sign(t.amount) !== Math.sign(e.amount) || !e.amount) return;
      const dd = Math.abs(days(t.date, e.date));
      if (dd > 7) return;
      const ad = Math.abs(Math.abs(t.amount) - Math.abs(e.amount)) / Math.abs(e.amount);
      const hit = overlap(want, tokens(`${t.text} ${t.party}`));
      const transferHit = e.item.type === 'transfer' && t.internal;
      if (!(ad <= 0.15 || ((hit || transferHit) && ad <= 0.5))) return;
      pairs.push({ ei, ti, score: (hit ? 2 : 0) + (transferHit ? 1.5 : 0) + (1 - ad) * 2 + (1 - dd / 8) });
    });
  });
  pairs.sort((a, b) => b.score - a.score);
  const usedE = new Map(), usedT = new Set();
  for (const p of pairs) {
    if (usedE.has(p.ei) || usedT.has(p.ti)) continue;
    usedE.set(p.ei, p.ti); usedT.add(p.ti);
  }
  const todayIso = iso(today);
  const rows = exp.map((e, ei) => {
    const t = usedE.has(ei) ? tx[usedE.get(ei)] : null;
    if (t) {
      const diff = Math.round((t.amount - e.amount) * 100) / 100;
      return { ...e, tx: t, diff, status: Math.abs(diff) <= 1 ? 'ok' : 'diff' };
    }
    const late = days(todayIso, e.date);
    return { ...e, tx: null, diff: 0, status: late > 3 ? 'missing' : late >= 0 ? 'late' : 'pending' };
  });
  const inMonth = tx.filter((t) => t.date.startsWith(ym));
  const sum = (arr, sign) => Math.round(arr.filter((x) => Math.sign(x) === sign).reduce((s, x) => s + Math.abs(x), 0) * 100) / 100;
  return {
    rows,
    usedIds: new Set([...usedT].map((i) => tx[i].id)),
    unplanned: inMonth.filter((t, i) => !usedT.has(tx.indexOf(t)) && !t.internal),
    internal: inMonth.filter((t) => t.internal),
    planned: { in: sum(exp.map((e) => e.amount), 1), out: sum(exp.map((e) => e.amount), -1) },
    actual: { in: sum(inMonth.map((t) => t.amount), 1), out: sum(inMonth.map((t) => t.amount), -1) },
  };
}

/** Faste betalinger i banken, som ikke står i budgettet (set i mindst 2 forskellige måneder). */
export function suggestions(items, txs, { account, today = new Date(), knownKeys = [], months = 4 } = {}) {
  const now = ymToIndex(iso(today).slice(0, 7));
  const used = new Set();
  for (let k = 0; k < months; k++) {
    const ym = indexToYm(now - k);
    for (const id of matchMonth(items, txs, { account, ym, today, knownKeys }).usedIds) used.add(id);
  }
  const fromYm = indexToYm(now - months + 1);
  const itemTok = items.map((i) => tokens(`${i.name} ${i.supplier || ''}`));
  const groups = new Map();
  for (const t of txs) {
    if (used.has(t.id) || t.amount >= 0 || t.date.slice(0, 7) < fromYm) continue;
    if (t.partyKey && knownKeys.includes(t.partyKey)) continue;
    const key = normText(t.party || t.text).split(' ').slice(0, 2).join(' ');
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const out = [];
  for (const [key, list] of groups) {
    const monthsSeen = new Set(list.map((t) => t.date.slice(0, 7)));
    if (monthsSeen.size < 2) continue;
    const amts = list.map((t) => Math.abs(t.amount)).sort((a, b) => a - b);
    const med = amts[Math.floor(amts.length / 2)];
    if (amts.some((a) => Math.abs(a - med) / med > 0.2)) continue;
    const kt = tokens(key);
    if (itemTok.some((it) => overlap(it, kt))) continue;
    const dd = list.map((t) => Number(t.date.slice(8, 10))).sort((a, b) => a - b);
    const raw = (list[0].party || list[0].text).trim();
    out.push({
      name: raw.length > 40 ? raw.slice(0, 40) : raw.replace(/\b\w/g, (c) => c.toUpperCase()),
      amount: Math.round(med * 100) / 100, day: dd[Math.floor(dd.length / 2)], seen: monthsSeen.size, account,
      last: list.map((t) => t.date).sort().pop(),
    });
  }
  return out.sort((a, b) => b.amount - a.amount).slice(0, 8);
}
