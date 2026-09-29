// Deling & udskrift: vælg poster med flueben → print-preview eller read-only link (f.eks. til banken).
import { db, doc, getDoc, setDoc, deleteDoc, updateDoc, serverTimestamp, Timestamp } from '../firebase.js';
import { state, isAdmin, lists, isShared } from '../state.js';
import { esc, kr, krSigned, fmtYm, fmtDate, openModal, toast, copyText, randomId, isoDate } from '../ui.js';
import { monthly, summarize, projectCashflow, freqLabel, countsInBudget, dateToIndex } from '../calc.js';
import { logAction } from '../data.js';
import { reportToPdf, reportToExcel, runExport, exportButtons } from '../export.js';

const shareUrl = (token) => `${location.origin}${location.pathname}?share=${token}`;

export function openShareDialog() {
  const now = dateToIndex(new Date());
  const items = state.items.filter((i) => countsInBudget(i, now));
  const L = lists();
  const groups = ['income', 'expense'].map((t) => [t, items.filter((i) => i.type === t).sort((a, b) => (a.category || '').localeCompare(b.category || '', 'da') || a.name.localeCompare(b.name, 'da'))]);

  const body = `
 <div class="share-intro">
      <p><b>1.</b> Sæt flueben ved de poster, der skal med (private poster er fravalgt). <b>2.</b> Vælg nederst hvad du vil:</p>
      <ul class="plain small">
        <li><b>📄 Hent PDF</b> — en færdig side til at printe, gemme eller sende til banken</li>
        <li><b>📊 Hent Excel</b> — et regneark, hvis du selv vil regne videre</li>
        <li><b>🖨 Udskriv</b> — direkte til printeren</li>
        ${isAdmin() ? '<li><b>🔗 Lav link</b> — et link banken kan åbne uden at logge ind (kun de valgte poster)</li>' : ''}
      </ul>
    </div>
    <label>Overskrift<input name="title" value="${esc(state.budget.name)} — budgetoversigt ${fmtDate(new Date())}"></label>
    <div class="share-opts">
      <label class="check"><input type="checkbox" name="optSupplier" checked> Vis leverandør</label>
      <label class="check"><input type="checkbox" name="optWho"> Vis hvem der betaler</label>
      <label class="check"><input type="checkbox" name="optAccount"> Vis konto</label>
      <label class="check"><input type="checkbox" name="optNote"> Vis noter</label>
      <label class="check"><input type="checkbox" name="optCashflow"> Medtag likviditet (12 mdr.)</label>
      <label class="check"><input type="checkbox" name="optSelectedTotals" checked> Totaler kun af valgte poster</label>
    </div>
    <div class="share-pick">
      <div class="row-between"><b>Hvilke poster skal med?</b><span><button type="button" class="link" data-all>Alle</button> · <button type="button" class="link" data-none>Ingen</button> · <button type="button" class="link" data-nopriv>Fravælg private</button></span></div>
      ${groups.map(([t, list]) => list.length ? `<div class="pick-group"><h4>${t === 'income' ? 'Indtægter' : 'Udgifter'}</h4>
        ${list.map((i) => `<label class="check pick"><input type="checkbox" name="pick" value="${i.id}" data-private="${i.private || !isShared(i) ? 1 : 0}" ${i.private || !isShared(i) ? '' : 'checked'}>
          <span>${esc(i.name)}<small class="muted"> · ${esc(i.category || '')}</small></span><span class="num">${kr(monthly(i))}/md.</span></label>`).join('')}
      </div>` : '').join('')}
    </div>
    <div class="share-count muted small" id="share-count"></div>
    ${isAdmin() ? `<div class="grid2"><label>Linket udløber
      <select name="expires"><option value="7">Om 7 dage</option><option value="30" selected>Om 30 dage</option><option value="90">Om 90 dage</option><option value="0">Aldrig</option></select></label></div>` : ''}`;

  const pick = (form) => {
    const data = buildReport(form);
    if (!data.sections.some((s) => s.items.length)) throw new Error('Vælg mindst én post');
    return data;
  };
  const buttons = [
    { label: '📄 Hent PDF', cls: 'ghost', onClick: async (form) => { await reportToPdf(pick(form)); toast('PDF hentet'); return false; } },
    { label: '📊 Hent Excel', cls: 'ghost', onClick: async (form) => { await reportToExcel(pick(form)); toast('Excel-fil hentet'); return false; } },
    { label: '🖨 Udskriv', cls: 'ghost', onClick: (form) => { printReport(pick(form)); return false; } },
  ];
  if (isAdmin()) {
    buttons.push({ label: '🔗 Lav link', cls: 'primary', onClick: async (form) => {
      const data = buildReport(form);
      if (!data.sections.some((s) => s.items.length)) { toast('Vælg mindst én post', 'error'); return false; }
      const days = Number(form.expires.value);
      await createShare(data, days);
    } });
  }

  openModal({
    title: 'Hent / del budgettet', body, wide: true, buttons,
    onOpen: (form) => {
      const upd = () => {
        const n = form.querySelectorAll('[name=pick]:checked').length;
        form.querySelector('#share-count').textContent = `${n} af ${items.length} poster valgt`;
      };
      form.addEventListener('change', upd); upd();
      const set = (fn) => { form.querySelectorAll('[name=pick]').forEach((c) => (c.checked = fn(c))); upd(); };
      form.querySelector('[data-all]').onclick = () => set(() => true);
      form.querySelector('[data-none]').onclick = () => set(() => false);
      form.querySelector('[data-nopriv]').onclick = () => set((c) => (c.dataset.private === '1' ? false : c.checked));
    },
  });
}

function buildReport(form) {
  const L = lists();
  const now = dateToIndex(new Date());
  const picked = new Set([...form.querySelectorAll('[name=pick]:checked')].map((c) => c.value));
  const all = state.items.filter((i) => countsInBudget(i, now));
  const sel = all.filter((i) => picked.has(i.id));
  const opts = {
    supplier: form.optSupplier.checked, who: form.optWho.checked, account: form.optAccount.checked,
    note: form.optNote.checked, cashflow: form.optCashflow.checked, selectedTotals: form.optSelectedTotals.checked,
  };
  const basis = opts.selectedTotals ? sel : all;
  const s = summarize(basis);
  const sections = [];
  for (const type of ['income', 'expense']) {
    const byCat = new Map();
    for (const i of sel.filter((x) => x.type === type)) {
      const c = i.category || 'Uden kategori';
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push({
        name: i.name, amount: i.amount, freqLabel: freqLabel(i.freq, L.frequencies), monthly: Math.round(monthly(i) * 100) / 100,
        supplier: opts.supplier ? i.supplier || '' : '', who: opts.who ? i.who || '' : '',
        account: opts.account ? i.account || '' : '', note: opts.note ? i.note || '' : '',
      });
    }
    for (const [cat, items] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0], 'da'))) {
      sections.push({ type, category: cat, total: items.reduce((x, i) => x + i.monthly, 0), items });
    }
  }
  let cashflow = null;
  if (opts.cashflow) {
    const bal = (state.budget.settings?.balances || []).reduce((x, b) => x + (Number(b.amount) || 0), 0);
    cashflow = projectCashflow(sel, bal, new Date(), 12).months.map((m) => ({ ym: m.ym, start: m.start, income: m.income, expense: m.expense, min: m.min, minDay: m.minDay, end: m.end }));
  }
  return {
    title: form.title.value.trim() || state.budget.name, generated: isoDate(), opts,
    totals: { income: s.income, expense: s.expense, net: s.net, yearNet: s.yearNet },
    sections, cashflow,
  };
}

/** Ren HTML-rapport — bruges både til print og til det offentlige read-only link. */
export function reportHtml(r) {
  const o = r.opts || {};
  const cols = [o.supplier && 'Leverandør', o.who && 'Hvem', o.account && 'Konto'].filter(Boolean);
  const sec = (type) => r.sections.filter((s) => s.type === type).map((s) => `
    <tr class="r-cat"><td colspan="${3 + cols.length}">${esc(s.category)}</td><td class="num">${kr(s.total)}</td></tr>
    ${s.items.map((i) => `<tr>
      <td>${esc(i.name)}${i.note ? `<div class="r-note">${esc(i.note)}</div>` : ''}</td>
      ${o.supplier ? `<td>${esc(i.supplier)}</td>` : ''}${o.who ? `<td>${esc(i.who)}</td>` : ''}${o.account ? `<td>${esc(i.account)}</td>` : ''}
      <td>${esc(i.freqLabel)}</td><td class="num">${kr(i.amount)}</td><td class="num">${kr(i.monthly)}</td></tr>`).join('')}`).join('');
  const head = `<tr><th>Post</th>${cols.map((c) => `<th>${c}</th>`).join('')}<th>Frekvens</th><th class="num">Beløb</th><th class="num">Pr. md.</th></tr>`;
  return `<article class="report">
    <header class="r-head"><div><h1>${esc(r.title)}</h1><p>Udarbejdet ${fmtDate(r.generated)} med BudgetBasen</p></div></header>
    <section class="r-kpis">
      <div><span>Indtægter pr. md.</span><b>${kr(r.totals.income)}</b></div>
      <div><span>Udgifter pr. md.</span><b>${kr(r.totals.expense)}</b></div>
      <div><span>Rådighed pr. md.</span><b>${kr(r.totals.net)}</b></div>
      <div><span>Pr. år</span><b>${kr(r.totals.yearNet, false)}</b></div>
    </section>
    ${r.sections.some((s) => s.type === 'income') ? `<h2>Indtægter</h2><table class="r-table">${head}${sec('income')}</table>` : ''}
    ${r.sections.some((s) => s.type === 'expense') ? `<h2>Udgifter</h2><table class="r-table">${head}${sec('expense')}</table>` : ''}
    ${r.cashflow ? `<h2>Likviditet næste 12 måneder</h2><table class="r-table">
      <tr><th>Måned</th><th class="num">Start</th><th class="num">Ind</th><th class="num">Ud</th><th class="num">Laveste</th><th class="num">Slut</th></tr>
      ${r.cashflow.map((m) => `<tr><td>${fmtYm(m.ym)}</td><td class="num">${kr(m.start, false)}</td><td class="num">${kr(m.income, false)}</td><td class="num">${kr(m.expense, false)}</td><td class="num">${kr(m.min, false)}</td><td class="num">${kr(m.end, false)}</td></tr>`).join('')}
    </table>` : ''}
    ${o.selectedTotals ? '' : '<p class="r-foot">Totaler omfatter alle aktive poster, også dem der ikke er vist.</p>'}
  </article>`;
}

export function printReport(data) {
  const root = document.getElementById('print-root');
  root.innerHTML = reportHtml(data);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

async function createShare(data, days) {
  const token = randomId(28);
  const expiresAt = days ? Timestamp.fromDate(new Date(Date.now() + days * 864e5)) : null;
  await setDoc(doc(db, 'shares', token), {
    budgetId: state.budgetId, createdBy: state.user.uid, createdAt: serverTimestamp(), expiresAt, data,
  });
  const entry = { token, title: data.title, createdAt: Date.now(), expiresAt: expiresAt ? expiresAt.toMillis() : null, count: data.sections.reduce((s, x) => s + x.items.length, 0) };
  await updateDoc(doc(db, 'budgets', state.budgetId), { shares: [...(state.budget.shares || []), entry] });
  logAction('create', 'share', data.title, { Udløber: { from: '', to: days ? `${days} dage` : 'aldrig' } });
  await copyText(shareUrl(token));
  toast('Link oprettet og kopieret — alle med linket kan se de valgte poster', 'ok', 5000);
}

export async function deleteShare(token) {
  await deleteDoc(doc(db, 'shares', token)).catch(() => {});
  await updateDoc(doc(db, 'budgets', state.budgetId), { shares: (state.budget.shares || []).filter((s) => s.token !== token) });
  logAction('delete', 'share', token.slice(0, 6) + '…');
}
export { shareUrl };

/** Offentlig visning: index.html?share=TOKEN — ingen login nødvendigt. */
export async function renderPublicShare(token) {
  document.getElementById('splash').classList.add('hidden');
  const root = document.getElementById('share-view');
  root.classList.remove('hidden');
  root.innerHTML = '<div class="skeleton"></div>';
  try {
    const s = await getDoc(doc(db, 'shares', token));
    if (!s.exists()) throw new Error('not-found');
    document.title = s.data().data.title;
    const data = s.data().data;
    root.innerHTML = `<div class="share-bar no-print"><span class="brand-mini">BudgetBasen · skrivebeskyttet visning</span>
      <span class="row-actions">${exportButtons('share-exp')}<button class="btn small ghost" id="share-print">Udskriv</button></span></div>
      <div class="share-paper">${reportHtml(data)}</div>`;
    root.querySelector('#share-exp [data-exp=pdf]').onclick = (e) => runExport(e.currentTarget, () => reportToPdf(data));
    root.querySelector('#share-exp [data-exp=xlsx]').onclick = (e) => runExport(e.currentTarget, () => reportToExcel(data));
    root.querySelector('#share-print').onclick = () => window.print();
  } catch {
    root.innerHTML = '<div class="empty glass share-missing"><div class="empty-emoji">🔒</div><h3>Linket findes ikke eller er udløbet</h3><p>Bed afsenderen om et nyt link.</p></div>';
  }
}
