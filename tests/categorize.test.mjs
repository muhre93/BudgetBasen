// Kør med:  node tests/categorize.test.mjs
import assert from 'node:assert/strict';
import { categorize, spendByCategory, monthSummary, recurring, partyKeyOf } from '../js/categorize.js';

let n = 0; const t = (name, fn) => { fn(); n++; console.log('✓', name); };
const tx = (date, amount, text, party = '', partyKey = '') => ({ id: `${date}${text}${amount}`, date, amount, text, party, partyKey });

t('kendte butikker', () => {
  assert.equal(categorize(tx('2026-09-21', -161, 'NETTO AALBORGVE Notanr 0530941626')), 'groceries');
  assert.equal(categorize(tx('2026-09-24', -211, 'proshop.dk\\Michael Drewsens Vej')), 'electronics');
  assert.equal(categorize(tx('2026-09-18', -134, 'Batteribyen.dk\\Spettrupvej')), 'electronics');
  assert.equal(categorize(tx('2026-09-03', -129, 'Netflix.com')), 'subscriptions');
  assert.equal(categorize(tx('2026-09-23', -160, 'Advis 1226 / BonusTryghedsGruppen')), 'insurance');
  assert.equal(categorize(tx('2026-09-15', -11200, 'Totalkredit termin')), 'housing');
});
t('MobilePay: til person vs. butik', () => {
  assert.equal(categorize(tx('2026-09-25', -220, 'MobilePay Steen Bendix Hald', 'VIPPS MOBILEPAY')), 'mobilepay');
  assert.equal(categorize(tx('2026-09-25', -89, 'MobilePay Sunset Boulevard')), 'eatout');
});
t('penge ind og egne konti', () => {
  assert.equal(categorize(tx('2026-09-29', 15576, 'Løn', 'Mike Skov Uhre')), 'income');
  assert.equal(categorize(tx('2026-09-28', 100, 'Mob.Pay*Kirsten')), 'moneyin');
  assert.equal(categorize(tx('2026-09-29', -300, 'Til Fælles Opsparing', '', 'k1'), {}, ['k1']), 'internal');
});
t('MobilePay-regler gælder modtageren, ikke alle MobilePay-betalinger', () => {
  assert.equal(partyKeyOf(tx('x', -220, 'MobilePay Steen Bendix Hald', 'VIPPS MOBILEPAY, FILIAL AF VIPPS')), 'steen bendix');
  assert.equal(partyKeyOf(tx('x', -161, 'NETTO AALBORGVE Notanr 0530', 'Mike')), 'mike');
});
t('egne regler vinder', () => {
  const t1 = tx('2026-09-25', -220, 'MobilePay Steen Bendix Hald');
  assert.equal(categorize(t1, { [partyKeyOf(t1)]: 'kids' }), 'kids');
});
t('forbrug pr. kategori uden overførsler og indtægter', () => {
  const r = spendByCategory([tx('a', -100, 'Netto'), tx('b', -50, 'Rema 1000'), tx('c', 500, 'Løn'), tx('d', -300, 'x', '', 'k1'), tx('e', -80, 'Netflix')], {}, ['k1']);
  assert.deepEqual(r, [{ id: 'groceries', amount: 150 }, { id: 'subscriptions', amount: 80 }]);
});
t('månedsopsummering', () => {
  const s = monthSummary([{ id: 'groceries', amount: 4200 }, { id: 'eatout', amount: 300 }], [{ id: 'groceries', amount: 3600 }, { id: 'eatout', amount: 650 }, { id: 'travel', amount: 50 }]);
  assert.equal(s.total, 4500); assert.equal(s.top.id, 'groceries');
  assert.deepEqual(s.changes, [{ id: 'groceries', diff: 600 }, { id: 'eatout', diff: -350 }]);
});
t('abonnementer og prisstigning', () => {
  const txs = [
    tx('2026-06-03', -129, 'Netflix.com'), tx('2026-07-03', -129, 'Netflix.com'), tx('2026-08-03', -129, 'NETFLIX.COM 44'), tx('2026-09-03', -149, 'Netflix.com'),
    tx('2026-07-12', -99, 'Spotify'), tx('2026-08-12', -99, 'Spotify'), tx('2026-09-12', -99, 'Spotify'),
    tx('2026-08-01', -450, 'Netto'), tx('2026-08-14', -312, 'Netto'), tx('2026-09-20', -250, 'Netto'),   // flere i samme måned → ikke abonnement
    tx('2026-03-20', -1980, 'Tryg forsikring'), tx('2026-06-20', -1980, 'Tryg forsikring'), tx('2026-09-20', -1980, 'Tryg forsikring'),  // kvartal
  ];
  const r = recurring(txs, [], { today: new Date(2026, 9, 1) });
  const by = Object.fromEntries(r.map((x) => [x.key, x]));
  assert.ok(!by.netto, 'Netto er ikke et abonnement');
  assert.equal(by['netflix com'].change, 20); assert.equal(by['netflix com'].amount, 149); assert.equal(by['netflix com'].freq, 1);
  assert.equal(by.spotify.change, 0);
  assert.equal(by['tryg forsikring'].freq, 3); assert.equal(by['tryg forsikring'].monthly, 660);
});
console.log(`\n${n} kategori-tests bestået.`);
