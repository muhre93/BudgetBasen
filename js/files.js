// Filhåndtering: komprimering af billeder + upload/åbning/sletning via Cloudflare Worker (Workers KV).
// Alle kald sender brugerens Firebase-login-token med, så Worker'en kan tjekke medlemskab.
import { auth } from './firebase.js';
import { state } from './state.js';
import { FILES_WORKER_URL } from '../firebase-config.js';

const MAX_UPLOAD = 10 * 1024 * 1024; // matcher Worker'en

// ---------- Kald til Worker'en ----------
export async function workerFetch(path, options = {}) {
  if (!FILES_WORKER_URL || FILES_WORKER_URL.includes('DIT-NAVN')) {
    throw new Error('Fil-serveren er ikke sat op endnu — indsæt FILES_WORKER_URL i firebase-config.js');
  }
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Du er ikke logget ind');
  let res;
  try {
    res = await fetch(`${FILES_WORKER_URL.replace(/\/+$/, '')}${path}`, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error('Kunne ikke kontakte fil-serveren — tjek nettet og FILES_WORKER_URL');
  }
  if (!res.ok) {
    let msg = `Fil-serveren svarede ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* ikke JSON */ }
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return res;
}

// ---------- Billeder ----------
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Billedet kunne ikke læses (prøv JPG/PNG)')); };
    img.src = url;
  });
}
function canvasFrom(img, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
const toBlob = (c, q) => new Promise((r) => c.toBlob(r, 'image/jpeg', q));

/** Komprimér billede til JPEG (typisk 200–400 KB) — sparer lager, mobildata og KV-kvote. */
export async function compressImage(file, maxDim = 1800, quality = 0.82) {
  const img = await loadImage(file);
  return toBlob(canvasFrom(img, maxDim), quality);
}
/** Lille miniature (data-URL, ~10 KB) som gemmes direkte i Firestore-dokumentet → hurtige lister. */
export async function makeThumb(file, maxDim = 260) {
  if (!file.type.startsWith('image/')) return null;
  const img = await loadImage(file);
  return canvasFrom(img, maxDim).toDataURL('image/jpeg', 0.7);
}

// ---------- Upload / åbn / slet ----------
/**
 * Upload én fil. folder = 'receipts' | 'documents'.
 * Returnerer metadata der gemmes i Firestore-dokumentet: { key, name, contentType, size }
 */
export async function uploadFile(file, folder) {
  const isImage = file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf';
  if (!isImage && !isPdf) throw new Error('Kun billeder og PDF-filer understøttes');
  const blob = isImage ? await compressImage(file) : file;
  if (blob.size > MAX_UPLOAD) throw new Error('Filen er større end 10 MB');
  const contentType = isImage ? 'image/jpeg' : 'application/pdf';
  const name = isImage ? file.name.replace(/\.\w+$/, '') + '.jpg' : file.name;
  const q = new URLSearchParams({ budget: state.budgetId, folder, name });
  const res = await workerFetch(`/upload?${q}`, { method: 'POST', headers: { 'Content-Type': contentType }, body: blob });
  const { key, size } = await res.json();
  return { key, name, contentType, size };
}

const objectUrls = new Map();
/** Hent filen som object-URL (caches i hukommelsen mens appen er åben). */
export async function fileUrl(meta) {
  if (objectUrls.has(meta.key)) return objectUrls.get(meta.key);
  const res = await workerFetch(`/file?key=${encodeURIComponent(meta.key)}`);
  const url = URL.createObjectURL(await res.blob());
  objectUrls.set(meta.key, url);
  return url;
}

/** Åbn fil i ny fane. Vinduet åbnes synkront, så pop-up-blokkere ikke stopper det. */
export async function openFile(meta) {
  if (!meta?.key) throw new Error('Filen er ikke tilgængelig');
  const w = window.open('', '_blank');
  try {
    const url = await fileUrl(meta);
    if (w) w.location.href = url; else window.location.href = url;
  } catch (e) { w?.close(); throw e; }
}

export async function removeFile(meta) {
  if (!meta?.key) return;
  await workerFetch(`/file?key=${encodeURIComponent(meta.key)}`, { method: 'DELETE' });
  objectUrls.delete(meta.key);
}

/** Slet ALLE filer for et budget (kun ejeren — bruges når budgettet slettes). */
export async function purgeBudgetFiles(budgetId) {
  const res = await workerFetch(`/budget?budget=${encodeURIComponent(budgetId)}`, { method: 'DELETE' });
  return (await res.json()).deleted;
}

export const fileSize = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Bed Worker'en sende invitationsmail (via EmailJS). Kaster fejl hvis mail ikke er sat op. */
export async function sendInviteMail(budgetId, email) {
  const appUrl = `${location.origin}${location.pathname}`;
  const res = await workerFetch('/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ budget: budgetId, email, appUrl }),
  });
  return res.json();
}
