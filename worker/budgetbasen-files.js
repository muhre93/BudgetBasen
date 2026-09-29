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
  return { uid, role, isOwner: doc.fields?.ownerUid?.stringValue === uid };
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
