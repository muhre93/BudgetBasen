// Likviditet: "Er der penge nok på kontoen, når regningerne skal betales?"
// Hver betaling gennemgås dag for dag. Vises som månedskort med trafiklys i hverdagssprog.
import { state, lists, canEdit, savingsAccounts } from '../state.js';
import { esc, kr, krSigned, fmtYm, fmtDate, parseAmount, numToInput, toast } from '../ui.js';
import { projectCashflow, calendarYear, requiredBalance, touchesAccount, flowOf } from '../calc.js';
import { exportButtons, bindExportButtons, cashflowToPdf, cashflowToExcel } from '../export.js';
import { helpBtn } from '../help.js';
import { budgetRef } from '../data.js';
import { updateDoc } from '../firebase.js';
import { openItemModal } from './budget.js';

const ALL = '__all';
const ui = { account: null, horizon: 12, override: '', open: new Set(), table: false };

function accountsInUse() {
  const balances = state.budget.settings?.balances || [];
  return [...new Set([...balances.map((b) => b.account), ...state.items.flatMap((i) => [i.account, i.toAccount]).filter(Boolean)])];
}

export function render(root) {
  const accounts = accountsInUse();
  if (ui.account === null || (ui.account !== ALL && !accounts.includes(ui.account))) {
    ui.account = accounts.includes('Budgetkonto') ? 'Budgetkonto' : accounts[0] || ALL;
  }
  const key = `cashflow:${state.budgetId}:${JSON.stringify(accounts)}:${canEdit()}`;
  if (root.dataset.shell !== key) {
    root.dataset.shell = key;
    root.innerHTML = `<div class="view-wrap">
      <section class="glass card cf-intro">
        <h2>Er der penge nok på kontoen? ${helpBtn('cashflow')}</h2>
        <div class="cf-controls">
          <label>Hvilken konto vil du se?
            <select id="cf-acc">
              ${accounts.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}
              <option value="${ALL}">Alle konti lagt sammen</option>
            </select>
          </label>
          <label>Hvor langt frem?
            <select id="cf-h">${[6, 12, 18, 24].map((h) => `<option value="${h}">${h} måneder</option>`).join('')}</select>
          </label>
          <label>Prøv med en anden saldo
            <input id="cf-ov" inputmode="decimal" placeholder="fx 5.000" autocomplete="off">
          </label>
        </div>
        <p class="muted small" id="cf-explain"></p>
      </section>
      <div id="cf-results"></div></div>`;
    const w = root.firstElementChild;
    w.querySelector('#cf-acc').value = ui.account;
    w.querySelector('#cf-h').value = String(ui.horizon);
    w.querySelector('#cf-ov').value = ui.override;
    w.querySelector('#cf-acc').onchange = (e) => { ui.account = e.target.value; ui.override = ''; w.querySelector('#cf-ov').value = ''; update(root); };
    w.querySelector('#cf-h').onchange = (e) => { ui.horizon = Number(e.target.value); update(root); };
    const ov = w.querySelector('#cf-ov');
    ov.addEventListener('input', () => { ui.override = ov.value; update(root); });
    ov.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ov.blur(); } });
    w.addEventListener('click', (e) => {
      const card = e.target.closest('[data-month]');
      if (card && !e.target.closest('.events')) {
        const ym = card.dataset.month;
        if (ui.open.has(ym)) ui.open.delete(ym); else ui.open.add(ym);
        update(root);
      }
      if (e.target.closest('#cf-add-transfer')) {
        const r = requiredBalance(state.items, ui.account);
        const from = accountsInUse().find((a) => a !== ui.account && !savingsAccounts().includes(a)) || 'Lønkonto';
        openItemModal({ type: 'transfer', name: `Overførsel til ${ui.account}`, amount: Math.ceil(r.monthlyTransfer / 100) * 100, freq: 1, payDay: 1, account: from, toAccount: ui.account, category: 'Overførsler', active: true, startMonth: new Date().toISOString().slice(0, 7), visibleTo: ['all'] });
      }
    });
    w.addEventListener('change', async (e) => {
      if (e.target.id === 'cf-warn' && canEdit()) {
        const v = parseAmount(e.target.value);
        if (Number.isNaN(v)) return;
        await updateDoc(budgetRef(), { 'settings.warnBelow': v }).catch(() => toast('Kunne ikke gemme', 'error'));
      }
      if (e.target.id === 'cf-table') { ui.table = e.target.checked; update(root); }
    });
  }
  update(root);
}

function update(root) {
  const today = new Date();
  const balances = state.budget.settings?.balances || [];
  const warnBelow = Number(state.budget.settings?.warnBelow ?? 1000);
  const isAll = ui.account === ALL;
  const bal = balances.find((b) => b.account === ui.account);
  const baseBal = isAll ? balances.reduce((s, b) => s + (Number(b.amount) || 0), 0) : Number(bal?.amount) || 0;
  const ov = parseAmount(ui.override);
  const startBal = ui.override.trim() !== '' && !Number.isNaN(ov) ? ov : baseBal;
  const items = isAll ? state.items : state.items.filter((i) => touchesAccount(i, ui.account));
  const flowOpts = { account: isAll ? null : ui.account };
  const hasIncome = items.some((i) => i.active !== false && flowOf(i, flowOpts).sign > 0);
  const hasExpense = items.some((i) => i.active !== false && flowOf(i, flowOpts).sign < 0);

  root.querySelector('#cf-explain').innerHTML = isAll
    ? 'Alle jeres konti regnes som én stor pengekasse: al løn ind, alle regninger ud. Overførsler mellem jeres egne konti tæller ikke — pengene bliver jo i familien.'
    : `Viser kun det, der går ind og ud af <b>${esc(ui.account)}</b> — regninger, løn og overførsler til/fra jeres andre konti. Startsaldoen er ${bal ? `den du skrev ${fmtDate(bal.date)}` : '0 kr. (du har ikke skrevet en saldo endnu)'}.`;

  const out = root.querySelector('#cf-results');
  if (!items.length) {
    out.innerHTML = `<div class="empty glass"><div class="empty-emoji">📭</div><h3>Ingen poster på ${esc(isAll ? 'nogen konto' : ui.account)}</h3><p>Vælg en anden konto ovenfor, eller angiv konto på dine poster under Budget.</p></div>`;
    return;
  }

  const cf = projectCashflow(items, startBal, today, ui.horizon, flowOpts);
  const year = today.getFullYear();
  const dec = cf.months.find((m) => m.ym === `${year}-12`);
  const cal = isAll ? calendarYear(items, year) : calendarYear(items, year, flowOpts);
  const light = (min) => (min < 0 ? 'red' : min < warnBelow ? 'yellow' : 'green');
  const worst = cf.months.reduce((w, m) => (m.min < w.min ? m : w), cf.months[0]);
  const status = light(worst.min);

  const banner = {
    red: () => `<div class="traffic red glass"><span class="tl">🔴</span><div><b>Der mangler penge ${fmtYm(cf.firstNegative.ym, true)}</b>
      <p>Den ${cf.lowest.day}. ${fmtYm(cf.lowest.ym, true)} kommer kontoen ned på <b>${kr(cf.lowest.amount)}</b> Der skal sættes mindst <b>${kr(-cf.lowest.amount)}</b> ind inden da — eller flyt en betalingsdato.</p></div></div>`,
    yellow: () => `<div class="traffic yellow glass"><span class="tl">🟡</span><div><b>Det bliver stramt</b>
      <p>Kontoen går ikke i minus, men ${worst.minDay ? `den ${worst.minDay}. ${fmtYm(worst.ym, true)} er der kun <b>${kr(worst.min)}</b> tilbage` : `lige nu står der kun <b>${kr(worst.min)}</b> på kontoen${!bal ? ' — har du husket at skrive saldoen under Budget?' : ''}`}</p></div></div>`,
    green: () => `<div class="traffic green glass"><span class="tl">🟢</span><div><b>Der er penge nok hele vejen</b>
      <p>Det laveste kontoen kommer ned på er <b>${kr(cf.lowest.amount)}</b> (${fmtDate(cf.lowest.date)})</p></div></div>`,
  }[status]();

  const needsTransfer = !isAll && hasExpense && !hasIncome;
  out.innerHTML = `
    ${banner}
    ${needsTransfer ? `<div class="hint warn">💡 Der går ingen penge <i>ind</i> på ${esc(ui.account)} i budgettet — derfor ser det ud som om kontoen løber tør.
      Tilføj den faste månedlige overførsel (fx fra lønkontoen), så bliver beregningen rigtig.
      ${canEdit() ? '<br><button class="btn small primary" id="cf-add-transfer" type="button" style="margin-top:.5rem">＋ Tilføj månedlig overførsel</button>' : ''}</div>` : ''}

    <section class="kpis">
      <div class="kpi glass"><div class="kpi-label">På kontoen nu</div><div class="kpi-value">${kr(startBal)}</div><div class="kpi-sub">${ui.override ? 'din prøve-saldo' : 'den saldo du har skrevet'}</div></div>
      <div class="kpi glass ${cf.lowest.amount < 0 ? 'neg' : ''}"><div class="kpi-label">Det laveste den kommer ned på</div><div class="kpi-value">${kr(cf.lowest.amount)}</div><div class="kpi-sub">${fmtDate(cf.lowest.date)}</div></div>
      <div class="kpi glass ${dec && dec.end < 0 ? 'neg' : 'pos'}"><div class="kpi-label">På kontoen nytårsaften</div><div class="kpi-value">${dec ? kr(dec.end) : '–'}</div><div class="kpi-sub">når årets regninger er betalt</div></div>
      <div class="kpi glass ${cal.net < 0 ? 'neg' : 'pos'}"><div class="kpi-label">Plus/minus i ${year}</div><div class="kpi-value">${krSigned(cal.net)}</div><div class="kpi-sub">ind ${kr(cal.income, false)} · ud ${kr(cal.expense, false)}</div></div>
    </section>

    <div class="result-bar">
      <h2 class="type-head">Måned for måned</h2>
      ${exportButtons('cf-exp')}
    </div>
    <div class="month-grid">
      ${cf.months.map((m, i) => {
        const l = light(m.min);
        return `<article class="month-card glass ${l} ${ui.open.has(m.ym) ? 'open' : ''}" data-month="${m.ym}">
          <header><span class="tl">${{ red: '🔴', yellow: '🟡', green: '🟢' }[l]}</span><b>${fmtYm(m.ym, true)}</b>${i === 0 ? '<small class="muted"> (resten af måneden)</small>' : ''}</header>
          <p>${m.income || m.expense ? `Der kommer <b class="pos">${kr(m.income, false)}</b> ind og går <b>${kr(m.expense, false)}</b> ud.` : 'Ingen betalinger.'}</p>
          <p>${m.min < 0 ? `<b class="neg">Kontoen er i minus: ${kr(m.min, false)}</b> den ${m.minDay}.` : m.minDay ? `Laveste: <b>${kr(m.min, false)}</b> den ${m.minDay}.` : ''}</p>
          <p class="muted small">Ved månedens slut: <b>${kr(m.end, false)}</b> · ${ui.open.has(m.ym) ? 'tryk for at skjule' : 'tryk for at se betalingerne'}</p>
          ${ui.open.has(m.ym) ? eventsHtml(m) : ''}
        </article>`;
      }).join('')}
    </div>

    <section class="glass chart-card">
      <div class="section-head"><h2>Kurven</h2><span class="legend"><i class="l-end"></i>Saldo ved månedens slut <i class="l-min"></i>Laveste punkt i måneden</span></div>
      ${chartSvg(cf.months)}
    </section>

    <section class="glass card cf-settings">
      <label class="inline">🟡 Gul advarsel når saldoen kommer under
        <input id="cf-warn" inputmode="decimal" value="${numToInput(warnBelow)}" class="w-sm" ${canEdit() ? '' : 'disabled'}> kr.</label>
      <label class="check"><input type="checkbox" id="cf-table" ${ui.table ? 'checked' : ''}> Vis også som tabel</label>
      ${ui.table ? `<div class="table-card"><table class="cf-table">
        <thead><tr><th>Måned</th><th class="num">Start</th><th class="num">Ind</th><th class="num">Ud</th><th class="num">Laveste</th><th class="num">Slut</th></tr></thead>
        <tbody>${cf.months.map((m) => `<tr class="${m.min < 0 ? 'neg' : ''}"><td>${fmtYm(m.ym)}</td><td class="num">${kr(m.start, false)}</td><td class="num">${kr(m.income, false)}</td><td class="num">${kr(m.expense, false)}</td><td class="num">${kr(m.min, false)}</td><td class="num strong">${kr(m.end, false)}</td></tr>`).join('')}</tbody>
      </table></div>` : ''}
      <p class="muted small">Regler: betalinger med dato i dag eller tidligere i denne måned regnes som betalt. Falder en regning og en indbetaling samme dag, kommer pengene ind først — ligesom i banken.</p>
    </section>`;

  const exp = { title: `Likviditet · ${state.budget.name}`, accountLabel: isAll ? 'Alle konti' : ui.account, startBalance: startBal, cf, yearEnd: dec ? dec.end : null, calYear: cal, year };
  bindExportButtons(out, 'cf-exp', {
    what: `Oversigt over ${exp.accountLabel} de næste ${ui.horizon} måneder — med hver eneste betaling og saldoen bagefter.`,
    pdf: () => cashflowToPdf(exp), xlsx: () => cashflowToExcel(exp),
  });
}

function eventsHtml(m) {
  if (!m.events.length) return '<p class="muted small">Ingen betalinger.</p>';
  return `<ul class="events">${m.events.map((e) => `
    <li class="${e.amount < 0 ? 'neg' : 'pos'}">
      <span class="ev-day">${e.day}.</span><span class="ev-name">${esc(e.name)}${e.account ? `<small> · ${esc(e.account)}</small>` : ''}</span>
      <span class="ev-amt">${krSigned(e.amount)}</span><span class="ev-bal ${e.balance < 0 ? 'neg' : ''}">${kr(e.balance)}</span>
    </li>`).join('')}</ul>`;
}

function chartSvg(months) {
  if (!months.length) return '';
  const W = 760, H = 240, PL = 64, PR = 16, PT = 16, PB = 30;
  const vals = months.flatMap((m) => [m.start, m.end, m.min]);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (hi - lo < 1000) hi = lo + 1000; // undgå akser som "1 1 1 0 0" ved små tal
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const n = months.length;
  const x = (i) => PL + (n === 1 ? (W - PL - PR) / 2 : (i * (W - PL - PR)) / (n - 1));
  const y = (v) => PT + ((hi - v) / (hi - lo)) * (H - PT - PB);
  const ticks = 4;
  const grid = Array.from({ length: ticks + 1 }, (_, i) => lo + ((hi - lo) * i) / ticks).map((v) =>
    `<line x1="${PL}" x2="${W - PR}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${PL - 8}" y="${y(v) + 4}" class="axis" text-anchor="end">${shortKr(v)}</text>`).join('');
  const line = months.map((m, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(m.end).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)} L${x(0).toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)} Z`;
  const mins = months.map((m, i) => `<circle cx="${x(i)}" cy="${y(m.min)}" r="4" class="${m.min < 0 ? 'dot-neg' : 'dot-min'}"><title>${fmtYm(m.ym)}: laveste ${kr(m.min)}</title></circle>`).join('');
  const labels = months.map((m, i) => (n > 12 && i % 2 ? '' : `<text x="${x(i)}" y="${H - 8}" class="axis" text-anchor="middle">${fmtYm(m.ym).split(' ')[0]}</text>`)).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Saldo-udvikling">
    <defs><linearGradient id="cfg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <line x1="${PL}" x2="${W - PR}" y1="${y(0)}" y2="${y(0)}" class="zero"/>
    <path d="${area}" fill="url(#cfg)"/>
    <path d="${line}" class="line"/>
    ${months.map((m, i) => `<circle cx="${x(i)}" cy="${y(m.end)}" r="3.5" class="dot-end"><title>${fmtYm(m.ym)}: ${kr(m.end)}</title></circle>`).join('')}
    ${mins}${labels}
  </svg>`;
}
function shortKr(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1).replace('.', ',')} mio`;
  if (a >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(Math.round(v));
}
