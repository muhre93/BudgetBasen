// Formular-hjælpere: dropdowns bygget på de fleksible lister, med "+ Tilføj ny…" direkte i menuen.
import { lists, canEdit, LIST_DEFS } from './state.js';
import { esc, promptDialog, toast, errorToast } from './ui.js';
import { addListValue, addFrequency } from './data.js';
import { freqLabel } from './calc.js';

const NEW = '__new__';

/** <select> for en liste (categories, people, suppliers, methods, accounts, docTypes) */
export function listSelect(name, key, value = '', { required = false, placeholder = '— Vælg —' } = {}) {
  const L = lists()[key] || [];
  const opts = [...L];
  if (value && !opts.includes(value)) opts.push(value); // bevar værdier der er slettet fra listen
  return `<select name="${name}" data-list="${key}" ${required ? 'required' : ''}>
    <option value="">${esc(placeholder)}</option>
    ${opts.map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}
    ${canEdit() ? `<option value="${NEW}">＋ Tilføj ny…</option>` : ''}
  </select>`;
}

export function freqSelect(name, value = 1) {
  const F = lists().frequencies;
  const opts = [...F];
  if (!opts.some((f) => Number(f.months) === Number(value))) opts.push({ months: Number(value), label: freqLabel(value, []) });
  return `<select name="${name}" data-list="frequencies" required>
    ${opts.map((f) => `<option value="${f.months}" ${Number(f.months) === Number(value) ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
    ${canEdit() ? `<option value="${NEW}">＋ Egen frekvens…</option>` : ''}
  </select>`;
}

/** Filter-select (til søgning) med "Alle" */
export function filterSelect(id, key, value = '', allLabel = 'Alle') {
  const L = lists()[key] || [];
  return `<select id="${id}"><option value="">${esc(allLabel)}</option>${L.map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
}

/** Aktivér "+ Tilføj ny…" i alle list-selects i en formular. */
export function bindListSelects(root) {
  root.querySelectorAll('select[data-list]').forEach((sel) => {
    let prev = sel.value;
    sel.addEventListener('focus', () => { prev = sel.value; });
    sel.addEventListener('change', async () => {
      if (sel.value !== NEW) { prev = sel.value; return; }
      const key = sel.dataset.list;
      try {
        if (key === 'frequencies') {
          const n = await promptDialog('Ny betalingsfrekvens', { label: 'Antal måneder mellem betalinger', type: 'number', placeholder: 'f.eks. 18' });
          if (!n) { sel.value = prev; return; }
          const months = await addFrequency(n, freqLabel(n, []));
          if (!sel.querySelector(`option[value="${months}"]`)) {
            const o = new Option(freqLabel(months, []), months);
            sel.insertBefore(o, sel.querySelector(`option[value="${NEW}"]`));
          }
          sel.value = String(months);
        } else {
          const def = LIST_DEFS.find((d) => d.key === key);
          const v = await promptDialog(`Ny ${def?.single || 'værdi'}`, { label: 'Navn' });
          if (!v) { sel.value = prev; return; }
          const saved = await addListValue(key, v);
          if (![...sel.options].some((o) => o.value === saved)) sel.insertBefore(new Option(saved, saved), sel.querySelector(`option[value="${NEW}"]`));
          sel.value = saved;
          toast(`"${saved}" tilføjet`);
        }
        prev = sel.value;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (e) { sel.value = prev; errorToast(e); }
    });
  });
}
