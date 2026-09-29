// Budget-fanen: nøgletal i hverdagssprog, hvem betaler hvad, kontosaldo og alle poster med filter.
// Skallen (søgefelt, filtre, knapper) bygges én gang; kun tal og liste opdateres,
// så tastaturet ikke lukker, mens man søger.
import { state, canEdit, lists, jointAccounts, isShared, visibilityLabel, defaultVisibleTo, memberName } from '../state.js';
import {
  esc, kr, krSigned, fmtYm, fmtDate, openModal, confirmDialog, toast, parseAmount, numToInput,
  currentYm, isoDate, lsGet, lsSet,
} from '../ui.js';
import {
  monthly, summarize, calendarYear, requiredBalance, nextPayment, freqLabel, countsInBudget, dateToIndex, ymToIndex,
  indexToYm, paysIn, personSummary, shareOf,
} from '../calc.js';
import { saveItem, deleteItem, saveBalances, budgetRef } from '../data.js';
import { updateDoc, serverTimestamp } from '../firebase.js';
import {
  listSelect, freqSelect, bindListSelects, visibilityPicker, bindVisibility, readVisibility, splitEditor, bindSplit, readSplit,
} from '../forms.js';
import { helpBtn } from '../help.js';
import { openShareDialog } from './share.js';
import { openCompareDialog, openSaveSnapshot } from './compare.js';

const EMPTY_F = { type: 'all', status: 'active', person: '', cat: '', acc: '', freq: '', vis: '', month: '', min: '', max: '' };
const ui = { q: '', f: { ...EMPTY_F }, filtersOpen: false, collapsed: new Set(lsGet('bb:collapsed', [])) };

const ICON = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
  compare: '<svg viewBox="0 0 24 24"><path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>',
  filter: '<svg viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" class="mini"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
};

// ---------------------------------------------------------------------
export function render(root) {
  const L = lists();
  const key = `budget:${state.budgetId}:${canEdit()}:${JSON.stringify([L.people, L.categories, L.accounts, L.frequencies.map((f) => f.months)])}`;
  if (root.dataset.shell !== key) buildShell(root, L, key);
  update(root);
}

function buildShell(root, L, key) {
  root.dataset.shell = key;
  const months = Array.from({ length: 12 }, (_, i) => indexToYm(dateToIndex(new Date()) + i));
  root.innerHTML = `<div class="view-wrap">
    <section class="kpis" id="b-kpis"></section>
    <section id="b-persons"></section>
    <section id="b-balances"></section>
    <section class="toolbar glass">
      <div class="toolbar-row">
        <input id="b-q" type="search" placeholder="Søg efter en post, fx husleje…" value="${esc(ui.q)}" enterkeyhint="search" autocomplete="off">
        <button class="btn ghost filter-btn" id="b-fbtn" type="button">${ICON.filter}Filter<span class="badge-count hidden" id="b-fcount"></span></button>
      </div>
      <div class="filter-panel ${ui.filtersOpen ? '' : 'hidden'}" id="b-fpanel">
        <label>Vis<select data-f="type"><option value="all">Både ind og ud</option><option value="expense">Kun penge ud</option><option value="income">Kun penge ind</option></select></label>
        <label>Status<select data-f="status"><option value="active">Aktive poster</option><option value="inactive">Stoppede / udløbne</option><option value="all">Alle</option></select></label>
        <label>Person<select data-f="person"><option value="">Alle personer</option>${L.people.map((p) => `<option>${esc(p)}</option>`).join('')}</select></label>
        <label>Kategori<select data-f="cat"><option value="">Alle kategorier</option>${L.categories.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
        <label>Konto<select data-f="acc"><option value="">Alle konti</option>${L.accounts.map((a) => `<option>${esc(a)}</option>`).join('')}</select></label>
        <label>Hvor ofte<select data-f="freq"><option value="">Alle</option>${L.frequencies.map((f) => `<option value="${f.months}">${esc(f.label)}</option>`).join('')}</select></label>
        <label>Betales i<select data-f="month"><option value="">Alle måneder</option>${months.map((m) => `<option value="${m}">${fmtYm(m, true)}</option>`).join('')}</select></label>
        <label>Synlighed<select data-f="vis"><option value="">Alle</option><option value="shared">Delt med alle</option><option value="private">Private</option></select></label>
        <label>Pr. måned fra<input data-f="min" inputmode="decimal" placeholder="0 kr."></label>
        <label>Pr. måned til<input data-f="max" inputmode="decimal" placeholder="ingen grænse"></label>
        <div class="filter-foot"><button type="button" class="btn small ghost" id="b-freset">Nulstil filtre</button></div>
      </div>
      <div class="toolbar-row actions">
        ${canEdit() ? `<button class="btn primary" data-act="add-expense">${ICON.plus}Penge ud</button>
        <button class="btn success" data-act="add-income">${ICON.plus}Penge ind</button>` : ''}
        <span class="spacer"></span>
        <button class="btn ghost" data-act="compare" title="Se hvad der har ændret sig">${ICON.compare}<span class="hide-sm">Sammenlign</span></button>
        ${canEdit() ? `<button class="btn ghost" data-act="snapshot" title="Gem hvordan budgettet ser ud lige nu">${ICON.save}<span class="hide-sm">Gem version</span></button>` : ''}
        <button class="btn ghost" data-act="share" title="Hent som PDF/Excel, udskriv eller del med banken">${ICON.share}Hent / del</button>
      </div>
    </section>
    <div id="b-results"></div></div>`;
  const w = root.firstElementChild;

  // Filterfelter: sæt værdier og lyt — opdaterer kun resultatet
  root.querySelectorAll('[data-f]').forEach((el) => {
    el.value = ui.f[el.dataset.f];
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => { ui.f[el.dataset.f] = el.value; update(root); });
  });
  root.querySelector('#b-q').addEventListener('input', (e) => { ui.q = e.target.value; update(root); });
  root.querySelector('#b-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
  root.querySelector('#b-fbtn').onclick = () => { ui.filtersOpen = !ui.filtersOpen; root.querySelector('#b-fpanel').classList.toggle('hidden', !ui.filtersOpen); };
  root.querySelector('#b-freset').onclick = () => {
    ui.f = { ...EMPTY_F };
    root.querySelectorAll('[data-f]').forEach((el) => (el.value = ui.f[el.dataset.f]));
    update(root);
  };
  // Klik-håndtering via delegation (virker også for indhold der tegnes om)
  w.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'add-expense') openItemModal(null, 'expense');
    if (act === 'add-income') openItemModal(null, 'income');
    if (act === 'share') openShareDialog();
    if (act === 'compare') openCompareDialog();
    if (act === 'snapshot') openSaveSnapshot();
    if (act === 'balances') openBalancesModal();
    if (act === 'joint') openJointModal();
    const it = e.target.closest('[data-item]');
    if (it) { const x = state.items.find((i) => i.id === it.dataset.item); if (x) openItemModal(x); }
    const person = e.target.closest('[data-person-card]');
    if (person) {
      ui.f.person = person.dataset.personCard;
      root.querySelector('[data-f=person]').value = ui.f.person;
      ui.filtersOpen = true; root.querySelector('#b-fpanel').classList.remove('hidden');
      update(root);
      root.querySelector('#b-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  w.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d.matches?.('details[data-group]')) return;
    if (d.open) ui.collapsed.delete(d.dataset.group); else ui.collapsed.add(d.dataset.group);
    lsSet('bb:collapsed', [...ui.collapsed]);
  }, true);
}

function update(root) {
  const today = new Date();
  const items = state.items;
  const L = lists();
  const sum = summarize(items, today);
  const cal = calendarYear(items, today.getFullYear());
  const q = (id) => root.querySelector(id);

  q('#b-kpis').innerHTML = `
    ${kpi('Penge ind hver måned', kr(sum.income), 'pos', 'in', `${kr(sum.yearIncome, false)} om året`)}
    ${kpi('Penge ud hver måned', kr(sum.expense), 'neg', 'out', `${kr(sum.yearExpense, false)} om året`)}
    ${kpi('Tilbage hver måned', kr(sum.net), sum.net >= 0 ? 'pos' : 'neg', 'left', sum.net >= 0 ? '🟢 Der er penge tilovers' : '🔴 Der går flere penge ud end ind')}
    ${kpi('Hele året', kr(sum.yearNet, false), sum.yearNet >= 0 ? 'pos' : 'neg', 'year', `I ${today.getFullYear()} faktisk: ${krSigned(cal.net)}`)}`;
  q('#b-persons').innerHTML = personsHtml(items, L);
  q('#b-balances').innerHTML = balancesHtml(items, today);

  const active = activeFilterCount();
  const badge = q('#b-fcount');
  badge.textContent = active; badge.classList.toggle('hidden', !active);
  q('#b-fbtn').classList.toggle('on', active > 0);

  q('#b-results').innerHTML = !state.itemsLoaded ? '<div class="skeleton"></div>'
    : items.length === 0 ? emptyHtml() : groupsHtml(items, today, L);
}

const kpi = (label, value, cls, help, sub) => `
  <div class="kpi glass ${cls}"><div class="kpi-label">${esc(label)} ${helpBtn(help)}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${esc(sub)}</div></div>`;

function emptyHtml() {
  return `<div class="empty glass">
    <div class="empty-emoji">🧾</div>
    <h3>Budgettet er tomt</h3>
    <p>Start med det, der kommer ind (løn, børnepenge), og tilføj derefter de faste regninger (husleje, forsikringer, abonnementer).</p>
    ${canEdit() ? `<div class="row-center"><button class="btn success" data-act="add-income">＋ Første indtægt</button><button class="btn primary" data-act="add-expense">＋ Første udgift</button></div>` : ''}
  </div>`;
}

// ---------- Hvem betaler hvad ----------
function personsHtml(items, L) {
  const people = L.people.filter((p) => p !== 'Fælles');
  if (!items.length || !people.length) return '';
  const js = state.budget.settings?.jointSplit;
  const s = personSummary(items, { jointAccounts: jointAccounts(), jointSplit: js, people });
  const cards = s.persons.map((p) => `
    <button class="person-card glass" data-person-card="${esc(p.name)}" title="Vis ${esc(p.name)}s poster">
      <div class="pc-name">${esc(p.name)}</div>
      <div class="pc-total"><span>Skal af med</span><b>${kr(p.totalOut, false)}</b><small>/md.</small></div>
      <div class="pc-lines">
        <div><span>Egne regninger</span><span>${kr(p.ownExpense, false)}</span></div>
        <div><span>Til fælles (${Math.round((p.jointContribution / (s.joint.need || 1)) * 100) || 0} %)</span><span>${kr(p.jointContribution, false)}</span></div>
        <div class="sep"><span>Penge ind</span><span>${kr(p.income, false)}</span></div>
        <div class="${p.left >= 0 ? 'pos' : 'neg'}"><span>Tilbage til sig selv</span><b>${kr(p.left, false)}</b></div>
      </div>
    </button>`).join('');
  const joint = `
    <div class="person-card glass joint">
      <div class="pc-name">Fælles <span class="muted small">(${esc(jointAccounts().join(', ') || 'ingen fælleskonti')})</span></div>
      <div class="pc-total"><span>Fælles regninger</span><b>${kr(s.joint.expense, false)}</b><small>/md.</small></div>
      <div class="pc-lines">
        <div><span>Kommer direkte ind (fx børnepenge)</span><span>${kr(s.joint.income, false)}</span></div>
        <div class="sep"><span>Skal overføres af jer</span><b>${kr(s.joint.need, false)}</b></div>
        <div class="muted small">Fordeles ${Object.entries(s.split).filter(([n]) => people.includes(n)).map(([n, p]) => `${esc(n)} ${Math.round(p)} %`).join(' · ') || 'ligeligt'}</div>
      </div>
      ${canEdit() ? '<button class="btn small ghost" data-act="joint">Ret fordeling / fælleskonti</button>' : ''}
    </div>`;
  return `<div class="section-title"><h2>Hvem betaler hvad ${helpBtn('persons')}</h2><span class="muted small">Tryk på en person for at se deres poster</span></div>
    <div class="person-grid">${cards}${joint}</div>`;
}

function openJointModal() {
  const L = lists();
  const people = L.people.filter((p) => p !== 'Fælles');
  const ja = jointAccounts();
  const js = state.budget.settings?.jointSplit || {};
  const body = `
    <p class="muted small">Poster der trækkes fra (eller går ind på) en fælleskonto, deles automatisk som fælles. Vælg hvilke konti der er fælles:</p>
    <div class="checks">${L.accounts.map((a) => `<label class="check"><input type="checkbox" name="ja" value="${esc(a)}" ${ja.includes(a) ? 'checked' : ''}> ${esc(a)}</label>`).join('')}</div>
    <p class="muted small">Hvor stor en del af det, fælleskontoen mangler, skal hver person overføre?</p>
    ${people.map((p) => `<label class="split-row"><span>${esc(p)}</span><span class="pct"><input type="number" min="0" max="100" name="js_${esc(p)}" data-p="${esc(p)}" value="${js[p] ?? Math.round(100 / people.length)}"> %</span></label>`).join('')}
    <p class="small" id="js-sum"></p>`;
  openModal({
    title: 'Fælles udgifter', body, submitLabel: 'Gem',
    onOpen: (f) => {
      const upd = () => { const s = [...f.querySelectorAll('[data-p]')].reduce((a, i) => a + (Number(i.value) || 0), 0); const el = f.querySelector('#js-sum'); el.textContent = `I alt ${s} %`; el.className = `small ${s === 100 ? 'pos' : 'neg'}`; };
      f.addEventListener('input', upd); upd();
    },
    onSubmit: async (fd, f) => {
      const split = {};
      f.querySelectorAll('[data-p]').forEach((i) => (split[i.dataset.p] = Number(i.value) || 0));
      const sum = Object.values(split).reduce((a, b) => a + b, 0);
      if (people.length && Math.abs(sum - 100) > 0.01) { toast('Procenterne skal give 100 i alt', 'error'); return false; }
      await updateDoc(budgetRef(), { 'settings.jointAccounts': fd.getAll('ja'), 'settings.jointSplit': split, updatedAt: serverTimestamp() });
      toast('Fordeling gemt');
    },
  });
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
          <span>${diff >= 0 ? `🟢 Der er ${kr(diff)} mere end nødvendigt` : `🔴 Der mangler ${kr(-diff)}`}</span>
          <span class="muted small">Der bør stå ${kr(r.required)} · husk at overføre ${kr(r.monthlyTransfer)} hver måned</span>
        </div>` : '<div class="bal-status muted small">Der trækkes ingen regninger fra denne konto</div>'}
    </div>`;
  }).join('');
  return `<section class="balances glass">
    <div class="section-head">
      <h2>Hvad står der på kontoen? ${helpBtn('budgetkonto')}</h2>
      ${canEdit() ? '<button class="btn small ghost" data-act="balances">Skriv saldo</button>' : ''}
    </div>
    ${balances.length ? rows : '<p class="muted">Skriv hvad der står på budgetkontoen i netbanken, så kan appen fortælle om der er penge nok til de kommende regninger.</p>'}
    ${stale ? '<p class="hint warn">Mindst én saldo er over en uge gammel — skriv den nye saldo for at få præcise tal.</p>' : ''}
  </section>`;
}

function openBalancesModal() {
  const L = lists();
  const balances = state.budget.settings?.balances || [];
  const accounts = [...new Set([...L.accounts, ...balances.map((b) => b.account)])];
  const body = `
    <p class="muted small">Skriv saldoen som den står i netbanken i dag. Lad feltet være tomt for konti, du ikke vil følge.</p>
    ${accounts.map((a, i) => {
      const b = balances.find((x) => x.account === a);
      return `<label>${esc(a)}<input name="bal_${i}" data-acc="${esc(a)}" inputmode="decimal" placeholder="Ikke fulgt" value="${b ? numToInput(b.amount) : ''}"></label>`;
    }).join('')}`;
  openModal({
    title: 'Skriv kontosaldo', body, submitLabel: 'Gem saldo',
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

// ---------- Filter & grupper ----------
function activeFilterCount() {
  return Object.entries(ui.f).filter(([k, v]) => v !== EMPTY_F[k]).length;
}
function involves(it, person) {
  if (it.split && Number(it.split[person]) > 0) return true;
  if (person === 'Fælles') return shareOf(it, jointAccounts()).joint;
  return it.who === person;
}
function filterItems(items, today) {
  const now = dateToIndex(today);
  const q = ui.q.trim().toLowerCase();
  const f = ui.f;
  const min = parseAmount(f.min), max = parseAmount(f.max);
  return items.filter((it) => {
    const active = countsInBudget(it, now);
    if (f.status === 'active' && !active) return false;
    if (f.status === 'inactive' && active) return false;
    if (f.type !== 'all' && it.type !== f.type) return false;
    if (f.person && !involves(it, f.person)) return false;
    if (f.cat && (it.category || '') !== f.cat) return false;
    if (f.acc && (it.account || '') !== f.acc) return false;
    if (f.freq && Number(it.freq) !== Number(f.freq)) return false;
    if (f.vis === 'shared' && !isShared(it)) return false;
    if (f.vis === 'private' && isShared(it)) return false;
    if (f.month && !paysIn(it, ymToIndex(f.month))) return false;
    if (!Number.isNaN(min) && monthly(it) < min) return false;
    if (!Number.isNaN(max) && monthly(it) > max) return false;
    if (q && ![it.name, it.supplier, it.note, it.category, it.who, it.account].some((x) => String(x || '').toLowerCase().includes(q))) return false;
    return true;
  });
}

function groupsHtml(items, today, L) {
  const filtered = filterItems(items, today);
  const n = activeFilterCount() + (ui.q ? 1 : 0);
  const head = n ? `<p class="result-line"><b>${filtered.length}</b> af ${items.length} poster vises · i alt ${kr(filtered.filter((i) => i.type === 'expense').reduce((s, i) => s + monthly(i), 0))}/md. ud og ${kr(filtered.filter((i) => i.type === 'income').reduce((s, i) => s + monthly(i), 0))}/md. ind</p>` : '';
  if (!filtered.length) return `${head}<div class="empty glass small"><p>Ingen poster passer til søgningen eller filtret.</p></div>`;
  const out = [head];
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
    const typeTotal = list.reduce((s, i) => s + (countsInBudget(i, dateToIndex(today)) ? monthly(i) : 0), 0);
    out.push(`<h2 class="type-head ${type}">${type === 'income' ? 'Penge ind' : 'Penge ud'}<span>${kr(typeTotal)} / md.</span></h2>`);
    for (const c of cats) {
      const its = byCat.get(c).sort((a, b) => monthly(b) - monthly(a));
      const tot = its.reduce((s, i) => s + (countsInBudget(i, dateToIndex(today)) ? monthly(i) : 0), 0);
      const key = `${type}|${c}`;
      out.push(`<details class="group glass" data-group="${esc(key)}" ${ui.collapsed.has(key) && !n ? '' : 'open'}>
        <summary><span class="chev"></span><span class="g-name">${esc(c)}</span><span class="g-count">${its.length}</span><span class="g-total">${kr(tot)}<small>/md.</small></span></summary>
        <div class="items">${its.map((it) => itemRow(it, today, L)).join('')}</div>
      </details>`);
    }
  }
  return out.join('');
}

function splitText(it) {
  const s = shareOf(it, jointAccounts());
  if (s.joint) return 'Fælles';
  return Object.entries(s.parts).map(([n, a]) => (Object.keys(s.parts).length > 1 ? `${n} ${Math.round((a / (monthly(it) || 1)) * 100)} %` : n)).join(' · ');
}
function itemRow(it, today, L) {
  const inactive = !countsInBudget(it, dateToIndex(today));
  const np = inactive ? null : nextPayment(it, today);
  const meta = [
    splitText(it), it.supplier, it.account,
    freqLabel(it.freq, L.frequencies),
    np ? `næste ${np.day}. ${fmtYm(np.ym)}` : inactive ? 'stoppet' : '',
  ].filter(Boolean).map(esc).join(' · ');
  return `<button class="item ${inactive ? 'inactive' : ''} ${it.type}" data-item="${it.id}">
    <div class="item-main">
      <div class="item-name">${esc(it.name)} ${!isShared(it) ? `<span class="vis-tag">${ICON.lock}${esc(visibilityLabel(it))}</span>` : ''}</div>
      <div class="item-meta">${meta}</div>
      ${it.note ? `<div class="item-note">${esc(it.note)}</div>` : ''}
    </div>
    <div class="item-amt">
      <div class="amt">${kr(monthly(it))}<small>/md.</small></div>
      ${Number(it.freq) > 1 ? `<div class="per">${kr(it.amount)} pr. gang</div>` : ''}
    </div>
  </button>`;
}

// ---------- Opret / redigér post ----------
const HINT_FIELDS = ['name', 'amount', 'freq', 'startMonth', 'payDay', 'endMonth', 'category', 'who', 'supplier', 'method', 'account'];

export function openItemModal(item = null, type = 'expense') {
  const editing = !!item?.id;
  const it = item || { type, freq: 1, payDay: 1, startMonth: currentYm(), active: true, account: type === 'expense' ? 'Budgetkonto' : 'Lønkonto', visibleTo: defaultVisibleTo() };
  const readOnly = !canEdit();
  const t = it.type;
  const hist = [...(it.history || [])].reverse();
  const last = hist[0];

  const body = `
    ${last ? `<div class="last-change">✏️ Sidst ændret ${fmtDate(new Date(last.at), true)} af ${esc(last.by)}: ${changesText(last.changes)}</div>` : ''}
    <div class="seg" role="radiogroup">
      <label><input type="radio" name="type" value="expense" ${t === 'expense' ? 'checked' : ''}><span>Penge ud</span></label>
      <label><input type="radio" name="type" value="income" ${t === 'income' ? 'checked' : ''}><span>Penge ind</span></label>
    </div>
    <label>Hvad hedder den?<input name="name" required maxlength="120" value="${esc(it.name)}" placeholder="${t === 'income' ? 'fx Løn, Børnepenge' : 'fx Husleje, Bilforsikring'}"></label>
    <div class="grid2">
      <label>Beløb hver gang (kr.)<input name="amount" required inputmode="decimal" value="${numToInput(it.amount)}" placeholder="0,00"></label>
      <label><span>Hvor ofte ${helpBtn('freq')}</span>${freqSelect('freq', it.freq)}</label>
    </div>
    <div class="calc-preview" id="calc-preview"></div>
    <div class="grid3">
      <label>Første/næste betaling<input type="month" name="startMonth" value="${esc(it.startMonth || '')}" required></label>
      <label>Dag i måneden<input type="number" name="payDay" min="1" max="31" value="${esc(it.payDay || 1)}" required></label>
      <label>Stopper (valgfri)<input type="month" name="endMonth" value="${esc(it.endMonth || '')}"></label>
    </div>
    <div class="grid2">
      <label>Kategori${listSelect('category', 'categories', it.category)}</label>
      <label><span data-lbl="who">${t === 'income' ? 'Hvem får pengene' : 'Hvem betaler'}</span>${listSelect('who', 'people', it.who)}</label>
    </div>
    <div class="grid2">
      <label><span data-lbl="supplier">${t === 'income' ? 'Afsender' : 'Leverandør'}</span>${listSelect('supplier', 'suppliers', it.supplier)}</label>
      <label>Betales med${listSelect('method', 'methods', it.method)}</label>
    </div>
    <label><span data-lbl="account">${t === 'income' ? 'Går ind på konto' : 'Trækkes fra konto'}</span>${listSelect('account', 'accounts', it.account)}</label>
    ${splitEditor(it)}
    <label>Kommentar / noter<textarea name="note" rows="2" maxlength="1000">${esc(it.note)}</textarea></label>
    ${visibilityPicker(it)}
    <label class="check"><input type="checkbox" name="active" ${it.active !== false ? 'checked' : ''}> Aktiv (fjern fluebenet hvis den er stoppet, men du vil gemme den)</label>
    ${hist.length ? `<details class="history"><summary>Historik (${hist.length} ændringer)</summary><ul>${hist.map((h) => `<li><span class="muted small">${fmtDate(new Date(h.at), true)} · ${esc(h.by)}</span><br>${changesText(h.changes)}</li>`).join('')}</ul></details>` : ''}
    ${editing ? `<p class="muted small">Oprettet ${it.createdByName ? `af ${esc(it.createdByName)} ` : ''}${fmtDate(it.createdAt)}</p>` : ''}`;

  const buttons = [];
  if (editing && !readOnly) {
    buttons.push({ label: 'Slet', cls: 'danger-ghost', onClick: async () => {
      if (!(await confirmDialog(`Slet posten <b>${esc(it.name)}</b>?`))) return false;
      await deleteItem(it); toast('Posten er slettet');
    } });
    buttons.push({ label: 'Kopiér', cls: 'ghost', onClick: () => { const { id, history, ...copy } = it; openItemModal({ ...copy, name: `${it.name} (kopi)` }); } });
  }

  openModal({
    title: readOnly ? it.name : editing ? 'Ret post' : t === 'income' ? 'Nye penge ind' : 'Ny regning / penge ud',
    body, readOnly, buttons, wide: true,
    submitLabel: editing ? 'Gem ændringer' : 'Tilføj',
    onOpen: (form) => {
      bindListSelects(form);
      bindVisibility(form);
      const getMonthly = () => { const a = parseAmount(form.amount.value); return Number.isNaN(a) ? 0 : a / (Number(form.freq.value) || 1); };
      bindSplit(form, getMonthly);
      // "Før: …" ved felter man ændrer
      if (editing) {
        for (const k of HINT_FIELDS) {
          const el = form.elements[k];
          if (!el) continue;
          const orig = it[k] ?? '';
          const was = document.createElement('small');
          was.className = 'was hidden';
          was.textContent = `Før: ${k === 'amount' ? kr(orig) : k === 'freq' ? freqLabel(orig, lists().frequencies) : orig || '(tom)'}`;
          el.closest('label')?.appendChild(was);
          const cmp = () => {
            const v = k === 'amount' ? parseAmount(el.value) : el.value;
            was.classList.toggle('hidden', String(v) === String(orig) || (k === 'amount' && Number(v) === Number(orig)));
          };
          el.addEventListener('input', cmp); el.addEventListener('change', cmp);
        }
      }
      const upd = () => {
        const a = parseAmount(form.amount.value);
        const f = Number(form.freq.value) || 1;
        const type = form.querySelector('[name=type]:checked').value;
        form.querySelector('[data-lbl=who]').textContent = type === 'income' ? 'Hvem får pengene' : 'Hvem betaler';
        form.querySelector('[data-lbl=supplier]').textContent = type === 'income' ? 'Afsender' : 'Leverandør';
        form.querySelector('[data-lbl=account]').textContent = type === 'income' ? 'Går ind på konto' : 'Trækkes fra konto';
        const p = form.querySelector('#calc-preview');
        if (Number.isNaN(a)) { p.innerHTML = ''; return; }
        p.innerHTML = f === 1
          ? `Det er <b>${kr(a)}</b> om måneden og <b>${kr(a * 12)}</b> om året`
          : `${kr(a)} ${esc(freqLabel(f, lists().frequencies).toLowerCase())} svarer til <b>${kr(a / f)}</b> om måneden og <b>${kr((a * 12) / f)}</b> om året`;
      };
      form.addEventListener('input', upd);
      form.addEventListener('change', upd);
      upd();
    },
    onSubmit: async (fd, form) => {
      const amount = parseAmount(fd.get('amount'));
      if (Number.isNaN(amount) || amount < 0) { toast('Skriv et gyldigt beløb', 'error'); return false; }
      const freq = parseInt(fd.get('freq'), 10);
      if (!(freq >= 1)) { toast('Vælg hvor ofte', 'error'); return false; }
      const startMonth = fd.get('startMonth') || currentYm();
      const endMonth = fd.get('endMonth') || null;
      if (endMonth && ymToIndex(endMonth) < ymToIndex(startMonth)) { toast('Stop-måneden ligger før første betaling', 'error'); return false; }
      let split;
      try { split = readSplit(form); } catch (e) { toast(e.message, 'error'); return false; }
      const data = {
        type: fd.get('type'), name: String(fd.get('name')).trim(), amount: Math.round(amount * 100) / 100, freq,
        startMonth, endMonth, payDay: Math.min(31, Math.max(1, parseInt(fd.get('payDay'), 10) || 1)),
        category: fd.get('category') || '', who: fd.get('who') || '', supplier: fd.get('supplier') || '',
        method: fd.get('method') || '', account: fd.get('account') || '', note: String(fd.get('note') || '').trim(),
        active: fd.get('active') === 'on', split, visibleTo: readVisibility(form),
      };
      await saveItem(editing ? it.id : null, data, it);
      toast(editing ? 'Ændringer gemt — den gamle værdi ligger i historikken' : `${data.type === 'income' ? 'Indtægt' : 'Udgift'} tilføjet`);
    },
  });
}

function changesText(changes) {
  if (!changes) return '';
  return Object.entries(changes).map(([k, v]) => {
    const f = (x) => (k === 'Beløb' && x !== '' && !Number.isNaN(Number(x)) ? kr(Number(x)) : x === '' || x === null || x === undefined ? '(tom)' : typeof x === 'boolean' ? (x ? 'ja' : 'nej') : x);
    return `<span class="chg">${esc(k)}: <s>${esc(f(v.from))}</s> → <b>${esc(f(v.to))}</b></span>`;
  }).join(' ');
}
export { changesText };
