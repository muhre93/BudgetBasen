// Budget-fanen: nøgletal i hverdagssprog, hvem betaler hvad, kontosaldo og alle poster med filter.
// Skallen (søgefelt, filtre, knapper) bygges én gang; kun tal og liste opdateres,
// så tastaturet ikke lukker, mens man søger.
import { isSimple, getPrefs, setPrefs } from '../prefs.js';
import { getConfig, SECTIONS, feature } from '../config.js';
import { renderSimple } from './simple.js';
import { state, canEdit, lists, jointAccounts, savingsAccounts, isShared, visibilityLabel, defaultVisibleTo, TYPE_PLURAL, TYPE_LABEL } from '../state.js';
import {
  esc, kr, krSigned, fmtYm, fmtDate, openModal, confirmDialog, toast, parseAmount, numToInput,
  currentYm, isoDate, lsGet, lsSet,
} from '../ui.js';
import {
  monthly, summarize, calendarYear, requiredBalance, nextPayment, freqLabel, countsInBudget, dateToIndex, ymToIndex,
  indexToYm, paysIn, personSummary, shareOf, touchesAccount, isTransfer, accountFunding, spendable, upcomingPayments, isPaused, bankDaysOn,
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
const ui = { q: '', f: { ...EMPTY_F }, filtersOpen: false, view: '', collapsed: new Set(lsGet('bb:collapsed', [])) };
const viewOpts = () => ({ account: ui.view || null, savingsAccounts: savingsAccounts() });

const ICON = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
  compare: '<svg viewBox="0 0 24 24"><path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>',
  filter: '<svg viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>',
  transfer: '<svg viewBox="0 0 24 24"><path d="M4 9h13l-4-4M20 15H7l4 4"/></svg>',
  lock: '<svg viewBox="0 0 24 24" class="mini"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
};

// ---------------------------------------------------------------------
export function render(root) {
  if (isSimple()) { root.dataset.shell = 'simple'; renderSimple(root); return; }
  const L = lists();
  const key = `budget:${state.budgetId}:${canEdit()}:${JSON.stringify([L.people, L.categories, L.accounts, L.frequencies.map((f) => f.months)])}`;
  if (root.dataset.shell !== key) buildShell(root, L, key);
  update(root);
}

function buildShell(root, L, key) {
  root.dataset.shell = key;
  const months = Array.from({ length: 12 }, (_, i) => indexToYm(dateToIndex(new Date()) + i));
  root.innerHTML = `<div class="view-wrap">
    <div id="b-simple-hint">${!lsGet('bb:simpleHint', false) && feature('simple') ? `<div class="simple-hint glass"><span>✨ <b>Er det lidt meget på én gang?</b> Prøv simpel visning — kun de vigtigste tal, og "Tilføj" spørger om én ting ad gangen. Du kan altid skifte med knappen øverst.</span>
      <span class="btn-row"><button class="btn small primary" data-act="try-simple">Prøv simpel visning</button><button class="hide-x" data-act="no-simple" aria-label="Luk">✕</button></span></div>` : ''}</div>
    <section class="acct-view" id="b-view"></section>
    <section class="kpis" id="b-kpis"></section>
    <section class="funding" id="b-funding"></section>
    <section id="b-persons"></section>
    <section id="b-balances"></section>
    <section class="toolbar glass">
      <div class="toolbar-row">
        <input id="b-q" type="search" placeholder="Søg efter en post, fx husleje…" value="${esc(ui.q)}" enterkeyhint="search" autocomplete="off">
        <button class="btn ghost filter-btn" id="b-fbtn" type="button">${ICON.filter}Filter<span class="badge-count hidden" id="b-fcount"></span></button>
      </div>
      <div class="filter-panel ${ui.filtersOpen ? '' : 'hidden'}" id="b-fpanel">
        <label>Vis<select data-f="type"><option value="all">Alt</option><option value="expense">Kun udgifter</option><option value="income">Kun indtægter</option><option value="transfer">Kun opsparing & overførsler</option></select></label>
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
        ${canEdit() ? `<button class="btn primary" data-act="add">${ICON.plus}Tilføj</button>` : ''}
        <span class="spacer"></span>
        <button class="btn ghost" data-act="compare" title="Se hvad der har ændret sig">${ICON.compare}<span class="hide-sm">Sammenlign</span></button>
        ${canEdit() ? `<button class="btn ghost" data-act="snapshot" title="Gem hvordan budgettet ser ud lige nu">${ICON.save}<span class="hide-sm">Gem version</span></button>` : ''}
        <button class="btn ghost" data-act="share" title="Hent som PDF/Excel, udskriv eller del med banken">${ICON.share}Hent / del</button>
      </div>
    </section>
    <div id="b-results"></div>
    ${canEdit() ? `<button class="fab" data-act="add" aria-label="Tilføj indtægt, udgift eller overførsel">${ICON.plus}<span>Tilføj</span></button>` : ''}</div>`;
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
    if (act === 'add-transfer') openItemModal(null, 'transfer');
    const v = e.target.closest('[data-view-acc]');
    if (v) { ui.view = v.dataset.viewAcc; update(root); }
    if (act === 'share') openShareDialog();
    if (act === 'compare') openCompareDialog();
    if (act === 'snapshot') openSaveSnapshot();
    if (act === 'add') openAddChooser();
    if (act === 'add-to-acc') { const acc = e.target.closest('[data-acc]').dataset.acc; openItemModal({ type: 'transfer', name: `Til ${acc}`, amount: '', freq: 1, payDay: 1, account: guessSalaryAccount(acc), toAccount: acc, active: true, startMonth: currentYm(), visibleTo: defaultVisibleTo() }); }
    if (act === 'try-simple') { lsSet('bb:simpleHint', true); setPrefs({ simple: true }); }
    if (act === 'no-simple') { lsSet('bb:simpleHint', true); root.querySelector('#b-simple-hint').innerHTML = ''; }
    const hb = e.target.closest('[data-hide-box]');
    if (hb) { setPrefs({ hidden: [...new Set([...(getPrefs().hidden || []), hb.dataset.hideBox])] }); toast('Boksen er skjult. Du kan vise den igen under Admin → Udseende.'); }
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

function viewAccounts(L) {
  const balances = (state.budget.settings?.balances || []).map((b) => b.account);
  const used = new Set([...balances, ...state.items.flatMap((i) => [i.account, i.toAccount]).filter(Boolean)]);
  return L.accounts.filter((a) => used.has(a)).concat([...used].filter((a) => !L.accounts.includes(a)));
}

/** Rækkefølge og skjulte kasser fra Ejer-admin. */
function applyLayout(root) {
  const { order } = getConfig().layout;
  const hidden = [...getConfig().layout.hidden, ...(getPrefs().hidden || [])];
  const w = root.firstElementChild;
  const listPos = order.indexOf('list');
  for (const el of w.children) {
    if (el.id === 'b-simple-hint') { el.style.order = '-1'; continue; }
    const sec = SECTIONS.find((x) => x.el && el.matches(x.el));
    const id = sec ? sec.id : 'list';
    el.style.order = String(id === 'list' ? listPos : order.indexOf(id));
    el.classList.toggle('layout-hidden', hidden.includes(id));
  }
}

function update(root) {
  applyLayout(root);
  const today = new Date();
  const L = lists();
  const accs = viewAccounts(L);
  if (ui.view && !accs.includes(ui.view)) ui.view = '';
  const opts = viewOpts();
  const allItems = state.items;
  const items = ui.view ? allItems.filter((i) => touchesAccount(i, ui.view)) : allItems;
  const sum = summarize(allItems, today, opts);
  const cal = calendarYear(allItems, today.getFullYear(), opts);
  const q = (id) => root.querySelector(id);
  const isSav = ui.view && savingsAccounts().includes(ui.view);
  const bal = (state.budget.settings?.balances || []).find((b) => b.account === ui.view);

  q('#b-view').innerHTML = accs.length ? `
    <span class="av-label">Vis ${helpBtn('accountView')}</span>
    <div class="av-chips">
      <button type="button" class="av-chip ${!ui.view ? 'on' : ''}" data-view-acc="">🏠 Hele budgettet</button>
      ${accs.map((a) => `<button type="button" class="av-chip ${ui.view === a ? 'on' : ''}" data-view-acc="${esc(a)}">${accIcon(a)} ${esc(a)}</button>`).join('')}
    </div>` : '';

  if (!ui.view) {
    q('#b-kpis').innerHTML = `
      ${kpi('Indtægter hver måned', kr(sum.income), 'pos', 'in', `${kr(sum.yearIncome, false)} om året`)}
      ${kpi('Udgifter hver måned', kr(sum.expense), 'neg', 'out', `${kr(sum.yearExpense, false)} om året`)}
      ${kpi('Opsparing hver måned', kr(sum.saving), 'save', 'saving', `${kr(sum.yearSaving, false)} om året`)}
      ${kpi('Tilbage af lønnen', kr(sum.left), sum.left >= 0 ? 'pos' : 'neg', 'left', sum.shortage > 0.5 ? `Til forbrug · 🔴 ${sum.funding.filter((f) => f.diff < -0.5).map((f) => f.account).join(' og ')} mangler ${kr(sum.shortage, false)}/md.` : sum.excess > 0.5 ? `Til forbrug · ${kr(sum.excess, false)} ekstra står på ${sum.funding.filter((f) => f.excess > 0.5).map((f) => f.account).join(' og ')}` : `${sum.left >= 0 ? '🟢 Der er penge tilovers' : '🔴 Der går flere penge ud end ind'} · ${kr(sum.yearLeft, false)} om året`)}`;
  } else if (isSav) {
    const now = Number(bal?.amount) || 0;
    q('#b-kpis').innerHTML = `
      ${kpi(`Sættes ind på ${ui.view}`, kr(sum.income), 'pos', 'saving', 'hver måned')}
      ${kpi('Hæves / trækkes', kr(sum.expense), 'neg', 'saving', 'hver måned')}
      ${kpi('Vokser med', kr(sum.net), sum.net >= 0 ? 'pos' : 'neg', 'saving', `${kr(sum.yearNet, false)} om året`)}
      ${kpi('Om 12 måneder', kr(now + sum.yearNet, false), 'save', 'saving', bal ? `står der ca. (nu: ${kr(now, false)})` : 'skriv saldoen for at se det rigtige tal')}`;
  } else {
    q('#b-kpis').innerHTML = `
      ${kpi(`Kommer ind på ${ui.view}`, kr(sum.income), 'pos', 'acctIn', 'hver måned — løn og overførsler')}
      ${kpi(`Går ud fra ${ui.view}`, kr(sum.expense), 'neg', 'acctOut', 'hver måned — regninger og overførsler')}
      ${kpi(`Tilbage på ${ui.view}`, kr(sum.net), sum.net >= 0 ? 'pos' : 'neg', 'acctLeft', sum.net >= 0 ? '🟢 Kontoen hænger sammen' : '🔴 Der går mere ud end ind')}
      ${kpi('Står på kontoen nu', bal ? kr(bal.amount) : '–', 'acct', 'budgetkonto', bal ? `skrevet ${fmtDate(bal.date)}` : 'skriv saldoen nedenfor')}`;
  }
  const funding = accountFunding(allItems, { savingsAccounts: savingsAccounts(), today }).filter((f) => !ui.view || f.account === ui.view);
  q('#b-funding').innerHTML = funding.length ? `<div class="fund-wrap">${funding.map(fundingLine).join('')}${hideBtn('funding')}</div>` : '';
  q('#b-persons').innerHTML = ui.view ? '' : personsHtml(allItems, L);
  q('#b-balances').innerHTML = balancesHtml(allItems, today, ui.view);

  const active = activeFilterCount();
  const badge = q('#b-fcount');
  badge.textContent = active; badge.classList.toggle('hidden', !active);
  q('#b-fbtn').classList.toggle('on', active > 0);

  q('#b-results').innerHTML = !state.itemsLoaded ? '<div class="skeleton"></div>'
    : allItems.length === 0 ? emptyHtml() : items.length === 0 ? `<div class="empty glass small"><p>Der er ingen poster på ${esc(ui.view)} endnu.</p></div>` : groupsHtml(items, today, L);
}

const accIcon = (a) => (savingsAccounts().includes(a) ? '💵' : jointAccounts().includes(a) ? '👨‍👩‍👧' : '💳');

/** Én linje pr. konto der får overførsler: passer / for meget / mangler. */
function fundingLine(f) {
  const cls = f.status === 'ok' ? 'ok' : f.status === 'over' ? 'warn' : 'neg';
  const icon = f.status === 'ok' ? '🟢' : f.status === 'over' ? '🟡' : '🔴';
  const txt = f.status === 'ok'
    ? `<b>${esc(f.account)} passer.</b> I overfører ${kr(f.transferIn, false)}, og regningerne koster ${kr(f.needs, false)} om måneden.`
    : f.status === 'over'
      ? `<b>${esc(f.account)}: I overfører ${kr(f.diff, false)} for meget hver måned.</b> I overfører ${kr(f.transferIn, false)}, men regningerne koster ${kr(f.needs, false)} om måneden. Pengene samler sig på kontoen.`
      : `<b>${esc(f.account)} mangler ${kr(-f.diff, false)} hver måned.</b> I overfører ${kr(f.transferIn, false)}, men regningerne koster ${kr(f.needs, false)} om måneden. Hæv overførslen til ca. ${kr(Math.ceil(f.needs / 100) * 100, false)} om måneden.`;
  return `<div class="fund-line ${cls}"><span class="fl-ico">${icon}</span><span>${txt}</span></div>`;
}

const kpi = (label, value, cls, help, sub) => `
  <div class="kpi glass ${cls}"><div class="kpi-label">${esc(label)} ${helpBtn(help)}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${esc(sub)}</div></div>`;

function emptyHtml() {
  return `<div class="empty glass">
    <div class="empty-emoji">🧾</div>
    <h3>Budgettet er tomt</h3>
    <p>Start med det, der kommer ind (løn, børnepenge), og tilføj derefter de faste regninger (husleje, forsikringer, abonnementer).</p>
    ${canEdit() ? `<div class="row-center"><button class="btn primary" data-act="add-expense">＋ Første udgift</button><button class="btn success" data-act="add-income">＋ Første indtægt</button></div>` : ''}
  </div>`;
}

// ---------- Hvem betaler hvad ----------
function personsHtml(items, L) {
  const people = L.people.filter((p) => p !== 'Fælles');
  if (!items.length || !people.length) return '';
  const js = state.budget.settings?.jointSplit;
  const showJoint = state.budget.settings?.showJoint !== false;
  const s = personSummary(items, { jointAccounts: showJoint ? jointAccounts() : [], jointSplit: js, people, savingsAccounts: savingsAccounts() });
  // Kun én person med penge ind eller ud, og intet fælles → boksen giver ingen mening
  const activePeople = s.persons.filter((p) => p.income > 0.5 || p.totalOut > 0.5 || p.saving > 0.5);
  if (activePeople.length <= 1 && s.joint.expense + s.joint.saving < 0.5) return '';
  const cards = s.persons.map((p) => `
    <button class="person-card glass" data-person-card="${esc(p.name)}" title="Vis ${esc(p.name)}s poster">
      <div class="pc-name">${esc(p.name)}</div>
      <div class="pc-total"><span>Skal af med</span><b>${kr(p.totalOut, false)}</b><small>/md.</small></div>
      <div class="pc-lines">
        <div><span>Egne regninger</span><span>${kr(p.ownExpense, false)}</span></div>
        ${showJoint || p.jointContribution > 0.5 ? `<div><span>${showJoint ? "Til fælles" : "Delte regninger"} (${Math.round((p.jointContribution / (s.joint.need || 1)) * 100) || 0} %)</span><span>${kr(p.jointContribution, false)}</span></div>` : ''}
        ${p.saving ? `<div><span>Opsparing</span><span>${kr(p.saving, false)}</span></div>` : ''}
        ${p.parked > 0.5 ? `<div class="warn-line"><span>Overført ekstra</span><span>${kr(p.parked, false)}</span></div>` : ''}
        ${p.parked < -0.5 ? `<div class="warn-line neg"><span>Mangler at overføre</span><span>${kr(-p.parked, false)}</span></div>` : ''}
        <div class="sep"><span>Indtægter</span><span>${kr(p.income, false)}</span></div>
        <div class="${p.left >= 0 ? 'pos' : 'neg'}"><span>Tilbage til sig selv</span><b>${kr(p.left, false)}</b></div>
      </div>
    </button>`).join('');
  const joint = `
    <div class="person-card glass joint">
      <div class="pc-name">Fælles <span class="muted small">(${esc(jointAccounts().join(', ') || 'ingen fælleskonti')})</span></div>
      <div class="pc-total"><span>Fælles regninger${s.joint.saving ? ' + opsparing' : ''}</span><b>${kr(s.joint.expense + s.joint.saving, false)}</b><small>/md.</small></div>
      <div class="pc-lines">
        <div><span>Kommer direkte ind (fx børnepenge)</span><span>${kr(s.joint.income, false)}</span></div>
        <div class="sep"><span>Skal overføres af jer</span><b>${kr(s.joint.need, false)}</b></div>
        <div class="muted small">Fordeles ${Object.entries(s.split).filter(([n]) => people.includes(n)).map(([n, p]) => `${esc(n)} ${Math.round(p)} %`).join(' · ') || 'ligeligt'}</div>
      </div>
      ${canEdit() ? '<button class="btn small ghost" data-act="joint">Ret fordeling / fælleskonti</button>' : ''}
    </div>`;
  return `<div class="section-title"><h2>Hvem betaler hvad ${helpBtn('persons')}</h2>
      <span class="st-actions"><span class="muted small">Tryk på en person for at se deres poster</span>${!showJoint && canEdit() ? '<button class="btn small ghost" data-act="joint">Fælles-indstillinger</button>' : ''}${hideBtn('persons')}</span></div>
    <div class="person-grid">${cards}${showJoint ? joint : ''}</div>`;
}

function openJointModal() {
  const L = lists();
  const people = L.people.filter((p) => p !== 'Fælles');
  const ja = jointAccounts();
  const js = state.budget.settings?.jointSplit || {};
  const showJoint = state.budget.settings?.showJoint !== false;
  const body = `
    <label class="check big-check"><input type="checkbox" name="showJoint" ${showJoint ? 'checked' : ''}> Vis "Fælles" under Hvem betaler hvad</label>
    <p class="muted small">Slå fra, hvis du er alene om budgettet eller I ikke har en fælles konto.</p>
    <div class="joint-settings">
    <p class="muted small">Poster der trækkes fra (eller går ind på) en fælleskonto, deles automatisk som fælles. Vælg hvilke konti der er fælles:</p>
    <div class="checks">${L.accounts.map((a) => `<label class="check"><input type="checkbox" name="ja" value="${esc(a)}" ${ja.includes(a) ? 'checked' : ''}> ${esc(a)}</label>`).join('')}</div>
    <p class="muted small">Hvor stor en del af det, fælleskontoen mangler, skal hver person overføre?</p>
    ${people.map((p) => `<label class="split-row"><span>${esc(p)}</span><span class="pct"><input type="number" min="0" max="100" name="js_${esc(p)}" data-p="${esc(p)}" value="${js[p] ?? Math.round(100 / people.length)}"> %</span></label>`).join('')}
    <p class="small" id="js-sum"></p>
    </div>`;
  openModal({
    title: 'Fælles udgifter', body, submitLabel: 'Gem',
    onOpen: (f) => {
      const tog = () => f.querySelector('.joint-settings').classList.toggle('hidden', !f.showJoint.checked);
      f.showJoint.addEventListener('change', tog); tog();
      const upd = () => { const s = [...f.querySelectorAll('[data-p]')].reduce((a, i) => a + (Number(i.value) || 0), 0); const el = f.querySelector('#js-sum'); el.textContent = `I alt ${s} %`; el.className = `small ${s === 100 ? 'pos' : 'neg'}`; };
      f.addEventListener('input', upd); upd();
    },
    onSubmit: async (fd, f) => {
      const split = {};
      f.querySelectorAll('[data-p]').forEach((i) => (split[i.dataset.p] = Number(i.value) || 0));
      const sum = Object.values(split).reduce((a, b) => a + b, 0);
      const on = f.showJoint.checked;
      if (on && people.length && Math.abs(sum - 100) > 0.01) { toast('Procenterne skal give 100 i alt', 'error'); return false; }
      await updateDoc(budgetRef(), { 'settings.showJoint': on, 'settings.jointAccounts': on ? fd.getAll('ja') : [], 'settings.jointSplit': split, updatedAt: serverTimestamp() });
      toast('Fordeling gemt');
    },
  });
}

// ---------- Kontosaldo & budgetkonto-status ----------
function balancesHtml(items, today, only = '') {
  const balances = (state.budget.settings?.balances || []).filter((b) => !only || b.account === only);
  const stale = balances.some((b) => b.date && (today - new Date(b.date)) / 864e5 > 7);
  const rows = balances.map((b) => {
    const touches = items.some((i) => i.active !== false && touchesAccount(i, b.account));
    const sp = touches ? spendable(items, b.account, Number(b.amount) || 0, today) : null;
    let status;
    if (!sp) status = `<div class="bal-status muted small"><span>Der er ingen poster på denne konto endnu</span>${canEdit() ? `<button class="btn small ghost" data-act="add-to-acc" data-acc="${esc(b.account)}">＋ Tilføj fast overførsel hertil</button>` : ''}</div>`;
    else if (sp.missing > 0) {
      status = `<div class="bal-status neg"><span>🔴 Der mangler ${kr(sp.missing)} den ${fmtDate(sp.missingDate)}</span>
        <span class="muted small">Sæt penge ind inden da, eller hæv den faste overførsel.</span></div>`;
    } else {
      status = `<div class="bal-status pos"><span>🟢 Du kan bruge ${kr(sp.canSpend)}</span>
        <span class="muted small">${sp.canSpend > 0 ? 'uden at mangle til regningerne det næste år' : 'Alt på kontoen skal bruges til kommende regninger'}${sp.nextBig ? ` · næste store: ${esc(sp.nextBig.name)} ${kr(sp.nextBig.amount, false)} den ${fmtDate(sp.nextBig.date)}` : ''}</span></div>`;
    }
    return `<div class="bal-row">
      <div class="bal-acc"><b>${accIcon(b.account)} ${esc(b.account)}</b><span class="muted small">${b.source === 'bank' ? '🏦 hentet fra banken' : 'opdateret'} ${fmtDate(b.date)}</span></div>
      <div class="bal-amt">${kr(b.amount)}</div>
      ${status}
    </div>`;
  }).join('');
  return `<section class="balances glass">
    <div class="section-head">
      <h2>Hvad står der på kontoen? ${helpBtn('budgetkonto')}</h2>
      ${canEdit() ? '<button class="btn small ghost" data-act="balances">Skriv saldo</button>' : ''}
    </div>
    ${balances.length ? rows : '<p class="muted">Skriv hvad der står på kontoen i netbanken, så kan appen fortælle hvor meget I kan bruge uden at mangle til regningerne.</p>'}
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
    const active = countsInBudget(it, now) || (it.active !== false && isPaused(it, now)); // pause vises stadig i listen
    if (f.status === 'active' && !active) return false;
    if (f.status === 'inactive' && active) return false;
    if (f.type !== 'all' && it.type !== f.type) return false;
    if (f.person && !involves(it, f.person)) return false;
    if (f.cat && (it.category || '') !== f.cat) return false;
    if (f.acc && !touchesAccount(it, f.acc)) return false;
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
  const head = n ? `<p class="result-line"><b>${filtered.length}</b> af ${items.length} poster vises · i alt ${kr(filtered.filter((i) => i.type === 'expense').reduce((s, i) => s + monthly(i), 0))}/md. udgifter og ${kr(filtered.filter((i) => i.type === 'income').reduce((s, i) => s + monthly(i), 0))}/md. indtægter</p>` : '';
  if (!filtered.length) return `${head}<div class="empty glass small"><p>Ingen poster passer til søgningen eller filtret.</p></div>`;
  const out = [head];
  for (const type of ['income', 'expense', 'transfer']) {
    const list = filtered.filter((i) => i.type === type);
    if (!list.length) continue;
    const byCat = new Map();
    for (const it of list) {
      const c = it.category || (type === 'transfer' ? 'Opsparing' : 'Uden kategori');
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(it);
    }
    const order = L.categories;
    const cats = [...byCat.keys()].sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b, 'da');
    });
    const typeTotal = list.reduce((s, i) => s + (countsInBudget(i, dateToIndex(today)) ? monthly(i) : 0), 0);
    let headAmt = `${kr(typeTotal)} / md.`;
    if (type === 'transfer') {
      const act = list.filter((i) => countsInBudget(i, dateToIndex(today)));
      if (ui.view) {
        const inn = act.filter((i) => i.toAccount === ui.view).reduce((a, i) => a + monthly(i), 0);
        const ud = act.filter((i) => i.account === ui.view).reduce((a, i) => a + monthly(i), 0);
        headAmt = `ind ${kr(inn, false)} · ud ${kr(ud, false)} / md.`;
      } else {
        const sav = savingsAccounts();
        const saving = act.filter((i) => sav.includes(i.toAccount) && !sav.includes(i.account)).reduce((a, i) => a + monthly(i), 0);
        headAmt = `opsparing ${kr(saving, false)} · flyttes ${kr(typeTotal - saving, false)} / md.`;
      }
    }
    out.push(`<h2 class="type-head ${type}">${TYPE_PLURAL[type]}<span>${headAmt}</span></h2>
      <p class="type-explain muted small">${TYPE_EXPLAIN[type]}</p>`);
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

function guessSalaryAccount(not) {
  const inc = state.items.filter((i) => i.type === 'income' && i.account && i.account !== not).map((i) => i.account);
  return inc[0] || lists().accounts.find((a) => a !== not && /løn/i.test(a)) || lists().accounts.find((a) => a !== not) || '';
}
export function openAddChooser() {
  const m = openModal({
    title: 'Hvad vil du tilføje?',
    body: `<div class="add-choices">
      <button type="button" class="add-opt income" data-t="income"><span class="ao-ico">💰</span><span><b>Indtægt</b><small>Penge der kommer ind — fx løn eller børnepenge</small></span></button>
      <button type="button" class="add-opt expense" data-t="expense"><span class="ao-ico">🧾</span><span><b>Udgift</b><small>En regning — fx husleje, forsikring eller mobil</small></span></button>
      <button type="button" class="add-opt transfer" data-t="transfer"><span class="ao-ico">🔁</span><span><b>Opsparing eller overførsel</b><small>Penge du flytter mellem dine egne konti — fx fast opsparing eller til budgetkontoen</small></span></button>
    </div>`,
    onOpen: (f) => f.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { m.close(); setTimeout(() => openItemModal(null, b.dataset.t), 180); })),
  });
}
const hideBtn = (id) => `<button type="button" class="hide-x" data-hide-box="${id}" title="Skjul denne boks (kun for dig — kan vises igen under Admin → Udseende)" aria-label="Skjul boksen">✕</button>`;
const TYPE_EXPLAIN = {
  income: '💰 Penge der kommer ind, fx løn og børnepenge.',
  expense: '🧾 Regninger og faste udgifter, der trækkes fra en konto.',
  transfer: '🔁 Penge I flytter mellem jeres egne konti: fast opsparing og overførsler til fx budgetkontoen.',
};
function splitText(it) {
  const s = shareOf(it, jointAccounts());
  if (s.joint) return 'Fælles';
  return Object.entries(s.parts).map(([n, a]) => (Object.keys(s.parts).length > 1 ? `${n} ${Math.round((a / (monthly(it) || 1)) * 100)} %` : n)).join(' · ');
}
function pauseText(it) {
  const p = it.pause;
  if (!p?.from) return '';
  return p.to ? `På pause til og med ${fmtYm(p.to)}` : 'På pause indtil videre';
}
function itemRow(it, today, L) {
  const paused = isPaused(it, dateToIndex(today));
  const inactive = !countsInBudget(it, dateToIndex(today));
  const np = inactive ? null : nextPayment(it, today);
  const meta = [
    isTransfer(it) ? `${it.account || '?'} → ${it.toAccount || '?'}` : splitText(it), isTransfer(it) ? '' : it.supplier, isTransfer(it) ? '' : it.account,
    freqLabel(it.freq, L.frequencies),
    np ? `næste ${np.day}. ${fmtYm(np.ym)}` : paused ? '' : inactive ? 'stoppet' : '',
  ].filter(Boolean).map(esc).join(' · ');
  const dir = ui.view && isTransfer(it) ? (it.toAccount === ui.view ? 'in' : 'out') : '';
  return `<button class="item ${inactive ? 'inactive' : ''} ${paused ? 'paused' : ''} ${it.type} ${dir}" data-item="${it.id}">
    <div class="item-main">
      <div class="item-name">${esc(it.name)} ${!isShared(it) ? `<span class="vis-tag">${ICON.lock}${esc(visibilityLabel(it))}</span>` : ''}${paused ? `<span class="pause-tag">⏸ ${esc(pauseText(it))}</span>` : ''}</div>
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
const HINT_FIELDS = ['name', 'amount', 'freq', 'startMonth', 'payDay', 'endMonth', 'category', 'who', 'supplier', 'method', 'account', 'toAccount'];
const TYPE_TEXT = {
  expense: { who: 'Hvem betaler', account: 'Trækkes fra konto', ph: 'fx Husleje, Bilforsikring', help: 'En regning eller fast udgift, fx husleje eller forsikring.' },
  income: { who: 'Hvem får pengene', account: 'Går ind på konto', ph: 'fx Løn, Børnepenge', help: 'Penge der kommer ind, fx løn eller børnepenge.' },
  transfer: { who: 'Hvem overfører', account: 'Fra konto', ph: 'fx Opsparing, Til budgetkontoen', help: 'Penge der flyttes mellem jeres egne konti, fx fast opsparing eller overførsel til budgetkontoen.' },
};
const MONTHS_DA = ['jan.', 'feb.', 'mar.', 'apr.', 'maj', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.'];
const shortDate = (d) => `${d.getDate()}. ${MONTHS_DA[d.getMonth()]} ${d.getFullYear()}`;

export function openItemModal(item = null, type = 'expense') {
  const editing = !!item?.id;
  const it = item || {
    type, freq: 1, payDay: 1, startMonth: currentYm(), active: true,
    account: type === 'expense' ? 'Budgetkonto' : 'Lønkonto',
    toAccount: type === 'transfer' ? (savingsAccounts()[0] || '') : '',
    category: '', visibleTo: defaultVisibleTo(),
  };
  const readOnly = !canEdit();
  const t = it.type;
  const hist = [...(it.history || [])].reverse();
  const last = hist[0];

  const body = `
    ${last ? `<div class="last-change">✏️ Sidst ændret ${fmtDate(new Date(last.at), true)} af ${esc(last.by)}: ${changesText(last.changes)}</div>` : ''}
    <div class="seg3 type-seg" role="radiogroup" aria-label="Type">
      <label><input type="radio" name="type" value="expense" ${t === 'expense' ? 'checked' : ''}><span>Udgift</span></label>
      <label><input type="radio" name="type" value="income" ${t === 'income' ? 'checked' : ''}><span>Indtægt</span></label>
      <label><input type="radio" name="type" value="transfer" ${t === 'transfer' ? 'checked' : ''}><span>Overførsel</span></label>
    </div>
    <p class="muted small type-help" data-type-help></p>

    <section class="fgroup">
      <h3 class="fgroup-title">Hvad og hvor meget</h3>
      <label>Hvad hedder den?<input name="name" required maxlength="120" value="${esc(it.name)}" placeholder="${TYPE_TEXT[t].ph}"></label>
      <div class="pair">
        <label>Beløb hver gang (kr.)<input name="amount" required inputmode="decimal" value="${numToInput(it.amount)}" placeholder="0,00"></label>
        <label><span class="lbl">Hvor ofte ${helpBtn('freq')}</span>${freqSelect('freq', it.freq)}</label>
      </div>
      <div class="calc-preview" id="calc-preview"></div>
    </section>

    <section class="fgroup">
      <h3 class="fgroup-title">Hvornår</h3>
      <div class="pair">
        <label>Første gang (måned)<input type="month" name="startMonth" value="${esc(it.startMonth || '')}" required></label>
        <label>Dag i måneden<select name="payDay">${Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}" ${Number(it.payDay || 1) === i + 1 ? 'selected' : ''}>Den ${i + 1}.</option>`).join('')}<option value="31" ${Number(it.payDay) >= 31 ? 'selected' : ''}>Sidste dag i måneden</option></select></label>
      </div>
      <p class="next-pay" id="next-pay"></p>
      <label>Stopper (valgfri)<input type="month" name="endMonth" value="${esc(it.endMonth || '')}"></label>
      <label class="check big-check pause-toggle"><input type="checkbox" name="paused" ${it.pause?.from ? 'checked' : ''}> <span>⏸ <b>Sæt på pause</b> <span class="muted small">— fx sommerferie i institutionen. Posten bliver liggende, men tæller ikke med i pausen.</span></span></label>
      <div class="pair pause-fields ${it.pause?.from ? '' : 'hidden'}">
        <label>Pause fra<input type="month" name="pauseFrom" value="${esc(it.pause?.from || currentYm())}"></label>
        <label>Til og med (tom = indtil videre)<input type="month" name="pauseTo" value="${esc(it.pause?.to || '')}"></label>
      </div>
    </section>

    <section class="fgroup">
      <h3 class="fgroup-title">Konto og hvem</h3>
      <div class="pair acc-pair">
        <label><span data-lbl="account">${TYPE_TEXT[t].account}</span>${listSelect('account', 'accounts', it.account)}</label>
        <label data-to-acc class="${t === 'transfer' ? '' : 'hidden'}"><span>Til konto</span>${listSelect('toAccount', 'accounts', it.toAccount)}</label>
      </div>
      <p class="muted small" data-transfer-info></p>
      <label><span data-lbl="who">${TYPE_TEXT[t].who}</span>${listSelect('who', 'people', it.who)}</label>
      <label data-cat class="${t === 'transfer' ? 'hidden' : ''}">Kategori${listSelect('category', 'categories', it.category)}</label>
      ${splitEditor(it)}
    </section>

    <details class="fgroup more" ${editing && (it.note || it.supplier) ? 'open' : ''}>
      <summary>Mere (valgfrit): ${'leverandør, noter, hvem må se den'}</summary>
      <label data-supplier class="${t === 'transfer' ? 'hidden' : ''}"><span data-lbl="supplier">${t === 'income' ? 'Afsender' : 'Leverandør'}</span>${listSelect('supplier', 'suppliers', it.supplier)}</label>
      <label data-method class="${t === 'expense' ? '' : 'hidden'}">Betales med${listSelect('method', 'methods', it.method)}</label>
      <label>Kommentar / noter<textarea name="note" rows="2" maxlength="1000">${esc(it.note)}</textarea></label>
      ${visibilityPicker(it)}
      <label class="check"><input type="checkbox" name="active" ${it.active !== false ? 'checked' : ''}> Aktiv (fjern fluebenet, hvis den er stoppet, men du vil gemme den)</label>
    </details>
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
    title: readOnly ? it.name : editing ? 'Ret post' : { income: 'Ny indtægt', expense: 'Ny udgift', transfer: 'Ny overførsel' }[t],
    body, readOnly, buttons, wide: true,
    submitLabel: editing ? 'Gem ændringer' : 'Tilføj',
    onOpen: (form) => {
      bindListSelects(form);
      bindVisibility(form);
      const getMonthly = () => { const a = parseAmount(form.amount.value); return Number.isNaN(a) ? 0 : a / (Number(form.freq.value) || 1); };
      bindSplit(form, getMonthly);
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
        const T = TYPE_TEXT[type];
        form.querySelector('[data-lbl=who]').textContent = T.who;
        form.querySelector('[data-lbl=account]').textContent = T.account;
        form.querySelector('[data-lbl=supplier]').textContent = type === 'income' ? 'Afsender' : 'Leverandør';
        form.querySelector('[data-type-help]').textContent = T.help;
        form.querySelector('[data-to-acc]').classList.toggle('hidden', type !== 'transfer');
        form.querySelector('[data-cat]').classList.toggle('hidden', type === 'transfer');
        form.querySelector('[data-supplier]').classList.toggle('hidden', type === 'transfer');
        form.querySelector('[data-method]').classList.toggle('hidden', type !== 'expense');
        form.querySelector('.acc-pair').classList.toggle('single', type !== 'transfer');
        const sl = form.querySelector('[data-split-lbl]'); if (sl) sl.textContent = type === 'income' ? 'Hvem får hvor meget?' : type === 'transfer' ? 'Hvem overfører hvor meget?' : 'Hvem betaler hvor meget?';

        // Næste betalinger
        const np = form.querySelector('#next-pay');
        const pauseOn = form.paused.checked;
        form.querySelector('.pause-fields').classList.toggle('hidden', !pauseOn);
        const draft = { type, freq: f, startMonth: form.startMonth.value, payDay: Number(form.payDay.value) || 1, endMonth: form.endMonth.value || null, active: true,
          pause: pauseOn && form.pauseFrom.value ? { from: form.pauseFrom.value, to: form.pauseTo.value || null } : null };
        const next = form.startMonth.value ? upcomingPayments(draft, new Date(), 3) : [];
        np.innerHTML = next.length
          ? `📅 Næste gang: <b>${shortDate(next[0])}</b>${next.length > 1 ? `, derefter ${next.slice(1).map(shortDate).join(' og ')}` : ''}${Number(form.payDay.value) >= 31 ? '<br><span class="muted small">Altid den sidste dag — også i korte måneder.</span>' : Number(form.payDay.value) > 28 ? '<br><span class="muted small">I korte måneder bruges den sidste dag i måneden.</span>' : ''}${bankDaysOn() ? `<br><span class="muted small">Falder dagen i en weekend eller på en helligdag, ${type === 'income' ? 'kommer pengene bankdagen før' : 'trækkes den næste bankdag'}.</span>` : ''}`
          : pauseOn ? '⏸ Posten er på pause — der kommer ingen betalinger, før pausen slutter.' : (form.endMonth.value ? '⚠ Posten er stoppet — der kommer ikke flere betalinger.' : '');

        // Overførsel: forklaring og passer/for meget/mangler for til-kontoen
        const info = form.querySelector('[data-transfer-info]');
        if (type === 'transfer') {
          const to = form.toAccount.value, from = form.account.value;
          if (!to || !from) info.innerHTML = '';
          else if (to === from) info.innerHTML = '<span class="neg">Fra- og til-konto er den samme.</span>';
          else if (savingsAccounts().includes(to)) info.innerHTML = `💵 Det her er <b>opsparing</b>. Det trækkes fra "Tilbage af lønnen".`;
          else {
            const others = state.items.filter((x) => x.id !== it.id);
            const draftItem = { type: 'transfer', amount: Number.isNaN(a) ? 0 : a, freq: f, startMonth: form.startMonth.value || currentYm(), payDay: 1, account: from, toAccount: to, active: true };
            const fund = accountFunding([...others, draftItem], { savingsAccounts: savingsAccounts() }).find((x) => x.account === to);
            info.innerHTML = !fund || !fund.needs ? `↔ Pengene flyttes til ${esc(to)}. Der er ingen regninger på ${esc(to)} endnu.`
              : fund.status === 'ok' ? `🟢 ${esc(to)} skal bruge ${kr(fund.needs, false)} om måneden — det passer.`
              : fund.status === 'over' ? `🟡 ${esc(to)} skal kun bruge ${kr(fund.needs, false)} om måneden. Med denne overførsel kommer der ${kr(fund.diff, false)} for meget ind.`
              : `🔴 ${esc(to)} skal bruge ${kr(fund.needs, false)} om måneden. Der mangler ${kr(-fund.diff, false)} om måneden.`;
          }
        } else info.innerHTML = '';

        const p = form.querySelector('#calc-preview');
        if (Number.isNaN(a)) { p.innerHTML = ''; return; }
        p.innerHTML = f === 1
          ? `Det er <b>${kr(a)}</b> om måneden og <b>${kr(a * 12)}</b> om året`
          : `Svarer til <b>${kr(a / f)}</b> om måneden og <b>${kr((a * 12) / f)}</b> om året`;
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
      const typ = fd.get('type');
      let pause = null;
      if (fd.get('paused') === 'on') {
        const pf = fd.get('pauseFrom') || currentYm(), pt = fd.get('pauseTo') || null;
        if (pt && ymToIndex(pt) < ymToIndex(pf)) { toast('Pausen slutter før den begynder', 'error'); return false; }
        pause = { from: pf, to: pt };
      }
      if (typ === 'transfer') {
        if (!fd.get('account') || !fd.get('toAccount')) { toast('Vælg både fra- og til-konto', 'error'); return false; }
        if (fd.get('account') === fd.get('toAccount')) { toast('Fra- og til-konto skal være forskellige', 'error'); return false; }
      }
      let split;
      try { split = readSplit(form); } catch (e) { toast(e.message, 'error'); return false; }
      const data = {
        type: typ, name: String(fd.get('name')).trim(), amount: Math.round(amount * 100) / 100, freq,
        startMonth, endMonth, payDay: Math.min(31, Math.max(1, parseInt(fd.get('payDay'), 10) || 1)),
        // Overførsler får automatisk kategori ud fra til-kontoen
        category: typ === 'transfer' ? (savingsAccounts().includes(fd.get('toAccount')) ? 'Opsparing' : 'Overførsler') : fd.get('category') || '',
        who: fd.get('who') || '',
        supplier: typ === 'transfer' ? '' : fd.get('supplier') || '',
        method: typ === 'expense' ? fd.get('method') || '' : typ === 'transfer' ? 'Overførsel' : '',
        account: fd.get('account') || '', toAccount: typ === 'transfer' ? fd.get('toAccount') || '' : null,
        note: String(fd.get('note') || '').trim(),
        active: fd.get('active') === 'on', split, visibleTo: readVisibility(form), pause,
      };
      await saveItem(editing ? it.id : null, data, it);
      toast(editing ? 'Ændringer gemt — den gamle værdi ligger i historikken' : `${TYPE_LABEL[data.type]} tilføjet`);
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
