// Kør med:  node tests/calc.test.mjs
import assert from 'node:assert/strict';
import {
  monthly, yearly, paysIn, ymToIndex, payDayIn, nextPayment, summarize,
  calendarYear, requiredBalance, projectCashflow, compareItems, freqLabel,
} from '../js/calc.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('✓', name); };
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg}: ${a} ≠ ${b}`);
const D = (y, m, d) => new Date(y, m - 1, d);

t('månedlig og årlig omregning', () => {
  close(monthly({ amount: 1200, freq: 3 }), 400, 'kvartal');
  close(monthly({ amount: 3000, freq: 12 }), 250, 'årlig');
  close(monthly({ amount: 999, freq: 6 }), 166.5, 'halvår');
  close(yearly({ amount: 450, freq: 2 }), 2700, '2-md årligt');
  close(monthly({ amount: 100, freq: 0 }), 100, 'ugyldig frekvens → 1');
});

t('betalingsmåneder følger ankeret', () => {
  const it = { amount: 300, freq: 3, startMonth: '2026-02' };
  const pays = (ym) => paysIn(it, ymToIndex(ym));
  assert.ok(pays('2026-02') && pays('2026-05') && pays('2026-08') && pays('2026-11') && pays('2027-02'));
  assert.ok(!pays('2026-03') && !pays('2026-01') && !pays('2025-11'), 'ikke før start');
});

t('slutmåned og inaktiv', () => {
  const it = { amount: 1, freq: 1, startMonth: '2026-01', endMonth: '2026-06' };
  assert.ok(paysIn(it, ymToIndex('2026-06')));
  assert.ok(!paysIn(it, ymToIndex('2026-07')));
  assert.ok(!paysIn({ ...it, active: false }, ymToIndex('2026-03')));
});

t('betalingsdag 31 i februar → 28', () => {
  assert.equal(payDayIn({ payDay: 31 }, ymToIndex('2026-02')), 28);
  assert.equal(payDayIn({ payDay: 31 }, ymToIndex('2028-02')), 29);
});

t('næste betaling', () => {
  const it = { amount: 1, freq: 1, payDay: 5, startMonth: '2026-01' };
  assert.equal(nextPayment(it, D(2026, 9, 29)).ym, '2026-10');
  assert.equal(nextPayment(it, D(2026, 9, 3)).ym, '2026-09');
  assert.equal(nextPayment(it, D(2026, 9, 5)).ym, '2026-10', 'samme dag = betalt');
  const y = { amount: 1, freq: 12, payDay: 1, startMonth: '2026-03' };
  assert.equal(nextPayment(y, D(2026, 9, 29)).ym, '2027-03');
});

t('opsummering + kalenderår', () => {
  const items = [
    { type: 'income', amount: 30000, freq: 1, category: 'Løn' },
    { type: 'expense', amount: 1200, freq: 3, category: 'Hus', startMonth: '2026-01' },
    { type: 'expense', amount: 0.1, freq: 1, category: 'Hus' },
    { type: 'expense', amount: 0.2, freq: 1, category: 'Hus' },
    { type: 'expense', amount: 500, freq: 1, active: false },
  ];
  const s = summarize(items, D(2026, 9, 29));
  close(s.income, 30000, 'ind'); close(s.expense, 400.3, 'ud'); close(s.net, 29599.7, 'netto');
  close(s.yearNet, 355196.4, 'år');
  const c = calendarYear(items, 2026);
  assert.equal(c.expense, 1200 * 4 + 12 * 0.3); // 4803.6 præcist i øre
  assert.equal(c.income, 360000);
});

t('budgetkonto: opsparet andel', () => {
  const today = D(2026, 9, 29);
  // årlig 1200 betalt i marts: april..sep = 6 overførsler = 600
  let r = requiredBalance([{ type: 'expense', amount: 1200, freq: 12, payDay: 1, startMonth: '2026-03', account: 'B' }], 'B', today);
  close(r.required, 600, 'årlig'); close(r.monthlyTransfer, 100, 'overførsel');
  // månedlig betaling den 30. (endnu ikke betalt) → hele beløbet skal stå klar
  r = requiredBalance([{ type: 'expense', amount: 800, freq: 1, payDay: 30, account: 'B' }], 'B', today);
  close(r.required, 800, 'ubetalt denne måned');
  // månedlig betalt den 1. → 0
  r = requiredBalance([{ type: 'expense', amount: 800, freq: 1, payDay: 1, account: 'B' }], 'B', today);
  close(r.required, 0, 'betalt');
  // anden konto tæller ikke med
  r = requiredBalance([{ type: 'expense', amount: 800, freq: 1, payDay: 30, account: 'X' }], 'B', today);
  close(r.required, 0, 'filter');
  // starter om 2 mdr, kvartalsvis → 1 af 3 overførsler = 1/3
  r = requiredBalance([{ type: 'expense', amount: 900, freq: 3, payDay: 1, startMonth: '2026-11' }], null, today);
  close(r.required, 300, 'fremtidig start');
});

t('likviditet: minus midt i måneden opdages', () => {
  const items = [
    { type: 'expense', name: 'Husleje', amount: 1500, freq: 1, payDay: 5 },
    { type: 'income', name: 'Løn', amount: 1000, freq: 1, payDay: 25 },
  ];
  const cf = projectCashflow(items, 1000, D(2026, 9, 29), 4);
  const [sep, oct, nov, dec] = cf.months;
  assert.equal(sep.ym, '2026-09'); assert.equal(sep.end, 1000, 'rest af sep uden hændelser');
  assert.equal(oct.ym, '2026-10');
  assert.equal(oct.start, 1000); assert.equal(oct.min, -500); assert.equal(oct.minDay, 5); assert.equal(oct.end, 500);
  assert.equal(nov.min, -1000); assert.equal(nov.end, 0);
  assert.equal(dec.end, -500);
  assert.equal(cf.firstNegative.ym, '2026-10');
  assert.equal(cf.lowest.amount, -1500); assert.equal(cf.lowest.ym, '2026-12');
});

t('likviditet: sept medtager kun resterende dage', () => {
  const items = [
    { type: 'expense', amount: 100, freq: 1, payDay: 10 },
    { type: 'expense', amount: 50, freq: 1, payDay: 30 },
  ];
  const cf = projectCashflow(items, 0, D(2026, 9, 29), 1);
  assert.equal(cf.months[0].expense, 50);
  assert.equal(cf.months[0].end, -50);
});

t('likviditet: samme dag kommer penge ind før penge ud', () => {
  const items = [
    { type: 'expense', amount: 500, freq: 1, payDay: 1 },
    { type: 'income', amount: 500, freq: 1, payDay: 1 },
  ];
  const cf = projectCashflow(items, 0, D(2026, 9, 29), 2);
  assert.equal(cf.months[1].min, 0, 'overførslen dækker regningen samme dag');
  assert.equal(cf.months[1].end, 0);
});

t('øre-præcision i likviditet', () => {
  const items = Array.from({ length: 10 }, () => ({ type: 'expense', amount: 0.1, freq: 1, payDay: 15 }));
  const cf = projectCashflow(items, 0, D(2026, 9, 29), 1);
  assert.equal(cf.months[0].end, 0); // 29/9: ingen betalinger tilbage i sep
  const cf2 = projectCashflow(items, 0, D(2026, 9, 1), 1);
  assert.equal(cf2.months[0].end, -1);
});

t('sammenligning', () => {
  const old = [
    { id: 'a', type: 'expense', name: 'Forsikring', amount: 1200, freq: 12, category: 'Forsikringer' },
    { id: 'b', type: 'expense', name: 'Netflix', amount: 129, freq: 1, category: 'Abonnementer' },
    { id: 'c', type: 'income', name: 'Løn', amount: 30000, freq: 1, category: 'Løn' },
  ];
  const now = [
    { id: 'a', type: 'expense', name: 'Forsikring', amount: 1800, freq: 12, category: 'Forsikringer' },
    { id: 'c', type: 'income', name: 'Løn', amount: 30000, freq: 1, category: 'Løn' },
    { id: 'x', type: 'expense', name: 'Fitness', amount: 299, freq: 1, category: 'Fritid' },
  ];
  const r = compareItems(old, now, D(2026, 9, 29));
  assert.equal(r.added.length, 1); assert.equal(r.removed.length, 1); assert.equal(r.changed.length, 1); assert.equal(r.unchanged, 1);
  close(r.changed[0].deltaMonthly, 50, 'forsikring +50/md');
  close(r.totals.delta.expense, 50 - 129 + 299, 'udgiftsændring');
});

t('frekvens-label fallback', () => {
  assert.equal(freqLabel(12), 'Årligt');
  assert.equal(freqLabel(18), 'Hver 18. måned');
});

console.log(`\n${passed} tests bestået.`);

// ---------- Fordeling pr. person ----------
import { shareOf, personSummary } from '../js/calc.js';
t('fælleskonto → hele posten er fælles', () => {
  const r = shareOf({ amount: 1200, freq: 3, account: 'Fælleskonto', split: { Mike: 50 } }, ['Fælleskonto']);
  assert.ok(r.joint); close(r.parts['Fælles'], 400, 'fælles');
});
t('procent pr. post (normaliseres)', () => {
  const r = shareOf({ amount: 1000, freq: 1, account: 'Lønkonto', split: { Mike: 60, Maria: 40 } }, ['Fælleskonto']);
  close(r.parts.Mike, 600, 'Mike'); close(r.parts.Maria, 400, 'Maria');
  const r2 = shareOf({ amount: 900, freq: 1, split: { Mike: 1, Maria: 2 } });
  close(r2.parts.Mike, 300, 'norm Mike'); close(r2.parts.Maria, 600, 'norm Maria');
});
t('uden split → 100 % til hvem', () => {
  close(shareOf({ amount: 500, freq: 1, who: 'Maria' }).parts.Maria, 500, 'Maria');
  assert.ok(shareOf({ amount: 500, freq: 1, who: 'Fælles' }).joint);
  assert.ok(shareOf({ amount: 500, freq: 1 }).joint);
});
t('person-overblik inkl. andel af fælleskonto', () => {
  const items = [
    { type: 'income', amount: 30000, freq: 1, who: 'Mike', account: 'Lønkonto' },
    { type: 'income', amount: 20000, freq: 1, who: 'Maria', account: 'Lønkonto' },
    { type: 'income', amount: 1000, freq: 1, who: 'Fælles', account: 'Fælleskonto' },   // børnepenge direkte til fælles
    { type: 'expense', amount: 9000, freq: 1, account: 'Fælleskonto' },                  // husleje
    { type: 'expense', amount: 1200, freq: 12, account: 'Fælleskonto' },                 // forsikring 100/md
    { type: 'expense', amount: 300, freq: 1, account: 'Lønkonto', split: { Mike: 50, Maria: 50 } },
    { type: 'expense', amount: 400, freq: 1, account: 'Lønkonto', who: 'Mike' },
  ];
  const s = personSummary(items, { jointAccounts: ['Fælleskonto'], jointSplit: { Mike: 60, Maria: 40 }, people: ['Mike', 'Maria', 'Fælles'] });
  close(s.joint.expense, 9100, 'fælles ud'); close(s.joint.need, 8100, 'skal overføres');
  const mike = s.persons.find((p) => p.name === 'Mike'), maria = s.persons.find((p) => p.name === 'Maria');
  close(mike.ownExpense, 550, 'Mike egne'); close(mike.jointContribution, 4860, 'Mike fælles 60%'); close(mike.totalOut, 5410, 'Mike i alt');
  close(maria.ownExpense, 150, 'Maria egne'); close(maria.jointContribution, 3240, 'Maria fælles 40%'); close(maria.left, 20000 - 3390, 'Maria tilbage');
  // Kontrol: alt der går ud = egne + fælles; det samme beløb skal findes i personernes totaler + fælles-indtægt
  close(mike.totalOut + maria.totalOut + s.joint.income, 9100 + 300 + 400, 'balancerer');
});
t('fælles deles ligeligt uden indstilling', () => {
  const s = personSummary([{ type: 'expense', amount: 1000, freq: 1, account: 'F' }], { jointAccounts: ['F'], people: ['A', 'B', 'Fælles'] });
  close(s.persons[0].jointContribution, 500, 'A'); close(s.persons[1].jointContribution, 500, 'B');
});
console.log(`${passed} tests bestået i alt.`);
