// Kør med:  node tests/bank.test.mjs   (tester bank-delen af Worker'en med falsk KV, falsk Google og falsk Enable Banking)
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, createVerify } from 'node:crypto';
import worker from '../worker/budgetbasen-files.js';

// --- Falsk KV (med metadata) ---
const kv = new Map();
const FILES = {
  put: async (k, v, o) => kv.set(k, { v, m: o?.metadata }),
  get: async (k) => (kv.has(k) ? kv.get(k).v : null),
  getWithMetadata: async (k) => (kv.has(k) ? { value: kv.get(k).v, metadata: kv.get(k).m } : { value: null, metadata: null }),
  delete: async (k) => kv.delete(k),
  list: async ({ prefix }) => ({ keys: [...kv.entries()].filter(([k]) => k.startsWith(prefix)).map(([name, x]) => ({ name, metadata: x.m })), list_complete: true }),
};
const env = { FILES, FIREBASE_PROJECT_ID: 'proj', ALLOWED_ORIGINS: 'https://muhre93.github.io', BANK_SECRET: 'x'.repeat(40) };

// --- Falske Google-login-nøgler ---
const google = generateKeyPairSync('rsa', { modulusLength: 2048 });
const gjwk = { ...google.publicKey.export({ format: 'jwk' }), kid: 'g1', alg: 'RS256', use: 'sig' };
const b64u = (b) => Buffer.from(b).toString('base64url');
function idToken(uid, extra = {}, key = google.privateKey) {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'g1', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const p = b64u(JSON.stringify({ iss: 'https://securetoken.google.com/proj', aud: 'proj', sub: uid, user_id: uid, iat: now, exp: now + 3600, email: `${uid}@example.com`, email_verified: true, ...extra }));
  const s = createSign('RSA-SHA256').update(`${h}.${p}`).sign(key);
  return `${h}.${p}.${b64u(s)}`;
}

// --- Falsk Enable Banking ---
const app = generateKeyPairSync('rsa', { modulusLength: 2048 });
const APP_ID = '11111111-2222-3333-4444-555555555555';
const PEM8 = app.privateKey.export({ type: 'pkcs8', format: 'pem' });
const PEM1 = app.privateKey.export({ type: 'pkcs1', format: 'pem' });
const calls = [];
const TX = [
  { entry_reference: 'r1', transaction_amount: { amount: '21963.00', currency: 'DKK' }, credit_debit_indicator: 'DBIT', booking_date: '2026-09-15', creditor: { name: 'Totalkredit' }, remittance_information: ['Totalkredit termin'] },
  { entry_reference: 'r2', transaction_amount: { amount: '23000.00', currency: 'DKK' }, credit_debit_indicator: 'CRDT', booking_date: '2026-09-30', debtor: { name: 'Lasse' }, debtor_account: { iban: 'DK5000400440116243' } },
  // Sparekasse-stil: ingen ind/ud-markering, minus foran beløbet, og kontoen selv står som "debtor"
  { entry_reference: 'r3', transaction_amount: { amount: '-161.00', currency: 'DKK' }, booking_date: '2026-09-21', creditor: { name: 'NETTO AALBORGVEJ' }, debtor: { name: 'Mike' }, debtor_account: { iban: 'DK12 3456 7890 1234 56' } },
  { entry_reference: 'r4', transaction_amount: { amount: '100.00', currency: 'DKK' }, booking_date: '2026-09-28', debtor: { name: 'Kirsten' }, creditor_account: { iban: 'DK12 3456 7890 1234 56' } },
];
globalThis.fetch = async (url, opts = {}) => {
  if (url.startsWith('https://www.googleapis.com/')) return new Response(JSON.stringify({ keys: [gjwk] }), { status: 200, headers: { 'Cache-Control': 'max-age=600' } });
  if (!url.startsWith('https://api.enablebanking.com')) throw new Error('uventet fetch ' + url);
  const jwt = (opts.headers?.Authorization || '').replace('Bearer ', '');
  const [h, p, s] = jwt.split('.');
  const hdr = JSON.parse(Buffer.from(h, 'base64url'));
  const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(app.publicKey, Buffer.from(s, 'base64url'));
  const body = JSON.parse(Buffer.from(p, 'base64url'));
  if (!ok || hdr.kid !== APP_ID || body.aud !== 'api.enablebanking.com' || body.iss !== 'enablebanking.com') return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 });
  const path = url.slice('https://api.enablebanking.com'.length);
  calls.push(`${opts.method} ${path}`);
  const J = (d, st = 200) => new Response(JSON.stringify(d), { status: st });
  if (path === '/application') return J({ name: 'BudgetBasen', environment: 'PRODUCTION', redirect_urls: ['https://muhre93.github.io/budgetbasen/'], active: true });
  if (path.startsWith('/aspsps')) return J({ aspsps: [{ name: 'Sparekassen Sjælland-Fyn', country: 'DK', maximum_consent_validity: 15552000, logo: 'x' }, { name: 'Danske Bank', country: 'DK', maximum_consent_validity: 7776000 }] });
  if (path === '/auth') { const b = JSON.parse(opts.body); return J({ url: `https://bank.example/login?state=${b.state}&r=${encodeURIComponent(b.redirect_url)}&vu=${b.access.valid_until}`, authorization_id: 'a1' }); }
  if (path === '/sessions') return J({ session_id: 'S1', aspsp: { name: 'Sparekassen Sjælland-Fyn', country: 'DK' }, access: { valid_until: '2027-03-30T00:00:00Z' }, accounts: [
    { uid: 'acc-1', account_id: { iban: 'DK12 3456 7890 1234 56' }, name: 'Budgetkonto', currency: 'DKK' },
    { uid: 'acc-2', account_id: { other: { identification: '9070-1234567' } }, name: 'Lønkonto', currency: 'DKK' },
  ] });
  if (path === '/accounts/acc-1/balances') return J({ balances: [{ balance_type: 'ITAV', balance_amount: { amount: '6500.00', currency: 'DKK' } }, { balance_type: 'ITBD', balance_amount: { amount: '6000.00', currency: 'DKK' }, reference_date: '2026-10-01' }] });
  if (path.startsWith('/accounts/acc-1/transactions')) {
    return path.includes('continuation_key=k2') ? J({ transactions: [TX[1], TX[2], TX[3]] }) : J({ transactions: [TX[0]], continuation_key: 'k2' });
  }
  if (path.startsWith('/accounts/acc-2/')) return J({ message: 'Session expired' }, 401);
  if (path.startsWith('/sessions/') && opts.method === 'DELETE') return J({});
  return J({ message: 'ukendt ' + path }, 404);
};

const call = (method, path, token, body) => worker.fetch(new Request(`https://w.dev${path}`, {
  method, body: body ? JSON.stringify(body) : undefined,
  headers: { Origin: 'https://muhre93.github.io', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
}), env);
const j = async (r) => ({ status: r.status, ...(await r.json()) });

let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('✓', name); };
const L = idToken('lasse');

await t('falsk login (forkert signatur) afvises', async () => {
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const r = await j(await call('GET', '/bank/status', idToken('lasse', {}, other.privateKey)));
  assert.equal(r.status, 401);
  const r2 = await j(await call('GET', '/bank/status', idToken('lasse', { aud: 'andet' })));
  assert.equal(r2.status, 401);
});
await t('status før opsætning', async () => {
  const r = await j(await call('GET', '/bank/status', L));
  assert.equal(r.status, 200); assert.equal(r.workerReady, true); assert.equal(r.configured, false);
});
await t('uden BANK_SECRET: workerReady=false og 501', async () => {
  const e2 = { ...env, BANK_SECRET: '' };
  const r = await worker.fetch(new Request('https://w.dev/bank/status', { headers: { Origin: 'https://muhre93.github.io', Authorization: `Bearer ${L}` } }), e2);
  assert.equal((await r.json()).workerReady, false);
  const r2 = await worker.fetch(new Request('https://w.dev/bank/aspsps', { headers: { Origin: 'https://muhre93.github.io', Authorization: `Bearer ${L}` } }), e2);
  assert.equal(r2.status, 501);
});
await t('forkert nøgle afvises med dansk besked', async () => {
  const bad = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const r = await j(await call('POST', '/bank/config', L, { appId: APP_ID, pem: bad }));
  assert.equal(r.status, 400); assert.match(r.error, /afviste nøglen/);
});
await t('gem nøgle (PKCS#1-format virker også) — krypteret i KV', async () => {
  const r = await j(await call('POST', '/bank/config', L, { appId: APP_ID, pem: PEM1 }));
  assert.equal(r.status, 200); assert.equal(r.appName, 'BudgetBasen');
  const stored = kv.get('bank:cfg:lasse');
  assert.ok(!stored.v.includes('PRIVATE KEY') && !stored.v.includes(APP_ID), 'nøglen må ikke ligge i klartekst');
  assert.equal(stored.m.email, 'lasse@example.com');
  const r2 = await j(await call('POST', '/bank/config', L, { appId: APP_ID, pem: PEM8 }));
  assert.equal(r2.status, 200);
});
await t('bankliste', async () => {
  const r = await j(await call('GET', '/bank/aspsps?country=DK', L));
  assert.deepEqual(r.banks.map((b) => b.name), ['Danske Bank', 'Sparekassen Sjælland-Fyn']);
  assert.equal(r.banks[1].maxDays, 180);
});
let state;
await t('connect: kun egen app-adresse, maks. 180 dage', async () => {
  const bad = await j(await call('POST', '/bank/connect', L, { bank: 'Danske Bank', country: 'DK', redirectUrl: 'https://evil.example/' }));
  assert.equal(bad.status, 400);
  const r = await j(await call('POST', '/bank/connect', L, { bank: 'Danske Bank', country: 'DK', redirectUrl: 'https://muhre93.github.io/budgetbasen/index.html' }));
  assert.equal(r.status, 200); assert.equal(r.days, 90);
  const u = new URL(r.url);
  assert.equal(u.searchParams.get('r'), 'https://muhre93.github.io/budgetbasen/');
  state = u.searchParams.get('state');
});
await t('callback: anden bruger kan ikke bruge state', async () => {
  const B = idToken('bjork');
  await call('POST', '/bank/config', B, { appId: APP_ID, pem: PEM8 });
  const r = await j(await call('POST', '/bank/callback', B, { code: 'c', state }));
  assert.equal(r.status, 403);
});
let keys;
await t('callback: konti med hemmelig nøgle og maskeret nummer', async () => {
  const r = await j(await call('POST', '/bank/callback', L, { code: 'c', state }));
  assert.equal(r.status, 200); assert.equal(r.accounts.length, 2);
  assert.equal(r.accounts[0].masked, '•••• 3456');
  assert.equal(r.accounts[1].masked, '•••• 4567');
  assert.match(r.accounts[0].key, /^[0-9a-f]{24}$/);
  assert.ok(!('uid' in r.accounts[0]), 'Enable Banking-kontoens id sendes ikke til appen');
  keys = r.accounts.map((a) => a.key);
  assert.match(r.accounts[0].proof, /^[0-9a-f]{64}$/);
  globalThis.__proof = r.accounts[0].proof;
  const again = await j(await call('POST', '/bank/callback', L, { code: 'c', state }));
  assert.equal(again.status, 410, 'state kan kun bruges én gang');
});
await t('samme kontonummer giver samme nøgle hos din kone (fælles genkendes)', async () => {
  const B = idToken('bjork');
  const c = await j(await call('POST', '/bank/connect', B, { bank: 'Sparekassen Sjælland-Fyn', country: 'DK', redirectUrl: 'https://muhre93.github.io/budgetbasen/' }));
  const st = new URL(c.url).searchParams.get('state');
  const r = await j(await call('POST', '/bank/callback', B, { code: 'c', state: st }));
  assert.equal(r.accounts[0].key, keys[0]);
  assert.equal(r.accounts[0].proof, globalThis.__proof, 'samme bevis for samme konto (så partneren kan blive medejer)');
  assert.notEqual(r.accounts[0].proof.slice(0, 24), r.accounts[0].key, 'beviset kan ikke regnes ud fra nøglen');
});
await t('sync: saldo (bogført) + alle sider med posteringer', async () => {
  const r = await j(await call('POST', '/bank/sync', L, { key: keys[0], dateFrom: '2026-07-01' }));
  assert.equal(r.status, 200);
  assert.equal(r.balance.amount, 6000); assert.equal(r.balance.available, 6500);
  assert.equal(r.transactions.length, 4);
  assert.deepEqual(r.transactions.map((x) => x.amount), [-21963, 23000, -161, 100], 'minus foran beløbet = ud');
  assert.equal(r.transactions[2].party, 'NETTO AALBORGVEJ');
  assert.equal(r.transactions[2].partyKey, '', 'kontoen selv er ikke "en anden egen konto"');
  assert.equal(r.transactions[3].party, 'Kirsten');
  assert.equal(r.transactions[0].party, 'Totalkredit');
  assert.match(r.transactions[1].partyKey, /^[0-9a-f]{24}$/);
  assert.ok(!JSON.stringify(r).includes('DK5000400440116243'), 'modpartens kontonummer sendes ikke i klartekst');
});
await t('sync: udløbet adgang → 410 med besked om MitID', async () => {
  const r = await j(await call('POST', '/bank/sync', L, { key: keys[1] }));
  assert.equal(r.status, 410); assert.match(r.error, /MitID/);
});
await t('sync: andres konto afvises', async () => {
  const r = await j(await call('POST', '/bank/sync', idToken('fremmed'), { key: keys[0] }));
  assert.equal(r.status, 412);
});
await t('status viser forbindelser', async () => {
  const r = await j(await call('GET', '/bank/status', L));
  assert.equal(r.configured, true); assert.equal(r.sessions.length, 1); assert.equal(r.sessions[0].accounts.length, 2);
});
await t('ejer-oversigt kun for ejeren', async () => {
  const no = await j(await call('GET', '/bank/admin', L));
  assert.equal(no.status, 403);
  const owner = idToken('owner', { email: 'muhre93@gmail.com' });
  const r = await j(await call('GET', '/bank/admin', owner));
  assert.equal(r.status, 200);
  const lasse = r.users.find((u) => u.uid === 'lasse');
  assert.equal(lasse.cfg.app, 'BudgetBasen'); assert.equal(lasse.sess.accounts, 2);
  const unverified = await j(await call('GET', '/bank/admin', idToken('owner', { email: 'muhre93@gmail.com', email_verified: false })));
  assert.equal(unverified.status, 403);
});
await t('afbryd forbindelse og slet nøgle', async () => {
  const st = await j(await call('GET', '/bank/status', L));
  const d = await j(await call('DELETE', `/bank/session?id=${st.sessions[0].id}`, L));
  assert.equal(d.status, 200);
  assert.ok(calls.includes('DELETE /sessions/S1'));
  const del = await j(await call('DELETE', '/bank/config', L));
  assert.equal(del.status, 200);
  assert.ok(!kv.has('bank:cfg:lasse') && !kv.has('bank:sess:lasse'));
});

console.log(`\n${n} bank-tests bestået.`);
