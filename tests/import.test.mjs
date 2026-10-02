// Kør med:  node tests/import.test.mjs
import assert from 'node:assert/strict';
import { parseImportRows, parseAmountDa, IMPORT_COLUMNS, IMPORT_EXAMPLES } from '../js/importparse.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('✓', name); };
const ctx = () => ({ accounts: ['Lønkonto', 'Budgetkonto', 'Opsparingskonto'], people: ['Mike', 'Maria'], categories: ['Bolig', 'Løn', 'Andet'], existing: [{ type: 'expense', name: 'realkredit', amount: 21963 }], currentYm: '2026-10' });
const obj = (arr) => Object.fromEntries(IMPORT_COLUMNS.map((c, i) => [c, arr[i]]));

t('beløb på dansk', () => {
  assert.equal(parseAmountDa('21.963,00'), 21963); assert.equal(parseAmountDa('1.200'), 1200); assert.equal(parseAmountDa('299,5 kr.'), 299.5); assert.equal(parseAmountDa(450), 450); assert.equal(parseAmountDa('12.5'), 12.5);
});
t('skabelonens eksempler kan læses', () => {
  const r = parseImportRows(IMPORT_EXAMPLES.map(obj), ctx());
  assert.equal(r.rows.length, 6); assert.ok(r.rows.every((x) => x.ok));
  const [lon, real, , bil, ovf] = r.rows.map((x) => x.item);
  assert.deepEqual([lon.type, lon.payDay, lon.freq, lon.account], ['income', 31, 1, 'Lønkonto']);
  assert.deepEqual([real.freq, real.startMonth, real.category], [3, '2026-12', 'Bolig']);
  assert.equal(r.rows[1].dup, true, 'Realkredit findes allerede');
  assert.equal(bil.freq, 6);
  assert.deepEqual([ovf.type, ovf.account, ovf.toAccount, ovf.category], ['transfer', 'Lønkonto', 'Budgetkonto', '']);
  assert.deepEqual(r.newValues, { accounts: [], people: [], categories: ['Mad & dagligvarer', 'Forsikringer'] });
});
t('fejl og advarsler', () => {
  const r = parseImportRows([
    { type: 'udgift', NAVN: 'El', 'beløb': '900', 'Hvor ofte': '', Dag: '', Konto: 'budgetkonto', Hvem: 'bjørk' },
    { Type: 'Hvad', Navn: 'x', Beløb: 5 },
    { Type: 'Overførsel', Navn: 'Opsparing', Beløb: 500, Konto: 'Lønkonto' },
    { Type: '', Navn: '', Beløb: '' },
    { Type: 'Udgift', Navn: 'Licens', Beløb: 'abc' },
    { Type: 'Udgift', Navn: 'Forsikring', Beløb: '1.980', 'Hvor ofte': 12, Dag: 'sidste', 'Første måned': '03/2027', Konto: 'Ny konto' },
  ], ctx());
  assert.equal(r.rows.length, 5, 'tom række springes over');
  assert.equal(r.rows[0].ok, true); assert.equal(r.rows[0].item.account, 'Budgetkonto', 'store/små bogstaver'); assert.equal(r.rows[0].item.who, 'bjørk');
  assert.equal(r.rows[1].ok, false); assert.equal(r.rows[2].ok, false); assert.equal(r.rows[3].ok, false);
  assert.match(r.rows[2].errors[0], /Til konto/);
  assert.deepEqual([r.rows[4].item.freq, r.rows[4].item.payDay, r.rows[4].item.startMonth], [12, 31, '2027-03']);
  assert.deepEqual(r.newValues, { accounts: ['Ny konto'], people: ['bjørk'], categories: [] });
  assert.equal(r.rows[0].line, 2); assert.equal(r.rows[4].line, 7);
});
console.log(`\n${n} import-tests bestået.`);
