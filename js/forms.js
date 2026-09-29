// Formular-hjælpere: dropdowns bygget på de fleksible lister, med "+ Tilføj ny…" direkte i menuen.
import { lists, canEdit, LIST_DEFS, state, members, ALL, jointAccounts } from './state.js';
import { helpBtn } from './help.js';
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

// ---------- Hvem må se den? ----------
/** Radio-valg: Alle / Kun mig / Udvalgte + afkrydsning af medlemmer. */
export function visibilityPicker(rec, { defaultTo = null } = {}) {
  const me = state.user.uid;
  const cur = rec?.visibleTo || defaultTo || [ALL];
  const shared = cur.includes(ALL);
  const onlyMe = !shared && cur.length === 1 && cur[0] === me;
  const mode = shared ? 'all' : onlyMe ? 'me' : 'some';
  const others = members().filter((m) => m.uid !== me);
  return `<fieldset class="vis-pick">
    <legend>Hvem må se den? ${helpBtn('visible')}</legend>
    <div class="seg3">
      <label><input type="radio" name="visMode" value="all" ${mode === 'all' ? 'checked' : ''}><span>👨‍👩‍👧 Alle</span></label>
      <label><input type="radio" name="visMode" value="me" ${mode === 'me' ? 'checked' : ''}><span>🔒 Kun mig</span></label>
      <label ${others.length ? '' : 'class="disabled"'}><input type="radio" name="visMode" value="some" ${mode === 'some' ? 'checked' : ''} ${others.length ? '' : 'disabled'}><span>👥 Udvalgte</span></label>
    </div>
    <div class="vis-members ${mode === 'some' ? '' : 'hidden'}">
      ${others.length ? others.map((m) => `<label class="check"><input type="checkbox" name="visUid" value="${m.uid}" ${cur.includes(m.uid) ? 'checked' : ''}> ${esc(m.name)}</label>`).join('')
        : '<span class="muted small">Der er ikke andre medlemmer endnu.</span>'}
      <span class="muted small">Du selv kan altid se den.</span>
    </div>
  </fieldset>`;
}
export function bindVisibility(form) {
  const box = form.querySelector('.vis-members');
  form.querySelectorAll('[name=visMode]').forEach((r) => r.addEventListener('change', () => box?.classList.toggle('hidden', form.querySelector('[name=visMode]:checked')?.value !== 'some')));
}
export function readVisibility(form) {
  const mode = form.querySelector('[name=visMode]:checked')?.value || 'all';
  if (mode === 'all') return [ALL];
  const picked = [...form.querySelectorAll('[name=visUid]:checked')].map((c) => c.value);
  return [...new Set([state.user.uid, ...(mode === 'some' ? picked : [])])];
}

// ---------- Fordeling i procent ----------
/** Editor til at fordele en post mellem personer (skjules hvis posten ligger på en fælleskonto). */
export function splitEditor(item) {
  const people = lists().people.filter((p) => p !== 'Fælles');
  const sp = item?.split || {};
  const hasSplit = Object.values(sp).some((v) => Number(v) > 0);
  return `<fieldset class="split-box" data-split>
    <legend>Hvem betaler hvor meget? ${helpBtn('split')}</legend>
    <p class="split-joint muted small hidden">Denne konto er en <b>fælleskonto</b> — posten deles automatisk som fælles. Du behøver ikke fordele den.</p>
    <div class="split-body">
      <label class="check"><input type="checkbox" name="useSplit" ${hasSplit ? 'checked' : ''}> Del posten mellem flere personer</label>
      <div class="split-rows ${hasSplit ? '' : 'hidden'}">
        ${people.map((p) => `<label class="split-row"><span>${esc(p)}</span><span class="pct"><input type="number" inputmode="decimal" min="0" max="100" step="1" name="split_${esc(p)}" data-person="${esc(p)}" value="${sp[p] ?? ''}" placeholder="0"> %</span><span class="split-kr muted small" data-kr="${esc(p)}"></span></label>`).join('')}
        <div class="split-quick"><button type="button" class="btn small ghost" data-even>Del lige</button><span class="split-sum small" id="split-sum"></span></div>
      </div>
    </div>
  </fieldset>`;
}
export function bindSplit(form, getMonthly) {
  const box = form.querySelector('[data-split]');
  if (!box) return () => {};
  const rows = box.querySelector('.split-rows');
  const inputs = [...box.querySelectorAll('[data-person]')];
  const upd = () => {
    const joint = jointAccounts().includes(form.account?.value);
    box.querySelector('.split-joint').classList.toggle('hidden', !joint);
    box.querySelector('.split-body').classList.toggle('hidden', joint);
    rows.classList.toggle('hidden', !form.useSplit.checked);
    const sum = inputs.reduce((s, i) => s + (Number(i.value) || 0), 0);
    const el = box.querySelector('#split-sum');
    el.textContent = `I alt ${Math.round(sum * 10) / 10} %`;
    el.className = `split-sum small ${Math.abs(sum - 100) < 0.01 ? 'pos' : 'neg'}`;
    const m = getMonthly();
    for (const i of inputs) {
      const t = box.querySelector(`[data-kr="${CSS.escape(i.dataset.person)}"]`);
      t.textContent = m && Number(i.value) ? `${new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 }).format((m * Number(i.value)) / 100)} kr./md.` : '';
    }
  };
  box.querySelector('[data-even]').onclick = () => {
    const n = inputs.length || 1;
    inputs.forEach((i, k) => (i.value = k === n - 1 ? Math.round((100 - Math.floor(100 / n) * (n - 1)) * 10) / 10 : Math.floor(100 / n)));
    upd();
  };
  form.addEventListener('input', upd); form.addEventListener('change', upd);
  upd();
  return upd;
}
/** Returnerer {navn: pct} eller null. Kaster fejl hvis summen ikke er 100. */
export function readSplit(form) {
  if (!form.useSplit?.checked || jointAccounts().includes(form.account?.value)) return null;
  const out = {};
  form.querySelectorAll('[data-person]').forEach((i) => { const v = Number(i.value); if (v > 0) out[i.dataset.person] = Math.round(v * 100) / 100; });
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  if (!Object.keys(out).length) return null;
  if (Math.abs(sum - 100) > 0.01) throw new Error(`Fordelingen skal give 100 % (nu ${Math.round(sum * 10) / 10} %)`);
  return out;
}
