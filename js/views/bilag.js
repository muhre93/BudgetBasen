// Bilag: kvitteringer og dokumenter samlet i én fane med to under-faner.
import { state } from '../state.js';
import { lsGet, lsSet } from '../ui.js';
import { feature } from '../config.js';
import { isSimple } from '../prefs.js';
import * as receipts from './receipts.js';
import * as documents from './documents.js';

const SUBS = [
  { id: 'receipts', label: '🧾 Kvitteringer', view: receipts, on: () => feature('receipts') },
  { id: 'documents', label: '📄 Dokumenter', view: documents, on: () => feature('documents') && !isSimple() },
];
let sub = lsGet('bb:bilag', 'receipts');
export const openSub = (id) => { sub = id; lsSet('bb:bilag', id); };
export const available = () => SUBS.filter((s) => s.on());

export function render(root) {
  const subs = available();
  if (!subs.some((s) => s.id === sub)) sub = subs[0]?.id;
  const key = `bilag:${state.budgetId}:${subs.map((s) => s.id).join(',')}`;
  if (root.dataset.shell !== key) {
    root.dataset.shell = key;
    root.innerHTML = `<div class="bilag-wrap">
      ${subs.length > 1 ? `<nav class="subtabs glass bilag-tabs">${subs.map((s) => `<button data-sub="${s.id}">${s.label}</button>`).join('')}</nav>` : ''}
      <div id="bilag-inner"></div></div>`;
    root.querySelectorAll('[data-sub]').forEach((b) => (b.onclick = () => {
      if (b.dataset.sub === sub) return;
      openSub(b.dataset.sub);
      root.querySelector('#bilag-inner').dataset.shell = '';
      render(root);
    }));
  }
  root.querySelectorAll('[data-sub]').forEach((b) => b.classList.toggle('active', b.dataset.sub === sub));
  const inner = root.querySelector('#bilag-inner');
  const cur = subs.find((s) => s.id === sub);
  if (!cur) { inner.innerHTML = '<div class="empty glass"><p>Kvitteringer og dokumenter er slået fra.</p></div>'; return; }
  if (inner.dataset.sub !== sub) { inner.dataset.shell = ''; inner.dataset.sub = sub; }
  cur.view.render(inner);
}
