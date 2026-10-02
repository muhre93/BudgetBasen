// Simpel visning: kun det vigtigste i store tal, og "Tilføj" stiller ét spørgsmål ad gangen.
// Bruger præcis de samme data som den udvidede visning.
import { state, canEdit, lists, savingsAccounts, jointAccounts, defaultVisibleTo } from '../state.js';
import { esc, kr, fmtDate, openModal, toast, parseAmount, currentYm, firstName, lsGet, lsSet } from '../ui.js';
import {
  monthly, summarize, countsInBudget, dateToIndex, nextPayment, accountFunding, spendable, indexToYm, isTransfer, flowOf,
} from '../calc.js';
import { saveItem } from '../data.js';
import { helpBtn } from '../help.js';
import { setPrefs } from '../prefs.js';
import { openItemModal } from './budget.js';

const FREQ_TXT = { 1: 'hver måned', 2: 'hver 2. måned', 3: 'hvert kvartal', 4: 'hver 4. måned', 6: 'hvert halve år', 12: 'hvert år' };
const freqTxt = (f) => FREQ_TXT[f] || `hver ${f}. måned`;
const MONTHS = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];

export function renderSimple(root) {
  const today = new Date();
  const items = state.items;
  const sav = savingsAccounts();
  // Hvad skal de store tal vise? Én konto (typisk Budgetkonto) eller hele budgettet.
  const inUse = [...new Set(items.flatMap((i) => [i.account, i.toAccount]).filter(Boolean))];
  let acc = lsGet('bb:simpleAcc', null);
  if (acc === null) acc = inUse.includes('Budgetkonto') ? 'Budgetkonto' : '';
  if (acc && !inUse.includes(acc)) acc = '';
  const full = summarize(items, today, { savingsAccounts: sav });
  const one = acc ? summarize(items, today, { account: acc, savingsAccounts: sav }) : null;
  const sum = acc ? { income: one.income, left: one.net } : full;
  const out = acc ? one.expense : sum.income - sum.left;
  const light = sum.left < 0 ? '🔴' : sum.left < sum.income * 0.05 ? '🟡' : '🟢';
  const now = dateToIndex(today);
  const funding = accountFunding(items, { savingsAccounts: sav, today }).filter((f) => f.status !== 'ok' && (!acc || f.account === acc));
  const balances = (state.budget.settings?.balances || []).filter((b) => !acc || b.account === acc);

  const rows = (list) => list.sort((a, b) => monthly(b) - monthly(a)).map((it) => {
    const np = nextPayment(it, today);
    const savingRow = isTransfer(it);
    return `<button class="s-row" data-item="${it.id}">
      <span class="s-row-main"><b>${esc(it.name)}</b><small>${savingRow ? '💵 Opsparing · ' : ''}${esc(freqTxt(Number(it.freq)))}${np ? ` · næste ${fmtDate(np.date)}` : ''}</small></span>
      <span class="s-row-amt"><b>${kr(it.amount, false)}</b>${Number(it.freq) > 1 ? `<small>= ${kr(monthly(it), false)}/md.</small>` : ''}</span>
    </button>`;
  }).join('');
  const active = items.filter((i) => countsInBudget(i, now));
  const inn = acc ? active.filter((i) => flowOf(i, { account: acc }).sign > 0) : active.filter((i) => i.type === 'income');
  const ud = acc ? active.filter((i) => flowOf(i, { account: acc }).sign < 0)
    : active.filter((i) => i.type === 'expense' || (isTransfer(i) && flowOf(i, { savingsAccounts: sav }).bucket === 'saving'));

  root.innerHTML = `<div class="view-wrap simple-view">
    ${inUse.length > 1 ? `<div class="av-chips s-accs">${inUse.map((a) => `<button class="av-chip ${a === acc ? 'on' : ''}" data-s-acc="${esc(a)}">${esc(a)}</button>`).join('')}<button class="av-chip ${!acc ? 'on' : ''}" data-s-acc="">🏠 Hele budgettet</button></div>` : ''}
    <section class="s-hero glass">
      <div class="s-num"><span>Kommer ind</span><b class="pos">${kr(sum.income, false)}</b></div>
      <div class="s-op">−</div>
      <div class="s-num"><span>Går ud</span><b>${kr(out, false)}</b></div>
      <div class="s-op">=</div>
      <div class="s-num big"><span>${acc ? `Tilbage på ${esc(acc)} hver måned ${helpBtn('acctLeft')}` : `Tilbage hver måned ${helpBtn('left')}`}</span><b class="${sum.left >= 0 ? 'pos' : 'neg'}">${light} ${kr(sum.left, false)}</b></div>
    </section>

    ${funding.map((f) => `<div class="fund-line ${f.status === 'over' ? 'warn' : 'neg'}"><span class="fl-ico">${f.status === 'over' ? '🟡' : '🔴'}</span><span>${f.status === 'over'
      ? `Der overføres <b>${kr(f.diff, false)}</b> mere til ${esc(f.account)}, end regningerne koster, hver måned.`
      : `${esc(f.account)} mangler <b>${kr(-f.diff, false)}</b> hver måned. Overfør ca. ${kr(Math.ceil(f.needs / 100) * 100, false)} hver måned.`}</span></div>`).join('')}

    ${balances.map((b) => {
      const sp = spendable(items, b.account, Number(b.amount) || 0, today);
      return `<div class="s-bal glass"><span>${esc(b.account)}: <b>${kr(b.amount, false)}</b></span>
        <span class="${sp.missing ? 'neg' : 'pos'}">${sp.missing ? `🔴 Mangler ${kr(sp.missing, false)} den ${fmtDate(sp.missingDate)}` : `🟢 Du kan bruge ${kr(sp.canSpend, false)}`}</span></div>`;
    }).join('')}

    ${canEdit() ? '<button class="btn primary big full s-add" data-s="add">＋ Tilføj indtægt eller udgift</button>' : ''}

    ${inn.length ? `<section class="s-list glass"><h2>Det kommer ind</h2>${rows(inn)}</section>` : ''}
    ${ud.length ? `<section class="s-list glass"><h2>Det går ud</h2>${rows(ud)}</section>` : ''}
    ${!items.length ? '<div class="empty glass"><div class="empty-emoji">👋</div><h3>Budgettet er tomt</h3><p>Tryk på den blå knap for at tilføje jeres løn og faste regninger. Appen spørger om én ting ad gangen.</p></div>' : ''}

    <button class="link s-switch" data-s="full">Vis alle detaljer (udvidet visning)</button>
  </div>`;

  const w = root.firstElementChild;
  w.addEventListener('click', (e) => {
    if (e.target.closest('[data-s=add]')) openWizard();
    const sa = e.target.closest('[data-s-acc]');
    if (sa) { lsSet('bb:simpleAcc', sa.dataset.sAcc); renderSimple(root); }
    if (e.target.closest('[data-s=full]')) setPrefs({ simple: false });
    const r = e.target.closest('[data-item]');
    if (r) { const it = state.items.find((x) => x.id === r.dataset.item); if (it) openItemModal(it); }
  });
}

// ---------- Tilføj: ét spørgsmål ad gangen ----------
const SUGGEST = {
  income: ['Løn', 'Børnepenge', 'Boligstøtte', 'SU', 'Pension'],
  expense: ['Husleje', 'El', 'Vand & varme', 'Forsikring', 'Internet', 'Mobil', 'Institution', 'Bil', 'Streaming'],
};
function defaultAccount(type) {
  const acc = lists().accounts;
  if (type === 'income') return acc.includes('Lønkonto') ? 'Lønkonto' : acc[0] || '';
  const j = jointAccounts().find((a) => acc.includes(a));
  return j || (acc.includes('Budgetkonto') ? 'Budgetkonto' : acc[0] || '');
}

export function openWizard() {
  const d = { type: '', name: '', amount: '', freq: 1, day: 1, month: indexToYm(dateToIndex(new Date()) + 1) };
  const steps = ['type', 'name', 'amount', 'freq', 'when', 'done'];
  let i = 0;
  const monthsAhead = Array.from({ length: 12 }, (_, k) => indexToYm(dateToIndex(new Date()) + k + 1));

  const html = () => {
    const s = steps[i];
    if (s === 'type') return `<p class="wz-q">Er det noget, der kommer ind, eller noget, der går ud?</p>
      <div class="wz-big"><button type="button" class="wz-opt" data-v="income"><span>💰</span><b>Kommer ind</b><small>fx løn eller børnepenge</small></button>
      <button type="button" class="wz-opt" data-v="expense"><span>🧾</span><b>Går ud</b><small>fx husleje eller forsikring</small></button></div>`;
    if (s === 'name') return `<p class="wz-q">Hvad hedder det?</p>
      <input id="wz-name" class="wz-input" value="${esc(d.name)}" placeholder="Skriv et navn" autocomplete="off" maxlength="120">
      <div class="wz-chips">${SUGGEST[d.type].map((n) => `<button type="button" class="av-chip" data-name="${esc(n)}">${esc(n)}</button>`).join('')}</div>`;
    if (s === 'amount') return `<p class="wz-q">Hvor mange penge ${d.type === 'income' ? 'kommer der ind' : 'skal der betales'} hver gang?</p>
      <div class="wz-amount"><input id="wz-amount" class="wz-input" inputmode="decimal" value="${esc(d.amount)}" placeholder="0" autocomplete="off"><span>kr.</span></div>
      <p class="muted small">Skriv beløbet, som det står på lønsedlen eller regningen.</p>`;
    if (s === 'freq') return `<p class="wz-q">Hvor tit?</p>
      <div class="wz-list">${[1, 3, 6, 12].map((f) => `<button type="button" class="wz-opt row ${d.freq === f ? 'on' : ''}" data-v="${f}"><b>${freqTxt(f)[0].toUpperCase() + freqTxt(f).slice(1)}</b></button>`).join('')}</div>`;
    if (s === 'when') return `<p class="wz-q">Hvornår ${d.type === 'income' ? 'kommer pengene' : 'skal den betales'}${d.freq > 1 ? ' næste gang' : ''}?</p>
      ${d.freq > 1 ? `<label>Måned<select id="wz-month">${monthsAhead.map((m) => `<option value="${m}" ${m === d.month ? 'selected' : ''}>${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}</option>`).join('')}</select></label>` : ''}
      <label>Dag i måneden<select id="wz-day" class="wz-input">${Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}" ${d.day === i + 1 ? 'selected' : ''}>Den ${i + 1}.</option>`).join('')}<option value="31" ${d.day >= 31 ? 'selected' : ''}>Sidste dag i måneden</option></select></label>
      <p class="muted small">Ved du det ikke præcist, så vælg den 1.</p>`;
    const amt = parseAmount(d.amount);
    return `<p class="wz-q">Ser det rigtigt ud?</p>
      <div class="wz-summary"><b>${esc(d.name)}</b><span>${kr(amt, false)} ${freqTxt(d.freq)}</span>
      <span class="muted">${d.freq > 1 ? `Næste gang: ${d.day >= 31 ? 'sidste dag i' : `${d.day}.`} ${MONTHS[Number(d.month.slice(5)) - 1]} ${d.month.slice(0, 4)}` : d.day >= 31 ? 'Den sidste dag hver måned' : `Den ${d.day}. hver måned`}</span>
      ${d.freq > 1 ? `<span class="muted small">Det svarer til ${kr(amt / d.freq, false)} om måneden.</span>` : ''}</div>`;
  };

  let el = null;
  const m = openModal({
    title: 'Tilføj', body: `<div id="wz"></div><div class="dots" id="wz-dots"></div>`,
    submitLabel: 'Næste',
    buttons: [{ label: '← Tilbage', cls: 'ghost', onClick: () => { if (i > 0) { i--; draw(); } return false; } }],
    onOpen: (form) => { el = form; draw(); },
    onSubmit: async () => {
      if (!read()) return false;
      if (steps[i] !== 'done') { i++; draw(); return false; }
      const amount = Math.round(parseAmount(d.amount) * 100) / 100;
      const me = firstName(state.user.displayName);
      await saveItem(null, {
        type: d.type, name: d.name.trim(), amount, freq: d.freq,
        startMonth: d.freq > 1 ? d.month : currentYm(), endMonth: null, payDay: d.day,
        category: d.type === 'income' ? (/løn|pension|su\b/i.test(d.name) ? 'Løn' : 'Offentlige ydelser') : 'Andet',
        who: lists().people.includes(me) ? me : '', supplier: '', method: d.type === 'expense' ? 'Betalingsservice' : '',
        account: defaultAccount(d.type), toAccount: null, note: '', active: true, split: null, visibleTo: defaultVisibleTo(),
      });
      toast(`${d.name} er tilføjet`);
    },
  });

  function read() {
    const s = steps[i];
    const f = el;
    if (s === 'type' && !d.type) { toast('Vælg "Kommer ind" eller "Går ud"', 'error'); return false; }
    if (s === 'name') { d.name = f.querySelector('#wz-name').value.trim(); if (!d.name) { toast('Skriv et navn', 'error'); return false; } }
    if (s === 'amount') { d.amount = f.querySelector('#wz-amount').value; const a = parseAmount(d.amount); if (Number.isNaN(a) || a <= 0) { toast('Skriv et beløb', 'error'); return false; } }
    if (s === 'when') {
      d.day = Math.min(31, Math.max(1, parseInt(f.querySelector('#wz-day').value, 10) || 1));
      if (d.freq > 1) d.month = f.querySelector('#wz-month').value;
    }
    return true;
  }
  function draw() {
    const f = el;
    f.querySelector('#wz').innerHTML = html();
    f.querySelector('#wz-dots').innerHTML = steps.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
    const sub = f.querySelector('[type=submit]');
    sub.textContent = steps[i] === 'done' ? 'Gem' : 'Næste';
    sub.classList.toggle('hidden', steps[i] === 'type' || steps[i] === 'freq');
    f.querySelector('.left-btns .btn').classList.toggle('hidden', i === 0);
    f.querySelectorAll('.wz-opt').forEach((b) => (b.onclick = () => {
      if (steps[i] === 'type') { d.type = b.dataset.v; if (!SUGGEST[d.type].includes(d.name)) d.name = ''; }
      if (steps[i] === 'freq') d.freq = Number(b.dataset.v);
      i++; draw();
    }));
    f.querySelectorAll('[data-name]').forEach((b) => (b.onclick = () => { f.querySelector('#wz-name').value = b.dataset.name; }));
    const inp = f.querySelector('.wz-input');
    if (inp && window.matchMedia('(pointer:fine)').matches) inp.focus();
  }
}
