// Kør med:  node tests/worker.test.mjs   (tester Worker'en med falsk KV + falsk Firestore)
import assert from 'node:assert/strict';
import worker from '../worker/budgetbasen-files.js';

// --- Falsk KV ---
const kv = new Map();
const FILES = {
  put: async (k, v, o) => kv.set(k, { v, m: o?.metadata }),
  getWithMetadata: async (k) => (kv.has(k) ? { value: kv.get(k).v, metadata: kv.get(k).m } : { value: null, metadata: null }),
  delete: async (k) => kv.delete(k),
  list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
};
const env = { FILES, FIREBASE_PROJECT_ID: 'proj', ALLOWED_ORIGINS: 'https://kronborg1980.github.io' };

// --- Falsk Firestore: budget B1 har ejer u1 (admin), u2 (read). u3 er ikke medlem → 403 ---
const members = { u1: 'admin', u2: 'read', u4: 'edit' };
const mails = [];
globalThis.fetch = async (url, opts) => {
  if (url.startsWith('https://api.emailjs.com')) { mails.push(JSON.parse(opts.body)); return new Response('OK', { status: 200 }); }
  if (url.includes('/invites/')) {
    return url.endsWith('/invites/B1_maria@example.com')
      ? new Response(JSON.stringify({ fields: { role: { stringValue: 'edit' }, budgetName: { stringValue: 'Familien' } } }), { status: 200 })
      : new Response('{}', { status: 404 });
  }
  const uid = JSON.parse(atob(opts.headers.Authorization.split('.')[1])).user_id;
  if (!url.includes('/budgets/B1?') || !members[uid]) return new Response('{}', { status: 403 });
  return new Response(JSON.stringify({ fields: {
    ownerUid: { stringValue: 'u1' },
    members: { mapValue: { fields: Object.fromEntries(Object.entries(members).map(([k, v]) => [k, { stringValue: v }])) } },
  } }), { status: 200 });
};
const tok = (uid, aud = 'proj', exp = Date.now() / 1000 + 3600) =>
  `x.${btoa(JSON.stringify({ user_id: uid, aud, exp })).replace(/=+$/, '')}.sig`;
const call = (method, path, uid, body, headers = {}) => worker.fetch(new Request(`https://w.dev${path}`, {
  method, body, headers: { Origin: 'https://kronborg1980.github.io', ...(uid ? { Authorization: `Bearer ${tok(uid)}` } : {}), ...headers },
}), env);

let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('✓', name); };

let key;
await t('admin kan uploade', async () => {
  const r = await call('POST', '/upload?budget=B1&folder=receipts&name=bon.jpg', 'u1', new Uint8Array([1, 2, 3]), { 'Content-Type': 'image/jpeg' });
  assert.equal(r.status, 201); key = (await r.json()).key;
  assert.match(key, /^B1\/receipts\//);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://kronborg1980.github.io');
});
await t('redaktør kan uploade PDF', async () => {
  const r = await call('POST', '/upload?budget=B1&folder=documents&name=a.pdf', 'u4', new Uint8Array([9]), { 'Content-Type': 'application/pdf' });
  assert.equal(r.status, 201);
});
await t('læser kan hente, men ikke uploade eller slette', async () => {
  const g = await call('GET', `/file?key=${encodeURIComponent(key)}`, 'u2');
  assert.equal(g.status, 200); assert.equal(g.headers.get('Content-Type'), 'image/jpeg');
  assert.deepEqual([...new Uint8Array(await g.arrayBuffer())], [1, 2, 3]);
  const u = await call('POST', '/upload?budget=B1&folder=receipts', 'u2', new Uint8Array([1]), { 'Content-Type': 'image/jpeg' });
  assert.equal(u.status, 403);
  const d = await call('DELETE', `/file?key=${encodeURIComponent(key)}`, 'u2');
  assert.equal(d.status, 403);
});
await t('ikke-medlem får 403 overalt', async () => {
  assert.equal((await call('GET', `/file?key=${encodeURIComponent(key)}`, 'u3')).status, 403);
  assert.equal((await call('POST', '/upload?budget=B1&folder=receipts', 'u3', new Uint8Array([1]), { 'Content-Type': 'image/jpeg' })).status, 403);
});
await t('uden login → 401, forkert projekt → 401, udløbet → 401', async () => {
  assert.equal((await call('GET', `/file?key=${encodeURIComponent(key)}`, null)).status, 401);
  const bad = (t2) => worker.fetch(new Request(`https://w.dev/file?key=${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${t2}`, Origin: 'https://kronborg1980.github.io' } }), env);
  assert.equal((await bad(tok('u1', 'andet'))).status, 401);
  assert.equal((await bad(tok('u1', 'proj', 1000))).status, 401);
});
await t('farlige filtyper og nøgler afvises', async () => {
  assert.equal((await call('POST', '/upload?budget=B1&folder=receipts', 'u1', new Uint8Array([1]), { 'Content-Type': 'text/html' })).status, 415);
  assert.equal((await call('POST', '/upload?budget=B1&folder=../x', 'u1', new Uint8Array([1]), { 'Content-Type': 'image/jpeg' })).status, 400);
  assert.equal((await call('GET', '/file?key=B1/../../x', 'u1')).status, 400);
});
await t('fremmed oprindelse afvises', async () => {
  const r = await worker.fetch(new Request('https://w.dev/health', { headers: { Origin: 'https://evil.example' } }), env);
  assert.equal(r.status, 403);
});
await t('redaktør kan ikke slette hele budgettet; ejer kan', async () => {
  assert.equal((await call('DELETE', '/budget?budget=B1', 'u4')).status, 403);
  const r = await call('DELETE', '/budget?budget=B1', 'u1');
  assert.equal(r.status, 200); assert.equal((await r.json()).deleted, 2); assert.equal(kv.size, 0);
});
await t('invitationsmail: kun admin, kun til rigtige invitationer, link kun til egne sider', async () => {
  const env2 = { ...env, EMAILJS_SERVICE_ID: 's', EMAILJS_TEMPLATE_ID: 't', EMAILJS_PUBLIC_KEY: 'p', EMAILJS_PRIVATE_KEY: 'k' };
  const inv = (uid, email, appUrl = 'https://kronborg1980.github.io/BudgetBasen/') => worker.fetch(new Request('https://w.dev/invite', {
    method: 'POST', body: JSON.stringify({ budget: 'B1', email, appUrl }),
    headers: { Origin: 'https://kronborg1980.github.io', Authorization: `Bearer ${tok(uid)}`, 'Content-Type': 'application/json' },
  }), env2);
  assert.equal((await inv('u4', 'maria@example.com')).status, 403, 'redaktør må ikke');
  assert.equal((await inv('u1', 'fremmed@example.com')).status, 404, 'ingen invitation');
  const ok = await inv('u1', 'Maria@Example.com');
  assert.equal(ok.status, 200);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].template_params.to_email, 'maria@example.com');
  assert.equal(mails[0].template_params.budget_name, 'Familien');
  await inv('u1', 'maria@example.com', 'https://evil.example/phish');
  assert.ok(!mails[1].template_params.app_url.includes('evil') && mails[1].template_params.app_url.startsWith('https://kronborg1980.github.io'), 'fremmed link erstattes');
  const noMail = await worker.fetch(new Request('https://w.dev/invite', { method: 'POST', body: '{}', headers: { Origin: 'https://kronborg1980.github.io', Authorization: `Bearer ${tok('u1')}` } }), env);
  assert.equal(noMail.status, 501, 'uden EmailJS-opsætning');
});
console.log(`\n${n} worker-tests bestået.`);
