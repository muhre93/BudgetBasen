// Kør med:  node tests/bankmatch.test.mjs
import assert from 'node:assert/strict';
import { matchMonth, suggestions, expectedFor, normText } from '../js/bankmatch.js';

const items = [
  { id: 'r', type: 'expense', name: 'Realkredit', supplier: 'Totalkredit', amount: 21963, freq: 3, startMonth: '2026-09', payDay: 15, account: 'Budgetkonto' },
  { id: 'el', type: 'expense', name: 'El', supplier: 'Andel Energi', amount: 900, freq: 1, payDay: 5, account: 'Budgetkonto' },
  { id: 'fo', type: 'expense', name: 'Forsikring', supplier: 'Tryg', amount: 650, freq: 1, payDay: 1, account: 'Budgetkonto' },
  { id: 'in', type: 'transfer', name: 'Til budgetkonto', amount: 8600, freq: 1, payDay: 1, account: 'Lønkonto', toAccount: 'Budgetkonto' },
  { id: 'net', type: 'expense', name: 'Internet', amount: 299, freq: 1, payDay: 10, account: 'Budgetkonto' },
  { id: 'other', type: 'expense', name: 'Mobil', amount: 199, freq: 1, payDay: 12, account: 'Lønkonto' },
];
const LON = 'k-lon';
const tx = [
  { id: 't1', date: '2026-09-15', amount: -21963, text: 'Totalkredit termin', party: 'Totalkredit' },
  { id: 't2', date: '2026-09-07', amount: -1203.5, text: 'Andel Energi BS', party: 'Andel Energi' },  // el: dyrere end planlagt, 2 dage senere
  { id: 't3', date: '2026-09-01', amount: 8600, text: 'Overførsel', party: 'Lasse', partyKey: LON },
  { id: 't4', date: '2026-09-03', amount: -129, text: 'Netflix.com', party: 'Netflix' },
  { id: 't5', date: '2026-08-03', amount: -129, text: 'Netflix.com', party: 'Netflix' },
  { id: 't6', date: '2026-07-03', amount: -129, text: 'NETFLIX.COM 4471', party: 'Netflix' },
  { id: 't7', date: '2026-09-20', amount: -450, text: 'Netto 1234', party: 'Netto' },
  { id: 't8', date: '2026-08-14', amount: -312, text: 'Netto 99', party: 'Netto' },
  { id: 't9', date: '2026-08-01', amount: -650, text: 'Tryg forsikring', party: 'Tryg' },
];
let n = 0; const t = (name, fn) => { fn(); n++; console.log('✓', name); };

t('forventet på Budgetkonto i september', () => {
  const e = expectedFor(items, 'Budgetkonto', '2026-09');
  assert.deepEqual(e.map((x) => [x.item.id, x.amount, x.day]), [['fo', -650, 1], ['in', 8600, 1], ['el', -900, 5], ['net', -299, 10], ['r', -21963, 15]]);
});
t('normText fjerner tal og fyldord', () => assert.equal(normText('NETFLIX.COM 4471 Betalingsservice'), 'netflix com'));

const m = matchMonth(items, tx, { account: 'Budgetkonto', ym: '2026-09', today: new Date(2026, 8, 30), knownKeys: [LON] });
const by = Object.fromEntries(m.rows.map((r) => [r.item.id, r]));
t('realkredit trukket som planlagt', () => { assert.equal(by.r.status, 'ok'); assert.equal(by.r.tx.id, 't1'); });
t('el trukket, men 303,50 kr. dyrere', () => { assert.equal(by.el.status, 'diff'); assert.equal(by.el.diff, -303.5); });
t('overførsel fra lønkonto genkendt (intern)', () => { assert.equal(by.in.status, 'ok'); assert.ok(by.in.tx.internal); });
t('forsikring mangler (august-trækket tæller ikke for september)', () => assert.equal(by.fo.status, 'missing'));
t('internet ikke fundet → mangler', () => assert.equal(by.net.status, 'missing'));
t('ikke-planlagte posteringer', () => assert.deepEqual(m.unplanned.map((x) => x.id).sort(), ['t4', 't7']));
t('planlagt vs faktisk', () => {
  assert.equal(m.planned.out, 650 + 900 + 299 + 21963); assert.equal(m.planned.in, 8600);
  assert.equal(m.actual.out, 21963 + 1203.5 + 129 + 450);
});
t('kommende betaling er "pending"', () => {
  const m2 = matchMonth(items, tx, { account: 'Budgetkonto', ym: '2026-10', today: new Date(2026, 9, 1) });
  const r = m2.rows.find((x) => x.item.id === 'el');
  assert.equal(r.status, 'pending');
});
t('forslag: Netflix (3 måneder) men ikke Netto (svinger) eller kendte poster', () => {
  const s = suggestions(items, tx, { account: 'Budgetkonto', today: new Date(2026, 8, 30), knownKeys: [LON] });
  assert.deepEqual(s.map((x) => x.name), ['Netflix']);
  assert.equal(s[0].amount, 129); assert.equal(s[0].day, 3); assert.equal(s[0].seen, 3);
});
console.log(`\n${n} bankmatch-tests bestået.`);
