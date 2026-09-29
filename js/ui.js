// UI-hjælpere: formatering, modaler, toasts, input-parsing.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const nf2 = new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 });
/** 1234.5 -> "1.234,50 kr." */
export const kr = (n, decimals = true) => (decimals ? nf2 : nf0).format(Math.abs(Number(n) || 0) < 0.005 ? 0 : Number(n) || 0);
/** Signeret: "+1.234,50 kr." */
export const krSigned = (n) => (n > 0.004 ? '+' : '') + kr(n);
/** Til input-felter: 1234.5 -> "1234,5" */
export const numToInput = (n) => (n === null || n === undefined || n === '' ? '' : String(n).replace('.', ','));

/** Dansk beløb: "1.234,50" / "1234.50" / "1 234" -> 1234.5 (NaN hvis ugyldig) */
export function parseAmount(v) {
  let s = String(v ?? '').trim().replace(/\s|kr\.?/gi, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

const MONTHS = ['jan.', 'feb.', 'mar.', 'apr.', 'maj', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.'];
const MONTHS_LONG = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
export function fmtYm(ym, long = false) {
  if (!ym) return '';
  const [y, m] = ym.split('-').map(Number);
  return `${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${y}`;
}
export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === 'function') return v.toDate();
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); }
  const d = new Date(v);
  return isNaN(d) ? null : d;
}
export function fmtDate(v, withTime = false) {
  const d = toDate(v);
  if (!d) return '';
  const s = `${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return withTime ? `${s} kl. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : s;
}
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const currentYm = (d = new Date()) => isoDate(d).slice(0, 7);
export const firstName = (s) => String(s || '').split(' ')[0];

export function randomId(len = 24) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const a = crypto.getRandomValues(new Uint8Array(len));
  return [...a].map((x) => chars[x % chars.length]).join('');
}

export function lsGet(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } }
export function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* privat vindue */ } }

// ---------- Toast ----------
export function toast(msg, type = 'ok', ms = 3200) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
}
export function errorToast(e) {
  console.error(e);
  const code = e?.code || '';
  const msg = code.includes('permission-denied') ? 'Du har ikke rettighed til dette.'
    : code.includes('unavailable') ? 'Ingen forbindelse — prøv igen.'
    : (e?.message || String(e));
  toast(msg, 'error', 5000);
}

// ---------- Modal ----------
/**
 * openModal({ title, body, submitLabel, onSubmit(fd, form), wide, readOnly, buttons:[{label, cls, onClick}] , onOpen(el) })
 * onSubmit må returnere false for at holde modalen åben.
 */
export function openModal({ title, body, submitLabel = 'Gem', onSubmit = null, wide = false, readOnly = false, buttons = [], onOpen = null, onClose = null }) {
  const root = $('#modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <form class="modal glass ${wide ? 'wide' : ''}" novalidate>
      <header class="modal-head">
        <h2>${esc(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Luk">✕</button>
      </header>
      <div class="modal-body">${body}</div>
      <footer class="modal-foot">
        <div class="left-btns"></div>
        <button type="button" class="btn ghost" data-close>${onSubmit && !readOnly ? 'Annullér' : 'Luk'}</button>
        ${onSubmit && !readOnly ? `<button type="submit" class="btn primary">${esc(submitLabel)}</button>` : ''}
      </footer>
    </form>`;
  const form = wrap.querySelector('form');
  const left = wrap.querySelector('.left-btns');
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn ${b.cls || 'ghost'}`;
    btn.textContent = b.label;
    btn.onclick = async () => {
      btn.disabled = true;
      try { const r = await b.onClick(form); if (r !== false) close(); } catch (e) { errorToast(e); } finally { btn.disabled = false; }
    };
    left.appendChild(btn);
  }
  const close = () => { wrap.classList.remove('show'); setTimeout(() => wrap.remove(), 200); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  wrap.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return;
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.classList.add('loading');
    try {
      const r = await onSubmit(new FormData(form), form);
      if (r !== false) close();
    } catch (err) { errorToast(err); } finally { btn.disabled = false; btn.classList.remove('loading'); }
  });
  root.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('show'));
  onOpen?.(form);
  if (readOnly) form.querySelectorAll('.modal-body input, .modal-body select, .modal-body textarea, .modal-body [data-edit-only]').forEach((x) => (x.disabled = true));
  const first = form.querySelector('.modal-body input:not([type=hidden]):not([type=checkbox]):not([type=radio]), .modal-body textarea');
  if (first && !readOnly && window.matchMedia('(pointer:fine)').matches) first.focus();
  return { el: form, close };
}

export function confirmDialog(message, { okLabel = 'Ja, fortsæt', danger = true, requireText = null } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title: 'Er du sikker?',
      body: `<p>${message}</p>${requireText ? `<label>Skriv <b>${esc(requireText)}</b> for at bekræfte<input name="confirm" autocomplete="off"></label>` : ''}`,
      submitLabel: okLabel,
      onSubmit: (fd) => {
        if (requireText && fd.get('confirm') !== requireText) { toast('Teksten matcher ikke', 'error'); return false; }
        done = true; resolve(true);
      },
      onClose: () => { if (!done) resolve(false); },
    });
    if (danger) m.el.querySelector('[type=submit]')?.classList.replace('primary', 'danger');
  });
}

export function promptDialog(title, { label = '', value = '', type = 'text', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    openModal({
      title,
      body: `<label>${esc(label)}<input name="v" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" required></label>`,
      submitLabel: 'OK',
      onSubmit: (fd) => { done = true; resolve(String(fd.get('v')).trim()); },
      onClose: () => { if (!done) resolve(null); },
    });
  });
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Kopieret til udklipsholderen'); }
  catch { window.prompt('Kopiér linket:', text); }
}

export function download(filename, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
