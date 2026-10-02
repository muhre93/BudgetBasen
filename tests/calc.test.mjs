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

t('likviditet: samme dag kommer indtægter før udgifter', () => {
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

// ---------- Overførsler & opsparing ----------
import { flowOf, touchesAccount } from '../js/calc.js';
const FAM = [
  { type: 'income', name: 'Løn', amount: 50000, freq: 1, payDay: 25, account: 'Lønkonto' },
  { type: 'transfer', name: 'Til budgetkonto', amount: 9500, freq: 1, payDay: 1, account: 'Lønkonto', toAccount: 'Budgetkonto' },
  { type: 'transfer', name: 'Opsparing', amount: 3000, freq: 1, payDay: 1, account: 'Lønkonto', toAccount: 'Opsparingskonto' },
  { type: 'expense', name: 'Husleje', amount: 9100, freq: 1, payDay: 1, account: 'Budgetkonto' },
  { type: 'expense', name: 'Mad', amount: 28900, freq: 1, payDay: 1, account: 'Lønkonto' },
];
const SAV = { savingsAccounts: ['Opsparingskonto'] };
t('samlet: opsparing trækkes fra, overførsel mellem brugskonti tæller ikke', () => {
  const s = summarize(FAM, D(2026, 9, 29), SAV);
  close(s.income, 50000, 'ind'); close(s.expense, 38000, 'ud'); close(s.saving, 3000, 'opsparing');
  close(s.net, 9000, 'tilbage af lønnen = 50000 − 38000 − 3000');
});
t('budgetkonto: kun det der går ind/ud af kontoen — opsparing rører den ikke', () => {
  const s = summarize(FAM, D(2026, 9, 29), { account: 'Budgetkonto', ...SAV });
  close(s.income, 9500, 'overførsel ind'); close(s.expense, 9100, 'husleje'); close(s.saving, 0, 'ingen opsparing'); close(s.net, 400, 'tilbage på budgetkontoen');
});
t('lønkonto: overførsler ud er minus', () => {
  const s = summarize(FAM, D(2026, 9, 29), { account: 'Lønkonto', ...SAV });
  close(s.income, 50000, 'løn'); close(s.expense, 9500 + 3000 + 28900, 'ud'); close(s.net, 8600, 'lønkonto: 50000 − 9500 − 3000 − 28900');
});
t('opsparingskonto: vokser med overførslen', () => {
  const s = summarize(FAM, D(2026, 9, 29), { account: 'Opsparingskonto', ...SAV });
  close(s.income, 3000, 'ind'); close(s.net, 3000, 'vokser');
});
t('hævning fra opsparing tæller som plus i det samlede', () => {
  const r = flowOf({ type: 'transfer', account: 'Opsparingskonto', toAccount: 'Lønkonto' }, SAV);
  assert.equal(r.bucket, 'saving'); assert.equal(r.sign, 1);
  assert.equal(flowOf({ type: 'transfer', account: 'A', toAccount: 'A' }, { account: 'A' }).sign, 0, 'samme konto → 0');
  assert.ok(touchesAccount(FAM[1], 'Budgetkonto') && touchesAccount(FAM[1], 'Lønkonto') && !touchesAccount(FAM[1], 'Opsparingskonto'));
});
t('likviditet pr. konto medtager overførsler; alle konti ignorerer dem', () => {
  const cf = projectCashflow(FAM, 1000, D(2026, 9, 29), 2, { account: 'Budgetkonto' });
  const oct = cf.months[1];
  assert.equal(oct.income, 9500); assert.equal(oct.expense, 9100); assert.equal(oct.end, 1400);
  assert.equal(oct.min, 1000, 'overførslen lander før huslejen samme dag → kontoen kommer aldrig under startsaldoen');
  const all = projectCashflow(FAM, 0, D(2026, 9, 29), 2);
  assert.equal(all.months[1].income, 50000); assert.equal(all.months[1].expense, 38000);
});
t('budgetkonto-behov: overførsler væk fra kontoen skal dækkes', () => {
  const r = requiredBalance(FAM, 'Lønkonto', D(2026, 9, 29));
  close(r.monthlyTransfer, 9500 + 3000 + 28900, 'lønkonto ud');
  close(requiredBalance(FAM, 'Budgetkonto', D(2026, 9, 29)).monthlyTransfer, 9100, 'kun husleje');
});
t('kalenderår med opsparing', () => {
  const c = calendarYear(FAM, 2027, SAV);
  assert.equal(c.saving, 36000); assert.equal(c.net, 12 * 9000);
});
t('person-overblik: opsparing pr. person og fælles', () => {
  const items = [
    { type: 'income', amount: 30000, freq: 1, who: 'A', account: 'Løn' },
    { type: 'income', amount: 20000, freq: 1, who: 'B', account: 'Løn' },
    { type: 'transfer', amount: 2000, freq: 1, who: 'A', account: 'Løn', toAccount: 'Opsparing' },
    { type: 'transfer', amount: 1000, freq: 1, account: 'Budgetkonto', toAccount: 'Opsparing' },  // fælles opsparing
    { type: 'transfer', amount: 9000, freq: 1, who: 'A', account: 'Løn', toAccount: 'Budgetkonto' }, // ignoreres
    { type: 'expense', amount: 8000, freq: 1, account: 'Budgetkonto' },
  ];
  const s = personSummary(items, { jointAccounts: ['Budgetkonto'], jointSplit: { A: 50, B: 50 }, people: ['A', 'B'], savingsAccounts: ['Opsparing'] });
  const A = s.persons.find((p) => p.name === 'A'), B = s.persons.find((p) => p.name === 'B');
  close(s.joint.need, 9000, 'fælles 8000 + opsparing 1000'); close(A.saving, 2000, 'A opsparing');
  close(A.left, 30000 - 4500 - 2000, 'A tilbage'); close(B.left, 20000 - 4500, 'B tilbage');
});

// ---------- Lasses eksempel: overfører mere end regningerne koster ----------
import { accountFunding, spendable } from '../js/calc.js';
const MIKE = [
  { type: 'income', name: 'Løn Mike', amount: 29400, freq: 1, payDay: 30, who: 'Mike', account: 'Lønkonto' },
  { type: 'transfer', name: 'Mike til Budget', amount: 23000, freq: 1, payDay: 30, who: 'Mike', account: 'Lønkonto', toAccount: 'Budgetkonto' },
  { type: 'expense', name: 'Realkredit', amount: 21963, freq: 3, startMonth: '2026-09', payDay: 15, who: 'Mike', account: 'Budgetkonto' },
];
t('Tilbage af lønnen = det der er tilbage på lønkontoen (29.400 − 23.000)', () => {
  const s = summarize(MIKE, D(2026, 9, 30), { savingsAccounts: [] });
  close(s.net, 22079, 'reelt overskud'); close(s.excess, 15679, 'parkeret på budgetkonto'); close(s.left, 6400, 'til forbrug');
  const lk = summarize(MIKE, D(2026, 9, 30), { account: 'Lønkonto' });
  close(lk.net, s.left, 'samme tal som når man ser på lønkontoen');
});
t('budgetkonto: overfører 15.679 for meget', () => {
  const [f] = accountFunding(MIKE, { today: D(2026, 9, 30) });
  assert.equal(f.account, 'Budgetkonto'); close(f.needs, 7321, 'behov'); close(f.diff, 15679, 'for meget'); assert.equal(f.status, 'over');
  const [g] = accountFunding([...MIKE.slice(0, 1), { ...MIKE[1], amount: 6000 }, MIKE[2]], { today: D(2026, 9, 30) });
  assert.equal(g.status, 'under'); close(g.diff, -1321, 'mangler');
  const [h] = accountFunding([...MIKE.slice(0, 1), { ...MIKE[1], amount: 7400 }, MIKE[2]], { today: D(2026, 9, 30) });
  assert.equal(h.status, 'ok', 'inden for 200 kr. = passer');
});
t('person-kort: Mikes "tilbage til sig selv" trækker det parkerede fra', () => {
  const ps = personSummary(MIKE, { jointAccounts: [], people: ['Mike', 'Maria'], today: D(2026, 9, 30) });
  const m = ps.persons.find((p) => p.name === 'Mike');
  close(m.parked, 15679, 'parkeret'); close(m.left, 6400, 'tilbage');
});
t('du kan bruge: med 0 kr. i dag og 23.000 ind hver md. mangler der ikke noget', () => {
  const r = spendable(MIKE, 'Budgetkonto', 0, D(2026, 9, 30));
  assert.equal(r.missing, 0); assert.equal(r.canSpend, 0, 'saldoen er 0 i dag → kan bruge 0');
  assert.equal(r.nextBig.name, 'Realkredit'); assert.equal(r.nextBig.amount, 21963);
  assert.equal(r.nextBig.date.getMonth(), 11, 'december'); assert.equal(r.nextBig.date.getDate(), 15);
});
t('du kan bruge: 26.000 på kontoen', () => {
  const r = spendable(MIKE, 'Budgetkonto', 26000, D(2026, 9, 30));
  assert.equal(r.canSpend, 26000, 'overførslerne dækker alt → hele saldoen er fri');
  const tight = [{ type: 'expense', name: 'Stor regning', amount: 30000, freq: 12, startMonth: '2026-11', payDay: 1, account: 'B' },
                 { type: 'transfer', name: 'Ind', amount: 2000, freq: 1, payDay: 1, account: 'L', toAccount: 'B' }];
  const r2 = spendable(tight, 'B', 20000, D(2026, 9, 30));
  assert.equal(r2.missing, 6000, '20.000 + 2×2.000 − 30.000 = −6.000 den 1. nov.');
  assert.equal(r2.missingDate.getMonth(), 10);
  const r3 = spendable(tight, 'B', 30000, D(2026, 9, 30));
  assert.equal(r3.canSpend, 4000, 'laveste punkt 4.000 = det man kan bruge');
  assert.equal(spendable(tight, 'B', 30000, D(2026, 9, 30), { buffer: 1000 }).canSpend, 3000, 'med buffer');
});

import { setBankDays, isBankDay, bankHolidays, isPaused, countsInBudget as cib, paysIn as pIn, summarize as sum2 } from '../js/calc.js';
t('reelt til forbrug vs. på lønkontoen, når der overføres for lidt', () => {
  const two = [MIKE[0], { ...MIKE[1], amount: 2000 }, MIKE[2]];
  const s = sum2(two, D(2026, 9, 30));
  close(s.left, 22079, 'reelt: 29.400 − 7.321'); close(s.onSalary, 27400, 'på lønkontoen: 29.400 − 2.000'); close(s.shortage, 5321, 'budgetkontoen mangler');
  const ps = personSummary(two, { jointAccounts: [], people: ['Mike'], today: D(2026, 9, 30) });
  close(ps.persons[0].left, 22079, 'person reelt'); close(ps.persons[0].onSalary, 27400, 'person lønkonto');
  const o = sum2(MIKE, D(2026, 9, 30));
  close(o.left, 6400, 'overfører for meget → 6.400'); close(o.onSalary, 6400, 'samme tal');
});
t('pause: tæller ikke med i pauseperioden', () => {
  const it = { type: 'expense', name: 'Institution', amount: 3000, freq: 1, payDay: 1, account: 'B', pause: { from: '2026-07', to: '2026-07' } };
  assert.equal(isPaused(it, 2026 * 12 + 6), true); assert.equal(pIn(it, 2026 * 12 + 6), false);
  assert.equal(pIn(it, 2026 * 12 + 7), true);
  assert.equal(cib({ ...it, pause: { from: '2026-09', to: null } }, 2026 * 12 + 9), false, 'indtil videre');
});
t('sidste dag i måneden (31)', () => {
  const it = { type: 'expense', payDay: 31 };
  assert.equal(payDayIn(it, 2026 * 12 + 1), 28); assert.equal(payDayIn(it, 2028 * 12 + 1), 29); assert.equal(payDayIn(it, 2026 * 12 + 3), 30);
});
t('bankdage: weekend og helligdage', () => {
  assert.ok(bankHolidays(2027).has('3-26'), 'langfredag 2027'); assert.ok(bankHolidays(2026).has('5-14'), 'Kr. himmelfart 2026');
  assert.equal(isBankDay(new Date(2026, 11, 24)), false, 'juleaften');
  setBankDays(true);
  // 1. nov. 2026 er en søndag → regning trækkes mandag den 2.
  assert.equal(payDayIn({ type: 'expense', payDay: 1 }, 2026 * 12 + 10), 2);
  // løn den 31. okt. 2026 (lørdag) → fredag den 30.
  assert.equal(payDayIn({ type: 'income', payDay: 31 }, 2026 * 12 + 9), 30);
  // 31. jan. 2027 er søndag; ingen bankdag efter i måneden → fredag den 29.
  assert.equal(payDayIn({ type: 'expense', payDay: 31 }, 2027 * 12), 29);
  setBankDays(false);
  assert.equal(payDayIn({ type: 'expense', payDay: 1 }, 2026 * 12 + 10), 1, 'slået fra');
});
console.log(`${passed} tests bestået i alt.`);
