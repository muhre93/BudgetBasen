// Sammenligning: nuværende budget vs. en gemt version eller et andet budget.
import { db, collection, getDocs } from '../firebase.js';
import { state, canEdit, lists } from '../state.js';
import { esc, kr, krSigned, fmtDate, openModal, toast, promptDialog, fmtYm, currentYm } from '../ui.js';
import { compareItems, freqLabel } from '../calc.js';
import { listSnapshots, saveSnapshot } from '../data.js';

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
    <label>Sammenlign nuværende budget med
      <select name="src">
        <option value="">— Vælg —</option>
        ${snaps.length ? `<optgroup label="Gemte versioner">${snaps.map((s) => `<option value="snap:${s.id}" ${preselect === s.id ? 'selected' : ''}>${esc(s.name)} · ${fmtDate(s.createdAt)}</option>`).join('')}</optgroup>` : ''}
        ${others.length ? `<optgroup label="Andre budgetter">${others.map((b) => `<option value="budget:${b.id}">${esc(b.name)}</option>`).join('')}</optgroup>` : ''}
      </select>
    </label>
    ${!snaps.length ? `<p class="hint">Der er endnu ingen gemte versioner. ${canEdit() ? 'Brug "Gem version" på budget-siden — appen gemmer desuden automatisk én version om måneden.' : ''}</p>` : ''}
    <div id="cmp-out"></div>`;

  openModal({
    title: 'Sammenlign budgetter', body, wide: true,
    onOpen: (form) => {
      const run = async () => {
        const out = form.querySelector('#cmp-out');
        const v = form.src.value;
        if (!v) { out.innerHTML = ''; return; }
        out.innerHTML = '<div class="skeleton"></div>';
        const [kind, id] = v.split(':');
        let oldItems;
        if (kind === 'snap') oldItems = snaps.find((s) => s.id === id)?.items || [];
        else oldItems = (await getDocs(collection(db, 'budgets', id, 'items'))).docs.map((d) => ({ id: d.id, ...d.data() }));
        out.innerHTML = resultHtml(compareItems(oldItems, state.items));
      };
      form.src.addEventListener('change', () => run().catch((e) => toast(e.message, 'error')));
      if (form.src.value) run();
    },
  });
}

function resultHtml(r) {
  const F = lists().frequencies;
  const t = r.totals;
  const row = (label, b, a, d, invert = false) => `<tr><td>${label}</td><td class="num">${kr(b)}</td><td class="num">${kr(a)}</td>
    <td class="num ${Math.abs(d) < 0.005 ? '' : (d > 0) !== invert ? 'pos' : 'neg'}">${krSigned(d)}</td></tr>`;
  const fieldTxt = (c) => c.fields.map((f) => {
    const val = (x) => (f === 'amount' ? kr(x[f]) : f === 'freq' ? freqLabel(x[f], F) : f === 'active' ? (x[f] === false ? 'nej' : 'ja') : x[f] || '–');
    const names = { amount: 'Beløb', freq: 'Frekvens', category: 'Kategori', who: 'Hvem', supplier: 'Leverandør', account: 'Konto', method: 'Metode', startMonth: 'Start', payDay: 'Dag', endMonth: 'Slut', active: 'Aktiv' };
    return `${names[f]}: ${esc(val(c.old))} → <b>${esc(val(c.new))}</b>`;
  }).join('<br>');

  return `
    <table class="cmp-table"><thead><tr><th></th><th class="num">Før / md.</th><th class="num">Nu / md.</th><th class="num">Ændring</th></tr></thead><tbody>
      ${row('Indtægter', t.before.income, t.after.income, t.delta.income)}
      ${row('Udgifter', t.before.expense, t.after.expense, t.delta.expense, true)}
      ${row('<b>Overskud</b>', t.before.net, t.after.net, t.delta.net)}
    </tbody></table>
    <p class="muted small">Årlig effekt på overskuddet: <b>${krSigned(t.delta.net * 12)}</b> · ${r.unchanged} poster uændrede</p>

    ${r.changed.length ? `<h3>Ændrede poster (${r.changed.length})</h3><ul class="cmp-list">${r.changed.map((c) => `
      <li><div><b>${esc(c.new.name)}</b><div class="small">${fieldTxt(c)}</div></div><span class="num ${delCls(c.deltaMonthly, c.new.type)}">${krSigned(c.deltaMonthly)}/md.</span></li>`).join('')}</ul>` : ''}
    ${r.added.length ? `<h3>Nye poster (${r.added.length})</h3><ul class="cmp-list">${r.added.map((a) => `
      <li><div><b>${esc(a.item.name)}</b><div class="small muted">${esc(a.item.category || '')} · ${a.item.type === 'income' ? 'indtægt' : 'udgift'}</div></div><span class="num ${delCls(a.deltaMonthly, a.item.type)}">${krSigned(a.deltaMonthly)}/md.</span></li>`).join('')}</ul>` : ''}
    ${r.removed.length ? `<h3>Fjernede poster (${r.removed.length})</h3><ul class="cmp-list">${r.removed.map((a) => `
      <li><div><b>${esc(a.item.name)}</b><div class="small muted">${esc(a.item.category || '')} · ${a.item.type === 'income' ? 'indtægt' : 'udgift'}</div></div><span class="num ${delCls(a.deltaMonthly, a.item.type)}">${krSigned(a.deltaMonthly)}/md.</span></li>`).join('')}</ul>` : ''}
    ${r.categories.filter((c) => Math.abs(c.delta) > 0.004).length ? `<h3>Pr. kategori</h3><table class="cmp-table"><tbody>
      ${r.categories.filter((c) => Math.abs(c.delta) > 0.004).map((c) => `<tr><td>${esc(c.category)} <small class="muted">${c.type === 'income' ? 'indtægt' : 'udgift'}</small></td><td class="num">${kr(c.before)}</td><td class="num">${kr(c.after)}</td><td class="num ${delCls(c.delta, c.type)}">${krSigned(c.delta)}</td></tr>`).join('')}
    </tbody></table>` : ''}`;
}
// Stigende indtægt = godt (grøn); stigende udgift = skidt (rød)
const delCls = (d, type) => (Math.abs(d) < 0.005 ? '' : (d > 0) === (type === 'income') ? 'pos' : 'neg');
