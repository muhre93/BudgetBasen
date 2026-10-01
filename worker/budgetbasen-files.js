// =====================================================================
//  BudgetBasen — Cloudflare Worker til filer (kvitteringer & kontrakter)
//  Gemmer filerne i Workers KV (gratis på Cloudflare Free — intet betalingskort).
//
//  Sikkerhed: Worker'en har INGEN hemmelige nøgler. Ved hver forespørgsel
//  sender appen brugerens Firebase-login-token med. Worker'en slår budgettet
//  op i Firestore MED DET TOKEN — så Firestore Security Rules afgør, om
//  brugeren er medlem, og hvilken rolle hun har. Ikke-medlemmer får 403.
//
//  Opsætning (Cloudflare-dashboard, ingen terminal):
//   1. Storage & Databases → KV → Create namespace → navn: budgetbasen-files
//   2. Workers & Pages → Create → Worker → indsæt denne fil → Deploy
//   3. Worker → Settings → Bindings → Add → KV namespace
//        Variable name: FILES   ·  KV namespace: budgetbasen-files
//   4. Worker → Settings → Variables and Secrets → Add (type: Text):
//        FIREBASE_PROJECT_ID = dit Firebase-projekt-id (f.eks. budgetbasen-12345)
//        ALLOWED_ORIGINS     = https://kronborg1980.github.io
//      (flere oprindelser adskilles med komma)
//   5. (Valgfrit) Invitationsmails via EmailJS — se README. Tilføj som *Secret*:
//        EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY
//   6. (Valgfrit) Bankforbindelse via Enable Banking — tilføj som *Secret*:
//        BANK_SECRET  = en lang tilfældig tekst (mindst 32 tegn). Bruges til at kryptere
//                       brugernes Enable Banking-nøgler i KV. Skift den ALDRIG bagefter,
//                       så kan de gemte nøgler ikke længere læses.
//      Og som Text-variabel (valgfri):  OWNER_EMAIL = muhre93@gmail.com
// =====================================================================

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB pr. fil (KV tillader op til 25 MiB)
const ALLOWED_TYPES = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/;
const FOLDERS = ['receipts', 'documents'];
const READ_ROLES = ['admin', 'edit', 'read'];
const EDIT_ROLES = ['admin', 'edit'];

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (!env.FILES) throw new HttpError(500, 'KV-binding "FILES" mangler i Worker-indstillingerne');
      if (!env.FIREBASE_PROJECT_ID) throw new HttpError(500, 'Variablen FIREBASE_PROJECT_ID mangler');
      if (cors === null) throw new HttpError(403, 'Oprindelsen er ikke tilladt (tjek ALLOWED_ORIGINS)');

      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '');

      if (path === '' || path === '/health') return json({ ok: true, service: 'budgetbasen-files' }, 200, cors);

      // Upload: POST /upload?budget=ID&folder=receipts|documents&name=fil.jpg   (body = filens bytes)
      if (path === '/upload' && request.method === 'POST') {
        const bid = safeId(url.searchParams.get('budget'));
        const folder = url.searchParams.get('folder');
        if (!FOLDERS.includes(folder)) throw new HttpError(400, 'Ugyldig mappe');
        const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
        if (!ALLOWED_TYPES.test(contentType)) throw new HttpError(415, 'Kun billeder og PDF er tilladt');
        const declared = Number(request.headers.get('Content-Length') || 0);
        if (declared > MAX_BYTES) throw new HttpError(413, 'Filen er større end 10 MB');

        const auth = await authorize(request, env, bid, EDIT_ROLES);
        const body = await request.arrayBuffer();
        if (!body.byteLength) throw new HttpError(400, 'Tom fil');
        if (body.byteLength > MAX_BYTES) throw new HttpError(413, 'Filen er større end 10 MB');

        const name = (url.searchParams.get('name') || 'fil').slice(0, 120);
        const key = `${bid}/${folder}/${Date.now()}-${crypto.randomUUID()}`;
        await env.FILES.put(key, body, {
          metadata: { contentType, name, size: body.byteLength, uid: auth.uid, created: new Date().toISOString() },
        });
        return json({ key, size: body.byteLength, contentType }, 201, cors);
      }

      // Hent: GET /file?key=...
      if (path === '/file' && request.method === 'GET') {
        const key = safeKey(url.searchParams.get('key'));
        await authorize(request, env, key.split('/')[0], READ_ROLES);
        const { value, metadata } = await env.FILES.getWithMetadata(key, { type: 'arrayBuffer' });
        if (!value) throw new HttpError(404, 'Filen findes ikke');
        return new Response(value, {
          headers: {
            ...cors,
            'Content-Type': metadata?.contentType || 'application/octet-stream',
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(metadata?.name || 'fil')}`,
            'Cache-Control': 'private, max-age=3600',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }

      // Slet én fil: DELETE /file?key=...
      if (path === '/file' && request.method === 'DELETE') {
        const key = safeKey(url.searchParams.get('key'));
        await authorize(request, env, key.split('/')[0], EDIT_ROLES);
        await env.FILES.delete(key);
        return json({ deleted: key }, 200, cors);
      }

      // Slet ALLE filer i et budget (når ejeren sletter budgettet): DELETE /budget?budget=ID
      if (path === '/budget' && request.method === 'DELETE') {
        const bid = safeId(url.searchParams.get('budget'));
        const auth = await authorize(request, env, bid, ['admin']);
        if (!auth.isOwner) throw new HttpError(403, 'Kun ejeren kan slette alle filer');
        let cursor, count = 0;
        do {
          const page = await env.FILES.list({ prefix: `${bid}/`, cursor });
          await Promise.all(page.keys.map((k) => env.FILES.delete(k.name)));
          count += page.keys.length;
          cursor = page.list_complete ? null : page.cursor;
        } while (cursor);
        return json({ deleted: count }, 200, cors);
      }

      // Invitationsmail: POST /invite  { budget, email, appUrl }  — kun admins af budgettet
      if (path === '/invite' && request.method === 'POST') {
        if (!env.EMAILJS_SERVICE_ID || !env.EMAILJS_TEMPLATE_ID || !env.EMAILJS_PUBLIC_KEY) throw new HttpError(501, 'Invitationsmail er ikke sat op');
        const body = await request.json().catch(() => ({}));
        const bid = safeId(body.budget);
        const email = String(body.email || '').trim().toLowerCase();
        if (!/^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(email) || email.length > 120) throw new HttpError(400, 'Ugyldig e-mail');
        const auth = await authorize(request, env, bid, ['admin']);
        // Der skal findes en rigtig invitation (kun admins kan oprette dem) → ingen spam via Worker'en
        const inv = await firestoreGet(env, auth.token, `invites/${bid}_${email}`);
        if (!inv) throw new HttpError(404, 'Invitationen findes ikke');
        const appUrl = allowedAppUrl(body.appUrl, env);
        const role = inv.fields?.role?.stringValue || 'read';
        const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            service_id: env.EMAILJS_SERVICE_ID,
            template_id: env.EMAILJS_TEMPLATE_ID,
            user_id: env.EMAILJS_PUBLIC_KEY,
            accessToken: env.EMAILJS_PRIVATE_KEY || undefined,
            template_params: {
              to_email: email,
              inviter_name: auth.name || 'Et familiemedlem',
              reply_to: auth.email || '',
              budget_name: inv.fields?.budgetName?.stringValue || 'et budget',
              role_text: { admin: 'administrator', edit: 'redaktør (kan tilføje og rette)', read: 'læser (kan se)' }[role] || role,
              app_url: appUrl,
            },
          }),
        });
        if (!res.ok) throw new HttpError(502, `Mailen kunne ikke sendes (${res.status}): ${(await res.text()).slice(0, 120)}`);
        return json({ sent: true }, 200, cors);
      }

      if (path.startsWith('/bank/')) return json(await bankRoute(path, request, env, url), 200, cors);

      throw new HttpError(404, 'Ukendt endpoint');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return json({ error: e.message || 'Serverfejl' }, status, cors || {});
    }
  },
};

// ---------- Adgangskontrol ----------
/**
 * Slår budgettet op i Firestore med brugerens eget token.
 * Firestore-reglerne afviser ikke-medlemmer (403) — og selv hvis de ikke gjorde,
 * tjekker vi rollen i members-mappet her.
 */
async function authorize(request, env, budgetId, allowedRoles) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Ikke logget ind');
  const claims = decodeJwt(token);
  if (claims.aud !== env.FIREBASE_PROJECT_ID) throw new HttpError(401, 'Token tilhører et andet projekt');
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new HttpError(401, 'Login er udløbet — genindlæs siden');
  const uid = claims.user_id || claims.sub;

  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/budgets/${budgetId}?mask.fieldPaths=members&mask.fieldPaths=ownerUid`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 401) throw new HttpError(401, 'Ugyldigt login');
  if (res.status === 403 || res.status === 404) throw new HttpError(403, 'Du har ikke adgang til dette budget');
  if (!res.ok) throw new HttpError(502, `Firestore svarede ${res.status}`);
  // Firestore har nu verificeret tokenets signatur — derfor kan vi stole på uid fra det.
  const doc = await res.json();
  const role = doc.fields?.members?.mapValue?.fields?.[uid]?.stringValue || '';
  if (!allowedRoles.includes(role)) throw new HttpError(403, 'Din rolle giver ikke adgang til dette');
  return { uid, role, isOwner: doc.fields?.ownerUid?.stringValue === uid, token, name: claims.name || '', email: claims.email || '' };
}

function decodeJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Ugyldigt token');
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(pad), (c) => c.charCodeAt(0))));
  } catch {
    throw new HttpError(401, 'Ugyldigt token');
  }
}

async function firestoreGet(env, token, path) {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new HttpError(502, `Firestore svarede ${res.status}`);
  return res.json();
}
/** Linket i mailen må kun pege på en af jeres egne adresser. */
function allowedAppUrl(url, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
  try {
    const u = new URL(url);
    if (allowed.includes(u.origin)) return u.origin + u.pathname;
  } catch { /* ugyldig */ }
  return allowed[0] || '';
}

// ---------- Hjælpere ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function safeId(v) {
  if (!v || !/^[A-Za-z0-9_-]{1,64}$/.test(v)) throw new HttpError(400, 'Ugyldigt budget-id');
  return v;
}
function safeKey(v) {
  if (!v || !/^[A-Za-z0-9_-]{1,64}\/(receipts|documents)\/[0-9]+-[0-9a-f-]{36}$/.test(v)) throw new HttpError(400, 'Ugyldig filnøgle');
  return v;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (origin && !allowed.includes(origin) && !isLocal) return null;
  return {
    'Access-Control-Allow-Origin': origin || allowed[0] || '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
}

// =====================================================================
//  BANK — Enable Banking (kun læseadgang: saldo og posteringer)
//  Hver bruger har sin EGEN Enable Banking-app (gratis "restricted mode")
//  og uploader sin nøglefil (.pem) + App-ID. Nøglen gemmes krypteret i KV
//  med BANK_SECRET og forlader aldrig Worker'en igen.
//  Appen kan ALDRIG flytte penge — vi bruger kun konto-informations-API'et.
// =====================================================================
const EB_API = 'https://api.enablebanking.com';
const GOOGLE_JWK = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const MAX_CONSENT_DAYS = 180;

async function bankRoute(path, request, env, url) {
  const user = await verifyUser(request, env);
  const ready = !!(env.BANK_SECRET && String(env.BANK_SECRET).length >= 32);
  const method = request.method;

  if (path === '/bank/status' && method === 'GET') {
    if (!ready) return { workerReady: false, configured: false, sessions: [] };
    const cfg = await loadCfg(env, user.uid);
    const sess = await loadSessions(env, user.uid);
    return {
      workerReady: true,
      configured: !!cfg,
      appName: cfg?.appName || '', environment: cfg?.environment || '', redirectUrls: cfg?.redirectUrls || [], active: cfg?.active ?? null,
      sessions: sess.map((s) => ({ id: s.id, bank: s.aspsp.name, country: s.aspsp.country, validUntil: s.validUntil, accounts: s.accounts.map((a) => ({ key: a.key, name: a.name, masked: a.masked })) })),
    };
  }
  if (!ready) throw new HttpError(501, 'Bankforbindelse er ikke slået til i Worker’en endnu (BANK_SECRET mangler)');

  // Gem/udskift brugerens Enable Banking-nøgle: POST /bank/config { appId, pem }
  if (path === '/bank/config' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const appId = String(body.appId || '').trim();
    const pem = String(body.pem || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(appId)) throw new HttpError(400, 'App-ID skal se ud som en lang kode med bindestreger (fx 1a2b3c4d-…)');
    if (!/-----BEGIN (RSA )?PRIVATE KEY-----/.test(pem) || pem.length > 8000) throw new HttpError(400, 'Det ligner ikke en nøglefil (.pem). Upload filen du fik, da du oprettede appen.');
    const cfg = { appId, pem };
    let app;
    try { app = await eb(cfg, 'GET', '/application'); } catch (e) {
      if (e.status === 401 || e.status === 403) throw new HttpError(400, 'Enable Banking afviste nøglen. Tjek at App-ID og nøglefil hører til den samme app.');
      throw e;
    }
    const saved = { ...cfg, appName: app.name || '', environment: app.environment || '', redirectUrls: app.redirect_urls || [], active: app.active ?? null, savedAt: new Date().toISOString() };
    await env.FILES.put(`bank:cfg:${user.uid}`, await encrypt(env, saved), {
      metadata: { email: user.email, name: user.name, app: saved.appName, env: saved.environment, at: saved.savedAt },
    });
    return { saved: true, appName: saved.appName, environment: saved.environment, redirectUrls: saved.redirectUrls, active: saved.active };
  }

  // Slet nøgle + alle bankforbindelser: DELETE /bank/config
  if (path === '/bank/config' && method === 'DELETE') {
    const cfg = await loadCfg(env, user.uid);
    if (cfg) for (const s of await loadSessions(env, user.uid)) await eb(cfg, 'DELETE', `/sessions/${encodeURIComponent(s.id)}`).catch(() => {});
    await env.FILES.delete(`bank:cfg:${user.uid}`);
    await env.FILES.delete(`bank:sess:${user.uid}`);
    return { deleted: true };
  }

  const cfg = await loadCfg(env, user.uid);
  if (!cfg && path !== '/bank/admin') throw new HttpError(412, 'Du har ikke sat din Enable Banking-nøgle ind endnu');

  // Liste over banker: GET /bank/aspsps?country=DK
  if (path === '/bank/aspsps' && method === 'GET') {
    const country = (url.searchParams.get('country') || 'DK').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new HttpError(400, 'Ugyldigt land');
    const r = await eb(cfg, 'GET', `/aspsps?country=${country}&psu_type=personal&service=AIS`);
    return {
      banks: (r.aspsps || []).map((a) => ({ name: a.name, country: a.country, logo: a.logo || '', maxDays: Math.floor((a.maximum_consent_validity || 0) / 86400) || null, beta: !!a.beta }))
        .sort((a, b) => a.name.localeCompare(b.name, 'da')),
    };
  }

  // Start MitID-login hos banken: POST /bank/connect { bank, country, redirectUrl }
  if (path === '/bank/connect' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const name = String(body.bank || '').slice(0, 120);
    const country = String(body.country || 'DK').toUpperCase();
    if (!name || !/^[A-Z]{2}$/.test(country)) throw new HttpError(400, 'Vælg en bank');
    const redirectUrl = appRedirectUrl(body.redirectUrl, env);
    const list = await eb(cfg, 'GET', `/aspsps?country=${country}&psu_type=personal&service=AIS`);
    const aspsp = (list.aspsps || []).find((a) => a.name === name);
    if (!aspsp) throw new HttpError(404, 'Banken findes ikke på listen');
    const days = Math.min(MAX_CONSENT_DAYS, Math.floor((aspsp.maximum_consent_validity || MAX_CONSENT_DAYS * 86400) / 86400));
    const state = crypto.randomUUID();
    await env.FILES.put(`bank:state:${state}`, JSON.stringify({ uid: user.uid, bank: name, country, at: Date.now() }), { expirationTtl: 1800 });
    const r = await eb(cfg, 'POST', '/auth', {
      access: { valid_until: new Date(Date.now() + days * 86400e3).toISOString() },
      aspsp: { name, country }, state, redirect_url: redirectUrl, psu_type: 'personal', language: 'da',
    });
    return { url: r.url, days };
  }

  // Tilbage fra banken: POST /bank/callback { code, state }
  if (path === '/bank/callback' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const state = String(body.state || '');
    if (!/^[0-9a-f-]{36}$/.test(state)) throw new HttpError(400, 'Ugyldigt svar fra banken');
    const st = await env.FILES.get(`bank:state:${state}`);
    if (!st) throw new HttpError(410, 'Login hos banken tog for lang tid — prøv igen');
    const info = JSON.parse(st);
    if (info.uid !== user.uid) throw new HttpError(403, 'Svaret fra banken hører til en anden bruger');
    await env.FILES.delete(`bank:state:${state}`);
    const r = await eb(cfg, 'POST', '/sessions', { code: String(body.code || '') });
    const accounts = [];
    for (const a of r.accounts || []) {
      const num = accountNumber(a);
      const ident = num || a.identification_hash || a.uid;
      accounts.push({
        uid: a.uid, key: await accountKey(env, ident),
        // Bevis for at man selv har koblet kontoen på (bruges når en partner bliver medejer af en fælleskonto)
        proof: await hmacHex(env, 'join', ident, 32),
        name: a.name || a.details || a.product || 'Konto', masked: mask(num), currency: a.currency || 'DKK',
      });
    }
    const all = await loadSessions(env, user.uid);
    const replaced = (s) => s.aspsp.name === r.aspsp?.name && s.accounts.every((a) => accounts.some((b) => b.key === a.key));
    for (const s of all.filter(replaced)) if (s.id !== r.session_id) await eb(cfg, 'DELETE', `/sessions/${encodeURIComponent(s.id)}`).catch(() => {});
    const sess = all.filter((s) => !replaced(s));
    const rec = { id: r.session_id, aspsp: r.aspsp || { name: info.bank, country: info.country }, validUntil: r.access?.valid_until || null, created: new Date().toISOString(), accounts: accounts.map(({ proof, ...a }) => a) };
    sess.push(rec);
    await saveSessions(env, user, sess);
    return { bank: rec.aspsp.name, validUntil: rec.validUntil, sessionId: rec.id, accounts: accounts.map(({ uid, ...a }) => a) };
  }

  // Hent saldo + posteringer for én konto: POST /bank/sync { key, dateFrom }
  if (path === '/bank/sync' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const key = String(body.key || '');
    const sess = await loadSessions(env, user.uid);
    const hit = sess.filter((s) => s.accounts.some((a) => a.key === key)).sort((a, b) => String(b.validUntil).localeCompare(String(a.validUntil)))[0];
    if (!hit) throw new HttpError(404, 'Du har ikke koblet denne konto på');
    if (hit.validUntil && new Date(hit.validUntil) < new Date()) throw new HttpError(410, `Adgangen til ${hit.aspsp.name} er udløbet — log ind med MitID igen`);
    const acc = hit.accounts.find((a) => a.key === key);
    const minFrom = new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10);
    let from = /^\d{4}-\d{2}-\d{2}$/.test(body.dateFrom || '') ? body.dateFrom : new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    if (from < minFrom) from = minFrom;
    let balances;
    try { balances = await eb(cfg, 'GET', `/accounts/${encodeURIComponent(acc.uid)}/balances`); } catch (e) { throw expired(e, hit); }
    const txs = [];
    let ck = null, pages = 0;
    do {
      const q = `date_from=${from}${ck ? `&continuation_key=${encodeURIComponent(ck)}` : ''}`;
      let r;
      try { r = await eb(cfg, 'GET', `/accounts/${encodeURIComponent(acc.uid)}/transactions?${q}`); } catch (e) { throw expired(e, hit); }
      for (const t of r.transactions || []) txs.push(await normalizeTx(env, t));
      ck = r.continuation_key || null;
    } while (ck && ++pages < 25);
    return { key, bank: hit.aspsp.name, validUntil: hit.validUntil, balance: pickBalance(balances.balances || []), transactions: txs, from };
  }

  // Afbryd én bankforbindelse: DELETE /bank/session?id=...
  if (path === '/bank/session' && method === 'DELETE') {
    const id = String(url.searchParams.get('id') || '');
    const sess = await loadSessions(env, user.uid);
    if (!sess.some((s) => s.id === id)) throw new HttpError(404, 'Forbindelsen findes ikke');
    await eb(cfg, 'DELETE', `/sessions/${encodeURIComponent(id)}`).catch(() => {});
    await saveSessions(env, user, sess.filter((s) => s.id !== id));
    return { deleted: true };
  }

  // Ejer-oversigt (kun app-ejeren): GET /bank/admin
  if (path === '/bank/admin' && method === 'GET') {
    const owner = String(env.OWNER_EMAIL || 'muhre93@gmail.com').toLowerCase();
    if (!user.emailVerified || user.email !== owner) throw new HttpError(403, 'Kun app-ejeren kan se dette');
    const out = {};
    for (const prefix of ['bank:cfg:', 'bank:sess:']) {
      let cursor;
      do {
        const page = await env.FILES.list({ prefix, cursor });
        for (const k of page.keys) {
          const uid = k.name.slice(prefix.length);
          out[uid] = { uid, ...(out[uid] || {}), [prefix === 'bank:cfg:' ? 'cfg' : 'sess']: k.metadata || {} };
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
    }
    return { users: Object.values(out) };
  }

  throw new HttpError(404, 'Ukendt bank-endpoint');
}

function expired(e, s) {
  if ([401, 403, 410].includes(e.status) || /expired|revoked|EXPIRED_SESSION|session.*(closed|invalid)/i.test(e.message)) {
    return new HttpError(410, `Adgangen til ${s.aspsp.name} er udløbet eller lukket — log ind med MitID igen`);
  }
  return e;
}

// ---------- Firebase-login: tjek signaturen mod Googles offentlige nøgler ----------
let jwkCache = { keys: null, exp: 0 };
async function verifyUser(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Ikke logget ind');
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Ugyldigt token');
  let header, claims;
  try { header = JSON.parse(b64urlText(parts[0])); claims = JSON.parse(b64urlText(parts[1])); } catch { throw new HttpError(401, 'Ugyldigt token'); }
  const now = Date.now() / 1000;
  if (header.alg !== 'RS256') throw new HttpError(401, 'Ugyldigt token');
  if (claims.aud !== env.FIREBASE_PROJECT_ID || claims.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`) throw new HttpError(401, 'Token tilhører et andet projekt');
  if (!claims.exp || claims.exp < now) throw new HttpError(401, 'Login er udløbet — genindlæs siden');
  if (!claims.sub || (claims.iat && claims.iat > now + 300)) throw new HttpError(401, 'Ugyldigt token');
  if (!jwkCache.keys || jwkCache.exp < Date.now()) {
    const r = await fetch(GOOGLE_JWK);
    if (!r.ok) throw new HttpError(502, 'Kunne ikke hente Googles login-nøgler');
    const maxAge = Number((r.headers.get('Cache-Control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
    jwkCache = { keys: (await r.json()).keys || [], exp: Date.now() + maxAge * 1000 };
  }
  const jwk = jwkCache.keys.find((k) => k.kid === header.kid);
  if (!jwk) { jwkCache.exp = 0; throw new HttpError(401, 'Ukendt login-nøgle — genindlæs siden'); }
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new HttpError(401, 'Ugyldigt login');
  return { uid: claims.sub, email: String(claims.email || '').toLowerCase(), emailVerified: claims.email_verified === true, name: claims.name || '' };
}

// ---------- Enable Banking-kald ----------
async function eb(cfg, method, path, body) {
  const jwt = await ebJwt(cfg);
  const res = await fetch(EB_API + path, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 200) }; }
  if (!res.ok) {
    const msg = data.message || data.detail || data.error || `Enable Banking svarede ${res.status}`;
    throw new HttpError(res.status === 429 ? 429 : res.status >= 500 ? 502 : res.status, `Banken/Enable Banking: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return data;
}
async function ebJwt(cfg) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: cfg.appId }));
  const p = b64url(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 }));
  let key;
  try { key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(cfg.pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']); } catch { throw new HttpError(400, 'Nøglefilen kunne ikke læses'); }
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}
/** PEM → PKCS#8 DER. "BEGIN RSA PRIVATE KEY" (PKCS#1) pakkes ind i PKCS#8. */
function pemToPkcs8(pem) {
  const isPkcs1 = /BEGIN RSA PRIVATE KEY/.test(pem);
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  if (!isPkcs1) return der;
  const len = (n) => (n < 128 ? [n] : n < 256 ? [0x81, n] : n < 65536 ? [0x82, n >> 8, n & 255] : [0x83, n >> 16, (n >> 8) & 255, n & 255]);
  const algId = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...len(der.length), ...der];
  const inner = [0x02, 0x01, 0x00, ...algId, ...octet];
  return new Uint8Array([0x30, ...len(inner.length), ...inner]);
}

// ---------- Data ----------
function accountNumber(a) {
  const id = a.account_id || {};
  return String(id.iban || id.other?.identification || a.all_account_ids?.[0]?.identification || '').replace(/\s+/g, '').toUpperCase();
}
function mask(num) { return num ? `•••• ${num.slice(-4)}` : ''; }
async function hmacHex(env, label, text, bytes) {
  const k = await crypto.subtle.importKey('raw', await sha256(`${env.BANK_SECRET}:${label}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(String(text).replace(/\s+/g, '').toUpperCase())));
  return [...sig.slice(0, bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const accountKey = (env, num) => hmacHex(env, 'acct', num, 12);
async function normalizeTx(env, t) {
  const debit = t.credit_debit_indicator === 'DBDT';
  const amt = Math.abs(Number(t.transaction_amount?.amount || 0));
  const party = debit ? t.creditor : t.debtor;
  const partyAcc = debit ? t.creditor_account : t.debtor_account;
  const partyNum = String(partyAcc?.iban || partyAcc?.other?.identification || '').replace(/\s+/g, '');
  const text = [...(t.remittance_information || [])].join(' ').replace(/\s+/g, ' ').trim();
  const date = t.booking_date || t.value_date || t.transaction_date || '';
  const base = t.entry_reference || t.transaction_id || '';
  const id = base ? String(base).slice(0, 60) : (await accountKey(env, `${date}|${amt}|${debit}|${text}|${party?.name || ''}`)).slice(0, 20);
  return {
    id, date, amount: Math.round((debit ? -amt : amt) * 100) / 100, currency: t.transaction_amount?.currency || 'DKK',
    text: (text || party?.name || '').slice(0, 140), party: String(party?.name || '').slice(0, 80),
    partyKey: partyNum ? await accountKey(env, partyNum) : '', status: t.status || 'BOOK',
  };
}
function pickBalance(list) {
  const by = (types) => list.find((b) => types.includes(b.balance_type));
  const booked = by(['ITBD', 'CLBD', 'XPCD', 'OPBD']) || by(['ITAV', 'CLAV']) || list[0];
  const avail = by(['ITAV', 'CLAV', 'XPCD']);
  const n = (b) => (b ? Number(b.balance_amount?.amount || 0) : null);
  return { amount: n(booked), available: n(avail), type: booked?.balance_type || '', currency: booked?.balance_amount?.currency || 'DKK', at: booked?.reference_date || booked?.last_change_date_time || new Date().toISOString().slice(0, 10) };
}

// ---------- Krypteret lager i KV ----------
async function aesKey(env) { return crypto.subtle.importKey('raw', await sha256(`${env.BANK_SECRET}:enc`), 'AES-GCM', false, ['encrypt', 'decrypt']); }
async function encrypt(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), new TextEncoder().encode(JSON.stringify(obj))));
  return b64url(new Uint8Array([...iv, ...ct]));
}
async function decrypt(env, s) {
  const raw = b64urlBytes(s);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await aesKey(env), raw.slice(12));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function loadCfg(env, uid) {
  const s = await env.FILES.get(`bank:cfg:${uid}`);
  if (!s) return null;
  try { return await decrypt(env, s); } catch { throw new HttpError(500, 'Den gemte nøgle kunne ikke låses op (er BANK_SECRET blevet ændret?) — slet og indsæt nøglen igen'); }
}
async function loadSessions(env, uid) {
  const s = await env.FILES.get(`bank:sess:${uid}`);
  if (!s) return [];
  try { return (await decrypt(env, s)).sessions || []; } catch { return []; }
}
async function saveSessions(env, user, sessions) {
  if (!sessions.length) { await env.FILES.delete(`bank:sess:${user.uid}`); return; }
  const exp = sessions.map((s) => s.validUntil).filter(Boolean).sort()[0] || null;
  await env.FILES.put(`bank:sess:${user.uid}`, await encrypt(env, { sessions }), {
    metadata: { email: user.email, banks: [...new Set(sessions.map((s) => s.aspsp.name))].slice(0, 6), accounts: sessions.reduce((n, s) => n + s.accounts.length, 0), exp },
  });
}
/** Banken må kun sende brugeren tilbage til jeres egen app-adresse. */
function appRedirectUrl(u, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
  try {
    const x = new URL(u);
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(x.origin);
    if (allowed.includes(x.origin) || local) return x.origin + x.pathname.replace(/index\.html$/, '');
  } catch { /* ugyldig */ }
  throw new HttpError(400, 'Ugyldig app-adresse');
}

// ---------- base64url ----------
async function sha256(text) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); }
function b64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlBytes(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b + '='.repeat((4 - (b.length % 4)) % 4)), (c) => c.charCodeAt(0));
}
function b64urlText(s) { return new TextDecoder().decode(b64urlBytes(s)); }
