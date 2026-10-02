// Sammenligning: nuværende budget vs. en gemt version eller et andet budget.
import { state, canEdit, lists, isShared, savingsAccounts } from '../state.js';
import { esc, kr, krSigned, fmtDate, openModal, toast, promptDialog, fmtYm, currentYm } from '../ui.js';
import { compareItems, freqLabel } from '../calc.js';
import { listSnapshots, saveSnapshot, loadAll } from '../data.js';

export async function openSaveSnapshot() {
  const name = await promptDialog('Gem version af budgettet', { label: 'Navn på versionen', value: `Budget ${fmtYm(currentYm(), true)}` });
  if (!name) return;
  await saveSnapshot(name);
  toast('Version gemt — du kan altid sammenligne med den senere');
}

export async function openCompareDialog(preselect = '') {
  let snaps = [];
  try { snaps = await listSnapshots(); } catch (e) { console.warn(e); }
  const others = state.budgets.filter((b) => b.id !== state.budgetId);
  const body = `
    <label>Sammenlign budgettet, som det er nu, med
      <select name="src">
        <option value="">— Vælg —</option>
        ${snaps.length ? `<optgroup label="Gemte versioner">${snaps.map((s) => `<option value="snap:${s.id}" ${preselect === s.id ? 'selected' : ''}>${esc(s.name)} · ${fmtDate(s.createdAt)}</option>`).join('')}</optgroup>` : ''}
        ${others.length ? `<optgroup label="Andre budgetter">${others.map((b) => `<option value="budget:${b.id}">${esc(b.name)}</option>`).join('')}</optgroup>` : ''}
      </select>
    </label>
    ${!snaps.length ? `<p class="hint">Der er endnu ingen gemte versioner. ${canEdit() ? 'Brug "Gem version" på budget-siden — appen gemmer desuden automatisk én version om måneden.' : ''}</p>` : ''}
    <div id="cmp-out"></div>`;

  openModal({
    title: 'Hvad har ændret sig?', body, wide: true,
    onOpen: (form) => {
      const run = async () => {
        const out = form.querySelector('#cmp-out');
        const v = form.src.value;
        if (!v) { out.innerHTML = ''; return; }
        out.innerHTML = '<div class="skeleton"></div>';
        const [kind, id] = v.split(':');
        let oldItems;
        if (kind === 'snap') oldItems = snaps.find((s) => s.id === id)?.items || [];
        else oldItems = await loadAll('items', id);
        const current = kind === 'snap' ? state.items.filter(isShared) : state.items;
        out.innerHTML = resultHtml(compareItems(oldItems, current, new Date(), { savingsAccounts: savingsAccounts() }));
        const only = out.querySelector('#cmp-only');
        only.onchange = () => out.querySelector('#cmp-table').classList.toggle('only-changes', only.checked);
      };
      form.src.addEventListener('change', () => run().catch((e) => toast(e.message, 'error')));
      if (form.src.value) run();
    },
  });
}

const FIELD_NAMES = { amount: 'Beløb', freq: 'Hvor ofte', category: 'Kategori', who: 'Hvem', supplier: 'Leverandør', account: 'Konto', method: 'Metode', startMonth: 'Start', payDay: 'Dag', endMonth: 'Slut', active: 'Aktiv' };

function resultHtml(r) {
  const F = lists().frequencies;
  const t = r.totals;
  const cls = (d, type) => (Math.abs(d) < 0.005 || type === 'transfer' || type === 'saving' ? 'muted' : (d > 0) === (type === 'income') ? 'pos' : 'neg');
  const val = (x, f) => (f === 'amount' ? kr(x[f]) : f === 'freq' ? freqLabel(x[f], F) : f === 'active' ? (x[f] === false ? 'nej' : 'ja') : x[f] || '–');
  const tag = { same: '', changed: '<span class="chip warn">Ændret</span>', added: '<span class="chip ok">Ny</span>', removed: '<span class="chip neg">Fjernet</span>' };
  const summary = (label, b, a, type) => `<div class="cmp-kpi"><span>${label}</span><b>${kr(a)}</b><small class="${cls(a - b, type)}">${Math.abs(a - b) < 0.005 ? 'uændret' : `${krSigned(a - b)} i forhold til før`}</small></div>`;

  const sections = ['income', 'expense', 'transfer'].map((type) => {
    const rows = r.rows.filter((x) => x.item.type === type);
    if (!rows.length) return '';
    const byCat = new Map();
    for (const x of rows) { const c = x.item.category || 'Uden kategori'; if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(x); }
    return `<h3>${{ income: 'Indtægter', expense: 'Udgifter', transfer: 'Opsparing og overførsler' }[type]}</h3>
      <table class="cmp-table full"><thead><tr><th>Post</th><th class="num">Før /md.</th><th class="num">Nu /md.</th><th class="num">Forskel</th></tr></thead><tbody>
      ${[...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0], 'da')).map(([cat, xs]) => {
        const b = xs.reduce((s, x) => s + x.before, 0), a = xs.reduce((s, x) => s + x.after, 0);
        return `<tr class="cmp-cat"><td>${esc(cat)}</td><td class="num">${kr(b)}</td><td class="num">${kr(a)}</td><td class="num ${cls(a - b, type)}">${Math.abs(a - b) < 0.005 ? '–' : krSigned(a - b)}</td></tr>
        ${xs.sort((p, q) => Math.abs(q.delta) - Math.abs(p.delta)).map((x) => `<tr class="cmp-${x.status}">
          <td>${esc(x.item.name)} ${tag[x.status]}${x.fields.length ? `<div class="small muted">${x.fields.map((f) => `${FIELD_NAMES[f]}: ${esc(val(x.old, f))} → <b>${esc(val(x.item, f))}</b>`).join('<br>')}</div>` : ''}</td>
          <td class="num">${x.status === 'added' ? '–' : kr(x.before)}</td><td class="num">${x.status === 'removed' ? '–' : kr(x.after)}</td>
          <td class="num ${cls(x.delta, type)}">${Math.abs(x.delta) < 0.005 ? '–' : krSigned(x.delta)}</td></tr>`).join('')}`;
      }).join('')}</tbody></table>`;
  }).join('');

  return `
    <div class="cmp-kpis">
      ${summary('Indtægter /md.', t.before.income, t.after.income, 'income')}
      ${summary('Udgifter /md.', t.before.expense, t.after.expense, 'expense')}
      ${t.before.saving || t.after.saving ? summary('Opsparing /md.', t.before.saving, t.after.saving, 'saving') : ''}
      ${summary('Tilbage af lønnen /md.', t.before.net, t.after.net, 'income')}
    </div>
    <p class="cmp-sentence">${Math.abs(t.delta.net) < 0.005 ? 'Budgettet giver det samme tilbage hver måned som før.'
      : t.delta.net > 0 ? `🟢 I har <b>${kr(t.delta.net)}</b> mere tilbage hver måned end før — det er <b>${kr(t.delta.net * 12)}</b> om året.`
      : `🔴 I har <b>${kr(-t.delta.net)}</b> mindre tilbage hver måned end før — det er <b>${kr(-t.delta.net * 12)}</b> om året.`}
      <span class="muted small">${r.changed.length} ændret · ${r.added.length} nye · ${r.removed.length} fjernet · ${r.unchanged} uændrede</span></p>
    <label class="check"><input type="checkbox" id="cmp-only"> Vis kun det, der er ændret</label>
    <div id="cmp-table">${sections}</div>`;
}
