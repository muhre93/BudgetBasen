// Likviditet: simulerer saldoen hændelse for hændelse, så man kan se om og hvornår kontoen går i minus.
import { state, lists } from '../state.js';
import { esc, kr, krSigned, fmtYm, fmtDate, parseAmount, numToInput, toDate } from '../ui.js';
import { projectCashflow, calendarYear, dateToIndex } from '../calc.js';
import { exportButtons, bindExportButtons, cashflowToPdf, cashflowToExcel } from '../export.js';

const ui = { account: '__all', horizon: 12, override: '', open: new Set() };

export function render(root) {
  const L = lists();
  const today = new Date();
  const balances = state.budget.settings?.balances || [];
  const accounts = [...new Set([...balances.map((b) => b.account), ...state.items.map((i) => i.account).filter(Boolean)])];
  if (ui.account !== '__all' && !accounts.includes(ui.account)) ui.account = '__all';

  const baseBal = ui.account === '__all'
    ? balances.reduce((s, b) => s + (Number(b.amount) || 0), 0)
    : Number(balances.find((b) => b.account === ui.account)?.amount) || 0;
  const ov = parseAmount(ui.override);
  const startBal = ui.override.trim() !== '' && !Number.isNaN(ov) ? ov : baseBal;
  const items = ui.account === '__all' ? state.items : state.items.filter((i) => (i.account || '') === ui.account);

  const cf = projectCashflow(items, startBal, today, ui.horizon);
  const year = today.getFullYear();
  const dec = cf.months.find((m) => m.ym === `${year}-12`);
  const cal = calendarYear(items, year);
  const balDate = ui.account === '__all' ? null : balances.find((b) => b.account === ui.account)?.date;

  root.innerHTML = `
    <section class="toolbar glass">
      <div class="toolbar-row">
        <label class="inline">Konto
          <select id="cf-acc">
            <option value="__all">Alle konti samlet</option>
            ${accounts.map((a) => `<option ${a === ui.account ? 'selected' : ''}>${esc(a)}</option>`).join('')}
          </select>
        </label>
        <label class="inline">Periode
          <select id="cf-h">${[6, 12, 18, 24].map((h) => `<option value="${h}" ${h === ui.horizon ? 'selected' : ''}>${h} mdr.</option>`).join('')}</select>
        </label>
        <label class="inline">Startsaldo
          <input id="cf-ov" inputmode="decimal" placeholder="${numToInput(Math.round(baseBal * 100) / 100)}" value="${esc(ui.override)}" title="Prøv en anden saldo (gemmes ikke)">
        </label>
        <span class="spacer"></span>
        ${exportButtons('cf-exp')}
      </div>
      ${ui.account === '__all' ? '<p class="hint">Tip: Når du ser "Alle konti", skal overførsler mellem egne konti ikke oprettes som poster — de tæller ellers dobbelt. Vælg en enkelt konto (f.eks. Budgetkonto) og opret den månedlige overførsel som en indtægt på den konto.</p>' : ''}
    </section>

    ${cf.firstNegative
      ? `<div class="alert neg glass"><b>⚠ Kontoen går i minus ${cf.firstNegative.minDay ? `den ${cf.firstNegative.minDay}.` : 'i'} ${fmtYm(cf.firstNegative.ym, true)}</b>
         <span>Laveste punkt i perioden: ${kr(cf.lowest.amount)} den ${fmtDate(cf.lowest.date)}. Overvej at flytte en betalingsdato, øge den månedlige overførsel eller sætte ${kr(-cf.lowest.amount)} ekstra ind.</span></div>`
      : `<div class="alert pos glass"><b>✓ Kontoen holder sig i plus hele perioden</b><span>Laveste saldo: ${kr(cf.lowest.amount)} den ${fmtDate(cf.lowest.date)}.</span></div>`}

    <section class="kpis">
      <div class="kpi glass"><div class="kpi-label">Startsaldo i dag</div><div class="kpi-value">${kr(startBal)}</div><div class="kpi-sub">${balDate ? `Saldo fra ${fmtDate(balDate)}` : 'Sum af registrerede saldi'}</div></div>
      <div class="kpi glass ${cf.lowest.amount < 0 ? 'neg' : ''}"><div class="kpi-label">Laveste punkt</div><div class="kpi-value">${kr(cf.lowest.amount)}</div><div class="kpi-sub">${fmtDate(cf.lowest.date)}</div></div>
      <div class="kpi glass ${dec && dec.end < 0 ? 'neg' : 'pos'}"><div class="kpi-label">Forventet saldo 31. dec.</div><div class="kpi-value">${dec ? kr(dec.end) : '–'}</div><div class="kpi-sub">Efter årets sidste betalinger</div></div>
      <div class="kpi glass ${cal.net < 0 ? 'neg' : 'pos'}"><div class="kpi-label">Årets resultat ${year}</div><div class="kpi-value">${krSigned(cal.net)}</div><div class="kpi-sub">Ind ${kr(cal.income, false)} · ud ${kr(cal.expense, false)}</div></div>
    </section>

    <section class="glass chart-card">
      <div class="section-head"><h2>Saldo-udvikling</h2><span class="legend"><i class="l-end"></i>Saldo ved månedens udgang <i class="l-min"></i>Laveste punkt i måneden</span></div>
      ${chartSvg(cf.months)}
    </section>

    <section class="glass table-card">
      <table class="cf-table">
        <thead><tr><th>Måned</th><th class="num hide-sm">Start</th><th class="num">Ind</th><th class="num">Ud</th><th class="num hide-sm">Netto</th><th class="num">Laveste</th><th class="num">Slut</th></tr></thead>
        <tbody>
          ${cf.months.map((m, i) => `
            <tr class="cf-row ${m.min < 0 ? 'neg' : ''} ${ui.open.has(m.ym) ? 'open' : ''}" data-ym="${m.ym}">
              <td><span class="chev"></span>${fmtYm(m.ym)}${i === 0 ? ' <small class="muted">(rest)</small>' : ''}</td>
              <td class="num hide-sm">${kr(m.start, false)}</td>
              <td class="num pos">${m.income ? kr(m.income, false) : '–'}</td>
              <td class="num neg">${m.expense ? kr(m.expense, false) : '–'}</td>
              <td class="num hide-sm">${krSigned(m.net)}</td>
              <td class="num ${m.min < 0 ? 'neg strong' : ''}">${kr(m.min, false)}${m.minDay ? `<small> d. ${m.minDay}.</small>` : ''}</td>
              <td class="num strong">${kr(m.end, false)}</td>
            </tr>
            ${ui.open.has(m.ym) ? `<tr class="cf-events"><td colspan="7">${eventsHtml(m)}</td></tr>` : ''}`).join('')}
        </tbody>
      </table>
      <p class="muted small pad">Betalinger med betalingsdag i dag eller tidligere i denne måned antages at være trukket. Falder en udgift og en indtægt samme dag, trækkes udgiften først (forsigtig beregning). Klik på en måned for at se hver betaling.</p>
    </section>`;

  const exp = { title: `Likviditet · ${state.budget.name}`, accountLabel: ui.account === '__all' ? 'Alle konti' : ui.account, startBalance: startBal, cf, yearEnd: dec ? dec.end : null, calYear: cal, year };
  bindExportButtons(root, 'cf-exp', { pdf: () => cashflowToPdf(exp), xlsx: () => cashflowToExcel(exp) });
  root.querySelector('#cf-acc').onchange = (e) => { ui.account = e.target.value; ui.override = ''; render(root); };
  root.querySelector('#cf-h').onchange = (e) => { ui.horizon = Number(e.target.value); render(root); };
  root.querySelector('#cf-ov').oninput = (e) => { ui.override = e.target.value; render(root); };
  root.querySelectorAll('.cf-row').forEach((r) => (r.onclick = () => {
    const ym = r.dataset.ym;
    if (ui.open.has(ym)) ui.open.delete(ym); else ui.open.add(ym);
    render(root);
  }));
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
  if (hi === lo) hi = lo + 1;
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
