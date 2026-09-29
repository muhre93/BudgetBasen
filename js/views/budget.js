// Budget-fanen: nøgletal, kontosaldo/budgetkonto-status og alle poster grupperet efter kategori.
import { state, canEdit, lists } from '../state.js';
import {
  esc, kr, krSigned, fmtYm, fmtDate, openModal, confirmDialog, toast, parseAmount, numToInput,
  currentYm, isoDate, lsGet, lsSet, $$,
} from '../ui.js';
import {
  monthly, summarize, calendarYear, requiredBalance, nextPayment, freqLabel, countsInBudget, dateToIndex, ymToIndex,
} from '../calc.js';
import { saveItem, deleteItem, saveBalances } from '../data.js';
import { listSelect, freqSelect, filterSelect, bindListSelects } from '../forms.js';
import { openShareDialog } from './share.js';
import { openCompareDialog, openSaveSnapshot } from './compare.js';

const ui = { q: '', who: '', show: 'all', collapsed: new Set(lsGet('bb:collapsed', [])) };

const ICON = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14"/></svg>',
  compare: '<svg viewBox="0 0 24 24"><path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>',
  lock: '<svg viewBox="0 0 24 24" class="mini"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
};

export function render(root) {
  const today = new Date();
  const items = state.items;
  const sum = summarize(items, today);
  const cal = calendarYear(items, today.getFullYear());
  const L = lists();

  root.innerHTML = `
    <section class="kpis">
      ${kpi('Indtægter pr. md.', kr(sum.income), 'pos', `${kr(sum.yearIncome, false)} om året`)}
      ${kpi('Udgifter pr. md.', kr(sum.expense), 'neg', `${kr(sum.yearExpense, false)} om året`)}
      ${kpi('Overskud pr. md.', kr(sum.net), sum.net >= 0 ? 'pos' : 'neg', sum.net >= 0 ? 'Der er luft i budgettet' : 'Budgettet hænger ikke sammen')}
      ${kpi(`Årets resultat`, kr(sum.yearNet, false), sum.yearNet >= 0 ? 'pos' : 'neg', `Kalenderår ${today.getFullYear()}: ${krSigned(cal.net)} faktisk`)}
    </section>

    ${balancesHtml(items, today)}

    <section class="toolbar glass">
      <div class="toolbar-row">
        <input id="b-q" type="search" placeholder="Søg i poster…" value="${esc(ui.q)}">
        ${filterSelect('b-who', 'people', ui.who, 'Alle personer')}
        <select id="b-show">
          <option value="all" ${ui.show === 'all' ? 'selected' : ''}>Alle poster</option>
          <option value="expense" ${ui.show === 'expense' ? 'selected' : ''}>Kun udgifter</option>
          <option value="income" ${ui.show === 'income' ? 'selected' : ''}>Kun indtægter</option>
          <option value="inactive" ${ui.show === 'inactive' ? 'selected' : ''}>Inaktive/udløbne</option>
        </select>
      </div>
      <div class="toolbar-row actions">
        ${canEdit() ? `<button class="btn primary" data-act="add-expense">${ICON.plus}Udgift</button>
        <button class="btn success" data-act="add-income">${ICON.plus}Indtægt</button>` : ''}
        <span class="spacer"></span>
        <button class="btn ghost" data-act="compare" title="Sammenlign med tidligere version">${ICON.compare}<span class="hide-sm">Sammenlign</span></button>
        ${canEdit() ? `<button class="btn ghost" data-act="snapshot" title="Gem en version af budgettet">${ICON.save}<span class="hide-sm">Gem version</span></button>` : ''}
        <button class="btn ghost" data-act="share" title="Del, eksportér (PDF/Excel) eller udskriv">${ICON.share}<span class="hide-sm">Del / eksportér</span></button>
      </div>
    </section>

    ${!state.itemsLoaded ? '<div class="skeleton"></div>' : items.length === 0 ? emptyHtml() : groupsHtml(items, today, L)}
  `;

  // --- Events ---
  const q = root.querySelector('#b-q');
  q.oninput = () => { ui.q = q.value; render(root); };
  root.querySelector('#b-who').onchange = (e) => { ui.who = e.target.value; render(root); };
  root.querySelector('#b-show').onchange = (e) => { ui.show = e.target.value; render(root); };
  root.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => {
    const a = b.dataset.act;
    if (a === 'add-expense') openItemModal(null, 'expense');
    if (a === 'add-income') openItemModal(null, 'income');
    if (a === 'share') openShareDialog();
    if (a === 'compare') openCompareDialog();
    if (a === 'snapshot') openSaveSnapshot();
    if (a === 'balances') openBalancesModal();
  }));
  root.querySelectorAll('[data-item]').forEach((el) => (el.onclick = () => {
    const it = state.items.find((x) => x.id === el.dataset.item);
    if (it) openItemModal(it);
  }));
  root.querySelectorAll('details[data-group]').forEach((d) => d.addEventListener('toggle', () => {
    if (d.open) ui.collapsed.delete(d.dataset.group); else ui.collapsed.add(d.dataset.group);
    lsSet('bb:collapsed', [...ui.collapsed]);
  }));
}

const kpi = (label, value, cls, sub) => `
  <div class="kpi glass ${cls}"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${esc(sub)}</div></div>`;

function emptyHtml() {
  return `<div class="empty glass">
    <div class="empty-emoji">🧾</div>
    <h3>Dit budget er tomt</h3>
    <p>Start med at tilføje jeres faste indtægter (løn, børnepenge) og derefter udgifterne (husleje, forsikringer, abonnementer…).</p>
    ${canEdit() ? `<div class="row-center"><button class="btn success" data-act="add-income">＋ Første indtægt</button><button class="btn primary" data-act="add-expense">＋ Første udgift</button></div>` : ''}
  </div>`;
}

// ---------- Kontosaldo & budgetkonto-status ----------
function balancesHtml(items, today) {
  const balances = state.budget.settings?.balances || [];
  const stale = balances.some((b) => b.date && (today - new Date(b.date)) / 864e5 > 7);
  const rows = balances.map((b) => {
    const r = requiredBalance(items, b.account, today);
    const diff = (Number(b.amount) || 0) - r.required;
    const hasExp = r.rows.length > 0 || r.monthlyTransfer > 0;
    return `<div class="bal-row">
      <div class="bal-acc"><b>${esc(b.account)}</b><span class="muted small">opdateret ${fmtDate(b.date)}</span></div>
      <div class="bal-amt">${kr(b.amount)}</div>
      ${hasExp ? `<div class="bal-status ${diff >= 0 ? 'pos' : 'neg'}">
          <span>${diff >= 0 ? 'Overskud' : 'Mangler'} ${kr(Math.abs(diff))}</span>
          <span class="muted small">Bør stå ${kr(r.required)} · overfør ${kr(r.monthlyTransfer)}/md.</span>
        </div>` : '<div class="bal-status muted small">Ingen udgifter trækkes fra denne konto</div>'}
    </div>`;
  }).join('');
  return `<section class="balances glass">
    <div class="section-head">
      <h2>Kontosaldo & budgetkonto</h2>
      ${canEdit() ? '<button class="btn small ghost" data-act="balances">Opdatér saldo</button>' : ''}
    </div>
    ${balances.length ? rows : '<p class="muted">Indtast den aktuelle saldo på budgetkontoen, så kan appen regne ud om der står nok til de kommende regninger.</p>'}
    ${stale ? '<p class="hint warn">Mindst én saldo er over en uge gammel — opdatér den for at få præcise tal.</p>' : ''}
    <details class="explain"><summary>Hvordan regnes "Bør stå" ud?</summary>
      <p>For hver udgift på kontoen regner appen ud, hvor stor en del der burde være sparet op siden sidste betaling, når du overfører det månedlige beløb den 1. i hver måned.
      Eksempel: en årlig forsikring på 1.200 kr. betalt i marts → i slutningen af september bør der stå 6 × 100 = 600 kr. til den.
      Skal en regning betales senere i indeværende måned, skal hele beløbet stå klar.</p>
    </details>
  </section>`;
}

function openBalancesModal() {
  const L = lists();
  const balances = state.budget.settings?.balances || [];
  const accounts = [...new Set([...L.accounts, ...balances.map((b) => b.account)])];
  const body = `
    <p class="muted small">Indtast saldoen som den står i netbanken i dag. Lad feltet stå tomt for konti du ikke vil følge.</p>
    ${accounts.map((a, i) => {
      const b = balances.find((x) => x.account === a);
      return `<label>${esc(a)}<input name="bal_${i}" data-acc="${esc(a)}" inputmode="decimal" placeholder="Ikke fulgt" value="${b ? numToInput(b.amount) : ''}"></label>`;
    }).join('')}`;
  openModal({
    title: 'Opdatér kontosaldo', body, submitLabel: 'Gem saldo',
    onSubmit: async (fd, form) => {
      const out = [];
      for (const inp of form.querySelectorAll('[data-acc]')) {
        if (inp.value.trim() === '') continue;
        const v = parseAmount(inp.value);
        if (Number.isNaN(v)) { toast(`Ugyldigt beløb for ${inp.dataset.acc}`, 'error'); return false; }
        const old = balances.find((x) => x.account === inp.dataset.acc);
        out.push({ account: inp.dataset.acc, amount: v, date: old && old.amount === v ? old.date : isoDate() });
      }
      await saveBalances(out);
      toast('Saldo gemt');
    },
  });
}

// ---------- Poster grupperet ----------
function filterItems(items, today) {
  const now = dateToIndex(today);
  const q = ui.q.trim().toLowerCase();
  return items.filter((it) => {
    const inactive = !countsInBudget(it, now);
    if (ui.show === 'inactive' && !inactive) return false;
    if (ui.show !== 'inactive' && ui.show !== 'all' && it.type !== ui.show) return false;
    if (ui.who && it.who !== ui.who) return false;
    if (q && ![it.name, it.supplier, it.note, it.category, it.who, it.account].some((f) => String(f || '').toLowerCase().includes(q))) return false;
    return true;
  });
}

function groupsHtml(items, today, L) {
  const now = dateToIndex(today);
  const filtered = filterItems(items, today);
  if (!filtered.length) return '<div class="empty glass small"><p>Ingen poster matcher filteret.</p></div>';
  const out = [];
  for (const type of ['income', 'expense']) {
    const list = filtered.filter((i) => i.type === type);
    if (!list.length) continue;
    const byCat = new Map();
    for (const it of list) {
      const c = it.category || 'Uden kategori';
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(it);
    }
    const order = L.categories;
    const cats = [...byCat.keys()].sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b, 'da');
    });
    const typeTotal = list.filter((i) => countsInBudget(i, now)).reduce((s, i) => s + monthly(i), 0);
    out.push(`<h2 class="type-head ${type}">${type === 'income' ? 'Indtægter' : 'Udgifter'}<span>${kr(typeTotal)} / md.</span></h2>`);
    for (const c of cats) {
      const its = byCat.get(c).sort((a, b) => monthly(b) - monthly(a));
      const tot = its.filter((i) => countsInBudget(i, now)).reduce((s, i) => s + monthly(i), 0);
      const key = `${type}|${c}`;
      out.push(`<details class="group glass" data-group="${esc(key)}" ${ui.collapsed.has(key) ? '' : 'open'}>
        <summary><span class="chev"></span><span class="g-name">${esc(c)}</span><span class="g-count">${its.length}</span><span class="g-total">${kr(tot)}<small>/md.</small></span></summary>
        <div class="items">${its.map((it) => itemRow(it, today, L)).join('')}</div>
      </details>`);
    }
  }
  return out.join('');
}

function itemRow(it, today, L) {
  const inactive = !countsInBudget(it, dateToIndex(today));
  const np = inactive ? null : nextPayment(it, today);
  const meta = [
    it.supplier, it.who, it.account,
    freqLabel(it.freq, L.frequencies),
    np ? `næste ${np.day}. ${fmtYm(np.ym)}` : inactive ? 'inaktiv' : '',
  ].filter(Boolean).map(esc).join(' · ');
  return `<button class="item ${inactive ? 'inactive' : ''} ${it.type}" data-item="${it.id}">
    <div class="item-main">
      <div class="item-name">${esc(it.name)} ${it.private ? ICON.lock : ''}</div>
      <div class="item-meta">${meta}</div>
      ${it.note ? `<div class="item-note">${esc(it.note)}</div>` : ''}
    </div>
    <div class="item-amt">
      <div class="amt">${kr(monthly(it))}<small>/md.</small></div>
      ${Number(it.freq) > 1 ? `<div class="per">${kr(it.amount)} pr. betaling</div>` : ''}
    </div>
  </button>`;
}

// ---------- Opret / redigér post ----------
export function openItemModal(item = null, type = 'expense') {
  const editing = !!item?.id;
  const it = item || { type, freq: 1, payDay: 1, startMonth: currentYm(), active: true, account: type === 'expense' ? 'Budgetkonto' : 'Lønkonto' };
  const readOnly = !canEdit();
  const t = it.type;

  const body = `
    <div class="seg" role="radiogroup">
      <label><input type="radio" name="type" value="expense" ${t === 'expense' ? 'checked' : ''}><span>Udgift</span></label>
      <label><input type="radio" name="type" value="income" ${t === 'income' ? 'checked' : ''}><span>Indtægt</span></label>
    </div>
    <label>Navn<input name="name" required maxlength="120" value="${esc(it.name)}" placeholder="${t === 'income' ? 'f.eks. Løn, Børnepenge' : 'f.eks. Realkredit, Vinduespudser'}"></label>
    <div class="grid2">
      <label>Beløb pr. betaling (kr.)<input name="amount" required inputmode="decimal" value="${numToInput(it.amount)}" placeholder="0,00"></label>
      <label>Hvor ofte${freqSelect('freq', it.freq)}</label>
    </div>
    <div class="calc-preview" id="calc-preview"></div>
    <div class="grid3">
      <label>Første/næste betaling<input type="month" name="startMonth" value="${esc(it.startMonth || '')}" required></label>
      <label>Betalingsdag<input type="number" name="payDay" min="1" max="31" value="${esc(it.payDay || 1)}" required></label>
      <label>Slutter (valgfri)<input type="month" name="endMonth" value="${esc(it.endMonth || '')}"></label>
    </div>
    <div class="grid2">
      <label>Kategori${listSelect('category', 'categories', it.category)}</label>
      <label><span data-lbl="who">${t === 'income' ? 'Hvem tjener pengene' : 'Hvem betaler'}</span>${listSelect('who', 'people', it.who)}</label>
    </div>
    <div class="grid2">
      <label><span data-lbl="supplier">${t === 'income' ? 'Afsender' : 'Leverandør'}</span>${listSelect('supplier', 'suppliers', it.supplier)}</label>
      <label>Betalingsmetode${listSelect('method', 'methods', it.method)}</label>
    </div>
    <label><span data-lbl="account">${t === 'income' ? 'Går ind på konto' : 'Trækkes fra konto'}</span>${listSelect('account', 'accounts', it.account)}</label>
    <label>Kommentar / noter<textarea name="note" rows="2" maxlength="1000">${esc(it.note)}</textarea></label>
    <div class="checks">
      <label class="check"><input type="checkbox" name="active" ${it.active !== false ? 'checked' : ''}> Aktiv</label>
      <label class="check"><input type="checkbox" name="private" ${it.private ? 'checked' : ''}> Privat (skjules som standard ved deling/udskrift)</label>
    </div>
    ${editing && it.updatedAt ? `<p class="muted small">Sidst ændret ${fmtDate(it.updatedAt, true)}</p>` : ''}`;

  const buttons = [];
  if (editing && !readOnly) {
    buttons.push({ label: 'Slet', cls: 'danger-ghost', onClick: async () => {
      if (!(await confirmDialog(`Slet posten <b>${esc(it.name)}</b>?`))) return false;
      await deleteItem(it); toast('Posten er slettet');
    } });
    buttons.push({ label: 'Kopiér', cls: 'ghost', onClick: () => { const { id, ...copy } = it; openItemModal({ ...copy, name: `${it.name} (kopi)` }); } });
  }

  openModal({
    title: readOnly ? it.name : editing ? 'Redigér post' : t === 'income' ? 'Ny indtægt' : 'Ny udgift',
    body, readOnly, buttons,
    submitLabel: editing && it.id ? 'Gem ændringer' : 'Tilføj',
    onOpen: (form) => {
      bindListSelects(form);
      const upd = () => {
        const a = parseAmount(form.amount.value);
        const f = Number(form.freq.value) || 1;
        const type = form.querySelector('[name=type]:checked').value;
        form.querySelector('[data-lbl=who]').textContent = type === 'income' ? 'Hvem tjener pengene' : 'Hvem betaler';
        form.querySelector('[data-lbl=supplier]').textContent = type === 'income' ? 'Afsender' : 'Leverandør';
        form.querySelector('[data-lbl=account]').textContent = type === 'income' ? 'Går ind på konto' : 'Trækkes fra konto';
        const p = form.querySelector('#calc-preview');
        if (Number.isNaN(a)) { p.innerHTML = ''; return; }
        p.innerHTML = f === 1
          ? `= <b>${kr(a)}</b> pr. måned · <b>${kr(a * 12)}</b> pr. år`
          : `${kr(a)} ${esc(freqLabel(f, lists().frequencies).toLowerCase())} = <b>${kr(a / f)}</b> pr. måned · <b>${kr((a * 12) / f)}</b> pr. år`;
      };
      form.addEventListener('input', upd);
      form.addEventListener('change', upd);
      upd();
    },
    onSubmit: async (fd) => {
      const amount = parseAmount(fd.get('amount'));
      if (Number.isNaN(amount) || amount < 0) { toast('Indtast et gyldigt beløb', 'error'); return false; }
      const freq = parseInt(fd.get('freq'), 10);
      if (!(freq >= 1)) { toast('Vælg en frekvens', 'error'); return false; }
      const startMonth = fd.get('startMonth') || currentYm();
      const endMonth = fd.get('endMonth') || null;
      if (endMonth && ymToIndex(endMonth) < ymToIndex(startMonth)) { toast('Slutmåned ligger før første betaling', 'error'); return false; }
      const data = {
        type: fd.get('type'), name: String(fd.get('name')).trim(), amount: Math.round(amount * 100) / 100, freq,
        startMonth, endMonth, payDay: Math.min(31, Math.max(1, parseInt(fd.get('payDay'), 10) || 1)),
        category: fd.get('category') || '', who: fd.get('who') || '', supplier: fd.get('supplier') || '',
        method: fd.get('method') || '', account: fd.get('account') || '', note: String(fd.get('note') || '').trim(),
        active: fd.get('active') === 'on', private: fd.get('private') === 'on',
      };
      await saveItem(editing && it.id ? it.id : null, data, it);
      toast(editing && it.id ? 'Ændringer gemt' : `${data.type === 'income' ? 'Indtægt' : 'Udgift'} tilføjet`);
    },
  });
}
